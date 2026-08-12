import fs from "node:fs";
import path from "node:path";

/**
 * Build the public image URL used by the headless report API.
 * Kept in sync for both the Express routes and the local CLI.
 */
export function buildImageUrl(clientId, imagePath) {
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

export function buildImageUrlsById(clientId, imagePathsById) {
  return Object.fromEntries(
    Object.entries(imagePathsById || {}).map(([imageId, imagePath]) => [
      imageId,
      buildImageUrl(clientId, imagePath),
    ])
  );
}

/**
 * Build the final client-facing payload for a successful headless report.
 * Matches the SSE `progress` complete event from GET /api/reports/:clientId/headless/stream
 * (and the JSON body of POST .../headless when splitImages=true, plus status fields).
 */
export function buildHeadlessReportResponse({
  clientId,
  result,
  splitImages = false,
  ts = new Date().toISOString(),
}) {
  const payload = {
    ts,
    stage: "complete",
    status: "ok",
    meta: result?.meta ?? null,
    analytics: result?.analytics ?? null,
    schedules: result?.schedules ?? null,
  };

  if (splitImages) {
    if (
      !result?.imagePathsById ||
      Object.keys(result.imagePathsById).length === 0
    ) {
      throw new Error("Report images were not generated");
    }
    payload.images = buildImageUrlsById(clientId, result.imagePathsById);
  } else {
    if (!result?.imagePath) {
      throw new Error("Report image was not generated");
    }
    payload.imageUrl = buildImageUrl(clientId, result.imagePath);
  }

  return payload;
}

export function buildHeadlessReportErrorResponse(
  error,
  ts = new Date().toISOString()
) {
  return {
    ts,
    stage: "error",
    status: "error",
    message: error?.message || "Headless report failed",
    schedules: null,
  };
}
