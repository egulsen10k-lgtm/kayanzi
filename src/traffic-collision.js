const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const axes = heading => [[Math.cos(heading), -Math.sin(heading)], [Math.sin(heading), Math.cos(heading)]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1];

// Separating-axis contact between two oriented vehicle footprints, in metres.
export function vehicleContact(player, car) {
  if (Math.abs((player.roadHeight ?? .08)-car.roadHeight)>.8) return null;
  const delta=[car.x-player.x,car.y-player.y];
  if(Math.hypot(...delta)>5)return null;
  const a=axes(player.heading??0),b=axes(car.heading??0);
  let depth=Infinity,normal=null;
  for(const axis of [...a,...b]) {
    const radiusA=.93*Math.abs(dot(a[0],axis))+2.25*Math.abs(dot(a[1],axis));
    const radiusB=.92*Math.abs(dot(b[0],axis))+2.1*Math.abs(dot(b[1],axis));
    const overlap=radiusA+radiusB-Math.abs(dot(delta,axis));
    if(overlap<=0)return null;
    if(overlap<depth){depth=overlap;const sign=dot(delta,axis)>=0?1:-1;normal=axis.map(n=>n*sign);}
  }
  return {depth,normal};
}

export function resolveTrafficContact(player, car) {
  const contact=vehicleContact(player,car);if(!contact)return false;
  const [nx,ny]=contact.normal,forward=[Math.sin(player.heading??0),Math.cos(player.heading??0)];
  const velocity=[forward[0]*player.speed/3.6,forward[1]*player.speed/3.6];
  const ai=[Math.sin(car.heading)*car.speed/3.6,Math.cos(car.heading)*car.speed/3.6];
  const tv=[(car.vx??0)+ai[0],(car.vy??0)+ai[1]];
  const relative=(velocity[0]-tv[0])*nx+(velocity[1]-tv[1])*ny;
  // Separate the bodies even at rest. Never pin the player's speed to zero.
  const separation=contact.depth+.015;
  car.offsetX=(car.offsetX??0)+nx*separation;car.offsetY=(car.offsetY??0)+ny*separation;
  car.x+=nx*separation;car.y+=ny*separation;
  car.impactTime=0;
  if(relative<=0)return true; // Reversing/moving away must stay possible.
  const massPlayer=1750,massTraffic=1550,inertia=massTraffic*(4.2**2+1.84**2)/12;
  const right=axes(car.heading)[0],along=axes(car.heading)[1];
  const delta=[player.x-car.x,player.y-car.y];
  const side=clamp(dot(delta,right),-.92,.92),front=clamp(dot(delta,along),-2.1,2.1);
  const rx=right[0]*side+along[0]*front,ry=right[1]*side+along[1]*front;
  const torque=rx*ny-ry*nx;
  const impulse=1.08*relative/(1/massPlayer+1/massTraffic+torque*torque/inertia);
  car.vx=tv[0]+nx*impulse/massTraffic;car.vy=tv[1]+ny*impulse/massTraffic;
  car.angularVelocity=clamp((car.angularVelocity??0)-torque*impulse/inertia,-2.5,2.5);
  car.speed=0;
  player.speed-=impulse/massPlayer*(nx*forward[0]+ny*forward[1])*3.6;
  return true;
}

export function integrateTrafficImpact(car,dt,distanceToPlayer) {
  car.impactTime=(car.impactTime??100)+dt;
  car.offsetX=(car.offsetX??0)+(car.vx??0)*dt;
  car.offsetY=(car.offsetY??0)+(car.vy??0)*dt;
  car.yawOffset=(car.yawOffset??0)+(car.angularVelocity??0)*dt;
  const friction=Math.exp(-1.7*dt);
  car.vx=(car.vx??0)*friction;car.vy=(car.vy??0)*friction;
  car.angularVelocity=(car.angularVelocity??0)*Math.exp(-3*dt);
  // The AI gradually rejoins its lane only once the impact settles and the
  // player is clear. Displacement is not overwritten by the next route update.
  if(car.impactTime>4 && distanceToPlayer>12) {
    const recover=Math.exp(-.35*dt);
    car.offsetX*=recover;car.offsetY*=recover;car.yawOffset*=recover;
  }
}
