import type { ChatClient } from '../api/types';
import { ANSWER_MAX_CHARS, FAIRY_MAX_TOKENS, QUESTION_MAX_CHARS } from '../config/constants';
import { buildFairySystemPrompt, type FairyPromptContext } from '../config/prompts';
import type { FairyAnswer, LevelJson } from '../types/level';
import { collectTamperTypes } from './validate';

/**
 * 鉴宝精灵（方案 §四）。
 *
 * 核心不是 prompt 写得多严，而是**物理隔离**：
 * `buildFairyContext()` 只从关卡里取 world / creators 公开档案 / 算子类型集合，
 * 结构上就碰不到 stalls（真伪、实际特征、任何价格）。
 * 因此哪怕玩家花式套话，LLM 也没有可泄露的信息。
 */
export type FairyContext = FairyPromptContext;

export const BLOCKED_ANSWER = '（精灵把身子一扭）我又没长天眼，是真是假得你自己凑近看。';

/** 越界回答的兜底：出现指向单件的编号样式，就整段替换为挡回语。 */
const ITEM_REFERENCE_PATTERNS: RegExp[] = [
  /第\s*[0-9一二三四五六七八九十]+\s*件/,
  /\bT\s*[1-9]\b/i,
  /#\s*[1-9]/,
  /编号\s*[0-9一二三四五六七八九十]+/,
  /(?:物品|珍宝|宝贝)\s*[1-9]/,
];

const countChars = (text: string): number => [...text].length;

/** 组装精灵上下文：**不含 stalls**（价格 / 真伪 / 特征全部物理隔离）。 */
export function buildFairyContext(level: LevelJson): FairyContext {
  return {
    world: {
      name: level.world.name,
      lore: level.world.lore,
      residentPref: level.world.residentPref,
      priceIndex: level.world.priceIndex,
      currencyName: level.world.currencyName,
    },
    creators: level.creators.map((creator) => ({
      name: creator.name,
      background: creator.background,
      reputationTier: creator.reputationTier,
      signatureTraits: { ...creator.signatureTraits },
    })),
    tamperTypes: collectTamperTypes(level),
    fairy: { name: level.fairy.name, persona: level.fairy.persona },
  };
}

export type QuestionCheck = { ok: true; value: string } | { ok: false; error: string };

/** 玩家问题：去空白、≤50 字（按 Unicode 码点）。 */
export function sanitizeQuestion(raw: string): QuestionCheck {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: '问题不能为空。' };
  const length = countChars(value);
  if (length > QUESTION_MAX_CHARS) {
    return { ok: false, error: `问题最多 ${QUESTION_MAX_CHARS} 字，当前 ${length} 字。` };
  }
  return { ok: true, value };
}

/** 回答清洗：单行、≤100 字；命中单件编号 → 整段挡回。 */
export function filterAnswer(raw: string): FairyAnswer {
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  const clipped = [...singleLine].slice(0, ANSWER_MAX_CHARS).join('');
  if (ITEM_REFERENCE_PATTERNS.some((pattern) => pattern.test(singleLine))) {
    return { answer: BLOCKED_ANSWER, blocked: true };
  }
  if (!clipped) return { answer: BLOCKED_ANSWER, blocked: true };
  return { answer: clipped, blocked: false };
}

/**
 * 问精灵：独立 DeepSeek 小调用（上下文约 1.5k tokens，回答 ≤100 字）。
 * 注意：不传历史对话（MVP 每问独立，防上下文注入套话）。
 */
export async function askFairy(
  client: ChatClient,
  context: FairyContext,
  question: string,
): Promise<FairyAnswer> {
  const checked = sanitizeQuestion(question);
  if (!checked.ok) return { answer: checked.error, blocked: true };

  const result = await client.chat({
    messages: [
      { role: 'system', content: buildFairySystemPrompt(context) },
      { role: 'user', content: checked.value },
    ],
    temperature: 0.85,
    maxTokens: FAIRY_MAX_TOKENS,
  });
  return filterAnswer(result.content);
}

/** 调试 / 测试用：把上下文序列化后检查是否真的不含单件信息。 */
export function fairyContextSnapshot(context: FairyContext): string {
  return JSON.stringify(context);
}
