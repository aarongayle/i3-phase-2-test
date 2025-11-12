// Vercel Serverless Function: GET /api/schedule-details/[clientId]/[date]
// Returns schedule details for a SINGLE date only
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
    const { clientId, date } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!date) {
      return res.status(400).json({ error: "date is required" });
    }

    console.log(
      `[Schedule Details API] Fetching schedule details for clientId: ${clientId}, date: ${date}`
    );

    const cacheKey = `schedule-details:${clientId}:${date}`;

    // Check cache
    if (isKvAvailable()) {
      const data = await kv.get(cacheKey);

      if (data) {
        console.log(`[Schedule Details API] ✓ Cache hit!`);
        return res.status(200).json({ scheduleDetails: data, cached: true });
      }
    }

    // Fetch schedule details for this ONE date
    const url = `${uri}/schedule-details?client=${clientId}&date=${date}`;
    console.log(`[Schedule Details API] Fetching from URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        Authorization: `${process.env.CO_MASTER_KEY}`,
      },
    });

    if (!response.ok) {
      console.error(
        `[Schedule Details API] ✗ HTTP ${response.status}: ${response.statusText}`
      );
      throw new Error(
        `Failed to fetch schedule details: ${response.status} ${response.statusText}`
      );
    }

    const bodyText = await response.text();
    console.log(
      `[Schedule Details API] Response body length: ${bodyText.length} chars`
    );
    console.log(
      `[Schedule Details API] Response body preview: ${bodyText.substring(
        0,
        200
      )}`
    );

    // Handle "no schedule" or empty response
    if (bodyText === "no schedule" || bodyText === "" || bodyText === "null") {
      console.log(
        `[Schedule Details API] ✓ No schedule details for date ${date}, returning empty array`
      );
      return res.status(200).json({ scheduleDetails: [] });
    }

    const scheduleDetails = JSON.parse(bodyText);
    console.log(
      `[Schedule Details API] ✓ Fetched ${scheduleDetails.length} schedule detail rows`
    );

    if (scheduleDetails.length > 0) {
      console.log(
        `[Schedule Details API] First row sample:`,
        JSON.stringify(scheduleDetails[0]).substring(0, 200)
      );
    }

    // Cache for 1 hour (historical data doesn't change)
    if (isKvAvailable()) {
      await kv.set(cacheKey, scheduleDetails, { ex: 3600 });
      res.setHeader(
        "Cache-Control",
        "s-maxage=3600, stale-while-revalidate=7200"
      );
    }

    return res.status(200).json({ scheduleDetails });
  } catch (error) {
    console.error("[Schedule Details API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 30,
};
