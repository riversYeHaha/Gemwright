import { askFairyQuestion, askTutorialQuestion, toggleFairyPanel } from '../app/actions';
import type { AppState } from '../app/store';
import { TUTORIAL_QA } from '../game/tutorial/level';
import type { LevelSession } from '../game/level';
import type { FairyExchange, LevelJson } from '../types/level';
import { button, h, typewrite } from './dom';
import { selfTalkLine } from './fairyTalk';

const GAMEPLAY_SCREENS = new Set<AppState['screen']>(['travel', 'market', 'inspect', 'base']);
const SMALL_TALK_LIMIT = 20;

interface SmallTalk {
  question: string;
  answer: string;
}

let root: HTMLElement | null = null;
let currentState: AppState | null = null;
let currentLevelId = '';
let smallTalk: SmallTalk[] = [];

/**
 * 常驻精灵的对话浮窗：固定层，不参与集市布局。
 * - 集市 / 教学关：复用精灵简报、限次问答、打字机回答；
 * - 其它游戏屏：本地闲聊，不消耗询问额度，也绝不读单件真伪 / 价格。
 */
export function updateFairyChat(state: AppState): void {
  currentState = state;
  if (!root) mountChat();
  const visible = state.fairyOpen && GAMEPLAY_SCREENS.has(state.screen) && Boolean(state.level);
  if (!visible) {
    if (root) {
      root.hidden = true;
      root.replaceChildren();
    }
    return;
  }
  const levelId = state.level?.id ?? '';
  if (levelId !== currentLevelId) {
    currentLevelId = levelId;
    smallTalk = [];
  }
  if (!root) return;
  const wasVisible = !root.hidden;
  root.hidden = false;
  root.replaceChildren(renderChat(state, rerender));
  const panel = root.querySelector<HTMLElement>('.fairy-chat__panel');
  if (panel) panel.scrollTop = panel.querySelector('.fairy-log__entry') ? panel.scrollHeight : 0;
  if (!wasVisible) {
    const focusable =
      root.querySelector<HTMLElement>('input, .fairy-question') ?? root.querySelector('button');
    focusable?.focus();
  }
}

export function disposeFairyChat(): void {
  root?.remove();
  root = null;
  currentState = null;
  currentLevelId = '';
  smallTalk = [];
  document.removeEventListener('keydown', onKeyDown);
}

function mountChat(): void {
  root = h('section', {
    class: 'fairy-chat',
    attrs: {
      role: 'dialog',
      'aria-label': '和鉴宝精灵对话',
      'aria-modal': 'false',
      hidden: '',
    },
  });
  document.body.append(root);
  document.addEventListener('keydown', onKeyDown);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !root || root.hidden) return;
  event.preventDefault();
  toggleFairyPanel(false);
}

function rerender(): void {
  if (!root || !currentState || root.hidden) return;
  root.replaceChildren(renderChat(currentState, rerender));
}

function renderChat(state: AppState, refresh: () => void): HTMLElement {
  const level = state.level;
  if (!level) return h('div');
  if (
    state.screen === 'market' &&
    state.session &&
    state.session.phase === 'market' &&
    level.kind === 'tutorial'
  ) {
    return renderTutorialChat(level, state.session);
  }
  if (state.screen === 'market' && state.session && state.session.phase === 'market') {
    return renderMarketChat(level, state.session, state.fairyBusy);
  }
  return renderSmallTalk(state, refresh);
}

function header(name: string, persona: string, right: HTMLElement): HTMLElement {
  return h(
    'header',
    { class: 'fairy-drawer__head' },
    h('div', null, h('h3', { text: `精灵「${name}」` }), h('p', { class: 'hint', text: persona })),
    right,
  );
}

function headActions(label: string): HTMLElement {
  return h(
    'div',
    { class: 'fairy-drawer__head-actions' },
    h('div', { class: 'fairy-drawer__quota', text: label }),
    button('关闭', { variant: 'subtle', onClick: () => toggleFairyPanel(false) }),
  );
}

function renderMarketChat(level: LevelJson, session: LevelSession, busy: boolean): HTMLElement {
  const askLeft = Math.max(0, session.fairyQuota - session.state.askUsed);
  const input = h('input', {
    class: 'input',
    attrs: {
      type: 'text',
      maxlength: '50',
      placeholder: '问点行内的，比如：这世界的仿品爱动哪里？',
      'aria-label': '向鉴宝精灵提问',
    },
  });
  const counter = h('span', { class: 'counter', text: '0/50' });
  input.addEventListener('input', () => {
    counter.textContent = `${[...input.value].length}/50`;
  });
  const submit = (): void => {
    const value = input.value.trim();
    if (!value || busy) return;
    input.value = '';
    counter.textContent = '0/50';
    void askFairyQuestion(value);
  };
  const form = h(
    'form',
    {
      class: 'ask-form',
      on: {
        submit: (event) => {
          event.preventDefault();
          submit();
        },
      },
    },
    input,
    counter,
    button('问', {
      variant: 'primary',
      disabled: askLeft <= 0 || busy,
      onClick: submit,
    }),
  );

  return h(
    'aside',
    { class: 'fairy-drawer fairy-chat__panel' },
    header(level.fairy.name, level.fairy.persona, headActions(`${askLeft} 问`)),
    h(
      'div',
      { class: 'fairy-log' },
      session.state.fairyLog.length === 0
        ? h('p', {
            class: 'hint',
            text: '它还没开口。它懂世界、懂创作人、懂流行手法——但不知道任何单件的真伪与价格。',
          })
        : null,
      ...fairyLogEntries(level, session.state.fairyLog),
    ),
    h('p', {
      class: 'hint',
      text: `本关剩余 ${askLeft} 问（每问 ≤50 字，回答 ≤100 字）；问单件真伪会被它挡回来。`,
    }),
    form,
    h('p', {
      class: 'hint hint--warn',
      text: '每问都是一次火力分配：好问题少走弯路，烂问题白白浪费额度。',
    }),
  );
}

function renderTutorialChat(level: LevelJson, session: LevelSession): HTMLElement {
  const askLeft = Math.max(0, session.fairyQuota - session.state.askUsed);
  const asked = new Set(session.state.fairyLog.map((entry) => entry.question));
  return h(
    'aside',
    { class: 'fairy-drawer fairy-chat__panel' },
    header(level.fairy.name, level.fairy.persona, headActions(`${askLeft} 问`)),
    h(
      'div',
      { class: 'fairy-questions' },
      ...TUTORIAL_QA.map((qa) => {
        const disabled = asked.has(qa.question) || askLeft <= 0;
        return h('button', {
          class: `fairy-question${qa.blocked ? ' fairy-question--blocked' : ''}`,
          attrs: { type: 'button', ...(disabled ? { disabled: '' } : {}) },
          on: { click: () => askTutorialQuestion(qa.id) },
          text: qa.question,
        });
      }),
    ),
    h('div', { class: 'fairy-log' }, ...fairyLogEntries(level, session.state.fairyLog)),
    h('p', {
      class: 'hint',
      text: '教学关卡不调用模型：精灵只回答这几句预设话术，但照常消耗询问额度。',
    }),
    h('p', { class: 'hint hint--warn', text: '注意那个被它挡回来的问题：它真的不知道单件真伪。' }),
  );
}

function renderSmallTalk(state: AppState, refresh: () => void): HTMLElement {
  const level = state.level as LevelJson;
  const input = h('input', {
    class: 'input',
    attrs: {
      type: 'text',
      maxlength: '50',
      placeholder: '和精灵聊两句，不消耗询问额度…',
      'aria-label': '和鉴宝精灵闲聊',
    },
  });
  const counter = h('span', { class: 'counter', text: '0/50' });
  input.addEventListener('input', () => {
    counter.textContent = `${[...input.value].length}/50`;
  });
  const submit = (): void => {
    const value = input.value.trim();
    if (!value) return;
    smallTalk.push({ question: value, answer: smallTalkReply(value, state) });
    if (smallTalk.length > SMALL_TALK_LIMIT) smallTalk.shift();
    input.value = '';
    counter.textContent = '0/50';
    refresh();
    const panel = root?.querySelector<HTMLElement>('.fairy-chat__panel');
    if (panel) panel.scrollTop = panel.scrollHeight;
    root?.querySelector<HTMLInputElement>('.fairy-chat__panel input')?.focus();
  };
  const form = h(
    'form',
    {
      class: 'ask-form',
      on: {
        submit: (event) => {
          event.preventDefault();
          submit();
        },
      },
    },
    input,
    counter,
    button('聊', { variant: 'primary', onClick: submit }),
  );

  return h(
    'aside',
    { class: 'fairy-drawer fairy-chat__panel' },
    header(level.fairy.name, level.fairy.persona, headActions('闲聊')),
    h('p', {
      class: 'hint',
      text: '现在不在集市，行情问不了；不过可以随便聊两句。闲聊不消耗询问额度。',
    }),
    h(
      'div',
      { class: 'fairy-log' },
      smallTalk.length === 0
        ? h('p', { class: 'hint', text: '它抱着胳膊看你，等你先开口。' })
        : null,
      ...smallTalk.map((entry, index) => {
        const isLast = index === smallTalk.length - 1;
        const answer = h('p', {
          class: 'fairy-log__a',
          text: isLast ? '' : `${level.fairy.name}：${entry.answer}`,
        });
        if (isLast) typewrite(answer, `${level.fairy.name}：${entry.answer}`);
        return h(
          'div',
          { class: 'fairy-log__entry' },
          h('p', { class: 'fairy-log__q', text: `你：${entry.question}` }),
          answer,
        );
      }),
    ),
    form,
    h('p', { class: 'hint hint--warn', text: '单件真伪和价格不在闲聊里说——去集市看 3D、对规范。' }),
  );
}

function smallTalkReply(question: string, state: AppState): string {
  if (/真|假|赝|仿|价|多少钱|贵|便宜/.test(question)) {
    return '单件真伪和价格不在闲聊里说——去集市看 3D、对规范，别让我替你看货。';
  }
  if (/你好|在吗|嗨|hello/i.test(question)) {
    return '在。你挑货，我盯人。';
  }
  return selfTalkLine(state);
}

/** 精灵对话渲染：最后一条回答用打字机（blocked 的挡回语直接显示）。 */
function fairyLogEntries(level: LevelJson, log: FairyExchange[]): HTMLElement[] {
  return log.map((entry, index) => {
    const isLast = index === log.length - 1;
    const full = `${level.fairy.name}：${entry.answer}`;
    const answer = h('p', {
      class: `fairy-log__a${entry.blocked ? ' fairy-log__a--blocked' : ''}`,
      text: isLast && !entry.blocked ? '' : full,
    });
    if (isLast && !entry.blocked) typewrite(answer, full);
    return h(
      'div',
      { class: 'fairy-log__entry' },
      h('p', { class: 'fairy-log__q', text: `你：${entry.question}` }),
      answer,
    );
  });
}
