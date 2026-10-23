import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createUsageService } from '../server/src/server.mjs';

const fullSource = await readFile(new URL('../CodexUsage.js', import.meta.url), 'utf8');
const source = fullSource.replace('try { await main(); } finally { Script.complete(); }', '');
const currentVersion = fullSource.match(/^const VERSION = "([\d.]+)";/m)[1];
const nextVersion = currentVersion.split('.').map((part, i) => i === 2 ? Number(part) + 1 : part).join('.');
const NOW = Date.parse('2026-10-24T01:00:00Z');
const KEY = 'test-key-not-a-real-credential';
const PROFILE = { endpoint: 'http://example.test/api/usage', apiKey: KEY, cacheId: 'test-cache-0001' };
const fixture = () => ({
  ok: true, fetchedAt: new Date(NOW).toISOString(), cached: false, ageSeconds: 0, cacheTtlSeconds: 30,
  ordinaryUsageAllowed: true, availableResetCount: 2,
  limits: [{ limitId: 'codex', planType: 'prolite', primary: { usedPercent: 88, remainingPercent: 12, windowDurationMins: 10080, resetsAt: 1793294364 }, secondary: null, spendControlReached: false, rateLimitReachedType: null }],
});

function harness({ configured = true, responses = [], files = new Map(), failWrites = false, corruptWrites = false, keychainFails = false, noStorage = false, scriptWriteFails = false, cloud = false, alertSteps = [], extra = {} } = {}) {
  let now = NOW, uid = 0;
  const calls = [];
  const messages = [], menus = [], launches = [], downloads = [], widgets = [];
  const keys = new Map(configured ? [['CodexUsage.connection.v1', JSON.stringify(PROFILE)]] : []);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const fm = {
    documentsDirectory: () => '/documents', joinPath: (a, b) => a + '/' + b,
    fileExists: path => files.has(path), createDirectory: path => files.set(path, '<directory>'),
    readString: path => { if (!files.has(path)) throw Error('missing'); return files.get(path); },
    writeString: (path, value) => {
      if (scriptWriteFails && path === '/documents/CodexUsage.js' && value !== fullSource) { files.set(path, '<partial>'); throw Error('write interrupted'); }
      if (failWrites) throw Error('disk full'); files.set(path, corruptWrites ? value.slice(0, 8) : value);
    },
    remove: path => files.delete(path),
    isFileStoredIniCloud: () => cloud,
    downloadFileFromiCloud: async path => downloads.push(path),
  };
  const api = vm.runInNewContext(`${source}\n;({readSettings, readRefreshSeconds, saveRefreshSeconds, configureRefresh, cleanPayload, snapshotFrom, chooseWindows, loadUsage, readConnection, saveConnection, normalizeEndpoint, footerLabel, effectiveStatus, fetchUsage, retryTime, configureConnection, main, sha256, validateUpdate, newerVersion, updateScript, restoreScript, replaceScript, scriptURL, widgetTapURL, resetLabel, beijingTime, setRenderer: fn => {renderWidget = fn;}})`, {
    Date: Clock,
    UUID: { string: () => 'test-new-cache-000' + ++uid },
    Keychain: {
      contains: key => { if (keychainFails) throw Error('locked'); return keys.has(key); },
      get: key => keys.get(key), set: (key, value) => { if (keychainFails) throw Error('locked'); keys.set(key, value); },
    },
    FileManager: { local: () => { if (noStorage) throw Error('unavailable'); return fm; }, iCloud: () => fm },
    module: { filename: '/documents/CodexUsage.js' },
    config: { runsInApp: true, runsInWidget: false },
    args: { queryParameters: {} },
    Script: { name: () => 'CodexUsage', setWidget: widget => widgets.push(widget) },
    Safari: { open: async url => launches.push(url) },
    Alert: class {
      fields = []; actions = [];
      addAction(label) { this.actions.push(label); } addCancelAction() {}
      addTextField(label, value) { this.fields.push({ label, value }); }
      addSecureTextField(label, value) { this.addTextField(label, value); }
      textFieldValue(index) { return this.answer?.values?.[index] ?? this.fields[index].value; }
      async presentAlert() { messages.push({ title: this.title, message: this.message, fields: this.fields }); this.answer = alertSteps.shift(); return this.answer?.choice ?? 0; }
      async presentSheet() { if (!alertSteps.length) throw Error('unexpected menu'); menus.push({ title: this.title, message: this.message, actions: this.actions }); return alertSteps.shift().choice; }
    },
    Request: class {
      constructor(url) { this.url = url; }
      async loadString() {
        calls.push(this);
        const response = responses.shift();
        if (!response) throw Error('test has no queued response');
        if (response.redirect) assert.equal(this.onRedirect({ url: 'https://other.test/collect' }), null);
        this.response = { statusCode: response.status ?? 200, headers: response.headers || {} };
        if (response.error) throw Error(response.error);
        return response.raw ?? JSON.stringify(response.body ?? fixture());
      }
    },
    ...extra,
  });
  return { api, calls, keys, files, responses, messages, menus, launches, downloads, widgets, setNow: value => { now = value; }, setWriteFailure: value => { failWrites = value; }, setCorruptWrites: value => { corruptWrites = value; }, settings: api.readSettings('') };
}

test('companion HTTP API returns quota that the widget can display', async t => {
  const service = createUsageService({
    host: '127.0.0.1', port: 0, cacheTtlSeconds: 30, timeoutSeconds: 2,
    apiKey: KEY, allowedOrigins: [],
  }, async () => ({
    ordinaryUsageAllowed: true,
    rateLimitResetCredits: { availableCount: 2 },
    rateLimitsByLimitId: { codex: {
      primary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: 1893456000 },
      secondary: null,
    } },
  }));
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}/api/usage`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const h = harness();
  h.setNow(Date.now());
  const snapshot = h.api.snapshotFrom(h.api.cleanPayload(payload), h.settings);
  assert.equal(snapshot.windows.length, 1);
  assert.equal(snapshot.windows[0].remainingPercent, 65);
  assert.equal(snapshot.windows[0].label, 'Weekly');
  assert.equal(snapshot.availableResetCount, 2);
  assert.ok(!JSON.stringify(payload).includes(KEY));
});

test('defaults use live data; credentials and endpoint are excluded from widget parameters', () => {
  const { api, settings } = harness();
  assert.equal(settings.scenario, 'live');
  assert.equal(settings.refreshSeconds, 600);
  assert.equal(settings.window, 'auto');
  const safe = api.readSettings(JSON.stringify({ apiKey: KEY, endpoint: 'https://other.test', theme: 'dark' }));
  assert.equal(safe.apiKey, undefined);
  assert.equal(safe.endpoint, undefined);
  assert.equal(safe.refreshMinutes, undefined);
});

test('refresh seconds persist locally, override old parameters and stay out of script links', () => {
  const h = harness();
  const connection = h.keys.get('CodexUsage.connection.v1');
  assert.equal(h.api.saveRefreshSeconds(' 30 '), 30);
  assert.equal(h.api.readRefreshSeconds(), 30);
  assert.equal(JSON.parse(h.keys.get('CodexUsage.preferences.v1')).refreshSeconds, 30);
  const settings = h.api.readSettings('{"refreshMinutes":1,"refreshSeconds":99,"openURL":"myapp://"}');
  assert.equal(settings.refreshSeconds, 30);
  assert.equal(settings.refreshMinutes, undefined);
  assert.equal(h.api.readSettings('chatgpt://').refreshSeconds, 30);
  for (const action of [undefined, 'update', 'refresh']) {
    const url = new URL(h.api.scriptURL(settings, 'medium', action));
    const parameter = JSON.parse(url.searchParams.get('parameter'));
    assert.equal(parameter.refreshSeconds, undefined);
    assert.equal(parameter.refreshMinutes, undefined);
    assert.equal(parameter.openURL, 'myapp://');
    h.api.saveRefreshSeconds(15);
    assert.equal(h.api.readSettings(url.searchParams.get('parameter')).refreshSeconds, 15);
  }
  assert.equal(h.keys.get('CodexUsage.connection.v1'), connection);
});

test('local refresh values validate integer seconds and preserve settings on invalid input', () => {
  const h = harness();
  for (const value of [1, 30, 600, 86400]) {
    h.api.saveRefreshSeconds(value);
    assert.equal(h.api.readRefreshSeconds(), value);
  }
  h.api.saveRefreshSeconds(30);
  for (const value of ['', ' ', '0', '-1', '0.5', '1e3', 'NaN', 86401, null]) {
    assert.throws(() => h.api.saveRefreshSeconds(value), /整数秒/);
    assert.equal(h.api.readRefreshSeconds(), 30);
  }
  h.keys.set('CodexUsage.preferences.v1', '{broken');
  assert.equal(h.api.readRefreshSeconds(), 600);
  h.keys.set('CodexUsage.preferences.v1', '{"refreshSeconds":0}');
  assert.equal(h.api.readRefreshSeconds(), 600);
  const locked = harness({ keychainFails: true });
  assert.equal(locked.api.readRefreshSeconds(), 600);
  assert.throws(() => locked.api.saveRefreshSeconds(30), /未能保存/);
});

test('refresh settings form retries invalid input, and cancel preserves the saved interval', async () => {
  const h = harness({ alertSteps: [{ choice: 0, values: ['0'] }, { choice: 0 }, { choice: 0, values: ['30'] }, { choice: -1 }] });
  assert.equal(await h.api.configureRefresh(), true);
  assert.equal(h.api.readRefreshSeconds(), 30);
  assert.equal(h.messages[0].fields[0].value, '600');
  assert.match(h.messages[1].message, /整数秒/);
  assert.equal(await h.api.configureRefresh(), false);
  assert.equal(h.messages.at(-1).fields[0].value, '30');
  assert.equal(h.api.readRefreshSeconds(), 30);
  assert.equal(h.calls.length, 0);
});

test('refresh menu saves seconds then forces exactly one request with the new interval', async () => {
  const h = harness({ responses: [{}, {}], alertSteps: [{ choice: 5 }, { choice: 0, values: ['30'] }] });
  await h.api.loadUsage(h.settings);
  let rendered, presented = 0;
  h.api.setRenderer((snapshot, settings) => {
    rendered = { snapshot, settings };
    return { presentMedium: async () => { presented++; } };
  });
  await h.api.main();
  assert.equal(h.calls.length, 2, 'save must bypass the previously fresh 600-second cache once');
  assert.equal(h.calls[1].url, PROFILE.endpoint + '?refresh=1');
  assert.match(h.menus[0].actions[5], /600 秒/);
  assert.equal(rendered.settings.refreshSeconds, 30);
  assert.equal(presented, 1);
});

test('cancel from refresh menu does not read the API or change local settings', async () => {
  const h = harness({ alertSteps: [{ choice: 5 }, { choice: -1 }] });
  h.api.saveRefreshSeconds(15);
  await h.api.main();
  assert.match(h.menus[0].message, /15 秒/);
  assert.equal(h.api.readRefreshSeconds(), 15);
  assert.equal(h.calls.length, 0);
  assert.equal(h.widgets.length, 0);
});

test('URL parameters configure arbitrary app taps and survive encoded update links', () => {
  const { api, settings } = harness();
  assert.equal(settings.openURL, '');
  const cases = [
    ['chatgpt://', 'chatgpt://'],
    ['  myapp://  ', 'myapp://'],
    ['Demo.App+test://item/123?name=hello%20world&next=a%2Bb#details', 'Demo.App+test://item/123?name=hello%20world&next=a%2Bb#details'],
    ['https://example.test/path?q=a%26b#section', 'https://example.test/path?q=a%26b#section'],
    ['mailto:user@example.test', 'mailto:user@example.test'],
    ['{"openURL":"  myapp://item?id=123  ","theme":"dark"}', 'myapp://item?id=123'],
  ];
  for (const [parameter, target] of cases) {
    const parsed = api.readSettings(parameter);
    assert.equal(parsed.openURL, target);
    assert.equal(parsed.scenario, 'live');
    assert.equal(api.widgetTapURL(parsed, 'small'), target);
    const update = new URL(api.scriptURL(parsed, 'medium', 'update'));
    assert.equal(update.protocol, 'scriptable:');
    assert.equal(update.searchParams.get('action'), 'update');
    const restored = api.readSettings(update.searchParams.get('parameter'));
    assert.equal(api.widgetTapURL(restored, 'medium'), target);
  }
  assert.match(api.widgetTapURL(settings, 'small'), /^scriptable:/);
  assert.equal(api.readSettings('{"openURL":"myapp://","theme":"dark"}').theme, 'dark');
  assert.match(api.widgetTapURL(api.readSettings('{"openURL":"  "}'), 'small'), /^scriptable:/);
  assert.equal(api.readSettings('{"tapAction":"chatgpt"}').openURL, '');
});

test('app names and malformed URL parameters give useful validation errors', () => {
  const { api } = harness();
  for (const value of ['ChatGPT', 'SomeApp', 'example.test', '{broken']) {
    assert.throws(() => api.readSettings(value), /完整的应用跳转链接/);
  }
  for (const value of ['myapp:', 'myapp://hello world', 'myapp://bad\npath', 'myapp://bad\u0000path', '1app://', '//example.test', 'ChatGPT', 123, null]) {
    assert.throws(() => api.readSettings(JSON.stringify({ openURL: value })), /openURL/);
  }
  for (const value of ['null', '[]', '"myapp://"']) assert.throws(() => api.readSettings(value), /JSON 对象/);
});

test('reset countdown rounds days and uses hours plus minutes below 24 hours', () => {
  const { api } = harness();
  const day = 86400000;
  for (const [remaining, label] of [
    [6 * day + 4 * 3600000, '6天'],
    [6.5 * day - 1, '6天'], [6.5 * day, '7天'], [7 * day - 1, '7天'],
    [day, '1天'], [day - 1, '24小时0分钟'],
    [23 * 3600000 + 59 * 60000, '23小时59分钟'],
    [2 * 3600000 + 18 * 60000, '2小时18分钟'], [3600000, '1小时0分钟'],
    [5 * 60000, '0小时5分钟'], [30000, '0小时1分钟'], [1, '0小时0分钟'],
  ]) assert.equal(api.resetLabel(new Date(NOW + remaining).toISOString(), NOW), 'Resets in ' + label);
  assert.equal(api.resetLabel(new Date(NOW).toISOString(), NOW), '重置时间已到 · 待刷新');
  assert.equal(api.resetLabel(null, NOW), '重置时间未知');
});

test('equivalent UTC and Beijing reset timestamps yield the same countdown and local clock', () => {
  const { api } = harness();
  const utc = '2026-10-29T17:19:24.000Z', beijing = '2026-10-30T01:19:24+08:00';
  const reference = Date.parse('2026-10-24T00:36:07+08:00');
  assert.equal(api.resetLabel(utc, reference), 'Resets in 6天');
  assert.equal(api.resetLabel(beijing, reference), 'Resets in 6天');
  assert.equal(api.beijingTime(utc, false), '10/30 01:19');
});

test('primary can be weekly; Unix reset seconds and optional metadata are mapped', () => {
  const { api, settings } = harness();
  const payload = api.cleanPayload(fixture());
  const snapshot = api.snapshotFrom(payload, settings);
  assert.equal(snapshot.windows.length, 1);
  assert.equal(snapshot.windows[0].label, 'Weekly');
  assert.equal(snapshot.windows[0].remainingPercent, 12);
  assert.equal(snapshot.windows[0].resetsAt, '2026-10-29T17:19:24.000Z');
  assert.equal(snapshot.availableResetCount, 2);
  assert.equal(api.chooseWindows(snapshot.windows, 'auto', false)[0].label, 'Weekly');
  assert.equal(api.chooseWindows(snapshot.windows, 'session', false).length, 0);
});

test('selects requested bucket and duration, never substitutes another model bucket', () => {
  const { api, settings } = harness();
  const body = fixture();
  const weekly = body.limits[0].primary;
  body.limits[0].primary = { remainingPercent: 76, windowDurationMins: 300 };
  body.limits[0].secondary = weekly;
  body.limits.unshift({ limitId: 'other', primary: { remainingPercent: 99, windowDurationMins: 10080 } });
  const data = api.cleanPayload(body);
  const snapshot = api.snapshotFrom(data, settings);
  assert.equal(api.chooseWindows(snapshot.windows, 'auto', false)[0].remainingPercent, 12);
  assert.equal(api.chooseWindows(snapshot.windows, 'session', false)[0].label, '5-hour');
  assert.equal(api.chooseWindows(snapshot.windows, 'primary', false)[0].remainingPercent, 76);
  assert.equal(api.chooseWindows(snapshot.windows, 'auto', true).length, 2);
  assert.equal(api.snapshotFrom(data, { ...settings, limitId: 'missing' }).windows.length, 0);
});

test('unknown percentages remain unknown; 0 is valid; used percentage fallback is clamped', () => {
  const { api } = harness();
  for (const [row, expected] of [[{ remainingPercent: null, usedPercent: null }, null], [{ remainingPercent: 0 }, 0], [{ usedPercent: 101 }, 0], [{ usedPercent: -1 }, 100], [{ usedPercent: 88 }, 12]]) {
    const body = fixture(); body.limits[0].primary = row;
    assert.equal(api.cleanPayload(body).limits[0].primary.remainingPercent, expected);
  }
  const bad = fixture(); bad.limits[0].primary.remainingPercent = '12';
  assert.throws(() => api.cleanPayload(bad), /格式/);
  assert.throws(() => api.cleanPayload({ ...fixture(), fetchedAt: 'invalid' }), /格式/);
  assert.throws(() => api.cleanPayload({ ...fixture(), fetchedAt: new Date(NOW + 120000).toISOString() }), /格式/);
});

test('unauthenticated setup and explicit demos never request live data', async () => {
  const h = harness({ configured: false });
  assert.equal((await h.api.loadUsage(h.settings)).status, 'empty');
  assert.equal((await h.api.loadUsage({ ...h.settings, scenario: 'demo' })).isDemo, true);
  assert.equal(h.calls.length, 0);
  assert.equal((await harness({ keychainFails: true }).api.loadUsage(h.settings)).errorCode, 'KEYCHAIN');
});

test('Bearer request, 10-minute cache, force refresh and credential-free disk cache', async () => {
  const h = harness({ responses: [{}, {}, {}] });
  const first = await h.api.loadUsage(h.settings);
  assert.equal(first.updatedAt, fixture().fetchedAt);
  assert.equal(first.cacheWarning, false);
  assert.equal(h.calls[0].headers.Authorization, 'Bearer ' + KEY);
  assert.equal(h.calls[0].timeoutInterval, 20);
  h.setNow(NOW + 9 * 60000);
  await h.api.loadUsage(h.settings);
  assert.equal(h.calls.length, 1);
  await h.api.loadUsage(h.settings, { force: true });
  assert.equal(h.calls[1].url, PROFILE.endpoint + '?refresh=1');
  h.setNow(NOW + 10 * 60000);
  await h.api.loadUsage(h.settings);
  assert.equal(h.calls.length, 3, 'old upstream timestamp must not be disguised by a recent local receipt');
  assert.ok([...h.files.values()].every(value => !value.includes(KEY) && !value.includes('Authorization')));
});

test('local second intervals govern the cache boundary and stale threshold', async () => {
  for (const seconds of [1, 30, 120]) {
    const h = harness({ responses: [{}, {}] });
    h.api.saveRefreshSeconds(seconds);
    const settings = h.api.readSettings('');
    await h.api.loadUsage(settings);
    h.setNow(NOW + seconds * 1000 - 1);
    await h.api.loadUsage(settings);
    assert.equal(h.calls.length, 1);
    h.setNow(NOW + seconds * 1000);
    await h.api.loadUsage(settings);
    assert.equal(h.calls.length, 2);
  }
  const { api } = harness();
  const snapshot = { status: 'ready', updatedAt: new Date(NOW).toISOString() };
  for (const [seconds, staleAfter] of [[30, 1800000], [3600, 10800000]]) {
    const settings = { ...api.readSettings(''), refreshSeconds: seconds };
    assert.equal(api.effectiveStatus(snapshot, settings, NOW + staleAfter - 1), 'ready');
    assert.equal(api.effectiveStatus(snapshot, settings, NOW + staleAfter), 'stale');
  }
});

test('expired data is marked stale; failed requests retain the original successful timestamp', async () => {
  const h = harness({ responses: [{}, { status: 503, body: { ok: false } }, {}] });
  await h.api.loadUsage(h.settings);
  h.setNow(NOW + 10 * 60000);
  const stale = await h.api.loadUsage(h.settings);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.updatedAt, fixture().fetchedAt);
  assert.equal(stale.windows[0].remainingPercent, 12);
  assert.match(h.api.footerLabel(stale, 'stale', false), /服务异常/);
  await h.api.loadUsage(h.settings);
  assert.equal(h.calls.length, 2, 'failure cooldown avoids repeated requests');
  const restored = await h.api.loadUsage(h.settings, { force: true });
  assert.equal(restored.errorCode, undefined);
  assert.equal(h.api.effectiveStatus(restored, h.settings, NOW + 30 * 60000), 'stale');
});

for (const [name, response, code] of [
  ['401', { status: 401, error: KEY }, 'AUTH'],
  ['timeout', { status: 0, error: KEY }, 'NETWORK'],
  ['connection refused', { status: 0, error: 'Could not connect to the server. ' + KEY }, 'CONNECT'],
  ['system connection error', { status: 0, error: 'NSURLErrorDomain Code=-1004 ' + KEY }, 'CONNECT'],
  ['request timed out', { status: 0, error: 'The request timed out. ' + KEY }, 'TIMEOUT'],
  ['Chinese timeout', { status: 0, error: '请求超时 ' + KEY }, 'TIMEOUT'],
  ['DNS lookup failure', { status: 0, error: 'A server with the specified hostname could not be found. ' + KEY }, 'DNS'],
  ['malformed JSON', { raw: '<html>proxy error</html>' }, 'FORMAT'],
  ['wrong payload', { body: { ok: true } }, 'FORMAT'],
  ['API failure in HTTP 200', { body: { ok: false, error: { code: 'CODEX_TIMEOUT', message: KEY } } }, 'SERVER'],
  ['redirect', { redirect: true, status: 302 }, 'REDIRECT'],
]) test(name + ' produces a safe error, never a demo or leaked response body', async () => {
  const h = harness({ responses: [response] });
  const result = await h.api.loadUsage(h.settings);
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, code);
  assert.equal(result.updatedAt, null);
  assert.equal(result.isDemo, undefined);
  assert.ok(!JSON.stringify(result).includes(KEY));
  assert.ok([...h.files.values()].every(value => !value.includes(KEY)));
});

test('network failure keeps old quota, reports the cause and preserves it during cooldown', async () => {
  const h = harness({ responses: [{}, { status: 0, error: 'ECONNREFUSED ' + KEY }] });
  await h.api.loadUsage(h.settings);
  const result = await h.api.loadUsage(h.settings, { force: true });
  assert.equal(result.errorCode, 'CONNECT');
  assert.equal(result.updatedAt, fixture().fetchedAt);
  assert.equal(result.windows[0].remainingPercent, 12);
  assert.match(h.api.footerLabel(result, 'stale', false), /连接失败/);
  const cached = await h.api.loadUsage(h.settings);
  assert.equal(cached.errorCode, 'CONNECT');
  assert.equal(h.calls.length, 2);
  assert.ok([...h.files.values()].every(value => !value.includes(KEY)));
});

test('429 Retry-After is honored even by a manual refresh', async () => {
  const h = harness({ responses: [{ status: 429, headers: { 'Retry-After': '120' } }, {}] });
  const first = await h.api.loadUsage(h.settings);
  assert.equal(first.retryAt, NOW + 120000);
  h.setNow(NOW + 60000);
  await h.api.loadUsage(h.settings, { force: true });
  assert.equal(h.calls.length, 1);
  h.setNow(NOW + 120000);
  assert.equal((await h.api.loadUsage(h.settings, { force: true })).status, 'ready');
  assert.equal(h.api.retryTime({ 'retry-after': new Date(NOW + 300000).toUTCString() }, NOW), NOW + 300000);
});

test('storage failure still displays fetched values; damaged new cache preserves the older slot', async () => {
  const h = harness({ responses: [{}, { body: { ...fixture(), fetchedAt: new Date(NOW + 600000).toISOString() } }, { status: 503 }] });
  await h.api.loadUsage(h.settings);
  h.setNow(NOW + 600000);
  h.setCorruptWrites(true);
  const fresh = await h.api.loadUsage(h.settings);
  assert.equal(fresh.status, 'ready');
  assert.equal(fresh.cacheWarning, true);
  assert.match(h.api.footerLabel(fresh, 'ready', false), /未保存/);
  h.setCorruptWrites(false);
  const stale = await h.api.loadUsage(h.settings);
  assert.equal(stale.updatedAt, fixture().fetchedAt);
  assert.equal(stale.status, 'stale');
  const noDisk = harness({ noStorage: true, responses: [{}] });
  assert.equal((await noDisk.api.loadUsage(noDisk.settings)).cacheWarning, true);
});

test('changing credentials partitions cache; changing endpoint requires a newly entered key', async () => {
  const h = harness({ responses: [{}, { status: 401 }] });
  await h.api.loadUsage(h.settings);
  const original = h.api.readConnection();
  assert.equal(h.api.saveConnection(original.endpoint + '/', '', original).cacheId, original.cacheId);
  assert.throws(() => h.api.saveConnection('https://other.test/api/usage', '', original), /重新输入/);
  const changed = h.api.saveConnection(original.endpoint, 'another-test-key', original);
  assert.notEqual(changed.cacheId, original.cacheId);
  const result = await h.api.loadUsage(h.settings);
  assert.equal(result.status, 'error');
  assert.equal(result.updatedAt, null, 'never show a previous credential profile’s cached account');
  assert.throws(() => h.api.normalizeEndpoint('http://user:pass@example.test/api/usage'));
  assert.throws(() => h.api.normalizeEndpoint('http://example.test/api/usage?apiKey=test'));
});

test('unknown response fields are not persisted, and restriction survives cache normalization', () => {
  const { api, settings } = harness();
  const input = fixture();
  input.secret = KEY;
  input.limits[0].otherSecret = KEY;
  input.limits[0].rateLimitReachedType = 'limit_reached';
  const first = api.cleanPayload(input);
  const roundtrip = api.cleanPayload(JSON.parse(JSON.stringify(first)));
  assert.ok(!JSON.stringify(first).includes(KEY));
  assert.equal(api.snapshotFrom(roundtrip, settings).restricted, true);
});

const nextSource = fullSource.replace(`// version: ${currentVersion}\n`, `// version: ${nextVersion}\n`).replace(`const VERSION = "${currentVersion}";`, `const VERSION = "${nextVersion}";`);
const nextManifest = () => ({ id: 'codex-usage-widget', script: 'CodexUsage.js', version: nextVersion, sha256: createHash('sha256').update(nextSource).digest('hex') });
const updateResponses = (manifest = nextManifest(), script = nextSource) => [{ body: { sha: 'a'.repeat(40) } }, { body: manifest }, { raw: script }];

test('SHA-256 matches Node for UTF-8 and release source; updates reject corruption and invalid syntax', () => {
  const { api } = harness();
  for (const text of ['', 'abc', '中文😀', nextSource]) assert.equal(api.sha256(text), createHash('sha256').update(text).digest('hex'));
  api.validateUpdate(nextManifest(), nextSource);
  assert.throws(() => api.validateUpdate(nextManifest(), nextSource + '\n'), /校验失败/);
  assert.throws(() => api.validateUpdate({ ...nextManifest(), id: 'another-widget' }, nextSource), /清单/);
  const invalid = nextSource + '\n} syntax error';
  assert.throws(() => api.validateUpdate({ ...nextManifest(), sha256: api.sha256(invalid) }, invalid), /语法/);
  assert.equal(api.newerVersion('1.0.10', '1.0.9'), true);
  assert.equal(api.newerVersion('1.0.0', '1.0.0'), false);
  assert.equal(api.newerVersion('0.9.9', '1.0.0'), false);
});

test('update pins both files to one commit, verifies backup, and launches the new script once', async () => {
  const files = new Map([['/documents/CodexUsage.js', fullSource]]);
  const h = harness({ responses: updateResponses(), files, cloud: true });
  const connection = h.keys.get('CodexUsage.connection.v1');
  h.api.saveRefreshSeconds(30);
  const preferences = h.keys.get('CodexUsage.preferences.v1');
  const target = 'myapp://view?title=hello%20world&next=a%2Bb#details';
  await h.api.updateScript({ ...h.settings, theme: 'dark', openURL: target }, 'large');
  assert.equal(h.files.get('/documents/CodexUsage.js'), nextSource);
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.slice(1).every(call => call.url.endsWith('?ref=' + 'a'.repeat(40))));
  assert.ok(h.calls.every(call => !('Authorization' in call.headers)));
  assert.equal(h.keys.get('CodexUsage.connection.v1'), connection);
  assert.equal(h.keys.get('CodexUsage.preferences.v1'), preferences);
  assert.equal(h.launches.length, 1);
  const url = new URL(h.launches[0]);
  assert.equal(url.searchParams.get('action'), 'refresh');
  assert.equal(url.searchParams.get('family'), 'large');
  assert.equal(JSON.parse(url.searchParams.get('parameter')).theme, 'dark');
  assert.equal(JSON.parse(url.searchParams.get('parameter')).openURL, target);
  assert.equal(JSON.parse(url.searchParams.get('parameter')).refreshSeconds, undefined);
  assert.equal(url.protocol, 'scriptable:');
  assert.ok(!h.launches[0].includes(KEY));
  assert.equal(h.downloads.length, 1);
  const backup = [...h.files.entries()].find(([path]) => /backup-.*\.json$/.test(path));
  assert.equal(JSON.parse(backup[1]).source, fullSource);
  assert.ok(![...h.files.keys()].some(path => path.endsWith('.update.tmp')));
});

test('corrupt download, same version and failed replacement preserve the installed script', async () => {
  for (const variant of ['corrupt', 'current', 'write-failure']) {
    const manifest = nextManifest();
    if (variant === 'current') manifest.version = currentVersion;
    const h = harness({ files: new Map([['/documents/CodexUsage.js', fullSource]]), responses: updateResponses(manifest, variant === 'corrupt' ? nextSource + 'corrupt' : nextSource), scriptWriteFails: variant === 'write-failure' });
    await h.api.updateScript(h.settings, 'medium');
    assert.equal(h.files.get('/documents/CodexUsage.js'), fullSource);
    assert.equal(h.launches.length, 0);
    assert.match(h.messages[0].title, variant === 'current' ? /最新/ : /失败/);
  }
});

test('restore validates and recovers the previous script without changing credentials', async () => {
  const h = harness({ files: new Map([['/documents/CodexUsage.js', fullSource]]), responses: updateResponses() });
  h.api.saveRefreshSeconds(17);
  await h.api.updateScript(h.settings, 'small');
  await h.api.restoreScript(h.settings, 'small');
  assert.equal(h.files.get('/documents/CodexUsage.js'), fullSource);
  assert.equal(h.api.readConnection().apiKey, KEY);
  assert.equal(h.api.readRefreshSeconds(), 17);
  assert.equal(h.launches.length, 2);
});

test('refresh launch bypasses menus and performs exactly one forced quota read', async () => {
  const h = harness({ responses: [{}], extra: { args: { queryParameters: { action: 'refresh', family: 'large', parameter: '{"theme":"dark","scenario":"demo","openURL":"myapp://"}' } } } });
  let rendered, presented = 0;
  h.api.setRenderer((snapshot, settings, family) => {
    rendered = { snapshot, settings, family };
    return { presentLarge: async () => { presented++; } };
  });
  await h.api.main();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, PROFILE.endpoint + '?refresh=1');
  assert.equal(rendered.settings.scenario, 'live');
  assert.equal(rendered.settings.theme, 'dark');
  assert.equal(rendered.settings.openURL, 'myapp://');
  assert.equal(rendered.family, 'large');
  assert.equal(presented, 1);
});
