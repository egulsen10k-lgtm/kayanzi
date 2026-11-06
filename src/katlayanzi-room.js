import {KatlayanziGame} from './katlayanzi-game.js';
export class CasinoRoom {
  constructor({session}={}) {
    this.session=session;this.listeners=new Set();this.key=null;this.serial=0;this.seen=new Map();this.lastView=null;this.lastVersion=-1;
    this._sync();this.timer=setInterval(()=>this._sync(),1000);
  }
  _identity(){const s=this.session;return s?.connected?`${s.room}:${s.id}:${s.worldAuthorityId}`:'solo';}
  _sync(){
    const key=this._identity();if(key!==this.key){
      this.key=key;this.seen.clear();this.lastVersion=-1;
      const s=this.session;this.meId=s?.connected?s.id:'solo';this.authority=!s?.connected||s.host;
      this.engine=this.authority?new KatlayanziGame({hostId:this.meId}):null;
      this.lastView=null;if(this.engine)this.engine.apply(this.meId,s?.name||'You',{type:'join'});
      if(this.authority)this._publish();else this.dispatch({type:'join'});
    }else if(this.authority){
      let changed=this.engine.advance();
      if(this.session?.connected){
        for(const id of this.seen.keys())if(!this.session.peers.has(id))this.seen.delete(id);
        for(const p of this.engine.players){if(p.id!==this.meId&&!this.session.peers.has(p.id)){this.engine.remove(p.id);changed=true;}}
      }
      if(changed)this._publish();
    }
  }

  _meta(view){return {...view,connected:Boolean(this.session?.connected),roomCode:this.session?.shortCode||this.session?.room||'Solo practice'};}
  _publish(){
    this.lastView=this.engine.view(this.meId);this._emit();
    if(this.session?.connected)for(const id of this.session.peers.keys())this.session.sendCasino?.({kind:'view',state:this.engine.view(id)},id);
  }
  _emit(){for(const listener of this.listeners)listener(this.getView());}
  getView(){return this._meta(this.lastView||{game:'blackjack',phase:'betting',round:1,version:0,players:[],dealer:[],roulette:null,turnId:null,message:'Connecting to the host’s table…',meId:this.meId,isHost:false});}
  subscribe(listener){this.listeners.add(listener);listener(this.getView());return ()=>this.listeners.delete(listener);}
  dispatch(action){
    const s=this.session;
    if(this._identity()!==this.key){this._sync();return;}
    const round=this.lastView?.round??1;
    if(this.authority){const previous=this.engine.version;const result=this.engine.apply(this.meId,s?.name||'You',{...action,round});if(result.ok||this.engine.version!==previous)this._publish();return result;}
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
      const previous=this.engine.version;const result=this.engine.apply(id,name,payload.action);if(result.ok||this.engine.version!==previous)this._publish();
      else this.session.sendCasino?.({kind:'view',state:{...this.engine.view(id),message:result.error}},id);
    }else if(id===this.session.worldAuthorityId&&payload.kind==='view'){
      const v=payload.state;if(!v||!Array.isArray(v.players)||v.players.length>8||!Array.isArray(v.dealer)||!Number.isSafeInteger(v.version)||v.version<this.lastVersion||v.meId!==this.meId)return;
      this.lastVersion=v.version;this.lastView=v;this._emit();
    }
  }
  destroy(){clearInterval(this.timer);this.listeners.clear();}
}
