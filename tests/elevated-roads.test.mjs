import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWorld } from '../src/road-network.js';
import { roadSurfaceAt, sweepRoadMotionResult, localToCoordinate, footprintOnRoad } from '../src/road-safety.js';
import { buildRoadMeshes } from '../src/road-mesh.js';
const center={lat:0,lng:0};
const pose=(point,heading,roadHeight=.08)=>({...localToCoordinate(point,center),heading,roadHeight});
test('bridge and crossing street stay separate in collision and rendered elevation',()=>{
  const network={center,radiusMeters:500,roads:[
    {width:8,highway:'primary',bridge:true,points:[[-100,0],[100,0]],elevations:[5,5]},
    {width:8,highway:'residential',points:[[0,-100],[0,100]],elevations:[0,0]}
  ]};
  assert.equal(roadSurfaceAt(network,[0,0],.08),.08);
  assert.equal(roadSurfaceAt(network,[0,0],5.08),5.08);
  assert.equal(sweepRoadMotionResult(network,pose([0,-20],0),pose([0,20],0)).fraction,1);
  assert.equal(sweepRoadMotionResult(network,pose([-20,0],Math.PI/2,5.08),pose([20,0],Math.PI/2,5.08)).roadHeight,5.08);
  assert.ok(sweepRoadMotionResult(network,pose([0,0],Math.PI/2),pose([20,0],Math.PI/2)).fraction<1);
  const meshes=buildRoadMeshes(network);const mesh=meshes.getObjectByName('asphalt');mesh.geometry.computeBoundingBox();
  assert.ok(mesh.geometry.boundingBox.max.y>5);
});
test('shared bridge approach climbs continuously without joining unrelated crossings',()=>{
  const way=(id,tags,coordinates)=>({type:'way',id,tags:{highway:'primary',width:'10',...tags},geometry:coordinates.map(([lon,lat])=>({lat,lon}))});
  const network=decodeWorld([
    way(1,{},[[-.002,0],[0,0]]), way(2,{bridge:'yes'},[[0,0],[.001,0]]),
    way(3,{},[[-.0005,-.001],[-.0005,.001]])
  ],0,0,500);
  const ramp=network.roads[0];assert.equal(ramp.elevations[0],0);assert.equal(ramp.elevations.at(-1),5);
  for(let i=1;i<ramp.points.length;i++) assert.ok(Math.abs(ramp.elevations[i]-ramp.elevations[i-1])<=Math.hypot(ramp.points[i][0]-ramp.points[i-1][0],ramp.points[i][1]-ramp.points[i-1][1])*.081);
  assert.ok(network.roads[2].elevations.every(h=>h===0));
  const motion=sweepRoadMotionResult(network,pose([-150,0],Math.PI/2),pose([70,0],Math.PI/2));
  assert.equal(motion.fraction,1);assert.equal(motion.roadHeight,5.08);
});
test('underground buildings do not obstruct surface roads; raised buildings preserve clearance',()=>{
  const polygon=[{lat:-.0001,lon:-.0001},{lat:.0001,lon:-.0001},{lat:.0001,lon:.0001},{lat:-.0001,lon:.0001},{lat:-.0001,lon:-.0001}];
  const n=decodeWorld([{type:'way',id:922269167,tags:{building:'train_station',location:'underground',layer:'-1'},geometry:polygon}],0,0,300);
  assert.equal(n.buildings.length,0);
  const network={center,radiusMeters:500,roads:[{width:8,points:[[0,-100],[0,100]]}],buildings:[{points:[[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]],minHeight:4,height:15}]};
  assert.ok(footprintOnRoad(network,[0,0],0,.08));
  assert.equal(footprintOnRoad({...network,roads:[{width:8,points:[[0,-100],[0,100]],elevations:[5,5]}]},[0,0],0,5.08),false);
});
test('coastline orientation is retained without filling land as water',()=>{
  const n=decodeWorld([{type:'way',id:8,tags:{natural:'coastline'},geometry:[{lat:0,lon:0},{lat:.001,lon:0}]}],0,0,300);
  assert.equal(n.coastlines.length,1);assert.ok(n.coastlines[0].points[1][1]>n.coastlines[0].points[0][1]);assert.equal(n.sceneryAreas.length,0);
});
test('tunnel approaches descend continuously and remain below crossing ground traffic',()=>{
  const way=(id,tags,coordinates)=>({type:'way',id,tags:{highway:'primary',width:'10',...tags},geometry:coordinates.map(([lon,lat])=>({lat,lon}))});
  const network=decodeWorld([way(1,{},[[-.002,0],[0,0]]),way(2,{tunnel:'yes'},[[0,0],[.001,0]])],0,0,500);
  const result=sweepRoadMotionResult(network,pose([-150,0],Math.PI/2),pose([70,0],Math.PI/2));
  assert.equal(result.fraction,1);assert.equal(result.roadHeight,-4.92);
  const meshes=buildRoadMeshes(network), structure=meshes.getObjectByName('structures');structure.geometry.computeBoundingBox();
  assert.ok(structure.geometry.boundingBox.max.y<0);assert.ok(structure.geometry.boundingBox.min.y<-5);
});
