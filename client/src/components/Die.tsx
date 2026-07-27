import type { DieValue } from "@yathze/shared";

const FACE_SRC: Record<DieValue, string> = {
  1: "/dice/1.png",
  2: "/dice/2.png",
  3: "/dice/3.png",
  4: "/dice/4.png",
  5: "/dice/5.png",
  6: "/dice/6.png",
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
        {revealed ? (
          <img
            className="die-img"
            src={FACE_SRC[value]}
            alt=""
            draggable={false}
          />
        ) : null}
      </span>
      {held && <span className="hold-tag">Keep</span>}
    </button>
  );
}
