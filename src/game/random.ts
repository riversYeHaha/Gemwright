/** 可注入的随机源：测试里用固定种子，线上用 Math.random。 */
export type RandomFn = () => number;

/** mulberry32：小而稳的可复现伪随机数，用于关卡归一化中的确定性打乱。 */
export function mulberry32(seed: number): RandomFn {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne<T>(items: readonly T[], rng: RandomFn = Math.random): T {
  if (items.length === 0) throw new Error('pickOne: 空集合');
  const item = items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
  if (item === undefined) throw new Error('pickOne: 索引越界');
  return item;
}

export function randomInt(min: number, max: number, rng: RandomFn = Math.random): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function shuffle<T>(items: readonly T[], rng: RandomFn = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}
