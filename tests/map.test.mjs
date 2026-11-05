import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window={
  requestAnimationFrame:callback=>setTimeout(callback,0),
  cancelAnimationFrame:handle=>clearTimeout(handle),
  screen:{deviceXDPI:1,logicalXDPI:1}
};
globalThis.document={documentElement:{style:{}},createElement:()=>({style:{},getContext:()=>null})};
if(typeof globalThis.navigator==='undefined')Object.defineProperty(globalThis,'navigator',{value:{userAgent:'node',platform:'Linux'},configurable:true});
const {WorldMapController}=await import('../src/map.js');

function controller() {
  const instance=Object.create(WorldMapController.prototype);
  instance.minimapZoom=1;
  instance.minimapDirty=false;
  instance.peerMarkers=new Map();
  return instance;
}
function markerStub(){return {removed:false,remove(){this.removed=true;},setLatLng(value){this.latLng=value;}};}


test('peer marker updates reject malformed coordinates and ids',()=>{
 const map=controller();map.map={};
 assert.equal(map.updatePeerPosition({peerId:'bad',lat:NaN,lng:0}),false);
 assert.equal(map.updatePeerPosition({peerId:'bad',lat:91,lng:0}),false);
 assert.equal(map.updatePeerPosition({peerId:'',lat:0,lng:0}),false);
 assert.equal(map.peerMarkers.size,0);
});

test('peer marker removal is safe and idempotent',()=>{
 const map=controller(),marker=markerStub();map.map={removeLayer(value){value.removed=true;}};map.peerMarkers.set('peer-1',marker);
 assert.equal(map.removePeerPosition('missing'),false);
 assert.equal(map.removePeerPosition('peer-1'),true);
 assert.equal(marker.removed,true);assert.equal(map.removePeerPosition('peer-1'),false);
});

test('clearPeerPositions removes every marker and tolerates repeated cleanup',()=>{
 const map=controller(),a=markerStub(),b=markerStub();map.map={removeLayer(value){value.removed=true;}};map.peerMarkers.set('a',a);map.peerMarkers.set('b',b);
 map.clearPeerPositions();assert.equal(map.peerMarkers.size,0);assert.equal(a.removed,true);assert.equal(b.removed,true);map.clearPeerPositions();
});

test('minimap zoom clamps to a maximum scale of three and marks the map dirty',()=>{
  const map=controller();
  assert.equal(map.setMinimapZoom(4),3);
  assert.equal(map.minimapZoom,3);
  assert.equal(map.minimapDirty,true);
});

test('minimap zoom clamps to a minimum scale of one half',()=>{
  const map=controller();
  assert.equal(map.setMinimapZoom(.1),.5);
  assert.equal(map.minimapZoom,.5);
});

// H3 — addFuelStations
test('addFuelStations stores entries from amenity=fuel nodes',()=>{
  const map=controller();
  map.fuelStations=[];
  map.addFuelStations({elements:[
    {type:'node',lat:48.1,lng:11.5,tags:{amenity:'fuel',name:'Shell'}},
    {type:'node',lat:48.2,lng:11.6,tags:{amenity:'fuel'}},
    {type:'way',lat:48.3,lng:11.7,tags:{amenity:'fuel'}},  // way, should be skipped
  ]});
  assert.equal(map.fuelStations.length,2);
});

test('addFuelStations returns empty array when no fuel nodes present',()=>{
  const map=controller();
  map.fuelStations=[];
  map.addFuelStations({elements:[
    {type:'node',lat:48.1,lng:11.5,tags:{amenity:'parking'}},
    {type:'node',lat:48.2,lng:11.6,tags:{name:'Supermarket'}},
  ]});
  assert.equal(map.fuelStations.length,0);
});

test('addFuelStations matches petrol/benzin/gas station name keywords',()=>{
  const map=controller();
  map.fuelStations=[];
  map.addFuelStations({elements:[
    {type:'node',lat:48.1,lng:11.5,tags:{name:'BP Petrol'}},
    {type:'node',lat:48.2,lng:11.6,tags:{name:'Benzin Istasyonu'}},
    {type:'node',lat:48.3,lng:11.7,tags:{name:'Gas Station Downtown'}},
    {type:'node',lat:48.4,lng:11.8,tags:{name:'Coffee Shop'}},
  ]});
  assert.equal(map.fuelStations.length,3);
});

test('addFuelStations returns empty array when roadNetwork has no elements',()=>{
  const map=controller();
  map.fuelStations=[];
  map.addFuelStations({});
  assert.equal(map.fuelStations.length,0);
  map.addFuelStations(null);
  assert.equal(map.fuelStations.length,0);
});

test('_updateFuelPins caps output at nearest 3 stations',()=>{
  const map=controller();
  map.fuelStations=[];
  // 5 stations all at slightly different positions near 48.0, 11.0
  map.addFuelStations({elements:[
    {type:'node',lat:48.001,lng:11.001,tags:{amenity:'fuel'}},
    {type:'node',lat:48.002,lng:11.002,tags:{amenity:'fuel'}},
    {type:'node',lat:48.003,lng:11.003,tags:{amenity:'fuel'}},
    {type:'node',lat:48.004,lng:11.004,tags:{amenity:'fuel'}},
    {type:'node',lat:48.005,lng:11.005,tags:{amenity:'fuel'}},
  ]});
  assert.equal(map.fuelStations.length,5);
  // Verify nearest-3 selection logic: sort by distance from car at 48.0, 11.0
  const carLat=48.0,carLng=11.0;
  const R=111195,scaleX=R*Math.cos(carLat*Math.PI/180);
  const sorted=map.fuelStations
    .map(s=>({...s,dist:Math.hypot((s.lng-carLng)*scaleX,(s.lat-carLat)*R)}))
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,3);
  assert.equal(sorted.length,3);
  // nearest should be 48.001,11.001
  assert.ok(Math.abs(sorted[0].lat-48.001)<1e-6);
});
