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
  // These files are regenerated in place using stable filenames, so browsers
  // and proxies must not reuse older copies.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(imagePath);
});

function normalizeFormat(format) {
  const fmt = String(format || "png").toLowerCase();
  return fmt === "jpeg" || fmt === "jpg" ? "jpeg" : "png";
}

function buildImageUrl(clientId, imagePath) {
  let cacheBust = Date.now();
  try {
    cacheBust = Math.trunc(fs.statSync(imagePath).mtimeMs);
  } catch (_err) {
    // Fall back to current time if the image file isn't stat-able yet.
  }
  return `/api/reports/${clientId}/headless/image/${path.basename(
    imagePath
  )}?v=${cacheBust}`;
}

function buildImageUrlsById(clientId, imagePathsById) {
  return Object.fromEntries(
    Object.entries(imagePathsById || {}).map(([imageId, imagePath]) => [
      imageId,
      buildImageUrl(clientId, imagePath),
    ])
  );
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
      splitImages = false,
      outDir,
    } = req.body || {};

    const result = await generateHeadlessReportImage({
      clientId,
      format,
      width,
      height,
      saveHtml,
      useCache,
      splitImages,
      outDir,
    });

    if (splitImages) {
      if (!result?.imagePathsById || Object.keys(result.imagePathsById).length === 0) {
        throw new Error("Report images were not generated");
      }

      return res.json({
        meta: result.meta,
        images: buildImageUrlsById(clientId, result.imagePathsById),
        analytics: result.analytics ?? null,
        schedules: result.schedules ?? null,
      });
    }

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

  // SSE headers - disable all proxy/nginx buffering
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.flushHeaders();

  const { clientId } = req.params;
  const format = req.query.format || "png";
  const width = Number(req.query.width) || 1400;
  const height = Number(req.query.height) || 900;
  const saveHtml = parseBoolean(req.query.saveHtml, true);
  const useCache = parseBoolean(req.query.useCache, true);
  const splitImages = parseBoolean(req.query.splitImages, false);
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
      splitImages,
      outDir,
      onProgress: (payload) => {
        if (closed) return;
        send("progress", payload || {});
      },
    });

    if (!closed) {
      const finalPayload = {
        ts: new Date().toISOString(),
        stage: "complete",
        status: "ok",
        meta: result.meta,
        analytics: result.analytics ?? null,
        schedules: result.schedules ?? null,
      };

      if (splitImages) {
        finalPayload.images = buildImageUrlsById(clientId, result.imagePathsById);
        console.log(
          `[reports-headless] Sending complete event with ${Object.keys(finalPayload.images).length} images`
        );
      } else {
        finalPayload.imageUrl = buildImageUrl(clientId, result.imagePath);
        console.log(
          `[reports-headless] Sending complete event with imageUrl: ${finalPayload.imageUrl}`
        );
      }

      // Write the final event
      const finalEvent = JSON.stringify(finalPayload);

      res.write(`event: progress\ndata: ${finalEvent}\n\n`);

      // Force flush with a comment and wait for proxy buffers
      res.write(`: flush ${Date.now()}\n\n`);

      console.log(
        `[reports-headless] Complete event written, waiting for flush...`
      );

      // Wait longer to ensure proxy buffers are flushed, then end
      setTimeout(() => {
        console.log(`[reports-headless] Ending stream`);
        markClosed();
        res.end();
      }, 500);
    }
  } catch (error) {
    console.error(`[reports-headless] Error in stream handler:`, error);
    if (!closed) {
      const errorEvent = JSON.stringify({
        ts: new Date().toISOString(),
        stage: "error",
        status: "error",
        message: error.message || "Headless report failed",
        schedules: null,
      });

      res.write(`event: progress\ndata: ${errorEvent}\n\n`);
      res.write(`: flush ${Date.now()}\n\n`);

      setTimeout(() => {
        markClosed();
        res.end();
      }, 500);
    }
  }
});

export default router;
