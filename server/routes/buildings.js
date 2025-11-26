// Express Route: GET /api/buildings/:clientId
// Returns buildings for a specific client

import { Router } from "express";
import * as cache from "../cache.js";
import { getBuildings } from "../../lib/co-client.js";

const router = Router();

router.get("/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    console.log(`[Buildings API] Fetching buildings for clientId: ${clientId}`);

    const cacheKey = `buildings:${clientId}`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Buildings API] ✓ Cache hit!`);
      return res.status(200).json({ buildings: cachedData, cached: true });
    }

    console.log(`[Buildings API] Cache miss, fetching fresh data`);

    // Fetch buildings
    const buildings = await getBuildings(Number(clientId));
    console.log(`[Buildings API] ✓ Fetched ${buildings.length} buildings`);

    // Cache for 5 minutes
    cache.set(cacheKey, buildings, { ex: 300 });
    console.log(`[Buildings API] ✓ Cached for 5 minutes`);

    return res.status(200).json({ buildings });
  } catch (error) {
    console.error("[Buildings API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

