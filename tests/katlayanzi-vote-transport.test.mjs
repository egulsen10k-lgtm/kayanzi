import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createLanServer} from '../server/lan-server.mjs';
import {MultiplayerSession} from '../src/multiplayer.js';
import {CasinoRoom} from '../src/katlayanzi-room.js';

const wait = async fn => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('Casino room did not synchronize');
};

const setup = async () => {
  const server = createLanServer({ port: 0, host: '127.0.0.1' });
  await server.listen();
  const url = `http://127.0.0.1:${server.server.address().port}`;
  let hostRoom, guestRoom;
  const host = new MultiplayerSession({ WebSocketClass: WebSocket, onCasino: p => hostRoom?.receive(p) });
  const guest = new MultiplayerSession({ WebSocketClass: WebSocket, onCasino: p => guestRoom?.receive(p) });
  await host.connectLan({ url, room: 'VOTE' });
  hostRoom = new CasinoRoom({ session: host });
  await guest.connectLan({ url, room: 'VOTE' });
  guestRoom = new CasinoRoom({ session: guest });
  await wait(() => guestRoom.lastView?.players.length === 2);
  return { server, host, guest, hostRoom, guestRoom };
};

const teardown = async ({ server, host, guest, hostRoom, guestRoom }) => {
  hostRoom?.destroy();
  guestRoom?.destroy();
  host.leave();
  guest.leave();
  await server.close();
};

test('guest proposes a game and host must vote instead of forcing its own switch', async t => {
  const { server, host, guest, hostRoom, guestRoom } = await setup();
  t.after(async () => teardown({ server, host, guest, hostRoom, guestRoom }));
  guestRoom.dispatch({ type: 'choose', game: 'roulette' });
  await wait(() => guestRoom.lastView?.gameVote);
  assert.equal(guestRoom.lastView.gameVote.game, 'roulette');
  assert.equal(guestRoom.lastView.gameVote.proposerId, guest.id);
  assert.equal(guestRoom.lastView.gameVote.votes[guest.id], true);
  assert.equal(guestRoom.lastView.gameVote.votes[host.id], undefined);
  assert.equal(guestRoom.lastView.gameVote.required, 2);
  assert.ok(guestRoom.lastView.gameVote.expiresAt > Date.now());
});

test('guest disconnects and cancels the vote', async t => {
  const { server, host, guest, hostRoom, guestRoom } = await setup();
  t.after(async () => teardown({ server, host, guest, hostRoom, guestRoom }));
  guestRoom.dispatch({ type: 'choose', game: 'roulette' });
  await wait(() => guestRoom.lastView?.gameVote);
  guest.leave();
  await wait(() => hostRoom.lastView?.gameVote === null);
  assert.equal(hostRoom.lastView.game, 'blackjack');
  assert.equal(hostRoom.lastView.gameVote,null);
  assert.equal(hostRoom.lastView.players.some(p=>p.id===guest.id),false);
});

test('host disconnects and cancels the vote', async t => {
  const { server, host, guest, hostRoom, guestRoom } = await setup();
  t.after(async () => teardown({ server, host, guest, hostRoom, guestRoom }));
  guestRoom.dispatch({ type: 'choose', game: 'roulette' });
  await wait(() => guestRoom.lastView?.gameVote);
  host.leave();
  await wait(() => guestRoom.lastView?.gameVote === null);
  assert.equal(guestRoom.lastView.game, 'blackjack');
  assert.equal(guestRoom.lastView.gameVote,null);
  assert.equal(guestRoom.lastView.isHost,true);
});

test('guest votes no and the game stays the same', async t => {
  const { server, host, guest, hostRoom, guestRoom } = await setup();
  t.after(async () => teardown({ server, host, guest, hostRoom, guestRoom }));
  guestRoom.dispatch({ type: 'choose', game: 'roulette' });
  await wait(() => guestRoom.lastView?.gameVote);
  hostRoom.dispatch({ type: 'vote', proposalId: guestRoom.lastView.gameVote.id, approve: false });
  await wait(() => guestRoom.lastView?.gameVote === null);
  assert.equal(guestRoom.lastView.game, 'blackjack');
  assert.equal(guestRoom.lastView.gameVote,null);
});

test('guest votes yes and the game changes', async t => {
  const { server, host, guest, hostRoom, guestRoom } = await setup();
  t.after(async () => teardown({ server, host, guest, hostRoom, guestRoom }));
  guestRoom.dispatch({ type: 'choose', game: 'roulette' });
  await wait(() => guestRoom.lastView?.gameVote);
  hostRoom.dispatch({ type: 'vote', proposalId: guestRoom.lastView.gameVote.id, approve: true });
  await wait(() => guestRoom.lastView?.game === 'roulette');
  assert.equal(guestRoom.lastView.game, 'roulette');
  assert.equal(guestRoom.lastView.gameVote,null);
  assert.ok(guestRoom.lastView.players.every(p=>p.bet===0));
});
