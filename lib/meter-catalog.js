import { getMeters, getUtilityTypes } from "./co-client.js";

function nullableString(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function canonicalUtilityType(value) {
  const normalized = nullableString(value)?.trim().toLowerCase() || null;
  if (normalized === "electricity") return "electric";
  return normalized;
}

export function normalizeMeterCatalog(meters, utilityTypes = []) {
  const utilityTypesById = new Map(
    (utilityTypes || []).map((utilityType) => [
      nullableString(utilityType?.Id ?? utilityType?.id),
      utilityType?.Name ?? utilityType?.name,
    ])
  );

  return (meters || []).map((meter) => {
    const utilityTypeId = nullableString(
      meter?.UtilityTypeId ?? meter?.utilityTypeId
    );
    const utilityTypeName =
      meter?.UtilityType ??
      meter?.utilityType ??
      utilityTypesById.get(utilityTypeId);

    return {
      meterId: nullableString(meter?.Id ?? meter?.id ?? meter?.MeterId),
      meterName: nullableString(meter?.Name ?? meter?.name ?? meter?.MeterName),
      meterNumber: nullableString(meter?.MeterNumber ?? meter?.meterNumber),
      esiId: nullableString(
        meter?.EsiIdNumber ?? meter?.EsiId ?? meter?.esiId
      ),
      accountNumber: nullableString(
        meter?.AccountNumber ?? meter?.accountNumber
      ),
      utilityType: canonicalUtilityType(utilityTypeName),
    };
  });
}

export async function loadMeterCatalog(clientId) {
  const [meters, utilityTypes] = await Promise.all([
    getMeters(clientId),
    getUtilityTypes(),
  ]);
  return normalizeMeterCatalog(meters, utilityTypes);
}
