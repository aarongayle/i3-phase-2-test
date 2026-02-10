// Express Route: GET/POST /api/pelican/core-settings/:clientId
// Returns occupied/unoccupied setpoints aggregated across multiple days
// Uses Supabase cache first, falls back to Pelican API

import { Router } from "express";
import { getBuildings, getDevices } from "../../campus-optimizer/co-api.js";
import {
  fetchAllThermostatsForSiteDate,
  fetchThermostatCoreSettingsForSite,
  getCachedThermostatSettingsFromSupabase,
  normalizeSerial,
  saveThermostatCoreSettingsToSupabase,
  summarizeThermostatDay,
  getCachedSummariesFromSupabase,
  saveSummariesToSupabase,
  isSupabaseEnabled,
} from "./pelican-history.js";

const router = Router();

const DEFAULT_DAYS = 2;

function hasValidCoreSettingPair(setting) {
  const maxHeatSetting = Number(setting?.maxHeatSetting);
  const minCoolSetting = Number(setting?.minCoolSetting);
  return (
    Number.isFinite(maxHeatSetting) &&
    Number.isFinite(minCoolSetting) &&
    maxHeatSetting !== 0 &&
    minCoolSetting !== 0
  );
}

/**
 * Get summaries for a site/date, using cache first
 */
async function getSummariesForSiteDate(clientId, siteSlug, username, password, date) {
  // Try Supabase cache first
  if (isSupabaseEnabled) {
    try {
      const cached = await getCachedSummariesFromSupabase(clientId, siteSlug, date);
      if (cached.length > 0) {
        console.log(`[Pelican Core Settings] ✅ Cache hit for ${siteSlug}/${date}: ${cached.length} thermostats`);
        return cached;
      }
    } catch (error) {
      console.warn(`[Pelican Core Settings] Cache lookup failed: ${error.message}`);
    }
  }

  // Fall back to Pelican API
  console.log(`[Pelican Core Settings] Cache miss, fetching from Pelican: ${siteSlug}/${date}`);
  const thermostats = await fetchAllThermostatsForSiteDate(siteSlug, username, password, date);
  const summaries = thermostats.map((t) => summarizeThermostatDay(t, date));

  // Save to cache for next time
  if (isSupabaseEnabled && summaries.length > 0) {
    try {
      await saveSummariesToSupabase(summaries, clientId, siteSlug);
    } catch (error) {
      console.warn(`[Pelican Core Settings] Failed to save to cache: ${error.message}`);
    }
  }

  return summaries;
}

async function handleRequest(req, res) {
  try {
    const { clientId } = req.params;
    const { siteSlug: filterSiteSlug, days: daysParam } = { ...req.query, ...req.body };

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    const days = Math.min(Math.max(Number(daysParam) || DEFAULT_DAYS, 1), 7);

    // Get CO devices for name lookup
    let coDevices = [];
    try {
      coDevices = await getDevices(Number(clientId));
    } catch (error) {
      console.warn(`[Pelican Core Settings] Could not fetch CO devices: ${error.message}`);
    }

    const coDevicesByName = new Map();
    for (const d of coDevices) {
      if (d?.Name) {
        coDevicesByName.set(d.Name.toLowerCase(), d);
      }
    }

    // Get all buildings and extract unique Pelican sites
    const buildings = await getBuildings(Number(clientId));
    const seen = new Set();
    const sites = [];

    for (const b of buildings) {
      const siteSlug = String(b?.PelicanSubdomain || "").trim();
      if (!siteSlug || seen.has(siteSlug.toLowerCase())) continue;
      seen.add(siteSlug.toLowerCase());

      const username = String(b?.PelicanUsername || "").trim();
      const password = String(b?.PelicanPassword || "").trim();

      if (username && password) {
        if (!filterSiteSlug || siteSlug.toLowerCase() === filterSiteSlug.toLowerCase()) {
          sites.push({ siteSlug, username, password, buildingName: b?.Name || "" });
        }
      }
    }

    if (sites.length === 0) {
      return res.status(404).json({ error: "No Pelican sites found for this client" });
    }

    // Build list of dates to query
    const dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split("T")[0]);
    }

    // Aggregate setpoints by serialNo across all days
    const deviceMap = new Map();

    for (const site of sites) {
      for (const queryDate of dates) {
        try {
          const summaries = await getSummariesForSiteDate(
            clientId,
            site.siteSlug,
            site.username,
            site.password,
            queryDate
          );

          for (const summary of summaries) {
            const key = `${site.siteSlug}:${summary.serialNo}`;

            if (!deviceMap.has(key)) {
              const coDevice = summary.name ? coDevicesByName.get(summary.name.toLowerCase()) : null;

              deviceMap.set(key, {
                pelicanId: summary.serialNo,
                name: coDevice?.Name || summary.name || summary.serialNo,
                groupName: summary.groupName,
                siteSlug: site.siteSlug,
                buildingName: site.buildingName,
                coDeviceId: coDevice?.Id || null,
                maxHeat: null,
                minHeat: null,
                maxCool: null,
                minCool: null,
                maxHeatSetting: null,
                minCoolSetting: null,
              });
            }

            const device = deviceMap.get(key);

            // Update name if we find a better one
            if (!device.name || device.name === device.pelicanId) {
              if (summary.name) {
                const coDevice = coDevicesByName.get(summary.name.toLowerCase());
                device.name = coDevice?.Name || summary.name;
                device.coDeviceId = coDevice?.Id || device.coDeviceId;
              }
            }

            // Aggregate min/max across days
            if (summary.maxHeatSetpoint !== null) {
              device.maxHeat = device.maxHeat === null
                ? summary.maxHeatSetpoint
                : Math.max(device.maxHeat, summary.maxHeatSetpoint);
            }
            if (summary.minHeatSetpoint !== null) {
              device.minHeat = device.minHeat === null
                ? summary.minHeatSetpoint
                : Math.min(device.minHeat, summary.minHeatSetpoint);
            }
            if (summary.maxCoolSetpoint !== null) {
              device.maxCool = device.maxCool === null
                ? summary.maxCoolSetpoint
                : Math.max(device.maxCool, summary.maxCoolSetpoint);
            }
            if (summary.minCoolSetpoint !== null) {
              device.minCool = device.minCool === null
                ? summary.minCoolSetpoint
                : Math.min(device.minCool, summary.minCoolSetpoint);
            }
          }
        } catch (error) {
          console.error(`[Pelican Core Settings] Error for ${site.siteSlug}/${queryDate}:`, error.message);
        }
      }

      const siteDevices = Array.from(deviceMap.values()).filter(
        (device) => device.siteSlug === site.siteSlug
      );
      const siteSerials = Array.from(
        new Set(siteDevices.map((device) => String(device.pelicanId || "").trim()).filter(Boolean))
      );

      if (siteSerials.length > 0) {
        try {
          const thermostatSettingsBySerial = new Map();
          let missingSerials = siteSerials;

          if (isSupabaseEnabled) {
            try {
              const cachedSettings = await getCachedThermostatSettingsFromSupabase(
                clientId,
                site.siteSlug,
                siteSerials
              );
              for (const setting of cachedSettings) {
                // Treat 0/0 cache rows as missing so we refetch from Pelican.
                if (!hasValidCoreSettingPair(setting)) continue;
                thermostatSettingsBySerial.set(
                  normalizeSerial(setting.serialNo),
                  setting
                );
              }
              missingSerials = siteSerials.filter(
                (serial) => !thermostatSettingsBySerial.has(normalizeSerial(serial))
              );
            } catch (cacheError) {
              console.warn(
                `[Pelican Core Settings] Thermostat settings cache lookup failed for ${site.siteSlug}: ${cacheError.message}`
              );
            }
          }

          if (missingSerials.length > 0) {
            const fetchedSettings = await fetchThermostatCoreSettingsForSite(
              site.siteSlug,
              site.username,
              site.password,
              missingSerials
            );

            for (const setting of fetchedSettings) {
              if (!hasValidCoreSettingPair(setting)) continue;
              thermostatSettingsBySerial.set(
                normalizeSerial(setting.serialNo),
                setting
              );
            }

            if (isSupabaseEnabled && fetchedSettings.length > 0) {
              try {
                await saveThermostatCoreSettingsToSupabase(
                  fetchedSettings,
                  clientId,
                  site.siteSlug
                );
              } catch (saveError) {
                console.warn(
                  `[Pelican Core Settings] Failed to cache thermostat settings for ${site.siteSlug}: ${saveError.message}`
                );
              }
            }
          }

          for (const device of siteDevices) {
            const setting = thermostatSettingsBySerial.get(normalizeSerial(device.pelicanId));
            if (!setting) continue;
            if (setting.maxHeatSetting !== null && setting.maxHeatSetting !== 0) {
              device.maxHeatSetting = setting.maxHeatSetting;
            }
            if (setting.minCoolSetting !== null && setting.minCoolSetting !== 0) {
              device.minCoolSetting = setting.minCoolSetting;
            }
          }
        } catch (error) {
          console.warn(
            `[Pelican Core Settings] Thermostat settings fetch failed for ${site.siteSlug}: ${error.message}`
          );
        }
      }
    }

    // Transform to final format
    const devices = Array.from(deviceMap.values()).map((d) => ({
      pelicanId: d.pelicanId,
      name: d.name,
      groupName: d.groupName,
      siteSlug: d.siteSlug,
      buildingName: d.buildingName,
      coDeviceId: d.coDeviceId,
      heatingOccupiedSetpoint: d.maxHeat,
      heatingUnoccupiedSetpoint: d.minHeat,
      coolingOccupiedSetpoint: d.minCool,
      coolingUnoccupiedSetpoint: d.maxCool,
      maxHeatSetting: d.maxHeatSetting,
      minCoolSetting: d.minCoolSetting,
    }));

    return res.status(200).json({
      devices,
      query: { clientId, siteSlug: filterSiteSlug || null, days, dates },
      summary: { deviceCount: devices.length, siteCount: sites.length },
    });
  } catch (error) {
    console.error("[Pelican Core Settings] Error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}

router.get("/:clientId", handleRequest);
router.post("/:clientId", handleRequest);

export default router;
