// Scheduled minutes per device per day from CO optimal-schedule rows.
//
// CO returns several days of events for one report date (report date
// 2026-08-26 → rows for Aug 24 … Sep 2), and some events span several days
// (e.g. 2026-08-26 02:45Z → 2026-09-03 05:00Z). Summing every row counts about
// a week of schedule as one day, so each event is clipped to the report date's
// local day and overlaps are counted once.
//
// CO rows carry no client time zone. Current clients are in Central time, so
// that is the default; pass another IANA zone when a client is elsewhere.

export const DEFAULT_SCHEDULE_TIME_ZONE = "America/Chicago";

const MINUTE_MS = 60 * 1000;

/** "2026-08-26T00:00:00.000Z" or "2026-08-26" → "2026-08-26" */
export function reportDateKey(date) {
  if (!date) return null;
  return String(date).split("T")[0];
}

/** Offset of timeZone from UTC at instant ms (local − UTC), in ms. */
function zoneOffsetMs(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC ms of local midnight starting dateKey in timeZone. */
function localMidnightUtc(dateKey, timeZone) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - zoneOffsetMs(naive, timeZone);
  // Second pass settles days where the offset changes (DST).
  guess = naive - zoneOffsetMs(guess, timeZone);
  return guess;
}

/**
 * [start, end) UTC ms bounds of the report date's local day.
 * @returns {[number, number] | null}
 */
export function reportDayBounds(reportDate, timeZone = DEFAULT_SCHEDULE_TIME_ZONE) {
  const key = reportDateKey(reportDate);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const start = localMidnightUtc(key, timeZone);
  const [y, m, d] = key.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return [start, localMidnightUtc(next, timeZone)];
}

/** Rows whose event overlaps the report date's local day. */
export function rowsForReportDate(rows, reportDate, timeZone = DEFAULT_SCHEDULE_TIME_ZONE) {
  const bounds = reportDayBounds(reportDate, timeZone);
  if (!bounds) return [];
  const [dayStart, dayEnd] = bounds;
  return (rows || []).filter((row) => {
    const start = Number(row?.StartDateEpoch);
    const end = Number(row?.EndDateEpoch);
    return Number.isFinite(start) && Number.isFinite(end) && start < dayEnd && end > dayStart;
  });
}

/** Total minutes covered by intervals, counting overlaps once. */
function unionMinutes(intervals) {
  const sorted = intervals
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let spanStart = null;
  let spanEnd = null;
  for (const [start, end] of sorted) {
    if (spanEnd == null || start > spanEnd) {
      if (spanEnd != null) total += spanEnd - spanStart;
      spanStart = start;
      spanEnd = end;
    } else if (end > spanEnd) {
      spanEnd = end;
    }
  }
  if (spanEnd != null) total += spanEnd - spanStart;
  return total / MINUTE_MS;
}

/**
 * @param {object[]} rows - optimal-schedule rows for one report date
 * @param {string} reportDate
 * @param {string} [timeZone]
 * @returns {Map<number|string, { scheduledMinutes: number, rampMinutes: number }>}
 *   scheduledMinutes never exceeds one day (1,440, or 1,380/1,500 on DST days).
 *   rampMinutes counts events that start on the report date.
 */
export function scheduledMinutesByDevice(rows, reportDate, timeZone = DEFAULT_SCHEDULE_TIME_ZONE) {
  const bounds = reportDayBounds(reportDate, timeZone);
  const result = new Map();
  if (!bounds) return result;
  const [dayStart, dayEnd] = bounds;

  const byDevice = new Map();
  for (const row of rowsForReportDate(rows, reportDate, timeZone)) {
    const deviceId = row?.DeviceId;
    if (deviceId == null) continue;
    const start = Number(row.StartDateEpoch);
    const end = Number(row.EndDateEpoch);
    let agg = byDevice.get(deviceId);
    if (!agg) {
      agg = { intervals: [], seen: new Set(), rampMinutes: 0 };
      byDevice.set(deviceId, agg);
    }
    // Identical rows (same device, same window) are one event.
    const key = `${start}-${end}`;
    if (agg.seen.has(key)) continue;
    agg.seen.add(key);
    agg.intervals.push([Math.max(start, dayStart), Math.min(end, dayEnd)]);
    if (start >= dayStart) agg.rampMinutes += Number(row?.RampTime) || 0;
  }

  for (const [deviceId, agg] of byDevice) {
    result.set(deviceId, {
      scheduledMinutes: unionMinutes(agg.intervals),
      rampMinutes: agg.rampMinutes,
    });
  }
  return result;
}

/** Monday (UTC) of the week containing dateKey. */
export function weekStartKey(dateKey) {
  const d = new Date(`${reportDateKey(dateKey)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Daily points → weekly totals labeled by week start (Monday).
 * First and last weeks can be partial.
 * @param {{ date: string, minutes: number }[]} dailyPoints
 */
export function weeklyTotals(dailyPoints) {
  const totals = new Map();
  for (const point of dailyPoints || []) {
    const week = weekStartKey(point?.date);
    if (!week) continue;
    totals.set(week, (totals.get(week) || 0) + (Number(point?.minutes) || 0));
  }
  return Array.from(totals.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, minutes]) => ({ date, minutes }));
}
