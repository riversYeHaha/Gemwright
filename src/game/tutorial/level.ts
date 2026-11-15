import type {
  CreatorProfile,
  LevelJson,
  LevelPhase,
  Stall,
  TutorialProgress,
} from '../../types/level';
import { BLOCKED_ANSWER } from '../fairy';
import { applyTamperOps } from '../validate';

/**
 * 教学关卡（MVP 保底，永不依赖网络与模型）：
 * - 手写世界、创作人、两件珍宝（一真一假），预生成故事背景；
 * - 3D 用程序化占位模型，**不调用 Lux3D**；
 * - 精灵只回答 5 个预设问题（含一个会被防火墙挡回的越界问题），**不调用 DeepSeek**；
 * - 但额度、砍价、回收、结算全部走真实规则，学到的操作在正式关卡里同样成立。
 *
 * 故事：烬岩坊市一年只开一夜。老锻翁·格罗姆拿出两枚星核，一枚是他亲手锻的，
 * 另一枚是学徒仿的——署名都是他。
 */

export const TUTORIAL_LEVEL_ID = 'tutorial-level';
export const TUTORIAL_ITEM_IDS = { real: 'T1', fake: 'T2' } as const;
export const TUTORIAL_QUOTA = 5;

export interface TutorialQA {
  id: string;
  question: string;
  answer: string;
  blocked?: boolean;
}

export const TUTORIAL_QA: TutorialQA[] = [
  {
    id: 'spec',
    question: '格罗姆的星核有什么讲究？',
    answer: '青蓝、八面体、七颗星砂、配银底——四样一样不差，才是他亲手锻的。',
  },
  {
    id: 'market',
    question: '今晚这坊市怎么这么挤？',
    answer: '烬岩坊市一年只开一夜，铁水一凉就得等明年。人挤，钱也挤，别急着掏。',
  },
  {
    id: 'forgery',
    question: '坊市里有人仿他的手艺吗？',
    answer: '学徒阿砾学了点皮毛，颗数总记不牢。我只说坊间传闻，你自己去看。',
  },
  {
    id: 'price',
    question: '这星核值多少钱？',
    answer: '我只谈手艺，不谈价钱。值多少，得你自己掂量。',
  },
  {
    id: 'which',
    question: '两枚星核哪枚是真的？',
    answer: BLOCKED_ANSWER,
    blocked: true,
  },
];

export function createTutorialLevel(now = Date.now()): LevelJson {
  const creator: CreatorProfile = {
    id: 'C1',
    name: '老锻翁·格罗姆',
    background:
      '烬岩坊市最老的锻匠。他锻星核有个死规矩：青蓝、八面体、七颗星砂、配银底，一样都不能少。',
    reputationTier: '名家',
    quoteRange: [500, 900],
    signatureTraits: { color: '青蓝', gemCount: 7, shape: '八面体', hasBase: true },
  };

  const realTraits = applyTamperOps(creator.signatureTraits, []);
  const fakeTraits = applyTamperOps(creator.signatureTraits, [
    { type: 'count_change', field: 'gemCount', delta: -1 },
  ]);

  const stalls: Stall[] = [
    {
      itemId: TUTORIAL_ITEM_IDS.real,
      creatorId: creator.id,
      stallOwner: {
        name: '独眼商人哈克',
        persona: '油滑但识货，知道今晚有两枚星核，却分不清哪枚是真的',
        savviness: '懂行',
      },
      item: {
        name: '星穹之核',
        pitch: '老锻翁亲手锻的星核，七颗星砂一颗不少，你数得清就值这个价。',
        traits: realTraits,
        tamperOps: [],
        isAuthentic: true,
      },
      economy: { salePrice: 380, bottomPrice: 260, flexibility: 0.6, trueValue: 800 },
    },
    {
      itemId: TUTORIAL_ITEM_IDS.fake,
      creatorId: creator.id,
      stallOwner: {
        name: '说书人墨鸦',
        persona: '张口就是一段传说，讲得比货还真',
        savviness: '半懂',
      },
      item: {
        name: '碎星残核',
        pitch: '同一位老匠的星核，成色一样好，少一颗星砂又怎样？便宜给你。',
        traits: fakeTraits,
        tamperOps: [{ type: 'count_change', field: 'gemCount', delta: -1 }],
        isAuthentic: false,
      },
      economy: { salePrice: 350, bottomPrice: 240, flexibility: 0.55, trueValue: 700 },
    },
  ];

  return {
    id: TUTORIAL_LEVEL_ID,
    kind: 'tutorial',
    seedId: 'TUT-S01',
    seedGenre: '熔岩锻造城邦',
    difficulty: 1,
    createdAt: now,
    world: {
      name: '烬岩坊市',
      genreSeed: '熔岩锻造城邦',
      lore: '烬岩城的街巷砌在冷却的熔岩上，脚下还是温的。坊市一年只开一夜：铁水一凉，摊主们就收摊等明年，所以这一夜，全城的人都挤在炉火边。老锻翁·格罗姆今年只放出两枚星核，一枚是他亲手锻的，另一枚据说是学徒阿砾的仿作——可署名都是格罗姆。哈克和墨鸦各自守着一枚，谁都不肯先降价。此地物价偏高，钱要花在刀刃上。',
      residentPref: '本地人只认“亲手锻过”的物件，看轻学徒的仿作。',
      priceIndex: 1.3,
      currencyName: '烬金币',
    },
    fairy: {
      name: '鎏金',
      persona: '毒舌学者',
      briefing: [
        '烬岩坊市一年只开一夜，钱不经花，别急着掏。',
        '格罗姆的规矩是青蓝、八面体、七颗星砂、配银底。',
        '坊间传闻学徒阿砾的仿作总在颗数上出错。',
      ],
    },
    creators: [creator],
    stalls,
  };
}

/* ------------------------------------------------------------------ */
/* 教学引导                                                            */
/* ------------------------------------------------------------------ */

export type TutorialObjectiveId = 'open' | 'inspect' | 'ask' | 'buy' | 'base' | 'settle';

export interface TutorialObjective {
  id: TutorialObjectiveId;
  title: string;
  hint: string;
  done: boolean;
}

export interface TutorialObjectiveInput {
  progress: TutorialProgress;
  askUsed: number;
  purchasedCount: number;
  phase: LevelPhase;
  settled: boolean;
}

/** 六步目标，全部由运行时状态推导，不做额外埋点。 */
export function tutorialObjectives(input: TutorialObjectiveInput): TutorialObjective[] {
  const inspectedCount = [TUTORIAL_ITEM_IDS.real, TUTORIAL_ITEM_IDS.fake].filter((id) =>
    input.progress.inspected.includes(id),
  ).length;

  return [
    {
      id: 'open',
      title: '开市',
      hint: '点「开市」，今晚的坊市只摆这两枚星核。',
      done: input.progress.openedMarket,
    },
    {
      id: 'inspect',
      title: `逐件验货（${inspectedCount}/2）`,
      hint: '两件都进 3D 看看：拖一拖，数星砂、看色族、确认底座。',
      done: inspectedCount === 2,
    },
    {
      id: 'ask',
      title: '问一次精灵',
      hint: '精灵懂手艺、懂传闻，但不知道哪枚是真的、也不知道价钱。',
      done: input.askUsed >= 1,
    },
    {
      id: 'buy',
      title: `把两件都买下（${input.purchasedCount}/2）`,
      hint: '分别出价：一件报 320 左右、一件报 300 左右，摊主大概率松口。',
      done: input.purchasedCount >= 2,
    },
    {
      id: 'base',
      title: '收摊回基地',
      hint: '货买齐了就点「收摊结算」，真伪与特征 diff 都会揭晓。',
      done: input.phase !== 'market',
    },
    {
      id: 'settle',
      title: '揭晓并结算',
      hint: '在基地逐件看「实际 vs 规范」，再点「结算并回城」。',
      done: input.settled,
    },
  ];
}

export function firstUndoneObjective(
  objectives: TutorialObjective[],
): TutorialObjective | undefined {
  return objectives.find((objective) => !objective.done);
}
