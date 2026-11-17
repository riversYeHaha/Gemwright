/**
 * 陪伴精灵的预置模型加载。
 *
 * `scripts/init_fairy.mjs` 生成 `public/models/fairy/fairy.glb` 与 manifest；
 * 没生成时返回 null，运行时用 `render/fairyRig` 实时构建同一套骨架兜底。
 */

export interface FairyManifest {
  version: number;
  generatedAt?: string;
  model?: string;
  animations?: string[];
  actions?: Record<string, string>;
  bones?: string[];
}

export interface FairyAsset {
  manifest: FairyManifest;
  buffer: ArrayBuffer;
}

const MANIFEST_REL_PATH = 'models/fairy/manifest.json';
const MODEL_BASE_REL = 'models/fairy/';

let manifestPromise: Promise<FairyManifest | null> | null = null;
let assetPromise: Promise<FairyAsset | null> | null = null;

function baseUrl(): string {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  return 'http://localhost/';
}

async function fetchManifest(): Promise<FairyManifest | null> {
  try {
    const response = await fetch(new URL(MANIFEST_REL_PATH, baseUrl()).toString(), {
      cache: 'no-cache',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!data || typeof data !== 'object') return null;
    const manifest = data as FairyManifest;
    return typeof manifest.model === 'string' && manifest.model ? manifest : null;
  } catch {
    return null;
  }
}

export async function loadFairyManifest(): Promise<FairyManifest | null> {
  if (!manifestPromise) manifestPromise = fetchManifest();
  return manifestPromise;
}

export async function loadFairyAsset(): Promise<FairyAsset | null> {
  if (!assetPromise) {
    assetPromise = (async () => {
      const manifest = await loadFairyManifest();
      if (!manifest?.model) return null;
      try {
        const url = new URL(manifest.model, new URL(MODEL_BASE_REL, baseUrl())).toString();
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 12) return null;
        const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
        if (magic !== 'glTF') return null;
        return { manifest, buffer };
      } catch {
        return null;
      }
    })();
  }
  return assetPromise;
}

/** 测试 / 重新生成模型后清空缓存。 */
export function resetFairyModelCache(): void {
  manifestPromise = null;
  assetPromise = null;
}
