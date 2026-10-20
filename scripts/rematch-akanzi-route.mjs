// Offline review candidate only. Never overwrites the shipped route fixture.
// Usage: node scripts/rematch-akanzi-route.mjs [/tmp/akanzi-mapped-route.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWorld, projectCoordinate } from '../src/road-network.js';
import { footprintOnRoad, localToCoordinate } from '../src/road-safety.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async p => JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const original = await read('public/data/akanzi-route.json');
const manifest = await read('public/data/akanzi-world/manifest.json');
if (!manifest.complete) throw new Error('Complete map pack required');
const elements = new Map();
for (const patch of manifest.patches) for (const e of (await read('public/data/akanzi-world/'+patch.file)).elements) {
  const key=e.type+'/'+e.id, old=elements.get(key);
  if(!old || (e.geometry?.length??0)>(old.geometry?.length??0)) elements.set(key,e);
}
const center = {lat:original.coordinates[0][1],lng:original.coordinates[0][0]};
const network = decodeWorld([...elements.values()],center.lat,center.lng,30000);
const vertices=[], byPosition=new Map(), edges=[];
const length=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function vertex(point) {
  const key=point.map(v=>Math.round(v*100)).join(','); // 1cm; never joins nearby carriageways.
  if(!byPosition.has(key)){byPosition.set(key,vertices.length);vertices.push(point);}
  return byPosition.get(key);
}
for(const road of network.roads) {
  const tags=elements.get(road.id.split('/').slice(0,2).join('/'))?.tags??{};
  if(['no','private'].includes(tags.access) || tags.motor_vehicle==='no' || tags.motorcar==='no')continue;
  const direction=tags.oneway==='-1'?-1:['yes','1','true'].includes(tags.oneway)||tags.junction==='roundabout'?1:0;
  for(let i=1;i<road.points.length;i++) {
    const a=vertex(road.points[i-1]),b=vertex(road.points[i]);
    if(a!==b)edges.push({a,b,road,direction,splits:[]});
  }
}
const source=original.coordinates.map(([lng,lat])=>projectCoordinate(lat,lng,center));
const cumulative=[0];for(let i=1;i<source.length;i++)cumulative.push(cumulative.at(-1)+length(source[i-1],source[i]));
function at(distance) {
  let i=1;while(i<cumulative.length-1&&cumulative[i]<distance)i++;
  const f=(distance-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);
  const a=source[i-1],b=source[i];
  return {point:[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],heading:Math.atan2(b[0]-a[0],b[1]-a[1])};
}
const anchors=[];
for(let distance=450;distance<cumulative.at(-1);distance+=450)anchors.push({distance,...at(distance)});
for(const [stopIndex,stop] of original.stops.entries()) {
  const distance=stop.distance/original.distance*cumulative.at(-1);
  anchors.push({distance,...at(distance),point:projectCoordinate(stop.lat,stop.lng,center),stopIndex});
}
anchors.sort((a,b)=>a.distance-b.distance);
function snap(anchor) {
  let best;
  for(const edge of edges) {
    const a=vertices[edge.a],b=vertices[edge.b],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((anchor.point[0]-a[0])*dx+(anchor.point[1]-a[1])*dy)/(dx*dx+dy*dy)));
    const p=[a[0]+dx*t,a[1]+dy*t],distance=length(p,anchor.point);
    if(distance>100)continue;
    const bearing=Math.atan2(dx,dy),delta=Math.cos(bearing-anchor.heading);
    if(edge.direction && delta*edge.direction<0.2)continue;
    const heading=edge.direction===-1?bearing+Math.PI:edge.direction===1?bearing:delta<0?bearing+Math.PI:bearing;
    if(!footprintOnRoad(network,p,heading))continue;
    if(!best||distance<best.distance)best={edge,t,p,distance};
  }
  if(!best)throw new Error(`No safe anchor near ${anchor.distance.toFixed(0)}m`);
  anchor.node=vertex(best.p);anchor.snapDistance=best.distance;
  best.edge.splits.push({node:anchor.node,t:best.t});
}
anchors.forEach(snap);
const adjacency=vertices.map(()=>[]);
for(const edge of edges) {
  const splits=[{node:edge.a,t:0},...edge.splits,{node:edge.b,t:1}].sort((a,b)=>a.t-b.t);
  for(let i=1;i<splits.length;i++) {
    const a=splits[i-1].node,b=splits[i].node;if(a===b)continue;
    const distance=length(vertices[a],vertices[b]);
    if(edge.direction>=0)adjacency[a].push({to:b,distance,road:edge.road});
    if(edge.direction<=0)adjacency[b].push({to:a,distance,road:edge.road});
  }
}
function shortest(start,end) {
  const costs=new Map([[start,0]]),prev=new Map(),queue=[[0,start]];
  function push(item){queue.push(item);let i=queue.length-1;while(i){const p=(i-1)>>1;if(queue[p][0]<=item[0])break;queue[i]=queue[p];i=p;}queue[i]=item;}
  function pop(){const top=queue[0],tail=queue.pop();if(queue.length){let i=0;while(2*i+1<queue.length){let c=2*i+1;if(c+1<queue.length&&queue[c+1][0]<queue[c][0])c++;if(tail[0]<=queue[c][0])break;queue[i]=queue[c];i=c;}queue[i]=tail;}return top;}
  while(queue.length){const [cost,node]=pop();if(cost!==costs.get(node))continue;if(node===end)break;for(const edge of adjacency[node]){const next=cost+edge.distance;if(next<(costs.get(edge.to)??Infinity)){costs.set(edge.to,next);prev.set(edge.to,{from:node,...edge});push([next,edge.to]);}}}
  if(!costs.has(end))return null;
  const result=[];for(let node=end;node!==start;){const edge=prev.get(node);result.push(edge);node=edge.from;}return result.reverse();
}
const segments=[],stops=[];let distance=0,unreachableLeg=null;
if(anchors[0].stopIndex!==0)throw new Error('First anchor must be starting checkpoint');
function recordStop(anchor){if(anchor.stopIndex===undefined)return;const c=localToCoordinate(vertices[anchor.node],center);stops.push({...original.stops[anchor.stopIndex],...c,distance});}
recordStop(anchors[0]);
for(let i=1;i<anchors.length;i++){
  const leg=shortest(anchors[i-1].node,anchors[i].node);
  if(!leg){unreachableLeg={originalStartMeters:anchors[i-1].distance,originalEndMeters:anchors[i].distance,reason:'Disconnected mapped ground-road graph; no synthetic connecting edges added'};break;}
  for(const edge of leg){segments.push(edge);distance+=edge.distance;}
  recordStop(anchors[i]);
}
const routePoints=[vertices[anchors[0].node],...segments.map(e=>vertices[e.to])];
const coordinates=routePoints.map(p=>{const c=localToCoordinate(p,center);return[c.lng,c.lat];});
const steps=[],routeElements=[];let progress=0,previousHeading;
for(const [index,edge] of segments.entries()){
  const a=vertices[edge.from],b=vertices[edge.to],heading=Math.atan2(b[0]-a[0],b[1]-a[1]);
  const change=previousHeading===undefined?0:Math.atan2(Math.sin(heading-previousHeading),Math.cos(heading-previousHeading));
  const name=edge.road.name||'Unnamed road',previous=steps.at(-1);
  if(!previous||previous.name!==name||Math.abs(change)>Math.PI/4){
    steps.push({name,distance:progress,length:edge.distance,maneuver:{location:coordinates[index],type:index?'turn':'depart',modifier:Math.abs(change)>2.6?'uturn':change<-.35?'left':change>.35?'right':'straight',bearing_before:previousHeading===undefined?0:((previousHeading*180/Math.PI)+360)%360,bearing_after:((heading*180/Math.PI)+360)%360}});
  }else previous.length+=edge.distance;
  routeElements.push({type:'way',id:`mapped-route-${index}`,tags:{highway:edge.road.highway,name,width:String(edge.road.width)},geometry:[coordinates[index],coordinates[index+1]].map(([lon,lat])=>({lon,lat}))});
  previousHeading=heading;progress+=edge.distance;
}
const gaps=[];let gap=null,d=0;
for(const edge of segments){const a=vertices[edge.from],b=vertices[edge.to],heading=Math.atan2(b[0]-a[0],b[1]-a[1]),count=Math.max(1,Math.ceil(edge.distance/2));for(let i=0;i<=count;i++){const f=i/count,p=[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],along=d+edge.distance*f;if(!footprintOnRoad(network,p,heading)){gap??={start:along};gap.end=along;}else if(gap){gaps.push(gap);gap=null;}}d+=edge.distance;}if(gap)gaps.push(gap);
const candidate={...original,source:'Offline shortest paths through bundled OpenStreetMap ground-road graph',downloaded:manifest.generated,widthNote:'Widths follow mapped widths or the existing highway-class estimates.',distance,coordinates,stops,steps,elements:routeElements,review:{candidateOnly:true,complete:!unreachableLeg,unreachableLeg,turnRestrictionsApplied:false,anchorSpacingMeters:450,maxAnchorSnapMeters:Math.max(...anchors.map(a=>a.snapDistance)),footprintSampleSpacingMeters:2,footprintGaps:gaps,continuousDrivable:!unreachableLeg&&gaps.length===0}};
const output=process.argv[2]??'/tmp/akanzi-mapped-route.json';
if(path.resolve(output)===path.join(root,'public/data/akanzi-route.json'))throw new Error('Cannot overwrite shipped route');
await fs.writeFile(output,JSON.stringify(candidate));
console.log(JSON.stringify({output,distance,coordinates:coordinates.length,stops:stops.map(s=>({name:s.name,distance:s.distance})),review:candidate.review},null,2));
