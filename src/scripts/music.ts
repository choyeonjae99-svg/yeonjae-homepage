/*
 * 배경음악 — YouTube IFrame Player API.
 *
 *  - 자동재생 없음. 사운드 버튼을 눌러야 재생된다.
 *  - 페이지를 옮겨도 끊기지 않도록 플레이어를 <body> 바깥(<html> 바로 아래)에 둔다.
 *    Astro View Transitions 는 <body> 만 교체하므로 iframe 이 다시 로드되지 않는다.
 *  - 버튼을 누르는 순간 바로 재생되도록(모바일 자동재생 제한), 페이지가 한가해지면
 *    플레이어를 미리 준비해 둔다. 소리는 버튼을 눌러야만 난다.
 *  - 켜고 끌 때 짧은 페이드 인/아웃, 끝나면 처음부터 반복.
 *  - YouTube 소리는 다른 사이트(iframe) 것이라 Web Audio 로 볼륨을 읽을 수 없다.
 *    그래서 연결망 반응용 level 은 재생 중일 때 박자처럼 흉내 낸 값이다.
 */

type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

type YTPlayer = {
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
  private startedAt = 0;
  private envelope = 0; // 0–1, 켜질 때 올라가고 꺼질 때 내려간다

  configure(videoId: string, volume = 60) {
    this.videoId = videoId;
    this.volume = volume;
  }

  get on() {
    return this.state === 'playing' || (this.state === 'loading' && this.wantPlay);
  }

  /** 연결망 반응용 0–1 값 (재생 중 박자 흉내 × 페이드 정도) */
  level(now = performance.now()) {
    const target = this.state === 'playing' ? 1 : 0;
    this.envelope += (target - this.envelope) * 0.05;
    if (this.envelope < 0.01) return 0;
    const t = (now - this.startedAt) / 1000;
    const beat = Math.pow(Math.max(0, Math.cos(t * Math.PI * (92 / 60))), 6); // 약 92 BPM
    const sway = 0.5 + 0.5 * Math.sin(t * 0.4);
    return this.envelope * (0.25 + 0.45 * beat + 0.3 * sway);
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
                this.startedAt = performance.now();
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
