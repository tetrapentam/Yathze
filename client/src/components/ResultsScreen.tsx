import type {
  LeaderboardEntry,
  MoveAccuracy,
  PlayerPublic,
  SeriesState,
} from "@yathze/shared";
import { Leaderboard } from "./Leaderboard";

const MAX_VISIBLE_ROUNDS = 5;

interface Props {
  players: PlayerPublic[];
  winners: string[];
  me: PlayerPublic;
  leaderboard: LeaderboardEntry[];
  series: SeriesState;
  onContinue: () => void;
  onReturn: () => void;
}

interface SeriesRow {
  playerId: string;
  name: string;
  wins: number;
  rounds: number;
  /** Score per round index (0-based); null if player missed that round. */
  roundScores: (number | null)[];
  totalScore: number;
  accuracy: MoveAccuracy;
  isYou: boolean;
  wonLast: boolean;
}

function emptyAccuracy(): MoveAccuracy {
  return { decisions: 0, top1: 0, top2: 0, top3: 0 };
}

function accuracyPct(hits: number, decisions: number): string {
  if (decisions <= 0) return "—";
  return `${Math.round((hits / decisions) * 100)}%`;
}

function buildSeriesRows(
  players: PlayerPublic[],
  winners: string[],
  series: SeriesState,
  meId: string,
): SeriesRow[] {
  const rounds = series.rounds;
  const byId = new Map<string, SeriesRow>();

  for (const p of players) {
    byId.set(p.id, {
      playerId: p.id,
      name: p.name,
      wins: 0,
      rounds: rounds.length,
      roundScores: Array.from({ length: rounds.length }, () => null),
      totalScore: 0,
      accuracy: emptyAccuracy(),
      isYou: p.id === meId,
      wonLast: winners.includes(p.id),
    });
  }

  rounds.forEach((round, roundIndex) => {
    for (const rp of round.players) {
      let row = byId.get(rp.playerId);
      if (!row) {
        row = {
          playerId: rp.playerId,
          name: rp.name,
          wins: 0,
          rounds: rounds.length,
          roundScores: Array.from({ length: rounds.length }, () => null),
          totalScore: 0,
          accuracy: emptyAccuracy(),
          isYou: rp.playerId === meId,
          wonLast: winners.includes(rp.playerId),
        };
        byId.set(rp.playerId, row);
      }
      if (rp.won) row.wins += 1;
      row.roundScores[roundIndex] = rp.total;
      row.totalScore += rp.total;
      row.accuracy.decisions += rp.accuracy.decisions;
      row.accuracy.top1 += rp.accuracy.top1;
      row.accuracy.top2 += rp.accuracy.top2;
      row.accuracy.top3 += rp.accuracy.top3;
    }
  });

  return [...byId.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.totalScore - a.totalScore;
  });
}

export function ResultsScreen({
  players,
  winners,
  me,
  leaderboard,
  series,
  onContinue,
  onReturn,
}: Props) {
  const rows = buildSeriesRows(players, winners, series, me.id);
  const winnerNames = players
    .filter((p) => winners.includes(p.id))
    .map((p) => p.name);
  const youWon = winners.includes(me.id);
  const roundCount = series.rounds.length;
  const visibleStart = Math.max(0, roundCount - MAX_VISIBLE_ROUNDS);
  const visibleRoundIndexes = Array.from(
    { length: roundCount - visibleStart },
    (_, i) => visibleStart + i,
  );

  return (
    <div className="screen results-screen">
      <div className="felt-glow" />
      <header className="panel-header">
        <h1 className="brand brand-sm">Burian Studio</h1>
        <p className={`winner-line ${youWon ? "you-won" : ""}`}>
          {winnerNames.length > 1
            ? `Tie: ${winnerNames.join(" & ")}`
            : `${winnerNames[0] ?? "Someone"} wins!`}
        </p>
        {roundCount > 0 && (
          <p className="series-round-label">
            Round {roundCount}
            {roundCount > 1 ? " · series standings" : ""}
            {roundCount > MAX_VISIBLE_ROUNDS
              ? ` · showing last ${MAX_VISIBLE_ROUNDS} rounds`
              : ""}
          </p>
        )}
      </header>

      <div className="play-layout">
        <aside className="play-sidebar">
          <Leaderboard entries={leaderboard} side />
        </aside>

        <div className="play-main">
          <p className="section-label final-scores-label">Series table</p>
          <div className="series-table-wrap">
            <table className="series-table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Wins</th>
                  <th scope="col">Rounds</th>
                  {visibleRoundIndexes.map((idx) => (
                    <th key={idx} scope="col">
                      Round {idx + 1}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                  <th scope="col">Correct 1</th>
                  <th scope="col">Correct 2</th>
                  <th scope="col">Correct 3</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.playerId}
                    className={`${row.wonLast ? "winner" : ""} ${
                      row.isYou ? "you" : ""
                    }`}
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <td className="pname">{row.name}</td>
                    <td>{row.wins}</td>
                    <td>{row.rounds}</td>
                    {visibleRoundIndexes.map((idx) => {
                      const score = row.roundScores[idx];
                      return (
                        <td key={idx}>{score == null ? "—" : score}</td>
                      );
                    })}
                    <td>{row.totalScore}</td>
                    <td>
                      {accuracyPct(row.accuracy.top1, row.accuracy.decisions)}
                    </td>
                    <td>
                      {accuracyPct(row.accuracy.top2, row.accuracy.decisions)}
                    </td>
                    <td>
                      {accuracyPct(row.accuracy.top3, row.accuracy.decisions)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {me.isHost ? (
            <div className="results-actions">
              <button type="button" className="btn primary" onClick={onContinue}>
                Continue
              </button>
              <button type="button" className="btn" onClick={onReturn}>
                Back to lobby
              </button>
            </div>
          ) : (
            <p className="hint">Waiting for the host to continue or open the lobby…</p>
          )}
        </div>
      </div>
    </div>
  );
}
