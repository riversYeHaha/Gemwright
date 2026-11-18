import { continueRun, navigate, startDemoLevel, startGame, startTutorial } from '../../app/actions';
import type { AppState } from '../../app/store';
import { button, h } from '../dom';
import { screenHead } from '../components';

/**
 * 新游戏页：把原来的三个开局入口从开始页挪到这里，
 * 开始页因此保持"标题 + 菜单"的常规结构。
 */
export function renderNewGame(state: AppState): HTMLElement {
  const hasSave = state.resumeAvailable && Boolean(state.level);
  const hasDeepSeek = Boolean(state.settings.deepseekKey);

  return h(
    'div',
    { class: 'screen-body' },
    screenHead('新游戏', '选一种开局方式。教学与演示关卡不需要任何 Key。', [
      button('← 返回开始页', { variant: 'subtle', onClick: () => navigate('start') }),
    ]),
    hasSave
      ? h(
          'div',
          { class: 'notice' },
          h('span', {
            class: 'notice__text',
            text: `当前有一局未完成：${state.level?.world.name ?? '未命名世界'}。教学关卡不会覆盖它；「正式开局」或「演示关卡」会覆盖续玩快照。`,
          }),
          button('继续这一局', { variant: 'subtle', onClick: () => continueRun() }),
        )
      : null,
    h(
      'div',
      { class: 'mode-grid' },
      modeCard({
        tone: 'gold',
        tag: '推荐首次游玩',
        title: '教学关卡',
        meta: '约 3 分钟 · 0 积分 · 无需 Key',
        desc: '烬岩坊市一年只开一夜。两枚星核一真一假，六步目标带你走完整个闭环。',
        points: [
          '预置故事与一真一假两件珍宝，不调用任何模型',
          '演示验货、精灵情报、砍价、基地揭晓与结算',
          '精灵包含一次"哪件是真的"防火墙挡回',
        ],
        action: button(state.tutorialCompleted ? '重玩教学关卡' : '进入教学关卡', {
          variant: 'primary',
          onClick: () => startTutorial(),
        }),
      }),
      modeCard({
        tone: 'teal',
        tag: hasDeepSeek ? '完整玩法' : '需要 DeepSeek Key',
        title: '正式开局',
        meta: '约 5 分钟 · Lux3D 约 65 积分/关',
        desc: 'LLM 现场生成异世界、创作人规范与 5 件珍宝，Lux3D 实时生成 3D 模型。每一局都不一样。',
        points: [
          '世界有独立物价、创作人档位与做伪风气',
          '先显示全屏布展动画，模型齐了再开市',
          '刷新后可从开始页继续这一局',
        ],
        action: button(hasDeepSeek ? '选择世界并出发' : '去设置 Key', {
          variant: hasDeepSeek ? 'ghost' : 'subtle',
          onClick: () => startGame(),
        }),
      }),
      modeCard({
        tone: 'blue',
        tag: '零成本体验',
        title: '演示关卡',
        meta: '0 积分 · 无需 Key · 内置 5 件',
        desc: '内置的完整集市：5 件珍宝、真伪揭晓、砍价与结算全部可用，3D 使用占位模型或预置 GLB。',
        points: ['不发起任何外部请求', '适合快速看完整流程', '会覆盖当前续玩快照'],
        action: button('进入演示关卡', { variant: 'subtle', onClick: () => startDemoLevel() }),
      }),
    ),
    h(
      'p',
      { class: 'muted mode-footnote' },
      '第一次来？先走教学关卡。它不消耗积分、不写真实存档，也不要求任何 Key。',
    ),
  );
}

function modeCard(options: {
  tone: 'gold' | 'teal' | 'blue';
  tag: string;
  title: string;
  meta: string;
  desc: string;
  points: string[];
  action: HTMLButtonElement;
}): HTMLElement {
  return h(
    'article',
    { class: `mode-card mode-card--${options.tone}` },
    h('p', { class: 'mode-card__tag', text: options.tag }),
    h('h2', { class: 'mode-card__title', text: options.title }),
    h('p', { class: 'mode-card__meta', text: options.meta }),
    h('p', { class: 'mode-card__desc', text: options.desc }),
    h(
      'ul',
      { class: 'mode-card__points' },
      ...options.points.map((point) => h('li', { text: point })),
    ),
    h('div', { class: 'mode-card__foot' }, options.action),
  );
}
