import { z } from 'zod';
import {
  BOTTOM_PRICE_MAX_RATIO,
  BOTTOM_PRICE_MIN_RATIO,
  COLOR_FAMILIES,
  GEM_COUNT_MAX,
  GEM_COUNT_MIN,
  ITEMS_PER_LEVEL,
  PRICE_INDEX_MAX,
  PRICE_INDEX_MIN,
  SHAPE_FAMILIES,
  SINGLE_SALE_MAX_RATIO,
  TOTAL_SALE_MAX_RATIO,
  TOTAL_SALE_MIN_RATIO,
  targetAuthenticCount,
} from '../config/constants';
import type {
  CreatorProfile,
  FairyProfile,
  ItemEconomy,
  LevelJson,
  Stall,
  TamperOp,
  TamperType,
  TraitDiff,
  TraitField,
  Traits,
  WorldInfo,
} from '../types/level';
import { FAIRY_PERSONA_POOL } from '../types/level';
import { pickOne, randomInt, shuffle, type RandomFn } from './random';

/**
 * 关卡归一化（方案 §二 M9 / §五 关键工程决策）。
 *
 * LLM 只负责"讲故事 + 给素材"，以下字段由本地代码覆写：
 * - `item.traits` ← `creator.signatureTraits` + `tamperOps`
 * - `item.isAuthentic` ⇔ `tamperOps.length === 0`
 * - 价格 clamp 到数值表约束内（含物价指数与资金预算）
 * 这样玩家看到的 3D 特征、判定 diff、回收价永远自洽，且 LLM 事后无法"翻供"。
 */

export const TAMPER_TYPE_LABELS: Record<TamperType, string> = {
  color_swap: '换色',
  count_change: '改颗数',
  shape_change: '换形制',
  base_flip: '动底座',
};

export const TRAIT_FIELD_LABELS: Record<TraitField, string> = {
  color: '色族',
  gemCount: '计数',
  shape: '形制',
  hasBase: '底座',
};

const REPUTATION_TIERS = ['无名匠', '名家', '宗师'] as const;
const SAVVINESS_LEVELS = ['外行', '半懂', '懂行'] as const;
const TAMPER_TYPES = ['color_swap', 'count_change', 'shape_change', 'base_flip'] as const;
const TRAIT_FIELDS = ['color', 'gemCount', 'shape', 'hasBase'] as const;

const traitsSchema = z.object({
  color: z.string().trim().min(1).max(16),
  gemCount: z.number().int().min(GEM_COUNT_MIN).max(GEM_COUNT_MAX),
  shape: z.string().trim().min(1).max(16),
  hasBase: z.boolean(),
});

const tamperOpItemSchema = z.object({
  type: z.enum(TAMPER_TYPES),
  field: z.enum(TRAIT_FIELDS),
  delta: z.number().int().min(-3).max(3).optional(),
  to: z.union([z.string().max(16), z.boolean()]).optional(),
});

/** 协议里单枚算子与算子数组都接受：L1 的"两个显性算子"用数组表达。 */
const tamperOpSchema = z
  .union([tamperOpItemSchema, z.array(tamperOpItemSchema).max(3)])
  .nullable()
  .optional();

const rawWorldSchema = z.object({
  name: z.string().trim().min(1).max(24),
  genreSeed: z.string().trim().max(24).optional(),
  lore: z.string().trim().min(40).max(800),
  residentPref: z.string().trim().min(1).max(120),
  priceIndex: z.number().min(0.5).max(2),
  currencyName: z.string().trim().min(1).max(12),
});

const rawFairySchema = z.object({
  name: z.string().trim().min(1).max(12),
  persona: z.enum(FAIRY_PERSONA_POOL),
  briefing: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
});

const rawCreatorSchema = z.object({
  id: z.string().trim().max(12).optional(),
  name: z.string().trim().min(1).max(24),
  background: z.string().trim().min(1).max(160),
  reputationTier: z.enum(REPUTATION_TIERS),
  quoteRange: z.tuple([z.number(), z.number()]),
  signatureTraits: traitsSchema,
});

const rawStallSchema = z.object({
  itemId: z.string().trim().max(12).optional(),
  creatorId: z.string().trim().max(12),
  stallOwner: z.object({
    name: z.string().trim().min(1).max(24),
    persona: z.string().trim().min(1).max(40),
    savviness: z.enum(SAVVINESS_LEVELS),
  }),
  item: z.object({
    name: z.string().trim().min(1).max(24),
    pitch: z.string().trim().min(1).max(120),
    traits: traitsSchema.optional(),
    tamperOp: tamperOpSchema,
  }),
  economy: z.object({
    salePrice: z.number().positive(),
    bottomPrice: z.number().positive(),
    flexibility: z.number(),
    trueValue: z.number().positive(),
  }),
});

const rawLevelSchema = z.object({
  world: rawWorldSchema,
  fairy: rawFairySchema,
  creators: z.array(rawCreatorSchema).min(1).max(4),
  stalls: z.array(rawStallSchema).min(3).max(ITEMS_PER_LEVEL),
});

export class LevelSchemaError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`关卡 JSON 不符合协议：${issues.slice(0, 6).join('；')}`);
    this.name = 'LevelSchemaError';
    this.issues = issues;
  }
}

export interface NormalizeInput {
  difficulty: number;
  /** 玩家当前资金：用于 Σ标价 / 单件标价上限约束。 */
  funds: number;
  seedId: string;
  seedGenre: string;
  priceIndexRange: [number, number];
  levelId?: string;
  now?: number;
  rng?: RandomFn;
}

export interface NormalizeResult {
  level: LevelJson;
  warnings: string[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const roundPrice = (value: number): number => Math.max(1, Math.round(value / 10) * 10);

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/** 特征规范化：计数取整、色族/形制保留文本、底座布尔。 */
export function normalizeTraits(traits: Traits): Traits {
  return {
    color: traits.color.trim(),
    gemCount: clamp(Math.round(traits.gemCount), GEM_COUNT_MIN, 7),
    shape: traits.shape.trim(),
    hasBase: Boolean(traits.hasBase),
  };
}

function nextDifferent(pool: readonly string[], current: string): string {
  const normalized = current.trim();
  const candidate = pool.find((entry) => entry !== normalized);
  return candidate ?? pool[0] ?? normalized;
}

/** 顺序应用多枚算子（L1 可能同时换色又改颗数）。 */
export function applyTamperOps(spec: Traits, ops: TamperOp[]): Traits {
  return ops.reduce<Traits>((traits, op) => applyTamperOp(traits, op), { ...spec });
}

/** 应用单枚混淆算子，得到"实际特征"。同值会被自动修正，保证仿品一定可见差异。 */
export function applyTamperOp(spec: Traits, op: TamperOp | null): Traits {
  const base: Traits = { ...spec };
  if (!op) return base;

  switch (op.type) {
    case 'color_swap': {
      const target = typeof op.to === 'string' ? op.to.trim() : '';
      base.color =
        target && target !== spec.color ? target : nextDifferent(COLOR_FAMILIES, spec.color);
      break;
    }
    case 'count_change': {
      let delta = op.delta ?? 1;
      if (delta === 0) delta = 1;
      let next = spec.gemCount + delta;
      if (next === spec.gemCount) next = spec.gemCount + 1;
      if (next > 9) next = spec.gemCount - Math.abs(delta || 1);
      if (next < 1) next = spec.gemCount + Math.abs(delta || 1);
      base.gemCount = clamp(next, GEM_COUNT_MIN, GEM_COUNT_MAX);
      break;
    }
    case 'shape_change': {
      const target = typeof op.to === 'string' ? op.to.trim() : '';
      base.shape =
        target && target !== spec.shape ? target : nextDifferent(SHAPE_FAMILIES, spec.shape);
      break;
    }
    case 'base_flip': {
      base.hasBase = !spec.hasBase;
      break;
    }
  }
  return base;
}

function sameTraits(a: Traits, b: Traits): boolean {
  return (
    a.color === b.color &&
    a.gemCount === b.gemCount &&
    a.shape === b.shape &&
    a.hasBase === b.hasBase
  );
}

/** 特征 diff：鉴宝揭晓页的"实际 vs 真品规范"对账，也是判定铁律的可视化。 */
export function diffTraits(spec: Traits, actual: Traits): TraitDiff[] {
  const diffs: TraitDiff[] = [];
  if (spec.color !== actual.color) {
    diffs.push({ field: 'color', label: '色族', expected: spec.color, actual: actual.color });
  }
  if (spec.gemCount !== actual.gemCount) {
    diffs.push({
      field: 'gemCount',
      label: '计数',
      expected: String(spec.gemCount),
      actual: String(actual.gemCount),
    });
  }
  if (spec.shape !== actual.shape) {
    diffs.push({ field: 'shape', label: '形制', expected: spec.shape, actual: actual.shape });
  }
  if (spec.hasBase !== actual.hasBase) {
    diffs.push({
      field: 'hasBase',
      label: '底座',
      expected: spec.hasBase ? '有底座' : '无底座',
      actual: actual.hasBase ? '有底座' : '无底座',
    });
  }
  return diffs;
}

/** 算子白名单：难度越低，仿得越显眼。 */
export function tamperPolicy(difficulty: number): TamperType[][] {
  if (difficulty <= 1) {
    return [['color_swap', 'count_change']];
  }
  if (difficulty <= 2) {
    return [['count_change', 'base_flip']];
  }
  return [['count_change']];
}

function sanitizeTamperOp(op: TamperOp, spec: Traits): TamperOp {
  switch (op.type) {
    case 'count_change': {
      const delta = op.delta && op.delta !== 0 ? clamp(op.delta, -3, 3) : 1;
      const next = applyTamperOp(spec, { type: 'count_change', field: 'gemCount', delta });
      return {
        type: 'count_change',
        field: 'gemCount',
        delta: next.gemCount - spec.gemCount,
      };
    }
    case 'color_swap':
      return {
        type: 'color_swap',
        field: 'color',
        to:
          typeof op.to === 'string' && op.to.trim()
            ? op.to.trim()
            : nextDifferent(COLOR_FAMILIES, spec.color),
      };
    case 'shape_change':
      return {
        type: 'shape_change',
        field: 'shape',
        to:
          typeof op.to === 'string' && op.to.trim()
            ? op.to.trim()
            : nextDifferent(SHAPE_FAMILIES, spec.shape),
      };
    case 'base_flip':
      return { type: 'base_flip', field: 'hasBase' };
  }
}

function buildTamperOp(type: TamperType, spec: Traits, rng: RandomFn): TamperOp {
  switch (type) {
    case 'color_swap':
      return { type, field: 'color', to: pickOne(COLOR_FAMILIES, rng) };
    case 'shape_change':
      return { type, field: 'shape', to: pickOne(SHAPE_FAMILIES, rng) };
    case 'base_flip':
      return { type, field: 'hasBase' };
    case 'count_change': {
      const delta = pickOne([-1, 1], rng) * randomInt(1, 2, rng);
      const op: TamperOp = { type, field: 'gemCount', delta };
      return sanitizeTamperOp(op, spec);
    }
  }
}

/** 按难度把 LLM 给的算子整形成白名单允许的形态（L1 保证 2 个显性算子）。 */
export function conformTamperOps(
  difficulty: number,
  ops: TamperOp[],
  spec: Traits,
  rng: RandomFn = Math.random,
): TamperOp[] {
  const sanitized = ops.map((op) => sanitizeTamperOp(op, spec));
  if (difficulty <= 1) {
    const result = sanitized.slice(0, 2);
    const types = new Set(result.map((op) => op.type));
    if (!types.has('color_swap')) {
      result.push(buildTamperOp('color_swap', spec, rng));
      types.add('color_swap');
    }
    if (!types.has('count_change')) {
      result.push(buildTamperOp('count_change', spec, rng));
    }
    return result.slice(0, 2);
  }

  const allowed = tamperPolicy(difficulty)[0] ?? ['count_change'];
  const kept = sanitized.find((op) => allowed.includes(op.type));
  if (kept) {
    if (difficulty >= 3 && kept.type === 'count_change') {
      const delta = Math.sign(kept.delta ?? 1) || 1;
      return [sanitizeTamperOp({ type: 'count_change', field: 'gemCount', delta }, spec)];
    }
    return [kept];
  }
  return [buildTamperOp(pickOne(allowed, rng), spec, rng)];
}

function normalizeEconomy(
  raw: { salePrice: number; bottomPrice: number; flexibility: number; trueValue: number },
  creator: CreatorProfile,
): ItemEconomy {
  const [lo, hi] = creator.quoteRange;
  const salePrice = Math.max(1, raw.salePrice);
  const ratio = raw.bottomPrice / salePrice;
  const bottomRatio = clamp(
    Number.isFinite(ratio) ? ratio : 0.65,
    BOTTOM_PRICE_MIN_RATIO,
    BOTTOM_PRICE_MAX_RATIO,
  );
  return {
    salePrice,
    bottomPrice: Math.max(1, Math.round(salePrice * bottomRatio)),
    flexibility: clamp(Number.isFinite(raw.flexibility) ? raw.flexibility : 0.5, 0, 1),
    trueValue: Math.round(clamp(raw.trueValue, lo, hi)),
  };
}

/**
 * 预算重平衡：Σ标价 ∈ [1.5, 2.2] × 资金，单件 ≤ 资金 × 0.9。
 * LLM 的原始比例尽量保留，只做整体缩放与封顶。
 */
function rebalancePrices(stalls: Stall[], funds: number): { saleTotal: number; adjusted: boolean } {
  const budget = Math.max(1, funds);
  const minTotal = TOTAL_SALE_MIN_RATIO * budget;
  const maxTotal = TOTAL_SALE_MAX_RATIO * budget;
  const cap = SINGLE_SALE_MAX_RATIO * budget;
  let adjusted = false;

  const saleOf = (stall: Stall): number => stall.economy.salePrice;
  let total = stalls.reduce((sum, stall) => sum + saleOf(stall), 0);

  const scaleTo = (target: number): void => {
    if (total <= 0) return;
    const factor = target / total;
    for (const stall of stalls) {
      const sale = clamp(roundPrice(stall.economy.salePrice * factor), 30, cap);
      stall.economy.salePrice = sale;
    }
    total = stalls.reduce((sum, stall) => sum + saleOf(stall), 0);
  };

  if (total < minTotal) {
    scaleTo(minTotal);
    adjusted = true;
  } else if (total > maxTotal) {
    scaleTo(maxTotal);
    adjusted = true;
  }

  // 封顶后仍可能偏离区间：按剩余余量做一次均匀摊派。
  if (total < minTotal) {
    const headroom = stalls.reduce((sum, stall) => sum + Math.max(0, cap - saleOf(stall)), 0);
    if (headroom > 0) {
      const need = Math.min(minTotal - total, headroom);
      for (const stall of stalls) {
        const room = Math.max(0, cap - saleOf(stall));
        if (room <= 0) continue;
        stall.economy.salePrice = roundPrice(saleOf(stall) + (need * room) / headroom);
        adjusted = true;
      }
    }
  }

  for (const stall of stalls) {
    stall.economy.salePrice = Math.max(30, Math.min(cap, stall.economy.salePrice));
    const ratio = clamp(
      stall.economy.bottomPrice / Math.max(1, stall.economy.salePrice),
      BOTTOM_PRICE_MIN_RATIO,
      BOTTOM_PRICE_MAX_RATIO,
    );
    stall.economy.bottomPrice = Math.max(1, Math.round(stall.economy.salePrice * ratio));
  }

  return { saleTotal: stalls.reduce((sum, stall) => sum + saleOf(stall), 0), adjusted };
}

function normalizeCreators(
  raw: z.infer<typeof rawCreatorSchema>[],
  warnings: string[],
): CreatorProfile[] {
  const usedIds = new Set<string>();
  return raw.slice(0, 3).map((creator, index) => {
    let id = creator.id?.trim().toUpperCase() || `C${index + 1}`;
    while (usedIds.has(id)) id = `${id}X`;
    usedIds.add(id);

    const [rawLo, rawHi] = creator.quoteRange;
    const lo = Math.max(50, Math.round(Math.min(rawLo, rawHi)));
    const hi = Math.max(lo + 100, Math.round(Math.max(rawLo, rawHi)));

    const signature = normalizeTraits(creator.signatureTraits);
    if (creator.signatureTraits.gemCount !== signature.gemCount) {
      warnings.push(`创作人 ${creator.name} 的 gemCount 被规范到 1~7（真品规范只用小数目）`);
    }

    return {
      id,
      name: creator.name,
      background: creator.background,
      reputationTier: creator.reputationTier,
      quoteRange: [lo, hi] as [number, number],
      signatureTraits: signature,
    };
  });
}

/**
 * 关卡归一化主入口。成功返回可直接进游戏的 LevelJson，失败抛 LevelSchemaError（生成层据此定向重试）。
 */
export function normalizeLevel(raw: unknown, input: NormalizeInput): NormalizeResult {
  const parsed = rawLevelSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LevelSchemaError(formatIssues(parsed.error));
  }

  const rng = input.rng ?? Math.random;
  const warnings: string[] = [];
  const data = parsed.data;

  const creators = normalizeCreators(data.creators, warnings);
  if (data.creators.length > 3) {
    warnings.push('创作人超过 3 位，已截断到前 3 位');
  }
  if (creators.length === 0) {
    throw new LevelSchemaError(['creators: 至少需要 1 位创作人']);
  }

  const priceIndex = clamp(
    clamp(data.world.priceIndex, input.priceIndexRange[0], input.priceIndexRange[1]),
    PRICE_INDEX_MIN,
    PRICE_INDEX_MAX,
  );

  const world: WorldInfo = {
    name: data.world.name,
    genreSeed: data.world.genreSeed?.trim() || input.seedGenre,
    lore: data.world.lore,
    residentPref: data.world.residentPref,
    priceIndex: Math.round(priceIndex * 100) / 100,
    currencyName: data.world.currencyName,
  };

  const fairy: FairyProfile = {
    name: data.fairy.name,
    persona: data.fairy.persona,
    briefing: data.fairy.briefing.slice(0, 3).map((line) => line.slice(0, 80)),
  };

  const stalls: Stall[] = [];
  const usedItemIds = new Set<string>();
  const rawStalls = data.stalls.slice(0, ITEMS_PER_LEVEL);

  for (const [index, rawStall] of rawStalls.entries()) {
    const creator =
      creators.find((entry) => entry.id === rawStall.creatorId.trim().toUpperCase()) ?? creators[0];
    if (!creator) continue;
    if (creator.id !== rawStall.creatorId.trim().toUpperCase()) {
      warnings.push(
        `珍宝 ${rawStall.item.name} 的 creatorId 无法解析，已挂到 ${creator.name} 名下`,
      );
    }

    let itemId = rawStall.itemId?.trim().toUpperCase() || `T${index + 1}`;
    while (usedItemIds.has(itemId)) itemId = `${itemId}_${index + 1}`;
    usedItemIds.add(itemId);

    const spec = creator.signatureTraits;
    const rawOps = rawStall.item.tamperOp;
    const opList = rawOps == null ? [] : Array.isArray(rawOps) ? rawOps : [rawOps];
    const providedOps: TamperOp[] = [];
    const expectedField: Record<TamperType, TraitField> = {
      color_swap: 'color',
      count_change: 'gemCount',
      shape_change: 'shape',
      base_flip: 'hasBase',
    };
    for (const op of opList) {
      if (op.field !== expectedField[op.type]) {
        warnings.push(`珍宝 ${rawStall.item.name} 的 tamperOp 字段与类型不匹配，已按类型修正`);
      }
      providedOps.push(
        sanitizeTamperOp(
          {
            type: op.type,
            field: expectedField[op.type],
            ...(op.delta !== undefined ? { delta: op.delta } : {}),
            ...(op.to !== undefined ? { to: op.to } : {}),
          },
          spec,
        ),
      );
    }

    const economy = normalizeEconomy(rawStall.economy, creator);

    if (rawStall.item.traits && !sameTraits(normalizeTraits(rawStall.item.traits), spec)) {
      warnings.push(`珍宝 ${rawStall.item.name} 的 traits 与真品规范不一致，已由程序按算子改写`);
    }

    stalls.push({
      itemId,
      creatorId: creator.id,
      stallOwner: rawStall.stallOwner,
      item: {
        name: rawStall.item.name,
        pitch: rawStall.item.pitch,
        traits: applyTamperOps(spec, providedOps),
        tamperOps: providedOps,
        isAuthentic: providedOps.length === 0,
      },
      economy,
    });

    // 暂存候选算子，供真伪配额调整时复用（L1 需要两个显性算子）。
    stallDraftOps.set(stalls[stalls.length - 1] as Stall, providedOps);
  }

  // 真伪配额：按难度强制"真品数递减"，不满足就用白名单算子造仿品 / 拆算子变真品。
  const targetAuthentic = Math.min(
    stalls.length,
    Math.max(1, targetAuthenticCount(input.difficulty)),
  );
  const authenticIdx = stalls
    .map((stall, index) => ({ stall, index }))
    .filter((entry) => entry.stall.item.isAuthentic)
    .map((entry) => entry.index);

  if (authenticIdx.length > targetAuthentic) {
    const toConvert = shuffle(authenticIdx, rng).slice(0, authenticIdx.length - targetAuthentic);
    for (const index of toConvert) {
      const stall = stalls[index];
      if (!stall) continue;
      const creator = creators.find((entry) => entry.id === stall.creatorId) ?? creators[0];
      if (!creator) continue;
      const spec = creator.signatureTraits;
      const drafts = stallDraftOps.get(stall) ?? [];
      const ops = conformTamperOps(input.difficulty, drafts, spec, rng);
      stall.item.tamperOps = ops;
      stall.item.traits = applyTamperOps(spec, ops);
      stall.item.isAuthentic = ops.length === 0;
    }
  } else if (authenticIdx.length < targetAuthentic) {
    const fakes = stalls
      .map((stall, index) => ({ stall, index }))
      .filter((entry) => !entry.stall.item.isAuthentic)
      .map((entry) => entry.index);
    const toConvert = shuffle(fakes, rng).slice(0, targetAuthentic - authenticIdx.length);
    for (const index of toConvert) {
      const stall = stalls[index];
      if (!stall) continue;
      stall.item.tamperOps = [];
      stall.item.isAuthentic = true;
      const creator = creators.find((entry) => entry.id === stall.creatorId) ?? creators[0];
      if (creator) stall.item.traits = { ...creator.signatureTraits };
    }
  }

  // 难度整形的兜底：确保所有仿品的算子符合白名单形态。
  for (const stall of stalls) {
    if (stall.item.isAuthentic) {
      stall.item.tamperOps = [];
      const creator = creators.find((entry) => entry.id === stall.creatorId);
      if (creator) stall.item.traits = { ...creator.signatureTraits };
      continue;
    }
    const creator = creators.find((entry) => entry.id === stall.creatorId);
    if (!creator) continue;
    const conformed = conformTamperOps(
      input.difficulty,
      stall.item.tamperOps,
      creator.signatureTraits,
      rng,
    );
    stall.item.tamperOps = conformed;
    stall.item.traits = applyTamperOps(creator.signatureTraits, conformed);
    stall.item.isAuthentic = conformed.length === 0;
  }

  if (data.stalls.length > ITEMS_PER_LEVEL) {
    warnings.push(`珍宝数超过 ${ITEMS_PER_LEVEL} 件，已截断`);
  }
  if (stalls.length < data.stalls.length) {
    warnings.push('部分珍宝因数据缺失被丢弃');
  }

  const priceResult = rebalancePrices(stalls, input.funds);
  if (priceResult.adjusted) {
    warnings.push('标价已按预算区间（1.5~2.2 × 资金）重平衡');
  }

  if (!stalls.some((stall) => stall.item.isAuthentic)) {
    warnings.push('本关没有真品，已强制把 1 件改为真品');
    const fallback = stalls[0];
    if (fallback) {
      fallback.item.tamperOps = [];
      fallback.item.isAuthentic = true;
      const creator = creators.find((entry) => entry.id === fallback.creatorId);
      if (creator) fallback.item.traits = { ...creator.signatureTraits };
    }
  }

  const now = input.now ?? Date.now();
  const level: LevelJson = {
    id: input.levelId ?? `${input.seedId}-D${input.difficulty}-${now.toString(36)}`,
    kind: 'generated',
    seedId: input.seedId,
    seedGenre: input.seedGenre,
    difficulty: input.difficulty,
    createdAt: now,
    world,
    fairy,
    creators,
    stalls,
  };
  return { level, warnings };
}

/** 归一化过程中的草稿算子（不进 LevelJson）。 */
const stallDraftOps = new WeakMap<Stall, TamperOp[]>();

/** 供精灵上下文使用：只取本关实际启用的算子类型（类型级，不含单件归属）。 */
export function collectTamperTypes(level: LevelJson): TamperType[] {
  const types = new Set<TamperType>();
  for (const stall of level.stalls) {
    for (const op of stall.item.tamperOps) types.add(op.type);
  }
  return [...types];
}
