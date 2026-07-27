import { useState } from "react";
import {
  MIN_PLAYERS,
  type LeaderboardEntry,
  type PlayerPublic,
} from "@yathze/shared";
import { Leaderboard } from "./Leaderboard";

interface Props {
  players: PlayerPublic[];
  me: PlayerPublic;
  error: string | null;
  inviteCode: string | null;
  leaderboard: LeaderboardEntry[];
  onStart: () => void;
}

function isLocalHostName(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function isPrivateLanHost(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const [a, b] = hostname.split(".").map(Number);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  }
  return hostname.endsWith(".local");
}

export function LobbyScreen({
  players,
  me,
  error,
  inviteCode,
  leaderboard,
  onStart,
}: Props) {
  const canStart = me.isHost && players.length >= MIN_PLAYERS;
  const alone = players.length === 1;
  const [copied, setCopied] = useState(false);
  const host = window.location.hostname;
  const onLocalhost = isLocalHostName(host);
  const onLanOnly = !onLocalhost && isPrivateLanHost(host);
  const remoteOk = !onLocalhost && !onLanOnly;

  async function copyInviteLink() {
    if (!inviteCode) return;
    if (onLocalhost) {
      window.alert(
        "This page is localhost — that link only works on your PC.\n\n" +
          "For a friend not on your Wi‑Fi, stop the server and run:\n" +
          "  npm run share\n\n" +
          "Then send them the HTTPS invite link printed in the terminal.",
      );
      return;
    }
    const link = `${window.location.origin}/?code=${encodeURIComponent(inviteCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  }

  return (
    <div className="screen lobby-screen">
      <div className="felt-glow" />
      <header className="panel-header">
        <h1 className="brand brand-sm">Burian Studio</h1>
        <p className="tagline">
          {me.isHost
            ? alone
              ? "Start alone, or invite friends"
              : "Ready when you are"
            : "Waiting for the host to start"}
        </p>
      </header>

      <div className="play-layout">
        <aside className="play-sidebar">
          <Leaderboard entries={leaderboard} side />
        </aside>

        <div className="play-main">
          {me.isHost && inviteCode && (
            <div className="invite-panel">
              <p className="section-label">Invite friends</p>
              <button type="button" className="btn primary" onClick={copyInviteLink}>
                {copied ? "Copied!" : "Copy invite link"}
              </button>
              {onLocalhost ? (
                <p className="hint warn-hint">
                  You opened the game on this PC only. Friends elsewhere need{" "}
                  <strong>npm run share</strong> — send them the HTTPS link from
                  the terminal (not localhost).
                </p>
              ) : onLanOnly ? (
                <p className="hint warn-hint">
                  This link only works on the same Wi‑Fi. For friends elsewhere,
                  run <strong>npm run share</strong> and send the HTTPS invite
                  link.
                </p>
              ) : remoteOk ? (
                <p className="hint">
                  Send this link to friends anywhere — they only enter their name.
                </p>
              ) : null}
            </div>
          )}

          <ul className="player-list">
            {players.map((p, i) => (
              <li
                key={p.id}
                className={`player-chip ${p.id === me.id ? "you" : ""} ${
                  p.connected ? "" : "away"
                }`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="seat">{i + 1}</span>
                <span className="pname">{p.name}</span>
                {p.isHost && <span className="badge">Host</span>}
                {p.id === me.id && <span className="badge you-badge">You</span>}
                {!p.connected && <span className="badge away-badge">Away</span>}
              </li>
            ))}
          </ul>

          {me.isHost ? (
            <div className="lobby-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!canStart}
                onClick={onStart}
              >
                {alone ? "Start solo" : "Start game"}
              </button>
              {canStart && alone && (
                <p className="hint">You can start now, or wait for friends to join.</p>
              )}
            </div>
          ) : (
            <p className="hint pulse">The host will start when everyone is ready.</p>
          )}

          {error && <p className="banner error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
