# Pelican History Data Collection & Query System

This system optimizes the collection and querying of Pelican thermostat history data with minimal memory usage and efficient file organization.

## Overview

The system has been optimized to:
- ✅ **Remove memory accumulation** - Data streams directly to disk
- ✅ **Organize files by date** - `{siteSlug}/{serialNo}/{year}/{month}/{day}.json`
- ✅ **Generate metadata index** - Fast lookups without scanning files
- ✅ **Provide query API** - Paginated queries via HTTP endpoint
- ✅ **Support incremental updates** - Merge new data with existing files

## File Structure

```
pelican/data/history-stream/
  metadata.json                    # Index of all available data
  {siteSlug}/
    {serialNo}/
      {year}/
        {month}/
          {day}.json              # One file per day per device
```

## Collection (Data Fetching)

### Basic Usage

```javascript
import { fetchThermostatHistory } from './pelican/history.js';
import { loadMetadata, saveMetadata, updateMetadataForEntry } from './pelican/metadata.js';

const streamOutputDir = path.join(process.cwd(), 'pelican', 'data', 'history-stream');
const metadata = await loadMetadata(streamOutputDir);

const result = await fetchThermostatHistory({
  siteSlug: 'Beevilleisd-ad-maint-cn',
  startDateTime: '2025-08-30',
  endDateTime: '2025-08-31',
  username: 'your-username',
  password: 'your-password',
  streamOutputDir,
  useDateOrganization: true, // Use new date-organized structure
  onEntryWritten: async ({ siteSlug, serialNo, date, entryCount, filePath }) => {
    // Update metadata index as files are written
    updateMetadataForEntry(metadata, {
      siteSlug,
      serialNo,
      date,
      entryCount,
      filePath,
      baseDir: streamOutputDir,
    });
  },
});

// Save metadata index
await saveMetadata(streamOutputDir, metadata);
```

### Running the Collection Script

```bash
node pelican/pelican-api.js
```

This will:
1. Fetch buildings for clientId 1420
2. Collect history data for all sites
3. Write files organized by date
4. Generate/update metadata index

## Querying Data

### Via API Endpoint

```javascript
// GET /api/pelican/history/[clientId]
// Query parameters:
//   - siteSlug: Required - Site identifier
//   - serialNo: Required - Device serial number
//   - startDate: Required - Start date (YYYY-MM-DD)
//   - endDate: Required - End date (YYYY-MM-DD)
//   - page: Optional - Page number (default: 0)
//   - limit: Optional - Results per page (default: 1000)

const response = await fetch(
  '/api/pelican/history/1420?siteSlug=Beevilleisd-ad-maint-cn&serialNo=8A3-1TRZ&startDate=2025-08-30&endDate=2025-08-31&page=0&limit=1000'
);

const data = await response.json();
// {
//   data: [...], // Array of history entries
//   pagination: {
//     page: 0,
//     limit: 1000,
//     hasMore: true,
//     totalReturned: 1000
//   },
//   query: { ... }
// }
```

### Programmatic Query

```javascript
import { loadMetadataIndex, findFilesForQuery, queryFiles } from './pelican/query.js';

const baseDir = path.join(process.cwd(), 'pelican', 'data', 'history-stream');

// Load metadata
const metadata = await loadMetadataIndex(baseDir);

// Find files matching query
const files = findFilesForQuery(metadata, {
  siteSlug: 'Beevilleisd-ad-maint-cn',
  serialNo: '8A3-1TRZ',
  startDate: '2025-08-30',
  endDate: '2025-08-31',
  baseDir,
});

// Query with pagination
const result = await queryFiles(files, {
  page: 0,
  limit: 1000,
  baseDir,
});

console.log(result.data); // Array of history entries
console.log(result.pagination); // Pagination info
```

## Frontend Integration

### React Hook Example

```javascript
// src/hooks/usePelicanHistory.js
import { useState, useEffect } from 'react';

export function usePelicanHistory({ clientId, siteSlug, serialNo, startDate, endDate }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  const loadPage = async (pageNum) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        siteSlug,
        serialNo,
        startDate,
        endDate,
        page: String(pageNum),
        limit: '1000',
      });
      
      const response = await fetch(`/api/pelican/history/${clientId}?${params}`);
      const result = await response.json();
      
      if (pageNum === 0) {
        setData(result.data);
      } else {
        setData(prev => [...prev, ...result.data]);
      }
      
      setHasMore(result.pagination.hasMore);
      setPage(pageNum);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      loadPage(page + 1);
    }
  };

  useEffect(() => {
    loadPage(0);
  }, [clientId, siteSlug, serialNo, startDate, endDate]);

  return { data, loading, error, hasMore, loadMore };
}
```

### Usage in Component

```javascript
import { usePelicanHistory } from '../hooks/usePelicanHistory';

function ThermostatHistory({ clientId, siteSlug, serialNo }) {
  const { data, loading, hasMore, loadMore } = usePelicanHistory({
    clientId,
    siteSlug,
    serialNo,
    startDate: '2025-08-30',
    endDate: '2025-08-31',
  });

  return (
    <div>
      {data.map(entry => (
        <div key={entry.timestamp}>
          {entry.timestamp}: {entry.temperature}°F
        </div>
      ))}
      {hasMore && (
        <button onClick={loadMore} disabled={loading}>
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

## Metadata Index Format

The `metadata.json` file structure:

```json
{
  "sites": {
    "Beevilleisd-ad-maint-cn": {
      "devices": {
        "8A3-1TRZ": {
          "dateRanges": [
            {
              "date": "2025-08-30",
              "entryCount": 144,
              "filePath": "Beevilleisd-ad-maint-cn/8A3-1TRZ/2025/08/30.json"
            }
          ],
          "totalEntries": 144,
          "lastUpdated": "2025-01-15T10:30:00Z"
        }
      }
    }
  },
  "indexVersion": "1.0",
  "lastUpdated": "2025-01-15T10:30:00Z"
}
```

## Key Optimizations

1. **No Memory Accumulation**: Data streams directly to disk, never loads everything into memory
2. **Date Organization**: Files organized by date for efficient querying
3. **Metadata Index**: Fast lookups without scanning all files
4. **Pagination**: API supports pagination for large result sets
5. **Caching**: API responses cached for 5 minutes (via Vercel KV if available)
6. **Incremental Updates**: New data merges with existing files, deduplicates by timestamp

## Migration from Old Format

If you have existing data in the old format (`{siteSlug}/{serialNo}/{date-range}.json`), you can migrate it by:

1. Reading old files
2. Extracting history records
3. Writing them using the new `writeThermostatHistoryByDate` function
4. Updating metadata index

The query functions support both formats for backward compatibility.





