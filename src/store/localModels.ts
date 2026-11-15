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
  levels?: Record<string, Record<string, string>>;
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
export async function loadLocalModel(levelId: string, itemId: string): Promise<Blob | null> {
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
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      blobCache.set(cacheKey, null);
      return null;
    }
    const blob = await response.blob();
    if (blob.size === 0) {
      blobCache.set(cacheKey, null);
      return null;
    }
    blobCache.set(cacheKey, blob);
    return blob;
  } catch {
    blobCache.set(cacheKey, null);
    return null;
  }
}

/** 一次加载一关的全部预置模型（教学 2 件 / 演示 5 件）。 */
export async function loadLevelLocalModels(level: LevelJson): Promise<Record<string, Blob | null>> {
  const entries = await Promise.all(
    level.stalls.map(
      async (stall) => [stall.itemId, await loadLocalModel(level.id, stall.itemId)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** 测试用：清空 manifest 与 blob 缓存。 */
export function resetLocalModelCache(): void {
  manifestPromise = null;
  blobCache.clear();
}
