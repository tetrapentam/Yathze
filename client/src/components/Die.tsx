import type { DieValue } from "@yathze/shared";

const PIP_MAP: Record<DieValue, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface Props {
  value: DieValue;
  held: boolean;
  revealed: boolean;
  interactive: boolean;
  onClick: () => void;
}

export function Die({
  value,
  held,
  revealed,
  interactive,
  onClick,
}: Props) {
  const pips = PIP_MAP[value];

  return (
    <button
      type="button"
      className={`die ${held ? "held" : ""} ${revealed ? "revealed" : "hidden-face"} ${
        interactive ? "clickable" : ""
      }`}
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      aria-label={`Die showing ${revealed ? value : "unrolled"}${held ? ", held" : ""}`}
      aria-pressed={held}
    >
      <span className="die-face">
        {revealed
          ? Array.from({ length: 9 }, (_, i) => (
              <span
                key={i}
                className={`pip ${pips.includes(i) ? "on" : ""}`}
              />
            ))
          : null}
      </span>
      {held && <span className="hold-tag">Keep</span>}
    </button>
  );
}
