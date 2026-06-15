import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { getBuildings } from "../../campus-optimizer/co-api.js";
import { buildHtml } from "../../campus-optimizer/generate-html.js";
import { calculatePelicanAnalytics } from "../../lib/pelican-analytics.js";
import { buildCompiledReport } from "../../lib/report-builder.js";
import {
  buildReportAnalytics,
  enrichStreamMeta,
  resolveClientName,
} from "../../lib/report-analytics.js";

const DEFAULT_OUT_DIR = path.resolve("./campus-optimizer/reports/headless");
const DEFAULT_PELICAN_DAYS = 100;
const API_BASE =
  process.env.HEADLESS_API_BASE ||
  `http://localhost:${process.env.PORT || 3001}/api`;
const SPLIT_IMAGE_TARGETS = [
  { id: "topRuntime", selector: "#barTopRuntime", label: "Top runtime" },
  {
    id: "weeklyRuntime",
    selector: "#lineWeekly",
    label: "Weekly runtime",
  },
  { id: "dailyEnergyUse", selector: "#lineEnergy", label: "Daily energy use" },
  {
    id: "dailyPeakDemand",
    selector: "#linePeakDemand",
    label: "Daily peak demand",
  },
  {
    id: "scheduleVsOccupancy",
    selector: "#pelicanComparison",
    label: "Schedule vs occupancy",
  },
  {
    id: "setpointTrends",
    selector: "#pelicanSetpoints",
    label: "Setpoint trends",
  },
  {
    id: "intervalLatestDay",
    selector: "#lineIntervalLatest",
    label: "Interval latest day",
  },
  {
    id: "intervalAverageDay",
    selector: "#lineIntervalAverage",
    label: "Interval average day",
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function clampFormat(format) {
  const fmt = String(format || "png").toLowerCase();
  return fmt === "jpeg" ? "jpeg" : fmt === "jpg" ? "jpeg" : "png";
}

function resolveChromeFromCache(cacheDir) {
  try {
    const chromeRoot = path.join(cacheDir, "chrome");
    const entries = fs.readdirSync(chromeRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const execPath = path.join(
        chromeRoot,
        entry.name,
        "chrome-linux64",
        "chrome"
      );
      if (fs.existsSync(execPath)) {
        return execPath;
      }
    }
  } catch (_err) {
    // ignore and fall through to other strategies
  }
  return null;
}

function resolveChromePath() {
  const cacheDir =
    process.env.PUPPETEER_CACHE_DIR || "/usr/local/share/puppeteer";

  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    resolveChromeFromCache(cacheDir),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);

  return candidates.find((p) => fs.existsSync(p)) || null;
}

function buildImagePath(outDir, sanitizedId, format, imageId) {
  const suffix = imageId ? `-${imageId}` : "";
  return path.join(outDir, `report-${sanitizedId}${suffix}.${clampFormat(format)}`);
}

async function captureSplitImages(page, { outDir, sanitizedId, format, progress }) {
  const imagePathsById = {};
  const imageType = clampFormat(format);

  for (const target of SPLIT_IMAGE_TARGETS) {
    const chartHandle = await page.$(target.selector);
    if (!chartHandle) {
      continue;
    }

    const cardHandle = await chartHandle.evaluateHandle(
      (element) => element.closest(".card") || element
    );
    const captureHandle =
      typeof cardHandle.asElement === "function"
        ? cardHandle.asElement()
        : null;

    if (!captureHandle) {
      await chartHandle.dispose();
      await cardHandle.dispose();
      continue;
    }

    const imagePath = buildImagePath(outDir, sanitizedId, format, target.id);
    const screenshotBuffer = await captureHandle.screenshot({
      path: imagePath,
      type: imageType,
    });

    await chartHandle.dispose();
    await cardHandle.dispose();

    if (!screenshotBuffer || screenshotBuffer.length === 0) {
      throw new Error(`Screenshot buffer is empty for ${target.id}`);
    }

    imagePathsById[target.id] = imagePath;
    progress("image-captured", `Captured ${target.label} chart`, {
      imageId: target.id,
    });
  }

  if (Object.keys(imagePathsById).length === 0) {
    throw new Error("No report chart images were generated");
  }

  return imagePathsById;
}

export async function generateHeadlessReportImage({
  clientId,
  outDir = DEFAULT_OUT_DIR,
  format = "png",
  width = 1400,
  height = 900,
  saveHtml = true,
  useCache = true,
  splitImages = false,
  pelicanDays = DEFAULT_PELICAN_DAYS,
  onProgress,
}) {
  if (!clientId) {
    throw new Error("clientId is required");
  }

  const progress = (stage, message, extra) =>
    onProgress?.({ stage, message, ...extra });

  progress("start", "Starting headless report generation", { clientId });

  const compiled = await buildCompiledReport(clientId, {
    useCache,
    saveJson: true,
    onProgress: (payload) =>
      progress(payload?.stage || "compile", payload?.message, payload),
  });

  // Optional Pelican analytics (occupancy/runtime) to enrich the report
  const pelican = await loadPelicanAnalytics(clientId, pelicanDays, progress);
  progress("pelican-done", "Pelican analytics loaded");

  const fullData = { ...compiled, pelican };
  const clientName = await resolveClientName(clientId);
  const streamMeta = enrichStreamMeta(compiled.report?.meta || {}, compiled.report, {
    clientName,
  });

  const html = buildHtml(fullData);
  ensureDir(outDir);
  progress("html-ready", "Report HTML built");

  const sanitizedId = String(clientId).replace(/[^\w.-]/g, "_");
  const htmlPath = path.join(outDir, `report-${sanitizedId}.html`);
  const imagePath = buildImagePath(outDir, sanitizedId, format);

  if (saveHtml) {
    fs.writeFileSync(htmlPath, html, "utf8");
  }

  progress("render-start", "Launching headless browser to render report");
  // In containers (Coolify/Docker) we need an explicit binary path plus
  // no-sandbox flags. Resolve Puppeteer cache first, then system paths.
  const executablePath = resolveChromePath();

  const launchOptions = {
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: Number(width) || 1400,
      height: Number(height) || 900,
    });

    await page.setContent(html, { waitUntil: "networkidle0" });
    await page
      .waitForFunction("window.__reportReady === true", {
        timeout: 60_000,
      })
      .catch(() => {
        console.warn(
          "[headless-report] Timed out waiting for report to signal readiness; continuing with screenshot"
        );
      });

    // Give the browser one final beat to flush layout/paint work after the
    // page signals readiness.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
          });
        })
    );

    if (splitImages) {
      const imagePathsById = await captureSplitImages(page, {
        outDir,
        sanitizedId,
        format,
        progress,
      });

      console.log(
        `[headless-report] Saved ${Object.keys(imagePathsById).length} split report images`
      );

      const analytics = buildReportAnalytics(fullData, {
        capturedImageIds: Object.keys(imagePathsById),
      });

      return {
        imagePathsById,
        meta: streamMeta,
        analytics,
        pelican,
      };
    }

    // Grab only the report content (prevents duplicated layouts if other nodes render outside the root)
    let screenshotBuffer;
    const root = await page.$("#report-root");
    if (root) {
      screenshotBuffer = await root.screenshot({
        path: imagePath,
        type: clampFormat(format),
      });
      progress("image-captured", "Captured report root screenshot");
    } else {
      // Fallback to full page if the root isn't found
      screenshotBuffer = await page.screenshot({
        path: imagePath,
        fullPage: true,
        type: clampFormat(format),
      });
      progress("image-captured", "Captured full page screenshot");
    }

    if (!screenshotBuffer || screenshotBuffer.length === 0) {
      throw new Error("Screenshot buffer is empty");
    }

    console.log(
      `[headless-report] Screenshot saved: ${imagePath} (${screenshotBuffer.length} bytes)`
    );

    const analytics = buildReportAnalytics(fullData);

    return {
      imagePath,
      meta: streamMeta,
      analytics,
      pelican,
    };
  } finally {
    try {
      await browser.close();
    } catch (closeErr) {
      console.warn(
        "[headless-report] Error closing browser:",
        closeErr.message
      );
    }
  }
}

async function loadPelicanAnalytics(
  clientId,
  days = DEFAULT_PELICAN_DAYS,
  onProgress
) {
  try {
    const progress = (stage, message, extra) =>
      onProgress?.(
        typeof stage === "string" ? { stage, message, ...extra } : stage
      );

    const buildings = await getBuildings(Number(clientId));
    const sites = Array.from(
      new Set(
        (buildings || [])
          .map((b) => String(b?.PelicanSubdomain || "").trim())
          .filter(Boolean)
      )
    );

    if (sites.length === 0) {
      return null;
    }

    progress("pelican-start", "Loading Pelican analytics", {
      sites: sites.length,
      days,
    });

    const dates = buildDateRange(days);
    const thermostats = [];

    for (const [siteIdx, siteSlug] of sites.entries()) {
      progress("pelican-site", "Fetching Pelican history for site", {
        siteSlug,
        siteIndex: siteIdx + 1,
        siteCount: sites.length,
        dates: dates.length,
      });
      for (const [dateIdx, date] of dates.entries()) {
        progress("pelican-fetch", "Fetching Pelican history", {
          siteSlug,
          date,
          dateIndex: dateIdx + 1,
          dateCount: dates.length,
        });
        const url = `${API_BASE}/pelican/history/${clientId}?siteSlug=${encodeURIComponent(
          siteSlug
        )}&date=${date}`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text();
          console.warn(
            `[headless-report] Pelican fetch failed ${siteSlug}/${date}: ${res.status} ${body}`
          );
          progress("pelican-fetch-error", "Pelican fetch failed", {
            siteSlug,
            date,
            status: res.status,
          });
          continue;
        }
        const json = await res.json();
        const rows = Array.isArray(json?.thermostats) ? json.thermostats : [];
        for (const row of rows) {
          thermostats.push({
            ...row,
            date,
            siteSlug,
            groupName: row?.groupName || row?.group || row?.group_name,
          });
        }
      }
    }

    const analytics = calculatePelicanAnalytics(thermostats, buildings, {
      start: dates[0],
      end: dates[dates.length - 1],
    });
    progress("pelican-analytics", "Pelican analytics calculated");
    return { analytics, sites, days };
  } catch (err) {
    console.warn("[headless-report] Pelican analytics failed:", err.message);
    onProgress?.({
      stage: "pelican-error",
      message: err.message,
    });
    return null;
  }
}

function buildDateRange(days) {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
