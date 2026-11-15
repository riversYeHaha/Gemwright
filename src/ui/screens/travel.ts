import {
  beginShopping,
  cancelModelGeneration,
  dismissNotice,
  navigate,
  nextLevel,
  rerollSeed,
  startDemoLevel,
  startGeneratedLevel,
} from '../../app/actions';
import type { AppState } from '../../app/store';
import { estimateCredits } from '../../api/lux3d';
import { ITEMS_PER_LEVEL, targetAuthenticCount } from '../../config/constants';
import { appendAll, button, fmt, h } from '../dom';
import { badge, noticeBar, progressSlots, screenHead, section, traitTable } from '../components';
import { tutorialCoach } from '../tutorial';

/** 穿越：抽种子 → 读世界 / 创作人规范 / 精灵简报 → 开市（3D 在后台并行布展）。 */
export function renderTravel(state: AppState): HTMLElement {
  const body = h('div', { class: 'screen-body' });
  appendAll(
    body,
    screenHead('穿越', '先读世界与创作人规范，再进集市：所有判断都从这两份公开档案开始。', [
      badge(
        state.level?.kind === 'tutorial'
          ? '教学关卡'
          : state.demoMode
            ? '演示关卡'
            : 'LLM 现场生成',
        state.level?.kind === 'tutorial' ? 'gold' : state.demoMode ? 'muted' : 'teal',
      ),
      badge(`Lv.${state.player.level}`, 'gold'),
    ]),
    tutorialCoach(state),
    noticeBar(state.notice, () => dismissNotice()),
  );

  if (state.busy?.kind === 'travel') {
    appendAll(
      body,
      section(
        `正在穿越到「${state.nextSeed.genre}」`,
        h('p', { class: 'muted', text: state.busy.message }),
        h('p', {
          class: 'hint',
          text: 'DeepSeek 正在铺开整关 JSON（约 30~60 秒）。世界观先到先展，3D 随后并行布展。',
        }),
        h(
          'ul',
          { class: 'booth__logs' },
          ...state.busy.logs.map((line) => h('li', { text: line })),
        ),
      ),
    );
    return body;
  }

  if (!state.level || !state.session) {
    body.append(seedPicker(state));
    return body;
  }

  body.append(levelPreview(state));
  return body;
}

function seedPicker(state: AppState): HTMLElement {
  const seed = state.nextSeed;
  const difficulty = state.player.level;
  const hasKey = Boolean(state.settings.deepseekKey);
  return h(
    'div',
    { class: 'stack' },
    section(
      '下一个世界',
      h(
        'div',
        { class: 'seed-card' },
        h('p', { class: 'seed-card__kicker', text: '世界种子' }),
        h('h3', { class: 'seed-card__title', text: seed.genre }),
        h('p', { class: 'seed-card__mood', text: seed.mood }),
        h(
          'div',
          { class: 'chip-row' },
          badge(
            `物价指数 ${seed.priceIndexRange[0].toFixed(2)}~${seed.priceIndexRange[1].toFixed(2)}`,
          ),
          badge(`难度 ${difficulty}`, 'teal'),
          badge(`真品 ${targetAuthenticCount(difficulty)} 件`, 'muted'),
          badge(`3D ≈ ${estimateCredits(ITEMS_PER_LEVEL)} 积分`, 'gold'),
        ),
        h(
          'p',
          { class: 'hint' },
          `资金 ${fmt(state.player.funds)} 星际币 · 本关 5 件珍宝 · Δ标价 ∈ [1.5, 2.2]×资金，必须取舍`,
        ),
      ),
      h(
        'div',
        { class: 'actions-row' },
        button('穿越生成（≈65 积分）', {
          variant: 'primary',
          disabled: !hasKey,
          onClick: () => void startGeneratedLevel(),
        }),
        button('演示关卡（0 积分）', { variant: 'ghost', onClick: () => startDemoLevel() }),
        button('换一个世界', { variant: 'subtle', onClick: () => rerollSeed() }),
        !hasKey
          ? button('去设置 Key', { variant: 'subtle', onClick: () => navigate('settings') })
          : null,
      ),
      !hasKey
        ? h('p', {
            class: 'hint hint--warn',
            text: '还没有 DeepSeek Key：可以先玩演示关卡熟悉流程。',
          })
        : null,
    ),
    section(
      '本机状态',
      h(
        'ul',
        { class: 'bullets' },
        h('li', { text: `DeepSeek：${hasKey ? '已配置' : '未配置'}` }),
        h('li', {
          text: `Lux3D：${state.settings.lux3dKey ? '已配置（真实 3D）' : '未配置（用程序化占位模型）'}`,
        }),
        h('li', {
          text: `议价模式：${state.settings.quickBargain ? '快速（纯本地公式）' : '混合（LLM 态度 + 硬规则）'}`,
        }),
      ),
    ),
  );
}

function levelPreview(state: AppState): HTMLElement {
  const level = state.level;
  const session = state.session;
  if (!level || !session) return h('div');

  const creators = h(
    'div',
    { class: 'creator-grid' },
    ...level.creators.map((creator) =>
      h(
        'article',
        { class: 'creator-card' },
        h(
          'header',
          { class: 'creator-card__head' },
          h('h4', { text: creator.name }),
          badge(
            creator.reputationTier,
            creator.reputationTier === '宗师'
              ? 'gold'
              : creator.reputationTier === '名家'
                ? 'teal'
                : 'muted',
          ),
        ),
        h('p', { class: 'creator-card__bio', text: creator.background }),
        h('p', { class: 'label', text: '真品规范（唯一判定依据）' }),
        traitTable(creator.signatureTraits),
        h('p', {
          class: 'hint',
          text: `行情区间 ${fmt(creator.quoteRange[0])}~${fmt(creator.quoteRange[1])} 星际币（普世锚，不随本地物价膨胀）`,
        }),
      ),
    ),
  );

  return h(
    'div',
    { class: 'stack' },
    section(
      '',
      h(
        'div',
        { class: 'world-card' },
        h(
          'div',
          { class: 'world-card__head' },
          h('h2', { text: level.world.name }),
          h(
            'div',
            { class: 'chip-row' },
            badge(
              `物价指数 ${level.world.priceIndex.toFixed(2)}`,
              level.world.priceIndex >= 1.2 ? 'red' : 'teal',
            ),
            badge(level.world.genreSeed, 'muted'),
            badge(`本地货币：${level.world.currencyName}（纯风味）`, 'muted'),
          ),
        ),
        h('p', { class: 'world-card__lore', text: level.world.lore }),
        h('p', { class: 'hint', text: `居民偏好：${level.world.residentPref}` }),
      ),
    ),
    section(
      `鉴宝精灵「${level.fairy.name}」`,
      h(
        'p',
        { class: 'muted' },
        `人设：${level.fairy.persona} · 开场简报免费，不占询问额度；它懂行，但不知道任何单件的真伪与价格。`,
      ),
      h(
        'ul',
        { class: 'briefing' },
        ...level.fairy.briefing.map((line) => h('li', { text: line })),
      ),
      h('p', {
        class: 'hint',
        text: `本关询问额度：${session.fairyQuota} 次（集市阶段可用，问题 ≤50 字）`,
      }),
    ),
    section('创作人档案', creators),
    state.busy?.kind === 'models'
      ? section('集市布展', progressSlots(state.busy))
      : h(
          'div',
          { class: 'actions-row' },
          button('开市', { variant: 'primary', onClick: () => beginShopping() }),
          button('换一个世界', { variant: 'subtle', onClick: () => nextLevel() }),
        ),
    state.busy?.kind === 'models'
      ? h(
          'div',
          { class: 'actions-row' },
          button('先开市（占位模型也能看）', {
            variant: 'primary',
            onClick: () => beginShopping(),
          }),
          button('停止布展', { variant: 'subtle', onClick: () => cancelModelGeneration() }),
        )
      : null,
  );
}
