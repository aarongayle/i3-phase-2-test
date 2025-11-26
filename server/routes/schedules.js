// Express Route: GET /api/schedules/:clientId/:date
// Returns optimal schedules for a specific date

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
      `[Schedules API] Fetching schedules for clientId: ${clientId}, date: ${date}`
    );

    const cacheKey = `schedules:${clientId}:${date}`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Schedules API] ✓ Cache hit!`);
      return res.status(200).json({ schedules: cachedData, cached: true });
    }

    // Fetch optimal schedules for this ONE date
    const url = `${uri}/optimal-schedules?client=${clientId}&date=${date}`;
    console.log(`[Schedules API] Fetching from URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        Authorization: `${process.env.CO_MASTER_KEY}`,
      },
    });

    if (!response.ok) {
      console.error(
        `[Schedules API] ✗ HTTP ${response.status}: ${response.statusText}`
      );
      throw new Error(
        `Failed to fetch schedules: ${response.status} ${response.statusText}`
      );
    }

    const bodyText = await response.text();
    console.log(
      `[Schedules API] Response body length: ${bodyText.length} chars`
    );

    // Handle "no schedule" or empty response
    if (bodyText === "no schedule" || bodyText === "" || bodyText === "null") {
      console.log(
        `[Schedules API] ✓ No schedules for date ${date}, returning empty array`
      );
      return res.status(200).json({ schedules: [] });
    }

    const schedules = JSON.parse(bodyText);
    console.log(`[Schedules API] ✓ Fetched ${schedules.length} schedules`);

    // Cache for 1 hour (historical data doesn't change)
    cache.set(cacheKey, schedules, { ex: 3600 });

    return res.status(200).json({ schedules });
  } catch (error) {
    console.error("[Schedules API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

