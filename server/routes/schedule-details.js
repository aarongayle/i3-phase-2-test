// Express Route: GET /api/schedule-details/:clientId/:date
// Returns schedule details for a specific date

import { Router } from "express";
import * as cache from "../cache.js";

const router = Router();

const uri = `https://${process.env.CO_ENVIRONMENT}.idealimpactinc.com/api`;

router.get("/:clientId/:date", async (req, res) => {
  try {
    const { clientId, date } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!date) {
      return res.status(400).json({ error: "date is required" });
    }

    console.log(
      `[Schedule Details API] Fetching schedule details for clientId: ${clientId}, date: ${date}`
    );

    const cacheKey = `schedule-details:${clientId}:${date}`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Schedule Details API] ✓ Cache hit!`);
      return res
        .status(200)
        .json({ scheduleDetails: cachedData, cached: true });
    }

    // Fetch schedule details for this ONE date
    const url = `${uri}/schedule-details?client=${clientId}&date=${date}`;
    console.log(`[Schedule Details API] Fetching from URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        Authorization: `${process.env.CO_MASTER_KEY}`,
      },
    });

    if (!response.ok) {
      console.error(
        `[Schedule Details API] ✗ HTTP ${response.status}: ${response.statusText}`
      );
      throw new Error(
        `Failed to fetch schedule details: ${response.status} ${response.statusText}`
      );
    }

    const bodyText = await response.text();
    console.log(
      `[Schedule Details API] Response body length: ${bodyText.length} chars`
    );
    console.log(
      `[Schedule Details API] Response body preview: ${bodyText.substring(
        0,
        200
      )}`
    );

    // Handle "no schedule" or empty response
    if (bodyText === "no schedule" || bodyText === "" || bodyText === "null") {
      console.log(
        `[Schedule Details API] ✓ No schedule details for date ${date}, returning empty array`
      );
      return res.status(200).json({ scheduleDetails: [] });
    }

    const scheduleDetails = JSON.parse(bodyText);
    console.log(
      `[Schedule Details API] ✓ Fetched ${scheduleDetails.length} schedule detail rows`
    );

    if (scheduleDetails.length > 0) {
      console.log(
        `[Schedule Details API] First row sample:`,
        JSON.stringify(scheduleDetails[0]).substring(0, 200)
      );
    }

    // Cache for 1 hour (historical data doesn't change)
    cache.set(cacheKey, scheduleDetails, { ex: 3600 });

    return res.status(200).json({ scheduleDetails });
  } catch (error) {
    console.error("[Schedule Details API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

