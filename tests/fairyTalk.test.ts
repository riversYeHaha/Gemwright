import { describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { createTutorialLevel } from '../src/game/tutorial/level';
import { LevelSession } from '../src/game/level';
import { fairyDisplayName, fairyReaction, selfTalkLine, snapshotOf } from '../src/ui/fairyTalk';

function tutorialState() {
  const level = createTutorialLevel();
  const session = new LevelSession(level, { funds: 1000, xp: 0, level: 1 });
  return {
    ...bootstrapState(),
    screen: 'market' as const,
    level,
    session,
    player: session.player,
  };
}

describe('精灵动作匹配与自言自语', () => {
  it('新关卡 → 说话；被防火墙挡回 → 难过；思考中 → think', () => {
    const state = tutorialState();
    const first = snapshotOf(state);
    expect(fairyReaction(null, first)).toMatchObject({ action: 'talk' });
    expect(fairyReaction(first, { ...first, logLength: 1, lastBlocked: true })).toMatchObject({
      action: 'sad',
    });
    expect(fairyReaction(first, { ...first, logLength: 1, lastBlocked: false })).toMatchObject({
      action: 'talk',
    });
    expect(fairyReaction(first, { ...first, purchased: 1 })).toMatchObject({ action: 'happy' });
    expect(fairyReaction(first, { ...first, fairyBusy: true })).toMatchObject({ action: 'think' });
  });

  it('询问额度耗尽 / 收摊 / 错误提示都会切动作', () => {
    const state = tutorialState();
    const first = snapshotOf(state);
    expect(fairyReaction({ ...first, askLeft: 1 }, { ...first, askLeft: 0 })).toMatchObject({
      action: 'alert',
    });
    expect(fairyReaction({ ...first, phase: 'market' }, { ...first, phase: 'base' })).toMatchObject(
      {
        action: 'alert',
      },
    );
    expect(
      fairyReaction(
        { ...first, noticeKind: null, noticeText: null },
        { ...first, noticeKind: 'error', noticeText: '断网了' },
      ),
    ).toMatchObject({ action: 'sad' });
  });

  it('自言自语来自静态台词池，包含教学 / 额度语境', () => {
    const state = tutorialState();
    const line = selfTalkLine(state, () => 0);
    expect(line.length).toBeGreaterThan(4);
    expect(line).not.toContain('isAuthentic');
    expect(line).not.toContain('底价');
    expect(fairyDisplayName(state)).toEqual({ name: '鎏金', persona: '毒舌学者' });
  });
});
