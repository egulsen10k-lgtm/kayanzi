import test from 'node:test';
import assert from 'node:assert/strict';
import { PauseState } from '../src/pause-state.js';

test('pause toggles overlay visibility and resumes cleanly',()=>{
  const overlay={hidden:true};
  const state=new PauseState(paused=>{overlay.hidden=!paused;});
  assert.equal(state.toggle(),true);assert.equal(overlay.hidden,false);
  assert.equal(state.toggle(),false);assert.equal(overlay.hidden,true);
});

test('paused frames do not run world update side effects',()=>{
  const state=new PauseState();let updates=0;
  state.set(true);
  if(!state.shouldSkipFrame())updates++;
  assert.equal(state.shouldSkipFrame(true),false);
  assert.equal(updates,0);
  assert.equal(state.runIfActive(()=>updates++),false);
  assert.equal(updates,0);
  state.set(false);
  assert.equal(state.runIfActive(()=>updates++),true);
  assert.equal(updates,1);
});
