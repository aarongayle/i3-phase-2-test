import { Chart } from "chart.js/auto";
import { useEffect, useRef } from "react";
import { getTopDevicesByRuntime, round2 } from "../utils/chartData";

export default function TopRuntimeChart({ devices }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current || !devices?.length) return;

    const topDevices = getTopDevicesByRuntime(devices, 10);
    const labels = topDevices.map((d) => d.name);
    const data = topDevices.map((d) => round2(d.runtimeAvgMin || 0));

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create new chart
    chartInstance.current = new Chart(chartRef.current, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Runtime Avg (min)",
            data,
            backgroundColor: "rgba(59, 130, 246, 0.6)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { autoSkip: false } },
          y: { beginAtZero: true },
        },
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
