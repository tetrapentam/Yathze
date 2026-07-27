import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOptTable, OPT_STATE_COUNT } from "@yathze/shared";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const candidates = [
  path.join(root, "data", "OptEScore.bin"),
  path.join(root, "client", "public", "OptEScore.bin"),
];

export function ensureOptTableLoaded(): void {
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    loadOptTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    console.log(`Loaded opt EV table from ${file} (${OPT_STATE_COUNT} states)`);
    return;
  }
  console.warn(
    "OptEScore.bin not found. Run: npm run build:opt-table\nLearn advice will fail until the table exists.",
  );
}
