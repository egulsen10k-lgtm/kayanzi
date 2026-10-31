// Arcade energy model: consistent units and time steps, not manufacturer consumption claims.
export class FuelEconomy {
  constructor(model='M3 Competition'){this.model=model;this.electric=/EV|i4/i.test(model);this.capacity=this.electric?84:/M5|XM/.test(model)?68:59;this.remaining=this.capacity;this.distanceKm=0;this.used=0;this.rate=0;}
  setModel(model) {
    const fraction=this.remaining/this.capacity,electric=/EV|i4/i.test(model);
    if(electric!==this.electric){this.distanceKm=0;this.used=0;}
    this.model=model;this.electric=electric;this.capacity=electric?84:/M5|XM/.test(model)?68:59;this.remaining=this.capacity*fraction;this.rate=0;
  }
  update(dt,state,distanceKm) {
    if(!Number.isFinite(dt)||dt<=0)return;
    const speed=Math.abs(state.speed??0),throttle=state.throttle??0;
    this.speed=state.speed??0;
    const braking=(throttle<0&&(state.speed??0)>0)||(throttle>0&&(state.speed??0)<0);
    const load=braking?0:Math.abs(throttle),mode=state.driveMode==='Sport+'?1.22:state.driveMode==='Sport'?1.1:1;
    let rate;
    if(this.electric)rate=braking&&speed>5?-Math.min(40,speed*.35):.3+speed/100*(11+speed*speed*.001+load*load*14)*mode;
    else {
      const modelFactor=/M5|XM/.test(this.model)?1.3:/M4/.test(this.model)?1.08:1;
      rate=load===0&&speed>8?0:(.8+load*1.6+speed/100*(6.2+speed*speed*.00035+load*load*6))*mode*modelFactor*(state.nitroEngaged?1.5:1);
    }
    if(this.remaining<=0&&rate>0)rate=0;
    if(this.remaining>=this.capacity&&rate<0)rate=0;
    if(this.electric&&rate>0&&state.nitroEngaged)rate*=1.4;
    const before=this.remaining;this.remaining=Math.max(0,Math.min(this.capacity,before-rate*dt/3600));
    this.used+=before-this.remaining;this.distanceKm+=Math.max(0,Number(distanceKm)||0);this.rate=rate;
  }
  get percent(){return this.remaining/this.capacity*100;}
  get average(){return this.distanceKm>=.05?Math.max(0,this.used)/this.distanceKm*100:null;}
  get instantaneous(){return Math.abs(this.speed??0)>5?this.rate/Math.abs(this.speed)*100:null;}
  get rangeKm(){return this.remaining/Math.max(this.electric?12:5,this.distanceKm>.5?this.average??0:this.electric?20:9)*100;}
  refuel(speed=0){if(Math.abs(speed)>1)return false;this.remaining=this.capacity;return true;}
  readout(speed=0) {
    const moving=Math.abs(speed)>5,value=moving?this.rate/Math.abs(speed)*100:this.rate;
    return `${value.toFixed(1)} ${moving?(this.electric?'kWh/100 km':'L/100 km'):(this.electric?'kW':'L/h')}`;
  }
}
