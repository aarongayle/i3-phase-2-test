import { Chart } from "chart.js/auto";
import { useEffect, useRef } from "react";
import {
  averageSeries,
  dailyAggregates,
  round2,
  seriesForDate,
  uniqueSortedDatesFromMaps,
} from "../utils/chartData";

export function IntervalComparisonLatest({ energyExpected, energyActual }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const { intervalsByDate: intervalsExpected } =
      dailyAggregates(energyExpected);
    const { intervalsByDate: intervalsActual } = dailyAggregates(energyActual);

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

    const { totals: dailyExpectedMap } = dailyAggregates(energyExpected);
    const { totals: dailyActualMap } = dailyAggregates(energyActual);
    const labels = uniqueSortedDatesFromMaps(dailyExpectedMap, dailyActualMap);
    const latestDate = labels.length ? labels[labels.length - 1] : null;

    const expectedSeries = latestDate
      ? seriesForDate(intervalsExpected, latestDate, intervalKeys).map(round2)
      : [];
    const actualSeries = latestDate
      ? seriesForDate(intervalsActual, latestDate, intervalKeys).map(round2)
      : [];

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create new chart
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels: intervalKeys,
        datasets: [
          {
            label: "Expected (kWh)",
            data: expectedSeries,
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            fill: true,
            tension: 0.2,
          },
          {
            label: "Actual (kWh)",
            data: actualSeries,
            borderColor: "rgb(234, 88, 12)",
            backgroundColor: "rgba(234, 88, 12, 0.2)",
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              callback(value, index) {
                if (index % 12 === 0) return intervalKeys[index];
                return "";
              },
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
  }, [energyExpected, energyActual]);

  if (!energyExpected?.length && !energyActual?.length) {
    return (
      <div className="text-gray-500 text-sm">No energy data available</div>
    );
  }

  return <canvas ref={chartRef}></canvas>;
}

export function IntervalComparisonAverage({ energyExpected, energyActual }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const { intervalsByDate: intervalsExpected } =
      dailyAggregates(energyExpected);
    const { intervalsByDate: intervalsActual } = dailyAggregates(energyActual);

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

    const expectedSeries = averageSeries(intervalsExpected, intervalKeys).map(
      round2
    );
    const actualSeries = averageSeries(intervalsActual, intervalKeys).map(
      round2
    );

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create new chart
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels: intervalKeys,
        datasets: [
          {
            label: "Expected Avg (kWh)",
            data: expectedSeries,
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            fill: true,
            tension: 0.2,
          },
          {
            label: "Actual Avg (kWh)",
            data: actualSeries,
            borderColor: "rgb(234, 88, 12)",
            backgroundColor: "rgba(234, 88, 12, 0.2)",
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              callback(value, index) {
                if (index % 12 === 0) return intervalKeys[index];
                return "";
              },
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
  }, [energyExpected, energyActual]);

  if (!energyExpected?.length && !energyActual?.length) {
    return (
      <div className="text-gray-500 text-sm">No energy data available</div>
    );
  }

  return <canvas ref={chartRef}></canvas>;
}
