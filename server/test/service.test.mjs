import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageService } from '../src/server.mjs';
import { normalizeUsage, normalizeWindow, UsageError } from '../src/codex.mjs';
import { loadConfig } from '../src/config.mjs';

const config = { host: '127.0.0.1', port: 0, cacheTtlSeconds: 30, timeoutSeconds: 2, apiKey: '', allowedOrigins: [] };
const sample = () => ({
  rateLimits: { limitId: 'old', primary: { usedPercent: 1 } },
  rateLimitsByLimitId: { codex: { planType: 'pro', primary: { usedPercent: 81, windowDurationMins: 10080, resetsAt: 1893456000 } } },
  ordinaryUsageAllowed: true,
  rateLimitResetCredits: { availableCount: 2, credits: [{ id: 'private-id' }] },
  accountId: 'private-account',
  access_token: 'private-token',
});
async function serve(t, reader, overrides = {}) {
  const service = createUsageService({ ...config, ...overrides }, reader);
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const base = `http://127.0.0.1:${service.server.address().port}`;
  return { base, get: async (path = '/api/usage', options) => {
    const response = await fetch(base + path, options);
    return { response, data: await response.json() };
  } };
}

test('multi-bucket data, nulls, remaining percentages and credential exclusion', () => {
  const data = normalizeUsage(sample());
  assert.equal(data.limits.length, 1);
  assert.equal(data.limits[0].limitId, 'codex');
  assert.equal(data.limits[0].primary.remainingPercent, 19);
  assert.equal(data.limits[0].primary.resetsAtIso, '2030-01-01T00:00:00.000Z');
  assert.equal(data.limits[0].secondary, null);
  assert.equal(data.availableResetCount, 2);
  assert.ok(!JSON.stringify(data).includes('private-'));
  assert.equal(normalizeWindow({}).remainingPercent, null);
  assert.equal(normalizeWindow({ usedPercent: 120 }).remainingPercent, 0);
  assert.equal(normalizeWindow({ usedPercent: -2 }).remainingPercent, 100);
  assert.equal(normalizeWindow({ resetsAt: 1e99 }).resetsAtIso, null);
  assert.equal(normalizeUsage({ rateLimits: { primary: { usedPercent: 0 } } }).limits[0].primary.remainingPercent, 100);
  assert.throws(() => normalizeUsage({}), { code: 'CODEX_NO_LIMITS' });
});

test('cache, forced refresh, coalesced concurrent reads', async t => {
  let calls = 0;
  const { get } = await serve(t, async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return sample();
  });
  const results = await Promise.all(Array.from({ length: 5 }, () => get()));
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.response.status === 200));
  assert.equal((await get()).data.cached, true);
  const refreshed = await get('/api/usage?refresh=1');
  assert.equal(calls, 2);
  assert.equal(refreshed.data.cached, false);
  assert.equal(refreshed.response.headers.get('cache-control'), 'no-store');
});

test('failure invalidates old data and does not leak upstream error details', async t => {
  let fail = false;
  let calls = 0;
  const { get } = await serve(t, async () => {
    calls++;
    if (fail) throw new Error('private-token');
    return sample();
  });
  await get();
  fail = true;
  const result = await get('/api/usage?refresh=1');
  assert.equal(result.response.status, 502);
  assert.equal(result.data.ok, false);
  assert.ok(!JSON.stringify(result.data).includes('private-token'));
  assert.equal((await get()).response.status, 502);
  assert.equal(calls, 2);
  fail = false;
  assert.equal((await get('/api/usage?refresh=1')).response.status, 200);
});

test('expired cache fetches again; timeout and unavailable data are errors', async t => {
  let calls = 0;
  const { get } = await serve(t, async () => { calls++; return sample(); }, { cacheTtlSeconds: 0 });
  await get(); await get();
  assert.equal(calls, 2);
  const timeout = await serve(t, async () => { throw new UsageError('CODEX_TIMEOUT', 'timeout', 504); });
  assert.equal((await timeout.get()).response.status, 504);
  const empty = await serve(t, async () => ({}));
  assert.equal((await empty.get()).response.status, 503);
});

test('health, API key, CORS preflight, methods, routing and Host protection', async t => {
  const { base, get } = await serve(t, async () => sample(), {
    apiKey: 'a-long-local-test-api-key', allowedOrigins: ['http://localhost:5173'],
  });
  assert.equal((await get('/health')).response.status, 200);
  assert.equal((await get()).response.status, 401);
  const headers = { Authorization: 'Bearer a-long-local-test-api-key', Origin: 'http://localhost:5173' };
  const valid = await get('/api/usage', { headers });
  assert.equal(valid.response.status, 200);
  assert.equal(valid.response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.equal((await get('/api/usage', { headers: { ...headers, Origin: 'https://untrusted.example' } })).response.status, 403);
  const preflight = await fetch(base + '/api/usage', { method: 'OPTIONS', headers: { Origin: headers.Origin } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal((await get('/api/usage', { method: 'POST', headers })).response.status, 405);
  assert.equal((await get('/missing', { headers })).response.status, 404);
  // Use node:http; fetch controls its own Host header.
  const { request } = await import('node:http');
  const status = await new Promise(resolve => {
    request(base + '/health', { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); }).end();
  });
  assert.equal(status, 403);
});

test('network exposure requires authentication and config values are validated', () => {
  assert.throws(() => loadConfig({ CODEX_USAGE_HOST: '0.0.0.0', CODEX_USAGE_API_KEY: '' }), /apiKey/);
  assert.throws(() => loadConfig({ CODEX_USAGE_PORT: 'not-a-port' }), /port/);
  assert.throws(() => loadConfig({ CODEX_USAGE_TIMEOUT_SECONDS: '0' }), /timeoutSeconds/);
  const network = loadConfig({ CODEX_USAGE_HOST: '0.0.0.0', CODEX_USAGE_API_KEY: 'a'.repeat(32) });
  assert.equal(network.host, '0.0.0.0');
});
