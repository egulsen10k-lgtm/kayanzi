import test from 'node:test';
import assert from 'node:assert/strict';
import {FuelEconomy} from '../src/fuel-economy.js';
import {CarPhysics} from '../src/physics.js';
const state={speed:80,throttle:.3,driveMode:'Normal'};
function drive(model,mode='Normal',nitroEngaged=false){const f=new FuelEconomy(model);for(let i=0;i<600;i++)f.update(.1,{...state,driveMode:mode,nitroEngaged},80/3600*.1);return f;}
test('idling burns fuel but never invents distance or economy',()=>{
 const f=new FuelEconomy();f.update(600,{speed:0,throttle:0},0);
 assert.ok(f.remaining<f.capacity);assert.equal(f.distanceKm,0);assert.equal(f.average,null);assert.match(f.readout(0),/L\/h/);
});
test('Sport modes and nitro consume more fuel over the same trip',()=>{
 const normal=drive('M3'),sport=drive('M3','Sport'),plus=drive('M3','Sport+'),boost=drive('M3','Normal',true);
 assert.ok(normal.used<sport.used&&sport.used<plus.used);assert.ok(boost.used>normal.used);assert.ok(normal.average>0);assert.match(normal.readout(80),/L\/100 km/);
});
test('coasting cuts petrol flow and reverse acceleration still burns fuel',()=>{
 const f=new FuelEconomy();f.update(10,{speed:50,throttle:0},.1);assert.equal(f.rate,0);
 f.update(10,{speed:-20,throttle:-.6},.05);assert.ok(f.rate>0);
});
test('electric braking regenerates and cannot exceed battery capacity',()=>{
 const f=new FuelEconomy('i4 M50 (EV)');f.remaining=40;f.update(60,{speed:80,throttle:-.6},1);
 assert.ok(f.remaining>40);assert.ok(f.rate<0);assert.match(f.readout(80),/kWh\/100 km/);
 f.remaining=f.capacity;f.update(60,{speed:80,throttle:-.6},1);assert.equal(f.remaining,f.capacity);
});
test('consumption is independent of frame size',()=>{
 const a=new FuelEconomy(),b=new FuelEconomy();
 for(let i=0;i<600;i++)a.update(.1,state,80/3600*.1);
 for(let i=0;i<3000;i++)b.update(.02,state,80/3600*.02);
 assert.ok(Math.abs(a.remaining-b.remaining)<1e-8);assert.ok(Math.abs(a.distanceKm-b.distanceKm)<1e-8);
});
test('empty tank prevents acceleration; refueling requires stopping',()=>{
 const car=new CarPhysics();car.roadConstrained=false;car.energy.remaining=0;car.keys={KeyW:true};
 for(let i=0;i<60;i++)car.update(1/60);assert.equal(car.speed,0);assert.equal(car.nitroEngaged,false);
 assert.equal(car.energy.refuel(20),false);assert.equal(car.energy.refuel(0),true);
 for(let i=0;i<60;i++)car.update(1/60);assert.ok(car.speed>0);assert.ok(car.energy.remaining<car.energy.capacity);
});
test('model switches preserve the percentage and teleport cannot refill fuel',()=>{
 const car=new CarPhysics();car.energy.remaining=car.energy.capacity*.5;car.setModel('i4 M50 (EV)');
 assert.equal(car.energy.percent,50);assert.equal(car.energy.electric,true);
 car.teleport(0,0);assert.equal(car.energy.percent,50);assert.equal(car.energy.distanceKm,0);
});
