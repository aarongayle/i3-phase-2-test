// Script to pre-compute report data
// Run with: node scripts/precompute-reports.js [clientId]

import { writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import { buildCompiledReport } from "../lib/report-builder.js";

// Get clientId from command line
const clientId = process.argv[2] || "1420";
console.log(`\n=== Pre-computing report for clientId: ${clientId} ===\n`);

buildCompiledReport(clientId, { useCache: false, saveJson: true })
  .then((data) => {
    const sizeMb = (JSON.stringify(data).length / 1024 / 1024).toFixed(2);
    console.log(`✓ File size: ${sizeMb} MB`);
    console.log(`\n=== Complete! ===\n`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error pre-computing report:", error);
    process.exit(1);
  });
