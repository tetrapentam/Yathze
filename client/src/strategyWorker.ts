import {
  rankHoldMoves,
  type DieValue,
  type HoldAdvice,
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
  top3: HoldAdvice[];
}

self.onmessage = (event: MessageEvent<StrategyWorkerRequest>) => {
  const { id, dice, sheet, rollsLeft } = event.data;
  const top3 = rankHoldMoves(dice, sheet, rollsLeft, 3);
  const response: StrategyWorkerResponse = { id, top3 };
  self.postMessage(response);
};
