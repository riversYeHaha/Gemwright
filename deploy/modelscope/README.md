# ModelScope Studio（Docker）

线上：https://modelscope.cn/studios/riversHaha/gemwright

该目录是 ModelScope Studio 的 Docker 部署件：

- `server.mjs`：同源静态服务器 + Lux3D 反向代理（`/lux3d/*` → `api.aholo.cn`，`/lux3d-global/*` → `api.aholo.ai/global`），监听 `0.0.0.0:7860`。
- `Dockerfile`：以仓库根目录为构建上下文，要求 `dist/` 已构建。

## 构建

```bash
VITE_LUX3D_PROXY=1 npm run build
```

`dist/` 会包含 `public/models/`（陪伴精灵、教学/演示珍宝 GLB），构建前确保这些文件存在。

## 本地验证

```bash
PORT=7860 node deploy/modelscope/server.mjs
```

访问 `http://127.0.0.1:7860/`；`/healthz` 用于健康检查。

## 部署

把 `dist/`、`server.mjs`、`Dockerfile` 推到 Studio 仓库根目录，Dockerfile 的 `COPY` 路径按根目录写：

```dockerfile
COPY dist ./dist
COPY server.mjs ./server.mjs
```

ModelScope Docker Studio 要求端口 7860。
