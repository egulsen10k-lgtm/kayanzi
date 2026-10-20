import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDrivingInput } from '../src/driving-input.js';
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
for (const reason of ['blur','resize','visibilitychange']) test(`${reason} clears input and permits the next touch`,()=>{
  const {buttons:[gas],physics,win,doc}=setup();
  fire(gas,'pointerdown',{pointerId:1,button:0});doc.hidden=true;
  fire(reason==='visibilitychange'?doc:win,reason);
  assert.equal(physics.keys.ArrowUp,false);assert.equal(gas.attrs['aria-pressed'],'false');assert.equal(gas.captures.size,0);
  physics.keys={};fire(gas,'pointerdown',{pointerId:2,button:0});assert.equal(physics.keys.ArrowUp,true);
});
