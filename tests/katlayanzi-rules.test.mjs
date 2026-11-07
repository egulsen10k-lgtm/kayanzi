import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {KatlayanziGame,rouletteReturnMultiplier} from '../src/katlayanzi-game.js';
import {sanitizeCasinoPayload} from '../src/katlayanzi-protocol.js';
import {CasinoRoom} from '../src/katlayanzi-room.js';
import {MultiplayerSession} from '../src/multiplayer.js';
import {createLanServer} from '../server/lan-server.mjs';
const cards=ranks=>ranks.split(' ').map(rank=>({rank,suit:'♠'}));
const act=(game,type,props={})=>game.apply('a','Alice',{type,...props});
function table(kind='blackjack'){
  const game=new KatlayanziGame({hostId:'a',random:()=>0});act(game,'join');act(game,'choose',{game:kind});return game;
}
function dealBlackjack(dealer='10 7',hand='5 6',draws='10'){
  const game=table();act(game,'bet',{amount:25});
  game._shuffle=()=>{game.deck=cards(`${dealer} ${hand} ${draws}`).reverse();};
  act(game,'deal');return game;
}
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Casino rules did not synchronize');};

test('blackjack double down buys exactly one card and settles the doubled wager',()=>{
  const game=dealBlackjack(),before=game.view('a').players[0];assert.equal(before.canDouble,true);
  assert.equal(act(game,'double').ok,true);const p=game.players[0];
  assert.equal(p.bet,50);assert.equal(p.hand.length,3);assert.equal(p.doubled,true);assert.equal(game.phase,'result');assert.equal(p.chips,1050);
  assert.equal(act(game,'double').ok,false);assert.equal(p.chips,1050);
});
test('blackjack double down requires an initial hand, balance and the correct turn',()=>{
  let game=dealBlackjack('10 7','2 3','2 10');act(game,'hit');assert.equal(act(game,'double').ok,false);assert.equal(act(game,'surrender').ok,false);
  game=dealBlackjack();game.players[0].chips=20;assert.equal(game.view('a').players[0].canDouble,false);assert.equal(act(game,'double').ok,false);assert.equal(game.players[0].bet,25);
  assert.equal(game.apply('b','Bob',{type:'double'}).ok,false);
});
test('late surrender returns half the stake exactly once and survives later settlement',()=>{
  const game=dealBlackjack('10 7','10 6','10');assert.equal(game.view('a').players[0].canSurrender,true);
  assert.equal(act(game,'surrender').ok,true);assert.equal(game.phase,'result');assert.equal(game.players[0].chips,987.5);assert.equal(game.players[0].payout,12.5);assert.equal(game.players[0].result,'Surrender');
  assert.equal(act(game,'surrender').ok,false);assert.equal(game.players[0].chips,987.5);
});
test('dealer blackjack is peeked before actions and player naturals push',()=>{
  let game=dealBlackjack('A K','10 6','2');assert.equal(game.phase,'result');assert.equal(game.players[0].result,'Dealer blackjack');assert.equal(game.players[0].chips,975);assert.equal(act(game,'surrender').ok,false);
  game=dealBlackjack('A K','A Q','2');assert.equal(game.phase,'result');assert.equal(game.players[0].chips,1000);
  game=dealBlackjack('10 7','A K','2');assert.equal(game.players[0].chips,1037.5);
});
test('dealer stands on soft17 and does not consume an unnecessary card',()=>{
  const game=dealBlackjack('A 6','10 8','2');act(game,'stand');assert.equal(game.dealer.length,2);assert.equal(game.players[0].result,'Win');
});
test('roulette pays simultaneous overlapping straight, color, parity, dozen and column wagers',()=>{
  const game=table('roulette');game.random=()=>1/37+.001;
  for(const choice of [1,'red','odd','low','dozen1','column1'])assert.equal(act(game,'bet',{amount:10,choice}).ok,true);
  assert.equal(game.players[0].bet,60);assert.equal(game.players[0].rouletteBets.length,6);assert.equal(game.players[0].chips,940);
  act(game,'deal');assert.equal(game.roulette.number,1);assert.equal(game.players[0].payout,480);assert.equal(game.players[0].chips,1420);
});
test('roulette zero and green share one straight-up wager and all outside bets lose on zero',()=>{
  const game=table('roulette');for(const choice of ['green',0,'red','even','low','dozen1','column1'])act(game,'bet',{amount:5,choice});
  assert.deepEqual(game.players[0].rouletteBets[0],{choice:0,amount:10});assert.equal(game.players[0].rouletteBets.length,6);
  act(game,'deal');assert.equal(game.roulette.number,0);assert.equal(game.players[0].payout,360);assert.equal(game.players[0].chips,1325);
  for(const choice of ['red','black','even','odd','low','high','dozen1','dozen2','dozen3','column1','column2','column3'])assert.equal(rouletteReturnMultiplier(choice,0),0);
});
test('roulette outside bets use European dozens and columns without wraparound',()=>{
  assert.equal(rouletteReturnMultiplier('dozen1',12),3);assert.equal(rouletteReturnMultiplier('dozen1',13),0);assert.equal(rouletteReturnMultiplier('dozen3',36),3);
  assert.equal(rouletteReturnMultiplier('column1',34),3);assert.equal(rouletteReturnMultiplier('column2',35),3);assert.equal(rouletteReturnMultiplier('column3',36),3);
  assert.equal(rouletteReturnMultiplier('high',19),2);assert.equal(rouletteReturnMultiplier('low',18),2);assert.equal(rouletteReturnMultiplier('even',36),2);
  for(const [choice,number] of [['bad',1],[false,1],['red',NaN],['red',37],[NaN,1]])assert.equal(rouletteReturnMultiplier(choice,number),0);
});
test('roulette limits reject overspending and malformed wagers atomically',()=>{
  const game=table('roulette');for(let i=0;i<4;i++)assert.equal(act(game,'bet',{amount:250,choice:i}).ok,true);
  const before=JSON.stringify(game.players[0]);assert.equal(act(game,'bet',{amount:5,choice:4}).ok,false);assert.equal(JSON.stringify(game.players[0]),before);
  act(game,'clearbets');for(const choice of [-1,37,2.5,'0','dozen4',null,{},[]])assert.equal(act(game,'bet',{amount:5,choice}).ok,false);
  for(const amount of [0,4,251,NaN,Infinity,-5,5.5])assert.equal(act(game,'bet',{amount,choice:1}).ok,false);
  for(const choice of [...Array.from({length:37},(_,i)=>i),'red','black','even'])assert.equal(act(game,'bet',{amount:5,choice}).ok,true);
  assert.equal(game.players[0].rouletteBets.length,40);assert.equal(act(game,'bet',{amount:5,choice:'odd'}).ok,false);
});
test('roulette single-spot removal, clearing, doubling and repeat preserve chip accounting',()=>{
  const game=table('roulette');act(game,'bet',{amount:10,choice:'red'});act(game,'bet',{amount:5,choice:0});act(game,'doublebet');
  assert.equal(game.players[0].bet,30);assert.equal(game.players[0].chips,970);assert.deepEqual(game.players[0].rouletteBets,[{choice:'red',amount:20},{choice:0,amount:10}]);
  act(game,'removebet',{choice:'green'});assert.equal(game.players[0].bet,20);assert.equal(game.players[0].chips,980);assert.equal(act(game,'removebet',{choice:0}).ok,false);
  act(game,'deal');assert.equal(act(game,'clearbets').ok,false);act(game,'next');assert.equal(game.players[0].rouletteBets.length,0);
  assert.equal(act(game,'rebet').ok,true);assert.equal(game.players[0].bet,20);assert.equal(game.players[0].chips,960);assert.equal(act(game,'rebet').ok,false);
  act(game,'clearbets');assert.equal(game.players[0].chips,980);assert.equal(game.players[0].bet,0);
});
test('standard bet doubling and repeating retain the initial wager without turning poker into shared hands',()=>{
  const game=table('poker');act(game,'bet',{amount:100});assert.equal(act(game,'doublebet').ok,true);assert.equal(game.players[0].bet,200);assert.equal(act(game,'doublebet').ok,false);
  game.apply('b','Bob',{type:'join'});game.apply('b','Bob',{type:'bet',amount:25});act(game,'deal');assert.ok(game.view('b').players[0].hand.every(card=>card===null));
  act(game,'stand');game.apply('b','Bob',{type:'stand'});act(game,'next');const before=game.players[0].chips;assert.equal(act(game,'rebet').ok,true);assert.equal(game.players[0].bet,200);assert.equal(game.players[0].chips,before-200);
});
test('new rule actions survive protocol validation while unknown actions fail',()=>{
  for(const type of ['double','surrender','doublebet','clearbets','rebet','removebet'])assert.ok(sanitizeCasinoPayload({kind:'action',requestId:'rule-1',action:{type,choice:0}}));
  assert.equal(sanitizeCasinoPayload({kind:'action',requestId:'rule-1',action:{type:'givechips'}}),null);
});
test('real LAN host publishes multiple guest roulette bets and clear refunds',async t=>{
  const server=createLanServer({port:0,host:'127.0.0.1'});await server.listen();const url=`http://127.0.0.1:${server.server.address().port}`;let hostRoom,guestRoom;
  const host=new MultiplayerSession({WebSocketClass:WebSocket,onCasino:p=>hostRoom?.receive(p)}),guest=new MultiplayerSession({WebSocketClass:WebSocket,onCasino:p=>guestRoom?.receive(p)});
  t.after(async()=>{hostRoom?.destroy();guestRoom?.destroy();host.leave();guest.leave();await server.close();});
  await host.connectLan({url,room:'RULES'});hostRoom=new CasinoRoom({session:host});await guest.connectLan({url,room:'RULES'});guestRoom=new CasinoRoom({session:guest});await wait(()=>guestRoom.getView().players.length===2);
  hostRoom.dispatch({type:'choose',game:'roulette'});await wait(()=>guestRoom.getView().gameVote);guestRoom.dispatch({type:'vote',proposalId:guestRoom.getView().gameVote.id,approve:true});await wait(()=>guestRoom.getView().game==='roulette');
  guestRoom.dispatch({type:'bet',amount:25,choice:'red'});guestRoom.dispatch({type:'bet',amount:10,choice:17});await wait(()=>hostRoom.getView().players.find(p=>p.id===guest.id)?.bet===35);
  guestRoom.dispatch({type:'doublebet'});await wait(()=>guestRoom.getView().players.find(p=>p.id===guest.id)?.bet===70);
  assert.deepEqual(guestRoom.getView().players.find(p=>p.id===guest.id).rouletteBets,[{choice:'red',amount:50},{choice:17,amount:20}]);
  guestRoom.dispatch({type:'removebet',choice:17});await wait(()=>guestRoom.getView().players.find(p=>p.id===guest.id)?.bet===50);
  guestRoom.dispatch({type:'clearbets'});await wait(()=>hostRoom.getView().players.find(p=>p.id===guest.id)?.bet===0);assert.equal(guestRoom.getView().players.find(p=>p.id===guest.id).chips,1000);
  guestRoom.dispatch({type:'bet',amount:25,choice:'red'});guestRoom.dispatch({type:'bet',amount:10,choice:17});await wait(()=>hostRoom.getView().players.find(p=>p.id===guest.id)?.bet===35);
  hostRoom.engine.random=()=>0;hostRoom.dispatch({type:'deal'});await wait(()=>guestRoom.getView().phase==='result');assert.equal(guestRoom.getView().players.find(p=>p.id===guest.id).chips,965);
  hostRoom.dispatch({type:'next'});await wait(()=>guestRoom.getView().phase==='betting');guestRoom.dispatch({type:'rebet'});await wait(()=>guestRoom.getView().players.find(p=>p.id===guest.id)?.bet===35);
  assert.deepEqual(hostRoom.getView().players.find(p=>p.id===guest.id).rouletteBets,[{choice:'red',amount:25},{choice:17,amount:10}]);assert.equal(guestRoom.getView().players.find(p=>p.id===guest.id).chips,930);
  guestRoom.dispatch({type:'clearbets'});await wait(()=>hostRoom.getView().players.find(p=>p.id===guest.id)?.bet===0);assert.equal(guestRoom.getView().players.find(p=>p.id===guest.id).chips,965);
});

test('maximum legal roulette views fit the existing packet budget and keep repeat history private',t=>{
  const ids=Array.from({length:8},(_,i)=>`p${i}${'x'.repeat(78)}`),game=new KatlayanziGame({hostId:ids[0],random:()=>1/37+.001});
  game.apply(ids[0],'\"'.repeat(24),{type:'join'});game.apply(ids[0],'\"'.repeat(24),{type:'choose',game:'roulette'});
  for(const id of ids.slice(1))game.apply(id,'\"'.repeat(24),{type:'join'});
  const choices=['red','black','even','odd','low','high','dozen1','dozen2','dozen3','column1','column2','column3',...Array.from({length:28},(_,i)=>i)];
  const betAll=()=>{for(const id of ids){for(const [i,choice] of choices.entries())assert.equal(game.apply(id,'\"'.repeat(24),{type:'bet',amount:i<6?100:10,choice}).ok,true);assert.equal(game.apply(id,'\"'.repeat(24),{type:'bet',amount:60,choice:'red'}).ok,true);}};
  betAll();game.apply(ids[0],'\"'.repeat(24),{type:'deal'});game.apply(ids[0],'\"'.repeat(24),{type:'next'});betAll();
  game.apply(ids[0],'\"'.repeat(24),{type:'choose',game:'poker'});
  for(let i=1;i<=6;i++)game.apply(ids[i],'\"'.repeat(24),{type:'vote',proposalId:game.gameVote.id,approve:i<=3});
  assert.equal(game.game,'roulette');assert.equal(Object.keys(game.gameVote.votes).length,7);
  let maxLength=0;
  for(const id of ids){
    const view=game.view(id),own=view.players.find(p=>p.id===id);
    assert.equal(game.players.find(p=>p.id===id).lastBets.length,40);assert.equal(own.previousWager,1000);assert.equal(own.canRebet,false);
    assert.ok(view.players.every(p=>!Object.hasOwn(p,'lastBets')&&!Object.hasOwn(p,'lastBet')&&!Object.hasOwn(p,'lastBetGame')));
    assert.ok(view.players.every(p=>p.rouletteBets.length===40));
    // Include the room's additional lobby metadata at its supported eight-peer bound.
    const packet={kind:'view',state:{...view,connected:true,roomCode:'R'.repeat(24),lobby:{revision:Number.MAX_SAFE_INTEGER,players:ids.map((peer,i)=>({id:peer,name:'\"'.repeat(24),x:6.123456789012345,z:-6.123456789012345,heading:-1.2345678901234567,tableId:'roulette'}))}}};
    maxLength=Math.max(maxLength,JSON.stringify(packet).length);
    assert.ok(JSON.stringify(packet).length<16000,`view length ${JSON.stringify(packet).length}`);
    assert.ok(sanitizeCasinoPayload(packet));
  }
  game.apply(ids[0],'A',{type:'clearbets'});assert.equal(game.view(ids[0]).players[0].canRebet,true);
  t.diagnostic(`Largest bounded private view: ${maxLength}/16000 characters`);
});
