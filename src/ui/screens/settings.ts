import {
  dismissNotice,
  goStart,
  navigate,
  resetProfile,
  testDeepSeekKey,
  updateSettings,
  wipeKeys,
} from '../../app/actions';
import type { AppState } from '../../app/store';
import { LUX3D_BASES, estimateCredits } from '../../api/lux3d';
import { ITEMS_PER_LEVEL, LUX3D_CREDITS_PER_ITEM } from '../../config/constants';
import { button, fmt, h } from '../dom';
import { badge, noticeBar, screenHead, section } from '../components';

/** 设置 / 首次进入：两把 Key + 模式开关 + 存档重置（Key 只存本机）。 */
export function renderSettings(state: AppState): HTMLElement {
  const deepseekInput = h('input', {
    class: 'input',
    attrs: {
      type: 'password',
      placeholder: 'sk-…（DeepSeek）',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'DeepSeek API Key',
    },
  });
  deepseekInput.value = state.settings.deepseekKey;

  const lux3dInput = h('input', {
    class: 'input',
    attrs: {
      type: 'password',
      placeholder: 'Lux3D / Aholo API Key',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Lux3D API Key',
    },
  });
  lux3dInput.value = state.settings.lux3dKey;

  const regionSelect = h(
    'select',
    { class: 'input', attrs: { 'aria-label': 'Lux3D 地区' } },
    h('option', { text: '国内 · api.aholo.cn', attrs: { value: 'china' } }),
    h('option', { text: '国际 · api.aholo.ai', attrs: { value: 'global' } }),
  );
  regionSelect.value = state.settings.region;

  const quickMode = h('input', { attrs: { type: 'checkbox', id: 'quick-mode' } });
  quickMode.checked = state.settings.quickBargain;

  const ackCost = h('input', { attrs: { type: 'checkbox', id: 'ack-cost' } });
  ackCost.checked = state.settings.acknowledgedCreditCost;

  const collect = (): void => {
    updateSettings({
      deepseekKey: deepseekInput.value.trim(),
      lux3dKey: lux3dInput.value.trim(),
      region: regionSelect.value === 'global' ? 'global' : 'china',
      quickBargain: quickMode.checked,
      acknowledgedCreditCost: ackCost.checked,
    });
  };

  const keyFields = h(
    'div',
    { class: 'form-grid' },
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label', text: 'DeepSeek API Key' }),
      deepseekInput,
      h('span', {
        class: 'field__hint',
        text: '用于关卡生成 / 精灵问答 / 摊主台词。platform.deepseek.com → API keys',
      }),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label', text: 'Lux3D（Aholo）API Key' }),
      lux3dInput,
      h('span', {
        class: 'field__hint',
        text: '用于文生 3D。注意：请求头直接放 Key，不能加 Bearer 前缀。',
      }),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label', text: 'Lux3D 地区' }),
      regionSelect,
      h('span', {
        class: 'field__hint',
        text: `当前端点：${LUX3D_BASES[state.settings.region]}（国内外 Key 不通用）`,
      }),
    ),
  );

  const switches = h(
    'div',
    { class: 'switches' },
    h(
      'label',
      { class: 'switch', attrs: { for: 'quick-mode' } },
      quickMode,
      h(
        'span',
        null,
        h('strong', { text: '快速议价模式' }),
        h('em', { text: '纯本地公式判定 + 预生成台词池，零 LLM 调用' }),
      ),
    ),
    h(
      'label',
      { class: 'switch', attrs: { for: 'ack-cost' } },
      ackCost,
      h(
        'span',
        null,
        h('strong', { text: '我了解积分消耗' }),
        h('em', {
          text: `文生 3D ${LUX3D_CREDITS_PER_ITEM} 积分/件，一关 ${ITEMS_PER_LEVEL} 件 ≈ ${estimateCredits(ITEMS_PER_LEVEL)} 积分`,
        }),
      ),
    ),
  );

  const actionsRow = h(
    'div',
    { class: 'actions-row' },
    button('保存设置', {
      variant: 'primary',
      onClick: () => {
        collect();
      },
    }),
    button('测试 DeepSeek Key', {
      variant: 'ghost',
      onClick: () => {
        collect();
        void testDeepSeekKey(deepseekInput.value.trim());
      },
    }),
    button('清除两把 Key', { variant: 'danger', onClick: () => wipeKeys() }),
    state.session
      ? button('回到当前关卡', { variant: 'subtle', onClick: () => navigate('market') })
      : null,
    button('回开始页', { variant: 'subtle', onClick: () => goStart() }),
  );

  return h(
    'div',
    { class: 'screen-body' },
    screenHead(
      '设置',
      '两把 Key 只存这台设备的浏览器里，不经过任何服务器；AI 直连由你自己的 Key 付费。',
      [
        badge('零后端', 'teal'),
        badge(state.settings.quickBargain ? '快速议价' : '混合议价', 'gold'),
      ],
    ),
    noticeBar(state.notice, () => dismissNotice()),
    section('API Key', keyFields, switches, actionsRow),
    section(
      '隐私与成本',
      h(
        'ul',
        { class: 'bullets' },
        h('li', {
          text: 'Key 存 localStorage，仅在请求 DeepSeek / Lux3D 时作为请求头发送；页面不加载任何第三方脚本。',
        }),
        h('li', {
          text: `每关 5 件文生 3D ≈ ${estimateCredits(ITEMS_PER_LEVEL)} 积分；关卡 JSON 与 GLB 存 IndexedDB，重开同关零积分重跑。`,
        }),
        h('li', { text: '免费档 Lux3D 并发为 5，恰好一关 5 件并行，不会排队到第 6 件。' }),
      ),
    ),
    section(
      '存档',
      h(
        'p',
        { class: 'muted' },
        `当前：Lv.${state.player.level} · ${fmt(state.player.funds)} 星际币 · ${state.player.xp} 经验`,
      ),
      h(
        'div',
        { class: 'actions-row' },
        button('重置存档（回 1000 资金 / Lv.1）', {
          variant: 'danger',
          onClick: () => resetProfile(),
        }),
        button('去穿越', { variant: 'ghost', onClick: () => navigate('travel') }),
      ),
    ),
  );
}
