/**
 * Data processing utilities for charts
 */

export function aggregateWeekly(devices) {
  const dateSet = new Set();
  devices.forEach((d) =>
    (d.runtimeWeekly || []).forEach((p) => dateSet.add(p.date))
  );
  const labels = Array.from(dateSet).sort((a, b) => new Date(a) - new Date(b));
  const totalRuntime = labels.map((date) => {
    let sum = 0;
    devices.forEach((d) => {
      const point = (d.runtimeWeekly || []).find((p) => p.date === date);
      if (point) sum += point.minutes;
    });
    return sum;
  });
  return { labels, totalRuntime };
}

export function getTopDevicesByRuntime(devices, count = 10) {
  return [...devices]
    .sort((a, b) => (b.runtimeAvgMin || 0) - (a.runtimeAvgMin || 0))
    .slice(0, count);
}

export function dailyAggregates(list) {
  const totals = new Map(); // date -> total kWh (sum of all intervals)
  const peakKwh = new Map(); // date -> max interval kWh across meters
  const intervalsByDate = new Map(); // date -> Map(interval -> aggregated kWh)

  for (const meter of list || []) {
    for (const pt of meter?.Interval || []) {
      const date = pt?.date;
      if (!date) continue;
      const val = Number(pt?.value);
      if (!Number.isFinite(val)) continue;

      totals.set(date, (totals.get(date) || 0) + val);

      const rawInterval = pt?.interval;
      let intervalKey;
      if (typeof rawInterval === "number" && Number.isFinite(rawInterval)) {
        intervalKey = rawInterval;
      } else if (
        typeof rawInterval === "string" &&
        rawInterval.trim() !== "" &&
        Number.isFinite(Number(rawInterval))
      ) {
        intervalKey = Number(rawInterval);
      } else {
        intervalKey = rawInterval ?? "__";
      }

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

  const peakKw = new Map();
  for (const [date, kwh] of peakKwh.entries()) {
    peakKw.set(date, kwh * 4); // Convert 15-min kWh to kW demand
  }

  return { totals, peakKw, intervalsByDate };
}

export function uniqueSortedDatesFromMaps(...maps) {
  const s = new Set();
  for (const m of maps) {
    for (const k of m?.keys?.() || []) s.add(k);
  }
  return Array.from(s).sort((a, b) => new Date(a) - new Date(b));
}

export function seriesForDate(intervalMap, date, intervalKeys) {
  const map = intervalMap.get(date) || new Map();
  return intervalKeys.map((key) => map.get(key) || 0);
}

export function averageSeries(intervalMap, intervalKeys) {
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

export function perMeterLatestDayTotals(list, date) {
  const out = new Map(); // meterId -> total for date
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

export function meterNameFor(id, energyExpected, energyActual) {
  const m1 = (energyExpected || []).find((m) => m.Id === id);
  if (m1?.Name) return m1.Name;
  const m2 = (energyActual || []).find((m) => m.Id === id);
  return m2?.Name || String(id);
}

export function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

export function fmt(n) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
