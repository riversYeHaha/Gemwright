import {
  FAKE_RECYCLE_RATIO,
  FAIRY_QUOTA_BASE,
  FAIRY_QUOTA_PER_LEVEL,
  OFFER_QUOTA_BASE,
  OFFER_QUOTA_PER_LEVEL,
  MAX_ROUNDS_PER_ITEM,
  RECYCLE_FEE,
  START_FUNDS,
  XP_PER_LEVEL,
} from '../config/constants';
import type {
  LevelRuntime,
  PlayerState,
  RecyclePlan,
  Settlement,
  Stall,
} from '../types/level';

/** 等级 = 1 + ⌊经验 / 800⌋（经验即净收益，负收益不扣级）。 */
export function levelForXp(xp: number): number {
  return Math.max(1, 1 + Math.floor(Math.max(0, xp) / XP_PER_LEVEL));
}

export function createPlayer(funds = START_FUNDS, xp = 0): PlayerState {
  return { funds, xp: Math.max(0, xp), level: levelForXp(xp) };
}

/** 议价额度：每关独立，10 点 + 5/级。 */
export function offerQuota(level: number): number {
  return OFFER_QUOTA_BASE + OFFER_QUOTA_PER_LEVEL * Math.max(0, level - 1);
}

/** 询问额度：每关独立，5 次 + 2/级。 */
export function fairyQuota(level: number): number {
  return FAIRY_QUOTA_BASE + FAIRY_QUOTA_PER_LEVEL * Math.max(0, level - 1);
}

export function spendSoFar(runtime: LevelRuntime): number {
  return Object.values(runtime.items).reduce(
    (sum, item) => sum + (item.status === 'purchased' ? item.purchasePrice ?? 0 : 0),
    0,
  );
}

export function remainingFunds(player: PlayerState, runtime: LevelRuntime): number {
  return Math.max(0, player.funds - spendSoFar(runtime));
}

/** 回收价预览：真品 = trueValue；仿品 = 0.1 × 标价（工艺残值）。 */
export function recycleValueOf(stall: Stall): number {
  return stall.item.isAuthentic
    ? Math.round(stall.economy.trueValue)
    : Math.round(stall.economy.salePrice * FAKE_RECYCLE_RATIO);
}

export function recycleFeeOf(recycle: boolean): number {
  return recycle ? RECYCLE_FEE : 0;
}

/**
 * 结算：净收益 = Σ回收 − Σ成交 − Σ手续费。
 * XP 只增不减（负收益不给经验，也不会掉级），避免"摆烂掉级"策略。
 */
export function settleLevel(
  runtime: LevelRuntime,
  player: PlayerState,
  level: { stalls: Stall[]; id: string },
  plan?: RecyclePlan[],
): Settlement {
  const planMap = new Map((plan ?? []).map((entry) => [entry.itemId, entry.recycle]));
  const lines: Settlement['lines'] = [];
  let spent = 0;
  let recycle = 0;
  let fees = 0;
  let authenticOwned = 0;
  let fakeOwned = 0;

  for (const stall of level.stalls) {
    const itemRuntime = runtime.items[stall.itemId];
    const purchased = itemRuntime?.status === 'purchased';
    const price = purchased ? itemRuntime.purchasePrice ?? 0 : 0;
    const recycled = purchased && (planMap.get(stall.itemId) ?? true);
    const value = recycled ? recycleValueOf(stall) : 0;
    const fee = recycled ? RECYCLE_FEE : 0;

    if (purchased) {
      spent += price;
      if (stall.item.isAuthentic) authenticOwned += 1;
      else fakeOwned += 1;
    }
    recycle += value;
    fees += fee;

    lines.push({
      itemId: stall.itemId,
      name: stall.item.name,
      purchased,
      price,
      authentic: stall.item.isAuthentic,
      recycleValue: value,
      fee,
      recycled,
      trueValue: stall.economy.trueValue,
    });
  }

  const net = recycle - spent - fees;
  const xpGain = Math.max(0, Math.floor(net));
  const settlement: Settlement = {
    spent,
    recycle,
    fees,
    net,
    xpGain,
    levelBefore: player.level,
    levelAfter: levelForXp(player.xp + xpGain),
    fundsBefore: player.funds,
    fundsAfter: player.funds - spent + recycle - fees,
    authenticOwned,
    fakeOwned,
    lines,
  };
  return settlement;
}

/** 结算后应用：升级、刷新等级；资金以结算为准。 */
export function applySettlement(player: PlayerState, settlement: Settlement): PlayerState {
  const xp = player.xp + settlement.xpGain;
  return { funds: Math.max(0, settlement.fundsAfter), xp, level: levelForXp(xp) };
}

export interface MarketEndCheck {
  end: boolean;
  reason?: 'offer-quota' | 'out-of-funds' | 'all-resolved';
  message?: string;
}

/** 自动结束条件（方案 §二 H2）：额度耗尽 / 资金低于全场最低底价 / 无货可议。 */
export function checkMarketEnd(
  runtime: LevelRuntime,
  player: PlayerState,
  level: { stalls: Stall[]; difficulty: number },
): MarketEndCheck {
  const available = remainingFunds(player, runtime);
  const minBottom = level.stalls.reduce(
    (min, stall) => Math.min(min, stall.economy.bottomPrice),
    Number.POSITIVE_INFINITY,
  );
  const quota = offerQuota(player.level);

  const unresolved = level.stalls.some((stall) => {
    const item = runtime.items[stall.itemId];
    if (!item || item.status !== 'listed') return false;
    return item.offers.length < MAX_ROUNDS_PER_ITEM && stall.economy.bottomPrice <= available;
  });

  if (runtime.offersUsed >= quota) {
    return { end: true, reason: 'offer-quota', message: '议价额度已耗尽，摊主们开始收摊。' };
  }
  if (available < minBottom) {
    return { end: true, reason: 'out-of-funds', message: '盘缠所剩无几，连最低的底价都够不上了。' };
  }
  if (!unresolved) {
    return { end: true, reason: 'all-resolved', message: '街上已没有你出得起的货，该收摊了。' };
  }
  return { end: false };
}
