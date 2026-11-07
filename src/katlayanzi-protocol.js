const ACTIONS=new Set(['join','choose','vote','bet','deal','hit','stand','fold','draw','next','double','surrender','doublebet','clearbets','rebet','removebet']);
export function sanitizeCasinoPayload(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  try {
    const text=JSON.stringify(raw);if(text.length>16000)return null;
    const payload=JSON.parse(text);
    if(payload.kind==='action'){
      if(typeof payload.requestId!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(payload.requestId)||!payload.action||Array.isArray(payload.action)||!ACTIONS.has(payload.action.type))return null;
      if(payload.action.type==='vote'&&(typeof payload.action.proposalId!=='string'||payload.action.proposalId.length>80||typeof payload.action.approve!=='boolean'))return null;
    }else if(payload.kind==='view'){
      const v=payload.state;if(!v||!Array.isArray(v.players)||v.players.length>8||!Array.isArray(v.dealer)||v.dealer.length>24||!Number.isSafeInteger(v.version)||v.version<0)return null;
    }else return null;
    return payload;
  }catch{return null;}
}
