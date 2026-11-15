import type { CreatorProfile, LevelJson, Stall, TamperOp } from '../../types/level';
import { applyTamperOps } from '../validate';

/**
 * 演示关卡：不消耗任何 API 调用，也能把"集市 → 议价 → 鉴宝 → 结算"整条闭环点一遍。
 * 用途：① 评委 / 队友无 Key 时预览 UI；② 没有 GLB 时由 Three.js 程序化占位模型演示特征对照。
 *
 * 数据与真实关卡同构（难度 2：2 件真品 + 3 件仿品，算子只用 count_change / base_flip），
 * 唯一区别是 id 固定为 `demo-level`，模型缓存不会串关。
 */

const opCount = (delta: number): TamperOp => ({ type: 'count_change', field: 'gemCount', delta });
const opBase: TamperOp = { type: 'base_flip', field: 'hasBase' };

function stall(
  itemId: string,
  creator: CreatorProfile,
  name: string,
  pitch: string,
  owner: Stall['stallOwner'],
  economy: Stall['economy'],
  ops: TamperOp[],
): Stall {
  return {
    itemId,
    creatorId: creator.id,
    stallOwner: owner,
    item: {
      name,
      pitch,
      traits: applyTamperOps(creator.signatureTraits, ops),
      tamperOps: ops,
      isAuthentic: ops.length === 0,
    },
    economy,
  };
}

export function createDemoLevel(now = Date.now()): LevelJson {
  const creatorA: CreatorProfile = {
    id: 'C1',
    name: '老锻翁·格罗姆',
    background: '烬岩坊市最老的锻匠，脾气像烧红的铁。晚年手有些抖，但署名从不马虎。',
    reputationTier: '名家',
    quoteRange: [400, 900],
    signatureTraits: { color: '青蓝', gemCount: 7, shape: '八面体', hasBase: true },
  };
  const creatorB: CreatorProfile = {
    id: 'C2',
    name: '潮音匠·弥拉',
    background: '从潮汐铁锚城迁来的女匠，只用海底熔金。她的六棱柱作品被藏家追着收。',
    reputationTier: '宗师',
    quoteRange: [700, 1400],
    signatureTraits: { color: '赤金', gemCount: 5, shape: '六棱柱', hasBase: true },
  };

  const stalls: Stall[] = [
    stall(
      'T1',
      creatorA,
      '星穹之核',
      '老锻翁亲手锻的星核，七颗星砂一颗不少，识货的才配拿。',
      { name: '独眼商人哈克', persona: '油滑但识货，爱拿故事抬价', savviness: '懂行' },
      { salePrice: 480, bottomPrice: 340, flexibility: 0.6, trueValue: 780 },
      [],
    ),
    stall(
      'T2',
      creatorA,
      '碎星坠饰',
      '格罗姆老爷子的手艺，你看这成色，错过就没了。',
      { name: '磨刀霍霍的苔拉', persona: '嘴上没把门，价格倒是实在', savviness: '半懂' },
      { salePrice: 390, bottomPrice: 280, flexibility: 0.5, trueValue: 700 },
      [opCount(-1)],
    ),
    stall(
      'T3',
      creatorB,
      '潮汐之瞳',
      '弥拉的六棱柱，赤金里头包着海，你凑近看就知道了。',
      { name: '披鳞的潮商伊索', persona: '慢条斯理，从不做亏本买卖', savviness: '懂行' },
      { salePrice: 560, bottomPrice: 400, flexibility: 0.45, trueValue: 1200 },
      [],
    ),
    stall(
      'T4',
      creatorB,
      '沉锚之泪',
      '海底捞上来的好东西，带不带底座都值钱。',
      { name: '拾荒者布洛', persona: '急着换钱，眼神躲闪', savviness: '外行' },
      { salePrice: 420, bottomPrice: 300, flexibility: 0.65, trueValue: 900 },
      [opBase],
    ),
    stall(
      'T5',
      creatorA,
      '灰烬棱晶',
      '老匠的边角料炼的，多一颗少一颗谁数得清？',
      { name: '说书人墨鸦', persona: '张口就是一段传说，真假难辨', savviness: '半懂' },
      { salePrice: 300, bottomPrice: 220, flexibility: 0.7, trueValue: 560 },
      [opCount(1)],
    ),
  ];

  return {
    id: 'demo-level',
    seedId: 'S01',
    seedGenre: '熔岩锻造城邦',
    difficulty: 2,
    createdAt: now,
    world: {
      name: '烬岩坊市',
      genreSeed: '熔岩锻造城邦',
      lore: '烬岩城的街巷砌在冷却的熔岩上，脚下还是温的。铁水昼夜不息，匠人把锻打当成修行，生人若不懂行，摊主连眼皮都懒得抬。此地物贵，钱不经花，一把好矿要拿半袋星际币换；倒是那些署名响亮的旧作，在这个人人都想当收藏家的地方，能卖出比别处更狠的价。',
      residentPref: '本地人迷信"亲手锻过"的物件，看轻来路不明的舶来品。',
      priceIndex: 1.4,
      currencyName: '烬金币',
    },
    fairy: {
      name: '鎏金',
      persona: '毒舌学者',
      briefing: [
        '烬岩坊市物贵，钱不经花，别指望在这儿捡便宜。',
        '盯紧老锻翁·格罗姆，他的手艺值钱，近年仿货也多。',
        '此地仿品惯用改颗数、动底座，凑近数一数不吃亏。',
      ],
    },
    creators: [creatorA, creatorB],
    stalls,
  };
}
