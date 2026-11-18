#!/usr/bin/env python3
"""生成教学 / 演示关卡所需的预置 3D 模型（不提交到仓库）。

用法（只需要 Python 3.9+，无第三方依赖）：
    export LUX3D_API_KEY=...            # 或写进 .env.local
    python3 scripts/init_models.py      # 默认国内端点
    python3 scripts/init_models.py --region global
    python3 scripts/init_models.py --dry-run   # 只打印将要生成的 prompt / 路径，不调用

脚本内置与前端一致的 renderPrompt 模板和 traits；生成结果写入 public/models/：
    public/models/tutorial/T1.glb ...
    public/models/manifest.json
网页会在教学 / 演示关卡的"验货"页自动读取 manifest.json 并加载这些 GLB；
没有生成时自动退回程序化占位模型，不影响玩法。

成本：G1-Turbo 13 积分/件；教学 2 件 + 演示 5 件 = 7 件 ≈ 91 积分。
已存在的文件默认跳过（可重复执行，不会重复烧积分）；--force 强制重生成。

Key 只会作为 Authorization 请求头发送，不写入任何文件、不打印。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "public" / "models"
VERSION = "G1-Turbo"
FACE_COUNT = 100_000
CREDITS_PER_ITEM = 13
POLL_INTERVAL = 3
TASK_TIMEOUT = 300

REGIONS = {
    "china": "https://api.aholo.cn",
    "global": "https://api.aholo.ai/global",
}

KEY_ENV_NAMES = ("LUX3D_API_KEY", "AHOLO_API_KEY")

PRINT_LOCK = threading.Lock()


@dataclass(frozen=True)
class PresetItem:
    level_id: str
    level_dir: str
    level_name: str
    item_id: str
    item_name: str
    shape: str
    color: str
    gem_count: int
    has_base: bool


# traits 与 src/game/tutorial/level.ts、src/game/fixtures/demoLevel.ts 一一对应。
TUTORIAL_ITEMS = [
    PresetItem("tutorial-level", "tutorial", "教学关卡", "T1", "星穹之核", "八面体", "青蓝", 7, True),
    PresetItem("tutorial-level", "tutorial", "教学关卡", "T2", "碎星残核", "八面体", "青蓝", 6, True),
]

DEMO_ITEMS = [
    PresetItem("demo-level", "demo", "演示关卡", "T1", "星穹之核", "八面体", "青蓝", 7, True),
    PresetItem("demo-level", "demo", "演示关卡", "T2", "碎星坠饰", "八面体", "青蓝", 6, True),
    PresetItem("demo-level", "demo", "演示关卡", "T3", "潮汐之瞳", "六棱柱", "赤金", 5, True),
    PresetItem("demo-level", "demo", "演示关卡", "T4", "沉锚之泪", "六棱柱", "赤金", 5, False),
    PresetItem("demo-level", "demo", "演示关卡", "T5", "灰烬棱晶", "八面体", "青蓝", 8, True),
]

ALL_ITEMS = TUTORIAL_ITEMS + DEMO_ITEMS


def load_dotenv(path: Path) -> None:
    """极简 .env 读取：只补环境里没有的变量。"""
    if not path.exists():
        return
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        pass


def resolve_key(explicit: str | None) -> str:
    if explicit:
        return explicit.strip()
    for name in KEY_ENV_NAMES:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def render_prompt(item: PresetItem) -> str:
    # 必须与 src/config/prompts.ts 的 renderPromptForTraits 保持一致。
    base = (
        "mounted on a dark silver metallic base"
        if item.has_base
        else "free-floating"
    )
    return (
        f"A fantasy treasure: {item.shape} in {item.color} "
        f"with {item.gem_count} small golden star gems embedded around its equator, "
        f"{base}, faintly glowing, game asset style, clean studio lighting"
    )


def output_path(item: PresetItem, out_dir: Path) -> Path:
    return out_dir / item.level_dir / f"{item.item_id}.glb"


def request_json(
    method: str,
    url: str,
    key: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 90,
) -> dict[str, Any]:
    headers = {"Authorization": key, "Accept": "application/json"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {error.code} {url}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"网络错误 {url}: {error.reason}") from error
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"非 JSON 响应 {url}: {body[:200]}") from error


def ensure_ok(body: dict[str, Any], context: str) -> None:
    code = str(body.get("c", "0"))
    if code != "0":
        raise RuntimeError(f"{context}失败：c={code} m={body.get('m')}")


def create_task(base: str, key: str, prompt: str) -> str:
    payload = {
        "prompt": prompt,
        "version": VERSION,
        "faceCount": FACE_COUNT,
        "outputFormat": ["glb"],
        "enablePbr": True,
        "style": "photorealistic",
    }
    body = request_json(
        "POST",
        f"{base}/lux3d/v1/generate/text-to-3d/task/create",
        key,
        payload,
    )
    ensure_ok(body, "创建文生 3D 任务")
    task_id = body.get("d")
    if task_id is None:
        raise RuntimeError(f"创建任务未返回 taskId：{body}")
    return str(task_id)


def query_task(base: str, key: str, task_id: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"taskid": task_id})
    body = request_json("GET", f"{base}/lux3d/v1/generate/task/get?{query}", key)
    ensure_ok(body, "查询任务")
    data = body.get("d")
    if not isinstance(data, dict):
        raise RuntimeError(f"查询任务返回异常：{body}")
    return data


def wait_for_task(base: str, key: str, task_id: str) -> dict[str, Any]:
    started = time.time()
    last_status = None
    while time.time() - started < TASK_TIMEOUT:
        data = query_task(base, key, task_id)
        status = int(data.get("status", -1))
        if status != last_status:
            last_status = status
            log(f"  任务 {task_id} status={status}（0 受理 / 1 运行 / 3 成功 / 4 失败 / 6 取消）")
        if status == 3:
            return data
        if status in (4, 6):
            detail = data.get("errorMsg") or "生成失败或被取消"
            raise RuntimeError(f"任务 {task_id} 结束：{detail}")
        time.sleep(POLL_INTERVAL)
    raise RuntimeError(f"任务 {task_id} 超时（{TASK_TIMEOUT}s）")


def pick_glb_url(outputs: Any) -> str:
    if not isinstance(outputs, list):
        return ""
    for entry in outputs:
        content = entry.get("content") if isinstance(entry, dict) else entry
        if isinstance(content, str) and ".glb" in content.split("?")[0].lower():
            return content
    return ""


def download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=300) as response, temp.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            handle.write(chunk)
    size = temp.stat().st_size
    if size == 0:
        temp.unlink(missing_ok=True)
        raise RuntimeError("下载到的 GLB 为空文件")
    with temp.open("rb") as handle:
        magic = handle.read(4)
    if magic != b"glTF":
        temp.unlink(missing_ok=True)
        raise RuntimeError("下载内容不是有效的 GLB（缺少 glTF magic）")
    temp.replace(dest)
    return size


def log(message: str) -> None:
    with PRINT_LOCK:
        print(message, flush=True)


def generate_one(item: PresetItem, args: argparse.Namespace, base: str, key: str) -> tuple[PresetItem, str]:
    dest = output_path(item, Path(args.out))
    prompt = render_prompt(item)
    log(f"→ {item.level_name} {item.item_id}《{item.item_name}》：提交生成（{Path(dest).name}）")
    task_id = create_task(base, key, prompt)
    data = wait_for_task(base, key, task_id)
    glb_url = pick_glb_url(data.get("outputs"))
    if not glb_url:
        raise RuntimeError(f"任务 {task_id} 没有 GLB 产物")
    size = download(glb_url, dest)
    size_text = f"{size / 1024 / 1024:.1f}MB" if size >= 1024 * 1024 else f"{size / 1024:.0f}KB"
    return item, size_text


def build_manifest(items: list[PresetItem], out_dir: Path, region: str) -> dict[str, Any]:
    levels: dict[str, dict[str, str]] = {}
    for item in items:
        dest = output_path(item, out_dir)
        if not dest.exists():
            continue
        levels.setdefault(item.level_id, {})[item.item_id] = f"{item.level_dir}/{item.item_id}.glb"
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "region": region,
        "creditsPerItem": CREDITS_PER_ITEM,
        "levels": levels,
        "items": {
            f"{item.level_id}/{item.item_id}": {
                "name": item.item_name,
                "traits": {
                    "shape": item.shape,
                    "color": item.color,
                    "gemCount": item.gem_count,
                    "hasBase": item.has_base,
                },
            }
            for item in items
            if output_path(item, out_dir).exists()
        },
    }


def write_manifest(items: list[PresetItem], out_dir: Path, region: str) -> Path:
    manifest = build_manifest(items, out_dir, region)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成教学 / 演示关卡的预置 3D 模型（Lux3D G1-Turbo）")
    parser.add_argument("--key", help="Lux3D API Key（也可用 LUX3D_API_KEY / .env.local）")
    parser.add_argument("--region", choices=sorted(REGIONS), default="china", help="API 地区（默认 china）")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="模型输出目录（默认 public/models）")
    parser.add_argument("--only", choices=["all", "tutorial", "demo"], default="all", help="只生成某部分")
    parser.add_argument("--force", action="store_true", help="已存在的文件也重新生成")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不调用 API、不写文件")
    parser.add_argument("--yes", action="store_true", help="跳过积分确认")
    parser.add_argument("--concurrency", type=int, default=5, help="并发任务数（免费档上限 5）")
    parser.add_argument("--base-url", default="", help="自定义 API 端点（调试 / 代理用，默认按 --region 选择）")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    load_dotenv(ROOT / ".env.local")
    load_dotenv(ROOT / ".env")
    args = parse_args(argv)

    if args.only == "tutorial":
        items = list(TUTORIAL_ITEMS)
    elif args.only == "demo":
        items = list(DEMO_ITEMS)
    else:
        items = list(ALL_ITEMS)

    out_dir = Path(args.out).expanduser().resolve()
    pending = [item for item in items if args.force or not output_path(item, out_dir).exists()]
    skipped = len(items) - len(pending)
    estimate = len(pending) * CREDITS_PER_ITEM

    print("=== 预置 3D 模型 ===")
    print(f"输出目录：{out_dir}")
    print(f"计划生成：{len(pending)} 件（{estimate} 积分）｜已存在跳过：{skipped} 件")

    if args.dry_run:
        plan = [
            {
                "levelId": item.level_id,
                "itemId": item.item_id,
                "file": str(output_path(item, out_dir)),
                "prompt": render_prompt(item),
            }
            for item in pending
        ]
        print(json.dumps({"region": args.region, "estimateCredits": estimate, "tasks": plan}, ensure_ascii=False, indent=2))
        return 0

    if not pending:
        manifest_path = write_manifest(ALL_ITEMS, out_dir, args.region)
        print(f"全部已存在，无需调用 API。已写 manifest：{manifest_path}")
        return 0

    any_existing = any(output_path(item, out_dir).exists() for item in ALL_ITEMS)
    if any_existing:
        # 先把已存在的模型登记进 manifest，避免"生成了一部分但网页读不到"。
        write_manifest(ALL_ITEMS, out_dir, args.region)

    key = resolve_key(args.key)
    if not key:
        print("缺少 Lux3D API Key：请设置 LUX3D_API_KEY，或 --key，或写进 .env.local。", file=sys.stderr)
        return 2

    if not args.yes:
        try:
            answer = input(f"将调用 Lux3D 生成 {len(pending)} 件，预计消耗 {estimate} 积分，继续？[y/N] ").strip().lower()
        except EOFError:
            answer = "n"
        if answer not in ("y", "yes"):
            print("已取消。")
            return 1

    base = args.base_url.rstrip("/") if args.base_url else REGIONS[args.region]
    failures: list[tuple[PresetItem, str]] = []
    succeeded = 0
    started = time.time()

    workers = max(1, min(args.concurrency, 5, len(pending)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(generate_one, item, args, base, key): item for item in pending
        }
        for future in as_completed(futures):
            item = futures[future]
            try:
                generated, size = future.result()
                succeeded += 1
                log(f"✓ {generated.level_name} {generated.item_id}《{generated.item_name}》 {size}")
            except Exception as error:  # noqa: BLE001 - CLI 需要把单件失败汇总后继续
                failures.append((item, str(error)))
                log(f"✗ {item.level_name} {item.item_id}：{error}")

    manifest_path = write_manifest(ALL_ITEMS, out_dir, args.region)
    elapsed = time.time() - started
    print()
    print(f"完成：成功 {succeeded} 件 / 失败 {len(failures)} 件，用时 {elapsed:.0f}s")
    print(f"manifest：{manifest_path}")
    print("刷新网页（或重新打开教学 / 演示关卡）即可在验货页看到真实 GLB。")
    if failures:
        print("失败明细：", file=sys.stderr)
        for item, message in failures:
            print(f"  - {item.level_name} {item.item_id}：{message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
