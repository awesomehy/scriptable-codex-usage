import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, delimiter } from 'node:path';

export class UsageError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Resolve a real executable without a shell. Desktop updates may change its directory.
export function findCodex(explicitPath = '') {
  if (explicitPath) return explicitPath;
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = readdirSync(root)
        .map(name => join(root, name, executable))
        .filter(path => existsSync(path))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    } catch { /* Fall through to a useful, non-sensitive error. */ }
  }
  throw new UsageError('CODEX_NOT_FOUND', '找不到 Codex 可执行文件，请设置 codexPath 或 CODEX_BIN。', 503);
}

export function readCodexUsage({ codexPath = '', timeoutSeconds = 20, signal } = {}, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(findCodex(codexPath), ['app-server', '--listen', 'stdio://'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let done = false;
    let initialized = false;
    const lines = createInterface({ input: child.stdout });
    const finish = (error, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(data);
    };
    const onAbort = () => finish(new UsageError('SHUTTING_DOWN', '服务正在停止。', 503));
    const timer = setTimeout(() => finish(new UsageError(
      'CODEX_TIMEOUT', '读取额度超时，请检查网络及 Codex 登录状态。', 504,
    )), timeoutSeconds * 1000);
    const send = message => {
      if (!done) child.stdin.write(JSON.stringify(message) + '\n');
    };
    // Never forward Codex stderr, credentials, or full RPC errors to callers/logs.
    child.stderr.resume();
    child.on('error', () => finish(new UsageError('CODEX_START_FAILED', '无法启动 Codex，请检查 codexPath 配置。', 503)));
    child.stdin.on('error', () => finish(new UsageError('CODEX_DISCONNECTED', 'Codex 连接意外中断。')));
    child.on('exit', () => finish(new UsageError('CODEX_EXITED', 'Codex 在返回额度前退出。')));
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1 && !initialized) {
        if (message.error) {
          finish(new UsageError('CODEX_INIT_FAILED', 'Codex 初始化失败，请检查版本与本地配置。', 503));
          return;
        }
        if (!Object.hasOwn(message, 'result')) return;
        initialized = true;
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'account/rateLimits/read', params: {} });
      } else if (message.id === 2 && initialized) {
        if (message.error) {
          finish(new UsageError('CODEX_USAGE_UNAVAILABLE', '无法读取额度，请确认 Codex 已通过 ChatGPT 登录并可联网。'));
        } else if (message.result && typeof message.result === 'object') {
          finish(null, message.result);
        } else {
          finish(new UsageError('CODEX_INVALID_RESPONSE', 'Codex 返回了无效的额度数据。'));
        }
      } else if (message.method && Object.hasOwn(message, 'id')) {
        // This adapter implements only quota reads; never approve other RPC actions.
        send({ id: message.id, error: { code: -32601, message: 'Method not supported' } });
      }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'codex_usage_api', title: 'Local Codex Usage API', version: '1.0.0' },
    } });
  });
}

const numberOrNull = value => Number.isFinite(value) ? value : null;
const stringOrNull = value => typeof value === 'string' ? value : null;
const booleanOrNull = value => typeof value === 'boolean' ? value : null;

export function normalizeWindow(window) {
  if (!window || typeof window !== 'object') return null;
  const usedPercent = numberOrNull(window.usedPercent);
  const resetsAt = numberOrNull(window.resetsAt);
  const date = resetsAt === null ? null : new Date(resetsAt * 1000);
  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
    windowDurationMins: numberOrNull(window.windowDurationMins),
    resetsAt,
    resetsAtIso: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
  };
}

function normalizeLimit(limit, id) {
  return {
    limitId: stringOrNull(limit.limitId) ?? id,
    limitName: stringOrNull(limit.limitName),
    planType: stringOrNull(limit.planType),
    primary: normalizeWindow(limit.primary),
    secondary: normalizeWindow(limit.secondary),
    credits: limit.credits ? {
      hasCredits: booleanOrNull(limit.credits.hasCredits),
      unlimited: booleanOrNull(limit.credits.unlimited),
      balance: stringOrNull(limit.credits.balance),
    } : null,
    spendControlReached: booleanOrNull(limit.spendControlReached),
    rateLimitReachedType: stringOrNull(limit.rateLimitReachedType),
  };
}

export function normalizeUsage(raw) {
  // Prefer the multi-bucket view. Missing quota is unknown, never zero usage.
  let entries = Object.entries(raw.rateLimitsByLimitId ?? {});
  if (!entries.length && raw.rateLimits) entries = [[raw.rateLimits.limitId ?? 'codex', raw.rateLimits]];
  const limits = entries.filter(([, limit]) => limit && typeof limit === 'object')
    .map(([id, limit]) => normalizeLimit(limit, id));
  if (!limits.length) throw new UsageError('CODEX_NO_LIMITS', '当前账号没有可用的 Codex 额度数据。', 503);
  return {
    ordinaryUsageAllowed: booleanOrNull(raw.ordinaryUsageAllowed),
    availableResetCount: numberOrNull(raw.rateLimitResetCredits?.availableCount),
    limits,
  };
}
