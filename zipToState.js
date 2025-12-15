export function zipToState(zip) {
  const z = Number(zip);

  if (z >= 10000 && z <= 14999) return "NY";
  if (z >= 90000 && z <= 96999) return "CA";
  if (z >= 75000 && z <= 79999) return "TX";
  if (z >= 32000 && z <= 34999) return "FL";

  return null;
}
