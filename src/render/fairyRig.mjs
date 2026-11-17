/**
 * 陪伴精灵的共享骨架 / 动画定义。
 *
 * 主路径由 `scripts/init_fairy.py` 调用 Lux3D 生成带 skin 的 humanoid GLB；
 * 这个文件是**没有 Key / 生成失败时**的运行时兜底：
 * `src/render/fairyStage.worker.ts` 会实时构建同一套程序化骨架与六套动画。
 *
 * 兜底骨架的动作 key 与 Lux3D 产物保持一致（idle/talk/think/happy/sad/alert）。
 */

import * as THREE from 'three';

export const FAIRY_ACTIONS = Object.freeze({
  idle: 'Idle',
  talk: 'Talk',
  think: 'Think',
  happy: 'Happy',
  sad: 'Sad',
  alert: 'Alert',
});

const TAU = Math.PI * 2;

export function buildFairyRig(options = {}) {
  const accent = new THREE.Color(options.accent ?? '#3ddbc6');
  const gold = new THREE.Color('#f6b73c');

  const bodyMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent.clone().multiplyScalar(0.32),
    emissiveIntensity: 1,
    roughness: 0.38,
    metalness: 0.18,
  });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xa7fff2 });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd8fff8,
    emissive: 0x1e5a52,
    emissiveIntensity: 0.25,
    roughness: 0.45,
    metalness: 0.05,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: gold,
    emissive: gold.clone().multiplyScalar(0.35),
    emissiveIntensity: 1,
    roughness: 0.28,
    metalness: 0.65,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x7ff7e4,
    emissive: 0x0f766e,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.62,
    roughness: 0.25,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a1520 });

  const root = new THREE.Group();
  root.name = 'FairyRoot';

  const bones = {};
  const addBone = (name, parent, x = 0, y = 0, z = 0) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    parent.add(bone);
    bones[name] = bone;
    return bone;
  };
  const attach = (bone, mesh) => {
    mesh.name = mesh.name || `${bone.name}Mesh`;
    bone.add(mesh);
    return mesh;
  };

  const rootBone = addBone('Root', root);
  const bodyBone = addBone('Body', rootBone);

  // 身体：水滴形的灵体 + 内芯
  const body = attach(
    bodyBone,
    new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), bodyMat),
  );
  body.name = 'FairyBody';
  body.scale.set(1, 1.2, 0.92);

  const core = attach(bodyBone, new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), coreMat));
  core.name = 'FairyCore';
  core.position.set(0, 0.02, 0.19);

  const skirt = attach(
    bodyBone,
    new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.34, 18, 1, true), bodyMat),
  );
  skirt.name = 'FairySkirt';
  skirt.position.set(0, -0.34, 0);

  // 头 + 眼睛 + 金色星冠
  const headBone = addBone('Head', bodyBone, 0, 0.66, 0);
  const head = attach(headBone, new THREE.Mesh(new THREE.SphereGeometry(0.255, 24, 18), skinMat));
  head.name = 'FairyHead';

  const eyeL = attach(
    headBone,
    new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), eyeMat),
  );
  eyeL.name = 'FairyEyeL';
  eyeL.position.set(-0.085, 0.035, 0.225);
  const eyeR = attach(
    headBone,
    new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), eyeMat),
  );
  eyeR.name = 'FairyEyeR';
  eyeR.position.set(0.085, 0.035, 0.225);

  const smile = attach(
    headBone,
    new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0x2c6f68 })),
  );
  smile.name = 'FairySmile';
  smile.position.set(0, -0.045, 0.242);
  smile.rotation.z = Math.PI;

  const crown = attach(
    headBone,
    new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 20), goldMat),
  );
  crown.name = 'FairyCrown';
  crown.position.set(0, 0.25, 0);
  crown.rotation.x = Math.PI / 2;

  const spark = attach(
    headBone,
    new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), goldMat),
  );
  spark.name = 'FairyHeadSpark';
  spark.position.set(0, 0.34, 0);

  // 光环
  const haloBone = addBone('Halo', headBone, 0, 0.42, 0);
  const halo = attach(
    haloBone,
    new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.011, 6, 36), goldMat),
  );
  halo.name = 'FairyHalo';
  halo.rotation.x = Math.PI / 2;

  // 手臂
  const armL = addBone('ArmL', bodyBone, -0.3, 0.08, 0);
  const armR = addBone('ArmR', bodyBone, 0.3, 0.08, 0);
  for (const [bone, side] of [
    [armL, -1],
    [armR, 1],
  ]) {
    const arm = attach(bone, new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.17, 4, 8), skinMat));
    arm.name = `${bone.name}Mesh`;
    arm.position.set(0, -0.1, 0);
    arm.rotation.z = side * 0.12;
    const hand = attach(bone, new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skinMat));
    hand.name = `${bone.name}Hand`;
    hand.position.set(0, -0.22, 0);
  }

  // 翅膀：上下两对，平面形状 + 半透明发光材质
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.28, 0.24, 0.64, 0.24, 0.74, 0.02);
  wingShape.bezierCurveTo(0.58, -0.18, 0.26, -0.26, 0, 0);
  const upperGeo = new THREE.ShapeGeometry(wingShape, 20);
  const lowerGeo = new THREE.ShapeGeometry(wingShape, 20);

  const wingBones = {};
  for (const side of ['L', 'R']) {
    const dir = side === 'L' ? -1 : 1;
    const upper = addBone(`WingUpper${side}`, bodyBone, dir * 0.16, 0.24, -0.04);
    upper.rotation.z = dir * 0.35;
    const upperMesh = new THREE.Mesh(upperGeo, wingMat);
    upperMesh.name = `FairyWingUpper${side}`;
    upperMesh.scale.set(dir * 0.9, 0.9, 1);
    attach(upper, upperMesh);

    const lower = addBone(`WingLower${side}`, bodyBone, dir * 0.12, 0.05, -0.02);
    lower.rotation.z = dir * 0.08;
    const lowerMesh = new THREE.Mesh(lowerGeo, wingMat);
    lowerMesh.name = `FairyWingLower${side}`;
    lowerMesh.scale.set(dir * 0.62, 0.58, 1);
    attach(lower, lowerMesh);

    wingBones[side] = { upper, lower };
  }

  // 尾巴 / 星尘
  const tailBone = addBone('Tail', bodyBone, 0, -0.5, 0);
  const tail = attach(
    tailBone,
    new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 10, 1, true), bodyMat),
  );
  tail.name = 'FairyTail';
  tail.rotation.x = Math.PI;
  tail.position.set(0, 0.12, 0);

  const sparklesBone = addBone('Sparkles', bodyBone, 0, 0, 0);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU;
    const mote = attach(
      sparklesBone,
      new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), goldMat),
    );
    mote.name = `FairySpark${i}`;
    mote.position.set(Math.cos(angle) * 0.46, 0.1 + Math.sin(angle * 2) * 0.18, Math.sin(angle) * 0.4);
  }

  const actions = FAIRY_ACTIONS;
  const clips = [
    buildIdleClip(),
    buildTalkClip(),
    buildThinkClip(),
    buildHappyClip(),
    buildSadClip(),
    buildAlertClip(),
  ];

  return { root, bones, clips, actions };
}

/* ------------------------------------------------------------------ */
/* 动画                                                               */
/* ------------------------------------------------------------------ */

const q = (x = 0, y = 0, z = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));

const qTrack = (name, property, times, values) =>
  new THREE.QuaternionKeyframeTrack(`${name}.${property}`, times, values.flatMap((v) => v.toArray()));

const vTrack = (name, property, times, values) =>
  new THREE.VectorKeyframeTrack(`${name}.${property}`, times, values.flatMap((v) => v.toArray()));

const position = (x, y, z) => new THREE.Vector3(x, y, z);

function buildIdleClip() {
  return new THREE.AnimationClip('Idle', 4, [
    vTrack('Root', 'position', [0, 1, 2, 3, 4], [
      position(0, 0, 0),
      position(0, 0.055, 0),
      position(0, 0, 0),
      position(0, 0.035, 0),
      position(0, 0, 0),
    ]),
    qTrack('Body', 'quaternion', [0, 2, 4], [q(), q(0, 0, 0.05), q()]),
    qTrack('Head', 'quaternion', [0, 2, 4], [q(0.02, 0, 0), q(-0.03, 0.08, 0.04), q(0.02, 0, 0)]),
    qTrack('Halo', 'quaternion', [0, 4], [q(), q(0, TAU, 0)]),
    qTrack('Sparkles', 'quaternion', [0, 4], [q(), q(0, -TAU, 0)]),
    qTrack('WingUpperL', 'quaternion', [0, 1, 2, 3, 4], [
      q(0, 0, 0.35),
      q(0, 0.15, 0.72),
      q(0, 0, 0.35),
      q(0, -0.1, 0.5),
      q(0, 0, 0.35),
    ]),
    qTrack('WingUpperR', 'quaternion', [0, 1, 2, 3, 4], [
      q(0, 0, -0.35),
      q(0, -0.15, -0.72),
      q(0, 0, -0.35),
      q(0, 0.1, -0.5),
      q(0, 0, -0.35),
    ]),
    qTrack('WingLowerL', 'quaternion', [0, 1.2, 2.4, 3.6, 4], [
      q(0, 0, 0.05),
      q(0, -0.1, 0.28),
      q(0, 0, 0.05),
      q(0, 0.1, 0.2),
      q(0, 0, 0.05),
    ]),
    qTrack('WingLowerR', 'quaternion', [0, 1.2, 2.4, 3.6, 4], [
      q(0, 0, -0.05),
      q(0, 0.1, -0.28),
      q(0, 0, -0.05),
      q(0, -0.1, -0.2),
      q(0, 0, -0.05),
    ]),
    qTrack('ArmL', 'quaternion', [0, 2, 4], [q(0, 0, 0.12), q(0, 0, 0.24), q(0, 0, 0.12)]),
    qTrack('ArmR', 'quaternion', [0, 2, 4], [q(0, 0, -0.12), q(0, 0, -0.24), q(0, 0, -0.12)]),
  ]);
}

function buildTalkClip() {
  return new THREE.AnimationClip('Talk', 2.4, [
    vTrack('Root', 'position', [0, 0.6, 1.2, 1.8, 2.4], [
      position(0, 0, 0),
      position(0, 0.04, 0),
      position(0, 0, 0),
      position(0, 0.03, 0),
      position(0, 0, 0),
    ]),
    qTrack('Head', 'quaternion', [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4], [
      q(0, 0, 0),
      q(0.12, 0.05, 0.06),
      q(-0.04, 0, 0),
      q(0.1, -0.05, -0.05),
      q(-0.03, 0, 0),
      q(0.08, 0, 0.03),
      q(0, 0, 0),
    ]),
    qTrack('ArmL', 'quaternion', [0, 0.6, 1.2, 1.8, 2.4], [
      q(0, 0, 0.12),
      q(-0.3, 0, 0.55),
      q(0, 0, 0.18),
      q(-0.2, 0, 0.42),
      q(0, 0, 0.12),
    ]),
    qTrack('ArmR', 'quaternion', [0, 0.6, 1.2, 1.8, 2.4], [
      q(0, 0, -0.12),
      q(-0.3, 0, -0.55),
      q(0, 0, -0.18),
      q(-0.2, 0, -0.42),
      q(0, 0, -0.12),
    ]),
    qTrack('WingUpperL', 'quaternion', [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4], [
      q(0, 0, 0.35),
      q(0, 0.2, 0.8),
      q(0, 0, 0.35),
      q(0, 0.2, 0.8),
      q(0, 0, 0.35),
      q(0, 0.2, 0.8),
      q(0, 0, 0.35),
      q(0, 0.2, 0.8),
      q(0, 0, 0.35),
    ]),
    qTrack('WingUpperR', 'quaternion', [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4], [
      q(0, 0, -0.35),
      q(0, -0.2, -0.8),
      q(0, 0, -0.35),
      q(0, -0.2, -0.8),
      q(0, 0, -0.35),
      q(0, -0.2, -0.8),
      q(0, 0, -0.35),
      q(0, -0.2, -0.8),
      q(0, 0, -0.35),
    ]),
    qTrack('Halo', 'quaternion', [0, 2.4], [q(), q(0, TAU, 0)]),
  ]);
}

function buildThinkClip() {
  return new THREE.AnimationClip('Think', 3, [
    vTrack('Root', 'position', [0, 1.5, 3], [position(0, 0, 0), position(0, 0.04, 0), position(0, 0, 0)]),
    qTrack('Head', 'quaternion', [0, 0.8, 1.6, 2.4, 3], [
      q(0, 0, 0),
      q(0.04, 0.12, -0.2),
      q(0, 0.18, -0.24),
      q(0.04, 0.1, -0.18),
      q(0, 0, 0),
    ]),
    qTrack('Body', 'quaternion', [0, 1.5, 3], [q(), q(0, 0.08, 0.05), q()]),
    qTrack('ArmL', 'quaternion', [0, 1.5, 3], [q(0, 0, 0.12), q(-0.2, 0, 0.34), q(0, 0, 0.12)]),
    qTrack('ArmR', 'quaternion', [0, 1.5, 3], [q(0, 0, -0.12), q(-0.1, 0, -0.2), q(0, 0, -0.12)]),
    qTrack('WingUpperL', 'quaternion', [0, 1.5, 3], [q(0, 0, 0.35), q(0, 0.1, 0.52), q(0, 0, 0.35)]),
    qTrack('WingUpperR', 'quaternion', [0, 1.5, 3], [q(0, 0, -0.35), q(0, -0.1, -0.52), q(0, 0, -0.35)]),
    qTrack('Halo', 'quaternion', [0, 3], [q(), q(0.2, TAU, 0)]),
  ]);
}

function buildHappyClip() {
  return new THREE.AnimationClip('Happy', 1.6, [
    vTrack('Root', 'position', [0, 0.3, 0.6, 0.9, 1.2, 1.6], [
      position(0, 0, 0),
      position(0, 0.18, 0),
      position(0, 0, 0),
      position(0, 0.16, 0),
      position(0, 0, 0),
      position(0, 0.02, 0),
    ]),
    qTrack('Body', 'quaternion', [0, 0.8, 1.6], [q(), q(0, TAU, 0), q(0, TAU, 0)]),
    qTrack('WingUpperL', 'quaternion', [0, 0.2, 0.4, 0.8, 1.2, 1.6], [
      q(0, 0, 0.35),
      q(0, 0.25, 1.1),
      q(0, 0, 0.35),
      q(0, 0.25, 1.1),
      q(0, 0, 0.35),
      q(0, 0.2, 1.0),
    ]),
    qTrack('WingUpperR', 'quaternion', [0, 0.2, 0.4, 0.8, 1.2, 1.6], [
      q(0, 0, -0.35),
      q(0, -0.25, -1.1),
      q(0, 0, -0.35),
      q(0, -0.25, -1.1),
      q(0, 0, -0.35),
      q(0, -0.2, -1.0),
    ]),
    qTrack('Head', 'quaternion', [0, 0.4, 0.8, 1.2, 1.6], [
      q(0, 0, 0),
      q(-0.18, 0, 0),
      q(0, 0, 0),
      q(-0.18, 0, 0),
      q(0, 0, 0),
    ]),
    qTrack('Halo', 'quaternion', [0, 1.6], [q(), q(0, TAU * 1.5, 0)]),
  ]);
}

function buildSadClip() {
  return new THREE.AnimationClip('Sad', 3.2, [
    vTrack('Root', 'position', [0, 1.6, 3.2], [position(0, 0, 0), position(0, -0.07, 0), position(0, 0, 0)]),
    qTrack('Head', 'quaternion', [0, 1.6, 3.2], [q(), q(0.24, -0.08, 0.06), q()]),
    qTrack('Body', 'quaternion', [0, 1.6, 3.2], [q(), q(0.05, 0, -0.04), q()]),
    qTrack('WingUpperL', 'quaternion', [0, 1.6, 3.2], [q(0, 0, 0.35), q(0, -0.05, 0.05), q(0, 0, 0.35)]),
    qTrack('WingUpperR', 'quaternion', [0, 1.6, 3.2], [q(0, 0, -0.35), q(0, 0.05, -0.05), q(0, 0, -0.35)]),
    qTrack('ArmL', 'quaternion', [0, 1.6, 3.2], [q(0, 0, 0.12), q(0.2, 0, 0.05), q(0, 0, 0.12)]),
    qTrack('ArmR', 'quaternion', [0, 1.6, 3.2], [q(0, 0, -0.12), q(0.2, 0, -0.05), q(0, 0, -0.12)]),
    qTrack('Halo', 'quaternion', [0, 3.2], [q(), q(0, TAU, 0)]),
  ]);
}

function buildAlertClip() {
  return new THREE.AnimationClip('Alert', 1.2, [
    vTrack('Root', 'position', [0, 0.3, 0.6, 0.9, 1.2], [
      position(0, 0.02, 0),
      position(0, 0.12, 0),
      position(0, 0.04, 0),
      position(0, 0.1, 0),
      position(0, 0.02, 0),
    ]),
    qTrack('Head', 'quaternion', [0, 0.3, 0.6, 0.9, 1.2], [
      q(0, 0, 0),
      q(-0.16, 0, 0),
      q(-0.05, 0, 0),
      q(-0.16, 0, 0),
      q(0, 0, 0),
    ]),
    qTrack('WingUpperL', 'quaternion', [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2], [
      q(0, 0, 0.35),
      q(0, 0.25, 1.0),
      q(0, 0, 0.35),
      q(0, 0.25, 1.0),
      q(0, 0, 0.35),
      q(0, 0.25, 1.0),
      q(0, 0, 0.35),
      q(0, 0.25, 1.0),
      q(0, 0, 0.35),
    ]),
    qTrack('WingUpperR', 'quaternion', [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2], [
      q(0, 0, -0.35),
      q(0, -0.25, -1.0),
      q(0, 0, -0.35),
      q(0, -0.25, -1.0),
      q(0, 0, -0.35),
      q(0, -0.25, -1.0),
      q(0, 0, -0.35),
      q(0, -0.25, -1.0),
      q(0, 0, -0.35),
    ]),
    qTrack('Halo', 'quaternion', [0, 1.2], [q(), q(0, TAU, 0)]),
  ]);
}
