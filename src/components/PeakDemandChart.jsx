import { Chart } from "chart.js/auto";
import { useEffect, useRef } from "react";
import {
  dailyAggregates,
  round2,
  uniqueSortedDatesFromMaps,
} from "../utils/chartData";

export default function PeakDemandChart({ energyExpected, energyActual }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const { peakKw: peakExpectedMap } = dailyAggregates(energyExpected);
    const { peakKw: peakActualMap } = dailyAggregates(energyActual);
    const labels = uniqueSortedDatesFromMaps(peakExpectedMap, peakActualMap);

    // Limit to most recent 75 points
    const ENERGY_MAX_POINTS = 75;
    const sliceStart = Math.max(0, labels.length - ENERGY_MAX_POINTS);
    const limitedLabels = labels.slice(sliceStart);

    const expectedSeries = limitedLabels.map((d) =>
      round2(peakExpectedMap.get(d) || 0)
    );
    const actualSeries = limitedLabels.map((d) =>
      round2(peakActualMap.get(d) || 0)
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
            label: "Expected Peak (kW)",
            data: expectedSeries,
            borderColor: "rgb(37, 99, 235)",
            backgroundColor: "rgba(37, 99, 235, 0.15)",
            fill: true,
            tension: 0.2,
          },
          {
            label: "Actual Peak (kW)",
            data: actualSeries,
            borderColor: "rgb(16, 185, 129)",
            backgroundColor: "rgba(16, 185, 129, 0.15)",
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
