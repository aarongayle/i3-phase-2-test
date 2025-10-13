// Vercel Serverless Function: GET /api/schedules/[clientId]/[date]
// Returns optimal schedules for a SINGLE date only
// ONE database query per request

import { kv } from "@vercel/kv";
import { getOptimalSchedules } from "../../../lib/co-client.js";

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
    const { clientId, date } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!date) {
      return res.status(400).json({ error: "date is required" });
    }

    console.log(
      `[Schedules API] Fetching schedules for clientId: ${clientId}, date: ${date}`
    );

    const cacheKey = `schedules:${clientId}:${date}`;

    // Check cache
    if (isKvAvailable()) {
      const data = await kv.get(cacheKey);

      if (data) {
        console.log(`[Schedules API] ✓ Cache hit!`);
        return res.status(200).json({ schedules: data, cached: true });
      }
    }

    // Fetch optimal schedules for this ONE date
    const schedules = await getOptimalSchedules(Number(clientId), date);
    console.log(`[Schedules API] ✓ Fetched ${schedules.length} schedules`);

    // Cache for 5 minutes
    if (isKvAvailable()) {
      await kv.set(cacheKey, schedules, { ex: 300 });
      res.setHeader(
        "Cache-Control",
        "s-maxage=300, stale-while-revalidate=600"
      );
    }

    return res.status(200).json({ schedules });
  } catch (error) {
    console.error("[Schedules API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 30,
};
