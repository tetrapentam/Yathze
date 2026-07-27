import type { PlayerSession } from "@yathze/shared";

const SESSION_KEY = "yathze.session";

export function loadSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlayerSession>;
    if (
      typeof parsed.playerId !== "string" ||
      typeof parsed.reconnectToken !== "string" ||
      typeof parsed.name !== "string"
    ) {
      return null;
    }
    return {
      playerId: parsed.playerId,
      reconnectToken: parsed.reconnectToken,
      name: parsed.name,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: PlayerSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
