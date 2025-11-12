import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const METADATA_FILE = "metadata.json";

export async function loadMetadata(baseDir) {
  const metadataPath = path.join(baseDir, METADATA_FILE);
  try {
    const content = await readFile(metadataPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    // Return empty metadata if file doesn't exist
    return {
      sites: {},
      indexVersion: "1.0",
      lastUpdated: new Date().toISOString(),
    };
  }
}

export async function saveMetadata(baseDir, metadata) {
  const metadataPath = path.join(baseDir, METADATA_FILE);
  metadata.lastUpdated = new Date().toISOString();
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

export function updateMetadataForEntry(metadata, { siteSlug, serialNo, date, entryCount, filePath, baseDir }) {
  if (!metadata.sites[siteSlug]) {
    metadata.sites[siteSlug] = { devices: {} };
  }

  const site = metadata.sites[siteSlug];
  if (!site.devices[serialNo]) {
    site.devices[serialNo] = {
      dateRanges: [],
      totalEntries: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  const device = site.devices[serialNo];
  
  // Check if this date range already exists
  const existingRange = device.dateRanges.find((r) => r.date === date);
  const relativePath = baseDir ? path.relative(baseDir, filePath) : filePath;
  
  if (existingRange) {
    existingRange.entryCount = entryCount;
    existingRange.filePath = relativePath;
  } else {
    device.dateRanges.push({
      date,
      entryCount,
      filePath: relativePath,
    });
    device.dateRanges.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Update total entries (recalculate from all ranges)
  device.totalEntries = device.dateRanges.reduce(
    (sum, range) => sum + range.entryCount,
    0
  );
  device.lastUpdated = new Date().toISOString();
}

let baseDirCache = null;

export function setBaseDir(baseDir) {
  baseDirCache = baseDir;
}

export function getBaseDir() {
  return baseDirCache;
}

