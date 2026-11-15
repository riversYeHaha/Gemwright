import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadLevelLocalModels,
  loadLocalModel,
  loadLocalModelManifest,
  resetLocalModelCache,
} from '../src/store/localModels';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';

const MANIFEST = {
  version: 1,
  region: 'china',
  levels: {
    'tutorial-level': { T1: 'tutorial/T1.glb' },
    'demo-level': { T2: 'demo/T2.glb' },
  },
};

function mockFetch(
  handler: (url: string) => Response | Promise<Response> = () =>
    new Response('{}', { status: 404 }),
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request) => handler(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as ReturnType<typeof vi.fn>;
}

describe('预置模型加载', () => {
  beforeEach(() => {
    resetLocalModelCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('按 manifest 加载 GLB，并缓存（同一件不重复请求）', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('manifest.json')) {
        return new Response(JSON.stringify(MANIFEST), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('tutorial/T1.glb')) {
        return new Response(new Blob(['glb-bytes']), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const blob = await loadLocalModel('tutorial-level', 'T1');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.size).toBeGreaterThan(0);
    const firstCallCount = fetchMock.mock.calls.length;
    expect(firstCallCount).toBe(2);

    const again = await loadLocalModel('tutorial-level', 'T1');
    expect(again).toBe(blob);
    expect(fetchMock.mock.calls.length).toBe(firstCallCount);
  });

  it('manifest 里没有的关卡 / 件返回 null', async () => {
    const fetchMock = mockFetch((url) =>
      url.includes('manifest.json')
        ? new Response(JSON.stringify(MANIFEST), { status: 200 })
        : new Response('x', { status: 404 }),
    );
    await expect(loadLocalModel('tutorial-level', 'T9')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('没有 manifest（未执行初始化脚本）时安静退回 null', async () => {
    const fetchMock = mockFetch(() => new Response('missing', { status: 404 }));
    await expect(loadLocalModelManifest()).resolves.toBeNull();
    await expect(loadLocalModel('tutorial-level', 'T1')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetch 抛错也被吞掉（离线 / 静态路径不对）', async () => {
    mockFetch(() => {
      throw new Error('network down');
    });
    await expect(loadLocalModel('demo-level', 'T2')).resolves.toBeNull();
  });

  it('loadLevelLocalModels 按关卡 itemId 汇总，缺的给 null', async () => {
    mockFetch((url) => {
      if (url.includes('manifest.json')) {
        return new Response(JSON.stringify(MANIFEST), { status: 200 });
      }
      if (url.includes('demo/T2.glb')) {
        return new Response(new Blob(['glb']), { status: 200 });
      }
      return new Response('x', { status: 404 });
    });
    const level = createDemoLevel(1);
    const models = await loadLevelLocalModels(level);
    expect(Object.keys(models)).toHaveLength(level.stalls.length);
    expect(models.T2).toBeInstanceOf(Blob);
    expect(models.T1).toBeNull();
  });
});
