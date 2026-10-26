import test from 'node:test';
import assert from 'node:assert/strict';
import { RobotJump } from '../src/robot-jump.js';

test('robot jump rises, lands, and refuses mid-air double jumps',()=>{
  const jump=new RobotJump();
  assert.equal(jump.jump(),true);
  jump.update(1/60);
  assert.ok(jump.height>0);
  assert.equal(jump.jump(),false);
  let peak=jump.height;
  for(let i=0;i<100;i++){jump.update(1/60);peak=Math.max(peak,jump.height);}
  assert.ok(peak>1.5);
  assert.equal(jump.height,0);
  assert.equal(jump.velocity,0);
  assert.equal(jump.jump(),true);
  jump.reset();assert.equal(jump.height,0);
});

test('invalid or long frame times cannot make the robot fall below the road',()=>{
  const jump=new RobotJump();jump.jump();
  jump.update(Number.NaN);assert.equal(jump.height,0);
  jump.update(10);assert.ok(jump.height>=0);
  for(let i=0;i<100;i++)jump.update(10);
  assert.equal(jump.height,0);
});
