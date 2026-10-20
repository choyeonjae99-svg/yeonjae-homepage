/*
 * 배경음악 — YouTube IFrame Player API.
 *
 *  - 자동재생 없음. 사운드 버튼을 눌러야 재생된다.
 *  - 페이지를 옮겨도 끊기지 않도록 플레이어를 <body> 바깥(<html> 바로 아래)에 둔다.
 *    Astro View Transitions 는 <body> 만 교체하므로 iframe 이 다시 로드되지 않는다.
 *  - 버튼을 누르는 순간 바로 재생되도록(모바일 자동재생 제한), 페이지가 한가해지면
 *    플레이어를 미리 준비해 둔다. 소리는 버튼을 눌러야만 난다.
 *  - 켜고 끌 때 짧은 페이드 인/아웃, 끝나면 처음부터 반복.
 *  - YouTube 소리는 다른 사이트(iframe) 것이라 Web Audio 로 소리를 분석할 수 없다.
 *    대신 곡의 BPM·첫 박 위치(music.json)와 플레이어의 실제 재생 위치로 "지금 몇 번째 박인지"를 계산한다.
 *    → beat() 가 연결망에 박 정보를 준다. 멈추거나 되감아도 재생 위치를 따라간다.
 */

type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** 연결망에 넘기는 박 정보 */
export interface BeatInfo {
  index: number; // 곡 처음부터 몇 번째 박인지
  phase: number; // 박 안에서의 위치 0–1 (0 = 박이 막 친 순간)
  downbeat: boolean; // 마디 첫 박(강박)인지
  period: number; // 한 박 길이 (초)
  strength: number; // 0–1, 켜고 끌 때 서서히
}

type YTPlayer = {
  getCurrentTime(): number;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(v: number): void;
  seekTo(s: number, allow: boolean): void;
  getPlayerState(): number;
};

type YTNamespace = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const FADE_MS = 900;
const FADE_STEPS = 12; // 페이드도 끊어지게

class Music extends EventTarget {
  state: State = 'idle';
  private videoId = '';
  private volume = 60;
  private player: YTPlayer | null = null;
  private ready = false;
  private wantPlay = false;
  private fadeTimer = 0;
  private preparing: Promise<void> | null = null;
  private envelope = 0; // 0–1, 켜질 때 올라가고 꺼질 때 내려간다
  private bpm = 0;
  private offset = 0;
  private beatsPerBar = 4;
  private lastRead = { song: 0, at: 0 };

  configure(videoId: string, volume = 60, beat?: { bpm: number; offset: number; beatsPerBar: number }) {
    this.videoId = videoId;
    this.volume = volume;
    if (beat) this.setBeat(beat.bpm, beat.offset, beat.beatsPerBar);
  }

  /** 박자 설정 (관리자 페이지의 박자 맞추기에서 바로 바꿔 볼 때도 쓴다) */
  setBeat(bpm: number, offset: number, beatsPerBar = 4) {
    this.bpm = bpm;
    this.offset = offset;
    this.beatsPerBar = beatsPerBar;
  }

  /**
   * 곡의 현재 재생 위치(초). 플레이어 값은 띄엄띄엄 갱신되므로
   * 값이 그대로면 흐른 시간만큼 더해서 매끄럽게 만든다.
   */
  time(now = performance.now()) {
    if (!this.player || !this.ready) return 0;
    const song = this.player.getCurrentTime?.() ?? 0;
    if (song !== this.lastRead.song || this.state !== 'playing') this.lastRead = { song, at: now };
    return this.state === 'playing' ? this.lastRead.song + (now - this.lastRead.at) / 1000 : song;
  }

  /** 재생 중일 때만 박 정보, 아니면 null */
  beat(now = performance.now()): BeatInfo | null {
    const target = this.state === 'playing' ? 1 : 0;
    this.envelope += (target - this.envelope) * 0.08;
    if (this.envelope < 0.02 || !this.bpm) return null;
    const period = 60 / this.bpm;
    const pos = (this.time(now) - this.offset) / period;
    const index = Math.floor(pos);
    return {
      index,
      phase: pos - index,
      downbeat: ((index % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0,
      period,
      strength: this.envelope,
    };
  }

  get on() {
    return this.state === 'playing' || (this.state === 'loading' && this.wantPlay);
  }

  /** 소리 없이 플레이어만 미리 만들어 둔다 */
  prepare(): Promise<void> {
    if (!this.videoId) return Promise.resolve();
    if (this.preparing) return this.preparing;
    this.preparing = new Promise<void>((resolve) => {
      const create = () => {
        const YT = window.YT!;
        const host = document.createElement('div');
        host.id = 'music-host';
        host.setAttribute('aria-hidden', 'true');
        // 화면 밖에 둔다. display:none 이면 일부 브라우저가 재생을 막는다
        host.style.cssText =
          'position:fixed;left:-10000px;top:0;width:200px;height:200px;overflow:hidden;pointer-events:none;';
        const mount = document.createElement('div');
        host.appendChild(mount);
        document.documentElement.appendChild(host);

        this.player = new YT.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          width: 200,
          height: 200,
          videoId: this.videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            loop: 1,
            playlist: this.videoId, // loop 를 쓰려면 같은 id 를 playlist 로 넣어야 한다
          },
          events: {
            onReady: () => {
              this.ready = true;
              this.player!.setVolume(0);
              resolve();
              if (this.wantPlay) this.play();
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === YT.PlayerState.ENDED) {
                this.player!.seekTo(0, true);
                this.player!.playVideo();
              }
              if (e.data === YT.PlayerState.PLAYING && this.wantPlay && this.state !== 'playing') {
                this.set('playing');
                this.fadeTo(this.volume);
              }
            },
            onError: () => {
              this.wantPlay = false;
              this.set('error');
              resolve();
            },
          },
        });
      };

      if (window.YT?.Player) {
        create();
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        create();
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => {
        this.set('error');
        resolve();
      };
      document.head.appendChild(s);
    });
    return this.preparing;
  }

  toggle() {
    if (this.on) this.pause();
    else this.play();
  }

  play() {
    if (this.state === 'error') return;
    this.wantPlay = true;
    if (!this.ready || !this.player) {
      this.set('loading');
      this.watchStall();
      void this.prepare();
      return;
    }
    // 페이드아웃 도중에 다시 켠 경우: 이미 재생 중이니 볼륨만 올린다
    if (this.player.getPlayerState() === window.YT!.PlayerState.PLAYING) {
      this.set('playing');
      this.fadeTo(this.volume);
      return;
    }
    window.clearInterval(this.fadeTimer);
    this.currentVolume = 0;
    this.player.setVolume(0);
    this.player.playVideo(); // 버튼 클릭 안에서 바로 호출해야 모바일에서도 재생된다
    this.set('loading');
    this.watchStall();
  }

  /** 브라우저가 재생을 막으면 '로딩'에 멈춰 있지 않게 꺼진 상태로 되돌린다 */
  private stallTimer = 0;
  private watchStall() {
    window.clearTimeout(this.stallTimer);
    this.stallTimer = window.setTimeout(() => {
      if (this.state === 'loading') {
        this.wantPlay = false;
        this.set('paused');
      }
    }, 8000);
  }

  pause() {
    this.wantPlay = false;
    if (!this.player || !this.ready) {
      this.set('paused');
      return;
    }
    this.set('paused');
    this.fadeTo(0, () => {
      if (!this.wantPlay) this.player?.pauseVideo();
    });
  }

  private fadeTo(target: number, done?: () => void) {
    window.clearInterval(this.fadeTimer);
    if (!this.player) return;
    const from = this.currentVolume;
    let i = 0;
    this.fadeTimer = window.setInterval(() => {
      i++;
      const v = Math.round(from + ((target - from) * i) / FADE_STEPS);
      this.currentVolume = v;
      this.player?.setVolume(v);
      if (i >= FADE_STEPS) {
        window.clearInterval(this.fadeTimer);
        done?.();
      }
    }, FADE_MS / FADE_STEPS);
  }
  private currentVolume = 0;

  private set(state: State) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new CustomEvent('change', { detail: { state } }));
  }
}

/** 페이지 전체에서 하나만 쓰는 음악 플레이어 */
export const music = new Music();
