/**
 * 开始画面背景：一块 2D canvas 黑洞。
 *
 * 设计目标（和"别把首屏拖垮"的约束）：
 * - 黑洞固定占据画面重心，四周的珍宝从各个方向被缓慢吸进去；
 * - 珍宝的轨迹、自转、拉伸全部由时间参数化（不是每帧积分），
 *   所以掉帧时不会"越吸越偏"，也能精确控制节奏；
 * - 被吞掉的珍宝立刻从场景数组移除并回收到对象池，精灵图预渲染、
 *   背景/黑洞预渲染到离屏 canvas，避免每帧 new 渐变与贴图；
 * - 离开开始画面时 dispose：取消 rAF、移除监听、清空数组与离屏 canvas。
 */

const TAU = Math.PI * 2;
const MAX_DPR = 2;
const POOL_LIMIT = 36;

type Shape = 'octa' | 'diamond' | 'hex' | 'shard' | 'coin' | 'obelisk' | 'ring';

interface SpriteDef {
  shape: Shape;
  color: string;
  light: string;
  glow: string;
}

/** 8 种"初始珍宝"的剪影/配色，和游戏里的色族/形制呼应。 */
const SPRITE_DEFS: SpriteDef[] = [
  { shape: 'octa', color: '#7dd3fc', light: '#e0f2fe', glow: 'rgba(125, 211, 252, 0.55)' },
  { shape: 'diamond', color: '#f6b73c', light: '#fff4d6', glow: 'rgba(246, 183, 60, 0.55)' },
  { shape: 'hex', color: '#5eead4', light: '#ccfbf1', glow: 'rgba(94, 234, 212, 0.5)' },
  { shape: 'shard', color: '#c084fc', light: '#f3e8ff', glow: 'rgba(192, 132, 252, 0.5)' },
  { shape: 'coin', color: '#f472b6', light: '#ffe4ef', glow: 'rgba(244, 114, 182, 0.45)' },
  { shape: 'obelisk', color: '#34d399', light: '#d1fae5', glow: 'rgba(52, 211, 153, 0.45)' },
  { shape: 'ring', color: '#fcd34d', light: '#fffbeb', glow: 'rgba(252, 211, 77, 0.5)' },
  { shape: 'octa', color: '#e2e8f0', light: '#ffffff', glow: 'rgba(226, 232, 240, 0.45)' },
];

interface Star {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
  tint: string;
}

interface Dust {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  alpha: number;
  tint: string;
}

/** 一件正在坠落的珍宝。字段全部复用，不随生命周期重新分配。 */
interface FlyingItem {
  sprite: number;
  startAngle: number;
  startRadius: number;
  duration: number;
  age: number;
  swirl: number;
  spin: number;
  spinSpeed: number;
  wobblePhase: number;
  size: number;
  direction: number;
  x: number;
  y: number;
  drawAngle: number;
  stretch: number;
  radialScale: number;
  alpha: number;
}

interface Flash {
  angle: number;
  life: number;
  max: number;
}

interface Backdrop {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  hx: number;
  hy: number;
  holeR: number;
  horizon: number;
  sky: HTMLCanvasElement | null;
  hole: HTMLCanvasElement | null;
  holePad: number;
  stars: Star[];
  dust: Dust[];
  items: FlyingItem[];
  pool: FlyingItem[];
  flashes: Flash[];
  sprites: HTMLCanvasElement[];
  time: number;
  lastTime: number;
  spawnCooldown: number;
  target: number;
  reducedMotion: boolean;
  raf: number;
  onResize: () => void;
  onVisibility: () => void;
}

let active: Backdrop | null = null;
/** 无 2D context 时（测试 / 极端浏览器）仍要记住挂上去的占位 canvas，方便回收。 */
let fallbackCanvas: HTMLCanvasElement | null = null;

export function mountStartBackdrop(host: HTMLElement): void {
  disposeStartBackdrop();

  const canvas = document.createElement('canvas');
  canvas.className = 'start__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);

  const ctx = context2d(canvas);
  // 没有 canvas 能力（测试环境 / 极端浏览器）时安静降级，只留占位层。
  if (!ctx) {
    fallbackCanvas = canvas;
    return;
  }

  const backdrop: Backdrop = {
    canvas,
    ctx,
    width: 0,
    height: 0,
    dpr: 1,
    hx: 0,
    hy: 0,
    holeR: 100,
    horizon: 92,
    sky: null,
    hole: null,
    holePad: 0,
    stars: [],
    dust: [],
    items: [],
    pool: [],
    flashes: [],
    sprites: SPRITE_DEFS.map((def) => renderSprite(def)),
    time: 0,
    lastTime: 0,
    spawnCooldown: 0.4,
    target: 14,
    reducedMotion: prefersReducedMotion(),
    raf: 0,
    onResize: () => {
      resize(backdrop);
      seedStarField(backdrop);
      // 静帧模式（reduced motion）不会再有下一帧，尺寸变化后要立刻重排。
      for (const item of backdrop.items) placeItem(backdrop, item);
      draw(backdrop);
    },
    onVisibility: () => {
      if (document.hidden) {
        if (backdrop.raf) cancelAnimationFrame(backdrop.raf);
        backdrop.raf = 0;
        return;
      }
      if (!backdrop.reducedMotion && !backdrop.raf && active === backdrop) {
        backdrop.lastTime = performance.now();
        backdrop.raf = requestAnimationFrame(tick);
      }
    },
  };

  active = backdrop;
  window.addEventListener('resize', backdrop.onResize);
  document.addEventListener('visibilitychange', backdrop.onVisibility);

  resize(backdrop);
  seedStarField(backdrop);
  seedItems(backdrop);

  /** 动画主循环：只在当前 backdrop 仍是活动实例时继续。 */
  function tick(now: number): void {
    if (active !== backdrop) return;
    const dt = Math.min(0.05, Math.max(0, (now - backdrop.lastTime) / 1000));
    backdrop.lastTime = now;
    backdrop.time += dt;
    update(backdrop, dt);
    draw(backdrop);
    backdrop.raf = requestAnimationFrame(tick);
  }

  if (backdrop.reducedMotion) {
    draw(backdrop);
  } else {
    backdrop.lastTime = performance.now();
    backdrop.raf = requestAnimationFrame(tick);
  }
}

export function disposeStartBackdrop(): void {
  const backdrop = active;
  const fallback = fallbackCanvas;
  active = null;
  fallbackCanvas = null;
  if (!backdrop) {
    fallback?.remove();
    return;
  }

  if (backdrop.raf) cancelAnimationFrame(backdrop.raf);
  backdrop.raf = 0;
  window.removeEventListener('resize', backdrop.onResize);
  document.removeEventListener('visibilitychange', backdrop.onVisibility);

  // 断开所有可能挂住闭包/画布的引用，交给 GC。
  backdrop.items.length = 0;
  backdrop.pool.length = 0;
  backdrop.flashes.length = 0;
  backdrop.stars.length = 0;
  backdrop.dust.length = 0;
  backdrop.sprites.length = 0;
  backdrop.sky = null;
  backdrop.hole = null;
  backdrop.canvas.remove();
}

/* ------------------------------------------------------------------ */
/* 尺寸 / 布局                                                          */
/* ------------------------------------------------------------------ */

function resize(backdrop: Backdrop): void {
  const width = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1024);
  const height = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 768);
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  backdrop.width = width;
  backdrop.height = height;
  backdrop.dpr = dpr;
  backdrop.canvas.width = Math.round(width * dpr);
  backdrop.canvas.height = Math.round(height * dpr);
  backdrop.canvas.style.width = `${width}px`;
  backdrop.canvas.style.height = `${height}px`;

  const portrait = width < 860;
  backdrop.hx = width * (portrait ? 0.5 : 0.665);
  // 竖屏时把黑洞抬高：下方要留给标题和四项菜单，避免黑盘压住文字。
  backdrop.hy = height * (portrait ? 0.27 : 0.46);
  backdrop.holeR = clamp(Math.min(width, height) * (portrait ? 0.155 : 0.132), 52, 152);
  backdrop.horizon = backdrop.holeR * 0.92;
  backdrop.target = Math.round(clamp((width * height) / (1440 * 900), 0.4, 1.25) * 14);

  backdrop.sky = renderSky(backdrop);
  const hole = renderHole(backdrop);
  backdrop.hole = hole.canvas;
  backdrop.holePad = hole.pad;

  // 窗口尺寸变化后，重新均匀分布星尘（不改变正被吸入的珍宝，避免跳变）。
  seedDust(backdrop);
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d', { alpha: false });
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------------ */
/* 预渲染：星空 / 黑洞 / 珍宝精灵                                        */
/* ------------------------------------------------------------------ */

function renderSky(backdrop: Backdrop): HTMLCanvasElement {
  const { width, height, dpr, hx, hy } = backdrop;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#05060b');
  base.addColorStop(0.55, '#070912');
  base.addColorStop(1, '#04050a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const far = Math.max(width, height);
  const nebulae: Array<[number, number, number, string]> = [
    [width * 0.18, height * 0.12, far * 0.52, 'rgba(56, 189, 248, 0.09)'],
    [width * 0.86, height * 0.06, far * 0.46, 'rgba(246, 183, 60, 0.06)'],
    [hx, hy, far * 0.5, 'rgba(94, 234, 212, 0.07)'],
    [width * 0.45, height * 1.02, far * 0.42, 'rgba(124, 58, 237, 0.07)'],
  ];
  for (const [x, y, radius, color] of nebulae) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.55, color.replace(/[\d.]+\)$/, '0.025)'));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // 一层极淡的银河带，避免纯黑背景发空。
  const band = ctx.createLinearGradient(0, height * 0.15, width, height * 0.95);
  band.addColorStop(0, 'rgba(148, 163, 184, 0)');
  band.addColorStop(0.45, 'rgba(148, 163, 184, 0.035)');
  band.addColorStop(1, 'rgba(148, 163, 184, 0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, width, height);

  return canvas;
}

function renderHole(backdrop: Backdrop): { canvas: HTMLCanvasElement; pad: number } {
  const { holeR: R, dpr } = backdrop;
  const pad = R * 3.5;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pad * 2 * dpr);
  canvas.height = Math.round(pad * 2 * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, pad };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(pad, pad);

  const diskGradient = (): CanvasGradient => {
    const gradient = ctx.createRadialGradient(0, 0, R * 0.96, 0, 0, R * 3.1);
    gradient.addColorStop(0, 'rgba(255, 242, 208, 0.9)');
    gradient.addColorStop(0.08, 'rgba(255, 206, 128, 0.52)');
    gradient.addColorStop(0.3, 'rgba(246, 148, 64, 0.22)');
    gradient.addColorStop(0.62, 'rgba(94, 234, 212, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    return gradient;
  };

  /** 环形路径：外圈顺时针 + 内圈逆时针，避免径向渐变把内圈糊成实心。 */
  const annulus = (inner: number, outer: number): void => {
    ctx.beginPath();
    ctx.arc(0, 0, outer, 0, TAU);
    ctx.arc(0, 0, inner, 0, TAU, true);
  };

  // 引力外晕
  const glow = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 3.4);
  glow.addColorStop(0, 'rgba(255, 214, 150, 0.2)');
  glow.addColorStop(0.42, 'rgba(94, 234, 212, 0.08)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, R * 3.4, 0, TAU);
  ctx.fill();

  // 吸积盘后半（在黑洞背后）：只画环带，黑洞本体稍后盖住中心。
  ctx.save();
  ctx.rotate(-0.3);
  ctx.scale(1, 0.36);
  ctx.fillStyle = diskGradient();
  annulus(R * 0.98, R * 3.1);
  ctx.fill();
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(0, 0, R * (1.34 + i * 0.42), 0, TAU);
    ctx.strokeStyle = i === 0 ? 'rgba(255, 244, 214, 0.42)' : 'rgba(246, 183, 60, 0.22)';
    ctx.lineWidth = i === 0 ? 1.2 : 0.9;
    ctx.stroke();
  }
  ctx.restore();

  // 事件视界：纯黑圆盘 + 光子环
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fillStyle = '#000';
  ctx.fill();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.04, 0, TAU);
  ctx.strokeStyle = 'rgba(255, 238, 200, 0.9)';
  ctx.lineWidth = Math.max(1.4, R * 0.018);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.04, 0, TAU);
  ctx.strokeStyle = 'rgba(255, 214, 140, 0.22)';
  ctx.lineWidth = Math.max(6, R * 0.09);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.22, 0, TAU);
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.18)';
  ctx.lineWidth = Math.max(2, R * 0.02);
  ctx.stroke();
  ctx.restore();

  // 吸积盘前半：用分段圆弧画一条跨过视界下缘的亮带，
  // 两端淡出，避免硬切边把黑洞画成"被咬了一口的硬币"。
  ctx.save();
  ctx.rotate(-0.3);
  ctx.scale(1, 0.36);
  ctx.lineCap = 'butt';
  const segments = 30;
  for (let i = 0; i < segments; i += 1) {
    const from = (i / segments) * Math.PI;
    const to = ((i + 1) / segments) * Math.PI;
    const fade = Math.pow(Math.sin((from + to) / 2), 1.3);
    if (fade < 0.02) continue;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.07, from, to);
    ctx.strokeStyle = `rgba(255, ${Math.round(206 + fade * 38)}, ${Math.round(126 + fade * 52)}, ${(0.92 * fade).toFixed(3)})`;
    ctx.lineWidth = R * 0.2;
    ctx.stroke();
  }
  ctx.restore();

  return { canvas, pad };
}

function renderSprite(def: SpriteDef): HTMLCanvasElement {
  const size = 192;
  const center = size / 2;
  const radius = 58;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // 外发光
  const glow = ctx.createRadialGradient(
    center,
    center,
    radius * 0.2,
    center,
    center,
    radius * 1.62,
  );
  glow.addColorStop(0, def.glow);
  glow.addColorStop(0.55, def.glow.replace(/[\d.]+\)$/, '0.12)'));
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(center, center);
  const body = ctx.createLinearGradient(-radius, -radius, radius, radius);
  body.addColorStop(0, def.light);
  body.addColorStop(0.35, def.color);
  body.addColorStop(1, def.color);
  ctx.fillStyle = body;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.6;
  traceShape(ctx, def.shape, radius);
  ctx.fill();
  ctx.stroke();

  // 切面高光：从中心连向顶点，模拟宝石的折面
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  const vertices = shapePoints(def.shape, radius);
  for (const [x, y] of vertices) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  const inner = ctx.createRadialGradient(-radius * 0.18, -radius * 0.22, 0, 0, 0, radius);
  inner.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
  inner.addColorStop(0.35, 'rgba(255, 255, 255, 0.06)');
  inner.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
  ctx.fillStyle = inner;
  traceShape(ctx, def.shape, radius * 0.97);
  ctx.fill();

  if (def.shape === 'coin') {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.52, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();

  return canvas;
}

function shapePoints(shape: Shape, radius: number): Array<[number, number]> {
  switch (shape) {
    case 'octa':
      return [
        [0, -radius],
        [radius * 0.72, 0],
        [0, radius],
        [-radius * 0.72, 0],
      ];
    case 'diamond':
      return [
        [0, -radius],
        [radius * 0.62, -radius * 0.18],
        [radius * 0.36, radius * 0.86],
        [-radius * 0.36, radius * 0.86],
        [-radius * 0.62, -radius * 0.18],
      ];
    case 'hex': {
      const points: Array<[number, number]> = [];
      for (let i = 0; i < 6; i += 1) {
        const angle = -Math.PI / 2 + (i * TAU) / 6;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
      return points;
    }
    case 'shard':
      return [
        [0, -radius],
        [radius * 0.8, radius * 0.72],
        [-radius * 0.58, radius * 0.56],
      ];
    case 'coin': {
      const points: Array<[number, number]> = [];
      for (let i = 0; i < 16; i += 1) {
        const angle = (i * TAU) / 16;
        points.push([Math.cos(angle) * radius * 0.88, Math.sin(angle) * radius * 0.88]);
      }
      return points;
    }
    case 'obelisk':
      return [
        [-radius * 0.42, -radius],
        [radius * 0.42, -radius],
        [radius * 0.52, radius * 0.6],
        [radius * 0.3, radius],
        [-radius * 0.3, radius],
        [-radius * 0.52, radius * 0.6],
      ];
    case 'ring': {
      const points: Array<[number, number]> = [];
      for (let i = 0; i < 20; i += 1) {
        const angle = (i * TAU) / 20;
        points.push([Math.cos(angle) * radius * 0.82, Math.sin(angle) * radius * 0.82]);
      }
      return points;
    }
  }
}

function traceShape(ctx: CanvasRenderingContext2D, shape: Shape, radius: number): void {
  ctx.beginPath();
  if (shape === 'ring') {
    ctx.arc(0, 0, radius * 0.74, 0, TAU);
    return;
  }
  const points = shapePoints(shape, radius);
  const first = points[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point) ctx.lineTo(point[0], point[1]);
  }
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* 星场 / 星尘 / 珍宝                                                   */
/* ------------------------------------------------------------------ */

function seedStarField(backdrop: Backdrop): void {
  const count = Math.round(clamp((backdrop.width * backdrop.height) / 7000, 90, 240));
  const tints = ['#dbeafe', '#fef3c7', '#e2e8f0', '#99f6e4'];
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      radius: Math.random() < 0.9 ? 0.7 + Math.random() * 0.8 : 1.4 + Math.random(),
      speed: 0.25 + Math.random() * 0.9,
      phase: Math.random() * TAU,
      tint: tints[i % tints.length] ?? '#dbeafe',
    });
  }
  backdrop.stars = stars;
}

function seedDust(backdrop: Backdrop): void {
  const count = backdrop.width < 860 ? 36 : 70;
  const tints = ['#fde68a', '#a5f3fc', '#fbcfe8', '#ffffff'];
  const dust: Dust[] = [];
  for (let i = 0; i < count; i += 1) {
    dust.push({
      angle: Math.random() * TAU,
      radius: backdrop.holeR * (1.3 + Math.random() * 1.7),
      speed: (0.12 + Math.random() * 0.45) * (Math.random() < 0.5 ? -1 : 1),
      size: 0.6 + Math.random() * 1.4,
      alpha: 0.15 + Math.random() * 0.45,
      tint: tints[i % tints.length] ?? '#ffffff',
    });
  }
  backdrop.dust = dust;
}

function seedItems(backdrop: Backdrop): void {
  const initial = Math.min(backdrop.target, 11);
  for (let i = 0; i < initial; i += 1) {
    spawnItem(backdrop, true);
  }
}

function createItem(): FlyingItem {
  return {
    sprite: 0,
    startAngle: 0,
    startRadius: 0,
    duration: 20,
    age: 0,
    swirl: 1,
    spin: 0,
    spinSpeed: 0,
    wobblePhase: 0,
    size: 30,
    direction: 1,
    x: 0,
    y: 0,
    drawAngle: 0,
    stretch: 1,
    radialScale: 1,
    alpha: 1,
  };
}

function spawnItem(backdrop: Backdrop, initial: boolean): void {
  const item = backdrop.pool.pop() ?? createItem();
  const minDim = Math.min(backdrop.width, backdrop.height);
  const angle = Math.random() * TAU;

  // 从"画面边缘"起飞，而不是从固定半径：竖屏和横屏都能看到珍宝从四面进入。
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const edgeX =
    (cos >= 0 ? backdrop.width - backdrop.hx : backdrop.hx) / Math.max(0.001, Math.abs(cos));
  const edgeY =
    (sin >= 0 ? backdrop.height - backdrop.hy : backdrop.hy) / Math.max(0.001, Math.abs(sin));
  const edgeDistance = Math.max(backdrop.holeR * 2.2, Math.min(edgeX, edgeY));
  const startRadius = edgeDistance * (0.82 + Math.random() * 0.18);
  const duration = 12 + startRadius / 55 + Math.random() * 6;

  item.sprite = Math.floor(Math.random() * SPRITE_DEFS.length);
  item.startAngle = angle;
  item.startRadius = startRadius;
  item.duration = duration;
  // 首屏直接摆出"已经吸了一会儿"的层次，避免前 20 秒只有零星几件。
  item.age = initial ? Math.random() * duration * 0.82 : 0;
  item.swirl = (0.45 + Math.random() * 1.3) * (Math.random() < 0.5 ? -1 : 1);
  item.spin = Math.random() * TAU;
  item.spinSpeed = (Math.random() - 0.5) * 0.9;
  item.wobblePhase = Math.random() * TAU;
  item.size = (22 + Math.random() * 26) * clamp(minDim / 820, 0.7, 1.25);
  item.direction = Math.random() < 0.5 ? -1 : 1;

  placeItem(backdrop, item);
  backdrop.items.push(item);
}

function placeItem(backdrop: Backdrop, item: FlyingItem): void {
  const t = clamp(item.age / item.duration, 0, 1);
  const remaining = 1 - t;
  const { horizon } = backdrop;

  // 前段慢、后段加速：t^2.6 让珍宝在画面里停留得足够久。
  const baseRadius = horizon + (item.startRadius - horizon) * (1 - Math.pow(t, 2.6));
  const wobble = Math.sin(item.age * 1.1 + item.wobblePhase) * 9 * remaining;
  const radius = Math.max(horizon * 0.55, baseRadius + wobble);
  const angle =
    item.startAngle +
    item.direction * item.swirl * Math.pow(t, 1.35) +
    Math.sin(item.age * 0.8 + item.wobblePhase) * 0.03 * remaining;

  item.x = backdrop.hx + Math.cos(angle) * radius;
  item.y = backdrop.hy + Math.sin(angle) * radius;
  item.drawAngle =
    angle +
    item.spin +
    item.spinSpeed * item.age +
    Math.sin(item.age * 0.9 + item.wobblePhase) * 0.55;

  const relative = clamp((radius - horizon) / Math.max(1, item.startRadius - horizon), 0, 1);
  const near = clamp(relative / 0.16, 0, 1);
  item.alpha = Math.min(1, item.age / 0.9) * (0.2 + 0.8 * near) * clamp(relative / 0.04, 0, 1);
  item.stretch = 1 + Math.pow(1 - near, 2) * 2.6;
  item.radialScale = 0.3 + 0.7 * near;
}

function update(backdrop: Backdrop, dt: number): void {
  for (let i = backdrop.items.length - 1; i >= 0; i -= 1) {
    const item = backdrop.items[i];
    if (!item) continue;
    item.age += dt;
    if (item.age >= item.duration) {
      // 进入事件视界：销毁场景对象并回收复用。
      backdrop.flashes.push({
        angle: Math.atan2(item.y - backdrop.hy, item.x - backdrop.hx),
        life: 0.5,
        max: 0.5,
      });
      backdrop.items.splice(i, 1);
      if (backdrop.pool.length < POOL_LIMIT) backdrop.pool.push(item);
      continue;
    }
    placeItem(backdrop, item);
  }

  for (const flash of backdrop.flashes) flash.life -= dt;
  backdrop.flashes = backdrop.flashes.filter((flash) => flash.life > 0);

  for (const mote of backdrop.dust) {
    mote.angle += mote.speed * dt;
  }

  // 持续补充：少的时候补得快，稳态时保持一条缓慢的"流星雨"。
  if (backdrop.items.length < backdrop.target) {
    backdrop.spawnCooldown -= dt;
    if (backdrop.spawnCooldown <= 0) {
      spawnItem(backdrop, false);
      const sparse = backdrop.items.length < backdrop.target * 0.6;
      backdrop.spawnCooldown = sparse ? 0.18 : 0.55 + Math.random() * 0.85;
    }
  } else {
    backdrop.spawnCooldown = 0.3;
  }
}

/* ------------------------------------------------------------------ */
/* 绘制                                                                 */
/* ------------------------------------------------------------------ */

function draw(backdrop: Backdrop): void {
  const { ctx, width, height, dpr } = backdrop;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  if (backdrop.sky) ctx.drawImage(backdrop.sky, 0, 0, width, height);
  else {
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, width, height);
  }

  drawStars(backdrop);
  drawDust(backdrop);
  for (const item of backdrop.items) drawItem(backdrop, item);

  if (backdrop.hole) {
    const pad = backdrop.holePad;
    ctx.drawImage(backdrop.hole, backdrop.hx - pad, backdrop.hy - pad, pad * 2, pad * 2);
  }

  drawAccretionStreaks(backdrop);
  drawFlashes(backdrop);
}

function drawStars(backdrop: Backdrop): void {
  const { ctx, width, height, time } = backdrop;
  for (const star of backdrop.stars) {
    const twinkle = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(time * star.speed + star.phase));
    ctx.globalAlpha = twinkle;
    ctx.fillStyle = star.tint;
    ctx.fillRect(star.x * width, star.y * height, star.radius, star.radius);
  }
  ctx.globalAlpha = 1;
}

function drawDust(backdrop: Backdrop): void {
  const { ctx, hx, hy, holeR } = backdrop;
  const tilt = -0.3;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  for (const mote of backdrop.dust) {
    const localX = Math.cos(mote.angle) * mote.radius;
    const localY = Math.sin(mote.angle) * mote.radius * 0.36;
    const x = hx + localX * cosTilt - localY * sinTilt;
    const y = hy + localX * sinTilt + localY * cosTilt;
    // 越靠内越亮，模拟被加热的尘埃。
    const heat = 1 - clamp((mote.radius - holeR) / (holeR * 2), 0, 1);
    ctx.globalAlpha = mote.alpha * (0.45 + heat * 0.55);
    ctx.fillStyle = mote.tint;
    ctx.fillRect(x, y, mote.size, mote.size);
  }
  ctx.globalAlpha = 1;
}

function drawItem(backdrop: Backdrop, item: FlyingItem): void {
  const sprite = backdrop.sprites[item.sprite % backdrop.sprites.length];
  if (!sprite) return;
  const drawSize = item.size * 2.2;
  const width = drawSize * item.stretch * item.radialScale;
  const height = (drawSize / (1 + (item.stretch - 1) * 0.55)) * item.radialScale;
  if (width <= 0 || height <= 0) return;

  const { ctx } = backdrop;
  ctx.save();
  ctx.globalAlpha = item.alpha;
  ctx.translate(item.x, item.y);
  ctx.rotate(item.drawAngle);
  ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawAccretionStreaks(backdrop: Backdrop): void {
  const { ctx, hx, hy, holeR, time } = backdrop;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(-0.3);
  ctx.scale(1, 0.36);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i += 1) {
    const radius = holeR * (1.38 + i * 0.34);
    const direction = i % 2 === 0 ? 1 : -1;
    const start = time * (0.28 + i * 0.07) * direction + i * 1.9;
    const end = start + 0.85 - i * 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, radius, Math.min(start, end), Math.max(start, end));
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 216, 150, 0.4)' : 'rgba(94, 234, 212, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlashes(backdrop: Backdrop): void {
  const { ctx, hx, hy, horizon } = backdrop;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const flash of backdrop.flashes) {
    const progress = 1 - flash.life / flash.max;
    ctx.globalAlpha = (1 - progress) * 0.75;
    ctx.strokeStyle = '#ffe4b0';
    ctx.lineWidth = 1 + progress * 2.5;
    ctx.beginPath();
    ctx.arc(hx, hy, horizon * (1.02 + progress * 0.16), flash.angle - 0.22, flash.angle + 0.22);
    ctx.stroke();
  }
  ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
