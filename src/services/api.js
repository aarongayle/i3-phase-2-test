/**
 * API service for fetching report data from separate endpoints
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

/**
 * Fetch devices for a client
 * @param {string|number} clientId - The client ID
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Array>} The devices
 */
async function fetchDevices(clientId, signal) {
  const url = `${API_BASE_URL}/devices/${clientId}`;
  console.log(`[API] Fetching devices from:`, url);

  const response = await fetch(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.devices;
}

/**
 * Fetch report dates for a client
 * @param {string|number} clientId - The client ID
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Array>} The dates
 */
async function fetchDates(clientId, signal) {
  const url = `${API_BASE_URL}/dates/${clientId}`;
  console.log(`[API] Fetching dates from:`, url);

  const response = await fetch(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.dates;
}

/**
 * Fetch meters for a client
 * @param {string|number} clientId - The client ID
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Array>} The meters
 */
async function fetchMeters(clientId, signal) {
  const url = `${API_BASE_URL}/meters/${clientId}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.meters;
}

/**
 * Fetch interval data for a client
 * @param {string|number} clientId - The client ID
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Array>} The interval data
 */
async function fetchIntervals(clientId, signal) {
  const url = `${API_BASE_URL}/intervals/${clientId}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.intervals;
}

/**
 * Fetch schedule details for a single date
 * @param {string|number} clientId - The client ID
 * @param {string} date - The date
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Array>} The schedule details
 */
async function fetchScheduleDetailsForDate(clientId, date, signal) {
  const url = `${API_BASE_URL}/schedule-details/${clientId}/${date}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.scheduleDetails;
}

/**
 * Fetch units (cooling and heating conversion factors)
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Object>} The units data
 */
async function fetchUnits(signal) {
  const url = `${API_BASE_URL}/units`;
  console.log(`[API] Fetching units from:`, url);

  const response = await fetch(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.units;
}

/**
 * Fetch optimal schedules for a single date
 * @param {string|number} clientId - The client ID
 * @param {string} date - The date (YYYY-MM-DD format)
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Array>} The schedules for this date
 */
async function fetchSchedulesForDate(clientId, date, signal) {
  const url = `${API_BASE_URL}/schedules/${clientId}/${date}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.schedules;
}

/**
 * Compute actual energy usage client-side
 * @param {Array} meters - Meters list
 * @param {Array} intervalData - Raw interval data
 * @returns {Array} Actual energy data
 */
function computeActualEnergy(meters, intervalData) {
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
    const monthNum = monthZero + 1;
    const dayNum = dayZero + 1;
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

  return meters.map(({ Id, Name }) => {
    const meterIntervals = intervalData.find(
      ({ meterName }) => meterName === Name
    );
    const byYear = meterIntervals?.data || {};
    const flat = [];

    for (const [year, byMonth] of Object.entries(byYear)) {
      for (const [month, byDay] of Object.entries(byMonth)) {
        for (const [day, byInterval] of Object.entries(byDay)) {
          const date = normalizedDate(year, month, day);
          if (!date) continue;
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
}

/**
 * Compute expected energy usage client-side
 * @param {Array} meters - Meters list
 * @param {Array} actualEnergy - Actual energy data (for output shape)
 * @param {Array} dates - Report dates
 * @param {Array} scheduleDetailsByDate - Schedule details grouped by date
 * @returns {Array} Expected energy data
 */
function computeExpectedEnergy(
  meters,
  actualEnergy,
  dates,
  scheduleDetailsByDate
) {
  const reportDays = dates
    .map((d) => d.report_date)
    .filter(Boolean)
    .map((s) => String(s).split("T")[0])
    .sort((a, b) => new Date(a) - new Date(b));

  if (reportDays.length === 0) {
    return actualEnergy.map(({ Id, Name, Interval }) => ({
      Id,
      Name,
      Interval: (Interval || []).map(({ date, interval }) => ({
        date,
        interval,
        value: 0,
      })),
    }));
  }

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
  console.log(
    "[DEBUG] computeExpectedEnergy: Processing",
    scheduleDetailsByDate.length,
    "schedule detail dates"
  );

  scheduleDetailsByDate.forEach(({ date, details }, idx) => {
    const perMeter = new Map();
    const byMeter = new Map();
    console.log(
      `[DEBUG] Date ${idx}: ${date}, Details count: ${details?.length || 0}`
    );

    for (const row of details || []) {
      const id = row?.meter_id;
      if (!id) {
        if (idx === 0) {
          console.log("[DEBUG] Row missing meter_id:", row);
        }
        continue;
      }
      if (!byMeter.has(id)) byMeter.set(id, []);
      byMeter.get(id).push(row);
    }

    for (const [id, meterRows] of byMeter.entries()) {
      const values = meterRows.slice(0, 96).map(valueFromRow);
      perMeter.set(id, values);
      if (idx === 0) {
        console.log(
          `[DEBUG] Meter ${id}: ${values.length} values, first value: ${values[0]}`
        );
      }
    }
    reportToMeterValues.set(date, perMeter);
  });

  // Build a map: calendar-day -> nearest-report-day
  const allDaysSet = new Set();
  for (const { Interval } of actualEnergy) {
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

  // Build expected output
  return actualEnergy.map(({ Id, Name, Interval }) => {
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
}

/**
 * Aggregate device metrics client-side
 * @param {Array} devices - Device list
 * @param {Array} dates - Date list
 * @param {Object} units - Units data
 * @param {Object} historyData - History data with schedules
 * @returns {Array} Aggregated device metrics
 */
function aggregateDeviceMetrics(devices, dates, units, historyData) {
  if (!historyData?.history || historyData.history.length === 0) {
    return [];
  }

  // Helper to convert capacity to kW
  const toKW = (capacity, unitId, unitList) => {
    const unit = unitList.find((u) => u.Id === unitId);
    return capacity * (unit?.KWConversionFactor ?? 1);
  };

  // Initialize device aggregates
  const deviceAggregates = new Map();
  devices.forEach((device) => {
    deviceAggregates.set(device.Id, {
      id: device.Id,
      name: device.Name,
      description: device.Description,
      heatingKW: toKW(
        device.HeatingCapacity,
        device.HeatingUnitId,
        units.heat || []
      ),
      coolingKW: toKW(
        device.CoolingCapacity,
        device.CoolingUnitId,
        units.cool || []
      ),
      sumRuntimeMin: 0,
      sumRamptimeMin: 0,
      daysCounted: 0,
      runtimeWeekly: [],
      ramptimeWeekly: [],
      runtimeLatest: 0,
      ramptimeLatest: 0,
    });
  });

  // Process each day's schedules
  historyData.history.forEach(({ date, schedules }, dayIndex) => {
    devices.forEach((device) => {
      const scheduleForDevice = (schedules || []).filter(
        (s) => s.DeviceId === device.Id
      );

      const runtimeMin =
        scheduleForDevice.reduce(
          (acc, curr) => acc + (curr.EndDateEpoch - curr.StartDateEpoch),
          0
        ) /
        1000 /
        60;

      const ramptimeMin = scheduleForDevice.reduce(
        (acc, curr) => acc + (curr.RampTime || 0),
        0
      );

      const agg = deviceAggregates.get(device.Id);
      agg.sumRuntimeMin += runtimeMin;
      agg.sumRamptimeMin += ramptimeMin;
      agg.daysCounted += 1;

      // Collect weekly samples (every 7th day)
      if (dayIndex % 7 === 0) {
        agg.runtimeWeekly.push({ date, minutes: runtimeMin });
        agg.ramptimeWeekly.push({ date, minutes: ramptimeMin });
      }

      // Latest day values
      if (dayIndex === historyData.history.length - 1) {
        agg.runtimeLatest = runtimeMin;
        agg.ramptimeLatest = ramptimeMin;
      }
    });
  });

  // Format output
  return Array.from(deviceAggregates.values()).map((agg) => {
    const days = Math.max(1, agg.daysCounted);
    return {
      name: agg.name,
      description: agg.description,
      coolingKW: agg.coolingKW,
      heatingKW: agg.heatingKW,
      runtimeAvgMin: agg.sumRuntimeMin / days,
      ramptimeAvgMin: agg.sumRamptimeMin / days,
      runtimeLatestMin: agg.runtimeLatest,
      ramptimeLatestMin: agg.ramptimeLatest,
      runtimeWeekly: agg.runtimeWeekly,
      ramptimeWeekly: agg.ramptimeWeekly,
    };
  });
}

/**
 * Fetch compiled report data using separate endpoints with progress tracking
 * @param {string|number} clientId - The client ID
 * @param {Function} onProgress - Progress callback receiving {stage, progress, message}
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Object>} The complete report data
 */
export async function fetchCompiledReportStream(clientId, onProgress, signal) {
  console.log("[API] Fetching report data for clientId:", clientId);

  try {
    // Stage 1: Fetch metadata in parallel
    onProgress?.({
      stage: "metadata",
      progress: 0,
      message: "Loading metadata...",
    });

    const [devices, dates, units] = await Promise.all([
      fetchDevices(clientId, signal),
      fetchDates(clientId, signal),
      fetchUnits(signal),
    ]);

    onProgress?.({
      stage: "metadata",
      progress: 100,
      message: `Loaded ${devices.length} devices, ${dates.length} dates`,
    });

    // Stage 2: Fetch schedules for each date (client makes multiple requests)
    onProgress?.({
      stage: "history",
      progress: 0,
      message: `Loading schedules for ${dates.length} dates...`,
    });

    // Fetch schedules for each date (rate limited internally)
    // Normalize dates to YYYY-MM-DD format (remove time component)
    const sortedDates = [...dates]
      .map((d) => d.report_date)
      .filter(Boolean)
      .map((s) => String(s).split("T")[0])
      .sort((a, b) => new Date(a) - new Date(b));

    console.log(
      `[API] Normalized dates: ${sortedDates.slice(0, 3).join(", ")}${
        sortedDates.length > 3 ? "..." : ""
      }`
    );

    const historyResults = [];
    let completedCount = 0;

    // Batch requests to avoid browser connection limits (process 20 at a time)
    const BATCH_SIZE = 20;
    for (let i = 0; i < sortedDates.length; i += BATCH_SIZE) {
      const batch = sortedDates.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (date) => {
        try {
          const schedules = await fetchSchedulesForDate(clientId, date, signal);
          completedCount++;

          // Update progress after each request completes
          if (
            completedCount % 10 === 0 ||
            completedCount === 1 ||
            completedCount === sortedDates.length
          ) {
            onProgress?.({
              stage: "history",
              progress: Math.round((completedCount / sortedDates.length) * 100),
              message: `Loading schedule ${completedCount}/${sortedDates.length}...`,
            });
          }

          return { date, schedules };
        } catch (error) {
          completedCount++;
          console.error(`Error fetching schedule for ${date}:`, error.message);
          return { date, schedules: [], error: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      historyResults.push(...batchResults);
    }
    const historyData = {
      history: historyResults,
    };

    onProgress?.({
      stage: "history",
      progress: 100,
      message: "All schedules loaded",
    });

    // Stage 3: Aggregate metrics client-side
    onProgress?.({
      stage: "aggregation",
      progress: 0,
      message: "Aggregating device metrics...",
    });

    const deviceMetrics = aggregateDeviceMetrics(
      devices,
      dates,
      units,
      historyData
    );

    onProgress?.({
      stage: "aggregation",
      progress: 100,
      message: "Aggregation complete",
    });

    // Stage 4: Fetch energy base data (meters + intervals)
    onProgress?.({
      stage: "energy",
      progress: 0,
      message: "Loading energy base data...",
    });

    const [meters, intervals] = await Promise.all([
      fetchMeters(clientId, signal),
      fetchIntervals(clientId, signal),
    ]);

    onProgress?.({
      stage: "energy",
      progress: 33,
      message: "Computing actual energy...",
    });

    const actualEnergy = computeActualEnergy(meters, intervals);

    onProgress?.({
      stage: "energy",
      progress: 50,
      message: `Fetching schedule details for ${sortedDates.length} dates...`,
    });

    // Fetch schedule details for each date (batched)
    let detailsCompletedCount = 0;
    const scheduleDetailsByDate = [];

    for (let i = 0; i < sortedDates.length; i += BATCH_SIZE) {
      const batch = sortedDates.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (date) => {
        try {
          const details = await fetchScheduleDetailsForDate(
            clientId,
            date,
            signal
          );
          detailsCompletedCount++;

          // Update progress after each request completes
          if (
            detailsCompletedCount % 10 === 0 ||
            detailsCompletedCount === 1 ||
            detailsCompletedCount === sortedDates.length
          ) {
            onProgress?.({
              stage: "energy",
              progress:
                50 +
                Math.round((detailsCompletedCount / sortedDates.length) * 33),
              message: `Fetching schedule details ${detailsCompletedCount}/${sortedDates.length}...`,
            });
          }

          return { date, details };
        } catch (error) {
          detailsCompletedCount++;
          console.error(
            `Error fetching schedule details for ${date}:`,
            error.message
          );
          return { date, details: [], error: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      scheduleDetailsByDate.push(...batchResults);
    }

    // Debug logging for schedule details
    console.log(
      "[DEBUG] Schedule Details Count:",
      scheduleDetailsByDate.length
    );
    console.log(
      "[DEBUG] First schedule detail sample:",
      scheduleDetailsByDate[0]
    );
    if (scheduleDetailsByDate[0]?.details?.length > 0) {
      console.log(
        "[DEBUG] First detail row sample:",
        scheduleDetailsByDate[0].details[0]
      );
    }

    onProgress?.({
      stage: "energy",
      progress: 90,
      message: "Computing expected energy...",
    });

    const expectedEnergy = computeExpectedEnergy(
      meters,
      actualEnergy,
      dates,
      scheduleDetailsByDate
    );

    // Debug logging for expected energy
    console.log("[DEBUG] Expected Energy Count:", expectedEnergy.length);
    if (expectedEnergy.length > 0) {
      console.log("[DEBUG] First expected energy sample:", expectedEnergy[0]);
      if (expectedEnergy[0]?.Interval?.length > 0) {
        console.log(
          "[DEBUG] First interval sample:",
          expectedEnergy[0].Interval[0]
        );
      }
    }

    onProgress?.({
      stage: "energy",
      progress: 100,
      message: "Energy data complete",
    });

    console.log("[API] All data loaded successfully");

    return {
      meta: {
        clientId: Number(clientId),
        reportsCount: dates.length,
        firstReportDate: dates[0]?.report_date,
        mostRecentDate: dates[dates.length - 1]?.report_date,
        generatedAt: new Date().toISOString(),
      },
      devices: deviceMetrics,
      energy: { expected: expectedEnergy, actual: actualEnergy },
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new DOMException("Request aborted", "AbortError");
    }
    throw err;
  }
}

/**
 * Fetch compiled report data without streaming (fallback)
 * Uses the new separate endpoints to fetch all data
 * @param {string|number} clientId - The client ID
 * @returns {Promise<Object>} The complete report data
 */
export async function fetchCompiledReport(clientId) {
  console.log("[API] Fetching all report data for clientId:", clientId);

  // This function is a simplified version without progress tracking
  // For production use, use fetchCompiledReportStream instead
  return fetchCompiledReportStream(clientId, null, null);
}

/**
 * Fetch top runtime devices
 * @param {string|number} clientId - The client ID
 * @param {number} limit - Number of top devices to fetch
 * @returns {Promise<Object>} The top runtime data
 */
export async function fetchTopRuntime(clientId, limit = 10) {
  const url = `${API_BASE_URL}/analytics/runtime-top/${clientId}?limit=${limit}`;
  console.log(`[API] Fetching top runtime from:`, url);

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  return response.json();
}
