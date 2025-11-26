// Express Route: GET /api/intervals/:clientId
// Returns trend interval data for a specific client

import { Router } from "express";
import * as cache from "../cache.js";

const router = Router();

const uri = `https://${process.env.CO_ENVIRONMENT}.idealimpactinc.com/api`;

router.get("/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    console.log(`[Intervals API] Fetching intervals for clientId: ${clientId}`);

    const cacheKey = `intervals:${clientId}`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Intervals API] ✓ Cache hit!`);
      return res.status(200).json({ intervals: cachedData, cached: true });
    }

    // Fetch trend intervals
    const url = `${uri}/trends/interval?client=${clientId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `${process.env.CO_MASTER_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch intervals: ${response.status} ${response.statusText}`
      );
    }

    const intervals = await response.json();
    console.log(`[Intervals API] ✓ Fetched interval data`);

    // Cache for 5 minutes
    cache.set(cacheKey, intervals, { ex: 300 });

    return res.status(200).json({ intervals });
  } catch (error) {
    console.error("[Intervals API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

