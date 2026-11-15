import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/game/random';
import {
  LevelSchemaError,
  applyTamperOps,
  collectTamperTypes,
  diffTraits,
  normalizeLevel,
} from '../src/game/validate';
import type { NormalizeInput } from '../src/game/validate';
import { makeRawLevel } from './fixtures/rawLevel';

function input(overrides: Partial<NormalizeInput> = {}): NormalizeInput {
  return {
    difficulty: 1,
    funds: 1000,
    seedId: 'S01',
    seedGenre: '熔岩锻造城邦',
    priceIndexRange: [1.25, 1.6],
    now: 1_700_000_000_000,
    rng: mulberry32(42),
    ...overrides,
  };
}

describe('normalizeLevel', () => {
  it('程序推导真伪：tamperOp 决定 isAuthentic，并改写实际特征', () => {
    const { level } = normalizeLevel(makeRawLevel(), input({ difficulty: 2 }));
    const t2 = level.stalls.find((stall) => stall.itemId === 'T2');
    const t1 = level.stalls.find((stall) => stall.itemId === 'T1');
    expect(t1?.item.isAuthentic).toBe(true);
    expect(t1?.item.tamperOps).toHaveLength(0);
    expect(t2?.item.isAuthentic).toBe(false);
    expect(t2?.item.traits.gemCount).toBe(6);
    expect(t2?.item.traits.color).toBe('青蓝');
    expect(diffTraits({ ...t2!.item.traits, gemCount: 7 }, t2!.item.traits)).toEqual([
      { field: 'gemCount', label: '计数', expected: '7', actual: '6' },
    ]);
  });

  it('把 LLM 提供的越界价格 clamp 进数值表', () => {
    const { level } = normalizeLevel(makeRawLevel(), input({ funds: 1000 }));
    const total = level.stalls.reduce((sum, stall) => sum + stall.economy.salePrice, 0);
    expect(total).toBeGreaterThanOrEqual(1450);
    expect(total).toBeLessThanOrEqual(2250);
    for (const stall of level.stalls) {
      expect(stall.economy.salePrice).toBeLessThanOrEqual(900);
      const ratio = stall.economy.bottomPrice / stall.economy.salePrice;
      expect(ratio).toBeGreaterThanOrEqual(0.54);
      expect(ratio).toBeLessThanOrEqual(0.76);
      expect(stall.economy.flexibility).toBeGreaterThanOrEqual(0);
      expect(stall.economy.flexibility).toBeLessThanOrEqual(1);
      const creator = level.creators.find((entry) => entry.id === stall.creatorId)!;
      expect(stall.economy.trueValue).toBeGreaterThanOrEqual(creator.quoteRange[0]);
      expect(stall.economy.trueValue).toBeLessThanOrEqual(creator.quoteRange[1]);
      expect(Number.isInteger(stall.economy.salePrice)).toBe(true);
    }
  });

  it('物价指数落在种子区间内', () => {
    const raw = makeRawLevel() as { world: { priceIndex: number } };
    raw.world.priceIndex = 0.5;
    const { level } = normalizeLevel(raw, input({ priceIndexRange: [1.25, 1.6] }));
    expect(level.world.priceIndex).toBe(1.25);
  });

  it('难度 1：真品 3 件，仿品各带 2 枚显性算子', () => {
    const { level } = normalizeLevel(makeRawLevel({ allAuthentic: true }), input({ difficulty: 1 }));
    const authentic = level.stalls.filter((stall) => stall.item.isAuthentic);
    const fakes = level.stalls.filter((stall) => !stall.item.isAuthentic);
    expect(authentic).toHaveLength(3);
    expect(fakes).toHaveLength(2);
    for (const fake of fakes) {
      expect(fake.item.tamperOps).toHaveLength(2);
      const types = fake.item.tamperOps.map((op) => op.type);
      expect(types).toContain('color_swap');
      expect(types).toContain('count_change');
      expect(diffTraits(
        level.creators.find((entry) => entry.id === fake.creatorId)!.signatureTraits,
        fake.item.traits,
      ).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('难度 2：真品 2 件，仿品只留 1 枚中等算子', () => {
    const { level } = normalizeLevel(makeRawLevel(), input({ difficulty: 2 }));
    expect(level.stalls.filter((stall) => stall.item.isAuthentic)).toHaveLength(2);
    for (const fake of level.stalls.filter((stall) => !stall.item.isAuthentic)) {
      expect(fake.item.tamperOps).toHaveLength(1);
      expect(['count_change', 'base_flip']).toContain(fake.item.tamperOps[0]!.type);
    }
  });

  it('难度 3+：真品 1 件，仿品只用 ±1 的改颗数', () => {
    const { level } = normalizeLevel(makeRawLevel(), input({ difficulty: 4 }));
    expect(level.stalls.filter((stall) => stall.item.isAuthentic)).toHaveLength(1);
    for (const fake of level.stalls.filter((stall) => !stall.item.isAuthentic)) {
      expect(fake.item.tamperOps).toHaveLength(1);
      expect(fake.item.tamperOps[0]!.type).toBe('count_change');
      expect(Math.abs(fake.item.tamperOps[0]!.delta ?? 0)).toBe(1);
      expect(fake.item.traits.gemCount).not.toBe(
        level.creators.find((entry) => entry.id === fake.creatorId)!.signatureTraits.gemCount,
      );
    }
    expect(collectTamperTypes(level)).toEqual(['count_change']);
  });

  it('tamperOp 字段与类型不匹配时按类型修正，并给出 warning', () => {
    const { level, warnings } = normalizeLevel(makeRawLevel({ tamperFieldMismatch: true }), input());
    const t2 = level.stalls.find((stall) => stall.itemId === 'T2')!;
    expect(t2.item.tamperOps[0]!.field).toBe('gemCount');
    expect(t2.item.traits.gemCount).toBe(6);
    expect(warnings.some((line) => line.includes('字段与类型不匹配'))).toBe(true);
  });

  it('JSON 缺字段时抛 LevelSchemaError（生成层据此定向重试）', () => {
    expect(() => normalizeLevel({}, input())).toThrow(LevelSchemaError);
  });
});

describe('applyTamperOps', () => {
  it('顺序应用多枚算子', () => {
    const spec = { color: '青蓝', gemCount: 7, shape: '八面体', hasBase: true };
    const actual = applyTamperOps(spec, [
      { type: 'color_swap', field: 'color', to: '赤金' },
      { type: 'count_change', field: 'gemCount', delta: -1 },
      { type: 'base_flip', field: 'hasBase' },
    ]);
    expect(actual).toEqual({ color: '赤金', gemCount: 6, shape: '八面体', hasBase: false });
    expect(diffTraits(spec, actual)).toHaveLength(3);
  });
});
