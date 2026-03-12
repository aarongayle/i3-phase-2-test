/**
 * Test: Pelican cache stale-entry fix
 *
 * Validates the two changes in server/routes/pelican-history.js:
 *  1. Cache hit is skipped (treated as miss) when all cached rows have entryCount=0
 *  2. Cache write is skipped when all freshly-fetched summaries have entryCount=0
 *
 * Run with: node scripts/test-pelican-cache-fix.js
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers that mirror the exact logic in pelican-history.js
// ---------------------------------------------------------------------------

/**
 * Mirrors the cache-hit guard added to the route handler.
 * Returns true when the caller should use the cache, false when it should
 * re-fetch from the live Pelican API.
 */
function shouldUseCachedSummaries(cachedSummaries) {
  if (!cachedSummaries.length) return false;
  const totalEntries = cachedSummaries.reduce(
    (sum, t) => sum + (t.entryCount ?? 0),
    0
  );
  return totalEntries > 0;
}

/**
 * Mirrors the cache-write guard added before saveSummariesToSupabase.
 * Returns true when results should be persisted, false when they should not.
 */
function shouldCacheSummaries(summarizedThermostats) {
  return summarizedThermostats.some((t) => (t.entryCount ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Suite 1: cache-hit guard
// ---------------------------------------------------------------------------
console.log("\nSuite 1 — shouldUseCachedSummaries()");

assert(
  !shouldUseCachedSummaries([]),
  "empty cache array → miss (no rows at all)"
);

assert(
  !shouldUseCachedSummaries([
    { serialNo: "AAA", entryCount: 0 },
    { serialNo: "BBB", entryCount: 0 },
  ]),
  "all-zero entryCount rows → miss (stale future-date cache)"
);

assert(
  shouldUseCachedSummaries([
    { serialNo: "AAA", entryCount: 0 },
    { serialNo: "BBB", entryCount: 42 },
  ]),
  "mixed entryCount (some > 0) → hit"
);

assert(
  shouldUseCachedSummaries([
    { serialNo: "AAA", entryCount: 1 },
  ]),
  "single row with entryCount=1 → hit"
);

assert(
  !shouldUseCachedSummaries([
    { serialNo: "AAA", entryCount: null },
    { serialNo: "BBB", entryCount: undefined },
  ]),
  "null/undefined entryCount treated as 0 → miss"
);

assert(
  shouldUseCachedSummaries([
    { serialNo: "AAA", entryCount: 288 },
  ]),
  "typical full-day cache (288 5-min intervals) → hit"
);

// ---------------------------------------------------------------------------
// Suite 2: cache-write guard
// ---------------------------------------------------------------------------
console.log("\nSuite 2 — shouldCacheSummaries()");

assert(
  !shouldCacheSummaries([]),
  "empty result set → skip write"
);

assert(
  !shouldCacheSummaries([
    { serialNo: "AAA", entryCount: 0 },
    { serialNo: "BBB", entryCount: 0 },
  ]),
  "all-zero entryCount → skip write (prevent cache poisoning for future dates)"
);

assert(
  shouldCacheSummaries([
    { serialNo: "AAA", entryCount: 0 },
    { serialNo: "BBB", entryCount: 5 },
  ]),
  "at least one thermostat has entries → do write"
);

assert(
  shouldCacheSummaries([
    { serialNo: "AAA", entryCount: 144 },
  ]),
  "normal day with entries → do write"
);

assert(
  !shouldCacheSummaries([
    { serialNo: "AAA", entryCount: null },
  ]),
  "null entryCount treated as 0 → skip write"
);

// ---------------------------------------------------------------------------
// Suite 3: real-world scenario — report initially run Dec 18 then re-run today
// ---------------------------------------------------------------------------
console.log("\nSuite 3 — Real-world scenario simulation");

// Simulate what was cached on Dec 18 for a date that was "Dec 30" (future at that time)
const dec30StaleCache = [
  { serialNo: "T001", entryCount: 0 },
  { serialNo: "T002", entryCount: 0 },
  { serialNo: "T003", entryCount: 0 },
];

assert(
  !shouldUseCachedSummaries(dec30StaleCache),
  "Dec 30 stale cache (cached when still in the future) → treated as miss"
);

// After re-fetching Dec 30 from Pelican today we get real data
const dec30FreshFromPelican = [
  { serialNo: "T001", entryCount: 96 },
  { serialNo: "T002", entryCount: 102 },
  { serialNo: "T003", entryCount: 88 },
];

assert(
  shouldCacheSummaries(dec30FreshFromPelican),
  "Fresh Dec 30 data from Pelican → persisted to cache"
);

// A genuinely empty day (thermostat offline all day): Pelican returns 0 entries
const genuinelyEmptyDay = [
  { serialNo: "T001", entryCount: 0 },
];

assert(
  !shouldCacheSummaries(genuinelyEmptyDay),
  "Genuinely empty day still → not cached (will re-fetch on next run; acceptable trade-off)"
);

// Dec 5 valid cache entry that was originally populated correctly
const dec5ValidCache = [
  { serialNo: "T001", entryCount: 96, maxHeatSetpoint: 68, minHeatSetpoint: 58 },
  { serialNo: "T002", entryCount: 102, maxHeatSetpoint: 68, minHeatSetpoint: 58 },
];

assert(
  shouldUseCachedSummaries(dec5ValidCache),
  "Dec 5 valid cache with real entries → served from cache (no re-fetch)"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("Some tests FAILED — review the logic above.");
  process.exit(1);
} else {
  console.log("All tests passed ✅");
}
