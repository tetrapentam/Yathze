import {
  ALL_CATEGORIES,
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  UPPER_CATEGORIES,
  type Category,
  type DieValue,
  type ScoreSheet,
  type UpperCategory,
} from "./types.js";
import {
  canScoreInCategory,
  scoreCategory,
  upperSubtotal,
  wouldEarnYahtzeeBonus,
} from "./scoring.js";

export interface HoldAdvice {
  /** Which dice indices to keep (length 5). */
  heldMask: boolean[];
  /** Faces that would be kept, sorted ascending. */
  heldFaces: DieValue[];
  /** Expected score for the rest of this turn under optimal follow-up. */
  expected: number;
}

const UPPER_SET = new Set<Category>(UPPER_CATEGORIES);

/** Number of distinct 5-dice multisets (stars-and-bars). */
export const HAND_COUNT = 252;

const FACT = [1, 1, 2, 6, 24, 120];

/** All 252 non-decreasing 5-die hands, index = packed id. */
export const ALL_HANDS: DieValue[][] = [];
/** Map "1,2,3,4,5" → hand id 0..251 */
const HAND_ID_BY_KEY = new Map<string, number>();

(function buildHandIndex() {
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      for (let c = b; c <= 6; c++) {
        for (let d = c; d <= 6; d++) {
          for (let e = d; e <= 6; e++) {
            const hand: DieValue[] = [
              a as DieValue,
              b as DieValue,
              c as DieValue,
              d as DieValue,
              e as DieValue,
            ];
            const id = ALL_HANDS.length;
            ALL_HANDS.push(hand);
            HAND_ID_BY_KEY.set(hand.join(","), id);
          }
        }
      }
    }
  }
})();

function isUpper(cat: Category): cat is UpperCategory {
  return UPPER_SET.has(cat);
}

function multinomial(counts: number[]): number {
  let n = 0;
  let denom = 1;
  for (const c of counts) {
    n += c;
    denom *= FACT[c]!;
  }
  return FACT[n]! / denom;
}

/** Pack a 5-die roll (any order) into hand id 0..251. */
export function handId(dice: readonly DieValue[]): number {
  const sorted = [...dice].sort((x, y) => x - y);
  return HAND_ID_BY_KEY.get(sorted.join(",")) ?? 0;
}

export function handFromId(id: number): DieValue[] {
  return ALL_HANDS[id]!.slice() as DieValue[];
}

/** Immediate turn value of scoring `category` with `dice`. */
export function categoryTurnValue(
  dice: DieValue[],
  sheet: ScoreSheet,
  category: Category,
): number {
  const pts = scoreCategory(dice, category, sheet);
  let value = pts;
  if (wouldEarnYahtzeeBonus(dice, sheet)) value += 100;

  if (isUpper(category) && sheet[category] === undefined) {
    const before = upperSubtotal(sheet);
    if (before < UPPER_BONUS_THRESHOLD) {
      const after = before + pts;
      if (after >= UPPER_BONUS_THRESHOLD) value += UPPER_BONUS_POINTS;
    }
  }
  return value;
}

/** Best category score available for this hand (this turn only). */
export function bestImmediateScore(
  dice: DieValue[],
  sheet: ScoreSheet,
): number {
  let best = 0;
  for (const category of ALL_CATEGORIES) {
    if (!canScoreInCategory(dice, sheet, category)) continue;
    best = Math.max(best, categoryTurnValue(dice, sheet, category));
  }
  return best;
}

/** Per-sheet LUT: handId → best immediate score. */
function buildScoreLut(sheet: ScoreSheet): Float64Array {
  const lut = new Float64Array(HAND_COUNT);
  for (let id = 0; id < HAND_COUNT; id++) {
    lut[id] = bestImmediateScore(ALL_HANDS[id]!, sheet);
  }
  return lut;
}

function heldFacesOf(dice: DieValue[], held: boolean[]): DieValue[] {
  const faces: DieValue[] = [];
  for (let i = 0; i < 5; i++) {
    if (held[i]) faces.push(dice[i]!);
  }
  return faces.sort((a, b) => a - b);
}

function holdFaceKey(dice: DieValue[], held: boolean[]): string {
  return heldFacesOf(dice, held).join(",") || "none";
}

/** All 32 keep masks. */
export function allHoldMasks(): boolean[][] {
  const masks: boolean[][] = [];
  for (let bits = 0; bits < 32; bits++) {
    masks.push([
      (bits & 1) !== 0,
      (bits & 2) !== 0,
      (bits & 4) !== 0,
      (bits & 8) !== 0,
      (bits & 16) !== 0,
    ]);
  }
  return masks;
}

/**
 * Unique keep actions for this dice layout (one mask per kept-face multiset).
 */
export function uniqueHoldMasks(dice: DieValue[]): { mask: boolean[]; faces: DieValue[]; key: string }[] {
  const seen = new Map<string, { mask: boolean[]; faces: DieValue[]; key: string }>();
  for (const mask of allHoldMasks()) {
    const faces = heldFacesOf(dice, mask);
    const key = faces.join(",") || "none";
    if (!seen.has(key)) seen.set(key, { mask: [...mask], faces, key });
  }
  return [...seen.values()];
}

/**
 * Enumerate every outcome of rolling unheld dice (held faces stay fixed).
 * Yields the resulting five-die array for each of 6^k outcomes (uniform).
 * Kept for tests / debugging; hot path uses weighted multisets.
 */
export function forEachRerollOutcome(
  dice: DieValue[],
  held: boolean[],
  visit: (next: DieValue[]) => void,
): number {
  const free: number[] = [];
  for (let i = 0; i < 5; i++) {
    if (!held[i]) free.push(i);
  }
  const k = free.length;
  if (k === 0) {
    visit([...dice]);
    return 1;
  }

  const next = [...dice] as DieValue[];
  const total = 6 ** k;
  for (let n = 0; n < total; n++) {
    let x = n;
    for (let j = 0; j < k; j++) {
      next[free[j]!] = ((x % 6) + 1) as DieValue;
      x = Math.floor(x / 6);
    }
    visit(next);
  }
  return total;
}

/**
 * For a keep mask, visit each distinct resulting multiset with its outcome weight.
 * Weight = number of microstates; weights sum to 6^k (k = free dice).
 */
export function forEachWeightedReroll(
  dice: DieValue[],
  held: boolean[],
  visit: (nextId: number, weight: number) => void,
): number {
  const keptCounts = [0, 0, 0, 0, 0, 0, 0];
  let free = 0;
  for (let i = 0; i < 5; i++) {
    if (held[i]) keptCounts[dice[i]!]! += 1;
    else free += 1;
  }
  if (free === 0) {
    visit(handId(dice), 1);
    return 1;
  }

  const total = 6 ** free;
  const rollCounts = [0, 0, 0, 0, 0, 0, 0];

  function rec(face: number, left: number): void {
    if (face === 6) {
      rollCounts[6] = left;
      const hand: DieValue[] = [];
      for (let f = 1; f <= 6; f++) {
        const n = keptCounts[f]! + rollCounts[f]!;
        for (let i = 0; i < n; i++) hand.push(f as DieValue);
      }
      visit(handId(hand), multinomial(rollCounts.slice(1)));
      return;
    }
    for (let n = 0; n <= left; n++) {
      rollCounts[face] = n;
      rec(face + 1, left - n);
    }
  }

  rec(1, free);
  return total;
}

type EvalCtx = {
  lut: Float64Array;
  /** turnValue memo: handId * 3 + rollsLeft → EV */
  memo: Float64Array;
  /** bitset: whether memo filled (rollsLeft 0..2) */
  memoSet: Uint8Array;
};

function turnValueId(hand: number, rollsLeft: number, ctx: EvalCtx): number {
  if (rollsLeft <= 0) return ctx.lut[hand]!;

  const slot = hand * 3 + rollsLeft;
  if (ctx.memoSet[slot]) return ctx.memo[slot]!;

  const dice = ALL_HANDS[hand]!;
  let best = ctx.lut[hand]!;

  for (const { mask } of uniqueHoldMasks(dice)) {
    const ev = expectedAfterHoldId(dice, mask, rollsLeft - 1, ctx);
    if (ev > best) best = ev;
  }

  ctx.memo[slot] = best;
  ctx.memoSet[slot] = 1;
  return best;
}

function expectedAfterHoldId(
  dice: DieValue[],
  held: boolean[],
  rollsAfterThis: number,
  ctx: EvalCtx,
): number {
  let sum = 0;
  let totalWeight = 0;
  forEachWeightedReroll(dice, held, (nextId, weight) => {
    sum += turnValueId(nextId, rollsAfterThis, ctx) * weight;
    totalWeight += weight;
  });
  return totalWeight === 0 ? 0 : sum / totalWeight;
}

/**
 * Rank keep combinations by expected remaining-turn score.
 * Ignores the player's current hold selection.
 *
 * @param rollsLeft — rolls still available after the current known dice
 *   (must be > 0 to get hold advice; if 0, returns empty).
 */
export function rankHoldMoves(
  dice: DieValue[],
  sheet: ScoreSheet,
  rollsLeft: number,
  topN = 3,
): HoldAdvice[] {
  if (dice.length !== 5 || rollsLeft <= 0) return [];

  const lut = buildScoreLut(sheet);
  const ctx: EvalCtx = {
    lut,
    memo: new Float64Array(HAND_COUNT * 3),
    memoSet: new Uint8Array(HAND_COUNT * 3),
  };

  // Seed memo for rollsLeft === 0 via lut (handled in turnValueId).

  const byFaceKey = new Map<string, HoldAdvice>();

  for (const { mask, faces, key } of uniqueHoldMasks(dice)) {
    const expected = expectedAfterHoldId(dice, mask, rollsLeft - 1, ctx);
    const prev = byFaceKey.get(key);
    if (!prev || expected > prev.expected) {
      byFaceKey.set(key, {
        heldMask: mask,
        heldFaces: faces,
        expected,
      });
    }
  }

  return [...byFaceKey.values()]
    .sort((a, b) => b.expected - a.expected)
    .slice(0, topN);
}
