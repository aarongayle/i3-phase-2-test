import { getBuildings } from "../../../campus-optimizer/co-api.js";
import { DEFAULT_HISTORY_FIELDS } from "../../../pelican/history.js";

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

const isKvAvailable = () => {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
};

// Lazy load KV client
async function getKv() {
  if (!isKvAvailable()) return null;
  try {
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch (error) {
    console.warn("[Pelican History API] KV import failed:", error.message);
    return null;
  }
}

/**
 * Convert date to Pelican datetime format (YYYY-MM-DDTHH:mm:ss)
 */
function toPelicanDateTime(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

/**
 * Fetch credentials for a site from buildings
 */
async function getCredentialsForSite(clientId, siteSlug) {
  const buildings = await getBuildings(clientId);

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
 * Call Pelican API to fetch history data
 */
async function fetchPelicanHistory(
  siteSlug,
  username,
  password,
  serialNo,
  date
) {
  // Build date range for single day (start and end of day)
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);
  const startDateTime = toPelicanDateTime(dateObj);

  dateObj.setHours(23, 59, 59, 999);
  const endDateTime = toPelicanDateTime(dateObj);

  // Build transaction
  const selection = {
    startDateTime,
    endDateTime,
    ThermostatSerialNo: [serialNo],
  };
  const transactions = buildHistoryTransaction(
    selection,
    DEFAULT_HISTORY_FIELDS
  );

  // Call Pelican API
  const response = await fetch(
    `https://${siteSlug}.officeclimatecontrol.net/api.cgi`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ username, password, transactions }),
    }
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

  const parsed = await response.json();

  // Extract history entries
  const entries = [];
  const thermostatHistory = parsed?.result?.[0]?.ThermostatHistory;

  if (Array.isArray(thermostatHistory)) {
    for (const entry of thermostatHistory) {
      // Filter by serialNo (case-insensitive)
      const entrySerialNo = String(entry?.serialNo || "")
        .trim()
        .toLowerCase();
      const targetSerialNo = String(serialNo).trim().toLowerCase();

      if (entrySerialNo === targetSerialNo && Array.isArray(entry.History)) {
        // Filter History entries by date
        const dateStr = date; // YYYY-MM-DD format
        for (const historyEntry of entry.History) {
          const timestamp = String(historyEntry?.timestamp || "");
          if (timestamp.startsWith(dateStr)) {
            entries.push(historyEntry);
          }
        }
      }
    }
  }

  // Sort by timestamp
  entries.sort((a, b) => {
    return (a.timestamp || "").localeCompare(b.timestamp || "");
  });

  return entries;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { clientId, siteSlug, serialNo, date } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!siteSlug || !serialNo || !date) {
      return res.status(400).json({
        error:
          "siteSlug, serialNo, and date (YYYY-MM-DD) are required query parameters",
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        error: "date must be in YYYY-MM-DD format",
      });
    }

    console.log(`[Pelican History API] Query:`, {
      clientId,
      siteSlug,
      serialNo,
      date,
    });

    // Check cache (single day = simple cache key)
    const cacheKey = `pelican:history:${clientId}:${siteSlug}:${serialNo}:${date}`;
    let cachedData = null;

    const kv = await getKv();
    if (kv) {
      try {
        cachedData = await kv.get(cacheKey);
        if (cachedData) {
          console.log(`[Pelican History API] ✓ Cache hit!`);
          res.setHeader(
            "Cache-Control",
            "s-maxage=3600, stale-while-revalidate=86400"
          );
          return res.status(200).json({ ...cachedData, cached: true });
        }
      } catch (error) {
        console.warn("[Pelican History API] Cache read error:", error.message);
      }
    }

    // Get credentials for this site
    const { username, password } = await getCredentialsForSite(
      Number(clientId),
      siteSlug
    );

    // Fetch data directly from Pelican API
    let data = [];
    try {
      data = await fetchPelicanHistory(
        siteSlug,
        username,
        password,
        serialNo,
        date
      );
    } catch (error) {
      console.error("[Pelican History API] Fetch error:", error);
      // If it's a "no data" scenario, return empty array instead of error
      if (
        error.message.includes("404") ||
        error.message.includes("not found")
      ) {
        data = [];
      } else {
        throw error;
      }
    }

    const response = {
      data,
      query: {
        clientId,
        siteSlug,
        serialNo,
        date,
      },
      count: data.length,
    };

    // Cache for 1 hour (single day data doesn't change)
    if (kv && data.length > 0) {
      try {
        await kv.set(cacheKey, response, { ex: 3600 });
        console.log(`[Pelican History API] ✓ Cached for 1 hour`);
        res.setHeader(
          "Cache-Control",
          "s-maxage=3600, stale-while-revalidate=86400"
        );
      } catch (error) {
        console.warn("[Pelican History API] Cache write error:", error.message);
      }
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("[Pelican History API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 10, // Single day API call should be fast
};
