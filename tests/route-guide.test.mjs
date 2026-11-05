import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteGuide } from '../src/route-guide.js';

const route={coordinates:[[0,0],[.001,0]],distance:1000,
  stops:[{name:'Start',distance:0},{name:'Finish',distance:1000}],steps:[]};

test('route progress is clamped and tracks distance since the current instruction',()=>{
  const guide=createRouteGuide(route);
  const start=guide.update(0,0,10,1);
  assert.equal(start.progressPercent,0);
  assert.equal(start.distanceSinceLastInstruction,0);
  const finish=guide.update(0,.001,10,1);
  assert.equal(finish.progressPercent,100);
  assert.ok(finish.distanceSinceLastInstruction>=0);
  guide.restart();
  const reset=guide.update(0,0,10,1);
  assert.equal(reset.progressPercent,0);
  assert.equal(reset.distanceSinceLastInstruction,0);
});

test('rerouteNeeded requires five seconds far off route and clears with recovery hysteresis',()=>{
  const guide=createRouteGuide(route);
  for(let i=0;i<5;i++) assert.equal(guide.update(.001,.001,8,1).rerouteNeeded,false);
  assert.equal(guide.update(.001,.001,8,.1).rerouteNeeded,true);
  assert.equal(guide.update(.00054,.00054,8,1).rerouteNeeded,true);
  assert.equal(guide.update(0,0,8,1).rerouteNeeded,false);
});

test('route ETA uses the measured average speed in metres per second',()=>{
  const guide=createRouteGuide(route);
  const info=guide.update(0,0,10,1);
  assert.equal(info.remaining,1000);
  assert.equal(info.etaSeconds,100);
});

test('route ETA falls back to 11 metres per second when stopped',()=>{
  const guide=createRouteGuide(route);
  const info=guide.update(0,0,0,1);
  assert.equal(info.etaSeconds,1000/11);
});

test('off-route guidance exposes a non-negative distance from the route',()=>{
  const guide=createRouteGuide(route);
  const info=guide.update(.01,.01,8,1);
  assert.equal(info.offRoute,true);
  assert.ok(info.offRouteDistance>0);
});

test('elapsed drive time increments until route completion and then stops',()=>{
  const guide=createRouteGuide(route);
  assert.equal(guide.update(0,0,10,2).elapsedSeconds,2);
  assert.equal(guide.update(0,0,10,1).elapsedSeconds,3);
  const finish=guide.update(0,.001,10,1);
  assert.equal(finish.complete,true);
  assert.equal(finish.elapsedSeconds,4);
  assert.equal(guide.update(0,.001,10,5).elapsedSeconds,4);
});

test('stopsVisited counts route stop events once as progress passes them',()=>{
  const guide=createRouteGuide({...route,stops:[
    {name:'Start',distance:0},{name:'Middle',distance:500},{name:'Finish',distance:1000}
  ]});
  assert.equal(guide.update(0,0,10,1).stopsVisited,1);
  assert.equal(guide.update(0,.0006,10,1).stopsVisited,2);
  assert.equal(guide.update(0,.001,10,1).stopsVisited,3);
  assert.equal(guide.stopsVisited,3);
});

// H2 — named stop proximity pings
const METERS=111195;
// Build a route with two named stops that have lat/lng coords.
// Stop A is at the origin (0,0), stop B is ~200 m east along lng axis.
const routeWithCoords={
  coordinates:[[0,0],[.002,0]],
  distance:2000,
  stops:[
    {name:'Alpha',distance:0,lat:0,lng:0},
    {name:'Beta', distance:1000,lat:0,lng:0.0009}  // ~100 m east
  ],
  steps:[]
};

test('stopEvent fires when car is within 80 m of a named stop',()=>{
  const guide=createRouteGuide(routeWithCoords);
  // Drive toward Alpha (already nearby at origin)
  guide.update(0,0,5,1);
  assert.ok(guide.stopEvent,'stopEvent should be set');
  assert.equal(guide.stopEvent.name,'Alpha');
  assert.equal(guide.stopEvent.number,1);
});

test('stopEvent does not fire again for the same stop',()=>{
  const guide=createRouteGuide(routeWithCoords);
  guide.update(0,0,5,1);
  guide.stopEvent=null;  // consume
  guide.update(0,0,5,1);
  assert.equal(guide.stopEvent,null,'should not re-fire for same stop');
});

test('visitedStops size increments as new named stops are entered',()=>{
  const guide=createRouteGuide(routeWithCoords);
  guide.update(0,0,5,1);
  const first=guide.stopEvent;
  guide.stopEvent=null;
  // Move to near Beta (lng ~0.0009 = ~100 m east, within 80 m)
  guide.update(0,0.0009,5,1);
  const second=guide.stopEvent;
  assert.ok(first,'first ping fired');
  assert.ok(second,'second ping fired');
  assert.equal(second.number,2);
  assert.notEqual(first.name,second.name);
});
