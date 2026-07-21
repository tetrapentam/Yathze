import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LeaderboardEntry } from "@yathze/shared";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "leaderboard.json");
const TOP_N = 10;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): LeaderboardEntry[] {
  try {
    if (!existsSync(FILE)) return [];
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as LeaderboardEntry[];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (e) =>
          e &&
          typeof e.name === "string" &&
          typeof e.score === "number" &&
          typeof e.achievedOn === "string",
      )
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, TOP_N);
  } catch {
    return [];
  }
}

function save(entries: LeaderboardEntry[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(entries, null, 2), "utf8");
}

let cache = load();

export function getLeaderboard(): LeaderboardEntry[] {
  return cache.map((e) => ({ ...e }));
}

/** Add finished-game scores to the all-time top 10. Same names are allowed. */
export function recordGameScores(
  players: { name: string; score: number }[],
): LeaderboardEntry[] {
  const achievedOn = todayIso();
  const next = cache.map((e) => ({ ...e }));

  for (const p of players) {
    const name = p.name.trim().slice(0, 16);
    if (!name || p.score <= 0) continue;
    next.push({ name, score: p.score, achievedOn });
  }

  cache = next
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, TOP_N);
  save(cache);
  return getLeaderboard();
}
