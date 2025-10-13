import { GoogleGenAI } from "@google/genai";
import analyzeXlsx from "llm-xlsx-parser";
import fs from "node:fs";
import path from "node:path";
import xlsxString from "./xlsx-from-string.js";

const ai = new GoogleGenAI({});
const model = "gemini-2.5-flash";
const outputDir = path.resolve("./images");

function ensureOutputDir() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function saveBase64Png(base64Data, filePath) {
  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
}

function loadXlsxBase64FromFile(filePath, fallbackBase64) {
  try {
    const absolutePath = path.resolve(filePath);
    if (fs.existsSync(absolutePath)) {
      return fs.readFileSync(absolutePath).toString("base64");
    }
  } catch (error) {
    console.warn(
      `Failed to read ${filePath}, falling back to embedded string:`,
      error?.message
    );
  }
  return fallbackBase64;
}

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

async function main() {
  // Prefer reading from local ./Book1.xlsx for faster iteration; fallback to embedded string
  const xlsxBase64 = loadXlsxBase64FromFile("./Book1.xlsx", xlsxString);

  const response = await analyzeXlsx(xlsxBase64, "./", {
    returnImageAsBase64: true,
    outputImage: true,
    sendCSV: false,
    sendJSON: false,
  });

  const imagesBase64 = normalizeToBase64Array(response);
  if (imagesBase64.length === 0) {
    console.log("No image(s) returned from analyzeXlsx.");
    return;
  }

  // Save discovered images to disk
  ensureOutputDir();
  imagesBase64.forEach((base64, index) => {
    const fileName =
      imagesBase64.length === 1 ? "image.png" : `sheet-${index + 1}.png`;
    const filePath = path.join(outputDir, fileName);
    saveBase64Png(base64, filePath);
  });
  console.log(`Saved ${imagesBase64.length} image(s) to ${outputDir}`);

  const imageParts = imagesBase64.map((b64) => ({
    inlineData: { mimeType: "image/png", data: b64 },
  }));

  const text = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "Are there any secret words encoded in the images? Describe them.",
          },
          ...imageParts,
        ],
      },
    ],
    config: {
      systemInstruction: `You are a secret word detector. You find secret words embedded in images and report those secret words to the user. You don't need to describe what you are doing or describe the context of the images. Simply return the secret workds in a list.
      Example:ethicist, hobby, telephone
      `,
    },
  });

  console.log(text.text);
}

main();
