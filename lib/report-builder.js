// Shared report data builder used by precompute scripts and API routes
import fs from "node:fs";
import path from "node:path";
import {
  actualEnergyUse,
  expectedEnergyUse,
  getDevices,
  getReportDates,
} from "./co-client.js";
import { DataAggregationService } from "./services/aggregation.js";

const aggregationService = new DataAggregationService();

function normalizeCompiledShape(raw) {
  if (!raw) return null;
  if (raw.report) return raw;
  if (raw.meta && raw.devices && raw.energy) {
    return { report: raw };
  }
  return null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Build the compiled report payload for a client.
 * Returns `{ report: { meta, devices, energy } }`.
 */
export async function buildCompiledReport(
  clientId,
  { useCache = true, saveJson = true, outputPath, onProgress } = {}
) {
  const normalizedId = String(clientId).trim();
  const outPath = path.resolve(
    outputPath || `campus-optimizer/data/compiled-${normalizedId}.json`
  );

  const progress = (stage, message, extra) =>
    onProgress?.({ stage, message, ...extra });

  if (useCache && fs.existsSync(outPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(outPath, "utf8"));
      const normalized = normalizeCompiledShape(cached);
      if (normalized) {
        progress(
          "cache-hit",
          `Used cached compiled report for client ${normalizedId}`
        );
        return normalized;
      }
    } catch (err) {
      console.warn(
        `[report-builder] Failed to use cached file ${outPath}: ${err.message}`
      );
    }
  }

  console.log(`[report-builder] Building compiled report for client ${clientId}`);
  console.log(`[report-builder] Loading devices and report dates...`);
  progress("start", "Building compiled report", { clientId: normalizedId });
  progress("load-devices-dates", "Loading devices and report dates...");
  const [devices, dates] = await Promise.all([
    getDevices(Number(normalizedId)),
    getReportDates(Number(normalizedId)),
  ]);
  console.log(
    `[report-builder] ✓ Loaded ${devices.length} devices, ${dates.length} dates`
  );
  progress("loaded-devices-dates", "Loaded devices and dates", {
    devices: devices.length,
    dates: dates.length,
  });

  console.log(`[report-builder] Loading energy data (expected & actual)...`);
  progress("energy-start", "Loading energy data (expected & actual)...");
  const energyProgress = (payload) =>
    progress(payload?.stage || "energy", payload?.message, payload);
  const [energyExpected, energyActual] = await Promise.all([
    expectedEnergyUse(Number(normalizedId), { onProgress: energyProgress }),
    actualEnergyUse(Number(normalizedId), { onProgress: energyProgress }),
  ]);
  console.log(`[report-builder] ✓ Energy data loaded`);
  progress("energy-loaded", "Energy data loaded");

  console.log(`[report-builder] Aggregating device metrics...`);
  progress("aggregation-start", "Aggregating device metrics...");
  const deviceMetrics = await aggregationService.aggregateDeviceMetrics(
    devices,
    dates,
    Number(normalizedId)
  );
  console.log(`[report-builder] ✓ Aggregation complete`);
  progress("aggregation-complete", "Aggregation complete");

  const report = {
    meta: {
      clientId: Number(normalizedId),
      reportsCount: dates.length,
      firstReportDate: dates[0]?.report_date,
      mostRecentDate: dates[dates.length - 1]?.report_date,
      generatedAt: new Date().toISOString(),
    },
    devices: deviceMetrics,
    energy: {
      expected: energyExpected,
      actual: energyActual,
    },
  };

  const compiled = { report };

  if (saveJson) {
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, JSON.stringify(compiled, null, 2));
    console.log(`[report-builder] ✓ Saved compiled report to ${outPath}`);
    progress("saved", "Saved compiled report to disk", { path: outPath });
  }

  progress("done", "Compiled report ready");
  return compiled;
}

export async function loadCompiledFromDisk(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const normalized = normalizeCompiledShape(raw);
  if (!normalized) {
    throw new Error(`Invalid compiled report shape in ${filePath}`);
  }
  return normalized;
}

