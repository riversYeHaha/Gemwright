/**
 * 关卡数据协议（对应 docs/珍宝猎人-方案v8-MVP.md §五）。
 *
 * 命名分两层：
 * - `Raw*`：DeepSeek 返回的原始形状，只用于校验，不直接进游戏。
 * - 其余类型：前端归一化之后的权威数据，真伪、特征、价格全部由本地代码持有。
 */

/** 创作人档位：决定行情区间，也决定玩家对"值多少"的先验。 */
export type ReputationTier = '无名匠' | '名家' | '宗师';

/** 摊主识货程度：外行摊主可能把真品标低价（可推断信号之一）。 */
export type Savviness = '外行' | '半懂' | '懂行';

/** 鉴宝精灵人设池：关卡生成时随机选一个并贯彻语气。 */
export const FAIRY_PERSONA_POOL = ['毒舌学者', '絮叨老灵魂', '傲娇幼龙', '沉默行家'] as const;
export type FairyPersona = (typeof FAIRY_PERSONA_POOL)[number];

/** 特征白名单字段：只用文生 3D 渲染得稳的粗粒度项（色族 / 计数 / 形制 / 有无）。 */
export type TraitField = 'color' | 'gemCount' | 'shape' | 'hasBase';

/** 一件珍宝的可见特征。仿品 = 真品规范被 tamperOp 改写后的实际特征。 */
export interface Traits {
  color: string;
  gemCount: number;
  shape: string;
  hasBase: boolean;
}

/** 混淆算子白名单（MVP 不做 material_swap）。 */
export type TamperType = 'color_swap' | 'count_change' | 'shape_change' | 'base_flip';

export interface TamperOp {
  type: TamperType;
  field: TraitField;
  /** count_change 的增减量（±1 ~ ±3）。 */
  delta?: number;
  /** color_swap / shape_change 的目标值；base_flip 可省略（取反）。 */
  to?: string | boolean;
}

export interface WorldInfo {
  name: string;
  /** 前端传入的世界类型种子，LLM 只填血肉。 */
  genreSeed: string;
  /** 约 200 字世界观，必须包含物价氛围。 */
  lore: string;
  residentPref: string;
  /** 物价指数 [0.8, 1.6]：只作用于标价 / 底价，真实价值锚定普世行情。 */
  priceIndex: number;
  /** 本地货币名，纯风味；所有结算数字统一显示星际币。 */
  currencyName: string;
}

export interface FairyProfile {
  name: string;
  persona: FairyPersona;
  /** 开场三行简报：物价氛围 / 创作人速览 / 盛行做伪手法。 */
  briefing: string[];
}

export interface CreatorProfile {
  id: string;
  name: string;
  background: string;
  reputationTier: ReputationTier;
  /** 行情区间（星际币，普世锚，不乘物价指数）。 */
  quoteRange: [number, number];
  /** 真品规范 = 玩家唯一的合法判定依据。 */
  signatureTraits: Traits;
}

export interface StallOwner {
  name: string;
  persona: string;
  savviness: Savviness;
}

export interface TreasureItem {
  name: string;
  /** 摊主吆喝：可能吹嘘，不构成判定依据。 */
  pitch: string;
  /** 实际特征：由 signatureTraits + tamperOps 程序推导，不信 LLM 自述。 */
  traits: Traits;
  /** 仿品使用的混淆算子（L1 两枚显性算子，L2+ 一枚）；真品为空数组。 */
  tamperOps: TamperOp[];
  /** 程序覆写：`tamperOps.length === 0 ⇔ isAuthentic === true`。 */
  isAuthentic: boolean;
}

export interface ItemEconomy {
  /** 标价（已含物价指数，星际币计）。 */
  salePrice: number;
  /** 摊主底价：低于此价必拒，前端持锁。 */
  bottomPrice: number;
  /** 议价弹性 0~1。 */
  flexibility: number;
  /** 真实价值：∈ 创作人 quoteRange，不随本地物价膨胀。 */
  trueValue: number;
}

export interface Stall {
  itemId: string;
  creatorId: string;
  stallOwner: StallOwner;
  item: TreasureItem;
  economy: ItemEconomy;
}

export interface LevelJson {
  /** 本地生成：`{seedId}-{difficulty}-{timestamp36}`。 */
  id: string;
  seedId: string;
  seedGenre: string;
  difficulty: number;
  createdAt: number;
  world: WorldInfo;
  fairy: FairyProfile;
  creators: CreatorProfile[];
  stalls: Stall[];
}

/* ------------------------------------------------------------------ */
/* 运行时（一局 / 一关）                                                */
/* ------------------------------------------------------------------ */

export interface PlayerState {
  funds: number;
  xp: number;
  level: number;
}

export interface OfferRecord {
  price: number;
  accepted: boolean;
  /** 第几次报价（1 起），单件上限 4 回合。 */
  round: number;
  source: 'local' | 'llm' | 'rules';
  at: number;
}

export type ItemStatus = 'listed' | 'purchased' | 'passed';

export interface ItemRuntime {
  itemId: string;
  status: ItemStatus;
  purchasePrice?: number;
  offers: OfferRecord[];
  /** 被拒价格，用于"接受价 ≥ 上次拒绝价"的一致性兜底。 */
  rejectedPrices: number[];
}

export interface FairyExchange {
  question: string;
  answer: string;
  blocked: boolean;
  at: number;
}

export type LevelPhase = 'market' | 'base' | 'settled';

export interface LevelRuntime {
  levelId: string;
  difficulty: number;
  phase: LevelPhase;
  items: Record<string, ItemRuntime>;
  /** 议价额度：每关独立，初始 10，每级 +5。 */
  offersUsed: number;
  /** 询问额度：每关独立，初始 5，每级 +2；仅集市阶段可问。 */
  askUsed: number;
  fairyLog: FairyExchange[];
  startedAt: number;
  /** 结算后写入，基地页据此渲染战绩。 */
  settlement?: Settlement;
}

export interface RecyclePlan {
  itemId: string;
  recycle: boolean;
}

export interface Settlement {
  spent: number;
  recycle: number;
  fees: number;
  net: number;
  xpGain: number;
  levelBefore: number;
  levelAfter: number;
  fundsBefore: number;
  fundsAfter: number;
  authenticOwned: number;
  fakeOwned: number;
  /** 逐件明细，基地结算页用。 */
  lines: Array<{
    itemId: string;
    name: string;
    purchased: boolean;
    price: number;
    authentic: boolean;
    recycleValue: number;
    fee: number;
    recycled: boolean;
    trueValue: number;
  }>;
}

/* ------------------------------------------------------------------ */
/* 交互层                                                                */
/* ------------------------------------------------------------------ */

export interface TraitDiff {
  field: TraitField;
  label: string;
  expected: string;
  actual: string;
}

export interface BargainDecision {
  accept: boolean;
  line: string;
  source: 'local' | 'llm' | 'rules';
  /** 报价被拒的硬原因（额度 / 回合 / 资金 / 低于底价）。 */
  code?:
    | 'below-floor'
    | 'no-quota'
    | 'round-cap'
    | 'invalid-offer'
    | 'already-purchased'
    | 'insufficient-funds';
}

export type BargainMode = 'hybrid' | 'local';

export interface FairyAnswer {
  answer: string;
  blocked: boolean;
}

export interface LevelGenerationProgress {
  stage: 'level' | 'models';
  message: string;
  /** 集市布展进度 0~1（5 格进度条）。 */
  ratio: number;
  itemId?: string;
}

export class LevelError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LevelError';
    this.cause = cause;
  }
}
