import { useEffect, useRef, useState } from "react";
import type { DieValue } from "@yathze/shared";
import { isYahtzeeDice, playSound } from "../sounds";
import { Die } from "./Die";

interface Props {
  dice: DieValue[];
  held: boolean[];
  hasRolled: boolean;
  rollsLeft: number;
  holdsFrozen: boolean;
  interactive: boolean;
  learnReady: boolean;
  learnOpen: boolean;
  onHold: (index: number) => void;
  onRoll: () => void;
  onLearn: () => void;
  /** True while faces are still cycling before the final result. */
  onRollingChange?: (rolling: boolean) => void;
}

function randomFace(): DieValue {
  return (Math.floor(Math.random() * 6) + 1) as DieValue;
}

const ROLL_TICKS = 28;

/** Fast at first, then normal, then slow toward settle (ms between face changes). */
function tickDelayMs(tickIndex: number, totalTicks: number): number {
  const t = totalTicks <= 1 ? 1 : tickIndex / (totalTicks - 1);
  const eased = t * t;
  return Math.round(26 + eased * 95);
}

export function DiceTray({
  dice,
  held,
  hasRolled,
  rollsLeft,
  holdsFrozen,
  interactive,
  learnReady,
  learnOpen,
  onHold,
  onRoll,
  onLearn,
  onRollingChange,
}: Props) {
  const [display, setDisplay] = useState<DieValue[]>(dice);
  const [rolling, setRolling] = useState(false);
  const prevRolls = useRef(rollsLeft);
  const prevPlayerDice = useRef(dice.join(","));
  const onRollingChangeRef = useRef(onRollingChange);
  onRollingChangeRef.current = onRollingChange;

  function setRollingState(next: boolean) {
    setRolling(next);
    onRollingChangeRef.current?.(next);
  }

  useEffect(() => {
    const key = dice.join(",");
    const rolled =
      hasRolled &&
      (rollsLeft < prevRolls.current ||
        (prevRolls.current === rollsLeft && key !== prevPlayerDice.current));

    prevRolls.current = rollsLeft;
    prevPlayerDice.current = key;

    if (!hasRolled) {
      setDisplay(dice);
      setRollingState(false);
      return;
    }

    if (!rolled) {
      setDisplay(dice);
      return;
    }

    setRollingState(true);
    let tick = 0;
    let timeoutId = 0;

    const step = () => {
      tick += 1;
      setDisplay((prev) =>
        prev.map((face, i) => {
          if (held[i]) return face;
          let next = randomFace();
          if (next === face) next = (((face % 6) + 1) as DieValue);
          return next;
        }),
      );
      if (tick >= ROLL_TICKS) {
        setDisplay(dice);
        setRollingState(false);
        if (isYahtzeeDice(dice)) playSound("yathze");
        return;
      }
      timeoutId = window.setTimeout(step, tickDelayMs(tick, ROLL_TICKS));
    };

    timeoutId = window.setTimeout(step, tickDelayMs(0, ROLL_TICKS));

    return () => window.clearTimeout(timeoutId);
  }, [dice, held, hasRolled, rollsLeft]);

  const canLearn =
    interactive &&
    hasRolled &&
    !rolling &&
    rollsLeft > 0 &&
    !holdsFrozen &&
    learnReady &&
    !learnOpen;

  const canHold =
    interactive && hasRolled && !rolling && !holdsFrozen;

  return (
    <section className="dice-tray">
      <div className="dice-row">
        {display.map((value, i) => (
          <Die
            key={i}
            value={value}
            held={held[i]!}
            revealed={hasRolled}
            interactive={canHold}
            onClick={() => onHold(i)}
          />
        ))}
      </div>
      <div className="dice-actions">
        <p className="rolls-left">
          {hasRolled
            ? `${rollsLeft} roll${rollsLeft === 1 ? "" : "s"} left`
            : "Ready to roll"}
          {holdsFrozen ? " · holds locked" : ""}
        </p>
        <div className="dice-btn-row">
          <button
            type="button"
            className="btn primary roll-btn"
            disabled={!interactive || rollsLeft <= 0 || rolling}
            onClick={onRoll}
          >
            {hasRolled ? "Roll again" : "Roll dice"}
          </button>
          <button
            type="button"
            className="btn learn-btn"
            disabled={!canLearn}
            onClick={onLearn}
            title={
              !learnReady && hasRolled && rollsLeft > 0
                ? "Calculating best moves…"
                : "Show top hold strategies"
            }
          >
            Learn
          </button>
        </div>
        {interactive && hasRolled && !rolling && !holdsFrozen && (
          <p className="hint">Tap dice you want to keep</p>
        )}
        {holdsFrozen && (
          <p className="hint">Holds frozen — roll to continue</p>
        )}
      </div>
    </section>
  );
}
