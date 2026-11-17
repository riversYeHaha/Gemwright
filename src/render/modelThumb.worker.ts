import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 开始页预置珍宝缩略图的渲染 Worker。
 *
 * 主线程只负责下载 GLB 与合成光晕；这里的 three / GLTFLoader / OffscreenCanvas
 * 负责解析 10MB 级模型并拍成 320×320 的 ImageBitmap，避免首屏卡顿。
 */

const THUMB_SIZE = 320;

interface ThumbRequest {
  id: number;
  buffer: ArrayBuffer;
  index: number;
}

interface ThumbResponse {
  id: number;
  ok: boolean;
  bitmap?: ImageBitmap;
  fatal?: boolean;
  error?: string;
}

/** Worker 里没有 DOM 的 self 类型，收敛到一个最小接口，避免引 WebWorker lib。 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ThumbRequest>) => void) | null;
  postMessage(message: ThumbResponse, transfer?: Transferable[]): void;
};

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let loader: GLTFLoader | null = null;

function setup(): boolean {
  if (renderer && scene && camera && loader) return true;
  try {
    const canvas = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
    renderer = new THREE.WebGLRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
  } catch {
    return false;
  }

  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);

  // 环境贴图让金属 / 粗糙度材质有反射；PMREM 初始化在 Worker 里跑，不卡主线程。
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.9;

  // 主光偏暖、补光偏冷、轮廓光从背后勾边，和开始页的金 / 青配色一致。
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  const key = new THREE.DirectionalLight(0xffe6c0, 3.2);
  key.position.set(4, 6, 5);
  const fill = new THREE.DirectionalLight(0x8be9ff, 1.6);
  fill.position.set(-5, 2, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 2.4);
  rim.position.set(-1, 3, -6);
  scene.add(ambient, key, fill, rim);

  loader = new GLTFLoader();
  return true;
}

// Worker 一创建就开始初始化 three / WebGL / 环境贴图，与主线程下载第一件 GLB 重叠。
setup();

scope.onmessage = (event: MessageEvent<ThumbRequest>): void => {
  void render(event.data);
};

async function render(request: ThumbRequest): Promise<void> {
  if (!setup() || !renderer || !scene || !camera || !loader) {
    scope.postMessage({ id: request.id, ok: false, fatal: true, error: 'WebGL 不可用' });
    return;
  }

  let root: THREE.Object3D | null = null;
  let group: THREE.Group | null = null;
  try {
    const gltf = await loader.parseAsync(request.buffer, '');
    root = gltf.scene;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error('模型没有可渲染的几何体');
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
      throw new Error('模型包围盒无效');
    }

    // 先把包围盒中心移到原点，再用 Group 做 Y 轴转角，避免旋转时偏心。
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    group = new THREE.Group();
    group.add(root);
    group.rotation.y = ((request.index % 5) - 2) * 0.32;
    group.rotation.x = -0.05;
    scene.add(group);

    const halfFov = (camera.fov * Math.PI) / 360;
    const distance = (sphere.radius / Math.sin(halfFov)) * 1.2;
    camera.position.set(0.9, 0.45, 1).normalize().multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(0.001, distance - sphere.radius * 3);
    camera.far = distance + sphere.radius * 6;
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    const bitmap = await createImageBitmap(renderer.domElement as unknown as OffscreenCanvas);
    scope.postMessage({ id: request.id, ok: true, bitmap }, [bitmap]);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (scene && group) scene.remove(group);
    else if (scene && root) scene.remove(root);
    if (root) disposeObject(root);
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as unknown as {
      geometry?: { dispose: () => void };
      material?: unknown;
    };
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || typeof material !== 'object') continue;
      const record = material as unknown as Record<string, unknown>;
      for (const value of Object.values(record)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      const disposable = material as { dispose?: () => void };
      disposable.dispose?.();
    }
  });
}
