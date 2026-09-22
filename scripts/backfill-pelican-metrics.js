#!/usr/bin/env node
/**
 * Backfill raw-reading metrics (lib/pelican-day-metrics.js) into
 * pelican_daily_summaries.metrics for one client/site and date range.
 *
 * Raw Pelican history isn't cached, so each day is fetched live (≈20–40 s per
 * site-day) and re-summarized. Run nightly or ahead of a report, not during one.
 *
 * Requires the column from db/migrations/2026-09-21-pelican-daily-metrics.sql
 * and PELICAN_SUMMARY_METRICS=1.
 *
 * Usage:
 *   PELICAN_SUMMARY_METRICS=1 node scripts/backfill-pelican-metrics.js \
 *     --client 2223 --site cashion-ps --from 2026-06-01 --to 2026-09-14 [--skip-existing]
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

function parseArgs(argv) {
  const opts = { skipExisting: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--client") opts.clientId = argv[++i];
    else if (arg === "--site") opts.siteSlug = argv[++i];
    else if (arg === "--from") opts.from = argv[++i];
    else if (arg === "--to") opts.to = argv[++i];
    else if (arg === "--skip-existing") opts.skipExisting = true;
  }
  return opts;
}

function datesBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.clientId || !opts.siteSlug || !opts.from || !opts.to) {
    console.error("Usage: --client <id> --site <pelican-subdomain> --from YYYY-MM-DD --to YYYY-MM-DD [--skip-existing]");
    process.exit(1);
  }
  if (process.env.PELICAN_SUMMARY_METRICS !== "1") {
    console.error("Set PELICAN_SUMMARY_METRICS=1 after applying db/migrations/2026-09-21-pelican-daily-metrics.sql.");
    process.exit(1);
  }

  const history = await import("../server/routes/pelican-history.js");
  const { username, password } = await history.getCredentialsForSite(Number(opts.clientId), opts.siteSlug);

  for (const date of datesBetween(opts.from, opts.to)) {
    if (opts.skipExisting) {
      const cached = await history.getCachedSummariesFromSupabase(opts.clientId, opts.siteSlug, date);
      if (cached.length && cached.every((row) => row.metrics)) {
        console.log(`${date}: already has metrics, skipped`);
        continue;
      }
    }
    const started = Date.now();
    try {
      const thermostats = await history.fetchAllThermostatsForSiteDate(opts.siteSlug, username, password, date);
      const summaries = thermostats.map((t) => history.summarizeThermostatDay(t, date));
      const withEntries = summaries.filter((s) => (s.entryCount ?? 0) > 0);
      if (!withEntries.length) {
        console.log(`${date}: no Pelican entries, skipped`);
        continue;
      }
      await history.saveSummariesToSupabase(withEntries, opts.clientId, opts.siteSlug);
      console.log(`${date}: ${withEntries.length} thermostats saved with metrics (${Math.round((Date.now() - started) / 1000)} s)`);
    } catch (err) {
      console.error(`${date}: failed — ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
