/**
 * API service for fetching compiled reports
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

/**
 * Fetch compiled report data
 * @param {string|number} clientId - The client ID
 * @param {Function} onProgress - Progress callback (not used, kept for compatibility)
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Object>} The complete report data
 */
export async function fetchCompiledReportStream(clientId, onProgress, signal) {
  const url = `${API_BASE_URL}/reports/compiled/${clientId}`;
  console.log("[API] Fetching report data from:", url);

  try {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    console.log("[API] Report data received successfully");
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new DOMException("Request aborted", "AbortError");
    }
    throw err;
  }
}

/**
 * Fetch compiled report data without streaming (fallback)
 * @param {string|number} clientId - The client ID
 * @returns {Promise<Object>} The complete report data
 */
export async function fetchCompiledReport(clientId) {
  const url = `${API_BASE_URL}/reports/compiled/${clientId}`;

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  return response.json();
}
