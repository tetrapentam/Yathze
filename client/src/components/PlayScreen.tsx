import { useEffect, useMemo, useState } from "react";
import {
  ALL_CATEGORIES,
  canScoreInCategory,
  suggestScores,
  upperSubtotal,
  type Category,
  type GameState,
  type HoldAdvice,
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

function formatHold(advice: HoldAdvice): string {
  if (advice.heldFaces.length === 0) return "Reroll all";
  return `Keep ${advice.heldFaces.join(", ")}`;
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
  const [learnVisible, setLearnVisible] = useState(false);
  const [shownAdvice, setShownAdvice] = useState<HoldAdvice[] | null>(null);

  const diceSettled = !diceRolling && settledToken === token;
  const showSuggestions =
    turn.hasRolled && diceSettled && active !== undefined;

  const adviceEnabled =
    isMyTurn && turn.hasRolled && turn.rollsLeft > 0 && active !== undefined;

  const { top3, ready: learnReady } = useStrategyAdvice(
    adviceEnabled ? turn.dice : null,
    adviceEnabled && active ? active.sheet : null,
    turn.rollsLeft,
    adviceEnabled,
  );

  useEffect(() => {
    setLearnVisible(false);
    setShownAdvice(null);
  }, [token]);

  useEffect(() => {
    if (turn.holdsFrozen && top3 && top3.length > 0 && isMyTurn) {
      setShownAdvice(top3);
      setLearnVisible(true);
      return;
    }
    if (!turn.holdsFrozen) {
      setLearnVisible(false);
      setShownAdvice(null);
    }
  }, [turn.holdsFrozen, top3, isMyTurn]);

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
        <h1 className="brand brand-sm">Yathze</h1>
        <div className={`turn-banner ${isMyTurn ? "yours" : ""}`}>
          {isMyTurn ? (
            <span>Your turn</span>
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
                }`}
              >
                <span className="rname">{p.name}</span>
                <span className="rtotal">{p.total} pts</span>
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
            learnOpen={learnVisible || Boolean(turn.holdsFrozen)}
            onHold={onHold}
            onRoll={onRoll}
            onLearn={onLearn}
            onRollingChange={handleRollingChange}
          />

          {learnVisible && shownAdvice && shownAdvice.length > 0 && (
            <div className="learn-panel" aria-live="polite">
              <p className="learn-title">Best holds (expected points)</p>
              <ol className="learn-list">
                {shownAdvice.map((advice, i) => (
                  <li key={`${formatHold(advice)}-${i}`}>
                    <span className="learn-move">{formatHold(advice)}</span>
                    <span className="learn-ev">
                      EV {advice.expected.toFixed(1)}
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
