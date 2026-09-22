/**
 * Compact Pelican rollups for reports and follow-up Q&A.
 *
 * Input is daily thermostat summaries (Supabase `pelican_daily_summaries` rows
 * mapped by rowToSummary, or live summaries). Output answers the questions the
 * report couldn't: every unit's runtime ÷ occupied time, per-building totals,
 * heating/cooling by building and month, and — when raw-reading metrics exist —
 * comfort, humidity, setpoint changes at the thermostat, staging, overnight
 * runtime and plant-loop temperatures.
 */

const HIDDEN_GROUP = "HIDDEN";
const MAX_LOOP_DAYS = 120;
const MAX_COMFORT_DAYS = 120;

const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const hours = (seconds) => (Number(seconds) || 0) / 3600;

function isWeekend(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function band(ratio) {
  if (ratio == null) return "noOccupied";
  if (ratio <= 50) return "le50";
  if (ratio <= 100) return "from50to100";
  return "over100";
}

function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * @param {Array<object>} summaries - daily thermostat summaries (date, serialNo, name, groupName, coolRuntime, heatRuntime, occupiedTime, metrics?)
 * @param {{ start?: string, end?: string }} [window]
 */
export function buildPelicanRollups(summaries, window = {}) {
  const rows = (summaries || []).filter(
    (s) =>
      s?.date &&
      s?.serialNo &&
      (s.entryCount ?? 1) > 0 &&
      (!window.start || s.date >= window.start) &&
      (!window.end || s.date <= window.end)
  );
  if (!rows.length) return null;

  const dates = Array.from(new Set(rows.map((s) => s.date))).sort();
  const units = new Map();
  const monthly = new Map();
  const loops = new Map();
  const comfortDaily = new Map();
  let daysWithMetrics = new Set();

  for (const s of rows) {
    const group = s.groupName || "Unknown";
    const m = s.metrics || null;

    if (group === HIDDEN_GROUP) {
      // Hidden devices are usually plant sensors (chilled / hot water loops).
      if (m?.loop) {
        const loop = loops.get(s.serialNo) || { name: s.name, serialNo: s.serialNo, days: [] };
        loop.days.push({ date: s.date, supplyDaytimeAvg: m.loop.supplyDaytimeAvg, returnDaytimeAvg: m.loop.returnDaytimeAvg, supplyMin: m.loop.supplyMin });
        loops.set(s.serialNo, loop);
      }
      continue;
    }

    const u =
      units.get(s.serialNo) ||
      { serialNo: s.serialNo, name: s.name, groupName: group, days: 0, coolH: 0, heatH: 0, occH: 0, unoccDayRunH: 0,
        metricDays: 0, comfortMiss: 0, comfortOcc: 0, humSum: 0, humDays: 0, humMax: null, raisedDays: 0, loweredDays: 0,
        stage2Direct: 0, callStarts: 0, overnightOccRunMin: 0, overnightRunDays: 0 };
    u.days += 1;
    const cool = hours(s.coolRuntime);
    const heat = hours(s.heatRuntime);
    const occ = hours(s.occupiedTime);
    u.coolH += cool;
    u.heatH += heat;
    u.occH += occ;
    if (occ === 0) u.unoccDayRunH += cool + heat;

    if (m) {
      daysWithMetrics.add(s.date);
      u.metricDays += 1;
      if (m.comfortMissMinutes != null && m.occupiedMinutes > 0) {
        u.comfortMiss += m.comfortMissMinutes;
        u.comfortOcc += m.occupiedMinutes;
      }
      if (m.humidityAvg != null) {
        u.humSum += m.humidityAvg;
        u.humDays += 1;
        u.humMax = u.humMax == null ? m.humidityMax : Math.max(u.humMax, m.humidityMax ?? 0);
      }
      if ((m.coolRaisedMinutes || 0) + (m.heatRaisedMinutes || 0) >= 15) u.raisedDays += 1;
      if ((m.coolLoweredMinutes || 0) + (m.heatLoweredMinutes || 0) >= 15) u.loweredDays += 1;
      u.stage2Direct += m.stage2DirectStarts || 0;
      u.callStarts += m.callStarts || 0;
      u.overnightOccRunMin += m.overnightOccupiedRuntimeMinutes || 0;
      if ((m.overnightOccupiedRuntimeMinutes || 0) >= 30) u.overnightRunDays += 1;

      if (!isWeekend(s.date) && m.occupiedMinutes > 0) {
        const key = `${s.date}|${group}`;
        const c = comfortDaily.get(key) || { date: s.date, groupName: group, miss: 0, occ: 0, humSum: 0, humN: 0 };
        c.miss += m.comfortMissMinutes || 0;
        c.occ += m.occupiedMinutes;
        if (m.humidityAvg != null) {
          c.humSum += m.humidityAvg;
          c.humN += 1;
        }
        comfortDaily.set(key, c);
      }
    }
    units.set(s.serialNo, u);

    const month = s.date.slice(0, 7);
    const mk = `${month}|${group}`;
    const mo = monthly.get(mk) || { month, groupName: group, unitDays: 0, heatH: 0, coolH: 0 };
    mo.unitDays += 1;
    mo.heatH += heat;
    mo.coolH += cool;
    monthly.set(mk, mo);
  }

  const unitList = Array.from(units.values()).map((u) => {
    const runH = u.coolH + u.heatH;
    const ratio = u.occH > 0 ? (runH / u.occH) * 100 : null;
    return {
      name: u.name,
      serialNo: u.serialNo,
      groupName: u.groupName,
      days: u.days,
      runtimeOverOccupiedPct: r1(ratio),
      band: band(ratio),
      runtimeH: r1(runH),
      coolH: r1(u.coolH),
      heatH: r1(u.heatH),
      occupiedH: r1(u.occH),
      unoccupiedDayRuntimeH: r1(u.unoccDayRunH),
      ...(u.metricDays
        ? {
            metricDays: u.metricDays,
            outsideSetpointPct: u.comfortOcc > 0 ? r1((u.comfortMiss / u.comfortOcc) * 100) : null,
            humidityAvg: u.humDays ? r1(u.humSum / u.humDays) : null,
            humidityMax: u.humMax,
            daysRaisedAtThermostat: u.raisedDays,
            daysLoweredAtThermostat: u.loweredDays,
            stage2DirectStartPct: u.callStarts ? r1((u.stage2Direct / u.callStarts) * 100) : null,
            overnightOccupiedRuntimeDays: u.overnightRunDays,
          }
        : {}),
    };
  });
  unitList.sort((a, b) => (b.runtimeOverOccupiedPct ?? -1) - (a.runtimeOverOccupiedPct ?? -1));

  const bands = { le50: 0, from50to100: 0, over100: 0, noOccupied: 0 };
  for (const u of unitList) bands[u.band] += 1;

  const groups = new Map();
  for (const u of unitList) {
    const g = groups.get(u.groupName) || { groupName: u.groupName, units: 0, runH: 0, occH: 0, heatH: 0, coolH: 0, ratios: [], over100: 0, miss: 0, occMetric: 0, hum: [] };
    g.units += 1;
    g.runH += u.runtimeH || 0;
    g.occH += u.occupiedH || 0;
    g.heatH += u.heatH || 0;
    g.coolH += u.coolH || 0;
    g.ratios.push(u.runtimeOverOccupiedPct);
    if (u.band === "over100") g.over100 += 1;
    const src = units.get(u.serialNo);
    g.miss += src.comfortMiss;
    g.occMetric += src.comfortOcc;
    if (u.humidityAvg != null) g.hum.push(u.humidityAvg);
    groups.set(u.groupName, g);
  }
  const groupList = Array.from(groups.values())
    .map((g) => ({
      groupName: g.groupName,
      units: g.units,
      runtimeOverOccupiedPct: g.occH > 0 ? r1((g.runH / g.occH) * 100) : null,
      medianUnitPct: r1(median(g.ratios)),
      unitsOver100: g.over100,
      heatH: r1(g.heatH),
      coolH: r1(g.coolH),
      outsideSetpointPct: g.occMetric > 0 ? r1((g.miss / g.occMetric) * 100) : null,
      humidityAvg: g.hum.length ? r1(g.hum.reduce((a, b) => a + b, 0) / g.hum.length) : null,
    }))
    .sort((a, b) => (b.runtimeOverOccupiedPct ?? -1) - (a.runtimeOverOccupiedPct ?? -1));

  const monthlyList = Array.from(monthly.values())
    .map((m) => ({
      month: m.month,
      groupName: m.groupName,
      heatHPerUnitDay: r1(m.heatH / m.unitDays) ?? 0,
      coolHPerUnitDay: r1(m.coolH / m.unitDays) ?? 0,
      unitDays: m.unitDays,
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.groupName.localeCompare(b.groupName));

  const comfortList = Array.from(comfortDaily.values())
    .map((c) => ({
      date: c.date,
      groupName: c.groupName,
      outsideSetpointPct: c.occ > 0 ? r1((c.miss / c.occ) * 100) : null,
      humidityAvg: c.humN ? r1(c.humSum / c.humN) : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_COMFORT_DAYS * Math.max(1, groups.size));

  const loopList = Array.from(loops.values()).map((l) => ({
    ...l,
    days: l.days.sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_LOOP_DAYS),
  }));

  return {
    version: 1,
    window: { start: dates[0], end: dates[dates.length - 1], days: dates.length },
    rawMetricsCoverage: { days: daysWithMetrics.size, firstDate: [...daysWithMetrics].sort()[0] ?? null },
    bands,
    units: unitList,
    groups: groupList,
    monthly: monthlyList,
    comfortDaily: comfortList,
    plantLoops: loopList,
  };
}
