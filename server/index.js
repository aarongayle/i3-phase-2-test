// Express.js API Server for Coolify Deployment
// Replaces Vercel serverless functions with a standalone Express server
//
// Required Environment Variables:
//   CO_ENVIRONMENT - Campus Optimizer environment (e.g., "portal")
//   CO_MASTER_KEY  - API authorization key
//
// Optional Environment Variables:
//   PORT           - Server port (default: 3001)
//   NODE_ENV       - "production" to serve static frontend files

import dotenv from "dotenv";
import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from project root .env file
dotenv.config({ path: join(__dirname, "..", ".env") });
//test environment variables

// Import route handlers
import * as cache from "./cache.js";
import buildingsRouter from "./routes/buildings.js";
import datesRouter from "./routes/dates.js";
import devicesRouter from "./routes/devices.js";
import intervalsRouter from "./routes/intervals.js";
import metersRouter from "./routes/meters.js";
import pelicanHistoryRouter from "./routes/pelican-history.js";
import pelicanThermostatsRouter from "./routes/pelican-thermostats.js";
import scheduleDetailsRouter from "./routes/schedule-details.js";
import schedulesRouter from "./routes/schedules.js";
import unitsRouter from "./routes/units.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${
        res.statusCode
      } (${duration}ms)`
    );
  });
  next();
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  const cacheStats = cache.stats();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.CO_ENVIRONMENT || "unknown",
    cache: cacheStats,
  });
});

// Mount API routes
app.use("/api/buildings", buildingsRouter);
app.use("/api/dates", datesRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/intervals", intervalsRouter);
app.use("/api/meters", metersRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/schedule-details", scheduleDetailsRouter);
app.use("/api/units", unitsRouter);
app.use("/api/pelican/thermostats", pelicanThermostatsRouter);
app.use("/api/pelican/history", pelicanHistoryRouter);

// 404 handler for API routes
app.use("/api/*path", (req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.originalUrl,
  });
});

// In production, serve the static frontend files
if (process.env.NODE_ENV === "production") {
  const distPath = join(__dirname, "..", "dist");

  // Serve static files
  app.use(express.static(distPath));

  // For SPA routing - serve index.html for all non-API routes
  app.get("*", (req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });

  console.log(`[Server] Serving static files from: ${distPath}`);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("[Server Error]", err);
  res.status(500).json({
    error: err.message || "Internal server error",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Campus Optimizer API Server                           ║
║                                                            ║
║   Server running on port ${PORT}                              ║
║   Environment: ${(process.env.CO_ENVIRONMENT || "unknown").padEnd(38)}║
║                                                            ║
║   API Endpoints:                                           ║
║   - GET /api/health                                        ║
║   - GET /api/buildings/:clientId                           ║
║   - GET /api/dates/:clientId                               ║
║   - GET /api/devices/:clientId                             ║
║   - GET /api/intervals/:clientId                           ║
║   - GET /api/meters/:clientId                              ║
║   - GET /api/schedules/:clientId/:date                     ║
║   - GET /api/schedule-details/:clientId/:date              ║
║   - GET /api/units                                         ║
║   - GET /api/pelican/thermostats/:clientId                 ║
   ║   - GET /api/pelican/history/:clientId                     ║
   ║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

export default app;
