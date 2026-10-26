import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RunnerGame, TRUCK_ROOF_HEIGHT } from '../src/runner-game.js';
import { createRobotModel } from '../src/robot-runner-view.js';
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
  game.trucks=[{id:1,lane:1,z:-11,length:9,hit:false}];
  game.pickups=[{id:2,lane:1,z:-11,y:TRUCK_ROOF_HEIGHT,truckId:1,taken:false}];
  game.lane=1;
  assert.equal(game.jump(),true);
  for(let i=0;i<100;i++)game.update(1/60);
  assert.equal(game.lives,3);
  assert.equal(game.collected,1);
  assert.ok(game.distance>0);
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
