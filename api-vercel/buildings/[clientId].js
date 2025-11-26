// Vercel Serverless Function: GET /api/buildings/[clientId]
// Returns buildings for a specific client

import { kv } from "@vercel/kv";
import { getBuildings } from "../../lib/co-client.js";

// Check if KV is available (has required env vars)
const isKvAvailable = () => {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    console.log(`[Buildings API] Fetching buildings for clientId: ${clientId}`);

    const cacheKey = `buildings:${clientId}`;
    let data = null;

    // Check cache
    if (isKvAvailable()) {
      console.log(`[Buildings API] Checking cache...`);
      data = await kv.get(cacheKey);

      if (data) {
        console.log(`[Buildings API] ✓ Cache hit!`);
        return res.status(200).json({ buildings: data, cached: true });
      }

      console.log(`[Buildings API] Cache miss, fetching fresh data`);
    }

    // Fetch buildings
    const buildings = await getBuildings(Number(clientId));
    console.log(`[Buildings API] ✓ Fetched ${buildings.length} buildings`);

    // Cache for 5 minutes
    if (isKvAvailable()) {
      await kv.set(cacheKey, buildings, { ex: 300 });
      console.log(`[Buildings API] ✓ Cached for 5 minutes`);
      res.setHeader(
        "Cache-Control",
        "s-maxage=300, stale-while-revalidate=600"
      );
    }

    return res.status(200).json({ buildings });
  } catch (error) {
    console.error("[Buildings API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 20,
};

