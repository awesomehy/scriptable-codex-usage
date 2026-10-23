import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const isLoopback = host => ['127.0.0.1', '::1', 'localhost'].includes(host);

export function loadConfig(env = process.env) {
  let file = {};
  try { file = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('config.json 不是有效的 JSON。'); }
  const config = {
    host: env.CODEX_USAGE_HOST ?? file.host ?? '127.0.0.1',
    port: Number(env.CODEX_USAGE_PORT ?? file.port ?? 58321),
    cacheTtlSeconds: Number(env.CODEX_USAGE_CACHE_SECONDS ?? file.cacheTtlSeconds ?? 30),
    timeoutSeconds: Number(env.CODEX_USAGE_TIMEOUT_SECONDS ?? file.timeoutSeconds ?? 20),
    codexPath: env.CODEX_BIN ?? file.codexPath ?? '',
    apiKey: env.CODEX_USAGE_API_KEY ?? file.apiKey ?? '',
    allowedOrigins: file.allowedOrigins ?? [],
  };
  if (typeof config.host !== 'string' || (!isIP(config.host) && config.host !== 'localhost')) throw new Error('host 必须是 IP 地址或 localhost。');
  for (const [key, min, max] of [['port', 1, 65535], ['cacheTtlSeconds', 0, 3600], ['timeoutSeconds', 1, 120]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`${key} 必须是 ${min}–${max} 之间的整数。`);
  }
  if (typeof config.apiKey !== 'string' || typeof config.codexPath !== 'string') throw new Error('apiKey 和 codexPath 必须是字符串。');
  if (!isLoopback(config.host) && config.apiKey.length < 24) throw new Error('监听局域网地址时必须设置至少 24 个字符的 apiKey。');
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.some(origin => {
    try { const url = new URL(origin); return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; }
    catch { return true; }
  })) throw new Error('allowedOrigins 必须是完整的 HTTP/HTTPS Origin 列表，不能使用通配符或路径。');
  return config;
}
