# PikaTransfer

A small browser-based, multi-user file transfer app. One Node.js server (PC A) handles login, online-user presence, and WebRTC signaling. File bytes travel directly between browsers over WebRTC DataChannels; the Node.js server does not store or relay file contents.

## Current status

**Prototype / MVP (0.1.0)**

- One Node.js signaling server; clients only need a modern browser.
- Shared password authentication and display names.
- Multiple online users.
- Browser-to-browser WebRTC data channel.
- Multi-file sending with progress display.
- Uses the File System Access API's `showOpenFilePicker()` to choose files.
- If that API is unavailable or the page is not in a secure context, the UI switches to download-only mode. Incoming files are saved through the browser's normal download mechanism.
- STUN is configured by default. An optional TURN server can be configured for restrictive networks.

## Requirements

- Node.js 20 or newer.
- A modern browser with WebRTC.
- For file sending, a secure context and `showOpenFilePicker()` support (Chromium-based browsers are the primary target).
- A network that permits WebRTC peer connections. Some networks require TURN.

## Run on PC A (Windows PowerShell)

1. Clone the repository and enter the folder.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Create your local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edit `.env` and set `PIKATRANSFER_PASSWORD` to a private password of at least 12 characters.
5. Start the server:

   ```powershell
   npm start
   ```

The server listens on port 3000 by default. Open `http://localhost:3000` on PC A.

## Connect other devices

- On a trusted LAN, open `http://PC-A-LAN-IP:3000` from another device.
- **Important:** ordinary HTTP on a LAN IP is not a secure context in browsers. In that case, `showOpenFilePicker()` is unavailable and that client will be in download-only mode.
- To enable the File System Access API from outside the host PC, serve the app through HTTPS. For example, an ngrok HTTPS tunnel can expose the Node.js web/signaling endpoint:

  ```powershell
  ngrok http 3000
  ```

  Open the HTTPS forwarding URL shown by ngrok. Keep the password private and do not publish the URL or credentials publicly.

ngrok only exposes the web app and signaling endpoint. WebRTC file traffic attempts to travel directly between clients; ngrok does not guarantee that peer-to-peer connectivity will work through every NAT or firewall.

## Optional TURN server

STUN is configured by default. If clients cannot establish a direct WebRTC connection, configure a TURN service in `.env`:

```env
TURN_URL=turn:turn.example.net:3478
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-credential
```

You can provide multiple comma-separated TURN URLs. Do not commit real TURN credentials.

## Security notes

- Set a strong private `PIKATRANSFER_PASSWORD` before starting the server.
- Use HTTPS when connecting over untrusted networks. Do not send the shared password over plain HTTP on a network you do not trust.
- Only share the ngrok URL and password with intended participants.
- The current prototype uses one shared room password; it does not yet have per-user accounts, permissions, transfer approval, or rate limiting.
- Received file chunks are currently buffered in browser memory before the download is triggered. Very large files can use substantial memory.
- Treat files from other participants as untrusted.

## Current limitations

- File transfer is one-to-one, although many users can be online at once.
- A user must select a recipient before sending.
- File sending is disabled when `showOpenFilePicker()` is unavailable; receiving still uses standard browser downloads.
- The prototype does not yet include folders, resumable transfers, transfer cancellation, checksums, or a persistent transfer history.
- If direct WebRTC connectivity fails, a TURN server is needed. Without TURN, some network combinations will not connect.

## License

No license has been selected yet.
