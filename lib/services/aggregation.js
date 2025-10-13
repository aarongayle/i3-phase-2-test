// Data Aggregation Service
// Extracted and refactored logic from generate-html.js and compile-data.js

import {
  getOptimalSchedules,
  getUnits,
} from "../../campus-optimizer/co-api.js";

export class DataAggregationService {
  /**
   * Aggregate device metrics across multiple report dates
   */
  async aggregateDeviceMetrics(devices, dates, clientId) {
    if (!Array.isArray(dates) || dates.length === 0) {
      console.log(`   ↳ No dates to process, returning empty array`);
      return [];
    }

    console.log(`   ↳ [1/4] Fetching units...`);
    const units = await getUnits();
    console.log(`   ↳ [1/4] ✓ Units fetched`);

    console.log(`   ↳ [2/4] Sorting ${dates.length} dates...`);
    const sortedDates = [...dates]
      .map((d) => d.report_date)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b));
    console.log(`   ↳ [2/4] ✓ ${sortedDates.length} dates sorted`);

    console.log(
      `   ↳ [3/4] Fetching schedules for ${sortedDates.length} dates...`
    );
    console.log(
      `   ↳ [3/4] Note: Rate limited to 10 QPS, estimated time: ~${Math.ceil(
        sortedDates.length / 10
      )}s`
    );

    const schedulePromises = sortedDates.map(async (d, i) => {
      if ((i + 1) % 10 === 0 || i === 0 || i === sortedDates.length - 1) {
        console.log(
          `   ↳ [3/4] Starting schedule fetch ${i + 1}/${sortedDates.length}`
        );
      }
      try {
        const schedules = await getOptimalSchedules(clientId, d);
        if ((i + 1) % 10 === 0 || i === 0 || i === sortedDates.length - 1) {
          console.log(
            `   ↳ [3/4] ✓ Completed schedule ${i + 1}/${sortedDates.length}`
          );
        }
        return schedules;
      } catch (error) {
        console.error(
          `   ↳ [3/4] ⚠️ Error fetching schedule for date ${d}:`,
          error.message
        );
        // Return empty array on error instead of failing entire request
        return [];
      }
    });

    console.log(
      `   ↳ [3/4] All promises created (${schedulePromises.length}), waiting for completion...`
    );
    const schedulesByDate = await Promise.all(schedulePromises);
    console.log(
      `   ↳ [3/4] ✓ Promise.all completed with ${schedulesByDate.length} results`
    );

    console.log(
      `   ↳ [4/4] Aggregating data for ${devices.length} devices across ${sortedDates.length} days...`
    );
    const deviceAggregates = this._initializeDeviceAggregates(devices, units);

    // Process each day's schedules
    schedulesByDate.forEach((daySchedules, dayIndex) => {
      if (
        (dayIndex + 1) % 10 === 0 ||
        dayIndex === 0 ||
        dayIndex === sortedDates.length - 1
      ) {
        console.log(
          `   ↳ [4/4] Processing day ${dayIndex + 1}/${sortedDates.length}`
        );
      }
      const dateString = sortedDates[dayIndex];

      devices.forEach((device) => {
        const scheduleForDevice = daySchedules.filter(
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
          agg.runtimeWeekly.push({ date: dateString, minutes: runtimeMin });
          agg.ramptimeWeekly.push({ date: dateString, minutes: ramptimeMin });
        }

        // Latest day values
        if (dayIndex === schedulesByDate.length - 1) {
          agg.runtimeLatest = runtimeMin;
          agg.ramptimeLatest = ramptimeMin;
        }
      });
    });

    console.log(`   ↳ [4/4] ✓ Aggregation complete`);

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
   * Get weekly runtime aggregates across all devices
   */
  async getWeeklyRuntime(devices, dates, clientId) {
    const deviceMetrics = await this.aggregateDeviceMetrics(
      devices,
      dates,
      clientId
    );

    const dateSet = new Set();
    deviceMetrics.forEach((d) =>
      (d.runtimeWeekly || []).forEach((p) => dateSet.add(p.date))
    );

    const labels = Array.from(dateSet).sort(
      (a, b) => new Date(a) - new Date(b)
    );

    const totalRuntime = labels.map((date) => {
      let sum = 0;
      deviceMetrics.forEach((d) => {
        const point = (d.runtimeWeekly || []).find((p) => p.date === date);
        if (point) sum += point.minutes;
      });
      return sum;
    });

    return { labels, totalRuntime };
  }

  /**
   * Get daily energy aggregates (totals and peak demand)
   */
  getDailyEnergyAggregates(energyExpected, energyActual, startDate, endDate) {
    const { totals: dailyExpectedMap, peakKw: peakExpectedMap } =
      this._dailyAggregates(energyExpected);
    const { totals: dailyActualMap, peakKw: peakActualMap } =
      this._dailyAggregates(energyActual);

    let dates = this._uniqueSortedDatesFromMaps(
      dailyExpectedMap,
      dailyActualMap
    );

    // Filter by date range
    if (startDate || endDate) {
      dates = dates.filter((date) => {
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
      });
    }

    return {
      labels: dates,
      expected: dates.map((d) => dailyExpectedMap.get(d) || 0),
      actual: dates.map((d) => dailyActualMap.get(d) || 0),
      peakExpected: dates.map((d) => peakExpectedMap.get(d) || 0),
      peakActual: dates.map((d) => peakActualMap.get(d) || 0),
    };
  }

  /**
   * Get interval-level analysis for a specific date
   */
  getIntervalAnalysis(energyExpected, energyActual, targetDate) {
    const { intervalsByDate: intervalsExpected } =
      this._dailyAggregates(energyExpected);
    const { intervalsByDate: intervalsActual } =
      this._dailyAggregates(energyActual);

    // Get all unique interval keys
    const intervalKeys = Array.from(
      new Set([
        ...Array.from(intervalsExpected.values()).flatMap((m) =>
          Array.from(m.keys())
        ),
        ...Array.from(intervalsActual.values()).flatMap((m) =>
          Array.from(m.keys())
        ),
      ])
    )
      .filter((k) => Number.isFinite(k))
      .sort((a, b) => a - b);

    if (targetDate) {
      // Specific date analysis
      const expectedMap = intervalsExpected.get(targetDate) || new Map();
      const actualMap = intervalsActual.get(targetDate) || new Map();

      return {
        date: targetDate,
        intervals: intervalKeys,
        expected: intervalKeys.map((key) => expectedMap.get(key) || 0),
        actual: intervalKeys.map((key) => actualMap.get(key) || 0),
      };
    } else {
      // Average across all dates
      const expectedAvg = this._averageSeries(intervalsExpected, intervalKeys);
      const actualAvg = this._averageSeries(intervalsActual, intervalKeys);

      return {
        date: "average",
        intervals: intervalKeys,
        expected: expectedAvg,
        actual: actualAvg,
      };
    }
  }

  /**
   * Sort devices by a specific metric
   */
  sortDevices(devices, sortBy = "runtimeAvg") {
    const sortFunctions = {
      runtimeAvg: (a, b) => (b.runtimeAvgMin || 0) - (a.runtimeAvgMin || 0),
      runtimeLatest: (a, b) =>
        (b.runtimeLatestMin || 0) - (a.runtimeLatestMin || 0),
      coolingKW: (a, b) => (b.coolingKW || 0) - (a.coolingKW || 0),
      heatingKW: (a, b) => (b.heatingKW || 0) - (a.heatingKW || 0),
      name: (a, b) => (a.name || "").localeCompare(b.name || ""),
    };

    const sortFn = sortFunctions[sortBy] || sortFunctions.runtimeAvg;
    return [...devices].sort(sortFn);
  }

  /**
   * Filter energy data by date range
   */
  filterEnergyByDateRange(energyData, startDate, endDate) {
    if (!startDate && !endDate) return energyData;

    return energyData.map((meter) => ({
      ...meter,
      Interval: (meter.Interval || []).filter(({ date }) => {
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
      }),
    }));
  }

  // ============================================================================
  // Private Helper Methods (extracted from generate-html.js)
  // ============================================================================

  _initializeDeviceAggregates(devices, units) {
    const aggregates = new Map();

    devices.forEach((device) => {
      aggregates.set(device.Id, {
        id: device.Id,
        name: device.Name,
        description: device.Description,
        heatingKW: this._toKW(
          device.HeatingCapacity,
          device.HeatingUnitId,
          units.heat
        ),
        coolingKW: this._toKW(
          device.CoolingCapacity,
          device.CoolingUnitId,
          units.cool
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

    return aggregates;
  }

  _toKW(capacity, unitId, unitList) {
    const unit = unitList.find((u) => u.Id === unitId);
    return capacity * (unit?.KWConversionFactor ?? 1);
  }

  _dailyAggregates(meterList) {
    const totals = new Map();
    const peakKwh = new Map();
    const intervalsByDate = new Map();

    for (const meter of meterList || []) {
      for (const pt of meter?.Interval || []) {
        const date = pt?.date;
        if (!date) continue;

        const val = Number(pt?.value);
        if (!Number.isFinite(val)) continue;

        totals.set(date, (totals.get(date) || 0) + val);

        const intervalKey = this._normalizeIntervalKey(pt?.interval);

        let intervalMap = intervalsByDate.get(date);
        if (!intervalMap) {
          intervalMap = new Map();
          intervalsByDate.set(date, intervalMap);
        }

        const prior = intervalMap.get(intervalKey) || 0;
        const aggregated = prior + val;
        intervalMap.set(intervalKey, aggregated);

        const currentPeak = peakKwh.get(date) || 0;
        if (aggregated > currentPeak) {
          peakKwh.set(date, aggregated);
        }
      }
    }

    // Convert 15-min kWh to kW demand
    const peakKw = new Map();
    for (const [date, kwh] of peakKwh.entries()) {
      peakKw.set(date, kwh * 4);
    }

    return { totals, peakKw, intervalsByDate };
  }

  _normalizeIntervalKey(rawInterval) {
    if (typeof rawInterval === "number" && Number.isFinite(rawInterval)) {
      return rawInterval;
    }
    if (
      typeof rawInterval === "string" &&
      rawInterval.trim() !== "" &&
      Number.isFinite(Number(rawInterval))
    ) {
      return Number(rawInterval);
    }
    return rawInterval ?? "__";
  }

  _uniqueSortedDatesFromMaps(...maps) {
    const s = new Set();
    for (const m of maps) {
      for (const k of m?.keys?.() || []) s.add(k);
    }
    return Array.from(s).sort((a, b) => new Date(a) - new Date(b));
  }

  _averageSeries(intervalMap, intervalKeys) {
    if (intervalKeys.length === 0) return [];

    const counts = Array(intervalKeys.length).fill(0);
    const sums = Array(intervalKeys.length).fill(0);

    for (const map of intervalMap.values()) {
      intervalKeys.forEach((key, idx) => {
        const val = map.get(key);
        if (Number.isFinite(val)) {
          sums[idx] += val;
          counts[idx] += 1;
        }
      });
    }

    return sums.map((sum, idx) => (counts[idx] ? sum / counts[idx] : 0));
  }
}
