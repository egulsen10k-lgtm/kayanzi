import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuildings, disposeWorldGroup } from '../src/building-world.js';
import { CarVisualizer3D } from '../src/visualizer.js';

test('building chunks include lit and unlit window materials at an approximately thirty percent ratio',()=>{
  const buildings=Array.from({length:100},(_,i)=>{
    const x=(i%10)*24,y=Math.floor(i/10)*24;
    return {height:9,points:[[x,y],[x+8,y],[x+8,y+8],[x,y+8],[x,y]]};
  });
  let randomIndex=0;
  const group=buildBuildings({buildings},{random:()=>randomIndex++%10<3?.1:.9});
  const stats=group.userData.windowLighting;
  assert.equal(stats.totalWindows,1200);
  assert.equal(stats.litWindows,360);
  assert.ok(stats.litWindows/stats.totalWindows>.25&&stats.litWindows/stats.totalWindows<.35);
  assert.ok(stats.litMaterials[0].emissiveIntensity>.0);
  assert.equal(stats.unlitMaterials[0].emissiveIntensity,0);
  CarVisualizer3D.prototype.setBuildingNightMode.call({roadGroup:group},false);
  assert.equal(stats.litMaterials[0].emissiveIntensity,0);
  CarVisualizer3D.prototype.setBuildingNightMode.call({roadGroup:group},true);
  assert.equal(stats.litMaterials[0].emissiveIntensity,.9);
  disposeWorldGroup(group);
});
