import type { AppState } from '../app/store';
import {
  firstUndoneObjective,
  tutorialObjectives,
  type TutorialObjective,
} from '../game/tutorial/level';
import { h } from './dom';

/**
 * 教学关卡的目标引导：六步全部由运行时状态推导，不埋额外事件。
 * 在任何教学屏（穿越 / 集市 / 验货 / 基地）复用同一个组件。
 */
export function tutorialCoach(state: AppState): HTMLElement | null {
  const level = state.level;
  const session = state.session;
  if (!level || level.kind !== 'tutorial' || !session) return null;

  const purchasedCount = Object.values(session.state.items).filter(
    (item) => item.status === 'purchased',
  ).length;

  const objectives = tutorialObjectives({
    progress: state.tutorial,
    askUsed: session.state.askUsed,
    purchasedCount,
    phase: session.phase,
    settled: Boolean(session.state.settlement),
  });
  const current = firstUndoneObjective(objectives);

  return h(
    'aside',
    { class: 'coach', attrs: { 'aria-label': '教学进度' } },
    h(
      'div',
      { class: 'coach__head' },
      h('span', { class: 'coach__kicker', text: '教学关卡' }),
      h('span', {
        class: 'coach__progress',
        text: `${objectives.filter((o) => o.done).length}/${objectives.length}`,
      }),
    ),
    h(
      'ol',
      { class: 'coach__steps' },
      ...objectives.map((objective, index) =>
        h(
          'li',
          {
            class: `coach-step${objective.done ? ' coach-step--done' : ''}${
              current?.id === objective.id ? ' coach-step--current' : ''
            }`,
          },
          h('span', { class: 'coach-step__index', text: objective.done ? '✓' : String(index + 1) }),
          h('span', { class: 'coach-step__title', text: objective.title }),
        ),
      ),
    ),
    current
      ? h('p', { class: 'coach__hint', text: current.hint })
      : h('p', {
          class: 'coach__hint',
          text: '六步都完成了：这局教的就是正式关卡里的全部核心玩法。',
        }),
  );
}

/** 供测试用：直接拿当前目标。 */
export function currentTutorialObjective(state: AppState): TutorialObjective | undefined {
  const session = state.session;
  if (!session) return undefined;
  const purchasedCount = Object.values(session.state.items).filter(
    (item) => item.status === 'purchased',
  ).length;
  return firstUndoneObjective(
    tutorialObjectives({
      progress: state.tutorial,
      askUsed: session.state.askUsed,
      purchasedCount,
      phase: session.phase,
      settled: Boolean(session.state.settlement),
    }),
  );
}
