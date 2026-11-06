// Simplified road-load/power model. Capacities and reference economy use BMW data;
// drag, rolling resistance and efficiencies are game approximations (see docs/energy-model.md).
const DEFAULT_MODEL='M3 Competition';
const PETROL_KWH_PER_LITRE=8.9;
const MIN_DT=1e-6;
const MAX_DT=3600;
const MAX_PAYLOAD_KG=10000;
const MAX_RATE=10000;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>{
  try { const number=Number(value); return Number.isFinite(number)?number:fallback; }
  catch { return fallback; }
};
const input=(object,key,fallback)=>{
  try { return object?.[key] ?? fallback; }
  catch { return fallback; }
};
const modelName=model=>typeof model==='string'&&model.trim()?model:DEFAULT_MODEL;
const boundedRemaining=(remaining,capacity)=>clamp(finite(remaining,capacity),0,capacity);

export function energyProfile(model=DEFAULT_MODEL) {
  model=modelName(model);
  if(/i4|EV/i.test(model))return {electric:true,capacity:81.1,mass:2290,dragArea:.60,rolling:.011,peakKW:400,idle:.6,reference:20.5};
  if(/M5|XM/i.test(model))return {electric:false,capacity:68,mass:1900,dragArea:.80,rolling:.012,peakKW:467,idle:1.3,reference:11.1};
  if(/M4/i.test(model))return {electric:false,capacity:59,mass:1670,dragArea:.72,rolling:.012,peakKW:405,idle:.95,reference:9.9};
  return {electric:false,capacity:59,mass:1800,dragArea:.75,rolling:.012,peakKW:375,idle:1,reference:10.2};
}
export class FuelEconomy {
  constructor(model=DEFAULT_MODEL) {
    model=modelName(model);this.model=model;this.profile=energyProfile(model);this.electric=this.profile.electric;
    this.capacity=this.profile.capacity;this.remaining=this.capacity;this.distanceKm=0;this.used=0;
    this.rate=0;this.displayRate=0;this.elapsed=0;this.lastSpeed=null;this.speed=0;this.rangeEconomy=this.profile.reference;
  }
  setModel(model) {
    const currentCapacity=finite(this.capacity,this.profile.capacity),fraction=boundedRemaining(this.remaining,currentCapacity)/currentCapacity;
    const profile=energyProfile(model);
    if(profile.electric!==this.electric){this.distanceKm=0;this.used=0;}
    this.model=modelName(model);this.profile=profile;this.electric=profile.electric;this.capacity=profile.capacity;
    this.remaining=clamp(this.capacity*fraction,0,this.capacity);this.rate=0;this.displayRate=0;this.lastSpeed=null;this.elapsed=0;this.rangeEconomy=profile.reference;
  }
  update(dt,state={},distanceKm,motion={}) {
    dt=finite(dt,0);if(dt<=0)return;
    dt=clamp(dt,MIN_DT,MAX_DT);
    const stateInput=state&&typeof state==='object'?state:{};
    const motionInput=motion&&typeof motion==='object'?motion:{};
    const capacity=finite(this.capacity,this.profile.capacity);
    this.capacity=capacity;this.remaining=boundedRemaining(this.remaining,capacity);
    this.used=finite(this.used,0);this.distanceKm=clamp(finite(this.distanceKm,0),0,Number.MAX_SAFE_INTEGER);
    this.rangeEconomy=clamp(finite(this.rangeEconomy,this.profile.reference),0,MAX_RATE);
    const signedSpeed=finite(input(stateInput,'speed',0)),speed=Math.abs(signedSpeed),v=speed/3.6;
    const throttle=clamp(finite(input(stateInput,'throttle',0)), -1, 1);
    this.speed=signedSpeed;this.elapsed=clamp(finite(this.elapsed,0)+dt,0,1e9);
    const braking=(throttle<0&&signedSpeed>0)||(throttle>0&&signedSpeed<0);
    const load=braking?0:Math.abs(throttle),p=this.profile;
    const measuredAcceleration=finite(input(motionInput,'acceleration',NaN),NaN);
    let acceleration=Number.isFinite(measuredAcceleration)?measuredAcceleration:this.lastSpeed===null?0:(speed-this.lastSpeed)/3.6/dt;
    if(!Number.isFinite(measuredAcceleration)&&braking)acceleration=Math.min(acceleration,-Math.min(4,Math.abs(throttle)*5));
    acceleration=clamp(finite(acceleration,0),-10,12);this.lastSpeed=speed;
    const payload=clamp(finite(input(stateInput,'payloadKg',0)),0,MAX_PAYLOAD_KG);
    const mass=p.mass+payload,grade=clamp(finite(input(motionInput,'grade',0)),-.15,.15);
    const rolling=mass*9.81*p.rolling,drag=.5*1.225*p.dragArea*v*v;
    const wheelKW=(rolling+drag+mass*acceleration+mass*9.81*grade)*v/1000;
    const driveMode=input(stateInput,'driveMode','Normal');
    const mode=driveMode==='Sport+'?1.05:driveMode==='Sport'?1.025:1;
    let rate;
    if(this.electric) {
      // Regeneration recovers part of actual braking work; taper near full charge and rest.
      const regenLimit=195*clamp(speed/15,0,1)*clamp((100-this.percent)/10,0,1);
      const demand=wheelKW<0&&!input(stateInput,'handbrake',false)?-Math.min(-wheelKW*.7,regenLimit):Math.max(0,wheelKW)/.90;
      rate=p.idle+(demand>0?Math.min(p.peakKW/.9,demand)*mode:demand);
    } else {
      const inGear=input(stateInput,'driveGear',null)!=='N';
      const fuelCut=load===0&&speed>8&&inGear;
      if(fuelCut)rate=0;
      else {
        const accessoryKW=1.1,revvingKW=v<1?load*load*p.peakKW*.025:0;
        const lockedAxleKW=input(stateInput,'handbrake',false)?load*p.peakKW*.08:0;
        const nitro=Boolean(input(stateInput,'nitroEngaged',false));
        const engineKW=clamp(Math.max(0,wheelKW)/.87+accessoryKW+revvingKW+lockedAxleKW,0,p.peakKW*(nitro?1.15:1));
        const efficiency=.19+.15*(1-Math.exp(-engineKW/p.peakKW*7));
        const rpmLoss=1+clamp((clamp(finite(input(stateInput,'rpm',2000)),0,30000)-2500)/45000,0,.12);
        const cold=1+.12*180/dt*(Math.exp(-(this.elapsed-dt)/180)-Math.exp(-this.elapsed/180));
        // Idle flow already includes accessories, so don't charge for them twice at rest.
        rate=(p.idle+Math.max(0,engineKW-accessoryKW)/(PETROL_KWH_PER_LITRE*efficiency))*mode*rpmLoss*cold*(nitro?1.08:1);
      }
    }
    rate=clamp(finite(rate,0),-MAX_RATE,MAX_RATE);
    if(this.remaining<=0&&rate>0)rate=0;
    if(this.remaining>=this.capacity&&rate<0)rate=0;
    if(this.electric&&this.remaining>=this.capacity&&wheelKW<0&&!input(stateInput,'handbrake',false))rate=0;
    const before=this.remaining;this.remaining=clamp(before-rate*dt/3600,0,this.capacity);
    const consumed=before-this.remaining,km=clamp(finite(distanceKm,0),0,Number.MAX_SAFE_INTEGER);
    this.used=finite(this.used+consumed,0);this.distanceKm=clamp(this.distanceKm+km,0,Number.MAX_SAFE_INTEGER);this.rate=clamp(finite(consumed/dt*3600,0),-MAX_RATE,MAX_RATE);
    this.displayRate=clamp(finite(this.displayRate,0),-MAX_RATE,MAX_RATE);
    this.displayRate=clamp(this.displayRate+(this.rate-this.displayRate)*(1-Math.exp(-dt/.6)),-MAX_RATE,MAX_RATE);
    if(km>0){const sample=clamp(consumed/km*100,0,p.reference*5),weight=1-Math.exp(-km/2);this.rangeEconomy=clamp(this.rangeEconomy+(sample-this.rangeEconomy)*weight,0,MAX_RATE);}
  }
  get percent(){return boundedRemaining(this.remaining,this.capacity)/this.capacity*100;}
  get average(){const distance=clamp(finite(this.distanceKm,0),0,Number.MAX_SAFE_INTEGER);return distance>=.05?Math.max(0,finite(this.used,0))/distance*100:null;}
  get instantaneous(){const speed=Math.abs(finite(this.speed,0));return speed>5?clamp(finite(this.rate,0),-MAX_RATE,MAX_RATE)/speed*100:null;}
  get rangeKm(){const remaining=boundedRemaining(this.remaining,this.capacity),economy=Math.max(this.profile.reference*.6,clamp(finite(this.rangeEconomy,this.profile.reference),0,MAX_RATE));return remaining/economy*100;}
  refuel(speed=0){if(typeof speed!=='number'||!Number.isFinite(speed)||speed<0||speed>1)return false;this.remaining=this.capacity;return true;}
  readout(speed=0) {
    const valueSpeed=finite(speed,0),moving=Math.abs(valueSpeed)>5,value=moving?clamp(finite(this.displayRate,0),-MAX_RATE,MAX_RATE)/Math.abs(valueSpeed)*100:clamp(finite(this.displayRate,0),-MAX_RATE,MAX_RATE);
    return `${finite(value,0).toFixed(1)} ${moving?(this.electric?'kWh/100 km':'L/100 km'):(this.electric?'kW':'L/h')}`;
  }
}
