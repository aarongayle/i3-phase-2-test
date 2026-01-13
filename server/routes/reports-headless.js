import express from "express";
import { generateHeadlessReportImage } from "../services/headless-report.js";

const router = express.Router();

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
      send("done", {
        status: "ok",
        meta: result.meta,
        imageDataUrl: result.imageDataUrl,
      });
      markClosed();
      res.end();
    }
  } catch (error) {
    if (!closed) {
      send("error", { message: error.message || "Headless report failed" });
      markClosed();
      res.end();
    }
  }
});

export default router;
