import type { RandomFn } from './random';

/**
 * 30 条异世界种子库（方案 §二 L12）：
 * 每局抽 1 条作为 `world.genreSeed` 硬参数传给 LLM，防止异世界多样性漂移；
 * 物价指数区间也挂在种子上，避免 LLM 每次都选中庸值。
 */
export interface WorldSeed {
  id: string;
  /** 世界类型（硬参数） */
  genre: string;
  /** 物价指数区间 [lo, hi]，LLM 必须落在其中 */
  priceIndexRange: [number, number];
  /** 一句话气质提示，供 prompt 与 UI 展示 */
  mood: string;
}

export const WORLD_SEEDS: WorldSeed[] = [
  {
    id: 'S01',
    genre: '熔岩锻造城邦',
    priceIndexRange: [1.25, 1.6],
    mood: '铁水昼夜不息，匠人以锻打为荣',
  },
  {
    id: 'S02',
    genre: '浮游晶簇树海',
    priceIndexRange: [0.9, 1.15],
    mood: '晶体长在树上，砍一枝就少一枝',
  },
  {
    id: 'S03',
    genre: '深渊墨市',
    priceIndexRange: [1.0, 1.35],
    mood: '见不得光的东西都在这里换手',
  },
  {
    id: 'S04',
    genre: '蒸汽齿轮港',
    priceIndexRange: [1.1, 1.45],
    mood: '黄铜管道爬满码头，货与名声一起进出',
  },
  {
    id: 'S05',
    genre: '沙漠玻璃城',
    priceIndexRange: [1.2, 1.55],
    mood: '整城是烧化的沙子，值钱的东西都烫手',
  },
  {
    id: 'S06',
    genre: '苔原冰骨集市',
    priceIndexRange: [0.8, 1.05],
    mood: '冻土里刨出来的东西，卖不出好价',
  },
  {
    id: 'S07',
    genre: '雨林菌灯部落',
    priceIndexRange: [0.8, 1.0],
    mood: '以物易物，钱在这里是稀罕物',
  },
  { id: 'S08', genre: '云端纸鸢城', priceIndexRange: [0.95, 1.2], mood: '风一停，物价就跟着落' },
  {
    id: 'S09',
    genre: '月海潮汐贝市',
    priceIndexRange: [1.0, 1.3],
    mood: '涨潮开市落潮收摊，摊主都看月亮脸色',
  },
  {
    id: 'S10',
    genre: '星砂废土驿站',
    priceIndexRange: [0.8, 1.1],
    mood: '沙里淘货，十件里九件是废铁',
  },
  { id: 'S11', genre: '机械僧院', priceIndexRange: [1.1, 1.4], mood: '僧人给器物开光，也给它标价' },
  { id: 'S12', genre: '镜湖倒影城', priceIndexRange: [1.0, 1.3], mood: '湖水照出赝品，也照出贪心' },
  {
    id: 'S13',
    genre: '盐碱白骨原',
    priceIndexRange: [0.8, 1.0],
    mood: '除了盐和骨头，什么都不值钱',
  },
  { id: 'S14', genre: '蜂巢铜矿镇', priceIndexRange: [1.0, 1.3], mood: '矿灯一亮，好货就藏进洞' },
  {
    id: 'S15',
    genre: '火山灰黑市',
    priceIndexRange: [1.3, 1.6],
    mood: '灰烬落满柜台，价格一天翻三回',
  },
  { id: 'S16', genre: '丝绸沙洲', priceIndexRange: [0.9, 1.2], mood: '驼铃一响，精明的商队到了' },
  {
    id: 'S17',
    genre: '苔藓石阵',
    priceIndexRange: [0.8, 1.0],
    mood: '石缝里交换秘密，很少有人用钱',
  },
  { id: 'S18', genre: '极光水晶港', priceIndexRange: [1.2, 1.5], mood: '极光下的货，贵得理直气壮' },
  {
    id: 'S19',
    genre: '沉船珊瑚窟',
    priceIndexRange: [0.9, 1.2],
    mood: '从船骸里捞上来的，来路都不干净',
  },
  {
    id: 'S20',
    genre: '雾林猎场',
    priceIndexRange: [0.9, 1.15],
    mood: '雾里看不清货，也看不清人心',
  },
  { id: 'S21', genre: '青铜天穹塔', priceIndexRange: [1.2, 1.5], mood: '塔越高，货越贵，人越冷' },
  {
    id: 'S22',
    genre: '熔金拍卖行',
    priceIndexRange: [1.3, 1.6],
    mood: '一锤定音，钱在这里只是筹码',
  },
  {
    id: 'S23',
    genre: '荒星拾荒营地',
    priceIndexRange: [0.8, 1.0],
    mood: '捡来的东西，谁都不当宝贝',
  },
  {
    id: 'S24',
    genre: '雪原驯鹿集市',
    priceIndexRange: [0.9, 1.1],
    mood: '一年开一次市，摊主不急，你别急',
  },
  { id: 'S25', genre: '地下菌光长廊', priceIndexRange: [0.8, 1.0], mood: '光越暗，越容易买错' },
  { id: 'S26', genre: '风暴云舟港', priceIndexRange: [1.1, 1.4], mood: '船期一误，价格就翻脸' },
  {
    id: 'S27',
    genre: '陶土墓园市集',
    priceIndexRange: [0.85, 1.1],
    mood: '在墓园边做买卖，见怪不怪',
  },
  { id: 'S28', genre: '龙脊矿脉镇', priceIndexRange: [1.15, 1.5], mood: '龙睡在山里，钱睡在矿里' },
  {
    id: 'S29',
    genre: '幻梦香料集市',
    priceIndexRange: [1.0, 1.35],
    mood: '香料掺着梦卖，账目也算不清',
  },
  {
    id: 'S30',
    genre: '潮汐铁锚城',
    priceIndexRange: [1.0, 1.3],
    mood: '铁锚锈了还值钱，货却不一定',
  },
];

export function getSeedById(id: string): WorldSeed | undefined {
  return WORLD_SEEDS.find((seed) => seed.id === id);
}

/** 抽一条种子（可注入 rng，测试可复现）。 */
export function pickSeed(rng: RandomFn = Math.random, excludeId?: string): WorldSeed {
  const pool = excludeId ? WORLD_SEEDS.filter((seed) => seed.id !== excludeId) : WORLD_SEEDS;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const seed = pool[index];
  if (!seed) throw new Error('世界种子库为空');
  return seed;
}
