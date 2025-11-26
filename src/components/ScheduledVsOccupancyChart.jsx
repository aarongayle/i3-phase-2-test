import { Chart } from "chart.js/auto";
import { useEffect, useRef } from "react";

/**
 * Format minutes as hours string
 */
function formatMinutesToHours(minutes) {
  if (!minutes || minutes < 1) return "0h";
  const hours = (minutes / 60).toFixed(1);
  return `${hours}h`;
}

/**
 * Group daily analytics by date and aggregate
 */
function aggregateDailyData(dailyAnalytics) {
  const byDate = new Map();

  for (const entry of dailyAnalytics || []) {
    const date = entry.date;
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        occupancyMinutes: 0,
        runtimeMinutes: 0,
        thermostatCount: 0,
      });
    }
    const agg = byDate.get(date);
    agg.occupancyMinutes += entry.occupancyMinutes || 0;
    agg.runtimeMinutes += entry.runtimeMinutes || 0;
    agg.thermostatCount += entry.thermostatCount || 0;
  }

  return Array.from(byDate.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
}

/**
 * Aggregate CO devices by date
 * CO devices have runtimeWeekly with {date, minutes} entries
 */
function aggregateCOScheduledTime(devices) {
  const byDate = new Map();

  for (const device of devices || []) {
    for (const entry of device.runtimeWeekly || []) {
      const date = entry.date;
      if (!date) continue;

      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          scheduledMinutes: 0,
          deviceCount: 0,
        });
      }
      const agg = byDate.get(date);
      agg.scheduledMinutes += entry.minutes || 0;
      agg.deviceCount += 1;
    }
  }

  return Array.from(byDate.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
}

export default function ScheduledVsOccupancyChart({
  pelicanData,
  coDevices,
  showRuntime = true,
}) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;

    // Aggregate Pelican daily data
    const pelicanDaily = aggregateDailyData(pelicanData?.daily || []);

    // Aggregate CO scheduled time data
    const coDaily = aggregateCOScheduledTime(coDevices || []);

    // If we don't have any data, show empty state
    if (pelicanDaily.length === 0 && coDaily.length === 0) {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
      return;
    }

    // Merge dates from both sources
    const allDates = new Set([
      ...pelicanDaily.map((d) => d.date),
      ...coDaily.map((d) => d.date),
    ]);
    const sortedDates = Array.from(allDates).sort(
      (a, b) => new Date(a) - new Date(b)
    );

    // Create lookup maps
    const pelicanMap = new Map(pelicanDaily.map((d) => [d.date, d]));
    const coMap = new Map(coDaily.map((d) => [d.date, d]));

    // Format dates for display
    const labels = sortedDates.map((date) => {
      const d = new Date(date);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    // Build datasets
    const datasets = [];

    // CO Scheduled Time (if available)
    if (coDaily.length > 0) {
      datasets.push({
        label: "CO Scheduled (min)",
        data: sortedDates.map((date) => {
          const entry = coMap.get(date);
          return entry ? entry.scheduledMinutes : null;
        }),
        backgroundColor: "rgba(59, 130, 246, 0.6)",
        borderColor: "rgba(59, 130, 246, 1)",
        borderWidth: 2,
        tension: 0.3,
        spanGaps: true,
      });
    }

    // Pelican Occupancy Time
    if (pelicanDaily.length > 0) {
      datasets.push({
        label: "Pelican Occupancy (min)",
        data: sortedDates.map((date) => {
          const entry = pelicanMap.get(date);
          return entry ? entry.occupancyMinutes : null;
        }),
        backgroundColor: "rgba(34, 197, 94, 0.6)",
        borderColor: "rgba(34, 197, 94, 1)",
        borderWidth: 2,
        tension: 0.3,
        spanGaps: true,
      });

      // Pelican Runtime (optional)
      if (showRuntime) {
        datasets.push({
          label: "Pelican Runtime (min)",
          data: sortedDates.map((date) => {
            const entry = pelicanMap.get(date);
            return entry ? entry.runtimeMinutes : null;
          }),
          backgroundColor: "rgba(249, 115, 22, 0.4)",
          borderColor: "rgba(249, 115, 22, 1)",
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.3,
          spanGaps: true,
        });
      }
    }

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create chart
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "top",
            labels: {
              usePointStyle: true,
              padding: 20,
            },
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const value = context.parsed.y;
                if (value === null) return null;
                const hours = (value / 60).toFixed(1);
                return `${context.dataset.label}: ${Math.round(value)} min (${hours}h)`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: "Minutes",
            },
            grid: {
              color: "rgba(0, 0, 0, 0.05)",
            },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [pelicanData, coDevices, showRuntime]);

  // Calculate summary stats
  const pelicanDaily = aggregateDailyData(pelicanData?.daily || []);
  const coDaily = aggregateCOScheduledTime(coDevices || []);

  const totalPelicanOccupancy = pelicanDaily.reduce(
    (sum, d) => sum + d.occupancyMinutes,
    0
  );
  const totalPelicanRuntime = pelicanDaily.reduce(
    (sum, d) => sum + d.runtimeMinutes,
    0
  );
  const totalCOScheduled = coDaily.reduce(
    (sum, d) => sum + d.scheduledMinutes,
    0
  );

  // Calculate variance between CO scheduled and Pelican occupancy
  let overlapDays = 0;
  let totalVariance = 0;
  for (const pd of pelicanDaily) {
    const cd = coDaily.find((c) => c.date === pd.date);
    if (cd && pd.occupancyMinutes > 0 && cd.scheduledMinutes > 0) {
      overlapDays++;
      // Variance as percentage difference
      totalVariance += Math.abs(pd.occupancyMinutes - cd.scheduledMinutes);
    }
  }
  const avgDailyVariance = overlapDays > 0 ? totalVariance / overlapDays : 0;

  const hasData = pelicanDaily.length > 0 || coDaily.length > 0;

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Scheduled vs Actual Occupancy
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Compare Campus Optimizer schedules with Pelican-detected occupancy
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      {hasData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {totalCOScheduled > 0 && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-medium">CO Scheduled</p>
              <p className="text-lg font-bold text-blue-800">
                {formatMinutesToHours(totalCOScheduled)}
              </p>
              <p className="text-xs text-blue-600">total period</p>
            </div>
          )}
          {totalPelicanOccupancy > 0 && (
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-xs text-green-600 font-medium">
                Pelican Occupancy
              </p>
              <p className="text-lg font-bold text-green-800">
                {formatMinutesToHours(totalPelicanOccupancy)}
              </p>
              <p className="text-xs text-green-600">total period</p>
            </div>
          )}
          {totalPelicanRuntime > 0 && (
            <div className="bg-orange-50 rounded-lg p-3">
              <p className="text-xs text-orange-600 font-medium">
                Pelican Runtime
              </p>
              <p className="text-lg font-bold text-orange-800">
                {formatMinutesToHours(totalPelicanRuntime)}
              </p>
              <p className="text-xs text-orange-600">total period</p>
            </div>
          )}
          {overlapDays > 0 && (
            <div className="bg-purple-50 rounded-lg p-3">
              <p className="text-xs text-purple-600 font-medium">
                Avg Daily Variance
              </p>
              <p className="text-lg font-bold text-purple-800">
                {formatMinutesToHours(avgDailyVariance)}
              </p>
              <p className="text-xs text-purple-600">
                across {overlapDays} days
              </p>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      <div className="h-80">
        {hasData ? (
          <canvas ref={chartRef}></canvas>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <p className="mt-2">
                Load both Campus Optimizer and Pelican data to compare
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Insight */}
      {overlapDays > 0 && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Insight:</span>{" "}
            {avgDailyVariance < 60
              ? "CO schedules align well with detected occupancy (variance under 1 hour/day)."
              : avgDailyVariance < 180
                ? "Moderate variance between schedules and occupancy. Consider reviewing schedule accuracy."
                : "Significant variance detected. Schedules may need adjustment based on actual occupancy patterns."}
          </p>
        </div>
      )}
    </div>
  );
}

