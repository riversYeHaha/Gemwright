import type { AppState, SlotProgress } from '../app/store';
import { h } from './dom';

const STATUS_LABEL: Record<SlotProgress['status'], string> = {
  running: '加载中',
  cached: '已缓存',
  done: '已就位',
  failed: '占位',
  skipped: '跳过',
};

/**
 * 全屏布展动画：模型没齐之前挡住世界，避免玩家在占位模型 / 真模型之间反复重绘。
 * 由 router 在 `busy.kind === 'models'` 时挂载；数据来自统一布展进度（正式关 / 教学 / 演示）。
 */
export function renderModelLoading(state: AppState): HTMLElement | null {
  const busy = state.busy;
  if (!busy || busy.kind !== 'models') return null;
  const total = busy.slots.length;
  const done = busy.slots.filter(
    (slot) =>
      slot.status === 'done' ||
      slot.status === 'cached' ||
      slot.status === 'failed' ||
      slot.status === 'skipped',
  ).length;
  const percent = Math.max(
    0,
    Math.min(100, Math.round((busy.ratio || done / Math.max(1, total)) * 100)),
  );

  return h(
    'div',
    {
      class: 'model-loading',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-busy': 'true' },
    },
    h(
      'section',
      { class: 'model-loading__card' },
      h(
        'div',
        { class: 'model-loading__orb', attrs: { 'aria-hidden': 'true' } },
        h('span', { class: 'model-loading__ring model-loading__ring--a' }),
        h('span', { class: 'model-loading__ring model-loading__ring--b' }),
        h('span', { class: 'model-loading__core' }),
        ...[0, 1, 2, 3, 4].map((index) =>
          h('span', { class: `model-loading__gem model-loading__gem--${index + 1}` }),
        ),
      ),
      h('p', { class: 'model-loading__kicker', text: 'LUX3D · 3D 布展' }),
      h('h2', { class: 'model-loading__title', text: '正在加载 3D 珍宝' }),
      h('p', { class: 'model-loading__message', text: busy.message }),
      h(
        'div',
        { class: 'model-loading__bar' },
        h('span', { class: 'model-loading__bar-fill', style: { width: `${percent}%` } }),
      ),
      h('p', { class: 'model-loading__count', text: `${done} / ${total} 件 · ${percent}%` }),
      h(
        'ul',
        { class: 'model-loading__slots' },
        ...busy.slots.map((slot, index) =>
          h(
            'li',
            { class: `model-loading__slot model-loading__slot--${slot.status}` },
            h('span', { class: 'model-loading__slot-index', text: String(index + 1) }),
            h('span', { class: 'model-loading__slot-name', text: slot.name }),
            h('span', { class: 'model-loading__slot-status', text: STATUS_LABEL[slot.status] }),
          ),
        ),
      ),
      busy.logs.length > 0
        ? h(
            'ul',
            { class: 'model-loading__logs' },
            ...busy.logs.slice(-3).map((line) => h('li', { text: line })),
          )
        : null,
      h('p', { class: 'model-loading__hint', text: '全部模型就位后自动进入世界，请稍候。' }),
    ),
  );
}
