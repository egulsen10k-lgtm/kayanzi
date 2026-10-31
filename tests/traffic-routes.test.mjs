import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrafficGraph,lanePose,makeTrafficTurn,nextTrafficEdge,trafficSpeedLimit} from '../src/traffic-routes.js';
import {signalPhase} from '../src/traffic-controls.js';
const road=(points,extra={})=>({points,width:8,...extra});
test('crossing streets become a connected junction; bridges remain separate',()=>{
 const streets=[road([[-100,0],[100,0]]),road([[0,-100],[0,100]])];
 const g=buildTrafficGraph({roads:streets});assert.ok([...g.nodes.values()].some(n=>n.neighbors.size===4));
 const bridge=buildTrafficGraph({roads:[streets[0],{...streets[1],elevations:[5,5]}]});assert.ok([...bridge.nodes.values()].every(n=>n.neighbors.size===1));
});
test('one-way lanes preserve direction and dead ends offer no instant U-turn',()=>{
 const g=buildTrafficGraph({roads:[road([[0,0],[0,100]],{oneway:'yes'})]});assert.equal(g.edges.length,1);assert.ok(g.edges[0].tangent[1]>0);
 assert.equal(nextTrafficEdge(g,g.edges[0]),null);
 const reverse=buildTrafficGraph({roads:[road([[0,0],[0,100]],{oneway:'-1'})]});assert.ok(reverse.edges[0].tangent[1]<0);
});
test('junction curves meet both lanes continuously with matching headings',()=>{
 const g=buildTrafficGraph({roads:[road([[0,-100],[0,0]]),road([[0,0],[100,0]])]});
 const a=g.edges.find(e=>e.tangent[1]>.9),b=nextTrafficEdge(g,a),turn=makeTrafficTurn(a,b);
 const start=turn.pose(0),end=turn.pose(turn.length);
 assert.ok(Math.hypot(start.x-a.end[0],start.y-a.end[1])<1e-6);assert.ok(Math.hypot(end.x-b.start[0],end.y-b.start[1])<1e-6);
 assert.ok(Math.abs(start.heading-lanePose(a,a.length).heading)<1e-6);assert.ok(Math.abs(end.heading-lanePose(b,0).heading)<1e-6);
});
test('perpendicular signals never show green together and include amber clearance',()=>{
 let amber=false,allRed=false;
 for(let t=0;t<88;t+=.1){const a=signalPhase(t,0),b=signalPhase(t,1);assert.ok(!(a==='green'&&b==='green'));amber ||= a==='amber';allRed ||= a==='red'&&b==='red';}
 assert.ok(amber&&allRed);
});
test('mapped speed limits support mph',()=>{assert.ok(Math.abs(trafficSpeedLimit({maxspeed:'30 mph'})-48.28)<.1);});
test('higher game zones share consistent arterial limits and retain local posted limits',()=>{
 for(const [highway,limit] of Object.entries({motorway:130,trunk:110,primary:90,secondary:70,motorway_link:80,trunk_link:80}))assert.equal(trafficSpeedLimit({highway,maxspeed:50}),limit);
 assert.equal(trafficSpeedLimit({highway:'residential',maxspeed:30}),30);
 assert.equal(trafficSpeedLimit({highway:'service',maxspeed:20}),20);
 assert.equal(trafficSpeedLimit({highway:'motorway',maxspeed:200}),160);
});
