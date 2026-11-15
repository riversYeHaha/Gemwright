import { navigate } from '../app/actions';
import type { AppState, SlotProgress } from '../app/store';
import { labelOfStatus } from '../app/store';
import type { Notice } from '../app/store';
import type { Traits } from '../types/level';
import { button, fmt, h } from './dom';

/** 共享 UI 组件：顶栏、提示条、特征表、统计块、布展进度。 */

export function topbar(state: AppState): HTMLElement {
  const hasLevel = Boolean(state.session);
  return h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'topbar__brand' },
      h('span', { class: 'topbar__mark', text: '✦' }),
      h(
        'div',
        null,
        h('p', { class: 'topbar__name', text: 'GEMWRIGHT' }),
        h('p', { class: 'topbar__sub', text: '珍宝猎人' }),
      ),
    ),
    h(
      'div',
      { class: 'topbar__stats' },
      statPill('资金', `${fmt(state.player.funds)}`, '星际币'),
      statPill('等级', `Lv.${state.player.level}`, `${state.player.xp} 经验`),
      h('span', {
        class: `dot ${state.settings.deepseekKey ? 'dot--on' : 'dot--off'}`,
        attrs: { title: state.settings.deepseekKey ? 'DeepSeek Key 已配置' : '未配置 DeepSeek Key' },
      }),
      h('span', {
        class: `dot ${state.settings.lux3dKey ? 'dot--on' : 'dot--off'}`,
        attrs: { title: state.settings.lux3dKey ? 'Lux3D Key 已配置' : '未配置 Lux3D Key' },
      }),
    ),
    h(
      'nav',
      { class: 'topbar__nav' },
      hasLevel ? button('集市', { variant: 'ghost', onClick: () => navigate('market') }) : null,
      hasLevel ? button('基地', { variant: 'ghost', onClick: () => navigate('base') }) : null,
      button('设置', { variant: 'ghost', onClick: () => navigate('settings') }),
    ),
  );
}

function statPill(label: string, value: string, unit: string): HTMLElement {
  return h(
    'div',
    { class: 'stat-pill' },
    h('span', { class: 'stat-pill__label', text: label }),
    h('span', { class: 'stat-pill__value', text: value }),
    h('span', { class: 'stat-pill__unit', text: unit }),
  );
}

export function screenHead(title: string, subtitle?: string, right?: HTMLElement[]): HTMLElement {
  return h(
    'div',
    { class: 'screen-head' },
    h('div', null, h('h1', { class: 'screen-head__title', text: title }), subtitle ? h('p', { class: 'screen-head__sub', text: subtitle }) : null),
    right && right.length > 0 ? h('div', { class: 'screen-head__actions' }, ...right) : null,
  );
}

export function noticeBar(notice: Notice | null, onDismiss: () => void): HTMLElement | null {
  if (!notice) return null;
  return h(
    'div',
    { class: `notice notice--${notice.kind}` },
    h('span', { class: 'notice__text', text: notice.text }),
    button('知道了', { variant: 'subtle', onClick: onDismiss }),
  );
}

export function badge(text: string, tone: 'gold' | 'teal' | 'red' | 'muted' = 'gold'): HTMLElement {
  return h('span', { class: `badge badge--${tone}`, text });
}

export function traitTable(traits: Traits): HTMLElement {
  const rows: Array<[string, string]> = [
    ['色族', traits.color],
    ['计数', `${traits.gemCount} 颗`],
    ['形制', traits.shape],
    ['底座', traits.hasBase ? '有' : '无'],
  ];
  return h(
    'dl',
    { class: 'trait-table' },
    ...rows.flatMap(([label, value]) => [
      h('dt', { text: label }),
      h('dd', { text: value }),
    ]),
  );
}

export function progressSlots(busy: { slots: SlotProgress[]; ratio: number; message: string; logs: string[] }): HTMLElement {
  return h(
    'div',
    { class: 'booth' },
    h('div', { class: 'booth__head' }, h('span', { text: busy.message }), h('span', { class: 'mono', text: `${Math.round(busy.ratio * 100)}%` })),
    h(
      'div',
      { class: 'booth__slots' },
      ...busy.slots.map((slot) =>
        h(
          'div',
          { class: `booth-slot booth-slot--${slot.status}`, attrs: { title: slot.message ?? labelOfStatus(slot.status) } },
          h('span', { class: 'booth-slot__name', text: slot.name }),
          h('span', { class: 'booth-slot__status', text: labelOfStatus(slot.status) }),
        ),
      ),
    ),
    h('ul', { class: 'booth__logs' }, ...busy.logs.slice(-5).map((line) => h('li', { text: line }))),
  );
}

export function section(title: string, ...children: Array<HTMLElement | null>): HTMLElement {
  return h(
    'section',
    { class: 'panel' },
    title ? h('h2', { class: 'panel__title', text: title }) : null,
    ...children.filter((child): child is HTMLElement => child !== null),
  );
}

export function emptyState(text: string): HTMLElement {
  return h('div', { class: 'empty', text });
}
