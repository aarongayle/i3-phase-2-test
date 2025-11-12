import { useEffect, useRef, useState } from "react";
import { fetchPelicanBulkLoad } from "../services/api";

export function usePelicanData(clientId, days = 14) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({
    pelican: { progress: 0, message: "" },
  });
  const abortControllerRef = useRef(null);

  useEffect(() => {
    if (!clientId || !clientId.trim()) {
      setLoading(false);
      setError(null);
      setProgress({
        pelican: { progress: 0, message: "" },
      });
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
          pelican: { progress: 0, message: "" },
        });

        const result = await fetchPelicanBulkLoad(
          clientId,
          days,
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
          console.log("[usePelicanData] Load complete:", result);
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
  }, [clientId, days]);

  return { loading, error, progress };
}

