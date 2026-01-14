import express from "express";
import fs from "node:fs";
import path from "node:path";
import { generateHeadlessReportImage } from "../services/headless-report.js";

const router = express.Router();

// Serve generated report images
router.get("/:clientId/headless/image/:filename", (req, res) => {
  const { clientId, filename } = req.params;

  // Security: only allow specific filename patterns
  if (!/^report-[\w.-]+\.(png|jpeg)$/.test(filename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  const imagePath = path.resolve(
    `./campus-optimizer/reports/headless/${filename}`
  );

  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: "Image not found" });
  }

  const ext = path.extname(filename).slice(1);
  const mimeType = ext === "jpeg" ? "image/jpeg" : "image/png";

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(imagePath);
});

function normalizeFormat(format) {
  const fmt = String(format || "png").toLowerCase();
  return fmt === "jpeg" || fmt === "jpg" ? "jpeg" : "png";
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return fallback;
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.post("/:clientId/headless", async (req, res, next) => {
  // Headless report generation can take several minutes; disable request timeout
  req.setTimeout(0);

  try {
    const { clientId } = req.params;
    const {
      format = "png",
      width = 1400,
      height = 900,
      saveHtml = true,
      useCache = true,
      outDir,
    } = req.body || {};

    const result = await generateHeadlessReportImage({
      clientId,
      format,
      width,
      height,
      saveHtml,
      useCache,
      outDir,
    });

    if (!result?.imagePath) {
      throw new Error("Report image was not generated");
    }

    const mimeFormat = normalizeFormat(format);
    res.setHeader("Content-Type", `image/${mimeFormat}`);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="report-${clientId}.${mimeFormat}"`
    );

    res.sendFile(result.imagePath);
  } catch (error) {
    next(error);
  }
});

router.get("/:clientId/headless/stream", async (req, res, next) => {
  req.setTimeout(0);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const { clientId } = req.params;
  const format = req.query.format || "png";
  const width = Number(req.query.width) || 1400;
  const height = Number(req.query.height) || 900;
  const saveHtml = parseBoolean(req.query.saveHtml, true);
  const useCache = parseBoolean(req.query.useCache, true);
  const outDir = req.query.outDir;

  const send = (event, payload) =>
    writeSse(res, event, {
      ts: new Date().toISOString(),
      ...payload,
    });

  let closed = false;
  let heartbeatTimer;
  const markClosed = () => {
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };
  heartbeatTimer = setInterval(() => {
    if (closed) return;
    // SSE comment-based heartbeat to keep proxies/clients from closing idle connections
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", markClosed);
  req.on("aborted", markClosed);
  res.on?.("close", markClosed);
  res.on?.("error", markClosed);

  try {
    send("progress", {
      stage: "start",
      message: "Starting headless report generation",
      clientId,
    });

    const result = await generateHeadlessReportImage({
      clientId,
      format,
      width,
      height,
      saveHtml,
      useCache,
      outDir,
      onProgress: (payload) => {
        if (closed) return;
        send("progress", payload || {});
      },
    });

    if (!closed) {
      // Build the URL for the client to fetch the image
      const filename = path.basename(result.imagePath);
      const imageUrl = `/api/reports/${clientId}/headless/image/${filename}`;

      console.log(
        `[reports-headless] Sending complete event with imageUrl: ${imageUrl}`
      );

      // Write the final event and ensure it's flushed before closing
      const finalEvent = JSON.stringify({
        ts: new Date().toISOString(),
        stage: "complete",
        status: "ok",
        meta: result.meta,
        imageUrl,
      });

      res.write(`event: progress\ndata: ${finalEvent}\n\n`, () => {
        // Callback fires when data is flushed to the OS
        console.log(`[reports-headless] Complete event flushed`);
        // Small delay to ensure proxy buffers are flushed
        setTimeout(() => {
          markClosed();
          res.end();
        }, 100);
      });
    }
  } catch (error) {
    console.error(`[reports-headless] Error in stream handler:`, error);
    if (!closed) {
      const errorEvent = JSON.stringify({
        ts: new Date().toISOString(),
        stage: "error",
        status: "error",
        message: error.message || "Headless report failed",
      });

      res.write(`event: progress\ndata: ${errorEvent}\n\n`, () => {
        setTimeout(() => {
          markClosed();
          res.end();
        }, 100);
      });
    }
  }
});

export default router;
