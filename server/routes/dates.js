// Express Route: GET /api/dates/:clientId
// Returns report dates for a specific client

import { Router } from "express";
import * as cache from "../cache.js";
import { getReportDates } from "../../lib/co-client.js";

const router = Router();

router.get("/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    console.log(`[Dates API] Fetching dates for clientId: ${clientId}`);

    const cacheKey = `dates:${clientId}`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Dates API] ✓ Cache hit!`);
      return res.status(200).json({ dates: cachedData, cached: true });
    }

    console.log(`[Dates API] Cache miss, fetching fresh data`);

    // Fetch dates
    const dates = await getReportDates(Number(clientId));
    console.log(`[Dates API] ✓ Fetched ${dates.length} dates`);

    // Cache for 5 minutes
    cache.set(cacheKey, dates, { ex: 300 });
    console.log(`[Dates API] ✓ Cached for 5 minutes`);

    return res.status(200).json({ dates });
  } catch (error) {
    console.error("[Dates API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

