import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RunnerGame, TRUCK_ROOF_HEIGHT, SLIDE_DURATION, ROLL_DURATION, BASE_SPEED, isSingleLaneFree } from '../src/runner-game.js';
import { createRobotModel, RobotRunnerView } from '../src/robot-runner-view.js';
import { animateRobot } from '../src/robot-animation.js';

test('runner lane changes stay inside three lanes and a grounded robot can jump',()=>{
  const game=new RunnerGame(()=>0);
  assert.equal(game.move(-1),true);
  assert.equal(game.move(-1),false);
  assert.equal(game.lane,0);
  assert.equal(game.jump(),true);
  assert.equal(game.jump(),false);
  for(let i=0;i<85;i++)game.update(1/60);
  assert.equal(game.y,0);
  assert.equal(game.jump(),true);
});

test('jumping onto a truck roof lands safely and collects its adult character',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[{id:1,lane:1,z:-11,length:9,hit:false,roll:0,rollVelocity:0}];
  game.pickups=[{id:2,lane:1,z:-11,y:TRUCK_ROOF_HEIGHT,truckId:1,taken:false}];
  game.lowObstacles=[];game.roadsters=[];game.powerups=[];
  game.lane=1;game.invulnerable=0;
  assert.equal(game.jump(),true);
  for(let i=0;i<100;i++)game.update(1/60);
  assert.ok(game.lives>=2,'should survive roof landing');
  assert.equal(game.collected,1);
  assert.ok(game.distance>0);
});

test('slide avoids low obstacles and expires after its roll window',()=>{
  const game=new RunnerGame(()=>0);
  game.lowObstacles=[{id:9,lane:1,z:-2,length:2.2,height:1.55,hit:false}];
  assert.equal(game.slide(),true);
  assert.equal(game.sliding,true);
  game.update(.05);
  assert.equal(game.lives,3);
  assert.ok(game.slideTimer<SLIDE_DURATION);
  for (let i = 0; i < 15; i++) game.update(.05);
  assert.equal(game.sliding,false);
});

test('down roll has a finite barrel-roll window and slide remains compatible',()=>{
  const game=new RunnerGame(()=>0);
  assert.equal(game.roll(),true);
  assert.equal(game.rolling,true);
  game.update(.05);
  assert.ok(Number.isFinite(game.rollAngle));
  assert.ok(game.rollTimer<ROLL_DURATION);
  assert.equal(game.slide(),true);
  for(let i=0;i<20;i++)game.update(.05);
  assert.equal(game.rolling,false);
});

test('low obstacle collision costs a life when not sliding',()=>{
  const game=new RunnerGame(()=>0);
  game.lowObstacles=[{id:9,lane:1,z:-1,length:2.2,height:1.55,hit:false}];
  game.trucks=[];game.roadsters=[];game.powerups=[];
  game.update(.05);
  assert.equal(game.lives,2);
  assert.equal(game.lowObstacles[0].hit,true);
});

test('roadster impact gives a truck a finite roll state',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[{id:1,lane:1,z:-1,length:9,hit:false,roll:0,rollVelocity:0}];
  game.roadsters=[{id:2,lane:1,z:-1,length:4.8,height:2.8,hit:false,roll:0}];
  game.update(.05);
  assert.equal(game.roadsters[0].hit,true);
  assert.ok(Number.isFinite(game.trucks[0].rollVelocity));
  assert.ok(game.trucks[0].rollVelocity>0);
});

test('truck impacts cost hearts, end the run, and reset cleanly',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[{id:1,lane:1,z:-4,length:9,hit:false}];
  game.pickups=[];
  game.update(.05);
  assert.equal(game.lives,2);
  assert.equal(game.trucks[0].hit,true);
  game.invulnerable=0;
  game.trucks[0].hit=false;
  game.update(.05);
  game.invulnerable=0;
  game.trucks[0].hit=false;
  game.update(.05);
  assert.equal(game.over,true);
  const stopped=game.distance;game.update(.05);assert.equal(game.distance,stopped);
  game.reset();assert.equal(game.lives,3);assert.equal(game.over,false);assert.equal(game.collected,0);
});

test('runner traffic and pickups animate between frames',()=>{
 const view=Object.create(RobotRunnerView.prototype);
 view.trucks=new Map();view.pickups=new Map();view.lowObstacles=new Map();view.roadsters=new Map();view.powerups=new Map();view._warnSprites=[];view.laneMarkers=[];view.buildings=[];view.root=new THREE.Group();view.robot=createRobotModel();
 view.camera={position:new THREE.Vector3(),lookAt(){},updateProjectionMatrix(){}};view.renderer={render(){}};view.container={clientWidth:320,clientHeight:240};
 const truck=view.createTruck({lane:1});const pickup=view.createPickup();
 const game={trucks:[{id:1,lane:1,z:-8,roll:0}],pickups:[{id:2,lane:1,z:-6,y:0}],roadsters:[],lowObstacles:[],distance:0,x:0,y:0,vy:0,lane:1,over:false,invulnerable:0};
 view.trucks.set(1,truck);view.pickups.set(2,pickup);
 const roadster={id:3,lane:1,z:-5,height:2.8,roll:.4};
 game.roadsters=[roadster];
 const wheelBefore=truck.userData.wheels[0].rotation.x,pickupY=pickup.position.y;
 view.update(game,.1);game.distance=1;view.update(game,.1);
 assert.notEqual(truck.userData.wheels[0].rotation.x,wheelBefore);
 assert.notEqual(pickup.position.y,pickupY);
 assert.equal(view.roadsters.get(3).name,'runner-roadster');
 assert.equal(view.roadsters.get(3).rotation.x,.4);
});
test('robot mode has a complete articulated 3D figure',()=>{
  const robot=createRobotModel('#1c3fa8');
  assert.ok(robot.getObjectByName('head'));
  assert.ok(robot.getObjectByName('windshield-chest'));
  assert.equal(robot.getObjectsByProperty('name','folded-wheel').length,2);
  const bounds=new THREE.Box3().setFromObject(robot);
  assert.ok(bounds.max.y>2.9&&bounds.min.y<.1);
});

test('shared robot gait runs with opposite limbs and reacts to jumps and landings',()=>{
  const robot=createRobotModel();
  robot.position.set(4,2,0);
  const rig=robot.userData.rig;
  const poses=[];
  for(let i=0;i<30;i++){
    animateRobot(robot,{dt:1/60,speed:14,grounded:true});
    poses.push(rig.leftLeg.rotation.x);
  }
  assert.ok(Math.max(...poses)-Math.min(...poses)>.8);
  assert.ok(rig.leftLeg.rotation.x*rig.rightLeg.rotation.x<0);
  assert.ok(rig.leftArm.rotation.x*rig.leftLeg.rotation.x<0);
  assert.ok(rig.leftKnee.rotation.x<0||rig.rightKnee.rotation.x<0);
  assert.deepEqual(robot.position.toArray(),[4,2,0]);
  for(let i=0;i<8;i++)animateRobot(robot,{dt:1/60,speed:14,grounded:false,verticalVelocity:8});
  assert.ok(rig.leftKnee.rotation.x<-.4);
  assert.ok(rig.leftArm.rotation.x>0);
  animateRobot(robot,{dt:1/60,speed:14,grounded:true,verticalVelocity:0});
  assert.ok(robot.userData.animation.landing>.8);
  assert.ok(rig.motion.position.y<.02);
});

test('level advances every 500m and caps at 10',()=>{
  const game=new RunnerGame(()=>0);
  assert.equal(game.level,1);
  game.distance=499; game.update(1/60);
  assert.equal(game.level,1);
  game.distance=500; game.update(1/60);
  assert.equal(game.level,2);
  game.distance=4500; game.update(1/60);
  assert.equal(game.level,10);
  game.distance=9999; game.update(1/60);
  assert.equal(game.level,10);
});

test('row speed at level 5 matches BASE_SPEED formula',()=>{
  const game=new RunnerGame(()=>0);
  game.level=5; game.distance=0;
  const expectedBase=BASE_SPEED+(5-1)*0.18;
  // After one tiny dt the speed term dominates; distance/500 is negligible
  const dt=1/60; game.update(dt);
  assert.ok(game.distance>0);
  assert.ok(Math.abs(game.distance/dt - expectedBase)<1,'speed at level 5 should be near BASE_SPEED+(4*0.18)');
});

test('runner combo increments after safely passing an obstacle',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[{id:99,lane:0,z:.5,length:1,hit:false,roll:0,rollVelocity:0}];
  game.lowObstacles=[];game.roadsters=[];
  game.update(.05);
  assert.equal(game.combo,1);
  assert.equal(game.comboTimer,1.5);
  assert.deepEqual(game.comboChangeEvent,{combo:1});
});

test('runner combo resets when its avoidance timer expires',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[{id:99,lane:0,z:.5,length:1,hit:false,roll:0,rollVelocity:0}];
  game.lowObstacles=[];game.roadsters=[];game.update(.05);
  for(let i=0;i<30;i++)game.update(.05);
  assert.equal(game.combo,0);
  assert.deepEqual(game.comboChangeEvent,{combo:0});
});

test('runner combo is capped at eight',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=Array.from({length:12},(_,i)=>({id:100+i,lane:0,z:.5,length:1,hit:false,roll:0,rollVelocity:0}));
  game.lowObstacles=[];game.roadsters=[];game.update(.05);
  assert.equal(game.combo,8);
});

test('distance score gains the active combo multiplier',()=>{
  const game=new RunnerGame(()=>0);game.trucks=[];game.lowObstacles=[];game.roadsters=[];
  game.combo=2;game.comboTimer=1.5;game.update(.05);
  assert.ok(Math.abs(game.score-game.distance*1.3)<1e-9);
});

test('trick input is ignored while the robot is grounded',()=>{
  const game=new RunnerGame(()=>0);
  assert.equal(game.trickInput('flip'),false);
  assert.equal(game.trickInput('spin'),false);
  assert.equal(game.trickFlip,false);assert.equal(game.trickSpin,false);
});

test('a flip trick scores when the robot lands',()=>{
  const game=new RunnerGame(()=>0);game.jump();game.update(.05);
  assert.ok(game.y>.15);assert.equal(game.trickInput('flip'),true);
  for(let i=0;i<60&&!game.trickEvent;i++)game.update(.05);
  assert.deepEqual(game.trickEvent,{types:['flip'],bonus:150});
  assert.ok(game.score>=150);
  assert.equal(game.trickFlip,false);
});

test('flip and spin together give a double trick bonus on landing',()=>{
  const game=new RunnerGame(()=>0);game.jump();game.update(.05);
  assert.equal(game.trickInput('flip'),true);assert.equal(game.trickInput('spin'),true);
  for(let i=0;i<60&&!game.trickEvent;i++)game.update(.05);
  assert.deepEqual(game.trickEvent,{types:['flip','spin'],bonus:300});
  assert.ok(game.score>=300);
});

test('normal obstacle rows always leave at least two lanes free',()=>{
  const game=new RunnerGame(()=>.99);
  const row=game.spawnRow();
  const blocked=new Set([...row.trucks,...row.lowObstacles,...row.roadsters].map(item=>item.lane));
  assert.ok(3-blocked.size>=2);
  assert.equal(isSingleLaneFree(row),false);
});

test('every fifth level six row can be a single-lane gauntlet',()=>{
  const game=new RunnerGame(()=>.99);game.level=6;
  let row;
  for(let i=0;i<5;i++)row=game.spawnRow();
  const blocked=new Set([...row.trucks,...row.lowObstacles,...row.roadsters].map(item=>item.lane));
  assert.equal(row.gauntlet,true);
  assert.equal(3-blocked.size,1);
  assert.equal(isSingleLaneFree(row),true);
});

test('gauntlet grace halves row speed for 0.4 seconds',()=>{
  const game=new RunnerGame(()=>.99);game.level=6;
  for(let i=0;i<5;i++)game.spawnRow();
  const nominal=BASE_SPEED+(game.level-1)*.18;
  game.update(.05);
  assert.ok(Math.abs(game.lastRowSpeed-nominal*.5)<1e-9);
  assert.ok(Math.abs(game.gauntletGraceTimer-.35)<1e-9);
});

test('getUpcomingHazards returns obstacles in z range -18 to -8',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[
    {id:1,lane:1,z:-13,length:7,hit:false,roll:0,rollVelocity:0},  // in range
    {id:2,lane:0,z:-5, length:7,hit:false,roll:0,rollVelocity:0},  // too close
    {id:3,lane:2,z:-20,length:7,hit:false,roll:0,rollVelocity:0},  // too far
  ];
  game.lowObstacles=[];game.roadsters=[];game.powerups=[];
  const hazards=game.getUpcomingHazards();
  assert.equal(hazards.length,1,'only the z=-13 truck is in range');
  assert.equal(hazards[0].id,1);
  assert.equal(hazards[0].kind,'truck');
});

test('getUpcomingHazards excludes obstacles outside -18 to -8',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[];
  game.lowObstacles=[
    {id:10,lane:0,z:-8, length:2,height:1.55,hit:false},   // boundary inclusive
    {id:11,lane:1,z:-18,length:2,height:1.55,hit:false},   // boundary inclusive
    {id:12,lane:2,z:-7.9,length:2,height:1.55,hit:false},  // just outside
    {id:13,lane:0,z:-18.1,length:2,height:1.55,hit:false}, // just outside
  ];
  game.roadsters=[];game.powerups=[];
  const hazards=game.getUpcomingHazards();
  assert.ok(hazards.some(h=>h.id===10),'z=-8 boundary included');
  assert.ok(hazards.some(h=>h.id===11),'z=-18 boundary included');
  assert.ok(!hazards.some(h=>h.id===12),'z=-7.9 excluded');
  assert.ok(!hazards.some(h=>h.id===13),'z=-18.1 excluded');
});

test('getUpcomingHazards includes powerups in range and tags kind correctly',()=>{
  const game=new RunnerGame(()=>0);
  game.trucks=[];game.lowObstacles=[];game.roadsters=[];
  game.powerups=[
    {id:20,type:'rocket',lane:1,z:-12,collected:false},
    {id:21,type:'wrench',lane:0,z:-3, collected:false},
  ];
  const hazards=game.getUpcomingHazards();
  assert.equal(hazards.length,1);
  assert.equal(hazards[0].kind,'powerup');
  assert.equal(hazards[0].id,20);
});
