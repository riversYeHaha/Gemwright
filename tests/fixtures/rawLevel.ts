/**
 * 测试用原始关卡 JSON（模拟 DeepSeek 返回形状）。
 * 故意把价格 / 底价 / trueValue 写得越界，用来验证前端 clamp 与程序覆写。
 */

export interface RawLevelOverrides {
  allAuthentic?: boolean;
  tamperFieldMismatch?: boolean;
}

export function makeRawLevel(overrides: RawLevelOverrides = {}): Record<string, unknown> {
  const creators = [
    {
      id: 'C1',
      name: '老锻翁·格罗姆',
      background: '烬岩坊市最老的锻匠，脾气像烧红的铁，晚年手抖但署名从不马虎。',
      reputationTier: '名家',
      quoteRange: [400, 900],
      signatureTraits: { color: '青蓝', gemCount: 7, shape: '八面体', hasBase: true },
    },
    {
      id: 'C2',
      name: '潮音匠·弥拉',
      background: '从潮汐铁锚城迁来的女匠，只用海底熔金，六棱柱作品被藏家追着收。',
      reputationTier: '宗师',
      quoteRange: [700, 1400],
      signatureTraits: { color: '赤金', gemCount: 5, shape: '六棱柱', hasBase: true },
    },
  ];

  const opCount = { type: 'count_change', field: 'gemCount', delta: -1 };
  const opColor = { type: 'color_swap', field: 'color', to: '赤金' };

  const stalls = [
    {
      itemId: 'T1',
      creatorId: 'C1',
      stallOwner: { name: '独眼商人哈克', persona: '油滑但识货', savviness: '懂行' },
      item: {
        name: '星穹之核',
        pitch: '老锻翁亲手锻的星核，七颗星砂一颗不少。',
        tamperOp: null,
      },
      economy: { salePrice: 1000, bottomPrice: 900, flexibility: 1.4, trueValue: 99999 },
    },
    {
      itemId: 'T2',
      creatorId: 'C1',
      stallOwner: { name: '苔拉', persona: '嘴上没把门', savviness: '半懂' },
      item: {
        name: '碎星坠饰',
        pitch: '格罗姆老爷子的手艺，你看这成色。',
        tamperOp: overrides.tamperFieldMismatch
          ? { type: 'count_change', field: 'color', delta: -1 }
          : opCount,
      },
      economy: { salePrice: 1200, bottomPrice: 300, flexibility: -1, trueValue: 50 },
    },
    {
      itemId: 'T3',
      creatorId: 'C2',
      stallOwner: { name: '潮商伊索', persona: '慢条斯理', savviness: '懂行' },
      item: {
        name: '潮汐之瞳',
        pitch: '弥拉的六棱柱，赤金里头包着海。',
        tamperOp: null,
      },
      economy: { salePrice: 900, bottomPrice: 1, flexibility: 0.45, trueValue: 1400 },
    },
    {
      itemId: 'T4',
      creatorId: 'C1',
      stallOwner: { name: '拾荒者布洛', persona: '急着换钱', savviness: '外行' },
      item: {
        name: '沉锚之泪',
        pitch: '海底捞上来的好东西。',
        tamperOp: null,
      },
      economy: { salePrice: 800, bottomPrice: 600, flexibility: 0.65, trueValue: 780 },
    },
    {
      itemId: 'T5',
      creatorId: 'C2',
      stallOwner: { name: '说书人墨鸦', persona: '张口就是一段传说', savviness: '半懂' },
      item: {
        name: '灰烬棱晶',
        pitch: '老匠的边角料炼的。',
        tamperOp: [opColor],
      },
      economy: { salePrice: 700, bottomPrice: 500, flexibility: 0.7, trueValue: 900 },
    },
  ];

  if (overrides.allAuthentic) {
    for (const stall of stalls) {
      stall.item.tamperOp = null as unknown as typeof stall.item.tamperOp;
    }
  }

  return {
    world: {
      name: '烬岩坊市',
      genreSeed: '熔岩锻造城邦',
      lore: '烬岩城的街巷砌在冷却的熔岩上，脚下还是温的。铁水昼夜不息，匠人把锻打当成修行，生人若不懂行，摊主连眼皮都懒得抬。此地物贵，钱不经花；倒是那些署名响亮的旧作，在这个人人都想当收藏家的地方，能卖出比别处更狠的价。',
      residentPref: '本地人迷信“亲手锻过”的物件。',
      priceIndex: 1.4,
      currencyName: '烬金币',
    },
    fairy: {
      name: '鎏金',
      persona: '毒舌学者',
      briefing: ['烬岩坊市物贵。', '盯紧老锻翁。', '此地仿品惯用改颗数、动底座。'],
    },
    creators,
    stalls,
  };
}
