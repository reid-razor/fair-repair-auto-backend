/**
 * Fair Repair Auto — JSON-ONLY Backend (FINAL, SHAPE-SAFE)
 *
 * • Supports BOTH flat JSON and { data: {...} } wrapped JSON
 * • Source of truth: ./data/<make>.json
 * • Lookup path (normalized):
 *     make → (data || root) → model → year → repairSlug
 */

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getLaborMultiplier } from "./laborRates.js";
import { zipToState } from "./zipToState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const DATA_DIR = path.join(__dirname, "data");
const cache = new Map();

/* -------------------------
   Normalization
-------------------------- */

const norm = (v) =>
  String(v || "").trim().toLowerCase();

const normYear = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
};

const normSlug = (v) =>
  norm(v).replace(/_/g, "-");

/* -------------------------
   JSON loading (shape-safe)
-------------------------- */

function loadMake(make) {
  const key = norm(make);
  if (!key) return null;

  if (cache.has(key)) return cache.get(key);

  const filePath = path.join(DATA_DIR, `${key}.json`);
  if (!fs.existsSync(filePath)) {
    cache.set(key, null);
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

    // 👇 CRITICAL LINE: support BOTH shapes
    const data = raw.data && typeof raw.data === "object"
      ? raw.data
      : raw;

    cache.set(key, data);
    return data;
  } catch (err) {
    console.error("JSON parse error:", err);
    cache.set(key, null);
    return null;
  }
}

/* -------------------------
   Health
-------------------------- */

app.get("/", (_, res) => {
  res.json({
    ok: true,
    service: "fair-repair-auto-api",
    mode: "json-only",
  });
});

/* -------------------------
   QUOTE
-------------------------- */

app.post("/api/quote", (req, res) => {
  const make = norm(req.body.make);
  const model = norm(req.body.model);
  const year = normYear(req.body.year);
  const repairSlug = normSlug(req.body.repairSlug);
  const zip = norm(req.body.zip);

  if (!make || !model || !year || !repairSlug) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT",
    });
  }

  const makeData = loadMake(make);
  if (!makeData) {
    return res.json({ ok: true, available: false, reason: "MAKE_NOT_FOUND" });
  }

  const modelData = makeData[model];
  if (!modelData) {
    return res.json({ ok: true, available: false, reason: "MODEL_NOT_FOUND" });
  }

  const yearData = modelData[year];
  if (!yearData) {
    return res.json({ ok: true, available: false, reason: "YEAR_NOT_FOUND" });
  }

  const record = yearData[repairSlug];
  if (!record || !record.total) {
    return res.json({ ok: true, available: false, reason: "REPAIR_NOT_FOUND" });
  }

  const state = zip ? zipToState(zip) : null;
  const multiplier = state ? getLaborMultiplier(state) : 1;

  res.json({
    ok: true,
    available: true,
    match: {
      make,
      model,
      year: Number(year),
      repairSlug,
      title: record.title,
    },
    price: {
      low: Math.round(record.total.low * multiplier),
      high: Math.round(record.total.high * multiplier),
    },
    labor: record.labor
      ? {
          low: Math.round(record.labor.low * multiplier),
          high: Math.round(record.labor.high * multiplier),
        }
      : null,
    parts: record.parts || null,
    state,
    multiplier,
    source: record.source || "JSON",
  });
});

/* -------------------------
   START
-------------------------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Fair Repair Auto API running on port ${PORT}`);
});
