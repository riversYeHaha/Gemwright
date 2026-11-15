import { describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { LevelSession } from '../src/game/level';
import { renderStart } from '../src/ui/screens/start';
import { DEFAULT_SETTINGS } from '../src/store/settings';

describe('开始页', () => {
  it('无 Key / 无进度时：教学入口 + 开始游戏 + 演示入口', () => {
    const state = {
      ...bootstrapState(),
      settings: { ...DEFAULT_SETTINGS },
      resumeAvailable: false,
    };
    const el = renderStart(state);
    expect(el.textContent).toContain('珍宝猎人');
    expect(el.textContent).toContain('你以为你在砍价，其实你在鉴定');
    expect(el.textContent).toContain('开始游戏');
    expect(el.textContent).toContain('教学关卡');
    expect(el.textContent).toContain('演示关卡');
    expect(el.textContent).toContain('DeepSeek 未配置');
  });

  it('有续玩快照时主按钮变成「继续上一局」，并显示停留的世界', () => {
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
    expect(el.textContent).toContain('继续上一局');
    expect(el.textContent).toContain('烬岩坊市');
    expect(el.textContent).toContain('教学已通关');
    expect(el.textContent).toContain('DeepSeek 已配置');
  });
});
