// Vercel Serverless Function: GET /api/reports/compiled/[clientId]
// Returns compiled report data

import { kv } from "@vercel/kv";
import {
  actualEnergyUse,
  expectedEnergyUse,
  getDevices,
  getReportDates,
} from "../../../lib/co-client.js";
import { DataAggregationService } from "../../../lib/services/aggregation.js";

const aggregationService = new DataAggregationService();

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

  const { clientId } = req.query;

  try {
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    console.log(`\n=== Starting request for clientId: ${clientId} ===`);

    const cacheKey = `compiled:${clientId}`;
    let data = null;

    // Check Vercel KV cache first (only if available)
    if (isKvAvailable()) {
      console.log(`Checking cache...`);
      data = await kv.get(cacheKey);

      if (data) {
        console.log(`✓ Cache hit! Returning cached data`);
        return res.status(200).json({ ...data, cached: true });
      }

      console.log(`Cache miss, will fetch fresh data`);
    } else {
      console.log(`KV not configured (normal for local dev)`);
    }

    // Fetch data in parallel where possible to speed things up
    console.log(`Fetching devices and dates in parallel...`);
    const [devices, dates] = await Promise.all([
      getDevices(Number(clientId)),
      getReportDates(Number(clientId)),
    ]);
    console.log(`✓ Loaded ${devices.length} devices, ${dates.length} dates`);

    console.log(`Fetching energy data in parallel...`);
    const [energyExpected, energyActual] = await Promise.all([
      expectedEnergyUse(Number(clientId)),
      actualEnergyUse(Number(clientId)),
    ]);
    console.log(`✓ Loaded energy data`);

    console.log(`Aggregating device metrics (this may take a while)...`);
    const startTime = Date.now();
    const deviceMetrics = await aggregationService.aggregateDeviceMetrics(
      devices,
      dates,
      Number(clientId)
    );
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Aggregation complete in ${duration}s`);

    // Build response
    data = {
      meta: {
        clientId: Number(clientId),
        reportsCount: dates.length,
        firstReportDate: dates[0]?.report_date,
        mostRecentDate: dates[dates.length - 1]?.report_date,
        generatedAt: new Date().toISOString(),
      },
      devices: deviceMetrics,
      energy: {
        expected: energyExpected,
        actual: energyActual,
      },
    };

    // Cache for 5 minutes
    if (isKvAvailable()) {
      await kv.set(cacheKey, data, { ex: 300 });
      console.log(`✓ Cached for 5 minutes`);
      res.setHeader(
        "Cache-Control",
        "s-maxage=300, stale-while-revalidate=600"
      );
    }

    console.log(`=== Request complete for clientId: ${clientId} ===\n`);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error in /api/reports/compiled:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

// Vercel function config
export const config = {
  maxDuration: 300, // 5 minutes max (Vercel limit)
  // NOTE: If your data takes longer than 5 minutes to process,
  // you MUST pre-compute it using: node scripts/precompute-reports.js [clientId]
  // Then upload to Vercel KV or serve the JSON file directly
};
