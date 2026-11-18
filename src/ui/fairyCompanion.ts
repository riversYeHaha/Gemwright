import { toggleFairyPanel } from '../app/actions';
import type { AppState, ScreenName } from '../app/store';
import type { FairyStage } from '../render/fairyStage';
import type { FairyAction } from '../render/fairyRig';
import { h } from './dom';
import {
  fairyDisplayName,
  fairyReaction,
  selfTalkLine,
  snapshotOf,
  type FairyReaction,
  type FairySnapshot,
} from './fairyTalk';

/**
 * 右下角常驻的鉴宝精灵。
 *
 * - 单例 DOM，不随 router 整屏重绘而重建，所以说话 / 动画不会被刷新打断；
 * - 只在游戏屏（穿越 / 集市 / 验货 / 基地）出现；
 * - 动作由状态推导：思考 / 说话 / 开心 / 难过 / 警戒 / 待机；
 * - 偶尔自言自语，全部来自静态台词池（不调用 LLM，不泄露真伪与价格）。
 */

const GAMEPLAY_SCREENS: ReadonlySet<ScreenName> = new Set(['travel', 'market', 'inspect', 'base']);

const SELF_TALK_FIRST_MS = 5200;
const SELF_TALK_MIN_MS = 12_000;
const SELF_TALK_MAX_MS = 24_000;
const BUBBLE_MS = 6200;
const STAGE_DELAY_MS = 650;
/** 单击说句话；两次点击间隔小于这个值视为双击，打开聊天面板。 */
const DOUBLE_CLICK_MS = 280;

let root: HTMLElement | null = null;
let stageButton: HTMLButtonElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let orb: HTMLElement | null = null;
let bubble: HTMLElement | null = null;
let nameLabel: HTMLElement | null = null;
let personaLabel: HTMLElement | null = null;

let stage: FairyStage | null = null;
let stageLoading = false;
let stageReady = false;
let stageFailed = false;
let stageTimer = 0;

let visible = false;
let currentState: AppState | null = null;
let snapshot: FairySnapshot | null = null;
let lastLevelId: string | null = null;
let currentAction: FairyAction = 'idle';
let docked = false;
let pendingReaction: FairyReaction | null = null;

let bubbleTimer = 0;
let selfTalkTimer = 0;
let clickTimer = 0;
let lastClickAt = 0;

export function mountFairyCompanion(): void {
  if (root) return;

  canvas = h('canvas', {
    class: 'fairy-companion__canvas',
    attrs: { 'aria-hidden': 'true' },
  });
  orb = h('span', { class: 'fairy-companion__orb', attrs: { 'aria-hidden': 'true' } });
  nameLabel = h('span', { class: 'fairy-companion__name', text: '鎏金' });
  personaLabel = h('span', { class: 'fairy-companion__persona', text: '毒舌学者' });
  bubble = h('div', {
    class: 'fairy-companion__bubble',
    attrs: { 'aria-live': 'polite' },
  });

  stageButton = h(
    'button',
    {
      class: 'fairy-companion__stage',
      attrs: { type: 'button', title: '单击说句话，双击唤出精灵面板' },
      on: {
        click: () => {
          const state = currentState;
          if (!state) return;
          const now = performance.now();
          if (now - lastClickAt < DOUBLE_CLICK_MS) {
            lastClickAt = 0;
            clearTimeout(clickTimer);
            clickTimer = 0;
            if (state.screen === 'market' && state.level && state.session) {
              toggleFairyPanel(true);
            } else {
              showBubble(
                state.level ? selfTalkLine(state) : '先找到一座坊市，我才有热闹可看。',
                'talk',
                5200,
              );
            }
            return;
          }
          lastClickAt = now;
          clearTimeout(clickTimer);
          clickTimer = window.setTimeout(() => {
            clickTimer = 0;
            const latest = currentState;
            if (!visible || docked) return;
            showBubble(
              latest?.level ? selfTalkLine(latest) : '先找到一座坊市，我才有热闹可看。',
              'talk',
              5200,
            );
          }, DOUBLE_CLICK_MS);
        },
      },
    },
    h('span', { class: 'fairy-companion__aura', attrs: { 'aria-hidden': 'true' } }),
    canvas,
    orb,
    h(
      'span',
      { class: 'fairy-companion__plate' },
      nameLabel,
      h('span', { class: 'fairy-companion__dot', attrs: { 'aria-hidden': 'true' } }),
      personaLabel,
    ),
  );

  root = h(
    'div',
    { class: 'fairy-companion', attrs: { 'data-fairy-companion': '' } },
    bubble,
    stageButton,
  );
  document.body.append(root);
  document.addEventListener('visibilitychange', onPageVisibility);
  window.addEventListener('beforeunload', disposeFairyCompanion);
}

/** 页面切走时停掉自语 / 气泡，回来再续；渲染 Worker 自己也会收到 pause。 */
function onPageVisibility(): void {
  if (document.hidden) {
    clearTimeout(bubbleTimer);
    clearTimeout(selfTalkTimer);
    bubbleTimer = 0;
    selfTalkTimer = 0;
    bubble?.classList.remove('is-visible');
    root?.classList.remove('is-talking');
    return;
  }
  if (!visible || docked) return;
  stage?.setPaused(false);
  ensureSelfTalk();
}

/** 每次 router 重绘后调用；DOM / WebGL 舞台由单例持有。 */
export function updateFairyCompanion(state: AppState): void {
  mountFairyCompanion();
  currentState = state;
  const nextVisible = GAMEPLAY_SCREENS.has(state.screen);
  const wasVisible = visible;

  if (!nextVisible) {
    if (wasVisible) hideCompanion();
    snapshot = snapshotOf(state);
    return;
  }

  if (!wasVisible) showCompanion();

  const next = snapshotOf(state);
  updateIdentity(state);
  const nextDocked = state.screen === 'market' && state.fairyOpen;
  if (nextDocked !== docked) {
    docked = nextDocked;
    root?.classList.toggle('is-docked', docked);
    if (docked) {
      pendingReaction = null;
      clearTimeout(bubbleTimer);
      clearTimeout(selfTalkTimer);
      bubbleTimer = 0;
      selfTalkTimer = 0;
      bubble?.classList.remove('is-visible');
      root?.classList.remove('is-talking');
      if (stageTimer) {
        clearTimeout(stageTimer);
        stageTimer = 0;
        stageLoading = false;
      }
      stage?.setPaused(true);
    } else {
      ensureStage();
      stage?.setPaused(false);
      const pending = pendingReaction;
      pendingReaction = null;
      if (pending?.line) showBubble(pending.line, pending.action);
      else ensureSelfTalk();
    }
  }
  if (docked) {
    // 面板打开时精灵让位，但把反应攒着；关闭面板后再补一个动作 / 气泡。
    const reaction = fairyReaction(snapshot, next);
    if (reaction.line) pendingReaction = reaction;
    snapshot = next;
    return;
  }

  const reaction = fairyReaction(snapshot, next);
  snapshot = next;

  if (!wasVisible) {
    if (next.levelId && lastLevelId !== next.levelId) {
      lastLevelId = next.levelId;
      showBubble('新地方，新规矩；先看创作人的规范。', 'talk');
    } else {
      scheduleSelfTalk(SELF_TALK_FIRST_MS);
    }
    return;
  }

  if (reaction.line) {
    showBubble(reaction.line, reaction.action);
  } else if (!bubbleTimer) {
    // 气泡还在说话时不要被一次普通 store 更新切回 idle。
    setAction(reaction.action);
    ensureSelfTalk();
  }
}

export function disposeFairyCompanion(): void {
  clearTimeout(bubbleTimer);
  clearTimeout(selfTalkTimer);
  clearTimeout(stageTimer);
  clearTimeout(clickTimer);
  bubbleTimer = 0;
  selfTalkTimer = 0;
  stageTimer = 0;
  clickTimer = 0;
  lastClickAt = 0;
  stage?.dispose();
  stage = null;
  stageReady = false;
  stageLoading = false;
  stageFailed = false;
  window.removeEventListener('beforeunload', disposeFairyCompanion);
  document.removeEventListener('visibilitychange', onPageVisibility);
  document.body.classList.remove('has-fairy');
  root?.remove();
  root = null;
  stageButton = null;
  canvas = null;
  orb = null;
  bubble = null;
  nameLabel = null;
  personaLabel = null;
  visible = false;
  docked = false;
  pendingReaction = null;
  currentState = null;
  snapshot = null;
  lastLevelId = null;
  currentAction = 'idle';
}

/* ------------------------------------------------------------------ */
/* 显示 / 动作 / 说话                                                  */
/* ------------------------------------------------------------------ */

function showCompanion(): void {
  visible = true;
  root?.classList.add('is-visible');
  document.body.classList.add('has-fairy');
  ensureStage();
  stage?.setPaused(false);
}

function hideCompanion(): void {
  visible = false;
  docked = false;
  pendingReaction = null;
  root?.classList.remove('is-visible', 'is-docked', 'is-talking');
  document.body.classList.remove('has-fairy');
  bubble?.classList.remove('is-visible');
  clearTimeout(bubbleTimer);
  clearTimeout(selfTalkTimer);
  clearTimeout(clickTimer);
  clickTimer = 0;
  lastClickAt = 0;
  if (stageTimer) {
    clearTimeout(stageTimer);
    stageTimer = 0;
    stageLoading = false;
  }
  bubbleTimer = 0;
  selfTalkTimer = 0;
  stage?.setPaused(true);
}

function updateIdentity(state: AppState): void {
  const { name, persona } = fairyDisplayName(state);
  if (nameLabel) nameLabel.textContent = name;
  if (personaLabel) personaLabel.textContent = persona;
  stageButton?.setAttribute('aria-label', `和鉴宝精灵「${name}」互动，双击打开对话`);
}

function setAction(action: FairyAction): void {
  currentAction = action;
  if (root) root.dataset.action = action;
  if (stage && stageReady) stage.play(action);
}

function showBubble(text: string, action: FairyAction, duration = BUBBLE_MS): void {
  if (!visible || !bubble || !root) return;
  bubble.textContent = text;
  bubble.classList.add('is-visible');
  root.classList.add('is-talking');
  setAction(action);
  clearTimeout(bubbleTimer);
  clearTimeout(selfTalkTimer);
  selfTalkTimer = 0;
  bubbleTimer = window.setTimeout(() => hideBubble(), duration);
}

function hideBubble(): void {
  bubbleTimer = 0;
  bubble?.classList.remove('is-visible');
  root?.classList.remove('is-talking');
  const state = currentState;
  setAction(state && (state.fairyBusy || state.busy) ? 'think' : 'idle');
  ensureSelfTalk();
}

function ensureSelfTalk(): void {
  if (!visible || selfTalkTimer || bubbleTimer) return;
  scheduleSelfTalk();
}

function scheduleSelfTalk(delay?: number): void {
  if (!visible) return;
  clearTimeout(selfTalkTimer);
  const wait = delay ?? randomBetween(SELF_TALK_MIN_MS, SELF_TALK_MAX_MS);
  selfTalkTimer = window.setTimeout(() => {
    selfTalkTimer = 0;
    if (!visible || !currentState) return;
    const busy = currentState.fairyBusy || currentState.busy;
    if (bubbleTimer || busy) {
      scheduleSelfTalk();
      return;
    }
    showBubble(selfTalkLine(currentState), 'talk', 5400);
  }, wait);
}

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * Math.max(0, max - min));
}

/* ------------------------------------------------------------------ */
/* 3D 舞台（懒加载，避开首屏 / 首帧）                                   */
/* ------------------------------------------------------------------ */

function ensureStage(): void {
  if (stage || stageLoading || stageFailed || !canvas || !visible) return;
  stageLoading = true;
  stageTimer = window.setTimeout(() => {
    stageTimer = 0;
    if (!visible) {
      stageLoading = false;
      return;
    }
    void import('../render/fairyStage')
      .then(({ createFairyStage }) => {
        stageLoading = false;
        if (!canvas || !root || !visible) return;
        const accent =
          (currentState?.level?.fairy.persona ?? '毒舌学者') === '傲娇幼龙'
            ? '#f6b73c'
            : (currentState?.level?.fairy.persona ?? '') === '絮叨老灵魂'
              ? '#7dd3fc'
              : '#5eead4';
        try {
          stage = createFairyStage(canvas, {
            accent,
            onReady: () => {
              stageReady = true;
              root?.classList.add('is-ready');
              if (docked) stage?.setPaused(true);
              else stage?.play(currentAction);
            },
            onError: (error) => {
              // GLB 解析失败不算致命：舞台内部已经回退到程序化骨架。
              console.warn('[gemwright] 陪伴精灵模型回退', error);
            },
          });
        } catch (error) {
          stageFailed = true;
          root?.classList.add('is-fallback');
          console.warn('[gemwright] 陪伴精灵 3D 舞台不可用，保留 CSS 兜底', error);
        }
      })
      .catch((error: unknown) => {
        stageLoading = false;
        stageFailed = true;
        root?.classList.add('is-fallback');
        console.warn('[gemwright] 陪伴精灵 3D 舞台加载失败', error);
      });
  }, STAGE_DELAY_MS);
}

/** 给测试 / 调试用：当前动作与气泡文本。 */
export function fairyCompanionDebug(): {
  visible: boolean;
  action: FairyAction;
  bubble: string;
  ready: boolean;
} {
  return {
    visible,
    action: currentAction,
    bubble: bubble?.textContent ?? '',
    ready: stageReady,
  };
}
