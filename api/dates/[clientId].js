// Vercel Serverless Function: GET /api/dates/[clientId]
// Returns report dates for a specific client

import { kv } from "@vercel/kv";
import { getReportDates } from "../../lib/co-client.js";

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

    console.log(`[Dates API] Fetching dates for clientId: ${clientId}`);

    const cacheKey = `dates:${clientId}`;
    let data = null;

    // Check cache
    if (isKvAvailable()) {
      console.log(`[Dates API] Checking cache...`);
      data = await kv.get(cacheKey);

      if (data) {
        console.log(`[Dates API] ✓ Cache hit!`);
        return res.status(200).json({ dates: data, cached: true });
      }

      console.log(`[Dates API] Cache miss, fetching fresh data`);
    }

    // Fetch dates
    const dates = await getReportDates(Number(clientId));
    console.log(`[Dates API] ✓ Fetched ${dates.length} dates`);

    // Cache for 5 minutes
    if (isKvAvailable()) {
      await kv.set(cacheKey, dates, { ex: 300 });
      console.log(`[Dates API] ✓ Cached for 5 minutes`);
      res.setHeader(
        "Cache-Control",
        "s-maxage=300, stale-while-revalidate=600"
      );
    }

    return res.status(200).json({ dates });
  } catch (error) {
    console.error("[Dates API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 20,
};
