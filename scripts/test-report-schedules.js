/**
 * Test: report-schedules payload builder
 * Run with: node scripts/test-report-schedules.js
 */

import cache from "../server/cache.js";
import { buildReportSchedules } from "../lib/report-schedules.js";

const clientId = 1420;
const scheduleDate = "2026-05-01";

cache.set(`schedules:${clientId}:${scheduleDate}`, [
  {
    DeviceId: 101,
    Name: "Morning occupied",
    StartDateEpoch: new Date(`${scheduleDate}T07:00:00`).getTime(),
    EndDateEpoch: new Date(`${scheduleDate}T15:30:00`).getTime(),
    Occupied: true,
  },
  {
    DeviceId: 102,
    Name: "Afternoon block",
    StartDateEpoch: new Date(`${scheduleDate}T08:00:00`).getTime(),
    EndDateEpoch: new Date(`${scheduleDate}T17:00:00`).getTime(),
    Occupied: true,
  },
]);

const mockReport = {
  meta: {
    clientId,
    reportsCount: 625,
    firstReportDate: "2024-01-01",
    mostRecentDate: scheduleDate,
  },
  devices: [{ name: "Gym RTU-1" }, { name: "Office RTU-2" }],
  energy: {
    expected: [
      {
        Interval: [{ date: "2026-04-01" }, { date: scheduleDate }],
      },
    ],
    actual: [
      {
        Interval: [{ date: "2026-04-01" }, { date: scheduleDate }],
      },
    ],
  },
};

const rawDevices = [
  { Id: 101, Name: "Gym RTU-1" },
  { Id: 102, Name: "Office RTU-2" },
];

const schedules = await buildReportSchedules(clientId, {
  report: mockReport,
  rawDevices,
  dateRange: { start: "2026-04-01", end: scheduleDate },
});

if (!schedules || schedules.version !== 1) {
  throw new Error("Expected schedules version 1");
}
if (schedules.items.length !== 2) {
  throw new Error(`Expected 2 schedule items, got ${schedules.items.length}`);
}
if (schedules.items[0].scopeType !== "device") {
  throw new Error("Expected device scopeType");
}
if (!schedules.items[0].events[0]?.startLocal) {
  throw new Error("Expected startLocal on events");
}

const bytes = Buffer.byteLength(JSON.stringify(schedules), "utf8");
console.log("schedules version:", schedules.version);
console.log("items:", schedules.items.length);
console.log("events on first item:", schedules.items[0].events.length);
console.log("dateRange:", schedules.dateRange);
console.log("serialized bytes:", bytes);

if (bytes > 100 * 1024) {
  throw new Error("Schedules payload exceeds 100KB target");
}

console.log("OK");
