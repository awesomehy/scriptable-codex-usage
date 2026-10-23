import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, isLoopback, projectRoot } from './config.mjs';
import { readCodexUsage, normalizeUsage, UsageError } from './codex.mjs';

export function createUsageService(config, reader = readCodexUsage) {
  let snapshot = null;
  let fetchedAt = 0;
  let pending = null;
  let lastFailure = null;
  let retryAt = 0;
  const abortController = new AbortController();
  const getUsage = async force => {
    const age = Date.now() - fetchedAt;
    // Do not serve a snapshot past a reset boundary that was still in the future when fetched.
    const resetPassed = snapshot?.limits.some(limit => [limit.primary, limit.secondary].some(window =>
      window?.resetsAt != null && window.resetsAt * 1000 > fetchedAt && window.resetsAt * 1000 <= Date.now()));
    if (!force && snapshot && !resetPassed && age < config.cacheTtlSeconds * 1000) return true;
    if (pending) { await pending; return false; }
    if (!force && lastFailure && Date.now() < retryAt) throw lastFailure;
    pending = (async () => {
      try {
        const raw = await reader({ ...config, signal: abortController.signal });
        const normalized = normalizeUsage(raw);
        snapshot = normalized;
        fetchedAt = Date.now();
        lastFailure = null;
      } catch (error) {
        // A failed explicit refresh invalidates earlier data; never hide a sign-out/failure.
        snapshot = null;
        lastFailure = error;
        retryAt = Date.now() + 5000;
        throw error;
      }
    })();
    try { await pending; } finally { pending = null; }
    return false;
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body, null, 2) + '\n'); };
    const fail = (status, code, message) => send(status, { ok: false, error: { code, message } });
    try {
      let url;
      try {
        const host = new URL(`http://${request.headers.host}`).hostname.replace(/^\[|\]$/g, '');
        if (isLoopback(config.host) && !isLoopback(host)) {
          fail(403, 'HOST_DENIED', '不允许此 Host。'); return;
        }
        url = new URL(request.url, 'http://localhost');
      } catch { fail(400, 'INVALID_REQUEST', '无效请求。'); return; }
      const origin = request.headers.origin;
      if (origin) {
        if (!config.allowedOrigins.includes(origin)) { fail(403, 'ORIGIN_DENIED', '请在 allowedOrigins 中配置浏览器来源。'); return; }
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.writeHead(204); response.end(); return;
      }
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET, OPTIONS');
        fail(405, 'METHOD_NOT_ALLOWED', '此接口只支持 GET。'); return;
      }
      if (url.pathname === '/health') {
        send(200, { ok: true, service: 'codex-usage-api', version: '1.0.0' }); return;
      }
      if (config.apiKey) {
        const expected = Buffer.from(`Bearer ${config.apiKey}`);
        const provided = Buffer.from(request.headers.authorization ?? '');
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          response.setHeader('WWW-Authenticate', 'Bearer');
          fail(401, 'UNAUTHORIZED', '需要有效的 Bearer API Key。'); return;
        }
      }
      if (url.pathname === '/') {
        send(200, { service: 'codex-usage-api', endpoints: { usage: '/api/usage', refresh: '/api/usage?refresh=1', health: '/health' } }); return;
      }
      if (url.pathname !== '/api/usage') { fail(404, 'NOT_FOUND', '接口不存在。'); return; }
      const cached = await getUsage(url.searchParams.get('refresh') === '1');
      send(200, {
        ok: true,
        source: 'codex-app-server',
        fetchedAt: new Date(fetchedAt).toISOString(),
        cached,
        ageSeconds: Math.floor((Date.now() - fetchedAt) / 1000),
        cacheTtlSeconds: config.cacheTtlSeconds,
        ...snapshot,
      });
    } catch (error) {
      if (error instanceof UsageError) fail(error.status, error.code, error.message);
      else fail(502, 'USAGE_FETCH_FAILED', '读取额度失败，请检查本地 Codex 配置和网络。');
    }
  });
  server.requestTimeout = (config.timeoutSeconds + 5) * 1000;
  server.headersTimeout = 10000;
  return {
    server,
    close: () => {
      abortController.abort();
      return new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig();
    // Always use this service's directory rather than an unrelated caller's project config.
    process.chdir(projectRoot);
    const service = createUsageService(config);
    service.server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `端口 ${config.port} 已被占用。` : 'HTTP 服务启动失败，请检查监听配置。');
      process.exitCode = 1;
    });
    service.server.listen(config.port, config.host, () => {
      const host = config.host.includes(':') ? `[${config.host}]` : config.host;
      console.log(`Codex Usage API: http://${host}:${config.port}/api/usage`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void service.close(); });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
