import { describe, expect, it } from 'vitest';
import { LevelSession } from '../src/game/level';
import {
  TUTORIAL_ITEM_IDS,
  TUTORIAL_LEVEL_ID,
  TUTORIAL_QA,
  createTutorialLevel,
  tutorialObjectives,
} from '../src/game/tutorial/level';
import { diffTraits } from '../src/game/validate';

const level = createTutorialLevel(1_700_000_000_000);

describe('教学关卡数据', () => {
  it('只有两件珍宝：一真一假，造假点在颗数', () => {
    expect(level.kind).toBe('tutorial');
    expect(level.id).toBe(TUTORIAL_LEVEL_ID);
    expect(level.stalls).toHaveLength(2);
    const real = level.stalls.find((stall) => stall.itemId === TUTORIAL_ITEM_IDS.real)!;
    const fake = level.stalls.find((stall) => stall.itemId === TUTORIAL_ITEM_IDS.fake)!;
    expect(real.item.isAuthentic).toBe(true);
    expect(fake.item.isAuthentic).toBe(false);
    expect(fake.item.tamperOps).toEqual([{ type: 'count_change', field: 'gemCount', delta: -1 }]);
    const creator = level.creators.find((entry) => entry.id === fake.creatorId)!;
    expect(diffTraits(creator.signatureTraits, fake.item.traits)).toEqual([
      { field: 'gemCount', label: '计数', expected: '7', actual: '6' },
    ]);
  });

  it('预生成故事背景：世界、创作人、精灵简报都不为空', () => {
    expect(level.world.lore.length).toBeGreaterThan(60);
    expect(level.world.lore).toContain('格罗姆');
    expect(level.creators[0]?.background.length).toBeGreaterThan(20);
    expect(level.fairy.briefing).toHaveLength(3);
  });

  it('预设问答覆盖：手艺规范 / 世界 / 传闻 / 价格 / 越界挡回', () => {
    expect(TUTORIAL_QA.length).toBeGreaterThanOrEqual(5);
    expect(TUTORIAL_QA.some((qa) => qa.blocked)).toBe(true);
    const blocked = TUTORIAL_QA.find((qa) => qa.blocked)!;
    expect(blocked.answer).toContain('没长天眼');
  });

  it('两件预算友好：买得起、且真品回收后整体小赚', () => {
    const total = level.stalls.reduce((sum, stall) => sum + stall.economy.salePrice, 0);
    expect(total).toBeLessThan(1000);
    const recycle = level.stalls.reduce(
      (sum, stall) =>
        sum +
        (stall.item.isAuthentic
          ? stall.economy.trueValue
          : Math.round(stall.economy.salePrice * 0.1)),
      0,
    );
    expect(recycle - total - 2 * 20).toBeGreaterThan(0);
  });
});

describe('教学关卡运行时', () => {
  it('剧本问答照常消耗额度、记录日志；越界回答标记 blocked', () => {
    const session = new LevelSession(level, { funds: 1000, xp: 0, level: 1 });
    const spec = TUTORIAL_QA.find((qa) => qa.id === 'spec')!;
    const which = TUTORIAL_QA.find((qa) => qa.id === 'which')!;
    session.askScripted(spec.question, spec.answer, false);
    session.askScripted(which.question, which.answer, true);
    expect(session.state.askUsed).toBe(2);
    expect(session.state.fairyLog).toHaveLength(2);
    expect(session.state.fairyLog[1]?.blocked).toBe(true);
  });

  it('六步目标由状态推导：依次点亮', () => {
    const base = {
      progress: { inspected: [] as string[], openedMarket: false },
      askUsed: 0,
      purchasedCount: 0,
      phase: 'market' as const,
      settled: false,
    };
    expect(tutorialObjectives(base).filter((o) => o.done)).toHaveLength(0);

    const afterMarket = tutorialObjectives({
      ...base,
      progress: { inspected: [TUTORIAL_ITEM_IDS.real], openedMarket: true },
    });
    expect(afterMarket.find((o) => o.id === 'open')?.done).toBe(true);
    expect(afterMarket.find((o) => o.id === 'inspect')?.done).toBe(false);

    const all = tutorialObjectives({
      progress: { inspected: [TUTORIAL_ITEM_IDS.real, TUTORIAL_ITEM_IDS.fake], openedMarket: true },
      askUsed: 1,
      purchasedCount: 2,
      phase: 'settled',
      settled: true,
    });
    expect(all.every((objective) => objective.done)).toBe(true);
  });
});
