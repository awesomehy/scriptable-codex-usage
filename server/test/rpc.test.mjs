import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readCodexUsage } from '../src/codex.mjs';

const fixture = fileURLToPath(new URL('./fixtures/rpc-peer.mjs', import.meta.url));
function peer(mode, children) {
  return (executable, args, options) => {
    assert.deepEqual(args, ['app-server', '--listen', 'stdio://']);
    const child = spawn(process.execPath, [fixture, mode], options);
    children.push(child);
    return child;
  };
}

test('RPC handshake precedes quota query and child exits after successful read', async () => {
  const children = [];
  const data = await readCodexUsage({ codexPath: process.execPath }, peer('success', children));
  assert.equal(data.rateLimits.primary.usedPercent, 42);
  if (children[0].exitCode === null && children[0].signalCode === null) await once(children[0], 'exit');
  assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
});

test('nonexistent Codex executable returns a safe startup error', async () => {
  await assert.rejects(readCodexUsage({ codexPath: 'nonexistent-codex-test-executable', timeoutSeconds: 1 }), { code: 'CODEX_START_FAILED' });
});

test('RPC client times out and terminates a silent child', async () => {
  const children = [];
  await assert.rejects(readCodexUsage({ codexPath: process.execPath, timeoutSeconds: 0.15 }, peer('silent', children)), { code: 'CODEX_TIMEOUT' });
  if (children[0].exitCode === null && children[0].signalCode === null) await once(children[0], 'exit');
  assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
});

test('RPC error is sanitized and an unexpected exit is reported', async () => {
  await assert.rejects(readCodexUsage({ codexPath: process.execPath }, peer('error', [])), error =>
    error.code === 'CODEX_USAGE_UNAVAILABLE' && !error.message.includes('private-token'));
  await assert.rejects(readCodexUsage({ codexPath: process.execPath }, peer('exit', [])), { code: 'CODEX_EXITED' });
});

test('aborted reads are rejected without starting quota requests', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readCodexUsage({ codexPath: process.execPath, signal: controller.signal }), { code: 'SHUTTING_DOWN' });
});
