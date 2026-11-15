import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '../src/api/types';
import {
  checkOffer,
  commitOffer,
  decideOffer,
  localDecision,
  localThreshold,
  nextRound,
  type OfferContext,
} from '../src/game/bargain';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import type { ItemRuntime, Stall } from '../src/types/level';

const level = createDemoLevel(1_700_000_000_000);
const stall = level.stalls.find((entry) => entry.itemId === 'T1') as Stall; // 480 / 340 / 0.6

function item(overrides: Partial<ItemRuntime> = {}): ItemRuntime {
  return {
    itemId: stall.itemId,
    status: 'listed',
    offers: [],
    rejectedPrices: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<OfferContext> = {}): OfferContext {
  return {
    stall,
    offer: 400,
    offersUsed: 0,
    quota: 10,
    availableFunds: 1000,
    item: item(),
    mode: 'local',
    ...overrides,
  };
}

describe('checkOffer', () => {
  it('额度耗尽 / 回合超限 / 资金不足 / 已购 都拦下', () => {
    expect(checkOffer(ctx({ offersUsed: 10 }))).toMatchObject({ ok: false, code: 'no-quota' });
    expect(checkOffer(ctx({ item: item({ offers: [1, 2, 3, 4].map(() => ({ price: 1, accepted: false, round: 1, source: 'local' as const, at: 0 })) }) }))).toMatchObject({
      ok: false,
      code: 'round-cap',
    });
    expect(checkOffer(ctx({ offer: 5000 }))).toMatchObject({ ok: false, code: 'insufficient-funds' });
    expect(checkOffer(ctx({ item: item({ status: 'purchased' }) }))).toMatchObject({
      ok: false,
      code: 'already-purchased',
    });
    expect(checkOffer(ctx({ offer: 900 }))).toMatchObject({ ok: false, code: 'invalid-offer' });
    expect(checkOffer(ctx({ offer: 0 }))).toMatchObject({ ok: false, code: 'invalid-offer' });
    expect(checkOffer(ctx({ offer: 400 }))).toEqual({ ok: true });
  });
});

describe('localDecision', () => {
  it('接受线在底价与标价之间，且随回合数下降（摊主耐心变差）', () => {
    const first = localThreshold(stall, 1);
    const last = localThreshold(stall, 4);
    expect(first).toBeGreaterThanOrEqual(stall.economy.bottomPrice);
    expect(first).toBeLessThanOrEqual(stall.economy.salePrice);
    expect(last).toBeLessThanOrEqual(first);
  });

  it('当众抬价到标价直接成交；低于接受线被拒', () => {
    expect(localDecision(ctx({ offer: stall.economy.salePrice })).accept).toBe(true);
    expect(localDecision(ctx({ offer: 350 })).accept).toBe(false);
    expect(localDecision(ctx({ offer: 460 })).accept).toBe(true);
  });
});

describe('decideOffer', () => {
  it('低于底价必拒，且不调用 LLM', async () => {
    const chat = vi.fn(async () => ({ content: '{"accept":true,"line":"好"}' }));
    const client: ChatClient = { chat };
    const decision = await decideOffer(client, ctx({ offer: 100, mode: 'hybrid' }));
    expect(decision.accept).toBe(false);
    expect(decision.code).toBe('below-floor');
    expect(decision.source).toBe('rules');
    expect(chat).not.toHaveBeenCalled();
  });

  it('LLM 接受后给出台词；JSON 崩掉时退回本地公式', async () => {
    const acceptClient: ChatClient = {
      chat: async () => ({ content: '{"accept":true,"line":"行，拿走。"}' }),
    };
    const accepted = await decideOffer(acceptClient, ctx({ offer: 400, mode: 'hybrid' }));
    expect(accepted).toMatchObject({ accept: true, source: 'llm', line: '行，拿走。' });

    const brokenClient: ChatClient = { chat: async () => ({ content: '不知道' }) };
    const fallback = await decideOffer(brokenClient, ctx({ offer: 400, mode: 'hybrid' }));
    expect(fallback.source).toBe('local');
    expect(typeof fallback.line).toBe('string');
  });

  it('一致性兜底：接受价不得低于此前被拒价格', async () => {
    const client: ChatClient = {
      chat: async () => ({ content: '{"accept":true,"line":"行"}' }),
    };
    const decision = await decideOffer(
      client,
      ctx({ offer: 380, mode: 'hybrid', item: item({ rejectedPrices: [400] }) }),
    );
    expect(decision.accept).toBe(false);
    expect(decision.source).toBe('rules');
  });
});

describe('commitOffer', () => {
  it('成交后件状态为已购，并记录成交价', () => {
    const next = commitOffer(item(), { accept: true, line: '成交', source: 'local' }, 430);
    expect(next.status).toBe('purchased');
    expect(next.purchasePrice).toBe(430);
    expect(next.offers).toHaveLength(1);
  });

  it('第 4 次被拒后流拍', () => {
    let runtime = item();
    for (let i = 0; i < 4; i += 1) {
      runtime = commitOffer(runtime, { accept: false, line: '不卖', source: 'local' }, 300 + i);
    }
    expect(runtime.status).toBe('passed');
    expect(runtime.rejectedPrices).toHaveLength(4);
    expect(nextRound(runtime)).toBe(5);
  });
});
