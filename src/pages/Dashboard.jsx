import { useState } from "react";
import { useParams } from "react-router-dom";
import DeviceMetricsTable from "../components/DeviceMetricsTable";
import EnergyUsageChart from "../components/EnergyUsageChart";
import {
  IntervalComparisonAverage,
  IntervalComparisonLatest,
} from "../components/IntervalComparisonCharts";
import LoadingProgress from "../components/LoadingProgress";
import MeterSnapshotTable from "../components/MeterSnapshotTable";
import PeakDemandChart from "../components/PeakDemandChart";
import TopRuntimeChart from "../components/TopRuntimeChart";
import WeeklyRuntimeChart from "../components/WeeklyRuntimeChart";
import { usePelicanData } from "../hooks/usePelicanData";
import { useReportData } from "../hooks/useReportData";

export default function Dashboard() {
  const { clientId: urlClientId } = useParams();
  const [clientId, setClientId] = useState(urlClientId || "");
  const [clientIdInput, setClientIdInput] = useState(urlClientId || "");
  const [shouldLoadReport, setShouldLoadReport] = useState(false);
  const [shouldLoadPelican, setShouldLoadPelican] = useState(false);
  const [pelicanDays, setPelicanDays] = useState(14); // Default 2 weeks
  const [pelicanClientId, setPelicanClientId] = useState("");

  const { data, loading, error, progress } = useReportData(
    shouldLoadReport ? clientId : ""
  );

  const {
    loading: pelicanLoading,
    error: pelicanError,
    progress: pelicanProgress,
  } = usePelicanData(pelicanClientId, pelicanDays);

  const handleSetClientId = () => {
    if (clientIdInput.trim()) {
      setClientId(clientIdInput.trim());
      setShouldLoadReport(false);
      setShouldLoadPelican(false);
      setPelicanClientId("");
    }
  };

  const handleLoadCampusOptimiser = () => {
    if (clientId) {
      setShouldLoadReport(true);
      setShouldLoadPelican(false);
    }
  };

  const handleLoadPelican = () => {
    if (clientId) {
      setPelicanClientId(clientId);
      setShouldLoadPelican(true);
      setShouldLoadReport(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Campus Optimizer Reports
          </h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Client ID Form */}
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <div className="flex gap-4 items-end flex-wrap">
              <div className="flex-1 max-w-md">
                <label
                  htmlFor="clientId"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Client ID
                </label>
                <input
                  type="text"
                  id="clientId"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSetClientId();
                    }
                  }}
                  className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md px-4 py-2 border"
                  placeholder="Enter client ID (e.g., 1420)"
                />
              </div>
              <button
                type="button"
                onClick={handleSetClientId}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Set Client ID
              </button>
            </div>
            {clientId && (
              <div className="mt-4 flex gap-4 items-end flex-wrap">
                <button
                  type="button"
                  onClick={handleLoadCampusOptimiser}
                  disabled={loading}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Load Campus Optimiser Data
                </button>
                <div className="flex gap-4 items-end">
                  <div>
                    <label
                      htmlFor="pelicanDays"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Days to Load
                    </label>
                    <input
                      type="number"
                      id="pelicanDays"
                      min="1"
                      max="90"
                      value={pelicanDays}
                      onChange={(e) => setPelicanDays(Number(e.target.value))}
                      className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-24 sm:text-sm border-gray-300 rounded-md px-4 py-2 border"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadPelican}
                    disabled={pelicanLoading}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Load Pelican Data
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Loading Progress Modal */}
          <LoadingProgress progress={progress} isVisible={loading} />
          <LoadingProgress
            progress={pelicanProgress}
            isVisible={pelicanLoading}
          />

          {/* Error State */}
          {error && (
            <div className="rounded-md bg-red-50 p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Error loading Campus Optimiser data
                  </h3>
                  <p className="mt-2 text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}
          {pelicanError && (
            <div className="rounded-md bg-red-50 p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Error loading Pelican data
                  </h3>
                  <p className="mt-2 text-sm text-red-700">{pelicanError}</p>
                </div>
              </div>
            </div>
          )}

          {/* Data Display */}
          {data && !loading && (
            <div className="space-y-6">
              {/* Metadata Card */}
              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <div className="px-4 py-5 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Report Overview
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-gray-500">
                    {data.cached && (
                      <span className="text-green-600">[Cached] </span>
                    )}
                    Generated at{" "}
                    {new Date(data.meta?.generatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="border-t border-gray-200 px-4 py-5 sm:px-6">
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">
                        Client ID
                      </dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {data.meta?.clientId}
                      </dd>
                    </div>
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">
                        Reports Count
                      </dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {data.meta?.reportsCount}
                      </dd>
                    </div>
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">
                        First Report
                      </dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {data.meta?.firstReportDate || "N/A"}
                      </dd>
                    </div>
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">
                        Most Recent
                      </dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {data.meta?.mostRecentDate || "N/A"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Runtime Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4">
                    Top 10 Devices by Avg Runtime (min)
                  </h3>
                  <div className="h-80">
                    <TopRuntimeChart devices={data.devices} />
                  </div>
                </div>
                <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4">
                    Total Runtime per Week (min)
                  </h3>
                  <div className="h-80">
                    <WeeklyRuntimeChart devices={data.devices} />
                  </div>
                </div>
              </div>

              {/* Energy Charts */}
              {(data.energy?.expected?.length ||
                data.energy?.actual?.length) && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-2">
                        Daily Energy Use (All Meters)
                      </h3>
                      <p className="text-xs text-gray-500 mb-4">
                        Expected vs Actual (sum of interval values per day)
                      </p>
                      <div className="h-80">
                        <EnergyUsageChart
                          energyExpected={data.energy?.expected}
                          energyActual={data.energy?.actual}
                        />
                      </div>
                    </div>
                    <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-2">
                        Daily Peak Demand (All Meters)
                      </h3>
                      <p className="text-xs text-gray-500 mb-4">
                        Expected vs Actual (max interval kW per day)
                      </p>
                      <div className="h-80">
                        <PeakDemandChart
                          energyExpected={data.energy?.expected}
                          energyActual={data.energy?.actual}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Interval Comparison Charts */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-2">
                        Interval Comparison — Latest Day
                      </h3>
                      <p className="text-xs text-gray-500 mb-4">
                        Expected vs Actual demand per 15-min interval for latest
                        day
                      </p>
                      <div className="h-80">
                        <IntervalComparisonLatest
                          energyExpected={data.energy?.expected}
                          energyActual={data.energy?.actual}
                        />
                      </div>
                    </div>
                    <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-2">
                        Interval Comparison — Multi-Day Average
                      </h3>
                      <p className="text-xs text-gray-500 mb-4">
                        Average expected vs actual demand across all days (per
                        15-min interval)
                      </p>
                      <div className="h-80">
                        <IntervalComparisonAverage
                          energyExpected={data.energy?.expected}
                          energyActual={data.energy?.actual}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Meter Snapshot Table */}
                  <MeterSnapshotTable
                    energyExpected={data.energy?.expected}
                    energyActual={data.energy?.actual}
                  />
                </>
              )}

              {/* Device Metrics Table */}
              <DeviceMetricsTable devices={data.devices} />

              {/* Raw JSON (for debugging) */}
              <details className="bg-white shadow overflow-hidden sm:rounded-lg">
                <summary className="px-4 py-5 sm:px-6 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  View Raw Data (Debug)
                </summary>
                <div className="border-t border-gray-200 px-4 py-5 sm:px-6">
                  <pre className="text-xs bg-gray-50 p-4 rounded overflow-auto max-h-96">
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </div>
              </details>
            </div>
          )}

          {/* No Data State */}
          {!data && !loading && !error && (
            <div className="text-center py-12">
              <p className="text-gray-500">
                Enter a client ID to load report data
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
