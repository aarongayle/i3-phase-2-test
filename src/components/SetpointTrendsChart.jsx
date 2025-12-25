import { Chart } from "chart.js/auto";
import { useEffect, useMemo, useRef, useState } from "react";

function num(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function deriveDaySetpoints(entry) {
  const minCool = num(entry?.minCoolSetpoint);
  const maxCool = num(entry?.maxCoolSetpoint);
  const minHeat = num(entry?.minHeatSetpoint);
  const maxHeat = num(entry?.maxHeatSetpoint);

  const hasCoolSchedule =
    minCool !== null && maxCool !== null && minCool !== maxCool;
  const hasHeatSchedule =
    minHeat !== null && maxHeat !== null && minHeat !== maxHeat;

  return {
    occupiedCool: hasCoolSchedule ? minCool : null,
    unoccupiedCool: maxCool,
    occupiedHeat: hasHeatSchedule ? maxHeat : null,
    unoccupiedHeat: minHeat,
  };
}

function buildChangeEvents(thermostats = []) {
  const bySerial = new Map();

  for (const t of thermostats) {
    const serial = t?.serialNo;
    const date = t?.date;
    if (!serial || !date) continue;
    if (!bySerial.has(serial)) bySerial.set(serial, []);
    bySerial.get(serial).push(t);
  }

  const events = [];

  for (const [serial, entries] of bySerial.entries()) {
    const sorted = entries.sort((a, b) => new Date(a.date) - new Date(b.date));
    let prev = null;

    for (const entry of sorted) {
      const current = deriveDaySetpoints(entry);
      if (prev) {
        for (const key of [
          "occupiedCool",
          "occupiedHeat",
          "unoccupiedCool",
          "unoccupiedHeat",
        ]) {
          const from = prev[key];
          const to = current[key];
          if (from === null || to === null) continue;
          if (from === to) continue;
          const delta = to - from;
          events.push({
            serialNo: serial,
            name: entry?.name || serial,
            group: entry?.groupName || entry?.group || entry?.siteSlug || "—",
            date: entry.date,
            type: key,
            from,
            to,
            delta,
          });
        }
      }
      prev = current;
    }
  }

  return events;
}

function formatType(type) {
  if (type === "occupiedCool") return "Occupied Cool";
  if (type === "occupiedHeat") return "Occupied Heat";
  if (type === "unoccupiedCool") return "Unoccupied Cool";
  if (type === "unoccupiedHeat") return "Unoccupied Heat";
  return type;
}

function badgeColor(type) {
  if (type.startsWith("occupied")) return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
}

function aggregateDailySetpoints(
  thermostats = [],
  selectedBuilding,
  selectedThermostat
) {
  const daily = new Map();

  for (const entry of thermostats) {
    const serial = entry?.serialNo;
    const date = entry?.date;
    if (!date) continue;

    const building = entry?.groupName || entry?.group || entry?.siteSlug || "—";

    if (selectedBuilding && building !== selectedBuilding) continue;
    if (selectedThermostat && serial !== selectedThermostat) continue;

    const day = deriveDaySetpoints(entry);
    if (!daily.has(date)) {
      daily.set(date, {
        date,
        occupiedCoolSum: 0,
        occupiedCoolCount: 0,
        occupiedHeatSum: 0,
        occupiedHeatCount: 0,
        unoccupiedCoolSum: 0,
        unoccupiedCoolCount: 0,
        unoccupiedHeatSum: 0,
        unoccupiedHeatCount: 0,
      });
    }

    const agg = daily.get(date);
    for (const key of [
      "occupiedCool",
      "occupiedHeat",
      "unoccupiedCool",
      "unoccupiedHeat",
    ]) {
      const val = day[key];
      if (val === null || !Number.isFinite(val)) continue;
      agg[`${key}Sum`] += val;
      agg[`${key}Count`] += 1;
    }
  }

  return Array.from(daily.values())
    .map((d) => {
      const occupiedCool =
        d.occupiedCoolCount > 0
          ? d.occupiedCoolSum / d.occupiedCoolCount
          : null;
      const occupiedHeat =
        d.occupiedHeatCount > 0
          ? d.occupiedHeatSum / d.occupiedHeatCount
          : null;
      const unoccupiedCool =
        d.unoccupiedCoolCount > 0
          ? d.unoccupiedCoolSum / d.unoccupiedCoolCount
          : null;
      const unoccupiedHeat =
        d.unoccupiedHeatCount > 0
          ? d.unoccupiedHeatSum / d.unoccupiedHeatCount
          : null;

      const deadband =
        occupiedCool !== null && occupiedHeat !== null
          ? occupiedCool - occupiedHeat
          : null;

      return {
        date: d.date,
        occupiedCool,
        occupiedHeat,
        unoccupiedCool,
        unoccupiedHeat,
        deadband,
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

export default function SetpointTrendsChart({ thermostats = [] }) {
  const [showOccupied, setShowOccupied] = useState(true);
  const [showUnoccupied, setShowUnoccupied] = useState(true);
  const [sortByDelta, setSortByDelta] = useState(true);
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [selectedThermostat, setSelectedThermostat] = useState("");

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const events = useMemo(() => buildChangeEvents(thermostats), [thermostats]);

  const buildingOptions = useMemo(() => {
    const buildings = new Set();
    for (const t of thermostats) {
      const name = t?.groupName || t?.group || t?.siteSlug || "—";
      if (name) buildings.add(name);
    }
    return Array.from(buildings).sort((a, b) => a.localeCompare(b));
  }, [thermostats]);

  const thermostatOptions = useMemo(() => {
    const map = new Map();
    for (const t of thermostats) {
      const serial = t?.serialNo;
      if (!serial) continue;
      if (!map.has(serial)) {
        map.set(serial, {
          serial,
          name: t?.name || serial,
          building: t?.groupName || t?.group || t?.siteSlug || "—",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [thermostats]);

  const dailyAverages = useMemo(
    () =>
      aggregateDailySetpoints(
        thermostats,
        selectedBuilding,
        selectedThermostat
      ),
    [thermostats, selectedBuilding, selectedThermostat]
  );

  const filtered = useMemo(() => {
    return events
      .filter((e) =>
        e.type.startsWith("occupied") ? showOccupied : showUnoccupied
      )
      .sort((a, b) => {
        if (sortByDelta) {
          const diff = Math.abs(b.delta) - Math.abs(a.delta);
          if (diff !== 0) return diff;
        }
        return new Date(b.date) - new Date(a.date);
      });
  }, [events, showOccupied, showUnoccupied, sortByDelta]);

  const topEvents = filtered.slice(0, 50); // keep it readable

  useEffect(() => {
    if (!chartRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    if (!dailyAverages.length) return;

    const labels = dailyAverages.map((d) =>
      new Date(d.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    );

    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Occupied Cooling",
            data: dailyAverages.map((d) => d.occupiedCool),
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.15)",
            tension: 0.2,
            spanGaps: true,
          },
          {
            label: "Occupied Heating",
            data: dailyAverages.map((d) => d.occupiedHeat),
            borderColor: "rgb(16, 185, 129)",
            backgroundColor: "rgba(16, 185, 129, 0.15)",
            tension: 0.2,
            spanGaps: true,
          },
          {
            label: "Unoccupied Cooling",
            data: dailyAverages.map((d) => d.unoccupiedCool),
            borderColor: "rgb(249, 115, 22)",
            backgroundColor: "rgba(249, 115, 22, 0.15)",
            tension: 0.2,
            spanGaps: true,
          },
          {
            label: "Unoccupied Heating",
            data: dailyAverages.map((d) => d.unoccupiedHeat),
            borderColor: "rgb(147, 51, 234)",
            backgroundColor: "rgba(147, 51, 234, 0.15)",
            tension: 0.2,
            spanGaps: true,
          },
          {
            label: "Occupied Deadband",
            data: dailyAverages.map((d) => d.deadband),
            borderColor: "rgb(107, 114, 128)",
            backgroundColor: "rgba(107, 114, 128, 0.15)",
            borderDash: [6, 4],
            tension: 0.2,
            spanGaps: true,
            yAxisID: "deadband",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            title: { display: true, text: "Setpoint (°F)" },
            grid: { drawBorder: false },
          },
          deadband: {
            position: "right",
            title: { display: true, text: "Deadband (°F)" },
            grid: { drawBorder: false, display: false },
          },
          x: {
            grid: { display: false },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed?.(1) ?? "–"}°`,
            },
          },
          legend: {
            position: "bottom",
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [dailyAverages]);

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6 space-y-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Average Setpoints (Daily)
            </h3>
            <p className="text-sm text-gray-500">
              Daily averages of occupied and unoccupied heating/cooling
              setpoints. Use filters to focus on a building or thermostat;
              defaults show all.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <label className="flex flex-col text-xs text-gray-500">
              Building
              <select
                value={selectedBuilding}
                onChange={(e) => setSelectedBuilding(e.target.value)}
                className="mt-1 min-w-[180px] rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All buildings</option>
                {buildingOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-gray-500">
              Thermostat
              <select
                value={selectedThermostat}
                onChange={(e) => setSelectedThermostat(e.target.value)}
                className="mt-1 min-w-[200px] rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All thermostats</option>
                {thermostatOptions.map((t) => (
                  <option key={t.serial} value={t.serial}>
                    {t.name} {t.building ? `(${t.building})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="h-72 border border-gray-200 rounded-lg p-3 bg-gray-50">
          {!dailyAverages.length ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              No setpoint data available for the selected filters.
            </div>
          ) : (
            <canvas ref={chartRef} aria-label="Daily setpoint averages chart" />
          )}
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Recent Setpoint Changes
          </h3>
          <p className="text-sm text-gray-500">
            Highlights devices whose occupied or unoccupied setpoints changed
            day-over-day. Occupied changes require min/max to differ; identical
            min/max are treated as unoccupied-only days.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Showing up to 50 changes, sorted by{" "}
            {sortByDelta ? "magnitude" : "date"}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={showOccupied}
              onChange={(e) => setShowOccupied(e.target.checked)}
            />
            <span>Occupied</span>
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={showUnoccupied}
              onChange={(e) => setShowUnoccupied(e.target.checked)}
            />
            <span>Unoccupied</span>
          </label>
          <button
            type="button"
            onClick={() => setSortByDelta((v) => !v)}
            className="ml-2 inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-700"
          >
            Sort by {sortByDelta ? "Date" : "Magnitude"}
          </button>
        </div>
      </div>

      {topEvents.length === 0 ? (
        <div className="text-sm text-gray-500">
          No setpoint changes found for the loaded period.
        </div>
      ) : (
        <div className="overflow-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-700">
                  Device
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">
                  Building
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">
                  Date
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">
                  Type
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">
                  From → To
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">
                  Δ (°F)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {topEvents.map((e) => (
                <tr key={`${e.serialNo}-${e.date}-${e.type}`}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{e.name}</div>
                    <div className="text-xs text-gray-500">{e.serialNo}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{e.group}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {new Date(e.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeColor(
                        e.type
                      )}`}
                    >
                      {formatType(e.type)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {e.from.toFixed(1)}° → {e.to.toFixed(1)}°
                  </td>
                  <td className="px-4 py-2 font-semibold text-gray-900">
                    {e.delta > 0 ? "+" : ""}
                    {e.delta.toFixed(1)}°
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
