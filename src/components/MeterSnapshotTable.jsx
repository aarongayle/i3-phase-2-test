import {
  dailyAggregates,
  fmt,
  meterNameFor,
  perMeterLatestDayTotals,
  uniqueSortedDatesFromMaps,
} from "../utils/chartData";

export default function MeterSnapshotTable({ energyExpected, energyActual }) {
  if (!energyExpected?.length && !energyActual?.length) {
    return (
      <div className="text-gray-500 text-sm p-4">No energy data available</div>
    );
  }

  const { totals: dailyExpectedMap } = dailyAggregates(energyExpected);
  const { totals: dailyActualMap } = dailyAggregates(energyActual);
  const labels = uniqueSortedDatesFromMaps(dailyExpectedMap, dailyActualMap);
  const latestDate = labels.length ? labels[labels.length - 1] : null;

  const latestExpectedByMeter = perMeterLatestDayTotals(
    energyExpected,
    latestDate
  );
  const latestActualByMeter = perMeterLatestDayTotals(energyActual, latestDate);

  const meterIdSet = new Set([
    ...Array.from(latestExpectedByMeter.keys()),
    ...Array.from(latestActualByMeter.keys()),
  ]);

  const meterRows = Array.from(meterIdSet).map((id) => {
    const name = meterNameFor(id, energyExpected, energyActual);
    const exp = latestExpectedByMeter.get(id) || 0;
    const act = latestActualByMeter.get(id) || 0;
    const delta = act - exp;

    return {
      id,
      name,
      expected: exp,
      actual: act,
      delta,
    };
  });

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900">
          Meter Energy Snapshot{latestDate ? ` — ${latestDate}` : ""}
        </h3>
      </div>
      <div className="border-t border-gray-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Meter
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Expected (daily total)
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Actual (daily total)
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Delta (A - E)
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {meterRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {row.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                    {fmt(row.expected)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                    {fmt(row.actual)}
                  </td>
                  <td
                    className={`px-6 py-4 whitespace-nowrap text-sm text-right ${
                      row.delta >= 0 ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {fmt(row.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
