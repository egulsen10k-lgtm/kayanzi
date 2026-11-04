import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildTrafficGraph} from '../src/traffic-routes.js';
import {RoadSigns,junctionDirections,turnArrow} from '../src/road-signs.js';
import {TrafficControls} from '../src/traffic-controls.js';
const graph=()=>buildTrafficGraph({roads:[{name:'North Street',width:8,maxspeed:30,points:[[0,-100],[0,100]]},{name:'Market Road',width:8,maxspeed:50,points:[[-100,0],[100,0]]}]});
test('roadside signs use mapped limits, road names, and actual turn directions',()=>{
 const g=graph(),signs=new RoadSigns(new THREE.Group());signs.rebuild(g);
 assert.ok(signs.entries.some(s=>s.type==='speed'&&s.limit===30));assert.ok(signs.entries.some(s=>s.type==='speed'&&s.limit===50));
 const entry=g.edges.find(e=>e.from.p[1]<0&&e.to.p[1]===0),directions=junctionDirections(g,entry);
 assert.ok(directions.some(d=>d.name==='Market Road'&&d.arrow==='←'));assert.ok(directions.some(d=>d.name==='Market Road'&&d.arrow==='→'));
 assert.equal(turnArrow([0,1],[0,1]),'↑');assert.equal(turnArrow([0,1],[1,0]),'→');
 assert.ok(signs.entries.some(s=>s.type==='direction'));const group=signs.group;signs.clear();assert.equal(group.parent,null);
});
test('HUD road lookup respects heading and vertical road level',()=>{
 const g=graph(),signs=new RoadSigns(new THREE.Group());
 const info=signs.nearby(g,{x:1.7,y:-50,heading:0,roadHeight:.08});assert.equal(info.limit,30);assert.equal(info.name,'North Street');
 assert.equal(signs.nearby(g,{x:1.7,y:-50,heading:0,roadHeight:5}),null);
});
test('crossing a red stop line registers once; green is permitted',()=>{
 const g=graph(),edge=g.edges.find(e=>e.from.p[1]<0&&e.to.p[1]===0);
 const controls=new TrafficControls(new THREE.Group());controls.rebuild(g);
 const at=distance=>({x:edge.end[0],y:edge.end[1]+distance,heading:0,roadHeight:.08,speed:30});
 controls.update(1,at(-3));controls.update(1.1,at(-2));assert.equal(controls.tickets,1);assert.match(controls.message,/Red light/);
 controls.update(1.2,at(-1));assert.equal(controls.tickets,1);
 const green=new TrafficControls(new THREE.Group());green.rebuild(g);green.update(23,at(-3));green.update(23.1,at(-2));assert.equal(green.tickets,0);
});
test('direction readout looks through intermediate road vertices to the next junction',()=>{
 const g=buildTrafficGraph({roads:[{name:'Approach',width:8,points:[[0,-100],[0,-30]]},{name:'Approach',width:8,points:[[0,-30],[0,0]]},{name:'Market Road',width:8,points:[[-100,0],[100,0]]}]});
 const signs=new RoadSigns(new THREE.Group()),info=signs.nearby(g,{x:1.7,y:-60,heading:0,roadHeight:.08});
 assert.equal(info.signalEdge.to.p[1],0);assert.ok(info.remaining>35);assert.ok(info.directions.some(d=>d.name==='Market Road'));
});
test('narrow roads retain speed signs and a limit readout without spawning traffic',()=>{
 const roads=[{width:3.5,name:'Narrow Lane',maxspeed:20,points:[[0,-100],[0,100]]}],g=buildTrafficGraph({roads}),signs=new RoadSigns(new THREE.Group());
 signs.rebuild(g,{x:0,y:0},roads);assert.equal(g.edges.length,0);
 assert.ok(signs.entries.some(s=>s.limit===20));assert.equal(signs.nearby(g,{x:0,y:0,heading:0,roadHeight:.08}).limit,20);
});

test('radar entries are generated for limit<=50 signs and not for limit>50',()=>{
 const g=buildTrafficGraph({roads:[
   {name:'Slow St',width:8,maxspeed:30,points:[[0,-100],[0,100]]},
   {name:'Fast Ave',width:8,maxspeed:100,points:[[-100,0],[100,0]]}
 ]});
 const signs=new RoadSigns(new THREE.Group());
 signs.rebuild(g,{x:0,y:0});
 const radars=signs.getRadars();
 assert.ok(Array.isArray(radars),'getRadars returns array');
 assert.ok(radars.length>0,'radar entries exist for slow road');
 assert.ok(radars.every(r=>r.limit<=50),'all radars have limit<=50');
 assert.ok(radars.every(r=>r.type==='radar'),'all entries have type radar');
 // fast road must not produce a radar
 assert.ok(!radars.some(r=>r.limit===100),'no radar for 100 km/h road');
});

test('clear() resets radars alongside entries',()=>{
 const g=buildTrafficGraph({roads:[{name:'X',width:8,maxspeed:30,points:[[0,-50],[0,50]]}]});
 const signs=new RoadSigns(new THREE.Group());
 signs.rebuild(g);
 assert.ok(signs.getRadars().length>0);
 signs.clear();
 assert.equal(signs.getRadars().length,0);
 assert.equal(signs.entries.length,0);
});
