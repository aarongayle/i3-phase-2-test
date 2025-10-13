// Script to pre-compute report data
// Run with: node scripts/precompute-reports.js [clientId]

import { writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import {
  actualEnergyUse,
  expectedEnergyUse,
  getDevices,
  getReportDates,
} from "../lib/co-client.js";
import { DataAggregationService } from "../lib/services/aggregation.js";

const aggregationService = new DataAggregationService();

async function precomputeReport(clientId) {
  console.log(`\n=== Pre-computing report for clientId: ${clientId} ===\n`);

  try {
    // Fetch all data in parallel where possible
    console.log("Fetching devices and dates in parallel...");
    const [devices, dates] = await Promise.all([
      getDevices(Number(clientId)),
      getReportDates(Number(clientId)),
    ]);
    console.log(`✓ Loaded ${devices.length} devices, ${dates.length} dates\n`);

    // Fetch energy data in parallel
    console.log("Fetching energy data in parallel...");
    const [energyExpected, energyActual] = await Promise.all([
      expectedEnergyUse(Number(clientId)),
      actualEnergyUse(Number(clientId)),
    ]);
    console.log(`✓ Loaded energy data\n`);

    // Aggregate device metrics (this is likely the slow part)
    console.log("Aggregating device metrics...");
    const startTime = Date.now();
    const deviceMetrics = await aggregationService.aggregateDeviceMetrics(
      devices,
      dates,
      Number(clientId)
    );
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Aggregation complete in ${duration}s\n`);

    // Build response
    const data = {
      meta: {
        clientId: Number(clientId),
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

    // Save to file
    await mkdir("campus-optimizer/data", { recursive: true });
    const filename = `campus-optimizer/data/compiled-${clientId}.json`;
    writeFileSync(filename, JSON.stringify(data, null, 2));

    console.log(`✓ Saved to ${filename}`);
    console.log(
      `✓ File size: ${(JSON.stringify(data).length / 1024 / 1024).toFixed(
        2
      )} MB`
    );
    console.log(`\n=== Complete! ===\n`);

    return data;
  } catch (error) {
    console.error("Error pre-computing report:", error);
    process.exit(1);
  }
}

// Get clientId from command line
const clientId = process.argv[2] || "1420";
precomputeReport(clientId).then(() => process.exit(0));
