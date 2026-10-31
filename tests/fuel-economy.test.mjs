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
function warmRate(model,speed,motion={acceleration:0,grade:0},extra={}) {
 const f=new FuelEconomy(model);f.elapsed=900;
 f.update(.1,{speed,throttle:.3,rpm:2000,driveGear:'D',driveMode:'Normal',...extra},speed/3600*.1,motion);
 return f;
}
test('warm cruise consumption sits in realistic performance-car and EV ranges',()=>{
 const petrol=warmRate('M3 Competition',100),electric=warmRate('i4 M50 (EV)',100);
 assert.ok(petrol.instantaneous>7&&petrol.instantaneous<12);
 assert.ok(electric.instantaneous>14&&electric.instantaneous<22);
 assert.equal(electric.capacity,81.1,'battery should expose usable energy');
});
test('measured acceleration, hills and high speed increase actual energy demand',()=>{
 const cruise=warmRate('M3',80),accelerating=warmRate('M3',80,{acceleration:3,grade:0}),hill=warmRate('M3',80,{acceleration:0,grade:.06});
 assert.ok(accelerating.rate>cruise.rate*3);assert.ok(hill.rate>cruise.rate*1.5);
 assert.ok(warmRate('M3',180).instantaneous>warmRate('M3',100).instantaneous*1.5);
 assert.ok(warmRate('M5 CS',100).instantaneous>warmRate('M4 CSL',100).instantaneous);
});
test('neutral coasting keeps idle flow while in-gear overrun cuts fuel',()=>{
 const neutral=warmRate('M3',50,{acceleration:-.4,grade:0},{throttle:0,driveGear:'N'});
 const engaged=warmRate('M3',50,{acceleration:-.4,grade:0},{throttle:0,driveGear:'D'});
 assert.ok(neutral.rate>.5);assert.equal(engaged.rate,0);
});
test('regeneration is bounded by braking power and fades near a full battery',()=>{
 const sample=percent=>{const f=new FuelEconomy('i4 M50 (EV)');f.remaining=f.capacity*percent/100;f.update(.1,{speed:100,throttle:-1},.002,{acceleration:-8,grade:0});return f;};
 const low=sample(50),high=sample(99);
 assert.ok(low.rate<0&&low.rate>=-195);assert.ok(Math.abs(high.rate)<Math.abs(low.rate));
});
