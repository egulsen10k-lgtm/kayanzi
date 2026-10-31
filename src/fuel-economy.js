// Simplified road-load/power model. Capacities and reference economy use BMW data;
// drag, rolling resistance and efficiencies are game approximations (see docs/energy-model.md).
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const PETROL_KWH_PER_LITRE=8.9;
export function energyProfile(model='M3 Competition') {
  if(/i4|EV/i.test(model))return {electric:true,capacity:81.1,mass:2290,dragArea:.60,rolling:.011,peakKW:400,idle:.6,reference:20.5};
  if(/M5|XM/i.test(model))return {electric:false,capacity:68,mass:1900,dragArea:.80,rolling:.012,peakKW:467,idle:1.3,reference:11.1};
  if(/M4/i.test(model))return {electric:false,capacity:59,mass:1670,dragArea:.72,rolling:.012,peakKW:405,idle:.95,reference:9.9};
  return {electric:false,capacity:59,mass:1800,dragArea:.75,rolling:.012,peakKW:375,idle:1,reference:10.2};
}
export class FuelEconomy {
  constructor(model='M3 Competition') {
    this.model=model;this.profile=energyProfile(model);this.electric=this.profile.electric;
    this.capacity=this.profile.capacity;this.remaining=this.capacity;this.distanceKm=0;this.used=0;
    this.rate=0;this.displayRate=0;this.elapsed=0;this.lastSpeed=null;this.rangeEconomy=this.profile.reference;
  }
  setModel(model) {
    const fraction=this.remaining/this.capacity,profile=energyProfile(model);
    if(profile.electric!==this.electric){this.distanceKm=0;this.used=0;}
    this.model=model;this.profile=profile;this.electric=profile.electric;this.capacity=profile.capacity;
    this.remaining=this.capacity*fraction;this.rate=0;this.displayRate=0;this.lastSpeed=null;this.elapsed=0;this.rangeEconomy=profile.reference;
  }
  update(dt,state,distanceKm,motion={}) {
    if(!Number.isFinite(dt)||dt<=0)return;
    const signedSpeed=Number(state.speed)||0,speed=Math.abs(signedSpeed),v=speed/3.6,throttle=Number(state.throttle)||0;
    this.speed=signedSpeed;this.elapsed+=dt;
    const braking=(throttle<0&&signedSpeed>0)||(throttle>0&&signedSpeed<0);
    const load=braking?0:Math.abs(throttle),p=this.profile;
    let acceleration=Number.isFinite(motion.acceleration)?motion.acceleration:this.lastSpeed===null?0:(speed-this.lastSpeed)/3.6/dt;
    // Standalone callers without measured motion can still request braking.
    if(!Number.isFinite(motion.acceleration)&&braking)acceleration=Math.min(acceleration,-Math.min(4,Math.abs(throttle)*5));
    acceleration=clamp(acceleration,-10,12);this.lastSpeed=speed;
    const mass=p.mass+Math.max(0,Number(state.payloadKg)||0),grade=clamp(Number(motion.grade)||0,-.15,.15);
    const rolling=mass*9.81*p.rolling,drag=.5*1.225*p.dragArea*v*v;
    const wheelKW=(rolling+drag+mass*acceleration+mass*9.81*grade)*v/1000;
    const mode=state.driveMode==='Sport+'?1.05:state.driveMode==='Sport'?1.025:1;
    let rate;
    if(this.electric) {
      // Regeneration recovers part of actual braking work; taper near full charge and rest.
      const regenLimit=195*clamp(speed/15,0,1)*clamp((100-this.percent)/10,0,1);
      const demand=wheelKW<0&&!state.handbrake?-Math.min(-wheelKW*.7,regenLimit):Math.max(0,wheelKW)/.90;
      rate=p.idle+(demand>0?Math.min(p.peakKW/.9,demand)*mode:demand);
    } else {
      const inGear=state.driveGear!=='N';
      const fuelCut=load===0&&speed>8&&inGear;
      if(fuelCut)rate=0;
      else {
        const accessoryKW=1.1,revvingKW=v<1?load*load*p.peakKW*.025:0;
        const lockedAxleKW=state.handbrake?load*p.peakKW*.08:0;
        const engineKW=clamp(Math.max(0,wheelKW)/.87+accessoryKW+revvingKW+lockedAxleKW,0,p.peakKW*(state.nitroEngaged?1.15:1));
        const efficiency=.19+.15*(1-Math.exp(-engineKW/p.peakKW*7));
        const rpmLoss=1+clamp(((state.rpm??2000)-2500)/45000,0,.12);
        const cold=1+.12*180/dt*(Math.exp(-(this.elapsed-dt)/180)-Math.exp(-this.elapsed/180));
        // Idle flow already includes accessories, so don't charge for them twice at rest.
        rate=(p.idle+Math.max(0,engineKW-accessoryKW)/(PETROL_KWH_PER_LITRE*efficiency))*mode*rpmLoss*cold*(state.nitroEngaged?1.08:1);
      }
    }
    if(this.remaining<=0&&rate>0)rate=0;
    if(this.remaining>=this.capacity&&rate<0)rate=0;
    if(this.electric&&this.remaining>=this.capacity&&wheelKW<0&&!state.handbrake)rate=0;
    const before=this.remaining;this.remaining=clamp(before-rate*dt/3600,0,this.capacity);
    const consumed=before-this.remaining,km=Math.max(0,Number(distanceKm)||0);
    this.used+=consumed;this.distanceKm+=km;this.rate=consumed/dt*3600;
    this.displayRate+=(this.rate-this.displayRate)*(1-Math.exp(-dt/.6));
    if(km>0){const sample=clamp(consumed/km*100,0,p.reference*5),weight=1-Math.exp(-km/2);this.rangeEconomy+=(sample-this.rangeEconomy)*weight;}
  }
  get percent(){return this.remaining/this.capacity*100;}
  get average(){return this.distanceKm>=.05?Math.max(0,this.used)/this.distanceKm*100:null;}
  get instantaneous(){return Math.abs(this.speed??0)>5?this.rate/Math.abs(this.speed)*100:null;}
  get rangeKm(){return this.remaining/Math.max(this.profile.reference*.6,this.rangeEconomy)*100;}
  refuel(speed=0){if(Math.abs(speed)>1)return false;this.remaining=this.capacity;return true;}
  readout(speed=0) {
    const moving=Math.abs(speed)>5,value=moving?this.displayRate/Math.abs(speed)*100:this.displayRate;
    return `${value.toFixed(1)} ${moving?(this.electric?'kWh/100 km':'L/100 km'):(this.electric?'kW':'L/h')}`;
  }
}
