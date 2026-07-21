import {
  CATEGORY_LABELS,
  LOWER_CATEGORIES,
  UPPER_BONUS_THRESHOLD,
  UPPER_CATEGORIES,
  type Category,
  type ScoreSheet,
} from "@yathze/shared";

interface Props {
  title: string;
  sheet: ScoreSheet;
  upperBonus: number;
  upperSub: number;
  yahtzeeBonus: number;
  total: number;
  suggestions: Partial<Record<Category, number>>;
  canScore: boolean;
  /** When set, only these empty categories are clickable (joker turns). */
  eligible?: Category[] | null;
  onScore: (category: Category) => void;
  highlight?: boolean;
  compact?: boolean;
}

function Row({
  category,
  sheet,
  suggestions,
  canScore,
  eligible,
  onScore,
}: {
  category: Category;
  sheet: ScoreSheet;
  suggestions: Partial<Record<Category, number>>;
  canScore: boolean;
  eligible?: Category[] | null;
  onScore: (category: Category) => void;
}) {
  const filled = sheet[category];
  const suggestion = suggestions[category];
  const isFilled = filled !== undefined;
  const allowed = !eligible || eligible.includes(category);
  const clickable = canScore && !isFilled && allowed;

  return (
    <button
      type="button"
      className={`score-row ${isFilled ? "filled" : ""} ${
        suggestion !== undefined ? "suggest" : ""
      } ${clickable ? "clickable" : ""}`}
      disabled={!clickable}
      onClick={() => onScore(category)}
    >
      <span className="cat-label">{CATEGORY_LABELS[category]}</span>
      <span className="cat-value">
        {isFilled ? (
          filled
        ) : suggestion !== undefined ? (
          <span className="suggestion">{suggestion}</span>
        ) : (
          <span className="empty">—</span>
        )}
      </span>
    </button>
  );
}

export function ScoreSheet({
  title,
  sheet,
  upperBonus,
  upperSub,
  yahtzeeBonus,
  total,
  suggestions,
  canScore,
  eligible,
  onScore,
  highlight,
  compact,
}: Props) {
  return (
    <aside
      className={`score-sheet ${highlight ? "highlight" : ""} ${
        compact ? "compact" : ""
      }`}
    >
      <header className="sheet-head">
        <h2>{title}</h2>
        <span className="sheet-total">{total}</span>
      </header>

      <div className="sheet-section">
        <p className="section-label">Upper</p>
        {UPPER_CATEGORIES.map((cat) => (
          <Row
            key={cat}
            category={cat}
            sheet={sheet}
            suggestions={suggestions}
            canScore={canScore}
            eligible={eligible}
            onScore={onScore}
          />
        ))}
        <div className="score-row meta-row">
          <span className="cat-label">
            Bonus ({UPPER_BONUS_THRESHOLD})
          </span>
          <span className="cat-value">
            {upperBonus > 0 ? (
              `+${upperBonus}`
            ) : (
              <span className="progress">{upperSub}/{UPPER_BONUS_THRESHOLD}</span>
            )}
          </span>
        </div>
      </div>

      <div className="sheet-section">
        <p className="section-label">Lower</p>
        {LOWER_CATEGORIES.map((cat) => (
          <Row
            key={cat}
            category={cat}
            sheet={sheet}
            suggestions={suggestions}
            canScore={canScore}
            eligible={eligible}
            onScore={onScore}
          />
        ))}
        <div className="score-row meta-row">
          <span className="cat-label">Yahtzee Bonus</span>
          <span className="cat-value">
            {yahtzeeBonus > 0 ? (
              `+${yahtzeeBonus}`
            ) : (
              <span className="empty">—</span>
            )}
          </span>
        </div>
      </div>
    </aside>
  );
}
