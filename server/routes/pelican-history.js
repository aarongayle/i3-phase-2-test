// Express Route: GET /api/pelican/history/:clientId
// Returns ALL thermostat history for a site/date in a single response.
// The Pelican API always returns all thermostats, so we pass them all to the client.

import { Router } from "express";
import { getBuildings } from "../../campus-optimizer/co-api.js";
import { DEFAULT_HISTORY_FIELDS } from "../../pelican/history.js";

const router = Router();

// History value template (matching pelican/history.js)
const HISTORY_VALUE_TEMPLATE = Object.freeze({
  timestamp: "",
  name: "",
  groupName: "",
  serialNo: "",
  system: "",
  heatSetting: "",
  coolSetting: "",
  fan: "",
  status: "",
  temperature: "",
  humidity: "",
  humidifySetting: "",
  dehumidifySetting: "",
  co2Setting: "",
  co2Level: "",
  setBy: "",
  frontKeypad: "",
  runStatus: "",
  auxStatus: "",
  slaves: "",
  setback: "",
});

/**
 * Build history transaction for Pelican API
 */
function buildHistoryTransaction(selection, fields) {
  let value;
  if (Array.isArray(fields) && fields.length > 0) {
    value = Object.fromEntries(
      fields.map((field) => [field, HISTORY_VALUE_TEMPLATE[field] ?? ""])
    );
  } else {
    value = { ...HISTORY_VALUE_TEMPLATE };
  }
  return [
    {
      request: "get",
      object: "ThermostatHistory",
      selection,
      value,
    },
  ];
}

/**
 * Convert date to Pelican datetime format (YYYY-MM-DDTHH:mm:ss)
 */
function toPelicanDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Parse a YYYY-MM-DD date string as local midnight (not UTC)
 */
function parseLocalDate(dateStr) {
  // Parse as local date by using the Date constructor with explicit parts
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed
}

/**
 * Fetch credentials for a site from buildings
 */
async function getCredentialsForSite(clientId, siteSlug) {
  const startTime = Date.now();
  console.log(
    `[Pelican History API] ⏱️ Fetching buildings for client ${clientId}...`
  );

  const buildings = await getBuildings(clientId);

  const buildingsFetchTime = Date.now() - startTime;
  console.log(
    `[Pelican History API] ⏱️ Buildings fetch completed in ${buildingsFetchTime}ms (${
      buildings?.length || 0
    } buildings)`
  );

  // Find building with matching PelicanSubdomain
  const building = buildings.find(
    (b) =>
      String(b?.PelicanSubdomain || "")
        .trim()
        .toLowerCase() === siteSlug.toLowerCase()
  );

  if (!building) {
    throw new Error(`No building found for siteSlug: ${siteSlug}`);
  }

  const username = String(building?.PelicanUsername || "").trim();
  const password = String(building?.PelicanPassword || "").trim();

  if (!username || !password) {
    throw new Error(`Missing credentials for siteSlug: ${siteSlug}`);
  }

  return { username, password };
}

/**
 * Fetch ALL thermostat history for a site/date using streaming.
 * Returns a Map of serialNo -> history entries (already filtered by date).
 */
async function fetchAllThermostatsForSiteDate(
  siteSlug,
  username,
  password,
  date
) {
  const overallStart = Date.now();

  // Build date range for single day (start and end of day)
  // Use parseLocalDate to avoid timezone issues with new Date("YYYY-MM-DD")
  const startDate = parseLocalDate(date);
  startDate.setHours(0, 0, 0, 0);
  const startDateTime = toPelicanDateTime(startDate);

  const endDate = parseLocalDate(date);
  endDate.setHours(23, 59, 59, 999);
  const endDateTime = toPelicanDateTime(endDate);

  // Build transaction - NO serial filter, we want everything
  const selection = {
    startDateTime,
    endDateTime,
  };
  const transactions = buildHistoryTransaction(
    selection,
    DEFAULT_HISTORY_FIELDS
  );

  console.log(`[Pelican History API] 🔍 DEBUG: Requesting date range:`, {
    requestedDate: date,
    startDateTime,
    endDateTime,
  });

  const pelicanUrl = `https://${siteSlug}.officeclimatecontrol.net/api.cgi`;
  const requestBody = JSON.stringify({ username, password, transactions });

  console.log(
    `[Pelican History API] ⏱️ Making Pelican API request to ${pelicanUrl}`
  );
  console.log(
    `[Pelican History API] ⏱️ Request body size: ${requestBody.length} bytes`
  );

  const fetchStart = Date.now();

  // Call Pelican API
  const response = await fetch(pelicanUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: requestBody,
  });

  const fetchTime = Date.now() - fetchStart;
  console.log(
    `[Pelican History API] ⏱️ Pelican API response received in ${fetchTime}ms (status: ${response.status})`
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Pelican request failed (${response.status}): ${details.slice(
        0,
        200
      )}`.trim()
    );
  }

  // Use streaming to read the response
  const streamStart = Date.now();
  const reader = response.body?.getReader();

  if (!reader) {
    // Fallback to non-streaming if reader not available
    console.log(
      `[Pelican History API] ⏱️ Streaming not available, falling back to buffered read`
    );
    const responseText = await response.text();
    const parsed = JSON.parse(responseText);
    return processFullResponse(parsed, date, overallStart);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  let chunkCount = 0;

  console.log(`[Pelican History API] ⏱️ Starting streaming read...`);

  // Read all chunks and accumulate
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    totalBytes += value?.length || 0;
    chunkCount++;
    buffer += decoder.decode(value, { stream: true });

    // Log progress every 1MB
    if (chunkCount === 1 || totalBytes % (1024 * 1024) < (value?.length || 0)) {
      const elapsed = Date.now() - streamStart;
      const mbReceived = (totalBytes / 1024 / 1024).toFixed(2);
      const mbps =
        elapsed > 0
          ? (totalBytes / 1024 / 1024 / (elapsed / 1000)).toFixed(2)
          : 0;
      console.log(
        `[Pelican History API] ⏱️ Streaming: ${mbReceived}MB received (${mbps} MB/s, ${chunkCount} chunks)`
      );
    }
  }

  // Flush decoder
  buffer += decoder.decode();

  const streamTime = Date.now() - streamStart;
  console.log(
    `[Pelican History API] ⏱️ Streaming complete: ${(
      totalBytes /
      1024 /
      1024
    ).toFixed(2)}MB in ${streamTime}ms`
  );

  // Parse JSON
  const parseStart = Date.now();
  const parsed = JSON.parse(buffer);
  const parseTime = Date.now() - parseStart;
  console.log(`[Pelican History API] ⏱️ JSON parsed in ${parseTime}ms`);

  return processFullResponse(parsed, date, overallStart);
}

/**
 * Process the full Pelican response and extract all thermostats' history.
 * Returns an array of { serialNo, entries } for all thermostats.
 */
function processFullResponse(parsed, date, overallStart) {
  const processStart = Date.now();
  const thermostats = [];
  const thermostatHistory = parsed?.result?.[0]?.ThermostatHistory;

  if (Array.isArray(thermostatHistory)) {
    console.log(
      `[Pelican History API] ⏱️ Processing ${thermostatHistory.length} thermostat(s) from response`
    );

    for (const entry of thermostatHistory) {
      const serialNo = String(entry?.serialNo || "").trim();
      if (!serialNo || !Array.isArray(entry.History)) continue;

      // Filter History entries by date and collect
      const entries = [];
      for (const historyEntry of entry.History) {
        const timestamp = String(historyEntry?.timestamp || "");
        if (timestamp.startsWith(date)) {
          entries.push(historyEntry);
        }
      }

      // Sort by timestamp
      entries.sort((a, b) =>
        (a.timestamp || "").localeCompare(b.timestamp || "")
      );

      thermostats.push({
        serialNo,
        entries,
        entryCount: entries.length,
      });
    }
  }

  const processTime = Date.now() - processStart;
  const totalTime = Date.now() - overallStart;

  const totalEntries = thermostats.reduce((sum, t) => sum + t.entryCount, 0);

  console.log(
    `[Pelican History API] ⏱️ Processed ${thermostats.length} thermostats with ${totalEntries} total entries in ${processTime}ms`
  );
  console.log(
    `[Pelican History API] ⏱️ Total fetchAllThermostats time: ${totalTime}ms`
  );

  return thermostats;
}

router.get("/:clientId", async (req, res) => {
  const requestStart = Date.now();

  try {
    const { clientId } = req.params;
    const { siteSlug, date } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!siteSlug || !date) {
      return res.status(400).json({
        error: "siteSlug and date (YYYY-MM-DD) are required query parameters",
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        error: "date must be in YYYY-MM-DD format",
      });
    }

    console.log(`\n[Pelican History API] ========== NEW REQUEST ==========`);
    console.log(`[Pelican History API] Query:`, { clientId, siteSlug, date });

    // Get credentials for this site
    const { username, password } = await getCredentialsForSite(
      Number(clientId),
      siteSlug
    );

    // Fetch ALL thermostats for this site/date
    const thermostats = await fetchAllThermostatsForSiteDate(
      siteSlug,
      username,
      password,
      date
    );

    const totalEntries = thermostats.reduce((sum, t) => sum + t.entryCount, 0);

    const responseData = {
      thermostats,
      query: { clientId, siteSlug, date },
      thermostatCount: thermostats.length,
      totalEntries,
    };

    const totalTime = Date.now() - requestStart;
    console.log(`[Pelican History API] ========== REQUEST COMPLETE ==========`);
    console.log(`[Pelican History API] ⏱️ TOTAL REQUEST TIME: ${totalTime}ms`);
    console.log(
      `[Pelican History API] ⏱️ Returned ${thermostats.length} thermostats with ${totalEntries} entries`
    );
    console.log(
      `[Pelican History API] ===========================================\n`
    );

    return res.status(200).json(responseData);
  } catch (error) {
    const totalTime = Date.now() - requestStart;
    console.error(`[Pelican History API] Error after ${totalTime}ms:`, error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;
