import type { AnimationClip, Bone, Group } from 'three';

export type FairyAction = 'idle' | 'talk' | 'think' | 'happy' | 'sad' | 'alert';

export const FAIRY_ACTIONS: Readonly<Record<FairyAction, string>>;

export interface FairyRigOptions {
  accent?: string;
}

export interface FairyRig {
  root: Group;
  bones: Record<string, Bone>;
  clips: AnimationClip[];
  actions: Readonly<Record<FairyAction, string>>;
}

export function buildFairyRig(options?: FairyRigOptions): FairyRig;
