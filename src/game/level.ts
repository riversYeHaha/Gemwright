import type { ChatClient } from '../api/types';
import { MAX_ROUNDS_PER_ITEM } from '../config/constants';
import type {
  BargainDecision,
  BargainMode,
  FairyAnswer,
  ItemRuntime,
  LevelJson,
  LevelPhase,
  LevelRuntime,
  PlayerState,
  RecyclePlan,
  Settlement,
  Stall,
} from '../types/level';
import { checkOffer, commitOffer, decideOffer, nextRound } from './bargain';
import {
  applySettlement,
  checkMarketEnd,
  fairyQuota,
  offerQuota,
  remainingFunds,
  settleLevel,
  type MarketEndCheck,
} from './economy';
import { askFairy, buildFairyContext, sanitizeQuestion } from './fairy';

/**
 * 关卡状态机（方案 §三）：集市（开市→验货→问精灵→议价→收摊）→ 基地（鉴宝→回收→结算）。
 * 这里是唯一允许改资金 / 额度 / 购买记录的地方；UI 只读它、调它。
 */
export class LevelSession {
  readonly level: LevelJson;
  player: PlayerState;
  readonly startedAt: number;
  private readonly runtime: LevelRuntime;

  constructor(level: LevelJson, player: PlayerState, startedAt = Date.now()) {
    this.level = level;
    this.player = player;
    this.startedAt = startedAt;
    this.runtime = {
      levelId: level.id,
      difficulty: level.difficulty,
      phase: 'market',
      items: Object.fromEntries(
        level.stalls.map((stall) => [
          stall.itemId,
          {
            itemId: stall.itemId,
            status: 'listed' as const,
            offers: [],
            rejectedPrices: [],
          },
        ]),
      ),
      offersUsed: 0,
      askUsed: 0,
      fairyLog: [],
      startedAt,
    };
  }

  get state(): Readonly<LevelRuntime> {
    return this.runtime;
  }

  get phase(): LevelPhase {
    return this.runtime.phase;
  }

  get offerQuota(): number {
    return offerQuota(this.player.level);
  }

  get fairyQuota(): number {
    return fairyQuota(this.player.level);
  }

  get availableFunds(): number {
    return remainingFunds(this.player, this.runtime);
  }

  get stalls(): Stall[] {
    return this.level.stalls;
  }

  stallOf(itemId: string): Stall | undefined {
    return this.level.stalls.find((stall) => stall.itemId === itemId);
  }

  itemOf(itemId: string): ItemRuntime | undefined {
    return this.runtime.items[itemId];
  }

  /** 本关最低底价（结束条件 / 预算判断用）。 */
  get minBottomPrice(): number {
    return this.level.stalls.reduce(
      (min, stall) => Math.min(min, stall.economy.bottomPrice),
      Number.POSITIVE_INFINITY,
    );
  }

  endCheck(): MarketEndCheck {
    return checkMarketEnd(this.runtime, this.player, this.level);
  }

  /**
   * 提交一次报价：结构校验 → 消耗 1 点额度 → 判定（LLM / 本地）→ 记账。
   * LLM 调用失败会退回本地公式，游戏不会卡住。
   */
  async submitOffer(
    itemId: string,
    offer: number,
    mode: BargainMode,
    client: ChatClient | null,
    signal?: AbortSignal,
  ): Promise<BargainDecision> {
    if (this.runtime.phase !== 'market') {
      return { accept: false, line: '已经收摊了。', source: 'rules', code: 'invalid-offer' };
    }
    const stall = this.stallOf(itemId);
    const item = this.runtime.items[itemId];
    if (!stall || !item) {
      return { accept: false, line: '摊位上没有这件货。', source: 'rules', code: 'invalid-offer' };
    }

    const ctx = {
      stall,
      offer,
      offersUsed: this.runtime.offersUsed,
      quota: this.offerQuota,
      availableFunds: this.availableFunds,
      item,
      mode,
    };
    const checked = checkOffer(ctx);
    if (!checked.ok) {
      return { accept: false, line: checked.message, source: 'rules', code: checked.code };
    }

    this.runtime.offersUsed += 1;
    const decision = await decideOffer(client, ctx, signal);
    this.runtime.items[itemId] = commitOffer(item, decision, offer);
    return decision;
  }

  /** 问精灵：仅集市阶段、消耗额度；无效问题不扣次数。 */
  async ask(
    client: ChatClient,
    question: string,
  ): Promise<{ answer: FairyAnswer; remaining: number }> {
    if (this.runtime.phase !== 'market') {
      return {
        answer: { answer: '回基地真相就揭晓了，还用问我？', blocked: true },
        remaining: this.fairyQuota - this.runtime.askUsed,
      };
    }
    if (this.runtime.askUsed >= this.fairyQuota) {
      return {
        answer: { answer: '今天的嘴皮子用完了，剩下的路你自己看。', blocked: true },
        remaining: 0,
      };
    }
    const checked = sanitizeQuestion(question);
    if (!checked.ok) {
      return {
        answer: { answer: checked.error, blocked: true },
        remaining: this.fairyQuota - this.runtime.askUsed,
      };
    }

    const answer = await askFairy(client, buildFairyContext(this.level), checked.value);
    this.runtime.askUsed += 1;
    this.runtime.fairyLog.push({
      question: checked.value,
      answer: answer.answer,
      blocked: answer.blocked,
      at: Date.now(),
    });
    return { answer, remaining: this.fairyQuota - this.runtime.askUsed };
  }

  /** 主动收摊 / 自动结束：进入基地阶段。 */
  closeMarket(): void {
    if (this.runtime.phase === 'market') this.runtime.phase = 'base';
  }

  /** 结算预览（不落地）。 */
  previewSettlement(plan?: RecyclePlan[]): Settlement {
    return settleLevel(this.runtime, this.player, this.level, plan);
  }

  /** 结算落地：更新资金 / 经验 / 等级，写回 runtime.settlement。 */
  settle(plan?: RecyclePlan[]): Settlement {
    const settlement = this.previewSettlement(plan);
    this.runtime.settlement = settlement;
    this.player = applySettlement(this.player, settlement);
    this.runtime.phase = 'settled';
    return settlement;
  }

  /** 是否还有可议价的货（UI 用来灰掉按钮）。 */
  hasNegotiableItem(): boolean {
    return this.level.stalls.some((stall) => {
      const item = this.runtime.items[stall.itemId];
      return (
        item !== undefined &&
        item.status === 'listed' &&
        nextRound(item) <= MAX_ROUNDS_PER_ITEM &&
        stall.economy.bottomPrice <= this.availableFunds
      );
    });
  }
}
