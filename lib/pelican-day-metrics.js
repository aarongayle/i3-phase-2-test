/**
 * Per-thermostat daily metrics derived from raw Pelican history entries.
 *
 * The daily summary (pelican-history summarizeThermostatDay) keeps runtime,
 * occupied time and setpoint ranges, then discards the raw readings. These
 * metrics keep what troubleshooting needs from those readings: comfort,
 * humidity, setpoint changes made at the thermostat, compressor staging,
 * overnight runtime, supply-air temperature, and plant-loop sensors.
 *
 * Entries are change-based samples: each one holds until the next timestamp.
 */

const OVERNIGHT_START_MIN = 22 * 60; // 22:00
const OVERNIGHT_END_MIN = 3 * 60; // 03:00 — before morning warm-up ramps
const DAYTIME_START_MIN = 10 * 60;
const DAYTIME_END_MIN = 15 * 60;
const COMFORT_TOLERANCE_F = 1;
const UNOCCUPIED_HEAT_MAX_F = 55;
const UNOCCUPIED_COOL_MIN_F = 85;

function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function minuteOfDay(timestamp) {
  const match = /T(\d{2}):(\d{2})/.exec(String(timestamp || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function round1(value) {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Split an entry list into intervals with a duration in minutes. */
function toIntervals(entries) {
  const sorted = entries
    .filter((e) => minuteOfDay(e?.timestamp) !== null)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  return sorted.map((entry, i) => {
    const start = minuteOfDay(entry.timestamp);
    const end = i + 1 < sorted.length ? minuteOfDay(sorted[i + 1].timestamp) : 24 * 60;
    return { entry, start, minutes: Math.max(0, end - start) };
  });
}

function stageKind(runStatus) {
  const s = String(runStatus || "").toLowerCase();
  if (s.includes("cool")) return "cool";
  if (s.includes("heat")) return "heat";
  return null;
}

function isOvernight(minute) {
  return minute >= OVERNIGHT_START_MIN || minute < OVERNIGHT_END_MIN;
}

function slaveValue(entry, pattern) {
  const slaves = Array.isArray(entry?.slaves) ? entry.slaves : [];
  const hit = slaves.find((s) => pattern.test(String(s?.name || "")) || pattern.test(String(s?.type || "")));
  return hit ? num(hit.value) : null;
}

/**
 * @param {Array<object>} entries - raw ThermostatHistory rows for one thermostat and day
 * @param {(entry: object) => boolean} isOccupied - same occupied rule as the daily summary
 * @returns {object|null}
 */
export function computeDayMetrics(entries, isOccupied) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return null;
  const intervals = toIntervals(list);
  if (!intervals.length) return null;

  const occupied = intervals.filter((iv) => isOccupied(iv.entry));
  const occupiedMinutes = occupied.reduce((s, iv) => s + iv.minutes, 0);

  // Occupied setpoints the schedule sets (baseline for "changed at the thermostat").
  const scheduled = occupied.filter((iv) => iv.entry.setBy === "Schedule");
  const schedCool = mode(scheduled.map((iv) => num(iv.entry.coolSetting)).filter((v) => v !== null && v < UNOCCUPIED_COOL_MIN_F));
  const schedHeat = mode(scheduled.map((iv) => num(iv.entry.heatSetting)).filter((v) => v !== null && v > UNOCCUPIED_HEAT_MAX_F));

  let comfortMissMinutes = 0;
  let tempMinutes = 0;
  let humidityWeighted = 0;
  let humidityMinutes = 0;
  let humidityMax = null;
  let setAtThermostatMinutes = 0;
  let coolRaisedMinutes = 0;
  let coolLoweredMinutes = 0;
  let heatRaisedMinutes = 0;
  let heatLoweredMinutes = 0;
  let maxCoolSet = null;
  let minCoolSet = null;

  for (const { entry, minutes } of occupied) {
    const temp = num(entry.temperature);
    const heat = num(entry.heatSetting);
    const cool = num(entry.coolSetting);
    if (temp !== null && temp > 0) {
      tempMinutes += minutes;
      // Only count a miss the thermostat is set up to fix: a heat-only unit
      // heater in "Heat" mode can't be "too warm", a "Cool" unit can't be "too cold".
      const system = String(entry.system || "").toLowerCase();
      const canHeat = system !== "cool" && system !== "off";
      const canCool = system !== "heat" && system !== "off";
      const tooCold = canHeat && heat !== null && heat > UNOCCUPIED_HEAT_MAX_F && temp < heat - COMFORT_TOLERANCE_F;
      const tooWarm = canCool && cool !== null && cool < UNOCCUPIED_COOL_MIN_F && temp > cool + COMFORT_TOLERANCE_F;
      if (tooCold || tooWarm) comfortMissMinutes += minutes;
    }
    const humidity = num(entry.humidity);
    if (humidity !== null && humidity > 0) {
      humidityWeighted += humidity * minutes;
      humidityMinutes += minutes;
      humidityMax = humidityMax === null ? humidity : Math.max(humidityMax, humidity);
    }
    if (entry.setBy && entry.setBy !== "Schedule") {
      setAtThermostatMinutes += minutes;
      if (schedCool !== null && cool !== null && cool < UNOCCUPIED_COOL_MIN_F) {
        if (cool > schedCool) {
          coolRaisedMinutes += minutes;
          maxCoolSet = maxCoolSet === null ? cool : Math.max(maxCoolSet, cool);
        } else if (cool < schedCool) {
          coolLoweredMinutes += minutes;
          minCoolSet = minCoolSet === null ? cool : Math.min(minCoolSet, cool);
        }
      }
      if (schedHeat !== null && heat !== null && heat > UNOCCUPIED_HEAT_MAX_F) {
        if (heat > schedHeat) heatRaisedMinutes += minutes;
        else if (heat < schedHeat) heatLoweredMinutes += minutes;
      }
    }
  }

  // Compressor calls: starts, starts straight into stage 2, overnight runtime.
  let callStarts = 0;
  let stage2DirectStarts = 0;
  let overnightRuntimeMinutes = 0;
  let overnightOccupiedRuntimeMinutes = 0;
  let fanOnMinutes = 0;
  let prevKind = null;
  const satHeat = [];
  const satCool = [];
  for (const { entry, start, minutes } of intervals) {
    const kind = stageKind(entry.runStatus);
    if (kind && kind !== prevKind) {
      callStarts += 1;
      if (/stage\s*2/i.test(String(entry.runStatus))) stage2DirectStarts += 1;
    }
    prevKind = kind;
    if (kind && isOvernight(start)) {
      overnightRuntimeMinutes += minutes;
      if (isOccupied(entry)) overnightOccupiedRuntimeMinutes += minutes;
    }
    const fan = String(entry.fan || "").toLowerCase();
    if (fan && fan !== "auto") fanOnMinutes += minutes;
    const sat = slaveValue(entry, /\bSAT\b|supply temperature/i);
    if (sat !== null && kind === "heat") satHeat.push([sat, minutes]);
    if (sat !== null && kind === "cool") satCool.push([sat, minutes]);
  }

  const weightedAvg = (pairs) => {
    const total = pairs.reduce((s, [, m]) => s + m, 0);
    return total > 0 ? pairs.reduce((s, [v, m]) => s + v * m, 0) / total : null;
  };

  // Plant-loop temperature monitors (e.g. "CHW Supply" / "CHW Return").
  const loopDay = [];
  let loopSupplyMin = null;
  for (const { entry, start, minutes } of intervals) {
    const supply = slaveValue(entry, /supply/i);
    const ret = slaveValue(entry, /return/i);
    const isMonitor = (entry.slaves || []).some((s) => /temp monitor/i.test(String(s?.type || "")));
    if (!isMonitor || supply === null) continue;
    loopSupplyMin = loopSupplyMin === null ? supply : Math.min(loopSupplyMin, supply);
    if (start >= DAYTIME_START_MIN && start < DAYTIME_END_MIN) loopDay.push([supply, ret, minutes]);
  }

  const metrics = {
    occupiedMinutes: Math.round(occupiedMinutes),
    comfortMissMinutes: tempMinutes > 0 ? Math.round(comfortMissMinutes) : null,
    humidityAvg: humidityMinutes > 0 ? round1(humidityWeighted / humidityMinutes) : null,
    humidityMax,
    scheduledOccupiedCool: schedCool,
    scheduledOccupiedHeat: schedHeat,
    setAtThermostatMinutes: Math.round(setAtThermostatMinutes),
    coolRaisedMinutes: Math.round(coolRaisedMinutes),
    coolLoweredMinutes: Math.round(coolLoweredMinutes),
    heatRaisedMinutes: Math.round(heatRaisedMinutes),
    heatLoweredMinutes: Math.round(heatLoweredMinutes),
    maxCoolSetAtThermostat: maxCoolSet,
    minCoolSetAtThermostat: minCoolSet,
    callStarts,
    stage2DirectStarts,
    overnightRuntimeMinutes: Math.round(overnightRuntimeMinutes),
    overnightOccupiedRuntimeMinutes: Math.round(overnightOccupiedRuntimeMinutes),
    fanOnMinutes: Math.round(fanOnMinutes),
    supplyAirHeatAvg: round1(weightedAvg(satHeat)),
    supplyAirCoolAvg: round1(weightedAvg(satCool)),
  };

  if (loopDay.length || loopSupplyMin !== null) {
    const total = loopDay.reduce((s, [, , m]) => s + m, 0);
    metrics.loop = {
      supplyDaytimeAvg: total > 0 ? round1(loopDay.reduce((s, [v, , m]) => s + v * m, 0) / total) : null,
      returnDaytimeAvg:
        total > 0 && loopDay.every(([, r]) => r !== null)
          ? round1(loopDay.reduce((s, [, r, m]) => s + r * m, 0) / total)
          : null,
      supplyMin: loopSupplyMin,
    };
  }

  return metrics;
}
