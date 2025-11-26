import { useEffect, useRef, useState } from "react";
import { fetchPelicanBulkLoad } from "../services/api";

/**
 * Determine if a thermostat entry indicates the unit is running
 * runStatus values: "Off", "Fan", "Cool-Stage1", "Cool-Stage2", "Heat-Stage1", "Heat-Stage2", etc.
 * Anything not "Off" means it's running
 */
function isRunning(entry) {
  const runStatus = String(entry?.runStatus || "").trim().toLowerCase();
  return runStatus && runStatus !== "off";
}

/**
 * Parse temperature value from entry
 */
function parseTemp(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Analyze temperature setpoints for a thermostat to determine occupied vs unoccupied thresholds
 * - Highest heating temp = occupied
 * - Lowest heating temp = unoccupied
 * - Lowest cooling temp = occupied
 * - Highest cooling temp = unoccupied
 */
function analyzeTemperatureThresholds(entries) {
  const heatTemps = new Set();
  const coolTemps = new Set();

  for (const entry of entries) {
    const heat = parseTemp(entry.heatSetting);
    const cool = parseTemp(entry.coolSetting);
    if (heat !== null && heat > 0) heatTemps.add(heat);
    if (cool !== null && cool > 0) coolTemps.add(cool);
  }

  const heatArr = Array.from(heatTemps).sort((a, b) => a - b);
  const coolArr = Array.from(coolTemps).sort((a, b) => a - b);

  // Determine thresholds
  // Heating: highest = occupied, lowest = unoccupied
  // Cooling: lowest = occupied, highest = unoccupied
  const occupiedHeat = heatArr.length > 0 ? heatArr[heatArr.length - 1] : null;
  const unoccupiedHeat = heatArr.length > 1 ? heatArr[0] : null;
  const occupiedCool = coolArr.length > 0 ? coolArr[0] : null;
  const unoccupiedCool = coolArr.length > 1 ? coolArr[coolArr.length - 1] : null;

  return {
    occupiedHeat,
    unoccupiedHeat,
    occupiedCool,
    unoccupiedCool,
    heatTemps: heatArr,
    coolTemps: coolArr,
  };
}

/**
 * Determine if an entry is "occupied" based on temperature setpoints
 */
function isOccupiedByTemp(entry, thresholds) {
  const heat = parseTemp(entry.heatSetting);
  const cool = parseTemp(entry.coolSetting);

  // If we have distinct occupied/unoccupied temps, check against them
  if (thresholds.occupiedHeat !== null && thresholds.unoccupiedHeat !== null) {
    // If heat setting matches occupied heat, it's occupied
    if (heat !== null && heat >= thresholds.occupiedHeat) {
      return true;
    }
    // If heat setting matches unoccupied heat, it's unoccupied
    if (heat !== null && heat <= thresholds.unoccupiedHeat) {
      return false;
    }
  }

  if (thresholds.occupiedCool !== null && thresholds.unoccupiedCool !== null) {
    // If cool setting matches occupied cool (lower temp), it's occupied
    if (cool !== null && cool <= thresholds.occupiedCool) {
      return true;
    }
    // If cool setting matches unoccupied cool (higher temp), it's unoccupied
    if (cool !== null && cool >= thresholds.unoccupiedCool) {
      return false;
    }
  }

  // Fallback: use typical values
  // Occupied: heat around 68, cool around 72
  // Unoccupied: heat around 50, cool around 90
  if (heat !== null) {
    if (heat >= 65) return true;
    if (heat <= 55) return false;
  }
  if (cool !== null) {
    if (cool <= 75) return true;
    if (cool >= 85) return false;
  }

  // If we can't determine, assume occupied (safer default)
  return true;
}

/**
 * Calculate analytics from raw thermostat data
 */
function calculateAnalytics(thermostats, buildings, dateRange) {
  // First pass: group all entries by thermostat and analyze temperature thresholds
  const thermostatEntries = new Map();

  for (const t of thermostats) {
    const key = t.serialNo;
    if (!thermostatEntries.has(key)) {
      thermostatEntries.set(key, {
        serialNo: t.serialNo,
        name: t.entries?.[0]?.name || t.serialNo,
        groupName: t.entries?.[0]?.groupName || "Unknown",
        siteSlug: t.siteSlug,
        entries: [],
        dates: new Set(),
      });
    }
    const agg = thermostatEntries.get(key);
    agg.entries.push(...(t.entries || []));
    if (t.date) agg.dates.add(t.date);
  }

  // Analyze temperature thresholds for each thermostat
  const thermostatThresholds = new Map();
  for (const [serialNo, data] of thermostatEntries) {
    thermostatThresholds.set(serialNo, analyzeTemperatureThresholds(data.entries));
  }

  // Second pass: calculate stats using temperature-based occupancy
  const byDate = new Map();
  const thermostatStats = [];

  for (const [serialNo, data] of thermostatEntries) {
    const thresholds = thermostatThresholds.get(serialNo);
    let occupancyMinutes = 0;
    let runtimeMinutes = 0;
    let occupiedHeatSum = 0;
    let occupiedHeatCount = 0;
    let unoccupiedHeatSum = 0;
    let unoccupiedHeatCount = 0;
    let occupiedCoolSum = 0;
    let occupiedCoolCount = 0;
    let unoccupiedCoolSum = 0;
    let unoccupiedCoolCount = 0;

    for (const entry of data.entries) {
      const interval = 15;
      const occupied = isOccupiedByTemp(entry, thresholds);
      const running = isRunning(entry);

      if (occupied) {
        occupancyMinutes += interval;
      }
      if (running) {
        runtimeMinutes += interval;
      }

      // Collect temperature stats
      const heat = parseTemp(entry.heatSetting);
      const cool = parseTemp(entry.coolSetting);
      if (heat !== null) {
        if (occupied) {
          occupiedHeatSum += heat;
          occupiedHeatCount++;
        } else {
          unoccupiedHeatSum += heat;
          unoccupiedHeatCount++;
        }
      }
      if (cool !== null) {
        if (occupied) {
          occupiedCoolSum += cool;
          occupiedCoolCount++;
        } else {
          unoccupiedCoolSum += cool;
          unoccupiedCoolCount++;
        }
      }
    }

    const daysWithData = data.dates.size;
    const runtimeByOccupancy =
      occupancyMinutes > 0 ? (runtimeMinutes / occupancyMinutes) * 100 : 0;

    thermostatStats.push({
      serialNo,
      name: data.name,
      groupName: data.groupName,
      siteSlug: data.siteSlug,
      daysWithData,
      totalMinutes: data.entries.length * 15,
      occupancyMinutes,
      runtimeMinutes,
      runtimeByOccupancy,
      avgDailyOccupancyMinutes: daysWithData > 0 ? occupancyMinutes / daysWithData : 0,
      avgDailyRuntimeMinutes: daysWithData > 0 ? runtimeMinutes / daysWithData : 0,
      // Temperature stats
      temps: {
        occupiedHeat: occupiedHeatCount > 0 ? occupiedHeatSum / occupiedHeatCount : null,
        unoccupiedHeat: unoccupiedHeatCount > 0 ? unoccupiedHeatSum / unoccupiedHeatCount : null,
        occupiedCool: occupiedCoolCount > 0 ? occupiedCoolSum / occupiedCoolCount : null,
        unoccupiedCool: unoccupiedCoolCount > 0 ? unoccupiedCoolSum / unoccupiedCoolCount : null,
        thresholds,
      },
    });

    // Also aggregate by date
    for (const t of thermostats.filter((x) => x.serialNo === serialNo)) {
      const date = t.date;
      if (!date) continue;

      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          occupancyMinutes: 0,
          runtimeMinutes: 0,
          thermostatCount: 0,
        });
      }
      const dailyAgg = byDate.get(date);

      for (const entry of t.entries || []) {
        const interval = 15;
        if (isOccupiedByTemp(entry, thresholds)) {
          dailyAgg.occupancyMinutes += interval;
        }
        if (isRunning(entry)) {
          dailyAgg.runtimeMinutes += interval;
        }
      }
      dailyAgg.thermostatCount++;
    }
  }

  // Convert daily map to sorted array
  const daily = Array.from(byDate.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // Aggregate by building (groupName)
  const byBuilding = new Map();
  for (const stat of thermostatStats) {
    const group = stat.groupName;
    if (!byBuilding.has(group)) {
      byBuilding.set(group, {
        groupName: group,
        thermostats: [],
        totalMinutes: 0,
        occupancyMinutes: 0,
        runtimeMinutes: 0,
        occupiedHeatSum: 0,
        occupiedHeatCount: 0,
        unoccupiedHeatSum: 0,
        unoccupiedHeatCount: 0,
        occupiedCoolSum: 0,
        occupiedCoolCount: 0,
        unoccupiedCoolSum: 0,
        unoccupiedCoolCount: 0,
      });
    }
    const agg = byBuilding.get(group);
    agg.thermostats.push(stat);
    agg.totalMinutes += stat.totalMinutes;
    agg.occupancyMinutes += stat.occupancyMinutes;
    agg.runtimeMinutes += stat.runtimeMinutes;

    // Aggregate temps
    if (stat.temps.occupiedHeat !== null) {
      agg.occupiedHeatSum += stat.temps.occupiedHeat;
      agg.occupiedHeatCount++;
    }
    if (stat.temps.unoccupiedHeat !== null) {
      agg.unoccupiedHeatSum += stat.temps.unoccupiedHeat;
      agg.unoccupiedHeatCount++;
    }
    if (stat.temps.occupiedCool !== null) {
      agg.occupiedCoolSum += stat.temps.occupiedCool;
      agg.occupiedCoolCount++;
    }
    if (stat.temps.unoccupiedCool !== null) {
      agg.unoccupiedCoolSum += stat.temps.unoccupiedCool;
      agg.unoccupiedCoolCount++;
    }
  }

  const buildingStats = Array.from(byBuilding.values()).map((agg) => ({
    groupName: agg.groupName,
    thermostats: agg.thermostats,
    thermostatCount: agg.thermostats.length,
    totalMinutes: agg.totalMinutes,
    occupancyMinutes: agg.occupancyMinutes,
    runtimeMinutes: agg.runtimeMinutes,
    runtimeByOccupancy:
      agg.occupancyMinutes > 0
        ? (agg.runtimeMinutes / agg.occupancyMinutes) * 100
        : 0,
    avgOccupancyMinutes:
      agg.thermostats.length > 0
        ? agg.occupancyMinutes / agg.thermostats.length
        : 0,
    avgRuntimeMinutes:
      agg.thermostats.length > 0
        ? agg.runtimeMinutes / agg.thermostats.length
        : 0,
    temps: {
      occupiedHeat: agg.occupiedHeatCount > 0 ? agg.occupiedHeatSum / agg.occupiedHeatCount : null,
      unoccupiedHeat: agg.unoccupiedHeatCount > 0 ? agg.unoccupiedHeatSum / agg.unoccupiedHeatCount : null,
      occupiedCool: agg.occupiedCoolCount > 0 ? agg.occupiedCoolSum / agg.occupiedCoolCount : null,
      unoccupiedCool: agg.unoccupiedCoolCount > 0 ? agg.unoccupiedCoolSum / agg.unoccupiedCoolCount : null,
    },
  }));

  // Campus-level aggregation
  let campusTotalMinutes = 0;
  let campusOccupancyMinutes = 0;
  let campusRuntimeMinutes = 0;
  let campusOccupiedHeatSum = 0;
  let campusOccupiedHeatCount = 0;
  let campusUnoccupiedHeatSum = 0;
  let campusUnoccupiedHeatCount = 0;
  let campusOccupiedCoolSum = 0;
  let campusOccupiedCoolCount = 0;
  let campusUnoccupiedCoolSum = 0;
  let campusUnoccupiedCoolCount = 0;

  for (const b of buildingStats) {
    campusTotalMinutes += b.totalMinutes;
    campusOccupancyMinutes += b.occupancyMinutes;
    campusRuntimeMinutes += b.runtimeMinutes;

    if (b.temps.occupiedHeat !== null) {
      campusOccupiedHeatSum += b.temps.occupiedHeat * b.thermostatCount;
      campusOccupiedHeatCount += b.thermostatCount;
    }
    if (b.temps.unoccupiedHeat !== null) {
      campusUnoccupiedHeatSum += b.temps.unoccupiedHeat * b.thermostatCount;
      campusUnoccupiedHeatCount += b.thermostatCount;
    }
    if (b.temps.occupiedCool !== null) {
      campusOccupiedCoolSum += b.temps.occupiedCool * b.thermostatCount;
      campusOccupiedCoolCount += b.thermostatCount;
    }
    if (b.temps.unoccupiedCool !== null) {
      campusUnoccupiedCoolSum += b.temps.unoccupiedCool * b.thermostatCount;
      campusUnoccupiedCoolCount += b.thermostatCount;
    }
  }

  const campusStats = {
    buildingCount: buildingStats.length,
    thermostatCount: thermostatStats.length,
    totalMinutes: campusTotalMinutes,
    occupancyMinutes: campusOccupancyMinutes,
    runtimeMinutes: campusRuntimeMinutes,
    runtimeByOccupancy:
      campusOccupancyMinutes > 0
        ? (campusRuntimeMinutes / campusOccupancyMinutes) * 100
        : 0,
    avgOccupancyMinutes:
      thermostatStats.length > 0
        ? campusOccupancyMinutes / thermostatStats.length
        : 0,
    avgRuntimeMinutes:
      thermostatStats.length > 0
        ? campusRuntimeMinutes / thermostatStats.length
        : 0,
    temps: {
      occupiedHeat: campusOccupiedHeatCount > 0 ? campusOccupiedHeatSum / campusOccupiedHeatCount : null,
      unoccupiedHeat: campusUnoccupiedHeatCount > 0 ? campusUnoccupiedHeatSum / campusUnoccupiedHeatCount : null,
      occupiedCool: campusOccupiedCoolCount > 0 ? campusOccupiedCoolSum / campusOccupiedCoolCount : null,
      unoccupiedCool: campusUnoccupiedCoolCount > 0 ? campusUnoccupiedCoolSum / campusUnoccupiedCoolCount : null,
    },
  };

  return {
    dateRange,
    campus: campusStats,
    buildings: buildingStats,
    thermostats: thermostatStats,
    daily,
  };
}

export function usePelicanData(clientId, days = 14) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({
    pelican: { progress: 0, message: "" },
  });
  const abortControllerRef = useRef(null);

  useEffect(() => {
    if (!clientId || !String(clientId).trim()) {
      setData(null);
      setLoading(false);
      setError(null);
      setProgress({
        pelican: { progress: 0, message: "" },
      });
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const currentController = abortControllerRef.current;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        setProgress({
          pelican: { progress: 0, message: "" },
        });

        const result = await fetchPelicanBulkLoad(
          clientId,
          days,
          (progressData) => {
            setProgress((prev) => ({
              ...prev,
              [progressData.stage]: {
                progress: progressData.progress,
                message: progressData.message,
              },
            }));
          },
          currentController.signal
        );

        if (!currentController.signal.aborted) {
          console.log("[usePelicanData] Load complete:", result);

          // Calculate analytics client-side
          const analytics = calculateAnalytics(
            result.thermostats || [],
            result.buildings || [],
            result.dateRange
          );

          setData({
            ...result,
            analytics,
          });
        }
      } catch (err) {
        if (!currentController.signal.aborted) {
          if (err.name === "AbortError") {
            console.log("Request was cancelled");
          } else {
            setError(err.message);
          }
        }
      } finally {
        if (!currentController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      currentController.abort();
    };
  }, [clientId, days]);

  return { data, loading, error, progress };
}
