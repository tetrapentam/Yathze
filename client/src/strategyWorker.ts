import {
  isOptTableLoaded,
  loadOptTable,
  OPT_STATE_COUNT,
  rankOptimalMoves,
  type DieValue,
  type MoveAdvice,
  type ScoreSheet,
} from "@yathze/shared";

export interface StrategyWorkerRequest {
  id: number;
  dice: DieValue[];
  sheet: ScoreSheet;
  rollsLeft: number;
}

export interface StrategyWorkerResponse {
  id: number;
  top3: MoveAdvice[];
}

let tablePromise: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (isOptTableLoaded()) return Promise.resolve();
  if (!tablePromise) {
    tablePromise = fetch("/OptEScore.bin")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load OptEScore.bin (${res.status})`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        loadOptTable(buf);
        if (!isOptTableLoaded()) {
          throw new Error(`Opt table load failed (expected ${OPT_STATE_COUNT})`);
        }
      })
      .catch((err) => {
        tablePromise = null;
        throw err;
      });
  }
  return tablePromise;
}

self.onmessage = async (event: MessageEvent<StrategyWorkerRequest>) => {
  const { id, dice, sheet, rollsLeft } = event.data;
  try {
    await ensureTable();
    const top3 = rankOptimalMoves(dice, sheet, rollsLeft, 3);
    const response: StrategyWorkerResponse = { id, top3 };
    self.postMessage(response);
  } catch (err) {
    console.error(err);
    self.postMessage({ id, top3: [] } satisfies StrategyWorkerResponse);
  }
};
