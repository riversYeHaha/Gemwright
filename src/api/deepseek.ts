import type { ChatClient, ChatOptions, ChatResult } from './types';

/** DeepSeek 官方默认基址（浏览器直连，CORS 已实测）。 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-chat';

export class DeepSeekError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
    this.code = code;
  }
}

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 单次请求超时（默认 120s：关卡 JSON 约 30~60s）。 */
  timeoutMs?: number;
}

export interface BalanceInfo {
  currency: string;
  total: number;
  granted: number;
  toppedUp: number;
}

export interface BalanceResult {
  available: boolean;
  balances: BalanceInfo[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; code?: string };
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * DeepSeek 浏览器直连适配层。
 *
 * 约定：
 * - Key 只来自玩家 localStorage，只用于 `Authorization: Bearer`，不进日志、不上传。
 * - 关卡生成 / 砍价判定用 JSON mode；精灵问答用普通模式（人设台词）。
 * - 所有错误信息只带 HTTP 状态与官方 message，不含请求头。
 */
export class DeepSeekClient implements ChatClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DeepSeekClientOptions) {
    if (!options.apiKey.trim()) throw new DeepSeekError('缺少 DeepSeek API Key');
    this.baseUrl = (options.baseUrl ?? DEEPSEEK_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new DeepSeekError('DeepSeek 请求超时，请重试', 0, 'timeout');
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new DeepSeekError('DeepSeek 请求已取消', 0, 'aborted');
      }
      throw new DeepSeekError(
        `DeepSeek 网络错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 非流式 chat/completions。 */
  async chat(options: ChatOptions): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: DEEPSEEK_MODEL,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      stream: false,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.json) body.response_format = { type: 'json_object' };

    const response = await this.request('/chat/completions', {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const text = await response.text();
    let parsed: ChatCompletionResponse | null = null;
    try {
      parsed = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      /* 非 JSON：走下面的状态判断 */
    }

    if (!response.ok) {
      const message = parsed?.error?.message ?? `DeepSeek 请求失败（HTTP ${response.status}）`;
      throw new DeepSeekError(message, response.status, parsed?.error?.code);
    }

    const content = parsed?.choices?.[0]?.message?.content ?? '';
    if (!content) throw new DeepSeekError('DeepSeek 返回了空内容', response.status);

    return {
      content,
      finishReason: parsed?.choices?.[0]?.finish_reason,
      usage: parsed?.usage
        ? {
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
            totalTokens: parsed.usage.total_tokens,
          }
        : undefined,
    };
  }

  /** JSON mode + 解析，失败时把原始片段带回给重试逻辑。 */
  async jsonChat(
    options: ChatOptions,
  ): Promise<{ data: unknown; raw: string; usage?: ChatResult['usage'] }> {
    const result = await this.chat({ ...options, json: true, temperature: options.temperature ?? 0.7 });
    const raw = stripFences(result.content);
    try {
      return { data: JSON.parse(raw) as unknown, raw, usage: result.usage };
    } catch {
      throw new DeepSeekError(`DeepSeek 返回的 JSON 无法解析：${raw.slice(0, 120)}`, 0, 'bad-json');
    }
  }

  /** 余额预检（设置页"本局将消耗约 65 积分"之外的 DeepSeek 侧检查）。 */
  async getBalance(): Promise<BalanceResult> {
    const response = await this.request('/user/balance', {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new DeepSeekError(`余额查询失败（HTTP ${response.status}）`, response.status);
    }
    const data = (await response.json()) as {
      is_available?: boolean;
      balance_infos?: Array<{
        currency?: string;
        total_balance?: string;
        granted_balance?: string;
        topped_up_balance?: string;
      }>;
    };
    return {
      available: Boolean(data.is_available),
      balances: (data.balance_infos ?? []).map((info) => ({
        currency: info.currency ?? 'CNY',
        total: Number(info.total_balance ?? 0),
        granted: Number(info.granted_balance ?? 0),
        toppedUp: Number(info.topped_up_balance ?? 0),
      })),
    };
  }
}

/** 便捷构造：Key 为空时返回 null，UI 据此提示"先去设置页"。 */
export function createDeepSeekClient(apiKey: string, baseUrl?: string): DeepSeekClient | null {
  if (!apiKey.trim()) return null;
  return new DeepSeekClient(baseUrl ? { apiKey, baseUrl } : { apiKey });
}

export type { ChatClient, ChatOptions, ChatResult };
