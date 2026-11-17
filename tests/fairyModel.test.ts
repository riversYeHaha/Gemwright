import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFairyAsset, loadFairyManifest, resetFairyModelCache } from '../src/store/fairyModel';

const MANIFEST = {
  version: 1,
  model: 'fairy.glb',
  animations: ['Idle', 'Talk'],
  actions: { idle: 'Idle', talk: 'Talk' },
};

const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);

describe('陪伴精灵模型加载', () => {
  beforeEach(() => {
    resetFairyModelCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('读取 manifest 与 GLB，并缓存', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('manifest.json')) {
        return new Response(JSON.stringify(MANIFEST), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(GLB, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await loadFairyAsset();
    expect(first?.manifest.model).toBe('fairy.glb');
    expect(first?.buffer.byteLength).toBe(GLB.length);
    const calls = fetchMock.mock.calls.length;

    const again = await loadFairyAsset();
    expect(again).toBe(first);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('没有生成模型时安静返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    );
    await expect(loadFairyManifest()).resolves.toBeNull();
    await expect(loadFairyAsset()).resolves.toBeNull();
  });
});
