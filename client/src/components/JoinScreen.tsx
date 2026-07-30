import { useState, type FormEvent } from "react";
import type { RoomPhase } from "@yathze/shared";

interface Props {
  onJoin: (name: string, inviteCode: string) => void;
  error: string | null;
  playerCount: number;
  maxPlayers: number;
  phase: RoomPhase;
  inviteRequired: boolean;
  initialInviteCode?: string;
}

export function JoinScreen({
  onJoin,
  error,
  playerCount,
  maxPlayers,
  phase,
  inviteRequired,
  initialInviteCode = "",
}: Props) {
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const hasLinkCode = initialInviteCode.trim().length > 0;
  const needsCodeInput = inviteRequired && !hasLinkCode;

  function submit(e: FormEvent) {
    e.preventDefault();
    onJoin(name, hasLinkCode ? initialInviteCode : inviteCode);
  }

  const blocked = phase !== "lobby";
  const canSubmit =
    name.trim().length > 0 && (!needsCodeInput || inviteCode.trim().length > 0);
  // Autofocus opens the keyboard on phones and often covers Join — skip on touch.
  const preferAutofocus =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  return (
    <div className="screen join-screen">
      <div className="felt-glow" />
      <div className="join-hero">
        <p className="eyebrow">Private table</p>
        <h1 className="brand">Burian Studio</h1>
        <p className="tagline">
          {hasLinkCode
            ? "You've been invited — enter your name to join."
            : inviteRequired
              ? "Ask the host for their invite link, or enter the code below."
              : "Enter your name to open the table, then share your invite link."}
        </p>
        {blocked ? (
          <p className="banner warn">
            A game is in progress. If you dropped mid-game, refresh this page to
            reclaim your seat. New players must wait until the host returns to
            the lobby.
          </p>
        ) : (
          <form className="join-form" onSubmit={submit}>
            <label htmlFor="username">Your name</label>
            <input
              id="username"
              autoFocus={preferAutofocus}
              maxLength={16}
              placeholder="Enter username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
            {needsCodeInput && (
              <>
                <label htmlFor="invite">Invite code</label>
                <input
                  id="invite"
                  maxLength={12}
                  placeholder="Invite code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  autoComplete="off"
                  spellCheck={false}
                />
              </>
            )}
            <button type="submit" className="btn primary" disabled={!canSubmit}>
              {inviteRequired ? "Join table" : "Open table"}
            </button>
          </form>
        )}
        {error && <p className="banner error">{error}</p>}
        <p className="meta">
          {playerCount}/{maxPlayers} seated
        </p>
      </div>
    </div>
  );
}
