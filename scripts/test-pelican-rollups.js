#!/usr/bin/env node
/**
 * Tests for raw-reading day metrics (lib/pelican-day-metrics.js) and
 * Pelican rollups (lib/pelican-rollups.js).
 *   node scripts/test-pelican-rollups.js
 */
import assert from "node:assert/strict";
import { computeDayMetrics } from "../lib/pelican-day-metrics.js";
import { buildPelicanRollups } from "../lib/pelican-rollups.js";

const at = (hhmm, extra) => ({ timestamp: `2026-08-26T${hhmm}`, setBy: "Schedule", fan: "Auto", runStatus: "Off", ...extra });
const occupied = (e) => Number(e.coolSetting) < 85 || Number(e.heatSetting) > 55;

// --- day metrics -----------------------------------------------------------
{
  const entries = [
    at("00:00", { heatSetting: 50, coolSetting: 90, temperature: 78 }),
    at("23:00", { heatSetting: 50, coolSetting: 90, temperature: 78, runStatus: "Cool-Stage1" }),
    at("07:00", { heatSetting: 64, coolSetting: 69, temperature: 72, humidity: 70, runStatus: "Cool-Stage2" }),
    at("08:00", { heatSetting: 64, coolSetting: 69, temperature: 69.5, humidity: 60, runStatus: "Cool-Stage1" }),
    at("09:00", { heatSetting: 64, coolSetting: 72, temperature: 71, humidity: 60, setBy: "Station" }),
    at("11:00", { heatSetting: 64, coolSetting: 69, temperature: 69, humidity: 60, runStatus: "Off" }),
    at("17:00", { heatSetting: 50, coolSetting: 90, temperature: 75 }),
  ];
  const m = computeDayMetrics(entries, occupied);
  assert.equal(m.occupiedMinutes, 600, "07:00–17:00 occupied");
  assert.equal(m.comfortMissMinutes, 60, "72°F vs 69°F cool setpoint for one hour");
  assert.equal(m.scheduledOccupiedCool, 69);
  assert.equal(m.coolRaisedMinutes, 120, "raised to 72 at the thermostat 09:00–11:00");
  assert.equal(m.maxCoolSetAtThermostat, 72);
  assert.equal(m.stage2DirectStarts, 1, "07:00 call starts in stage 2");
  assert.equal(m.overnightRuntimeMinutes, 60, "23:00–24:00 running");
  assert.equal(m.overnightOccupiedRuntimeMinutes, 0, "overnight runtime was at setback");
  assert.equal(m.humidityMax, 70);
  assert.equal(m.fanOnMinutes, 0);
}

// --- plant loop sensor -----------------------------------------------------
{
  const loop = (hhmm, supply, ret) =>
    at(hhmm, { slaves: [{ name: "CHW Supply", type: "Temp Monitor", value: supply }, { name: "CHW Return", type: "Temp Monitor", value: ret }] });
  const m = computeDayMetrics([loop("09:00", 50, 55), loop("10:00", 58, 61), loop("15:00", 44, 50)], () => false);
  assert.deepEqual(m.loop, { supplyDaytimeAvg: 58, returnDaytimeAvg: 61, supplyMin: 44 });
}

// --- rollups ---------------------------------------------------------------
{
  const day = (date, serialNo, groupName, coolH, heatH, occH, metrics) => ({
    date, serialNo, name: serialNo, groupName,
    coolRuntime: coolH * 3600, heatRuntime: heatH * 3600, occupiedTime: occH * 3600, entryCount: 10, metrics,
  });
  const rows = [
    day("2026-03-02", "A", "MS Main", 0, 4, 10),
    day("2026-03-03", "A", "MS Main", 0, 2, 10),
    day("2026-03-02", "B", "Elementary", 0, 1, 10),
    day("2026-08-26", "A", "MS Main", 12, 0, 10, { occupiedMinutes: 600, comfortMissMinutes: 300, humidityAvg: 75, humidityMax: 80, coolRaisedMinutes: 0, callStarts: 4, stage2DirectStarts: 2 }),
    day("2026-08-26", "B", "Elementary", 3, 0, 10, { occupiedMinutes: 600, comfortMissMinutes: 60, humidityAvg: 60, humidityMax: 62, coolRaisedMinutes: 90, callStarts: 4, stage2DirectStarts: 0 }),
    day("2026-08-29", "C", "Portables", 2, 0, 0),
    day("2026-08-26", "LOOP", "HIDDEN", 0, 0, 0, { loop: { supplyDaytimeAvg: 58, returnDaytimeAvg: 60.8, supplyMin: 45 } }),
  ];
  const r = buildPelicanRollups(rows);
  assert.deepEqual(r.window, { start: "2026-03-02", end: "2026-08-29", days: 4 });
  assert.deepEqual(r.bands, { le50: 1, from50to100: 1, over100: 0, noOccupied: 1 });
  const a = r.units.find((u) => u.serialNo === "A");
  assert.equal(a.runtimeOverOccupiedPct, 60);
  assert.equal(a.outsideSetpointPct, 50);
  assert.equal(a.stage2DirectStartPct, 50);
  assert.equal(r.units.find((u) => u.serialNo === "B").daysRaisedAtThermostat, 1);
  assert.equal(r.units.find((u) => u.serialNo === "C").unoccupiedDayRuntimeH, 2);
  assert.ok(!r.units.some((u) => u.groupName === "HIDDEN"), "plant sensors aren't units");
  const march = r.monthly.find((m) => m.month === "2026-03" && m.groupName === "MS Main");
  assert.equal(march.heatHPerUnitDay, 3);
  assert.equal(r.groups.find((g) => g.groupName === "MS Main").humidityAvg, 75);
  assert.equal(r.plantLoops[0].days[0].supplyDaytimeAvg, 58);
  assert.deepEqual(r.rawMetricsCoverage, { days: 1, firstDate: "2026-08-26" });
}

// --- older cached days with blank names/groups (Beeville backfill) -----------
{
  const day = (date, serialNo, name, groupName, heatH, metrics) => ({
    date, serialNo, name, groupName, coolRuntime: 0, heatRuntime: heatH * 3600, occupiedTime: 10 * 3600, entryCount: 10, metrics,
  });
  const r = buildPelicanRollups([
    day("2026-01-05", "A", "", "", 2),
    day("2026-02-05", "A", "JH-305 old", "300s", 2),
    day("2026-03-05", "A", "JH-305", "300s", 2),
    day("2026-01-05", "LOOP", "", "", 0),
    day("2026-03-05", "LOOP", "CHW", "HIDDEN", 0, { loop: { supplyDaytimeAvg: 50, returnDaytimeAvg: 55, supplyMin: 44 } }),
  ]);
  assert.deepEqual(r.units.map((u) => [u.serialNo, u.name, u.groupName]), [["A", "JH-305", "300s"]], "latest name, blank days, no plant sensor");
  assert.ok(r.monthly.every((m) => m.groupName === "300s"), "blank-group days count under the unit's group");
}

console.log("pelican rollups tests: OK");
