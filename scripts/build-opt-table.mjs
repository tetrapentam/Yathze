/**
 * Build the full-game optimal EV table and write data/OptEScore.bin
 * (also copied to client/public for the Learn worker).
 *
 * Usage: npm run build:opt-table
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_GAME_EV,
  fillOptTable,
  initialOptGameState,
  packOptState,
  OPT_STATE_COUNT,
} from "../shared/dist/optimal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "data", "OptEScore.bin");
const publicPath = join(root, "client", "public", "OptEScore.bin");

const t0 = Date.now();
let lastPct = -1;
const table = fillOptTable((done, total) => {
  const pct = Math.floor((100 * done) / total);
  if (pct !== lastPct && pct % 5 === 0) {
    lastPct = pct;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`opt-table ${pct}% (${done}/${total}) ${elapsed}s`);
  }
});

const init = initialOptGameState();
const emptyEv = table[packOptState(init.free, init.usneed, init.chip)];
console.log(`Empty-game EV: ${emptyEv.toFixed(4)} (target ≈ ${EMPTY_GAME_EV})`);
if (Math.abs(emptyEv - EMPTY_GAME_EV) > 0.5) {
  console.warn(
    `Warning: empty EV differs from published ${EMPTY_GAME_EV} by ${Math.abs(emptyEv - EMPTY_GAME_EV).toFixed(4)}`,
  );
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(table.buffer, table.byteOffset, table.byteLength));
console.log(`Wrote ${outPath} (${OPT_STATE_COUNT} × float64)`);

mkdirSync(dirname(publicPath), { recursive: true });
copyFileSync(outPath, publicPath);
console.log(`Copied to ${publicPath}`);

if (!existsSync(outPath)) process.exit(1);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
