import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRoadMeshes,depressedRoadOpening} from '../src/road-mesh.js';
import {createGroundOcclusion,configureGroundOcclusion,selectGroundOpenings,updateGroundOcclusion,MAX_GROUND_OPENINGS} from '../src/satellite-world.js';
import {CarVisualizer3D} from '../src/visualizer.js';

test('terrain apertures follow only depressed approaches and leave deep tunnel roofs covered',()=>{
  assert.equal(depressedRoadOpening([0,0,0],[100,0,5],6),null);
  assert.equal(depressedRoadOpening([0,0,-5],[100,0,-5],6,true),null);
  const ramp=depressedRoadOpening([0,0,0],[100,0,-5],6);
  assert.deepEqual(ramp,[2,0,100,0,3.65]);
  const portal=depressedRoadOpening([0,0,0],[100,0,-5],6,true);
  assert.ok(Math.abs(portal[2]-86)<1e-8);assert.equal(portal[4],3.22);
  assert.equal(depressedRoadOpening([0,0,NaN],[100,0,-5],6),null);
  assert.equal(depressedRoadOpening([0,0,-1],[100,0,-5],Infinity),null);
});

test('terrain aperture selection is bounded, nearest-first and excludes invalid or distant corridors',()=>{
  const cuts=Array.from({length:100},(_,i)=>[i*2,0,i*2+1,0,3]);
  cuts.push([NaN,0,1,0,3],[1,1,2,2,Infinity],[1000,0,1001,0,3]);
  const selected=selectGroundOpenings(cuts,[0,0],Infinity);
  assert.equal(selected.length,MAX_GROUND_OPENINGS);assert.deepEqual(selected[0],cuts[0]);
  assert.deepEqual(selectGroundOpenings(cuts,[Infinity,0]),[]);
  const state=createGroundOcclusion();updateGroundOcclusion(state,cuts,{x:-25,z:30});
  assert.equal(state.count.value,32);assert.deepEqual(state.offset.value.toArray(),[-25,30]);
  assert.ok(state.radii.value.every(Number.isFinite));
});

test('fixed ground is opaque from above and below and shares the road aperture shader',()=>{
  const scene=new THREE.Scene(),view=Object.create(CarVisualizer3D.prototype);view.scene=scene;view.setupEnvironment();
  const ground=view.environmentGroup.getObjectByName('opaque-ground-surface');
  assert.equal(ground.position.y,-.08);assert.equal(ground.material.side,THREE.DoubleSide);assert.equal(ground.material.depthWrite,true);assert.equal(ground.material.transparent,false);
  scene.updateMatrixWorld(true);
  for(const [height,direction]of [[5,-1],[-5,1]])assert.equal(new THREE.Raycaster(new THREE.Vector3(30,height,30),new THREE.Vector3(0,direction,0)).intersectObject(ground).length,1);
  const material=configureGroundOcclusion(new THREE.MeshBasicMaterial(),view.groundOcclusion);
  const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <clipping_planes_fragment>'};material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.terrainCutCount,view.groundOcclusion.count);assert.match(shader.fragmentShader,/discard/);assert.match(shader.vertexShader,/modelMatrix/);
});

test('approaches have terrain-height retaining walls while tunnel enclosure preserves physical elevation',()=>{
  const approach=buildRoadMeshes({roads:[{width:6,points:[[0,0],[0,40]],elevations:[0,-5],highway:'residential'}]});
  assert.equal(approach.userData.groundOpenings.length,1);
  const walls=approach.getObjectByName('retaining-walls');walls.geometry.computeBoundingBox();
  assert.ok(walls.geometry.boundingBox.max.y>=.15-1e-7);assert.ok(walls.geometry.boundingBox.min.y<-5);
  const tunnel=buildRoadMeshes({roads:[{width:6,points:[[0,0],[0,40]],elevations:[-5,-5],tunnel:true,highway:'residential'}]});
  assert.equal(tunnel.userData.groundOpenings.length,0);
  tunnel.updateMatrixWorld(true);const enclosure=tunnel.getObjectByName('structures');
  for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0)])assert.ok(new THREE.Raycaster(new THREE.Vector3(0,-3,-20),direction).intersectObject(enclosure).length>0);
  tunnel.traverse(o=>{if(o.geometry?.attributes.position)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));});
});

test('terrain aperture origin follows geographic road group, never the road height',()=>{
  const view=Object.create(CarVisualizer3D.prototype);view.groundOcclusion=createGroundOcclusion();view.roadGroup=new THREE.Group();
  view.roadGroup.position.set(-50,0,25);view.groundOpenings=[[50,-25,60,-25,3]];view.updateGroundSurfaces(.1);
  assert.equal(view.groundOcclusion.count.value,1);assert.deepEqual(view.groundOcclusion.offset.value.toArray(),[-50,25]);
  view.roadGroup.position.set(-51,0,26);view.updateGroundSurfaces(.1);assert.deepEqual(view.groundOcclusion.offset.value.toArray(),[-51,26]);
});
