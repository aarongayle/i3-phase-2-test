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
import { buildReportSchedules } from "../../lib/report-schedules.js";
import {
  DEFAULT_REPORT_WINDOW_DAYS,
  daysBetween,
  resolveEnergyDateRange,
} from "../../lib/report-window.js";
import { loadPelicanHistoryForSiteDate } from "../routes/pelican-history.js";

const DEFAULT_OUT_DIR = path.resolve("./campus-optimizer/reports/headless");
const DEFAULT_PELICAN_DAYS = DEFAULT_REPORT_WINDOW_DAYS;
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
  reportWindowDays = DEFAULT_REPORT_WINDOW_DAYS,
  onProgress,
}) {
  if (!clientId) {
    throw new Error("clientId is required");
  }

  const progress = (stage, message, extra) =>
    onProgress?.({ stage, message, ...extra });

  progress("start", "Starting headless report generation", { clientId });

  const compiledCachePath = path.resolve(
    `./campus-optimizer/data/compiled-${String(clientId).trim()}.json`
  );
  const hasCompiledCache = useCache && fs.existsSync(compiledCachePath);

  // Never overwrite the canonical precomputed compiled file from headless.
  // Only use a bounded rebuild window when there is no compiled cache to load.
  const compiled = await buildCompiledReport(clientId, {
    useCache,
    saveJson: false,
    reportWindowDays: hasCompiledCache ? undefined : reportWindowDays,
    onProgress: (payload) =>
      progress(payload?.stage || "compile", payload?.message, payload),
  });

  const energyRange = resolveEnergyDateRange(
    compiled.report?.energy?.expected,
    compiled.report?.energy?.actual,
    compiled.report?.meta
  );
  const pelicanDayCount = energyRange
    ? Math.min(
        pelicanDays,
        daysBetween(energyRange.start, energyRange.end)
      )
    : pelicanDays;

  // Optional Pelican analytics (occupancy/runtime) to enrich the report
  const pelican = await loadPelicanAnalytics(
    clientId,
    pelicanDayCount,
    progress
  );
  progress("pelican-done", "Pelican analytics loaded");

  const fullData = { ...compiled, pelican };
  const clientName = await resolveClientName(clientId);
  const streamMeta = enrichStreamMeta(compiled.report?.meta || {}, compiled.report, {
    clientName,
  });

  progress("schedules-start", "Loading schedules (cache/DB, CO on miss)");
  let schedules = null;
  try {
    schedules = await buildReportSchedules(clientId, {
      report: compiled.report,
      dateRange: streamMeta.dateRange,
      windowDays: reportWindowDays,
    });
    if (schedules) {
      const bytes = Buffer.byteLength(JSON.stringify(schedules), "utf8");
      console.log(`[headless-report] Schedules payload: ${bytes} bytes`);
      progress("schedules-done", "Compact schedules loaded", { bytes });
    } else {
      progress("schedules-empty", "No compact schedules in storage");
    }
  } catch (schedErr) {
    console.warn("[headless-report] Schedules load failed:", schedErr.message);
    progress("schedules-error", schedErr.message);
    schedules = null;
  }

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
        schedules,
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
      schedules,
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

    progress("pelican-start", "Loading Pelican analytics (cache/DB, live on miss)", {
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
        try {
          const json = await loadPelicanHistoryForSiteDate(
            clientId,
            siteSlug,
            date,
            { log: false }
          );
          const rows = Array.isArray(json?.thermostats) ? json.thermostats : [];
          for (const row of rows) {
            thermostats.push({
              ...row,
              date,
              siteSlug,
              groupName: row?.groupName || row?.group || row?.group_name,
            });
          }
        } catch (fetchErr) {
          console.warn(
            `[headless-report] Pelican fetch failed ${siteSlug}/${date}: ${fetchErr.message}`
          );
          progress("pelican-fetch-error", "Pelican fetch failed", {
            siteSlug,
            date,
            message: fetchErr.message,
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
