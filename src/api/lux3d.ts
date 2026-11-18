import {
  LUX3D_CREDITS_PER_ITEM,
  LUX3D_FACE_COUNT,
  LUX3D_POLL_INTERVAL_MS,
  LUX3D_TASK_TIMEOUT_MS,
  LUX3D_VERSION,
} from '../config/constants';
import { LevelError } from '../types/level';

/** Lux3D 地区：Key 不通用（国内 labs.aholo3d.cn / 国际 labs.aholo3d.com）。 */
export type Lux3DRegion = 'china' | 'global';

export const LUX3D_BASES: Record<Lux3DRegion, string> = {
  china: 'https://api.aholo.cn',
  global: 'https://api.aholo.ai/global',
};

/**
 * 开发时走 Vite 同源代理：浏览器请求 /lux3d/*，Vite 转发到官方端点。
 * 这样 Lux3D 的 401/400 响应即使不带 CORS 头，浏览器也能读到真实错误；
 * 生产构建没有 Vite，仍回落到官方端点（需要部署平台提供同源代理或 API 支持 CORS）。
 * Vitest 的 MODE 是 test，不能走代理，否则单测 URL 会变成相对路径。
 */
const USE_DEV_PROXY = import.meta.env.DEV && import.meta.env.MODE !== 'test';
// 部署到同源反代（如 ModelScope Docker）时，构建前设置 VITE_LUX3D_PROXY=1。
const USE_BUILD_PROXY = import.meta.env.VITE_LUX3D_PROXY === '1';
const USE_PROXY = USE_DEV_PROXY || USE_BUILD_PROXY;

export const LUX3D_REQUEST_BASES: Record<Lux3DRegion, string> = {
  china: USE_PROXY ? '' : LUX3D_BASES.china,
  global: USE_PROXY ? '/lux3d-global' : LUX3D_BASES.global,
};

export const LUX3D_STATUS_LABELS: Record<number, string> = {
  0: '已受理',
  1: '生成中',
  3: '完成',
  4: '失败',
  6: '已取消',
};

export interface Lux3DTask {
  taskId: string;
  status: number;
  outputs: string[];
  errorMessage?: string;
}

export interface CreateTextTo3DOptions {
  version?: 'G1' | 'G1-Turbo';
  faceCount?: number;
  enablePbr?: boolean;
  style?: string;
  signal?: AbortSignal;
}

export interface Lux3DClientOptions {
  apiKey: string;
  region?: Lux3DRegion;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  baseUrl?: string;
}

interface ApiEnvelope {
  c?: string | number;
  m?: string;
  d?: unknown;
}

export class Lux3DError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'Lux3DError';
    this.code = code;
  }
}

function assertEnvelope(body: ApiEnvelope, context: string): unknown {
  const code = body.c === undefined || body.c === null ? '0' : String(body.c);
  if (code !== '0') {
    throw new Lux3DError(`${context}失败：${body.m || `code ${code}`}`, code);
  }
  return body.d;
}

function readOutputs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && 'content' in entry) {
        const content = (entry as { content?: unknown }).content;
        return typeof content === 'string' ? content : null;
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

export function pickGlbUrl(outputs: string[]): string | null {
  return outputs.find((url) => /\.glb(\?|$)/i.test(url)) ?? null;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Lux3DError('生成已取消', 'aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Lux3DError('生成已取消', 'aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Lux3D（Aholo）浏览器直连适配层。
 *
 * 实测约定：
 * - `Authorization: <API Key>`，**没有 Bearer 前缀**（加了反而 invalid）。
 * - create 返回 `{ c: "0", d: taskId }`；`c === "0"` 只代表查询成功，不代表任务完成。
 * - `task/get` 轮询，`d.status`：0 受理 / 1 运行 / 3 成功 / 4 失败 / 6 取消。
 * - 产物 URL 仅 2 小时有效 → 必须立刻下载为 Blob 存 IndexedDB。
 */
export class Lux3DClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  /** 相对 base 说明请求经过同源代理；ModelScope 网关会改写 Authorization，改用自定义头带 Key。 */
  private readonly proxyMode: boolean;

  constructor(options: Lux3DClientOptions) {
    if (!options.apiKey.trim()) throw new Lux3DError('缺少 Lux3D API Key');
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? LUX3D_REQUEST_BASES[options.region ?? 'china']).replace(
      /\/+$/,
      '',
    );
    // 同 DeepSeek：原生 fetch 不能以实例为 this 调用，必须绑定 globalThis。
    this.fetchImpl = (options.fetchImpl ?? globalThis.fetch).bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? LUX3D_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? LUX3D_TASK_TIMEOUT_MS;
    this.proxyMode = !/^https?:\/\//i.test(this.baseUrl);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: this.apiKey,
      Accept: 'application/json',
      ...(this.proxyMode ? { 'X-Lux3D-Key': this.apiKey } : {}),
      ...extra,
    };
  }

  private async json(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Lux3DError('生成已取消', 'aborted');
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Lux3DError(
        `Lux3D 网络错误：${detail}。常见原因：Key 无效、地区选错或积分不足——` +
          'Lux3D 的错误响应未带 CORS 头，浏览器只能看到 Failed to fetch。',
      );
    }

    const text = await response.text();
    let body: ApiEnvelope;
    try {
      body = JSON.parse(text) as ApiEnvelope;
    } catch {
      throw new Lux3DError(`Lux3D 返回非 JSON 响应（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      throw new Lux3DError(body.m || `Lux3D 请求失败（HTTP ${response.status}）`);
    }
    return assertEnvelope(body, 'Lux3D 请求');
  }

  /** 创建文生 3D 任务，返回 taskId。 */
  async createTextTo3D(prompt: string, options: CreateTextTo3DOptions = {}): Promise<string> {
    const version = options.version ?? LUX3D_VERSION;
    const payload: Record<string, unknown> = {
      prompt,
      version,
      faceCount: options.faceCount ?? LUX3D_FACE_COUNT,
      style: options.style ?? 'photorealistic',
    };
    if (version === 'G1-Turbo') {
      payload.outputFormat = ['glb'];
      payload.enablePbr = options.enablePbr ?? true;
    }

    const data = await this.json('/lux3d/v1/generate/text-to-3d/task/create', {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (typeof data !== 'number' && typeof data !== 'string') {
      throw new Lux3DError('创建文生 3D 任务未返回 taskId');
    }
    return String(data);
  }

  async getTask(taskId: string, signal?: AbortSignal): Promise<Lux3DTask> {
    const data = await this.json(
      `/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`,
      { method: 'GET', headers: this.headers(), ...(signal ? { signal } : {}) },
    );
    if (!data || typeof data !== 'object') {
      throw new Lux3DError('查询任务返回了异常数据');
    }
    const record = data as {
      taskId?: number | string;
      status?: number;
      outputs?: unknown;
      errorMsg?: string;
    };
    if (typeof record.status !== 'number') {
      throw new Lux3DError('任务状态缺失');
    }
    return {
      taskId: String(record.taskId ?? taskId),
      status: record.status,
      outputs: readOutputs(record.outputs),
      ...(typeof record.errorMsg === 'string' ? { errorMessage: record.errorMsg } : {}),
    };
  }

  /** 轮询直到 status 3；4 / 6 立即抛错，超时抛错。 */
  async waitForTask(
    taskId: string,
    onStatus?: (status: number, elapsedMs: number) => void,
    signal?: AbortSignal,
  ): Promise<Lux3DTask> {
    const startedAt = Date.now();
    let lastStatus = -1;
    while (Date.now() - startedAt < this.timeoutMs) {
      const task = await this.getTask(taskId, signal);
      if (task.status !== lastStatus) {
        lastStatus = task.status;
        onStatus?.(task.status, Date.now() - startedAt);
      }
      if (task.status === 3) return task;
      if (task.status === 4) {
        throw new Lux3DError(task.errorMessage || '文生 3D 生成失败', 'task-failed');
      }
      if (task.status === 6) throw new Lux3DError('文生 3D 任务被取消', 'task-cancelled');
      await sleep(this.pollIntervalMs, signal);
    }
    throw new Lux3DError('文生 3D 生成超时（超过 5 分钟）', 'timeout');
  }

  async downloadGlb(url: string, signal?: AbortSignal): Promise<Blob> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, signal ? { signal } : {});
    } catch {
      throw new Lux3DError('下载 GLB 失败（产物 URL 可能已过期，有效期 2 小时）');
    }
    if (!response.ok) {
      throw new Lux3DError(`下载 GLB 失败（HTTP ${response.status}）`);
    }
    return response.blob();
  }

  /** 一站式：create → poll → download，返回可直接进 Three.js 的 Blob。 */
  async generateGlb(
    prompt: string,
    options: CreateTextTo3DOptions = {},
  ): Promise<{ blob: Blob; taskId: string; url: string }> {
    const taskId = await this.createTextTo3D(prompt, options);
    const task = await this.waitForTask(taskId, undefined, options.signal);
    const url = pickGlbUrl(task.outputs);
    if (!url) throw new Lux3DError('生成结果中没有 GLB 文件');
    const blob = await this.downloadGlb(url, options.signal);
    if (blob.size === 0) throw new Lux3DError('下载到的 GLB 为空文件');
    return { blob, taskId, url };
  }
}

/** 每关 5 件 ≈ 65 积分的展示口径。 */
export function estimateCredits(itemCount: number): number {
  return itemCount * LUX3D_CREDITS_PER_ITEM;
}

/** 供 UI 统一包错误：Lux3DError → LevelError 之外的展示文案。 */
export function toLux3DErrorMessage(error: unknown): string {
  if (error instanceof Lux3DError) return error.message;
  if (error instanceof LevelError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
