// Simple health check endpoint for testing
// GET /api/health

export default async function handler(req, res) {
  console.log("🔍 Health check endpoint called");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Headers:", req.headers);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const response = {
    status: "ok",
    message: "API is working! 🚀",
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || "development",
    request: {
      method: req.method,
      url: req.url,
      headers: Object.keys(req.headers),
    },
  };

  console.log("✅ Sending response:", response);

  return res.status(200).json(response);
}
