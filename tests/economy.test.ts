import { describe, expect, it } from 'vitest';
import {
  applySettlement,
  checkMarketEnd,
  createPlayer,
  fairyQuota,
  levelForXp,
  offerQuota,
  recycleValueOf,
  remainingFunds,
  settleLevel,
} from '../src/game/economy';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import type { LevelRuntime, PlayerState } from '../src/types/level';

const level = createDemoLevel(1_700_000_000_000);

function runtimeWith(purchases: Record<string, number>): LevelRuntime {
  return {
    levelId: level.id,
    difficulty: level.difficulty,
    phase: 'base',
    items: Object.fromEntries(
      level.stalls.map((stall) => [
        stall.itemId,
        {
          itemId: stall.itemId,
          status: purchases[stall.itemId] !== undefined ? ('purchased' as const) : ('listed' as const),
          ...(purchases[stall.itemId] !== undefined ? { purchasePrice: purchases[stall.itemId] } : {}),
          offers: [],
          rejectedPrices: [],
        },
      ]),
    ),
    offersUsed: 0,
    askUsed: 0,
    fairyLog: [],
    startedAt: 0,
  };
}

describe('economy', () => {
  it('等级 / 额度随经验与等级成长', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(799)).toBe(1);
    expect(levelForXp(800)).toBe(2);
    expect(levelForXp(1600)).toBe(3);
    expect(offerQuota(1)).toBe(10);
    expect(offerQuota(3)).toBe(20);
    expect(fairyQuota(1)).toBe(5);
    expect(fairyQuota(4)).toBe(11);
  });

  it('创建玩家：默认 1000 资金，经验决定等级', () => {
    expect(createPlayer()).toEqual({ funds: 1000, xp: 0, level: 1 });
    expect(createPlayer(500, 900).level).toBe(2);
  });

  it('回收价：真品 = trueValue，仿品 = 标价 × 10%', () => {
    const real = level.stalls.find((stall) => stall.item.isAuthentic)!;
    const fake = level.stalls.find((stall) => !stall.item.isAuthentic)!;
    expect(recycleValueOf(real)).toBe(real.economy.trueValue);
    expect(recycleValueOf(fake)).toBe(Math.round(fake.economy.salePrice * 0.1));
  });

  it('结算：净收益 = Σ回收 − Σ成交 − Σ手续费', () => {
    const runtime = runtimeWith({ T1: 300, T2: 200 });
    const player: PlayerState = { funds: 1000, xp: 0, level: 1 };
    const settlement = settleLevel(runtime, player, level, [
      { itemId: 'T1', recycle: true },
      { itemId: 'T2', recycle: true },
    ]);
    const t1 = level.stalls.find((stall) => stall.itemId === 'T1')!;
    const t2 = level.stalls.find((stall) => stall.itemId === 'T2')!;
    const expectedRecycle = t1.economy.trueValue + Math.round(t2.economy.salePrice * 0.1);
    expect(settlement.spent).toBe(500);
    expect(settlement.fees).toBe(40);
    expect(settlement.recycle).toBe(expectedRecycle);
    expect(settlement.net).toBe(expectedRecycle - 500 - 40);
    expect(settlement.fundsAfter).toBe(1000 - 500 + expectedRecycle - 40);
    expect(settlement.xpGain).toBe(Math.max(0, settlement.net));
    expect(settlement.authenticOwned).toBe(1);
    expect(settlement.fakeOwned).toBe(1);
  });

  it('不回收：无所得也不收手续费', () => {
    const runtime = runtimeWith({ T1: 300 });
    const settlement = settleLevel(runtime, { funds: 1000, xp: 0, level: 1 }, level, [
      { itemId: 'T1', recycle: false },
    ]);
    expect(settlement.recycle).toBe(0);
    expect(settlement.fees).toBe(0);
    expect(settlement.net).toBe(-300);
  });

  it('结算应用：资金更新、经验只增不减、升级', () => {
    const player: PlayerState = { funds: 1000, xp: 300, level: 1 };
    const settlement = settleLevel(runtimeWith({ T1: 300 }), player, level);
    const next = applySettlement(player, { ...settlement, xpGain: 600, net: 600 });
    expect(next.xp).toBe(900);
    expect(next.level).toBe(2);
  });

  it('可用资金扣除已购件', () => {
    const runtime = runtimeWith({ T1: 300 });
    expect(remainingFunds({ funds: 1000, xp: 0, level: 1 }, runtime)).toBe(700);
  });

  it('结束条件：额度耗尽 / 资金不足最低底价 / 无货可议', () => {
    const player: PlayerState = { funds: 1000, xp: 0, level: 1 };
    expect(checkMarketEnd(runtimeWith({}), player, level).end).toBe(false);

    const exhausted = runtimeWith({});
    exhausted.offersUsed = offerQuota(1);
    expect(checkMarketEnd(exhausted, player, level)).toMatchObject({
      end: true,
      reason: 'offer-quota',
    });

    const brokePlayer: PlayerState = { funds: 10, xp: 0, level: 1 };
    expect(checkMarketEnd(runtimeWith({}), brokePlayer, level)).toMatchObject({
      end: true,
      reason: 'out-of-funds',
    });

    const allBought = runtimeWith({ T1: 300, T2: 200, T3: 100, T4: 100, T5: 100 });
    expect(checkMarketEnd(allBought, { funds: 2000, xp: 0, level: 1 }, level)).toMatchObject({
      end: true,
      reason: 'all-resolved',
    });
  });
});
