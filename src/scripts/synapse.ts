/*
 * 시냅스 연결망 — 메인 화면 Canvas 2D 그래픽.
 *
 * 규칙 (CLAUDE.md 3-3, 4장):
 *  - 모든 좌표는 정수 픽셀에 스냅한다. 점은 네모, 선은 2px 점 + 6px 간격 픽셀 점선.
 *  - 움직임은 TICK 단위로 끊어서 그린다 (CSS steps() 와 같은 레트로 느낌).
 *  - 회색 노드 + 자홍 노드(네모 링 맥박) + 꼬리 2개 달린 자홍 신호 + 전체 drift.
 *  - 커서 근처 노드가 끌려오고, 커서와 가까운 노드 사이에 임시 연결선이 생긴다.
 *  - 화면 크기에 따라 노드 수·배치를 새로 만든다. 모바일은 노드 수가 적다.
 *  - prefers-reduced-motion 이면 정지 화면 한 장만 그린다.
 *  - setBeatSource() 로 음악의 박 정보를 넣으면 박마다 자홍 노드가 차례로 맥박을 치고
 *    (마디 첫 박에는 전부), 크기가 커졌다 돌아오며, 신호가 박에 맞춰 튀어 나간다.
 */

type Node = {
  x: number; // 기본 위치
  y: number;
  accent: boolean;
  phase: number; // 개별 흔들림 위상
  pulseDelay: number; // 맥박 시작 지연 (초)
  ox: number; // 커서에 끌려간 현재 오프셋
  oy: number;
  adj: number[]; // 연결된 노드 인덱스
};

type Signal = {
  from: number;
  to: number;
  dist: number; // 현재 선분에서 이동한 거리
  trail: { t: number; x: number; y: number }[];
};

type Palette = {
  accent: string;
  accentDeep: string;
  dot: string;
  node: string;
};

const TICK = 1000 / 24; // 초당 24번만 화면을 바꾼다
const DASH = 8; // 픽셀 점선 주기 (2px 점 + 6px 간격)
const NODE = 6;
const NODE_ACCENT = 10;
const PULSE_PERIOD = 2.6; // 초
const PULSE_STEPS = 8;
const PULSE_SCALE = 4;
const DRIFT_PERIOD = 22; // 초 — 프로토타입과 같은 값
const DRIFT_STEPS = 24;
const DRIFT_X = -16;
const DRIFT_Y = 8;
const WOBBLE = 3; // 노드 개별 흔들림 (px)
const SIGNAL_SPEED = 150; // px/s — 프로토타입 신호 속도와 비슷하게
const TAIL_DELAYS = [0.15, 0.3]; // 꼬리 2개 (초 단위로 뒤따름)
const TAIL_ALPHA = [0.55, 0.25];
const CURSOR_RADIUS = 170;
const CURSOR_PULL = 14; // 최대로 끌려가는 거리 (px)
const CURSOR_LINKS = 3;

/** 음악 박 정보 (music.ts 의 BeatInfo 와 같은 모양) */
export interface Beat {
  index: number;
  phase: number;
  downbeat: boolean;
  period: number;
  strength: number;
}
type Ring = { node: number; start: number; dur: number; strong: boolean };
const BEAT_RING_STEPS = 6;

/** 같은 화면 크기에서는 같은 배치가 나오도록 고정 시드 난수 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const px = Math.round;

export class Synapse {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private nodes: Node[] = [];
  private edges: [number, number][] = [];
  private signals: Signal[] = [];
  private colors: Palette;

  private raf = 0;
  private lastTick = 0;
  private time = 0; // 경과 시간 (초, 일시정지 동안은 멈춤)
  private prevNow = 0;
  private running = false;

  private pointer: { x: number; y: number } | null = null;
  private level = 0; // 음악 볼륨 0–1
  private reduced: MediaQueryList;
  private resizeTimer = 0;
  private cleanup: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 쓸 수 없습니다');
    this.ctx = ctx;
    this.colors = this.readPalette();
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.resize();
    this.listen();
    this.start();
  }

  /** 음악 반응 정도 (0–1) */
  setLevel(v: number) {
    this.level = Math.max(0, Math.min(1, v));
  }

  /** 매 틱마다 음악 박 정보를 읽어올 함수 (재생 중이 아니면 null 을 돌려준다) */
  setBeatSource(fn: (() => Beat | null) | null) {
    this.beatSource = fn;
  }
  private beatSource: (() => Beat | null) | null = null;
  private beat: Beat | null = null;
  private lastBeat = Number.NaN;
  private rings: Ring[] = [];
  private accentOrder: number[] = [];

  /** 박이 칠 때: 강박엔 자홍 노드 전부, 나머지 박엔 하나씩 돌아가며 링을 퍼뜨린다 */
  private onBeat(b: Beat) {
    if (!this.accentOrder.length) return;
    const dur = Math.min(1.2, Math.max(0.35, b.period * 0.95));
    const targets = b.downbeat
      ? this.accentOrder
      : [this.accentOrder[((b.index % this.accentOrder.length) + this.accentOrder.length) % this.accentOrder.length]];
    for (const node of targets) this.rings.push({ node, start: this.time, dur, strong: b.downbeat });
  }

  /** 박 직후 1 → 박 끝 0 으로 줄어드는 세기 (끊어지게 4단계) */
  private kick() {
    const b = this.beat;
    if (!b) return 0;
    const k = Math.pow(1 - b.phase, 3) * b.strength;
    return Math.round(k * 4) / 4;
  }

  destroy() {
    this.stop();
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    window.clearTimeout(this.resizeTimer);
  }

  // ── 설정 ────────────────────────────────

  private readPalette(): Palette {
    const s = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
    return {
      accent: v('--color-accent', '#e0306a'),
      accentDeep: v('--color-accent-deep', '#9e1f4a'),
      dot: v('--color-dot', '#4a474e'),
      node: v('--color-node', '#8a858c'),
    };
  }

  private on(
    target: EventTarget,
    type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: (e: any) => void,
    opts?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, fn, opts);
    this.cleanup.push(() => target.removeEventListener(type, fn, opts));
  }

  private listen() {
    this.on(window, 'resize', () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.resize(), 150);
    });
    this.on(window, 'pointermove', (e: PointerEvent) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    }, { passive: true });
    this.on(document, 'pointerleave', () => (this.pointer = null));
    this.on(window, 'blur', () => (this.pointer = null));
    // 터치는 손을 떼면 커서 효과를 없앤다
    this.on(window, 'pointerup', (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') this.pointer = null;
    });
    this.on(document, 'visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.on(this.reduced, 'change', () => (this.reduced.matches ? this.stop() : this.start()));
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, px(rect.width));
    this.h = Math.max(1, px(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.build();
    this.draw();
  }

  // ── 연결망 만들기 ───────────────────────

  private build() {
    const { w, h } = this;
    const mobile = w <= 640;
    const rand = mulberry32(w * 7919 + h);

    // 헤더·푸터 글자와 겹치지 않도록 위아래를 비운 영역에만 노드를 둔다
    const top = mobile ? 76 : 96;
    const bottom = mobile ? 64 : 84;
    const side = mobile ? 8 : 24;
    const aw = w - side * 2;
    const ah = Math.max(1, h - top - bottom);

    // 1440×900 에서 약 38개 (프로토타입과 비슷한 밀도), 모바일은 줄인다
    const count = Math.round(Math.min(44, Math.max(mobile ? 18 : 20, (w * h) / 34000)));
    const cols = Math.max(2, Math.round(Math.sqrt((count * aw) / ah)));
    const rows = Math.max(2, Math.ceil(count / cols));
    const cw = aw / cols;
    const ch = ah / rows;

    // 흐트러진 격자: 칸마다 하나씩, 칸 안에서 무작위 위치.
    // 칸이 노드보다 많으면 남는 칸을 여기저기 흩어서 비운다 (한쪽만 비지 않게)
    const cells = rows * cols;
    const skip = new Set(
      Array.from({ length: cells }, (_, i) => i)
        .sort(() => rand() - 0.5)
        .slice(0, cells - count),
    );
    const nodes: Node[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (skip.has(r * cols + c)) continue;
        nodes.push({
          x: px(side + (c + 0.12 + rand() * 0.76) * cw),
          y: px(top + (r + 0.12 + rand() * 0.76) * ch),
          accent: false,
          phase: rand() * Math.PI * 2,
          pulseDelay: 0,
          ox: 0,
          oy: 0,
          adj: [],
        });
      }
    }

    // 자홍 노드: 약 1/6 (최소 3개)
    const accentCount = Math.max(3, Math.round(nodes.length / 6));
    const order = nodes.map((_, i) => i).sort(() => rand() - 0.5);
    order.slice(0, accentCount).forEach((i, k) => {
      nodes[i].accent = true;
      nodes[i].pulseDelay = (k * 0.4) % PULSE_PERIOD;
    });

    // 연결선: 최소 신장 트리(끊긴 곳 없게) + 각 노드의 가까운 이웃 3개 (모바일 2개)
    const d2 = (a: Node, b: Node) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const seen = new Set<string>();
    const edges: [number, number][] = [];
    const link = (a: number, b: number) => {
      const k = key(a, b);
      if (a === b || seen.has(k)) return;
      seen.add(k);
      edges.push([a, b]);
      nodes[a].adj.push(b);
      nodes[b].adj.push(a);
    };

    const inTree = new Set([0]);
    while (inTree.size < nodes.length) {
      let best: [number, number] = [0, 0];
      let bestD = Infinity;
      for (const a of inTree) {
        for (let b = 0; b < nodes.length; b++) {
          if (inTree.has(b)) continue;
          const d = d2(nodes[a], nodes[b]);
          if (d < bestD) (bestD = d), (best = [a, b]);
        }
      }
      link(best[0], best[1]);
      inTree.add(best[1]);
    }
    const maxD = (Math.max(cw, ch) * 1.6) ** 2;
    nodes.forEach((n, i) => {
      nodes
        .map((m, j) => [j, d2(n, m)] as const)
        .filter(([j, d]) => j !== i && d < maxD)
        .sort((a, b) => a[1] - b[1])
        .slice(0, mobile ? 2 : 3)
        .forEach(([j]) => link(i, j));
    });

    this.nodes = nodes;
    this.edges = edges;
    this.accentOrder = nodes.map((n, i) => (n.accent ? i : -1)).filter((i) => i >= 0);
    this.rings = [];

    // 신호: 데스크톱 4개, 모바일 2개. 자홍 노드에서 출발
    const accents = nodes.map((n, i) => (n.accent ? i : -1)).filter((i) => i >= 0);
    this.signals = Array.from({ length: mobile ? 2 : 4 }, (_, k) => {
      const from = accents[k % accents.length];
      const to = nodes[from].adj[Math.floor(rand() * nodes[from].adj.length)];
      return { from, to, dist: rand() * 40, trail: [] as Signal['trail'] };
    });
    // 첫 화면(또는 움직임 줄이기 정지 화면)에도 신호가 보이게 시작 위치를 넣는다
    for (const s of this.signals) {
      const a = this.pos(s.from);
      const b = this.pos(s.to);
      const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const t = Math.min(1, s.dist / len);
      s.trail = [{ t: this.time, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }];
    }
  }

  // ── 루프 ────────────────────────────────

  private start() {
    if (this.running || document.hidden) return;
    if (this.reduced.matches) {
      this.draw();
      return;
    }
    this.running = true;
    this.prevNow = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (now - this.lastTick < TICK) return;
      this.lastTick = now;
      const dt = Math.min(0.1, (now - this.prevNow) / 1000);
      this.prevNow = now;
      this.update(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private update(dt: number) {
    this.time += dt;

    // 음악 박: 새 박이 오면 링을 퍼뜨리고, 신호 속도·노드 크기는 kick() 으로 박에 맞춘다
    this.beat = this.beatSource?.() ?? null;
    if (this.beat) {
      if (this.beat.index !== this.lastBeat) {
        if (!Number.isNaN(this.lastBeat)) this.onBeat(this.beat);
        this.lastBeat = this.beat.index;
      }
      this.setLevel(this.beat.strength);
    } else {
      this.lastBeat = Number.NaN;
      this.setLevel(0);
    }
    this.rings = this.rings.filter((r) => this.time - r.start < r.dur);

    // 커서 쪽으로 끌려가기 (정지 상태 기준 거리로 계산)
    const p = this.pointer;
    for (const n of this.nodes) {
      let tx = 0;
      let ty = 0;
      if (p) {
        const dx = p.x - n.x;
        const dy = p.y - n.y;
        const d = Math.hypot(dx, dy);
        if (d < CURSOR_RADIUS && d > 0) {
          const f = (1 - d / CURSOR_RADIUS) * CURSOR_PULL;
          tx = (dx / d) * f;
          ty = (dy / d) * f;
        }
      }
      n.ox += (tx - n.ox) * 0.25;
      n.oy += (ty - n.oy) * 0.25;
    }

    // 신호 이동 — 음악이 나오면 박마다 튀어 나갔다가 박 끝에서 느려진다
    const speed = this.beat
      ? SIGNAL_SPEED * (0.35 + 3 * this.kick() + 0.4 * (1 - this.beat.strength))
      : SIGNAL_SPEED;
    for (const s of this.signals) {
      s.dist += speed * dt;
      let a = this.pos(s.from);
      let b = this.pos(s.to);
      let len = Math.hypot(b.x - a.x, b.y - a.y);
      while (s.dist >= len) {
        s.dist -= len;
        const prev = s.from;
        s.from = s.to;
        const options = this.nodes[s.from].adj.filter((j) => j !== prev);
        const pool = options.length ? options : this.nodes[s.from].adj;
        s.to = pool[Math.floor(Math.random() * pool.length)];
        a = this.pos(s.from);
        b = this.pos(s.to);
        len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      }
      const t = s.dist / len;
      s.trail.push({ t: this.time, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const keep = this.time - TAIL_DELAYS[TAIL_DELAYS.length - 1] - 0.1;
      while (s.trail.length > 2 && s.trail[0].t < keep) s.trail.shift();
    }
  }

  /** 현재 화면 위치: 기본 위치 + 전체 drift + 개별 흔들림 + 커서 오프셋 */
  private pos(i: number) {
    const n = this.nodes[i];
    const d = this.drift();
    const wob = this.reduced.matches ? 0 : WOBBLE;
    const k = Math.floor(this.time / 1.5) * 1.5; // 흔들림도 1.5초 단위로 끊는다
    return {
      x: n.x + d.x + Math.sin(k * 0.35 + n.phase) * wob + n.ox,
      y: n.y + d.y + Math.cos(k * 0.29 + n.phase) * wob + n.oy,
    };
  }

  private drift() {
    if (this.reduced.matches) return { x: 0, y: 0 };
    // 0 → 반환점 → 0 을 DRIFT_STEPS 단계로 (CSS steps(24) 와 같게)
    const step = Math.floor(((this.time % DRIFT_PERIOD) / DRIFT_PERIOD) * DRIFT_STEPS);
    const u = 0.5 - 0.5 * Math.cos((step / DRIFT_STEPS) * Math.PI * 2);
    return { x: DRIFT_X * u, y: DRIFT_Y * u };
  }

  // ── 그리기 ──────────────────────────────

  private draw() {
    const { ctx, colors } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const P = this.nodes.map((_, i) => this.pos(i));

    // 연결선: 픽셀 점선
    ctx.fillStyle = colors.dot;
    for (const [a, b] of this.edges) this.dash(P[a].x, P[a].y, P[b].x, P[b].y);

    // 커서 임시 연결선
    const p = this.pointer;
    if (p && !this.reduced.matches) {
      const near = P.map((q, i) => [i, Math.hypot(q.x - p.x, q.y - p.y)] as const)
        .filter(([, d]) => d < CURSOR_RADIUS)
        .sort((a, b) => a[1] - b[1])
        .slice(0, CURSOR_LINKS);
      ctx.fillStyle = colors.accentDeep;
      for (const [i] of near) this.dash(p.x, p.y, P[i].x, P[i].y);
    }

    // 회색 노드
    ctx.fillStyle = colors.node;
    this.nodes.forEach((n, i) => {
      if (!n.accent) ctx.fillRect(px(P[i].x) - NODE / 2, px(P[i].y) - NODE / 2, NODE, NODE);
    });

    // 자홍 노드 + 네모 링 맥박 (음악이 나오면 박에 맞춰, 아니면 각자 주기대로)
    ctx.fillStyle = colors.accent;
    ctx.strokeStyle = colors.accent;
    const bump = this.beat ? Math.round(this.kick() * 3) * 2 : 0; // 박 치는 순간 0·2·4·6px 커진다
    this.nodes.forEach((n, i) => {
      if (!n.accent) return;
      const x = px(P[i].x);
      const y = px(P[i].y);
      const size = NODE_ACCENT + (this.beat && this.rings.some((r) => r.node === i && this.time - r.start < r.dur * 0.5) ? bump : 0);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (!this.reduced.matches && !this.beat) this.pulse(x, y, n.pulseDelay);
    });
    if (!this.reduced.matches) for (const r of this.rings) this.beatRing(r, P[r.node]);

    // 신호 + 꼬리 2개
    for (const s of this.signals) {
      const head = s.trail[s.trail.length - 1];
      if (!head) continue;
      ctx.globalAlpha = 1;
      ctx.fillRect(px(head.x) - 3, px(head.y) - 3, 6, 6);
      TAIL_DELAYS.forEach((delay, k) => {
        const q = this.trailAt(s, this.time - delay);
        if (!q) return;
        ctx.globalAlpha = TAIL_ALPHA[k];
        ctx.fillRect(px(q.x) - 3, px(q.y) - 3, 6, 6);
      });
    }
    ctx.globalAlpha = 1;
  }

  /** 2px 점을 8px 간격으로 찍어 픽셀 점선을 만든다 */
  private dash(x1: number, y1: number, x2: number, y2: number) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.floor(len / DASH);
    if (!n) return;
    const sx = ((x2 - x1) / len) * DASH;
    const sy = ((y2 - y1) / len) * DASH;
    for (let i = 0; i <= n; i++) {
      this.ctx.fillRect(px(x1 + sx * i) - 1, px(y1 + sy * i) - 1, 2, 2);
    }
  }

  /** 자홍 노드에서 네모 링이 steps(8) 로 커지며 사라진다. 음악이 크면 링이 더 크다 */
  private pulse(x: number, y: number, delay: number) {
    const t = this.time - delay;
    if (t < 0) return;
    const period = PULSE_PERIOD / (1 + this.level);
    const step = Math.floor(((t % period) / period) * PULSE_STEPS);
    const u = step / PULSE_STEPS;
    const scale = 1 + (PULSE_SCALE - 1 + this.level * 2) * u;
    const size = px(NODE_ACCENT * scale);
    const half = px(size / 2);
    const { ctx } = this;
    ctx.globalAlpha = 0.9 * (1 - u);
    // 2px 테두리를 사각형 4개로 (선 굵기가 흐려지지 않게)
    ctx.fillRect(x - half, y - half, size, 2);
    ctx.fillRect(x - half, y + half - 2, size, 2);
    ctx.fillRect(x - half, y - half, 2, size);
    ctx.fillRect(x + half - 2, y - half, 2, size);
    ctx.globalAlpha = 1;
  }

  /** 박에 맞춘 링: 강박은 더 크게 */
  private beatRing(r: Ring, p: { x: number; y: number }) {
    const step = Math.floor(((this.time - r.start) / r.dur) * BEAT_RING_STEPS);
    const u = Math.min(1, step / BEAT_RING_STEPS);
    const size = px(NODE_ACCENT * (1 + (r.strong ? 4.5 : 3) * u));
    const half = px(size / 2);
    const x = px(p.x);
    const y = px(p.y);
    const { ctx } = this;
    ctx.globalAlpha = (r.strong ? 1 : 0.8) * (1 - u);
    ctx.fillRect(x - half, y - half, size, 2);
    ctx.fillRect(x - half, y + half - 2, size, 2);
    ctx.fillRect(x - half, y - half, 2, size);
    ctx.fillRect(x + half - 2, y - half, 2, size);
    ctx.globalAlpha = 1;
  }

  private trailAt(s: Signal, t: number) {
    const tr = s.trail;
    if (!tr.length || tr[0].t > t) return null;
    for (let i = tr.length - 1; i >= 0; i--) if (tr[i].t <= t) return tr[i];
    return null;
  }
}
