/**
 * 经济与规则常量（对应方案 §六 经济数值表）。
 * 只放"会变的数值"，玩法相关的推导逻辑在 game/economy.ts。
 */

export const START_FUNDS = 1000;

/** 每关珍宝数；砍刀线可降到 3。 */
export const ITEMS_PER_LEVEL = 5;
export const FALLBACK_ITEMS_PER_LEVEL = 3;

/** 回收手续费（星际币/件，只对选择回收者收）。 */
export const RECYCLE_FEE = 20;
/** 仿品回收价 = 标价 × 该比例（工艺残值）。 */
export const FAKE_RECYCLE_RATIO = 0.1;

/** 经验：净收益即经验（负收益不扣级）；每 800 经验升 1 级。 */
export const XP_PER_LEVEL = 800;

/** 议价额度：初始 10 点/关，每级 +5。 */
export const OFFER_QUOTA_BASE = 10;
export const OFFER_QUOTA_PER_LEVEL = 5;
/** 单件最多 4 回合，末回合拒绝即流拍。 */
export const MAX_ROUNDS_PER_ITEM = 4;

/** 询问额度：初始 5 次/关，每级 +2。 */
export const FAIRY_QUOTA_BASE = 5;
export const FAIRY_QUOTA_PER_LEVEL = 2;
/** 问题 ≤50 字 / 回答 ≤100 字（按 Unicode 码点计）。 */
export const QUESTION_MAX_CHARS = 50;
export const ANSWER_MAX_CHARS = 100;

/** 物价指数区间：世界级，只作用于标价 / 底价。 */
export const PRICE_INDEX_MIN = 0.8;
export const PRICE_INDEX_MAX = 1.6;

/** Σ标价 ∈ [1.5, 2.2] × 玩家资金（物价指数施加后仍强制）。 */
export const TOTAL_SALE_MIN_RATIO = 1.5;
export const TOTAL_SALE_MAX_RATIO = 2.2;
/** 单件标价 ≤ 资金 × 0.9，避免出现谁也买不起的死局。 */
export const SINGLE_SALE_MAX_RATIO = 0.9;

/** 底价 ∈ [0.55, 0.75] × 标价。 */
export const BOTTOM_PRICE_MIN_RATIO = 0.55;
export const BOTTOM_PRICE_MAX_RATIO = 0.75;

/** Lux3D：G1-Turbo 单件 13 积分，一关 5 件 ≈ 65 积分。 */
export const LUX3D_CREDITS_PER_ITEM = 13;
export const LUX3D_FACE_COUNT = 100_000;
export const LUX3D_VERSION = 'G1-Turbo' as const;
export const LUX3D_POLL_INTERVAL_MS = 3000;
export const LUX3D_TASK_TIMEOUT_MS = 300_000;

/** DeepSeek：关卡生成重试 2 次（共 3 次机会）；精灵回答 max_tokens 200。 */
export const LEVEL_GENERATION_MAX_ATTEMPTS = 3;
export const FAIRY_MAX_TOKENS = 200;

/** 色族 / 形制白名单：特征与 renderPrompt 共用的词汇表。 */
export const COLOR_FAMILIES = ['青蓝', '赤金', '墨黑', '霜白', '紫晶', '苔绿'] as const;
export const SHAPE_FAMILIES = ['八面体', '三棱锥', '六棱柱', '莲座', '螺旋', '月牙'] as const;
export const GEM_COUNT_MIN = 1;
export const GEM_COUNT_MAX = 9;

/** 每关真品数目标：L1 3 件，L2~L3 2 件，L4+ 1 件（随难度递减）。 */
export function targetAuthenticCount(difficulty: number): number {
  if (difficulty <= 1) return 3;
  if (difficulty <= 3) return 2;
  return 1;
}
