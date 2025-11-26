import { useState } from "react";

/**
 * Format minutes as hours and minutes string
 */
function formatMinutes(minutes) {
  if (!minutes || minutes < 1) return "0m";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format temperature with degree symbol
 */
function formatTemp(temp) {
  if (temp === null || temp === undefined) return "—";
  return `${temp.toFixed(1)}°`;
}

/**
 * Get color class based on runtime/occupancy ratio
 * Lower is generally better (less runtime per occupied time)
 */
function getRatioColor(ratio) {
  if (ratio < 20) return "text-emerald-600";
  if (ratio < 35) return "text-green-600";
  if (ratio < 50) return "text-yellow-600";
  if (ratio < 75) return "text-orange-500";
  return "text-red-500";
}

/**
 * Get background color class based on ratio
 */
function getRatioBgColor(ratio) {
  if (ratio < 20) return "bg-emerald-50";
  if (ratio < 35) return "bg-green-50";
  if (ratio < 50) return "bg-yellow-50";
  if (ratio < 75) return "bg-orange-50";
  return "bg-red-50";
}

/**
 * Progress bar component
 */
function ProgressBar({ value, max = 100, color = "blue" }) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const colorClasses = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
  };
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div
        className={`h-2 rounded-full ${colorClasses[color] || "bg-blue-500"}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

/**
 * Stat card for individual metrics
 */
function StatCard({ label, value, subtext, className = "" }) {
  return (
    <div className={`p-4 rounded-lg ${className}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
    </div>
  );
}

/**
 * Temperature display component
 */
function TempDisplay({ temps, compact = false }) {
  if (!temps) return null;

  if (compact) {
    return (
      <div className="flex gap-4 text-xs">
        <span className="text-red-600">
          🔥 {formatTemp(temps.occupiedHeat)}/{formatTemp(temps.unoccupiedHeat)}
        </span>
        <span className="text-blue-600">
          ❄️ {formatTemp(temps.occupiedCool)}/{formatTemp(temps.unoccupiedCool)}
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div className="bg-red-50 rounded-lg p-3">
        <p className="text-xs font-medium text-red-800 mb-1">🔥 Heating</p>
        <div className="flex justify-between">
          <div>
            <p className="text-xs text-red-600">Occupied</p>
            <p className="font-bold text-red-800">{formatTemp(temps.occupiedHeat)}</p>
          </div>
          <div>
            <p className="text-xs text-red-600">Unoccupied</p>
            <p className="font-bold text-red-800">{formatTemp(temps.unoccupiedHeat)}</p>
          </div>
        </div>
      </div>
      <div className="bg-blue-50 rounded-lg p-3">
        <p className="text-xs font-medium text-blue-800 mb-1">❄️ Cooling</p>
        <div className="flex justify-between">
          <div>
            <p className="text-xs text-blue-600">Occupied</p>
            <p className="font-bold text-blue-800">{formatTemp(temps.occupiedCool)}</p>
          </div>
          <div>
            <p className="text-xs text-blue-600">Unoccupied</p>
            <p className="font-bold text-blue-800">{formatTemp(temps.unoccupiedCool)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Expandable row for building or thermostat
 */
function ExpandableRow({ item, isBuilding = false, expanded, onToggle }) {
  const ratio = item.runtimeByOccupancy || 0;
  const colorClass = getRatioColor(ratio);

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div
        className="flex items-center justify-between py-3 px-4 hover:bg-gray-50 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {item.groupName || item.name || item.serialNo}
          </p>
          {isBuilding && (
            <p className="text-xs text-gray-500">
              {item.thermostatCount} thermostat
              {item.thermostatCount !== 1 ? "s" : ""}
            </p>
          )}
          {!isBuilding && item.groupName && (
            <p className="text-xs text-gray-500">{item.groupName}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className={`text-lg font-bold ${colorClass}`}>
              {ratio.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500">
              {formatMinutes(item.runtimeMinutes)} /{" "}
              {formatMinutes(item.occupancyMinutes)}
            </p>
          </div>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 bg-gray-50">
          <div className="grid grid-cols-3 gap-4 text-sm mb-3">
            <div>
              <p className="text-gray-500">Total Time</p>
              <p className="font-medium">{formatMinutes(item.totalMinutes)}</p>
            </div>
            <div>
              <p className="text-gray-500">Occupied</p>
              <p className="font-medium text-blue-600">
                {formatMinutes(item.occupancyMinutes)}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Runtime</p>
              <p className="font-medium text-orange-600">
                {formatMinutes(item.runtimeMinutes)}
              </p>
            </div>
          </div>

          {/* Temperature stats */}
          {item.temps && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-2">Average Setpoint Temperatures:</p>
              <TempDisplay temps={item.temps} />
            </div>
          )}

          {isBuilding && item.thermostats && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">Thermostats:</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {item.thermostats
                  .sort((a, b) => b.runtimeByOccupancy - a.runtimeByOccupancy)
                  .map((t) => (
                    <div
                      key={t.serialNo}
                      className="flex justify-between text-sm items-center"
                    >
                      <span className="truncate flex-1">{t.name}</span>
                      <TempDisplay temps={t.temps} compact />
                      <span className={`ml-2 ${getRatioColor(t.runtimeByOccupancy)}`}>
                        {t.runtimeByOccupancy.toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RuntimeByOccupancyCard({ data }) {
  const [viewMode, setViewMode] = useState("campus"); // campus, buildings, thermostats
  const [expandedItems, setExpandedItems] = useState(new Set());

  if (!data) {
    return (
      <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
        <p className="text-gray-500 text-sm">
          No Pelican analytics data available
        </p>
      </div>
    );
  }

  const { campus, buildings, thermostats, dateRange } = data;
  const campusRatio = campus?.runtimeByOccupancy || 0;

  const toggleExpanded = (key) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedItems(newExpanded);
  };

  // Sort buildings by ratio (highest first)
  const sortedBuildings = [...(buildings || [])].sort(
    (a, b) => b.runtimeByOccupancy - a.runtimeByOccupancy
  );

  // Sort thermostats by ratio (highest first)
  const sortedThermostats = [...(thermostats || [])].sort(
    (a, b) => b.runtimeByOccupancy - a.runtimeByOccupancy
  );

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Runtime by Occupancy
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {dateRange?.start} to {dateRange?.end}
            </p>
          </div>
          <div
            className={`text-4xl font-bold ${getRatioColor(campusRatio)} ${getRatioBgColor(campusRatio)} px-4 py-2 rounded-lg`}
          >
            {campusRatio.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Campus Overview Stats */}
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Buildings"
            value={campus?.buildingCount || 0}
            className="bg-white"
          />
          <StatCard
            label="Thermostats"
            value={campus?.thermostatCount || 0}
            className="bg-white"
          />
          <StatCard
            label="Avg Daily Occupancy"
            value={formatMinutes(campus?.avgOccupancyMinutes || 0)}
            subtext="per thermostat"
            className="bg-white"
          />
          <StatCard
            label="Avg Daily Runtime"
            value={formatMinutes(campus?.avgRuntimeMinutes || 0)}
            subtext="per thermostat"
            className="bg-white"
          />
        </div>
      </div>

      {/* Campus Temperature Stats */}
      {campus?.temps && (
        <div className="px-6 py-4 border-b border-gray-200">
          <h4 className="text-sm font-medium text-gray-700 mb-3">
            Campus Average Setpoint Temperatures
          </h4>
          <TempDisplay temps={campus.temps} />
        </div>
      )}

      {/* Explanation */}
      <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
        <p className="text-sm text-blue-800">
          <strong>Runtime by Occupancy</strong> measures how much of the occupied
          time the HVAC is actually running. Occupancy is inferred from temperature
          setpoints (higher heat / lower cool = occupied). Values over 100% indicate
          the system runs while spaces are unoccupied.
        </p>
      </div>

      {/* View Mode Tabs */}
      <div className="px-6 py-3 border-b border-gray-200">
        <div className="flex gap-2">
          {["campus", "buildings", "thermostats"].map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                viewMode === mode
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content based on view mode */}
      <div className="max-h-96 overflow-y-auto">
        {viewMode === "campus" && (
          <div className="p-6">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Total Occupied Time</span>
                  <span className="font-medium">
                    {formatMinutes(campus?.occupancyMinutes || 0)}
                  </span>
                </div>
                <ProgressBar value={100} color="blue" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Total Runtime</span>
                  <span className="font-medium">
                    {formatMinutes(campus?.runtimeMinutes || 0)}
                  </span>
                </div>
                <ProgressBar
                  value={campusRatio}
                  max={100}
                  color={campusRatio > 100 ? "red" : "orange"}
                />
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-3">
                Top 5 Buildings by Runtime/Occupancy
              </h4>
              <div className="space-y-2">
                {sortedBuildings.slice(0, 5).map((b) => (
                  <div
                    key={b.groupName}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm text-gray-600 truncate flex-1">
                      {b.groupName}
                    </span>
                    <span
                      className={`text-sm font-medium ${getRatioColor(b.runtimeByOccupancy)}`}
                    >
                      {b.runtimeByOccupancy.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {viewMode === "buildings" && (
          <div>
            {sortedBuildings.length === 0 ? (
              <p className="p-6 text-gray-500 text-sm">
                No building data available
              </p>
            ) : (
              sortedBuildings.map((building) => (
                <ExpandableRow
                  key={building.groupName}
                  item={building}
                  isBuilding={true}
                  expanded={expandedItems.has(building.groupName)}
                  onToggle={() => toggleExpanded(building.groupName)}
                />
              ))
            )}
          </div>
        )}

        {viewMode === "thermostats" && (
          <div>
            {sortedThermostats.length === 0 ? (
              <p className="p-6 text-gray-500 text-sm">
                No thermostat data available
              </p>
            ) : (
              sortedThermostats.map((thermostat) => (
                <ExpandableRow
                  key={thermostat.serialNo}
                  item={thermostat}
                  isBuilding={false}
                  expanded={expandedItems.has(thermostat.serialNo)}
                  onToggle={() => toggleExpanded(thermostat.serialNo)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
