import { continueRun, navigate, startDemoLevel, startGame, startTutorial } from '../../app/actions';
import type { AppState } from '../../app/store';
import { button, fmt, h } from '../dom';
import { badge } from '../components';

/**
 * 开始页（游戏门面）：
 * - 先给玩家一条"零成本"的路（教学关卡），再给正式开局；
 * - 有刷新前的续玩快照时，最显眼的按钮是「继续」；
 * - Key 状态、教学进度、当前资金/等级一眼可见。
 */
export function renderStart(state: AppState): HTMLElement {
  const hasDeepSeek = Boolean(state.settings.deepseekKey);
  const hasLux3d = Boolean(state.settings.lux3dKey);
  const tutorialDone = state.tutorialCompleted;

  const primaryAction = state.resumeAvailable
    ? button('继续上一局', { variant: 'primary', onClick: () => continueRun() })
    : button('开始游戏', { variant: 'primary', onClick: () => startGame() });

  const hero = h(
    'div',
    { class: 'landing__hero' },
    h(
      'div',
      { class: 'landing__copy' },
      h('p', { class: 'landing__kicker', text: '群核 Aholo 全球 3D AI 黑客松' }),
      h(
        'h1',
        { class: 'landing__title' },
        '珍宝猎人',
        h('span', { class: 'landing__title-en', text: 'GEMWRIGHT' }),
      ),
      h('p', { class: 'landing__lede', text: '你以为你在砍价，其实你在鉴定。' }),
      h(
        'p',
        { class: 'landing__desc' },
        '每一局都是 LLM 现场生成的异世界集市：砍价买下 5 件 3D 珍宝，回基地按创作人的真品规范鉴宝回收。',
        '定价迷雾、精灵情报、预算与额度——你买的不是宝贝，是你自己的眼力。',
      ),
      h(
        'div',
        { class: 'landing__actions' },
        primaryAction,
        tutorialDone
          ? button('重玩教学关卡', { variant: 'ghost', onClick: () => startTutorial() })
          : button('教学关卡 · 约 3 分钟', { variant: 'ghost', onClick: () => startTutorial() }),
        !hasDeepSeek
          ? button('演示关卡 · 0 积分', { variant: 'subtle', onClick: () => startDemoLevel() })
          : null,
        button('设置', { variant: 'subtle', onClick: () => navigate('settings') }),
      ),
      state.resumeAvailable && state.level
        ? h(
            'p',
            { class: 'landing__resume' },
            `上次停在「${state.level.world.name}」· ${
              state.session?.phase === 'market' ? '集市阶段' : '基地阶段'
            }，货还在原处。`,
          )
        : null,
      h(
        'div',
        { class: 'landing__chips' },
        badge(`Lv.${state.player.level} · ${fmt(state.player.funds)} 星际币`, 'gold'),
        badge(tutorialDone ? '教学已通关' : '教学未通关', tutorialDone ? 'teal' : 'muted'),
        badge(hasDeepSeek ? 'DeepSeek 已配置' : 'DeepSeek 未配置', hasDeepSeek ? 'teal' : 'muted'),
        badge(hasLux3d ? 'Lux3D 已配置' : 'Lux3D 未配置（占位 3D）', hasLux3d ? 'teal' : 'muted'),
      ),
    ),
    h(
      'div',
      { class: 'landing__visual', attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'landing__halo' }),
      h('div', { class: 'landing__gem' }),
      h('div', { class: 'landing__ring landing__ring--one' }),
      h('div', { class: 'landing__ring landing__ring--two' }),
      h('p', { class: 'landing__visual-caption', text: 'AI 生成的珍宝，等你亲手转一转' }),
    ),
  );

  const features = h(
    'div',
    { class: 'landing__features' },
    feature(
      '✦',
      'LLM 现场铺开的世界',
      '每个世界有自己的物价指数、创作人档位与做伪风气——没有两局是一样的。',
    ),
    feature(
      '◇',
      '亲手转动的 3D 珍宝',
      'Lux3D 文生 3D 生成每件珍宝；色族、颗数、形制、底座就是判定依据。',
    ),
    feature(
      '◈',
      '懂行但不知价的情报',
      '鉴宝精灵知道创作人规矩与坊间传闻，却不知道任何单件的真伪与价格——问什么，也是策略。',
    ),
  );

  return h(
    'div',
    { class: 'landing' },
    h(
      'header',
      { class: 'landing__nav' },
      h(
        'div',
        { class: 'landing__brand' },
        h('span', { class: 'landing__brand-mark', text: '✦' }),
        h(
          'div',
          null,
          h('p', { class: 'landing__brand-name', text: 'GEMWRIGHT' }),
          h('p', { class: 'landing__brand-sub', text: '珍宝猎人 · 3D AI 鉴宝' }),
        ),
      ),
      h(
        'div',
        { class: 'landing__nav-actions' },
        button('设置', { variant: 'ghost', onClick: () => navigate('settings') }),
      ),
    ),
    hero,
    features,
    h(
      'footer',
      { class: 'landing__footer' },
      h('span', { text: 'Key 只存本机浏览器 · 无后端 · 无第三方脚本' }),
      h('span', { text: '2026.11 · 群核 Aholo 黑客松 MVP' }),
    ),
  );
}

function feature(icon: string, title: string, desc: string): HTMLElement {
  return h(
    'article',
    { class: 'feature-card' },
    h('span', { class: 'feature-card__icon', text: icon }),
    h('h3', { class: 'feature-card__title', text: title }),
    h('p', { class: 'feature-card__desc', text: desc }),
  );
}
