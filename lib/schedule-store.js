// Read/write compact CO optimal-schedule rows (Supabase + server cache).
// On cache/DB miss, fetch that one date from Campus Optimizer (same as /api/schedules).

import cache from "../server/cache.js";
import { getSupabase } from "../server/lib/supabase-client.js";
import { getOptimalSchedules } from "./co-client.js";

const SUPABASE_SCHEDULES_TABLE =
  process.env.SUPABASE_CO_SCHEDULES_TABLE || "co_short_schedules";

function cacheKey(clientId, date) {
  return `schedules:${clientId}:${date}`;
}

function normalizeReportDate(date) {
  return String(date).split("T")[0];
}

/**
 * @param {number|string} clientId
 * @param {string[]} dates - YYYY-MM-DD report dates
 * @returns {Promise<Map<string, object[]>>} date -> optimal-schedule rows
 */
export async function readShortSchedulesForDates(clientId, dates) {
  const normalizedId = Number(clientId);
  const uniqueDates = Array.from(new Set((dates || []).filter(Boolean))).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  const result = new Map();
  if (!uniqueDates.length) return result;

  const missingDates = [];

  for (const date of uniqueDates) {
    const cached = cache.get(cacheKey(clientId, date));
    if (Array.isArray(cached)) {
      result.set(date, cached);
    } else {
      missingDates.push(date);
    }
  }

  const supabase = getSupabase();
  if (missingDates.length && supabase) {
    const { data, error } = await supabase
      .from(SUPABASE_SCHEDULES_TABLE)
      .select("report_date, schedules")
      .eq("client_id", normalizedId)
      .in("report_date", missingDates);

    if (error) {
      console.warn(
        `[schedule-store] Supabase read failed for client ${clientId}:`,
        error.message
      );
    } else if (Array.isArray(data)) {
      for (const row of data) {
        const date = String(row?.report_date || "").split("T")[0];
        const schedules = Array.isArray(row?.schedules) ? row.schedules : [];
        if (date) {
          result.set(date, schedules);
          cache.set(cacheKey(clientId, date), schedules, { ex: 3600 });
        }
      }
    }
  }

  return result;
}

/**
 * Persist compact schedule rows (fire-and-forget from schedule API routes).
 */
export async function saveShortSchedulesForDate(clientId, date, schedules) {
  const rows = Array.isArray(schedules) ? schedules : [];
  const reportDate = normalizeReportDate(date);
  cache.set(cacheKey(clientId, reportDate), rows, { ex: 3600 });

  const supabase = getSupabase();
  if (!supabase) return;

  const normalizedId = Number(clientId);

  const { error } = await supabase.from(SUPABASE_SCHEDULES_TABLE).upsert(
    {
      client_id: normalizedId,
      report_date: reportDate,
      schedules: rows,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,report_date" }
  );

  if (error) {
    console.warn(
      `[schedule-store] Supabase upsert failed for ${clientId}/${reportDate}:`,
      error.message
    );
  }
}

/**
 * Same behavior as GET /api/schedules/:clientId/:date —
 * cache → Supabase → live CO optimal-schedules for that one date, then persist.
 *
 * @returns {Promise<object[]>}
 */
export async function ensureShortSchedulesForDate(clientId, date) {
  const reportDate = normalizeReportDate(date);
  const existing = await readShortSchedulesForDates(clientId, [reportDate]);
  if (existing.has(reportDate)) {
    return existing.get(reportDate) || [];
  }

  console.log(
    `[schedule-store] Cache/DB miss for ${clientId}/${reportDate}; fetching from CO`
  );
  const schedules = await getOptimalSchedules(clientId, reportDate);
  const rows = Array.isArray(schedules) ? schedules : [];
  await saveShortSchedulesForDate(clientId, reportDate, rows);
  return rows;
}
