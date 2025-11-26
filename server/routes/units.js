// Express Route: GET /api/units
// Returns units (cooling and heating conversion factors)

import { Router } from "express";
import * as cache from "../cache.js";
import { getUnits } from "../../lib/co-client.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    console.log(`[Units API] Fetching units...`);

    const cacheKey = `units:all`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Units API] ✓ Cache hit!`);
      return res.status(200).json({ units: cachedData, cached: true });
    }

    console.log(`[Units API] Cache miss, fetching fresh data`);

    // Fetch units
    const units = await getUnits();
    console.log(
      `[Units API] ✓ Fetched ${units.cool?.length} cooling units, ${units.heat?.length} heating units`
    );

    // Cache for 1 hour (units rarely change)
    cache.set(cacheKey, units, { ex: 3600 });
    console.log(`[Units API] ✓ Cached for 1 hour`);

    return res.status(200).json({ units });
  } catch (error) {
    console.error("[Units API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

