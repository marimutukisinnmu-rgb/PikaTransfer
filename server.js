require("dotenv").config();

const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PASSWORD = process.env.PIKATRANSFER_PASSWORD;

if (!PASSWORD || PASSWORD.length < 12) {
  console.error("Set PIKATRANSFER_PASSWORD to a private password of at least 12 characters.");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  cors: { origin: false }
});

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  etag: true,
  maxAge: "1h"
}));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "PikaTransfer" });
});

app.get("/config.js", (_req, res) => {
  const turnUrl = process.env.TURN_URL || "";
  const iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }];
  if (turnUrl && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: turnUrl.split(",").map((value) => value.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.type("application/javascript").send(
    "window.PIKA_CONFIG = " + JSON.stringify({ iceServers }) + ";"
  );
});

const clients = new Map();

function publicUsers() {
  return [...clients.entries()].map(([id, user]) => ({
    id,
    name: user.name,
    connectedAt: user.connectedAt
  }));
}

io.use((socket, next) => {
  const supplied = socket.handshake.auth?.password;
  if (typeof supplied !== "string" || supplied !== PASSWORD) {
    return next(new Error("認証に失敗しました。パスワードを確認してください。"));
  }
  next();
});

io.on("connection", (socket) => {
  socket.on("profile:set", (payload, ack = () => {}) => {
    const name = String(payload?.name || "").trim().slice(0, 24);
    if (!name) return ack({ ok: false, error: "ユーザー名を入力してください。" });

    clients.set(socket.id, { name, connectedAt: Date.now() });
    socket.data.ready = true;
    ack({ ok: true, id: socket.id });
    io.emit("users:update", publicUsers());
  });

  socket.on("signal", (payload) => {
    if (!socket.data.ready) return;
    const to = payload?.to;
    const description = payload?.description;
    const candidate = payload?.candidate;

    if (typeof to !== "string" || to === socket.id || !clients.has(to)) return;
    if (description && typeof description === "object") {
      io.to(to).emit("signal", { from: socket.id, description });
    } else if (candidate && typeof candidate === "object") {
      io.to(to).emit("signal", { from: socket.id, candidate });
    }
  });

  socket.on("disconnect", () => {
    clients.delete(socket.id);
    io.emit("users:update", publicUsers());
  });
});

server.listen(PORT, HOST, () => {
  console.log(`PikaTransfer listening on http://${HOST}:${PORT}`);
  console.log("Keep the access password private. Use HTTPS when connecting from other devices.");
});
