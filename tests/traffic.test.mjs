import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrafficManager } from '../src/traffic.js';

test('TrafficManager initializes, spawns cars on road network, and updates positions', () => {
  const scene = new THREE.Scene();
  const traffic = new TrafficManager(scene);

  const mockNetwork = {
    center: { lat: 48.1764, lng: 11.5583 },
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

  assert.ok(traffic.cars[0].group.position, 'Car group should have position');
  traffic.clear();
  assert.equal(traffic.cars.length, 0, 'Should clear all traffic cars');
});

test('traffic density rebuilds immediately and positions remain relative to player',()=>{
 const traffic=new TrafficManager(new THREE.Scene());
 const roads=Array.from({length:20},(_,i)=>({width:8,points:[[20+i*8,20],[20+i*8,100]],elevations:[0,0]}));
 const network={center:{lat:0,lng:0},roads};const player={lat:0,lng:0,speed:0,roadHeight:.08};
 traffic.reset(network,player);assert.equal(traffic.cars.length,8);
 traffic.setDensity(2,player);assert.equal(traffic.cars.length,16);
 const car=traffic.cars[0],before=car.group.position.x;player.lng=.0001;traffic.update(0,player);
 assert.ok(car.group.position.x<before-10);assert.equal(car.group.position.y,.08);
 traffic.setDensity(0,player);assert.equal(traffic.cars.length,0);
});
