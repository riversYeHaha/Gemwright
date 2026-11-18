import { describe, expect, it } from 'vitest';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { GameCache } from '../src/store/cache';

const level = createDemoLevel(1_700_000_000_000);
const first = level.stalls[0]!;

describe('生成列表归档', () => {
  it('归档 Blob 后可列出、读取并删除', async () => {
    const cache = new GameCache(null);
    const blob = new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46])], {
      type: 'model/gltf-binary',
    });
    const saved = await cache.archiveModels(level, { [first.itemId]: blob });
    expect(saved).toBe(1);

    const list = await cache.listLibrary();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      key: `${level.id}:${first.itemId}`,
      name: first.item.name,
      authentic: first.item.isAuthentic,
      worldName: level.world.name,
      size: blob.size,
    });
    expect(await cache.getLibraryModel(list[0]!.key)).toBe(blob);

    await cache.deleteLibraryModel(list[0]!.key);
    expect(await cache.listLibrary()).toHaveLength(0);
    expect(await cache.getLibraryModel(list[0]!.key)).toBeNull();
  });

  it('跳过 null 占位模型；清空归档释放全部条目', async () => {
    const cache = new GameCache(null);
    expect(await cache.archiveModels(level, { [first.itemId]: null })).toBe(0);
    await cache.archiveModels(level, {
      [first.itemId]: new Blob(['a']),
      [level.stalls[1]!.itemId]: new Blob(['bb']),
    });
    expect(await cache.listLibrary()).toHaveLength(2);
    await cache.clearLibrary();
    expect(await cache.listLibrary()).toHaveLength(0);
  });
});
