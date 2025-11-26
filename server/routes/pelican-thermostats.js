// Express Route: GET /api/pelican/thermostats/:clientId
// Discover all thermostats for a site by querying Pelican API

import { Router } from "express";
import { getBuildings } from "../../campus-optimizer/co-api.js";
import { DEFAULT_HISTORY_FIELDS } from "../../pelican/history.js";

const router = Router();

/**
 * Build history transaction for Pelican API (without serialNo filter to discover all thermostats)
 */
function buildDiscoveryTransaction(selection, fields) {
  let value;
  if (Array.isArray(fields) && fields.length > 0) {
    value = Object.fromEntries(fields.map((field) => [field, ""]));
  } else {
    value = Object.fromEntries(
      DEFAULT_HISTORY_FIELDS.map((field) => [field, ""])
    );
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
 * Discover all thermostats for a site by querying Pelican API
 */
async function discoverThermostats(siteSlug, username, password, date) {
  // Use a single day query to discover thermostats
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);
  const startDateTime = toPelicanDateTime(dateObj);

  dateObj.setHours(23, 59, 59, 999);
  const endDateTime = toPelicanDateTime(dateObj);

  // Build transaction without serialNo filter
  const selection = {
    startDateTime,
    endDateTime,
    // No ThermostatSerialNo filter - this will return all thermostats
  };
  const transactions = buildDiscoveryTransaction(
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

  // Extract unique serial numbers from response
  const serialNos = new Set();
  const thermostatHistory = parsed?.result?.[0]?.ThermostatHistory;

  if (Array.isArray(thermostatHistory)) {
    for (const entry of thermostatHistory) {
      const serialNo = String(entry?.serialNo || "").trim();
      if (serialNo) {
        serialNos.add(serialNo);
      }
    }
  }

  return Array.from(serialNos);
}

router.get("/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { siteSlug, date } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!siteSlug) {
      return res.status(400).json({
        error: "siteSlug is required",
      });
    }

    // Use today's date if not provided
    const queryDate = date || new Date().toISOString().split("T")[0];

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(queryDate)) {
      return res.status(400).json({
        error: "date must be in YYYY-MM-DD format",
      });
    }

    console.log(`[Pelican Thermostats API] Discovering thermostats for:`, {
      clientId,
      siteSlug,
      date: queryDate,
    });

    // Get credentials for this site
    const { username, password } = await getCredentialsForSite(
      Number(clientId),
      siteSlug
    );

    // Discover thermostats
    const serialNos = await discoverThermostats(
      siteSlug,
      username,
      password,
      queryDate
    );

    console.log(
      `[Pelican Thermostats API] Found ${serialNos.length} thermostats for ${siteSlug}`
    );

    return res.status(200).json({
      siteSlug,
      serialNos,
      count: serialNos.length,
      date: queryDate,
    });
  } catch (error) {
    console.error("[Pelican Thermostats API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

