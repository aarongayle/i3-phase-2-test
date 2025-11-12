import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadMetadata } from "./metadata.js";

/**
 * Load the metadata index
 */
export async function loadMetadataIndex(baseDir) {
  return loadMetadata(baseDir);
}

/**
 * Find files that match the query criteria
 */
export function findFilesForQuery(metadata, { siteSlug, serialNo, startDate, endDate, baseDir }) {
  const files = [];
  
  if (!siteSlug || !serialNo || !startDate || !endDate) {
    return files;
  }

  const site = metadata.sites[siteSlug];
  if (!site) return files;

  const device = site.devices[serialNo];
  if (!device) return files;

  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Find all date ranges that overlap with query
  const matchingRanges = device.dateRanges.filter((range) => {
    const rangeDate = new Date(range.date);
    return rangeDate >= start && rangeDate <= end;
  });

  return matchingRanges.map((range) => ({
    path: baseDir ? path.resolve(baseDir, range.filePath) : range.filePath,
    date: range.date,
    entryCount: range.entryCount,
  }));
}

/**
 * Query history files and return results with pagination
 */
export async function queryFiles(files, { page = 0, limit = 1000, baseDir }) {
  const results = [];
  let skipped = 0;
  let yielded = 0;
  const skipCount = page * limit;

  for (const file of files) {
    if (yielded >= limit) {
      break;
    }

    try {
      const filePath = path.isAbsolute(file.path) 
        ? file.path 
        : (baseDir ? path.join(baseDir, file.path) : file.path);
      
      const content = await readFile(filePath, "utf8");
      const data = JSON.parse(content);
      
      // Handle both formats: single entry with History array, or array of entries
      let entries = [];
      if (Array.isArray(data)) {
        entries = data;
      } else if (data.History && Array.isArray(data.History)) {
        entries = data.History.map((entry) => ({
          ...entry,
          serialNo: data.serialNo,
          name: data.name,
          groupName: data.groupName,
        }));
      } else if (data.timestamp) {
        // Single entry
        entries = [data];
      }

      // Filter by date range if needed
      for (const entry of entries) {
        if (skipped < skipCount) {
          skipped++;
          continue;
        }

        if (yielded >= limit) {
          break;
        }

        results.push(entry);
        yielded++;
      }
    } catch (error) {
      console.error(`Error reading ${file.path}:`, error.message);
    }
  }

  return {
    data: results,
    pagination: {
      page,
      limit,
      hasMore: yielded === limit && files.length > 0,
      totalReturned: results.length,
    },
  };
}

/**
 * Get summary statistics for a query
 */
export async function getQuerySummary(metadata, { siteSlug, serialNo, startDate, endDate, baseDir }) {
  const files = findFilesForQuery(metadata, { siteSlug, serialNo, startDate, endDate, baseDir });
  
  let totalEntries = 0;
  let totalFiles = files.length;
  
  for (const file of files) {
    totalEntries += file.entryCount || 0;
  }

  return {
    siteSlug,
    serialNo,
    dateRange: { start: startDate, end: endDate },
    totalFiles,
    totalEntries,
    estimatedPages: Math.ceil(totalEntries / 1000),
  };
}

