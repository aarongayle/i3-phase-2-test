// Structured schedule export for report follow-up Q&A (schema version 1)
import { ensureShortSchedulesForDate } from "./schedule-store.js";
import { DEFAULT_SCHEDULE_TIME_ZONE, localParts } from "./co-scheduled-minutes.js";
import {
  DEFAULT_REPORT_WINDOW_DAYS,
  isoDate,
  resolveEnergyDateRange,
  sliceReportDates,
  uniqueSortedReportDates,
} from "./report-window.js";

const MAX_ITEMS = 50;
const MAX_EVENTS_PER_ITEM = 40;
const TARGET_MAX_BYTES = 100 * 1024;

// CO epochs are UTC; read them on the client's wall clock, not the server's.
function epochToLocalTime(epoch, timeZone) {
  const ms = Number(epoch);
  if (!Number.isFinite(ms)) return null;
  const { minutes } = localParts(ms, timeZone);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function isOccupiedEvent(row) {
  if (typeof row?.Occupied === "boolean") return row.Occupied;
  if (typeof row?.IsOccupied === "boolean") return row.IsOccupied;
  if (typeof row?.occupied === "boolean") return row.occupied;
  // Runtime blocks from optimal-schedules represent scheduled-on time.
  return true;
}

function eventLabel(row) {
  return (
    row?.Name ??
    row?.EventName ??
    row?.ScheduleName ??
    row?.Description ??
    null
  );
}

function rowsToEvents(rows, reportDate, timeZone) {
  const events = [];
  for (const row of rows || []) {
    const startLocal = epochToLocalTime(row?.StartDateEpoch, timeZone);
    const endLocal = epochToLocalTime(row?.EndDateEpoch, timeZone);
    if (!startLocal || !endLocal) continue;

    const startMs = Number(row?.StartDateEpoch);
    const event = {
      startLocal,
      endLocal,
      occupied: isOccupiedEvent(row),
      label: eventLabel(row),
    };
    // startLocal is when the device turns on (ramp + load rolling included);
    // eventStartLocal is the occupied time the client entered on the events page.
    const eventStartLocal = epochToLocalTime(row?.EventStartDateEpoch, timeZone);
    const eventEndLocal = epochToLocalTime(row?.EventEndDateEpoch, timeZone);
    if (eventStartLocal) event.eventStartLocal = eventStartLocal;
    if (eventEndLocal) event.eventEndLocal = eventEndLocal;
    if (Number.isFinite(Number(row?.RampTime))) event.rampMin = Number(row.RampTime);
    if (Number(row?.LoadRollTime)) event.loadRollMin = Number(row.LoadRollTime);

    if (Number.isFinite(startMs)) {
      event.dayOfWeek = localParts(startMs, timeZone).dayOfWeek;
    }
    if (reportDate) {
      event.date = reportDate;
    }

    events.push(event);
    if (events.length >= MAX_EVENTS_PER_ITEM) break;
  }
  return events;
}

function buildDeviceLookup(devices) {
  const byId = new Map();
  for (const device of devices || []) {
    const id = device?.Id ?? device?.id;
    if (id != null) byId.set(id, device);
  }
  return byId;
}

function deviceScopeName(device, deviceId) {
  return (
    device?.Name ??
    device?.name ??
    device?.Description ??
    String(deviceId)
  );
}

/**
 * Build schedules payload from cache/DB, fetching one CO date on miss
 * (same path as GET /api/schedules/:clientId/:date).
 */
export async function buildReportSchedules(clientId, options = {}) {
  try {
    const report = options.report || {};
    const meta = report.meta || {};
    const energy = report.energy || {};
    const devicesById = buildDeviceLookup(options.rawDevices || []);
    const timeZone = options.timeZone || meta.timeZone || DEFAULT_SCHEDULE_TIME_ZONE;

    const energyRange =
      options.dateRange ||
      resolveEnergyDateRange(energy.expected, energy.actual, meta);

    const allReportDays = uniqueSortedReportDates(
      options.allReportDates?.length
        ? options.allReportDates
        : [meta.firstReportDate, meta.mostRecentDate].filter(Boolean)
    );

    const windowDays = options.windowDays ?? DEFAULT_REPORT_WINDOW_DAYS;
    const windowedDays = sliceReportDates(allReportDays, { windowDays });
    const scheduleDate =
      isoDate(meta.mostRecentDate) ||
      windowedDays[windowedDays.length - 1] ||
      allReportDays[allReportDays.length - 1];

    if (!scheduleDate) {
      return null;
    }

    const rawRows = await ensureShortSchedulesForDate(clientId, scheduleDate);

    if (!rawRows.length) {
      return null;
    }

    const byDevice = new Map();
    for (const row of rawRows) {
      const deviceId = row?.DeviceId ?? row?.deviceId;
      if (deviceId == null) continue;
      if (!byDevice.has(deviceId)) byDevice.set(deviceId, []);
      byDevice.get(deviceId).push(row);
    }

    const deviceIds = [...byDevice.keys()];
    let truncated = false;
    let omittedItems = 0;
    let cappedDeviceIds = deviceIds;

    if (deviceIds.length > MAX_ITEMS) {
      truncated = true;
      omittedItems = deviceIds.length - MAX_ITEMS;
      cappedDeviceIds = deviceIds.slice(0, MAX_ITEMS);
    }

    const items = cappedDeviceIds.map((deviceId) => {
      const device = devicesById.get(deviceId);
      return {
        scopeType: "device",
        scopeId: deviceId,
        scopeName: deviceScopeName(device, deviceId),
        events: rowsToEvents(byDevice.get(deviceId), scheduleDate, timeZone),
      };
    });

    const dateRange = energyRange
      ? { start: energyRange.start, end: energyRange.end }
      : {
          start: windowedDays[0] || scheduleDate,
          end: scheduleDate,
        };

    let payload = {
      version: 1,
      fetchedAt: new Date().toISOString(),
      timeZone,
      dateRange,
      items,
      ...(truncated
        ? {
            truncated: true,
            omittedCounts: { items: omittedItems },
          }
        : {}),
    };

    // Shrink if over target size by dropping events from lowest-priority items.
    let serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > TARGET_MAX_BYTES) {
      truncated = true;
      const trimmedItems = items.map((item) => ({
        ...item,
        events: item.events.slice(0, Math.min(20, item.events.length)),
      }));
      payload = {
        ...payload,
        items: trimmedItems,
        truncated: true,
        omittedCounts: {
          ...(payload.omittedCounts || {}),
          events: "size_cap",
        },
      };
      serialized = JSON.stringify(payload);
    }

    if (Buffer.byteLength(serialized, "utf8") > TARGET_MAX_BYTES) {
      payload.items = payload.items.slice(0, Math.floor(MAX_ITEMS / 2));
      payload.truncated = true;
    }

    return payload;
  } catch (err) {
    console.warn("[report-schedules] Failed to build schedules:", err.message);
    return null;
  }
}

export { DEFAULT_REPORT_WINDOW_DAYS, resolveEnergyDateRange, sliceReportDates };
