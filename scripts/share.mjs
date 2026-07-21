#!/usr/bin/env node
/**
 * Build + start Yathze on 127.0.0.1 and expose it via a Cloudflare quick tunnel.
 * Prints a one-time HTTPS invite link. No router ports are opened.
 */
import { spawn, execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "3000";
const HOST = "127.0.0.1";

function which(cmd) {
  try {
    const out = execSync(
      process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split(/\r?\n/).find(Boolean)?.trim() ?? null;
  } catch {
    return null;
  }
}

function resolveCloudflared() {
  const local = path.join(
    root,
    "tools",
    process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
  if (existsSync(local)) return local;
  return which("cloudflared");
}

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

const cloudflared = resolveCloudflared();
if (!cloudflared) {
  fail(
    [
      "cloudflared is not installed (needed for a safe public invite link).",
      "",
      "Install it, then run npm run share again:",
      "  winget install Cloudflare.cloudflared",
      "",
      "Or place cloudflared.exe in the tools/ folder.",
      "Docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/",
    ].join("\n"),
  );
}

console.log("Building Yathze…");
try {
  execSync("npm run build", { cwd: root, stdio: "inherit", shell: true });
} catch {
  fail("Build failed.");
}

const children = [];
let inviteCode = null;
let tunnelUrl = null;
let linkPrinted = false;

function tryPrintLink() {
  if (linkPrinted || !inviteCode || !tunnelUrl) return;
  linkPrinted = true;
  const link = `${tunnelUrl}/?code=${encodeURIComponent(inviteCode)}`;
  console.log("");
  console.log("========================================");
  console.log("  Invite link (send this to friends):");
  console.log(`  ${link}`);
  console.log("========================================");
  console.log("Leave this window open while you play.");
  console.log("Press Ctrl+C to stop — the link will stop working.");
  console.log("");
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const serverEntry = path.join(root, "server", "dist", "index.js");
const server = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: { ...process.env, HOST, PORT },
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(server);

function watchServer(stream) {
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    process.stdout.write(`${line}\n`);
    const m = line.match(/YATHZE_INVITE_CODE=([A-Z0-9]+)/i);
    if (m) {
      inviteCode = m[1].toUpperCase();
      tryPrintLink();
    }
  });
}

watchServer(server.stdout);
watchServer(server.stderr);

server.on("exit", (code) => {
  console.error(`Server exited (code ${code ?? "?"}).`);
  shutdown();
});

// Give the server a moment, then start the tunnel
setTimeout(() => {
  const tunnel = spawn(
    cloudflared,
    ["tunnel", "--url", `http://${HOST}:${PORT}`],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );
  children.push(tunnel);

  function watchTunnel(stream) {
    const rl = createInterface({ input: stream });
    rl.on("line", (line) => {
      // cloudflared is noisy; only echo useful lines
      if (/error|failed|ERR/i.test(line) && !/Registered/i.test(line)) {
        process.stderr.write(`[tunnel] ${line}\n`);
      }
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) {
        tunnelUrl = m[0].replace(/\/$/, "");
        tryPrintLink();
      }
    });
  }

  watchTunnel(tunnel.stdout);
  watchTunnel(tunnel.stderr);

  tunnel.on("exit", (code) => {
    console.error(`Tunnel exited (code ${code ?? "?"}).`);
    shutdown();
  });
}, 800);
