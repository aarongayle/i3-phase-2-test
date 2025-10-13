import { Chart } from "chart.js/auto";
import { useEffect, useRef } from "react";
import {
  dailyAggregates,
  round2,
  uniqueSortedDatesFromMaps,
} from "../utils/chartData";

export default function EnergyUsageChart({ energyExpected, energyActual }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const { totals: dailyExpectedMap } = dailyAggregates(energyExpected);
    const { totals: dailyActualMap } = dailyAggregates(energyActual);
    const labels = uniqueSortedDatesFromMaps(dailyExpectedMap, dailyActualMap);

    // Limit to most recent 75 points
    const ENERGY_MAX_POINTS = 75;
    const sliceStart = Math.max(0, labels.length - ENERGY_MAX_POINTS);
    const limitedLabels = labels.slice(sliceStart);

    const expectedSeries = limitedLabels.map((d) =>
      round2(dailyExpectedMap.get(d) || 0)
    );
    const actualSeries = limitedLabels.map((d) =>
      round2(dailyActualMap.get(d) || 0)
    );

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create new chart
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels: limitedLabels,
        datasets: [
          {
            label: "Expected (daily total)",
            data: expectedSeries,
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            fill: true,
            tension: 0.2,
          },
          {
            label: "Actual (daily total)",
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
