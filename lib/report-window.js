// Shared date-window helpers for headless reports, analytics, and schedules.

export const DEFAULT_REPORT_WINDOW_DAYS = 100;

export function isoDate(value) {
  if (!value) return null;
  const str = String(value);
  return str.includes("T") ? str.split("T")[0] : str;
}

export function normalizeReportDate(value) {
  return isoDate(value?.report_date ?? value);
}

export function uniqueSortedReportDates(dates) {
  return Array.from(
    new Set((dates || []).map(normalizeReportDate).filter(Boolean))
  ).sort((a, b) => new Date(a) - new Date(b));
}

/**
 * Keep the trailing N report dates (or all if fewer).
 */
export function sliceReportDates(allDates, { windowDays = DEFAULT_REPORT_WINDOW_DAYS } = {}) {
  const sorted = uniqueSortedReportDates(allDates);
  if (!sorted.length || !windowDays || sorted.length <= windowDays) {
    return sorted;
  }
  return sorted.slice(sorted.length - windowDays);
}

export function filterDatesByReportDays(dates, reportDayStrings) {
  const allowed = new Set(reportDayStrings);
  return (dates || []).filter((d) => allowed.has(normalizeReportDate(d)));
}

export function daysBetween(start, end) {
  if (!start || !end) return DEFAULT_REPORT_WINDOW_DAYS;
  const ms = new Date(end) - new Date(start);
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)) + 1);
}

export function resolveEnergyDateRange(energyExpected, energyActual, meta = {}) {
  const labels = [];
  const seen = new Set();
  for (const meter of [...(energyExpected || []), ...(energyActual || [])]) {
    for (const pt of meter?.Interval || []) {
      const d = isoDate(pt?.date);
      if (d && !seen.has(d)) {
        seen.add(d);
        labels.push(d);
      }
    }
  }
  labels.sort((a, b) => new Date(a) - new Date(b));

  if (labels.length > 0) {
    return { start: labels[0], end: labels[labels.length - 1], labels };
  }

  const start = isoDate(meta.firstReportDate);
  const end = isoDate(meta.mostRecentDate);
  if (start && end) {
    return { start, end, labels: [] };
  }

  return null;
}

/**
 * Report dates needed for schedule-details / expected energy within the energy window.
 */
export function reportDaysForEnergyWindow(allReportDays, energyRange) {
  const sorted = uniqueSortedReportDates(allReportDays);
  if (!sorted.length) return [];

  if (!energyRange?.start || !energyRange?.end) {
    return sliceReportDates(sorted);
  }

  const needed = new Set();
  const energyStart = new Date(energyRange.start);
  const energyEnd = new Date(energyRange.end);

  for (
    let d = new Date(energyStart);
    d <= energyEnd;
    d.setDate(d.getDate() + 1)
  ) {
    const day = isoDate(d);
    let closest = sorted[0];
    let minDiff = Math.abs(new Date(day) - new Date(sorted[0]));
    for (let j = 1; j < sorted.length; j++) {
      const diff = Math.abs(new Date(day) - new Date(sorted[j]));
      if (diff < minDiff) {
        minDiff = diff;
        closest = sorted[j];
      }
    }
    needed.add(closest);
  }

  return Array.from(needed).sort((a, b) => new Date(a) - new Date(b));
}
