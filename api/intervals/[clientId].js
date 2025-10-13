// Vercel Serverless Function: GET /api/intervals/[clientId]
// Returns trend interval data for a specific client
// ONE database query per request

import { kv } from "@vercel/kv";

const uri = `https://${process.env.CO_ENVIRONMENT}.idealimpactinc.com/api`;

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

    console.log(`[Intervals API] Fetching intervals for clientId: ${clientId}`);

    const cacheKey = `intervals:${clientId}`;

    // Check cache
    if (isKvAvailable()) {
      const data = await kv.get(cacheKey);

      if (data) {
        console.log(`[Intervals API] ✓ Cache hit!`);
        return res.status(200).json({ intervals: data, cached: true });
      }
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
    if (isKvAvailable()) {
      await kv.set(cacheKey, intervals, { ex: 300 });
      res.setHeader(
        "Cache-Control",
        "s-maxage=300, stale-while-revalidate=600"
      );
    }

    return res.status(200).json({ intervals });
  } catch (error) {
    console.error("[Intervals API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 60,
};
