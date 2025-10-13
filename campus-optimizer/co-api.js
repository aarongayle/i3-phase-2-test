import dotenv from "dotenv";
dotenv.config();

const uri = `https://${process.env.CO_ENVIRONMENT}.idealimpactinc.com/api`;

// Client-based rate limits (queries-per-second). Adjust per clientId as needed.
const CLIENT_QPS = {
  1841: 10,
};
const DEFAULT_QPS = 10;
const GLOBAL_QPS = 10; // For endpoints without a client parameter

// Simple per-key rate limiter using a FIFO queue spaced by intervalMs
const _rateLimiterState = new Map(); // key -> { intervalMs, lastRunMs, queue, running }

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
  // If interval changed, update it
  state.intervalMs = intervalMs;
  return state;
}

function _runQueue(state) {
  if (state.queue.length === 0) {
    state.running = false;
    return;
  }
  const now = Date.now();
  const waitMs = Math.max(0, state.lastRunMs + state.intervalMs - now);
  setTimeout(async () => {
    const item = state.queue.shift();
    state.lastRunMs = Date.now();
    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
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
  const qps =
    clientKey === "__global__"
      ? GLOBAL_QPS
      : CLIENT_QPS[clientKey] || DEFAULT_QPS;
  const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, qps)));
  return _enqueueWithRateLimit(clientKey, intervalMs, async () => {
    if (options?.label) {
      console.log(`fetching ${options.label}`);
    }
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `${process.env.CO_MASTER_KEY}`,
        },
      });
      if (options?.label) {
        console.log(`fetched ${options.label}`);
      }
      return res;
    } catch (error) {
      if (options?.label) {
        console.log(`failed ${options.label}: ${String(error)}`);
      }
      throw error;
    }
  });
}

export async function getReportDates(client) {
  const response = await coFetch(
    `${uri}/optimal-schedules/dates?client=${client}`
  );
  const data = await response.json();
  return data;
}

export async function getOptimalSchedules(client, date, options) {
  const response = await coFetch(
    `${uri}/optimal-schedules?client=${client}&date=${date}`,
    options
  );
  const bodyText = await response.text();
  if (bodyText === "no schedule") {
    return [];
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch optimal schedules (${response.status}): ${bodyText.slice(
        0,
        200
      )}`
    );
  }
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`Unable to parse optimal schedules JSON: ${String(error)}`);
  }
}

export async function getDevices(client) {
  const response = await coFetch(
    `${uri}/project/devices?client=${client}&all=true`
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
    // Stream through in the provided order; capture first 96 entries per meter
    for (const row of Array.isArray(rows) ? rows : []) {
      const meterId =
        row?.meter_id ?? row?.MeterId ?? row?.MeterID ?? row?.meterID;
      if (meterId == null) continue;
      if (!perMeter.has(meterId)) perMeter.set(meterId, []);
      const arr = perMeter.get(meterId);
      if (arr.length < 96) arr.push(valueFromRow(row));
    }
    reportToMeterValues.set(dateKey, perMeter);
  });

  // 4) Precompute mapping from calendar date -> latest report date <= that day
  const uniqueDates = new Set();
  actual.forEach((m) =>
    (m.Interval || []).forEach((pt) => uniqueDates.add(pt.date))
  );
  const uniqueSortedDates = Array.from(uniqueDates).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  const dateToReport = new Map();
  let j = 0; // pointer into reportDays
  uniqueSortedDates.forEach((day) => {
    while (
      j + 1 < reportDays.length &&
      new Date(reportDays[j + 1]) <= new Date(day)
    ) {
      j += 1;
    }
    // If the first report is after the day, use the first report as fallback
    if (new Date(reportDays[0]) > new Date(day)) {
      dateToReport.set(day, reportDays[0]);
    } else {
      dateToReport.set(day, reportDays[j]);
    }
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
  const result = metersData.map(({ Id, Name }) => {
    const meterIntervals = data.find(({ meterName }) => meterName === Name);
    const byYear = meterIntervals?.data || {};
    const flat = [];
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

export const BUILDING_TYPE = 2;
export const METER_TYPE = 3;
export const GROUP_TYPE = 4;
export const DEVICE_TYPE = 5;
export const ROOM_TYPE = 8;

export async function getBuildings(client) {
  const response = await coFetch(
    `${uri}/project/buildings?client=${client}&all=true`
  );
  const data = await response.json();
  return data;
}

export async function getMeters(client) {
  const response = await coFetch(
    `${uri}/project/meters?client=${client}&all=true`
  );
  const data = await response.json();
  return data;
}

export async function getGroups(client) {
  const response = await coFetch(
    `${uri}/project/groups?client=${client}&all=true`
  );
  const data = await response.json();
  return data;
}

export async function getRooms(client) {
  const response = await coFetch(
    `${uri}/project/rooms?client=${client}&all=true`
  );
  const data = await response.json();
  return data;
}

export function getNode(hierarchy, id, type) {
  return hierarchy.find(
    ({ ElementTableId, CategoryId }) =>
      ElementTableId === id && CategoryId === type
  );
}

export async function getDescendants(hierarchy, element, elementType, type) {
  const results = [];
  const node = getNode(hierarchy, element.Id, elementType);

  const elements =
    type === BUILDING_TYPE
      ? await getBuildings(node.ClientId)
      : type === METER_TYPE
      ? await getMeters(node.ClientId)
      : type === GROUP_TYPE
      ? await getGroups(node.ClientId)
      : type === ROOM_TYPE
      ? await getRooms(node.ClientId)
      : [];

  function getChildren(hierarchy, node, type) {
    const result = [];
    const children = hierarchy.filter(
      ({ ParentElementTableId, ParentCategoryId }) =>
        ParentElementTableId === node.ElementTableId &&
        ParentCategoryId === node.CategoryId
    );
    console.log(children);
    for (const child of children) {
      if (child.CategoryId === type) {
        result.push(child);
      }
      result.push(...getChildren(hierarchy, child, type));
    }
    return result;
  }

  const children = getChildren(hierarchy, node, type);
  for (const child of children) {
    results.push(child);
    results.push(...getChildren(hierarchy, child, type));
  }

  return results.map(({ ElementTableId }) =>
    elements.find(({ Id }) => Id === ElementTableId)
  );
}

export async function getAncestors(hierarchy, element, elementType, type) {
  const results = [];
  const startNode = getNode(hierarchy, element.Id, elementType);

  if (!startNode) {
    return results;
  }

  const elements =
    type === BUILDING_TYPE
      ? await getBuildings(startNode.ClientId)
      : type === METER_TYPE
      ? await getMeters(startNode.ClientId)
      : type === GROUP_TYPE
      ? await getGroups(startNode.ClientId)
      : type === ROOM_TYPE
      ? await getRooms(startNode.ClientId)
      : [];

  const visited = new Set();
  let current = startNode;

  while (
    current?.ParentElementTableId != null &&
    current?.ParentCategoryId != null
  ) {
    const key = `${current.ParentCategoryId}:${current.ParentElementTableId}`;
    if (visited.has(key)) {
      break;
    }
    visited.add(key);

    const parentNode = hierarchy.find(
      ({ ElementTableId, CategoryId }) =>
        ElementTableId === current.ParentElementTableId &&
        CategoryId === current.ParentCategoryId
    );

    if (!parentNode) {
      break;
    }

    if (parentNode.CategoryId === type) {
      results.push(parentNode);
    }

    current = parentNode;
  }

  return results
    .map(({ ElementTableId }) =>
      elements.find(({ Id }) => Id === ElementTableId)
    )
    .filter(Boolean);
}

export async function getHirearchy(client) {
  const response = await coFetch(`${uri}/hierarchy?client=${client}`);
  const data = await response.json();
  return data;
}

export async function getUnits() {
  const coolUnits = await coFetch(`${uri}/types/cool-units`);
  const coolSources = await coFetch(`${uri}/types/cool`);
  const heatUnits = await coFetch(`${uri}/types/heat-units`);
  const heatSources = await coFetch(`${uri}/types/heat`);
  const coolData = await coolUnits.json();
  const heatData = await heatUnits.json();
  const coolSourcesData = await coolSources.json();
  const heatSourcesData = await heatSources.json();
  const data = {
    cool: coolData,
    heat: heatData,
    coolSources: coolSourcesData,
    heatSources: heatSourcesData,
  };
  return data;
}

async function main() {
  const client = 1420;
  const hierarchy = await getHirearchy(client);
  const devices = await getDevices(client);
  const firstDevice = devices[1];

  const deviceBuildings = await getAncestors(
    hierarchy,
    firstDevice,
    DEVICE_TYPE,
    BUILDING_TYPE
  );

  console.log(deviceBuildings);
}

// main();
