import test from 'node:test';
import assert from 'node:assert/strict';
import {KatlayanziGame,blackjackTotal,pokerRank} from '../src/katlayanzi-game.js';
import {CasinoRoom} from '../src/katlayanzi-room.js';
const cards=(ranks,suit='♠')=>ranks.split(' ').map(rank=>({rank,suit}));
const table=(game='blackjack')=>{const t=new KatlayanziGame({hostId:'a',random:()=>.4});t.apply('a','Alice',{type:'join'});t.apply('a','Alice',{type:'choose',game});t.apply('b','Bob',{type:'join'});return t;};
const act=(t,id,action)=>t.apply(id,id,action);
test('virtual-chip bets are bounded, replace previous bets and cannot be forged by guests',()=>{
  const t=table();assert.equal(act(t,'a',{type:'bet',amount:25}).ok,true);assert.equal(t.players[0].chips,975);
  act(t,'a',{type:'bet',amount:50});assert.equal(t.players[0].chips,950);
  for(const amount of [-10,0,NaN,Infinity,251,2.5])assert.equal(act(t,'a',{type:'bet',amount}).ok,false);
  assert.equal(act(t,'b',{type:'deal'}).ok,false);
  act(t,'a',{type:'choose',game:'roulette'});assert.equal(t.game,'blackjack');
  act(t,'b',{type:'vote',proposalId:t.gameVote.id,approve:true});assert.equal(t.players[0].chips,1000);
});
test('blackjack aces, natural payout, turn enforcement and dealer settlement',()=>{
  assert.equal(blackjackTotal(cards('A A 9')),21);
  const t=table();act(t,'a',{type:'bet',amount:20});act(t,'b',{type:'bet',amount:20});act(t,'a',{type:'deal'});
  t.players[0].hand=cards('10 8');t.players[1].hand=cards('A K');t.players[1].status='stood';t.dealer=cards('10 7');
  assert.equal(act(t,'b',{type:'hit'}).ok,false);act(t,'a',{type:'stand'});
  assert.equal(t.phase,'result');assert.equal(t.players[0].chips,1020);assert.equal(t.players[1].chips,1030);
  const before=t.players[0].chips;assert.equal(act(t,'a',{type:'stand'}).ok,false);assert.equal(t.players[0].chips,before);
});
test('roulette shared result pays color and exact-number bets correctly',()=>{
  const t=table('roulette');t.random=()=>0;
  act(t,'a',{type:'bet',amount:10,choice:0});act(t,'b',{type:'bet',amount:10,choice:'red'});act(t,'a',{type:'deal'});
  assert.deepEqual(t.roulette,{number:0,color:'green'});assert.equal(t.players[0].chips,1350);assert.equal(t.players[1].chips,990);
});
test('poker ranking handles wheel straight, flush, full house and private hands',()=>{
  assert.deepEqual(pokerRank(cards('A 2 3 4 5')), [8,5]);
  assert.equal(pokerRank([...cards('K K K'),...cards('2 2','♥')])[0],6);
  const t=table('poker');act(t,'a',{type:'bet',amount:25});act(t,'b',{type:'bet',amount:25});act(t,'a',{type:'deal'});
  assert.equal(t.view('b').players[0].hand.every(c=>c===null),true);assert.ok(t.view('a').players[0].hand[0]);
  assert.equal(act(t,'a',{type:'draw',indices:[0,0]}).ok,false);
  assert.equal(act(t,'a',{type:'draw',indices:[0,1,2]}).ok,true);act(t,'b',{type:'stand'});
  assert.equal(t.phase,'result');assert.ok(t.view('b').players[0].hand[0]);
});
test('five-player poker supports full draws without exhausting a standard deck',()=>{
  const t=table('poker');for(const id of ['c','d','e','f'])act(t,id,{type:'join'});
  for(const id of ['a','b','c','d','e'])assert.equal(act(t,id,{type:'bet',amount:5}).ok,true);
  assert.equal(act(t,'f',{type:'bet',amount:5}).ok,false);act(t,'a',{type:'deal'});
  for(const id of ['a','b','c','d','e'])assert.equal(act(t,id,{type:'draw',indices:[0,1,2]}).ok,true);
  assert.equal(t.phase,'result');
});
test('room controller delivers private host views and rejects replayed actions',t=>{
  const sent=[];const session={connected:true,room:'ABC123',id:'a',worldAuthorityId:'a',host:true,name:'Alice',peers:new Map([['b',{}]]),sendCasino:(payload,id)=>{sent.push({payload,id});return true;}};
  const room=new CasinoRoom({session});t.after(()=>room.destroy());
  room.dispatch({type:'choose',game:'poker'});room.dispatch({type:'bet',amount:25});
  const join={id:'b',name:'Bob',payload:{kind:'action',requestId:'join',action:{type:'join'}}};room.receive(join);
  const bet={id:'b',name:'Bob',payload:{kind:'action',requestId:'bet',action:{type:'bet',amount:25}}};room.receive(bet);room.receive(bet);
  room.dispatch({type:'deal'});const view=sent.at(-1);assert.equal(view.id,'b');assert.equal(view.payload.state.meId,'b');
  assert.equal(view.payload.state.players[0].hand.every(c=>c===null),true);assert.equal(room.engine.players[1].chips,975);
});
test('guests cannot apply untrusted views and stale actions cannot advance a new round',t=>{
  const session={connected:true,room:'ABC123',id:'b',worldAuthorityId:'a',host:false,peers:new Map(),sendCasino:()=>true};
  const room=new CasinoRoom({session});t.after(()=>room.destroy());
  room.receive({id:'evil',payload:{kind:'view',state:{players:[],dealer:[],version:99,meId:'b'}}});assert.equal(room.lastView,null);
  const game=table();assert.equal(act(game,'a',{type:'bet',amount:5,round:game.round-1}).ok,false);
});

test('eight-player blackjack shoe settles repeated seeded rounds without invalid balances',()=>{
  let seed=23;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let round=0;round<40;round++){
    const t=new KatlayanziGame({hostId:'p0',random});
    for(let i=0;i<8;i++){act(t,`p${i}`,{type:'join'});act(t,`p${i}`,{type:'bet',amount:25});}
    act(t,'p0',{type:'deal'});
    let moves=0;
    while(t.phase==='playing'&&moves++<150){const player=t.players.find(p=>p.id===t.turnId);act(t,player.id,{type:blackjackTotal(player.hand)<17?'hit':'stand'});}
    assert.equal(t.phase,'result');assert.ok(t.players.every(p=>Number.isFinite(p.chips)&&p.chips>=0));
    const snapshot=t.view('p0');assert.ok(snapshot.dealer.every(Boolean));
  }
});

test('guest-proposed game changes need a strict majority and refund bets once',()=>{
  const t=table();act(t,'a',{type:'bet',amount:50});act(t,'b',{type:'bet',amount:25});
  assert.equal(act(t,'b',{type:'choose',game:'roulette'}).ok,true);
  const proposal=t.view('a').gameVote;
  assert.equal(t.game,'blackjack');assert.equal(proposal.yes,1);assert.equal(proposal.required,2);
  assert.equal(act(t,'a',{type:'deal'}).ok,false);
  assert.equal(act(t,'a',{type:'vote',proposalId:proposal.id,approve:true}).ok,true);
  assert.equal(t.game,'roulette');assert.equal(t.gameVote,null);
  assert.deepEqual(t.players.map(p=>p.chips),[1000,1000]);
  assert.equal(act(t,'a',{type:'vote',proposalId:proposal.id,approve:true}).ok,false);
  assert.deepEqual(t.players.map(p=>p.chips),[1000,1000]);
});

test('host cannot bypass rejection, duplicate voting or eligible-player checks',()=>{
  const t=table();act(t,'a',{type:'choose',game:'poker'});const vote=t.gameVote.id;
  assert.equal(act(t,'a',{type:'vote',proposalId:vote,approve:true}).ok,false);
  act(t,'c',{type:'join'});
  assert.equal(act(t,'c',{type:'vote',proposalId:vote,approve:true}).ok,false);
  assert.equal(act(t,'a',{type:'choose',game:'roulette'}).ok,false);
  assert.equal(act(t,'b',{type:'vote',proposalId:'old-vote',approve:true}).ok,false);
  act(t,'b',{type:'vote',proposalId:vote,approve:false});
  assert.equal(t.gameVote,null);assert.equal(t.game,'blackjack');assert.match(t.message,/declined/);
});

test('votes expire without action and departing voters cancel pending proposals',()=>{
  let now=500;const t=new KatlayanziGame({hostId:'a',now:()=>now});
  act(t,'a',{type:'join'});act(t,'b',{type:'join'});act(t,'a',{type:'choose',game:'poker'});
  now+=29999;assert.equal(t.advance(),false);now++;assert.equal(t.advance(),true);
  assert.equal(t.gameVote,null);assert.equal(t.game,'blackjack');assert.equal(t.advance(),false);
  act(t,'b',{type:'choose',game:'roulette'});t.remove('a');
  assert.equal(t.gameVote,null);assert.equal(t.game,'blackjack');assert.match(t.message,/voter left/);
});

test('majority for three players is two and proposals cannot interrupt a dealt hand',()=>{
  const t=table();act(t,'c',{type:'join'});act(t,'a',{type:'choose',game:'poker'});
  assert.equal(t.gameVote.required,2);act(t,'c',{type:'vote',proposalId:t.gameVote.id,approve:true});
  assert.equal(t.game,'poker');act(t,'a',{type:'bet',amount:25});act(t,'a',{type:'deal'});
  assert.equal(act(t,'b',{type:'choose',game:'roulette'}).ok,false);assert.equal(t.game,'poker');
});

test('host room tick publishes vote expiration even with no player actions',t=>{
  const session={connected:true,room:'VOTES',id:'a',worldAuthorityId:'a',host:true,name:'A',peers:new Map([['b',{}]]),sendCasino:()=>true};
  const room=new CasinoRoom({session});t.after(()=>room.destroy());
  room.receive({id:'b',name:'B',payload:{kind:'action',requestId:'join',action:{type:'join'}}});
  room.dispatch({type:'choose',game:'poker'});room.engine.gameVote.expiresAt=0;
  let updates=0;room.subscribe(()=>updates++);room._sync();
  assert.equal(room.getView().gameVote,null);assert.match(room.getView().message,/expired/);assert.equal(updates,2);
});
