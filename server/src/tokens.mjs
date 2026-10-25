import { UsageError } from './codex.mjs';

const validTokens = value => Number.isSafeInteger(value) && value >= 0;
const localDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function period(buckets, startDate, endDate) {
  let tokens = 0;
  let reportedDays = 0;
  const missingDates = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    if (buckets.has(date)) {
      tokens += buckets.get(date);
      reportedDays++;
    } else missingDates.push(date);
  }
  if (!Number.isSafeInteger(tokens)) throw new UsageError('CODEX_INVALID_RESPONSE', 'Codex 返回的 token 数值超出安全范围。');
  return { tokens: reportedDays ? tokens : null, startDate, endDate, reportedDays, missingDates, complete: missingDates.length === 0 };
}

export function normalizeTokenUsage(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') throw new UsageError('CODEX_INVALID_RESPONSE', 'Codex 返回了无效的 token 数据。');
  const lifetime = raw.summary?.lifetimeTokens;
  if (lifetime != null && !validTokens(lifetime)) throw new UsageError('CODEX_INVALID_RESPONSE', 'Codex 返回了无效的 token 数据。');
  const input = raw.dailyUsageBuckets;
  if (input != null && !Array.isArray(input)) throw new UsageError('CODEX_INVALID_RESPONSE', 'Codex 返回了无效的每日 token 数据。');
  const buckets = new Map();
  for (const bucket of input ?? []) {
    if (!bucket || !validDate(bucket.startDate) || !validTokens(bucket.tokens) || buckets.has(bucket.startDate)) {
      throw new UsageError('CODEX_INVALID_RESPONSE', 'Codex 返回了无效的每日 token 数据。');
    }
    buckets.set(bucket.startDate, bucket.tokens);
  }
  const today = localDate(now);
  const dates = [...buckets.keys()].sort();
  return {
    lifetimeTokens: lifetime ?? null,
    asOfDate: today,
    serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    thisMonth: period(buckets, `${today.slice(0, 7)}-01`, today),
    last7Days: period(buckets, addDays(today, -6), today),
    yesterday: period(buckets, addDays(today, -1), addDays(today, -1)),
    dailyCoverage: {
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      reportedDays: dates.length,
    },
  };
}
