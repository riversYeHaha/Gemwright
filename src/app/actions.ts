import { DeepSeekClient } from '../api/deepseek';
import { Lux3DClient } from '../api/lux3d';
import { createDemoLevel } from '../game/fixtures/demoLevel';
import { ensureLevelModels, generateLevel, loadCachedModels } from '../game/generation';
import { LevelSession } from '../game/level';
import { levelForXp } from '../game/economy';
import { pickSeed, type WorldSeed } from '../game/seeds';
import { TUTORIAL_QA, createTutorialLevel } from '../game/tutorial/level';
import type { LevelJson, LevelRuntime, PlayerState } from '../types/level';
import {
  clearActiveRun,
  clearProfile,
  gameCache,
  isTutorialCompleted,
  loadActiveRun,
  loadProfile,
  markTutorialCompleted,
  saveActiveRun,
  saveProfile,
} from '../store/cache';
import {
  clearKeys,
  hasDeepSeekKey,
  loadSettings,
  saveSettings,
  type ClientSettings,
} from '../store/settings';
import {
  applyModelProgress,
  createSlotProgress,
  store,
  type AppState,
  type ScreenName,
} from './store';

/**
 * 应用动作层：UI 只调这里，所有异步流程（生成 / 议价 / 问精灵 / 结算）集中在此。
 * 任何失败都要落到 notice，保证玩家不会卡在"没反应"。
 *
 * 教学关卡的特殊性：
 * - 用独立的"新手玩家"（1000 资金 / Lv.1），不写玩家存档、不写续玩快照；
 * - 不调用 DeepSeek / Lux3D；
 * - 退出时恢复教学前的玩家状态。
 */

/** 3D 布展的取消句柄（同时用于停止 5 个并行任务与轮询）。 */
let modelAbortController: AbortController | null = null;
/** 进入教学前的真实存档，退出教学时恢复。 */
let playerBeforeTutorial: PlayerState | null = null;

function defaultPlayer(): PlayerState {
  return { funds: 1000, xp: 0, level: 1 };
}

function emptyTutorialProgress(): AppState['tutorial'] {
  return { inspected: [], openedMarket: false };
}

export function bootstrapState(): AppState {
  const settings = loadSettings();
  const tutorialCompleted = isTutorialCompleted();
  const base: AppState = {
    screen: 'start',
    settings,
    player: loadProfile() ?? defaultPlayer(),
    level: null,
    session: null,
    models: {},
    inspectItemId: null,
    busy: null,
    notice: null,
    nextSeed: pickSeed(),
    offerOpenFor: null,
    decisions: {},
    fairyOpen: false,
    fairyBusy: false,
    fairyDraftError: null,
    recyclePlan: {},
    demoMode: false,
    attempts: 0,
    resumeAvailable: false,
    tutorial: emptyTutorialProgress(),
    tutorialCompleted,
  };

  const run = loadActiveRun();
  if (run) {
    const session = LevelSession.fromRuntime(run.level, run.player, run.runtime);
    base.player = run.player;
    base.level = run.level;
    base.session = session;
    base.resumeAvailable = true;
    base.tutorial = run.tutorial ?? emptyTutorialProgress();
  }
  return base;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function deepseekOf(settings: ClientSettings): DeepSeekClient | null {
  if (!settings.deepseekKey.trim()) return null;
  try {
    return new DeepSeekClient({ apiKey: settings.deepseekKey });
  } catch {
    return null;
  }
}

function lux3dOf(settings: ClientSettings): Lux3DClient | null {
  if (!settings.lux3dKey.trim()) return null;
  try {
    return new Lux3DClient({ apiKey: settings.lux3dKey, region: settings.region });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 续玩快照 / 存档                                                      */
/* ------------------------------------------------------------------ */

function isTutorialLevel(level: LevelJson | null): boolean {
  return level?.kind === 'tutorial';
}

/** 正式关卡与演示关卡才写续玩快照；教学关卡刷新即从头再来。 */
function persistActiveRun(): void {
  const state = store.get();
  const { session, level } = state;
  if (!session || !level || isTutorialLevel(level)) return;
  const runtime: LevelRuntime = JSON.parse(JSON.stringify(session.state)) as LevelRuntime;
  saveActiveRun({
    version: 1,
    savedAt: Date.now(),
    player: session.player,
    level,
    runtime,
  });
}

function persistPlayer(): void {
  const state = store.get();
  if (!state.session || isTutorialLevel(state.level)) return;
  saveProfile(state.session.player);
}

/** 离开教学关卡时恢复教学前的真实存档。 */
function leaveTutorialIfNeeded(state: AppState): PlayerState | null {
  if (!isTutorialLevel(state.level)) return null;
  const restored = playerBeforeTutorial ?? loadProfile() ?? defaultPlayer();
  playerBeforeTutorial = null;
  return restored;
}

export function hydrateActiveModels(): void {
  const { level } = store.get();
  if (!level) return;
  void loadCachedModels(level, gameCache).then((models) => {
    const current = store.get();
    if (current.level?.id !== level.id) return;
    store.set({ models });
  });
}

/* ------------------------------------------------------------------ */
/* 导航 / 开始页                                                         */
/* ------------------------------------------------------------------ */

export function navigate(screen: ScreenName): void {
  store.set({ screen });
}

/** 开始页「开始游戏」：新开一局（会丢弃续玩快照，续玩走单独入口）。 */
export function startGame(): void {
  const state = store.get();
  const restored = leaveTutorialIfNeeded(state);
  if (!hasDeepSeekKey(state.settings)) {
    store.set({
      screen: 'settings',
      notice: { kind: 'info', text: '先填入 DeepSeek Key；没有 Key 也可以先玩教学关卡。' },
    });
    return;
  }
  clearActiveRun();
  store.set({
    screen: 'travel',
    player: restored ?? state.player,
    level: null,
    session: null,
    models: {},
    resumeAvailable: false,
    tutorial: emptyTutorialProgress(),
    offerOpenFor: null,
    decisions: {},
    recyclePlan: {},
    inspectItemId: null,
    busy: null,
    demoMode: false,
    notice: null,
    nextSeed: pickSeed(Math.random, state.nextSeed.id),
  });
}

/** 开始页「继续」：回到刷新前的关卡（集市 / 基地）。 */
export function continueRun(): void {
  const { session, level } = store.get();
  if (!session || !level) {
    navigate('travel');
    return;
  }
  store.set({
    screen: session.phase === 'market' ? 'market' : 'base',
    player: session.player,
    resumeAvailable: true,
  });
  void hydrateActiveModels();
}

export function goStart(): void {
  const state = store.get();
  const wasTutorial = isTutorialLevel(state.level);
  const restored = leaveTutorialIfNeeded(state);

  if (wasTutorial) {
    // 教学局不落续玩快照；回到开始页时恢复"教学前那一局"（如果还在）。
    const run = loadActiveRun();
    const session = run ? LevelSession.fromRuntime(run.level, run.player, run.runtime) : null;
    store.set({
      screen: 'start',
      player: run?.player ?? restored ?? state.player,
      level: run?.level ?? null,
      session,
      models: {},
      resumeAvailable: Boolean(run),
      tutorial: run?.tutorial ?? emptyTutorialProgress(),
      busy: null,
      offerOpenFor: null,
      fairyOpen: false,
      inspectItemId: null,
    });
    return;
  }

  store.set({
    screen: 'start',
    ...(restored ? { player: restored } : {}),
    resumeAvailable: Boolean(state.session && state.level),
    busy: null,
    offerOpenFor: null,
    fairyOpen: false,
  });
}

/* ------------------------------------------------------------------ */
/* 设置 / 存档                                                          */
/* ------------------------------------------------------------------ */

export function dismissNotice(): void {
  store.set({ notice: null });
}

export function rerollSeed(): void {
  const current = store.get();
  store.set({ nextSeed: pickSeed(Math.random, current.nextSeed.id) });
}

export function updateSettings(settings: ClientSettings): void {
  saveSettings(settings);
  store.set({
    settings,
    notice: { kind: 'success', text: '设置已保存到本机浏览器。' },
  });
}

export function wipeKeys(): void {
  clearKeys();
  store.set({
    settings: loadSettings(),
    notice: { kind: 'info', text: '两把 Key 已从本机清除。' },
  });
}

export function resetProfile(): void {
  clearProfile();
  clearActiveRun();
  modelAbortController?.abort();
  modelAbortController = null;
  playerBeforeTutorial = null;
  store.set({
    player: defaultPlayer(),
    level: null,
    session: null,
    models: {},
    decisions: {},
    recyclePlan: {},
    demoMode: false,
    resumeAvailable: false,
    tutorial: emptyTutorialProgress(),
    busy: null,
    screen: 'start',
    notice: { kind: 'info', text: '存档已重置：资金 1000、等级 1。' },
  });
}

export async function testDeepSeekKey(apiKeyOverride?: string): Promise<void> {
  const settings = apiKeyOverride
    ? { ...store.get().settings, deepseekKey: apiKeyOverride }
    : store.get().settings;
  const client = deepseekOf(settings);
  if (!client) {
    store.set({ notice: { kind: 'error', text: '先填入 DeepSeek Key 再测试。' } });
    return;
  }
  try {
    const balance = await client.getBalance();
    const amount = balance.balances
      .map((item) => `${item.total.toFixed(2)} ${item.currency}`)
      .join(' / ');
    store.set({
      notice: {
        kind: balance.available ? 'success' : 'error',
        text: balance.available
          ? `DeepSeek 连通，余额 ${amount || '未知'}`
          : `DeepSeek 返回不可用状态（余额 ${amount || '未知'}）`,
      },
    });
  } catch (error) {
    store.set({ notice: { kind: 'error', text: `DeepSeek 测试失败：${describeError(error)}` } });
  }
}

/* ------------------------------------------------------------------ */
/* 教学关卡                                                             */
/* ------------------------------------------------------------------ */

export function startTutorial(): void {
  const state = store.get();
  if (state.busy) return;
  if (!isTutorialLevel(state.level)) {
    playerBeforeTutorial = state.player;
  }

  const level = createTutorialLevel();
  const session = new LevelSession(level, defaultPlayer());
  store.set({
    level,
    session,
    player: session.player,
    screen: 'travel',
    models: {},
    busy: null,
    notice: { kind: 'info', text: '教学关卡：不调用任何模型，跟着上方的目标清单走一遍就能学会。' },
    tutorial: emptyTutorialProgress(),
    offerOpenFor: null,
    decisions: {},
    inspectItemId: null,
    recyclePlan: {},
    fairyOpen: false,
    demoMode: false,
    resumeAvailable: false,
    attempts: 1,
  });
}

/** 教学关卡的预设问答：不调模型，但走真实额度与日志（含一次防火墙挡回）。 */
export function askTutorialQuestion(qaId: string): void {
  const state = store.get();
  const session = state.session;
  if (!session || !isTutorialLevel(state.level)) return;
  const qa = TUTORIAL_QA.find((entry) => entry.id === qaId);
  if (!qa) return;
  if (session.state.fairyLog.some((entry) => entry.question === qa.question)) {
    store.set({ notice: { kind: 'info', text: '这个问题已经问过了，换一个试试。' } });
    return;
  }
  session.askScripted(qa.question, qa.answer, Boolean(qa.blocked));
  store.set({
    notice: qa.blocked
      ? {
          kind: 'info',
          text: '精灵把问题挡了回来——它真的不知道单件的真伪，这正是教学想让你看到的。',
        }
      : null,
  });
  persistActiveRun();
}

/* ------------------------------------------------------------------ */
/* 生成 / 续玩                                                          */
/* ------------------------------------------------------------------ */

export async function startGeneratedLevel(): Promise<void> {
  const state = store.get();
  if (state.busy) return;
  const restored = leaveTutorialIfNeeded(state);
  const client = deepseekOf(state.settings);
  if (!client) {
    store.set({
      screen: 'settings',
      notice: { kind: 'error', text: '还没有 DeepSeek Key：请在设置页填入后再穿越。' },
    });
    return;
  }

  const seed = state.nextSeed;
  const player = restored ?? state.player;
  clearActiveRun();
  store.set({
    screen: 'travel',
    notice: null,
    player,
    tutorial: emptyTutorialProgress(),
    busy: {
      kind: 'travel',
      message: `正在穿越到「${seed.genre}」…`,
      ratio: 0,
      slots: [],
      logs: ['抽到世界种子：' + seed.genre],
    },
  });

  try {
    const generated = await generateLevel(
      { client },
      {
        seed,
        difficulty: player.level,
        funds: player.funds,
        hooks: {
          onAttempt: (attempt, previousError) => {
            const current = store.get();
            if (!current.busy) return;
            const logs = [...current.busy.logs];
            if (previousError) logs.push(`校准失败：${previousError.slice(0, 80)}`);
            logs.push(
              attempt === 1
                ? '星图校准中，等待 DeepSeek 铺开世界…'
                : `第 ${attempt} 次重试（定向修正）…`,
            );
            store.set({
              busy: {
                ...current.busy,
                message:
                  attempt === 1
                    ? `正在穿越到「${seed.genre}」…`
                    : `星图校准中（第 ${attempt} 次）…`,
                logs: logs.slice(-6),
              },
            });
          },
          onWarnings: (warnings) => {
            const current = store.get();
            if (!current.busy || warnings.length === 0) return;
            store.set({
              busy: {
                ...current.busy,
                logs: [...current.busy.logs, ...warnings.map((line) => `校正：${line}`)].slice(-6),
              },
            });
          },
        },
      },
    );

    const level = generated.level;
    await gameCache.saveLevel(level);
    const session = new LevelSession(level, store.get().player);
    store.set({
      level,
      session,
      demoMode: false,
      attempts: generated.attempts,
      busy: null,
      screen: 'travel',
      models: {},
      offerOpenFor: null,
      decisions: {},
      inspectItemId: null,
      recyclePlan: {},
      resumeAvailable: true,
      notice: {
        kind: 'success',
        text:
          generated.warnings.length > 0
            ? `「${level.world.name}」已就绪（${generated.warnings.length} 处数值已校正）`
            : `「${level.world.name}」已就绪`,
      },
    });
    persistActiveRun();
    void refreshModels(level);
  } catch (error) {
    store.set({
      busy: null,
      notice: { kind: 'error', text: describeError(error) },
    });
  }
}

/** 3D 并行补货：不阻塞世界观展示（错峰体验，方案 M8）。可被 cancelModelGeneration 取消。 */
async function refreshModels(level: LevelJson): Promise<void> {
  const settings = store.get().settings;
  const lux3d = lux3dOf(settings);
  const slots = createSlotProgress(
    level,
    Object.fromEntries(level.stalls.map((stall) => [stall.itemId, 'running' as const])),
  );
  modelAbortController?.abort();
  const controller = new AbortController();
  modelAbortController = controller;

  store.set({
    busy: {
      kind: 'models',
      message: lux3d ? '集市布展中：5 件珍宝并行生成' : '未配置 Lux3D Key：先用占位模型布展',
      ratio: 0,
      slots,
      logs: [
        lux3d
          ? 'Three.js 检视会在模型到位后逐件加载。'
          : '在设置页填入 Lux3D Key 可生成真实 3D 珍宝。',
      ],
    },
  });

  const result = await ensureLevelModels(
    level,
    { lux3d, cache: gameCache },
    {
      signal: controller.signal,
      onProgress: (progress) => {
        const current = store.get();
        if (!current.busy || current.busy.kind !== 'models') return;
        store.set({ busy: applyModelProgress(current.busy, progress) });
      },
    },
  );

  if (store.get().level?.id !== level.id) {
    if (modelAbortController === controller) modelAbortController = null;
    return;
  }
  if (modelAbortController === controller) modelAbortController = null;
  if (controller.signal.aborted) {
    store.set({ models: result.models, busy: null });
    return;
  }

  const failed = Object.keys(result.errors).length;
  store.set({
    models: result.models,
    busy: null,
    notice: failed
      ? { kind: 'error', text: `${failed} 件 3D 生成失败（已重试），已用占位模型顶上。` }
      : result.creditsSpent > 0
        ? { kind: 'success', text: `3D 珍宝已上架，本关消耗约 ${result.creditsSpent} 积分。` }
        : {
            kind: 'info',
            text: '未配置 Lux3D Key：本关用程序化占位模型演示，填入 Key 后可生成真实 GLB。',
          },
  });
  persistActiveRun();
}

export function cancelModelGeneration(): void {
  if (!modelAbortController) {
    store.set({ notice: { kind: 'info', text: '当前没有正在进行的 3D 生成。' } });
    return;
  }
  modelAbortController.abort();
  modelAbortController = null;
  if (store.get().busy?.kind === 'models') {
    store.set({
      busy: null,
      notice: { kind: 'info', text: '已停止布展：保留已完成 / 缓存件，其余用占位模型。' },
    });
  }
}

export function startDemoLevel(): void {
  const state = store.get();
  if (state.busy) return;
  const restored = leaveTutorialIfNeeded(state);
  clearActiveRun();
  const level = createDemoLevel();
  const player = restored ?? state.player;
  const session = new LevelSession(level, player);
  store.set({
    level,
    session,
    player,
    demoMode: true,
    screen: 'travel',
    models: {},
    busy: null,
    offerOpenFor: null,
    decisions: {},
    inspectItemId: null,
    recyclePlan: {},
    resumeAvailable: true,
    tutorial: emptyTutorialProgress(),
    notice: { kind: 'info', text: '演示关卡：不调用任何 API，3D 用程序化占位模型。' },
  });
  persistActiveRun();
  void loadCachedModels(level, gameCache).then((models) => {
    if (store.get().level?.id === level.id) store.set({ models });
  });
}

/* ------------------------------------------------------------------ */
/* 集市                                                                 */
/* ------------------------------------------------------------------ */

export function beginShopping(): void {
  const state = store.get();
  if (!state.session) return;
  const tutorial = isTutorialLevel(state.level)
    ? { ...state.tutorial, openedMarket: true }
    : state.tutorial;
  store.set({ screen: 'market', offerOpenFor: null, inspectItemId: null, tutorial });
  persistActiveRun();
}

export function openInspect(itemId: string): void {
  const state = store.get();
  const tutorial =
    isTutorialLevel(state.level) && !state.tutorial.inspected.includes(itemId)
      ? { ...state.tutorial, inspected: [...state.tutorial.inspected, itemId] }
      : state.tutorial;
  store.set({ screen: 'inspect', inspectItemId: itemId, offerOpenFor: null, tutorial });
}

export function backToMarket(): void {
  store.set({ screen: 'market', inspectItemId: null });
}

export function setOfferOpen(itemId: string | null): void {
  store.set({ offerOpenFor: itemId });
}

export async function submitOffer(itemId: string, offer: number): Promise<void> {
  const state = store.get();
  const session = state.session;
  if (!session) return;
  if (session.phase !== 'market') {
    store.set({ notice: { kind: 'error', text: '已经收摊了，回基地鉴宝吧。' } });
    return;
  }
  const tutorial = isTutorialLevel(state.level);
  const mode = tutorial || state.settings.quickBargain ? 'local' : 'hybrid';
  const client = tutorial ? null : mode === 'hybrid' ? deepseekOf(state.settings) : null;

  try {
    const decision = await session.submitOffer(itemId, offer, mode, client);
    persistPlayer();
    persistActiveRun();
    const next = store.get();
    store.set({
      player: session.player,
      decisions: { ...next.decisions, [itemId]: { ...decision, offer } },
      offerOpenFor: decision.accept ? null : next.offerOpenFor,
      ...(decision.accept
        ? { notice: { kind: 'success' as const, text: `成交：${offer} 星际币。${decision.line}` } }
        : decision.code === 'below-floor'
          ? { notice: { kind: 'error' as const, text: decision.line } }
          : {}),
    });

    const end = session.endCheck();
    if (end.end) {
      closeMarket(end.message ?? '集市散了。');
    }
  } catch (error) {
    store.set({ notice: { kind: 'error', text: `议价失败：${describeError(error)}` } });
  }
}

export async function askFairyQuestion(question: string): Promise<void> {
  const state = store.get();
  const session = state.session;
  if (!session || state.fairyBusy) return;
  if (isTutorialLevel(state.level)) {
    store.set({ notice: { kind: 'info', text: '教学关卡不调用模型：请用下方的预设问题。' } });
    return;
  }
  const client = deepseekOf(state.settings);
  if (!client) {
    store.set({
      notice: { kind: 'error', text: '精灵需要 DeepSeek Key 才能开口（设置页填入）。' },
    });
    return;
  }
  store.set({ fairyBusy: true, fairyDraftError: null });
  try {
    await session.ask(client, question);
    persistActiveRun();
    store.set({ fairyBusy: false });
  } catch (error) {
    store.set({
      fairyBusy: false,
      notice: { kind: 'error', text: `精灵哑火了：${describeError(error)}（本问不扣次数）` },
    });
  }
}

export function toggleFairyPanel(open?: boolean): void {
  const state = store.get();
  store.set({ fairyOpen: open ?? !state.fairyOpen });
}

export function closeMarket(message?: string): void {
  const state = store.get();
  const session = state.session;
  if (!session || !state.level) return;
  session.closeMarket();
  persistPlayer();
  persistActiveRun();
  const recyclePlan: Record<string, boolean> = {};
  for (const stall of state.level.stalls) {
    recyclePlan[stall.itemId] = session.itemOf(stall.itemId)?.status === 'purchased';
  }
  store.set({
    screen: 'base',
    player: session.player,
    recyclePlan,
    notice: message ? { kind: 'info', text: message } : null,
    offerOpenFor: null,
    fairyOpen: false,
  });
}

export function toggleRecycle(itemId: string): void {
  const state = store.get();
  store.set({
    recyclePlan: { ...state.recyclePlan, [itemId]: !state.recyclePlan[itemId] },
  });
}

export function settleNow(): void {
  const state = store.get();
  const session = state.session;
  const level = state.level;
  if (!session || !level) return;
  const plan = level.stalls
    .filter((stall) => session.itemOf(stall.itemId)?.status === 'purchased')
    .map((stall) => ({ itemId: stall.itemId, recycle: state.recyclePlan[stall.itemId] ?? true }));
  const settlement = session.settle(plan);
  const tutorial = isTutorialLevel(level);

  if (tutorial) {
    markTutorialCompleted();
  } else {
    saveProfile(session.player);
    persistActiveRun();
  }

  store.set({
    player: session.player,
    models: tutorial ? state.models : {},
    tutorialCompleted: tutorial ? true : state.tutorialCompleted,
    notice: {
      kind: settlement.net >= 0 ? 'success' : 'error',
      text: tutorial
        ? `教学关卡已通关（净收益 ${settlement.net} 星际币）。随时可以在开始页重玩。`
        : settlement.net >= 0
          ? `本关净赚 ${settlement.net} 星际币，经验 +${settlement.xpGain}`
          : `本关净亏 ${Math.abs(settlement.net)} 星际币，经验不变`,
    },
  });
}

export function nextLevel(): void {
  const state = store.get();
  const restored = leaveTutorialIfNeeded(state);
  if (!isTutorialLevel(state.level)) clearActiveRun();
  const player = restored ?? state.player;
  if (player.funds < 1) {
    restartSoft();
    return;
  }
  store.set({
    screen: 'travel',
    player,
    level: null,
    session: null,
    models: {},
    inspectItemId: null,
    decisions: {},
    recyclePlan: {},
    offerOpenFor: null,
    busy: null,
    demoMode: false,
    resumeAvailable: false,
    tutorial: emptyTutorialProgress(),
    nextSeed: pickSeed(Math.random, state.nextSeed.id),
    notice: null,
  });
}

/** 盘缠耗尽：保留等级，资金回 1000（方案 L11 软重开）。 */
export function restartSoft(): void {
  const state = store.get();
  const restored = leaveTutorialIfNeeded(state);
  const base = restored ?? state.player;
  const xp = Math.max(0, base.xp);
  const next: PlayerState = { funds: 1000, xp, level: levelForXp(xp) };
  clearActiveRun();
  if (restored || !isTutorialLevel(state.level)) saveProfile(next);
  store.set({
    player: next,
    screen: 'travel',
    level: null,
    session: null,
    models: {},
    decisions: {},
    recyclePlan: {},
    inspectItemId: null,
    offerOpenFor: null,
    busy: null,
    demoMode: false,
    resumeAvailable: false,
    tutorial: emptyTutorialProgress(),
    nextSeed: pickSeed(),
    notice: { kind: 'info', text: '盘缠已补足到 1000 星际币，等级保留。' },
  });
}

/** 调试用：把当前随机种子固定下来（控制台复现某关）。 */
export function forceSeed(seed: WorldSeed): void {
  store.set({ nextSeed: seed });
}
