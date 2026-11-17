import { loadLocalModel, loadLocalModelManifest } from '../store/localModels';
import type { LocalModelManifest } from '../store/localModels';

/**
 * 开始画面用的"真实珍宝"缩略图。
 *
 * 预置 GLB 在 public/models/ 里（脚本生成、不入库）。这里把每件 GLB 拍成
 * 320×320 的透明缩略图，交给 2D canvas 黑洞背景当精灵用：
 *
 * - 只有 manifest 真的存在时才启动 Worker（没有预置模型就完全不加载 3D）；
 * - three + GLTFLoader + OffscreenCanvas 全部在 Worker 里跑：
 *   10MB 级 GLB 的解析和 WebGL 初始化不会卡住开始页动画；
 * - 逐件加载 / 渲染，通过 onSprite 渐进替换程序化图形，失败的单件保留兜底；
 * - 缩略图按 manifest.generatedAt 缓存，回到开始页不重新解析；
 * - 页面切走时 signal.abort() → 停止下载、终止 Worker，资源交给 GC。
 */

const THUMB_SIZE = 320;
const MAX_SPRITES = 7;
const WORKER_TIMEOUT_MS = 15_000;

const GLOW_RGB: Record<string, string> = {
  青蓝: '94, 234, 212',
  赤金: '246, 183, 60',
  墨黑: '148, 163, 184',
  霜白: '226, 232, 240',
  紫晶: '192, 132, 252',
  苔绿: '52, 211, 153',
};

/** key 带 manifest 版本，重新生成模型后不会拿到旧缩略图。 */
const spriteCache = new Map<string, HTMLCanvasElement>();

export function resetModelSpriteCache(): void {
  spriteCache.clear();
}

export interface ModelEntry {
  levelId: string;
  itemId: string;
  name?: string;
  color?: string;
}

export interface ModelSprite extends ModelEntry {
  canvas: HTMLCanvasElement;
}

export interface LoadModelSpritesOptions {
  signal?: AbortSignal;
  max?: number;
  /** 每成功一件回调一次；slot 从 0 递增，用于替换对应位置的兜底图形。 */
  onSprite?: (sprite: ModelSprite, slot: number) => void;
}

interface WorkerResult {
  id: number;
  ok: boolean;
  bitmap?: ImageBitmap;
  fatal?: boolean;
  error?: string;
}

interface PendingJob {
  resolve: (bitmap: ImageBitmap) => void;
  reject: (error: Error) => void;
  timer: number;
}

/** manifest → 有序的 [关卡, 珍宝] 列表；教学关排最前，开始页先看到教学的两件。 */
export function collectModelEntries(
  manifest: LocalModelManifest | null | undefined,
  max = MAX_SPRITES,
): ModelEntry[] {
  if (!manifest?.levels || max <= 0) return [];
  const levelWeight = (id: string): number => {
    if (id === 'tutorial-level') return 0;
    if (id === 'demo-level') return 1;
    return 2;
  };
  const levelIds = Object.keys(manifest.levels).sort(
    (a, b) => levelWeight(a) - levelWeight(b) || a.localeCompare(b),
  );

  const entries: ModelEntry[] = [];
  for (const levelId of levelIds) {
    const items = manifest.levels[levelId];
    if (!items) continue;
    for (const itemId of Object.keys(items)) {
      if (entries.length >= max) return entries;
      const meta = manifest.items?.[`${levelId}/${itemId}`];
      entries.push({
        levelId,
        itemId,
        ...(meta?.name ? { name: meta.name } : {}),
        ...(meta?.traits?.color ? { color: meta.traits.color } : {}),
      });
    }
  }
  return entries;
}

/**
 * 开始画面要加载几件：省流量模式 / 2G 直接不加载；手机上控制在 4 件。
 * 默认 7（与开始页的 7 个精灵槽位、manifest 的 7 件预置模型对齐）。
 */
export function modelSpriteBudget(): number {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 0;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData) return 0;
  if (connection?.effectiveType && /(^|-)2g/.test(connection.effectiveType)) return 0;
  return window.innerWidth < 860 ? 4 : MAX_SPRITES;
}

export async function loadModelSprites(
  options: LoadModelSpritesOptions = {},
): Promise<ModelSprite[]> {
  const { signal, onSprite } = options;
  const max = Math.min(options.max ?? modelSpriteBudget(), MAX_SPRITES);
  if (max <= 0 || signal?.aborted) return [];
  if (!canUseWorkerThumbs()) return [];

  const manifest = await loadLocalModelManifest();
  if (!manifest || signal?.aborted) return [];
  const entries = collectModelEntries(manifest, max);
  if (entries.length === 0) return [];

  const version = manifest.generatedAt ?? `v${manifest.version ?? 1}`;
  const loaded: ModelSprite[] = [];
  const thumbnails = new WorkerThumbnails(signal);
  // 先把 Worker 的 three / WebGL 初始化与第一件 GLB 的下载重叠起来。
  if (entries.some((entry) => !spriteCache.has(`${version}:${entry.levelId}:${entry.itemId}`))) {
    thumbnails.warmup();
  }
  const abortHandler = (): void => thumbnails.dispose();
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    for (const entry of entries) {
      if (signal?.aborted || !thumbnails.available) break;
      const cacheKey = `${version}:${entry.levelId}:${entry.itemId}`;
      const cached = spriteCache.get(cacheKey);
      if (cached) {
        announce({ ...entry, canvas: cached }, loaded, onSprite);
        continue;
      }

      const blob = await loadLocalModel(entry.levelId, entry.itemId, signal);
      if (!blob || signal?.aborted) continue;

      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await thumbnails.render(await blob.arrayBuffer(), loaded.length);
      } catch {
        // 单件解析失败只跳过这一件；Worker 不可用才停止整批。
        if (!thumbnails.available) break;
        continue;
      }
      if (!bitmap) {
        if (!thumbnails.available) break;
        continue;
      }
      if (signal?.aborted) {
        bitmap.close();
        break;
      }
      const canvas = composeThumbnail(bitmap, entry.color);
      spriteCache.set(cacheKey, canvas);
      announce({ ...entry, canvas }, loaded, onSprite);
      // 让主线程把这一帧画出来，再处理下一件。
      await yieldToBrowser();
    }
  } catch (error) {
    if (!signal?.aborted) {
      console.warn('[gemwright] 预置珍宝缩略图加载失败，继续使用程序化图形', error);
    }
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    thumbnails.dispose();
  }

  return loaded;
}

function canUseWorkerThumbs(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/** 一个 Worker 顺序渲染缩略图；内部维护 id → Promise 的映射与超时。 */
class WorkerThumbnails {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, PendingJob>();
  private nextId = 1;
  private disposed = false;
  private fatal = false;

  constructor(private readonly signal?: AbortSignal) {}

  get available(): boolean {
    return !this.disposed && !this.fatal;
  }

  warmup(): void {
    this.ensureWorker();
  }

  render(buffer: ArrayBuffer, index: number): Promise<ImageBitmap | null> {
    if (this.signal?.aborted || this.disposed) return Promise.resolve(null);
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(null);

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        // 超时多半是某件模型过大 / 损坏：终止 Worker，下一件重新起一个。
        this.worker?.terminate();
        this.worker = null;
        reject(new Error('缩略图渲染超时'));
      }, WORKER_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (bitmap) => {
          clearTimeout(timer);
          resolve(bitmap);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
      try {
        worker.postMessage({ id, buffer, index }, [buffer]);
      } catch (error) {
        this.fail(id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, job] of this.pending) {
      clearTimeout(job.timer);
      job.reject(new Error('开始页已离开'));
      this.pending.delete(id);
    }
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.fatal) return null;
    try {
      const worker = new Worker(new URL('./modelThumb.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<WorkerResult>) => this.onMessage(event.data);
      worker.onerror = (event) => {
        console.warn('[gemwright] 缩略图 Worker 异常，回退程序化图形', event.message);
        this.failAll(new Error(event.message || 'Worker error'));
      };
      this.worker = worker;
      return worker;
    } catch {
      this.fatal = true;
      return null;
    }
  }

  private onMessage(result: WorkerResult): void {
    const job = this.pending.get(result.id);
    if (!job) {
      result.bitmap?.close();
      return;
    }
    this.pending.delete(result.id);
    if (result.ok && result.bitmap) {
      job.resolve(result.bitmap);
      return;
    }
    job.reject(new Error(result.error ?? '缩略图渲染失败'));
    if (result.fatal) this.failAll(new Error(result.error ?? '缩略图渲染不可用'));
  }

  private fail(id: number, error: Error): void {
    const job = this.pending.get(id);
    if (!job) return;
    this.pending.delete(id);
    job.reject(error);
  }

  private failAll(error: Error): void {
    this.fatal = true;
    for (const [id, job] of this.pending) {
      clearTimeout(job.timer);
      job.reject(error);
      this.pending.delete(id);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}

function composeThumbnail(bitmap: ImageBitmap, color: string | undefined): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    drawHalo(ctx, color);
    ctx.drawImage(bitmap, 0, 0, THUMB_SIZE, THUMB_SIZE);
  }
  bitmap.close();
  return canvas;
}

function drawHalo(ctx: CanvasRenderingContext2D, color: string | undefined): void {
  const rgb = (color && GLOW_RGB[color]) || '246, 183, 60';
  const gradient = ctx.createRadialGradient(
    THUMB_SIZE / 2,
    THUMB_SIZE / 2,
    8,
    THUMB_SIZE / 2,
    THUMB_SIZE / 2,
    THUMB_SIZE * 0.47,
  );
  gradient.addColorStop(0, `rgba(${rgb}, 0.46)`);
  gradient.addColorStop(0.45, `rgba(${rgb}, 0.16)`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
}

function announce(
  sprite: ModelSprite,
  loaded: ModelSprite[],
  onSprite: LoadModelSpritesOptions['onSprite'],
): void {
  loaded.push(sprite);
  try {
    onSprite?.(sprite, loaded.length - 1);
  } catch {
    // 回调属于 UI 层，失败不能影响其余模型的加载。
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 16);
  });
}
