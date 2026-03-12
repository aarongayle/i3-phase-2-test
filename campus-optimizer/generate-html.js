  function topBuildings(buildings) {
    return buildings
      .slice()
      .sort((a, b) => (b.runtimeByOccupancy || 0) - (a.runtimeByOccupancy || 0))
      .slice(0, 5)
      .map(
        (b) => `<tr class="border-b">
        <td class="px-3 py-2">${escapeHtml(b.groupName || "")}</td>
        <td class="px-3 py-2 text-right">${fmt(b.runtimeByOccupancy)}%</td>
        <td class="px-3 py-2 text-right">${fmt(b.runtimeMinutes)}</td>
        <td class="px-3 py-2 text-right">${fmt(b.occupancyMinutes)}</td>
      </tr>`
      );
  }

  function topThermostats(list) {
    return list
      .slice()
      .sort((a, b) => (b.runtimeByOccupancy || 0) - (a.runtimeByOccupancy || 0))
      .slice(0, 10)
      .map(
        (t) => `<tr class="border-b">
        <td class="px-3 py-2">${escapeHtml(t.name || t.serialNo || "")}</td>
        <td class="px-3 py-2 text-right">${fmt(t.runtimeByOccupancy)}%</td>
        <td class="px-3 py-2 text-right">${fmt(t.runtimeMinutes)}</td>
        <td class="px-3 py-2 text-right">${fmt(t.occupancyMinutes)}</td>
      </tr>`
      );
  }
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function loadCompiled() {
  const inputPath = path.resolve("./campus-optimizer/data/compiled.json");
  if (!fs.existsSync(inputPath)) {
    throw new Error(
      `Missing compiled data at ${inputPath}. Run the compile step first.`
    );
  }
  const raw = fs.readFileSync(inputPath, "utf8");
  return JSON.parse(raw);
}

function aggregateWeekly(devices) {
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

function buildSparklineSvg(values, width = 120, height = 28) {
  const series = (values || []).map((v) =>
    Number.isFinite(v) ? v : Number(v) || 0
  );
  const n = series.length;
  const w = Math.max(10, Number(width) || 120);
  const h = Math.max(10, Number(height) || 28);
  if (n === 0) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="text-gray-300"></svg>`;
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min;
  const pad = 1; // padding inside the box
  const innerH = h - pad * 2;
  const innerW = w - pad * 2;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const yFor = (v) => {
    if (range === 0) return pad + innerH / 2; // flat line centered
    const t = (v - min) / range;
    return pad + (1 - t) * innerH; // invert y so higher values are higher visually
  };
  const points = series.map((v, i) => [pad + i * stepX, yFor(v)]);
  const path = points
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"}${Math.round(x * 100) / 100} ${
          Math.round(y * 100) / 100
        }`
    )
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="text-blue-600">
    <path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" />
  </svg>`;
}

export function buildHtml(data) {
  const meta = data.report?.meta || {};
  const devices = data.report?.devices || [];
  const energy = data.report?.energy || {};
  const pelicanAnalytics = data.pelican?.analytics || null;
  const energyExpected = Array.isArray(energy.expected) ? energy.expected : [];
  const energyActual = Array.isArray(energy.actual) ? energy.actual : [];

  const topRuntimeAvg = [...devices]
    .sort((a, b) => (b.runtimeAvgMin || 0) - (a.runtimeAvgMin || 0))
    .slice(0, 10);

  const { labels, totalRuntime } = aggregateWeekly(devices);

  // Pelican vs CO comparison (if present)
  const pelicanDaily = Array.isArray(pelicanAnalytics?.daily)
    ? pelicanAnalytics.daily
    : [];
  const pelicanDateSet = new Set(pelicanDaily.map((d) => d.date));
  const coDateSet = new Set();
  const coDailyMap = new Map();
  devices.forEach((d) =>
    (d.runtimeWeekly || []).forEach((p) => {
      coDateSet.add(p.date);
      coDailyMap.set(p.date, (coDailyMap.get(p.date) || 0) + (p.minutes || 0));
    })
  );
  const combinedDates = Array.from(new Set([...pelicanDateSet, ...coDateSet])).sort(
    (a, b) => new Date(a) - new Date(b)
  );
  const pelicanDailyMap = new Map(pelicanDaily.map((d) => [d.date, d]));
  const pelicanDailySetpoints = Array.isArray(pelicanAnalytics?.dailySetpoints)
    ? pelicanAnalytics.dailySetpoints
    : [];
  const pelicanSetpointLabels = pelicanDailySetpoints.map((d) => d.date);

  // Aggregate meter-level energy by calendar day
  function dailyAggregates(list) {
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

  function uniqueSortedDatesFromMaps(...maps) {
    const s = new Set();
    for (const m of maps) {
      for (const k of m?.keys?.() || []) s.add(k);
    }
    return Array.from(s).sort((a, b) => new Date(a) - new Date(b));
  }

  const {
    totals: dailyExpectedMap,
    peakKw: peakExpectedMap,
    intervalsByDate: intervalsExpected,
  } = dailyAggregates(energyExpected);
  const {
    totals: dailyActualMap,
    peakKw: peakActualMap,
    intervalsByDate: intervalsActual,
  } = dailyAggregates(energyActual);
  const energyLabels = uniqueSortedDatesFromMaps(
    dailyExpectedMap,
    dailyActualMap
  );
  const energyExpectedSeries = energyLabels.map(
    (d) => dailyExpectedMap.get(d) || 0
  );
  const energyActualSeries = energyLabels.map(
    (d) => dailyActualMap.get(d) || 0
  );
  const energyPeakExpectedSeries = energyLabels.map(
    (d) => peakExpectedMap.get(d) || 0
  );
  const energyPeakActualSeries = energyLabels.map(
    (d) => peakActualMap.get(d) || 0
  );

  // Build interval-aligned data (96 points) for most recent day and averages
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

  const latestDate = energyLabels.length
    ? energyLabels[energyLabels.length - 1]
    : null;

  function seriesForDate(intervalMap, date) {
    const map = intervalMap.get(date) || new Map();
    return intervalKeys.map((key) => map.get(key) || 0);
  }

  function averageSeries(intervalMap) {
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

  const recentExpectedIntervalSeries = latestDate
    ? seriesForDate(intervalsExpected, latestDate)
    : [];
  const recentActualIntervalSeries = latestDate
    ? seriesForDate(intervalsActual, latestDate)
    : [];
  const averageExpectedIntervalSeries = averageSeries(intervalsExpected);
  const averageActualIntervalSeries = averageSeries(intervalsActual);

  // Limit energy chart to the most recent N points to avoid overcrowding
  const ENERGY_MAX_POINTS = 75;
  const energySliceStart = Math.max(0, energyLabels.length - ENERGY_MAX_POINTS);
  const energyLabelsLimited = energyLabels.slice(energySliceStart);
  const energyExpectedSeriesLimited =
    energyExpectedSeries.slice(energySliceStart);
  const energyActualSeriesLimited = energyActualSeries.slice(energySliceStart);
  const energyPeakExpectedSeriesLimited =
    energyPeakExpectedSeries.slice(energySliceStart);
  const energyPeakActualSeriesLimited =
    energyPeakActualSeries.slice(energySliceStart);

  // Per-meter snapshot for the latest day present
  const latestEnergyDate = energyLabels.length
    ? energyLabels[energyLabels.length - 1]
    : null;

  function perMeterLatestDayTotals(list, date) {
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

  const latestExpectedByMeter = perMeterLatestDayTotals(
    energyExpected,
    latestEnergyDate
  );
  const latestActualByMeter = perMeterLatestDayTotals(
    energyActual,
    latestEnergyDate
  );

  const meterIdSet = new Set([
    ...Array.from(latestExpectedByMeter.keys()),
    ...Array.from(latestActualByMeter.keys()),
  ]);

  function meterNameFor(id) {
    const m1 = (energyExpected || []).find((m) => m.Id === id);
    if (m1?.Name) return m1.Name;
    const m2 = (energyActual || []).find((m) => m.Id === id);
    return m2?.Name || String(id);
  }

  const meterRowsHtml = Array.from(meterIdSet)
    .map((id) => {
      const name = meterNameFor(id);
      const exp = latestExpectedByMeter.get(id) || 0;
      const act = latestActualByMeter.get(id) || 0;
      const delta = act - exp;
      return `<tr class="border-b">
        <td class="px-3 py-2">${escapeHtml(name)}</td>
        <td class="px-3 py-2 text-right">${fmt(exp)}</td>
        <td class="px-3 py-2 text-right">${fmt(act)}</td>
        <td class="px-3 py-2 text-right ${
          delta >= 0 ? "text-red-600" : "text-emerald-600"
        }">${fmt(delta)}</td>
      </tr>`;
    })
    .join("\n");

  const tableRows = devices
    .map((d) => {
      const series = labels.map((date) => {
        const pt = (d.runtimeWeekly || []).find((p) => p.date === date);
        return pt ? pt.minutes : 0;
      });
      const spark = buildSparklineSvg(series, 120, 28);
      return `<tr class=\"border-b\">
        <td class=\"px-3 py-2\">${escapeHtml(d.name)}</td>
        <td class=\"px-3 py-2\">${escapeHtml(d.description || "")}</td>
        <td class=\"px-3 py-2 text-right\">${fmt(d.coolingKW)}</td>
        <td class=\"px-3 py-2 text-right\">${fmt(d.heatingKW)}</td>
        <td class=\"px-3 py-2 text-right\">${fmt(d.runtimeAvgMin)}</td>
        <td class=\"px-3 py-2 text-right\">${fmt(d.ramptimeAvgMin)}</td>
        <td class=\"px-3 py-2 text-right\">${fmt(d.runtimeLatestMin)}</td>
        <td class=\"px-3 py-2 text-right\">${fmt(d.ramptimeLatestMin)}</td>
        <td class=\"px-3 py-2\"><div class=\"w-[120px]\">${spark}</div></td>
      </tr>`;
    })
    .join("\n");

  const topRuntimeLabels = topRuntimeAvg.map((d) => d.name);
  const topRuntimeData = topRuntimeAvg.map((d) => round2(d.runtimeAvgMin || 0));

  const html = `<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
  <title>CampusOptimizer Report</title>
  <script src=\"https://cdn.tailwindcss.com\"></script>
  <script src=\"https://cdn.jsdelivr.net/npm/chart.js\"></script>
  <style>
    .card { @apply bg-white shadow rounded p-4; }
    canvas { min-height: 260px; }
  </style>
</head>
<body class=\"bg-gray-50 text-gray-900\">
  <div id=\"report-root\" class=\"max-w-7xl mx-auto p-6 space-y-6\">
    <header class=\"flex items-end justify-between\">
      <div>
        <h1 class=\"text-2xl font-semibold\">CampusOptimizer Report</h1>
        <p class=\"text-sm text-gray-600\">Client ${escapeHtml(
          String(meta.clientId || "")
        )}</p>
      </div>
      <div class=\"text-right text-sm text-gray-600\">
        <div>Reports: <span class=\"font-medium\">${
          meta.reportsCount || 0
        }</span></div>
        <div>First: <span class=\"font-medium\">${escapeHtml(
          meta.firstReportDate || "-"
        )}</span></div>
        <div>Latest: <span class=\"font-medium\">${escapeHtml(
          meta.mostRecentDate || "-"
        )}</span></div>
      </div>
    </header>

    <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="card min-h-[360px]">
        <h2 class="text-lg font-semibold mb-2">Top 10 Devices by Avg Runtime (min)</h2>
        <div class="h-72">
          <canvas id="barTopRuntime" style="min-height:260px;"></canvas>
        </div>
      </div>
      <div class="card min-h-[360px]">
        <h2 class="text-lg font-semibold mb-2">Total Runtime per Week (min)</h2>
        <div class="h-72">
          <canvas id="lineWeekly" style="min-height:260px;"></canvas>
        </div>
      </div>
    </section>

    ${
      energyLabels.length
        ? `
    <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="card min-h-[360px]">
        <h2 class="text-lg font-semibold mb-2">Daily Energy Use (All Meters)</h2>
        <p class="text-xs text-gray-500 mb-2">Expected vs Actual (sum of interval values per day)</p>
        <div class="h-72">
          <canvas id="lineEnergy" style="min-height:260px;"></canvas>
        </div>
      </div>
      <div class="card min-h-[360px]">
        <h2 class="text-lg font-semibold mb-2">Daily Peak Demand (All Meters)</h2>
        <p class="text-xs text-gray-500 mb-2">Expected vs Actual (max interval kW per day)</p>
        <div class="h-72">
          <canvas id="linePeakDemand" style="min-height:260px;"></canvas>
        </div>
      </div>
    </section>
    ${
      pelicanAnalytics
        ? `
    <section class="card min-h-[380px]">
      <h2 class="text-lg font-semibold mb-2">Schedule vs Occupancy (CO vs Pelican)</h2>
      <p class="text-xs text-gray-500 mb-3">Daily comparison of Pelican occupancy/runtime vs CO scheduled minutes</p>
      <div class="h-80">
        <canvas id="pelicanComparison" style="min-height:280px;"></canvas>
      </div>
    </section>
    <section class="card min-h-[380px]">
      <h2 class="text-lg font-semibold mb-2">Runtime vs Occupancy (Pelican)</h2>
      <p class="text-xs text-gray-500 mb-3">Campus and top sites by runtime/occupancy ratio</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div class="bg-emerald-50 rounded-lg p-4">
          <p class="text-xs text-emerald-700 font-semibold mb-1">Campus Runtime/OCC</p>
          <p class="text-3xl font-bold text-emerald-800">${round2(pelicanAnalytics.campus?.runtimeByOccupancy || 0)}%</p>
          <p class="text-xs text-emerald-700 mt-1">Runtime: ${fmt(pelicanAnalytics.campus?.runtimeMinutes || 0)} min</p>
          <p class="text-xs text-emerald-700">Occupancy: ${fmt(pelicanAnalytics.campus?.occupancyMinutes || 0)} min</p>
        </div>
        <div class="bg-blue-50 rounded-lg p-4">
          <p class="text-xs text-blue-700 font-semibold mb-1">Thermostats</p>
          <p class="text-3xl font-bold text-blue-800">${pelicanAnalytics.campus?.thermostatCount || 0}</p>
          <p class="text-xs text-blue-700 mt-1">Buildings: ${pelicanAnalytics.campus?.buildingCount || 0}</p>
        </div>
        <div class="bg-amber-50 rounded-lg p-4">
          <p class="text-xs text-amber-700 font-semibold mb-1">Temps (avg)</p>
          <p class="text-sm text-amber-800">Occ Heat: ${fmt1(pelicanAnalytics.campus?.temps?.occupiedHeat)}</p>
          <p class="text-sm text-amber-800">Unocc Heat: ${fmt1(pelicanAnalytics.campus?.temps?.unoccupiedHeat)}</p>
          <p class="text-sm text-blue-800">Occ Cool: ${fmt1(pelicanAnalytics.campus?.temps?.occupiedCool)}</p>
          <p class="text-sm text-blue-800">Unocc Cool: ${fmt1(pelicanAnalytics.campus?.temps?.unoccupiedCool)}</p>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-700">
            <tr>
              <th class="px-3 py-2 text-left">Top Buildings (ratio)</th>
              <th class="px-3 py-2 text-right">Runtime %Occ</th>
              <th class="px-3 py-2 text-right">Runtime (min)</th>
              <th class="px-3 py-2 text-right">Occupancy (min)</th>
            </tr>
          </thead>
          <tbody>
            ${topBuildings(pelicanAnalytics.buildings || []).join("")}
          </tbody>
        </table>
      </div>
      <div class="overflow-x-auto mt-4">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-700">
            <tr>
              <th class="px-3 py-2 text-left">Top Thermostats (ratio)</th>
              <th class="px-3 py-2 text-right">Runtime %Occ</th>
              <th class="px-3 py-2 text-right">Runtime (min)</th>
              <th class="px-3 py-2 text-right">Occupancy (min)</th>
            </tr>
          </thead>
          <tbody>
            ${topThermostats(pelicanAnalytics.thermostats || []).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="card min-h-[380px]">
      <h2 class="text-lg font-semibold mb-2">Setpoint Trends (Pelican)</h2>
      <p class="text-xs text-gray-500 mb-3">Daily average setpoints across all thermostats</p>
      <div class="h-80">
        <canvas id="pelicanSetpoints" style="min-height:280px;"></canvas>
      </div>
    </section>
    `
        : ""
    }
    <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="card min-h-[360px]">
        <h2 class="text-lg font-semibold mb-2">Interval Comparison — Latest Day</h2>
        <p class="text-xs text-gray-500 mb-2">Expected vs Actual demand per 15-min interval for ${
          latestEnergyDate ? escapeHtml(latestEnergyDate) : "latest day"
        }</p>
        <div class="h-72">
          <canvas id="lineIntervalLatest" style="min-height:260px;"></canvas>
        </div>
      </div>
      <div class="card min-h-[360px]">
        <h2 class="text-lg font-semibold mb-2">Interval Comparison — Multi-Day Average</h2>
        <p class="text-xs text-gray-500 mb-2">Average expected vs actual demand across all days (per 15-min interval)</p>
        <div class="h-72">
          <canvas id="lineIntervalAverage" style="min-height:260px;"></canvas>
        </div>
      </div>
    </section>
    <section class="card">
      <h2 class="text-lg font-semibold mb-2">Meter Energy Snapshot${
        latestEnergyDate ? ` — ${escapeHtml(latestEnergyDate)}` : ""
      }</h2>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-700">
            <tr>
              <th class="px-3 py-2 text-left">Meter</th>
              <th class="px-3 py-2 text-right">Expected (daily total)</th>
              <th class="px-3 py-2 text-right">Actual (daily total)</th>
              <th class="px-3 py-2 text-right">Delta (A - E)</th>
            </tr>
          </thead>
          <tbody>
            ${meterRowsHtml}
          </tbody>
        </table>
      </div>
    </section>
    `
        : ""
    }

    <section class="card">
      <h2 class="text-lg font-semibold mb-4">Device Metrics</h2>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-700">
            <tr>
              <th class="px-3 py-2 text-left">Name</th>
              <th class="px-3 py-2 text-left">Description</th>
              <th class="px-3 py-2 text-right">Cooling kW</th>
              <th class="px-3 py-2 text-right">Heating kW</th>
              <th class="px-3 py-2 text-right">Runtime Avg (min)</th>
              <th class="px-3 py-2 text-right">Ramptime Avg (min)</th>
              <th class="px-3 py-2 text-right">Runtime Latest (min)</th>
              <th class="px-3 py-2 text-right">Ramptime Latest (min)</th>
              <th class="px-3 py-2 text-left">Weekly Runtime</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <script>
    if (window.Chart) {
      // Headless screenshots should capture the fully-drawn chart, not an
      // in-progress animation frame.
      Chart.defaults.animation = false;
      Chart.defaults.responsiveAnimationDuration = 0;
    }

    const topRuntimeLabels = ${JSON.stringify(topRuntimeLabels)};
    const topRuntimeData = ${JSON.stringify(topRuntimeData)};
    const weeklyLabels = ${JSON.stringify(labels)};
    const weeklyValues = ${JSON.stringify(totalRuntime.map(round2))};

    const energyLabels = ${JSON.stringify(energyLabelsLimited)};
    const energyExpectedSeries = ${JSON.stringify(
      energyExpectedSeriesLimited.map((n) => round2(n))
    )};
    const energyActualSeries = ${JSON.stringify(
      energyActualSeriesLimited.map((n) => round2(n))
    )};
    const energyPeakExpectedSeries = ${JSON.stringify(
      energyPeakExpectedSeriesLimited.map((n) => round2(n))
    )};
    const energyPeakActualSeries = ${JSON.stringify(
      energyPeakActualSeriesLimited.map((n) => round2(n))
    )};
    const intervalLabels = ${JSON.stringify(intervalKeys)};
    const recentExpectedInterval = ${JSON.stringify(
      recentExpectedIntervalSeries.map((n) => round2(n))
    )};
    const recentActualInterval = ${JSON.stringify(
      recentActualIntervalSeries.map((n) => round2(n))
    )};
    const averageExpectedInterval = ${JSON.stringify(
      averageExpectedIntervalSeries.map((n) => round2(n))
    )};
    const averageActualInterval = ${JSON.stringify(
      averageActualIntervalSeries.map((n) => round2(n))
    )};

    const pelicanDates = ${JSON.stringify(combinedDates)};
    const pelicanCOValues = ${JSON.stringify(
      combinedDates.map((d) => round2(coDailyMap.get(d) || 0))
    )};
    const pelicanOccValues = ${JSON.stringify(
      combinedDates.map((d) => round2(pelicanDailyMap.get(d)?.occupancyMinutes || 0))
    )};
    const pelicanRunValues = ${JSON.stringify(
      combinedDates.map((d) => round2(pelicanDailyMap.get(d)?.runtimeMinutes || 0))
    )};

    const setpointLabelsRaw = ${JSON.stringify(pelicanSetpointLabels)};
    const setpointLabels = setpointLabelsRaw.map((d) => formatLabel(d));
    const setpointOccHeat = ${JSON.stringify(
      pelicanDailySetpoints.map((d) => round2(d.occupiedHeat ?? null))
    )};
    const setpointUnoccHeat = ${JSON.stringify(
      pelicanDailySetpoints.map((d) => round2(d.unoccupiedHeat ?? null))
    )};
    const setpointOccCool = ${JSON.stringify(
      pelicanDailySetpoints.map((d) => round2(d.occupiedCool ?? null))
    )};
    const setpointUnoccCool = ${JSON.stringify(
      pelicanDailySetpoints.map((d) => round2(d.unoccupiedCool ?? null))
    )};
    const setpointDeadband = ${JSON.stringify(
      pelicanDailySetpoints.map((d) => round2(d.deadband ?? null))
    )};

    const barCtx = document.getElementById('barTopRuntime');
    new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: topRuntimeLabels,
        datasets: [{
          label: 'Runtime Avg (min)',
          data: topRuntimeData,
          backgroundColor: 'rgba(59, 130, 246, 0.6)'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { autoSkip: false } } }
      }
    });

    const lineCtx = document.getElementById('lineWeekly');
    new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: weeklyLabels,
        datasets: [{
          label: 'Total Runtime (min)',
          data: weeklyValues,
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.2)',
          fill: true,
          tension: 0.2
        }]
      },
      options: { responsive: true }
    });

    if (energyLabels.length) {
      const engCtx = document.getElementById('lineEnergy');
      new Chart(engCtx, {
        type: 'line',
        data: {
          labels: energyLabels,
          datasets: [
            {
              label: 'Expected (daily total)',
              data: energyExpectedSeries,
              borderColor: 'rgb(59, 130, 246)',
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              fill: true,
              tension: 0.2
            },
            {
              label: 'Actual (daily total)',
              data: energyActualSeries,
              borderColor: 'rgb(234, 88, 12)',
              backgroundColor: 'rgba(234, 88, 12, 0.2)',
              fill: true,
              tension: 0.2
            }
          ]
        },
        options: { responsive: true }
      });

      const peakCtx = document.getElementById('linePeakDemand');
      if (peakCtx) {
        new Chart(peakCtx, {
          type: 'line',
          data: {
            labels: energyLabels,
            datasets: [
              {
                label: 'Expected Peak (kW)',
                data: energyPeakExpectedSeries,
                borderColor: 'rgb(37, 99, 235)',
                backgroundColor: 'rgba(37, 99, 235, 0.15)',
                fill: true,
                tension: 0.2
              },
              {
                label: 'Actual Peak (kW)',
                data: energyPeakActualSeries,
                borderColor: 'rgb(16, 185, 129)',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                fill: true,
                tension: 0.2
              }
            ]
          },
          options: { responsive: true }
        });
      }

      const intervalLatestCtx = document.getElementById('lineIntervalLatest');
      if (intervalLatestCtx && intervalLabels.length) {
        new Chart(intervalLatestCtx, {
          type: 'line',
          data: {
            labels: intervalLabels,
            datasets: [
              {
                label: 'Expected (kWh)',
                data: recentExpectedInterval,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                fill: true,
                tension: 0.2
              },
              {
                label: 'Actual (kWh)',
                data: recentActualInterval,
                borderColor: 'rgb(234, 88, 12)',
                backgroundColor: 'rgba(234, 88, 12, 0.2)',
                fill: true,
                tension: 0.2
              }
            ]
          },
          options: {
            responsive: true,
            scales: {
              x: {
                ticks: {
                  callback(value, index) {
                    if (index % 12 === 0) return intervalLabels[index];
                    return '';
                  }
                }
              }
            }
          }
        });
      }

      const intervalAverageCtx = document.getElementById('lineIntervalAverage');
      if (intervalAverageCtx && intervalLabels.length) {
        new Chart(intervalAverageCtx, {
          type: 'line',
          data: {
            labels: intervalLabels,
            datasets: [
              {
                label: 'Expected Avg (kWh)',
                data: averageExpectedInterval,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                fill: true,
                tension: 0.2
              },
              {
                label: 'Actual Avg (kWh)',
                data: averageActualInterval,
                borderColor: 'rgb(234, 88, 12)',
                backgroundColor: 'rgba(234, 88, 12, 0.2)',
                fill: true,
                tension: 0.2
              }
            ]
          },
          options: {
            responsive: true,
            scales: {
              x: {
                ticks: {
                  callback(value, index) {
                    if (index % 12 === 0) return intervalLabels[index];
                    return '';
                  }
                }
              }
            }
          }
        });
      }
    }

    const pelicanLabels = pelicanDates.map((d) => formatLabel(d));

    if (pelicanLabels.length) {
      const pelicanCtx = document.getElementById('pelicanComparison');
      if (pelicanCtx) {
        new Chart(pelicanCtx, {
          type: 'line',
          data: {
            labels: pelicanLabels,
            datasets: [
              {
                label: 'CO Scheduled (min)',
                data: pelicanCOValues,
                borderColor: 'rgba(59, 130, 246, 1)',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderWidth: 2,
                tension: 0.25,
                spanGaps: true
              },
              {
                label: 'Pelican Occupancy (min)',
                data: pelicanOccValues,
                borderColor: 'rgba(34, 197, 94, 1)',
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                borderWidth: 2,
                tension: 0.25,
                spanGaps: true
              },
              {
                label: 'Pelican Runtime (min)',
                data: pelicanRunValues,
                borderColor: 'rgba(249, 115, 22, 1)',
                backgroundColor: 'rgba(249, 115, 22, 0.15)',
                borderDash: [6, 4],
                borderWidth: 2,
                tension: 0.25,
                spanGaps: true
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: { beginAtZero: true, title: { display: true, text: 'Minutes' } }
            }
          }
        });
      }
    }

    if (setpointLabels.length) {
      const spCtx = document.getElementById('pelicanSetpoints');
      if (spCtx) {
        new Chart(spCtx, {
          type: 'line',
          data: {
            labels: setpointLabels,
            datasets: [
              {
                label: 'Occupied Heat',
                data: setpointOccHeat,
                borderColor: 'rgb(239, 68, 68)',
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                spanGaps: true,
                tension: 0.25,
              },
              {
                label: 'Unoccupied Heat',
                data: setpointUnoccHeat,
                borderColor: 'rgb(248, 113, 113)',
                backgroundColor: 'rgba(248, 113, 113, 0.15)',
                borderDash: [6,4],
                spanGaps: true,
                tension: 0.25,
              },
              {
                label: 'Occupied Cool',
                data: setpointOccCool,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                spanGaps: true,
                tension: 0.25,
              },
              {
                label: 'Unoccupied Cool',
                data: setpointUnoccCool,
                borderColor: 'rgb(96, 165, 250)',
                backgroundColor: 'rgba(96, 165, 250, 0.15)',
                borderDash: [6,4],
                spanGaps: true,
                tension: 0.25,
              },
              {
                label: 'Deadband (Occ Cool - Occ Heat)',
                data: setpointDeadband,
                borderColor: 'rgb(168, 85, 247)',
                backgroundColor: 'rgba(168, 85, 247, 0.15)',
                borderDash: [4,3],
                spanGaps: true,
                tension: 0.25,
              },
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { title: { display: true, text: '°F' } }
            }
          }
        });
      }
    }

    function round2(n) { return Math.round((n || 0) * 100) / 100; }
    function formatLabel(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    // Wait until the browser has had a chance to lay out and paint the charts
    // before signaling Puppeteer to capture screenshots.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__reportReady = true;
      });
    });
  </script>
</body>
</html>`;
  return html;
}

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}
function fmt(n) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmt1(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  const compiled = loadCompiled();
  const outDir = path.resolve("./campus-optimizer/reports");
  ensureDir(outDir);
  const html = buildHtml(compiled);
  const outPath = path.join(outDir, "report.html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`Wrote ${outPath}`);
}

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("generate-html failed:", err);
    process.exitCode = 1;
  });
}
