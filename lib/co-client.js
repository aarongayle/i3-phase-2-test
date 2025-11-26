// Campus Optimizer API Client
// Edge-compatible version (no Node.js specific features)

import dotenv from "dotenv";
dotenv.config();

const uri = `https://${process.env.CO_ENVIRONMENT}.idealimpactinc.com/api`;

// Rate limiting state (persists across warm function invocations)
const _rateLimiterState = new Map();

function _getLimiterState(key, intervalMs) {
  if (!_rateLimiterState.has(key)) {
    _rateLimiterState.set(key, {
      intervalMs,
      lastRunMs: 0,
      queue: [],
      running: false,
    });
  }
  const state = _rateLimiterState.get(key);
  state.intervalMs = intervalMs;
  return state;
}

function _runQueue(state) {
  if (state.queue.length === 0) {
    state.running = false;
    console.log(`[Rate Limiter] Queue empty, stopping`);
    return;
  }
  const now = Date.now();
  const waitMs = Math.max(0, state.lastRunMs + state.intervalMs - now);

  setTimeout(async () => {
    const item = state.queue.shift();
    const remaining = state.queue.length;
    if (remaining % 50 === 0 || remaining < 5) {
      console.log(
        `[Rate Limiter] Processing request, ${remaining} remaining in queue`
      );
    }
    state.lastRunMs = Date.now();
    try {
      const result = await Promise.race([
        item.task(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Request timeout after 10s")),
            10000
          )
        ),
      ]);
      item.resolve(result);
    } catch (error) {
      console.error(`[Rate Limiter] Task failed:`, error.message);
      item.reject(error);
    } finally {
      _runQueue(state);
    }
  }, waitMs);
}

function _enqueueWithRateLimit(key, intervalMs, task) {
  const state = _getLimiterState(key, intervalMs);
  return new Promise((resolve, reject) => {
    state.queue.push({ task, resolve, reject });
    if (!state.running) {
      state.running = true;
      _runQueue(state);
    }
  });
}

function _extractClientKeyFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const clientParam = url.searchParams.get("client");
    return clientParam || "__global__";
  } catch (_e) {
    return "__global__";
  }
}

async function coFetch(url, options = {}) {
  const clientKey = _extractClientKeyFromUrl(url);
  const qps = 10; // Queries per second
  const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, qps)));

  return _enqueueWithRateLimit(clientKey, intervalMs, async () => {
    const res = await fetch(url, {
      headers: {
        Authorization: `${process.env.CO_MASTER_KEY}`,
      },
    });
    return res;
  });
}

export async function getReportDates(client) {
  const response = await coFetch(
    `${uri}/optimal-schedules/dates?client=${client}`
  );
  const data = await response.json();
  return data;
}

export async function getOptimalSchedules(client, date) {
  try {
    const response = await coFetch(
      `${uri}/optimal-schedules?client=${client}&date=${date}`
    );
    const bodyText = await response.text();

    if (bodyText === "no schedule") {
      return [];
    }

    if (!response.ok) {
      console.error(
        `Failed to fetch schedule for ${date}: ${response.status} ${response.statusText}`
      );
      throw new Error(`Failed to fetch optimal schedules (${response.status})`);
    }

    return JSON.parse(bodyText);
  } catch (error) {
    console.error(
      `Error in getOptimalSchedules for date ${date}:`,
      error.message
    );
    throw error;
  }
}

export async function getDevices(client) {
  const response = await coFetch(
    `${uri}/project/devices?client=${client}&all=true`
  );
  const data = await response.json();
  return data;
}

export async function getBuildings(client) {
  const response = await coFetch(
    `${uri}/project/buildings?client=${client}&all=true`
  );
  const data = await response.json();
  return data;
}

export async function expectedEnergyUse(client) {
  // 1) Load actuals to mirror the exact output shape (per meter, flat Interval list)
  const actual = await actualEnergyUse(client);

  // 2) Get all report dates, normalized and sorted asc (YYYY-MM-DD)
  const reportDatesRaw = await getReportDates(client);
  const reportDays = Array.from(
    new Set(
      (reportDatesRaw || [])
        .map((d) => d?.report_date)
        .filter(Boolean)
        .map((s) => String(s).split("T")[0])
    )
  ).sort((a, b) => new Date(a) - new Date(b));

  if (reportDays.length === 0) {
    // No reports; return zeros aligned to actuals
    return actual.map(({ Id, Name, Interval }) => ({
      Id,
      Name,
      Interval: (Interval || []).map(({ date, interval }) => ({
        date,
        interval,
        value: 0,
      })),
    }));
  }

  // 3) Fetch schedule-details for each report date and extract first 96 values per meter
  const schedulesByDate = await Promise.all(
    reportDays.map((d, i) =>
      coFetch(`${uri}/schedule-details?client=${client}&date=${d}`, {
        label: `schedule-details ${i + 1}/${reportDays.length}`,
      }).then((res) => res.json())
    )
  );

  // Helper to coerce value from a schedule-details row
  function valueFromRow(row) {
    const candidates = [row?.total_demand_LR, row?.total_demand];
    for (const v of candidates) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  // Build: reportDate -> Map(meterId -> first96Values[])
  const reportToMeterValues = new Map();
  schedulesByDate.forEach((rows, idx) => {
    const dateKey = reportDays[idx];
    const perMeter = new Map();
    const byMeter = new Map();
    for (const row of rows || []) {
      const id = row?.meter_id;
      if (!id) continue;
      if (!byMeter.has(id)) byMeter.set(id, []);
      byMeter.get(id).push(row);
    }
    for (const [id, meterRows] of byMeter.entries()) {
      perMeter.set(id, meterRows.slice(0, 96).map(valueFromRow));
    }
    reportToMeterValues.set(dateKey, perMeter);
  });

  // 4) Build a map: calendar-day -> nearest-report-day (for days missing reports)
  const allDaysSet = new Set();
  for (const { Interval } of actual) {
    for (const { date } of Interval || []) {
      allDaysSet.add(date);
    }
  }
  const allDays = Array.from(allDaysSet).sort(
    (a, b) => new Date(a) - new Date(b)
  );
  const dateToReport = new Map();
  allDays.forEach((day) => {
    let closest = reportDays[0];
    let minDiff = Math.abs(new Date(day) - new Date(reportDays[0]));
    for (let j = 1; j < reportDays.length; j++) {
      const diff = Math.abs(new Date(day) - new Date(reportDays[j]));
      if (diff < minDiff) {
        minDiff = diff;
        closest = reportDays[j];
      }
    }
    dateToReport.set(day, closest);
  });

  // 5) Build expected output in the same shape as actuals
  const expected = actual.map(({ Id, Name, Interval }) => {
    const out = [];
    for (const { date, interval } of Interval || []) {
      const reportForDay = dateToReport.get(date) || reportDays[0];
      const perMeter = reportToMeterValues.get(reportForDay);
      const values96 = perMeter?.get(Id) || [];
      const idx = Number(interval);
      const value =
        Number.isFinite(idx) && idx >= 0 && idx < values96.length
          ? values96[idx] * 0.25 // convert kW (15-min) to kWh
          : 0;
      out.push({ date, interval, value });
    }
    return { Id, Name, Interval: out };
  });

  return expected;
}

export async function actualEnergyUse(client) {
  const meters = await coFetch(`${uri}/project/meters?client=${client}`);
  const metersData = await meters.json();
  const response = await coFetch(`${uri}/trends/interval?client=${client}`);
  const data = await response.json();

  function pad(n) {
    const num = Number(n);
    return num.toString().padStart(2, "0");
  }

  function normalizedDate(y, m, d) {
    const yearNum = Number(y);
    const monthZero = Number(m);
    const dayZero = Number(d);
    if (
      !Number.isFinite(yearNum) ||
      !Number.isFinite(monthZero) ||
      !Number.isFinite(dayZero)
    )
      return null;
    // Source data uses 0-indexed month and day; convert to calendar values
    const monthNum = monthZero + 1;
    const dayNum = dayZero + 1;
    // Validate with Date
    const dt = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
    if (
      dt.getUTCFullYear() !== yearNum ||
      dt.getUTCMonth() + 1 !== monthNum ||
      dt.getUTCDate() !== dayNum
    ) {
      return null;
    }
    return `${yearNum}-${pad(monthNum)}-${pad(dayNum)}`;
  }

  const result = metersData.map(({ Id, Name }) => {
    const meterIntervals = data.find(({ meterName }) => meterName === Name);
    const byYear = meterIntervals?.data || {};
    const flat = [];

    for (const [year, byMonth] of Object.entries(byYear)) {
      for (const [month, byDay] of Object.entries(byMonth)) {
        for (const [day, byInterval] of Object.entries(byDay)) {
          const date = normalizedDate(year, month, day);
          if (!date) continue; // skip invalid combos after normalization
          for (const [intervalKey, value] of Object.entries(byInterval)) {
            const interval = Number.isFinite(Number(intervalKey))
              ? Number(intervalKey)
              : intervalKey;
            flat.push({ date, interval, value });
          }
        }
      }
    }

    return {
      Id,
      Name,
      Interval: flat,
    };
  });

  return result;
}

export async function getUnits() {
  const [coolUnits, heatUnits] = await Promise.all([
    coFetch(`${uri}/types/cool-units`).then((r) => r.json()),
    coFetch(`${uri}/types/heat-units`).then((r) => r.json()),
  ]);

  return {
    cool: coolUnits,
    heat: heatUnits,
  };
}
