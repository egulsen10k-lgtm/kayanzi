import test from 'node:test';
import assert from 'node:assert/strict';
import {createBundledWorldLoader,containsCoordinate} from '../src/bundled-world.js';
const patches=[{file:'west.json',bbox:[-.004,-.004,.004,.004]},{file:'east.json',bbox:[.002,-.004,.010,.004]},{file:'far.json',bbox:[1,1,2,2]}];
function fixture(options={}) {
  const calls=[];
  const load=createBundledWorldLoader({...options,fetchImpl:async(url,{signal})=>{
    signal?.throwIfAborted();calls.push(url);
    return {ok:true,json:async()=>url.endsWith('manifest.json')?{version:1,patches}:{elements:[{type:'way',id:1,geometry:[{lat:0,lon:0}]},{type:'node',id:1,lat:0,lon:0}]}};
  }});
  return {load,calls};
}
test('bundled world loads nearby overlapping districts, deduplicates typed ids, and reuses cache',async()=>{
  const {load,calls}=fixture();
  const result=await load(0,0);
  assert.equal(result.elements.length,2);assert.equal(result.bundled,true);
  assert.equal(calls.length,3);assert.ok(!calls.some(x=>x.includes('far.json')));
  await load(0,.0001);assert.equal(calls.length,3);
  assert.equal(await load(30,30),null);assert.equal(calls.length,3);
});
test('bundled cache evicts old patches and cancelled callers cannot load data',async()=>{
  const {load,calls}=fixture({maxEntries:1});
  await load(0,0);await load(0,0);
  assert.equal(calls.length,5);
  const controller=new AbortController();controller.abort();
  await assert.rejects(load(0,0,controller.signal),{name:'AbortError'});
  assert.equal(calls.length,5);
});
test('manifest failure has bounded retries and falls back without fabricated coverage',async()=>{
  let calls=0;
  const load=createBundledWorldLoader({fetchImpl:async()=>{calls++;return {ok:false};}});
  assert.equal(await load(0,0),null);assert.equal(await load(0,0),null);assert.equal(calls,1);
  assert.equal(containsCoordinate([29.055,40.960,29.085,40.975],40.955,29.07),false);
});
