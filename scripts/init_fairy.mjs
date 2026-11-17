#!/usr/bin/env node
/* global Buffer, console, process */
/**
 * 生成陪伴精灵的 3D 形象、骨骼与动作动画（GLB，不提交到仓库）。
 *
 * 用法：
 *     npm run fairy           # 生成 public/models/fairy/fairy.glb + manifest.json
 *     npm run fairy:dry       # 只打印骨架 / 动画 / 路径，不写文件
 *     node scripts/init_fairy.mjs --force
 *
 * 为什么不用 Lux3D：
 * - Lux3D 文生 3D 只输出静态网格，没有骨骼与动画；
 * - 陪伴精灵需要 Idle / Talk / Think / Happy / Sad / Alert 六套可切换动作，
 *   所以这里用与运行时完全共享的 `src/render/fairyRig.mjs` 生成真正的骨骼层级
 *   与 AnimationClip，再导出 GLB。
 * - 零 API Key、零积分、可重复执行；网页没有生成时会用同一套骨架实时兜底。
 *
 * 产物：
 *   public/models/fairy/fairy.glb
 *   public/models/fairy/manifest.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GLTFExporter 在 Node 下需要 FileReader 把 ArrayBuffer 读成 GLB；补一个最小实现。
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
    }

    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          this.onloadend?.();
        })
        .catch((error) => this.onerror?.(error));
    }

    readAsDataURL(blob) {
      blob
        .arrayBuffer()
        .then((buffer) => {
          const base64 = Buffer.from(buffer).toString('base64');
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
          this.onloadend?.();
        })
        .catch((error) => this.onerror?.(error));
    }
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildFairyRig } = await import('../src/render/fairyRig.mjs');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const DEFAULT_OUT = path.join(ROOT, 'public', 'models', 'fairy');
const GLB_NAME = 'fairy.glb';
const MANIFEST_NAME = 'manifest.json';

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--out') {
      args.out = path.resolve(argv[i + 1] ?? DEFAULT_OUT);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

function log(message) {
  console.log(message);
}

function writeAtomic(dest, buffer) {
  const temp = `${dest}.part`;
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, dest);
}

async function exportGlb(rig, dest) {
  const exporter = new GLTFExporter();
  const data = await exporter.parseAsync(rig.root, {
    binary: true,
    animations: rig.clips,
    onlyVisible: true,
  });
  if (!(data instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter 没有返回二进制 GLB');
  }
  const buffer = Buffer.from(data);
  if (buffer.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error('导出结果缺少 glTF magic');
  }
  writeAtomic(dest, buffer);
  return buffer.length;
}

function buildManifest(rig) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/init_fairy.mjs',
    credits: 0,
    model: GLB_NAME,
    animations: rig.clips.map((clip) => clip.name),
    actions: rig.actions,
    bones: Object.keys(rig.bones),
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('用法：node scripts/init_fairy.mjs [--out DIR] [--force] [--dry-run]');
    return 0;
  }

  const rig = buildFairyRig();
  const glbPath = path.join(args.out, GLB_NAME);
  const manifestPath = path.join(args.out, MANIFEST_NAME);
  const plan = {
    output: glbPath,
    manifest: manifestPath,
    bones: Object.keys(rig.bones),
    clips: rig.clips.map((clip) => ({ name: clip.name, duration: clip.duration })),
    actions: rig.actions,
    credits: 0,
  };

  if (args.dryRun) {
    log(JSON.stringify(plan, null, 2));
    return 0;
  }

  fs.mkdirSync(args.out, { recursive: true });
  // 本地骨架生成零成本，每次都重新导出，避免改了动画却沿用旧 GLB。
  const size = await exportGlb(rig, glbPath);
  const sizeText =
    size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)}MB` : `${(size / 1024).toFixed(1)}KB`;
  log(`✓ ${glbPath}（${sizeText}）`);

  fs.writeFileSync(manifestPath, `${JSON.stringify(buildManifest(rig), null, 2)}\n`, 'utf8');
  log(`✓ ${manifestPath}`);
  log(`骨骼 ${plan.bones.length} 根：${plan.bones.join(', ')}`);
  log(`动画 ${plan.clips.length} 套：${plan.clips.map((clip) => `${clip.name}(${clip.duration}s)`).join(', ')}`);
  log('零积分。刷新网页后，右下角精灵会自动加载这个 GLB。');
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`生成陪伴精灵失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
}
