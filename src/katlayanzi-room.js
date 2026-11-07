import {KatlayanziGame} from './katlayanzi-game.js';
import {CASINO_TABLES, constrainLobbyPosition, sanitizeLobbyPose, sanitizeLobbySnapshot} from './katlayanzi-lobby.js';
const LOBBY_SPAWNS=[[0,10],[.9,10],[-.9,10],[1.8,10],[-1.8,10],[.9,11],[-.9,11],[1.8,11]];
export class CasinoRoom {
  constructor({session,now=Date.now}={}) {
    this.session=session;this.now=now;this.listeners=new Set();this.lobbyListeners=new Set();this.lobbyPlayers=new Map();this.lobbyRevision=0;this.lastLobby={revision:0,players:[]};this.lobbyRates=new Map();this.inLobby=false;
    this.key=null;this.serial=0;this.seen=new Map();this.lastView=null;this.lastVersion=-1;
    this._sync();this.timer=setInterval(()=>this._sync(),1000);
  }
  _identity(){const s=this.session;return s?.connected?`${s.room}:${s.id}:${s.worldAuthorityId}`:'solo';}
  _sync(){
    const key=this._identity();if(key!==this.key){
      this.key=key;this.seen.clear();this.lastVersion=-1;this.lobbyPlayers.clear();this.lobbyRates.clear();this.lobbyRevision=0;this.lastLobby={revision:0,players:[]};
      const s=this.session;this.meId=s?.connected?s.id:'solo';this.authority=!s?.connected||s.host;
      this.engine=this.authority?new KatlayanziGame({hostId:this.meId}):null;
      this.lastView=null;if(this.engine)this.engine.apply(this.meId,s?.name||'You',{type:'join'});
      if(this.authority)this._publish();else this.dispatch({type:'join'});
      if(this.inLobby)this._lobbyDispatch({type:'enter'});
    }else if(this.authority){
      let changed=this.engine.advance();
      if(this.session?.connected){
        for(const id of this.seen.keys())if(!this.session.peers.has(id))this.seen.delete(id);
        for(const id of this.lobbyPlayers.keys())if(id!==this.meId&&!this.session.peers.has(id)){this.lobbyPlayers.delete(id);this.lobbyRates.delete(id);this.lobbyRevision++;changed=true;}
        for(const p of this.engine.players){if(p.id!==this.meId&&!this.session.peers.has(p.id)){this.engine.remove(p.id);changed=true;}}
      }
      if(changed)this._publish();
    }
  }
  _reconcileLobby(){
    for(const player of this.lobbyPlayers.values()){
      if(player.tableId&&player.tableId!==this.engine.game){player.tableId=null;this.lobbyRevision++;}
      if(player.pendingTableId===this.engine.game){player.tableId=player.pendingTableId;player.pendingTableId=null;this.lobbyRevision++;}
      else if(player.pendingTableId&&!this.engine.gameVote){player.pendingTableId=null;}
    }
  }
  _lobbySnapshot(){return {revision:this.lobbyRevision,players:[...this.lobbyPlayers.values()].map(({id,name,x,z,heading,tableId})=>({id,name,x,z,heading,tableId}))};}
  _privateView(id){return {...this.engine.view(id),lobby:this._lobbySnapshot()};}
  _meta(view){return {...view,connected:Boolean(this.session?.connected),roomCode:this.session?.shortCode||this.session?.room||'Solo practice'};}
  _publish(){
    this._reconcileLobby();this.lastLobby=this._lobbySnapshot();this.lastView=this._privateView(this.meId);this._emit();this._emitLobby();
    if(this.session?.connected)for(const id of this.session.peers.keys())this.session.sendCasino?.({kind:'view',state:this._privateView(id)},id);
  }
  _emit(){for(const listener of this.listeners)listener(this.getView());}
  _emitLobby(){for(const listener of this.lobbyListeners)listener(this.getLobby());}
  getView(){return this._meta(this.lastView||{game:'blackjack',phase:'betting',round:1,version:0,players:[],dealer:[],roulette:null,turnId:null,message:'Connecting to the host’s table…',meId:this.meId,isHost:false});}
  getLobby(){return {meId:this.meId,revision:this.lastLobby.revision,players:this.lastLobby.players.map(player=>({...player})),tables:CASINO_TABLES};}
  subscribe(listener){this.listeners.add(listener);listener(this.getView());return ()=>this.listeners.delete(listener);}
  subscribeLobby(listener){this.lobbyListeners.add(listener);listener(this.getLobby());return ()=>this.lobbyListeners.delete(listener);}
  enterLobby(){this.inLobby=true;return this._lobbyDispatch({type:'enter'});}
  leaveLobby(){this.inLobby=false;return this._lobbyDispatch({type:'leave'});}
  moveLobby(pose){const valid=sanitizeLobbyPose(pose);if(!valid)return {ok:false,error:'Invalid position.'};return this._lobbyDispatch({type:'move',...valid});}
  sitAtTable(tableId){return this._lobbyDispatch({type:'sit',tableId});}
  standUp(){return this._lobbyDispatch({type:'stand'});}
  _lobbyDispatch(lobby){return this.dispatch({type:'join',lobby});}
  _leaveSeat(id){
    const seated=this.engine.players.find(player=>player.id===id);
    if(!seated)return;
    if(this.engine.phase==='betting'&&seated.bet){seated.chips+=seated.bet;seated.bet=0;seated.rouletteBets=[];seated.status='seated';this.engine.version++;}
    if(this.engine.phase==='playing'&&seated.status==='playing'){
      seated.status='folded';this.engine.version++;
      if(this.engine.turnId===id)this.engine._turn();
    }
  }
  _applyLobby(id,name,action){
    const fail=error=>({ok:false,error});
    if(!action||typeof action!=='object'||!['enter','leave','move','sit','stand'].includes(action.type))return fail('Invalid lobby action.');
    let player=this.lobbyPlayers.get(id);
    if(action.type==='enter'){
      if(player)return {ok:true};
      if(this.lobbyPlayers.size>=8)return fail('The lounge is full.');
      const occupied=[...this.lobbyPlayers.values()];
      const clearance=([x,z])=>occupied.reduce((nearest,p)=>Math.min(nearest,Math.hypot(x-p.x,z-p.z)),Infinity);
      const [x,z]=LOBBY_SPAWNS.find(pose=>clearance(pose)>=.75)||LOBBY_SPAWNS.reduce((best,pose)=>clearance(pose)>clearance(best)?pose:best);
      player={id,name:String(name||'Driver').slice(0,24),x,z,heading:Math.PI,tableId:null,pendingTableId:null,lastMove:this.now()};
      this.lobbyPlayers.set(id,player);this.lobbyRevision++;return {ok:true};
    }
    if(action.type==='leave'){if(player){
      this._leaveSeat(id);
      if(this.engine.gameVote?.eligibleIds.includes(id)){this.engine.gameVote=null;this.engine.message='Game-change vote canceled because a voter left the lounge.';this.engine.version++;}
      this.lobbyPlayers.delete(id);this.lobbyRates.delete(id);this.lobbyRevision++;
    }return {ok:true};}
    if(!player)return fail('Enter the lounge first.');
    if(action.type==='stand'){this._leaveSeat(id);player.tableId=null;player.pendingTableId=null;this.lobbyRevision++;return {ok:true};}
    if(action.type==='move'){
      if(player.tableId)return fail('Stand up before walking.');
      const pose=sanitizeLobbyPose(action);if(!pose)return fail('Invalid position.');
      const now=this.now();let rate=this.lobbyRates.get(id);
      if(!rate||now-rate.start>=1000){rate={start:now,count:0};this.lobbyRates.set(id,rate);}
      if(++rate.count>40)return fail('Movement rate exceeded.');
      const allowance=Math.min(1,Math.max(0,(now-player.lastMove)/1000))*7.5+.35;
      if(Math.hypot(pose.x-player.x,pose.z-player.z)>allowance)return fail('Walk to the table first.');
      Object.assign(player,constrainLobbyPosition(pose,player));player.lastMove=now;player.pendingTableId=null;this.lobbyRevision++;return {ok:true};
    }
    const table=CASINO_TABLES.find(table=>table.id===action.tableId&&table.playable);
    if(!table||Math.hypot(player.x-table.x,player.z-table.z)>4.5)return fail('Walk closer to a playable table.');
    if(this.engine.phase==='playing'&&this.engine.game!==table.id)return fail('Finish the current hand before changing tables.');
    const joined=this.engine.apply(id,name,{type:'join'});if(!joined.ok)return joined;
    if(this.engine.game!==table.id){
      const chosen=this.engine.apply(id,name,{type:'choose',game:table.id});if(!chosen.ok)return chosen;
      if(this.engine.game!==table.id){player.pendingTableId=table.id;return {ok:false,pending:true,error:'A game-change vote is open. The table opens when the vote passes.'};}
    }
    player.tableId=table.id;player.pendingTableId=null;this.lobbyRevision++;return {ok:true};
  }
  _applyAction(id,name,action){
    if(action?.type==='join'&&Object.hasOwn(action,'lobby'))return this._applyLobby(id,name,action.lobby);
    const player=this.lobbyPlayers.get(id);
    if(player&&!player.tableId&&!['join','choose','vote'].includes(action?.type))return {ok:false,error:'Sit at a table before playing.'};
    return this.engine.apply(id,name,action);
  }
  dispatch(action){
    const s=this.session;
    if(this._identity()!==this.key){this._sync();return {ok:false,error:'Room changed. Please try again.'};}
    const round=this.lastView?.round??1;
    if(this.authority){const previous=this.engine.version,revision=this.lobbyRevision;const result=this._applyAction(this.meId,s?.name||'You',{...action,round});if(result.ok||this.engine.version!==previous||revision!==this.lobbyRevision)this._publish();return result;}
    const sent=s?.sendCasino?.({kind:'action',requestId:`${Date.now().toString(36)}-${++this.serial}`,action:{...action,round}});
    return {ok:Boolean(sent),error:sent?undefined:'Connect to a multiplayer room first.'};
  }
  receive({id,name,payload}={}){
    if(this._identity()!==this.key)this._sync();
    if(!this.session?.connected||!payload)return;
    if(this.authority){
      if(payload.kind!=='action'||!this.session.peers.has(id)||typeof payload.requestId!=='string'||payload.requestId.length>80)return;
      let seen=this.seen.get(id);if(!seen){seen=new Set();this.seen.set(id,seen);}if(seen.has(payload.requestId))return;
      seen.add(payload.requestId);if(seen.size>128)seen.delete(seen.values().next().value);
      const previous=this.engine.version,revision=this.lobbyRevision;const result=this._applyAction(id,name,payload.action);
      if(result.ok||this.engine.version!==previous||revision!==this.lobbyRevision)this._publish();
      if(!result.ok)this.session.sendCasino?.({kind:'view',state:{...this._privateView(id),message:result.error}},id);
    }else if(id===this.session.worldAuthorityId&&payload.kind==='view'){
      const v=payload.state;if(!v||!Array.isArray(v.players)||v.players.length>8||!Array.isArray(v.dealer)||!Number.isSafeInteger(v.version)||v.version<this.lastVersion||v.meId!==this.meId)return;
      const lobby=v.lobby===undefined?null:sanitizeLobbySnapshot(v.lobby);
      if(v.lobby!==undefined&&(!lobby||lobby.revision<this.lastLobby.revision))return;
      this.lastVersion=v.version;this.lastView=v;if(lobby)this.lastLobby=lobby;this._emit();if(lobby)this._emitLobby();
    }
  }
  destroy(){clearInterval(this.timer);this.listeners.clear();this.lobbyListeners.clear();this.lobbyPlayers.clear();this.lobbyRates.clear();}
}
