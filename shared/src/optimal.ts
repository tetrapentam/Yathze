/**
 * Full-game optimal expected-score DP for solitaire Yahtzee.
 * Algorithm idea (not source) follows Verhoeff / TU Eindhoven Optimal Solitaire Yahtzee:
 * state = free categories + upper-section need + Yahtzee chip;
 * EV(choice) = immediate points + V(next state).
 * Gold check: empty-sheet V ≈ 254.59.
 */
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
  wouldEarnYahtzeeBonus,
} from "./scoring.js";
import {
  ALL_HANDS,
  HAND_COUNT,
  forEachWeightedReroll,
  handId,
  uniqueHoldMasks,
} from "./strategy.js";

export const OPT_STATE_COUNT = 786_432;
/** Published optimal expected final score from an empty sheet. */
export const EMPTY_GAME_EV = 254.5896;

const YZ_INDEX = ALL_CATEGORIES.indexOf("yahtzee");
const UPPER_SET = new Set<Category>(UPPER_CATEGORIES);
const N_ROLL_LEVELS = 2;

export interface OptGameState {
  /** Bit i set ⇒ ALL_CATEGORIES[i] still free. */
  free: number;
  /** Points still needed in upper section for the +35 bonus (0..63). */
  usneed: number;
  /** True iff Yahtzee was scored non-zero (extra-Yahtzee bonuses available). */
  chip: boolean;
}

export type MoveAdvice =
  | {
      kind: "hold";
      heldMask: boolean[];
      heldFaces: DieValue[];
      expected: number;
    }
  | {
      kind: "score";
      category: Category;
      expected: number;
    };

/** Dense V table: index → expected remaining score from start of a turn. */
let valueTable: Float64Array | null = null;

export function isOptTableLoaded(): boolean {
  return valueTable !== null;
}

export function loadOptTable(buffer: ArrayBuffer | Float64Array): void {
  const view =
    buffer instanceof Float64Array ? buffer : new Float64Array(buffer);
  if (view.length !== OPT_STATE_COUNT) {
    throw new Error(
      `Opt table length ${view.length}, expected ${OPT_STATE_COUNT}`,
    );
  }
  valueTable = view;
}

export function getOptTable(): Float64Array | null {
  return valueTable;
}

export function clearOptTable(): void {
  valueTable = null;
}

function isUpper(cat: Category): cat is UpperCategory {
  return UPPER_SET.has(cat);
}

/** Pack free (without yahtzee bit) + yzMode(0..2) + usneed → 0..786431. */
export function packOptState(
  free: number,
  usneed: number,
  chip: boolean,
): number {
  const yzFree = ((free >>> YZ_INDEX) & 1) === 1;
  const free12 =
    ((free >>> (YZ_INDEX + 1)) << YZ_INDEX) | (free & ((1 << YZ_INDEX) - 1));
  const yzMode = yzFree ? 0 : chip ? 2 : 1;
  return (free12 * 3 + yzMode) * 64 + usneed;
}

export function unpackOptState(index: number): OptGameState {
  const usneed = index % 64;
  const rest = (index - usneed) / 64;
  const yzMode = rest % 3;
  const free12 = (rest - yzMode) / 3;
  let free =
    ((free12 >>> YZ_INDEX) << (YZ_INDEX + 1)) |
    (free12 & ((1 << YZ_INDEX) - 1));
  if (yzMode === 0) free |= 1 << YZ_INDEX;
  return {
    free,
    usneed,
    chip: yzMode === 2,
  };
}

export function initialOptGameState(): OptGameState {
  return {
    free: (1 << ALL_CATEGORIES.length) - 1,
    usneed: UPPER_BONUS_THRESHOLD,
    chip: false,
  };
}

export function sheetToOptGameState(sheet: ScoreSheet): OptGameState {
  let free = 0;
  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    if (sheet[ALL_CATEGORIES[i]!] === undefined) free |= 1 << i;
  }
  let upper = 0;
  for (const cat of UPPER_CATEGORIES) {
    upper += sheet[cat] ?? 0;
  }
  const usneed =
    upper >= UPPER_BONUS_THRESHOLD ? 0 : UPPER_BONUS_THRESHOLD - upper;
  const yz = sheet.yahtzee;
  const chip = yz !== undefined && yz !== 0;
  return { free, usneed, chip };
}

/** Minimal sheet so scoring/joker helpers match this abstract state. */
function sheetForState(free: number, chip: boolean): ScoreSheet {
  const sheet: ScoreSheet = {};
  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    if ((free & (1 << i)) === 0) {
      const cat = ALL_CATEGORIES[i]!;
      sheet[cat] = cat === "yahtzee" ? (chip ? 50 : 0) : 0;
    }
  }
  return sheet;
}

/**
 * Points earned this action (category + Yahtzee bonus + upper bonus) and next state.
 * Returns null if the category is not legal for this hand/state.
 */
export function applyScoreAction(
  dice: DieValue[],
  free: number,
  usneed: number,
  chip: boolean,
  category: Category,
  sheet?: ScoreSheet,
): { points: number; next: OptGameState } | null {
  const catBit = 1 << ALL_CATEGORIES.indexOf(category);
  if ((free & catBit) === 0) return null;

  const sc = sheet ?? sheetForState(free, chip);
  if (!canScoreInCategory(dice, sc, category)) return null;

  const pts = scoreCategory(dice, category, sc);
  let points = pts;
  if (wouldEarnYahtzeeBonus(dice, sc)) points += 100;

  let nextUsneed = usneed;
  if (isUpper(category) && nextUsneed > 0) {
    if (pts >= nextUsneed) {
      points += UPPER_BONUS_POINTS;
      nextUsneed = 0;
    } else {
      nextUsneed -= pts;
    }
  }

  let nextChip = chip;
  if (category === "yahtzee") nextChip = pts !== 0;

  return {
    points,
    next: {
      free: free & ~catBit,
      usneed: nextUsneed,
      chip: nextChip,
    },
  };
}

function lookupV(next: OptGameState, table: Float64Array): number {
  if (next.free === 0) return 0;
  return table[packOptState(next.free, next.usneed, next.chip)]!;
}

/** Best score-now value for a hand in this game state. */
function bestScoreNow(
  hand: DieValue[],
  free: number,
  usneed: number,
  chip: boolean,
  table: Float64Array,
  sheet: ScoreSheet,
): number {
  let best = -Infinity;
  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    if ((free & (1 << i)) === 0) continue;
    const cat = ALL_CATEGORIES[i]!;
    const applied = applyScoreAction(hand, free, usneed, chip, cat, sheet);
    if (!applied) continue;
    const ev = applied.points + lookupV(applied.next, table);
    if (ev > best) best = ev;
  }
  return best === -Infinity ? 0 : best;
}

type Keeper = {
  /** Face counts [unused, c1..c6]. */
  counts: number[];
  size: number;
  nextIds: Uint16Array;
  weights: Float64Array;
  totalWeight: number;
};

const KEEPERS: Keeper[] = [];
/** For each hand id: indices into KEEPERS that are sub-multisets of the hand. */
const HAND_SUBKEEPS: Uint16Array[] = [];
const FIRST_ROLL: { id: number; weight: number }[] = [];
let FIRST_ROLL_TOTAL = 0;
const KEEP_EV = new Float64Array(512); // enough for ≤462 keepers

const FACT = [1, 1, 2, 6, 24, 120];

function multiNom(counts: number[]): number {
  let n = 0;
  let denom = 1;
  for (let f = 1; f <= 6; f++) {
    const c = counts[f]!;
    n += c;
    denom *= FACT[c]!;
  }
  return FACT[n]! / denom;
}

function countsKey(counts: number[]): string {
  return `${counts[1]},${counts[2]},${counts[3]},${counts[4]},${counts[5]},${counts[6]}`;
}

function handIdFromCounts(counts: number[]): number {
  const hand: DieValue[] = [];
  for (let f = 1; f <= 6; f++) {
    for (let i = 0; i < counts[f]!; i++) hand.push(f as DieValue);
  }
  return handId(hand);
}

function buildKeeperCompletions(kept: number[]): {
  nextIds: Uint16Array;
  weights: Float64Array;
  totalWeight: number;
} {
  const size = kept[1]! + kept[2]! + kept[3]! + kept[4]! + kept[5]! + kept[6]!;
  const free = 5 - size;
  const nextIds: number[] = [];
  const weights: number[] = [];
  let totalWeight = 0;

  if (free === 0) {
    const id = handIdFromCounts(kept);
    return {
      nextIds: new Uint16Array([id]),
      weights: new Float64Array([1]),
      totalWeight: 1,
    };
  }

  const roll = [0, 0, 0, 0, 0, 0, 0];
  function rec(face: number, left: number): void {
    if (face === 6) {
      roll[6] = left;
      const handCounts = [0, 0, 0, 0, 0, 0, 0];
      for (let f = 1; f <= 6; f++) {
        handCounts[f] = kept[f]! + roll[f]!;
      }
      const w = multiNom(roll);
      nextIds.push(handIdFromCounts(handCounts));
      weights.push(w);
      totalWeight += w;
      return;
    }
    for (let n = 0; n <= left; n++) {
      roll[face] = n;
      rec(face + 1, left - n);
    }
  }
  rec(1, free);
  return {
    nextIds: Uint16Array.from(nextIds),
    weights: Float64Array.from(weights),
    totalWeight,
  };
}

(function precomputeHands() {
  const keepIndex = new Map<string, number>();

  for (let size = 0; size <= 5; size++) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    function enumFaces(face: number, left: number): void {
      if (face === 6) {
        counts[6] = left;
        const key = countsKey(counts);
        if (!keepIndex.has(key)) {
          keepIndex.set(key, KEEPERS.length);
          const comp = buildKeeperCompletions(counts.slice());
          KEEPERS.push({
            counts: counts.slice(),
            size,
            nextIds: comp.nextIds,
            weights: comp.weights,
            totalWeight: comp.totalWeight,
          });
        }
        return;
      }
      for (let n = 0; n <= left; n++) {
        counts[face] = n;
        enumFaces(face + 1, left - n);
      }
    }
    enumFaces(1, size);
  }

  const emptyKept = [0, 0, 0, 0, 0, 0, 0];
  const first = buildKeeperCompletions(emptyKept);
  for (let i = 0; i < first.nextIds.length; i++) {
    FIRST_ROLL.push({ id: first.nextIds[i]!, weight: first.weights[i]! });
    FIRST_ROLL_TOTAL += first.weights[i]!;
  }

  for (let id = 0; id < HAND_COUNT; id++) {
    const dice = ALL_HANDS[id]!;
    const hc = [0, 0, 0, 0, 0, 0, 0];
    for (const d of dice) hc[d]! += 1;
    const subs: number[] = [];
    for (let ki = 0; ki < KEEPERS.length; ki++) {
      const kc = KEEPERS[ki]!.counts;
      let ok = true;
      for (let f = 1; f <= 6; f++) {
        if (kc[f]! > hc[f]!) {
          ok = false;
          break;
        }
      }
      if (ok) subs.push(ki);
    }
    HAND_SUBKEEPS.push(Uint16Array.from(subs));
  }
})();

const SCRATCH0 = new Float64Array(HAND_COUNT);
const SCRATCH1 = new Float64Array(HAND_COUNT);
const SCRATCH2 = new Float64Array(HAND_COUNT);

function fillChooseFromPrev(prev: Float64Array, scoreNow: Float64Array, out: Float64Array): void {
  const nKeep = KEEPERS.length;
  for (let ki = 0; ki < nKeep; ki++) {
    const k = KEEPERS[ki]!;
    let sum = 0;
    const ids = k.nextIds;
    const ws = k.weights;
    for (let i = 0; i < ids.length; i++) {
      sum += prev[ids[i]!]! * ws[i]!;
    }
    KEEP_EV[ki] = sum / k.totalWeight;
  }

  for (let h = 0; h < HAND_COUNT; h++) {
    let best = scoreNow[h]!;
    const subs = HAND_SUBKEEPS[h]!;
    for (let i = 0; i < subs.length; i++) {
      const ev = KEEP_EV[subs[i]!]!;
      if (ev > best) best = ev;
    }
    out[h] = best;
  }
}

/**
 * Compute V(GS): expected remaining score at the start of a turn (before rolling).
 * Requires `table` to already hold correct V for all states with fewer free boxes.
 */
export function computeStateValue(
  free: number,
  usneed: number,
  chip: boolean,
  table: Float64Array,
): number {
  if (free === 0) return 0;

  const choose0 = SCRATCH0;
  const choose1 = SCRATCH1;
  const choose2 = SCRATCH2;

  const sheet = sheetForState(free, chip);
  for (let h = 0; h < HAND_COUNT; h++) {
    choose0[h] = bestScoreNow(ALL_HANDS[h]!, free, usneed, chip, table, sheet);
  }

  fillChooseFromPrev(choose0, choose0, choose1);
  fillChooseFromPrev(choose1, choose0, choose2);

  let sum = 0;
  for (const { id, weight } of FIRST_ROLL) {
    sum += choose2[id]! * weight;
  }
  return sum / FIRST_ROLL_TOTAL;
}

function bitCount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

/** Fill every abstract state bottom-up by number of free categories. */
export function fillOptTable(
  onProgress?: (done: number, total: number) => void,
): Float64Array {
  const table = new Float64Array(OPT_STATE_COUNT);

  const byPop: number[][] = Array.from({ length: 14 }, () => []);
  for (let free12 = 0; free12 < 4096; free12++) {
    for (let yzMode = 0; yzMode < 3; yzMode++) {
      for (let usneed = 0; usneed < 64; usneed++) {
        const index = (free12 * 3 + yzMode) * 64 + usneed;
        let free =
          ((free12 >>> YZ_INDEX) << (YZ_INDEX + 1)) |
          (free12 & ((1 << YZ_INDEX) - 1));
        if (yzMode === 0) free |= 1 << YZ_INDEX;
        byPop[bitCount(free)]!.push(index);
      }
    }
  }

  let done = 0;
  const total = OPT_STATE_COUNT;
  for (let pop = 0; pop <= 13; pop++) {
    for (const index of byPop[pop]!) {
      if (pop === 0) {
        table[index] = 0;
      } else {
        const { free, usneed, chip } = unpackOptState(index);
        table[index] = computeStateValue(free, usneed, chip, table);
      }
      done++;
      if (onProgress && (done & 1023) === 0) onProgress(done, total);
    }
  }
  onProgress?.(done, total);
  valueTable = table;
  return table;
}

function requireTable(): Float64Array {
  if (!valueTable) {
    throw new Error(
      "Optimal EV table not loaded. Run npm run build:opt-table and load OptEScore.bin.",
    );
  }
  return valueTable;
}

export function optExpectedScore(gs: OptGameState): number {
  if (gs.free === 0) return 0;
  return requireTable()[packOptState(gs.free, gs.usneed, gs.chip)]!;
}

function buildChooseTables(
  free: number,
  usneed: number,
  chip: boolean,
  table: Float64Array,
): Float64Array[] {
  const choose0 = new Float64Array(HAND_COUNT);
  const choose1 = new Float64Array(HAND_COUNT);
  const choose2 = new Float64Array(HAND_COUNT);

  const sheet = sheetForState(free, chip);
  for (let h = 0; h < HAND_COUNT; h++) {
    choose0[h] = bestScoreNow(ALL_HANDS[h]!, free, usneed, chip, table, sheet);
  }

  fillChooseFromPrev(choose0, choose0, choose1);
  fillChooseFromPrev(choose1, choose0, choose2);

  return [choose0, choose1, choose2];
}

/**
 * Expected remaining score for the current dice with `rollsLeft` rolls still
 * available (including the option to score now).
 */
export function turnExpectedValue(
  dice: DieValue[],
  sheet: ScoreSheet,
  rollsLeft: number,
): number {
  const table = requireTable();
  const { free, usneed, chip } = sheetToOptGameState(sheet);
  if (free === 0) return 0;

  const choose = buildChooseTables(free, usneed, chip, table);
  const id = handId(dice);
  const rl = Math.max(0, Math.min(N_ROLL_LEVELS, rollsLeft));
  return choose[rl]![id]!;
}

/**
 * Rank keep and score-now actions by expected remaining game score.
 * When `rollsLeft` is 0, only score-now options are ranked.
 */
export function rankOptimalMoves(
  dice: DieValue[],
  sheet: ScoreSheet,
  rollsLeft: number,
  topN = 3,
): MoveAdvice[] {
  if (dice.length !== 5 || rollsLeft < 0) return [];

  const table = requireTable();
  const { free, usneed, chip } = sheetToOptGameState(sheet);
  if (free === 0) return [];

  const moves: MoveAdvice[] = [];

  if (rollsLeft > 0) {
    const choose = buildChooseTables(free, usneed, chip, table);
    const rlAfter = Math.min(N_ROLL_LEVELS, Math.max(0, rollsLeft - 1));
    const afterRoll = choose[rlAfter]!;

    for (const { mask, faces } of uniqueHoldMasks(dice)) {
      let sum = 0;
      let totalWeight = 0;
      forEachWeightedReroll(dice, mask, (nextId, weight) => {
        sum += afterRoll[nextId]! * weight;
        totalWeight += weight;
      });
      moves.push({
        kind: "hold",
        heldMask: [...mask],
        heldFaces: [...faces],
        expected: totalWeight === 0 ? 0 : sum / totalWeight,
      });
    }
  }

  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    if ((free & (1 << i)) === 0) continue;
    const category = ALL_CATEGORIES[i]!;
    const applied = applyScoreAction(dice, free, usneed, chip, category);
    if (!applied) continue;
    moves.push({
      kind: "score",
      category,
      expected: applied.points + lookupV(applied.next, table),
    });
  }

  moves.sort((a, b) => b.expected - a.expected);
  return moves.slice(0, topN);
}

/** Sorted faces of dice currently marked held. */
export function heldFacesFromMask(
  dice: DieValue[],
  held: boolean[],
): DieValue[] {
  const faces: DieValue[] = [];
  for (let i = 0; i < dice.length; i++) {
    if (held[i]) faces.push(dice[i]!);
  }
  faces.sort((a, b) => a - b);
  return faces;
}

function facesEqual(a: DieValue[], b: DieValue[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export type DecisionActual =
  | { kind: "hold"; heldFaces: DieValue[] }
  | { kind: "score"; category: Category };

/**
 * Best matching advice slot (1-based), or 0 if the actual move is not in `advice`.
 */
export function matchAdviceRank(
  actual: DecisionActual,
  advice: MoveAdvice[],
): 0 | 1 | 2 | 3 {
  for (let i = 0; i < advice.length && i < 3; i++) {
    const row = advice[i]!;
    if (
      actual.kind === "hold" &&
      row.kind === "hold" &&
      facesEqual(actual.heldFaces, row.heldFaces)
    ) {
      return (i + 1) as 1 | 2 | 3;
    }
    if (
      actual.kind === "score" &&
      row.kind === "score" &&
      actual.category === row.category
    ) {
      return (i + 1) as 1 | 2 | 3;
    }
  }
  return 0;
}

/** Sheet-only expected final score (current total + remaining EV). */
export function estimatedTotalFromSheet(
  sheet: ScoreSheet,
  scoredTotal: number,
): number {
  return scoredTotal + optExpectedScore(sheetToOptGameState(sheet));
}
