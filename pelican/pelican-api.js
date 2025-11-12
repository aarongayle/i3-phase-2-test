import path from "node:path";
import { getBuildings } from "../campus-optimizer/co-api.js";
import { fetchThermostatHistory } from "./history.js";
import {
  loadMetadata,
  saveMetadata,
  updateMetadataForEntry,
} from "./metadata.js";

async function main() {
  const clientId = 1420;
  const buildings = await getBuildings(clientId);

  // Define the date range once for all devices
  const startDateTime = "2025-08-30";
  const endDateTime = "2025-08-31";

  const streamOutputDir = path.join(
    process.cwd(),
    "pelican",
    "data",
    "history-stream"
  );

  // Load existing metadata or create new
  const metadata = await loadMetadata(streamOutputDir);

  // Build unique list of Pelican subdomains with credentials from buildings
  const seen = new Set();
  const sites = [];
  for (const b of buildings) {
    const siteSlug = String(b?.PelicanSubdomain || "").trim();
    if (!siteSlug || seen.has(siteSlug)) continue;
    seen.add(siteSlug);
    sites.push({
      siteSlug,
      username: String(b?.PelicanUsername || "").trim(),
      password: String(b?.PelicanPassword || "").trim(),
    });
  }

  for (const [index, site] of sites.entries()) {
    console.log(`${index + 1}/${sites.length} fetching site ${site.siteSlug}`);
    console.log("Resolved credentials", {
      siteSlug: site.siteSlug,
      username: site.username,
      password: site.password ? "[REDACTED]" : "",
    });
    console.log(
      `Starting fetch for site ${site.siteSlug} between ${startDateTime} and ${endDateTime}`
    );
    const fetchStartedAt = Date.now();

    const result = await fetchThermostatHistory({
      siteSlug: site.siteSlug,
      startDateTime,
      endDateTime,
      username: site.username,
      password: site.password,
      streamOutputDir,
      useDateOrganization: true, // Use new date-organized structure
      onEntryWritten: async ({
        siteSlug,
        serialNo,
        date,
        entryCount,
        filePath,
      }) => {
        // Update metadata index as files are written
        updateMetadataForEntry(metadata, {
          siteSlug,
          serialNo,
          date,
          entryCount,
          filePath,
          baseDir: streamOutputDir,
        });
      },
    });

    console.log(
      `Completed fetch for site ${site.siteSlug} in ${(
        (Date.now() - fetchStartedAt) /
        1000
      ).toFixed(2)}s`,
      {
        entriesProcessed: result.entriesProcessed,
        rangesProcessed: result.rangesProcessed,
      }
    );
  }

  // Save metadata index
  console.log("Saving metadata index...");
  await saveMetadata(streamOutputDir, metadata);
  console.log("Metadata index saved successfully");

  console.log("\n=== Collection Complete ===");
  console.log(`Processed ${sites.length} sites`);
  console.log(
    `Metadata saved to: ${path.join(streamOutputDir, "metadata.json")}`
  );
}

main();
