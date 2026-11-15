/**
 * 两个 AI 适配层共用的最小接口：游戏逻辑只依赖接口，不依赖具体 SDK，
 * 便于单测注入假客户端（也让"砍价双模式 / 精灵防火墙"可以被离线验证）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 要求 DeepSeek 返回 JSON 对象（response_format: json_object）。 */
  json?: boolean;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  content: string;
  finishReason?: string;
  usage?: ChatUsage;
}

export interface ChatClient {
  chat(options: ChatOptions): Promise<ChatResult>;
}
