import { describe, expect, it } from 'vitest';
import type { ChatClient } from '../src/api/types';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { LevelSession } from '../src/game/level';
import type { PlayerState } from '../src/types/level';

const level = createDemoLevel(1_700_000_000_000);
const player = (): PlayerState => ({ funds: 1000, xp: 0, level: 1 });
const echoClient: ChatClient = {
  chat: async () => ({ content: '此地仿品爱改颗数，凑近数一数。' }),
};

describe('LevelSession 集市 → 基地闭环', () => {
  it('初始化额度：10 议价 / 5 询问', () => {
    const session = new LevelSession(level, player());
    expect(session.offerQuota).toBe(10);
    expect(session.fairyQuota).toBe(5);
    expect(session.availableFunds).toBe(1000);
    expect(session.phase).toBe('market');
  });

  it('问精灵：扣一次额度并记录；超长问题不扣次数', async () => {
    const session = new LevelSession(level, player());
    const first = await session.ask(echoClient, '这世界的人偏爱什么？');
    expect(first.answer.blocked).toBe(false);
    expect(session.state.askUsed).toBe(1);
    expect(session.state.fairyLog).toHaveLength(1);

    const tooLong = await session.ask(echoClient, '问'.repeat(60));
    expect(tooLong.answer.blocked).toBe(true);
    expect(session.state.askUsed).toBe(1);
  });

  it('议价：低于底价必拒且消耗额度；按标价成交', async () => {
    const session = new LevelSession(level, player());
    const low = await session.submitOffer('T1', 100, 'local', null);
    expect(low.accept).toBe(false);
    expect(low.code).toBe('below-floor');
    expect(session.state.offersUsed).toBe(1);

    const done = await session.submitOffer('T1', 480, 'local', null);
    expect(done.accept).toBe(true);
    expect(session.itemOf('T1')).toMatchObject({ status: 'purchased', purchasePrice: 480 });
    expect(session.state.offersUsed).toBe(2);
    expect(session.availableFunds).toBe(520);
    expect(session.endCheck().end).toBe(false);
  });

  it('第 4 次被拒后流拍，不能再议价', async () => {
    const session = new LevelSession(level, player());
    for (let round = 0; round < 4; round += 1) {
      await session.submitOffer('T5', 230, 'local', null);
    }
    expect(session.itemOf('T5')?.status).toBe('passed');
    const blocked = await session.submitOffer('T5', 240, 'local', null);
    expect(blocked.code).toBe('round-cap');
  });

  it('收摊 → 结算：资金、经验、等级按公式落地', async () => {
    const session = new LevelSession(level, player());
    await session.submitOffer('T1', 480, 'local', null);
    session.closeMarket();
    expect(session.phase).toBe('base');

    const settlement = session.settle([{ itemId: 'T1', recycle: true }]);
    expect(settlement.spent).toBe(480);
    expect(settlement.recycle).toBe(780);
    expect(settlement.fees).toBe(20);
    expect(settlement.net).toBe(280);
    expect(session.player.funds).toBe(1280);
    expect(session.player.xp).toBe(280);
    expect(session.phase).toBe('settled');
  });

  it('集市结束后不能再问精灵', async () => {
    const session = new LevelSession(level, player());
    session.closeMarket();
    const answer = await session.ask(echoClient, '还能问吗？');
    expect(answer.answer.blocked).toBe(true);
    expect(session.state.askUsed).toBe(0);
  });
});
