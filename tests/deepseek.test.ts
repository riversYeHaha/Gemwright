import { describe, expect, it, vi } from 'vitest';
import { DeepSeekClient, DeepSeekError } from '../src/api/deepseek';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DeepSeekClient', () => {
  it('chat：Bearer 鉴权 + JSON mode + 解析 content', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const client = new DeepSeekClient({ apiKey: 'sk-test', fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      json: true,
      maxTokens: 200,
    });
    expect(result.content).toBe('{"ok":true}');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(200);
    expect(body.stream).toBe(false);
  });

  it('HTTP 错误带上官方 message，不泄露请求头', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: 'Insufficient Balance', code: 'invalid_request_error' } }, 402),
    );
    const client = new DeepSeekClient({ apiKey: 'sk-secret', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      name: 'DeepSeekError',
      status: 402,
      message: 'Insufficient Balance',
    });
    try {
      await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (error) {
      expect(String(error)).not.toContain('sk-secret');
    }
  });

  it('jsonChat 容忍 markdown 代码块，解析失败抛 bad-json', async () => {
    const ok = new DeepSeekClient({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] })) as unknown as typeof fetch,
    });
    const parsed = await ok.jsonChat({ messages: [{ role: 'user', content: 'x' }] });
    expect(parsed.data).toEqual({ a: 1 });

    const bad = new DeepSeekClient({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({ choices: [{ message: { content: '这不是 JSON' } }] })) as unknown as typeof fetch,
    });
    await expect(bad.jsonChat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      name: 'DeepSeekError',
      code: 'bad-json',
    });
  });

  it('getBalance 解析余额', async () => {
    const client = new DeepSeekClient({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({
          is_available: true,
          balance_infos: [
            { currency: 'CNY', total_balance: '12.30', granted_balance: '0', topped_up_balance: '12.30' },
          ],
        })) as unknown as typeof fetch,
    });
    await expect(client.getBalance()).resolves.toEqual({
      available: true,
      balances: [{ currency: 'CNY', total: 12.3, granted: 0, toppedUp: 12.3 }],
    });
  });

  it('缺少 Key 直接抛错', () => {
    expect(() => new DeepSeekClient({ apiKey: '  ' })).toThrow(DeepSeekError);
  });
});
