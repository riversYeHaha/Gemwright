#!/usr/bin/env python3
"""用 Lux3D API 生成陪伴精灵：文生 3D → 数字人自动绑骨 → 动作重定向。

用法（只需要 Python 3.9+，无第三方依赖）：
    export LUX3D_API_KEY=...
    python3 scripts/init_fairy.py                 # 生成 public/models/fairy/fairy.glb
    python3 scripts/init_fairy.py --dry-run       # 只打印 prompt / 动作 / 预计积分
    python3 scripts/init_fairy.py --force         # 重新生成（会再次消耗积分）
    python3 scripts/init_fairy.py --region global # 国际端点

调用链（全部是 Lux3D 官方异步任务，任务查询共用 /generate/task/get）：
1. POST /lux3d/v1/generate/text-to-3d/task/create
   → 静态人物 GLB（公网 URL，约 2 小时有效，脚本立刻接着用）
2. POST /lux3d/v1/animations/rig/task/create
   → 已绑骨 GLB
3. POST /lux3d/v1/animations/retarget/task/create
   → combined 输出：6 个动作合并进一个 GLB，每个动作保留独立 AnimationClip
4. 下载最终 GLB，校验 skin / animation，写入 manifest.json

预计积分（2026-11 限时价）：文生 3D 标准版 20 + 人物绑骨 15 + 人物动画（按次）6 = 41。
Key 只放 Authorization 请求头，不落盘、不打印；结果 URL 只在本次运行内使用，不写入仓库。
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "public" / "models" / "fairy"
MODEL_NAME = "fairy.glb"
MANIFEST_NAME = "manifest.json"

VERSION = "G1"
FACE_COUNT = 100_000
STYLE = "fantasy"
POLL_INTERVAL = 3
TASK_TIMEOUT = 900
TEXT_CREDITS = 20
RIG_CREDITS = 15
ANIMATION_CREDITS = 6
TOTAL_CREDITS = TEXT_CREDITS + RIG_CREDITS + ANIMATION_CREDITS

REGIONS = {
    "china": "https://api.aholo.cn",
    "global": "https://api.aholo.ai/global",
}
KEY_ENV_NAMES = ("LUX3D_API_KEY", "AHOLO_API_KEY")

PROMPT = (
    "A cute chibi fairy companion character for a fantasy treasure-hunting game, "
    "full body humanoid character, standing in a neutral A-pose with both arms slightly "
    "away from the torso and both legs visible, facing the camera, large expressive eyes, "
    "teal and gold adventurer outfit, small translucent wings folded behind the shoulders, "
    "soft friendly smile, clean game-ready topology, single character, centered, "
    "no pedestal, no base, dark neutral background, soft studio lighting, stylized 3D game asset"
)

# 动作 key 与前端 FairyAction 对齐；value 是 Lux3D 85 个公开动作 ID。
ACTION_ANIMATIONS = {
    "idle": "Idle_Loop",
    "talk": "Idle_Talking_Loop",
    "think": "Idle_FoldArms_Loop",
    "happy": "Dance_Loop",
    "sad": "Crouch_Idle_Loop",
    "alert": "Yes",
}
ANIMATION_IDS = list(ACTION_ANIMATIONS.values())


def load_dotenv(path: Path) -> None:
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


def log(message: str) -> None:
    print(message, flush=True)


def request_json(
    method: str,
    url: str,
    key: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 120,
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
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {error.code} {url}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"网络错误 {url}: {error.reason}") from error
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"非 JSON 响应 {url}: {body[:300]}") from error


def ensure_ok(body: dict[str, Any], context: str) -> None:
    code = str(body.get("c", "0"))
    if code != "0":
        raise RuntimeError(f"{context}失败：c={code} m={body.get('m')}")


def create_task(base: str, key: str, path: str, payload: dict[str, Any], label: str) -> int:
    body = request_json("POST", f"{base}{path}", key, payload)
    ensure_ok(body, label)
    task_id = body.get("d")
    if task_id is None:
        raise RuntimeError(f"{label}未返回 taskId：{body}")
    log(f"→ {label} 已创建：task {task_id}")
    return int(task_id)


def query_task(base: str, key: str, task_id: int) -> dict[str, Any]:
    query = urllib.parse.urlencode({"taskid": task_id})
    body = request_json("GET", f"{base}/lux3d/v1/generate/task/get?{query}", key)
    ensure_ok(body, "查询任务")
    data = body.get("d")
    if not isinstance(data, dict):
        raise RuntimeError(f"查询任务返回异常：{body}")
    return data


def wait_for_task(base: str, key: str, task_id: int, label: str) -> dict[str, Any]:
    started = time.time()
    last_status = None
    while time.time() - started < TASK_TIMEOUT:
        data = query_task(base, key, task_id)
        status = int(data.get("status", -1))
        if status != last_status:
            last_status = status
            log(f"  {label} task {task_id} status={status}（0 初始化 / 1 运行 / 3 成功 / 4 失败 / 6 取消）")
        if status == 3:
            return data
        if status in (4, 6):
            raise RuntimeError(f"{label} task {task_id} 结束：status={status} {data.get('errorMsg') or ''}")
        time.sleep(POLL_INTERVAL)
    raise RuntimeError(f"{label} task {task_id} 超时（{TASK_TIMEOUT}s）")


def contents_of(data: dict[str, Any]) -> list[str]:
    outputs = data.get("outputs")
    if not isinstance(outputs, list):
        return []
    result: list[str] = []
    for entry in outputs:
        content = entry.get("content") if isinstance(entry, dict) else entry
        if isinstance(content, str) and content:
            result.append(content)
    return result


def pick_glb_url(data: dict[str, Any], label: str) -> str:
    for content in contents_of(data):
        if content.startswith(("http://", "https://")) and ".glb" in content.split("?")[0].lower():
            return content
    # 绑骨任务可能直接返回 URL 或含 error 的 JSON。
    for content in contents_of(data):
        if content.startswith("//"):
            return "https:" + content
        if content.startswith("https://") or content.startswith("http://"):
            return content
        if content.lstrip().startswith("{"):
            try:
                payload = json.loads(content)
            except json.JSONDecodeError:
                continue
            if payload.get("error"):
                raise RuntimeError(f"{label}返回错误：{payload.get('error')}")
            for value in payload.values():
                if isinstance(value, str) and ".glb" in value:
                    return value
    raise RuntimeError(f"{label}没有 GLB 产物：{contents_of(data)}")


def download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=600) as response, temp.open("wb") as handle:
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
        raise RuntimeError("下载内容不是有效 GLB（缺少 glTF magic）")
    temp.replace(dest)
    return size


def read_glb_json(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    magic, version, _length = struct.unpack("<III", data[:12])
    if magic != 0x46546C67:
        raise RuntimeError(f"{path} 不是 GLB")
    offset = 12
    while offset + 8 <= len(data):
        chunk_len, chunk_type = struct.unpack("<II", data[offset : offset + 8])
        offset += 8
        chunk = data[offset : offset + chunk_len]
        offset += chunk_len
        if chunk_type == 0x4E4F534A:
            return json.loads(chunk.decode("utf-8"))
    raise RuntimeError(f"{path} 缺少 JSON chunk")


def clip_names(gltf: dict[str, Any]) -> list[str]:
    animations = gltf.get("animations")
    if not isinstance(animations, list):
        return []
    return [
        str(animation.get("name") or f"Animation{index}")
        for index, animation in enumerate(animations)
        if isinstance(animation, dict)
    ]


def bone_names(gltf: dict[str, Any]) -> list[str]:
    nodes = gltf.get("nodes")
    if not isinstance(nodes, list):
        return []
    joints: set[int] = set()
    for skin in gltf.get("skins") or []:
        if isinstance(skin, dict):
            for joint in skin.get("joints") or []:
                if isinstance(joint, int):
                    joints.add(joint)
    names: list[str] = []
    for index in sorted(joints):
        if 0 <= index < len(nodes) and isinstance(nodes[index], dict):
            names.append(str(nodes[index].get("name") or f"Bone{index}"))
    return names


def match_actions(animations: list[str]) -> dict[str, str]:
    def find(target: str) -> str | None:
        for name in animations:
            if name == target:
                return name
        for name in animations:
            if name.casefold() == target.casefold():
                return name
        target_key = target.replace("_", "").casefold()
        for name in animations:
            if target_key in name.replace("_", "").casefold():
                return name
        return None

    mapped: dict[str, str] = {}
    for key, target in ACTION_ANIMATIONS.items():
        found = find(target)
        if found:
            mapped[key] = found

    if len(mapped) == len(ACTION_ANIMATIONS):
        return mapped

    # 少数版本会把 clip 重命名成 Animation0..5；数量一致时按请求顺序兜底。
    if len(animations) == len(ANIMATION_IDS):
        log("! 动画名与 Lux3D 动作 ID 不完全一致，按请求顺序映射；请检查最终 GLB")
        return dict(zip(ACTION_ANIMATIONS.keys(), animations))

    missing = [target for key, target in ACTION_ANIMATIONS.items() if key not in mapped]
    raise RuntimeError(f"最终 GLB 缺少这些动作：{missing}；实际 clips：{animations}")


def export_manifest(
    gltf: dict[str, Any],
    actions: dict[str, str],
    clips: list[str],
    bones: list[str],
    model: str,
    region: str,
) -> dict[str, Any]:
    return {
        "version": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "scripts/init_fairy.py",
        "provider": "Lux3D",
        "versionDetail": VERSION,
        "region": region,
        "credits": TOTAL_CREDITS,
        "model": model,
        "rigged": bool(gltf.get("skins")),
        "skins": len(gltf.get("skins") or []),
        "bones": bones,
        "animations": clips,
        "animationIds": ANIMATION_IDS,
        "actions": actions,
        "prompt": PROMPT,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="用 Lux3D 生成陪伴精灵（文生 3D + 绑骨 + 动作重定向）")
    parser.add_argument("--key", help="Lux3D API Key（也可用 LUX3D_API_KEY / AHOLO_API_KEY / .env.local）")
    parser.add_argument("--region", choices=sorted(REGIONS), default="china", help="API 地区（默认 china）")
    parser.add_argument("--base-url", default="", help="自定义 API 根地址（默认按 region；旧 Key 可试 https://api.aholo3d.cn）")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="输出目录（默认 public/models/fairy）")
    parser.add_argument("--force", action="store_true", help="已存在也重新生成（会再次消耗积分）")
    parser.add_argument("--dry-run", action="store_true", help="只打印 prompt / 动作 / 积分，不调用 API")
    parser.add_argument("--yes", action="store_true", help="跳过积分确认")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    load_dotenv(ROOT / ".env.local")
    load_dotenv(ROOT / ".env")
    args = parse_args(argv)
    out_dir = Path(args.out).expanduser().resolve()
    glb_path = out_dir / MODEL_NAME
    manifest_path = out_dir / MANIFEST_NAME

    print("=== 陪伴精灵（Lux3D）===")
    print(f"输出：{glb_path}")
    print(f"动作：{json.dumps(ACTION_ANIMATIONS, ensure_ascii=False)}")
    print(f"预计积分：{TEXT_CREDITS}（文生 3D）+ {RIG_CREDITS}（绑骨）+ {ANIMATION_CREDITS}（动画按次）= {TOTAL_CREDITS}")

    if args.dry_run:
        print(
            json.dumps(
                {
                    "model": MODEL_NAME,
                    "prompt": PROMPT,
                    "version": VERSION,
                    "faceCount": FACE_COUNT,
                    "style": STYLE,
                    "animationIds": ANIMATION_IDS,
                    "actions": ACTION_ANIMATIONS,
                    "estimateCredits": TOTAL_CREDITS,
                    "output": str(glb_path),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if glb_path.exists() and manifest_path.exists() and not args.force:
        print(f"已存在，跳过：{glb_path}（--force 可重新生成，会再消耗积分）")
        return 0

    key = resolve_key(args.key)
    if not key:
        print("缺少 Lux3D API Key：请设置 LUX3D_API_KEY / AHOLO_API_KEY，或 --key，或写进 .env.local。", file=sys.stderr)
        return 2

    if not args.yes:
        try:
            answer = input(f"将调用 Lux3D 生成 1 个精灵（约 {TOTAL_CREDITS} 积分），继续？[y/N] ").strip().lower()
        except EOFError:
            answer = "n"
        if answer not in ("y", "yes"):
            print("已取消。")
            return 1

    base = (args.base_url.rstrip("/") if args.base_url else REGIONS[args.region]).rstrip("/")
    started = time.time()
    try:
        # 1. 文生 3D
        text_task = create_task(
            base,
            key,
            "/lux3d/v1/generate/text-to-3d/task/create",
            {
                "prompt": PROMPT,
                "style": STYLE,
                "version": VERSION,
                "faceCount": FACE_COUNT,
                "outputFormat": ["zip", "glb"],
                "enablePbr": True,
                "aiPredictSize": True,
            },
            "文生 3D",
        )
        text_data = wait_for_task(base, key, text_task, "文生 3D")
        source_glb_url = pick_glb_url(text_data, "文生 3D")
        log(f"✓ 静态模型：{source_glb_url.split('?')[0]}")

        # 2. 数字人自动绑骨
        rig_task = create_task(
            base,
            key,
            "/lux3d/v1/animations/rig/task/create",
            {"modelUrl": source_glb_url},
            "数字人绑骨",
        )
        rig_data = wait_for_task(base, key, rig_task, "数字人绑骨")
        rig_glb_url = pick_glb_url(rig_data, "数字人绑骨")
        log(f"✓ 已绑骨：{rig_glb_url.split('?')[0]}")

        # 3. 动作重定向（combined：6 个动作合并进一个 GLB）
        retarget_task = create_task(
            base,
            key,
            "/lux3d/v1/animations/retarget/task/create",
            {
                "rigModelUrl": rig_glb_url,
                "animationIds": ANIMATION_IDS,
                "animationOutputMode": "combined",
                "outFormat": "glb",
                "animateInPlace": True,
            },
            "动作重定向",
        )
        retarget_data = wait_for_task(base, key, retarget_task, "动作重定向")

        # 4. 解析重定向结果：actions JSON → 唯一 combined GLB URL
        urls: list[str] = []
        for content in contents_of(retarget_data):
            if content.startswith("http://") or content.startswith("https://"):
                urls.append(content)
                continue
            try:
                payload = json.loads(content)
            except json.JSONDecodeError:
                continue
            actions = payload.get("actions") if isinstance(payload, dict) else None
            if isinstance(actions, list):
                for action in actions:
                    if not isinstance(action, dict):
                        continue
                    if action.get("status") != "success":
                        raise RuntimeError(
                            f"动作 {action.get('animation_id')} 失败：{action.get('error') or action}"
                        )
                    url = action.get("animationGlbUrl") or action.get("glbUrl") or action.get("url")
                    if isinstance(url, str) and url:
                        urls.append(url)
            # 兼容 combined 模式把合并文件放在其它字段 / 顶层的情况。
            def collect(value: Any) -> None:
                if isinstance(value, str) and ".glb" in value.split("?")[0].lower():
                    urls.append(value)
                elif isinstance(value, dict):
                    for child in value.values():
                        collect(child)
                elif isinstance(value, list):
                    for child in value:
                        collect(child)

            collect(payload)
        unique_urls = list(dict.fromkeys(urls))
        if not unique_urls:
            raise RuntimeError(f"动作重定向没有返回 GLB：{contents_of(retarget_data)}")
        if len(unique_urls) > 1:
            raise RuntimeError(
                f"combined 模式预期同一个 GLB，但返回了 {len(unique_urls)} 个不同 URL；"
                "请确认 API 版本支持 animationOutputMode=combined"
            )
        log(f"✓ 动画：{unique_urls[0].split('?')[0]}")

        # 5. 下载 + 校验
        size = download(unique_urls[0], glb_path)
        gltf = read_glb_json(glb_path)
        animations = clip_names(gltf)
        skins = gltf.get("skins") or []
        bones = bone_names(gltf)
        if not skins:
            raise RuntimeError("绑骨结果没有 skin，Lux3D 绑骨可能失败；未写入 manifest（旧文件保留）")
        if not animations:
            raise RuntimeError("动画结果没有 AnimationClip；未写入 manifest（旧文件保留）")
        actions = match_actions(animations)
        manifest = export_manifest(gltf, actions, animations, bones, MODEL_NAME, args.region)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        elapsed = time.time() - started
        size_text = f"{size / 1024 / 1024:.1f}MB" if size >= 1024 * 1024 else f"{size / 1024:.0f}KB"
        print()
        print(f"✓ 完成：{glb_path}（{size_text}，{len(skins)} 个 skin / {len(bones)} 根骨骼 / {len(animations)} 个动作，用时 {elapsed:.0f}s）")
        print(f"✓ manifest：{manifest_path}")
        print(f"✓ 动作映射：{json.dumps(actions, ensure_ascii=False)}")
        print("刷新网页后，右下角精灵会自动加载这个 Lux3D GLB。")
        return 0
    except Exception as error:  # noqa: BLE001 - CLI 需要统一输出可操作错误
        print(f"\n✗ 生成失败：{error}", file=sys.stderr)
        print("旧 fairy.glb / manifest 未被覆盖，网页会继续使用上一个产物或程序化兜底。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
