import type { LeaderboardEntry } from "@yathze/shared";
import type { LiveLeaderboardEntry } from "../leaderboardLive";

interface Props {
  entries: Array<LeaderboardEntry | LiveLeaderboardEntry>;
  compact?: boolean;
  side?: boolean;
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function Leaderboard({ entries, compact, side }: Props) {
  return (
    <section
      className={`hall-of-fame ${compact ? "compact" : ""} ${side ? "side" : ""}`}
    >
      <p className="section-label">Top 10 all time</p>
      {entries.length === 0 ? (
        <p className="hint">No scores yet — play to climb the board.</p>
      ) : (
        <ol className="hof-list">
          {entries.map((e, i) => {
            const live = "live" in e && e.live;
            const active = "active" in e && e.active;
            return (
              <li
                key={`${i}-${e.name}-${e.score}-${e.achievedOn}-${live ? "live" : "rec"}`}
                className={`hof-row ${active ? "active" : ""} ${live ? "live" : ""}`}
              >
                <span className="hof-rank">{i + 1}</span>
                <span className="hof-name">
                  {e.name}
                  {live ? <span className="hof-live-tag">live</span> : null}
                </span>
                <span className="hof-score">{e.score} pts</span>
                <span className="hof-date">{formatDay(e.achievedOn)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
