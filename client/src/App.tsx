import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { Category, GameState } from "@yathze/shared";
import { JoinScreen } from "./components/JoinScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { PlayScreen } from "./components/PlayScreen";
import { ResultsScreen } from "./components/ResultsScreen";
import { playSound } from "./sounds";

function createSocket(): Socket {
  const url =
    import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : undefined;
  return io(url, { autoConnect: true });
}

function readCodeFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("code")?.trim() ?? "";
  } catch {
    return "";
  }
}

function sheetFilledKeys(sheet: Record<string, number | undefined>): string[] {
  return Object.keys(sheet).filter((k) => sheet[k] !== undefined);
}

export default function App() {
  const [socket] = useState(createSocket);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [initialInvite] = useState(readCodeFromUrl);
  const prevState = useRef<GameState | null>(null);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setMyId(socket.id ?? null);
    };
    const onDisconnect = () => setConnected(false);
    const onState = (next: GameState) => {
      const prev = prevState.current;
      if (prev && prev.phase === "playing") {
        const prevTurn = prev.turn;
        const nextTurn = next.turn;
        if (
          next.phase === "playing" &&
          prevTurn &&
          nextTurn &&
          nextTurn.rollsLeft < prevTurn.rollsLeft &&
          nextTurn.playerId === prevTurn.playerId
        ) {
          playSound("dice");
        }

        for (const player of next.players) {
          const before = prev.players.find((p) => p.id === player.id);
          if (!before) continue;
          const prevKeys = new Set(sheetFilledKeys(before.sheet));
          for (const cat of sheetFilledKeys(player.sheet)) {
            if (prevKeys.has(cat)) continue;
            playSound("pencil");
            if (cat === "yahtzee" && player.sheet.yahtzee === 50) {
              playSound("yathze");
            }
            break;
          }
        }
      }
      prevState.current = next;
      setState(next);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
    };
  }, [socket]);

  useEffect(() => {
    if (socket.id) setMyId(socket.id);
  }, [socket.id, connected]);

  const me = useMemo(
    () => state?.players.find((p) => p.id === myId) ?? null,
    [state, myId],
  );

  useEffect(() => {
    if (!me?.isHost || inviteCode) return;
    socket.emit(
      "getInviteCode",
      (res: { ok: boolean; inviteCode?: string }) => {
        if (res.ok && res.inviteCode) setInviteCode(res.inviteCode);
      },
    );
  }, [me?.isHost, inviteCode, socket]);

  const join = useCallback(
    (name: string, code: string) => {
      setError(null);
      socket.emit(
        "join",
        { name, inviteCode: code },
        (res: { ok: boolean; error?: string; inviteCode?: string }) => {
          if (res.ok) {
            setJoined(true);
            setMyId(socket.id ?? null);
            if (res.inviteCode) setInviteCode(res.inviteCode);
          } else {
            setError(res.error ?? "Could not join.");
          }
        },
      );
    },
    [socket],
  );

  const startGame = useCallback(() => {
    setError(null);
    socket.emit("startGame", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? "Could not start.");
    });
  }, [socket]);

  const roll = useCallback(() => {
    socket.emit("roll", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? "Roll failed.");
    });
  }, [socket]);

  const holdDice = useCallback(
    (index: number) => {
      socket.emit("holdDice", index, (res: { ok: boolean; error?: string }) => {
        if (!res.ok) setError(res.error ?? "Hold failed.");
      });
    },
    [socket],
  );

  const learn = useCallback(() => {
    socket.emit("learn", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? "Learn failed.");
    });
  }, [socket]);

  const score = useCallback(
    (category: Category) => {
      socket.emit("score", category, (res: { ok: boolean; error?: string }) => {
        if (!res.ok) setError(res.error ?? "Score failed.");
      });
    },
    [socket],
  );

  const returnToLobby = useCallback(() => {
    socket.emit("returnToLobby", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? "Reset failed.");
    });
  }, [socket]);

  useEffect(() => {
    if (state && me) setJoined(true);
    if (state && !me && joined) {
      setJoined(false);
      setInviteCode(null);
    }
  }, [state, me, joined]);

  if (!state) {
    return (
      <div className="screen center">
        <div className="felt-glow" />
        <p className="status-text">
          {connected ? "Loading table…" : "Connecting to host…"}
        </p>
      </div>
    );
  }

  if (!joined || !me) {
    return (
      <JoinScreen
        onJoin={join}
        error={error}
        playerCount={state.players.length}
        maxPlayers={state.maxPlayers}
        phase={state.phase}
        inviteRequired={state.inviteRequired}
        initialInviteCode={initialInvite}
      />
    );
  }

  if (state.phase === "lobby") {
    return (
      <LobbyScreen
        players={state.players}
        me={me}
        error={error}
        inviteCode={me.isHost ? inviteCode : null}
        leaderboard={state.leaderboard}
        onStart={startGame}
      />
    );
  }

  if (state.phase === "finished") {
    return (
      <ResultsScreen
        players={state.players}
        winners={state.winners}
        me={me}
        leaderboard={state.leaderboard}
        onReturn={returnToLobby}
      />
    );
  }

  return (
    <PlayScreen
      state={state}
      me={me}
      error={error}
      onRoll={roll}
      onHold={holdDice}
      onScore={score}
      onLearn={learn}
    />
  );
}
