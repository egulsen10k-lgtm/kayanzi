import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { vehicleContact, resolveTrafficContact, integrateTrafficImpact } from '../src/traffic-collision.js';
import { TrafficManager } from '../src/traffic.js';
import { localToCoordinate } from '../src/road-safety.js';
const traffic=()=>({x:0,y:0,heading:0,speed:0,roadHeight:.08});
test('side impact transfers momentum toward the push and displacement persists',()=>{
 const car=traffic(),player={x:-2,y:0,heading:Math.PI/2,speed:36,roadHeight:.08};
 assert.ok(resolveTrafficContact(player,car));assert.ok(car.vx>0);assert.ok(Math.abs(car.vy)<.001);
 assert.ok(player.speed>0&&player.speed<36);assert.equal(vehicleContact(player,car),null);
 const x=car.offsetX;integrateTrafficImpact(car,.1,5);assert.ok(car.offsetX>x);
 const remaining=car.offsetX;for(let i=0;i<200;i++)integrateTrafficImpact(car,.02,5);
 assert.ok(car.offsetX>=remaining);assert.ok(Math.abs(car.vx)<.02);
});
test('reversing away is never cancelled even during initial overlap',()=>{
 const car=traffic(),player={x:0,y:-3,heading:0,speed:-9,roadHeight:.08};
 resolveTrafficContact(player,car);assert.equal(player.speed,-9);
});
test('off-centre impacts produce angular motion; separate road levels do not collide',()=>{
 const car=traffic(),player={x:-2,y:1.5,heading:Math.PI/2,speed:50,roadHeight:.08};
 resolveTrafficContact(player,car);assert.ok(Math.abs(car.angularVelocity)>.1);
 const bridge=traffic();bridge.roadHeight=5;assert.equal(resolveTrafficContact(player,bridge),false);
});
test('oriented bodies permit passing beside a car without proximity locks',()=>{
 const car=traffic(),player={x:2,y:0,heading:0,speed:30,roadHeight:.08};
 assert.equal(vehicleContact(player,car),null);assert.equal(resolveTrafficContact(player,car),false);assert.equal(player.speed,30);
});
test('traffic route update preserves pushed position and player can back out',()=>{
 const manager=new TrafficManager(new THREE.Scene()),center={lat:0,lng:0};
 const network={center,roads:[{width:10,points:[[0,20],[0,120]],elevations:[0,0]}]};
 const player={lat:0,lng:0,heading:Math.PI/2,speed:36,roadHeight:.08};manager.reset(network,player);
 const car=manager.cars[0],before=car.x;
 Object.assign(player,localToCoordinate([car.x-2,car.y],center));manager.update(.016,player);
 assert.ok(car.x>before);const pushed=car.x;
 player.speed=-5;manager.update(.016,player);assert.ok(player.speed<0);assert.ok(car.x>=pushed);
 manager.clear();
});
