import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CarPhysics } from '../src/physics.js';
import { decodeWorld, projectCoordinate } from '../src/road-network.js';
import { footprintOnRoad, nearestRoadSpawn, localToCoordinate, sweepRoadMotion, roadSurfaceAt, sweepRoadMotionResult } from '../src/road-safety.js';
import { buildBuildings } from '../src/building-world.js';
const road = () => ({center:{lat:0,lng:0},radiusMeters:500,roads:[{width:8,points:[[0,-400],[0,400]],name:'Test street'}]});
const location = (p,heading=0) => ({...localToCoordinate(p,{lat:0,lng:0}),heading});

test('car is held safely without road data and teleport clears old coverage',()=>{
  const car=new CarPhysics();car.keys.KeyW=true;car.update(.1);
  assert.equal(car.speed,0);assert.equal(car.roadBlocked,true);
  car.setRoadNetwork(road());car.teleport(35,139);assert.equal(car.roadNetwork,null);
});
test('whole car footprint blocks nose and corner excursions, not only its center',()=>{
  const n=road();
  assert.ok(footprintOnRoad(n,[0,0],0));
  assert.equal(footprintOnRoad(n,[2,0],Math.PI/2),false);
  assert.equal(footprintOnRoad(n,[3.2,0],0),false);
});
test('swept path cannot jump across a narrow off-road gap at high speed',()=>{
  const n=road();n.roads=[{width:6,points:[[-20,0],[-5,0]]},{width:6,points:[[5,0],[20,0]]}];
  const result=sweepRoadMotion(n,location([-10,0],Math.PI/2),location([10,0],Math.PI/2));
  assert.ok(result>0&&result<.5);
});
test('road remains drivable when car crosses a spatial index cell boundary',()=>{
  const n=road();
  assert.notEqual(roadSurfaceAt(n,[0,30.1]),null);
  assert.equal(footprintOnRoad(n,[0,30.1],0),true);
});
test('collision bounces back and slows down smoothly; deliberate reversing remains available',()=>{
  const car=new CarPhysics();
  const start=localToCoordinate([0,399], road().center);
  car.setRoadNetwork(road());
  car.teleport(start.lat, start.lng);
  car.setRoadNetwork(road());
  car.heading=0;car.speed=100;car.keys.KeyW=false;car.update(.1);
  assert.equal(car.roadBlocked,true);
  assert.ok(car.impactEvent !== null);
  const impactLat=car.lat;car.keys={KeyS:true};for(let i=0;i<10;i++)car.update(.1);assert.ok(car.lat<impactLat);
});
test('intersection permits a crossing while unloaded coverage edges block movement',()=>{
  const n=road();n.roads.push({width:8,points:[[-400,0],[400,0]]});
  assert.equal(sweepRoadMotion(n,location([-10,0],Math.PI/2),location([10,0],Math.PI/2)),1);
  assert.equal(footprintOnRoad(n,[499,0],Math.PI/2),false);
});
test('bundled Munich is real mapped road geometry with 3D buildings and a valid spawn',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/munich.json',import.meta.url)));
  const world=decodeWorld(data.elements,48.1764,11.5583,450);
  assert.ok(world.roads.length>10);assert.ok(world.buildings.length>5);
  const spawn=nearestRoadSpawn(world,48.1764,11.5583);
  assert.ok(spawn && spawn.distance<150);
  assert.ok(footprintOnRoad(world,projectCoordinate(spawn.lat,spawn.lng,world.center),spawn.heading));
  const geometry=buildBuildings({buildings:[{id:'asymmetric',points:[[10,20],[20,20],[20,40],[10,40],[10,20]],height:12}]}).children[0].geometry;
  geometry.computeBoundingBox();
  assert.equal(geometry.boundingBox.min.x,10);
  assert.equal(geometry.boundingBox.max.x,20);
  assert.equal(geometry.boundingBox.min.z,-40);
  assert.equal(geometry.boundingBox.max.z,-20);
  assert.ok(geometry.boundingBox.max.y>=12);
  assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
});

test('building volumes block road travel even when map geometry overlaps them',()=>{
  const n=road();n.buildings=[{points:[[-10,10],[10,10],[10,20],[-10,20],[-10,10]],height:12}];
  assert.equal(footprintOnRoad(n,[0,15],0),false);
  assert.ok(sweepRoadMotion(n,location([0,0]),location([0,30]))<.4);
});


test('urban sidewalk is climbable with a tighter footprint and raised car height',()=>{
  const n=road();n.roads[0].highway='residential';
  assert.equal(roadSurfaceAt(n,[4.5,0]),.22);
  assert.equal(footprintOnRoad(n,[4.5,0],0,.22),true);
  assert.equal(footprintOnRoad(n,[4.8,0],0,.22),false);
  const climb=sweepRoadMotionResult(n,location([0,0]),location([4.5,0]));
  assert.equal(climb.fraction,1);assert.equal(climb.roadHeight,.22);
  const descend=sweepRoadMotionResult(n,{...location([4.5,0]),roadHeight:.22},location([0,0]));
  assert.equal(descend.fraction,1);assert.equal(descend.roadHeight,.08);
});

test('sidewalk remains outside bridge walls and buildings still block sidewalk travel',()=>{
  for(const tag of ['bridge','tunnel']) {
    const n=road();Object.assign(n.roads[0],{highway:'residential',[tag]:true});
    assert.equal(roadSurfaceAt(n,[4.5,0]),null);
  }
  const n=road();n.roads[0].highway='residential';
  n.buildings=[{points:[[4,10],[6,10],[6,20],[4,20],[4,10]],height:12}];
  assert.equal(footprintOnRoad(n,[4.5,15],0,.22),false);
});

test('crossing asphalt takes precedence over adjacent raised sidewalks',()=>{
  const n=road();n.roads[0].highway='residential';
  n.roads.push({width:8,highway:'residential',points:[[-100,0],[100,0]]});
  assert.equal(roadSurfaceAt(n,[4.5,0],.22),.08);
  assert.equal(sweepRoadMotionResult(n,location([-20,0],Math.PI/2),location([20,0],Math.PI/2)).fraction,1);
});
