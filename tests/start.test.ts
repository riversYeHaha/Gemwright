import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { LevelSession } from '../src/game/level';
import { disposeStartBackdrop } from '../src/render/startBackdrop';
import { renderStart } from '../src/ui/screens/start';
import { DEFAULT_SETTINGS } from '../src/store/settings';

afterEach(() => {
  disposeStartBackdrop();
});

describe('开始页', () => {
  it('常规主菜单：新游戏 / 继续游戏 / 设置 / 游戏说明，且挂载黑洞 canvas', () => {
    const state = {
      ...bootstrapState(),
      settings: { ...DEFAULT_SETTINGS },
      level: null,
      session: null,
      resumeAvailable: false,
    };
    const el = renderStart(state);

    expect(el.textContent).toContain('珍宝猎人');
    expect(el.textContent).toContain('你以为你在砍价，其实你在鉴定');
    expect(el.textContent).toContain('新游戏');
    expect(el.textContent).toContain('继续游戏');
    expect(el.textContent).toContain('设置');
    expect(el.textContent).toContain('游戏说明');
    expect(el.textContent).toContain('暂无存档');

    const actions = [...el.querySelectorAll<HTMLButtonElement>('[data-action]')].map(
      (node) => node.dataset.action,
    );
    expect(actions).toEqual(['new', 'continue', 'settings', 'guide']);

    const continueButton = el.querySelector<HTMLButtonElement>('[data-action="continue"]');
    expect(continueButton?.disabled).toBe(true);
    expect(el.querySelector('[data-action="new"]')).not.toBeNull();

    // 背景层挂了一块 canvas（测试环境没有 2D context 时安静降级，但节点仍在）。
    expect(el.querySelector('.start__backdrop canvas')).not.toBeNull();
  });

  it('有续玩快照时「继续游戏」可用，并显示世界与阶段', () => {
    const level = createDemoLevel(1);
    const session = new LevelSession(level, { funds: 900, xp: 0, level: 1 });
    const state = {
      ...bootstrapState(),
      settings: { ...DEFAULT_SETTINGS, deepseekKey: 'sk-test' },
      level,
      session,
      resumeAvailable: true,
      player: session.player,
      tutorialCompleted: true,
    };
    const el = renderStart(state);

    const continueButton = el.querySelector<HTMLButtonElement>('[data-action="continue"]');
    expect(continueButton?.disabled).toBe(false);
    expect(el.textContent).toContain('烬岩坊市');
    expect(el.textContent).toContain('集市阶段');
    expect(el.textContent).toContain('教学已通关');
    expect(el.textContent).toContain('DeepSeek');
  });
});
