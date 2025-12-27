import { useEffect, useRef, useState } from "react";
import { fetchPelicanBulkLoad } from "../services/api";

function toMinutes(seconds) {
  const value = Number(seconds ?? 0) / 60;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Calculate analytics from summarized thermostat-day data
 */
function calculateAnalytics(thermostats, buildings, dateRange) {
  const byDate = new Map();
  const byThermostat = new Map();

  for (const t of thermostats || []) {
    const serialNo = t.serialNo;
    if (!serialNo) continue;

    const groupName = t.groupName || t.group || "Unknown";
    const siteSlug = t.siteSlug;
    const date = t.date;

    const occupiedMinutes = toMinutes(t.occupiedTime);
    const runtimeMinutes = toMinutes((t.coolRuntime || 0) + (t.heatRuntime || 0));
    const fanMinutes = toMinutes(t.fanRuntime);
    const totalMinutes = 24 * 60; // one full day

    // Daily aggregation (for charts)
    if (date) {
      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          occupancyMinutes: 0,
          runtimeMinutes: 0,
          fanMinutes: 0,
          thermostatCount: 0,
        });
      }
      const daily = byDate.get(date);
      daily.occupancyMinutes += occupiedMinutes;
      daily.runtimeMinutes += runtimeMinutes;
      daily.fanMinutes += fanMinutes;
      daily.thermostatCount += 1;
    }

    // Per-thermostat aggregation
    if (!byThermostat.has(serialNo)) {
      byThermostat.set(serialNo, {
        serialNo,
        name: t.name || serialNo,
        groupName,
        siteSlug,
        daysWithData: 0,
        totalMinutes: 0,
        occupancyMinutes: 0,
        runtimeMinutes: 0,
        fanMinutes: 0,
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

    const agg = byThermostat.get(serialNo);
    agg.daysWithData += date ? 1 : 0;
    agg.totalMinutes += totalMinutes;
    agg.occupancyMinutes += occupiedMinutes;
    agg.runtimeMinutes += runtimeMinutes;
    agg.fanMinutes += fanMinutes;

    // Temperature bands: use extrema as proxies
    const occupiedHeat = Number.isFinite(t.maxHeatSetpoint) ? t.maxHeatSetpoint : null;
    const unoccupiedHeat = Number.isFinite(t.minHeatSetpoint) ? t.minHeatSetpoint : null;
    const occupiedCool = Number.isFinite(t.minCoolSetpoint) ? t.minCoolSetpoint : null;
    const unoccupiedCool = Number.isFinite(t.maxCoolSetpoint) ? t.maxCoolSetpoint : null;

    if (occupiedHeat !== null) {
      agg.occupiedHeatSum += occupiedHeat;
      agg.occupiedHeatCount++;
    }
    if (unoccupiedHeat !== null) {
      agg.unoccupiedHeatSum += unoccupiedHeat;
      agg.unoccupiedHeatCount++;
    }
    if (occupiedCool !== null) {
      agg.occupiedCoolSum += occupiedCool;
      agg.occupiedCoolCount++;
    }
    if (unoccupiedCool !== null) {
      agg.unoccupiedCoolSum += unoccupiedCool;
      agg.unoccupiedCoolCount++;
    }
  }

  // Build thermostat stats array
  const thermostatStats = Array.from(byThermostat.values()).map((agg) => {
    const runtimeByOccupancy =
      agg.occupancyMinutes > 0 ? (agg.runtimeMinutes / agg.occupancyMinutes) * 100 : 0;

    return {
      serialNo: agg.serialNo,
      name: agg.name,
      groupName: agg.groupName,
      siteSlug: agg.siteSlug,
      daysWithData: agg.daysWithData,
      totalMinutes: agg.totalMinutes,
      occupancyMinutes: agg.occupancyMinutes,
      runtimeMinutes: agg.runtimeMinutes,
      fanMinutes: agg.fanMinutes,
      runtimeByOccupancy,
      avgDailyOccupancyMinutes:
        agg.daysWithData > 0 ? agg.occupancyMinutes / agg.daysWithData : 0,
      avgDailyRuntimeMinutes:
        agg.daysWithData > 0 ? agg.runtimeMinutes / agg.daysWithData : 0,
      temps: {
        occupiedHeat:
          agg.occupiedHeatCount > 0 ? agg.occupiedHeatSum / agg.occupiedHeatCount : null,
        unoccupiedHeat:
          agg.unoccupiedHeatCount > 0
            ? agg.unoccupiedHeatSum / agg.unoccupiedHeatCount
            : null,
        occupiedCool:
          agg.occupiedCoolCount > 0 ? agg.occupiedCoolSum / agg.occupiedCoolCount : null,
        unoccupiedCool:
          agg.unoccupiedCoolCount > 0
            ? agg.unoccupiedCoolSum / agg.unoccupiedCoolCount
            : null,
      },
    };
  });

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
        fanMinutes: 0,
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
    agg.fanMinutes += stat.fanMinutes;

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
    fanMinutes: agg.fanMinutes,
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
      occupiedHeat:
        agg.occupiedHeatCount > 0 ? agg.occupiedHeatSum / agg.occupiedHeatCount : null,
      unoccupiedHeat:
        agg.unoccupiedHeatCount > 0
          ? agg.unoccupiedHeatSum / agg.unoccupiedHeatCount
          : null,
      occupiedCool:
        agg.occupiedCoolCount > 0 ? agg.occupiedCoolSum / agg.occupiedCoolCount : null,
      unoccupiedCool:
        agg.unoccupiedCoolCount > 0
          ? agg.unoccupiedCoolSum / agg.unoccupiedCoolCount
          : null,
    },
  }));

  // Campus-level aggregation
  let campusTotalMinutes = 0;
  let campusOccupancyMinutes = 0;
  let campusRuntimeMinutes = 0;
  let campusFanMinutes = 0;
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
    campusFanMinutes += b.fanMinutes;

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
    fanMinutes: campusFanMinutes,
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
      occupiedHeat:
        campusOccupiedHeatCount > 0
          ? campusOccupiedHeatSum / campusOccupiedHeatCount
          : null,
      unoccupiedHeat:
        campusUnoccupiedHeatCount > 0
          ? campusUnoccupiedHeatSum / campusUnoccupiedHeatCount
          : null,
      occupiedCool:
        campusOccupiedCoolCount > 0
          ? campusOccupiedCoolSum / campusOccupiedCoolCount
          : null,
      unoccupiedCool:
        campusUnoccupiedCoolCount > 0
          ? campusUnoccupiedCoolSum / campusUnoccupiedCoolCount
          : null,
    },
  };

  // Convert daily map to sorted array
  const daily = Array.from(byDate.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

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







