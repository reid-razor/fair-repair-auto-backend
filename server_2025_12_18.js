import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---------- setup ----------
const app = express();
const PORT = process.env.PORT || 3000;

// Needed for ES modules (__dirname replacement)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- middleware ----------
app.use(express.json());

// CORS — allow ALL origins (testing mode)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---------- load JSON data ----------
const DATA_DIR = path.join(__dirname, "data");
const acuraPath = path.join(DATA_DIR, "acura.json");

let acuraData;
try {
  acuraData = JSON.parse(fs.readFileSync(acuraPath, "utf-8"));
} catch (err) {
  console.error("Failed to load Acura JSON:", err);
  process.exit(1);
}

// ---------- health check ----------
app.get("/", (req, res) => {
  res.json({ ok: true, service: "fair-repair-auto-json-api" });
});

// ---------- main quote endpoint ----------
app.post("/api/quote", (req, res) => {
  const { make, model, year, repairSlug, zip } = req.body;

  // basic validation
  if (!make || !model || !year || !repairSlug || !zip) {
    return res.status(400).json({
      ok: false,
      message: "Missing required fields",
    });
  }

  // JSON-only: we ONLY support Acura right now
  if (make.toLowerCase() !== "acura") {
    return res.json({
      ok: true,
      available: false,
      reason: "MAKE_NOT_SUPPORTED",
    });
  }

  const modelKey = model.toLowerCase();
  const yearKey = String(year);

  const modelBlock = acuraData.data?.[modelKey];
  if (!modelBlock) {
    return res.json({
      ok: true,
      available: false,
      reason: "MODEL_NOT_FOUND",
    });
  }

  const yearBlock = modelBlock[yearKey];
  if (!yearBlock) {
    return res.json({
      ok: true,
      available: false,
      reason: "YEAR_NOT_FOUND",
    });
  }

  const repairBlock = yearBlock[repairSlug];
  if (!repairBlock) {
    return res.json({
      ok: true,
      available: false,
      reason: "REPAIR_NOT_FOUND",
    });
  }

  // SUCCESS
  return res.json({
    ok: true,
    available: true,
    source: "json",
    inputs: { make, model, year, repairSlug, zip },
    price: {
      parts: repairBlock.parts,
      labor: repairBlock.labor,
      total: repairBlock.total,
    },
  });
});

// ---------- start server ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`JSON-only API running on port ${PORT}`);
});
