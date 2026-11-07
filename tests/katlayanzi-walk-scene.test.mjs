import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCasinoHall,updateCasinoHall,moveCasinoWalker,nearestCasinoTable,KatlayanziScene} from '../src/katlayanzi-scene.js';

test('casino hall distinguishes three playable tables from decorative closed tables',()=>{
  const hall=buildCasinoHall();
  assert.equal(hall.userData.tables.filter(t=>t.playable).length,3);
  assert.equal(hall.userData.tables.filter(t=>!t.playable).length,2);
  for(const table of hall.userData.tables){const group=hall.getObjectByName(`hall-table-${table.id}`);assert.ok(group);assert.equal(group.userData.playable,table.playable);}
  assert.ok(hall.getObjectByName('hall-glass-sunroof'));
  hall.traverse(o=>{assert.ok(o.position.toArray().every(Number.isFinite));if(o.geometry?.attributes.position)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));});
});

test('hall robots show multiplayer walking positions, identity and distinct seated positions',()=>{
  const hall=buildCasinoHall();
  const a={id:'a',name:'Ada',x:2,z:9,heading:1,tableId:null},b={id:'b',name:'Can',x:4,z:3,heading:0,tableId:'roulette'};
  updateCasinoHall(hall,{meId:'a',players:[a,b,{...b,id:'c'}]});
  const records=hall.userData.players;
  assert.equal(records.size,3);assert.equal(records.get('a').group.position.x,2);assert.equal(records.get('a').group.userData.isLocal,true);
  assert.equal(records.get('b').sitting,true);assert.notDeepEqual(records.get('b').group.position.toArray(),records.get('c').group.position.toArray());
  updateCasinoHall(hall,{meId:'a',players:[a]});assert.equal(records.size,1);
  updateCasinoHall(hall,{players:[null,{id:'bad',x:Infinity,z:0}]});assert.equal(records.size,0);
});

test('walking is bounded, speed-normalized, table-blocked and rejects malformed input',()=>{
  const straight=moveCasinoWalker({x:0,z:10},{x:1,z:0},.1),diagonal=moveCasinoWalker({x:0,z:10},{x:1,z:1},.1);
  assert.ok(Math.abs(Math.hypot(straight.x,straight.z-10)-Math.hypot(diagonal.x,diagonal.z-10))<1e-9);
  const bounded=moveCasinoWalker({x:13,z:12},{x:1,z:1},1);assert.equal(bounded.x,13);assert.equal(bounded.z,12);
  const blocked=moveCasinoWalker({x:0,z:8.7},{x:0,z:-1},.1);assert.ok(Math.hypot(blocked.x,blocked.z-6)>=2.65-1e-9);
  assert.ok(Object.values(moveCasinoWalker(null,{x:NaN,z:Infinity},NaN)).every(Number.isFinite));
});

test('table interaction requires proximity and never selects decorative tables',()=>{
  assert.equal(nearestCasinoTable({x:0,z:10}).id,'poker');
  assert.equal(nearestCasinoTable({x:0,z:-10}),null);
  assert.equal(nearestCasinoTable({x:-9,z:8}),null);
  assert.equal(nearestCasinoTable({x:NaN,z:0}),null);
  const selected=[],scene=new KatlayanziScene({onTable:id=>selected.push(id)});
  scene.setWalking(true);assert.equal(scene.interact(),'poker');assert.deepEqual(selected,['poker']);
  scene.setWalking(false);assert.equal(scene.interact(),null);scene.dispose();
});

test('walking scene preserves local prediction, stops input on mode change, and disposes hall',()=>{
  const scene=new KatlayanziScene();scene.setLobby({meId:'a',players:[{id:'a',x:0,z:10,heading:0}]});scene.setWalking(true);
  scene.localPosition.x=.5;scene.setLobby({meId:'a',players:[{id:'a',x:0,z:10,heading:0}]});assert.equal(scene.localPosition.x,.5);
  scene.setMoveInput({x:1,z:-1});scene.setWalking(false);assert.deepEqual(scene.moveInput,{x:0,z:0});
  assert.equal(scene.lounge.visible,true);assert.equal(scene.hall.visible,false);
  scene.dispose();assert.equal(scene.hall.children.length,0);scene.setLobby({players:[]});assert.equal(scene.hall.children.length,0);
});

test('walking updates publish at most ten times per second and flush the final stopped pose',()=>{
  const updates=[],scene=new KatlayanziScene({onMove:pose=>updates.push(pose)});
  scene.setLobby({meId:'a',players:[{id:'a',x:0,z:10,heading:0}]});scene.setWalking(true);scene.setMoveInput({x:1,z:0});
  for(let now=0;now<=95;now+=5)scene._walkStep(now);
  assert.equal(updates.length,1);
  scene.setMoveInput({x:0,z:0});scene._walkStep(105);
  assert.equal(updates.length,2);assert.equal(updates[1].x,scene.localPosition.x);
  scene._walkStep(210);assert.equal(updates.length,2);scene.dispose();
});

test('repeated walking state preserves held input and movement clock across network snapshots',()=>{
  const scene=new KatlayanziScene();scene.setWalking(true);scene.setMoveInput({x:1,z:0});scene.lastStep=123;
  scene.setWalking(true);assert.deepEqual(scene.moveInput,{x:1,z:0});assert.equal(scene.lastStep,123);scene.dispose();
});

test('front edge columns stay out of the third-person entrance camera path',()=>{
  const hall=buildCasinoHall();let centralFront=0;
  hall.traverse(object=>{if(object.name==='hall-column'&&object.position.z>10&&Math.abs(object.position.x)<13)centralFront++;});
  assert.equal(centralFront,0);
});

test('remote hall robots interpolate snapshots and heading along the shortest arc',async()=>{
  const {animateCasinoHall}=await import('../src/katlayanzi-scene.js');
  const hall=buildCasinoHall(),player={id:'remote',x:3,z:10,heading:3.1,tableId:null};
  updateCasinoHall(hall,{meId:'local',players:[player]},0);
  const record=hall.userData.players.get('remote');
  updateCasinoHall(hall,{meId:'local',players:[{...player,x:4,heading:-3.1}]},100);
  assert.equal(record.group.position.x,3);
  animateCasinoHall(hall,.05,150);
  assert.ok(record.group.position.x>3&&record.group.position.x<4);
  assert.ok(record.group.rotation.y>3.1,'takes short arc across PI');
  assert.notEqual(record.robot.userData.rig.leftLeg.rotation.x,0);
  updateCasinoHall(hall,{meId:'local',players:[{...player,x:4,heading:-3.1}]},300);
  animateCasinoHall(hall,.05,400);
  assert.equal(record.robot.userData.rig.leftLeg.rotation.x,0,'stale motion stops despite heartbeats');
});

test('remote interpolation preserves local prediction and seated poses',async()=>{
  const {animateCasinoHall}=await import('../src/katlayanzi-scene.js');
  const hall=buildCasinoHall();updateCasinoHall(hall,{meId:'local',players:[{id:'local',x:0,z:10,heading:0},{id:'seat',x:3,z:10,heading:0,tableId:'poker'}]},0);
  const own=hall.userData.players.get('local'),seated=hall.userData.players.get('seat');
  own.group.position.x=1;const before=seated.group.position.toArray();animateCasinoHall(hall,.1,200);
  assert.equal(own.group.position.x,1);assert.deepEqual(seated.group.position.toArray(),before);
  assert.equal(seated.robot.userData.rig.leftLeg.rotation.x,-1.45);
});

test('seated table view excludes walking spectators and refreshes when lobby occupancy changes',()=>{
  const scene=new KatlayanziScene(),view={game:'poker',phase:'betting',round:1,meId:'host',players:[{id:'host',name:'Host',hand:[]},{id:'guest',name:'Guest',hand:[]}],dealer:[]};
  scene.update(view);assert.equal(scene.lounge.userData.players.size,2,'legacy view has no lobby filter');
  scene.setLobby({meId:'host',players:[{id:'host',x:0,z:10,heading:0,tableId:null},{id:'guest',x:0,z:9,heading:0,tableId:'poker'}]});
  assert.equal(scene.lounge.userData.players.has('host'),false);assert.equal(scene.lounge.userData.players.has('guest'),true);
  assert.equal(scene.view,view);assert.equal(scene.view.players.length,2,'original private view is preserved');
  scene.setLobby({meId:'host',players:[{id:'host',x:0,z:10,heading:0,tableId:null},{id:'guest',x:0,z:9,heading:0,tableId:null}]});
  assert.equal(scene.lounge.userData.players.size,0);scene.dispose();
});

test('decorative tables have six cosmetic seated guests outside multiplayer membership',async()=>{
  const {animateCasinoHall}=await import('../src/katlayanzi-scene.js');
  const hall=buildCasinoHall(),guests=hall.userData.ambientGuests;
  assert.equal(guests.length,6);assert.equal(hall.userData.players.size,0);
  for(const table of hall.userData.tables.filter(table=>!table.playable)){
    const seated=guests.filter(guest=>guest.group.userData.tableId===table.id);
    assert.equal(seated.length,3);
    for(const guest of seated){assert.equal(guest.group.userData.ambient,true);assert.equal(guest.group.userData.peerId,undefined);assert.equal(guest.robot.userData.rig.leftLeg.rotation.x,-1.45);assert.equal(guest.group.parent.name,`hall-table-${table.id}`);}
  }
  updateCasinoHall(hall,{meId:'a',players:[{id:'a',x:0,z:10,heading:0,tableId:null}]});
  updateCasinoHall(hall,{players:[]});assert.equal(hall.userData.players.size,0);assert.equal(hall.userData.ambientGuests.length,6);
  animateCasinoHall(hall,.1,800);assert.notEqual(guests[0].robot.userData.rig.head.rotation.y,0);
  animateCasinoHall(hall,.1,800,true);assert.equal(guests[0].robot.userData.rig.head.rotation.y,0);
});

test('seated view keeps the hall context at the selected physical table without duplicate avatars',()=>{
  const scene=new KatlayanziScene(),players=[{id:'me',name:'You',x:0,z:10,heading:0,tableId:'poker'},{id:'friend',name:'Friend',x:1,z:10,heading:0,tableId:'poker'},{id:'walker',name:'Walker',x:4,z:8,heading:0,tableId:null}];
  scene.update({game:'poker',phase:'betting',round:1,meId:'me',players:players.map(p=>({...p,hand:[]})),dealer:[]});
  scene.setLobby({meId:'me',players});
  assert.equal(scene.hall.visible,true);assert.equal(scene.lounge.visible,true);
  assert.deepEqual(scene.lounge.position.toArray(),[0,0,6]);
  assert.equal(scene.hall.getObjectByName('hall-table-poker').visible,false);
  assert.equal(scene.hall.getObjectByName('hall-table-roulette').visible,true);
  assert.equal(scene.lounge.getObjectByName('lounge-floor').visible,false);
  assert.equal(scene.lounge.getObjectByName('oval-wood-table').visible,true);
  assert.equal(scene.hall.userData.players.get('me').group.visible,false);
  assert.equal(scene.hall.userData.players.get('friend').group.visible,false);
  assert.equal(scene.hall.userData.players.get('walker').group.visible,true);
  assert.equal(scene.lounge.userData.players.size,2);
  assert.ok(scene.camera.position.z>6);
  scene.setWalking(true);
  assert.equal(scene.lounge.visible,false);assert.equal(scene.hall.visible,true);
  assert.equal(scene.hall.getObjectByName('hall-table-poker').visible,true);
  assert.equal(scene.hall.userData.players.get('friend').group.visible,true);
  assert.deepEqual(scene.lounge.position.toArray(),[0,0,0]);
  scene.dispose();assert.equal(scene.hall.children.length,0);
});

test('switching the selected seated table moves detailed geometry and its camera together',()=>{
  const scene=new KatlayanziScene(),me={id:'a',x:0,z:10,heading:0,tableId:'blackjack'};
  scene.setLobby({meId:'a',players:[me]});
  assert.deepEqual(scene.lounge.position.toArray(),[-6,0,-3]);
  const cameraX=scene.camera.position.x,cameraZ=scene.camera.position.z;
  scene.setLobby({meId:'a',players:[{...me,tableId:'roulette'}]});
  assert.deepEqual(scene.lounge.position.toArray(),[6,0,-3]);
  assert.ok(scene.camera.position.x>cameraX&&scene.camera.position.x-cameraX<=12);assert.equal(scene.camera.position.z,cameraZ);
  assert.equal(scene.hall.getObjectByName('hall-table-blackjack').visible,true);
  assert.equal(scene.hall.getObjectByName('hall-table-roulette').visible,false);
  scene.dispose();
});


test('seated cameras stay inside hall walls and below roof for every game and aspect ratio',()=>{
  const scene=new KatlayanziScene();
  for(const aspect of [.65,1.3,2])for(const tableId of ['blackjack','roulette','poker']){
    scene.camera.aspect=aspect;
    scene.setLobby({meId:'a',players:[{id:'a',x:0,z:10,heading:0,tableId}]});
    const p=scene.camera.position;
    assert.ok(p.x>=-13&&p.x<=13);assert.ok(p.z>=-10&&p.z<=13);assert.ok(p.y>1&&p.y<=6.8);
    assert.ok(p.toArray().every(Number.isFinite));
  }
  scene.dispose();
});
