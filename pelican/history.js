import dotenv from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

dotenv.config();

const HISTORY_VALUE_TEMPLATE = Object.freeze({
  timestamp: "",
  name: "",
  groupName: "",
  serialNo: "",
  system: "",
  heatSetting: "",
  coolSetting: "",
  fan: "",
  status: "",
  temperature: "",
  humidity: "",
  humidifySetting: "",
  dehumidifySetting: "",
  co2Setting: "",
  co2Level: "",
  setBy: "",
  frontKeypad: "",
  runStatus: "",
  auxStatus: "",
  slaves: "",
  setback: "",
});

const DEFAULT_HISTORY_FIELDS = Object.freeze(
  Object.keys(HISTORY_VALUE_TEMPLATE)
);

const MAX_RANGE_DAYS = 30;
const DEFAULT_CHUNK_DAYS = 30;
const DEFAULT_HISTORY_YEARS = 2;

function normalizeSerial(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function sanitizeFileSegment(value, fallback = "segment") {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned || fallback;
}

function getRangeFileName(selection, index = 0) {
  const startSegment = sanitizeFileSegment(selection?.startDateTime, "start");
  const endSegment = sanitizeFileSegment(selection?.endDateTime, "end");
  const indexSegment = String(index).padStart(4, "0");
  return `${startSegment}__${endSegment}__${indexSegment}.json`;
}

/**
 * Extract date from timestamp string (format: "2025-08-30T00:01")
 */
function extractDateFromTimestamp(timestamp) {
  if (!timestamp) return null;
  const match = String(timestamp).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Group history entries by date and write to organized file structure
 * Structure: {baseDir}/{siteSlug}/{serialNo}/{year}/{month}/{day}.json
 */
async function writeThermostatHistoryByDate({
  baseDir,
  siteSlug,
  entry,
  onEntryWritten,
}) {
  const serialNo = entry?.serialNo;
  if (!serialNo) {
    console.warn("history-stream:write:missing-serial", { entry });
    return null;
  }

  const serialSegment = sanitizeFileSegment(serialNo, "unknown");

  // Extract history records from entry
  const historyRecords = Array.isArray(entry?.History) ? entry.History : [];
  if (historyRecords.length === 0) {
    return null;
  }

  // Group records by date
  const recordsByDate = new Map();
  for (const record of historyRecords) {
    const date = extractDateFromTimestamp(record?.timestamp);
    if (!date) continue;

    if (!recordsByDate.has(date)) {
      recordsByDate.set(date, []);
    }
    recordsByDate.get(date).push(record);
  }

  const writtenFiles = [];

  // Write one file per date
  for (const [date, records] of recordsByDate.entries()) {
    const [year, month, day] = date.split("-");
    const targetDir = path.resolve(
      baseDir,
      siteSlug,
      serialSegment,
      year,
      month
    );
    await mkdir(targetDir, { recursive: true });

    const fileName = `${day}.json`;
    const targetPath = path.join(targetDir, fileName);

    // Read existing file if it exists and merge
    let existingRecords = [];
    try {
      const existingContent = await readFile(targetPath, "utf8");
      const existingData = JSON.parse(existingContent);
      existingRecords = Array.isArray(existingData) ? existingData : [];
    } catch {
      // File doesn't exist yet, that's fine
    }

    // Merge and deduplicate by timestamp
    const recordMap = new Map();
    for (const record of [...existingRecords, ...records]) {
      const key = record.timestamp;
      if (key && !recordMap.has(key)) {
        recordMap.set(key, record);
      }
    }

    const mergedRecords = Array.from(recordMap.values()).sort((a, b) => {
      return (a.timestamp || "").localeCompare(b.timestamp || "");
    });

    const payload = JSON.stringify(mergedRecords, null, 2);
    await writeFile(targetPath, payload, "utf8");

    console.log("history-stream:write", {
      siteSlug,
      serialNo,
      date,
      entries: mergedRecords.length,
      file: targetPath,
    });

    writtenFiles.push({
      path: targetPath,
      date,
      entryCount: mergedRecords.length,
    });

    // Callback for metadata updates
    if (typeof onEntryWritten === "function") {
      await onEntryWritten({
        siteSlug,
        serialNo,
        date,
        entryCount: mergedRecords.length,
        filePath: targetPath,
      });
    }
  }

  return writtenFiles;
}

// Keep old function for backward compatibility but mark as deprecated
async function writeThermostatHistoryEntry({
  baseDir,
  siteSlug,
  selection,
  entry,
  raw,
  index,
}) {
  const serialSegment = sanitizeFileSegment(entry?.serialNo, "unknown");
  const targetDir = path.resolve(baseDir, siteSlug, serialSegment);
  await mkdir(targetDir, { recursive: true });
  const fileName = getRangeFileName(selection, index);
  const targetPath = path.join(targetDir, fileName);
  const payload = raw ?? JSON.stringify(entry, null, 2);
  await writeFile(targetPath, payload, "utf8");
  console.log("history-stream:write", {
    siteSlug,
    serialNo: entry?.serialNo ?? null,
    file: targetPath,
  });
  return targetPath;
}

function extractMessageFromTail(tailText) {
  if (!tailText) return null;
  const match = tailText.match(/"message"\s*:\s*(null|"(?:\\.|[^"])*")/);
  if (!match) return null;
  const raw = match[1];
  if (raw === "null") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw.replace(/^"|"$/g, "");
  }
}

function createHistoryStreamParser({ onHistory, tailLimit = 10_000 }) {
  const KEY = '"ThermostatHistory"';
  let bufferChunks = []; // Use array to avoid string concatenation slowdown
  let bufferLength = 0;
  let capturing = false;
  let historyFound = false;
  let historyCompleted = false;
  let inString = false;
  let escapeNext = false;
  let braceDepth = 0;
  let objectStart = -1;
  let tailText = "";
  let entryIndex = 0;

  const emitHistory = async (jsonSlice) => {
    let parsed;
    try {
      parsed = JSON.parse(jsonSlice);
    } catch (error) {
      console.error("history-stream:entry-parse-error", error, {
        preview: jsonSlice.slice(0, 200),
      });
      throw error;
    }
    const meta = {
      index: entryIndex,
      serialNo: parsed?.serialNo ?? null,
    };
    entryIndex += 1;
    // Log progress every 100 entries instead of every entry
    if (entryIndex % 100 === 0) {
      console.log("history-stream:entries:progress", {
        entriesProcessed: entryIndex,
      });
    }
    if (typeof onHistory === "function") {
      await onHistory(parsed, jsonSlice, meta);
    }
  };

  const appendTail = (text) => {
    if (!text) return;
    tailText += text;
    if (tailText.length > tailLimit) {
      tailText = tailText.slice(-tailLimit);
    }
  };

  const feed = async (chunk) => {
    if (!chunk) return;

    if (historyCompleted) {
      appendTail(chunk);
      return;
    }

    bufferChunks.push(chunk);
    bufferLength += chunk.length;

    // Join buffer only once per feed call
    let buffer = bufferChunks.join("");

    while (buffer) {
      if (!capturing) {
        const keyIndex = buffer.indexOf(KEY);
        if (keyIndex === -1) {
          if (buffer.length > KEY.length) {
            buffer = buffer.slice(buffer.length - KEY.length);
          }
          bufferChunks = [buffer];
          bufferLength = buffer.length;
          return;
        }
        const arrayStart = buffer.indexOf("[", keyIndex + KEY.length);
        if (arrayStart === -1) {
          buffer = buffer.slice(keyIndex);
          bufferChunks = [buffer];
          bufferLength = buffer.length;
          return;
        }
        historyFound = true;
        buffer = buffer.slice(arrayStart + 1);
        capturing = true;
        inString = false;
        escapeNext = false;
        braceDepth = 0;
        objectStart = -1;
        console.log("history-stream:array:start");
      }

      let index = 0;
      while (index < buffer.length) {
        const char = buffer[index];

        if (inString) {
          if (escapeNext) {
            escapeNext = false;
          } else if (char === "\\") {
            escapeNext = true;
          } else if (char === '"') {
            inString = false;
          }
          index += 1;
          continue;
        }

        if (char === '"') {
          inString = true;
          index += 1;
          continue;
        }

        if (char === "{") {
          if (braceDepth === 0) {
            objectStart = index;
          }
          braceDepth += 1;
          index += 1;
          continue;
        }

        if (char === "}") {
          if (braceDepth > 0) {
            braceDepth -= 1;
          }

          if (braceDepth === 0 && objectStart !== -1) {
            const jsonSlice = buffer.slice(objectStart, index + 1);
            buffer = buffer.slice(index + 1).replace(/^[\s,]+/, "");
            objectStart = -1;
            index = 0;
            await emitHistory(jsonSlice);
            continue;
          }

          index += 1;
          continue;
        }

        if (char === "]" && braceDepth === 0) {
          const remainder = buffer.slice(index + 1);
          appendTail(remainder);
          bufferChunks = [];
          bufferLength = 0;
          capturing = false;
          historyCompleted = true;
          return;
        }

        index += 1;
      }

      if (objectStart > 0) {
        buffer = buffer.slice(objectStart);
        objectStart = 0;
      }

      // Update buffer chunks at the end
      bufferChunks = [buffer];
      bufferLength = buffer.length;

      return;
    }
  };

  const finalize = () => {
    return {
      historyFound,
      historyCompleted,
      entryCount: entryIndex,
      message: extractMessageFromTail(tailText),
    };
  };

  return {
    feed,
    finalize,
  };
}

function getCredentials() {
  const username = process.env.PELICAN_USERNAME?.trim();
  const password = process.env.PELICAN_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error(
      "PELICAN_USERNAME and PELICAN_PASSWORD must be set before using the Pelican history client."
    );
  }
  return { username, password };
}

function toPelicanDateTime(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

function normalizeDateInput(input, label) {
  if (!input) return null;
  let value;
  if (input instanceof Date) {
    value = new Date(input.getTime());
  } else if (typeof input === "string") {
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      value = new Date(`${trimmed}T00:00:00`);
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      value = new Date(`${trimmed}Z`);
    } else {
      value = new Date(trimmed);
    }
  } else {
    value = new Date(input);
  }
  if (Number.isNaN(value.valueOf())) {
    throw new Error(`Invalid ${label} provided.`);
  }
  return value;
}

function resolveDateRange({
  startDateTime,
  endDateTime,
  defaultYears = DEFAULT_HISTORY_YEARS,
}) {
  let end = normalizeDateInput(endDateTime, "endDateTime") ?? new Date();
  end.setHours(23, 59, 59, 999);

  let start =
    normalizeDateInput(startDateTime, "startDateTime") ?? new Date(end);
  if (!startDateTime) {
    start.setFullYear(start.getFullYear() - defaultYears);
  }
  start.setHours(0, 0, 0, 0);

  if (start > end) {
    throw new Error("startDateTime must be before endDateTime.");
  }

  return {
    start,
    end,
    startISO: toPelicanDateTime(start),
    endISO: toPelicanDateTime(end),
  };
}

function splitDateRange(
  startDateTime,
  endDateTime,
  chunkDays = DEFAULT_CHUNK_DAYS
) {
  if (!startDateTime || !endDateTime) {
    throw new Error("startDateTime and endDateTime are required.");
  }

  if (chunkDays < 1 || chunkDays > MAX_RANGE_DAYS) {
    throw new Error(
      `chunkDays must be between 1 and ${MAX_RANGE_DAYS} (received ${chunkDays}).`
    );
  }

  const start = new Date(startDateTime);
  const end = new Date(endDateTime);

  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    throw new Error("Invalid startDateTime or endDateTime provided.");
  }

  if (start > end) {
    throw new Error("startDateTime must be before endDateTime.");
  }

  const ranges = [];
  const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
  let cursor = new Date(start);

  while (cursor <= end) {
    const rangeStart = new Date(cursor);
    const rawEndMs = rangeStart.getTime() + chunkMs - 1;
    const rangeEnd = new Date(Math.min(end.getTime(), rawEndMs));
    rangeEnd.setHours(23, 59, 59, 999);
    if (rangeEnd > end) {
      rangeEnd.setTime(end.getTime());
    }

    ranges.push({
      startDateTime: toPelicanDateTime(rangeStart),
      endDateTime: toPelicanDateTime(rangeEnd),
    });

    const nextStart = new Date(rangeEnd);
    nextStart.setDate(nextStart.getDate() + 1);
    nextStart.setHours(0, 0, 0, 0);

    if (nextStart <= rangeStart) {
      break;
    }

    cursor = nextStart;
  }

  return ranges;
}

function buildHistoryTransaction(selection, fields) {
  let value;
  if (Array.isArray(fields) && fields.length > 0) {
    value = Object.fromEntries(
      fields.map((field) => [field, HISTORY_VALUE_TEMPLATE[field] ?? ""])
    );
  } else {
    value = { ...HISTORY_VALUE_TEMPLATE };
  }
  return [
    {
      request: "get",
      object: "ThermostatHistory",
      selection,
      value,
    },
  ];
}

async function postPelican(
  siteSlug,
  transactions,
  signal,
  username,
  password,
  options = {}
) {
  // const { username, password } = getCredentials();
  console.log("postPelican:start", {
    siteSlug,
    transactionCount: transactions?.length ?? 0,
    hasSignal: Boolean(signal),
  });
  const startedAt = Date.now();
  const response = await fetch(
    `https://${siteSlug}.officeclimatecontrol.net/api.cgi`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ username, password, transactions }),
      signal,
    }
  );

  console.log("postPelican:response", {
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    headers: {
      "content-length": response.headers.get("content-length"),
      "content-type": response.headers.get("content-type"),
      "transfer-encoding": response.headers.get("transfer-encoding"),
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Pelican request failed (${response.status}): ${details.slice(
        0,
        200
      )}`.trim()
    );
  }

  // Prefer streaming the response to incrementally emit history entries
  const reader =
    response.body && typeof response.body.getReader === "function"
      ? response.body.getReader()
      : null;
  const collected = [];

  if (reader) {
    console.log("postPelican:stream:start");
    const decoder = new TextDecoder();

    // Optional: stream raw response to file to avoid memory issues
    let rawResponseFileHandle = null;
    if (options.streamRawToFile) {
      const { open } = await import("node:fs/promises");
      rawResponseFileHandle = await open(options.streamRawToFile, "w");
      console.log("postPelican:stream:raw-file", {
        path: options.streamRawToFile,
      });
    }

    const parser = createHistoryStreamParser({
      onHistory: async (entry, rawEntry, meta) => {
        collected.push(entry);
        if (typeof options.onHistory === "function") {
          await options.onHistory(entry, rawEntry, meta);
        }
      },
    });

    let totalBytes = 0;
    let chunkCount = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value ? value.length : 0;
      chunkCount += 1;
      // Log first chunk to confirm streaming started
      if (chunkCount === 1) {
        console.log("postPelican:stream:first-chunk", {
          bytes: value?.length || 0,
        });
      }
      // Log progress every 10 chunks or every 100KB
      if (chunkCount % 10 === 0 || totalBytes % 100000 < (value?.length || 0)) {
        console.log("postPelican:stream:progress", {
          chunks: chunkCount,
          bytesReceived: totalBytes,
          mbReceived: (totalBytes / 1024 / 1024).toFixed(2),
        });
      }
      const chunkText = decoder.decode(value, { stream: true });

      // Stream to file if enabled (avoids memory accumulation)
      if (rawResponseFileHandle) {
        await rawResponseFileHandle.write(chunkText, "utf8");
      }

      await parser.feed(chunkText);
    }

    // Flush any remaining decoder buffer and feed to parser
    const tailText = decoder.decode();
    if (tailText) {
      if (rawResponseFileHandle) {
        await rawResponseFileHandle.write(tailText, "utf8");
      }
      await parser.feed(tailText);
      console.log("history-stream:decoder:flushed");
    }

    // Close the raw response file
    if (rawResponseFileHandle) {
      await rawResponseFileHandle.close();
      console.log("postPelican:stream:raw-file:closed");
    }

    const summary = parser.finalize();
    console.log("postPelican:stream:done", {
      bytes: totalBytes,
      entries: collected.length,
      historyFound: summary.historyFound,
      historyCompleted: summary.historyCompleted,
    });

    let parsed = {
      result: [
        {
          ThermostatHistory: collected,
          message: summary.message ?? null,
        },
      ],
    };

    // If parsing failed to extract entries, try reading from the file
    if (collected.length === 0 && options.streamRawToFile) {
      console.log("history-stream:fallback:file-parse:start", {
        file: options.streamRawToFile,
      });
      try {
        const { readFile } = await import("node:fs/promises");
        const rawChunks = await readFile(options.streamRawToFile, "utf8");
        const full = JSON.parse(rawChunks);
        const entries = full?.result?.[0]?.ThermostatHistory;
        if (Array.isArray(entries)) {
          for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const rawEntry = JSON.stringify(entry);
            collected.push(entry);
            if (typeof options.onHistory === "function") {
              await options.onHistory(entry, rawEntry, { index });
            }
          }
          console.log("history-stream:fallback:file-parse:emitted", {
            entries: entries.length,
          });
        }
        parsed = full;
      } catch (_e) {
        console.log("history-stream:fallback:file-parse:failed");
      }
    }

    if (typeof options.onPayload === "function") {
      await options.onPayload(parsed, "");
    }

    return parsed;
  }

  // Fallback to non-streaming if a reader is not available
  const rawBody = await response.text();
  console.log("postPelican:body", {
    length: rawBody.length,
    preview: rawBody.slice(0, 120),
  });

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error) {
    console.error("postPelican:parse-error", error, {
      preview: rawBody.slice(0, 200),
    });
    throw error;
  }

  if (typeof options.onPayload === "function") {
    await options.onPayload(parsed, rawBody);
  }

  if (typeof options.onHistory === "function") {
    const entries = parsed?.result?.[0]?.ThermostatHistory;
    if (Array.isArray(entries)) {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const rawEntry = JSON.stringify(entry);
        await options.onHistory(entry, rawEntry, { index });
      }
    }
  }

  return parsed;
}

function extractHistory(payload) {
  const firstResult = payload?.result?.[0];
  if (!firstResult) {
    throw new Error("Pelican response did not include a result array.");
  }

  const history = firstResult.ThermostatHistory;
  if (!Array.isArray(history)) {
    throw new Error("Pelican response did not include ThermostatHistory data.");
  }

  return {
    history,
    message: firstResult.message ?? null,
  };
}

export function createRangeChunks(options) {
  const { startISO, endISO } = resolveDateRange(options || {});
  return splitDateRange(startISO, endISO, options?.chunkDays);
}

export async function fetchThermostatHistory({
  siteSlug,
  startDateTime,
  endDateTime,
  serialNumber,
  serialNumbers,
  username,
  password,
  fields = DEFAULT_HISTORY_FIELDS,
  chunkDays = DEFAULT_CHUNK_DAYS,
  defaultYears = DEFAULT_HISTORY_YEARS,
  signal,
  onChunk,
  streamOutputDir,
  onEntryWritten,
  useDateOrganization = true, // New: use date-organized file structure
}) {
  if (!siteSlug) {
    throw new Error("siteSlug is required.");
  }

  const { startISO, endISO } = resolveDateRange({
    startDateTime,
    endDateTime,
    defaultYears,
  });

  const serialFilter = serialNumber
    ? [serialNumber]
    : Array.isArray(serialNumbers) && serialNumbers.length > 0
    ? serialNumbers
    : null;

  const ranges = splitDateRange(startISO, endISO, chunkDays);
  let totalEntriesProcessed = 0;

  console.log("fetchThermostatHistory:prepared", {
    siteSlug,
    serialNumber,
    serialNumbers: serialFilter,
    totalRanges: ranges.length,
    rangeSample: ranges[0],
    useDateOrganization,
  });

  const normalizedStreamDir = streamOutputDir
    ? path.resolve(streamOutputDir)
    : null;

  for (const [rangeIndex, range] of ranges.entries()) {
    console.log("fetchThermostatHistory:range:start", range);
    const selection = { ...range };
    if (serialFilter) {
      selection.ThermostatSerialNo = serialFilter;
    }
    const transactions = buildHistoryTransaction(selection, fields);
    let streamWritesForRange = 0;

    // Create temp file path for streaming raw response
    const rawResponseFile = normalizedStreamDir
      ? path.join(
          normalizedStreamDir,
          siteSlug,
          `raw-response-${rangeIndex}.json`
        )
      : null;

    if (rawResponseFile) {
      await mkdir(path.dirname(rawResponseFile), { recursive: true });
    }

    const payload = await postPelican(
      siteSlug,
      transactions,
      signal,
      username,
      password,
      {
        streamRawToFile: rawResponseFile, // Stream chunks directly to file
        onHistory: normalizedStreamDir
          ? async (entry, rawEntry, meta) => {
              if (useDateOrganization) {
                // Use new date-organized writing
                const writtenFiles = await writeThermostatHistoryByDate({
                  baseDir: normalizedStreamDir,
                  siteSlug,
                  entry,
                  onEntryWritten,
                });
                if (writtenFiles && writtenFiles.length > 0) {
                  streamWritesForRange += writtenFiles.length;
                  totalEntriesProcessed += entry?.History?.length || 0;
                }
              } else {
                // Use old format for backward compatibility
                await writeThermostatHistoryEntry({
                  baseDir: normalizedStreamDir,
                  siteSlug,
                  selection: range,
                  entry,
                  raw: rawEntry,
                  index: meta?.index ?? 0,
                });
                streamWritesForRange += 1;
                totalEntriesProcessed += 1;
              }
            }
          : undefined,
      }
    );
    console.log("fetchThermostatHistory:range:received", {
      range,
      hasResult: Boolean(payload?.result?.length),
    });
    console.log("fetchThermostatHistory:range:payload", {
      hasResult: Boolean(payload?.result?.length),
      keys: payload ? Object.keys(payload) : null,
    });
    const { history, message } = extractHistory(payload);
    const entries = serialFilter
      ? history.filter((item) =>
          serialFilter.some(
            (targetSerial) =>
              String(item?.serialNo).toLowerCase().trim() ===
              String(targetSerial).toLowerCase().trim()
          )
        )
      : history;

    // Fallback: if streaming did not write any files for this range, write now
    if (
      normalizedStreamDir &&
      streamWritesForRange === 0 &&
      entries.length > 0
    ) {
      console.log("history-stream:fallback:range:write", {
        range,
        entries: entries.length,
      });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (useDateOrganization) {
          await writeThermostatHistoryByDate({
            baseDir: normalizedStreamDir,
            siteSlug,
            entry,
            onEntryWritten,
          });
        } else {
          const rawEntry = JSON.stringify(entry);
          await writeThermostatHistoryEntry({
            baseDir: normalizedStreamDir,
            siteSlug,
            selection: range,
            entry,
            raw: rawEntry,
            index: i,
          });
        }
      }
      totalEntriesProcessed += entries.length;
    }

    if (typeof onChunk === "function") {
      await onChunk({
        range,
        entries,
        message,
      });
    }
  }

  console.log("fetchThermostatHistory:completed", {
    serialNumber,
    serialNumbers: serialFilter,
    entriesProcessed: totalEntriesProcessed,
  });

  // Return summary instead of full data array
  return {
    siteSlug,
    entriesProcessed: totalEntriesProcessed,
    rangesProcessed: ranges.length,
  };
}

export { DEFAULT_HISTORY_FIELDS, DEFAULT_HISTORY_YEARS };
