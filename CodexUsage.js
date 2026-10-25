// Variables used by Scriptable.
// icon-color: blue; icon-glyph: chart-bar;
// CODEX_USAGE_WIDGET
// version: 1.0.5
// Codex Usage
// 独立脚本：全部复制到 Scriptable，命名为 CodexUsage。
// 首次运行设置 API Key。密钥仅保存到 Scriptable Keychain，不要写入脚本或组件参数。

const VERSION = "1.0.5";
const REPOSITORY = "awesomehy/scriptable-codex-usage";
const CONNECTION_KEY = "CodexUsage.connection.v1";
const PREFERENCES_KEY = "CodexUsage.preferences.v1";
const DEFAULT_REFRESH_SECONDS = 600;
const DEFAULTS = { theme: "light", scenario: "live", window: "auto", limitId: "codex", openURL: "" };
const FETCH_ERROR_CODES = ["AUTH", "NETWORK", "CONNECT", "TIMEOUT", "DNS", "FORMAT", "SERVER", "REDIRECT", "RATE"];
const DEMO_NOW = Date.parse("2026-10-24T15:58:00Z");
const FAMILIES = ["small", "medium", "large"];
const LAYOUTS = { original: "原版浅色", dark: "简洁深色", gradient: "渐变卡片", dashboard: "仪表盘" };

function readSettings(parameter) {
  const value = typeof parameter === "string" ? parameter.trim() : parameter;
  let input;
  if (value == null || value === "") input = {};
  else if (typeof value === "string" && /^[a-z][a-z0-9+.-]*:/i.test(value)) input = { openURL: value };
  else {
    try { input = JSON.parse(value); }
    catch (_) { throw new Error("Parameter 请填写完整的应用跳转链接（如 myapp://），或 JSON 对象。"); }
  }
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("Parameter 请填写 JSON 对象。");
  // 只传递允许的组件参数，不从连接设置读取接口地址或凭据。
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (Object.prototype.hasOwnProperty.call(input, key)) settings[key] = input[key];
  if (!["light", "dark", "auto"].includes(settings.theme)) throw new Error("theme 支持 light、dark、auto。");
  if (!["live", "demo", "empty", "stale", "error"].includes(settings.scenario)) throw new Error("scenario 支持 live、demo、empty、stale、error。");
  if (!["auto", "weekly", "session", "primary", "secondary"].includes(settings.window)) throw new Error("window 支持 auto、weekly、session、primary、secondary。");
  if (typeof settings.openURL !== "string") throw new Error("openURL 请填写完整的应用跳转链接，或留空。");
  settings.openURL = settings.openURL.trim();
  if (settings.openURL && !/^[a-z][a-z0-9+.-]*:[^\s\u0000-\u001f\u007f]+$/i.test(settings.openURL)) {
    throw new Error("openURL 需要完整的 URL Scheme（如 myapp://），链接内的空格请写成 %20。");
  }
  if (typeof settings.limitId !== "string" || !/^[a-zA-Z0-9_.-]{1,80}$/.test(settings.limitId)) throw new Error("limitId 请填写接口中的额度标识。");
  if (input.layout !== undefined && (typeof input.layout !== "string" || !Object.prototype.hasOwnProperty.call(LAYOUTS, input.layout))) throw new Error("layout 支持 original、dark、gradient、dashboard。");
  return { ...settings, refreshSeconds: readRefreshSeconds(), layout: input.layout ?? readLayout(), layoutOverride: input.layout ?? null };
}

function readPreferences() {
  try {
    const value = Keychain.contains(PREFERENCES_KEY) ? JSON.parse(Keychain.get(PREFERENCES_KEY)) : {};
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch (_) { /* 首次运行或设置损坏时使用默认值。 */ }
  return {};
}

function savePreference(key, value) {
  // 合并保存，切换外观不会覆盖刷新秒数，修改刷新秒数也不会清除外观。
  Keychain.set(PREFERENCES_KEY, JSON.stringify({ ...readPreferences(), [key]: value }));
}

function readLayout() {
  const layout = readPreferences().layout;
  return typeof layout === "string" && Object.prototype.hasOwnProperty.call(LAYOUTS, layout) ? layout : "original";
}

function saveLayout(layout) {
  if (typeof layout !== "string" || !Object.prototype.hasOwnProperty.call(LAYOUTS, layout)) throw new Error("无效的外观布局。");
  try { savePreference("layout", layout); }
  catch (_) { throw new Error("外观布局未能保存到本机，请重试。"); }
}

async function configureLayout() {
  const menu = new Alert();
  menu.title = "外观布局";
  menu.message = "保存到本机，所有尺寸共用。单个组件可用 Parameter 的 layout 字段覆盖。";
  const layouts = Object.keys(LAYOUTS), current = readLayout();
  layouts.forEach(id => menu.addAction((id === current ? "✓ " : "") + LAYOUTS[id]));
  menu.addCancelAction("取消");
  const index = await menu.presentSheet();
  if (index < 0 || !layouts[index]) return null;
  try { saveLayout(layouts[index]); return layouts[index]; }
  catch (error) { await showMessage("设置未保存", error.message); return null; }
}

function validRefreshSeconds(value) {
  return Number.isInteger(value) && value >= 1 && value <= 86400;
}

function readRefreshSeconds() {
  const value = readPreferences();
  if (validRefreshSeconds(value.refreshSeconds)) return value.refreshSeconds;
  return DEFAULT_REFRESH_SECONDS;
}

function saveRefreshSeconds(value) {
  const text = String(value).trim(), seconds = Number(text);
  if (!/^\d+$/.test(text) || !validRefreshSeconds(seconds)) throw new Error("请填写 1–86400 之间的整数秒。");
  try { savePreference("refreshSeconds", seconds); }
  catch (_) { throw new Error("刷新间隔未能保存到本机，请重试。"); }
  return seconds;
}

function demoUsage(settings) {
  if (settings.scenario === "empty") {
    return { isDemo: false, status: "empty", updatedAt: null, windows: [] };
  }
  if (settings.scenario === "error") {
    return { isDemo: true, status: "error", updatedAt: null, windows: [] };
  }
  const stale = settings.scenario === "stale";
  return {
    isDemo: true,
    status: stale ? "stale" : "ready",
    updatedAt: new Date(DEMO_NOW - (stale ? 2 * 3600000 : 0)).toISOString(),
    windows: [
      { id: "weekly", slot: "primary", windowDurationMins: 10080, label: "Weekly", remainingPercent: 29, resetsAt: new Date(DEMO_NOW + 6 * 86400000).toISOString() },
      { id: "session", slot: "secondary", windowDurationMins: 300, label: "5-hour", remainingPercent: 76, resetsAt: new Date(DEMO_NOW + 138 * 60000).toISOString() },
    ],
  };
}

function sha256(text) {
  const bytes = [];
  for (const char of text) {
    const c = char.codePointAt(0);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else if (c < 65536) bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    else bytes.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  const byteLength = bytes.length;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLength = byteLength * 8;
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLength >>> (i * 8)) & 255);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (n, b) => (n >>> b) | (n << (32 - b));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = [];
    for (let i = 0; i < 16; i++) w[i] = (bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16) | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (j + sum1 + choice + k[i] + w[i]) | 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      j = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + sum0 + majority) | 0;
    }
    [a,b,c,d,e,f,g,j].forEach((value, i) => { h[i] = (h[i] + value) | 0; });
  }
  return h.map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
}


function usageError(code) {
  const messages = {
    AUTH: "API Key 无效，请重新设置", NETWORK: "网络连接失败，请检查网络", FORMAT: "接口返回格式不正确",
    CONNECT: "无法连接 API 服务，请检查服务是否启动及端口是否开放", TIMEOUT: "接口请求超时，请检查服务和网络", DNS: "接口域名解析失败，请检查地址和 DNS",
    SERVER: "服务端读取额度失败", REDIRECT: "接口发生重定向，请更新地址", RATE: "请求过多，请稍后刷新",
    CONFIG: "请先打开脚本设置接口", KEYCHAIN: "无法读取钥匙串，请打开脚本设置",
  };
  const error = new Error(messages[code] || messages.SERVER);
  error.code = code;
  return error;
}

function compactError(code) {
  return { AUTH: "API Key 无效", NETWORK: "网络连接失败", CONNECT: "无法连接 API 服务", TIMEOUT: "接口请求超时", DNS: "接口域名解析失败", FORMAT: "接口格式错误", SERVER: "服务端读取失败", REDIRECT: "请修改接口地址", RATE: "请求过多，稍后重试", KEYCHAIN: "请重新设置接口" }[code] || "暂时无法读取额度";
}

function networkErrorCode(error) {
  // 只分类系统错误，不显示或保存可能含接口地址的原始错误正文。
  const message = String(error?.message || error || "");
  if (/\b(?:ETIMEDOUT|ESOCKETTIMEDOUT)\b|timed?\s*out|timeout|超时|逾時|(?:Code\s*=\s*|\b)-1001\b/i.test(message)) return "TIMEOUT";
  if (/\b(?:ENOTFOUND|EAI_AGAIN)\b|hostname.*(?:not.*found|resolve)|could not find.*host|DNS|域名.*解析|找不到.*(?:主机|主機)|(?:Code\s*=\s*|\b)-100[36]\b/i.test(message)) return "DNS";
  if (/\b(?:ECONNREFUSED|EHOSTUNREACH|ENETUNREACH)\b|refused|could not connect|cannot connect|unable to connect|无法连接.*服务器|無法連接.*伺服器|(?:Code\s*=\s*|\b)-1004\b/i.test(message)) return "CONNECT";
  return "NETWORK";
}

function normalizeEndpoint(value) {
  // Scriptable 不依赖浏览器 URL API；不接受含凭据、查询参数或片段的地址。
  if (typeof value !== "string") throw new Error("请填写完整的 HTTP 或 HTTPS 接口地址。");
  const endpoint = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(endpoint)) {
    throw new Error("接口地址不能包含密钥、查询参数或 #。请填写 /api/usage 地址。");
  }
  return endpoint;
}

function readConnection() {
  try {
    if (!Keychain.contains(CONNECTION_KEY)) return null;
    const value = JSON.parse(Keychain.get(CONNECTION_KEY));
    if (!value || typeof value.apiKey !== "string" || !value.apiKey.trim() || /[\r\n]/.test(value.apiKey) || !/^[a-zA-Z0-9-]{8,80}$/.test(value.cacheId)) throw usageError("KEYCHAIN");
    return { endpoint: normalizeEndpoint(value.endpoint), apiKey: value.apiKey, cacheId: value.cacheId };
  } catch (_) { throw usageError("KEYCHAIN"); }
}

function saveConnection(endpoint, apiKey, previous) {
  endpoint = normalizeEndpoint(endpoint);
  apiKey = apiKey.trim();
  if (!apiKey && previous?.endpoint === endpoint) apiKey = previous.apiKey;
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error("请输入有效的 API Key；更换地址时需要重新输入。");
  const unchanged = previous?.endpoint === endpoint && previous?.apiKey === apiKey;
  const connection = { endpoint, apiKey, cacheId: unchanged ? previous.cacheId : UUID.string() };
  try { Keychain.set(CONNECTION_KEY, JSON.stringify(connection)); }
  catch (_) { throw new Error("API Key 未能保存到钥匙串，请重试。"); }
  return connection;
}

function nullableNumber(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nullableBoolean(value) { return typeof value === "boolean" ? value : null; }
function periodLabel(minutes, slot) {
  if (minutes === 10080) return "Weekly";
  if (minutes === 1440) return "Daily";
  if (minutes === 60) return "Hourly";
  if (minutes > 0) return minutes % 1440 === 0 ? (minutes / 1440) + "-day" : minutes % 60 === 0 ? (minutes / 60) + "-hour" : minutes + "-min";
  return slot === "primary" ? "Primary" : "Secondary";
}

// 校验并仅保留展示所需的字段；不缓存任意服务端字段或错误正文。
function cleanPayload(body, now = Date.now()) {
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const fetched = timestamp(body?.fetchedAt);
  if (!object(body) || body.ok !== true || fetched === null || fetched > now + 60000 || !Array.isArray(body.limits) || body.limits.length > 50) throw usageError("FORMAT");
  const ids = new Set();
  const limits = body.limits.map(limit => {
    if (!object(limit) || typeof limit.limitId !== "string" || !/^[a-zA-Z0-9_.-]{1,80}$/.test(limit.limitId) || ids.has(limit.limitId)) throw usageError("FORMAT");
    ids.add(limit.limitId);
    const result = {
      limitId: limit.limitId,
      planType: typeof limit.planType === "string" ? limit.planType.slice(0, 40) : null,
      spendControlReached: nullableBoolean(limit.spendControlReached),
      rateLimitReached: limit.rateLimitReached === true || limit.rateLimitReachedType != null,
    };
    for (const slot of ["primary", "secondary"]) {
      const row = limit[slot];
      if (row == null) { result[slot] = null; continue; }
      if (!object(row)) throw usageError("FORMAT");
      for (const key of ["remainingPercent", "usedPercent", "windowDurationMins"]) {
        if (row[key] != null && nullableNumber(row[key]) === null) throw usageError("FORMAT");
      }
      let remaining = nullableNumber(row.remainingPercent);
      const used = nullableNumber(row.usedPercent);
      if (remaining === null && used !== null) remaining = Math.min(100, Math.max(0, 100 - used));
      if (remaining !== null && percentValue(remaining) === null) throw usageError("FORMAT");
      const duration = nullableNumber(row.windowDurationMins);
      if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) throw usageError("FORMAT");
      let reset = timestamp(row.resetsAtIso);
      if (reset === null && nullableNumber(row.resetsAt) !== null) {
        const ms = row.resetsAt * 1000;
        if (ms > 0 && ms <= 8640000000000000) reset = ms;
      }
      result[slot] = { remainingPercent: remaining, windowDurationMins: duration, resetsAtIso: reset === null ? null : new Date(reset).toISOString() };
    }
    return result;
  });
  return {
    ok: true, fetchedAt: new Date(fetched).toISOString(), limits,
    ordinaryUsageAllowed: nullableBoolean(body.ordinaryUsageAllowed),
    availableResetCount: Number.isInteger(body.availableResetCount) && body.availableResetCount >= 0 ? body.availableResetCount : null,
  };
}

function snapshotFrom(payload, settings) {
  const limit = payload.limits.find(row => row.limitId === settings.limitId);
  const windows = [];
  for (const slot of ["primary", "secondary"]) {
    const row = limit?.[slot];
    if (row) windows.push({ id: slot, slot, windowDurationMins: row.windowDurationMins, label: periodLabel(row.windowDurationMins, slot), remainingPercent: row.remainingPercent, resetsAt: row.resetsAtIso });
  }
  return {
    isDemo: false, status: "ready", updatedAt: payload.fetchedAt, windows,
    planType: limit?.planType || null, availableResetCount: payload.availableResetCount,
    restricted: payload.ordinaryUsageAllowed === false || limit?.spendControlReached === true || limit?.rateLimitReached === true,
  };
}

function chooseWindows(windows, preference, large) {
  const weekly = windows.find(row => row.windowDurationMins === 10080);
  const session = windows.filter(row => row.windowDurationMins > 0 && row.windowDurationMins < 10080).sort((a, b) => a.windowDurationMins - b.windowDurationMins)[0];
  const selected = preference === "auto" ? weekly || windows[0] : preference === "weekly" ? weekly : preference === "session" ? session : windows.find(row => row.slot === preference);
  if (large) return [...(weekly ? [weekly] : []), ...windows.filter(row => row !== weekly)].slice(0, 2);
  return selected ? [selected] : [];
}

// 两个交替写入的本地文件：写入中断时，仍能读取另一份有效快照；不调用 move()。
function cacheStore(connection) {
  const fm = FileManager.local();
  const folder = fm.joinPath(fm.documentsDirectory(), "CodexUsageWidget");
  if (!fm.fileExists(folder)) fm.createDirectory(folder, true);
  return { fm, paths: [0, 1].map(index => fm.joinPath(folder, "usage-" + connection.cacheId + "-" + index + ".json")) };
}

function readCache(store, now) {
  if (!store) return null;
  const entries = [];
  for (let slot = 0; slot < store.paths.length; slot++) {
    try {
      if (!store.fm.fileExists(store.paths[slot])) continue;
      const entry = JSON.parse(store.fm.readString(store.paths[slot]));
      if (entry.version !== 1 || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || nullableNumber(entry.receivedAt) === null || entry.receivedAt < 0 || entry.receivedAt > now + 60000) continue;
      entry.payload = entry.payload ? cleanPayload(entry.payload, now) : null;
      entry.errorCode = FETCH_ERROR_CODES.includes(entry.errorCode) ? entry.errorCode : null;
      entry.retryAt = nullableNumber(entry.retryAt) || 0;
      entries.push({ ...entry, slot });
    } catch (_) { /* 损坏的文件不覆盖另一份有效缓存。 */ }
  }
  return entries.sort((a, b) => b.revision - a.revision)[0] || null;
}

function writeCache(store, previous, entry) {
  if (!store) return false;
  try {
    const slot = previous ? 1 - previous.slot : 0;
    const value = JSON.stringify({ ...entry, version: 1, revision: (previous?.revision || 0) + 1 });
    store.fm.writeString(store.paths[slot], value);
    return store.fm.readString(store.paths[slot]) === value;
  } catch (_) { return false; }
}

function retryTime(headers, now) {
  const key = Object.keys(headers || {}).find(name => name.toLowerCase() === "retry-after");
  const value = key ? String(headers[key]).trim() : "";
  const at = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(at) && at > now ? at : now + 60000;
}

async function fetchUsage(connection, force) {
  const request = new Request(connection.endpoint + (force ? "?refresh=1" : ""));
  request.method = "GET";
  request.headers = { Authorization: "Bearer " + connection.apiKey, Accept: "application/json" };
  request.timeoutInterval = 20;
  let redirected = false;
  request.onRedirect = () => { redirected = true; return null; };
  let raw, failure;
  try { raw = await request.loadString(); } catch (error) { failure = error; }
  const status = request.response?.statusCode;
  if (redirected || (status >= 300 && status < 400)) throw usageError("REDIRECT");
  if (status === 401 || status === 403) throw usageError("AUTH");
  if (status === 429) {
    const error = usageError("RATE");
    error.retryAt = retryTime(request.response.headers, Date.now());
    throw error;
  }
  if (status >= 400) throw usageError("SERVER");
  if (failure || !status) throw usageError(networkErrorCode(failure));
  if (typeof raw !== "string" || raw.length > 500000) throw usageError("FORMAT");
  let body;
  try { body = JSON.parse(raw); } catch (_) { throw usageError("FORMAT"); }
  if (body?.ok === false) throw usageError(body.error?.code === "UNAUTHORIZED" ? "AUTH" : "SERVER");
  return cleanPayload(body);
}

async function loadUsage(settings, options = {}) {
  if (settings.scenario !== "live") return demoUsage(settings);
  let connection;
  try { connection = readConnection(); }
  catch (error) { return { status: "error", updatedAt: null, windows: [], errorCode: error.code }; }
  if (!connection) return { status: "empty", updatedAt: null, windows: [] };
  const now = Date.now();
  let store;
  try { store = cacheStore(connection); } catch (_) { store = null; }
  const cache = readCache(store, now);
  const oldSnapshot = cache?.payload ? snapshotFrom(cache.payload, settings) : null;
  const withError = (code, retryAt) => ({ ...(oldSnapshot || { updatedAt: null, windows: [] }), status: oldSnapshot ? "stale" : "error", errorCode: code, retryAt });
  if (cache?.errorCode && cache.retryAt > now && (!options.force || cache.errorCode === "RATE")) return withError(cache.errorCode, cache.retryAt);
  const interval = settings.refreshSeconds * 1000;
  if (!options.force && cache?.payload && !cache.errorCode && now >= cache.receivedAt && now - cache.receivedAt < interval && now - timestamp(cache.payload.fetchedAt) < interval) return oldSnapshot;
  try {
    const payload = await fetchUsage(connection, options.force === true);
    const receivedAt = Date.now();
    const saved = writeCache(store, cache, { payload, receivedAt, errorCode: null, retryAt: 0 });
    return { ...snapshotFrom(payload, settings), cacheWarning: !saved };
  } catch (error) {
    const code = FETCH_ERROR_CODES.includes(error.code) ? error.code : "NETWORK";
    const retryAt = error.retryAt || Date.now() + 60000;
    const saved = writeCache(store, cache, { payload: cache?.payload || null, receivedAt: cache?.receivedAt || now, errorCode: code, retryAt });
    return { ...withError(code, retryAt), cacheWarning: !saved };
  }
}

function scriptURL(settings, family, action) {
  const parsed = readSettings(JSON.stringify(settings));
  // 刷新间隔只从本机设置读取，不放入点击、更新或恢复链接。
  const safe = {};
  for (const key of Object.keys(DEFAULTS)) safe[key] = parsed[key];
  if (settings.layoutOverride != null) safe.layout = parsed.layout;
  let url = "scriptable:///run?scriptName=" + encodeURIComponent(Script.name()) + "&parameter=" + encodeURIComponent(JSON.stringify(safe));
  if (FAMILIES.includes(family)) url += "&family=" + family;
  if (action) url += "&action=" + encodeURIComponent(action);
  return url;
}

function widgetTapURL(settings, family) {
  return settings.openURL || scriptURL(settings, family);
}

async function showMessage(title, message) {
  const alert = new Alert();
  alert.title = title; alert.message = message;
  alert.addAction("好");
  await alert.presentAlert();
}

function newerVersion(candidate, current) {
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(candidate || "")) throw new Error("更新版本号无效。");
  const a = candidate.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function validateManifest(manifest) {
  if (!manifest || manifest.id !== "codex-usage-widget" || manifest.script !== "CodexUsage.js" || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(manifest.version || "") || !/^[a-f0-9]{64}$/.test(manifest.sha256 || "")) throw new Error("更新清单无效。");
}

function validateUpdate(manifest, source) {
  validateManifest(manifest);
  if (typeof source !== "string" || !source.startsWith("// Variables used by Scriptable.\n") || !source.includes("// CODEX_USAGE_WIDGET\n") || !source.includes("// version: " + manifest.version + "\n") || !source.includes('const VERSION = "' + manifest.version + '";')) throw new Error("下载内容不是对应版本的 Codex 额度脚本。");
  if (sha256(source) !== manifest.sha256) throw new Error("下载校验失败，未替换脚本。");
  try { new Function("return async function() {\n" + source + "\n};"); }
  catch (_) { throw new Error("新版本语法校验失败，未替换脚本。"); }
}

async function downloadUpdateText(url, raw = false) {
  const request = new Request(url);
  request.timeoutInterval = 20;
  // 更新仅访问公开 GitHub，不读取连接设置，不携带额度接口的 Authorization。
  request.headers = { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" };
  request.onRedirect = () => null;
  let value;
  try { value = await request.loadString(); } catch (_) { throw new Error("无法连接 GitHub，请稍后重试。"); }
  const status = request.response?.statusCode;
  if (status !== 200) throw new Error(status === 403 || status === 429 ? "GitHub 请求受限，请稍后重试。" : "下载失败，请稍后重试。");
  if (typeof value !== "string" || value.length > 500000) throw new Error("下载内容异常。");
  return value;
}

async function currentScriptFile() {
  const path = module.filename;
  if (typeof path !== "string" || !path.endsWith(".js")) throw new Error("请先将脚本保存到 Scriptable。");
  const local = FileManager.local(), cloud = FileManager.iCloud();
  const fm = cloud.isFileStoredIniCloud(path) ? cloud : local;
  if (fm === cloud) await fm.downloadFileFromiCloud(path);
  if (!fm.fileExists(path)) throw new Error("无法找到当前脚本文件。");
  return { fm, path };
}

function backupFile(path) {
  const fm = FileManager.local();
  const folder = fm.joinPath(fm.documentsDirectory(), "CodexUsageWidget");
  if (!fm.fileExists(folder)) fm.createDirectory(folder, true);
  return { fm, path: fm.joinPath(folder, "backup-" + sha256(path).slice(0, 16) + ".json") };
}

async function replaceScript(source, keepBackup) {
  const file = await currentScriptFile();
  const original = file.fm.readString(file.path);
  if (!original || !original.includes("// CODEX_USAGE_WIDGET")) throw new Error("当前文件不是 Codex 额度脚本，未执行替换。");
  const backup = backupFile(file.path);
  const saved = JSON.stringify({ source: original, sha256: sha256(original) });
  if (keepBackup) {
    backup.fm.writeString(backup.path + ".pending", saved);
    if (backup.fm.readString(backup.path + ".pending") !== saved) throw new Error("更新前备份校验失败，未替换脚本。");
  }
  const temporary = file.path + ".update.tmp";
  try {
    file.fm.writeString(temporary, source);
    if (file.fm.readString(temporary) !== source) throw new Error("临时文件校验失败。");
    file.fm.writeString(file.path, source);
    if (file.fm.readString(file.path) !== source) throw new Error("脚本回读校验失败。");
    if (keepBackup) {
      backup.fm.writeString(backup.path, saved);
      if (backup.fm.readString(backup.path) !== saved) throw new Error("备份保存失败。");
    }
  } catch (_) {
    try {
      let current;
      try { current = file.fm.readString(file.path); } catch (_) {}
      if (current !== original) file.fm.writeString(file.path, original);
      if (file.fm.readString(file.path) !== original) throw new Error("restore");
    } catch (_) { throw new Error("写入与恢复均失败，请从 GitHub 复制完整代码覆盖当前脚本。"); }
    throw new Error("更新写入失败，已保留原脚本。");
  } finally {
    try { if (file.fm.fileExists(temporary)) file.fm.remove(temporary); } catch (_) {}
  }
}

async function relaunchAfterUpdate(settings, family, title) {
  try {
    await Safari.open(scriptURL({ ...settings, scenario: "live" }, family, "refresh"));
  } catch (_) {
    await showMessage(title, "代码已保存，但无法启动自动刷新。请再次运行脚本并选择立即刷新。连接设置和桌面参数均保留。");
  }
}

async function updateScript(settings, family) {
  if (!config.runsInApp) return;
  try {
    const base = "https://api.github.com/repos/" + REPOSITORY;
    // 将清单和源码固定到同一次提交，避免发布过程中版本混用。
    const commit = JSON.parse(await downloadUpdateText(base + "/commits/main"));
    if (!/^[a-f0-9]{40}$/.test(commit.sha || "")) throw new Error("无法确认仓库版本。");
    const ref = "?ref=" + commit.sha;
    const manifest = JSON.parse(await downloadUpdateText(base + "/contents/update.json" + ref, true));
    validateManifest(manifest);
    if (!newerVersion(manifest.version, VERSION)) {
      await showMessage("已是最新版本", "当前版本 v" + VERSION);
      return;
    }
    const source = await downloadUpdateText(base + "/contents/CodexUsage.js" + ref, true);
    validateUpdate(manifest, source);
    await replaceScript(source, true);
  } catch (error) {
    await showMessage("更新失败", error.message + "\n可稍后重试，或从 GitHub 复制完整代码覆盖原脚本。无需删除组件或重填连接设置。");
    return;
  }
  // 运行已保存的新版，跳过菜单并强制刷新一次额度。
  await relaunchAfterUpdate(settings, family, "更新完成");
}

async function restoreScript(settings, family) {
  try {
    const file = await currentScriptFile();
    const backup = backupFile(file.path);
    if (!backup.fm.fileExists(backup.path)) throw new Error("还没有更新前的备份。");
    const saved = JSON.parse(backup.fm.readString(backup.path));
    if (typeof saved.source !== "string" || !saved.source.includes("// CODEX_USAGE_WIDGET") || sha256(saved.source) !== saved.sha256) throw new Error("备份校验失败。");
    await replaceScript(saved.source, false);
  } catch (error) { await showMessage("恢复失败", error.message); return; }
  await relaunchAfterUpdate(settings, family, "恢复完成");
}

function palette(theme) {
  const color = (light, dark) => theme === "light" ? new Color(light) : theme === "dark" ? new Color(dark) : Color.dynamic(new Color(light), new Color(dark));
  return {
    background: color("FFFFFF", "1C1C1E"),
    text: color("101010", "F5F5F7"),
    secondary: color("66666A", "B1B1B8"),
    muted: color("8E8E93", "9999A1"),
    track: color("EFEFF1", "36363B"),
    blue: color("0088FF", "0A84FF"),
    // DrawContext 不支持动态颜色；位图前景使用固定蓝色，底轨仍跟随主题。
    imageBlue: new Color(theme === "light" ? "0088FF" : "0A84FF"),
    warning: color("9A620F", "E7B362"),
  };
}

function layoutColors(settings) {
  const colors = palette(settings.layout === "dark" ? "dark" : settings.theme);
  if (settings.layout === "gradient") {
    for (const [key, hex] of Object.entries({ background: "164CA7", text: "FFFFFF", secondary: "D9E7FF", muted: "C5D8F9", track: "426AB2", blue: "FFFFFF", imageBlue: "FFFFFF", warning: "FFE3A1" })) colors[key] = new Color(hex);
  }
  return colors;
}

function quotaRing(value, colors, diameter) {
  const ctx = new DrawContext();
  ctx.size = new Size(diameter, diameter);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.setLineWidth(6);
  const arc = (fraction, color) => {
    const path = new Path(), steps = Math.max(1, Math.ceil(100 * fraction));
    for (let i = 0; i <= steps; i++) {
      const angle = -Math.PI / 2 + i / steps * fraction * Math.PI * 2;
      const point = new Point(diameter / 2 + Math.cos(angle) * (diameter / 2 - 5), diameter / 2 + Math.sin(angle) * (diameter / 2 - 5));
      if (!i) path.move(point); else path.addLine(point);
    }
    ctx.setStrokeColor(color); ctx.addPath(path); ctx.strokePath();
  };
  arc(1, colors.track);
  const valid = percentValue(value);
  if (valid !== null && valid > 0) arc(valid / 100, colors.blue);
  ctx.setFont(Font.systemFont(diameter < 70 ? 16 : 22));
  ctx.setTextColor(colors.text);
  ctx.setTextAlignedCenter();
  ctx.drawTextInRect(percentLabel(value).replace(" left", ""), new Rect(5, diameter / 2 - (diameter < 70 ? 10 : 14), diameter - 10, 30));
  return ctx.getImage();
}

function dashboardBlock(parent, entry, family, colors, now, compact) {
  const small = family === "small";
  const diameter = small ? 52 : compact ? 68 : 78;
  if (small) {
    text(parent, entry.label || "Usage", 11, colors.secondary);
    parent.addSpacer(3);
  }
  const row = parent.addStack();
  row.centerAlignContent();
  const ring = row.addImage(quotaRing(entry.remainingPercent, colors, diameter));
  ring.imageSize = new Size(diameter, diameter);
  row.addSpacer(small ? 8 : 16);
  const detail = row.addStack(); detail.layoutVertically();
  text(detail, small ? "left" : entry.label || "Usage", small ? 12 : 13, colors.secondary);
  if (!small) {
    detail.addSpacer(5);
    text(detail, percentLabel(entry.remainingPercent), 25, colors.text);
    detail.addSpacer(5);
    text(detail, resetLabel(entry.resetsAt, now), 10.5, colors.muted);
  }
  if (small) {
    parent.addSpacer(4);
    text(parent, resetLabel(entry.resetsAt, now).replace("重置时间已到 · 待刷新", "已到重置时间"), 10, colors.muted);
  }
}

function text(parent, value, size, color) {
  const item = parent.addText(String(value));
  item.font = Font.systemFont(size);
  item.textColor = color;
  item.lineLimit = 1;
  item.minimumScaleFactor = 1;
  return item;
}

function percentValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function percentLabel(value) {
  const valid = percentValue(value);
  if (valid === null) return "—";
  if (valid > 0 && valid < 1) return "<1% left";
  // 不把 99.9% 向上显示成已恢复到 100%。
  return Math.floor(valid) + "% left";
}

function timestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function resetLabel(value, now) {
  const at = timestamp(value);
  if (at === null) return "重置时间未知";
  const remaining = at - now;
  if (remaining <= 0) return "重置时间已到 · 待刷新";
  // 先按实际毫秒判断单位，避免分钟舍入提前触发天数显示。
  if (remaining >= 86400000) return "Resets in " + Math.round(remaining / 86400000) + "天";
  const minutes = Math.round(remaining / 60000);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return "Resets in " + hours + "小时" + rest + "分钟";
}

function beijingTime(value, short) {
  const ms = timestamp(value);
  if (ms === null) return "—";
  const d = new Date(ms + 8 * 3600000);
  const two = n => String(n).padStart(2, "0");
  const time = two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
  return short ? time : two(d.getUTCMonth() + 1) + "/" + two(d.getUTCDate()) + " " + time;
}

function effectiveStatus(snapshot, settings, now) {
  if (snapshot.status !== "ready") return snapshot.status;
  const at = timestamp(snapshot.updatedAt);
  if (at === null || at > now + 60000 || now - at >= Math.max(1800, settings.refreshSeconds * 3) * 1000) return "stale";
  return "ready";
}

function footerLabel(snapshot, status, small) {
  if (status === "empty") return "未配置 · 无刷新记录";
  const demo = snapshot.isDemo ? "示例 · " : "";
  if (timestamp(snapshot.updatedAt) === null) return demo + "尚无成功刷新";
  const time = beijingTime(snapshot.updatedAt, small);
  const errors = { AUTH: "验证失败", RATE: "请求限流", NETWORK: "网络失败", CONNECT: "连接失败", TIMEOUT: "请求超时", DNS: "域名异常", FORMAT: "格式异常", SERVER: "服务异常", REDIRECT: "地址跳转" };
  const tag = snapshot.errorCode ? errors[snapshot.errorCode] || "刷新失败" : status === "stale" ? "已过期" : snapshot.cacheWarning ? "未保存" : snapshot.restricted ? "受限" : "";
  if (small) return demo + (tag ? time + " · " + tag : "更新 " + time);
  return demo + "上次刷新 " + time + (tag ? " · " + tag : "");
}

// 用代码绘制接近参考图的终端徽标；无外部图片请求。
function codexMark(color) {
  const ctx = new DrawContext();
  ctx.size = new Size(24, 24);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.setStrokeColor(color);
  ctx.setLineWidth(1.8);
  const outline = new Path();
  for (let i = 0; i <= 120; i++) {
    const a = i * Math.PI * 2 / 120;
    const radius = 9.3 + 0.85 * Math.cos(a * 6);
    const p = new Point(12 + Math.cos(a) * radius, 12 + Math.sin(a) * radius);
    if (i === 0) outline.move(p); else outline.addLine(p);
  }
  outline.closeSubpath();
  ctx.addPath(outline);
  ctx.strokePath();
  const terminal = new Path();
  terminal.move(new Point(8, 8.5));
  terminal.addLine(new Point(11, 11.5));
  terminal.addLine(new Point(8, 14.5));
  terminal.move(new Point(12, 15));
  terminal.addLine(new Point(16, 15));
  ctx.addPath(terminal);
  ctx.strokePath();
  return ctx.getImage();
}

function progressBar(parent, value, colors) {
  const bar = parent.addStack();
  bar.layoutHorizontally();
  bar.setPadding(0, 0, 0, 0);
  bar.spacing = 0;
  bar.size = new Size(0, 4);
  bar.cornerRadius = 2;
  bar.backgroundColor = colors.track;
  const valid = percentValue(value);
  // 先绘制前景，避免极近色标的渐变在桌面快照中偶发只显示灰色底轨。
  if (valid === 100) bar.backgroundColor = colors.blue;
  else if (valid !== null && valid > 0) {
    const ctx = new DrawContext(), side = 256;
    ctx.size = new Size(side, side);
    ctx.opaque = false;
    ctx.respectScreenScale = false;
    // 方形图像的每一行相同：横条无论拉伸还是按比例填满，都保留横向比例。
    // 透明区域透出原生动态底轨；无需获取组件宽度或判断系统深浅色。
    ctx.setFillColor(colors.imageBlue);
    ctx.fillRect(new Rect(0, 0, side * valid / 100, side));
    // 用独立子层承载透明图像，避免同一层的背景色与图像优先级影响灰轨。
    const foreground = bar.addStack();
    foreground.size = new Size(0, 4);
    foreground.setPadding(0, 0, 0, 0);
    foreground.backgroundImage = ctx.getImage();
    foreground.addSpacer();
  }
  if (valid === null || valid === 0 || valid === 100) bar.addSpacer();
  return bar;
}

function header(widget, family, colors, compact) {
  const row = widget.addStack();
  row.centerAlignContent();
  const icon = row.addImage(codexMark(colors.text));
  icon.imageSize = new Size(compact ? 16 : 18, compact ? 16 : 18);
  icon.tintColor = colors.text;
  row.addSpacer(6);
  text(row, "Codex", compact ? 14 : 16, colors.text);
  row.addSpacer();
  if (family !== "small") text(row, "Usage limits", 12, colors.secondary);
}

function quotaBlock(parent, entry, family, colors, now, compact) {
  const small = family === "small", large = family === "large";
  text(parent, entry.label || "Usage", compact ? 11 : small ? 12 : 13, colors.secondary);
  parent.addSpacer(compact ? 2 : 3);
  text(parent, percentLabel(entry.remainingPercent), compact ? 26 : large ? 34 : small ? 28 : 29, colors.text);
  parent.addSpacer(compact ? 5 : 7);
  progressBar(parent, entry.remainingPercent, colors);
  parent.addSpacer(compact ? 5 : 6);
  // 各尺寸均保留小时和分钟，小号仅简化已到重置时间的提示。
  let reset = resetLabel(entry.resetsAt, now);
  if (small) reset = reset.replace("重置时间已到 · 待刷新", "已到重置时间");
  text(parent, reset, compact ? 10 : small ? 10.5 : 11.5, colors.muted);
}

function renderWidget(snapshot, settings, family, now = Date.now()) {
  const widget = new ListWidget();
  const colors = layoutColors(settings);
  const small = family === "small", large = family === "large";
  const screen = Device.screenSize();
  const compact = !large && Math.min(screen.width, screen.height) < 390;
  widget.backgroundColor = colors.background;
  if (settings.layout === "gradient") {
    const background = new LinearGradient();
    background.colors = [new Color("3479DB"), new Color("193C87")];
    background.locations = [0, 1];
    background.startPoint = new Point(0, 0); background.endPoint = new Point(1, 1);
    widget.backgroundGradient = background;
  }
  widget.setPadding(compact ? 12 : large ? 18 : 15, compact ? 12 : small ? 16 : 18, compact ? 8 : large ? 16 : 11, compact ? 12 : small ? 16 : 18);
  widget.refreshAfterDate = new Date(Math.max(now + settings.refreshSeconds * 1000, snapshot.retryAt || 0));
  widget.url = widgetTapURL(settings, family);
  header(widget, family, colors, compact);
  widget.addSpacer(compact ? 6 : large ? 22 : small ? 8 : 10);

  // 示例使用固定的时钟，确保显示的示例时间不会冒充本次成功刷新。
  const referenceNow = snapshot.isDemo ? DEMO_NOW : now;
  const status = effectiveStatus(snapshot, settings, referenceNow);
  const windows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
  const shown = chooseWindows(windows, settings.window, large);

  if (shown.length && status !== "empty" && status !== "error") {
    for (let i = 0; i < shown.length; i++) {
      if (i > 0) {
        widget.addSpacer(18);
        const divider = widget.addStack();
        divider.size = new Size(0, 1);
        divider.backgroundColor = colors.track;
        divider.addSpacer();
        widget.addSpacer(18);
      }
      if (settings.layout === "dashboard") dashboardBlock(widget, shown[i], family, colors, referenceNow, compact);
      else quotaBlock(widget, shown[i], family, colors, referenceNow, compact);
    }
    if (large && shown.length === 1 && !snapshot.isDemo) {
      widget.addSpacer(24);
      text(widget, "重置于 " + beijingTime(shown[0].resetsAt, false), 12, colors.secondary);
      if (snapshot.availableResetCount !== null && snapshot.availableResetCount !== undefined) {
        widget.addSpacer(8);
        text(widget, "可用重置次数 " + snapshot.availableResetCount, 12, colors.secondary);
      }
    }
  } else {
    const empty = status === "empty";
    text(widget, settings.window === "weekly" ? "Weekly" : "Usage", compact ? 11 : 12, colors.secondary);
    widget.addSpacer(compact ? 2 : 3);
    text(widget, "—", compact ? 26 : 28, colors.text);
    widget.addSpacer(compact ? 5 : 7);
    progressBar(widget, null, colors);
    widget.addSpacer(compact ? 5 : 6);
    const message = empty ? "请打开脚本设置接口" : status === "error" ? small ? compactError(snapshot.errorCode) : usageError(snapshot.errorCode || "NETWORK").message : "此额度窗口暂无数据";
    text(widget, message, small ? 10 : 12, colors.muted);
  }
  widget.addSpacer();
  widget.addSpacer(compact ? 4 : 6);
  const footer = small ? widget : widget.addStack();
  if (!small) footer.centerAlignContent();
  text(footer, footerLabel(snapshot, status, small), compact ? 8.5 : small ? 9 : 10, status === "stale" || status === "error" || snapshot.cacheWarning || snapshot.restricted ? colors.warning : colors.muted);
  if (!small) {
    footer.addSpacer();
    const update = text(footer, "更新 ↗", 9, colors.secondary);
    update.url = scriptURL(settings, family, "update");
  }
  return widget;
}

function renderNotice(message) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("FFFFFF");
  widget.setPadding(16, 16, 16, 16);
  text(widget, "Codex Usage", 16, new Color("101010"));
  widget.addSpacer(10);
  const detail = text(widget, message, 12, new Color("66666A"));
  detail.lineLimit = 5;
  return widget;
}

async function configureConnection() {
  let previous;
  try { previous = readConnection(); } catch (_) { previous = null; }
  while (true) {
    const form = new Alert();
    form.title = "设置额度接口";
    form.message = "输入自己的接口地址和 API Key，二者都保存在本机钥匙串。地址不变时，密钥留空可保留原值。HTTP 会明文传输请求，接口支持时请使用 HTTPS。";
    form.addTextField("完整接口地址（含 /api/usage）", previous?.endpoint || "");
    form.addSecureTextField(previous ? "API Key（留空保留）" : "API Key", "");
    form.addAction("保存并刷新");
    form.addCancelAction("取消");
    if (await form.presentAlert() < 0) return false;
    try {
      saveConnection(form.textFieldValue(0), form.textFieldValue(1), previous);
      return true;
    } catch (error) {
      const notice = new Alert();
      notice.title = "设置未保存";
      notice.message = error.message;
      notice.addAction("好");
      await notice.presentAlert();
    }
  }
}

async function configureRefresh() {
  while (true) {
    const form = new Alert();
    form.title = "刷新间隔（秒）";
    form.message = "填写 1–86400 之间的整数秒，例如 30 或 600（10 分钟）。保存到本机，对所有尺寸生效。此间隔用于缓存和申请刷新，实际刷新时机由 iOS 决定。";
    form.addTextField("刷新间隔（秒）", String(readRefreshSeconds()));
    form.addAction("保存并刷新");
    form.addCancelAction("取消");
    if (await form.presentAlert() < 0) return false;
    try {
      saveRefreshSeconds(form.textFieldValue(0));
      return true;
    } catch (error) {
      await showMessage("设置未保存", error.message);
    }
  }
}

async function main() {
  let settings;
  try { settings = readSettings(args.widgetParameter || args.queryParameters?.parameter); }
  catch (error) {
    const widget = renderNotice("参数有误：" + error.message);
    Script.setWidget(widget);
    if (config.runsInApp) await widget.presentMedium();
    return;
  }

  let family = config.widgetFamily || "medium";
  if (config.runsInApp && FAMILIES.includes(args.queryParameters?.family)) family = args.queryParameters.family;
  const action = config.runsInApp ? args.queryParameters?.action : null;
  if (action === "update") { await updateScript(settings, family); return; }
  let force = action === "refresh";
  if (force) settings = { ...settings, scenario: "live" };
  if (config.runsInApp) {
    let connection;
    try { connection = readConnection(); } catch (_) { connection = null; }
    if (!connection && settings.scenario === "live") {
      if (!await configureConnection()) return;
      force = true;
    } else if (!force) {
      const menu = new Alert();
      menu.title = "Codex Usage · " + VERSION;
      menu.message = "当前每 " + settings.refreshSeconds + " 秒申请刷新。立即刷新会请求服务端重新读取额度；桌面刷新时机由 iOS 决定。";
      ["预览小号", "预览中号", "预览大号", "立即刷新", "设置接口 / API Key", "刷新间隔（" + settings.refreshSeconds + " 秒）", "预览示例（不请求接口）", "一键更新脚本", "恢复更新前版本", "外观布局（" + LAYOUTS[settings.layout] + "）"].forEach(label => menu.addAction(label));
      menu.addCancelAction("取消");
      const choice = await menu.presentSheet();
      if (choice < 0) return;
      if (choice === 7) { await updateScript(settings, family); return; }
      if (choice === 8) { await restoreScript(settings, family); return; }
      family = FAMILIES[choice] || "medium";
      settings = { ...settings, scenario: choice === 6 ? "demo" : "live" };
      if (choice === 3) force = true;
      if (choice === 4) {
        if (!await configureConnection()) return;
        force = true;
      }
      if (choice === 5) {
        if (!await configureRefresh()) return;
        settings = { ...settings, refreshSeconds: readRefreshSeconds() };
        force = true;
      }
      if (choice === 9) {
        const layout = await configureLayout();
        if (!layout) return;
        settings = { ...settings, layout, layoutOverride: null };
      }
    }
  }

  const widget = FAMILIES.includes(family)
    ? renderWidget(await loadUsage(settings, { force }), settings, family)
    : renderNotice("请添加小号、中号或大号桌面组件。");
  Script.setWidget(widget);
  if (config.runsInApp) await widget[{ small: "presentSmall", medium: "presentMedium", large: "presentLarge" }[family] || "presentMedium"]();
}

try { await main(); } finally { Script.complete(); }
