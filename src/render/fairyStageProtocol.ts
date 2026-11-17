import type { FairyManifest } from '../store/fairyModel';
import type { FairyAction } from './fairyRig';

/** 主线程 ↔ 精灵渲染 Worker 的消息协议。 */

export interface FairyStageInitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
  reducedMotion: boolean;
  buffer: ArrayBuffer | null;
  manifest: FairyManifest | null;
  accent?: string;
}

export type FairyMainMessage =
  | FairyStageInitMessage
  | { type: 'action'; action: FairyAction }
  | { type: 'pause'; paused: boolean }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'dispose' };

export type FairyWorkerMessage =
  { type: 'ready'; reducedMotion?: boolean } | { type: 'error'; message: string };
