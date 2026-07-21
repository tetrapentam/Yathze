# Yathze

Stylish multiplayer Yahtzee. Host on your PC; friends join with a username via your invite link — on the same Wi‑Fi or from anywhere via a private HTTPS link.

## Requirements

- Node.js 20+ and npm
- For online invites: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) (`winget install Cloudflare.cloudflared`), or place `cloudflared.exe` in `tools/`

## Play with friends online (recommended)

Creates a temporary HTTPS link through Cloudflare. **No router ports are opened.** The game only listens on `127.0.0.1`.

```bash
npm run share
```

1. Wait for the printed **Invite link** (includes `?code=…`), or open the base URL, enter your name, and use **Copy invite link** in the lobby.
2. Open the table yourself (name only if the table is empty — you become host).
3. Send the invite link to friends anywhere — they only enter their name.
4. Click **Start solo** or **Start game** when ready (1–6 players).
5. Leave the terminal open. Press **Ctrl+C** when done — the link stops working.

Do **not** port-forward port 3000 on your router. Use `npm run share` instead.

## Same Wi‑Fi (LAN)

```bash
npm start
```

Server listens on all interfaces (`0.0.0.0:3000`).

1. Open `http://localhost:3000` (or `http://YOUR_LAN_IP:3000`).
2. Enter your name and open the table (you become host).
3. Click **Copy invite link** and send it to friends on the same Wi‑Fi.

## Development

```bash
npm install
npm run dev
```

- **Game server:** http://localhost:3000  
- **Vite UI:** http://localhost:5173  

## How to play

1. Host opens the table with a unique username (no invite code needed).
2. Friends join via the host’s invite link (name only).
3. Host clicks **Start game** / **Start solo** when ready (1–6 players).
4. On your turn: **Roll**, click dice to **keep**, roll up to 3 times, then click a score box.
5. Empty boxes show **suggested points** only when the potential score is greater than zero.
6. After all categories are filled, final scores and the winner are shown. Host can return everyone to the lobby.

## Security notes

- Online mode binds to localhost only; strangers cannot reach the game via your public IP.
- Joining a seated table requires the random invite code in the shared link (wrong guesses are rate-limited).
- The Cloudflare quick-tunnel URL is temporary and dies when you stop `npm run share`.

## Project layout

- `shared/` — types and Yahtzee scoring
- `server/` — Express + Socket.IO game room
- `client/` — React UI
- `sounds/` / `client/public/sounds/` — game SFX
- `scripts/share.mjs` — build + localhost server + Cloudflare tunnel
