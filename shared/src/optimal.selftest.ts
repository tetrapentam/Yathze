import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_CATEGORIES,
  type DieValue,
  type ScoreSheet,
} from "./types.js";
import { bestImmediateScore } from "./strategy.js";
import {
  EMPTY_GAME_EV,
  initialOptGameState,
  loadOptTable,
  optExpectedScore,
  rankOptimalMoves,
  sheetToOptGameState,
} from "./optimal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const binPath = join(root, "data", "OptEScore.bin");

if (!existsSync(binPath)) {
  console.error(
    `Missing ${binPath}. Run: npm run build:opt-table`,
  );
  process.exit(1);
}

const buf = readFileSync(binPath);
loadOptTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const emptyEv = optExpectedScore(initialOptGameState());
console.log(`Empty-game EV: ${emptyEv.toFixed(4)} (target ≈ ${EMPTY_GAME_EV})`);
assert.ok(
  Math.abs(emptyEv - EMPTY_GAME_EV) < 0.5,
  `empty EV ${emptyEv} should be near ${EMPTY_GAME_EV}`,
);

const empty: ScoreSheet = {};
const pairFives: DieValue[] = [5, 5, 1, 2, 3];
const advice = rankOptimalMoves(pairFives, empty, 1, 32);
assert.ok(advice.length >= 3, "expected ranked moves");

const keepFives = advice.find(
  (a) =>
    a.kind === "hold" &&
    a.heldFaces.length === 2 &&
    a.heldFaces.every((f) => f === 5),
);
const keepJunk = advice.find(
  (a) =>
    a.kind === "hold" &&
    a.heldFaces.length === 2 &&
    a.heldFaces[0] === 1 &&
    a.heldFaces[1] === 2,
);
assert.ok(keepFives, "should evaluate keeping two 5s");
assert.ok(keepJunk, "should evaluate keeping 1,2");
assert.ok(
  keepFives!.expected > keepJunk!.expected,
  `keeping two 5s (EV ${keepFives!.expected}) should beat keeping 1,2 (EV ${keepJunk!.expected})`,
);

const scoreOnly = rankOptimalMoves(pairFives, empty, 0);
assert.ok(scoreOnly.length > 0, "rollsLeft 0 should still rank score-now moves");
assert.ok(
  scoreOnly.every((a) => a.kind === "score"),
  "rollsLeft 0 should only return score moves",
);

const lateSheet: ScoreSheet = {
  ones: 3,
  twos: 6,
  threes: 9,
  fours: 12,
  fives: 15,
  sixes: 18,
  threeOfAKind: 20,
  fourOfAKind: 22,
  fullHouse: 25,
  smallStraight: 30,
  largeStraight: 40,
  yahtzee: 50,
};
const gs = sheetToOptGameState(lateSheet);
assert.equal(gs.chip, true);
const chanceBit = 1 << ALL_CATEGORIES.indexOf("chance");
assert.ok((gs.free & chanceBit) !== 0, "chance should be free");
const chanceOnly = optExpectedScore(gs);
assert.ok(chanceOnly > 0 && chanceOnly < 40, `chance-only EV ${chanceOnly}`);

assert.equal(bestImmediateScore([6, 6, 6, 6, 6], empty), 50);

console.log("optimal.selftest: ok");
