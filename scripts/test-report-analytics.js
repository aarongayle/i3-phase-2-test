import { buildReportAnalytics, enrichStreamMeta } from "../lib/report-analytics.js";

const mockFullData = {
  report: {
    meta: {
      clientId: 1420,
      reportsCount: 2,
      firstReportDate: "2026-04-01",
      mostRecentDate: "2026-05-01",
      generatedAt: "2026-06-15T12:00:00.000Z",
    },
    devices: [
      {
        name: "Gym RTU-1",
        runtimeAvgMin: 980,
        ramptimeAvgMin: 400,
        runtimeWeekly: [{ date: "2026-04-07", minutes: 900 }],
      },
      {
        name: "Office RTU-2",
        runtimeAvgMin: 200,
        ramptimeAvgMin: 20,
        runtimeWeekly: [{ date: "2026-04-07", minutes: 180 }],
      },
    ],
    energy: {
      expected: [
        {
          Id: 1,
          Name: "Main Electric",
          Interval: [
            { date: "2026-05-01", interval: 24, value: 80 },
            { date: "2026-05-01", interval: 0, value: 20 },
          ],
        },
      ],
      actual: [
        {
          Id: 1,
          Name: "Main Electric",
          Interval: [
            { date: "2026-05-01", interval: 24, value: 103 },
            { date: "2026-05-01", interval: 0, value: 25 },
          ],
        },
      ],
    },
  },
  pelican: {
    analytics: {
      dateRange: { start: "2026-04-01", end: "2026-05-01" },
      daily: [
        {
          date: "2026-04-07",
          occupancyMinutes: 480,
          runtimeMinutes: 620,
          fanMinutes: 100,
          thermostatCount: 1,
        },
      ],
      dailySetpoints: [],
      thermostats: [
        {
          serialNo: "T-1",
          name: "Gym RTU-1",
          runtimeMinutes: 4200,
          fanMinutes: 800,
          occupancyMinutes: 5000,
          runtimeByOccupancy: 84,
          temps: {
            occupiedCool: 74,
            occupiedHeat: 72,
            unoccupiedCool: 78,
            unoccupiedHeat: 65,
          },
        },
      ],
      buildings: [],
      campus: { thermostatCount: 1, buildingCount: 1 },
    },
  },
};

const analytics = buildReportAnalytics(mockFullData, {
  capturedImageIds: ["topRuntime", "dailyPeakDemand"],
});
const meta = enrichStreamMeta(mockFullData.report.meta, mockFullData.report, {
  clientName: "Beeville — Example ISD",
});

const serialized = JSON.stringify(analytics);
console.log("analytics version:", analytics?.version);
console.log("overallGrade:", analytics?.summary?.overallGrade);
console.log(
  "worst meter delta:",
  analytics?.reports?.[0]?.meters?.[0]?.delta
);
console.log("imageKeys:", analytics?.reports?.[0]?.imageKeys);
console.log("meta.dateRange:", meta.dateRange);
console.log("serialized bytes:", Buffer.byteLength(serialized, "utf8"));

if (!analytics || analytics.version !== 1) {
  throw new Error("Expected analytics version 1");
}
if ((analytics.reports[0].meters[0].delta ?? 0) <= 0) {
  throw new Error("Expected positive meter delta for overage case");
}
if (!analytics.reports[0].imageKeys.includes("topRuntime")) {
  throw new Error("Expected captured image keys to be preserved");
}

console.log("OK");
