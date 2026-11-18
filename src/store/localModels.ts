import type { LevelJson } from '../types/level';

/**
 * 预置模型加载（教学 / 演示关卡）。
 *
 * 模型由 `scripts/init_models.py` 生成到 `public/models/`（不入库），
 * 脚本会写一份 `manifest.json`；网页按 `levelId → itemId → 相对路径` 读取。
 * 没生成时返回 null，调用方自动退回程序化占位模型，玩法不受影响。
 */

export interface LocalModelManifest {
  version: number;
  region?: string;
  generatedAt?: string;
  levels?: Record<string, Record<string, string>>;
  /** 脚本额外写入的展示信息（名称 / 特征），开始画面的缩略图用色族做外发光。 */
  items?: Record<
    string,
    {
      name?: string;
      traits?: {
        shape?: string;
        color?: string;
        gemCount?: number;
        hasBase?: boolean;
      };
    }
  >;
}

const MANIFEST_REL_PATH = 'models/manifest.json';
const MODELS_BASE_REL = 'models/';

let manifestPromise: Promise<LocalModelManifest | null> | null = null;
const blobCache = new Map<string, Blob | null>();

function baseUrl(): string {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  return 'http://localhost/';
}

function manifestUrl(): string {
  return new URL(MANIFEST_REL_PATH, baseUrl()).toString();
}

export async function loadLocalModelManifest(): Promise<LocalModelManifest | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const response = await fetch(manifestUrl(), { cache: 'no-cache' });
        if (!response.ok) return null;
        const data = (await response.json()) as unknown;
        if (!data || typeof data !== 'object') return null;
        const manifest = data as LocalModelManifest;
        return manifest.levels ? manifest : null;
      } catch {
        return null;
      }
    })();
  }
  return manifestPromise;
}

/** 单件预置模型：命中返回 Blob，未生成 / 读取失败返回 null（并记住结果）。 */
export async function loadLocalModel(
  levelId: string,
  itemId: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const cacheKey = `${levelId}:${itemId}`;
  if (blobCache.has(cacheKey)) return blobCache.get(cacheKey) ?? null;

  const manifest = await loadLocalModelManifest();
  const relative = manifest?.levels?.[levelId]?.[itemId];
  if (!relative) {
    blobCache.set(cacheKey, null);
    return null;
  }

  try {
    const url = new URL(relative, new URL(MODELS_BASE_REL, baseUrl())).toString();
    const response = await fetch(url, { cache: 'no-cache', ...(signal ? { signal } : {}) });
    if (!response.ok) {
      if (!signal?.aborted) blobCache.set(cacheKey, null);
      return null;
    }
    const blob = await response.blob();
    if (blob.size === 0) {
      if (!signal?.aborted) blobCache.set(cacheKey, null);
      return null;
    }
    blobCache.set(cacheKey, blob);
    return blob;
  } catch {
    // 页面切走导致的 abort 不能写入 null 缓存，否则下次会误判"模型不存在"。
    if (!signal?.aborted) blobCache.set(cacheKey, null);
    return null;
  }
}

export interface LocalModelLoadHooks {
  /** 单件开始 / 结束；用于登录页 / 加载动画显示进度。 */
  onItem?: (itemId: string, index: number, status: 'running' | 'done' | 'failed') => void;
}

/** 一次加载一关的全部预置模型（教学 2 件 / 演示 5 件）。 */
export async function loadLevelLocalModels(
  level: LevelJson,
  hooks: LocalModelLoadHooks = {},
): Promise<Record<string, Blob | null>> {
  const entries = await Promise.all(
    level.stalls.map(async (stall, index) => {
      hooks.onItem?.(stall.itemId, index, 'running');
      const blob = await loadLocalModel(level.id, stall.itemId);
      hooks.onItem?.(stall.itemId, index, blob ? 'done' : 'failed');
      return [stall.itemId, blob] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** 测试用：清空 manifest 与 blob 缓存。 */
export function resetLocalModelCache(): void {
  manifestPromise = null;
  blobCache.clear();
}
