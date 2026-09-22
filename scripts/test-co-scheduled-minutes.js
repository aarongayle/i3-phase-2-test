import {
  reportDayBounds,
  rowsForReportDate,
  scheduledMinutesByDevice,
  weekStartKey,
  weeklyTotals,
} from "../lib/co-scheduled-minutes.js";

const at = (iso) => Date.parse(iso);
const row = (deviceId, start, end, rampTime = 0) => ({
  DeviceId: deviceId,
  StartDateEpoch: at(start),
  EndDateEpoch: at(end),
  RampTime: rampTime,
});

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Central time: CDT (UTC−5) in August, CST (UTC−6) in January.
assertEqual(
  reportDayBounds("2026-08-26T00:00:00.000Z").map((ms) => new Date(ms).toISOString()),
  ["2026-08-26T05:00:00.000Z", "2026-08-27T05:00:00.000Z"],
  "August day bounds"
);
assertEqual(
  reportDayBounds("2026-01-15").map((ms) => new Date(ms).toISOString()),
  ["2026-01-15T06:00:00.000Z", "2026-01-16T06:00:00.000Z"],
  "January day bounds"
);
assertEqual(
  reportDayBounds("2026-03-08").map((ms) => (ms / 60000)).reduce((a, b) => b - a),
  1380,
  "spring-forward day is 23 hours"
);

// CO returns a window of days for report date 2026-08-26 (Wed): Mon Aug 24 … Wed Sep 2.
const windowDays = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31", "2026-09-01", "2026-09-02"];
const rows = windowDays.map((d) => row(1, `${d}T11:30:00.000Z`, `${d}T21:00:00.000Z`, 30));
// Duplicate of the report-date row, and an overlapping pair for device 2.
rows.push(row(1, "2026-08-26T11:30:00.000Z", "2026-08-26T21:00:00.000Z", 30));
rows.push(row(2, "2026-08-26T11:00:00.000Z", "2026-08-26T15:00:00.000Z", 15));
rows.push(row(2, "2026-08-26T14:00:00.000Z", "2026-08-26T18:00:00.000Z", 0));
// Evening event 6–11pm local, which ends after UTC midnight.
rows.push(row(3, "2026-08-26T23:00:00.000Z", "2026-08-27T04:00:00.000Z", 0));
// 9–11pm local on Aug 26, stored with an Aug 27 UTC date.
rows.push(row(4, "2026-08-27T02:00:00.000Z", "2026-08-27T04:00:00.000Z", 0));
// Multi-day event (seen at Bartlesville): counts at most one day.
rows.push(row(5, "2026-08-26T02:45:00.000Z", "2026-09-03T05:00:00.000Z", 45));

assertEqual(rowsForReportDate(rows, "2026-08-26T00:00:00.000Z").length, 7, "rows overlapping report date");

const byDevice = scheduledMinutesByDevice(rows, "2026-08-26");
assertEqual(byDevice.get(1), { scheduledMinutes: 570, rampMinutes: 30 }, "device 1 counts one day, duplicate ignored");
assertEqual(byDevice.get(2), { scheduledMinutes: 420, rampMinutes: 15 }, "device 2 overlap counted once");
assertEqual(byDevice.get(3), { scheduledMinutes: 300, rampMinutes: 0 }, "device 3 evening event");
assertEqual(byDevice.get(4), { scheduledMinutes: 120, rampMinutes: 0 }, "device 4 late evening belongs to local date");
assertEqual(byDevice.get(5), { scheduledMinutes: 1440, rampMinutes: 0 }, "device 5 multi-day event clipped to one day");

// Previous evening's late event starts before the report day and is not counted.
assertEqual(scheduledMinutesByDevice(rows, "2026-08-27").get(4), undefined, "late event not counted on next date");

// Sunday report date: CO still returns weekday rows, none on the date itself.
const sundayRows = windowDays.slice(3).map((d) => row(1, `${d}T11:30:00.000Z`, `${d}T21:00:00.000Z`));
assertEqual(scheduledMinutesByDevice(sundayRows, "2026-08-30").size, 0, "Sunday has no scheduled minutes");

assertEqual(weekStartKey("2026-08-30"), "2026-08-24", "Sunday belongs to the week starting Monday");
assertEqual(weekStartKey("2026-08-31"), "2026-08-31", "Monday starts its own week");
assertEqual(
  weeklyTotals([
    { date: "2026-08-24", minutes: 570 },
    { date: "2026-08-25", minutes: 570 },
    { date: "2026-08-30", minutes: 0 },
    { date: "2026-08-31", minutes: 630 },
  ]),
  [
    { date: "2026-08-24", minutes: 1140 },
    { date: "2026-08-31", minutes: 630 },
  ],
  "weekly totals"
);

console.log("OK");
