import { describe, expect, it, vi } from 'vitest';
import {
  LUX3D_BASES,
  Lux3DClient,
  Lux3DError,
  estimateCredits,
  pickGlbUrl,
} from '../src/api/lux3d';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Lux3DClient', () => {
  it('create：Authorization 直接放 Key（无 Bearer）+ G1-Turbo 参数', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ c: '0', d: 777 }));
    const client = new Lux3DClient({
      apiKey: 'lux-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });
    const taskId = await client.createTextTo3D('A fantasy treasure: 八面体');
    expect(taskId).toBe('777');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.aholo3d.cn/lux3d/v1/generate/text-to-3d/task/create');
    expect((init.headers as Record<string, string>).Authorization).toBe('lux-key');
    const body = JSON.parse(String(init.body));
    expect(body.version).toBe('G1-Turbo');
    expect(body.faceCount).toBe(100_000);
    expect(body.outputFormat).toEqual(['glb']);
    expect(body.enablePbr).toBe(true);
  });

  it('国际区端点带 /global 前缀', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ c: '0', d: 1 }));
    const client = new Lux3DClient({
      apiKey: 'k',
      region: 'global',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.createTextTo3D('x');
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LUX3D_BASES.global}/lux3d/v1/generate/text-to-3d/task/create`);
  });

  it('轮询到 status 3 后取出 GLB，并下载为 Blob', async () => {
    let pollCount = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('task/create')) return jsonResponse({ c: '0', d: 99 });
      if (url.includes('task/get')) {
        pollCount += 1;
        if (pollCount === 1) {
          return jsonResponse({ c: '0', d: { taskId: 99, status: 1, outputs: [] } });
        }
        return jsonResponse({
          c: '0',
          d: { taskId: 99, status: 3, outputs: [{ content: 'https://oss.example/a.glb?x=1' }] },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const client = new Lux3DClient({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
      timeoutMs: 2000,
    });
    const result = await client.generateGlb('prompt');
    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(result.blob.size).toBe(3);
    expect(result.url).toContain('.glb');
  });

  it('失败状态 / 平台错误码给出可读原因', async () => {
    const failing = new Lux3DClient({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({
          c: '0',
          d: { taskId: 1, status: 4, outputs: [], errorMsg: '爆显存了' },
        })) as unknown as typeof fetch,
      pollIntervalMs: 1,
      timeoutMs: 500,
    });
    await expect(failing.waitForTask('1')).rejects.toMatchObject({
      name: 'Lux3DError',
      message: '爆显存了',
    });

    const badAuth = new Lux3DClient({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({ c: '401', m: 'invalid appKey' })) as unknown as typeof fetch,
    });
    await expect(badAuth.createTextTo3D('x')).rejects.toBeInstanceOf(Lux3DError);
  });

  it('pickGlbUrl / estimateCredits', () => {
    expect(pickGlbUrl(['https://a/x.png', 'https://a/y.glb?t=1'])).toBe('https://a/y.glb?t=1');
    expect(pickGlbUrl(['https://a/x.png'])).toBeNull();
    expect(estimateCredits(5)).toBe(65);
  });
});
