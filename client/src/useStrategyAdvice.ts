import { useEffect, useRef, useState } from "react";
import type { DieValue, HoldAdvice, ScoreSheet } from "@yathze/shared";
import type {
  StrategyWorkerRequest,
  StrategyWorkerResponse,
} from "./strategyWorker";

function adviceToken(
  dice: DieValue[],
  sheet: ScoreSheet,
  rollsLeft: number,
): string {
  const sheetKey = Object.entries(sheet)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
  return `${dice.join(",")}:${rollsLeft}:${sheetKey}`;
}

/**
 * Starts EV ranking as soon as a new roll outcome is known (while dice animate).
 * Work runs in a Web Worker so the UI thread stays free.
 */
export function useStrategyAdvice(
  dice: DieValue[] | null,
  sheet: ScoreSheet | null,
  rollsLeft: number,
  enabled: boolean,
): {
  top3: HoldAdvice[] | null;
  ready: boolean;
  token: string | null;
} {
  const [top3, setTop3] = useState<HoldAdvice[] | null>(null);
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const reqId = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("./strategyWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !dice || !sheet || rollsLeft <= 0) {
      setTop3(null);
      setReady(false);
      setToken(null);
      return;
    }

    const nextToken = adviceToken(dice, sheet, rollsLeft);
    const id = ++reqId.current;
    setTop3(null);
    setReady(false);
    setToken(nextToken);

    const worker = workerRef.current;
    if (!worker) return;

    const onMessage = (event: MessageEvent<StrategyWorkerResponse>) => {
      if (event.data.id !== id) return;
      setTop3(event.data.top3);
      setReady(true);
    };
    worker.addEventListener("message", onMessage);

    const request: StrategyWorkerRequest = {
      id,
      dice: [...dice],
      sheet: { ...sheet },
      rollsLeft,
    };
    worker.postMessage(request);

    return () => {
      worker.removeEventListener("message", onMessage);
    };
  }, [dice, sheet, rollsLeft, enabled]);

  return { top3, ready, token };
}
