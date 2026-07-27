import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { Category, GameState, PlayerSession } from "@yathze/shared";
import { JoinScreen } from "./components/JoinScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { PlayScreen } from "./components/PlayScreen";
import { ResultsScreen } from "./components/ResultsScreen";
import { clearSession, loadSession, saveSession } from "./session";
import { playSound } from "./sounds";

type SocketAck = {
  ok: boolean;
  error?: string;
  inviteCode?: string;
  playerId?: string;
  reconnectToken?: string;
};

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
  const [myId, setMyId] = useState<string | null>(() => loadSession()?.playerId ?? null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [initialInvite] = useState(readCodeFromUrl);
  const [rejoining, setRejoining] = useState(() => Boolean(loadSession()));
  const prevState = useRef<GameState | null>(null);
  const rejoiningRef = useRef(false);

  const applySessionAck = useCallback(
    (res: SocketAck, nameFallback?: string) => {
      if (!res.ok || !res.playerId || !res.reconnectToken) return false;
      const session: PlayerSession = {
        playerId: res.playerId,
        reconnectToken: res.reconnectToken,
        name: nameFallback ?? loadSession()?.name ?? "",
      };
      saveSession(session);
      setMyId(res.playerId);
      setJoined(true);
      if (res.inviteCode) setInviteCode(res.inviteCode);
      setError(null);
      return true;
    },
    [],
  );

  const tryRejoin = useCallback(() => {
    const session = loadSession();
    if (!session || rejoiningRef.current) {
      if (!session) setRejoining(false);
      return;
    }
    rejoiningRef.current = true;
    setRejoining(true);
    socket.emit(
      "rejoin",
      { reconnectToken: session.reconnectToken },
      (res: SocketAck) => {
        rejoiningRef.current = false;
        setRejoining(false);
        if (applySessionAck(res, session.name)) return;
        clearSession();
        setJoined(false);
        setMyId(null);
        setInviteCode(null);
        if (res.error) setError(res.error);
      },
    );
  }, [socket, applySessionAck]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      tryRejoin();
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
  }, [socket, tryRejoin]);

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
        (res: SocketAck) => {
          if (applySessionAck(res, name.trim().slice(0, 16))) return;
          setError(res.error ?? "Could not join.");
        },
      );
    },
    [socket, applySessionAck],
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

  const continueSeries = useCallback(() => {
    socket.emit("continueSeries", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? "Could not continue.");
    });
  }, [socket]);

  useEffect(() => {
    if (state && me) setJoined(true);
    if (state && myId && !me && joined && !rejoining) {
      // Seat was permanently removed (grace expired / table reset).
      clearSession();
      setJoined(false);
      setMyId(null);
      setInviteCode(null);
    }
  }, [state, me, joined, myId, rejoining]);

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

  if (rejoining) {
    return (
      <div className="screen center">
        <div className="felt-glow" />
        <p className="status-text">Rejoining your seat…</p>
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
        series={state.series}
        onContinue={continueSeries}
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
