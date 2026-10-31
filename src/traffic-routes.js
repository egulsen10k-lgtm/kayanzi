// Directed lanes built from mapped streets. Junctions connect only at the same height.
const distance=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const key=(p,h)=>`${Math.round(p[0]*2)},${Math.round(p[1]*2)},${Math.round(h*2)}`;
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
export function trafficSpeedLimit(road) {
  const raw=String(road.maxspeed??road.speedLimit??'');
  const value=parseFloat(raw);
  const posted=Number.isFinite(value)?value*(raw.toLowerCase().includes('mph')?1.609344:1):null;
  // Game zones: higher-speed arterial routes, with posted local limits retained.
  const fastZones={motorway:130,motorway_link:80,trunk:110,trunk_link:80,primary:90,primary_link:70,secondary:70,secondary_link:60};
  const defaults={tertiary:60,tertiary_link:50,unclassified:60,residential:50,living_street:20,service:30,track:30};
  const zone=fastZones[road.highway];
  return Math.max(15,Math.min(160,zone?Math.max(zone,posted??0):posted??defaults[road.highway]??50));
}
function simplified(road) {
  const points=road.points, result=[];
  for(let i=0;i<points.length;i++) {
    const h=road.elevations?.[i]??0;
    if(i>0&&i<points.length-1) {
      const a=result.at(-1),b=points[i],c=points[i+1],ab=[b[0]-a.p[0],b[1]-a.p[1]],bc=[c[0]-b[0],c[1]-b[1]];
      const la=Math.hypot(...ab),lb=Math.hypot(...bc);
      if(la&&lb&&Math.abs(cross(ab,bc))/(la*lb)<.008&&ab[0]*bc[0]+ab[1]*bc[1]>0&&Math.abs((h-a.h)/la-((road.elevations?.[i+1]??0)-h)/lb)<.015)continue;
    }
    result.push({p:points[i],h});
  }
  return result;
}
export function buildTrafficGraph(network) {
  const segments=[],cells=new Map();
  for(const road of network.roads??[]) {
    if(!Number.isFinite(road.width)||road.width<6)continue;
    const points=simplified(road);
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],length=distance(a.p,b.p);if(length<1)continue;
      const s={a:a.p,b:b.p,ha:a.h,hb:b.h,road,length,cuts:[0,1],index:segments.length};segments.push(s);
      for(let x=Math.floor(Math.min(a.p[0],b.p[0])/60);x<=Math.floor(Math.max(a.p[0],b.p[0])/60);x++)
        for(let y=Math.floor(Math.min(a.p[1],b.p[1])/60);y<=Math.floor(Math.max(a.p[1],b.p[1])/60);y++) {
          const k=`${x},${y}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(s);
        }
    }
  }
  const seen=new Set();
  for(const list of cells.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++) {
    const a=list[i],b=list[j],pair=`${Math.min(a.index,b.index)}:${Math.max(a.index,b.index)}`;if(seen.has(pair))continue;seen.add(pair);
    const av=[a.b[0]-a.a[0],a.b[1]-a.a[1]],bv=[b.b[0]-b.a[0],b.b[1]-b.a[1]],delta=[b.a[0]-a.a[0],b.a[1]-a.a[1]],den=cross(av,bv);
    const add=(t,u)=>{if(t>=-1e-5&&t<=1.00001&&u>=-1e-5&&u<=1.00001&&Math.abs(a.ha+(a.hb-a.ha)*t-b.ha-(b.hb-b.ha)*u)<.5){a.cuts.push(Math.max(0,Math.min(1,t)));b.cuts.push(Math.max(0,Math.min(1,u)));}};
    if(Math.abs(den)>.0001)add(cross(delta,bv)/den,cross(delta,av)/den);
    else if(Math.abs(cross(delta,av))/a.length<.25) {
      for(const t of [0,1]){const p=[a.a[0]+av[0]*t,a.a[1]+av[1]*t];add(t,((p[0]-b.a[0])*bv[0]+(p[1]-b.a[1])*bv[1])/(b.length*b.length));}
      for(const u of [0,1]){const p=[b.a[0]+bv[0]*u,b.a[1]+bv[1]*u];add(((p[0]-a.a[0])*av[0]+(p[1]-a.a[1])*av[1])/(a.length*a.length),u);}
    }
  }
  const nodes=new Map(),edges=[],edgeKeys=new Set();
  const node=(p,h)=>{const id=key(p,h);if(!nodes.has(id))nodes.set(id,{id,p,h,out:[],incoming:[],neighbors:new Set()});return nodes.get(id);};
  for(const s of segments) {
    const cuts=[...new Set(s.cuts.map(t=>Math.round(t*1e6)/1e6))].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++) {
      const at=t=>node([s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t],s.ha+(s.hb-s.ha)*t);
      const a=at(cuts[i-1]),b=at(cuts[i]);if(distance(a.p,b.p)<1)continue;
      const one=String(s.road.oneway??'no');
      for(const [from,to] of (one==='-1'?[[b,a]]:/^(yes|1|true)$/.test(one)?[[a,b]]:[[a,b],[b,a]])) {
        const id=`${from.id}>${to.id}`;if(edgeKeys.has(id))continue;edgeKeys.add(id);
        const length=distance(from.p,to.p),tangent=[(to.p[0]-from.p[0])/length,(to.p[1]-from.p[1])/length],normal=[tangent[1],-tangent[0]],lane=Math.min(s.road.width/4,1.7),trim=Math.min(5,length*.2);
        const edge={id,from,to,road:s.road,tangent,normal,lane,trim,length:length-2*trim,limit:trafficSpeedLimit(s.road)};
        edge.start=[from.p[0]+tangent[0]*trim+normal[0]*lane,from.p[1]+tangent[1]*trim+normal[1]*lane];
        edge.end=[to.p[0]-tangent[0]*trim+normal[0]*lane,to.p[1]-tangent[1]*trim+normal[1]*lane];
        edge.ha=from.h+(to.h-from.h)*trim/length+.08;edge.hb=to.h-(to.h-from.h)*trim/length+.08;
        edges.push(edge);from.out.push(edge);to.incoming.push(edge);from.neighbors.add(to.id);to.neighbors.add(from.id);
      }
    }
  }
  return {nodes,edges};
}
export function lanePose(edge,s) {
  const t=Math.max(0,Math.min(1,s/edge.length));
  return {x:edge.start[0]+(edge.end[0]-edge.start[0])*t,y:edge.start[1]+(edge.end[1]-edge.start[1])*t,roadHeight:edge.ha+(edge.hb-edge.ha)*t,heading:Math.atan2(...edge.tangent)};
}
export function nextTrafficEdge(graph,edge,choice=0) {
  const node=graph.nodes.get(edge.to.id)??edge.to;
  const candidates=node.out.filter(next=>next.to.id!==edge.from.id && Math.abs(next.ha-edge.hb)<.6);
  candidates.sort((a,b)=>(b.tangent[0]*edge.tangent[0]+b.tangent[1]*edge.tangent[1])-(a.tangent[0]*edge.tangent[0]+a.tangent[1]*edge.tangent[1])||a.id.localeCompare(b.id));
  return candidates.length?candidates[choice%5===4&&candidates.length>1?1:0]:null;
}
export function makeTrafficTurn(edge,next) {
  const a=edge.end,b=next.start,d=distance(a,b),handle=Math.max(.2,d*.5);
  const c=[a[0]+edge.tangent[0]*handle,a[1]+edge.tangent[1]*handle],e=[b[0]-next.tangent[0]*handle,b[1]-next.tangent[1]*handle];
  const point=t=>{const u=1-t;return [u*u*u*a[0]+3*u*u*t*c[0]+3*u*t*t*e[0]+t*t*t*b[0],u*u*u*a[1]+3*u*u*t*c[1]+3*u*t*t*e[1]+t*t*t*b[1]];};
  const samples=[{s:0,t:0}],count=24;let previous=a,length=0;
  for(let i=1;i<=count;i++){const p=point(i/count);length+=distance(previous,p);samples.push({s:length,t:i/count});previous=p;}
  return {length,next,pose(s){const entry=samples.findIndex(v=>v.s>=s),i=Math.max(1,entry<0?samples.length-1:entry),lo=samples[i-1],hi=samples[i],t=lo.t+(hi.t-lo.t)*Math.max(0,Math.min(1,(s-lo.s)/Math.max(.0001,hi.s-lo.s))),p=point(t),u=1-t;
    const dx=3*u*u*(c[0]-a[0])+6*u*t*(e[0]-c[0])+3*t*t*(b[0]-e[0]),dy=3*u*u*(c[1]-a[1])+6*u*t*(e[1]-c[1])+3*t*t*(b[1]-e[1]);
    return {x:p[0],y:p[1],heading:Math.atan2(dx,dy),roadHeight:edge.hb+(next.ha-edge.hb)*t};}};
}
