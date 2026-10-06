// Per-meter demand and baseload, demand targets, buildings, and client-entered
// event schedules for the headless report (schema version 1).
//
// The rest of the analytics payload is site-wide or device-level. Project
// managers work per meter and per building: which meter set a demand peak and
// whether it happened during startup (load rolling / demand targets) or under
// normal occupied load, which meters carry a high overnight floor, and whether
// the hours a client enters on the CO events page fit the building.
//
// Interval data is CO's 15-minute kWh per meter (kW = kWh × 4); its interval
// index is already the meter's local time. Event times come from CO as UTC and
// are converted to the client's time zone. All clock times are "HH:MM" 24-hour
// local time; consumers format them for people.
import {
  getActualWeather,
  getBuildingTypes,
  getBuildings,
  getDemandTargets,
  getHierarchy,
  getLoadRollingOptions,
  getMeters,
  getRoomCollections,
  getSchedulerEvents,
  getUtilityTypes,
  getWeatherCity,
} from "./co-client.js";
import { DEFAULT_SCHEDULE_TIME_ZONE, localParts } from "./co-scheduled-minutes.js";

const CATEGORY = { building: 2, meter: 3, group: 4, device: 5, room: 8 };
const PEAK_DAYS = 400; // a full year of billing periods where CO has the interval history
const PEAK_HOURS_DAYS = 90;
const BASELOAD_MONTHS = 13;
const OVERNIGHT_INTERVALS = [0, 16]; // 12:00 AM – 4:00 AM
const CLOCK_STARTUP_INTERVALS = [20, 36]; // 5:00 AM – 9:00 AM when no schedule is known
const STARTUP_GRACE_MIN = 60; // demand settles within an hour of occupancy
const EVENT_WEEKS_BACK = 7;
const EVENT_WEEKS_AHEAD = 1;
const MAX_SERIES = 150;
const WEATHER_YEARS = 4; // covers a contract's base year for most clients
const WINDOW_CHANGE_MIN = 30;
const LODGING_TYPE = "lodging";
const RESIDENTIAL_CATEGORY = /dorm|residen|apartment|housing|nursing|assisted|retirement/i;
// Most CO buildings have no type yet, so a name like "Pontotoc Hall Dormitory"
// or "Adult Housing Unit K" is the only residential signal.
const RESIDENTIAL_NAME = /\b(dorm|dormitory|residence|residential|housing|apartments?|suites|parsonage)\b/i;

const round = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export function clock(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** "07-29-2025" or "2025-07-29T…" → "2025-07-29" */
function isoDay(value) {
  const s = String(value ?? "");
  const us = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

function addDays(dateKey, n) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing dateKey. */
function mondayOf(dateKey) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

function parseIdList(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── hierarchy ──────────────────────────────────────────────────────────────

/**
 * Device → building → electric meter, room → device, from CO's element tree.
 * Meters and buildings nest in both directions in CO, so each lookup walks up
 * to the nearest ancestor of the wanted kind.
 */
export function buildTopology({ hierarchy, buildings, meters, utilityTypes }) {
  const nodes = new Map();
  for (const node of hierarchy || []) nodes.set(`${node.CategoryId}:${node.ElementTableId}`, node);

  const utilityName = new Map((utilityTypes || []).map((u) => [String(u.Id ?? u.id), String(u.Name ?? u.name ?? "")]));
  const electricMeters = new Set(
    (meters || [])
      .filter((m) => /elec/i.test(utilityName.get(String(m.UtilityTypeId)) || "") || Number(m.UtilityTypeId) === 1)
      .map((m) => Number(m.Id)),
  );

  const ancestor = (category, id, wanted, accept = () => true) => {
    let node = nodes.get(`${category}:${id}`);
    const seen = new Set();
    while (node && node.ParentCategoryId != null) {
      const key = `${node.ParentCategoryId}:${node.ParentElementTableId}`;
      if (seen.has(key)) break;
      seen.add(key);
      if (node.ParentCategoryId === wanted && accept(node.ParentElementTableId)) return node.ParentElementTableId;
      node = nodes.get(key);
    }
    return null;
  };

  const buildingMeter = new Map();
  for (const b of buildings || []) {
    buildingMeter.set(b.Id, ancestor(CATEGORY.building, b.Id, CATEGORY.meter, (id) => electricMeters.has(id)));
  }

  const deviceBuilding = new Map();
  const deviceMeter = new Map();
  const roomDevice = new Map();
  for (const node of hierarchy || []) {
    if (node.CategoryId === CATEGORY.device) {
      const buildingId = ancestor(CATEGORY.device, node.ElementTableId, CATEGORY.building);
      deviceBuilding.set(node.ElementTableId, buildingId);
      deviceMeter.set(
        node.ElementTableId,
        (buildingId != null ? buildingMeter.get(buildingId) : null) ??
          ancestor(CATEGORY.device, node.ElementTableId, CATEGORY.meter, (id) => electricMeters.has(id)),
      );
    } else if (node.CategoryId === CATEGORY.room) {
      roomDevice.set(node.ElementTableId, ancestor(CATEGORY.room, node.ElementTableId, CATEGORY.device));
    }
  }
  return { buildingMeter, deviceBuilding, deviceMeter, roomDevice, electricMeters };
}

// ─── buildings, meters, targets ─────────────────────────────────────────────

function residentialFlag(name, type) {
  if (type) {
    return {
      residential: String(type.Type).toLowerCase() === LODGING_TYPE || RESIDENTIAL_CATEGORY.test(type.Category || ""),
      residentialSource: "type",
    };
  }
  return RESIDENTIAL_NAME.test(name || "")
    ? { residential: true, residentialSource: "name" }
    : { residential: null, residentialSource: null };
}

function buildingRows(buildings, buildingTypes, topology, meterNames) {
  const types = new Map((buildingTypes || []).map((t) => [Number(t.Id), t]));
  const deviceCounts = new Map();
  for (const buildingId of topology.deviceBuilding.values()) {
    if (buildingId != null) deviceCounts.set(buildingId, (deviceCounts.get(buildingId) || 0) + 1);
  }
  return (buildings || []).map((b) => {
    const type = types.get(Number(b.Type)) || null;
    const meterId = topology.buildingMeter.get(b.Id) ?? null;
    return {
      buildingId: b.Id,
      name: b.Name,
      typeId: b.Type ?? null,
      type: type?.Type ?? null,
      category: type?.Category ?? null,
      ...residentialFlag(b.Name, type),
      squareFeet: Number(b.SquareFootage) > 0 ? Number(b.SquareFootage) : null,
      meterId: meterId != null ? String(meterId) : null,
      meterName: meterId != null ? meterNames.get(meterId) ?? null : null,
      deviceCount: deviceCounts.get(b.Id) || 0,
    };
  });
}

function meterRows(meters, utilityTypes, buildings) {
  const utilityName = new Map((utilityTypes || []).map((u) => [String(u.Id ?? u.id), String(u.Name ?? u.name ?? "")]));
  return (meters || []).map((m) => ({
    meterId: String(m.Id),
    name: m.Name,
    utilityType: /elec/i.test(utilityName.get(String(m.UtilityTypeId)) || "")
      ? "electric"
      : (utilityName.get(String(m.UtilityTypeId)) || "").toLowerCase() || null,
    sqftServed: Number(m.SqftServed) > 0 ? Number(m.SqftServed) : null,
    hasDemandCharge: m.HasDemandCharge == null ? null : Boolean(Number(m.HasDemandCharge)),
    weatherCityId: m.WeatherCityId ?? null,
    buildings: buildings.filter((b) => b.meterId === String(m.Id)).map((b) => b.name),
  }));
}

export function demandTargetRows(targets, loadRollingOptions) {
  const lr = new Map((loadRollingOptions || []).map((o) => [Number(o.Id), o.Name]));
  return (targets || [])
    .map((t) => ({
      meterId: String(t.MeterId),
      begin: isoDay(t.BeginDate),
      end: isoDay(t.EndDate),
      demandTargetKw: Number.isFinite(Number(t.DemandTarget)) ? Number(t.DemandTarget) : null,
      loadRolling: lr.get(Number(t.LoadRollingOptionId)) ?? null,
      notes: t.Notes || null,
    }))
    .sort((a, b) => (a.meterId === b.meterId ? String(a.begin).localeCompare(String(b.begin)) : a.meterId.localeCompare(b.meterId)));
}

/**
 * meter → date → demand target CO applied that day (schedule-details). The
 * configured /project/targets ranges are not used here: their dates don't
 * reliably match what CO applied (seasonal ranges, adjustments).
 */
function appliedTargetIndex(applied) {
  const out = new Map();
  for (const t of applied || []) {
    const id = String(t.meterId);
    if (!out.has(id)) out.set(id, new Map());
    out.get(id).set(String(t.date).slice(0, 10), t.demandTargetKw);
  }
  return out;
}

// ─── interval demand and baseload ───────────────────────────────────────────

/** meter → date → 96 kW values (null where CO has no reading). */
function intervalKwByMeter(energyActual) {
  const out = new Map();
  for (const meter of energyActual || []) {
    const byDate = new Map();
    for (const pt of meter?.Interval || []) {
      const idx = Number(pt?.interval);
      const value = Number(pt?.value);
      if (!pt?.date || !Number.isInteger(idx) || idx < 0 || idx > 95 || !Number.isFinite(value)) continue;
      if (!byDate.has(pt.date)) byDate.set(pt.date, new Array(96).fill(null));
      byDate.get(pt.date)[idx] = value * 4;
    }
    // Days where the meter reported nothing but zeros are outages, not load.
    for (const [date, values] of byDate) {
      if (!values.some((v) => v > 0)) byDate.delete(date);
    }
    if (byDate.size) out.set(String(meter.Id), { name: meter.Name, byDate });
  }
  return out;
}

/** meter → date → { startMin, eventStartMin } across the meter's devices. */
function startsByMeterDate(devices, topology) {
  const out = new Map();
  for (const device of devices || []) {
    const meterId = topology.deviceMeter.get(Number(device.coDeviceId));
    if (meterId == null) continue;
    const key = String(meterId);
    if (!out.has(key)) out.set(key, new Map());
    const byDate = out.get(key);
    for (const s of device.startsDaily || []) {
      const prev = byDate.get(s.date);
      byDate.set(s.date, {
        startMin: Math.min(prev?.startMin ?? Infinity, s.startMin),
        eventStartMin:
          s.eventStartMin == null
            ? prev?.eventStartMin ?? null
            : Math.min(prev?.eventStartMin ?? Infinity, s.eventStartMin),
      });
    }
  }
  return out;
}

/**
 * Daily peak per meter, and whether it fell in the startup window: from the
 * first device start (ramp + load rolling) to an hour after occupancy begins.
 * Without a known schedule that day, 5–9 AM stands in ("clock" basis).
 */
export function meterDailyPeaks(intervals, starts, appliedTargets, { days = PEAK_DAYS } = {}) {
  const columns = [
    "meterId", "date", "peakKw", "peakTime", "startup", "startupBasis",
    "firstDeviceStart", "occupiedStart", "demandTargetKw",
  ];
  const rows = [];
  for (const [meterId, { byDate }] of intervals) {
    const dates = [...byDate.keys()].sort().slice(-days);
    for (const date of dates) {
      const values = byDate.get(date);
      let peakIdx = -1;
      for (let i = 0; i < 96; i++) if (values[i] != null && (peakIdx < 0 || values[i] > values[peakIdx])) peakIdx = i;
      if (peakIdx < 0) continue;
      const peakMin = peakIdx * 15;
      const s = starts.get(meterId)?.get(date);
      let startup;
      let basis;
      if (s && Number.isFinite(s.startMin)) {
        const end = (s.eventStartMin ?? s.startMin) + STARTUP_GRACE_MIN;
        startup = peakMin >= s.startMin && peakMin < end;
        basis = "schedule";
      } else {
        startup = peakIdx >= CLOCK_STARTUP_INTERVALS[0] && peakIdx < CLOCK_STARTUP_INTERVALS[1];
        basis = "clock";
      }
      rows.push([
        meterId, date, round(values[peakIdx], 1), clock(peakMin), startup ? 1 : 0, basis,
        s ? clock(s.startMin) : null, s?.eventStartMin != null ? clock(s.eventStartMin) : null,
        appliedTargets.get(meterId)?.get(date) ?? null,
      ]);
    }
  }
  return { columns, rows, days };
}

/**
 * The EIC "top 10%" view: which hours hold the highest 10% of 15-minute
 * demand readings over the last 90 days, per meter.
 */
export function meterPeakHours(intervals, { days = PEAK_HOURS_DAYS } = {}) {
  const out = [];
  for (const [meterId, { byDate }] of intervals) {
    const dates = [...byDate.keys()].sort().slice(-days);
    const readings = [];
    for (const date of dates) {
      const weekend = [0, 6].includes(dayOfWeek(date));
      byDate.get(date).forEach((kw, idx) => {
        if (kw != null) readings.push({ kw, hour: Math.floor(idx / 4), weekend });
      });
    }
    if (readings.length < 96) continue;
    const sorted = readings.map((r) => r.kw).sort((a, b) => a - b);
    const threshold = percentile(sorted, 90);
    const top = readings.filter((r) => r.kw >= threshold);
    const byHour = new Array(24).fill(0);
    for (const r of top) byHour[r.hour] += 1;
    out.push({
      meterId,
      days: dates.length,
      thresholdKw: round(threshold, 1),
      maxKw: round(sorted[sorted.length - 1], 1),
      hourSharePct: byHour.map((n) => round((n / top.length) * 100, 1)),
      weekendSharePct: round((top.filter((r) => r.weekend).length / top.length) * 100, 1),
    });
  }
  return out;
}

/** Monthly overnight (12–4 AM) demand floor per meter: median of nightly averages. */
export function meterBaseload(intervals, { months = BASELOAD_MONTHS } = {}) {
  const columns = ["meterId", "month", "overnightKw", "weekdayDaytimeKw", "nights"];
  const rows = [];
  for (const [meterId, { byDate }] of intervals) {
    const byMonth = new Map();
    for (const [date, values] of byDate) {
      const month = date.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, { nights: [], days: [] });
      const night = values.slice(...OVERNIGHT_INTERVALS);
      if (night.every((v) => v != null)) {
        byMonth.get(month).nights.push(night.reduce((a, b) => a + b, 0) / night.length);
      }
      if (![0, 6].includes(dayOfWeek(date))) {
        const day = values.slice(40, 60).filter((v) => v != null); // 10 AM – 3 PM
        if (day.length) byMonth.get(month).days.push(day.reduce((a, b) => a + b, 0) / day.length);
      }
    }
    for (const month of [...byMonth.keys()].sort().slice(-months)) {
      const m = byMonth.get(month);
      if (!m.nights.length) continue;
      rows.push([meterId, month, round(median(m.nights), 1), round(median(m.days), 1), m.nights.length]);
    }
  }
  return { columns, rows };
}

// ─── client-entered events ──────────────────────────────────────────────────

function unionMinutes(spans) {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of sorted) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

function modeWindow(windows) {
  const counts = new Map();
  for (const w of windows) {
    const key = `${w.start}-${w.end}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  for (const [key, n] of counts) if (!best || n > best.n) best = { key, n };
  if (!best) return null;
  const [start, end] = best.key.split("-").map(Number);
  return { start, end };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayList(days) {
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const key = sorted.join(",");
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "1,2,3,4,5,6,0") return "Every day";
  if (key === "6,0") return "Sat–Sun";
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}

/**
 * Client-entered events → recurring series, per-building weekly windows, and
 * week-over-week changes in each building's typical weekday hours.
 */
export function summarizeEvents(events, { topology, buildings, roomCollections, timeZone, weeks }) {
  const buildingName = new Map(buildings.map((b) => [b.buildingId, b.name]));
  const buildingDevices = new Map(buildings.map((b) => [b.buildingId, b.deviceCount]));
  const collectionRooms = new Map((roomCollections || []).map((c) => [c.Id, parseIdList(c.Rooms)]));
  const weekSet = new Set(weeks);

  const series = new Map();
  const perBuildingDay = new Map(); // building → date → { spans, events }

  for (const ev of events || []) {
    const startMs = Date.parse(ev.StartDate);
    const endMs = Date.parse(ev.EndDate);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const start = localParts(startMs, timeZone);
    const week = mondayOf(start.date);
    if (!weekSet.has(week)) continue;
    const durationMin = Math.round((endMs - startMs) / 60000);

    const rooms = new Set(parseIdList(ev.Resources));
    for (const c of parseIdList(ev.RoomCollections)) for (const r of collectionRooms.get(c) || []) rooms.add(r);
    const devices = new Set();
    for (const r of rooms) {
      const d = topology.roomDevice.get(Number(r));
      if (d != null) devices.add(d);
    }
    const buildingIds = new Set([...devices].map((d) => topology.deviceBuilding.get(d)).filter((b) => b != null));

    const end = localParts(endMs, timeZone);
    const key = `${ev.Id}|${clock(start.minutes)}|${ev.AllDay ? "all" : durationMin}`;
    if (!series.has(key)) {
      series.set(key, {
        name: ev.EventName || null,
        start: ev.AllDay ? null : clock(start.minutes),
        end: ev.AllDay ? null : clock(end.minutes),
        hours: ev.AllDay ? 24 : round(durationMin / 60, 2),
        allDay: Boolean(ev.AllDay),
        recurring: Boolean(ev.RecurrenceRule),
        isDehumid: Boolean(Number(ev.IsDehumid)),
        coolSetpoint: ev.CoolingSetpoint ?? null,
        heatSetpoint: ev.HeatingSetpoint ?? null,
        days: new Set(),
        weeks: new Set(),
        occurrences: 0,
        devices: new Set(),
        buildings: new Set(),
      });
    }
    const s = series.get(key);
    s.days.add(start.dayOfWeek);
    s.weeks.add(week);
    s.occurrences += 1;
    for (const d of devices) s.devices.add(d);
    for (const b of buildingIds) s.buildings.add(b);

    // Split the event across local days so overnight events count on each day.
    for (const b of buildingIds.size ? buildingIds : [null]) {
      let cursor = startMs;
      while (cursor < endMs) {
        const p = localParts(cursor, timeZone);
        const dayEndMs = cursor + (1440 - p.minutes) * 60000;
        const spanEnd = Math.min(endMs, dayEndMs);
        const minutesEnd = p.minutes + Math.round((spanEnd - cursor) / 60000);
        if (!perBuildingDay.has(b)) perBuildingDay.set(b, new Map());
        const days = perBuildingDay.get(b);
        if (!days.has(p.date)) days.set(p.date, { spans: [], events: 0 });
        days.get(p.date).spans.push([p.minutes, minutesEnd]);
        days.get(p.date).events += 1;
        cursor = spanEnd;
      }
    }
  }

  const seriesRows = [...series.values()]
    .map((s) => {
      const covered = [...s.buildings].reduce((n, b) => n + (buildingDevices.get(b) || 0), 0);
      return {
        name: s.name,
        days: dayList(s.days),
        start: s.start,
        end: s.end,
        hours: s.hours,
        allDay: s.allDay,
        recurring: s.recurring,
        isDehumid: s.isDehumid,
        coolSetpoint: s.coolSetpoint,
        heatSetpoint: s.heatSetpoint,
        weeksSeen: s.weeks.size,
        firstWeek: [...s.weeks].sort()[0],
        lastWeek: [...s.weeks].sort().at(-1),
        occurrences: s.occurrences,
        deviceCount: s.devices.size,
        buildings: [...s.buildings].map((b) => buildingName.get(b)).filter(Boolean),
        buildingDeviceSharePct: covered ? round((s.devices.size / covered) * 100, 0) : null,
      };
    })
    .sort((a, b) => b.hours * b.deviceCount * b.occurrences - a.hours * a.deviceCount * a.occurrences);

  const weekColumns = [
    "building", "weekStart", "weekdaysScheduled", "typicalStart", "typicalEnd",
    "weekdayAvgHours", "weekendHours", "events",
  ];
  const weekRows = [];
  const changes = [];
  for (const [buildingId, days] of perBuildingDay) {
    const name = buildingId == null ? "No building" : buildingName.get(buildingId) || String(buildingId);
    const byWeek = new Map();
    for (const [date, d] of days) {
      const week = mondayOf(date);
      if (!weekSet.has(week)) continue;
      if (!byWeek.has(week)) byWeek.set(week, { windows: [], hours: [], weekend: 0, events: 0 });
      const w = byWeek.get(week);
      const minutes = unionMinutes(d.spans);
      w.events += d.events;
      if ([0, 6].includes(dayOfWeek(date))) w.weekend += minutes / 60;
      else {
        w.hours.push(minutes / 60);
        w.windows.push({ start: Math.min(...d.spans.map((x) => x[0])), end: Math.max(...d.spans.map((x) => x[1])) });
      }
    }
    let previous = null;
    for (const week of weeks) {
      const w = byWeek.get(week);
      if (!w) continue;
      const typical = modeWindow(w.windows);
      const avg = w.hours.length ? w.hours.reduce((a, b) => a + b, 0) / w.hours.length : 0;
      weekRows.push([
        name, week, w.hours.length, typical ? clock(typical.start) : null,
        typical ? clock(typical.end) : null, round(avg, 2), round(w.weekend, 1), w.events,
      ]);
      // A change needs a few school days on each side so holidays don't count.
      if (typical && w.hours.length >= 3) {
        if (
          previous &&
          (Math.abs(typical.start - previous.window.start) >= WINDOW_CHANGE_MIN ||
            Math.abs(typical.end - previous.window.end) >= WINDOW_CHANGE_MIN)
        ) {
          const fromHours = (previous.window.end - previous.window.start) / 60;
          const toHours = (typical.end - typical.start) / 60;
          changes.push({
            building: name,
            weekStart: week,
            fromWeek: previous.week,
            from: `${clock(previous.window.start)}–${clock(previous.window.end)}`,
            to: `${clock(typical.start)}–${clock(typical.end)}`,
            fromHours: round(fromHours, 2),
            toHours: round(toHours, 2),
            changePct: fromHours ? round(((toHours - fromHours) / fromHours) * 100, 1) : null,
          });
        }
        previous = { week, window: typical };
      }
    }
  }
  weekRows.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : String(a[0]).localeCompare(String(b[0]))));

  return {
    weeks,
    series: seriesRows.slice(0, MAX_SERIES),
    seriesTotal: seriesRows.length,
    buildingWeeks: { columns: weekColumns, rows: weekRows },
    changes,
  };
}

/** Week starts (Mondays) from EVENT_WEEKS_BACK before this week through EVENT_WEEKS_AHEAD after. */
export function eventWeeks(todayKey, back = EVENT_WEEKS_BACK, ahead = EVENT_WEEKS_AHEAD) {
  const monday = mondayOf(todayKey);
  const weeks = [];
  for (let i = -back; i <= ahead; i++) weeks.push(addDays(monday, i * 7));
  return weeks;
}

// ─── weather ────────────────────────────────────────────────────────────────

/**
 * Daily highs and lows for every weather city the client's meters use, from
 * CO's weather store (the same source the savings workbook's degree days come
 * from), so any bill period's degree days can be recomputed.
 */
export async function loadWeather(meters, { now = new Date() } = {}) {
  const cityIds = [...new Set((meters || []).map((m) => m.WeatherCityId).filter((id) => id != null))];
  if (!cityIds.length) return null;
  const start = `${now.getUTCFullYear() - WEATHER_YEARS}-01-01`;
  const cities = [];
  const rows = [];
  for (const id of cityIds) {
    const [city, actual] = await Promise.all([getWeatherCity(id), getActualWeather(id, start)]);
    cities.push({
      cityId: id,
      name: city?.name ?? null,
      state: city?.state ?? null,
      station: city?.weather_station_name ?? null,
      stationId: city?.call_sign ?? city?.WBAN ?? null,
    });
    for (const r of actual || []) {
      const date = String(r.Date ?? "").slice(0, 10);
      const high = Number(r.High);
      const low = Number(r.Low);
      if (date && Number.isFinite(high) && Number.isFinite(low)) rows.push([id, date, high, low]);
    }
  }
  rows.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return { source: "Campus Optimizer weather (dev_i3_weather.actual)", cities, daily: { columns: ["cityId", "date", "highF", "lowF"], rows } };
}

// ─── entry point ────────────────────────────────────────────────────────────

/**
 * @param {number|string} clientId
 * @param {{ report: object, timeZone?: string, now?: Date, onProgress?: Function }} options
 */
export async function buildReportInsights(clientId, { report, timeZone, now = new Date(), onProgress } = {}) {
  const progress = (stage, message, extra) => onProgress?.({ stage, message, ...extra });
  const zone = timeZone || report?.meta?.timeZone || DEFAULT_SCHEDULE_TIME_ZONE;
  const client = Number(clientId);
  const weeks = eventWeeks(localParts(now.getTime(), zone).date);
  const fetchStart = addDays(weeks[0], -1);
  const fetchEnd = addDays(weeks.at(-1), 8);

  progress("insights-start", "Loading buildings, demand targets, and events");
  const settle = (p, label) =>
    p.catch((err) => {
      console.warn(`[report-insights] ${label} failed: ${err.message}`);
      return null;
    });
  const [hierarchy, buildingsRaw, buildingTypes, meters, utilityTypes, targets, lrOptions, roomCollections, events] =
    await Promise.all([
      settle(getHierarchy(client), "hierarchy"),
      settle(getBuildings(client), "buildings"),
      settle(getBuildingTypes(), "building types"),
      settle(getMeters(client), "meters"),
      settle(getUtilityTypes(), "utility types"),
      settle(getDemandTargets(client), "demand targets"),
      settle(getLoadRollingOptions(), "load rolling options"),
      settle(getRoomCollections(client), "room collections"),
      settle(getSchedulerEvents(client, fetchStart, fetchEnd), "events"),
    ]);

  const topology = buildTopology({ hierarchy, buildings: buildingsRaw, meters, utilityTypes });
  const meterNames = new Map((meters || []).map((m) => [m.Id, m.Name]));
  const buildings = buildingRows(buildingsRaw, buildingTypes, topology, meterNames);
  const targetRows = demandTargetRows(targets, lrOptions);

  const intervals = intervalKwByMeter(report?.energy?.actual);
  const starts = startsByMeterDate(report?.devices, topology);

  const insights = {
    version: 1,
    timeZone: zone,
    buildings,
    meters: meterRows(meters, utilityTypes, buildings),
    demandTargets: targetRows,
    meterDailyPeaks: meterDailyPeaks(intervals, starts, appliedTargetIndex(report?.energy?.appliedDemandTargets)),
    meterPeakHours: meterPeakHours(intervals),
    meterBaseload: meterBaseload(intervals),
    events: Array.isArray(events)
      ? summarizeEvents(events, { topology, buildings, roomCollections, timeZone: zone, weeks })
      : null,
    weather: await loadWeather(meters, { now }).catch((err) => {
      console.warn(`[report-insights] weather failed: ${err.message}`);
      return null;
    }),
    // [CO device id, building id] so thermostat-level data can be read by building.
    deviceBuildings: {
      columns: ["deviceId", "buildingId"],
      rows: [...topology.deviceBuilding].filter(([, b]) => b != null),
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(insights), "utf8");
  progress("insights-done", "Per-meter demand, baseload, and events ready", { bytes });
  return insights;
}
