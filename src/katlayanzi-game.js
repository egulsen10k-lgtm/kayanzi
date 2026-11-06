// Virtual chips only. The room host owns the deck, outcomes and balances.
export const CASINO_GAMES = ['blackjack', 'roulette', 'poker'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const value = card => RANKS.indexOf(card.rank) + 2;
const clone = data => JSON.parse(JSON.stringify(data));
const safeName = name => String(name || 'Driver').replace(/[<>\x00-\x1f]/g,'').slice(0,24);
export function blackjackTotal(hand) {
  let total=0,aces=0;
  for(const card of hand){if(card.rank==='A'){total+=11;aces++;}else total+=Math.min(10,value(card));}
  while(total>21&&aces-- >0)total-=10;
  return total;
}
export function pokerRank(hand) {
  if(!Array.isArray(hand)||hand.length!==5)return [-1];
  const ranks=hand.map(value).sort((a,b)=>b-a), counts=new Map();
  for(const r of ranks)counts.set(r,(counts.get(r)||0)+1);
  const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const unique=[...counts.keys()].sort((a,b)=>b-a);
  const straight=unique.length===5?(unique[0]-unique[4]===4?unique[0]:unique.join(',')==='14,5,4,3,2'?5:0):0;
  const flush=hand.every(c=>c.suit===hand[0].suit);
  if(flush&&straight)return [8,straight];
  if(groups[0][1]===4)return [7,groups[0][0],groups[1][0]];
  if(groups[0][1]===3&&groups[1][1]===2)return [6,groups[0][0],groups[1][0]];
  if(flush)return [5,...ranks];
  if(straight)return [4,straight];
  if(groups[0][1]===3)return [3,...groups.map(g=>g[0])];
  if(groups[0][1]===2&&groups[1][1]===2)return [2,...groups.map(g=>g[0])];
  if(groups[0][1]===2)return [1,...groups.map(g=>g[0])];
  return [0,...ranks];
}
const compare=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return Math.sign(d);}return 0;};
export class KatlayanziGame {
  constructor({hostId='solo',now=Date.now,random=()=>{const n=new Uint32Array(1);globalThis.crypto.getRandomValues(n);return n[0]/4294967296;}}={}) {
    this.hostId=hostId;this.random=random;this.now=now;this.gameVote=null;this.voteSerial=0;this.game='blackjack';this.phase='betting';this.round=1;this.version=0;this.players=[];this.dealer=[];this.deck=[];this.roulette=null;this.turnId=null;this.message='Take a seat and place your virtual-chip bet.';
  }
  _shuffle(){this.deck=Array.from({length:this.game==='blackjack'?6:1},()=>SUITS.flatMap(suit=>RANKS.map(rank=>({rank,suit})))).flat();for(let i=this.deck.length-1;i>0;i--){const j=Math.min(i,Math.max(0,Math.floor(this.random()*(i+1))));[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}}
  _card(){const card=this.deck.pop();if(!card)throw new Error('Deck exhausted');return card;}
  _turn(){this.turnId=this.players.find(p=>p.status==='playing')?.id||null;if(!this.turnId)this._settle();}
  _pay(p,multiplier,result){p.payout=p.bet*multiplier;p.chips+=p.payout;p.result=result;p.status='done';}
  _settle(){
    if(this.game==='blackjack'){
      while(blackjackTotal(this.dealer)<17)this.dealer.push(this._card());
      const dealer=blackjackTotal(this.dealer),natural=this.dealer.length===2&&dealer===21;
      for(const p of this.players.filter(p=>p.bet>0)){
        if(p.status==='folded'){this._pay(p,0,'Left table');continue;}
        const score=blackjackTotal(p.hand),bj=p.hand.length===2&&score===21;
        if(score>21)this._pay(p,0,'Bust');
        else if(bj&&!natural)this._pay(p,2.5,'Blackjack');
        else if(natural&&!bj)this._pay(p,0,'Dealer blackjack');
        else if(dealer>21||score>dealer)this._pay(p,2,'Win');
        else if(score===dealer)this._pay(p,1,'Push');else this._pay(p,0,'Dealer wins');
      }
    }else if(this.game==='poker'){
      const counts=new Map();for(const c of this.dealer)counts.set(c.rank,(counts.get(c.rank)||0)+1);
      this.dealer=this.dealer.map(c=>(counts.get(c.rank)>1||value(c)>=12)?c:this._card());
      for(const p of this.players.filter(p=>p.bet>0)){
        if(p.status==='folded'){this._pay(p,0,'Folded');continue;}
        const cmp=compare(pokerRank(p.hand),pokerRank(this.dealer));this._pay(p,cmp>0?2:cmp===0?1:0,cmp>0?'Win':cmp===0?'Push':'Dealer wins');
      }
    }
    this.phase='result';this.turnId=null;this.message='Round complete. Host can start the next round.';
  }
  advance(now=this.now()) {
    if(!this.gameVote||!Number.isFinite(now)||now<this.gameVote.expiresAt)return false;
    this.gameVote=null;this.message='Game-change vote expired. The current table stays open.';this.version++;return true;
  }
  _changeGame(game) {
    if(this.phase==='betting')for(const player of this.players)player.chips+=player.bet;
    this.gameVote=null;this.game=game;this._reset();
  }
  _resolveVote() {
    const vote=this.gameVote;if(!vote)return;
    vote.yes=Object.values(vote.votes).filter(v=>v===true).length;
    vote.no=Object.values(vote.votes).filter(v=>v===false).length;
    if(vote.yes>=vote.required){this._changeGame(vote.game);this.message=`Vote passed. Welcome to ${this.game}. Unplayed bets were returned.`;}
    else if(vote.eligibleIds.length-vote.no<vote.required){this.gameVote=null;this.message='Game-change vote declined. The current table stays open.';}
  }
  apply(id,name,action={}) {
    if(!action||typeof action!=='object'||Array.isArray(action))return {ok:false,error:'Invalid action'};
    if(action.type!=='join'&&action.round!==undefined&&action.round!==this.round)return {ok:false,error:'That round has ended.'};
    this.advance();
    const host=id===this.hostId;
    let p=this.players.find(p=>p.id===id);
    const fail=error=>({ok:false,error});
    switch(action.type){
      case 'join':
        if(p)break;if(this.players.length>=8)return fail('All eight seats are taken.');
        if(this.phase==='playing')return fail('Join after this round.');
        this.players.push({id,name:safeName(name),chips:1000,bet:0,hand:[],status:'seated',result:'',payout:0});break;
      case 'choose': {
        if(!p||this.phase==='playing'||!CASINO_GAMES.includes(action.game))return fail('Seated players can propose a game between rounds.');
        if(this.gameVote)return fail('Finish the current game-change vote first.');
        if(action.game===this.game)break;
        if(this.players.length===1){this._changeGame(action.game);break;}
        const eligibleIds=this.players.map(player=>player.id),votes=Object.create(null);
        votes[id]=true;
        this.gameVote={id:`vote-${this.round}-${++this.voteSerial}`,game:action.game,proposerId:id,eligibleIds,votes,expiresAt:this.now()+30000,yes:1,no:0,required:Math.floor(eligibleIds.length/2)+1};
        this.message=`${p.name} proposes ${action.game}. Seated players: please vote.`;
        break;
      }
      case 'vote': {
        const vote=this.gameVote;
        if(!vote||action.proposalId!==vote.id)return fail('That vote is no longer open.');
        if(!vote.eligibleIds.includes(id)||typeof action.approve!=='boolean')return fail('Only eligible seated players may vote.');
        if(Object.hasOwn(vote.votes,id))return fail('Your vote has already been recorded.');
        vote.votes[id]=action.approve;this._resolveVote();break;
      }
      case 'next':
        if(this.gameVote)return fail('Finish the game-change vote first.');
        if(!host||this.phase!=='result')return fail('Wait for the round to finish.');this._reset();break;
      case 'bet':{
        if(!p||this.phase!=='betting')return fail('Take a seat before betting.');
        if(this.game==='poker'&&!p.bet&&this.players.filter(player=>player.bet>0).length>=5)return fail('Poker seats five players per hand.');
        const amount=action.amount;if(!Number.isSafeInteger(amount)||amount<5||amount>250||amount>p.chips+p.bet)return fail('Bet 5–250 chips within your balance.');
        const choice=action.choice??'red';if(this.game==='roulette'&&!['red','black','green'].includes(choice)&&!(Number.isInteger(choice)&&choice>=0&&choice<=36))return fail('Choose a roulette color or number.');
        p.chips+=p.bet-amount;p.bet=amount;p.choice=choice;p.status='ready';break;}
      case 'deal':{
        if(this.gameVote)return fail('Finish the game-change vote before dealing.');
        if(!host||this.phase!=='betting'||!this.players.some(p=>p.bet>0))return fail('Place at least one bet, then the host deals.');
        this._shuffle();this.phase='playing';this.message=this.game==='poker'?'Five-card draw. Choose up to three cards to replace, or stand.':'Hit or stand. Dealer stands on 17.';
        const active=this.players.filter(p=>p.bet>0);for(const player of active){player.status='playing';player.result='';player.payout=0;player.hand=[];}
        if(this.game==='roulette'){
          const number=Math.min(36,Math.max(0,Math.floor(this.random()*37))),color=number===0?'green':RED.has(number)?'red':'black';this.roulette={number,color};
          for(const player of active){const win=player.choice===number||player.choice===color;this._pay(player,win?(typeof player.choice==='number'||player.choice==='green'?36:2):0,win?'Win':'Miss');}
          this.phase='result';this.message=`${number} · ${color}. Round complete.`;
        }else{
          const count=this.game==='poker'?5:2;this.dealer=Array.from({length:count},()=>this._card());
          for(const player of active){player.hand=Array.from({length:count},()=>this._card());if(this.game==='blackjack'&&blackjackTotal(player.hand)===21)player.status='stood';}
          this._turn();
        }break;}
      case 'hit':
        if(!p||this.game!=='blackjack'||this.phase!=='playing'||this.turnId!==id)return fail('Wait for your blackjack turn.');
        p.hand.push(this._card());if(blackjackTotal(p.hand)>=21){p.status='stood';this._turn();}break;
      case 'stand':case 'fold':case 'draw':{
        if(!p||this.phase!=='playing'||this.turnId!==id||this.game==='roulette')return fail('Wait for your turn.');
        if(action.type==='fold'&&this.game!=='poker')return fail('Use stand in blackjack.');
        if(action.type==='draw'){
          const indices=action.indices;if(this.game!=='poker'||!Array.isArray(indices)||indices.length>3||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>4))return fail('Choose up to three different cards.');
          for(const i of indices)p.hand[i]=this._card();
        }
        p.status=action.type==='fold'?'folded':'stood';this._turn();break;}
      default:return fail('Unknown table action.');
    }
    this.version++;return {ok:true};
  }
  _reset(){this.phase='betting';this.round++;this.dealer=[];this.roulette=null;this.turnId=null;for(const p of this.players)Object.assign(p,{bet:0,hand:[],status:'seated',result:'',payout:0});this.message='Place your bet. Virtual chips only.';}
  remove(id){if(this.gameVote?.eligibleIds.includes(id)){this.gameVote=null;this.message='Game-change vote canceled because a voter left.';}const p=this.players.find(p=>p.id===id);if(!p)return;if(this.phase==='playing'&&p.status==='playing'){p.status='folded';if(this.turnId===id)this._turn();}if(this.phase!=='playing')this.players=this.players.filter(p=>p.id!==id);this.version++;}
  view(id){
    const result=this.phase==='result';
    return clone({game:this.game,phase:this.phase,round:this.round,version:this.version,gameVote:this.gameVote,players:this.players.map(p=>({...p,hand:this.game==='poker'&&!result&&p.id!==id?p.hand.map(()=>null):p.hand})),dealer:this.dealer.map((c,i)=>result||i===0?c:null),roulette:this.roulette,turnId:this.turnId,message:this.message,meId:id,isHost:id===this.hostId});
  }
}
