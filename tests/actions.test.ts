import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as actions from '../src/app/actions';
import { store } from '../src/app/store';
import { loadProfile, saveProfile } from '../src/store/cache';
import { DEFAULT_SETTINGS } from '../src/store/settings';

const sentinel = { funds: 777, xp: 500, level: 2 };

function reset(): void {
  localStorage.clear();
  // 教学关会尝试读取 public/models/manifest.json；测试里直接 404，避免真实网络请求。
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  );
  saveProfile(sentinel);
  store.set({
    ...actions.bootstrapState(),
    settings: { ...DEFAULT_SETTINGS, deepseekKey: 'sk-test' },
  });
}

describe('教学关卡：不碰真实存档、不调模型', () => {
  beforeEach(reset);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('从开始页进入教学 → 走完六步 → 回到开始页后存档原样', async () => {
    actions.startTutorial();
    let state = store.get();
    expect(state.screen).toBe('travel');
    expect(state.level?.kind).toBe('tutorial');
    expect(state.player.funds).toBe(1000);
    expect(state.player.level).toBe(1);

    actions.beginShopping();
    state = store.get();
    expect(state.screen).toBe('market');
    expect(state.tutorial.openedMarket).toBe(true);

    actions.openInspect('T1');
    actions.openInspect('T2');
    expect(store.get().tutorial.inspected).toEqual(['T1', 'T2']);

    actions.askTutorialQuestion('spec');
    expect(store.get().session?.state.askUsed).toBe(1);
    expect(store.get().session?.state.fairyLog[0]?.blocked).toBe(false);

    await actions.submitOffer('T1', 320);
    await actions.submitOffer('T2', 300);
    state = store.get();
    expect(state.session?.itemOf('T1')).toMatchObject({ status: 'purchased', purchasePrice: 320 });
    expect(state.session?.itemOf('T2')).toMatchObject({ status: 'purchased', purchasePrice: 300 });
    expect(state.screen).toBe('base');

    actions.settleNow();
    state = store.get();
    expect(state.tutorialCompleted).toBe(true);
    expect(state.player.funds).toBe(1175);
    expect(state.player.xp).toBe(175);
    expect(loadProfile()).toEqual(sentinel);

    actions.goStart();
    state = store.get();
    expect(state.screen).toBe('start');
    expect(state.player.funds).toBe(777);
    expect(state.level).toBeNull();
    expect(state.tutorialCompleted).toBe(true);
  });

  it('教学问答不改变额度规则：连问会耗尽', () => {
    actions.startTutorial();
    actions.beginShopping();
    for (const qaId of ['spec', 'market', 'forgery', 'price', 'which']) {
      actions.askTutorialQuestion(qaId);
    }
    const session = store.get().session!;
    expect(session.state.askUsed).toBe(5);
    actions.askTutorialQuestion('spec');
    expect(session.state.askUsed).toBe(5);
    expect(store.get().notice?.text).toContain('已经问过');
  });
});
