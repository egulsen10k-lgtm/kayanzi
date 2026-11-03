# Play together

The game supports small driving rooms with up to eight drivers. Open **Multiplayer** on the game page to see connection status, create or join a room, and find other drivers. Each driver controls their own car. The visible traffic and pedestrian world mirrors the host's simulation; guests do not run their own crowd interactions, and player-to-player collision physics and competitive anti-cheat are not included.

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

## Published GitHub page: six-character room codes

GitHub Pages serves static files and does not run the LAN server. The published game offers PeerJS room codes instead:

1. Everyone opens the published game page using HTTPS and opens **Multiplayer**.
2. The host chooses **Host game**. Share the six-character code it shows, such as `ABC123`.
3. Friends choose **Join game**, enter that code, and wait until both pages show the connection is ready. No answer code is needed.
4. Repeat the join step for each additional friend if the room supports multiple guests.

Room codes use PeerJS public signaling (`0.peerjs.com`) only to introduce browsers, so discovery needs internet access. Once connected, driving data flows directly browser to browser over WebRTC, and same-network play connects best. Keep all pages open while playing; the host must stay connected for guests to remain in the room. If the public signaling service is unavailable, the LAN server method above still works fully offline.

This WebRTC path has no TURN relay. Guest Wi-Fi isolation, VPNs, strict browser policy, or restrictive firewalls can block direct connections. Manual invitation/answer pairing remains available under the advanced options for networks where the public signaling service is unreachable, but the six-character flow is the normal path. Opening an HTTPS GitHub page does not let it connect to a plain HTTP/WebSocket LAN server automatically: use the local game link for LAN hosting.

## Technical protocol

The local server serves the built `dist/` directory, exposes `GET /api/multiplayer-info`, and accepts WebSocket connections at `/multiplayer`. It validates room codes, limits rooms to eight players, assigns driver IDs, bounds vehicle-state values, limits message size and frequency, removes disconnected drivers, and rejects browser connections from unexpected origins. No account or database is required. Empty rooms disappear when their last driver leaves.

The multiplayer feature synchronizes vehicle position, heading, speed, steering, appearance, elevation and robot-transform state. The room host also publishes the visible NPC world at a bounded rate: traffic vehicles and pedestrians at up to 10 updates per second, with at most 16 vehicles and 24 pedestrians per snapshot. Guests render that host world and do not simulate their own traffic or pedestrians; crowd interactions are host-controlled. If the host leaves, the remaining drivers elect a new host and that driver publishes the next NPC world. Player-to-player contact is resolved independently on each client, so cars push apart and play an impact sound locally; nearby remote engines are audible with distance attenuation. Individual player car collisions with traffic are also resolved locally, not authoritatively. A local server must remain running for local room links to work.
