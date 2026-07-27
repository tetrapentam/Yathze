import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { Category } from "@yathze/shared";
import { GameRoom } from "./game.js";
import { ensureOptTableLoaded } from "./optTable.js";

ensureOptTableLoaded();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const room = new GameRoom(process.env.INVITE_CODE);

const app = express();
app.use(cors());

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) res.status(404).send("Client not built. Run npm run build.");
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

function broadcast(): void {
  io.emit("state", room.getState());
}

room.setChangeListener(broadcast);

type Ack = (r: {
  ok: boolean;
  error?: string;
  inviteCode?: string;
  playerId?: string;
  reconnectToken?: string;
}) => void;

io.on("connection", (socket) => {
  socket.emit("state", room.getState());

  socket.on(
    "join",
    (
      payload: string | { name?: string; inviteCode?: string },
      ack?: Ack,
    ) => {
      const name =
        typeof payload === "string" ? payload : (payload?.name ?? "");
      const inviteCode =
        typeof payload === "string" ? "" : (payload?.inviteCode ?? "");
      const result = room.join(socket.id, name, inviteCode);
      if (result.ok) {
        broadcast();
        ack?.({
          ok: true,
          playerId: result.playerId,
          reconnectToken: result.reconnectToken,
          ...(result.inviteCode ? { inviteCode: result.inviteCode } : {}),
        });
      } else {
        ack?.({ ok: false, error: result.error });
      }
    },
  );

  socket.on(
    "rejoin",
    (payload: { reconnectToken?: string }, ack?: Ack) => {
      const result = room.rejoin(socket.id, payload?.reconnectToken ?? "");
      if (result.ok) {
        broadcast();
        ack?.({
          ok: true,
          playerId: result.playerId,
          reconnectToken: result.reconnectToken,
          ...(result.inviteCode ? { inviteCode: result.inviteCode } : {}),
        });
      } else {
        ack?.({ ok: false, error: result.error });
      }
    },
  );

  socket.on("getInviteCode", (ack?: Ack) => {
    const code = room.revealInviteIfHost(socket.id);
    if (code) ack?.({ ok: true, inviteCode: code });
    else ack?.({ ok: false, error: "Only the host can view the invite code." });
  });

  socket.on("startGame", (ack?: Ack) => {
    const result = room.start(socket.id);
    if (result.ok) {
      broadcast();
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: result.error });
    }
  });

  socket.on("holdDice", (index: number, ack?: Ack) => {
    const result = room.holdDice(socket.id, Number(index));
    if (result.ok) {
      broadcast();
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: result.error });
    }
  });

  socket.on("learn", (ack?: Ack) => {
    const result = room.learn(socket.id);
    if (result.ok) {
      broadcast();
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: result.error });
    }
  });

  socket.on("roll", (ack?: Ack) => {
    const result = room.roll(socket.id);
    if (result.ok) {
      broadcast();
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: result.error });
    }
  });

  socket.on("score", (category: Category, ack?: Ack) => {
    const result = room.score(socket.id, category);
    if (result.ok) {
      broadcast();
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: result.error });
    }
  });

  socket.on("returnToLobby", (ack?: Ack) => {
    const result = room.returnToLobby(socket.id);
    if (result.ok) {
      broadcast();
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: result.error });
    }
  });

  socket.on("continueSeries", (ack?: Ack) => {
    const result = room.continueSeries(socket.id);
    if (result.ok) {
      broadcast();
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: result.error });
    }
  });

  socket.on("disconnect", () => {
    room.disconnect(socket.id);
    broadcast();
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log("");
  console.log("Burian Studio server is ready.");
  console.log(`  Bound:  http://${HOST}:${PORT}`);
  console.log(`  Local:  http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log(`  LAN:    http://<your-ip>:${PORT}`);
  } else {
    console.log("  Share mode: only reachable via tunnel or localhost.");
  }
  console.log(`BURIAN_INVITE_CODE=${room.getInviteCode()}`);
  console.log("Leave this window open while you play.");
  console.log("");
});
