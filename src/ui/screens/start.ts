import { continueRun, navigate } from '../../app/actions';
import type { AppState } from '../../app/store';
import type { LevelPhase } from '../../types/level';
import { fmt, h } from '../dom';
import { mountStartBackdrop } from '../../render/startBackdrop';

/**
 * 游戏开始画面：
 * - canvas 黑洞背景（见 render/startBackdrop.ts），珍宝从四面被吸进去；
 * - 常规主菜单：新游戏 / 继续游戏 / 设置 / 游戏说明；
 * - 只有存在续玩快照时「继续游戏」才可用；
 * - 不再在首屏铺功能介绍：玩法说明收进独立的「游戏说明」页。
 */
export function renderStart(state: AppState): HTMLElement {
  const hasSave = state.resumeAvailable && Boolean(state.level);
  const tutorialDone = state.tutorialCompleted;
  const phase = state.session?.phase;
  const saveLine = state.level
    ? `「${state.level.world.name}」· ${phaseLabel(phase)}`
    : '刷新或离开后会在这里出现';

  const backdrop = h('div', { class: 'start__backdrop' });
  // 在元素离屏阶段就开始铺画布；挂载后直接用窗口尺寸，不会闪空白。
  mountStartBackdrop(backdrop);

  const menu = h(
    'nav',
    { class: 'start-menu', attrs: { 'aria-label': '主菜单' } },
    menuItem({
      action: 'new',
      icon: '✦',
      label: '新游戏',
      sub: '教学关卡 · 正式开局 · 演示关卡',
      tone: hasSave ? 'normal' : 'primary',
      onClick: () => navigate('newgame'),
    }),
    menuItem({
      action: 'continue',
      icon: '↻',
      label: '继续游戏',
      sub: hasSave ? `上次停在 ${saveLine}` : '暂无存档，开始一局后自动记录',
      tone: hasSave ? 'primary' : 'normal',
      disabled: !hasSave,
      onClick: () => {
        if (hasSave) continueRun();
      },
    }),
    menuItem({
      action: 'settings',
      icon: '⚙',
      label: '设置',
      sub: 'API Key · 地区 · 快速议价',
      tone: 'normal',
      onClick: () => navigate('settings'),
    }),
    menuItem({
      action: 'guide',
      icon: '?',
      label: '游戏说明',
      sub: '玩法循环 · 真伪判定 · 操作',
      tone: 'normal',
      onClick: () => navigate('guide'),
    }),
  );

  const meta = h(
    'div',
    { class: 'start__meta' },
    h('span', { class: 'start__meta-item', text: `Lv.${state.player.level}` }),
    h('span', { class: 'start__meta-item', text: `${fmt(state.player.funds)} 星际币` }),
    h('span', {
      class: `start__meta-item${tutorialDone ? ' is-on' : ''}`,
      text: tutorialDone ? '教学已通关' : '教学未通关',
    }),
    keyStatus('DeepSeek', Boolean(state.settings.deepseekKey)),
    keyStatus('Lux3D', Boolean(state.settings.lux3dKey)),
  );

  return h(
    'div',
    { class: 'start' },
    backdrop,
    h('div', { class: 'start__scrim', attrs: { 'aria-hidden': 'true' } }),
    h(
      'div',
      { class: 'start__inner' },
      h(
        'header',
        { class: 'start__top' },
        h(
          'div',
          { class: 'start__brand' },
          h('span', { class: 'start__brand-mark', text: '✦' }),
          h(
            'div',
            null,
            h('p', { class: 'start__brand-name', text: 'GEMWRIGHT' }),
            h('p', { class: 'start__brand-sub', text: '珍宝猎人 · 3D AI 鉴宝' }),
          ),
        ),
        h('span', {
          class: 'start__event',
          text: '群核 Aholo 全球 3D AI 黑客松 · 2026',
        }),
      ),
      h(
        'main',
        { class: 'start__main' },
        h(
          'section',
          { class: 'start__panel' },
          h('p', { class: 'start__kicker', text: 'A 3D AI TREASURE HUNT' }),
          h(
            'h1',
            { class: 'start__title' },
            '珍宝猎人',
            h('span', { class: 'start__title-en', text: 'GEMWRIGHT' }),
          ),
          h('p', { class: 'start__tagline', text: '你以为你在砍价，其实你在鉴定。' }),
          h('p', {
            class: 'start__lede',
            text: '穿越到 LLM 现场生成的异世界集市，砍价买下 3D 珍宝，回基地鉴宝回收。',
          }),
          menu,
          meta,
        ),
      ),
      h(
        'footer',
        { class: 'start__foot' },
        h('span', { text: 'Key 只存本机浏览器 · 无后端 · 无第三方脚本' }),
        h('span', { text: 'v0.1.0 · MVP' }),
      ),
    ),
  );
}

function menuItem(options: {
  action: string;
  icon: string;
  label: string;
  sub: string;
  tone: 'normal' | 'primary';
  disabled?: boolean;
  onClick: () => void;
}): HTMLButtonElement {
  const el = h(
    'button',
    {
      class: `start-menu__item start-menu__item--${options.tone}`,
      attrs: { type: 'button', 'data-action': options.action },
    },
    h('span', { class: 'start-menu__icon', text: options.icon }),
    h(
      'span',
      { class: 'start-menu__text' },
      h('span', { class: 'start-menu__label', text: options.label }),
      h('span', { class: 'start-menu__sub', text: options.sub }),
    ),
    h('span', { class: 'start-menu__arrow', text: '›' }),
  );
  if (options.disabled) el.disabled = true;
  else el.addEventListener('click', options.onClick);
  return el;
}

function keyStatus(label: string, on: boolean): HTMLElement {
  return h(
    'span',
    {
      class: `start__key${on ? ' is-on' : ''}`,
      attrs: { title: on ? `${label} Key 已配置` : `${label} Key 未配置` },
    },
    h('span', { class: 'start__key-dot' }),
    label,
  );
}

function phaseLabel(phase: LevelPhase | undefined): string {
  switch (phase) {
    case 'market':
      return '集市阶段';
    case 'base':
      return '基地揭晓';
    case 'settled':
      return '已结算';
    default:
      return '进行中';
  }
}
