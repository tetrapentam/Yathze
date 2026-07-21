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

function isUpper(cat: Category): cat is UpperCategory {
  return UPPER_SET.has(cat);
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

function diceKey(dice: readonly DieValue[]): string {
  return [...dice].sort((a, b) => a - b).join(",");
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
 * Enumerate every outcome of rolling unheld dice (held faces stay fixed).
 * Yields the resulting five-die array for each of 6^k outcomes (uniform).
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

function expectedAfterHold(
  dice: DieValue[],
  held: boolean[],
  sheet: ScoreSheet,
  rollsAfterThis: number,
  memo: Map<string, number>,
): number {
  let sum = 0;
  const count = forEachRerollOutcome(dice, held, (next) => {
    sum += turnValue(next, sheet, rollsAfterThis, memo);
  });
  return sum / count;
}

/**
 * Expected score from this dice state with `rollsLeft` further rolls available
 * (same meaning as TurnState.rollsLeft after the current faces are known).
 */
function turnValue(
  dice: DieValue[],
  sheet: ScoreSheet,
  rollsLeft: number,
  memo: Map<string, number>,
): number {
  if (rollsLeft <= 0) return bestImmediateScore(dice, sheet);

  const key = `${diceKey(dice)}|${rollsLeft}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let best = bestImmediateScore(dice, sheet);
  for (const held of allHoldMasks()) {
    const ev = expectedAfterHold(dice, held, sheet, rollsLeft - 1, memo);
    if (ev > best) best = ev;
  }
  memo.set(key, best);
  return best;
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

  const memo = new Map<string, number>();
  const byFaceKey = new Map<string, HoldAdvice>();

  for (const heldMask of allHoldMasks()) {
    const expected = expectedAfterHold(
      dice,
      heldMask,
      sheet,
      rollsLeft - 1,
      memo,
    );
    const heldFaces = heldFacesOf(dice, heldMask);
    const key = holdFaceKey(dice, heldMask);
    const prev = byFaceKey.get(key);
    if (!prev || expected > prev.expected) {
      byFaceKey.set(key, {
        heldMask: [...heldMask],
        heldFaces,
        expected,
      });
    }
  }

  return [...byFaceKey.values()]
    .sort((a, b) => b.expected - a.expected)
    .slice(0, topN);
}
