import {
  ALL_CATEGORIES,
  LOWER_CATEGORIES,
  UPPER_CATEGORIES,
  type Category,
  type DieValue,
  type ScoreSheet,
  type UpperCategory,
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
} from "./types.js";

const FACE_TO_UPPER: Record<DieValue, UpperCategory> = {
  1: "ones",
  2: "twos",
  3: "threes",
  4: "fours",
  5: "fives",
  6: "sixes",
};

function counts(dice: DieValue[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] += 1;
  return c;
}

function sum(dice: DieValue[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

function hasStraight(uniqueSorted: number[], length: number): boolean {
  if (uniqueSorted.length < length) return false;
  for (let i = 0; i <= uniqueSorted.length - length; i++) {
    let ok = true;
    for (let j = 1; j < length; j++) {
      if (uniqueSorted[i + j] !== uniqueSorted[i]! + j) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export function isYahtzeeRoll(dice: DieValue[]): boolean {
  return dice.length === 5 && dice.every((d) => d === dice[0]);
}

export function yahtzeeFace(dice: DieValue[]): DieValue {
  return dice[0] ?? 1;
}

/** Yahtzee box already filled — subsequent five-of-a-kind uses joker rules. */
export function isJokerTurn(dice: DieValue[], sheet: ScoreSheet): boolean {
  return isYahtzeeRoll(dice) && sheet.yahtzee !== undefined;
}

/** +100 bonus when you already have 50 in Yahtzee and roll another. */
export function wouldEarnYahtzeeBonus(
  dice: DieValue[],
  sheet: ScoreSheet,
): boolean {
  return isYahtzeeRoll(dice) && sheet.yahtzee === 50;
}

export function canScoreInCategory(
  dice: DieValue[],
  sheet: ScoreSheet,
  category: Category,
): boolean {
  if (sheet[category] !== undefined) return false;
  if (!isJokerTurn(dice, sheet)) return true;

  const upper = FACE_TO_UPPER[yahtzeeFace(dice)];
  if (sheet[upper] === undefined) {
    return category === upper;
  }

  const lowerOpen = LOWER_CATEGORIES.filter(
    (c) => c !== "yahtzee" && sheet[c] === undefined,
  );
  if (lowerOpen.length > 0) {
    return (lowerOpen as readonly Category[]).includes(category);
  }

  return (UPPER_CATEGORIES as readonly Category[]).includes(category);
}

function jokerScore(dice: DieValue[], category: Category): number {
  const total = sum(dice);
  const face = yahtzeeFace(dice);

  switch (category) {
    case "ones":
    case "twos":
    case "threes":
    case "fours":
    case "fives":
    case "sixes":
      return FACE_TO_UPPER[face] === category ? face * 5 : 0;
    case "threeOfAKind":
    case "fourOfAKind":
    case "chance":
      return total;
    case "fullHouse":
      return 25;
    case "smallStraight":
      return 30;
    case "largeStraight":
      return 40;
    case "yahtzee":
      return 0;
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

export function scoreCategory(
  dice: DieValue[],
  category: Category,
  sheet?: ScoreSheet,
): number {
  if (sheet && isJokerTurn(dice, sheet)) {
    return jokerScore(dice, category);
  }

  const c = counts(dice);
  const total = sum(dice);

  switch (category) {
    case "ones":
      return c[1]! * 1;
    case "twos":
      return c[2]! * 2;
    case "threes":
      return c[3]! * 3;
    case "fours":
      return c[4]! * 4;
    case "fives":
      return c[5]! * 5;
    case "sixes":
      return c[6]! * 6;
    case "threeOfAKind":
      return c.some((n, v) => v > 0 && n >= 3) ? total : 0;
    case "fourOfAKind":
      return c.some((n, v) => v > 0 && n >= 4) ? total : 0;
    case "fullHouse": {
      const hasThree = c.some((n, v) => v > 0 && n === 3);
      const hasTwo = c.some((n, v) => v > 0 && n === 2);
      const isYz = c.some((n, v) => v > 0 && n === 5);
      return (hasThree && hasTwo) || isYz ? 25 : 0;
    }
    case "smallStraight": {
      const uniq = [1, 2, 3, 4, 5, 6].filter((v) => c[v]! > 0);
      return hasStraight(uniq, 4) ? 30 : 0;
    }
    case "largeStraight": {
      const uniq = [1, 2, 3, 4, 5, 6].filter((v) => c[v]! > 0);
      return hasStraight(uniq, 5) ? 40 : 0;
    }
    case "yahtzee":
      return c.some((n, v) => v > 0 && n === 5) ? 50 : 0;
    case "chance":
      return total;
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

/**
 * Potential scores for empty eligible categories.
 * Joker turns include 0s when you must dump into an upper box.
 */
export function suggestScores(
  dice: DieValue[],
  sheet: ScoreSheet,
): Partial<Record<Category, number>> {
  const suggestions: Partial<Record<Category, number>> = {};
  const joker = isJokerTurn(dice, sheet);
  for (const category of ALL_CATEGORIES) {
    if (!canScoreInCategory(dice, sheet, category)) continue;
    const pts = scoreCategory(dice, category, sheet);
    if (pts > 0 || joker) suggestions[category] = pts;
  }
  return suggestions;
}

export function upperSubtotal(sheet: ScoreSheet): number {
  return UPPER_CATEGORIES.reduce((acc, cat) => acc + (sheet[cat] ?? 0), 0);
}

export function computeUpperBonus(sheet: ScoreSheet): number {
  return upperSubtotal(sheet) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_POINTS : 0;
}

export function computeTotal(
  sheet: ScoreSheet,
  yahtzeeBonus = 0,
): number {
  const categorySum = ALL_CATEGORIES.reduce(
    (acc, cat) => acc + (sheet[cat] ?? 0),
    0,
  );
  return categorySum + computeUpperBonus(sheet) + yahtzeeBonus;
}

export function isSheetComplete(sheet: ScoreSheet): boolean {
  return ALL_CATEGORIES.every((cat) => sheet[cat] !== undefined);
}

export function rollDie(): DieValue {
  return (Math.floor(Math.random() * 6) + 1) as DieValue;
}

export function rollDice(held: boolean[], current: DieValue[]): DieValue[] {
  return current.map((d, i) => (held[i] ? d : rollDie()));
}
