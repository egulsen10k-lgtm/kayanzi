import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {CasinoRoom} from '../src/katlayanzi-room.js';
import {CASINO_TABLES,sanitizeLobbyPose,constrainLobbyPosition,nearbyLobbyTable,sanitizeLobbySnapshot} from '../src/katlayanzi-lobby.js';
import {sanitizeCasinoPayload} from '../src/katlayanzi-protocol.js';
import {MultiplayerSession} from '../src/multiplayer.js';
import {createLanServer} from '../server/lan-server.mjs';

function solo(t){let clock=1000;const room=new CasinoRoom({now:()=>clock});t.after(()=>room.destroy());return {room,advance:()=>{clock+=1000;}};}
function walk(room,advance,x,z){for(let i=0;i<100;i++){const player=room.getLobby().players.find(p=>p.id===room.meId),dx=x-player.x,dz=z-player.z,d=Math.hypot(dx,dz);if(d<.01)return;advance();const result=room.moveLobby({x:player.x+dx/d*Math.min(1,d),z:player.z+dz/d*Math.min(1,d),heading:0});assert.equal(result.ok,true);}}
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Lobby did not synchronize');};

test('lobby geometry bounds malformed poses and blocks walking through tables',()=>{
  assert.equal(sanitizeLobbyPose({x:NaN,z:0,heading:0}),null);
  assert.deepEqual(sanitizeLobbyPose({x:99,z:-99,heading:0}),{x:13,z:-10,heading:0});
  const stopped=constrainLobbyPosition({x:0,z:0,heading:0},{x:0,z:10,heading:0});
  assert.ok(stopped.z>=8.3);assert.equal(nearbyLobbyTable({x:0,z:10}).id,'poker');
  assert.equal(CASINO_TABLES.filter(t=>t.playable).length,3);
  assert.equal(nearbyLobbyTable({x:9,z:6}),null);
  assert.equal(sanitizeLobbySnapshot({revision:0,players:[{id:'x',x:Infinity,z:1,heading:0,tableId:null}]}),null);
});

test('lobby metadata survives existing casino protocol without new packet types',()=>{
  const action={kind:'action',requestId:'move-1',action:{type:'join',lobby:{type:'move',x:1,z:10,heading:0}}};
  assert.deepEqual(sanitizeCasinoPayload(action),action);
  const view={kind:'view',state:{version:0,players:[],dealer:[],lobby:{revision:1,players:[]}}};
  assert.deepEqual(sanitizeCasinoPayload(view),view);
});

test('solo entering walks, rejects remote seating and decorative tables, then seats selected game',t=>{
  const {room,advance}=solo(t);assert.equal(room.enterLobby().ok,true);
  assert.equal(room.getLobby().players[0].tableId,null);
  assert.equal(room.sitAtTable('roulette').ok,false);
  assert.equal(room.sitAtTable('decor-right').ok,false);
  assert.equal(room.dispatch({type:'bet',amount:25}).ok,false);
  assert.equal(room.sitAtTable('poker').ok,true);
  assert.equal(room.getView().game,'poker');assert.equal(room.getLobby().players[0].tableId,'poker');
  assert.equal(room.moveLobby({x:1,z:10,heading:0}).ok,false);
  assert.equal(room.dispatch({type:'bet',amount:25}).ok,true);
  room.standUp();assert.equal(room.getView().players[0].chips,1000);assert.equal(room.getView().players[0].bet,0);
  walk(room,advance,2,10);assert.equal(room.getLobby().players[0].x,2);
  room.leaveLobby();assert.equal(room.getLobby().players.length,0);room.enterLobby();assert.equal(room.getView().players[0].chips,1000);
});

test('movement rejects nonfinite coordinates, teleports and packet floods',t=>{
  const {room}=solo(t);room.enterLobby();
  assert.equal(room.moveLobby({x:NaN,z:10,heading:0}).ok,false);
  assert.equal(room.moveLobby({x:12,z:10,heading:0}).ok,false);
  for(let i=0;i<39;i++)assert.equal(room.moveLobby({x:0,z:10,heading:0}).ok,true);
  assert.equal(room.moveLobby({x:0,z:10,heading:0}).ok,false);
});

test('standing during an active hand resolves the leaving turn without resetting bankroll',t=>{
  const {room}=solo(t);room.enterLobby();room.sitAtTable('poker');room.dispatch({type:'bet',amount:25});room.dispatch({type:'deal'});
  assert.equal(room.getView().phase,'playing');room.standUp();
  assert.equal(room.getView().phase,'result');assert.equal(room.getView().players[0].chips,975);assert.equal(room.getLobby().players[0].tableId,null);
});

test('guests reject foreign, malformed and out-of-order lobby snapshots',t=>{
  const session={connected:true,room:'ABC123',id:'b',worldAuthorityId:'a',host:false,peers:new Map(),sendCasino:()=>true};
  const room=new CasinoRoom({session});t.after(()=>room.destroy());
  const state={version:0,players:[],dealer:[],meId:'b',lobby:{revision:4,players:[{id:'b',name:'Bob',x:0,z:10,heading:0,tableId:null}]}};
  room.receive({id:'other',payload:{kind:'view',state}});assert.equal(room.getLobby().players.length,0);
  room.receive({id:'a',payload:{kind:'view',state}});assert.equal(room.getLobby().revision,4);
  room.receive({id:'a',payload:{kind:'view',state:{...state,lobby:{revision:3,players:[]}}}});assert.equal(room.getLobby().players.length,1);
  room.receive({id:'a',payload:{kind:'view',state:{...state,lobby:{revision:5,players:[null]}}}});assert.equal(room.getLobby().revision,4);
});

test('two real LAN clients share lounge movement, voted seating, standing and leaving',async t=>{
  const server=createLanServer({port:0,host:'127.0.0.1'});await server.listen();const url=`http://127.0.0.1:${server.server.address().port}`;
  let hostRoom,guestRoom;
  const host=new MultiplayerSession({WebSocketClass:WebSocket,onCasino:p=>hostRoom?.receive(p)}),guest=new MultiplayerSession({WebSocketClass:WebSocket,onCasino:p=>guestRoom?.receive(p)});
  t.after(async()=>{hostRoom?.destroy();guestRoom?.destroy();host.leave();guest.leave();await server.close();});
  await host.connectLan({url,room:'LOBBY'});hostRoom=new CasinoRoom({session:host});
  await guest.connectLan({url,room:'LOBBY'});guestRoom=new CasinoRoom({session:guest});
  await wait(()=>guestRoom.getView().players.length===2);
  hostRoom.enterLobby();guestRoom.enterLobby();await wait(()=>guestRoom.getLobby().players.length===2);
  const guestX=guestRoom.getLobby().players.find(p=>p.id===guest.id).x+.2;
  guestRoom.moveLobby({x:guestX,z:10,heading:1});await wait(()=>hostRoom.getLobby().players.find(p=>p.id===guest.id)?.x===guestX);
  guestRoom.sitAtTable('poker');await wait(()=>hostRoom.getView().gameVote);
  assert.equal(hostRoom.getLobby().players.find(p=>p.id===guest.id).tableId,null);
  hostRoom.dispatch({type:'vote',proposalId:hostRoom.getView().gameVote.id,approve:true});
  await wait(()=>guestRoom.getLobby().players.find(p=>p.id===guest.id)?.tableId==='poker');
  guestRoom.standUp();await wait(()=>hostRoom.getLobby().players.find(p=>p.id===guest.id)?.tableId===null);
  guestRoom.leaveLobby();await wait(()=>hostRoom.getLobby().players.length===1);
  guestRoom.enterLobby();await wait(()=>hostRoom.getLobby().players.length===2);
  const leavingId=guest.id;guest.leave();await wait(()=>!host.peers.has(leavingId));hostRoom._sync();assert.equal(hostRoom.getLobby().players.length,1);
});


test('eight arrivals use separate safe spawns and reuse vacancies after departures',t=>{
  const {room}=solo(t);room.enterLobby();
  assert.deepEqual([room.getLobby().players[0].x,room.getLobby().players[0].z],[0,10]);
  for(let i=1;i<8;i++)assert.equal(room._applyLobby(`peer-${i}`,'Guest',{type:'enter'}).ok,true);
  const players=room._lobbySnapshot().players;
  assert.equal(new Set(players.map(p=>`${p.x}:${p.z}`)).size,8);
  for(const p of players){
    assert.ok(p.x>=-13&&p.x<=13&&p.z>=-10&&p.z<=12);
    assert.ok(CASINO_TABLES.every(table=>Math.hypot(p.x-table.x,p.z-table.z)>=2.3));
  }
  const vacant=players.find(p=>p.id==='peer-2');
  room._applyLobby('peer-2','Guest',{type:'leave'});
  room._applyLobby('replacement','Guest',{type:'enter'});
  const replacement=room._lobbySnapshot().players.find(p=>p.id==='replacement');
  assert.deepEqual([replacement.x,replacement.z],[vacant.x,vacant.z]);
});
