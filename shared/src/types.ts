export const UPPER_CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
] as const;

export const LOWER_CATEGORIES = [
  "threeOfAKind",
  "fourOfAKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yahtzee",
  "chance",
] as const;

export const ALL_CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES] as const;

export type UpperCategory = (typeof UPPER_CATEGORIES)[number];
export type LowerCategory = (typeof LOWER_CATEGORIES)[number];
export type Category = (typeof ALL_CATEGORIES)[number];

export type ScoreSheet = Partial<Record<Category, number>>;

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 1;
export const MAX_ROLLS = 3;
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS_POINTS = 35;
/** Bonus for each Yahtzee after the first 50 is scored (50 + 100 = 150 from that pair). */
export const YAHTZEE_BONUS_POINTS = 100;

export interface PlayerPublic {
  id: string;
  name: string;
  isHost: boolean;
  sheet: ScoreSheet;
  upperBonus: number;
  /** Extra points from Yahtzee bonuses (100 each after a natural 50). */
  yahtzeeBonus: number;
  total: number;
}

export type RoomPhase = "lobby" | "playing" | "finished";

export interface TurnState {
  playerId: string;
  dice: DieValue[];
  held: boolean[];
  rollsLeft: number;
  hasRolled: boolean;
  /** After Learn: hold toggles locked until the next roll. */
  holdsFrozen: boolean;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  /** ISO date string (YYYY-MM-DD) when this score was achieved */
  achievedOn: string;
}

export interface GameState {
  phase: RoomPhase;
  players: PlayerPublic[];
  turn: TurnState | null;
  winners: string[];
  maxPlayers: number;
  inviteRequired: boolean;
  leaderboard: LeaderboardEntry[];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  ones: "Ones",
  twos: "Twos",
  threes: "Threes",
  fours: "Fours",
  fives: "Fives",
  sixes: "Sixes",
  threeOfAKind: "3 of a Kind",
  fourOfAKind: "4 of a Kind",
  fullHouse: "Full House",
  smallStraight: "Sm. Straight",
  largeStraight: "Lg. Straight",
  yahtzee: "Yahtzee",
  chance: "Chance",
};
