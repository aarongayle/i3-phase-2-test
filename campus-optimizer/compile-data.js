import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import {
  actualEnergyUse,
  expectedEnergyUse,
  getDevices,
  getOptimalSchedules,
  getReportDates,
  getUnits,
} from "./co-api.js";

dotenv.config();

async function main() {
  const clientId = 1420;

  const dataDir = path.resolve("./campus-optimizer/data");
  fs.mkdirSync(dataDir, { recursive: true });

  const units = await getUnits();
  const devices = await getDevices(clientId);
  const dates = await getReportDates(clientId);

  if (!Array.isArray(dates) || dates.length === 0) {
    const empty = { meta: { clientId, reportsCount: 0 }, devices: [] };
    fs.writeFileSync(
      path.join(dataDir, "compiled.json"),
      JSON.stringify({ report: empty }, null, 2)
    );
    console.log("No report dates available. Wrote empty compiled.json");
    return;
  }

  const sortedDates = [...dates]
    .map((d) => d.report_date)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b));

  const totalSchedules = sortedDates.length;
  const schedulesByDate = await Promise.all(
    sortedDates.map((d, i) =>
      getOptimalSchedules(clientId, d, {
        label: `schedule ${i + 1}/${totalSchedules}`,
      })
    )
  );

  const mostRecentDate = sortedDates[sortedDates.length - 1];

  function toKW(capacity, unitId, unitList) {
    const unit = unitList.find((u) => u.Id === unitId);
    return capacity * (unit?.KWConversionFactor ?? 1);
  }

  const deviceAggregates = new Map();

  devices.forEach((device) => {
    deviceAggregates.set(device.Id, {
      Id: device.Id,
      Name: device.Name,
      Description: device.Description,
      HeatingKW: toKW(device.HeatingCapacity, device.HeatingUnitId, units.heat),
      CoolingKW: toKW(device.CoolingCapacity, device.CoolingUnitId, units.cool),
      sumRuntimeMin: 0,
      sumRamptimeMin: 0,
      daysCounted: 0,
      RuntimeWeekly: [],
      RamptimeWeekly: [],
      Runtime: 0,
      Ramptime: 0,
    });
  });

  schedulesByDate.forEach((daySchedules, dayIndex) => {
    const dateString = sortedDates[dayIndex];
    devices.forEach((device) => {
      const scheduleForDevice = daySchedules.filter(
        (s) => s.DeviceId === device.Id
      );
      const runtimeMin =
        scheduleForDevice.reduce(
          (acc, curr) => acc + (curr.EndDateEpoch - curr.StartDateEpoch),
          0
        ) /
        1000 /
        60;
      const ramptimeMin = scheduleForDevice.reduce(
        (acc, curr) => acc + (curr.RampTime || 0),
        0
      );

      const agg = deviceAggregates.get(device.Id);
      agg.sumRuntimeMin += runtimeMin;
      agg.sumRamptimeMin += ramptimeMin;
      agg.daysCounted += 1;

      if (dayIndex % 7 === 0) {
        agg.RuntimeWeekly.push({ date: dateString, minutes: runtimeMin });
        agg.RamptimeWeekly.push({ date: dateString, minutes: ramptimeMin });
      }

      if (dayIndex === schedulesByDate.length - 1) {
        agg.Runtime = runtimeMin;
        agg.Ramptime = ramptimeMin;
      }
    });
  });

  const report = devices.map((device) => {
    const agg = deviceAggregates.get(device.Id);
    const days = Math.max(1, agg.daysCounted);
    return {
      Name: agg.Name,
      Description: agg.Description,
      HeatingKW: agg.HeatingKW,
      CoolingKW: agg.CoolingKW,
      Runtime: agg.Runtime,
      Ramptime: agg.Ramptime,
      RuntimeAvg: agg.sumRuntimeMin / days,
      RamptimeAvg: agg.sumRamptimeMin / days,
      RuntimeWeekly: agg.RuntimeWeekly,
      RamptimeWeekly: agg.RamptimeWeekly,
    };
  });

  // Meter-level energy use (expected vs actual)
  const [energyExpected, energyActual] = await Promise.all([
    expectedEnergyUse(clientId),
    actualEnergyUse(clientId),
  ]);

  const llmPayload = {
    meta: {
      clientId,
      reportsCount: sortedDates.length,
      firstReportDate: sortedDates[0],
      mostRecentDate,
    },
    devices: report.map((d) => ({
      name: d.Name,
      description: d.Description,
      coolingKW: d.CoolingKW,
      heatingKW: d.HeatingKW,
      runtimeAvgMin: d.RuntimeAvg,
      ramptimeAvgMin: d.RamptimeAvg,
      runtimeLatestMin: d.Runtime,
      ramptimeLatestMin: d.Ramptime,
      runtimeWeekly: d.RuntimeWeekly,
      ramptimeWeekly: d.RamptimeWeekly,
    })),
    energy: {
      expected: energyExpected,
      actual: energyActual,
    },
  };

  const out = { report: llmPayload };
  const outPath = path.join(dataDir, "compiled.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error("compile-data failed:", err);
  process.exitCode = 1;
});
