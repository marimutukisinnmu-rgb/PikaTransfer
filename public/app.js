const $ = (id) => document.getElementById(id);
const socket = io({ autoConnect: false, reconnection: true });
const peers = new Map();
const channels = new Map();
const receivers = new Map();
let myId = null;
let selectedPeer = null;
let connected = false;

const canOpenFiles = window.isSecureContext && typeof window.showOpenFilePicker === "function";
const iceServers = window.PIKA_CONFIG?.iceServers || [{ urls: ["stun:stun.l.google.com:19302"] }];

function setConnection(online, label) {
  $("connectionDot").classList.toggle("online", online);
  $("connectionText").textContent = label;
}

function log(message) {
  const list = $("logList");
  const empty = list.querySelector(".empty");
  if (empty) empty.remove();
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  list.prepend(item);
  while (list.children.length > 30) list.lastElementChild.remove();
}

function setMode() {
  if (canOpenFiles) {
    $("modeBanner").classList.add("hidden");
    $("sendButton").disabled = true;
    $("sendHelp").textContent = "転送相手を選択してください。";
  } else {
    $("modeTitle").textContent = "ダウンロード専用モード";
    $("modeDescription").textContent = "File System Access APIを利用できないため、ファイル送信は無効です。受信したファイルは通常のブラウザダウンロードで保存できます。HTTPSまたはlocalhostで開くと対応ブラウザでは送信機能も利用できます。";
    $("sendButton").disabled = true;
    $("sendHelp").textContent = "この環境ではファイル送信を利用できません。";
  }
}

function renderUsers(users) {
  const list = $("userList");
  list.replaceChildren();
  const others = users.filter((user) => user.id !== myId);
  $("userCount").textContent = String(others.length);

  if (others.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "まだ他のユーザーはいません。";
    list.append(empty);
  }

  for (const user of others) {
    const button = document.createElement("button");
    button.className = "user-item" + (selectedPeer === user.id ? " selected" : "");
    button.type = "button";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = user.name.slice(0, 1).toUpperCase();
    const meta = document.createElement("span");
    meta.className = "user-meta";
    const name = document.createElement("strong");
    name.textContent = user.name;
    const status = document.createElement("small");
    status.textContent = channels.get(user.id)?.readyState === "open" ? "P2P接続済み" : "接続待機中";
    meta.append(name, status);
    const mark = document.createElement("span");
    mark.className = "online-mark";
    button.append(avatar, meta, mark);
    button.addEventListener("click", () => selectPeer(user.id, user.name));
    list.append(button);
  }

  // Create one peer connection per pair. The lexicographically smaller socket ID offers.
  for (const user of others) {
    if (myId && myId.localeCompare(user.id) < 0 && !peers.has(user.id)) {
      createPeer(user.id, true);
    }
  }
  updateSendButton();
}

function selectPeer(id, name) {
  selectedPeer = id;
  $("targetHint").textContent = `転送先：${name}`;
  renderUsers(window.lastUsers || []);
  updateSendButton();
}

function updateSendButton() {
  const channel = selectedPeer ? channels.get(selectedPeer) : null;
  const ready = Boolean(channel && channel.readyState === "open");
  $("sendButton").disabled = !canOpenFiles || !ready;
  if (!canOpenFiles) {
    $("sendHelp").textContent = "File System Access APIが利用できないため送信できません。";
  } else {
    $("sendHelp").textContent = ready ? "複数ファイルを選択できます。" : "相手とのP2P接続を確立しています…";
  }
  $("transferState").textContent = ready ? "接続済み" : selectedPeer ? "接続中" : "待機中";
}

function sendSignal(to, data) {
  socket.emit("signal", { to, ...data });
}

function createPeer(remoteId, initiator) {
  if (peers.has(remoteId)) return peers.get(remoteId);
  const pc = new RTCPeerConnection({ iceServers });
  peers.set(remoteId, pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(remoteId, { candidate: event.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      channels.delete(remoteId);
      if (pc.connectionState !== "disconnected") peers.delete(remoteId);
      updateSendButton();
      renderUsers(window.lastUsers || []);
    }
  };
  pc.ondatachannel = (event) => attachChannel(remoteId, event.channel);

  if (initiator) {
    const channel = pc.createDataChannel("pikatransfer", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 512 * 1024;
    attachChannel(remoteId, channel);
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => sendSignal(remoteId, { description: pc.localDescription }))
      .catch((error) => log("接続開始エラー：" + error.message));
  }
  return pc;
}

function attachChannel(remoteId, channel) {
  channels.set(remoteId, channel);
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 512 * 1024;
  channel.onopen = () => {
    log("P2P接続が確立しました。");
    updateSendButton();
    renderUsers(window.lastUsers || []);
  };
  channel.onclose = () => {
    channels.delete(remoteId);
    updateSendButton();
    renderUsers(window.lastUsers || []);
  };
  channel.onerror = () => log("データ通信でエラーが発生しました。");
  channel.onmessage = (event) => receiveData(remoteId, event.data);
}

async function handleSignal({ from, description, candidate }) {
  try {
    const pc = peers.get(from) || createPeer(from, false);
    if (description) {
      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(from, { description: pc.localDescription });
      }
    } else if (candidate) {
      await pc.addIceCandidate(candidate);
    }
  } catch (error) {
    log("接続処理エラー：" + error.message);
  }
}

function showProgress(name, percent, detail) {
  $("progressWrap").classList.remove("hidden");
  $("progressName").textContent = name;
  $("progressPercent").textContent = percent + "%";
  $("progressBar").style.width = percent + "%";
  $("progressDetail").textContent = detail || "";
}

function receiveData(remoteId, data) {
  if (typeof data === "string") {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.type === "file-start") {
      receivers.set(remoteId, {
        name: String(message.name || "download.bin").replace(/[\\/\\0]/g, "_"),
        size: Number(message.size) || 0,
        mime: String(message.mime || "application/octet-stream"),
        chunks: [],
        received: 0
      });
      log(`受信開始：${message.name || "ファイル"}`);
      showProgress("受信中：" + (message.name || "ファイル"), 0, formatBytes(message.size));
    } else if (message.type === "file-end") {
      finishReceive(remoteId);
    }
    return;
  }

  const transfer = receivers.get(remoteId);
  if (!transfer) return;
  transfer.chunks.push(data);
  transfer.received += data.byteLength;
  const percent = transfer.size ? Math.min(100, Math.round(transfer.received / transfer.size * 100)) : 0;
  showProgress("受信中：" + transfer.name, percent, `${formatBytes(transfer.received)} / ${formatBytes(transfer.size)}`);
}

function finishReceive(remoteId) {
  const transfer = receivers.get(remoteId);
  if (!transfer) return;
  receivers.delete(remoteId);
  const blob = new Blob(transfer.chunks, { type: transfer.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = transfer.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  showProgress("受信完了：" + transfer.name, 100, formatBytes(blob.size));
  log("受信完了：" + transfer.name + "（ブラウザからダウンロード）");
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = -1;
  do { size /= 1024; index++; } while (size >= 1024 && index < units.length - 1);
  return size.toFixed(1) + " " + units[index];
}

function waitForBuffer(channel) {
  if (channel.bufferedAmount < 1024 * 1024) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      channel.removeEventListener("bufferedamountlow", done);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", done, { once: true });
  });
}

async function sendFile(handle, channel) {
  const file = await handle.getFile();
  channel.send(JSON.stringify({
    type: "file-start",
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream"
  }));

  const chunkSize = 64 * 1024;
  let offset = 0;
  while (offset < file.size) {
    if (channel.readyState !== "open") throw new Error("接続が切断されました。");
    await waitForBuffer(channel);
    const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
    channel.send(chunk);
    offset += chunk.byteLength;
    const percent = Math.round(offset / file.size * 100);
    showProgress("送信中：" + file.name, percent, `${formatBytes(offset)} / ${formatBytes(file.size)}`);
  }
  channel.send(JSON.stringify({ type: "file-end" }));
  log("送信完了：" + file.name);
  showProgress("送信完了：" + file.name, 100, formatBytes(file.size));
}

$("loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  $("loginError").textContent = "";
  const name = $("nameInput").value.trim();
  const password = $("passwordInput").value;
  if (!name || !password) return;

  socket.auth = { password };
  socket.connect();
  socket.once("connect", () => {
    socket.emit("profile:set", { name }, (result) => {
      if (!result?.ok) {
        $("loginError").textContent = result?.error || "接続できませんでした。";
        socket.disconnect();
        return;
      }
      myId = result.id;
      connected = true;
      $("loginPanel").classList.add("hidden");
      $("appPanel").classList.remove("hidden");
      setConnection(true, "接続中");
      log("サーバーに接続しました。");
      updateSendButton();
      renderUsers(window.lastUsers || []);
    });
  });
  socket.once("connect_error", (error) => {
    $("loginError").textContent = error.message || "接続に失敗しました。";
    setConnection(false, "未接続");
  });
});

socket.on("users:update", (users) => {
  window.lastUsers = users;
  if (connected) renderUsers(users);
});
socket.on("signal", handleSignal);
socket.on("disconnect", () => {
  connected = false;
  setConnection(false, "切断");
  if (myId) log("サーバーとの接続が切れました。");
  updateSendButton();
});
socket.on("connect", () => setConnection(true, "接続中"));

$("sendButton").addEventListener("click", async () => {
  if (!canOpenFiles || !selectedPeer) return;
  const channel = channels.get(selectedPeer);
  if (!channel || channel.readyState !== "open") return;
  try {
    const handles = await window.showOpenFilePicker({ multiple: true });
    for (const handle of handles) {
      await sendFile(handle, channel);
    }
  } catch (error) {
    if (error.name !== "AbortError") log("ファイル送信エラー：" + error.message);
  }
});

$("disconnectButton").addEventListener("click", () => {
  socket.disconnect();
  for (const pc of peers.values()) pc.close();
  peers.clear();
  channels.clear();
  receivers.clear();
  myId = null;
  selectedPeer = null;
  connected = false;
  $("appPanel").classList.add("hidden");
  $("loginPanel").classList.remove("hidden");
  $("passwordInput").value = "";
  setConnection(false, "未接続");
});

setMode();
