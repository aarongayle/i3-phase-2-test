/**
 * Test: overnight setback audit from daily Pelican summaries.
 * Run with: node scripts/test-pelican-setbacks.js
 */
import assert from "node:assert/strict";
import { buildSetbackAudit } from "../lib/pelican-setbacks.js";

const end = "2026-10-06";
const day = (n) => new Date(Date.parse(`${end}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const rows = [];
for (let n = 40; n >= 0; n--) {
  // A: occupied days with a 50/90 setback the whole time.
  rows.push({ serialNo: "A", name: "E-101", groupName: "Elementary", date: day(n), minHeatSetpoint: 50, maxHeatSetpoint: 68, minCoolSetpoint: 72, maxCoolSetpoint: 90 });
  // B: cooling setback changed from 90 to 78 five days ago.
  rows.push({ serialNo: "B", name: "AD-201", groupName: "Admin", date: day(n), minHeatSetpoint: 50, maxHeatSetpoint: 68, minCoolSetpoint: 72, maxCoolSetpoint: n > 4 ? 90 : 78 });
  // C: held 58/72 all day, every day (no real setback).
  rows.push({ serialNo: "C", name: "AC-131", groupName: "Fine Arts", date: day(n), minHeatSetpoint: 58, maxHeatSetpoint: 58, minCoolSetpoint: 72, maxCoolSetpoint: 72 });
  // D: fan runs all day with the compressor off (fan set to On).
  rows.push({ serialNo: "D", name: "AD-251", groupName: "Admin", date: day(n), minHeatSetpoint: 50, maxHeatSetpoint: 68, minCoolSetpoint: 72, maxCoolSetpoint: 90, fanRuntime: 86400, coolRuntime: 0, heatRuntime: 0, occupiedTime: 0 });
  // Plant-loop sensor: ignored.
  rows.push({ serialNo: "P", name: "MS CHW", groupName: "HIDDEN", date: day(n), minHeatSetpoint: 70, maxHeatSetpoint: 70, minCoolSetpoint: 73, maxCoolSetpoint: 73 });
}
const audit = buildSetbackAudit(rows, {
  end,
  schedulesBySerial: new Map([["B", { scheduleOn: true, scheduleName: "Unoccupied 50-90", scheduleRepeat: "Weekday" }]]),
});
const units = Object.fromEntries(audit.units.rows.map((r) => [r[0], Object.fromEntries(audit.units.columns.map((c, i) => [c, r[i]]))]));

assert.equal(Object.keys(units).length, 4, "plant sensors are excluded");
assert.equal(units.A.heldHeatF, 50);
assert.equal(units.A.heldCoolF, 90);
assert.equal(units.A.coolChangedOn, null);
assert.equal(units.A.flatDaysPct, 0);
assert.equal(units.B.heldCoolF, 78);
assert.equal(units.B.priorCoolF, 90);
assert.equal(units.B.coolChangedOn, day(4));
assert.equal(units.B.scheduleName, "Unoccupied 50-90");
assert.equal(units.B.scheduleOn, true);
assert.equal(units.C.heldHeatF, 58);
assert.equal(units.C.heldCoolF, 72);
assert.equal(units.C.flatDaysPct, 100);
assert.equal(units.C.recentDays, 7);
assert.equal(units.D.fanOnlyHoursPerDay, 24);
assert.equal(units.A.fanOnlyHoursPerDay, 0);
console.log("pelican setbacks tests: OK");
