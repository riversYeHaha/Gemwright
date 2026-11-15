import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { LevelSession } from '../src/game/level';
import { ACTIVE_RUN_KEY, clearActiveRun, loadActiveRun, saveActiveRun } from '../src/store/cache';
import type { LevelRuntime } from '../src/types/level';

const level = createDemoLevel(1_700_000_000_000);

function runtime(overrides: Partial<LevelRuntime> = {}): LevelRuntime {
  return {
    levelId: level.id,
    difficulty: level.difficulty,
    phase: 'market',
    items: Object.fromEntries(
      level.stalls.map((stall) => [
        stall.itemId,
        { itemId: stall.itemId, status: 'listed' as const, offers: [], rejectedPrices: [] },
      ]),
    ),
    offersUsed: 0,
    askUsed: 0,
    fairyLog: [],
    startedAt: 1,
    ...overrides,
  };
}

describe('刷新续玩', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('快照可存可读；清空后读回 null', () => {
    saveActiveRun({
      version: 1,
      savedAt: 123,
      player: { funds: 880, xp: 120, level: 1 },
      level,
      runtime: runtime({ offersUsed: 3 }),
    });
    const loaded = loadActiveRun();
    expect(loaded?.player.funds).toBe(880);
    expect(loaded?.level.id).toBe(level.id);
    expect(loaded?.runtime.offersUsed).toBe(3);
    clearActiveRun();
    expect(loadActiveRun()).toBeNull();
  });

  it('坏数据 / 旧版本不会把游戏带崩', () => {
    localStorage.setItem(ACTIVE_RUN_KEY, '{not json');
    expect(loadActiveRun()).toBeNull();
    localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify({ version: 99 }));
    expect(loadActiveRun()).toBeNull();
  });

  it('LevelSession.fromRuntime 能恢复额度、成交与阶段', () => {
    const snapshot = runtime({
      phase: 'base',
      offersUsed: 4,
      askUsed: 2,
      items: {
        ...runtime().items,
        T1: {
          itemId: 'T1',
          status: 'purchased',
          purchasePrice: 480,
          offers: [{ price: 480, accepted: true, round: 1, source: 'local', at: 1 }],
          rejectedPrices: [],
        },
      },
      fairyLog: [{ question: '问', answer: '答', blocked: false, at: 1 }],
    });
    const session = LevelSession.fromRuntime(level, { funds: 700, xp: 0, level: 1 }, snapshot);
    expect(session.phase).toBe('base');
    expect(session.state.offersUsed).toBe(4);
    expect(session.state.askUsed).toBe(2);
    expect(session.itemOf('T1')).toMatchObject({ status: 'purchased', purchasePrice: 480 });
    expect(session.availableFunds).toBe(220);
  });

  it('bootstrapState 从快照恢复：落在开始页并提供「继续」', () => {
    saveActiveRun({
      version: 1,
      savedAt: 1,
      player: { funds: 880, xp: 120, level: 1 },
      level,
      runtime: runtime({ phase: 'base' }),
    });
    const state = bootstrapState();
    expect(state.screen).toBe('start');
    expect(state.resumeAvailable).toBe(true);
    expect(state.level?.id).toBe(level.id);
    expect(state.session?.phase).toBe('base');
    expect(state.player.funds).toBe(880);
  });
});
