import assert from "node:assert/strict";
import { normalizeMeterCatalog } from "../lib/meter-catalog.js";
import { buildReportAnalytics } from "../lib/report-analytics.js";

const exactEsiId = "10032789440552938123";
const meterCatalog = normalizeMeterCatalog(
  [
    {
      Id: 9678,
      Name: "HS Gym_Auditorium",
      MeterNumber: "558785333",
      EsiIdNumber: exactEsiId,
      AccountNumber: "321",
      UtilityTypeId: 1,
    },
    {
      Id: 9999,
      Name: "Configured Without Analytics",
      MeterNumber: null,
      EsiIdNumber: null,
      AccountNumber: null,
      UtilityTypeId: null,
    },
  ],
  [{ Id: 1, Name: "Electricity" }]
);

assert.deepEqual(meterCatalog[0], {
  meterId: "9678",
  meterName: "HS Gym_Auditorium",
  meterNumber: "558785333",
  esiId: exactEsiId,
  accountNumber: "321",
  utilityType: "electric",
});
assert.deepEqual(meterCatalog[1], {
  meterId: "9999",
  meterName: "Configured Without Analytics",
  meterNumber: null,
  esiId: null,
  accountNumber: null,
  utilityType: null,
});
assert.equal(
  JSON.parse(JSON.stringify(meterCatalog))[0].esiId,
  exactEsiId,
  "ESI ID must survive JSON serialization without numeric precision loss"
);

const analytics = buildReportAnalytics(
  {
    report: {
      meta: {
        clientId: 1420,
        firstReportDate: "2026-08-01",
        mostRecentDate: "2026-08-01",
      },
      devices: [],
      energy: {
        expected: [
          {
            Id: 9678,
            Name: "HS Gym_Auditorium",
            Interval: [{ date: "2026-08-01", interval: 0, value: 10 }],
          },
          {
            Id: 1234,
            Name: "Analytics Meter Missing Config",
            Interval: [{ date: "2026-08-01", interval: 0, value: 5 }],
          },
        ],
        actual: [
          {
            Id: 9678,
            Name: "HS Gym_Auditorium",
            Interval: [{ date: "2026-08-01", interval: 0, value: 20 }],
          },
          {
            Id: 1234,
            Name: "Analytics Meter Missing Config",
            Interval: [{ date: "2026-08-01", interval: 0, value: 6 }],
          },
        ],
      },
    },
  },
  { meterCatalog }
);

assert.equal(analytics.meterCatalog.length, 2);
assert.equal(
  analytics.meterCatalog[1].meterId,
  "9999",
  "catalog must include configured meters absent from ranked analytics"
);

const enriched = analytics.reports[0].meters.find(
  (meter) => meter.meterId === "9678"
);
assert.equal(enriched.meterNumber, "558785333");
assert.equal(enriched.esiId, exactEsiId);
assert.equal(enriched.accountNumber, "321");
assert.equal(enriched.utilityType, "electric");

const missing = analytics.reports[0].meters.find(
  (meter) => meter.meterId === "1234"
);
assert.equal(missing.meterNumber, null);
assert.equal(missing.esiId, null);
assert.equal(missing.accountNumber, null);
assert.equal(missing.utilityType, null);

console.log("meter catalog tests: OK");
