import type { FairyAction } from './fairyRig';
import type { FairyMainMessage, FairyWorkerMessage } from './fairyStageProtocol';
import { loadFairyAsset } from '../store/fairyModel';

/**
 * 右下角常驻精灵的控制器。
 *
 * 真正的 three / GLTFLoader / WebGL 全部跑在 `fairyStage.worker.ts`：
 * 主线程只把 canvas 的 OffscreenCanvas 控制权交出去，然后接收 ready / 错误。
 * 这样首次进游戏时不会因为创建 WebGL 上下文 + 编译 shader 卡住主线程
 * （实测从 ~2.4s 长任务降到几十毫秒）。
 *
 * 不支持 transferControlToOffscreen 的浏览器由 companion 保留 CSS 光球兜底。
 */

export interface FairyStage {
  play(action: FairyAction): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

export interface FairyStageOptions {
  accent?: string;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export function createFairyStage(
  canvas: HTMLCanvasElement,
  options: FairyStageOptions = {},
): FairyStage {
  if (typeof Worker === 'undefined' || typeof canvas.transferControlToOffscreen !== 'function') {
    throw new Error('当前浏览器不支持 OffscreenCanvas Worker');
  }

  const worker = new Worker(new URL('./fairyStage.worker.ts', import.meta.url), {
    type: 'module',
  });
  const offscreen = canvas.transferControlToOffscreen();
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  canvas.dataset.reducedMotion = String(reducedMotion);

  let disposed = false;
  let ready = false;
  let paused = false;
  let pendingAction: FairyAction = 'idle';
  let resizeObserver: ResizeObserver | null = null;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 0;

  const post = (message: FairyMainMessage): void => {
    if (disposed) return;
    worker.postMessage(message);
  };

  const sendPause = (): void => {
    post({ type: 'pause', paused: paused || document.hidden });
  };

  const measure = (): { width: number; height: number; dpr: number } => ({
    width: Math.max(1, Math.round(canvas.clientWidth || 150)),
    height: Math.max(1, Math.round(canvas.clientHeight || 180)),
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  });

  const initial = measure();
  lastWidth = initial.width;
  lastHeight = initial.height;
  lastDpr = initial.dpr;

  worker.onmessage = (event: MessageEvent<FairyWorkerMessage>) => {
    const message = event.data;
    if (message.type === 'ready') {
      ready = true;
      canvas.dataset.workerReducedMotion = String(message.reducedMotion ?? false);
      options.onReady?.();
      if (pendingAction !== 'idle') post({ type: 'action', action: pendingAction });
      sendPause();
      return;
    }
    if (message.type === 'error') {
      options.onError?.(new Error(message.message));
    }
  };
  worker.onerror = (event) => {
    options.onError?.(new Error(event.message || '精灵渲染 Worker 异常'));
  };

  // 先把 CSS 尺寸量好再初始化；GLB 只有 100 多 KB，主线程读取后 transfer 进 Worker。
  void loadFairyAsset()
    .then((asset) => {
      if (disposed) return;
      // 复制一份再 transfer：loadFairyAsset 的 ArrayBuffer 是模块级缓存，
      // 直接转移会被 detach，下次创建舞台就拿到空 buffer。
      const buffer = asset ? asset.buffer.slice(0) : null;
      worker.postMessage(
        {
          type: 'init',
          canvas: offscreen,
          width: initial.width,
          height: initial.height,
          dpr: initial.dpr,
          reducedMotion,
          buffer,
          manifest: asset?.manifest ?? null,
          accent: options.accent,
        } satisfies FairyMainMessage,
        buffer ? [offscreen, buffer] : [offscreen],
      );
    })
    .catch((error: unknown) => {
      options.onError?.(error);
      if (disposed) return;
      worker.postMessage(
        {
          type: 'init',
          canvas: offscreen,
          width: initial.width,
          height: initial.height,
          dpr: initial.dpr,
          reducedMotion,
          buffer: null,
          manifest: null,
          accent: options.accent,
        } satisfies FairyMainMessage,
        [offscreen],
      );
    });

  const onVisibility = (): void => sendPause();
  document.addEventListener('visibilitychange', onVisibility);

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (!ready) return;
      const next = measure();
      if (next.width === lastWidth && next.height === lastHeight && next.dpr === lastDpr) return;
      lastWidth = next.width;
      lastHeight = next.height;
      lastDpr = next.dpr;
      post({ type: 'resize', ...next });
    });
    resizeObserver.observe(canvas);
  }

  return {
    play: (action) => {
      pendingAction = action;
      if (ready) post({ type: 'action', action });
    },
    setPaused: (next) => {
      paused = next;
      sendPause();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      document.removeEventListener('visibilitychange', onVisibility);
      worker.postMessage({ type: 'dispose' } satisfies FairyMainMessage);
      worker.terminate();
    },
  };
}
