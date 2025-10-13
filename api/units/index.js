// Vercel Serverless Function: GET /api/units
// Returns units (cooling and heating conversion factors)

import { kv } from "@vercel/kv";
import { getUnits } from "../../lib/co-client.js";

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
    console.log(`[Units API] Fetching units...`);

    const cacheKey = `units:all`;
    let data = null;

    // Check cache
    if (isKvAvailable()) {
      console.log(`[Units API] Checking cache...`);
      data = await kv.get(cacheKey);

      if (data) {
        console.log(`[Units API] ✓ Cache hit!`);
        return res.status(200).json({ units: data, cached: true });
      }

      console.log(`[Units API] Cache miss, fetching fresh data`);
    }

    // Fetch units
    const units = await getUnits();
    console.log(
      `[Units API] ✓ Fetched ${units.cool?.length} cooling units, ${units.heat?.length} heating units`
    );

    // Cache for 1 hour (units rarely change)
    if (isKvAvailable()) {
      await kv.set(cacheKey, units, { ex: 3600 });
      console.log(`[Units API] ✓ Cached for 1 hour`);
      res.setHeader(
        "Cache-Control",
        "s-maxage=3600, stale-while-revalidate=7200"
      );
    }

    return res.status(200).json({ units });
  } catch (error) {
    console.error("[Units API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 10,
};
