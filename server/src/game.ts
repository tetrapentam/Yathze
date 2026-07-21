import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  ALL_CATEGORIES,
  computeTotal,
  computeUpperBonus,
  isSheetComplete,
  MAX_PLAYERS,
  MAX_ROLLS,
  MIN_PLAYERS,
  rollDice,
  scoreCategory,
  canScoreInCategory,
  wouldEarnYahtzeeBonus,
  YAHTZEE_BONUS_POINTS,
  type Category,
  type DieValue,
  type GameState,
  type LeaderboardEntry,
  type PlayerPublic,
  type ScoreSheet,
  type TurnState,
} from "@yathze/shared";
import { getLeaderboard, recordGameScores } from "./leaderboard.js";

interface InternalPlayer {
  id: string;
  name: string;
  isHost: boolean;
  sheet: ScoreSheet;
  yahtzeeBonus: number;
  connected: boolean;
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_FAILED_INVITES = 5;
const INVITE_COOLDOWN_MS = 15_000;

function emptyHeld(): boolean[] {
  return [false, false, false, false, false];
}

function freshDice(): DieValue[] {
  return [1, 1, 1, 1, 1];
}

function toPublic(p: InternalPlayer): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    sheet: { ...p.sheet },
    upperBonus: computeUpperBonus(p.sheet),
    yahtzeeBonus: p.yahtzeeBonus,
    total: computeTotal(p.sheet, p.yahtzeeBonus),
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

export class GameRoom {
  private players: InternalPlayer[] = [];
  private phase: GameState["phase"] = "lobby";
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private turn: TurnState | null = null;
  private winners: string[] = [];
  private inviteCode: string;
  private leaderboard: LeaderboardEntry[] = getLeaderboard();
  private failedInvites = new Map<string, { count: number; lockedUntil: number }>();

  constructor(inviteCode?: string) {
    this.inviteCode = inviteCode ?? generateInviteCode();
  }

  getInviteCode(): string {
    return this.inviteCode;
  }

  getState(): GameState {
    return {
      phase: this.phase,
      players: this.players.map(toPublic),
      turn: this.turn ? { ...this.turn, dice: [...this.turn.dice], held: [...this.turn.held] } : null,
      winners: [...this.winners],
      maxPlayers: MAX_PLAYERS,
      inviteRequired: this.players.length > 0,
      leaderboard: this.leaderboard.map((e) => ({ ...e })),
    };
  }

  getPlayer(socketId: string): InternalPlayer | undefined {
    return this.players.find((p) => p.id === socketId);
  }

  join(
    socketId: string,
    name: string,
    inviteCode: string,
  ): { ok: true; inviteCode?: string } | { ok: false; error: string } {
    const trimmed = name.trim().slice(0, 16);
    if (!trimmed) return { ok: false, error: "Enter a username." };
    if (this.phase !== "lobby") return { ok: false, error: "Game already in progress." };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: "Room is full." };
    if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: "That name is taken." };
    }
    if (this.players.some((p) => p.id === socketId)) {
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
    this.players.push({
      id: socketId,
      name: trimmed,
      isHost,
      sheet: {},
      yahtzeeBonus: 0,
      connected: true,
    });
    return isHost ? { ok: true, inviteCode: this.inviteCode } : { ok: true };
  }

  leave(socketId: string): void {
    this.failedInvites.delete(socketId);
    const idx = this.players.findIndex((p) => p.id === socketId);
    if (idx === -1) return;

    const wasHost = this.players[idx]!.isHost;
    this.players.splice(idx, 1);

    if (wasHost && this.players.length > 0) {
      this.players[0]!.isHost = true;
    }

    if (this.phase === "lobby") return;

    if (this.players.length === 0) {
      this.resetToLobby();
      return;
    }

    if (this.phase === "playing" && this.turn?.playerId === socketId) {
      this.advanceAfterLeave();
    } else if (this.phase === "playing") {
      const currentId = this.turn?.playerId;
      this.turnOrder = this.turnOrder.filter((id) => id !== socketId);
      if (currentId) {
        const nextIdx = this.turnOrder.indexOf(currentId);
        this.turnIndex = nextIdx >= 0 ? nextIdx : 0;
      }
    }
  }

  /** Host who reconnected / already seated can fetch the code. */
  revealInviteIfHost(socketId: string): string | null {
    const player = this.getPlayer(socketId);
    return player?.isHost ? this.inviteCode : null;
  }

  start(socketId: string): { ok: true } | { ok: false; error: string } {
    const player = this.getPlayer(socketId);
    if (!player?.isHost) return { ok: false, error: "Only the host can start." };
    if (this.phase !== "lobby") return { ok: false, error: "Already started." };
    if (this.players.length < MIN_PLAYERS) {
      return { ok: false, error: `Need at least ${MIN_PLAYERS} players.` };
    }

    for (const p of this.players) {
      p.sheet = {};
      p.yahtzeeBonus = 0;
    }
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
   * Freeze the current hold selection (informational Learn). Does not change held.
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
    this.turn.holdsFrozen = true;
    return { ok: true };
  }

  roll(socketId: string): { ok: true } | { ok: false; error: string } {
    if (!this.isActivePlayer(socketId) || !this.turn) {
      return { ok: false, error: "Not your turn." };
    }
    if (this.turn.rollsLeft <= 0) {
      return { ok: false, error: "No rolls left." };
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

    const player = this.getPlayer(socketId)!;
    if (player.sheet[category] !== undefined) {
      return { ok: false, error: "Category already filled." };
    }
    if (!canScoreInCategory(this.turn.dice, player.sheet, category)) {
      return { ok: false, error: "That box isn't allowed for this roll." };
    }

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
    const player = this.getPlayer(socketId);
    if (!player?.isHost) return { ok: false, error: "Only the host can reset." };
    if (this.phase !== "finished") return { ok: false, error: "Game not finished." };
    this.resetToLobbyKeepPlayers();
    return { ok: true };
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
    return this.phase === "playing" && this.turn?.playerId === socketId;
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
    this.leaderboard = recordGameScores(
      this.players.map((p) => ({
        name: p.name,
        score: computeTotal(p.sheet, p.yahtzeeBonus),
      })),
    );
  }

  private resetToLobby(): void {
    this.phase = "lobby";
    this.turn = null;
    this.turnOrder = [];
    this.turnIndex = 0;
    this.winners = [];
    this.players = [];
    this.inviteCode = generateInviteCode();
    this.failedInvites.clear();
  }

  private resetToLobbyKeepPlayers(): void {
    this.phase = "lobby";
    this.turn = null;
    this.turnOrder = [];
    this.turnIndex = 0;
    this.winners = [];
    for (const p of this.players) {
      p.sheet = {};
      p.yahtzeeBonus = 0;
    }
  }
}
