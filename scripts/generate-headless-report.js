#!/usr/bin/env node
/**
 * Generate a headless report locally and print the same JSON payload the
 * server returns on the SSE complete event for:
 *   GET /api/reports/:clientId/headless/stream?splitImages=true
 *
 * Usage:
 *   pnpm co:headless 1910
 *   pnpm co:headless 1910 --no-cache
 *   pnpm co:headless 1910 --no-split
 *   pnpm co:headless 1910 --format jpeg --out-dir ./tmp/reports
 *
 * Progress logs go to stderr. Final JSON goes to stdout (and is also written
 * next to the generated images).
 *
 * Pelican history and CO schedules both load through shared libs
 * (Supabase cache → live fetch on miss). No local Express server required.
 */

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHeadlessReportErrorResponse,
  buildHeadlessReportResponse,
} from "../lib/headless-report-response.js";
import { generateHeadlessReportImage } from "../server/services/headless-report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

function printHelp() {
  console.error(`Usage: pnpm co:headless <clientId> [options]

Options:
  --split / --no-split     Split chart images (default: --split)
  --cache / --no-cache     Use compiled-{clientId}.json if present (default: --cache)
  --save-html / --no-save-html
                           Write report HTML beside images (default: --save-html)
  --format <png|jpeg>      Image format (default: png)
  --width <n>              Viewport width (default: 1400)
  --height <n>             Viewport height (default: 900)
  --out-dir <path>         Output directory for images/html/json
  --quiet                  Suppress progress logs on stderr
  -h, --help               Show this help

Output:
  Prints the stream complete JSON payload to stdout.
  Also writes report-<clientId>-response.json under the output directory.
`);
}

function parseArgs(argv) {
  const opts = {
    clientId: null,
    splitImages: true,
    useCache: true,
    saveHtml: true,
    format: "png",
    width: 1400,
    height: 900,
    outDir: undefined,
    quiet: false,
    help: false,
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "-h" || arg === "--help") {
      opts.help = true;
      continue;
    }
    if (arg === "--split") {
      opts.splitImages = true;
      continue;
    }
    if (arg === "--no-split") {
      opts.splitImages = false;
      continue;
    }
    if (arg === "--cache") {
      opts.useCache = true;
      continue;
    }
    if (arg === "--no-cache") {
      opts.useCache = false;
      continue;
    }
    if (arg === "--save-html") {
      opts.saveHtml = true;
      continue;
    }
    if (arg === "--no-save-html") {
      opts.saveHtml = false;
      continue;
    }
    if (arg === "--quiet") {
      opts.quiet = true;
      continue;
    }
    if (arg === "--format") {
      opts.format = String(args.shift() || "png");
      continue;
    }
    if (arg.startsWith("--format=")) {
      opts.format = arg.slice("--format=".length);
      continue;
    }
    if (arg === "--width") {
      opts.width = Number(args.shift());
      continue;
    }
    if (arg.startsWith("--width=")) {
      opts.width = Number(arg.slice("--width=".length));
      continue;
    }
    if (arg === "--height") {
      opts.height = Number(args.shift());
      continue;
    }
    if (arg.startsWith("--height=")) {
      opts.height = Number(arg.slice("--height=".length));
      continue;
    }
    if (arg === "--out-dir") {
      opts.outDir = args.shift();
      continue;
    }
    if (arg.startsWith("--out-dir=")) {
      opts.outDir = arg.slice("--out-dir=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (opts.clientId == null) {
      opts.clientId = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return opts;
}

function logProgress(quiet, payload) {
  if (quiet) return;
  const stage = payload?.stage || "progress";
  const message = payload?.message || "";
  const extra = { ...payload };
  delete extra.stage;
  delete extra.message;
  const extraKeys = Object.keys(extra);
  const suffix =
    extraKeys.length > 0 ? ` ${JSON.stringify(extra)}` : "";
  console.error(`[${stage}] ${message}${suffix}`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    printHelp();
    process.exit(1);
  }

  if (opts.help || !opts.clientId) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  const clientId = String(opts.clientId).trim();
  console.error(`\n=== Headless report for clientId: ${clientId} ===\n`);

  try {
    const result = await generateHeadlessReportImage({
      clientId,
      format: opts.format,
      width: opts.width,
      height: opts.height,
      saveHtml: opts.saveHtml,
      useCache: opts.useCache,
      splitImages: opts.splitImages,
      outDir: opts.outDir,
      onProgress: (payload) => logProgress(opts.quiet, payload),
    });

    const response = buildHeadlessReportResponse({
      clientId,
      result,
      splitImages: opts.splitImages,
    });

    const outDir = path.resolve(
      opts.outDir || "./campus-optimizer/reports/headless"
    );
    fs.mkdirSync(outDir, { recursive: true });
    const sanitizedId = clientId.replace(/[^\w.-]/g, "_");
    const responsePath = path.join(
      outDir,
      `report-${sanitizedId}-response.json`
    );
    fs.writeFileSync(responsePath, `${JSON.stringify(response, null, 2)}\n`);

    if (!opts.quiet) {
      console.error(`\n✓ Wrote response JSON: ${responsePath}`);
      if (opts.splitImages) {
        console.error(
          `✓ Generated ${Object.keys(response.images || {}).length} split images`
        );
      } else {
        console.error(`✓ Generated image: ${result.imagePath}`);
      }
      if (!result?.pelican) {
        console.error(
          "⚠ Pelican analytics unavailable (no Pelican sites or history fetch failed)"
        );
      }
      console.error("");
    }

    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  } catch (error) {
    const errorResponse = buildHeadlessReportErrorResponse(error);
    console.error(`\nHeadless report failed: ${error.message}\n`);
    process.stdout.write(`${JSON.stringify(errorResponse, null, 2)}\n`);
    process.exit(1);
  }
}

main();
