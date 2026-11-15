import { DeepSeekClient } from '../api/deepseek';
import { Lux3DClient } from '../api/lux3d';
import { createDemoLevel } from '../game/fixtures/demoLevel';
import { ensureLevelModels, generateLevel, loadCachedModels } from '../game/generation';
import { LevelSession } from '../game/level';
import { levelForXp } from '../game/economy';
import { pickSeed, type WorldSeed } from '../game/seeds';
import type { LevelJson, PlayerState } from '../types/level';
import { clearProfile, gameCache, loadProfile, saveProfile } from '../store/cache';
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
 */

export function bootstrapState(): AppState {
  const settings = loadSettings();
  const player = loadProfile() ?? { funds: 1000, xp: 0, level: 1 };
  return {
    screen: hasDeepSeekKey(settings) ? 'travel' : 'settings',
    settings,
    player,
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
  };
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

export function navigate(screen: ScreenName): void {
  store.set({ screen });
}

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
  const player = { funds: 1000, xp: 0, level: 1 };
  store.set({
    player,
    level: null,
    session: null,
    models: {},
    decisions: {},
    recyclePlan: {},
    demoMode: false,
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

export async function startGeneratedLevel(): Promise<void> {
  const state = store.get();
  if (state.busy) return;
  const client = deepseekOf(state.settings);
  if (!client) {
    store.set({
      screen: 'settings',
      notice: { kind: 'error', text: '还没有 DeepSeek Key：请在设置页填入后再穿越。' },
    });
    return;
  }

  const seed = state.nextSeed;
  const player = state.player;
  store.set({
    screen: 'travel',
    notice: null,
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
            logs.push(attempt === 1 ? '星图校准中，等待 DeepSeek 铺开世界…' : `第 ${attempt} 次重试（定向修正）…`);
            store.set({
              busy: {
                ...current.busy,
                message: attempt === 1 ? `正在穿越到「${seed.genre}」…` : `星图校准中（第 ${attempt} 次）…`,
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
      notice: {
        kind: 'success',
        text:
          generated.warnings.length > 0
            ? `「${level.world.name}」已就绪（${generated.warnings.length} 处数值已校正）`
            : `「${level.world.name}」已就绪`,
      },
    });

    void refreshModels(level);
  } catch (error) {
    store.set({
      busy: null,
      notice: { kind: 'error', text: describeError(error) },
    });
  }
}

/** 3D 并行补货：不阻塞世界观展示（错峰体验，方案 M8）。 */
async function refreshModels(level: LevelJson): Promise<void> {
  const settings = store.get().settings;
  const lux3d = lux3dOf(settings);
  const slots = createSlotProgress(level, Object.fromEntries(level.stalls.map((stall) => [stall.itemId, 'running' as const])));
  store.set({
    busy: {
      kind: 'models',
      message: lux3d ? '集市布展中：5 件珍宝并行生成' : '未配置 Lux3D Key：先用占位模型布展',
      ratio: 0,
      slots,
      logs: [lux3d ? 'Three.js 检视会在模型到位后逐件加载。' : '在设置页填入 Lux3D Key 可生成真实 3D 珍宝。'],
    },
  });

  const result = await ensureLevelModels(
    level,
    { lux3d, cache: gameCache },
    {
      onProgress: (progress) => {
        const current = store.get();
        if (!current.busy || current.busy.kind !== 'models') return;
        store.set({ busy: applyModelProgress(current.busy, progress) });
      },
    },
  );

  const failed = Object.keys(result.errors).length;
  store.set({
    models: result.models,
    busy: null,
    notice: failed
      ? { kind: 'error', text: `${failed} 件 3D 生成失败，已用占位模型顶上（可重开本关复用缓存）。` }
      : result.creditsSpent > 0
        ? { kind: 'success', text: `3D 珍宝已上架，本关消耗约 ${result.creditsSpent} 积分。` }
        : { kind: 'info', text: '未配置 Lux3D Key：本关用程序化占位模型演示，填入 Key 后可生成真实 GLB。' },
  });
}

export function startDemoLevel(): void {
  if (store.get().busy) return;
  const level = createDemoLevel();
  const session = new LevelSession(level, store.get().player);
  store.set({
    level,
    session,
    demoMode: true,
    screen: 'travel',
    models: {},
    busy: null,
    offerOpenFor: null,
    decisions: {},
    inspectItemId: null,
    recyclePlan: {},
    notice: { kind: 'info', text: '演示关卡：不调用任何 API，3D 用程序化占位模型。' },
  });
  void loadCachedModels(level, gameCache).then((models) => store.set({ models }));
}

export function beginShopping(): void {
  if (!store.get().session) return;
  store.set({ screen: 'market', offerOpenFor: null, inspectItemId: null });
}

export function openInspect(itemId: string): void {
  store.set({ screen: 'inspect', inspectItemId: itemId, offerOpenFor: null });
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
  const mode = state.settings.quickBargain ? 'local' : 'hybrid';
  const client = mode === 'hybrid' ? deepseekOf(state.settings) : null;

  try {
    const decision = await session.submitOffer(itemId, offer, mode, client);
    saveProfile(session.player);
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
  const client = deepseekOf(state.settings);
  if (!client) {
    store.set({ notice: { kind: 'error', text: '精灵需要 DeepSeek Key 才能开口（设置页填入）。' } });
    return;
  }
  store.set({ fairyBusy: true, fairyDraftError: null });
  try {
    await session.ask(client, question);
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
  saveProfile(session.player);
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
  saveProfile(session.player);
  store.set({
    player: session.player,
    notice: {
      kind: settlement.net >= 0 ? 'success' : 'error',
      text:
        settlement.net >= 0
          ? `本关净赚 ${settlement.net} 星际币，经验 +${settlement.xpGain}`
          : `本关净亏 ${Math.abs(settlement.net)} 星际币，经验不变`,
    },
  });
}

export function nextLevel(): void {
  const state = store.get();
  if (state.player.funds < 1) {
    restartSoft();
    return;
  }
  store.set({
    screen: 'travel',
    level: null,
    session: null,
    models: {},
    inspectItemId: null,
    decisions: {},
    recyclePlan: {},
    offerOpenFor: null,
    busy: null,
    demoMode: false,
    nextSeed: pickSeed(Math.random, state.nextSeed.id),
    notice: null,
  });
}

/** 盘缠耗尽：保留等级，资金回 1000（方案 L11 软重开）。 */
export function restartSoft(): void {
  const player = store.get().player;
  const funds = 1000;
  const xp = Math.max(0, player.xp);
  const next: PlayerState = { funds, xp, level: levelForXp(xp) };
  saveProfile(next);
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
    nextSeed: pickSeed(),
    notice: { kind: 'info', text: '盘缠已补足到 1000 星际币，等级保留。' },
  });
}

/** 调试用：把当前随机种子固定下来（控制台复现某关）。 */
export function forceSeed(seed: WorldSeed): void {
  store.set({ nextSeed: seed });
}
