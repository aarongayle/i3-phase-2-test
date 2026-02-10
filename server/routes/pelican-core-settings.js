// Express Route: GET/POST /api/pelican/core-settings/:clientId
// Wrapper around pelican-history that renames setpoint fields to occupied/unoccupied terminology
// Queries all Pelican sites for a client automatically

import { Router } from "express";
import { getBuildings, getDevices } from "../../campus-optimizer/co-api.js";
import {
  fetchAllThermostatsForSiteDate,
  summarizeThermostatDay,
} from "./pelican-history.js";

const router = Router();

const DEFAULT_DAYS = 2;

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

    // Build lookup map - CO devices may have various serial number fields
    const coDevicesByName = new Map();
    for (const d of coDevices) {
      if (d?.Name) {
        coDevicesByName.set(d.Name.toLowerCase(), d);
      }
    }

    // Get all buildings and extract unique Pelican sites with credentials
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
          const thermostats = await fetchAllThermostatsForSiteDate(
            site.siteSlug,
            site.username,
            site.password,
            queryDate
          );

          for (const t of thermostats) {
            const summary = summarizeThermostatDay(t, queryDate);
            const key = `${site.siteSlug}:${summary.serialNo}`;

            if (!deviceMap.has(key)) {
              // Try to find CO device by name match
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
          console.error(`[Pelican Core Settings] Error fetching ${site.siteSlug} for ${queryDate}:`, error.message);
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
