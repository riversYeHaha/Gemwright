/* global process, console, URL */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 7860);
const HOST = process.env.HOST || '0.0.0.0';
const DIST = resolve(process.env.DIST_DIR || 'dist');
const UPSTREAMS = [
  { prefix: '/lux3d-global', hostname: 'api.aholo.ai', pathPrefix: '/global' },
  { prefix: '/lux3d', hostname: 'api.aholo.cn', pathPrefix: '/lux3d' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function log(message) {
  console.log(`[gemwright] ${message}`);
}

function proxy(req, res, upstream) {
  const rest = req.url.slice(upstream.prefix.length);
  const path = `${upstream.pathPrefix}${rest}`;
  const headers = {};
  for (const name of ['authorization', 'content-type', 'accept', 'accept-language', 'user-agent']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  // ModelScope 的 ms.show 网关会用平台 token 改写 / 消费 Authorization，
  // 因此浏览器端在代理模式额外发送 X-Lux3D-Key；服务端把它还原成 Lux3D 需要的裸 Key。
  const proxyKey = req.headers['x-lux3d-key'];
  if (typeof proxyKey === 'string' && proxyKey.trim()) headers.authorization = proxyKey.trim();
  const target = httpsRequest(
    {
      hostname: upstream.hostname,
      port: 443,
      path,
      method: req.method,
      headers,
      timeout: 120_000,
    },
    (remote) => {
      const responseHeaders = { ...remote.headers };
      delete responseHeaders.connection;
      delete responseHeaders['transfer-encoding'];
      res.writeHead(remote.statusCode || 502, responseHeaders);
      remote.pipe(res);
    },
  );
  target.on('timeout', () => target.destroy(new Error('upstream timeout')));
  target.on('error', (error) => {
    log(`proxy error ${req.method} ${path}: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ c: '-1', m: `Lux3D proxy error: ${error.message}` }));
    } else {
      res.destroy();
    }
  });
  req.pipe(target);
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  let file = resolve(join(DIST, normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '')));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (pathname.endsWith('/') || !existsSync(file)) file = join(DIST, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = extname(file).toLowerCase();
  const stat = statSync(file);
  const isHtml = ext === '.html';
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control':
      isHtml || pathname === '/models/manifest.json'
        ? 'no-cache'
        : pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const upstream = UPSTREAMS.find(({ prefix }) =>
    (req.url || '').startsWith(`${prefix}/`),
  );
  if (upstream) {
    proxy(req, res, upstream);
    return;
  }
  serveStatic(req, res);
});

server.keepAliveTimeout = 65_000;
server.listen(PORT, HOST, () => log(`listening on ${HOST}:${PORT}, dist=${DIST}`));
