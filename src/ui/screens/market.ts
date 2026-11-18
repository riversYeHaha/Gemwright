import {
  closeMarket,
  dismissNotice,
  navigate,
  openInspect,
  setOfferOpen,
  submitOffer,
} from '../../app/actions';
import type { AppState } from '../../app/store';
import type { LevelSession } from '../../game/level';
import { tutorialCoach } from '../tutorial';
import type { LevelJson, Stall } from '../../types/level';
import { appendAll, button, fmt, h } from '../dom';
import { badge, emptyState, noticeBar, screenHead } from '../components';

/** 集市：5 件珍宝的卡片、逐件议价；精灵对话浮窗由 fairyChat 全局挂载。 */
export function renderMarket(state: AppState): HTMLElement {
  const body = h('div', { class: 'screen-body' });
  const session = state.session;
  const level = state.level;

  if (!session || !level) {
    appendAll(
      body,
      emptyState('还没有进入任何世界。'),
      h(
        'div',
        { class: 'actions-row' },
        button('去穿越', { variant: 'primary', onClick: () => navigate('travel') }),
      ),
    );
    return body;
  }

  if (session.phase !== 'market') {
    appendAll(
      body,
      emptyState('本关已经收摊，真相在基地等你。'),
      h(
        'div',
        { class: 'actions-row' },
        button('去基地鉴宝', { variant: 'primary', onClick: () => navigate('base') }),
      ),
    );
    return body;
  }

  const quota = session.offerQuota;
  const offerLeft = Math.max(0, quota - session.state.offersUsed);
  const askLeft = Math.max(0, session.fairyQuota - session.state.askUsed);
  const end = session.endCheck();

  appendAll(
    body,
    screenHead(`集市 · ${level.world.name}`, '你以为你在砍价，其实你在鉴定。', [
      badge(
        `物价指数 ${level.world.priceIndex.toFixed(2)}`,
        level.world.priceIndex >= 1.2 ? 'red' : 'teal',
      ),
      badge(
        level.kind === 'tutorial'
          ? '教学 · 本地判定'
          : state.settings.quickBargain
            ? '快速议价'
            : '混合议价',
        'muted',
      ),
    ]),
    tutorialCoach(state),
    noticeBar(state.notice, () => dismissNotice()),
    h(
      'div',
      { class: 'market-hud' },
      hudCell('可用资金', `${fmt(session.availableFunds)}`, '星际币'),
      hudCell('议价额度', `${offerLeft} / ${quota}`, '每关刷新'),
      hudCell('询问额度', `${askLeft} / ${session.fairyQuota}`, '仅集市可用'),
      hudCell('世界类型', `Lv.${level.difficulty}`, level.seedGenre),
      h(
        'div',
        { class: 'market-hud__actions' },
        button('收摊结算', { variant: 'primary', onClick: () => closeMarket() }),
      ),
    ),
    end.end && end.message ? h('p', { class: 'hint hint--warn', text: end.message }) : null,
  );

  const layout = h(
    'div',
    { class: 'market-layout' },
    h(
      'div',
      { class: 'stall-grid' },
      ...level.stalls.map((stall) => renderStallCard(stall, state, session)),
    ),
  );
  body.append(layout);
  return body;
}

function hudCell(label: string, value: string, hint: string): HTMLElement {
  return h(
    'div',
    { class: 'hud-cell' },
    h('span', { class: 'hud-cell__label', text: label }),
    h('strong', { class: 'hud-cell__value', text: value }),
    h('span', { class: 'hud-cell__hint', text: hint }),
  );
}

function renderStallCard(stall: Stall, state: AppState, session: LevelSession): HTMLElement {
  const level = state.level as LevelJson;
  const creator = level.creators.find((entry) => entry.id === stall.creatorId);
  const runtime = session.itemOf(stall.itemId);
  if (!runtime) return h('article');

  const decision = state.decisions[stall.itemId];
  const statusBadge =
    runtime.status === 'purchased'
      ? badge(`已成交 ${fmt(runtime.purchasePrice ?? 0)}`, 'gold')
      : runtime.status === 'passed'
        ? badge('流拍', 'red')
        : badge('在售', 'muted');

  const canOffer =
    runtime.status === 'listed' &&
    runtime.offers.length < 4 &&
    session.state.offersUsed < session.offerQuota &&
    session.availableFunds >= 10;

  const card = h(
    'article',
    {
      class: `stall-card${runtime.status === 'purchased' ? ' stall-card--bought' : ''}${
        runtime.status === 'passed' ? ' stall-card--passed' : ''
      }`,
    },
    h(
      'header',
      { class: 'stall-card__head' },
      h(
        'div',
        null,
        h('h3', { text: stall.item.name }),
        h('p', {
          class: 'stall-card__creator',
          text: `${creator?.name ?? '佚名'} · ${creator?.reputationTier ?? '无名匠'}`,
        }),
      ),
      statusBadge,
    ),
    h('p', { class: 'stall-card__pitch', text: `「${stall.item.pitch}」` }),
    h(
      'div',
      { class: 'stall-card__meta' },
      h('span', { text: `摊主：${stall.stallOwner.name}` }),
      badge(
        stall.stallOwner.savviness,
        stall.stallOwner.savviness === '懂行'
          ? 'gold'
          : stall.stallOwner.savviness === '外行'
            ? 'teal'
            : 'muted',
      ),
    ),
    h('p', { class: 'stall-card__persona', text: stall.stallOwner.persona }),
    h(
      'div',
      { class: 'stall-card__price' },
      h('span', { class: 'label', text: '标价' }),
      h('strong', { text: `${fmt(stall.economy.salePrice)} 星际币` }),
      h('span', {
        class: 'hint',
        text: `行情 ${fmt(creator?.quoteRange[0] ?? 0)}~${fmt(creator?.quoteRange[1] ?? 0)}`,
      }),
    ),
    decision
      ? h(
          'p',
          { class: `decision ${decision.accept ? 'decision--yes' : 'decision--no'}` },
          `${decision.accept ? '成交' : '被拒'}：${decision.line}`,
        )
      : null,
    h(
      'div',
      { class: 'stall-card__actions' },
      button('验货', {
        variant: 'ghost',
        disabled: state.busy?.kind === 'travel',
        onClick: () => openInspect(stall.itemId),
      }),
      button('出价', {
        variant: 'primary',
        disabled: !canOffer,
        onClick: () => setOfferOpen(state.offerOpenFor === stall.itemId ? null : stall.itemId),
      }),
    ),
    state.offerOpenFor === stall.itemId ? renderOfferPanel(stall, session) : null,
  );
  return card;
}

function renderOfferPanel(stall: Stall, session: LevelSession): HTMLElement {
  // range 的取值必须落在 min + n×step 上，所以把上限对 10 取整，保证"按标价成交"报得出来。
  const maxRaw = Math.max(10, Math.min(session.availableFunds, stall.economy.salePrice));
  const max = Math.max(10, Math.floor(maxRaw / 10) * 10);
  const initial = Math.min(
    max,
    Math.max(10, Math.round((stall.economy.salePrice * 0.72) / 10) * 10),
  );
  const slider = h('input', {
    class: 'slider',
    attrs: {
      type: 'range',
      min: '10',
      max: String(max),
      step: '10',
      value: String(initial),
      'aria-label': '报价',
    },
  });
  slider.value = String(initial);
  const readout = h('strong', { class: 'offer-readout', text: `${fmt(initial)} 星际币` });
  slider.addEventListener('input', () => {
    readout.textContent = `${fmt(Number(slider.value))} 星际币`;
  });

  const submit = (): void => {
    void submitOffer(stall.itemId, Number(slider.value));
  };

  return h(
    'div',
    { class: 'offer-panel' },
    h(
      'div',
      { class: 'offer-panel__row' },
      h('span', { class: 'label', text: '你的报价' }),
      readout,
      h('span', { class: 'hint', text: `可报 10~${fmt(max)}` }),
    ),
    slider,
    h(
      'p',
      { class: 'hint' },
      `每报一次消耗 1 点额度（剩 ${Math.max(0, session.offerQuota - session.state.offersUsed)} 点）；低于摊主底价必被拒；本件已报 ${session.itemOf(stall.itemId)?.offers.length ?? 0}/4 回合。`,
    ),
    h(
      'div',
      { class: 'actions-row' },
      button('就报这个价', { variant: 'primary', onClick: submit }),
      button('算了', { variant: 'subtle', onClick: () => setOfferOpen(null) }),
    ),
  );
}
