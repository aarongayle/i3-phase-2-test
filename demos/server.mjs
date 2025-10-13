import express from "express";
import analyzeXlsx from "llm-xlsx-parser";
import path from "node:path";

function normalizeToBase64Array(response) {
  if (!response) return [];
  if (typeof response === "string") return [response];
  const sheets = Array.isArray(response)
    ? response
    : Object.values(response || {});
  return sheets
    .map((sheet) => (typeof sheet === "string" ? sheet : sheet?.image))
    .filter(Boolean);
}

const app = express();
app.use(express.json({ limit: "25mb" }));

app.post("/api/analyze-xlsx", async (req, res) => {
  try {
    const { xlsxBase64 } = req.body || {};
    if (!xlsxBase64 || typeof xlsxBase64 !== "string") {
      return res.status(400).json({
        error: "Missing or invalid 'xlsxBase64' string in request body.",
      });
    }

    const cwd = path.resolve("./");
    const response = await analyzeXlsx(xlsxBase64, cwd, {
      returnImageAsBase64: true,
      outputImage: false,
      sendCSV: false,
      sendJSON: false,
    });

    const imagesBase64 = normalizeToBase64Array(response);
    return res.json(imagesBase64);
  } catch (error) {
    console.error("/api/analyze-xlsx error:", error);
    return res.status(500).json({ error: "Failed to analyze XLSX" });
  }
});

app.get("/health", (_req, res) => {
  return res.json({ status: "ok" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
