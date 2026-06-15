// Structured analytics export for report follow-up Q&A (schema version 1)
import { DataAggregationService } from "./services/aggregation.js";

const aggregationService = new DataAggregationService();

const MAX_METERS_ALL = 50;
const MAX_METERS_TOP = 30;
const MAX_DEVICES = 20;
const MAX_DAILY_PEAKS = 14;
const MAX_DIAGNOSTICS = 15;
const MAX_SETPOINT_DEVICE_SAMPLES = 10;
const HIGH_RUNTIME_PERCENT = 60;
const COLLAPSED_DEADBAND_F = 3;
const OVERNIGHT_INTERVAL_START = 0;
const OVERNIGHT_INTERVAL_END = 15; // 12:00 AM – 4:00 AM
const MORNING_PEAK_INTERVAL_START = 24; // 6:00 AM
const MORNING_PEAK_INTERVAL_END = 32; // 8:00 AM

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function isoDate(value) {
  if (!value) return null;
  const str = String(value);
  return str.includes("T") ? str.split("T")[0] : str;
}

function intervalToLocalTime(interval) {
  if (!Number.isFinite(interval)) return null;
  const hour = Math.floor(interval / 4);
  const minute = (interval % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function perMeterLatestDayTotals(list, date) {
  const out = new Map();
  if (!date) return out;
  for (const meter of list || []) {
    let sum = 0;
    for (const pt of meter?.Interval || []) {
      if (pt?.date === date) sum += Number(pt?.value) || 0;
    }
    out.set(meter.Id, sum);
  }
  return out;
}

function meterNameFor(id, energyExpected, energyActual) {
  const m1 = (energyExpected || []).find((m) => m.Id === id);
  if (m1?.Name) return m1.Name;
  const m2 = (energyActual || []).find((m) => m.Id === id);
  return m2?.Name || String(id);
}

function findPeakIntervalForDate(intervalsByDate, date) {
  const map = intervalsByDate.get(date);
  if (!map) return { interval: null, peakKwh: 0 };

  let peakInterval = null;
  let peakKwh = 0;
  for (const [intervalKey, value] of map.entries()) {
    if (!Number.isFinite(intervalKey)) continue;
    const val = Number(value) || 0;
    if (val > peakKwh) {
      peakKwh = val;
      peakInterval = intervalKey;
    }
  }
  return { interval: peakInterval, peakKwh };
}

function buildCoDailyRuntimeMap(devices) {
  const map = new Map();
  for (const device of devices || []) {
    for (const point of device.runtimeWeekly || []) {
      map.set(point.date, (map.get(point.date) || 0) + (point.minutes || 0));
    }
  }
  return map;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildPelicanThermostatLookup(thermostats) {
  const byName = new Map();
  for (const stat of thermostats || []) {
    const key = normalizeName(stat.name);
    if (key) byName.set(key, stat);
  }
  return byName;
}

function resolveImageKeys(fullData, capturedImageIds) {
  const meta = fullData.report?.meta || {};
  const devices = fullData.report?.devices || [];
  const energy = fullData.report?.energy || {};
  const pelicanAnalytics = fullData.pelican?.analytics || null;
  const energyExpected = Array.isArray(energy.expected) ? energy.expected : [];
  const energyActual = Array.isArray(energy.actual) ? energy.actual : [];

  const daily = aggregationService.getDailyEnergyAggregates(
    energyExpected,
    energyActual
  );
  const hasEnergy = daily.labels.length > 0;

  const keys = [];
  if (devices.length > 0) {
    keys.push("topRuntime", "weeklyRuntime");
  }
  if (hasEnergy) {
    keys.push(
      "dailyEnergyUse",
      "dailyPeakDemand",
      "intervalLatestDay",
      "intervalAverageDay"
    );
  }
  if (pelicanAnalytics) {
    keys.push("scheduleVsOccupancy", "setpointTrends");
  }

  if (!Array.isArray(capturedImageIds)) {
    return [];
  }

  if (capturedImageIds.length === 0) {
    return [];
  }

  const captured = new Set(capturedImageIds);
  return keys.filter((key) => captured.has(key));
}

export function enrichStreamMeta(meta, report, { clientName } = {}) {
  const energy = report?.energy || {};
  const energyExpected = Array.isArray(energy.expected) ? energy.expected : [];
  const energyActual = Array.isArray(energy.actual) ? energy.actual : [];
  const daily = aggregationService.getDailyEnergyAggregates(
    energyExpected,
    energyActual
  );

  const dateRange =
    daily.labels.length > 0
      ? {
          start: daily.labels[0],
          end: daily.labels[daily.labels.length - 1],
        }
      : meta.firstReportDate || meta.mostRecentDate
        ? {
            start: isoDate(meta.firstReportDate),
            end: isoDate(meta.mostRecentDate),
          }
        : undefined;

  return {
    ...meta,
    ...(clientName ? { clientName } : {}),
    ...(dateRange ? { dateRange } : {}),
  };
}

export function buildReportAnalytics(fullData, options = {}) {
  try {
    const report = fullData?.report || {};
    const meta = report.meta || {};
    const devices = report.devices || [];
    const energy = report.energy || {};
    const pelicanAnalytics = fullData?.pelican?.analytics || null;
    const energyExpected = Array.isArray(energy.expected) ? energy.expected : [];
    const energyActual = Array.isArray(energy.actual) ? energy.actual : [];

    const { totals: dailyExpectedMap, peakKw: peakExpectedMap, intervalsByDate: intervalsExpected } =
      aggregationService._dailyAggregates(energyExpected);
    const { totals: dailyActualMap, peakKw: peakActualMap, intervalsByDate: intervalsActual } =
      aggregationService._dailyAggregates(energyActual);

    const energyLabels = aggregationService._uniqueSortedDatesFromMaps(
      dailyExpectedMap,
      dailyActualMap
    );
    const latestEnergyDate = energyLabels.length
      ? energyLabels[energyLabels.length - 1]
      : null;

    const slice = buildReportSlice({
      reportKey: `${meta.clientId || "client"}-${isoDate(meta.mostRecentDate) || "latest"}`,
      meta,
      devices,
      energyExpected,
      energyActual,
      energyLabels,
      latestEnergyDate,
      dailyExpectedMap,
      dailyActualMap,
      peakExpectedMap,
      peakActualMap,
      intervalsExpected,
      intervalsActual,
      pelicanAnalytics,
      imageKeys: resolveImageKeys(fullData, options.capturedImageIds),
    });

    const summary = buildSummary(slice, pelicanAnalytics);

    return {
      version: 1,
      summary,
      reports: [slice],
    };
  } catch (err) {
    console.warn("[report-analytics] Failed to build analytics:", err.message);
    return null;
  }
}

function buildReportSlice(ctx) {
  const metersResult = buildMeters(ctx);
  const energy = buildEnergySummary(ctx);
  const demand = buildDemandSummary(ctx);
  const devicesResult = buildDevices(ctx);
  const setpointTrends = buildSetpointTrends(ctx.pelicanAnalytics);
  const scheduleCompliance = buildScheduleCompliance(
    ctx.pelicanAnalytics,
    ctx.devices
  );
  const baseload = buildBaseload(ctx);
  const diagnostics = buildDiagnostics({
    ...ctx,
    meters: metersResult.meters,
    devices: devicesResult.devices,
    energy,
    demand,
    setpointTrends,
    scheduleCompliance,
    baseload,
  });

  return {
    reportKey: ctx.reportKey,
    siteSlug: null,
    siteName: null,
    buildingName: null,
    dateRange: {
      start:
        isoDate(ctx.meta.firstReportDate) ||
        (ctx.energyLabels[0] ?? null),
      end:
        isoDate(ctx.meta.mostRecentDate) ||
        (ctx.energyLabels[ctx.energyLabels.length - 1] ?? null),
    },
    imageKeys: ctx.imageKeys,
    meters: metersResult.meters,
    energy,
    demand,
    devices: devicesResult.devices,
    diagnostics,
    scheduleCompliance,
    setpointTrends,
    baseload,
    ...(metersResult.truncated || devicesResult.truncated
      ? {
          truncated: true,
          omittedCounts: {
            ...(metersResult.omittedCount
              ? { meters: metersResult.omittedCount }
              : {}),
            ...(devicesResult.omittedCount
              ? { devices: devicesResult.omittedCount }
              : {}),
          },
        }
      : {}),
  };
}

function buildMeters(ctx) {
  const latestExpectedByMeter = perMeterLatestDayTotals(
    ctx.energyExpected,
    ctx.latestEnergyDate
  );
  const latestActualByMeter = perMeterLatestDayTotals(
    ctx.energyActual,
    ctx.latestEnergyDate
  );

  const meterIdSet = new Set([
    ...latestExpectedByMeter.keys(),
    ...latestActualByMeter.keys(),
  ]);

  const allMeters = Array.from(meterIdSet).map((id) => {
    const expected = latestExpectedByMeter.get(id) || 0;
    const actual = latestActualByMeter.get(id) || 0;
    const delta = actual - expected;
    return {
      meterName: meterNameFor(id, ctx.energyExpected, ctx.energyActual),
      meterId: id != null ? String(id) : null,
      delta: round2(delta),
      deltaUnit: "kWh",
      expected: round2(expected),
      actual: round2(actual),
    };
  });

  allMeters.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  allMeters.forEach((meter, index) => {
    meter.rank = index + 1;
  });

  if (allMeters.length <= MAX_METERS_ALL) {
    return { meters: allMeters, truncated: false, omittedCount: 0 };
  }

  return {
    meters: allMeters.slice(0, MAX_METERS_TOP),
    truncated: true,
    omittedCount: allMeters.length - MAX_METERS_TOP,
  };
}

function buildEnergySummary(ctx) {
  let totalExpected = 0;
  let totalActual = 0;

  for (const date of ctx.energyLabels) {
    totalExpected += ctx.dailyExpectedMap.get(date) || 0;
    totalActual += ctx.dailyActualMap.get(date) || 0;
  }

  if (ctx.energyLabels.length === 0) {
    return {
      actualAboveExpected: null,
      totalExpected: null,
      totalActual: null,
      missMagnitude: null,
      missUnit: "kWh",
    };
  }

  const missMagnitude = totalActual - totalExpected;
  return {
    actualAboveExpected: missMagnitude > 0,
    totalExpected: round2(totalExpected),
    totalActual: round2(totalActual),
    missMagnitude: round2(missMagnitude),
    missUnit: "kWh",
  };
}

function buildDemandSummary(ctx) {
  const peakDates = ctx.energyLabels.slice(-MAX_DAILY_PEAKS);
  const dailyPeaks = peakDates
    .map((date) => {
      const peakKw = ctx.peakActualMap.get(date) || 0;
      const { interval } = findPeakIntervalForDate(ctx.intervalsActual, date);
      return {
        date,
        peakKw: round2(peakKw),
        peakTimeLocal: intervalToLocalTime(interval),
      };
    })
    .filter((row) => row.peakKw > 0);

  let peakDate = null;
  let peakDemandKw = null;
  let peakTimeLocal = null;
  let morningStartupPeak = null;
  let loadRollingConcern = null;

  for (const date of ctx.energyLabels) {
    const peakKw = ctx.peakActualMap.get(date) || 0;
    if (peakDemandKw == null || peakKw > peakDemandKw) {
      peakDemandKw = peakKw;
      peakDate = date;
      const { interval } = findPeakIntervalForDate(ctx.intervalsActual, date);
      peakTimeLocal = intervalToLocalTime(interval);
    }
  }

  if (peakDate != null) {
    const { interval } = findPeakIntervalForDate(ctx.intervalsActual, peakDate);
    morningStartupPeak =
      Number.isFinite(interval) &&
      interval >= MORNING_PEAK_INTERVAL_START &&
      interval < MORNING_PEAK_INTERVAL_END;

    const expectedPeak = ctx.peakExpectedMap.get(peakDate) || 0;
    loadRollingConcern =
      morningStartupPeak &&
      peakDemandKw > expectedPeak * 1.05 &&
      peakDemandKw - expectedPeak > 5;
  }

  return {
    morningStartupPeak,
    peakTimeLocal,
    peakDemandKw: round2(peakDemandKw),
    peakDate,
    loadRollingConcern,
    dailyPeaks,
  };
}

function buildDevices(ctx) {
  const pelicanLookup = buildPelicanThermostatLookup(
    ctx.pelicanAnalytics?.thermostats
  );
  const minutesPerDay = 24 * 60;

  const ranked = aggregationService
    .sortDevices(ctx.devices, "runtimeAvg")
    .map((device) => {
      const runtimeMinutes = device.runtimeAvgMin || 0;
      const runtimePercent = round2((runtimeMinutes / minutesPerDay) * 100);
      const pelicanMatch = pelicanLookup.get(normalizeName(device.name));
      const flags = [];

      const effectiveRuntimePercent =
        pelicanMatch?.runtimeByOccupancy ?? runtimePercent;
      if (effectiveRuntimePercent >= HIGH_RUNTIME_PERCENT) {
        flags.push("high_runtime");
      }

      const ramptime = device.ramptimeAvgMin || 0;
      if (runtimeMinutes > 0 && ramptime / runtimeMinutes > 0.35) {
        flags.push("short_cycling");
      }

      if (
        pelicanMatch &&
        pelicanMatch.occupancyMinutes > 0 &&
        pelicanMatch.runtimeMinutes > pelicanMatch.occupancyMinutes * 1.1
      ) {
        flags.push("unscheduled_runtime");
      }

      if (pelicanMatch?.temps) {
        const deadband =
          pelicanMatch.temps.occupiedCool != null &&
          pelicanMatch.temps.occupiedHeat != null
            ? pelicanMatch.temps.occupiedCool - pelicanMatch.temps.occupiedHeat
            : null;
        if (deadband != null && deadband < COLLAPSED_DEADBAND_F) {
          flags.push("collapsed_deadband");
        }
        if (
          pelicanMatch.temps.unoccupiedCool != null &&
          pelicanMatch.temps.occupiedCool != null &&
          pelicanMatch.temps.unoccupiedCool < pelicanMatch.temps.occupiedCool
        ) {
          flags.push("improper_setback");
        }
      }

      return {
        deviceName: device.name,
        pelicanId: pelicanMatch?.serialNo ?? null,
        coDeviceId: null,
        runtimePercent: round2(effectiveRuntimePercent),
        coolingMinutes: null,
        heatingMinutes: null,
        latentRuntimeMinutes: null,
        fanMinutes: pelicanMatch ? round2(pelicanMatch.fanMinutes) : null,
        flags: flags.length ? flags : undefined,
        _sortRuntime: runtimeMinutes,
      };
    });

  ranked.sort((a, b) => (b._sortRuntime || 0) - (a._sortRuntime || 0));

  const allDevices = ranked.map((device, index) => {
    const { _sortRuntime, ...rest } = device;
    return { ...rest, rank: index + 1 };
  });

  if (allDevices.length <= MAX_DEVICES) {
    return { devices: allDevices, truncated: false, omittedCount: 0 };
  }

  return {
    devices: allDevices.slice(0, MAX_DEVICES),
    truncated: true,
    omittedCount: allDevices.length - MAX_DEVICES,
  };
}

function buildSetpointTrends(pelicanAnalytics) {
  if (!pelicanAnalytics) return undefined;

  const collapsedDeadbandDevices = [];
  const improperSetbackDevices = [];

  for (const stat of pelicanAnalytics.thermostats || []) {
    const temps = stat.temps || {};
    const deadband =
      temps.occupiedCool != null && temps.occupiedHeat != null
        ? temps.occupiedCool - temps.occupiedHeat
        : null;

    if (deadband != null && deadband < COLLAPSED_DEADBAND_F) {
      collapsedDeadbandDevices.push(stat.name);
    }

    if (
      temps.unoccupiedCool != null &&
      temps.occupiedCool != null &&
      temps.unoccupiedCool < temps.occupiedCool
    ) {
      improperSetbackDevices.push(stat.name);
    }
  }

  return {
    collapsedDeadbandDeviceCount: collapsedDeadbandDevices.length,
    improperSetbackDeviceCount: improperSetbackDevices.length,
    collapsedDeadbandDevices: collapsedDeadbandDevices.slice(
      0,
      MAX_SETPOINT_DEVICE_SAMPLES
    ),
    improperSetbackDevices: improperSetbackDevices.slice(
      0,
      MAX_SETPOINT_DEVICE_SAMPLES
    ),
  };
}

function buildScheduleCompliance(pelicanAnalytics, devices) {
  if (!pelicanAnalytics) return undefined;

  const pelicanDaily = Array.isArray(pelicanAnalytics.daily)
    ? pelicanAnalytics.daily
    : [];
  const pelicanDailyMap = new Map(pelicanDaily.map((d) => [d.date, d]));
  const coDailyMap = buildCoDailyRuntimeMap(devices);
  const combinedDates = Array.from(
    new Set([...pelicanDailyMap.keys(), ...coDailyMap.keys()])
  ).sort((a, b) => new Date(a) - new Date(b));

  let unscheduledRuntimeMinutes = 0;
  let exceedDays = 0;
  let comparedDays = 0;

  for (const date of combinedDates) {
    const pelicanDay = pelicanDailyMap.get(date);
    const coMinutes = coDailyMap.get(date) || 0;
    if (!pelicanDay) continue;

    comparedDays += 1;
    if (pelicanDay.runtimeMinutes > coMinutes) {
      unscheduledRuntimeMinutes += pelicanDay.runtimeMinutes - coMinutes;
    }
    if (
      pelicanDay.occupancyMinutes > 0 &&
      pelicanDay.runtimeMinutes > pelicanDay.occupancyMinutes
    ) {
      exceedDays += 1;
    }
  }

  return {
    unscheduledRuntimeMinutes: round2(unscheduledRuntimeMinutes),
    manualOverrideSuspected: unscheduledRuntimeMinutes > 600,
    runtimeExceedsSchedulePercent:
      comparedDays > 0 ? round2((exceedDays / comparedDays) * 100) : null,
  };
}

function buildBaseload(ctx) {
  const intervalAnalysis = aggregationService.getIntervalAnalysis(
    ctx.energyExpected,
    ctx.energyActual
  );

  if (!intervalAnalysis.intervals?.length) {
    return {
      highBaseload: null,
      overnightFloorKw: null,
      overnightFloorPercentOfPeak: null,
    };
  }

  const overnightIntervals = intervalAnalysis.intervals.filter(
    (interval) =>
      interval >= OVERNIGHT_INTERVAL_START && interval <= OVERNIGHT_INTERVAL_END
  );
  const overnightActual = overnightIntervals.map((interval, idx) => {
    const position = intervalAnalysis.intervals.indexOf(interval);
    return intervalAnalysis.actual[position] || 0;
  });

  const overnightFloorKwh =
    overnightActual.length > 0 ? Math.min(...overnightActual) : null;
  const overnightFloorKw =
    overnightFloorKwh != null ? round2(overnightFloorKwh * 4) : null;

  let peakDemandKw = 0;
  for (const date of ctx.energyLabels) {
    peakDemandKw = Math.max(peakDemandKw, ctx.peakActualMap.get(date) || 0);
  }

  const overnightFloorPercentOfPeak =
    overnightFloorKw != null && peakDemandKw > 0
      ? round2(overnightFloorKw / peakDemandKw)
      : null;

  return {
    highBaseload:
      overnightFloorPercentOfPeak != null
        ? overnightFloorPercentOfPeak >= 0.2
        : null,
    overnightFloorKw,
    overnightFloorPercentOfPeak,
  };
}

function buildDiagnostics(ctx) {
  const findings = [];

  if (ctx.demand?.morningStartupPeak) {
    findings.push({
      code: "morning_demand_peak",
      severity: "critical",
      title: "Morning startup demand peak",
      detail:
        "Daily peak demand consistently occurs between 6–8 AM; load rolling may be insufficient.",
      affectedMeters: ctx.meters.slice(0, 3).map((m) => m.meterName),
      evidence: {
        peakTimeLocal: ctx.demand.peakTimeLocal,
        peakDemandKw: ctx.demand.peakDemandKw,
        peakDate: ctx.demand.peakDate,
        loadRollingConcern: ctx.demand.loadRollingConcern,
      },
    });
  }

  if (ctx.baseload?.highBaseload) {
    findings.push({
      code: "high_baseload",
      severity: "warning",
      title: "Elevated overnight baseload",
      detail:
        "Overnight demand floor is a significant fraction of daily peak demand.",
      evidence: {
        overnightFloorKw: ctx.baseload.overnightFloorKw,
        overnightFloorPercentOfPeak: ctx.baseload.overnightFloorPercentOfPeak,
      },
    });
  }

  if ((ctx.scheduleCompliance?.unscheduledRuntimeMinutes || 0) > 120) {
    findings.push({
      code: "unscheduled_runtime",
      severity: "warning",
      title: "Unscheduled runtime detected",
      detail:
        "Pelican runtime exceeds CO scheduled minutes across the reporting window.",
      affectedDevices: ctx.devices
        .filter((d) => d.flags?.includes("unscheduled_runtime"))
        .slice(0, 5)
        .map((d) => d.deviceName),
      evidence: {
        unscheduledRuntimeMinutes:
          ctx.scheduleCompliance.unscheduledRuntimeMinutes,
      },
    });
  }

  if ((ctx.setpointTrends?.collapsedDeadbandDeviceCount || 0) > 0) {
    findings.push({
      code: "collapsed_deadband",
      severity: "warning",
      title: "Collapsed deadband on thermostats",
      detail: "One or more thermostats show occupied heat/cool setpoints too close together.",
      affectedDevices: ctx.setpointTrends.collapsedDeadbandDevices,
      evidence: {
        collapsedDeadbandDeviceCount:
          ctx.setpointTrends.collapsedDeadbandDeviceCount,
      },
    });
  }

  if ((ctx.setpointTrends?.improperSetbackDeviceCount || 0) > 0) {
    findings.push({
      code: "improper_setback",
      severity: "info",
      title: "Improper cooling setback",
      detail:
        "Unoccupied cooling setpoints are tighter than occupied setpoints on some thermostats.",
      affectedDevices: ctx.setpointTrends.improperSetbackDevices,
      evidence: {
        improperSetbackDeviceCount: ctx.setpointTrends.improperSetbackDeviceCount,
      },
    });
  }

  const highRuntimeDevices = ctx.devices.filter((d) =>
    d.flags?.includes("high_runtime")
  );
  if (highRuntimeDevices.length > 0) {
    findings.push({
      code: "high_runtime",
      severity: "warning",
      title: "High device runtime",
      detail: "Devices exceed 60% runtime during the reporting window.",
      affectedDevices: highRuntimeDevices.slice(0, 5).map((d) => d.deviceName),
      evidence: { deviceCount: highRuntimeDevices.length },
    });
  }

  const worstMeter = ctx.meters[0];
  if (worstMeter && (worstMeter.delta ?? 0) > 0) {
    findings.push({
      code: "meter_energy_over",
      severity: worstMeter.delta > 500 ? "critical" : "warning",
      title: "Meter energy over expected",
      detail: `${worstMeter.meterName} exceeded expected use on the latest snapshot day.`,
      affectedMeters: [worstMeter.meterName],
      evidence: {
        delta: worstMeter.delta,
        expected: worstMeter.expected,
        actual: worstMeter.actual,
      },
    });
  }

  return findings.slice(0, MAX_DIAGNOSTICS);
}

function buildSummary(slice, pelicanAnalytics) {
  const meters = slice.meters || [];
  const devices = slice.devices || [];
  const diagnostics = slice.diagnostics || [];

  const metersWithPositiveDelta = meters.filter((m) => (m.delta ?? 0) > 0).length;
  const metersWithNegativeDelta = meters.filter((m) => (m.delta ?? 0) < 0).length;
  const devicesWithHighRuntime = devices.filter((d) =>
    d.flags?.includes("high_runtime")
  ).length;
  const unscheduledRuntimeEvents = diagnostics.filter(
    (d) => d.code === "unscheduled_runtime"
  ).length;

  const totalDelta = slice.energy?.missMagnitude ?? null;
  const criticalCount = diagnostics.filter((d) => d.severity === "critical").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

  let overallGrade = "UNKNOWN";
  if (meters.length > 0 || devices.length > 0 || pelicanAnalytics) {
    if (criticalCount > 0 || (totalDelta != null && totalDelta > 500)) {
      overallGrade = "FAIL";
    } else if (
      warningCount > 0 ||
      (totalDelta != null && totalDelta > 0)
    ) {
      overallGrade = "WATCH";
    } else {
      overallGrade = "PASS";
    }
  }

  const primary = diagnostics[0];
  return {
    overallGrade,
    totalDelta,
    totalDeltaUnit: slice.energy?.missUnit || "kWh",
    primaryIssueCode: primary?.code ?? null,
    primaryIssueLabel: primary?.title ?? null,
    metersWithPositiveDelta,
    metersWithNegativeDelta,
    devicesWithHighRuntime,
    unscheduledRuntimeEvents,
  };
}

export async function resolveClientName(clientId) {
  try {
    const { getClients } = await import("./co-client.js");
    const raw = await getClients();
    const clients = Array.isArray(raw?.clients) ? raw.clients : raw || [];
    const match = clients.find(
      (client) =>
        String(client?.Id ?? client?.id ?? client?.ClientId) === String(clientId)
    );
    return (
      match?.Name ||
      match?.name ||
      match?.ClientName ||
      match?.clientName ||
      null
    );
  } catch (err) {
    console.warn("[report-analytics] Client name lookup failed:", err.message);
    return null;
  }
}
