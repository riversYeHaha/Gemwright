import { describe, expect, it } from 'vitest';
import type { ChatClient } from '../src/api/types';
import { createDemoLevel } from '../src/game/fixtures/demoLevel';
import {
  BLOCKED_ANSWER,
  askFairy,
  buildFairyContext,
  fairyContextSnapshot,
  filterAnswer,
  sanitizeQuestion,
} from '../src/game/fairy';

const level = createDemoLevel(1_700_000_000_000);

describe('精灵信息防火墙', () => {
  it('上下文不含 stalls / 任何价格 / 单件名 / quoteRange', () => {
    const context = buildFairyContext(level);
    const snapshot = fairyContextSnapshot(context);
    expect(snapshot).not.toContain('"stalls"');
    expect(snapshot).not.toContain('星穹之核');
    expect(snapshot).not.toContain('salePrice');
    expect(snapshot).not.toContain('trueValue');
    expect(snapshot).not.toContain('bottomPrice');
    expect(snapshot).not.toContain('quoteRange');
    expect(snapshot).not.toContain('tamperOps');
    expect(context.tamperTypes).toEqual(['count_change', 'base_flip']);
    expect(context.world.lore).toContain('物贵');
    expect(context.creators.map((creator) => creator.name)).toContain('老锻翁·格罗姆');
  });

  it('系统提示词包含防火墙指令，回答上限 100 字', async () => {
    let seen = '';
    const client: ChatClient = {
      chat: async (options) => {
        seen = options.messages[0]?.content ?? '';
        return { content: '此地物贵，钱不经花，先看清楚再出手。' };
      },
    };
    const answer = await askFairy(client, buildFairyContext(level), '这世界的东西贵不贵？');
    expect(answer.blocked).toBe(false);
    expect(seen).toContain('你绝对不知道');
    expect(seen).toContain('任何价格');
    expect(seen).toContain('100');
  });
});

describe('问题与回答清洗', () => {
  it('问题 ≤50 字，去空白，空问题被拒', () => {
    expect(sanitizeQuestion('  这世界的仿品爱动哪里？  ')).toEqual({
      ok: true,
      value: '这世界的仿品爱动哪里？',
    });
    expect(sanitizeQuestion('')).toMatchObject({ ok: false });
    expect(sanitizeQuestion('问'.repeat(51))).toMatchObject({ ok: false });
    expect(sanitizeQuestion('问'.repeat(50))).toMatchObject({ ok: true });
  });

  it('回答出现件数编号时整段替换为挡回语', () => {
    for (const text of [
      '第 3 件是假的',
      '第三件绝对有问题',
      'T2 是仿品',
      '编号 4 的那件别买',
      '珍宝 5 值得收',
    ]) {
      const result = filterAnswer(text);
      expect(result.blocked).toBe(true);
      expect(result.answer).toBe(BLOCKED_ANSWER);
    }
  });

  it('回答被压成单行、截断到 100 字', () => {
    const long = '好'.repeat(140);
    const result = filterAnswer(`第一行\n第二行 ${long}`);
    expect(result.blocked).toBe(false);
    expect([...result.answer]).toHaveLength(100);
    expect(result.answer).not.toContain('\n');
  });

  it('LLM 想泄底也会被前端过滤兜底', async () => {
    const client: ChatClient = {
      chat: async () => ({ content: '跟你说实话，第 3 件是仿的，别买。' }),
    };
    const answer = await askFairy(client, buildFairyContext(level), '第三件是不是假的？');
    expect(answer.blocked).toBe(true);
    expect(answer.answer).toBe(BLOCKED_ANSWER);
  });
});
