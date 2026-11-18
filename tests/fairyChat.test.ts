import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import { createTutorialLevel } from '../src/game/tutorial/level';
import { LevelSession } from '../src/game/level';
import type { AppState } from '../src/app/store';
import { disposeFairyChat, updateFairyChat } from '../src/ui/fairyChat';

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
    fairyOpen: true,
  };
}

afterEach(() => {
  disposeFairyChat();
  document.body.innerHTML = '';
});

describe('精灵对话浮窗', () => {
  it('集市双击后在当前页出现问答浮窗，不改造页面布局', () => {
    updateFairyChat(marketState());
    const root = document.querySelector<HTMLElement>('.fairy-chat');
    expect(root).not.toBeNull();
    expect(root?.hidden).toBe(false);
    expect(root?.textContent).toContain('精灵「鎏金」');
    expect(root?.querySelectorAll('.fairy-question').length).toBeGreaterThan(0);
    expect(root?.querySelector('input')).toBeNull();
    expect(root?.textContent).toContain('关闭');
  });

  it('非集市页面提供闲聊输入，不消耗询问额度', () => {
    updateFairyChat({ ...marketState(), screen: 'travel' });
    const root = document.querySelector<HTMLElement>('.fairy-chat');
    expect(root?.hidden).toBe(false);
    expect(root?.textContent).toContain('闲聊');
    expect(root?.textContent).toContain('不消耗询问额度');
    const input = root?.querySelector('input');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('placeholder')).toContain('不消耗询问额度');
  });

  it('开始页即使 fairyOpen 也不显示，关闭后隐藏', () => {
    updateFairyChat({ ...bootstrapState(), screen: 'start', fairyOpen: true });
    let root = document.querySelector<HTMLElement>('.fairy-chat');
    expect(root?.hidden).toBe(true);

    updateFairyChat({ ...marketState(), fairyOpen: false });
    root = document.querySelector<HTMLElement>('.fairy-chat');
    expect(root?.hidden).toBe(true);
  });
});
