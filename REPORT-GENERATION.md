# Report Generation Guide

## The Problem

Report generation takes **10+ minutes** for large datasets because it needs to:

1. Fetch hundreds of devices
2. Fetch hundreds of report dates
3. Fetch energy data for all dates
4. Aggregate metrics across all devices and dates

**Vercel serverless functions have a 5-minute timeout limit.** This means large reports will timeout if computed on-demand.

## Solution: Pre-compute Reports

For large datasets that take longer than 5 minutes, you need to **pre-compute** the report data.

### Step 1: Pre-compute Locally

Run the pre-computation script with your client ID:

```bash
pnpm precompute 1420
```

This will:

- Fetch all the data (takes as long as needed, no timeout)
- Aggregate device metrics
- Save to `campus-optimizer/data/compiled-{clientId}.json`
- Show timing information

Example output:

```
=== Pre-computing report for clientId: 1420 ===

Fetching devices and dates in parallel...
✓ Loaded 150 devices, 384 dates

Fetching energy data in parallel...
✓ Loaded energy data

Aggregating device metrics...
✓ Aggregation complete in 487.23s

✓ Saved to campus-optimizer/data/compiled-1420.json
✓ File size: 2.45 MB

=== Complete! ===
```

### Step 2: Serve Pre-computed Data

#### Option A: Use Vercel KV (Production)

Upload the pre-computed data to Vercel KV:

```bash
# Install Vercel KV CLI if needed
pnpm add -g @vercel/kv-cli

# Upload the data
vercel kv set compiled:1420 --file campus-optimizer/data/compiled-1420.json
```

The API will automatically serve from KV cache when available.

#### Option B: Serve Static File (Simple)

Just keep the generated JSON file and serve it statically. Update your API or serve it directly from the filesystem in local dev.

### Step 3: Keep Data Fresh

For production, you can:

1. **Manual updates**: Re-run `pnpm precompute [clientId]` when data changes
2. **Scheduled updates**: Set up a cron job or GitHub Action to run the script daily
3. **On-demand**: Create an admin endpoint that triggers the pre-computation

## For Development

The frontend uses individual API endpoints to fetch data incrementally with progress tracking. The main entry point is through the `fetchCompiledReportStream` function which calls:

- `/api/devices/[clientId]`
- `/api/dates/[clientId]`
- `/api/units`
- `/api/schedules/[clientId]/[date]`
- `/api/schedule-details/[clientId]/[date]`
- `/api/meters/[clientId]`
- `/api/intervals/[clientId]`

The client will show a loading spinner with progress updates as data is fetched.

## Optimization Tips

If aggregation is taking too long, consider:

1. **Parallel processing**: Process devices in batches
2. **Incremental updates**: Only recompute changed data
3. **Database indexing**: Optimize your data source queries
4. **Caching**: Cache intermediate results

## Architecture Considerations

For truly massive datasets, consider:

- **Background jobs**: Use a queue system (BullMQ, AWS SQS)
- **Streaming**: Return partial results as they're computed
- **CDN**: Serve pre-computed JSON from a CDN
- **Database**: Store aggregated data in a database instead of computing on-the-fly
