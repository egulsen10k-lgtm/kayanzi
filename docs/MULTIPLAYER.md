# Play together on the same network

The game supports small driving rooms with up to eight drivers. Open **Multiplayer** on the game page to see connection status, create or join a room, and find other drivers. Each driver controls their own car. Traffic and pedestrian simulation remain local; player-to-player collision physics and competitive anti-cheat are not included.

## Recommended: host a LAN room

One computer serves the game and exchanges positions for everyone on the same Wi-Fi or Ethernet network. The other devices need only a browser.

1. Install Node.js 20 or newer and download or clone this repository.
2. In the repository directory, run:

   ```sh
   npm ci
   npm run multiplayer
   ```

3. Keep the terminal open. It prints addresses such as `http://192.168.1.50:3000/`. Open a printed network address on the host and on every other device. `127.0.0.1` and `localhost` reach only the current device.
4. On the page, open **Multiplayer**, create a room and share its room link, or have friends enter the same room code. Choose a friend in the player list to meet near their car.
5. If a firewall asks, allow Node.js on the private/local network. Stop hosting with Ctrl+C.

The command builds a local version of the game and runs a server bound to all network interfaces on port 3000. Choose a different port if needed:

```sh
npm run build -- --base ./
PORT=3001 node server/lan-server.mjs
```

On Windows PowerShell, use `$env:PORT=3001` before running `node server/lan-server.mjs`.

Use a trusted home or office network. Devices on guest Wi-Fi may be isolated from one another even when the Wi-Fi name matches. Disable guest/client isolation or use the same non-guest network. VPNs and corporate firewall policies can also prevent connection. Do not forward the LAN server's port to the public internet; it is a small local room relay, not a publicly managed game service.

## Published GitHub page: connection codes

GitHub Pages serves static files and does not run the LAN server. The published game offers a server-free WebRTC connection-code option instead:

1. Everyone opens the published game page using HTTPS and opens **Multiplayer**.
2. The host creates an invitation code and sends the complete code to a friend using a messaging app or another channel.
3. The friend pastes the invitation and creates an answer code, then sends that complete answer to the host.
4. The host accepts the answer. Wait until both pages show that the connection is ready.
5. Repeat the invitation/answer exchange for each additional friend if the room supports multiple guests.

Keep all pages open while pairing and playing. Connection codes contain temporary network session information; send them only to the intended players and use freshly generated codes after leaving a session. The host must stay connected for guests to remain in the room.

This mode uses direct browser-to-browser connections and has no TURN relay. It works when browsers can find a direct network path, commonly on the same ordinary local network. Guest Wi-Fi isolation, VPNs, browser policy or restrictive firewalls can still block it; connection codes cannot bypass those restrictions. If direct pairing fails, use the LAN server method above. Opening an HTTPS GitHub page does not let it connect to a plain HTTP/WebSocket LAN server automatically: use the local game link for LAN hosting.

## Technical protocol

The local server serves the built `dist/` directory, exposes `GET /api/multiplayer-info`, and accepts WebSocket connections at `/multiplayer`. It validates room codes, limits rooms to eight players, assigns driver IDs, bounds vehicle-state values, limits message size and frequency, removes disconnected drivers, and rejects browser connections from unexpected origins. No account or database is required. Empty rooms disappear when their last driver leaves.

The multiplayer feature synchronizes vehicle position, heading, speed, steering, appearance and elevation. It does not synchronize every world object. A local server must remain running for local room links to work.
