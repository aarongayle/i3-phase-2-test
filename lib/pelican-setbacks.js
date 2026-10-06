// What each Pelican thermostat actually sets back to overnight (schema version 1).
//
// Pelican runs a background schedule on every thermostat (the setback, e.g.
// 50°F heat / 90°F cool) and CO pushes occupied events over it. A client can
// edit that background schedule in Pelican without touching CO; CO never sees
// it, and the unit keeps the new setback until someone changes it back.
//
// Pelican's API won't return a schedule's setpoints ("Get Thermostat Schedule
// is currently unsupported"), so the setback is read from history instead:
// each day's lowest heat setpoint and highest cool setpoint are the setback
// whenever the unit spent part of the day unoccupied. The most common daily
// value over the last week is what the unit holds now; comparing it with the
// weeks before shows when it was changed. Pelican's Thermostat object does
// give the schedule's name and whether the schedule is on.

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 7;
const PRIOR_START_DAYS = 14; // prior window: 14–60 days before the end date
const PRIOR_END_DAYS = 60;
const PLANT_GROUP = "HIDDEN"; // plant-loop sensors, not thermostats
const MIN_CHANGE_F = 2; // smaller moves are residents nudging a thermostat, not a schedule edit

function addDays(dateKey, n) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function avg(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function mode(values) {
  const counts = new Map();
  for (const v of values) if (v != null && Number.isFinite(Number(v))) counts.set(Number(v), (counts.get(Number(v)) || 0) + 1);
  let best = null;
  for (const [v, n] of counts) if (!best || n > best.n || (n === best.n && v < best.v)) best = { v, n };
  return best?.v ?? null;
}

/**
 * Latest day the unit switched to its current value: that day matches the
 * current value and the data day before it matched the prior value.
 */
function changeDate(days, key, current, prior) {
  if (current == null || prior == null || Math.abs(current - prior) < MIN_CHANGE_F) return null;
  for (let i = days.length - 1; i > 0; i--) {
    if (days[i][key] === current && days[i - 1][key] === prior) return days[i].date;
  }
  return null;
}

/**
 * @param {object[]} rows - daily summaries (serialNo, name, groupName, date,
 *   minHeatSetpoint, maxHeatSetpoint, minCoolSetpoint, maxCoolSetpoint, siteSlug)
 * @param {{ end: string, schedulesBySerial?: Map<string, object> }} opts
 */
export function buildSetbackAudit(rows, { end, schedulesBySerial = new Map() } = {}) {
  const recentStart = addDays(end, -(RECENT_DAYS - 1));
  const priorFrom = addDays(end, -PRIOR_END_DAYS);
  const priorTo = addDays(end, -PRIOR_START_DAYS);

  const byUnit = new Map();
  for (const r of rows || []) {
    const serial = String(r?.serialNo ?? "").trim();
    if (!serial || !r?.date || r.date > end || r.date < priorFrom) continue;
    if (String(r.groupName ?? "").toUpperCase() === PLANT_GROUP) continue;
    if (!byUnit.has(serial)) byUnit.set(serial, { serial, name: r.name, groupName: r.groupName, siteSlug: r.siteSlug, days: [] });
    const unit = byUnit.get(serial);
    if (r.name) unit.name = r.name;
    if (r.groupName) unit.groupName = r.groupName;
    unit.days.push({
      date: r.date,
      heat: r.minHeatSetpoint ?? null,
      cool: r.maxCoolSetpoint ?? null,
      flat: r.minHeatSetpoint != null && r.minHeatSetpoint === r.maxHeatSetpoint && r.minCoolSetpoint === r.maxCoolSetpoint,
      fanH: Number(r.fanRuntime) / 3600 || 0,
      compH: Math.max(Number(r.coolRuntime) || 0, Number(r.heatRuntime) || 0) / 3600,
      occH: Number(r.occupiedTime) / 3600 || 0,
    });
  }

  const columns = [
    "serialNo", "name", "groupName", "siteSlug", "recentDays",
    "heldHeatF", "heldCoolF", "priorHeatF", "priorCoolF", "heatChangedOn", "coolChangedOn",
    "flatDaysPct", "scheduleOn", "scheduleName", "scheduleRepeat", "lastSeen",
    // Fan hours beyond compressor hours: a fan set to On instead of Auto.
    "fanHoursPerDay", "fanOnlyHoursPerDay", "occupiedHoursPerDay",
  ];
  const out = [];
  for (const unit of byUnit.values()) {
    const days = unit.days.sort((a, b) => a.date.localeCompare(b.date));
    const recent = days.filter((d) => d.date >= recentStart);
    const prior = days.filter((d) => d.date >= priorFrom && d.date <= priorTo);
    const heldHeat = mode(recent.map((d) => d.heat));
    const heldCool = mode(recent.map((d) => d.cool));
    const priorHeat = mode(prior.map((d) => d.heat));
    const priorCool = mode(prior.map((d) => d.cool));
    const sched = schedulesBySerial.get(unit.serial) ?? null;
    out.push([
      unit.serial, unit.name ?? null, unit.groupName ?? null, unit.siteSlug ?? null, recent.length,
      heldHeat, heldCool, priorHeat, priorCool,
      changeDate(days, "heat", heldHeat, priorHeat), changeDate(days, "cool", heldCool, priorCool),
      recent.length ? Math.round((recent.filter((d) => d.flat).length / recent.length) * 100) : null,
      sched ? sched.scheduleOn : null, sched?.scheduleName ?? null, sched?.scheduleRepeat ?? null,
      days.at(-1)?.date ?? null,
      avg(recent.map((d) => d.fanH)),
      avg(recent.map((d) => Math.max(0, d.fanH - d.compH))),
      avg(recent.map((d) => d.occH)),
    ]);
  }
  out.sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[1]).localeCompare(String(b[1])));
  return {
    version: 1,
    window: { recentFrom: recentStart, end, priorFrom, priorTo },
    units: { columns, rows: out },
  };
}

/**
 * Each thermostat's background schedule name, repeat, and whether it's on,
 * from Pelican's Thermostat object (one request per site).
 * @returns {Promise<Map<string, { scheduleOn: boolean|null, scheduleName: string|null, scheduleRepeat: string|null }>>}
 */
export async function fetchThermostatSchedules(siteSlug, username, password) {
  const res = await fetch(`https://${siteSlug}.officeclimatecontrol.net/api.cgi`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      username,
      password,
      transactions: [
        { request: "get", object: "Thermostat", selection: {}, value: { serialNo: "", schedule: "", scheduleName: "", scheduleRepeat: "" } },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Pelican thermostat schedules ${siteSlug} failed (${res.status})`);
  const json = await res.json();
  const list = json?.result?.[0]?.Thermostat;
  const out = new Map();
  for (const t of Array.isArray(list) ? list : list ? [list] : []) {
    const serial = String(t?.serialNo ?? "").trim();
    if (!serial) continue;
    const raw = String(t?.schedule ?? "").trim().toLowerCase();
    out.set(serial, {
      scheduleOn: raw === "on" ? true : raw === "off" ? false : null,
      scheduleName: String(t?.scheduleName ?? "").trim() || null,
      scheduleRepeat: String(t?.scheduleRepeat ?? "").trim() || null,
    });
  }
  return out;
}
