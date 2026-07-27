import { useMemo, useState } from "react";
import {
  ALL_CATEGORIES,
  canScoreInCategory,
  suggestScores,
  upperSubtotal,
  type Category,
  type GameState,
  type LearnHint,
  type PlayerPublic,
} from "@yathze/shared";
import { mergeLiveLeaderboard } from "../leaderboardLive";
import { useStrategyAdvice } from "../useStrategyAdvice";
import { DiceTray } from "./DiceTray";
import { Leaderboard } from "./Leaderboard";
import { ScoreSheet } from "./ScoreSheet";

interface Props {
  state: GameState;
  me: PlayerPublic;
  error: string | null;
  onRoll: () => void;
  onHold: (index: number) => void;
  onScore: (category: Category) => void;
  onLearn: () => void;
}

function rollToken(turn: NonNullable<GameState["turn"]>): string {
  return `${turn.playerId}:${turn.rollsLeft}:${turn.hasRolled}:${turn.dice.join(",")}`;
}

function formatAdvice(advice: LearnHint): string {
  if (advice.kind === "score") {
    return `Score ${formatCategory(advice.category)}`;
  }
  if (advice.heldFaces.length === 0) return "Reroll all";
  return `Keep ${advice.heldFaces.join(", ")}`;
}

function formatCategory(category: Category): string {
  return category
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function PlayScreen({
  state,
  me,
  error,
  onRoll,
  onHold,
  onScore,
  onLearn,
}: Props) {
  const turn = state.turn!;
  const isMyTurn = turn.playerId === me.id;
  const active = state.players.find((p) => p.id === turn.playerId);
  const token = rollToken(turn);
  const [settledToken, setSettledToken] = useState(token);
  const [diceRolling, setDiceRolling] = useState(false);

  const diceSettled = !diceRolling && settledToken === token;
  const showSuggestions =
    turn.hasRolled && diceSettled && active !== undefined;

  const adviceEnabled =
    isMyTurn &&
    turn.hasRolled &&
    turn.rollsLeft > 0 &&
    !turn.holdsFrozen &&
    active !== undefined;

  const { ready: learnReady } = useStrategyAdvice(
    adviceEnabled ? turn.dice : null,
    adviceEnabled && active ? active.sheet : null,
    turn.rollsLeft,
    adviceEnabled,
  );

  const learnAdvice = turn.learnAdvice;
  const showLearnPanel = Boolean(learnAdvice && learnAdvice.length > 0);

  const suggestions = useMemo(() => {
    if (!showSuggestions || !active) return {};
    return suggestScores(turn.dice, active.sheet);
  }, [showSuggestions, active, turn.dice]);

  const eligible = useMemo(() => {
    if (!showSuggestions || !active) return null;
    return ALL_CATEGORIES.filter((c) =>
      canScoreInCategory(turn.dice, active.sheet, c),
    );
  }, [showSuggestions, active, turn.dice]);

  const liveBoard = useMemo(
    () =>
      mergeLiveLeaderboard(
        state.leaderboard,
        state.players,
        turn.playerId,
      ),
    [state.leaderboard, state.players, turn.playerId],
  );

  function handleRollingChange(rolling: boolean) {
    setDiceRolling(rolling);
    if (!rolling) setSettledToken(rollToken(turn));
  }

  return (
    <div className="screen play-screen">
      <div className="felt-glow" />
      <header className="play-header">
        <h1 className="brand brand-sm">Burian Studio</h1>
        <div className={`turn-banner ${isMyTurn ? "yours" : ""}`}>
          {isMyTurn ? (
            <span>Your turn</span>
          ) : active && !active.connected ? (
            <span>
              Waiting for <strong>{active.name}</strong> to rejoin…
            </span>
          ) : (
            <span>
              <strong>{active?.name ?? "…"}</strong> is rolling
            </span>
          )}
        </div>
      </header>

      <div className="play-layout">
        <aside className="play-sidebar">
          <Leaderboard entries={liveBoard} side />
        </aside>

        <div className="play-main">
          <div className="roster">
            {state.players.map((p) => (
              <div
                key={p.id}
                className={`roster-item ${p.id === turn.playerId ? "active" : ""} ${
                  p.id === me.id ? "you" : ""
                } ${p.connected ? "" : "away"}`}
              >
                <span className="rname">
                  {p.name}
                  {!p.connected ? " (away)" : ""}
                </span>
                <span className="rtotal">{p.total} pts</span>
                <span className="rest" title="Estimated final total (optimal play)">
                  est {Math.round(p.estimatedTotal)}
                </span>
              </div>
            ))}
          </div>

          <DiceTray
            dice={turn.dice}
            held={turn.held}
            hasRolled={turn.hasRolled}
            rollsLeft={turn.rollsLeft}
            holdsFrozen={Boolean(turn.holdsFrozen)}
            interactive={isMyTurn}
            learnReady={learnReady}
            learnOpen={showLearnPanel || Boolean(turn.holdsFrozen)}
            onHold={onHold}
            onRoll={onRoll}
            onLearn={onLearn}
            onRollingChange={handleRollingChange}
          />

          {showLearnPanel && learnAdvice && (
            <div className="learn-panel" aria-live="polite">
              <p className="learn-title">Best moves (estimated total)</p>
              <ol className="learn-list">
                {learnAdvice.map((advice, i) => (
                  <li key={`${formatAdvice(advice)}-${i}`}>
                    <span className="learn-move">{formatAdvice(advice)}</span>
                    <span className="learn-ev">
                      {advice.expected.toFixed(1)} pts
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="sheets-row">
            {state.players.map((p) => {
              const isActive = p.id === turn.playerId;
              const canScore = isMyTurn && isActive && showSuggestions;
              return (
                <ScoreSheet
                  key={p.id}
                  title={p.id === me.id ? `${p.name} (you)` : p.name}
                  sheet={p.sheet}
                  upperBonus={p.upperBonus}
                  upperSub={upperSubtotal(p.sheet)}
                  yahtzeeBonus={p.yahtzeeBonus}
                  total={p.total}
                  suggestions={isActive && showSuggestions ? suggestions : {}}
                  eligible={isActive && showSuggestions ? eligible : null}
                  canScore={canScore}
                  onScore={onScore}
                  highlight={isActive}
                />
              );
            })}
          </div>

          {error && <p className="banner error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
