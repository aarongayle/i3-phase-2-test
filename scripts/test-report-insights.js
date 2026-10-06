/**
 * Test: per-meter demand/baseload, demand targets, topology, and event summaries.
 * Run with: node scripts/test-report-insights.js
 */
import assert from "node:assert/strict";
import { firstStartsByDevice, localParts } from "../lib/co-scheduled-minutes.js";
import {
  buildTopology,
  demandTargetRows,
  eventWeeks,
  meterBaseload,
  meterDailyPeaks,
  meterPeakHours,
  summarizeEvents,
} from "../lib/report-insights.js";

const TZ = "America/Chicago";

// ─── local time ────────────────────────────────────────────────────────────
// 12:00Z on Sep 28 is 7:00 AM CDT; 05:00Z on Sep 29 is midnight CDT, still Monday's night.
assert.deepEqual(localParts(Date.parse("2026-09-28T12:00:00Z"), TZ), { date: "2026-09-28", minutes: 420, dayOfWeek: 1 });
assert.deepEqual(localParts(Date.parse("2026-09-29T04:30:00Z"), TZ), { date: "2026-09-28", minutes: 1410, dayOfWeek: 1 });

// First device start (ramp) and first event start on the local day.
const starts = firstStartsByDevice(
  [
    { DeviceId: 1, StartDateEpoch: Date.parse("2026-09-28T10:30:00Z"), EventStartDateEpoch: Date.parse("2026-09-28T12:00:00Z") },
    { DeviceId: 1, StartDateEpoch: Date.parse("2026-09-28T18:00:00Z"), EventStartDateEpoch: Date.parse("2026-09-28T18:30:00Z") },
    { DeviceId: 2, StartDateEpoch: Date.parse("2026-09-29T11:00:00Z"), EventStartDateEpoch: Date.parse("2026-09-29T12:00:00Z") },
  ],
  "2026-09-28",
  TZ
);
assert.deepEqual(starts.get(1), { startMin: 330, eventStartMin: 420 });
assert.equal(starts.has(2), false);

// ─── topology ──────────────────────────────────────────────────────────────
// meter 10 (electric) → building 20 → group 30 → device 40 → room 50
const topology = buildTopology({
  hierarchy: [
    { CategoryId: 3, ElementTableId: 10, ParentCategoryId: 1, ParentElementTableId: 1 },
    { CategoryId: 2, ElementTableId: 20, ParentCategoryId: 3, ParentElementTableId: 10 },
    { CategoryId: 4, ElementTableId: 30, ParentCategoryId: 2, ParentElementTableId: 20 },
    { CategoryId: 5, ElementTableId: 40, ParentCategoryId: 4, ParentElementTableId: 30 },
    { CategoryId: 5, ElementTableId: 41, ParentCategoryId: 4, ParentElementTableId: 30 },
    { CategoryId: 8, ElementTableId: 50, ParentCategoryId: 5, ParentElementTableId: 40 },
  ],
  buildings: [{ Id: 20, Name: "Elementary" }],
  meters: [{ Id: 10, UtilityTypeId: 1 }],
  utilityTypes: [{ Id: 1, Name: "Electricity" }],
});
assert.equal(topology.deviceBuilding.get(40), 20);
assert.equal(topology.deviceMeter.get(40), 10);
assert.equal(topology.roomDevice.get(50), 40);

// ─── demand targets ────────────────────────────────────────────────────────
const targets = demandTargetRows(
  [{ MeterId: 10, BeginDate: "08-01-2026", EndDate: "10-31-2026", DemandTarget: 120, LoadRollingOptionId: 2 }],
  [{ Id: 2, Name: "Cooling" }]
);
assert.deepEqual(targets[0], {
  meterId: "10", begin: "2026-08-01", end: "2026-10-31", demandTargetKw: 120, loadRolling: "Cooling", notes: null,
});

// ─── daily peaks: startup vs occupied load ─────────────────────────────────
function day(peakIdx, peakKw, base = 20) {
  const values = new Array(96).fill(base);
  values[peakIdx] = peakKw;
  return values;
}
const intervals = new Map([
  [
    "10",
    {
      name: "Main",
      byDate: new Map([
        ["2026-09-28", day(26, 150)], // 6:30 AM, devices start 5:30, occupied 7:00 → startup
        ["2026-09-29", day(58, 160)], // 2:30 PM → occupied load
        ["2026-09-26", day(28, 90)], // Saturday, no schedule → clock window 5–9 AM
      ]),
    },
  ],
]);
const startsByMeter = new Map([
  ["10", new Map([
    ["2026-09-28", { startMin: 330, eventStartMin: 420 }],
    ["2026-09-29", { startMin: 330, eventStartMin: 420 }],
  ])],
]);
const appliedTargets = new Map([["10", new Map([["2026-09-28", 120]])]]);
const peaks = meterDailyPeaks(intervals, startsByMeter, appliedTargets);
const byDate = Object.fromEntries(peaks.rows.map((r) => [r[1], Object.fromEntries(peaks.columns.map((c, i) => [c, r[i]]))]));
assert.equal(byDate["2026-09-28"].startup, 1);
assert.equal(byDate["2026-09-28"].peakTime, "06:30");
assert.equal(byDate["2026-09-28"].firstDeviceStart, "05:30");
assert.equal(byDate["2026-09-28"].occupiedStart, "07:00");
assert.equal(byDate["2026-09-28"].demandTargetKw, 120);
assert.equal(byDate["2026-09-29"].startup, 0);
assert.equal(byDate["2026-09-29"].startupBasis, "schedule");
assert.equal(byDate["2026-09-26"].startup, 1);
assert.equal(byDate["2026-09-26"].startupBasis, "clock");

// ─── top 10% hours and overnight baseload ──────────────────────────────────
const hours = meterPeakHours(intervals)[0];
assert.equal(hours.maxKw, 160);
assert.equal(hours.hourSharePct.reduce((a, b) => a + b, 0) > 99, true);

const baseload = meterBaseload(intervals);
// Weekday daytime (10 AM – 3 PM) median: Mon 20 kW, Tue 27 kW with its 2:30 PM peak.
assert.deepEqual(baseload.rows[0], ["10", "2026-09", 20, 23.5, 3]);

// ─── events: weekday windows and a schedule change ─────────────────────────
const weeks = eventWeeks("2026-09-30", 1, 0);
assert.deepEqual(weeks, ["2026-09-21", "2026-09-28"]);
const occurrences = [];
for (const [date, startZ, endZ] of [
  ...["21", "22", "23", "24", "25"].map((d) => [`2026-09-${d}`, "12:45", "20:30"]), // 7:45 AM – 3:30 PM CDT
  ...["28", "29", "30"].map((d) => [`2026-09-${d}`, "11:00", "22:00"]), // 6:00 AM – 5:00 PM CDT
  ["2026-10-01", "11:00", "22:00"],
  ["2026-10-02", "11:00", "22:00"],
]) {
  occurrences.push({
    Id: 7,
    EventName: "Reg Hours",
    StartDate: `${date}T${startZ}:00.000Z`,
    EndDate: `${date}T${endZ}:00.000Z`,
    RecurrenceRule: "FREQ=WEEKLY",
    Resources: [50],
    RoomCollections: [],
  });
}
const summary = summarizeEvents(occurrences, {
  topology,
  buildings: [{ buildingId: 20, name: "Elementary", deviceCount: 2 }],
  roomCollections: [],
  timeZone: TZ,
  weeks,
});
assert.equal(summary.series.length, 2);
assert.equal(summary.series[0].days, "Mon–Fri");
assert.equal(summary.series[0].buildingDeviceSharePct, 50);
assert.deepEqual(summary.buildingWeeks.rows[0], ["Elementary", "2026-09-21", 5, "07:45", "15:30", 7.75, 0, 5]);
assert.deepEqual(summary.changes, [
  {
    building: "Elementary",
    weekStart: "2026-09-28",
    fromWeek: "2026-09-21",
    from: "07:45–15:30",
    to: "06:00–17:00",
    fromHours: 7.75,
    toHours: 11,
    changePct: 41.9,
  },
]);

console.log("OK");
