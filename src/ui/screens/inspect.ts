import { backToMarket, dismissNotice, setOfferOpen } from '../../app/actions';
import type { AppState } from '../../app/store';
import { TreasureViewer } from '../../render/viewer';
import { appendAll, button, fmt, h } from '../dom';
import { badge, emptyState, noticeBar, screenHead, traitTable } from '../components';

/**
 * 验货：3D 单件检视 + 创作人真品规范。
 * 只展示"规范"与模型本身，**不列出实际特征**——判定靠玩家自己看模型，而不是读一张答案表。
 */

let activeViewer: TreasureViewer | null = null;

export function disposeInspectViewer(): void {
  activeViewer?.dispose();
  activeViewer = null;
}

export function renderInspect(state: AppState): HTMLElement {
  disposeInspectViewer();

  const body = h('div', { class: 'screen-body' });
  const level = state.level;
  const session = state.session;
  const itemId = state.inspectItemId;
  const stall = level?.stalls.find((entry) => entry.itemId === itemId);

  appendAll(
    body,
    screenHead('验货', '拖动旋转 / 滚轮缩放 / 双击回正。把模型看到的样子，和创作人的真品规范对上。', [
      badge('免费', 'teal'),
    ]),
    noticeBar(state.notice, () => dismissNotice()),
  );

  if (!level || !session || !stall) {
    appendAll(
      body,
      emptyState('没有正在检视的珍宝。'),
      h('div', { class: 'actions-row' }, button('回集市', { variant: 'primary', onClick: () => backToMarket() })),
    );
    return body;
  }

  const creator = level.creators.find((entry) => entry.id === stall.creatorId);
  const runtime = session.itemOf(stall.itemId);
  const viewerHost = h('div', { class: 'viewer' });
  const viewer = new TreasureViewer(viewerHost);
  activeViewer = viewer;
  void viewer.show(state.models[stall.itemId] ?? null, stall.item.traits);

  const layout = h(
    'div',
    { class: 'inspect-layout' },
    h(
      'div',
      { class: 'inspect-stage' },
      viewerHost,
      h('p', { class: 'viewer__hint', text: '开箱雾散去后，请自己数一数、看一看——规范不多不少，多一也是仿。' }),
    ),
    h(
      'div',
      { class: 'inspect-info' },
      h(
        'div',
        { class: 'panel' },
        h('h2', { class: 'panel__title', text: stall.item.name }),
        h('p', { class: 'stall-card__creator', text: `署名：${creator?.name ?? '佚名'} · ${creator?.reputationTier ?? ''}` }),
        h('p', { class: 'stall-card__pitch', text: `「${stall.item.pitch}」` }),
        h(
          'div',
          { class: 'chip-row' },
          badge(`标价 ${fmt(stall.economy.salePrice)}`),
          badge(`摊主 ${stall.stallOwner.name}`, 'muted'),
          runtime?.status === 'purchased' ? badge(`已成交 ${fmt(runtime.purchasePrice ?? 0)}`, 'teal') : badge('在售', 'muted'),
        ),
      ),
      h(
        'div',
        { class: 'panel' },
        h('h2', { class: 'panel__title', text: '创作人真品规范' }),
        creator ? traitTable(creator.signatureTraits) : null,
        h(
          'ul',
          { class: 'bullets' },
          h('li', { text: '色族、颗数、形制、底座——四项都要对。' }),
          h('li', { text: '「不多不少」是铁律：多一颗、少一颗、换一种颜色，都算仿品。' }),
          h('li', { text: '模型由 AI 按规范的特征程序化生成，判定时以你看到的模型为准。' }),
        ),
      ),
      h(
        'div',
        { class: 'actions-row' },
        button('回集市', { variant: 'ghost', onClick: () => backToMarket() }),
        button('回集市出价', {
          variant: 'primary',
          disabled: runtime?.status !== 'listed',
          onClick: () => {
            setOfferOpen(stall.itemId);
            backToMarket();
          },
        }),
      ),
      h('p', { class: 'hint', text: '底价不会告诉你；低于底价的报价必被拒，而且会消耗一次议价额度。' }),
    ),
  );

  body.append(layout);
  return body;
}
