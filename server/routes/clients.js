// Express Route: GET /api/clients
// Returns all clients from Campus Optimizer

import { Router } from "express";
import * as cache from "../cache.js";
import { getClients } from "../../lib/co-client.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    console.log(`[Clients API] Fetching clients list...`);

    const cacheKey = `clients:all`;

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`[Clients API] ✓ Cache hit!`);
      return res.status(200).json({ clients: cachedData, cached: true });
    }

    console.log(`[Clients API] Cache miss, fetching fresh data`);

    // Fetch clients
    const raw = await getClients();
    const clients = Array.isArray(raw?.clients) ? raw.clients : raw || [];
    console.log(`[Clients API] ✓ Fetched ${clients.length} clients`);

    // Cache for 5 minutes
    cache.set(cacheKey, clients, { ex: 300 });
    console.log(`[Clients API] ✓ Cached for 5 minutes`);

    return res.status(200).json({ clients });
  } catch (error) {
    console.error("[Clients API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;


