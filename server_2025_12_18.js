/**
 * Fair Repair Auto — JSON-only backend
 * Server version: 2025-12-18
 * Data source: local JSON files only (NO Vehicle Databases)
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// --- ESM helpers ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- App setup ---
const app = express();
app.use(express.json());

// --- Load Acura JSON once at startup ---
const acuraDataPath = path.join(__dirname, "data", "acura.json");

let acuraJSON;
try {
  acuraJSON = JSON.parse(fs.readFileSync(acuraDataPath, "utf-8"));
  console.log("✅ Acura JSON loaded");
} catch (err) {
  console.error("❌ Failed to load Acura JSON", err);
  process.exit(1);
}

// --- Health check ---
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "fair-repair-auto-api",
    mode: "json-only",
    timestamp: new Date().toISOString()
  });
});

// --- Quote endpoint ---
app.post("/api/quote", (req, res) => {
  const { make, model, year, repairSlug, zip } = req.body;

  // ---- Basic validation ----
  if (!make || !model || !year || !repairSlug || !zip) {
    return res.status(400).json({
      ok: false,
      message: "Missing required fields"
    });
  }

  // ---- Only Acura supported for now ----
  if (make.toLowerCase() !== "acura") {
    return res.json({
      ok: true,
      available: false,
      reason: "MAKE_NOT_SUPPORTED"
    });
  }

  const modelKey = model.toLowerCase();
  const yearKey = String(year);

  const modelBlock = acuraJSON.data?.[modelKey];
  if (!modelBlock) {
    return res.json({
      ok: true,
      available: false,
      reason: "MODEL_NOT_FOUND"
    });
  }

  const yearBlock = modelBlock[yearKey];
  if (!yearBlock) {
    return res.json({
      ok: true,
      available: false,
      reason: "YEAR_NOT_FOUND"
    });
  }

  const repairBlock = yearBlock[repairSlug];
  if (!repairBlock) {
    return res.json({
      ok: true,
      available: false,
      reason: "REPAIR_NOT_FOUND"
    });
  }

  // ---- Success ----
  return res.json({
    ok: true,
    available: true,
    source: "json",
    inputs: {
      make: "acura",
      model: modelKey,
      year: year,
      repairSlug,
      zip
    },
    price: {
      parts: repairBlock.parts,
      labor: repairBlock.labor,
      total: repairBlock.total
    }
  });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Fair Repair Auto API running on port ${PORT}`);
});
