import type { ChatClient } from '../api/types';
import { MAX_ROUNDS_PER_ITEM } from '../config/constants';
import { buildBargainSystemPrompt, buildBargainUserPrompt } from '../config/prompts';
import type { BargainDecision, BargainMode, ItemRuntime, Stall } from '../types/level';

/**
 * 混合砍价（方案 §二 H3）：
 * 1. 结构校验 + 底价硬规则在前端，不问 LLM；
 * 2. LLM 只在"报价 ≥ 底价"后决定态度与台词；
 * 3. 一致性兜底：接受价不得低于此前被拒价格；
 * 4. "快速模式"（local）用本地公式 + 预生成台词池，零调用。
 */

export interface OfferContext {
  stall: Stall;
  offer: number;
  /** 本局已消耗的议价额度。 */
  offersUsed: number;
  quota: number;
  /** 玩家可用资金（已扣除已购件）。 */
  availableFunds: number;
  item: ItemRuntime;
  mode: BargainMode;
}

export type OfferBlockCode = NonNullable<BargainDecision['code']>;

export type OfferCheck =
  | { ok: true }
  | { ok: false; code: OfferBlockCode; message: string };

/** 单件当前是第几回合（1 起）。 */
export function nextRound(item: ItemRuntime): number {
  return item.offers.length + 1;
}

export function checkOffer(ctx: OfferContext): OfferCheck {
  if (ctx.item.status === 'purchased') {
    return { ok: false, code: 'already-purchased', message: '这件已经是你的了。' };
  }
  if (!Number.isFinite(ctx.offer) || !Number.isInteger(ctx.offer) || ctx.offer <= 0) {
    return { ok: false, code: 'invalid-offer', message: '报价必须是正整数星际币。' };
  }
  if (nextRound(ctx.item) > MAX_ROUNDS_PER_ITEM) {
    return { ok: false, code: 'round-cap', message: '摊主摆手：谈崩了，这件不卖你了。' };
  }
  if (ctx.offersUsed >= ctx.quota) {
    return { ok: false, code: 'no-quota', message: '议价额度已用完，摊主们都散了。' };
  }
  if (ctx.offer > ctx.availableFunds) {
    return {
      ok: false,
      code: 'insufficient-funds',
      message: `你身上只剩 ${ctx.availableFunds} 星际币，报不出这个价。`,
    };
  }
  if (ctx.offer > ctx.stall.economy.salePrice) {
    return { ok: false, code: 'invalid-offer', message: '没人会按高于标价的价买，别当冤大头。' };
  }
  return { ok: true };
}

/** 本地公式的"接受线"：弹性 + 回合数共同决定摊主耐心。 */
export function localThreshold(stall: Stall, round: number): number {
  const { salePrice, bottomPrice, flexibility } = stall.economy;
  const gap = Math.max(1, salePrice - bottomPrice);
  const patience = 0.05 * Math.max(0, round - 1);
  const threshold = salePrice - gap * (flexibility + patience);
  return Math.min(salePrice, Math.max(bottomPrice, Math.ceil(threshold)));
}

const ACCEPT_LINES = [
  '钱货两清，拿走吧。',
  '行，看你识货。',
  '这个价……罢了，交个朋友。',
  '就这个数，别磨叽了。',
];

const REJECT_LINES = [
  '这价太低了，你再去别处转转吧。',
  '你当这是捡破烂？再加点。',
  '不卖不卖，我进货都不止这个数。',
  '你这刀砍得有点狠，我喝西北风去？',
];

const BELOW_FLOOR_LINE = '这个价？你出门左转吧，我连本都收不回。';
const GUARD_LINE = '刚才那个价我都没松口，这个更低的就别提了。';
const ASK_PRICE_LINE = '不费口舌，按标价拿走。';

function lineFrom(pool: string[], round: number, offer: number): string {
  const index = (round + offer) % pool.length;
  return pool[index] ?? pool[0] ?? '';
}

/** 纯本地判定（快速模式 / LLM 失败兜底）。 */
export function localDecision(ctx: OfferContext): BargainDecision {
  const round = nextRound(ctx.item);
  if (ctx.offer >= ctx.stall.economy.salePrice) {
    return { accept: true, line: ASK_PRICE_LINE, source: 'local' };
  }
  const threshold = localThreshold(ctx.stall, round);
  if (ctx.offer >= threshold) {
    return { accept: true, line: lineFrom(ACCEPT_LINES, round, ctx.offer), source: 'local' };
  }
  return { accept: false, line: lineFrom(REJECT_LINES, round, ctx.offer), source: 'local' };
}

function parseDecision(raw: string): { accept: boolean; line: string } | null {
  const trimmed = raw.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) return null;
    try {
      data = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as { accept?: unknown; line?: unknown };
  if (typeof record.accept !== 'boolean') return null;
  const line = typeof record.line === 'string' ? record.line.trim().slice(0, 40) : '';
  return { accept: record.accept, line: line || (record.accept ? '成交。' : '不卖。') };
}

/**
 * 判定一次报价。返回 accept 不代表状态已更新——记账由 LevelSession.commitOffer 负责，
 * 保证"判定"与"状态"可以分别测试。
 */
export async function decideOffer(
  client: ChatClient | null,
  ctx: OfferContext,
  signal?: AbortSignal,
): Promise<BargainDecision> {
  const checked = checkOffer(ctx);
  if (!checked.ok) {
    return { accept: false, line: checked.message, source: 'rules', code: checked.code };
  }

  // 硬规则：低于底价必拒，不消耗 LLM 调用（但计入议价额度）。
  if (ctx.offer < ctx.stall.economy.bottomPrice) {
    return { accept: false, line: BELOW_FLOOR_LINE, source: 'rules', code: 'below-floor' };
  }

  if (ctx.mode === 'local' || !client) {
    return localDecision(ctx);
  }

  try {
    const result = await client.chat({
      messages: [
        { role: 'system', content: buildBargainSystemPrompt(ctx.stall) },
        { role: 'user', content: buildBargainUserPrompt(ctx.stall, ctx.offer, nextRound(ctx.item)) },
      ],
      json: true,
      temperature: 0.8,
      maxTokens: 200,
      ...(signal ? { signal } : {}),
    });
    const parsed = parseDecision(result.content);
    if (!parsed) return { ...localDecision(ctx), source: 'local' };

    // 一致性兜底：接受价不得低于此前被拒的价格。
    const lastRejected = ctx.item.rejectedPrices[ctx.item.rejectedPrices.length - 1];
    if (parsed.accept && lastRejected !== undefined && ctx.offer < lastRejected) {
      return { accept: false, line: GUARD_LINE, source: 'rules' };
    }
    return { accept: parsed.accept, line: parsed.line, source: 'llm' };
  } catch {
    // 断网 / 超时 / JSON 崩：退回本地公式，保证游戏能玩下去。
    return localDecision(ctx);
  }
}

/** 状态更新：成交或拒绝都消耗 1 点额度，并累计回合记录。 */
export function commitOffer(
  item: ItemRuntime,
  decision: BargainDecision,
  offer: number,
): ItemRuntime {
  const record = {
    price: offer,
    accepted: decision.accept,
    round: nextRound(item),
    source: decision.source,
    at: Date.now(),
  };
  const offers = [...item.offers, record];
  if (decision.accept) {
    return {
      ...item,
      status: 'purchased',
      purchasePrice: offer,
      offers,
      rejectedPrices: item.rejectedPrices,
    };
  }
  const rejectedPrices = [...item.rejectedPrices, offer];
  const passed = offers.length >= MAX_ROUNDS_PER_ITEM;
  return {
    ...item,
    status: passed ? 'passed' : 'listed',
    offers,
    rejectedPrices,
  };
}
