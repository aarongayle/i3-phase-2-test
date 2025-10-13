// Vercel Serverless Function: GET /api/analytics/runtime-top/[clientId]
// Returns top N devices by average runtime

import { kv } from "@vercel/kv";
import { getDevices, getReportDates } from "../../../../lib/co-client.js";
import { DataAggregationService } from "../../../../lib/services/aggregation.js";

const aggregationService = new DataAggregationService();

// Check if KV is available (has required env vars)
const isKvAvailable = () => {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
};

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { clientId } = req.query;
    const limit = req.query.limit ? Number(req.query.limit) : 10;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    console.log(
      `\n=== [1/5] Starting runtime-top request for clientId: ${clientId}, limit: ${limit} ===`
    );

    const cacheKey = `top-runtime:${clientId}:${limit}`;
    let data = null;

    // Check cache
    console.log(`[2/5] Checking cache availability...`);
    if (isKvAvailable()) {
      console.log(`[2/5] KV available, checking cache for key: ${cacheKey}`);
      data = await kv.get(cacheKey);

      if (data) {
        console.log(`[2/5] ✓ Cache hit! Returning cached data`);
        return res.status(200).json({ ...data, cached: true });
      }

      console.log(`[2/5] Cache miss, will fetch fresh data`);
    } else {
      console.log(
        `[2/5] KV not configured, skipping cache (normal for local dev)`
      );
    }

    // Fetch data
    console.log(`[3/5] Fetching devices and report dates...`);
    const [devices, dates] = await Promise.all([
      getDevices(Number(clientId)),
      getReportDates(Number(clientId)),
    ]);
    console.log(
      `[3/5] ✓ Fetched ${devices.length} devices, ${dates.length} report dates`
    );

    console.log(`[4/5] Aggregating and sorting device metrics...`);
    const deviceMetrics = await aggregationService.aggregateDeviceMetrics(
      devices,
      dates,
      Number(clientId)
    );

    const topDevices = deviceMetrics
      .sort((a, b) => (b.runtimeAvgMin || 0) - (a.runtimeAvgMin || 0))
      .slice(0, limit);
    console.log(`[4/5] ✓ Found top ${topDevices.length} devices by runtime`);

    data = {
      devices: topDevices,
      limit,
    };

    // Cache for 5 minutes
    console.log(`[5/5] Caching result...`);
    if (isKvAvailable()) {
      await kv.set(cacheKey, data, { ex: 300 });
      console.log(`[5/5] ✓ Cached for 5 minutes`);
      res.setHeader(
        "Cache-Control",
        "s-maxage=300, stale-while-revalidate=600"
      );
    } else {
      console.log(`[5/5] Skipping cache (KV not configured)`);
    }

    console.log(`=== Request complete for clientId: ${clientId} ===\n`);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error in /api/analytics/runtime-top:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 20,
};
