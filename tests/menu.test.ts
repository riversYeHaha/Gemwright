import { describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { LevelSession } from '../src/game/level';
import { renderGuide } from '../src/ui/screens/guide';
import { renderNewGame } from '../src/ui/screens/newgame';
import { DEFAULT_SETTINGS } from '../src/store/settings';

describe('新游戏页 / 游戏说明页', () => {
  it('新游戏页给出教学、正式、演示三种开局', () => {
    const el = renderNewGame({
      ...bootstrapState(),
      settings: { ...DEFAULT_SETTINGS },
      resumeAvailable: false,
    });
    expect(el.textContent).toContain('教学关卡');
    expect(el.textContent).toContain('正式开局');
    expect(el.textContent).toContain('演示关卡');
    expect(el.textContent).toContain('无需 Key');
    expect(el.querySelectorAll('.mode-card')).toHaveLength(3);
  });

  it('有续玩快照时新游戏页提示会覆盖，并提供继续入口', () => {
    const level = createDemoLevel(1);
    const session = new LevelSession(level, { funds: 1000, xp: 0, level: 1 });
    const el = renderNewGame({
      ...bootstrapState(),
      settings: { ...DEFAULT_SETTINGS },
      level,
      session,
      resumeAvailable: true,
    });
    expect(el.textContent).toContain('会覆盖续玩快照');
    expect(el.textContent).toContain('继续这一局');
  });

  it('游戏说明页覆盖循环、判定、精灵边界与额度', () => {
    const el = renderGuide();
    expect(el.textContent).toContain('一局怎么走');
    expect(el.textContent).toContain('怎么判断真伪');
    expect(el.textContent).toContain('色族');
    expect(el.textContent).toContain('颗数');
    expect(el.textContent).toContain('精灵知道什么、不知道什么');
    expect(el.textContent).toContain('议价额度');
    expect(el.textContent).toContain('进入教学关卡');
  });
});
