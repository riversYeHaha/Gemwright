import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FAIRY_ACTIONS, buildFairyRig, type FairyAction } from './fairyRig';
import type {
  FairyMainMessage,
  FairyStageInitMessage,
  FairyWorkerMessage,
} from './fairyStageProtocol';
import type { FairyManifest } from '../store/fairyModel';

/**
 * 陪伴精灵的 3D 渲染 Worker。
 *
 * canvas 的 OffscreenCanvas 控制权由主线程转交进来；three、WebGL 上下文创建、
 * GLTFLoader 解析与每帧渲染都在这里，主线程只收 ready / error。
 */

const TARGET_HEIGHT = 1.55;

interface Scope {
  onmessage: ((event: MessageEvent<FairyMainMessage>) => void) | null;
  postMessage(message: FairyWorkerMessage): void;
  close(): void;
}

const scope = self as unknown as Scope;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let mixer: THREE.AnimationMixer | null = null;
let actions = new Map<string, THREE.AnimationAction>();
let actionMap: Record<FairyAction, string> = { ...FAIRY_ACTIONS };
let current: THREE.AnimationAction | null = null;
let currentAction: FairyAction | null = null;
let pendingAction: FairyAction = 'idle';
let reducedMotion = false;
let paused = false;
let ready = false;
let disposed = false;
let timer = 0;
let lastTime = 0;

scope.onmessage = (event) => {
  void handle(event.data);
};

async function handle(message: FairyMainMessage): Promise<void> {
  if (message.type === 'init') {
    await init(message);
    return;
  }
  if (message.type === 'action') {
    play(message.action);
    return;
  }
  if (message.type === 'pause') {
    paused = message.paused;
    if (paused) stop();
    else start();
    return;
  }
  if (message.type === 'resize') {
    if (!renderer || !camera || !scene) return;
    renderer.setPixelRatio(message.dpr);
    renderer.setSize(message.width, message.height, false);
    camera.aspect = message.width / message.height;
    camera.updateProjectionMatrix();
    render();
    return;
  }
  if (message.type === 'dispose') {
    dispose();
  }
}

async function init(message: FairyStageInitMessage): Promise<void> {
  if (disposed || renderer) return;
  reducedMotion = message.reducedMotion;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas: message.canvas as unknown as HTMLCanvasElement,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch (error) {
    fail(error);
    return;
  }
  renderer.setPixelRatio(message.dpr);
  renderer.setSize(message.width, message.height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, message.width / message.height, 0.01, 50);
  camera.position.set(0, 0.06, 3.4);
  camera.lookAt(0, 0.02, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffe6c0, 2.6);
  key.position.set(2.2, 3.2, 4);
  const fill = new THREE.DirectionalLight(0x7dd3fc, 1.6);
  fill.position.set(-3, 1.2, 2.4);
  const rim = new THREE.DirectionalLight(0xffffff, 1.8);
  rim.position.set(-1, 2.4, -3);
  const warm = new THREE.PointLight(0xf6b73c, 1.0, 9);
  warm.position.set(0, -1.2, 2);
  scene.add(key, fill, rim, warm);

  const floorRing = new THREE.Mesh(
    new THREE.RingGeometry(0.74, 0.76, 64),
    new THREE.MeshBasicMaterial({
      color: 0xf6b73c,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = -0.92;
  scene.add(floorRing);

  try {
    if (message.buffer && message.manifest) {
      const gltf = await new GLTFLoader().parseAsync(message.buffer, '');
      if (gltf.animations.length > 0 && mountModel(gltf.scene, gltf.animations, message.manifest)) {
        finish();
        return;
      }
    }
  } catch {
    // GLB 坏了不致命，继续用共享骨架兜底。
  }

  try {
    const rig = buildFairyRig({ accent: message.accent });
    if (!mountModel(rig.root, rig.clips, null)) {
      throw new Error('精灵骨架没有可渲染的几何体');
    }
    finish();
  } catch (error) {
    fail(error);
  }
}

function mountModel(
  model: THREE.Object3D,
  clips: THREE.AnimationClip[],
  manifest: FairyManifest | null,
): boolean {
  if (!renderer || !scene) return false;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = TARGET_HEIGHT / Math.max(size.y, 0.0001);

  model.position.sub(center);
  const wrapper = new THREE.Group();
  wrapper.scale.setScalar(scale);
  wrapper.position.y = 0.08;
  wrapper.add(model);
  scene.add(wrapper);

  mixer = new THREE.AnimationMixer(model);
  actions = new Map();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.enabled = false;
    actions.set(clip.name, action);
  }
  if (manifest?.actions) {
    actionMap = { ...FAIRY_ACTIONS, ...(manifest.actions as Partial<Record<FairyAction, string>>) };
  }
  mixer.addEventListener('finished', (event) => {
    if (
      current &&
      event.action === current &&
      (currentAction === 'happy' || currentAction === 'alert')
    ) {
      play('idle');
    }
  });

  return true;
}

function finish(): void {
  ready = true;
  play(pendingAction);
  if (!reducedMotion) start();
  else {
    mixer?.update(0);
    render();
  }
  scope.postMessage({ type: 'ready', reducedMotion });
}

function play(action: FairyAction): void {
  pendingAction = action;
  if (!ready || !mixer) return;
  const name = actionMap[action] ?? FAIRY_ACTIONS[action];
  const next = actions.get(name);
  if (!next) return;
  if (next === current) {
    currentAction = action;
    return;
  }
  next.reset();
  next.enabled = true;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);
  const once = action === 'happy' || action === 'alert';
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  next.clampWhenFinished = once;
  if (current) next.crossFadeFrom(current, 0.28, false);
  next.play();
  current = next;
  currentAction = action;
  if (reducedMotion) {
    mixer.update(0);
    render();
  }
}

function start(): void {
  if (timer || reducedMotion || paused || disposed || !mixer) return;
  lastTime = performance.now();
  timer = setInterval(() => {
    if (paused || disposed || !mixer) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    mixer.update(dt);
    render();
  }, 1000 / 30) as unknown as number;
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = 0;
}

function render(): void {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function fail(error: unknown): void {
  if (disposed) return;
  disposed = true;
  stop();
  scope.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  dispose();
  scope.close();
}

function dispose(): void {
  if (disposed && !renderer) return;
  disposed = true;
  stop();
  mixer?.stopAllAction();
  mixer = null;
  if (scene) {
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture && !textures.has(value)) {
            textures.add(value);
            value.dispose();
          }
        }
        material.dispose();
      }
    });
    scene.clear();
  }
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
  scene = null;
  camera = null;
  actions.clear();
  current = null;
}
