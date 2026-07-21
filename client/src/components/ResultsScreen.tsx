import type { LeaderboardEntry, PlayerPublic } from "@yathze/shared";
import { Leaderboard } from "./Leaderboard";

interface Props {
  players: PlayerPublic[];
  winners: string[];
  me: PlayerPublic;
  leaderboard: LeaderboardEntry[];
  onReturn: () => void;
}

export function ResultsScreen({
  players,
  winners,
  me,
  leaderboard,
  onReturn,
}: Props) {
  const ranked = [...players].sort((a, b) => b.total - a.total);
  const winnerNames = players
    .filter((p) => winners.includes(p.id))
    .map((p) => p.name);
  const youWon = winners.includes(me.id);

  return (
    <div className="screen results-screen">
      <div className="felt-glow" />
      <header className="panel-header">
        <h1 className="brand brand-sm">Yathze</h1>
        <p className={`winner-line ${youWon ? "you-won" : ""}`}>
          {winnerNames.length > 1
            ? `Tie: ${winnerNames.join(" & ")}`
            : `${winnerNames[0] ?? "Someone"} wins!`}
        </p>
      </header>

      <div className="play-layout">
        <aside className="play-sidebar">
          <Leaderboard entries={leaderboard} side />
        </aside>

        <div className="play-main">
          <p className="section-label final-scores-label">Final scores</p>
          <ol className="standings">
            {ranked.map((p, i) => (
              <li
                key={p.id}
                className={`standing ${winners.includes(p.id) ? "winner" : ""} ${
                  p.id === me.id ? "you" : ""
                }`}
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <span className="rank">{i + 1}</span>
                <span className="pname">{p.name}</span>
                <span className="score">{p.total} pts</span>
              </li>
            ))}
          </ol>

          {me.isHost ? (
            <button type="button" className="btn primary" onClick={onReturn}>
              Back to lobby
            </button>
          ) : (
            <p className="hint">Waiting for the host to open the lobby…</p>
          )}
        </div>
      </div>
    </div>
  );
}
