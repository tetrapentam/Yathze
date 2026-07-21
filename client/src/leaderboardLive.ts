import type { LeaderboardEntry, PlayerPublic } from "@yathze/shared";

export type LiveLeaderboardEntry = LeaderboardEntry & {
  live?: boolean;
  active?: boolean;
};

const TOP_N = 10;

/**
 * Keep all-time scores (same names allowed as separate rows).
 * Insert the active player's live total only if it earns a top-10 spot.
 */
export function mergeLiveLeaderboard(
  allTime: LeaderboardEntry[],
  players: PlayerPublic[],
  activePlayerId?: string | null,
): LiveLeaderboardEntry[] {
  const rows: LiveLeaderboardEntry[] = allTime
    .slice(0, TOP_N)
    .map((e) => ({ ...e }));

  const active = players.find((p) => p.id === activePlayerId);
  if (!active) {
    return rows
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, TOP_N);
  }

  const today = new Date().toISOString().slice(0, 10);
  const liveScore = active.total;
  const tenthScore = rows.length >= TOP_N ? rows[TOP_N - 1]!.score : -1;

  if (rows.length < TOP_N || liveScore > tenthScore) {
    rows.push({
      name: active.name,
      score: liveScore,
      achievedOn: today,
      live: true,
      active: true,
    });
  }

  return rows
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, TOP_N)
    .map((e) =>
      e.live
        ? e
        : {
            ...e,
            active: false,
            live: false,
          },
    );
}
