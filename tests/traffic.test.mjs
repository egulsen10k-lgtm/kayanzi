import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrafficManager } from '../src/traffic.js';
import { footprintOnRoad } from '../src/road-safety.js';

test('TrafficManager initializes, spawns cars on road network, and updates positions', () => {
  const scene = new THREE.Scene();
  const traffic = new TrafficManager(scene);

  const mockNetwork = {
    center: { lat: 48.1764, lng: 11.5583 },
    radiusMeters: 500,
    roads: [
      {
        points: [
          [0, 0],
          [0, 100],
          [50, 100]
        ],
        elevations: [0, 0, 0],
        width: 8
      }
    ]
  };

  const playerCar = {
    lat: 48.1764,
    lng: 11.5583,
    heading: 0,
    speed: 0
  };

  traffic.reset(mockNetwork, playerCar);
  assert.ok(traffic.cars.length > 0, 'Should spawn traffic cars');

  traffic.update(0.1, playerCar);

  const spawned=traffic.cars[0];
  assert.ok([spawned.x,spawned.y,spawned.roadHeight,spawned.heading,spawned.offsetX,spawned.offsetY,spawned.yawOffset,spawned.vx,spawned.vy].every(Number.isFinite), 'traffic state must stay finite after first update');
  assert.ok(Number.isFinite(spawned.group.position.x) && Number.isFinite(spawned.group.position.z), 'traffic transform must stay finite');
  assert.equal(spawned.group.parent, scene, 'traffic cars should use the manager parent for world offsets');
  scene.position.set(17, 0, -23);
  assert.equal(spawned.group.getWorldPosition(new THREE.Vector3()).x, spawned.group.position.x + 17);
  traffic.clear();
  assert.equal(traffic.cars.length, 0, 'Should clear all traffic cars');
});

test('traffic remains road-contained after repeated side-impact updates', () => {
  const traffic = new TrafficManager(new THREE.Scene());
  const network = {
    center: { lat: 48.1764, lng: 11.5583 },
    radiusMeters: 500,
    roads: [{ points: [[0, 0], [0, 120]], elevations: [0, 0], width: 8 }],
    buildings: []
  };
  const player = { lat: 48.1764, lng: 11.5583, heading: 0, speed: 18 };
  traffic.reset(network, player);
  assert.ok(traffic.cars.length > 0);
  const car = traffic.cars[0];
  car.offsetX = 1.5;
  car.vx = 8;
  for (let frame = 0; frame < 30; frame++) {
    traffic.update(1 / 30, player);
    assert.ok(footprintOnRoad(network, [car.x, car.y], car.heading, car.roadHeight), `traffic left road at frame ${frame}`);
    assert.ok(Math.abs(car.offsetX) < 2.1, `impact drift escaped lane at frame ${frame}`);
  }
});

test('traffic impact stays in its lane and settles back promptly',()=>{
 const manager=new TrafficManager(new THREE.Scene());
 const network={center:{lat:0,lng:0},radiusMeters:500,
  roads:[{width:8,points:[[0,0],[0,120]],elevations:[0,0]}],buildings:[]};
 const player={lat:0,lng:0,speed:0,roadHeight:.08};manager.reset(network,player);
 const car=manager.cars[0],laneCenter=car.x;
 car.offsetX=.5;car.vx=10;car.impactTime=0;
 manager.update(.1,player);
 assert.ok(Math.abs(car.x-laneCenter)<=1.2+1e-6,'impact pushed traffic outside its lane');
 car.impactTime=2;car.vx=0;car.vy=0;
 for(let i=0;i<30;i++)manager.update(.1,player);
 assert.ok(Math.abs(car.x-laneCenter)<.1,'traffic failed to return to its lane');
 manager.clear();
});

test('traffic density rebuilds immediately and cars use road-group coordinates',()=>{
 const parent=new THREE.Group(),traffic=new TrafficManager(parent);
 const roads=Array.from({length:20},(_,i)=>({width:8,points:[[20+i*8,20],[20+i*8,100]],elevations:[0,0]}));
 const network={center:{lat:0,lng:0},radiusMeters:500,roads};const player={lat:0,lng:0,speed:0,roadHeight:.08};
 traffic.reset(network,player);assert.equal(traffic.cars.length,8);
 traffic.setDensity(2,player);assert.equal(traffic.cars.length,16);
 const car=traffic.cars[0],before=car.group.position.x;player.lng=.0001;traffic.update(0,player);
 assert.equal(car.group.position.x,before,'moving the player must not move traffic within its road-group parent');
 parent.position.x=-11;
 assert.equal(car.group.getWorldPosition(new THREE.Vector3()).x,before-11);
 assert.equal(car.group.position.y,.08);
 traffic.setDensity(0,player);assert.equal(traffic.cars.length,0);
});

test('traffic stops at the last valid point before a building blocks its route', () => {
  const traffic = new TrafficManager(new THREE.Scene());
  const network = {
    center: { lat: 48.1764, lng: 11.5583 },
    radiusMeters: 500,
    roads: [{ points: [[0, 20], [0, 120]], elevations: [0, 0], width: 8 }],
    buildings: [{ points: [[-4, 90], [4, 90], [4, 110], [-4, 110], [-4, 90]] }]
  };
  const player = { lat: 48.1764, lng: 11.5583, heading: 0, speed: 0 };
  traffic.reset(network, player);
  assert.equal(traffic.cars.length, 1);
  const car = traffic.cars[0];
  car.t = .68;
  traffic.update(0, player);
  const lastValid = { x: car.x, y: car.y, t: car.t };
  car.speed = car.cruise;
  traffic.update(.1, player);
  assert.deepEqual({ x: car.x, y: car.y, t: car.t }, lastValid);
  assert.equal(footprintOnRoad(network, [car.x, car.y], car.heading, car.roadHeight), true);
});

test('traffic skips road segments whose vehicle footprint is inside a mapped building',()=>{
 const traffic=new TrafficManager(new THREE.Scene());
 const network={center:{lat:0,lng:0},radiusMeters:500,roads:[{width:8,points:[[0,20],[0,120]],elevations:[0,0]}],buildings:[{minHeight:0,points:[[-4,45],[4,45],[4,95],[-4,95],[-4,45]]}]};
 traffic.reset(network,{lat:0,lng:0,speed:0,roadHeight:.08});
 assert.equal(traffic.cars.length,0);
});

test('traffic stops at a building encountered after a valid spawn',()=>{
 const traffic=new TrafficManager(new THREE.Scene());
 const network={center:{lat:0,lng:0},radiusMeters:500,
  roads:[{width:8,points:[[0,20],[0,120]],elevations:[0,0]}],
  buildings:[{minHeight:0,points:[[-4,90],[4,90],[4,110],[-4,110],[-4,90]]}]};
 const player={lat:0,lng:0,speed:0,roadHeight:.08};
 traffic.reset(network,player);
 assert.equal(traffic.cars.length,1);
 const car=traffic.cars[0];
 car.cruise=60;
 for(let frame=0;frame<150;frame++) {
  traffic.update(.1,player);
  assert.ok(footprintOnRoad(network,[car.x,car.y],car.heading,car.roadHeight),`traffic entered building at frame ${frame}`);
 }
 assert.ok(car.y<90,'traffic should not cross the building');
 traffic.clear();
});
