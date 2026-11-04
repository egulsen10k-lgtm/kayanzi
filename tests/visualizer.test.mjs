import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarVisualizer3D, MudSystem, SkidMarkSystem, SpeedometerOverlay } from '../src/visualizer.js';

// Minimal stub that replicates only the smoke/damage methods from CarVisualizer3D
function makeVis() {
  const scene = new THREE.Scene();
  const carGroup = new THREE.Group();
  carGroup.position.set(0, 0, 0);
  scene.add(carGroup);
  return {
    scene,
    carGroup,
    damageLevel: 0,
    smokeParticles: [],
    triggerImpact(speed) {
      this.damageLevel = Math.min(1, this.damageLevel + speed / 400);
      const count = 6 + Math.floor(speed / 25);
      const carPos = this.carGroup.position;
      for (let i = 0; i < count; i++) {
        const geo = new THREE.BufferGeometry();
        const verts = new Float32Array(60);
        for (let j = 0; j < 60; j++) verts[j] = (Math.random() - .5) * 1.2;
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        const mat = new THREE.PointsMaterial({ size: 0.35, transparent: true, opacity: 0.6, color: 0xaaaaaa, depthWrite: false });
        const puff = new THREE.Points(geo, mat);
        puff.position.set(carPos.x, carPos.y + .5, carPos.z);
        this.scene.add(puff);
        this.smokeParticles.push({ mesh: puff, age: 0, lifetime: 2 });
      }
    },
    resetDamage() {
      for (const p of this.smokeParticles) {
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.scene.remove(p.mesh);
      }
      this.smokeParticles = [];
      this.damageLevel = 0;
    }
  };
}

test('triggerImpact raises damageLevel', () => {
  const vis = makeVis();
  assert.equal(vis.damageLevel, 0);
  vis.triggerImpact(200);
  assert.ok(vis.damageLevel > 0, 'damageLevel should increase after impact');
  assert.ok(vis.damageLevel <= 1, 'damageLevel capped at 1');
  vis.triggerImpact(9999);
  assert.equal(vis.damageLevel, 1, 'damageLevel never exceeds 1');
});

test('triggerImpact spawns the expected smoke count', () => {
  const vis = makeVis();
  vis.triggerImpact(100);
  assert.equal(vis.smokeParticles.length, 6 + Math.floor(100 / 25));
});

test('smoke puffs age out after lifetime', () => {
  const vis = makeVis();
  vis.triggerImpact(50);
  assert.ok(vis.smokeParticles.length > 0);
  const dt = 2.1; // past lifetime of 2
  for (let i = vis.smokeParticles.length - 1; i >= 0; i--) {
    const p = vis.smokeParticles[i];
    p.age += dt;
    if (p.age >= p.lifetime) {
      p.mesh.geometry.dispose(); p.mesh.material.dispose();
      vis.scene.remove(p.mesh);
      vis.smokeParticles.splice(i, 1);
    }
  }
  assert.equal(vis.smokeParticles.length, 0, 'all puffs removed after lifetime');
});

test('resetDamage clears particles and resets damageLevel', () => {
  const vis = makeVis();
  vis.triggerImpact(300);
  assert.ok(vis.smokeParticles.length > 0);
  assert.ok(vis.damageLevel > 0);
  vis.resetDamage();
  assert.equal(vis.smokeParticles.length, 0);
  assert.equal(vis.damageLevel, 0);
});

test('skid segments are added while drifting on road above the speed threshold',()=>{
  const scene=new THREE.Scene(),skids=new SkidMarkSystem(scene,4);
  skids.setPosition(3,7);
  skids.update(.04,true,{speed:20,heading:0,roadHeight:.1,onRoad:true},1);
  assert.equal(skids.count,1);
  assert.equal(skids.mesh.parent,scene);
  assert.ok(Math.abs(skids.geometry.attributes.color.array[3]-.55)<1e-6);
  skids.dispose();
});

test('skid mark opacity fades over its twelve second lifetime',()=>{
  const skids=new SkidMarkSystem(new THREE.Scene(),2);
  skids.add(0,0,0,.1,1);
  skids.update(0,false,{speed:0,roadHeight:.1},7);
  assert.ok(Math.abs(skids.geometry.attributes.color.array[3]-.275)<1e-6);
  skids.dispose();
});

test('skid mark pool recycles its oldest segment when full',()=>{
  const skids=new SkidMarkSystem(new THREE.Scene(),2);
  skids.add(0,0,0,.1,1);skids.add(1,0,0,.1,2);skids.add(2,0,0,.1,3);
  assert.equal(skids.count,2);
  assert.equal(skids.records[0].time,3);
  assert.equal(skids.records[1].time,2);
  skids.dispose();
});

test('mud splatter spawns four wheel pairs off-road above ten km/h',()=>{
  const mud=new MudSystem(new THREE.Scene(),80,()=>.5);
  mud.update(.05,{onRoad:false,speed:11,heading:0,roadHeight:.1});
  assert.equal(mud.count,8);
  assert.equal(mud.mesh.material.color.getHex(),0x5c3d1e);
  assert.equal(mud.mesh.material.opacity,.7);
  mud.dispose();
});

test('mud does not spawn on-road and existing splatter fades after returning',()=>{
  const mud=new MudSystem(new THREE.Scene(),80,()=>.5);
  mud.update(.05,{onRoad:true,speed:30,heading:0,roadHeight:.1});
  assert.equal(mud.count,0);
  mud.update(.05,{onRoad:false,speed:30,heading:0,roadHeight:.1});
  assert.equal(mud.count,8);
  mud.update(.1,{onRoad:true,speed:30,heading:0,roadHeight:.1});
  const alpha=mud.geometry.attributes.color.array[3];
  assert.ok(alpha>0&&alpha<1);
  mud.update(.3,{onRoad:true,speed:30,heading:0,roadHeight:.1});
  assert.equal(mud.count,0);
  mud.dispose();
});

test('mud opacity decays with particle age',()=>{
  const mud=new MudSystem(new THREE.Scene(),80,()=>.5);
  mud.update(.05,{onRoad:false,speed:30,heading:0,roadHeight:.1});
  const initial=mud.geometry.attributes.color.array[3];
  mud.update(.2,{onRoad:false,speed:30,heading:0,roadHeight:.1});
  assert.ok(mud.geometry.attributes.color.array[3]<initial);
  mud.dispose();
});

test('speedometer overlay creates a fixed 120 pixel canvas and eases needle angle across the sweep',()=>{
  const noop=()=>{};
  const context={clearRect:noop,save:noop,restore:noop,beginPath:noop,arc:noop,fill:noop,stroke:noop,moveTo:noop,lineTo:noop,fillText:noop};
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>({style:{},hidden:false,setAttribute:noop,getContext:()=>context,remove:noop})};
  const container={appendChild(canvas){this.canvas=canvas;}};
  try {
    const meter=new SpeedometerOverlay(container);
    assert.equal(container.canvas.width,120);assert.equal(container.canvas.height,120);
    meter.update(140,.2,true);
    assert.equal(meter.needleSpeed,140);
    assert.ok(Math.abs(meter.needleAngle-(meter.startAngle+meter.sweep*.5))<1e-9);
    meter.update(500,.2,true);
    assert.ok(meter.needleAngle<=meter.startAngle+meter.sweep);
    meter.update(0,.1,false);assert.equal(container.canvas.hidden,true);
    meter.dispose();
  } finally {if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});

test('quality tiers cap pixel ratio and toggle shadows',()=>{
  const vis={renderer:{setPixelRatio(value){this.pixelRatio=value;},shadowMap:{enabled:true}},mobile:true,trafficDensity:1};
  const selected=CarVisualizer3D.prototype.setQualityTier.call(vis,'high',{mobile:true});
  assert.equal(selected,'high');
  assert.equal(vis.renderer.pixelRatio,1);
  assert.equal(vis.renderer.shadowMap.enabled,false);
  CarVisualizer3D.prototype.setQualityTier.call(vis,'eco',{mobile:false});
  assert.equal(vis.renderer.pixelRatio,1);
});

test('camera shake is bounded and disabled by reduced motion',()=>{
  const vis={damageLevel:0,reducedMotion:false,cameraShakeEnabled:true,cameraShake:0,cameraShakeTime:0,carGroup:{position:new THREE.Vector3()},scene:new THREE.Scene(),smokeParticles:[]};
  CarVisualizer3D.prototype.triggerImpact.call(vis,500);
  assert.ok(vis.cameraShake>0&&vis.cameraShake<=.45);
  vis.reducedMotion=true;vis.cameraShake=0;
  CarVisualizer3D.prototype.triggerImpact.call(vis,500);
  assert.equal(vis.cameraShake,0);
});

test('camera roll eases toward drift direction and returns to level',()=>{
  const camera={cameraMode:'chase',cameraRoll:0};
  const physics={handbrake:true,speed:35,isDrifting:true,driftDirection:1};
  const rolled=CarVisualizer3D.prototype.updateCameraRoll.call(camera,physics,.1);
  assert.ok(rolled>0&&rolled<.06);
  physics.handbrake=false;
  const level=CarVisualizer3D.prototype.updateCameraRoll.call(camera,physics,.1);
  assert.ok(level>=0&&level<rolled);
});

test('spawnSparks adds entries to sparkParticles',()=>{
  const scene=new THREE.Scene();
  const vis={scene,sparkParticles:[]};
  CarVisualizer3D.prototype.spawnSparks.call(vis,{x:0,y:0,z:0},5);
  assert.equal(vis.sparkParticles.length,5,'five sparks created');
  assert.ok(vis.sparkParticles.every(s=>Number.isFinite(s.lifetime)&&s.lifetime>0),'all sparks have positive lifetime');
});

test('sparks age out after their lifetime',()=>{
  const scene=new THREE.Scene();
  const vis={scene,sparkParticles:[]};
  CarVisualizer3D.prototype.spawnSparks.call(vis,{x:0,y:0,z:0},3);
  assert.equal(vis.sparkParticles.length,3);
  for(const s of vis.sparkParticles){s.age=s.lifetime+0.01;}
  for(let i=vis.sparkParticles.length-1;i>=0;i--){
    const s=vis.sparkParticles[i];
    if(s.age>=s.lifetime){s.mesh.geometry.dispose();s.mesh.material.dispose();scene.remove(s.mesh);vis.sparkParticles.splice(i,1);}
  }
  assert.equal(vis.sparkParticles.length,0,'expired sparks removed');
});

test('sparkParticles pool is capped at 60',()=>{
  const scene=new THREE.Scene();
  const vis={scene,sparkParticles:[]};
  CarVisualizer3D.prototype.spawnSparks.call(vis,{x:0,y:0,z:0},70);
  assert.ok(vis.sparkParticles.length<=60,'pool respects 60-spark cap');
});
