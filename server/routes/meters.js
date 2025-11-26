// Express Route: GET /api/meters/:clientId
// Returns meters list for a specific client

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

    console.log(`[Meters API] Fetching meters for clientId: ${clientId}`);

    const cacheKey = `meters:${clientId}`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Meters API] ✓ Cache hit!`);
      return res.status(200).json({ meters: cachedData, cached: true });
    }

    // Fetch meters
    const url = `${uri}/project/meters?client=${clientId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `${process.env.CO_MASTER_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch meters: ${response.status} ${response.statusText}`
      );
    }

    const meters = await response.json();
    console.log(`[Meters API] ✓ Fetched ${meters.length} meters`);

    // Cache for 5 minutes
    cache.set(cacheKey, meters, { ex: 300 });

    return res.status(200).json({ meters });
  } catch (error) {
    console.error("[Meters API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

