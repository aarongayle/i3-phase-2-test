import fs from "node:fs";
import path from "node:path";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadCompiled() {
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

function buildHtml(data) {
  const meta = data.report?.meta || {};
  const devices = data.report?.devices || [];
  const energy = data.report?.energy || {};
  const energyExpected = Array.isArray(energy.expected) ? energy.expected : [];
  const energyActual = Array.isArray(energy.actual) ? energy.actual : [];

  const topRuntimeAvg = [...devices]
    .sort((a, b) => (b.runtimeAvgMin || 0) - (a.runtimeAvgMin || 0))
    .slice(0, 10);

  const { labels, totalRuntime } = aggregateWeekly(devices);

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
  </style>
</head>
<body class=\"bg-gray-50 text-gray-900\">
  <div class=\"max-w-7xl mx-auto p-6 space-y-6\">
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
      <div class="card">
        <h2 class="text-lg font-semibold mb-2">Top 10 Devices by Avg Runtime (min)</h2>
        <canvas id="barTopRuntime" height="120"></canvas>
      </div>
      <div class="card">
        <h2 class="text-lg font-semibold mb-2">Total Runtime per Week (min)</h2>
        <canvas id="lineWeekly" height="120"></canvas>
      </div>
    </section>

    ${
      energyLabels.length
        ? `
    <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="card">
        <h2 class="text-lg font-semibold mb-2">Daily Energy Use (All Meters)</h2>
        <p class="text-xs text-gray-500 mb-2">Expected vs Actual (sum of interval values per day)</p>
        <canvas id="lineEnergy" height="120"></canvas>
      </div>
      <div class="card">
        <h2 class="text-lg font-semibold mb-2">Daily Peak Demand (All Meters)</h2>
        <p class="text-xs text-gray-500 mb-2">Expected vs Actual (max interval kW per day)</p>
        <canvas id="linePeakDemand" height="120"></canvas>
      </div>
    </section>
    <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="card">
        <h2 class="text-lg font-semibold mb-2">Interval Comparison — Latest Day</h2>
        <p class="text-xs text-gray-500 mb-2">Expected vs Actual demand per 15-min interval for ${
          latestEnergyDate ? escapeHtml(latestEnergyDate) : "latest day"
        }</p>
        <canvas id="lineIntervalLatest" height="120"></canvas>
      </div>
      <div class="card">
        <h2 class="text-lg font-semibold mb-2">Interval Comparison — Multi-Day Average</h2>
        <p class="text-xs text-gray-500 mb-2">Average expected vs actual demand across all days (per 15-min interval)</p>
        <canvas id="lineIntervalAverage" height="120"></canvas>
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

    function round2(n) { return Math.round((n || 0) * 100) / 100; }
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

main().catch((err) => {
  console.error("generate-html failed:", err);
  process.exitCode = 1;
});
