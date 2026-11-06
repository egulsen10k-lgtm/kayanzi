import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDrivingInput, GamepadInput, applyDeadzone, updateWithGamepad } from '../src/driving-input.js';
class Target extends EventTarget {
  attrs = {}; captures = new Set();
  getAttribute(k) { return this.attrs[k]; }
  setAttribute(k,v) { this.attrs[k]=v; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
function setup() {
  const win=new Target(), doc=new Target(), physics={keys:{}};
  const buttons=['ArrowUp','ArrowLeft'].map(code=>{const b=new Target();b.attrs['data-drive-key']=code;return b;});
  bindDrivingInput({physics,buttons,win,doc});
  return {win,doc,physics,buttons};
}
function fire(target,type,props={}) { const e=new Event(type,{cancelable:true});Object.assign(e,props);target.dispatchEvent(e); }
test('two fingers can accelerate and steer; releasing steering preserves throttle',()=>{
  const {buttons:[gas,left],physics}=setup();
  fire(gas,'pointerdown',{pointerId:1,button:0});fire(left,'pointerdown',{pointerId:2,button:0});
  assert.equal(physics.keys.ArrowUp,true);assert.equal(physics.keys.ArrowLeft,true);
  fire(left,'pointercancel',{pointerId:2});assert.equal(physics.keys.ArrowLeft,false);assert.equal(physics.keys.ArrowUp,true);
  fire(gas,'lostpointercapture',{pointerId:1});assert.equal(physics.keys.ArrowUp,false);
});
test('keyboard and touch ownership remain independent',()=>{
  const {buttons:[gas],physics,win}=setup();
  fire(win,'keydown',{code:'ArrowUp'});fire(gas,'pointerdown',{pointerId:1,button:0});
  fire(gas,'pointerup',{pointerId:1});assert.equal(physics.keys.ArrowUp,true);
  fire(win,'keyup',{code:'ArrowUp'});assert.equal(physics.keys.ArrowUp,false);
});
test('space jumps only in robot mode and remains a handbrake in car mode',()=>{
  const win=new Target(),doc=new Target(),physics={keys:{}},space=new Target();
  space.attrs['data-drive-key']='Space';
  let robotMode=false,jumps=0;
  const binding=bindDrivingInput({physics,buttons:[space],win,doc,isRobotMode:()=>robotMode,onRobotJump:()=>jumps++});
  fire(win,'keydown',{code:'Space',repeat:false});
  assert.equal(physics.keys.Space,true);
  fire(win,'keyup',{code:'Space'});assert.equal(physics.keys.Space,false);
  robotMode=true;binding.clear();
  fire(win,'keydown',{code:'Space',repeat:false});
  fire(win,'keydown',{code:'Space',repeat:true});
  assert.equal(jumps,1);assert.equal(physics.keys.Space,false);
  fire(space,'pointerdown',{pointerId:1,button:0});
  assert.equal(jumps,2);assert.equal(physics.keys.Space,false);
  fire(space,'pointerup',{pointerId:1});
  robotMode=false;binding.clear();
  fire(space,'pointerdown',{pointerId:2,button:0});
  assert.equal(physics.keys.Space,true);
  fire(space,'pointerup',{pointerId:2});assert.equal(physics.keys.Space,false);
});
for (const reason of ['blur','resize','visibilitychange']) test(`${reason} clears input and permits the next touch`,()=>{
  const {buttons:[gas],physics,win,doc}=setup();
  fire(gas,'pointerdown',{pointerId:1,button:0});doc.hidden=true;
  fire(reason==='visibilitychange'?doc:win,reason);
  assert.equal(physics.keys.ArrowUp,false);assert.equal(gas.attrs['aria-pressed'],'false');assert.equal(gas.captures.size,0);
  physics.keys={};fire(gas,'pointerdown',{pointerId:2,button:0});assert.equal(physics.keys.ArrowUp,true);
});

const makePad=({axis=0,rt=0,lt=0,a=false,y=false,up=false,down=false}={})=>({connected:true,axes:[axis,0],buttons:[{pressed:a},null,null,{pressed:y},null,null,{value:lt},{value:rt},null,null,null,null,{pressed:up},{pressed:down}]});

test('gamepad maps left stick, triggers, handbrake, horn and camera d-pad',()=>{
  const events=[];
  const input=new GamepadInput({navigatorRef:{getGamepads:()=>[makePad({axis:.8,rt:.7,lt:.2,a:true,y:true,up:true})]},onHornStart:()=>events.push('horn'),onCameraCycle:n=>events.push(`camera:${n}`)});
  const state=input.poll();
  assert.equal(state.connected,true);assert.ok(state.steering>.7);assert.equal(state.throttle,.7);assert.equal(state.brake,.2);assert.equal(state.handbrake,true);
  assert.deepEqual(events,['horn','camera:1']);
});

test('gamepad stick deadzone suppresses drift and rescales active input',()=>{
  assert.equal(applyDeadzone(.1),0);assert.equal(applyDeadzone(-.16),0);
  assert.ok(Math.abs(applyDeadzone(.58)-.5)<1e-9);
});

test('held keyboard and touch keys take precedence over gamepad analogs',()=>{
  const physics={keys:{ArrowLeft:true,ArrowUp:true,Space:false},tiltInput:null,wheelSteering:0};let result;
  updateWithGamepad(physics,{steering:1,throttle:1,brake:0,handbrake:true},()=>{result={...physics.tiltInput,space:physics.keys.Space};});
  assert.equal(result.steering,0);assert.equal(result.throttle,0);assert.equal(result.space,true);
  assert.equal(physics.tiltInput,null);assert.equal(physics.keys.Space,false);
});

test('missing Gamepad API is safe and reports no controller',()=>{
  const input=new GamepadInput({navigatorRef:undefined});
  assert.deepEqual(input.poll(),{steering:0,throttle:0,brake:0,handbrake:false,connected:false});
});

test('safe pointer capture/release errors and focusin editable clearing are robust', () => {
  const win = new Target(), doc = new Target(), physics = { keys: {} };
  class FaultyTarget extends Target {
    setPointerCapture(id) { throw new Error('not supported'); }
    hasPointerCapture(id) { throw new Error('not supported'); }
    releasePointerCapture(id) { throw new Error('not supported'); }
  }
  const btn = new FaultyTarget();
  btn.attrs['data-drive-key'] = 'ArrowUp';
  bindDrivingInput({ physics, buttons: [btn], win, doc });

  fire(btn, 'pointerdown', { pointerId: 10, button: 0 });
  assert.equal(physics.keys.ArrowUp, true);
  fire(btn, 'pointerup', { pointerId: 10 });
  assert.equal(physics.keys.ArrowUp, false);

  const inputEl = new Target();
  inputEl.tagName = 'INPUT';
  fire(win, 'keydown', { code: 'ArrowUp' });
  assert.equal(physics.keys.ArrowUp, true);
  doc.activeElement = inputEl;
  const ev = new Event('focusin', { cancelable: true });
  Object.defineProperty(ev, 'target', { value: inputEl, writable: false });
  doc.dispatchEvent(ev);
  assert.equal(physics.keys.ArrowUp, false);
});
