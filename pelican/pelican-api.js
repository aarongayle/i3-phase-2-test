import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getBuildings } from "../campus-optimizer/co-api.js";
import { fetchThermostatHistory } from "./history.js";

async function main() {
  const clientId = 1420;
  const buildings = await getBuildings(clientId);
  const results = [];

  // Define the date range once for all devices
  const startDateTime = "2025-08-30";
  const endDateTime = "2025-08-31";

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
    const history = await fetchThermostatHistory({
      siteSlug: site.siteSlug,
      startDateTime,
      endDateTime,
      username: site.username,
      password: site.password,
      // Stream each history entry to disk as it is parsed
      streamOutputDir: path.join(
        process.cwd(),
        "pelican",
        "data",
        "history-stream"
      ),
    });
    console.log(
      `Completed fetch for site ${site.siteSlug} in ${(
        (Date.now() - fetchStartedAt) /
        1000
      ).toFixed(2)}s`
    );

    results.push({
      siteSlug: site.siteSlug,
      thermostats: history,
    });
  }

  const dataDir = path.resolve(process.cwd(), "pelican", "data");
  await mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, "thermostat-history.json");
  const payload = {
    clientId,
    startDateTime,
    endDateTime,
    retrievedAt: new Date().toISOString(),
    thermostats: results,
  };

  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

main();
