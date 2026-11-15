import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '../src/api/types';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { ensureLevelModels, generateLevel } from '../src/game/generation';
import { getSeedById } from '../src/game/seeds';
import { LevelError } from '../src/types/level';
import { Lux3DError, type Lux3DClient } from '../src/api/lux3d';
import { makeRawLevel } from './fixtures/rawLevel';

const seed = getSeedById('S01')!;

describe('generateLevel', () => {
  it('第一次输出不是 JSON → 定向重试后成功', async () => {
    const responses = ['不是 JSON', JSON.stringify(makeRawLevel({ allAuthentic: true }))];
    let calls = 0;
    const client: ChatClient = {
      chat: async (options) => {
        calls += 1;
        // 第二次调用必须带上一次的问题反馈
        if (calls === 2) {
          const last = options.messages[options.messages.length - 1]?.content ?? '';
          expect(last).toContain('上一次输出存在以下问题');
        }
        return { content: responses[calls - 1] ?? '' };
      },
    };
    const result = await generateLevel(
      { client },
      { seed, difficulty: 1, funds: 1000, rng: () => 0.42, now: 1_700_000_000_000 },
    );
    expect(calls).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.level.id.startsWith('S01-D1-')).toBe(true);
    expect(result.level.stalls).toHaveLength(5);
    expect(result.level.stalls.filter((stall) => stall.item.isAuthentic)).toHaveLength(3);
  });

  it('三次都失败 → LevelError（UI 给"重掷"）', async () => {
    const client: ChatClient = { chat: async () => ({ content: '一直不是 JSON' }) };
    await expect(
      generateLevel({ client }, { seed, difficulty: 2, funds: 1000 }),
    ).rejects.toBeInstanceOf(LevelError);
  }, 10_000);
});

describe('ensureLevelModels', () => {
  it('缓存命中的件直接用缓存；没有 Lux3D Key 的件给占位模型', async () => {
    const level = createDemoLevel(1);
    const cachedBlob = new Blob(['cached']);
    const cache = {
      getModel: vi.fn(async (_levelId: string, itemId: string) =>
        itemId === 'T1' ? cachedBlob : null,
      ),
      saveModel: vi.fn(async () => undefined),
    };
    const progress: string[] = [];
    const result = await ensureLevelModels(
      level,
      { cache, lux3d: null },
      { onProgress: (entry) => progress.push(`${entry.itemId}:${entry.status}`) },
    );
    expect(result.models.T1).toBe(cachedBlob);
    expect(result.models.T2).toBeNull();
    expect(result.errors).toEqual({});
    expect(result.creditsSpent).toBe(0);
    expect(progress).toContain('T1:cached');
    expect(progress).toContain('T2:skipped');
  });

  it('5 件并发（免费档并发 5），不是串行', async () => {
    const level = createDemoLevel(1);
    let started = 0;
    let maxConcurrent = 0;
    const resolvers: Array<() => void> = [];
    const lux3d = {
      generateGlb: vi.fn(
        () =>
          new Promise((resolve) => {
            started += 1;
            maxConcurrent = Math.max(maxConcurrent, started);
            resolvers.push(() =>
              resolve({ blob: new Blob(['glb']), taskId: '1', url: 'https://x/a.glb' }),
            );
          }),
      ),
    } as unknown as Lux3DClient;
    const cache = { getModel: vi.fn(async () => null), saveModel: vi.fn(async () => undefined) };

    const pending = ensureLevelModels(level, { cache, lux3d });
    await vi.waitFor(() => expect(started).toBe(5));
    for (const resolve of resolvers) resolve();
    const result = await pending;
    expect(maxConcurrent).toBe(5);
    expect(Object.keys(result.models)).toHaveLength(5);
  });

  it('可重试失败（task-failed / timeout）会自动重试一次', async () => {
    const level = createDemoLevel(1);
    let calls = 0;
    const lux3d = {
      generateGlb: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Lux3DError('显存抖动', 'task-failed');
        return { blob: new Blob(['glb']), taskId: '1', url: 'https://x/a.glb' };
      }),
    } as unknown as Lux3DClient;
    const cache = { getModel: vi.fn(async () => null), saveModel: vi.fn(async () => undefined) };
    const result = await ensureLevelModels(level, { cache, lux3d });
    expect(result.errors).toEqual({});
    expect(Object.values(result.models).every((blob) => blob instanceof Blob)).toBe(true);
  });

  it('取消布展：标记停止、不产生 errors', async () => {
    const level = createDemoLevel(1);
    const controller = new AbortController();
    const lux3d = {
      generateGlb: vi.fn(
        (_prompt: string, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new Lux3DError('生成已取消', 'aborted')),
            );
          }),
      ),
    } as unknown as Lux3DClient;
    const cache = { getModel: vi.fn(async () => null), saveModel: vi.fn(async () => undefined) };
    const pending = ensureLevelModels(level, { cache, lux3d }, { signal: controller.signal });
    await vi.waitFor(() => expect(lux3d.generateGlb).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result.errors).toEqual({});
    expect(Object.values(result.models).every((blob) => blob === null)).toBe(true);
  });

  it('有 Lux3D 时按 traits 生成并写缓存，单件失败不影响其他件', async () => {
    const level = createDemoLevel(1);
    const generated = new Blob(['glb']);
    let call = 0;
    const lux3d = {
      generateGlb: vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('boom');
        return { blob: generated, taskId: '1', url: 'https://oss/a.glb' };
      }),
    } as unknown as Lux3DClient;
    const cache = {
      getModel: vi.fn(async () => null),
      saveModel: vi.fn(async () => undefined),
    };
    const result = await ensureLevelModels(level, { cache, lux3d });
    expect(result.errors.T1).toContain('boom');
    expect(result.models.T2).toBe(generated);
    expect(result.creditsSpent).toBeGreaterThan(0);
    expect(cache.saveModel).toHaveBeenCalled();
    // prompt 由 traits 组装：Lux3D 原生模板里包含形制、色族与颗数
    const prompt =
      (lux3d.generateGlb as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('八面体');
    expect(prompt).toContain('青蓝');
  });
});
