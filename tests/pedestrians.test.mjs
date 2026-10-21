import test from 'node:test';
import assert from 'node:assert/strict';
import { Pedestrians,seatCapacity } from '../src/pedestrians.js';
const network={center:{lat:0,lng:0},radiusMeters:500,roads:[{width:8,highway:'residential',points:[[0,-100],[0,100]]}],buildings:[]};
const car=()=>({lat:0,lng:0,speed:0,roadHeight:.08,bmwModel:'M3 Competition',roadNetwork:network});
const person=(x,y=0)=>({id:x,x,y,height:.08,state:'idle',remaining:0,phase:0});
test('horn activates only nearby pedestrians on the same road level',()=>{
 const sim=new Pedestrians(),c=car();sim.network=network;sim.people=[person(10),person(60)];
 assert.equal(sim.horn(c),1);assert.equal(sim.people[0].state,'chasing');assert.equal(sim.people[1].state,'idle');
 c.roadHeight=5;assert.equal(sim.horn(c),0);
});
test('catching a slow car boards once, with capacity including driver',()=>{
 const sim=new Pedestrians(),c=car();sim.network=network;sim.people=Array.from({length:8},(_,i)=>person(2+i*.01));
 sim.horn(c);sim.update(c,.1);assert.equal(sim.passengers,4);assert.equal(sim.people.filter(p=>p.state==='boarded').length,4);
 sim.horn(c);sim.update(c,.1);assert.equal(sim.passengers,4);
 c.bmwModel='M4 CSL';sim.update(c,.1);assert.equal(sim.passengers,1);assert.equal(seatCapacity(c.bmwModel),2);
});
test('pedestrians cannot board a fast car or chase forever',()=>{
 const sim=new Pedestrians(),c=car();sim.network=network;sim.people=[person(2)];c.speed=40;
 sim.horn(c);sim.update(c,.1);assert.equal(sim.passengers,0);
 sim.people[0].remaining=.01;sim.update(c,.1);assert.equal(sim.people[0].state,'idle');
});
test('overflow passengers cling to the car and ragdoll at speed or during a sharp wiggle',()=>{
 const sim=new Pedestrians(),c=car();sim.network=network;sim.passengers=4;
 sim.people=[person(2)];sim.horn(c);sim.update(c,.1);assert.equal(sim.people[0].state,'clinging');
 const held=sim.people[0],previousY=held.y;c.lat=.0001;sim.update(c,.1);assert.notEqual(held.y,previousY);
 c.speed=30;sim.update(c,.1);assert.equal(sim.people[0].state,'ragdoll');
 const wiggling=new Pedestrians(),d=car();wiggling.network=network;wiggling.passengers=4;wiggling.people=[person(2)];
 wiggling.horn(d);wiggling.update(d,.1);assert.equal(wiggling.people[0].state,'clinging');
 d.speed=15;d.heading=.2;wiggling.update(d,.1);assert.equal(wiggling.people[0].state,'ragdoll');
});
test('spawn budget is bounded and places people on ground streets only',()=>{
 const sim=new Pedestrians(),c=car();sim.update(c,.1);assert.ok(sim.people.length>0);assert.ok(sim.people.length<=16);
 for(const p of sim.people)assert.ok(Math.abs(p.x)>4);
 sim.reset({...network,roads:[{...network.roads[0],bridge:true,elevations:[5,5]}]},c);assert.equal(sim.people.length,0);
});
test('chase advances toward car without walking through buildings',()=>{
 const sim=new Pedestrians(),c=car();sim.network=network;sim.people=[person(0,15)];
 sim.horn(c);sim.update(c,.1);assert.ok(sim.people[0].y<15);
 const blocked={...network,buildings:[{points:[[-10,10],[10,10],[10,14.9],[-10,14.9],[-10,10]]}]};
 sim.network=blocked;c.roadNetwork=blocked;sim.people=[person(0,15)];sim.horn(c);sim.update(c,.1);
 assert.equal(sim.people[0].y,15);
});

test('passengers survive world streaming, while old pedestrians are replaced',()=>{
 const sim=new Pedestrians(),c=car();sim.update(c,.1);sim.passengers=2;
 c.roadNetwork={...network};sim.update(c,.1);assert.equal(sim.passengers,2);assert.equal(sim.network,c.roadNetwork);
 c.roadNetwork=null;sim.update(c,.1);assert.equal(sim.people.length,0);assert.equal(sim.network,null);
});
