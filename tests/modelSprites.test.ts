import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocalModelCache } from '../src/store/localModels';
import {
  collectModelEntries,
  loadModelSprites,
  resetModelSpriteCache,
} from '../src/render/modelSprites';

const MANIFEST = {
  version: 1,
  generatedAt: '2026-11-16T16:36:07+00:00',
  levels: {
    'demo-level': { T1: 'demo/T1.glb', T2: 'demo/T2.glb' },
    'tutorial-level': { T1: 'tutorial/T1.glb', T2: 'tutorial/T2.glb' },
  },
  items: {
    'tutorial-level/T1': { name: '星穹之核', traits: { color: '青蓝' } },
    'tutorial-level/T2': { name: '碎星残核', traits: { color: '青蓝' } },
  },
};

/** 用假的 Worker / OffscreenCanvas 覆盖编排逻辑，不真的跑 WebGL。 */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: { id: number }): void {
    const id = message.id;
    queueMicrotask(() => {
      const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
      this.onmessage?.({ data: { id, ok: true, bitmap } } as MessageEvent);
    });
  }

  terminate(): void {}
}

class FailingWorker extends FakeWorker {
  override postMessage(): void {
    queueMicrotask(() => {
      this.onerror?.({ message: 'boom' } as ErrorEvent);
    });
  }
}

describe('开始画面的预置珍宝缩略图', () => {
  beforeEach(() => {
    resetLocalModelCache();
    resetModelSpriteCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collectModelEntries：教学关优先、限制数量、带上名称与色族', () => {
    const entries = collectModelEntries(MANIFEST, 3);
    expect(entries.map((entry) => `${entry.levelId}/${entry.itemId}`)).toEqual([
      'tutorial-level/T1',
      'tutorial-level/T2',
      'demo-level/T1',
    ]);
    expect(entries[0]?.name).toBe('星穹之核');
    expect(entries[0]?.color).toBe('青蓝');
    expect(collectModelEntries(null)).toEqual([]);
    expect(collectModelEntries(MANIFEST, 0)).toEqual([]);
  });

  it('没有 manifest（未跑初始化脚本）时返回空数组，不加载 three', async () => {
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const onSprite = vi.fn();
    await expect(loadModelSprites({ onSprite })).resolves.toEqual([]);
    expect(onSprite).not.toHaveBeenCalled();
  });

  it('Worker 成功时把缩略图交给 onSprite', async () => {
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('manifest.json')) {
          return new Response(JSON.stringify(MANIFEST), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(new Blob(['glb']), { status: 200 });
      }),
    );
    const onSprite = vi.fn();
    const sprites = await loadModelSprites({ max: 1, onSprite });
    expect(sprites).toHaveLength(1);
    expect(sprites[0]?.levelId).toBe('tutorial-level');
    expect(sprites[0]?.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(onSprite).toHaveBeenCalledTimes(1);
  });

  it('Worker 报错时安静回退空数组', async () => {
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', FailingWorker);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('manifest.json')) {
          return new Response(JSON.stringify(MANIFEST), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(new Blob(['glb']), { status: 200 });
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(loadModelSprites({ max: 1 })).resolves.toEqual([]);
    warn.mockRestore();
  });

  it('manifest 存在但 GLB 读取失败时安静回退', async () => {
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('manifest.json')) {
          return new Response(JSON.stringify(MANIFEST), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('missing', { status: 404 });
      }),
    );
    await expect(loadModelSprites({ max: 2 })).resolves.toEqual([]);
  });
});
