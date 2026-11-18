import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { createTutorialLevel } from '../src/game/tutorial/level';
import { LevelSession } from '../src/game/level';
import type { AppState } from '../src/app/store';
import { store } from '../src/app/store';
import {
  disposeFairyCompanion,
  fairyCompanionDebug,
  updateFairyCompanion,
} from '../src/ui/fairyCompanion';

function marketState(): AppState {
  const level = createTutorialLevel();
  const session = new LevelSession(level, { funds: 1000, xp: 0, level: 1 });
  return {
    ...bootstrapState(),
    screen: 'market',
    level,
    session,
    player: session.player,
    resumeAvailable: true,
  };
}

afterEach(() => {
  disposeFairyCompanion();
  document.body.innerHTML = '';
});

describe('右下角常驻精灵', () => {
  it('开始页隐藏，进入游戏后显示并打招呼', () => {
    updateFairyCompanion({ ...bootstrapState(), screen: 'start' });
    let root = document.querySelector<HTMLElement>('[data-fairy-companion]');
    expect(root).not.toBeNull();
    expect(root?.classList.contains('is-visible')).toBe(false);
    expect(document.body.classList.contains('has-fairy')).toBe(false);

    updateFairyCompanion(marketState());
    root = document.querySelector<HTMLElement>('[data-fairy-companion]');
    expect(root?.classList.contains('is-visible')).toBe(true);
    expect(document.body.classList.contains('has-fairy')).toBe(true);
    expect(root?.textContent).toContain('鎏金');
    expect(root?.dataset.action).toBe('talk');
    expect(fairyCompanionDebug().bubble.length).toBeGreaterThan(0);

    const canvas = root?.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('双击常驻精灵会打开集市精灵面板', () => {
    store.set({ fairyOpen: false });
    updateFairyCompanion(marketState());
    const stage = document.querySelector<HTMLButtonElement>('button.fairy-companion__stage');
    expect(stage).not.toBeNull();
    stage?.click();
    stage?.click();
    expect(store.get().fairyOpen).toBe(true);
  });

  it('离开游戏屏后隐藏并清掉常驻状态', () => {
    updateFairyCompanion(marketState());
    updateFairyCompanion({ ...marketState(), screen: 'start', level: null, session: null });
    const root = document.querySelector<HTMLElement>('[data-fairy-companion]');
    expect(root?.classList.contains('is-visible')).toBe(false);
    expect(document.body.classList.contains('has-fairy')).toBe(false);
  });
});
