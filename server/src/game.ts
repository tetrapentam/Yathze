import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  ALL_CATEGORIES,
  computeTotal,
  computeUpperBonus,
  estimatedTotalFromSheet,
  heldFacesFromMask,
  isSheetComplete,
  MAX_PLAYERS,
  MAX_ROLLS,
  MIN_PLAYERS,
  matchAdviceRank,
  rollDice,
  scoreCategory,
  canScoreInCategory,
  wouldEarnYahtzeeBonus,
  YAHTZEE_BONUS_POINTS,
  rankOptimalMoves,
  type Category,
  type DieValue,
  type GameState,
  type LeaderboardEntry,
  type LearnHint,
  type MoveAccuracy,
  type PlayerPublic,
  type ScoreSheet,
  type SeriesRound,
  type SeriesState,
  type TurnState,
} from "@yathze/shared";
import { getLeaderboard, recordGameScores } from "./leaderboard.js";

interface InternalPlayer {
  id: string;
  socketId: string | null;
  reconnectToken: string;
  name: string;
  isHost: boolean;
  sheet: ScoreSheet;
  yahtzeeBonus: number;
  connected: boolean;
  accuracy: MoveAccuracy;
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_FAILED_INVITES = 5;
const INVITE_COOLDOWN_MS = 15_000;
/** Soft-disconnect grace before the seat is removed permanently. */
const RECONNECT_GRACE_MS = 10 * 60 * 1000;

function emptyHeld(): boolean[] {
  return [false, false, false, false, false];
}

function freshDice(): DieValue[] {
  return [1, 1, 1, 1, 1];
}

function emptyAccuracy(): MoveAccuracy {
  return { decisions: 0, top1: 0, top2: 0, top3: 0 };
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

function newReconnectToken(): string {
  return randomBytes(24).toString("base64url");
}

function toPublic(p: InternalPlayer): PlayerPublic {
  const total = computeTotal(p.sheet, p.yahtzeeBonus);
  let estimatedTotal = total;
  try {
    estimatedTotal = estimatedTotalFromSheet(p.sheet, total);
  } catch {
    // Opt table not loaded yet — fall back to scored total.
  }
  return {
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    connected: p.connected,
    sheet: { ...p.sheet },
    upperBonus: computeUpperBonus(p.sheet),
    yahtzeeBonus: p.yahtzeeBonus,
    total,
    estimatedTotal,
  };
}

export function generateInviteCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length]!;
  }
  return code;
}

function codesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a.toUpperCase());
  const right = Buffer.from(b.toUpperCase());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type JoinOk = {
  ok: true;
  playerId: string;
  reconnectToken: string;
  inviteCode?: string;
};

export type JoinErr = { ok: false; error: string };

export class GameRoom {
  private players: InternalPlayer[] = [];
  private phase: GameState["phase"] = "lobby";
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private turn: TurnState | null = null;
  private winners: string[] = [];
  private inviteCode: string;
  private leaderboard: LeaderboardEntry[] = getLeaderboard();
  private series: SeriesState = { rounds: [] };
  private failedInvites = new Map<string, { count: number; lockedUntil: number }>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private onChange: (() => void) | null = null;

  constructor(inviteCode?: string) {
    this.inviteCode = inviteCode ?? generateInviteCode();
  }

  /** Called when a grace timer hard-removes a player so the server can broadcast. */
  setChangeListener(listener: () => void): void {
    this.onChange = listener;
  }

  getInviteCode(): string {
    return this.inviteCode;
  }

  getState(): GameState {
    return {
      phase: this.phase,
      players: this.players.map(toPublic),
      turn: this.turn
        ? {
            ...this.turn,
            dice: [...this.turn.dice],
            held: [...this.turn.held],
            learnAdvice: this.turn.learnAdvice
              ? this.turn.learnAdvice.map((h) =>
                  h.kind === "hold"
                    ? {
                        kind: "hold" as const,
                        heldFaces: [...h.heldFaces],
                        expected: h.expected,
                      }
                    : {
                        kind: "score" as const,
                        category: h.category,
                        expected: h.expected,
                      },
                )
              : null,
          }
        : null,
      winners: [...this.winners],
      maxPlayers: MAX_PLAYERS,
      inviteRequired: this.players.length > 0,
      leaderboard: this.leaderboard.map((e) => ({ ...e })),
      series: {
        rounds: this.series.rounds.map((r) => ({
          winners: [...r.winners],
          players: r.players.map((p) => ({
            ...p,
            accuracy: { ...p.accuracy },
          })),
        })),
      },
    };
  }

  getPlayerBySocket(socketId: string): InternalPlayer | undefined {
    return this.players.find((p) => p.socketId === socketId);
  }

  join(
    socketId: string,
    name: string,
    inviteCode: string,
  ): JoinOk | JoinErr {
    const trimmed = name.trim().slice(0, 16);
    if (!trimmed) return { ok: false, error: "Enter a username." };
    if (this.phase !== "lobby") return { ok: false, error: "Game already in progress." };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: "Room is full." };
    if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: "That name is taken." };
    }
    if (this.players.some((p) => p.socketId === socketId)) {
      return { ok: false, error: "Already joined." };
    }

    const isHost = this.players.length === 0;
    if (!isHost) {
      const rate = this.checkInviteRateLimit(socketId);
      if (!rate.ok) return rate;

      const provided = typeof inviteCode === "string" ? inviteCode.trim() : "";
      if (!provided || !codesEqual(provided, this.inviteCode)) {
        this.recordFailedInvite(socketId);
        return { ok: false, error: "Invalid invite code. Use the host's invite link." };
      }
    }

    this.failedInvites.delete(socketId);
    const playerId = newId();
    const reconnectToken = newReconnectToken();
    this.players.push({
      id: playerId,
      socketId,
      reconnectToken,
      name: trimmed,
      isHost,
      sheet: {},
      yahtzeeBonus: 0,
      connected: true,
      accuracy: emptyAccuracy(),
    });
    return isHost
      ? { ok: true, playerId, reconnectToken, inviteCode: this.inviteCode }
      : { ok: true, playerId, reconnectToken };
  }

  /**
   * Reclaim a seat after a drop or page refresh using the reconnect token.
   */
  rejoin(
    socketId: string,
    reconnectToken: string,
  ): JoinOk | JoinErr {
    const token = typeof reconnectToken === "string" ? reconnectToken.trim() : "";
    if (!token) return { ok: false, error: "Missing session." };

    const player = this.players.find((p) => p.reconnectToken === token);
    if (!player) {
      return { ok: false, error: "Session expired. Join again when the table is in lobby." };
    }

    // Kick any stale socket still bound to this seat.
    if (player.socketId && player.socketId !== socketId) {
      player.socketId = null;
    }

    this.clearDisconnectTimer(player.id);
    player.socketId = socketId;
    player.connected = true;
    this.failedInvites.delete(socketId);

    return {
      ok: true,
      playerId: player.id,
      reconnectToken: player.reconnectToken,
      ...(player.isHost ? { inviteCode: this.inviteCode } : {}),
    };
  }

  /**
   * Soft-disconnect: keep the seat and scorecard so the player can rejoin.
   */
  disconnect(socketId: string): void {
    this.failedInvites.delete(socketId);
    const player = this.getPlayerBySocket(socketId);
    if (!player) return;

    player.connected = false;
    player.socketId = null;
    this.scheduleHardLeave(player.id);
  }

  /** Permanently remove a seat (grace expiry or empty-room cleanup). */
  leave(playerId: string): void {
    this.clearDisconnectTimer(playerId);
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;

    const wasHost = this.players[idx]!.isHost;
    this.players.splice(idx, 1);

    if (wasHost && this.players.length > 0) {
      this.players[0]!.isHost = true;
    }

    if (this.phase === "lobby") {
      if (this.players.length === 0) {
        this.resetToLobby();
      }
      return;
    }

    if (this.players.length === 0) {
      this.resetToLobby();
      return;
    }

    if (this.phase === "playing" && this.turn?.playerId === playerId) {
      this.advanceAfterLeave();
    } else if (this.phase === "playing") {
      const currentId = this.turn?.playerId;
      this.turnOrder = this.turnOrder.filter((id) => id !== playerId);
      if (currentId) {
        const nextIdx = this.turnOrder.indexOf(currentId);
        this.turnIndex = nextIdx >= 0 ? nextIdx : 0;
      }
    }
  }

  /** Host who reconnected / already seated can fetch the code. */
  revealInviteIfHost(socketId: string): string | null {
    const player = this.getPlayerBySocket(socketId);
    return player?.isHost ? this.inviteCode : null;
  }

  start(socketId: string): { ok: true } | { ok: false; error: string } {
    const player = this.getPlayerBySocket(socketId);
    if (!player?.isHost) return { ok: false, error: "Only the host can start." };
    if (this.phase !== "lobby") return { ok: false, error: "Already started." };
    if (this.players.length < MIN_PLAYERS) {
      return { ok: false, error: `Need at least ${MIN_PLAYERS} players.` };
    }

    for (const p of this.players) {
      p.sheet = {};
      p.yahtzeeBonus = 0;
      p.accuracy = emptyAccuracy();
    }
    this.series = { rounds: [] };
    this.turnOrder = this.players.map((p) => p.id);
    this.turnIndex = 0;
    this.winners = [];
    this.phase = "playing";
    this.beginTurn();
    return { ok: true };
  }

  holdDice(
    socketId: string,
    index: number,
  ): { ok: true } | { ok: false; error: string } {
    if (!this.isActivePlayer(socketId) || !this.turn) {
      return { ok: false, error: "Not your turn." };
    }
    if (!this.turn.hasRolled) {
      return { ok: false, error: "Roll first." };
    }
    if (this.turn.holdsFrozen) {
      return { ok: false, error: "Holds are locked after Learn." };
    }
    if (index < 0 || index > 4) return { ok: false, error: "Invalid die." };
    this.turn.held[index] = !this.turn.held[index];
    return { ok: true };
  }

  /**
   * Freeze the current hold selection and broadcast top-3 advice to all players.
   */
  learn(socketId: string): { ok: true } | { ok: false; error: string } {
    if (!this.isActivePlayer(socketId) || !this.turn) {
      return { ok: false, error: "Not your turn." };
    }
    if (!this.turn.hasRolled) {
      return { ok: false, error: "Roll first." };
    }
    if (this.turn.rollsLeft <= 0) {
      return { ok: false, error: "No rolls left to learn for." };
    }
    if (this.turn.holdsFrozen) {
      return { ok: false, error: "Already learning this roll." };
    }

    const player = this.getPlayerBySocket(socketId)!;
    try {
      const top3 = rankOptimalMoves(
        this.turn.dice,
        player.sheet,
        this.turn.rollsLeft,
        3,
      );
      const scored = computeTotal(player.sheet, player.yahtzeeBonus);
      this.turn.holdsFrozen = true;
      this.turn.learnAdvice = top3.map((h): LearnHint => {
        if (h.kind === "hold") {
          return {
            kind: "hold",
            heldFaces: [...h.heldFaces],
            expected: scored + h.expected,
          };
        }
        return {
          kind: "score",
          category: h.category,
          expected: scored + h.expected,
        };
      });
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: "Strategy table missing. Run npm run build:opt-table.",
      };
    }
  }

  roll(socketId: string): { ok: true } | { ok: false; error: string } {
    if (!this.isActivePlayer(socketId) || !this.turn) {
      return { ok: false, error: "Not your turn." };
    }
    if (this.turn.rollsLeft <= 0) {
      return { ok: false, error: "No rolls left." };
    }

    const player = this.getPlayerBySocket(socketId)!;

    // Grade hold decision before mutating (skip the opening roll of a turn).
    if (this.turn.hasRolled) {
      this.recordDecision(player, {
        kind: "hold",
        heldFaces: heldFacesFromMask(this.turn.dice, this.turn.held),
      });
    }

    if (!this.turn.hasRolled) {
      this.turn.held = emptyHeld();
      this.turn.dice = rollDice(emptyHeld(), freshDice());
    } else {
      this.turn.dice = rollDice(this.turn.held, this.turn.dice);
    }
    this.turn.rollsLeft -= 1;
    this.turn.hasRolled = true;
    this.turn.holdsFrozen = false;
    this.turn.learnAdvice = null;
    return { ok: true };
  }

  score(
    socketId: string,
    category: Category,
  ): { ok: true } | { ok: false; error: string } {
    if (!this.isActivePlayer(socketId) || !this.turn) {
      return { ok: false, error: "Not your turn." };
    }
    if (!this.turn.hasRolled) {
      return { ok: false, error: "Roll before scoring." };
    }
    if (!ALL_CATEGORIES.includes(category)) {
      return { ok: false, error: "Invalid category." };
    }

    const player = this.getPlayerBySocket(socketId)!;
    if (player.sheet[category] !== undefined) {
      return { ok: false, error: "Category already filled." };
    }
    if (!canScoreInCategory(this.turn.dice, player.sheet, category)) {
      return { ok: false, error: "That box isn't allowed for this roll." };
    }

    this.recordDecision(player, { kind: "score", category });

    if (wouldEarnYahtzeeBonus(this.turn.dice, player.sheet)) {
      player.yahtzeeBonus += YAHTZEE_BONUS_POINTS;
    }
    player.sheet[category] = scoreCategory(
      this.turn.dice,
      category,
      player.sheet,
    );
    this.nextTurnOrFinish();
    return { ok: true };
  }

  returnToLobby(socketId: string): { ok: true } | { ok: false; error: string } {
    const player = this.getPlayerBySocket(socketId);
    if (!player?.isHost) return { ok: false, error: "Only the host can reset." };
    if (this.phase !== "finished") return { ok: false, error: "Game not finished." };
    this.resetToLobbyKeepPlayers();
    return { ok: true };
  }

  continueSeries(socketId: string): { ok: true } | { ok: false; error: string } {
    const player = this.getPlayerBySocket(socketId);
    if (!player?.isHost) return { ok: false, error: "Only the host can continue." };
    if (this.phase !== "finished") return { ok: false, error: "Game not finished." };
    if (this.players.length < MIN_PLAYERS) {
      return { ok: false, error: `Need at least ${MIN_PLAYERS} players.` };
    }

    for (const p of this.players) {
      p.sheet = {};
      p.yahtzeeBonus = 0;
      p.accuracy = emptyAccuracy();
    }
    this.turnOrder = this.players.map((p) => p.id);
    this.turnIndex = 0;
    this.winners = [];
    this.phase = "playing";
    this.beginTurn();
    return { ok: true };
  }

  private scheduleHardLeave(playerId: string): void {
    this.clearDisconnectTimer(playerId);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      const still = this.players.find((p) => p.id === playerId);
      if (!still || still.connected) return;
      this.leave(playerId);
      this.onChange?.();
    }, RECONNECT_GRACE_MS);
    this.disconnectTimers.set(playerId, timer);
  }

  private clearDisconnectTimer(playerId: string): void {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }
  }

  private checkInviteRateLimit(
    socketId: string,
  ): { ok: true } | { ok: false; error: string } {
    const entry = this.failedInvites.get(socketId);
    if (!entry) return { ok: true };
    if (entry.lockedUntil > Date.now()) {
      const secs = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
      return { ok: false, error: `Too many attempts. Try again in ${secs}s.` };
    }
    return { ok: true };
  }

  private recordFailedInvite(socketId: string): void {
    const entry = this.failedInvites.get(socketId) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILED_INVITES) {
      entry.lockedUntil = Date.now() + INVITE_COOLDOWN_MS;
      entry.count = 0;
    }
    this.failedInvites.set(socketId, entry);
  }

  private isActivePlayer(socketId: string): boolean {
    const player = this.getPlayerBySocket(socketId);
    return (
      this.phase === "playing" &&
      !!player &&
      player.connected &&
      this.turn?.playerId === player.id
    );
  }

  private beginTurn(): void {
    const playerId = this.turnOrder[this.turnIndex]!;
    this.turn = {
      playerId,
      dice: freshDice(),
      held: emptyHeld(),
      rollsLeft: MAX_ROLLS,
      hasRolled: false,
      holdsFrozen: false,
      learnAdvice: null,
    };
  }

  private nextTurnOrFinish(): void {
    const allDone = this.players.every((p) => isSheetComplete(p.sheet));
    if (allDone) {
      this.finishGame();
      return;
    }

    let safety = this.turnOrder.length * 2;
    do {
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
      const nextId = this.turnOrder[this.turnIndex]!;
      const next = this.players.find((p) => p.id === nextId);
      if (next && !isSheetComplete(next.sheet)) {
        this.beginTurn();
        return;
      }
      safety -= 1;
    } while (safety > 0);

    this.finishGame();
  }

  private advanceAfterLeave(): void {
    this.turnOrder = this.turnOrder.filter((id) =>
      this.players.some((p) => p.id === id),
    );
    if (this.turnOrder.length === 0) {
      this.resetToLobby();
      return;
    }
    if (this.players.every((p) => isSheetComplete(p.sheet))) {
      this.finishGame();
      return;
    }
    this.turnIndex = this.turnIndex % this.turnOrder.length;
    let safety = this.turnOrder.length * 2;
    while (safety > 0) {
      const nextId = this.turnOrder[this.turnIndex]!;
      const next = this.players.find((p) => p.id === nextId);
      if (next && !isSheetComplete(next.sheet)) {
        this.beginTurn();
        return;
      }
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
      safety -= 1;
    }
    this.finishGame();
  }

  private finishGame(): void {
    this.phase = "finished";
    this.turn = null;
    const scored = this.players.map((p) => ({
      id: p.id,
      total: computeTotal(p.sheet, p.yahtzeeBonus),
    }));
    const best = Math.max(...scored.map((s) => s.total), 0);
    this.winners = scored.filter((s) => s.total === best).map((s) => s.id);

    const round: SeriesRound = {
      winners: [...this.winners],
      players: this.players.map((p) => ({
        playerId: p.id,
        name: p.name,
        total: computeTotal(p.sheet, p.yahtzeeBonus),
        won: this.winners.includes(p.id),
        accuracy: { ...p.accuracy },
      })),
    };
    this.series.rounds.push(round);

    this.leaderboard = recordGameScores(
      this.players.map((p) => ({
        name: p.name,
        score: computeTotal(p.sheet, p.yahtzeeBonus),
      })),
    );
  }

  private recordDecision(
    player: InternalPlayer,
    actual: { kind: "hold"; heldFaces: DieValue[] } | { kind: "score"; category: Category },
  ): void {
    if (!this.turn) return;
    try {
      const advice = rankOptimalMoves(
        this.turn.dice,
        player.sheet,
        this.turn.rollsLeft,
        3,
      );
      const rank = matchAdviceRank(actual, advice);
      player.accuracy.decisions += 1;
      if (rank === 1) player.accuracy.top1 += 1;
      if (rank === 1 || rank === 2) player.accuracy.top2 += 1;
      if (rank >= 1) player.accuracy.top3 += 1;
    } catch {
      // Opt table missing — skip grading rather than blocking play.
    }
  }

  private resetToLobby(): void {
    for (const id of this.disconnectTimers.keys()) {
      this.clearDisconnectTimer(id);
    }
    this.phase = "lobby";
    this.turn = null;
    this.turnOrder = [];
    this.turnIndex = 0;
    this.winners = [];
    this.players = [];
    this.series = { rounds: [] };
    this.inviteCode = generateInviteCode();
    this.failedInvites.clear();
  }

  private resetToLobbyKeepPlayers(): void {
    this.phase = "lobby";
    this.turn = null;
    this.turnOrder = [];
    this.turnIndex = 0;
    this.winners = [];
    this.series = { rounds: [] };
    for (const p of this.players) {
      p.sheet = {};
      p.yahtzeeBonus = 0;
      p.accuracy = emptyAccuracy();
    }
  }
}
