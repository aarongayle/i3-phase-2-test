import { useEffect, useRef, useState } from "react";
import { fetchCompiledReportStream } from "../services/api";

export function useReportData(clientId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({
    cache: { progress: 0, message: "" },
    devices: { progress: 0, message: "" },
    dates: { progress: 0, message: "" },
    "energy-expected": { progress: 0, message: "" },
    "energy-actual": { progress: 0, message: "" },
    aggregation: { progress: 0, message: "" },
  });
  const abortControllerRef = useRef(null);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const currentController = abortControllerRef.current;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        setProgress({
          cache: { progress: 0, message: "" },
          devices: { progress: 0, message: "" },
          dates: { progress: 0, message: "" },
          "energy-expected": { progress: 0, message: "" },
          "energy-actual": { progress: 0, message: "" },
          aggregation: { progress: 0, message: "" },
        });

        const result = await fetchCompiledReportStream(
          clientId,
          (progressData) => {
            setProgress((prev) => ({
              ...prev,
              [progressData.stage]: {
                progress: progressData.progress,
                message: progressData.message,
              },
            }));
          },
          currentController.signal
        );

        if (!currentController.signal.aborted) {
          setData(result);
        }
      } catch (err) {
        if (!currentController.signal.aborted) {
          if (err.name === "AbortError") {
            console.log("Request was cancelled");
          } else {
            setError(err.message);
          }
        }
      } finally {
        if (!currentController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      currentController.abort();
    };
  }, [clientId]);

  return { data, loading, error, progress };
}
