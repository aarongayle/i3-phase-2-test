import { Chart } from "chart.js/auto";
import { useEffect, useRef } from "react";
import { aggregateWeekly, round2 } from "../utils/chartData";

export default function WeeklyRuntimeChart({ devices }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current || !devices?.length) return;

    const { labels, totalRuntime } = aggregateWeekly(devices);
    const data = totalRuntime.map(round2);

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create new chart
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Total Runtime (min)",
            data,
            borderColor: "rgb(16, 185, 129)",
            backgroundColor: "rgba(16, 185, 129, 0.2)",
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
  }, [devices]);

  if (!devices?.length) {
    return (
      <div className="text-gray-500 text-sm">No device data available</div>
    );
  }

  return <canvas ref={chartRef}></canvas>;
}
