import { describe, expect, it } from 'vitest';
import { FAIRY_ACTIONS, buildFairyRig } from '../src/render/fairyRig';

describe('陪伴精灵骨架', () => {
  it('生成完整骨骼层级与六套动作', () => {
    const rig = buildFairyRig();
    expect(Object.keys(rig.bones)).toEqual(
      expect.arrayContaining([
        'Root',
        'Body',
        'Head',
        'Halo',
        'ArmL',
        'ArmR',
        'WingUpperL',
        'WingLowerL',
        'WingUpperR',
        'WingLowerR',
        'Tail',
        'Sparkles',
      ]),
    );
    expect(rig.clips.map((clip) => clip.name)).toEqual([
      'Idle',
      'Talk',
      'Think',
      'Happy',
      'Sad',
      'Alert',
    ]);
    expect(rig.actions).toEqual(FAIRY_ACTIONS);
    expect(rig.clips[0]?.duration).toBe(4);
    expect(rig.root.getObjectByName('FairyWingUpperL')).toBeDefined();
  });

  it('每套动作都有可播放的关键帧轨道', () => {
    const rig = buildFairyRig();
    for (const clip of rig.clips) {
      expect(clip.tracks.length).toBeGreaterThan(2);
      expect(clip.tracks.every((track) => track.times.length > 0)).toBe(true);
    }
  });
});
