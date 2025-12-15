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
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const cache = new Map();

function loadMake(make) {
  if (cache.has(make)) return cache.get(make);

  const filePath = path.join(DATA_DIR, `${make}.json`);
  if (!fs.existsSync(filePath)) return null;

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  cache.set(make, data);
  return data;
}

function lookupRepair({ make, model, year, repairSlug }) {
  const makeData = loadMake(make);
  if (!makeData) return { found: false, reason: "MAKE_NOT_FOUND" };

  const modelData = makeData[model];
  if (!modelData) return { found: false, reason: "MODEL_NOT_FOUND" };

  const yearData = modelData[year];
  if (!yearData) return { found: false, reason: "YEAR_NOT_FOUND" };

  const repair = yearData[repairSlug];
  if (!repair) return { found: false, reason: "REPAIR_NOT_FOUND" };

  return { found: true, data: repair };
}

app.post("/api/quote", (req, res) => {
  const { make, model, year, repairSlug, zip } = req.body;

  if (!make || !model || !year || !repairSlug) {
    return res.status(400).json({ ok: false, error: "INVALID_INPUT" });
  }

  const lookup = lookupRepair({
    make: make.toLowerCase(),
    model: model.toLowerCase(),
    year: String(year),
    repairSlug
  });

  if (!lookup.found) {
    return res.json({
      ok: true,
      available: false,
      reason: lookup.reason
    });
  }

  const state = zip ? zipToState(zip) : null;
  const multiplier = state ? getLaborMultiplier(state) : 1;
  const base = lookup.data;

  const adjusted = {
    parts: base.parts,
    labor: base.labor
      ? {
          low: Math.round(base.labor.low * multiplier),
          high: Math.round(base.labor.high * multiplier)
        }
      : null,
    total: base.total
      ? {
          low: Math.round(base.total.low * multiplier),
          high: Math.round(base.total.high * multiplier)
        }
      : null
  };

  res.json({
    ok: true,
    available: true,
    state,
    multiplier,
    base,
    adjusted
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Fair Repair Auto backend running on port ${PORT}`);
});
