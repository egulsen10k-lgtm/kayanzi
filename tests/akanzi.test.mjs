import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRouteGuide } from '../src/route-guide.js';
import { decodeWorld, projectCoordinate } from '../src/road-network.js';
import { footprintOnRoad, nearestRoadSpawn } from '../src/road-safety.js';
const route=JSON.parse(fs.readFileSync(new URL('../public/data/akanzi-route.json',import.meta.url)));

test('Akanzi includes the requested streets and a continuous coastal route to Pendik',()=>{
  assert.equal(route.name,'Akanzi');assert.ok(route.distance>20000 && route.distance<21000);
  assert.ok(route.elements.some(e=>e.tags.name==='Bağdat Caddesi'));
  assert.ok(route.elements.some(e=>e.tags.name==='Çetin Emeç Bulvarı'));
  assert.ok(route.elements.some(e=>e.tags.name==='Turgut Özal Bulvarı'));
  assert.equal(route.stops.at(-1).name,'Pendik Sahil');
  for(let i=1;i<route.elements.length;i++) {
    const end=route.elements[i-1].geometry.at(-1),start=route.elements[i].geometry[0];
    assert.ok(Math.hypot(end.lat-start.lat,end.lon-start.lon)<.00002,'route steps must connect');
  }
});
test('progress follows the route in order, completes at its end, and rejects off-route positions',()=>{
  const guide=createRouteGuide(route);
  const start=route.stops[0];assert.ok(guide.update(start.lat,start.lng).remaining>20000);
  const jumped=guide.update(route.stops.at(-1).lat,route.stops.at(-1).lng);
  assert.equal(jumped.complete,false);assert.equal(jumped.offRoute,true);
  let last;
  for(const [lng,lat] of route.coordinates)last=guide.update(lat,lng);
  assert.ok(last.complete);assert.ok(last.remaining<20);
});
test('route corridor is usable without live map APIs and supports a road-aligned start',()=>{
  const start=route.stops[0],network=decodeWorld(route.elements,start.lat,start.lng,30000);
  const spawn=nearestRoadSpawn(network,start.lat,start.lng);
  assert.ok(spawn&&spawn.distance<5);
  assert.ok(footprintOnRoad(network,projectCoordinate(spawn.lat,spawn.lng,network.center),spawn.heading));
  for(const stop of route.stops)assert.ok(nearestRoadSpawn(network,stop.lat,stop.lng).distance<5);
});

test('map service failure still returns the complete Akanzi driving corridor',async()=>{
  const {setWorldRoute,loadWorld}=await import('../src/world-data.js');
  const fetch=globalThis.fetch;
  try {
    setWorldRoute(route);
    globalThis.fetch=async()=>({ok:false,status:503});
    const finish=route.stops.at(-1);
    const network=await loadWorld({lat:finish.lat,lng:finish.lng});
    assert.equal(network.routeName,'Akanzi');
    assert.ok(network.radiusMeters>route.distance);
    assert.ok(nearestRoadSpawn(network,finish.lat,finish.lng).distance<5);
  } finally {globalThis.fetch=fetch;setWorldRoute(null);}
});
