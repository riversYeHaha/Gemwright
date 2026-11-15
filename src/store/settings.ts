import type { Lux3DRegion } from '../api/lux3d';

/**
 * 客户端设置：两把 API Key 只存玩家自己浏览器的 localStorage，不经过任何服务器。
 * 这里刻意不提供"导出 / 上报"能力，避免 Key 泄露。
 */

export interface ClientSettings {
  deepseekKey: string;
  lux3dKey: string;
  /** Lux3D 地区（Key 不通用）。 */
  region: Lux3DRegion;
  /** 快速模式：纯本地公式判定砍价，零 LLM 调用。 */
  quickBargain: boolean;
  /** 设置页"我已了解本局约消耗 65 积分"。 */
  acknowledgedCreditCost: boolean;
}

export const SETTINGS_STORAGE_KEY = 'gemwright.settings.v1';

export const DEFAULT_SETTINGS: ClientSettings = {
  deepseekKey: '',
  lux3dKey: '',
  region: 'china',
  quickBargain: false,
  acknowledgedCreditCost: false,
};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): ClientSettings {
  const raw = storage()?.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(raw) as Partial<ClientSettings>;
    return {
      deepseekKey: typeof data.deepseekKey === 'string' ? data.deepseekKey.trim() : '',
      lux3dKey: typeof data.lux3dKey === 'string' ? data.lux3dKey.trim() : '',
      region: data.region === 'global' ? 'global' : 'china',
      quickBargain: Boolean(data.quickBargain),
      acknowledgedCreditCost: Boolean(data.acknowledgedCreditCost),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ClientSettings): void {
  storage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function clearKeys(): void {
  const current = loadSettings();
  saveSettings({ ...current, deepseekKey: '', lux3dKey: '' });
}

/** 脱敏展示：sk-abc...xyz。 */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '未填写';
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}***`;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

export function hasDeepSeekKey(settings: ClientSettings): boolean {
  return settings.deepseekKey.trim().length > 0;
}

export function hasLux3DKey(settings: ClientSettings): boolean {
  return settings.lux3dKey.trim().length > 0;
}
