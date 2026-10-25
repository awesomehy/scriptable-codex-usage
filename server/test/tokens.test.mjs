import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageService } from '../src/server.mjs';
import { normalizeTokenUsage } from '../src/tokens.mjs';

const sample = () => ({
  summary: { lifetimeTokens: 12345, accountId: 'private-account' },
  dailyUsageBuckets: [
    { startDate: '2026-09-30', tokens: 10 },
    { startDate: '2026-10-01', tokens: 20 },
    { startDate: '2026-10-04', tokens: 40 },
    { startDate: '2026-10-05', tokens: 50 },
  ],
  access_token: 'private-token',
});

test('lifetime, month, last seven calendar days, and yesterday keep missing days visible', () => {
  const result = normalizeTokenUsage(sample(), new Date(2026, 9, 5, 12));
  assert.equal(result.lifetimeTokens, 12345);
  assert.equal(result.thisMonth.tokens, 110);
  assert.equal(result.thisMonth.startDate, '2026-10-01');
  assert.deepEqual(result.thisMonth.missingDates, ['2026-10-02', '2026-10-03']);
  assert.equal(result.thisMonth.complete, false);
  assert.equal(result.last7Days.tokens, 120);
  assert.equal(result.last7Days.startDate, '2026-09-29');
  assert.equal(result.yesterday.tokens, 40);
  assert.equal(result.yesterday.complete, true);
  assert.equal(result.dailyCoverage.firstDate, '2026-09-30');
  assert.ok(!JSON.stringify(result).includes('private-'));
});

test('missing upstream metrics remain unknown and malformed buckets are rejected', () => {
  const date = new Date(2026, 9, 5, 12);
  const missing = normalizeTokenUsage({ summary: { lifetimeTokens: null }, dailyUsageBuckets: null }, date);
  assert.equal(missing.lifetimeTokens, null);
  assert.equal(missing.yesterday.tokens, null);
  assert.equal(missing.yesterday.complete, false);
  assert.equal(missing.dailyCoverage.reportedDays, 0);
  assert.throws(() => normalizeTokenUsage({ dailyUsageBuckets: [{ startDate: '2026-02-30', tokens: 1 }] }, date), { code: 'CODEX_INVALID_RESPONSE' });
  assert.throws(() => normalizeTokenUsage({ dailyUsageBuckets: [{ startDate: '2026-10-04', tokens: -1 }] }, date), { code: 'CODEX_INVALID_RESPONSE' });
});

test('token endpoint authenticates, caches, refreshes, and excludes raw account fields', async t => {
  let calls = 0;
  let fail = false;
  const config = { host: '127.0.0.1', port: 0, cacheTtlSeconds: 30, timeoutSeconds: 2,
    apiKey: 'test-token-key', allowedOrigins: [] };
  const service = createUsageService(config, async () => ({ rateLimits: { primary: { usedPercent: 10 } } }), async () => {
    calls++;
    if (fail) throw new Error('private-token');
    return sample();
  });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}/api/token-usage`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { Authorization: 'Bearer test-token-key' };
  const first = await (await fetch(url, { headers })).json();
  assert.equal(first.lifetimeTokens, 12345);
  assert.equal(first.cached, false);
  assert.ok(!JSON.stringify(first).includes('private-'));
  assert.equal((await (await fetch(url, { headers })).json()).cached, true);
  assert.equal(calls, 1);
  assert.equal((await (await fetch(url + '?refresh=1', { headers })).json()).cached, false);
  assert.equal(calls, 2);
  fail = true;
  const failed = await fetch(url + '?refresh=1', { headers });
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes('private-token'));
  assert.equal((await fetch(url, { headers })).status, 502);
});
