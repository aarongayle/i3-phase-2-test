// Express Route: GET /api/devices/:clientId
// Returns devices for a specific client

import { Router } from "express";
import * as cache from "../cache.js";
import { getDevices } from "../../lib/co-client.js";

const router = Router();

router.get("/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    console.log(`[Devices API] Fetching devices for clientId: ${clientId}`);

    const cacheKey = `devices:${clientId}`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Devices API] ✓ Cache hit!`);
      return res.status(200).json({ devices: cachedData, cached: true });
    }

    console.log(`[Devices API] Cache miss, fetching fresh data`);

    // Fetch devices
    const devices = await getDevices(Number(clientId));
    console.log(`[Devices API] ✓ Fetched ${devices.length} devices`);

    // Cache for 5 minutes
    cache.set(cacheKey, devices, { ex: 300 });
    console.log(`[Devices API] ✓ Cached for 5 minutes`);

    return res.status(200).json({ devices });
  } catch (error) {
    console.error("[Devices API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;

