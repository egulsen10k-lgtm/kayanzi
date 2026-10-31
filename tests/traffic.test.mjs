import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrafficManager } from '../src/traffic.js';
import { lanePose, makeTrafficTurn, nextTrafficEdge } from '../src/traffic-routes.js';
import { footprintOnRoad,localToCoordinate } from '../src/road-safety.js';
const network=(roads,buildings=[])=>({center:{lat:0,lng:0},radiusMeters:800,roads,buildings});
const street=(points,extra={})=>({width:8,highway:'residential',points,elevations:points.map(()=>0),...extra});
const player=()=>({lat:-.002,lng:-.002,heading:0,speed:0,roadHeight:.08});
function setup(world,camera=null){const manager=new TrafficManager(new THREE.Group(),{camera});manager.setDensity(.125);manager.reset(world,player());return manager;}
function place(car,edge,s){car.edge=edge;car.turn=null;car.s=s;Object.assign(car,lanePose(edge,s));car.offsetX=car.offsetY=car.yawOffset=0;car.group.position.set(car.x,car.roadHeight,-car.y);}

test('traffic stays on connected lanes without jumps at segment boundaries',()=>{
 const m=setup(network([street([[0,-200],[0,0],[80,100],[200,100]])]));
 const car=m.cars[0];assert.ok(car);let turnSeen=false;
 place(car,m.graph.edges.find(e=>e.from.p[1]<0&&Math.abs(e.to.p[1])<.1),50);
 for(let i=0;i<1500;i++){
  const before={x:car.x,y:car.y};m.update(.05,player());turnSeen ||= !!car.turn;
  assert.ok(Math.hypot(car.x-before.x,car.y-before.y)<1,'vehicle teleported at a route transition');
  assert.ok(footprintOnRoad(m.world,[car.x,car.y],car.heading,car.roadHeight));
 }
 assert.ok(turnSeen,'car never traversed the connected bend');
});

test('a dead-end stops the vehicle instead of reversing or changing lanes',()=>{
 const m=setup(network([street([[0,20],[0,120]])]));const car=m.cars[0];
 const edge=m.graph.edges.find(e=>e.tangent[1]>0);place(car,edge,edge.length-8);car.speed=18;
 const x=car.x;
 for(let i=0;i<200;i++)m.update(.05,player());
 assert.equal(car.edge.id,edge.id);assert.equal(car.turn,null);assert.ok(car.speed<.2);assert.equal(car.x,x);assert.ok(car.s<=edge.length);
});
test('straight road joins preserve cruising speed in a fast zone',()=>{
 const m=setup(network([street([[0,-200],[0,0]],{highway:'primary'}),street([[0,0],[0,200]],{highway:'primary'})]));
 const car=m.cars[0],edge=m.graph.edges.find(e=>e.from.p[1]<0&&e.to.p[1]===0);
 place(car,edge,edge.length);car.turn=makeTrafficTurn(edge,nextTrafficEdge(m.graph,edge));car.s=car.turn.length/2;Object.assign(car,car.turn.pose(car.s));car.speed=80;
 assert.ok(m.targetSpeed(car,m.playerPoint(player()))>20,'straight joins should not force an 18 km/h turn speed');
});

test('district streaming preserves the same car and exact world position',()=>{
 const world=network([street([[0,-200],[0,200]],{id:'main'})]);const m=setup(world);const car=m.cars[0];m.update(.1,player());
 const before={x:car.x,y:car.y,s:car.s,speed:car.speed,heading:car.heading,group:car.group,id:car.id};
 const renderedBefore=car.group.getWorldPosition(new THREE.Vector3());
 const center=localToCoordinate([30,0],world.center);
 m.reset({...world,center,roads:[street([[-30,-200],[-30,200]],{id:'main'})]},player());
 assert.equal(m.cars[0],car);for(const key of Object.keys(before))assert.equal(car[key],before[key]);
 assert.equal(car.group.parent,m.root);assert.equal(car.group.position.x,car.x);
 m.scene.position.set(m.shift[0],0,-m.shift[1]);
 assert.ok(car.group.getWorldPosition(new THREE.Vector3()).distanceTo(renderedBefore)<1e-6,'district rebase moved the rendered car');
});

test('density changes never rebuild or immediately remove visible traffic',()=>{
 const world=network(Array.from({length:8},(_,i)=>street([[i*15-60,-400],[i*15-60,400]])));
 const m=setup(world),car=m.cars[0];m.setDensity(2);assert.equal(m.cars.length,1);assert.equal(m.cars[0],car);
 m.setDensity(0);assert.equal(m.cars[0],car);assert.equal(car.retiring,undefined);
});

test('new traffic enters only far away and outside the expanded camera view',()=>{
 const camera=new THREE.PerspectiveCamera(65,1,.1,1000);camera.position.set(0,4,6);camera.lookAt(0,0,-100);camera.updateMatrixWorld();
 const m=new TrafficManager(new THREE.Group(),{camera});
 const p={lat:0,lng:0,heading:0,speed:0,roadHeight:.08};
 m.reset(network([street([[0,-500],[0,500]]),street([[-400,-300],[400,-300]])]),p);
 assert.ok(m.cars.length);
 m.refreshFrustum();for(const car of m.cars){assert.ok(Math.hypot(car.x,car.y)>=180);assert.ok(m.offscreen(car));}
});

test('traffic queues at red and proceeds when its light becomes green',()=>{
 const m=setup(network([street([[-150,0],[150,0]]),street([[0,-150],[0,150]])]));const car=m.cars[0];
 const edge=m.graph.edges.find(e=>e.tangent[1]>.9&&Math.abs(e.to.p[1])<.1);
 place(car,edge,edge.length-12);car.speed=18;
 assert.ok(m.controls.signals.has(edge.to.id));
 for(let i=0;i<150;i++)m.update(.05,player());
 assert.equal(car.turn,null);assert.equal(car.edge.id,edge.id);assert.ok(car.speed<.5,'car failed to stop at red');
 assert.ok(car.s+car.length/2<edge.length,'front bumper crossed the stop line');
 m.time=22;
 for(let i=0;i<100;i++)m.update(.05,player());
 assert.ok(car.turn||car.edge.id!==edge.id,'car did not proceed on green');
});

test('traffic follows a stopped car without overlapping',()=>{
 const m=setup(network([street([[0,-200],[0,200]])]));m.maxCars=2;m.spawn(m.playerPoint(player()),true);
 assert.equal(m.cars.length,2);const [front,back]=m.cars,edge=m.graph.edges.find(e=>e.tangent[1]>.9);
 place(front,edge,150);front.cruise=0;place(back,edge,130);back.speed=25;
 for(let i=0;i<200;i++)m.update(.05,player());
 assert.ok(front.y-back.y>=6,'traffic drove into the queued car');assert.ok(back.speed<.2);
});

test('a building blocks traffic movement without an unsafe fallback',()=>{
 const world=network([street([[0,20],[0,120]])],[{points:[[-4,90],[4,90],[4,110],[-4,110],[-4,90]]}]);
 const m=setup(world),car=m.cars[0];assert.ok(car);
 const edge=m.graph.edges.find(e=>e.tangent[1]>0);place(car,edge,edge.length*.45);
 for(let i=0;i<250;i++){m.update(.05,player());assert.ok(footprintOnRoad(m.world,[car.x,car.y],car.heading,car.roadHeight));}
 assert.ok(car.y<90);
});

test('police observe speeding and cameras issue one ticket per pass',()=>{
 const m=setup(network([street([[0,-300],[0,300]],{maxspeed:40})]));const car=m.cars[0];car.type='police';
 const p={...localToCoordinate([car.x+8,car.y],m.origin),heading:0,speed:80,roadHeight:.08};
 m.update(.1,p);assert.ok(car.alertUntil>m.time);assert.match(m.status,/Police/);
 const radar=[...m.controls.radars.values()][0];assert.ok(radar);
 const observed={x:radar.x,y:radar.y,speed:80,roadHeight:.08};const before=m.controls.tickets;
 m.controls.update(m.time,observed);m.controls.update(m.time+.1,observed);
 assert.equal(m.controls.tickets,before+1);assert.match(m.status,/Speed camera/);
});

test('all service vehicles have visible models and release resources on clear',()=>{
 const m=new TrafficManager(new THREE.Group());m.setDensity(2);
 m.reset(network(Array.from({length:10},(_,i)=>street([[i*20-100,-400],[i*20-100,400]]))),player());
 const types=new Set(m.cars.map(c=>c.type));for(const type of ['police','firetruck','ambulance','bus','van'])assert.ok(types.has(type));
 const groups=m.cars.map(c=>c.group);m.clear();assert.equal(m.cars.length,0);assert.ok(groups.every(g=>g.parent===null));assert.equal(m.controls.signals.size,0);
});
