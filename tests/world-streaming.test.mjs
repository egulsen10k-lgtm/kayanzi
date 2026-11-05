import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyCachedWorld,nextWorldLocation,distanceMeters,WorldStreamingCoordinator} from '../src/world-streaming.js';
import {buildBuildings,disposeWorldGroup} from '../src/building-world.js';

test('nearby worlds reuse cached patches but stale or distant ones do not',()=>{
  const cache=new Map([['old',{savedAt:0,network:{center:{lat:0,lng:0}}}],['near',{savedAt:300000,network:{center:{lat:0,lng:.0001}}}]]);
  assert.equal(nearbyCachedWorld(cache,0,0,300001).key,'near');
  assert.equal(nearbyCachedWorld(cache,0,.01,300001),null);
  assert.equal(nearbyCachedWorld(cache,0,0,600001),null);
});
test('streaming looks ahead with bounded distance and follows reverse direction',()=>{
  const origin={lat:40,lng:29};
  const ahead=nextWorldLocation(origin,0,90),reverse=nextWorldLocation(origin,0,-18);
  assert.ok(ahead.lat>origin.lat&&reverse.lat<origin.lat);
  assert.ok(distanceMeters(origin,ahead)<=100.01);
  assert.ok(Math.abs(distanceMeters(origin,reverse)-20)<.01);
  const wrapped=nextWorldLocation({lat:0,lng:179.9999},Math.PI/2,200);
  assert.ok(wrapped.lng<0);
});

test('streaming stats report cache hits, misses and finite nonnegative counters',async()=>{
  const stream=new WorldStreamingCoordinator({maxCacheEntries:1});
  const before=stream.getStats();
  assert.deepEqual(before,{cacheHits:0,cacheMisses:0,abortedRequests:0,activeRequests:0});
  assert.equal(await stream.request({key:'district-a',load:async()=>({name:'A'})}).then(v=>v.name),'A');
  assert.equal(await stream.request({key:'district-a',load:async()=>({name:'unused'})}).then(v=>v.name),'A');
  stream.getStats();
  const stats=stream.getStats();
  assert.equal(stats.cacheHits,1);assert.equal(stats.cacheMisses,1);
  assert.ok(Object.values(stats).every(value=>Number.isFinite(value)&&value>=0));
});

test('duplicate coordinate requests coalesce into one load and latest commit',async()=>{
  const stream=new WorldStreamingCoordinator(),commits=[];
  let finish,loads=0;
  const first=stream.request({lat:40,lng:29,load:()=>{loads++;return new Promise(resolve=>{finish=resolve;});},commit:value=>commits.push(`old:${value}`)});
  const second=stream.request({lat:40,lng:29,load:async()=>{loads++;return 'duplicate';},commit:value=>commits.push(`new:${value}`)});
  assert.equal(loads,1);
  finish('district');
  assert.deepEqual(await Promise.all([first,second]),['district','district']);
  assert.deepEqual(commits,['new:district']);
  assert.equal(stream.getStats().activeRequests,0);
});

test('aborting one coalesced waiter preserves shared work; aborting the last cancels it',async()=>{
  const stream=new WorldStreamingCoordinator(),firstController=new AbortController(),lastController=new AbortController();
  let upstreamSignal,settle;
  const load=({signal})=>{upstreamSignal=signal;return new Promise((resolve,reject)=>{settle={resolve,reject};signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
  const first=stream.request({key:'shared',signal:firstController.signal,load});
  const last=stream.request({key:'shared',signal:lastController.signal,load:async()=>null});
  firstController.abort(new Error('first waiter left'));
  await assert.rejects(first,/first waiter left/);
  assert.equal(upstreamSignal.aborted,false);
  lastController.abort(new Error('last waiter left'));
  await assert.rejects(last,/last waiter left/);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(upstreamSignal.aborted,true);
  assert.equal(stream.getStats().abortedRequests,2);
  assert.equal(stream.getStats().activeRequests,0);
  settle?.reject(new Error('late upstream failure'));
});

test('active district loads stay within concurrency and stale loads cannot commit',async()=>{
  const stream=new WorldStreamingCoordinator({maxConcurrent:2,maxQueued:2});
  const pending=new Map();let active=0,maxActive=0;
  const loadFor=key=>()=>{active++;maxActive=Math.max(maxActive,active);return new Promise(resolve=>pending.set(key,value=>{active--;resolve(value);}));};
  const commits=[];
  const a=stream.request({key:'district-a',load:loadFor('a'),commit:()=>commits.push('a')});
  const b=stream.request({key:'district-b',load:loadFor('b'),commit:()=>commits.push('b')});
  const c=stream.request({key:'district-c',load:loadFor('c'),commit:()=>commits.push('c')});
  const d=stream.request({key:'district-d',load:loadFor('d'),commit:()=>commits.push('d')});
  assert.equal(stream.getStats().activeRequests,2);assert.equal(active,2);
  await assert.rejects(stream.request({key:'district-e',load:async()=>null}),/queue is full/);
  pending.get('a')('a');await a;
  assert.equal(stream.getStats().activeRequests,2);assert.equal(active,2);
  pending.get('c')('c');await c;
  pending.get('d')('d');await d;
  pending.get('b')('b');await b;
  assert.equal(maxActive,2);
  assert.deepEqual(commits,['d']);
  assert.equal(stream.getStats().activeRequests,0);
});

test('a newer cached district supersedes an older active request',async()=>{
  const stream=new WorldStreamingCoordinator();
  await stream.request({key:'cached-newer',load:async()=>({district:'newer'})});
  let finish;const commits=[];
  const old=stream.request({key:'old-active',load:()=>new Promise(resolve=>{finish=resolve;}),commit:()=>commits.push('old')});
  await stream.request({key:'cached-newer',load:async()=>null,commit:()=>commits.push('cached')});
  finish({district:'old'});await old;
  assert.deepEqual(commits,['cached']);
});
test('buildings batch roof and lit/unlit facade groups by spatial chunk',()=>{
  const buildings=Array.from({length:20},(_,i)=>({id:i,height:10,points:[[i*3,0],[i*3+2,0],[i*3+2,2],[i*3,2],[i*3,0]]}));
  let randomIndex=0;const group=buildBuildings({buildings},{random:()=>randomIndex++%10<3?.1:.9});
  assert.equal(group.children.length,1);
  const geometry=group.children[0].geometry;
  assert.equal(geometry.groups.length,3);
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.max.y===10&&geometry.boundingBox.max.x===59);
  let disposed=false;geometry.addEventListener('dispose',()=>disposed=true);
  disposeWorldGroup(group);assert.ok(disposed);
});
