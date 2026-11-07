import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectCasinoBuildings,nearbyCasino,buildCasinoExteriors,buildCasinoAccessRoads,prepareCasinoWorld,CASINO_ENTRY_RADIUS} from '../src/casino-locations.js';
import {decodeWorld} from '../src/road-network.js';
import {footprintOnRoad,roadSurfaceAt} from '../src/road-safety.js';
import {disposeWorldGroup} from '../src/building-world.js';
const building=(id,x=0,y=12)=>({id,height:8,minHeight:0,points:[[x,y],[x+12,y],[x+12,y+12],[x,y+12],[x,y]]});
const network=()=>({roads:[{width:6,points:[[-250,0],[250,0]],elevations:[0,0]}],buildings:[building(1),building(2,100),building(3,-100)]});
test('casino entrances use mapped ground footprints near streets and remain deterministic',()=>{
  const n=network(),a=selectCasinoBuildings(n),b=selectCasinoBuildings({...n,buildings:[...n.buildings].reverse()});
  assert.equal(a.length,3);assert.deepEqual(a.map(v=>v.id),b.map(v=>v.id));
  assert.ok(a.every(v=>n.buildings.some(b=>String(b.id)===v.id)&&v.entrance.every(Number.isFinite)));
  const pinned=selectCasinoBuildings(n,[a[2].id]);assert.equal(pinned[0].id,a[2].id);
});
test('only a nearby ground-level casino entrance enables access',()=>{
  const venues=selectCasinoBuildings(network()),v=venues[0];
  assert.equal(nearbyCasino(venues,v.entrance,.08).allowed,true);
  const one=[v];assert.equal(nearbyCasino(one,[v.entrance[0]+CASINO_ENTRY_RADIUS,v.entrance[1]]).allowed,true);
  assert.equal(nearbyCasino(one,[v.entrance[0]+CASINO_ENTRY_RADIUS+1,v.entrance[1]]).allowed,false);
  for(const height of [5,-5,NaN,Infinity])assert.equal(nearbyCasino(one,v.entrance,height).allowed,false);
  assert.equal(nearbyCasino([],v.entrance).allowed,false);assert.equal(nearbyCasino(one,[NaN,0]).allowed,false);
});
test('missing data, malformed footprints and elevated approaches create no casino',()=>{
  for(const n of [null,{}, {buildings:[],roads:[]}, {...network(),buildings:[null,{points:null},building(1,0,200)]}, {...network(),roads:[{width:6,points:[[-250,0],[250,0]],bridge:true}]}])assert.deepEqual(selectCasinoBuildings(n),[]);
  assert.deepEqual(selectCasinoBuildings({...network(),buildings:[{...building(1),minHeight:NaN}]}),[]);
});
test('casino exteriors have named doors, marquee lighting and finite mapped geometry',()=>{
  const venues=selectCasinoBuildings(network());const group=buildCasinoExteriors(venues);
  assert.equal(group.children.filter(c=>c.userData.casinoId).length,venues.length);
  assert.ok(group.getObjectByName('casino-sign'));assert.ok(group.getObjectByName('casino-door'));assert.ok(group.getObjectByName('casino-roof-lights'));
  group.traverse(object=>{if(object.geometry?.attributes.position)assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));});disposeWorldGroup(group);
});
test('starter district offers reachable casino buildings within its loaded streets',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/munich.json',import.meta.url)));
  const world=decodeWorld(data.elements,48.1764,11.5583,450),venues=selectCasinoBuildings(world);
  assert.ok(venues.length>0&&venues.length<=3);assert.ok(Math.hypot(...venues[0].entrance)<150);
  assert.equal(nearbyCasino(venues,[0,0]).allowed,false);assert.ok(venues.every(v=>nearbyCasino(venues,v.roadPoint).allowed));
});


test('casino driveways are short finite ground service roads and preserve their input world',()=>{
  const world={...network(),radiusMeters:450},venues=selectCasinoBuildings(world),before=JSON.stringify(world);
  const access=buildCasinoAccessRoads(world,venues);
  assert.equal(access.length,3);assert.equal(JSON.stringify(world),before);
  assert.deepEqual(access,buildCasinoAccessRoads(world,[...venues,venues[0]]));
  for(const road of access){
    const venue=venues.find(v=>v.id===road.casinoId),end=road.points[1];
    assert.equal(road.id,`casino-access/${venue.id}`);assert.equal(road.highway,'service');assert.equal(road.width,4.5);
    assert.equal(road.bridge,false);assert.equal(road.tunnel,false);assert.deepEqual(road.elevations,[0,0]);
    assert.deepEqual(road.points[0],venue.roadPoint);assert.ok(road.points.flat().every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(end[0]-venue.entrance[0],end[1]-venue.entrance[1])-3)<1e-8);
    assert.ok(Math.hypot(end[0]-road.points[0][0],end[1]-road.points[0][1])<=25);
  }
});

test('driveways reject intervening buildings and raised-road crossings',()=>{
  const world={...network(),radiusMeters:450},venue=selectCasinoBuildings(world).find(v=>v.id==='1');
  const blocker={id:99,height:8,points:[[0,5],[12,5],[12,7],[0,7],[0,5]]};
  assert.deepEqual(buildCasinoAccessRoads({...world,buildings:[...world.buildings,blocker]},[venue]),[]);
  const bridge={id:'bridge',highway:'service',width:4,bridge:true,points:[[-30,6],[30,6]],elevations:[5,5]};
  assert.deepEqual(buildCasinoAccessRoads({...world,roads:[...world.roads,bridge]},[venue]),[]);
  const tunnel={...bridge,bridge:false,tunnel:true,elevations:[-5,-5]};
  assert.deepEqual(buildCasinoAccessRoads({...world,roads:[...world.roads,tunnel]},[venue]),[]);
});

test('driveways require a mapped facade and mapped ground-road connection',()=>{
  const world={...network(),radiusMeters:450},venue=selectCasinoBuildings(world)[0];
  for(const invalid of [{...venue,id:'missing'},{...venue,entrance:[0,0]},{...venue,roadPoint:[0,4]},{...venue,roadPoint:[0,-99]},{...venue,roadPoint:[NaN,0]}])assert.deepEqual(buildCasinoAccessRoads(world,[invalid]),[]);
  assert.deepEqual(buildCasinoAccessRoads({...world,roads:world.roads.map(r=>({...r,bridge:true}))},[venue]),[]);
  assert.deepEqual(buildCasinoAccessRoads({...world,roads:world.roads.map(r=>({...r,elevations:[5,5]}))},[venue]),[]);
  assert.equal(buildCasinoAccessRoads({...world,roads:[...world.roads,...buildCasinoAccessRoads(world,[venue])]},[venue]).length,1);
});

test('malformed driveway-boundary data is skipped safely',()=>{
  const world={...network(),radiusMeters:450},venues=selectCasinoBuildings(world);
  for(const invalid of [null,{}, {...world,radiusMeters:Infinity},{...world,roads:[null]},{...world,roads:[{...world.roads[0],elevations:[0,NaN]}]},{...world,buildings:[null]},{...world,buildings:[{height:8,points:[[0,0],[1,NaN],[0,0],[0,0]]}]}])assert.deepEqual(buildCasinoAccessRoads(invalid,venues),[]);
  assert.deepEqual(buildCasinoAccessRoads(world,[null,{id:'1',entrance:null,roadPoint:[0,0]}]),[]);
  assert.deepEqual(buildCasinoAccessRoads(world,null),[]);
});

test('starter casino driveway is continuously drivable and stops clear of the facade',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/munich.json',import.meta.url)));
  const world=decodeWorld(data.elements,48.1764,11.5583,450),venues=selectCasinoBuildings(world),access=buildCasinoAccessRoads(world,venues);
  assert.ok(access.length>0&&access.length<=3);
  const connected={...world,roads:[...world.roads,...access]};
  for(const road of access){
    const [a,b]=road.points,heading=Math.atan2(b[0]-a[0],b[1]-a[1]);
    for(let i=0;i<=20;i++){
      const p=[a[0]+(b[0]-a[0])*i/20,a[1]+(b[1]-a[1])*i/20];
      assert.equal(footprintOnRoad(connected,p,heading,.08),true);assert.ok(Math.abs(roadSurfaceAt(connected,p,.08)-.08)<1e-8);
    }
    const venue=venues.find(v=>v.id===road.casinoId);
    assert.equal(footprintOnRoad(connected,venue.entrance,heading,.08),false);
    assert.equal(nearbyCasino(venues,b).allowed,true);
  }
});


test('preparing casino streets preserves cached source safety indexes and reuses prepared districts',()=>{
  const source={...network(),radiusMeters:450},venues=selectCasinoBuildings(source);
  const access=buildCasinoAccessRoads(source,venues)[0];
  const a=access.points[0],b=access.points[1],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const heading=Math.atan2(b[0]-a[0],b[1]-a[1]);
  assert.equal(footprintOnRoad(source,mid,heading,.08),false);
  const prepared=prepareCasinoWorld(source);
  assert.notEqual(prepared,source);assert.equal(source.roads.length,1);
  assert.equal(footprintOnRoad(prepared,mid,heading,.08),true);
  assert.equal(footprintOnRoad(source,mid,heading,.08),false);
  assert.equal(prepareCasinoWorld(prepared),prepared);
  assert.deepEqual(selectCasinoBuildings(prepared).map(v=>v.roadPoint),venues.map(v=>v.roadPoint));
});
