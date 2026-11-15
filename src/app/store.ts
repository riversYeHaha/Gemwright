import type { BargainDecision, LevelJson, TutorialProgress } from '../types/level';
import type { ClientSettings } from '../store/settings';
import type { PlayerState } from '../types/level';
import type { ModelStatus, ModelProgress } from '../game/generation';
import type { LevelSession } from '../game/level';
import type { ModelMap } from '../store/cache';
import { pickSeed, type WorldSeed } from '../game/seeds';
import { DEFAULT_SETTINGS } from '../store/settings';

/** 5 屏：设置 / 穿越 / 集市（含精灵侧栏）/ 验货 / 基地。 */
export type ScreenName = 'start' | 'settings' | 'travel' | 'market' | 'inspect' | 'base';

export interface SlotProgress {
  itemId: string;
  name: string;
  status: ModelStatus;
  message?: string;
}

export interface BusyState {
  kind: 'travel' | 'models';
  message: string;
  /** 集市布展进度 0~1（五格进度条）。 */
  ratio: number;
  slots: SlotProgress[];
  logs: string[];
}

export interface Notice {
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface AppState {
  screen: ScreenName;
  settings: ClientSettings;
  player: PlayerState;
  level: LevelJson | null;
  session: LevelSession | null;
  models: ModelMap;
  inspectItemId: string | null;
  busy: BusyState | null;
  notice: Notice | null;
  nextSeed: WorldSeed;
  offerOpenFor: string | null;
  decisions: Record<string, BargainDecision & { offer: number }>;
  fairyOpen: boolean;
  fairyBusy: boolean;
  fairyDraftError: string | null;
  recyclePlan: Record<string, boolean>;
  demoMode: boolean;
  attempts: number;
  /** 是否有可续玩的关卡（刷新后从 active run 恢复）。 */
  resumeAvailable: boolean;
  /** 教学关卡进度（仅教学关有效；刷新不保留）。 */
  tutorial: TutorialProgress;
  /** 教学是否已经完整通关过（localStorage）。 */
  tutorialCompleted: boolean;
}

export type Listener = (state: AppState) => void;

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function createSlotProgress(
  level: LevelJson,
  statuses: Record<string, ModelStatus> = {},
): SlotProgress[] {
  return level.stalls.map((stall) => ({
    itemId: stall.itemId,
    name: stall.item.name,
    status: statuses[stall.itemId] ?? 'running',
  }));
}

export function applyModelProgress(busy: BusyState, progress: ModelProgress): BusyState {
  const slots = busy.slots.map((slot) =>
    slot.itemId === progress.itemId
      ? {
          ...slot,
          status: progress.status,
          ...(progress.message ? { message: progress.message } : {}),
        }
      : slot,
  );
  const done = slots.filter(
    (slot) =>
      slot.status === 'done' ||
      slot.status === 'cached' ||
      slot.status === 'failed' ||
      slot.status === 'skipped',
  ).length;
  const logs = [
    ...busy.logs,
    `[${progress.index + 1}/${progress.total}] ${progress.itemName}：${labelOfStatus(progress.status)}${
      progress.message ? `（${progress.message}）` : ''
    }`,
  ].slice(-6);
  return {
    ...busy,
    slots,
    logs,
    ratio: slots.length > 0 ? done / slots.length : 0,
  };
}

export function labelOfStatus(status: ModelStatus): string {
  switch (status) {
    case 'cached':
      return '读取本地缓存';
    case 'running':
      return '布展中';
    case 'done':
      return '已上架';
    case 'failed':
      return '生成失败（占位模型顶上）';
    case 'skipped':
      return '未配置 Key（占位模型）';
  }
}

/** 全局单例：main.ts 启动时用 bootstrapState() 覆盖为真实存档。 */
function defaultState(): AppState {
  return {
    screen: 'settings',
    settings: { ...DEFAULT_SETTINGS },
    player: { funds: 1000, xp: 0, level: 1 },
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
    tutorial: { inspected: [], openedMarket: false },
    tutorialCompleted: false,
  };
}

export const store = new Store(defaultState());
