import type { AppState } from '../app/store';
import type { FairyAction } from '../render/fairyRig';
import type { LevelPhase } from '../types/level';

/** 精灵台词与动作推导：纯函数，方便测试，也保证不碰真伪 / 价格数据。 */

export type NoticeKind = 'info' | 'error' | 'success';

export interface FairySnapshot {
  levelId: string | null;
  levelName: string | null;
  logLength: number;
  lastBlocked: boolean;
  purchased: number;
  askLeft: number;
  offerLeft: number;
  phase: LevelPhase | null;
  busy: boolean;
  fairyBusy: boolean;
  noticeKind: NoticeKind | null;
  noticeText: string | null;
}

export interface FairyReaction {
  action: FairyAction;
  line: string | null;
}

const GREETING_LINE = '新地方，新规矩；先看创作人的规范。';
const THINK_LINE = '让我看看……别催。';
const BLOCKED_LINE = '这个问题，我可不敢接。';
const ANSWER_LINE = '情报给你了，判断还是你自己的事。';
const PURCHASE_LINE = '成交？拿稳，别让摊主反悔。';
const ERROR_LINE = '先别急，把 Key 和网络理顺再上路。';
const SUCCESS_LINE = '成了。下一件见分晓。';
const BASE_LINE = '收摊了？真相在基地等你。';
const NO_QUOTA_LINE = '问额度见底了，接下来靠你自己的眼睛。';

export function snapshotOf(state: AppState): FairySnapshot {
  const session = state.session;
  const log = session?.state.fairyLog ?? [];
  const last = log[log.length - 1];
  const purchased = session
    ? Object.values(session.state.items).filter((item) => item.status === 'purchased').length
    : 0;
  return {
    levelId: state.level?.id ?? null,
    levelName: state.level?.world.name ?? null,
    logLength: log.length,
    lastBlocked: Boolean(last?.blocked),
    purchased,
    askLeft: session ? Math.max(0, session.fairyQuota - session.state.askUsed) : 0,
    offerLeft: session ? Math.max(0, session.offerQuota - session.state.offersUsed) : 0,
    phase: session?.phase ?? null,
    busy: Boolean(state.busy),
    fairyBusy: state.fairyBusy,
    noticeKind: state.notice?.kind ?? null,
    noticeText: state.notice?.text ?? null,
  };
}

/** 状态变化 → 精灵动作 + 一句反应。优先级：新回答 > 成交 > 提示 > 忙/换世界/收摊/额度。 */
export function fairyReaction(prev: FairySnapshot | null, next: FairySnapshot): FairyReaction {
  if (!prev) {
    return next.levelId ? { action: 'talk', line: GREETING_LINE } : { action: 'idle', line: null };
  }

  if (next.logLength > prev.logLength) {
    return next.lastBlocked
      ? { action: 'sad', line: BLOCKED_LINE }
      : { action: 'talk', line: ANSWER_LINE };
  }

  if (next.purchased > prev.purchased) {
    return { action: 'happy', line: PURCHASE_LINE };
  }

  if (
    next.noticeText !== prev.noticeText &&
    (next.noticeKind === 'error' || next.noticeKind === 'success')
  ) {
    return next.noticeKind === 'error'
      ? { action: 'sad', line: ERROR_LINE }
      : { action: 'happy', line: SUCCESS_LINE };
  }

  if (next.fairyBusy || next.busy) {
    return prev.fairyBusy || prev.busy
      ? { action: 'think', line: null }
      : { action: 'think', line: THINK_LINE };
  }

  if (next.levelId && next.levelId !== prev.levelId) {
    return { action: 'talk', line: GREETING_LINE };
  }

  if (next.phase === 'base' && prev.phase === 'market') {
    return { action: 'alert', line: BASE_LINE };
  }

  if (next.askLeft === 0 && prev.askLeft > 0) {
    return { action: 'alert', line: NO_QUOTA_LINE };
  }

  return { action: 'idle', line: null };
}

const PERSONA_LINES: Record<string, string[]> = {
  毒舌学者: [
    '你盯着标价的样子，像在给钱包做心肺复苏。',
    '别问我哪件是真的。我要是知道，早自己开张了。',
    '摊主笑得越甜，账越要算得慢。',
    '规范写在墙上，偏偏有人只看得见价格。',
    '你数星砂的耐心，比数工资时还少。',
  ],
  絮叨老灵魂: [
    '我年轻那会儿，坊市里可没这么多花招……',
    '慢点走，先看创作人的规矩，再看货。',
    '别嫌我啰嗦：颗数、色族、形制、底座，一样都别漏。',
    '钱要花在刀刃上，眼力要花在货上。',
  ],
  傲娇幼龙: [
    '哼，这种货色也值得你犹豫这么久？',
    '我才不是担心你亏钱，只是不想陪你睡大街。',
    '看清楚了再出价，别让我替你脸红。',
    '你要真看走眼，我可不会帮你圆场。',
  ],
};

const GENERIC_LINES = [
  '这地方的钱，好像比别处更烫手。',
  '别急着掏钱，先让摊主多演一会儿。',
  '情报是我的，判断是你的。',
  '有些东西，看久了反而更看不清。',
  '你听见没有？那摊主的报价里藏着心虚。',
  '我闻到了铜臭味，还有一点……做旧的味道。',
];

const TUTORIAL_LINES = [
  '教学关不花积分，正好把眼力练稳。',
  '数清楚星砂，再决定掏不掏钱。',
  '记住：规范不多不少，多一颗也是破绽。',
];

/** 偶尔的自言自语；只取静态台词池，不调用模型，也绝不包含真伪 / 价格。 */
export function selfTalkLine(state: AppState, random: () => number = Math.random): string {
  const session = state.session;
  const persona = state.level?.fairy.persona ?? '毒舌学者';
  const worldName = state.level?.world.name;
  const contextual: string[] = [];

  if (state.level?.kind === 'tutorial') contextual.push(...TUTORIAL_LINES);
  if (session && session.fairyQuota - session.state.askUsed <= 0) {
    contextual.push('问额度空了。接下来，靠你自己的眼睛。');
  }
  if (session && session.offerQuota - session.state.offersUsed <= 2) {
    contextual.push('出价额度不多了，别拿它练手。');
  }
  if (session?.phase === 'base') {
    contextual.push('真相已经摆上桌了，别急着怪自己。');
  }
  if (state.player.funds < 300) {
    contextual.push('钱袋见底了，接下来每一步都得算。');
  }
  if (worldName) {
    contextual.push(`「${worldName}」这地方，连风里都带着价码。`);
  }

  const pool = [...(PERSONA_LINES[persona] ?? []), ...GENERIC_LINES];
  if (contextual.length > 0 && random() < 0.45) {
    return pick(contextual, random);
  }
  return pick(pool, random);
}

function pick(lines: string[], random: () => number): string {
  if (lines.length === 0) return GENERIC_LINES[0] ?? '……';
  const index = Math.min(lines.length - 1, Math.floor(random() * lines.length));
  return lines[index] ?? GENERIC_LINES[0] ?? '……';
}

export function fairyDisplayName(state: AppState): { name: string; persona: string } {
  return {
    name: state.level?.fairy.name ?? '鎏金',
    persona: state.level?.fairy.persona ?? '毒舌学者',
  };
}
