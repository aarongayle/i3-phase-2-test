// Express Route: GET /api/pelican/history/:clientId
// Returns ALL thermostat history for a site/date in a single response.
// The Pelican API always returns all thermostats, so we pass them all to the client.

import { Router } from "express";
import { getBuildings } from "../../campus-optimizer/co-api.js";
import { DEFAULT_HISTORY_FIELDS } from "../../pelican/history.js";
import supabase from "../lib/supabase-client.js";

const router = Router();
const SUPABASE_DAILY_TABLE = "pelican_daily_summaries";
const SUPABASE_THERMOSTAT_TABLE = "pelican_thermostats";
const isSupabaseEnabled = Boolean(supabase);
const THERMOSTAT_VALUE_TEMPLATE = Object.freeze({
  serialNo: "",
  maxHeatSetting: "",
  minCoolSetting: "",
});

// History value template (matching pelican/history.js)
const HISTORY_VALUE_TEMPLATE = Object.freeze({
  timestamp: "",
  name: "",
  groupName: "",
  serialNo: "",
  system: "",
  heatSetting: "",
  coolSetting: "",
  fan: "",
  status: "",
  temperature: "",
  humidity: "",
  humidifySetting: "",
  dehumidifySetting: "",
  co2Setting: "",
  co2Level: "",
  setBy: "",
  frontKeypad: "",
  runStatus: "",
  auxStatus: "",
  slaves: "",
  setback: "",
});

/**
 * Build history transaction for Pelican API
 */
function buildHistoryTransaction(selection, fields) {
  let value;
  if (Array.isArray(fields) && fields.length > 0) {
    value = Object.fromEntries(
      fields.map((field) => [field, HISTORY_VALUE_TEMPLATE[field] ?? ""])
    );
  } else {
    value = { ...HISTORY_VALUE_TEMPLATE };
  }
  return [
    {
      request: "get",
      object: "ThermostatHistory",
      selection,
      value,
    },
  ];
}

/**
 * Convert date to Pelican datetime format (YYYY-MM-DDTHH:mm:ss)
 */
function toPelicanDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Parse a YYYY-MM-DD date string as local midnight (not UTC)
 */
function parseLocalDate(dateStr) {
  // Parse as local date by using the Date constructor with explicit parts
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed
}

function toMillis(timestamp) {
  if (!timestamp) return null;
  const value = new Date(timestamp).valueOf();
  return Number.isNaN(value) ? null : value;
}

function toSeconds(ms) {
  const seconds = Number(ms ?? 0) / 1000;
  return Number.isFinite(seconds) ? Number(seconds.toFixed(2)) : 0;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function summaryToDailyRow(summary, clientId, siteSlug) {
  return {
    summary_date: summary.date,
    serial_no: summary.serialNo,
    thermostat_name: summary.name,
    group_name: summary.groupName,
    client_id: Number(clientId),
    pelican_subdomain: siteSlug,
    max_heat_setpoint: summary.maxHeatSetpoint,
    min_heat_setpoint: summary.minHeatSetpoint,
    max_cool_setpoint: summary.maxCoolSetpoint,
    min_cool_setpoint: summary.minCoolSetpoint,
    fan_runtime_seconds: summary.fanRuntime ?? null,
    cool_runtime_seconds: summary.coolRuntime ?? null,
    heat_runtime_seconds: summary.heatRuntime ?? null,
    occupied_time_seconds: summary.occupiedTime ?? null,
    number_of_events: summary.numberOfEvents ?? null,
    time_to_first_satisfy_seconds: summary.timeToFirstSatisfy ?? null,
    cycle_probability: summary.cycleProbability ?? null,
    entry_count: summary.entryCount ?? 0,
  };
}

function summaryToThermostatRow(summary, clientId, siteSlug) {
  return {
    serial_no: summary.serialNo,
    client_id: Number(clientId),
    pelican_subdomain: siteSlug,
    thermostat_name: summary.name,
    group_name: summary.groupName,
  };
}

function rowToSummary(row) {
  return {
    date: row.summary_date,
    name: row.thermostat_name || "",
    groupName: row.group_name || "",
    serialNo: row.serial_no,
    maxHeatSetpoint: row.max_heat_setpoint,
    minHeatSetpoint: row.min_heat_setpoint,
    maxCoolSetpoint: row.max_cool_setpoint,
    minCoolSetpoint: row.min_cool_setpoint,
    fanRuntime: row.fan_runtime_seconds ?? 0,
    coolRuntime: row.cool_runtime_seconds ?? 0,
    heatRuntime: row.heat_runtime_seconds ?? 0,
    occupiedTime: row.occupied_time_seconds ?? 0,
    numberOfEvents: row.number_of_events ?? 0,
    timeToFirstSatisfy: row.time_to_first_satisfy_seconds,
    cycleProbability: row.cycle_probability,
    entryCount: row.entry_count ?? 0,
  };
}

function normalizeSerial(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function thermostatRowToSettings(row) {
  const serialNo = String(row?.serial_no || "").trim();
  if (!serialNo) return null;
  return {
    serialNo,
    maxHeatSetting: safeNumber(row?.max_heat_setting),
    minCoolSetting: safeNumber(row?.min_cool_setting),
  };
}

async function getCachedSummariesFromSupabase(clientId, siteSlug, date) {
  if (!isSupabaseEnabled) return [];

  const { data, error } = await supabase
    .from(SUPABASE_DAILY_TABLE)
    .select("*")
    .eq("summary_date", date)
    .eq("pelican_subdomain", siteSlug)
    .eq("client_id", Number(clientId));

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return Array.isArray(data) ? data.map(rowToSummary) : [];
}

async function upsertThermostats(rows) {
  if (!isSupabaseEnabled || !rows.length) return;
  const { error } = await supabase
    .from(SUPABASE_THERMOSTAT_TABLE)
    .upsert(rows, { onConflict: "serial_no" });
  if (error) {
    throw new Error(`Supabase thermostat upsert failed: ${error.message}`);
  }
}

async function upsertDailySummaries(rows) {
  if (!isSupabaseEnabled || !rows.length) return;
  const { error } = await supabase
    .from(SUPABASE_DAILY_TABLE)
    .upsert(rows, { onConflict: "summary_date,serial_no" });
  if (error) {
    throw new Error(`Supabase daily summary upsert failed: ${error.message}`);
  }
}

async function saveSummariesToSupabase(summaries, clientId, siteSlug) {
  if (!isSupabaseEnabled || !Array.isArray(summaries) || !summaries.length) {
    return;
  }

  const thermostatRows = summaries.map((summary) =>
    summaryToThermostatRow(summary, clientId, siteSlug)
  );
  const dailyRows = summaries.map((summary) =>
    summaryToDailyRow(summary, clientId, siteSlug)
  );

  await upsertThermostats(thermostatRows);
  await upsertDailySummaries(dailyRows);
}

function buildThermostatTransaction(selection) {
  return [
    {
      request: "get",
      object: "Thermostat",
      selection,
      value: { ...THERMOSTAT_VALUE_TEMPLATE },
    },
  ];
}

async function fetchThermostatCoreSettingsForSite(
  siteSlug,
  username,
  password,
  serialNumbers
) {
  if (!siteSlug) {
    throw new Error("siteSlug is required");
  }
  if (!username || !password) {
    throw new Error("username and password are required");
  }

  const normalizedSerials = Array.from(
    new Set(
      (Array.isArray(serialNumbers) ? serialNumbers : [])
        .map((serial) => String(serial || "").trim())
        .filter(Boolean)
    )
  );

  const selection =
    normalizedSerials.length > 0
      ? { ThermostatSerialNo: normalizedSerials }
      : {};
  const transactions = buildThermostatTransaction(selection);
  const pelicanUrl = `https://${siteSlug}.officeclimatecontrol.net/api.cgi`;

  const response = await fetch(pelicanUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ username, password, transactions }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Pelican thermostat request failed (${response.status}): ${details.slice(
        0,
        200
      )}`.trim()
    );
  }

  const parsed = await response.json();
  const payload = parsed?.result?.[0]?.Thermostat;
  const thermostats = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
    ? [payload]
    : [];

  return thermostats
    .map((item) => ({
      serialNo: String(item?.serialNo || "").trim(),
      maxHeatSetting: safeNumber(item?.maxHeatSetting),
      minCoolSetting: safeNumber(item?.minCoolSetting),
    }))
    .filter((item) => item.serialNo);
}

async function getCachedThermostatSettingsFromSupabase(
  clientId,
  siteSlug,
  serialNumbers
) {
  if (!isSupabaseEnabled) return [];

  const normalizedSerials = Array.from(
    new Set(
      (Array.isArray(serialNumbers) ? serialNumbers : [])
        .map((serial) => String(serial || "").trim())
        .filter(Boolean)
    )
  );

  if (!normalizedSerials.length) return [];

  const { data, error } = await supabase
    .from(SUPABASE_THERMOSTAT_TABLE)
    .select("serial_no, max_heat_setting, min_cool_setting")
    .eq("pelican_subdomain", siteSlug)
    .eq("client_id", Number(clientId))
    .in("serial_no", normalizedSerials);

  if (error) {
    throw new Error(`Supabase thermostat settings fetch failed: ${error.message}`);
  }

  return Array.isArray(data)
    ? data.map(thermostatRowToSettings).filter(Boolean)
    : [];
}

async function saveThermostatCoreSettingsToSupabase(
  thermostatSettings,
  clientId,
  siteSlug
) {
  if (
    !isSupabaseEnabled ||
    !Array.isArray(thermostatSettings) ||
    !thermostatSettings.length
  ) {
    return;
  }

  const rows = thermostatSettings
    .map((setting) => {
      const serialNo = String(setting?.serialNo || "").trim();
      if (!serialNo) return null;
      return {
        serial_no: serialNo,
        client_id: Number(clientId),
        pelican_subdomain: siteSlug,
        // Avoid poisoning cache with zero defaults; treat as missing.
        max_heat_setting:
          safeNumber(setting?.maxHeatSetting) === 0
            ? null
            : safeNumber(setting?.maxHeatSetting),
        min_cool_setting:
          safeNumber(setting?.minCoolSetting) === 0
            ? null
            : safeNumber(setting?.minCoolSetting),
      };
    })
    .filter(Boolean);

  if (!rows.length) return;

  const { error } = await supabase
    .from(SUPABASE_THERMOSTAT_TABLE)
    .upsert(rows, { onConflict: "serial_no" });

  if (error) {
    throw new Error(`Supabase thermostat settings upsert failed: ${error.message}`);
  }
}

function isSetbackActive(entry) {
  const raw = String(entry?.setback ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  if (["0", "off", "false", "no", "inactive"].includes(raw)) return false;
  const numeric = Number(raw);
  if (!Number.isNaN(numeric)) {
    return numeric > 0;
  }
  return true;
}

function isOccupied(entry) {
  return !isSetbackActive(entry);
}

function isCoolRunning(entry) {
  const runStatus = String(entry?.runStatus ?? "").toLowerCase();
  return runStatus.includes("cool");
}

function isHeatRunning(entry) {
  const runStatus = String(entry?.runStatus ?? "").toLowerCase();
  return runStatus.includes("heat");
}

function isFanRunning(entry) {
  const runStatus = String(entry?.runStatus ?? "").toLowerCase();
  const fanField = String(entry?.fan ?? "").toLowerCase();
  if (
    runStatus.includes("fan") ||
    runStatus.includes("cool") ||
    runStatus.includes("heat")
  ) {
    return true;
  }
  return ["on", "high", "low", "medium"].includes(fanField);
}

function isConditioningRunning(entry) {
  return isCoolRunning(entry) || isHeatRunning(entry);
}

/**
 * Fetch credentials for a site from buildings
 */
async function getCredentialsForSite(clientId, siteSlug) {
  const startTime = Date.now();
  console.log(
    `[Pelican History API] ⏱️ Fetching buildings for client ${clientId}...`
  );

  const buildings = await getBuildings(clientId);

  const buildingsFetchTime = Date.now() - startTime;
  console.log(
    `[Pelican History API] ⏱️ Buildings fetch completed in ${buildingsFetchTime}ms (${
      buildings?.length || 0
    } buildings)`
  );

  // Find building with matching PelicanSubdomain
  const building = buildings.find(
    (b) =>
      String(b?.PelicanSubdomain || "")
        .trim()
        .toLowerCase() === siteSlug.toLowerCase()
  );

  if (!building) {
    throw new Error(`No building found for siteSlug: ${siteSlug}`);
  }

  const username = String(building?.PelicanUsername || "").trim();
  const password = String(building?.PelicanPassword || "").trim();

  if (!username || !password) {
    throw new Error(`Missing credentials for siteSlug: ${siteSlug}`);
  }

  return { username, password };
}

/**
 * Fetch ALL thermostat history for a site/date using streaming.
 * Returns a Map of serialNo -> history entries (already filtered by date).
 */
async function fetchAllThermostatsForSiteDate(
  siteSlug,
  username,
  password,
  date
) {
  const overallStart = Date.now();

  // Build date range for single day (start and end of day)
  // Use parseLocalDate to avoid timezone issues with new Date("YYYY-MM-DD")
  const startDate = parseLocalDate(date);
  startDate.setHours(0, 0, 0, 0);
  const startDateTime = toPelicanDateTime(startDate);

  const endDate = parseLocalDate(date);
  endDate.setHours(23, 59, 59, 999);
  const endDateTime = toPelicanDateTime(endDate);

  // Build transaction - NO serial filter, we want everything
  const selection = {
    startDateTime,
    endDateTime,
  };
  const transactions = buildHistoryTransaction(
    selection,
    DEFAULT_HISTORY_FIELDS
  );

  console.log(`[Pelican History API] 🔍 DEBUG: Requesting date range:`, {
    requestedDate: date,
    startDateTime,
    endDateTime,
  });

  const pelicanUrl = `https://${siteSlug}.officeclimatecontrol.net/api.cgi`;
  const requestBody = JSON.stringify({ username, password, transactions });

  console.log(
    `[Pelican History API] ⏱️ Making Pelican API request to ${pelicanUrl}`
  );
  console.log(
    `[Pelican History API] ⏱️ Request body size: ${requestBody.length} bytes`
  );

  const fetchStart = Date.now();

  // Call Pelican API
  const response = await fetch(pelicanUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: requestBody,
  });

  const fetchTime = Date.now() - fetchStart;
  console.log(
    `[Pelican History API] ⏱️ Pelican API response received in ${fetchTime}ms (status: ${response.status})`
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Pelican request failed (${response.status}): ${details.slice(
        0,
        200
      )}`.trim()
    );
  }

  // Use streaming to read the response
  const streamStart = Date.now();
  const reader = response.body?.getReader();

  if (!reader) {
    // Fallback to non-streaming if reader not available
    console.log(
      `[Pelican History API] ⏱️ Streaming not available, falling back to buffered read`
    );
    const responseText = await response.text();
    const parsed = JSON.parse(responseText);
    return processFullResponse(parsed, date, overallStart);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  let chunkCount = 0;

  console.log(`[Pelican History API] ⏱️ Starting streaming read...`);

  // Read all chunks and accumulate
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    totalBytes += value?.length || 0;
    chunkCount++;
    buffer += decoder.decode(value, { stream: true });

    // Log progress every 1MB
    if (chunkCount === 1 || totalBytes % (1024 * 1024) < (value?.length || 0)) {
      const elapsed = Date.now() - streamStart;
      const mbReceived = (totalBytes / 1024 / 1024).toFixed(2);
      const mbps =
        elapsed > 0
          ? (totalBytes / 1024 / 1024 / (elapsed / 1000)).toFixed(2)
          : 0;
      console.log(
        `[Pelican History API] ⏱️ Streaming: ${mbReceived}MB received (${mbps} MB/s, ${chunkCount} chunks)`
      );
    }
  }

  // Flush decoder
  buffer += decoder.decode();

  const streamTime = Date.now() - streamStart;
  console.log(
    `[Pelican History API] ⏱️ Streaming complete: ${(
      totalBytes /
      1024 /
      1024
    ).toFixed(2)}MB in ${streamTime}ms`
  );

  // Parse JSON
  const parseStart = Date.now();
  const parsed = JSON.parse(buffer);
  const parseTime = Date.now() - parseStart;
  console.log(`[Pelican History API] ⏱️ JSON parsed in ${parseTime}ms`);

  return processFullResponse(parsed, date, overallStart);
}

/**
 * Process the full Pelican response and extract all thermostats' history.
 * Returns an array of { serialNo, entries } for all thermostats.
 */
function processFullResponse(parsed, date, overallStart) {
  const processStart = Date.now();
  const thermostats = [];
  const thermostatHistory = parsed?.result?.[0]?.ThermostatHistory;

  if (Array.isArray(thermostatHistory)) {
    console.log(
      `[Pelican History API] ⏱️ Processing ${thermostatHistory.length} thermostat(s) from response`
    );

    for (const entry of thermostatHistory) {
      const serialNo = String(entry?.serialNo || "").trim();
      if (!serialNo || !Array.isArray(entry.History)) continue;

      // Capture name/groupName from thermostat level (may also be in History entries)
      const thermostatName = String(entry?.name || "").trim();
      const thermostatGroupName = String(entry?.groupName || "").trim();

      // Filter History entries by date and collect
      const entries = [];
      for (const historyEntry of entry.History) {
        const timestamp = String(historyEntry?.timestamp || "");
        if (timestamp.startsWith(date)) {
          entries.push(historyEntry);
        }
      }

      // Sort by timestamp
      entries.sort((a, b) =>
        (a.timestamp || "").localeCompare(b.timestamp || "")
      );

      thermostats.push({
        serialNo,
        name: thermostatName,
        groupName: thermostatGroupName,
        entries,
        entryCount: entries.length,
      });
    }
  }

  const processTime = Date.now() - processStart;
  const totalTime = Date.now() - overallStart;

  const totalEntries = thermostats.reduce((sum, t) => sum + t.entryCount, 0);

  console.log(
    `[Pelican History API] ⏱️ Processed ${thermostats.length} thermostats with ${totalEntries} total entries in ${processTime}ms`
  );
  console.log(
    `[Pelican History API] ⏱️ Total fetchAllThermostats time: ${totalTime}ms`
  );

  return thermostats;
}

/**
 * Summarize a single thermostat's day into a compact object so we avoid sending
 * large history payloads to clients.
 */
function summarizeThermostatDay(thermostat, date) {
  const entries = Array.isArray(thermostat?.entries) ? thermostat.entries : [];
  const serialNo = String(thermostat?.serialNo || "").trim();
  // Use thermostat-level name first, fall back to first entry's name
  const name = thermostat?.name || entries[0]?.name || "";
  const groupName = thermostat?.groupName || entries[0]?.groupName || "";
  const dayStartMs = toMillis(`${date}T00:00:00`);
  const dayEndMs = toMillis(`${date}T23:59:59.999`);

  const baseSummary = {
    date,
    name,
    groupName,
    serialNo,
    maxHeatSetpoint: null,
    minHeatSetpoint: null,
    maxCoolSetpoint: null,
    minCoolSetpoint: null,
    fanRuntime: 0,
    coolRuntime: 0,
    heatRuntime: 0,
    occupiedTime: 0,
    numberOfEvents: 0,
    timeToFirstSatisfy: null,
    cycleProbability: null,
    entryCount: entries.length,
  };

  if (!entries.length || dayStartMs === null || dayEndMs === null) {
    return baseSummary;
  }

  // Pre-compute setpoint ranges
  let maxHeatSetpoint = null;
  let minHeatSetpoint = null;
  let maxCoolSetpoint = null;
  let minCoolSetpoint = null;
  let heatValueCount = 0;
  let coolValueCount = 0;

  for (const entry of entries) {
    const heat = safeNumber(entry?.heatSetting);
    const cool = safeNumber(entry?.coolSetting);
    if (heat !== null) {
      maxHeatSetpoint =
        maxHeatSetpoint === null ? heat : Math.max(maxHeatSetpoint, heat);
      minHeatSetpoint =
        minHeatSetpoint === null ? heat : Math.min(minHeatSetpoint, heat);
      heatValueCount += 1;
    }
    if (cool !== null) {
      maxCoolSetpoint =
        maxCoolSetpoint === null ? cool : Math.max(maxCoolSetpoint, cool);
      minCoolSetpoint =
        minCoolSetpoint === null ? cool : Math.min(minCoolSetpoint, cool);
      coolValueCount += 1;
    }
  }

  const hasHeatVariation =
    heatValueCount > 0 && maxHeatSetpoint !== null && minHeatSetpoint !== null
      ? maxHeatSetpoint !== minHeatSetpoint
      : false;
  const hasCoolVariation =
    coolValueCount > 0 && maxCoolSetpoint !== null && minCoolSetpoint !== null
      ? maxCoolSetpoint !== minCoolSetpoint
      : false;

  const setpointRanges = {
    maxHeatSetpoint,
    minHeatSetpoint,
    maxCoolSetpoint,
    minCoolSetpoint,
    hasHeatVariation,
    hasCoolVariation,
  };

  const isOccupiedBySetpoints = (entry) => {
    // If no variation all day, treat as unoccupied
    if (!hasHeatVariation && !hasCoolVariation) return false;

    const heat = safeNumber(entry?.heatSetting);
    const cool = safeNumber(entry?.coolSetting);
    const epsilon = 0.0001;

    let occupied = false;

    if (
      hasHeatVariation &&
      heat !== null &&
      maxHeatSetpoint !== null &&
      minHeatSetpoint !== null
    ) {
      // Occupied if at (or above) the day's highest heat setpoint
      if (heat >= maxHeatSetpoint - epsilon) occupied = true;
    }

    if (
      hasCoolVariation &&
      cool !== null &&
      minCoolSetpoint !== null &&
      maxCoolSetpoint !== null
    ) {
      // Occupied if at (or below) the day's lowest cool setpoint
      if (cool <= minCoolSetpoint + epsilon) occupied = true;
    }

    return occupied;
  };

  // Build contiguous intervals from consecutive history rows
  const intervals = [];
  for (let i = 0; i < entries.length; i += 1) {
    const rawStart = toMillis(entries[i]?.timestamp);
    const startMs = i === 0 && dayStartMs !== null ? dayStartMs : rawStart;
    if (startMs === null) continue;

    let endMs = null;
    for (let j = i + 1; j < entries.length; j += 1) {
      endMs = toMillis(entries[j]?.timestamp);
      if (endMs !== null) break;
    }
    endMs = endMs ?? dayEndMs;

    const clampedStart = Math.max(startMs, dayStartMs);
    const clampedEnd = Math.min(endMs, dayEndMs);
    if (clampedEnd <= clampedStart) continue;

    intervals.push({
      startMs: clampedStart,
      endMs: clampedEnd,
      entry: entries[i],
    });
  }

  if (!intervals.length) {
    return baseSummary;
  }

  let fanRuntimeMs = 0;
  let coolRuntimeMs = 0;
  let heatRuntimeMs = 0;
  let occupiedMs = 0;
  let numberOfEvents = 0;
  let timeToFirstSatisfyMs = null;
  let cycleRuntimeAfterInitialMs = 0;
  let cycleDurationAfterInitialMs = 0;

  let currentEvent = null;

  const finalizeEvent = (event) => {
    if (!event) return;
    const eventEndMs = event.lastEndMs ?? event.startMs;

    // Close the initial run if it never stopped before event end
    if (event.initialRunStarted && !event.initialRunEnded) {
      event.initialRunEnded = true;
      event.initialRunEndMs = eventEndMs;
    }

    if (timeToFirstSatisfyMs === null && event.initialRunMs > 0) {
      timeToFirstSatisfyMs = event.initialRunMs;
    }

    if (event.initialRunStarted) {
      const afterInitialDuration = Math.max(
        0,
        eventEndMs - (event.initialRunEndMs ?? eventEndMs)
      );
      const runtimeAfterInitial = Math.max(
        0,
        event.runtimeMs - event.initialRunMs
      );

      if (afterInitialDuration > 0) {
        cycleDurationAfterInitialMs += afterInitialDuration;
        cycleRuntimeAfterInitialMs += runtimeAfterInitial;
      }
    }
  };

  for (const interval of intervals) {
    const { startMs, endMs, entry } = interval;
    const deltaMs = endMs - startMs;

    const fanRunning = isFanRunning(entry);
    const coolRunning = isCoolRunning(entry);
    const heatRunning = isHeatRunning(entry);
    const conditioningRunning = isConditioningRunning(entry);

    if (fanRunning) fanRuntimeMs += deltaMs;
    if (coolRunning) coolRuntimeMs += deltaMs;
    if (heatRunning) heatRuntimeMs += deltaMs;

    const occupied = isOccupiedBySetpoints(entry);

    if (occupied) {
      occupiedMs += deltaMs;
      if (!currentEvent) {
        currentEvent = {
          startMs,
          lastEndMs: endMs,
          durationMs: 0,
          runtimeMs: 0,
          initialRunMs: 0,
          initialRunStarted: false,
          initialRunEnded: false,
          initialRunEndMs: null,
        };
        numberOfEvents += 1;
      }

      currentEvent.durationMs += deltaMs;
      currentEvent.lastEndMs = endMs;

      if (conditioningRunning) {
        currentEvent.runtimeMs += deltaMs;
        if (!currentEvent.initialRunStarted) {
          currentEvent.initialRunStarted = true;
        }
        if (!currentEvent.initialRunEnded) {
          currentEvent.initialRunMs += deltaMs;
          currentEvent.initialRunEndMs = endMs;
        }
      } else if (
        currentEvent.initialRunStarted &&
        !currentEvent.initialRunEnded
      ) {
        // First satisfy point reached
        currentEvent.initialRunEnded = true;
        currentEvent.initialRunEndMs = startMs;
      }
    } else if (currentEvent) {
      finalizeEvent(currentEvent);
      currentEvent = null;
    }
  }

  if (currentEvent) {
    finalizeEvent(currentEvent);
  }

  const cycleProbability =
    cycleDurationAfterInitialMs > 0
      ? Math.min(
          1,
          Number(
            (cycleRuntimeAfterInitialMs / cycleDurationAfterInitialMs).toFixed(
              3
            )
          )
        )
      : null;

  const summary = {
    date,
    name,
    groupName,
    serialNo,
    maxHeatSetpoint,
    minHeatSetpoint,
    maxCoolSetpoint,
    minCoolSetpoint,
    fanRuntime: toSeconds(fanRuntimeMs),
    coolRuntime: toSeconds(coolRuntimeMs),
    heatRuntime: toSeconds(heatRuntimeMs),
    occupiedTime: toSeconds(occupiedMs),
    numberOfEvents,
    timeToFirstSatisfy:
      timeToFirstSatisfyMs !== null ? toSeconds(timeToFirstSatisfyMs) : null,
    cycleProbability,
    entryCount: entries.length,
  };

  // If setpoints never change, assume space stayed unoccupied to avoid inflating occupancy
  if (
    maxHeatSetpoint !== null &&
    minHeatSetpoint !== null &&
    maxCoolSetpoint !== null &&
    minCoolSetpoint !== null &&
    maxHeatSetpoint === minHeatSetpoint &&
    maxCoolSetpoint === minCoolSetpoint
  ) {
    summary.occupiedTime = 0;
    summary.numberOfEvents = 0;
    summary.timeToFirstSatisfy = null;
    summary.cycleProbability = null;
  }

  return summary;
}

router.get("/:clientId", async (req, res) => {
  const requestStart = Date.now();

  try {
    const { clientId } = req.params;
    const { siteSlug, date } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!siteSlug || !date) {
      return res.status(400).json({
        error: "siteSlug and date (YYYY-MM-DD) are required query parameters",
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        error: "date must be in YYYY-MM-DD format",
      });
    }

    console.log(`\n[Pelican History API] ========== NEW REQUEST ==========`);
    console.log(`[Pelican History API] Query:`, { clientId, siteSlug, date });

    // Try cached daily summaries first (Supabase)
    if (isSupabaseEnabled) {
      try {
        const cachedSummaries = await getCachedSummariesFromSupabase(
          clientId,
          siteSlug,
          date
        );

        if (cachedSummaries.length) {
          const cachedTotalEntries = cachedSummaries.reduce(
            (sum, t) => sum + (t.entryCount ?? 0),
            0
          );

          // Only trust the cache when at least one thermostat has actual history
          // entries. If every cached row has entryCount=0, the cache was likely
          // written when this date was in the future (no data existed yet at write
          // time). Skip the stale cache and re-fetch from the Pelican API so that
          // now-available data is returned and the cache is healed.
          if (cachedTotalEntries > 0) {
            console.log(
              `[Pelican History API] ✅ Cache hit in Supabase for ${cachedSummaries.length} thermostats (${cachedTotalEntries} total entries)`
            );

            return res.status(200).json({
              thermostats: cachedSummaries,
              query: { clientId, siteSlug, date },
              thermostatCount: cachedSummaries.length,
              totalEntries: cachedTotalEntries,
              summarized: true,
              cache: { source: "supabase", hit: true },
            });
          }

          console.log(
            `[Pelican History API] ⚠️ Cache has ${cachedSummaries.length} rows for ${date} but all have 0 entries — treating as stale, re-fetching from Pelican`
          );
        }
      } catch (cacheError) {
        console.error(
          `[Pelican History API] Supabase cache lookup failed:`,
          cacheError
        );
      }
    }

    // Get credentials for this site
    const { username, password } = await getCredentialsForSite(
      Number(clientId),
      siteSlug
    );

    // Fetch ALL thermostats for this site/date
    const thermostats = await fetchAllThermostatsForSiteDate(
      siteSlug,
      username,
      password,
      date
    );

    const totalEntries = thermostats.reduce((sum, t) => sum + t.entryCount, 0);
    const summarizedThermostats = thermostats.map((t) =>
      summarizeThermostatDay(t, date)
    );

    const responseData = {
      thermostats: summarizedThermostats,
      query: { clientId, siteSlug, date },
      thermostatCount: summarizedThermostats.length,
      totalEntries,
      summarized: true,
    };

    const totalTime = Date.now() - requestStart;
    console.log(`[Pelican History API] ========== REQUEST COMPLETE ==========`);
    console.log(`[Pelican History API] ⏱️ TOTAL REQUEST TIME: ${totalTime}ms`);
    console.log(
      `[Pelican History API] ⏱️ Returned ${thermostats.length} thermostats with ${totalEntries} entries`
    );
    console.log(
      `[Pelican History API] ===========================================\n`
    );

    // Persist summaries to Supabase for future cache hits.
    // Skip caching when every thermostat has 0 entries — this typically means
    // the date had no data yet (e.g. a future or same-day request). Caching
    // such results would poison the cache and hide real data on future fetches.
    const hasAnyEntries = summarizedThermostats.some(
      (t) => (t.entryCount ?? 0) > 0
    );
    if (isSupabaseEnabled && hasAnyEntries) {
      try {
        await saveSummariesToSupabase(
          summarizedThermostats,
          clientId,
          siteSlug
        );
      } catch (supabaseError) {
        console.error(
          "[Pelican History API] Failed to upsert Supabase summaries:",
          supabaseError
        );
      }
    } else if (isSupabaseEnabled && !hasAnyEntries) {
      console.log(
        `[Pelican History API] ⚠️ Skipping cache write for ${date} — no thermostat entries returned`
      );
    }

    return res.status(200).json(responseData);
  } catch (error) {
    const totalTime = Date.now() - requestStart;
    console.error(`[Pelican History API] Error after ${totalTime}ms:`, error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

// Export shared utilities for other pelican routes
export {
  getCredentialsForSite,
  fetchAllThermostatsForSiteDate,
  fetchThermostatCoreSettingsForSite,
  summarizeThermostatDay,
  buildHistoryTransaction,
  toPelicanDateTime,
  parseLocalDate,
  safeNumber,
  getCachedSummariesFromSupabase,
  getCachedThermostatSettingsFromSupabase,
  saveSummariesToSupabase,
  saveThermostatCoreSettingsToSupabase,
  normalizeSerial,
  isSupabaseEnabled,
};
