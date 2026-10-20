import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltAxes, bindTiltInput } from '../src/tilt-input.js';
import { CarPhysics } from '../src/physics.js';
const neutral = {beta:40,gamma:0};
test('neutral dead zone, forward throttle, backward braking and steering directions',()=>{
  assert.deepEqual(tiltAxes({beta:42,gamma:2},neutral),{throttle:0,steering:0});
  assert.equal(tiltAxes({beta:14,gamma:26},neutral).throttle,1);
  assert.equal(tiltAxes({beta:14,gamma:26},neutral).steering,-1);
  assert.equal(tiltAxes({beta:66,gamma:-26},neutral).throttle,-1);
  assert.equal(tiltAxes({beta:66,gamma:-26},neutral).steering,1);
});
test('landscape axes are rotated for both orientations',()=>{
  assert.equal(tiltAxes({beta:40,gamma:-26},neutral,90).throttle,1);
  assert.equal(tiltAxes({beta:66,gamma:0},neutral,90).steering,1);
  assert.equal(tiltAxes({beta:40,gamma:26},neutral,270).throttle,1);
  assert.equal(tiltAxes({beta:14,gamma:0},neutral,270).steering,1);
});
test('analog acceleration scales with tilt and touch brake overrides forward tilt',()=>{
  const slow=new CarPhysics('slow'),fast=new CarPhysics('fast');
  slow.roadConstrained=false;fast.roadConstrained=false;
  slow.tiltInput={throttle:.3,steering:0};fast.tiltInput={throttle:1,steering:0};
  slow.integrate(.1);fast.integrate(.1);assert.ok(fast.speed>slow.speed*2);
  fast.keys.ArrowDown=true;const before=fast.speed;fast.integrate(.1);assert.ok(fast.speed<before);
});
class Target extends EventTarget { setAttribute(k,v){this[k]=v;} }
function fixture(permission='granted') {
 const win=new Target(),doc=new Target(),button=new Target(),calibrate=new Target(),status={};
 win.DeviceOrientationEvent={requestPermission:async()=>permission};win.screen={orientation:{angle:0}};
 win.setInterval=fn=>{win.tick=fn;};const physics={};
 bindTiltInput({physics,win,doc,button,calibrate,status});return {win,doc,button,calibrate,status,physics};
}
const emit=(target,type,props={})=>{const e=new Event(type);Object.assign(e,props);target.dispatchEvent(e);};
const enable=async f=>{emit(f.button,'click');await new Promise(r=>setImmediate(r));};
test('permission denial leaves neutral controls',async()=>{
 const f=fixture('denied');await enable(f);assert.equal(f.physics.tiltInput.throttle,0);assert.match(f.status.textContent,/denied/);
});
test('calibration, recenter and background suspension never retain throttle',async()=>{
 const f=fixture();await enable(f);emit(f.win,'deviceorientation',neutral);
 emit(f.win,'deviceorientation',{beta:14,gamma:0});assert.equal(f.physics.tiltInput.throttle,1);
 emit(f.calibrate,'click');assert.equal(f.physics.tiltInput.throttle,0);
 emit(f.win,'deviceorientation',{beta:14,gamma:0});assert.equal(f.physics.tiltInput.throttle,0);
 emit(f.win,'deviceorientation',{beta:-12,gamma:0});assert.equal(f.physics.tiltInput.throttle,1);
 emit(f.win,'blur');assert.equal(f.physics.tiltInput.throttle,0);
 emit(f.win,'deviceorientation',{beta:-30,gamma:0});assert.equal(f.physics.tiltInput.throttle,0);
});
test('invalid sensor and rotation cannot keep stale acceleration',async()=>{
 const f=fixture();await enable(f);emit(f.win,'deviceorientation',neutral);
 emit(f.win,'deviceorientation',{beta:14,gamma:0});emit(f.win,'deviceorientation',{beta:null,gamma:null});
 assert.equal(f.physics.tiltInput.throttle,0);
 f.win.screen.orientation.angle=90;emit(f.win,'deviceorientation',neutral);
 assert.equal(f.button['aria-pressed'],'false');
});
