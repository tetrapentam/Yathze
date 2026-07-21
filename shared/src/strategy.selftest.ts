import assert from "node:assert/strict";
import { rankHoldMoves, bestImmediateScore } from "./strategy.js";
import type { DieValue, ScoreSheet } from "./types.js";

const empty: ScoreSheet = {};

const pairFives: DieValue[] = [5, 5, 1, 2, 3];

const advice = rankHoldMoves(pairFives, empty, 1, 32);
assert.ok(advice.length >= 3, "expected at least 3 ranked holds");

const best = advice[0]!;
assert.ok(
  best.heldFaces.includes(5),
  `top hold should keep at least one 5, got ${best.heldFaces.join(",")}`,
);

const keepFives = advice.find(
  (a) => a.heldFaces.length === 2 && a.heldFaces.every((f) => f === 5),
);
const keepJunk = advice.find(
  (a) =>
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

assert.equal(rankHoldMoves(pairFives, empty, 0).length, 0);

const scored = bestImmediateScore([6, 6, 6, 6, 6], empty);
assert.equal(scored, 50, "yahtzee should score 50 as best immediate");

console.log("strategy.selftest: ok");
