import { describe, expect, it } from 'vitest';
import { bootstrapState } from '../src/app/actions';
import type { AppState } from '../src/app/store';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import { LevelSession } from '../src/game/level';
import { renderBase } from '../src/ui/screens/base';
import { renderMarket } from '../src/ui/screens/market';
import { renderSettings } from '../src/ui/screens/settings';
import { renderTravel } from '../src/ui/screens/travel';
import { DEFAULT_SETTINGS } from '../src/store/settings';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    ...bootstrapState(),
    settings: { ...DEFAULT_SETTINGS, deepseekKey: 'sk-test', lux3dKey: '' },
    player: { funds: 1000, xp: 0, level: 1 },
    nextSeed: { id: 'S01', genre: '熔岩锻造城邦', priceIndexRange: [1.25, 1.6], mood: '铁水昼夜不息' },
    ...overrides,
  };
}

describe('UI 渲染冒烟', () => {
  it('设置页渲染两把 Key 与成本提示', () => {
    const el = renderSettings(state());
    expect(el.textContent).toContain('DeepSeek API Key');
    expect(el.textContent).toContain('Lux3D（Aholo）API Key');
    expect(el.textContent).toContain('65 积分');
    expect(el.querySelectorAll('input[type="password"]')).toHaveLength(2);
  });

  it('穿越页在没有关卡时给出种子与两个入口', () => {
    const el = renderTravel(state());
    expect(el.textContent).toContain('熔岩锻造城邦');
    expect(el.textContent).toContain('穿越生成');
    expect(el.textContent).toContain('演示关卡');
  });

  it('集市页渲染 5 件珍宝与精灵入口', () => {
    const level = createDemoLevel(1);
    const session = new LevelSession(level, { funds: 1000, xp: 0, level: 1 });
    const el = renderMarket(state({ screen: 'market', level, session }));
    expect(el.querySelectorAll('.stall-card')).toHaveLength(5);
    expect(el.textContent).toContain('星穹之核');
    expect(el.textContent).toContain('议价额度');
    expect(el.textContent).toContain('唤出精灵');
  });

  it('基地页逐件揭晓真伪与特征 diff', async () => {
    const level = createDemoLevel(1);
    const session = new LevelSession(level, { funds: 1000, xp: 0, level: 1 });
    await session.submitOffer('T1', 480, 'local', null);
    await session.submitOffer('T2', 390, 'local', null);
    session.closeMarket();
    const el = renderBase(
      state({
        screen: 'base',
        level,
        session,
        player: session.player,
        recyclePlan: { T1: true, T2: true },
      }),
    );
    expect(el.textContent).toContain('真品');
    expect(el.textContent).toContain('仿品');
    expect(el.querySelectorAll('.loot-card')).toHaveLength(2);
    expect(el.textContent).toContain('结算并回城');
  });
});
