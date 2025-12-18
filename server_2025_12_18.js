/**
 * Fair Repair Auto — JSON-ONLY Backend
 * Version: 2025-12-18
 *
 * • NO Vehicle Databases
 * • Reads local JSON only
 * • Source of truth: ./data/<make>.json
 * • Lookup path: data → model → year → repairSlug
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const DATA_DIR = path.join(__dirname, "data");
const makeCache = new Map();

/* -------------------------
   Normalization helpers
-------------------------- */

const normalize = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

const normalizeYear = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
};

const normalizeRepairSlug = (v) =>
  normalize(v).replace(/_/g, "-");

/* -------------------------
   JSON loading
-------------------------- */

function loadMakeJSON(make) {
  const key = normalize(make);
  if (!key) return null;

  if (makeCache.has(key)) {
    return makeCache.get(key);
  }

  const filePath = path.join(DATA_DIR, `${key}.json`);
  if (!fs.existsSync(filePath)) {
    makeCache.set(key, null);
    return null;
  }

  try {
    const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
    makeCache.set(key, json);
    return json;
  } catch (err) {
    console.error("JSON parse error:", err);
    makeCache.set(key, null);
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
    version: "2025-12-18",
  });
});

/* -------------------------
   OPTIONS (for dropdown UX)
-------------------------- */

// Years (union across all makes)
app.get("/api/options/years", (_, res) => {
  const years = new Set();

  if (!fs.existsSync(DATA_DIR)) {
    return res.json({ ok: true, years: [] });
  }

  fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .forEach((file) => {
      const doc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file)));
      const data = doc?.data || {};
      Object.values(data).forEach((modelBlock) => {
        Object.keys(modelBlock || {}).forEach((y) => years.add(y));
      });
    });

  res.json({
    ok: true,
    years: Array.from(years)
      .map(Number)
      .sort((a, b) => b - a),
  });
});

// Makes for year
app.get("/api/options/makes", (req, res) => {
  const year = normalizeYear(req.query.year);
  if (!year) return res.json({ ok: true, makes: [] });

  const makes = [];

  fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .forEach((file) => {
      const make = file.replace(".json", "");
      const doc = loadMakeJSON(make);
      const data = doc?.data || {};

      for (const model of Object.keys(data)) {
        if (data[model]?.[year]) {
          makes.push(make);
          break;
        }
      }
    });

  res.json({ ok: true, makes });
});

// Models for make + year
app.get("/api/options/models", (req, res) => {
  const make = normalize(req.query.make);
  const year = normalizeYear(req.query.year);
  if (!make || !year) return res.json({ ok: true, models: [] });

  const doc = loadMakeJSON(make);
  const data = doc?.data || {};

  const models = Object.keys(data).filter(
    (m) => data[m]?.[year]
  );

  res.json({ ok: true, models });
});

// Repairs for make + model + year
app.get("/api/options/repairs", (req, res) => {
  const make = normalize(req.query.make);
  const model = normalize(req.query.model);
  const year = normalizeYear(req.query.year);

  if (!make || !model || !year) {
    return res.json({ ok: true, repairs: [] });
  }

  const doc = loadMakeJSON(make);
  const repairs =
    doc?.data?.[model]?.[year] || {};

  res.json({
    ok: true,
    repairs: Object.keys(repairs).map((slug) => ({
      slug,
      title: repairs[slug]?.title || slug,
    })),
  });
});

/* -------------------------
   QUOTE — JSON ONLY
-------------------------- */

app.post("/api/quote", (req, res) => {
  const year = normalizeYear(req.body.year);
  const make = normalize(req.body.make);
  const model = normalize(req.body.model);
  const repairSlug = normalizeRepairSlug(req.body.repairSlug);
  const zip = normalize(req.body.zip);

  if (!year || !make || !model || !repairSlug) {
    return res.json({
      ok: false,
      message: "Missing required fields",
    });
  }

  const doc = loadMakeJSON(make);
  const record =
    doc?.data?.[model]?.[year]?.[repairSlug];

  if (!record || !record.total) {
    return res.json({
      ok: true,
      available: false,
      reason: "NOT_FOUND",
      input: { make, model, year, repairSlug },
    });
  }

  res.json({
    ok: true,
    available: true,
    mode: "json-only",
    match: {
      make,
      model,
      year: Number(year),
      repairSlug,
      title: record.title,
    },
    price: {
      low: record.total.low,
      high: record.total.high,
    },
    zip,
    source: record.source || "JSON",
  });
});

/* -------------------------
   START
-------------------------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Fair Repair Auto API running (JSON-ONLY) on port ${PORT}`
  );
});
