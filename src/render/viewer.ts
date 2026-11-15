import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Traits } from '../types/level';

/**
 * 单件 3D 检视（方案 §七 render/viewer.js）：
 * - Three.js + OrbitControls，单件按需加载（GLB 约 13MB，一次只进一件）。
 * - 开箱雾：材质 opacity 0 → 目标值的淡入，掩盖首帧跳变。
 * - 没有 GLB（无 Key / 生成失败 / demo）时用程序化占位模型：仍能对照色族 / 计数 / 形制 / 底座。
 */

const COLOR_HEX: Record<string, number> = {
  青蓝: 0x4fd1c5,
  赤金: 0xf6b73c,
  墨黑: 0x30323d,
  霜白: 0xe8eef5,
  紫晶: 0xa78bfa,
  苔绿: 0x7bc47f,
};

function colorHex(color: string): number {
  return COLOR_HEX[color.trim()] ?? 0x9ad0ff;
}

function shapeGeometry(shape: string): THREE.BufferGeometry {
  switch (shape.trim()) {
    case '三棱锥':
      return new THREE.ConeGeometry(1.15, 2.1, 3);
    case '六棱柱':
      return new THREE.CylinderGeometry(1.05, 1.05, 1.9, 6);
    case '莲座':
      return new THREE.CylinderGeometry(1.35, 0.8, 1.1, 12);
    case '螺旋':
      return new THREE.TorusKnotGeometry(0.85, 0.28, 128, 16);
    case '月牙':
      return new THREE.TorusGeometry(1.05, 0.35, 24, 48, Math.PI * 1.35);
    case '八面体':
    default:
      return new THREE.OctahedronGeometry(1.25, 0);
  }
}

interface FadeEntry {
  material: THREE.Material;
  start: number;
  targetOpacity: number;
}

export class TreasureViewer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls | null;
  private readonly loader = new GLTFLoader();
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private current: THREE.Object3D | null = null;
  private fadeEntries: FadeEntry[] = [];
  private disposed = false;
  private readonly clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(container.clientWidth || 480, container.clientHeight || 360);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.domElement.className = 'viewer-canvas';
      container.appendChild(renderer.domElement);
    } catch {
      container.classList.add('viewer--unsupported');
      container.textContent = '当前环境不支持 WebGL，无法检视 3D 珍宝。';
    }
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(
      45,
      (container.clientWidth || 480) / (container.clientHeight || 360),
      0.1,
      100,
    );
    this.camera.position.set(0, 1.8, 6);

    if (!renderer) {
      this.controls = null;
      return;
    }

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 12;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.target.set(0, 0.15, 0);
    renderer.domElement.addEventListener('dblclick', this.handleFocus);
    this.setupLights();
    this.observeResize();
    this.animate();
  }

  private handleFocus = (): void => {
    this.controls?.target.set(0, 0.15, 0);
    this.controls?.update();
  };

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xc7dcff, 0x1b1b24, 1.1);
    const key = new THREE.DirectionalLight(0xfff1d0, 2.4);
    key.position.set(4, 6, 5);
    const rim = new THREE.DirectionalLight(0x6fb1ff, 1.2);
    rim.position.set(-5, -2, -4);
    const fill = new THREE.PointLight(0xffb86b, 12, 12, 2);
    fill.position.set(0, -2.4, 2.4);
    this.scene.add(hemi, key, rim, fill);
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const now = this.clock.getElapsedTime();
    for (const entry of this.fadeEntries) {
      const progress = Math.min(1, (now - entry.start) / 0.6);
      entry.material.opacity = entry.targetOpacity * progress;
      entry.material.transparent = progress < 1 || entry.targetOpacity < 1;
    }
    if (
      this.fadeEntries.length > 0 &&
      this.fadeEntries.every((entry) => now - entry.start >= 0.6)
    ) {
      this.fadeEntries = [];
    }
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
  };

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
  }

  private clearCurrent(): void {
    if (!this.current) return;
    this.scene.remove(this.current);
    this.disposeObject(this.current);
    this.current = null;
    this.fadeEntries = [];
  }

  private prepareMaterials(object: THREE.Object3D): void {
    const startedAt = this.clock.getElapsedTime();
    const entries: FadeEntry[] = [];
    const seen = new Set<THREE.Material>();
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material || seen.has(material)) continue;
        seen.add(material);
        const target = material.opacity;
        material.transparent = true;
        material.opacity = 0;
        material.needsUpdate = true;
        entries.push({ material, start: startedAt, targetOpacity: target });
      }
    });
    this.fadeEntries = entries;
  }

  private frameObject(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
    object.scale.setScalar(3.1 / maxDimension);
    this.camera.position.set(0, 1.8, 6);
    this.controls?.target.set(0, 0.1, 0);
    this.controls?.update();
  }

  private buildPlaceholder(traits: Traits): THREE.Object3D {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      shapeGeometry(traits.shape),
      new THREE.MeshStandardMaterial({
        color: colorHex(traits.color),
        metalness: 0.25,
        roughness: 0.18,
        emissive: colorHex(traits.color),
        emissiveIntensity: 0.18,
      }),
    );
    body.rotation.y = Math.PI / 9;
    group.add(body);

    const gemMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      metalness: 0.55,
      roughness: 0.25,
      emissive: 0xffa000,
      emissiveIntensity: 0.75,
      // 占位模型的首要任务是"数得清"：让星砂穿透本体显示，
      // 否则背面的星砂会被晶体挡住，7 颗看上去只有 6 颗。
      depthTest: false,
      transparent: true,
      opacity: 0.96,
    });
    const count = Math.max(1, Math.min(9, traits.gemCount));
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      // 交替高低 + 略大于本体轮廓：占位模型必须"数得清"，
      // 否则教学关卡里 7 颗 vs 6 颗的判定就不成立。
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), gemMaterial);
      gem.position.set(Math.cos(angle) * 1.72, Math.sin(angle * 2) * 0.7, Math.sin(angle) * 1.72);
      group.add(gem);
    }

    if (traits.hasBase) {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.55, 1.75, 0.22, 48),
        new THREE.MeshStandardMaterial({ color: 0x707888, metalness: 0.85, roughness: 0.35 }),
      );
      base.position.y = -1.55;
      group.add(base);
    }

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshStandardMaterial({
        color: 0x0e1320,
        transparent: true,
        opacity: 0.55,
        roughness: 1,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = traits.hasBase ? -1.66 : -1.7;
    group.add(ground);

    return group;
  }

  /** 显示一件珍宝：有 GLB 用 GLB，没有就用 traits 驱动的占位模型。 */
  async show(blob: Blob | null, traits?: Traits): Promise<void> {
    if (this.disposed) return;
    this.clearCurrent();

    if (blob) {
      try {
        const buffer = await blob.arrayBuffer();
        const gltf = await new Promise<THREE.Group>((resolve, reject) => {
          this.loader.parse(buffer, '', (result) => resolve(result.scene), reject);
        });
        if (this.disposed) return;
        this.current = gltf;
        this.scene.add(gltf);
        this.prepareMaterials(gltf);
        this.frameObject(gltf);
        return;
      } catch (error) {
        console.warn('[viewer] GLB 解析失败，退回占位模型', error);
      }
    }

    if (!traits) return;
    const placeholder = this.buildPlaceholder(traits);
    this.current = placeholder;
    this.scene.add(placeholder);
    this.prepareMaterials(placeholder);
    this.frameObject(placeholder);
  }

  resize(): void {
    if (!this.renderer) return;
    const width = this.container.clientWidth || 480;
    const height = this.container.clientHeight || 360;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.controls?.dispose();
    this.clearCurrent();
    this.renderer?.dispose();
    if (this.renderer) this.renderer.domElement.remove();
  }
}
