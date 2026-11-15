import type { ChatClient, ChatMessage } from '../api/types';
import { Lux3DError, type Lux3DClient } from '../api/lux3d';
import {
  LEVEL_GENERATION_MAX_ATTEMPTS,
  LUX3D_CREDITS_PER_ITEM,
  targetAuthenticCount,
} from '../config/constants';
import {
  LEVEL_SYSTEM_PROMPT,
  buildLevelUserPrompt,
  buildRetryFeedback,
  renderPromptForTraits,
} from '../config/prompts';
import type { LevelJson } from '../types/level';
import { LevelError } from '../types/level';
import type { GameCache, ModelMap } from '../store/cache';
import { mulberry32, type RandomFn } from './random';
import { getSeedById, type WorldSeed } from './seeds';
import { LevelSchemaError, normalizeLevel } from './validate';

/**
 * 生成编排（方案 §二 M8 / M9 + §五）：
 *   种子 → DeepSeek 整关 JSON（最多 3 次，含定向重试）→ 本地归一化 → IndexedDB 存档
 *   然后 5 件 GLB 并行生成（并发 5 恰好一关）→ 存 blob。
 * 关卡与模型分开，是为了"世界观先到先展、3D 慢慢补"的错峰体验。
 */

export interface LevelGenHooks {
  /** 每次 LLM 尝试前回调（UI 显示"星图校准中…"）。 */
  onAttempt?: (attempt: number, previousError?: string) => void;
  onWarnings?: (warnings: string[]) => void;
  signal?: AbortSignal;
}

export interface GenerateLevelOptions {
  seed: WorldSeed;
  difficulty: number;
  funds: number;
  rng?: RandomFn;
  now?: number;
  levelId?: string;
  hooks?: LevelGenHooks;
}

export interface GeneratedLevel {
  level: LevelJson;
  warnings: string[];
  attempts: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sleepWithSignal = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const MODEL_GEN_ATTEMPTS = 2;

/** 只重试"可能是抖动"的失败；鉴权 / 参数 / 积分不足重试也是白烧。 */
function isRetryableModelError(error: unknown): boolean {
  if (!(error instanceof Lux3DError)) return false;
  if (error.code === 'task-failed' || error.code === 'timeout') return true;
  if (error.code === undefined && /网络|超时/.test(error.message)) return true;
  return false;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Lux3DError && error.code === 'aborted';
}

function readingErrorMessage(error: unknown): string {
  if (error instanceof LevelSchemaError) return error.issues.join('；');
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 一次大调用生成整关（约 2.5~3k tokens 输出）。
 * 校验不过就把问题回灌给 LLM 做定向重试；仍失败 → 抛 LevelError 让 UI 给"重掷"按钮。
 */
export async function generateLevel(
  deps: { client: ChatClient },
  options: GenerateLevelOptions,
): Promise<GeneratedLevel> {
  const seed = getSeedById(options.seed.id) ?? options.seed;
  const rng = options.rng ?? mulberry32(options.now ?? Date.now());
  const authenticTarget = targetAuthenticCount(options.difficulty);
  const itemCount = 5;

  let previousError: string | undefined;
  let issues: string[] = [];

  for (let attempt = 1; attempt <= LEVEL_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    options.hooks?.onAttempt?.(attempt, previousError);

    const messages: ChatMessage[] = [
      { role: 'system', content: LEVEL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildLevelUserPrompt({
          genre: seed.genre,
          mood: seed.mood,
          priceIndexRange: seed.priceIndexRange,
          difficulty: options.difficulty,
          funds: options.funds,
          itemCount,
          authenticTarget,
        }),
      },
    ];
    if (attempt > 1 && issues.length > 0) {
      messages.push({ role: 'user', content: buildRetryFeedback(issues) });
    }

    try {
      const result = await deps.client.chat({
        messages,
        json: true,
        temperature: 0.7,
        maxTokens: 5000,
        ...(options.hooks?.signal ? { signal: options.hooks.signal } : {}),
      });
      const text = result.content
        .trim()
        .replace(/^```[a-zA-Z]*\s*/, '')
        .replace(/```\s*$/, '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new LevelError('模型输出不是合法 JSON');
      }

      const normalized = normalizeLevel(parsed, {
        difficulty: options.difficulty,
        funds: options.funds,
        seedId: seed.id,
        seedGenre: seed.genre,
        priceIndexRange: seed.priceIndexRange,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.levelId !== undefined ? { levelId: options.levelId } : {}),
        rng,
      });
      options.hooks?.onWarnings?.(normalized.warnings);
      return { level: normalized.level, warnings: normalized.warnings, attempts: attempt };
    } catch (error) {
      previousError = readingErrorMessage(error);
      if (error instanceof LevelSchemaError) {
        issues = error.issues;
      } else if (error instanceof LevelError) {
        issues = [error.message];
      } else {
        // 网络 / CORS / 鉴权错误：重试一次可能无意义，但保持统一重试窗口，最后一次抛出可读信息。
        issues = [`请求失败：${previousError}`];
      }
      if (attempt < LEVEL_GENERATION_MAX_ATTEMPTS) {
        await sleep(800);
      }
    }
  }

  throw new LevelError(
    `关卡生成失败（已尝试 ${LEVEL_GENERATION_MAX_ATTEMPTS} 次）：${previousError ?? '未知错误'}`,
  );
}

/* ------------------------------------------------------------------ */
/* 3D 生成                                                             */
/* ------------------------------------------------------------------ */

export type ModelStatus = 'cached' | 'running' | 'done' | 'failed' | 'skipped';

export interface ModelProgress {
  itemId: string;
  itemName: string;
  index: number;
  total: number;
  status: ModelStatus;
  message?: string;
}

export interface ModelGenHooks {
  onProgress?: (progress: ModelProgress) => void;
  signal?: AbortSignal;
}

export interface ModelGenDeps {
  lux3d?: Lux3DClient | null;
  cache?: Pick<GameCache, 'getModel' | 'saveModel'> | null;
}

export interface ModelGenResult {
  models: ModelMap;
  errors: Record<string, string>;
  creditsSpent: number;
}

/**
 * 按关卡生成 / 读取 5 件 GLB。
 * - 先读缓存：重开同关卡零积分。
 * - 没配 Lux3D Key：返回全 null，Three.js 用程序化占位模型（demo / 无 Key 也能看）。
 * - 单件失败不拖垮整关，失败项走占位模型并记录原因。
 */
export async function ensureLevelModels(
  level: LevelJson,
  deps: ModelGenDeps,
  hooks: ModelGenHooks = {},
): Promise<ModelGenResult> {
  const models: ModelMap = {};
  const errors: Record<string, string> = {};
  let creditsSpent = 0;
  const total = level.stalls.length;

  // 并发 5：免费档恰好一关 5 件，错峰后一关约 2~3 分钟（方案 §一 1.2 / M8）。
  await Promise.all(
    level.stalls.map(async (stall, index) => {
      const emit = (status: ModelStatus, message?: string): void => {
        hooks.onProgress?.({
          itemId: stall.itemId,
          itemName: stall.item.name,
          index,
          total,
          status,
          ...(message ? { message } : {}),
        });
      };

      try {
        const cached = await deps.cache?.getModel(level.id, stall.itemId);
        if (cached) {
          models[stall.itemId] = cached;
          emit('cached');
          return;
        }
      } catch {
        // 缓存读失败不阻塞生成
      }

      if (!deps.lux3d) {
        models[stall.itemId] = null;
        emit('skipped', '未配置 Lux3D Key，使用占位模型');
        return;
      }

      if (hooks.signal?.aborted) {
        models[stall.itemId] = null;
        emit('skipped', '已停止布展');
        return;
      }

      const prompt = renderPromptForTraits(stall.item.traits);
      for (let attempt = 1; attempt <= MODEL_GEN_ATTEMPTS; attempt += 1) {
        emit(
          'running',
          attempt === 1 ? '集市布展中…' : `失败重试中（${attempt}/${MODEL_GEN_ATTEMPTS}）`,
        );
        try {
          const result = await deps.lux3d.generateGlb(prompt, {
            ...(hooks.signal ? { signal: hooks.signal } : {}),
          });
          creditsSpent += LUX3D_CREDITS_PER_ITEM;
          await deps.cache?.saveModel(level.id, stall.itemId, result.blob);
          models[stall.itemId] = result.blob;
          emit('done', '生成完成');
          return;
        } catch (error) {
          if (isAbortError(error, hooks.signal)) {
            models[stall.itemId] = null;
            emit('skipped', '已停止布展');
            return;
          }
          const retryable = isRetryableModelError(error);
          if (retryable && attempt < MODEL_GEN_ATTEMPTS) {
            await sleepWithSignal(1500, hooks.signal).catch(() => undefined);
            continue;
          }
          const message = error instanceof Error ? error.message : String(error);
          errors[stall.itemId] = message;
          models[stall.itemId] = null;
          emit('failed', message);
          return;
        }
      }
    }),
  );

  return { models, errors, creditsSpent };
}

/** 本地演示 / 无 Key 兜底：只从缓存取模型，不发请求。 */
export async function loadCachedModels(
  level: LevelJson,
  cache: Pick<GameCache, 'getModel'>,
): Promise<ModelMap> {
  const models: ModelMap = {};
  for (const stall of level.stalls) {
    models[stall.itemId] = await cache.getModel(level.id, stall.itemId);
  }
  return models;
}
