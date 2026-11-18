import {
  dismissNotice,
  goStart,
  navigate,
  nextLevel,
  restartSoft,
  settleNow,
  toggleRecycle,
} from '../../app/actions';
import type { AppState } from '../../app/store';
import { FAKE_RECYCLE_RATIO, RECYCLE_FEE } from '../../config/constants';
import { diffTraits, TRAIT_FIELD_LABELS } from '../../game/validate';
import type { Settlement, Stall } from '../../types/level';
import { appendAll, button, fmt, h } from '../dom';
import { badge, emptyState, noticeBar, screenHead, section } from '../components';
import { tutorialCoach } from '../tutorial';

/**
 * 基地：逐件揭晓真伪 + 特征 diff 对账（免费）→ 选择回收（20 手续费/件）→ 结算。
 * 真伪在这里只是"揭晓"，不是"重新判定"——它在关卡生成时就被程序定死了。
 */
export function renderBase(state: AppState): HTMLElement {
  const body = h('div', { class: 'screen-body' });
  const level = state.level;
  const session = state.session;

  appendAll(
    body,
    screenHead(
      '基地 · 鉴宝台',
      '真相揭晓：真品回收按真实价值，仿品只值工艺残值（标价 × 10%），回收另收 20 星际币/件。',
      [badge(state.demoMode ? '演示关卡' : '成绩即将入库', state.demoMode ? 'muted' : 'gold')],
    ),
    tutorialCoach(state),
    noticeBar(state.notice, () => dismissNotice()),
  );

  if (!level || !session) {
    appendAll(
      body,
      emptyState('还没有带着货回来。'),
      h(
        'div',
        { class: 'actions-row' },
        button('去穿越', { variant: 'primary', onClick: () => navigate('travel') }),
      ),
    );
    return body;
  }

  if (session.phase === 'market') {
    appendAll(
      body,
      emptyState('还在集市上，先把摊收了再回基地鉴宝。'),
      h(
        'div',
        { class: 'actions-row' },
        button('回集市', { variant: 'primary', onClick: () => navigate('market') }),
      ),
    );
    return body;
  }

  const settlement = session.state.settlement;
  if (settlement && session.phase === 'settled') {
    body.append(renderSettlement(state, settlement));
    return body;
  }

  const purchased = level.stalls.filter(
    (stall) => session.itemOf(stall.itemId)?.status === 'purchased',
  );
  const plan = purchased.map((stall) => ({
    itemId: stall.itemId,
    recycle: state.recyclePlan[stall.itemId] ?? true,
  }));
  const preview = session.previewSettlement(plan);

  appendAll(
    body,
    section(
      `战利品：${purchased.length} 件`,
      purchased.length === 0
        ? h('p', { class: 'hint', text: '两手空空。好消息是：你也没亏钱。' })
        : h(
            'div',
            { class: 'loot-grid' },
            ...purchased.map((stall, index) => renderLootCard(stall, state, index)),
          ),
    ),
    section(
      '结算预览',
      h(
        'div',
        { class: 'settlement-grid' },
        metric('成交支出', `−${fmt(preview.spent)}`),
        metric('回收所得', `+${fmt(preview.recycle)}`),
        metric('回收手续费', `−${fmt(preview.fees)}`),
        metric(
          '净收益',
          `${preview.net >= 0 ? '+' : ''}${fmt(preview.net)}`,
          preview.net >= 0 ? 'good' : 'bad',
        ),
        metric('经验', `+${fmt(preview.xpGain)}`),
        metric('真品 / 仿品', `${preview.authenticOwned} / ${preview.fakeOwned}`),
      ),
      h('p', {
        class: 'hint',
        text: `未买下的 ${level.stalls.length - purchased.length} 件不揭晓，也不结算。回收与否逐件决定；不回收则无所得、也不收手续费。`,
      }),
      h(
        'div',
        { class: 'actions-row' },
        button('结算并回城', { variant: 'primary', onClick: () => settleNow() }),
        button('回开始页', { variant: 'ghost', onClick: () => goStart() }),
      ),
    ),
  );
  return body;
}

function metric(label: string, value: string, tone?: 'good' | 'bad'): HTMLElement {
  return h(
    'div',
    { class: `metric${tone ? ` metric--${tone}` : ''}` },
    h('span', { class: 'metric__label', text: label }),
    h('strong', { class: 'metric__value', text: value }),
  );
}

function renderLootCard(stall: Stall, state: AppState, index = 0): HTMLElement {
  const level = state.level;
  const session = state.session;
  if (!level || !session) return h('article');
  const creator = level.creators.find((entry) => entry.id === stall.creatorId);
  const runtime = session.itemOf(stall.itemId);
  const authentic = stall.item.isAuthentic;
  const diff = creator ? diffTraits(creator.signatureTraits, stall.item.traits) : [];
  const recycled = state.recyclePlan[stall.itemId] ?? true;
  const recycleValue = authentic
    ? stall.economy.trueValue
    : Math.round(stall.economy.salePrice * FAKE_RECYCLE_RATIO);

  return h(
    'article',
    {
      class: `loot-card loot-card--reveal${authentic ? ' loot-card--real' : ' loot-card--fake'}`,
      style: { animationDelay: `${index * 130}ms` },
    },
    h(
      'header',
      { class: 'loot-card__head' },
      h(
        'div',
        null,
        h('h3', { text: stall.item.name }),
        h('p', {
          class: 'hint',
          text: `成交 ${fmt(runtime?.purchasePrice ?? 0)} 星际币 · ${creator?.name ?? '佚名'}`,
        }),
      ),
      badge(authentic ? '真品' : '仿品', authentic ? 'teal' : 'red'),
    ),
    h('p', { class: 'label', text: '特征对账（实际 vs 真品规范）' }),
    diff.length === 0
      ? h('p', { class: 'diff-ok', text: '四项全对，不多不少——真品。' })
      : h(
          'table',
          { class: 'diff-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { text: '特征' }),
              h('th', { text: '规范' }),
              h('th', { text: '实际' }),
            ),
          ),
          h(
            'tbody',
            null,
            ...diff.map((entry) =>
              h(
                'tr',
                null,
                h('td', { text: TRAIT_FIELD_LABELS[entry.field] }),
                h('td', { text: entry.expected }),
                h('td', { class: 'diff-table__actual', text: entry.actual }),
              ),
            ),
          ),
        ),
    h(
      'div',
      { class: 'loot-card__recycle' },
      h(
        'label',
        { class: 'switch switch--inline' },
        (() => {
          const checkbox = h('input', { attrs: { type: 'checkbox' } });
          checkbox.checked = recycled;
          checkbox.addEventListener('change', () => toggleRecycle(stall.itemId));
          return checkbox;
        })(),
        h(
          'span',
          null,
          h('strong', { text: '交给回收行' }),
          h('em', { text: `回收 ${fmt(recycleValue)}，手续费 ${RECYCLE_FEE}` }),
        ),
      ),
      h('p', {
        class: 'hint',
        text: authentic
          ? `真实价值 ${fmt(stall.economy.trueValue)} 星际币（不随本地物价膨胀）`
          : `仿品只有工艺残值：标价 ${fmt(stall.economy.salePrice)} × 10%`,
      }),
    ),
  );
}

function renderSettlement(state: AppState, settlement: Settlement): HTMLElement {
  const levelUp = settlement.levelAfter > settlement.levelBefore;
  const isTutorial = state.level?.kind === 'tutorial';
  return h(
    'div',
    { class: 'stack' },
    isTutorial
      ? section(
          '教学完成：你已经会玩了',
          h(
            'p',
            { class: 'muted' },
            '这一关把正式关卡的核心都走了一遍：读规范 → 转 3D → 问精灵 → 砍价 → 揭晓 diff → 回收结算。',
          ),
          h(
            'ul',
            { class: 'bullets' },
            h('li', { text: '判定依据是「创作人真品规范」对 3D 实际特征：不多不少，多一也是仿。' }),
            h('li', {
              text: '精灵懂手艺、懂传闻，但不知道单件真伪与价格——它挡回来的那个问题就是证据。',
            }),
            h('li', { text: '报价低于底价必被拒，还会消耗议价额度；预算和额度都要省着用。' }),
            h('li', { text: '仿品只值标价的 10% 残值，误购的亏损比省下的手续费大得多。' }),
          ),
          h(
            'div',
            { class: 'actions-row' },
            button('去第一关（LLM 现场生成）', { variant: 'primary', onClick: () => nextLevel() }),
            button('回开始页', { variant: 'ghost', onClick: () => goStart() }),
          ),
        )
      : null,
    section(
      '本关结算',
      h(
        'div',
        { class: 'settlement-grid' },
        metric('成交支出', `−${fmt(settlement.spent)}`),
        metric('回收所得', `+${fmt(settlement.recycle)}`),
        metric('手续费', `−${fmt(settlement.fees)}`),
        metric(
          '净收益',
          `${settlement.net >= 0 ? '+' : ''}${fmt(settlement.net)}`,
          settlement.net >= 0 ? 'good' : 'bad',
        ),
        metric('资金', `${fmt(settlement.fundsBefore)} → ${fmt(settlement.fundsAfter)}`),
        metric(
          '经验 / 等级',
          `+${fmt(settlement.xpGain)} · Lv.${settlement.levelBefore} → Lv.${settlement.levelAfter}`,
        ),
      ),
      levelUp
        ? h('p', {
            class: 'levelup',
            text: `升级！Lv.${settlement.levelAfter}：议价额度 +5，询问额度 +2，下个世界更贵更险。`,
          })
        : h('p', {
            class: 'hint',
            text:
              settlement.net >= 0
                ? '经验到 800 即可升级。'
                : '亏钱不扣级，但也没有经验。下次少看故事、多数颗数。',
          }),
      h(
        'table',
        { class: 'settle-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { text: '珍宝' }),
            h('th', { text: '判定' }),
            h('th', { text: '成交' }),
            h('th', { text: '回收' }),
            h('th', { text: '手续费' }),
          ),
        ),
        h(
          'tbody',
          null,
          ...settlement.lines.map((line) =>
            h(
              'tr',
              null,
              h('td', { text: line.name }),
              h('td', { text: line.purchased ? (line.authentic ? '真品' : '仿品') : '未买下' }),
              h('td', { text: line.purchased ? String(line.price) : '—' }),
              h('td', { text: line.recycled ? String(line.recycleValue) : '—' }),
              h('td', { text: line.recycled ? String(line.fee) : '—' }),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'actions-row' },
        button('下一关（Lv.' + settlement.levelAfter + '）', {
          variant: 'primary',
          onClick: () => nextLevel(),
        }),
        button('盘缠不足？重开旅程（资金回 1000，保留等级）', {
          variant: 'ghost',
          onClick: () => restartSoft(),
        }),
        button(state.demoMode ? '再玩一次演示关卡' : '去穿越', {
          variant: 'subtle',
          onClick: () => nextLevel(),
        }),
        state.demoMode || state.level?.kind !== 'generated'
          ? null
          : button('查看生成列表', { variant: 'subtle', onClick: () => navigate('library') }),
      ),
      h('p', {
        class: 'hint',
        text: `当前世界：${state.level?.world.name ?? ''}。下一关会抽到新的世界种子，物价指数与创作人档位都会变。`,
      }),
      !isTutorial && state.level?.kind === 'generated'
        ? h('p', {
            class: 'hint',
            text: '本关 3D 模型已归档到「生成列表」，可随时重新下载；关卡缓存会在结算后自动清理。',
          })
        : null,
    ),
  );
}
