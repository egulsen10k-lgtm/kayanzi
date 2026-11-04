export const RUNNER_LANES = [-4, 0, 4];
export const TRUCK_ROOF_HEIGHT = 2.25;
export const LOW_OBSTACLE_HEIGHT = 1.55;
export const SLIDE_DURATION = .72;
export const ROADSTER_HEIGHT = 2.8;
export const ROLL_DURATION = .68;
export const BASE_SPEED = 7.2;
export const POWERUP_WRENCH = 'wrench';
export const POWERUP_ROCKET = 'rocket';

export function isSingleLaneFree(row) {
  const obstacles=[...(row?.trucks??[]),...(row?.lowObstacles??[]),...(row?.roadsters??[])];
  const blocked=new Set(obstacles.map(item=>item.lane));
  return [0,1,2].filter(lane=>!blocked.has(lane)).length===1;
}

export class RunnerGame {
  constructor(random = Math.random) {
    this.random = random;
    this.reset();
  }

  reset() {
    this.lane = 1;
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.roof = null;
    this.sliding = false;
    this.slideTimer = 0;
    this.rolling = false;
    this.rollTimer = 0;
    this.rollAngle = 0;
    this.trucks = [];
    this.lowObstacles = [];
    this.roadsters = [];
    this.pickups = [];
    this.powerups = [];
    this.rocketTimer = 0;
    this.distance = 0;
    this.score=0;
    this.combo=0;
    this.comboTimer=0;
    this.comboChangeEvent=null;
    this.trickFlip=false;
    this.trickSpin=false;
    this.trickEvent=null;
    this.collected = 0;
    this.level = 1;
    this.lives = 3;
    this.invulnerable = 0;
    this.spawnDistance = 0;
    this.nextId = 1;
    this.highLevelRows=0;
    this.gauntletGraceTimer=0;
    this.lastRowSpeed=BASE_SPEED;
    this.over = false;
    this.spawnRow(-33);
    this.spawnRow(-62);
  }

  move(direction) {
    if (this.over) return false;
    const next = Math.max(0, Math.min(2, this.lane + Math.sign(direction)));
    if (next === this.lane) return false;
    this.lane = next;
    return true;
  }

  jump() {
    if (this.over || this.sliding || (this.y > .03 && !this.roof) || this.vy > 0) return false;
    this.roof = null;
    this.vy = 12.5;
    return true;
  }

  trickInput(type) {
    if(this.over||this.y<=.15)return false;
    if(type==='flip')this.trickFlip=true;
    else if(type==='spin')this.trickSpin=true;
    else return false;
    return true;
  }

  slide() {
    if (!this.roll()) return false;
    this.sliding = true;
    this.slideTimer = SLIDE_DURATION;
    return true;
  }

  roll() {
    if (this.over || this.y > .03 || this.roof) return false;
    this.rolling = true;
    this.rollTimer = ROLL_DURATION;
    this.rollAngle = 0;
    return true;
  }

  spawnRow(z = -66) {
    const lane = Math.floor(this.random() * 3);
    const id = this.nextId++;
    const levelScale = 1 + (this.level - 1) / 9 * 0.5;
    const row={id,z,gauntlet:false,trucks:[],lowObstacles:[],roadsters:[]};
    const truck={ id, lane, z, length: 9, hit: false, roll: 0, rollVelocity: 0 };
    this.trucks.push(truck);row.trucks.push(truck);
    this.pickups.push({ id:this.nextId++, lane, z:z - 1.2, y:TRUCK_ROOF_HEIGHT, truckId:id, taken:false });
    if (this.random() > (1 - 0.65 * levelScale)) {const obstacle={
      id: this.nextId++, lane: (lane + 1 + Math.floor(this.random() * 2)) % 3,
      z: z - 7, length: 2.2, height: LOW_OBSTACLE_HEIGHT, hit: false
    };this.lowObstacles.push(obstacle);row.lowObstacles.push(obstacle);}
    if (this.random() > (1 - 0.35 * levelScale)) {const roadster={
      id: this.nextId++, lane: (lane + 2) % 3, z: z - 16,
      length: 4.8, height: ROADSTER_HEIGHT, hit: false, roll: 0
    };this.roadsters.push(roadster);row.roadsters.push(roadster);}
    let gauntlet=false;
    if(this.level>=6){this.highLevelRows++;gauntlet=this.highLevelRows%5===0;}
    row.gauntlet=gauntlet;
    const blockedLanes=()=>new Set([...row.trucks,...row.lowObstacles,...row.roadsters].map(item=>item.lane));
    if(gauntlet){
      while(blockedLanes().size>2){const remove=row.roadsters.pop()??row.lowObstacles.pop();if(!remove)break;this.roadsters=this.roadsters.filter(item=>item!==remove);this.lowObstacles=this.lowObstacles.filter(item=>item!==remove);}
      if(blockedLanes().size<2){const free=[0,1,2].find(candidate=>!blockedLanes().has(candidate));const obstacle={id:this.nextId++,lane:free,z:z-7,length:2.2,height:LOW_OBSTACLE_HEIGHT,hit:false};this.lowObstacles.push(obstacle);row.lowObstacles.push(obstacle);}
      this.gauntletGraceTimer=.4;
    }else{
      while(blockedLanes().size>1){const remove=row.roadsters.pop()??row.lowObstacles.pop();if(!remove)break;this.roadsters=this.roadsters.filter(item=>item!==remove);this.lowObstacles=this.lowObstacles.filter(item=>item!==remove);}
    }
    const openLane = (lane + 1 + Math.floor(this.random() * 2)) % 3;
    this.pickups.push({ id:this.nextId++, lane:openLane, z:z + 2.5, y:0, truckId:null, taken:false });
    const addPowerup = type => {
      const occupied = new Set([...this.trucks, ...this.lowObstacles].map(item => item.lane));
      const available = [0, 1, 2].filter(candidate => !occupied.has(candidate) &&
        !this.powerups.some(item => item.lane === candidate && Math.abs(item.z - z) < 24));
      if (!available.length) return;
      const powerLane = available[Math.floor(this.random() * available.length)];
      this.powerups.push({ id: this.nextId++, type, lane: powerLane, z: z - 22 });
    };
    if (this.random() < .06) addPowerup(POWERUP_WRENCH);
    if (this.random() < .04) addPowerup(POWERUP_ROCKET);
    return row;
  }

  setCombo(value) {
    const combo=Math.max(0,Math.min(8,Math.floor(value)));
    if(combo!==this.combo){this.combo=combo;this.comboChangeEvent={combo};}
  }
  recordAvoidance(obstacle) {
    if(obstacle.hit||obstacle.comboPassed)return;
    obstacle.comboPassed=true;this.setCombo(this.combo+1);this.comboTimer=1.5;
  }

  update(dt) {
    if (this.over) return;
    dt = Math.max(0, Math.min(.05, Number.isFinite(dt) ? dt : 0));
    this.trickEvent=null;
    const wasAirborne=this.y>.03;
    if(this.combo>0){this.comboTimer=Math.max(0,this.comboTimer-dt);if(this.comboTimer<=0)this.setCombo(0);}
    const speed = Math.min(25, BASE_SPEED + (this.level - 1) * 0.18 + this.distance / 500);
    const grace=this.gauntletGraceTimer>0;
    const rowSpeed = speed * (this.rocketTimer > 0 ? 1.6 : 1) * (grace?.5:1);
    this.lastRowSpeed=rowSpeed;
    this.gauntletGraceTimer=Math.max(0,this.gauntletGraceTimer-dt);
    this.distance += rowSpeed * dt;
    this.score+=rowSpeed*dt*(1+this.combo*.15);
    this.level = Math.min(10, Math.max(this.level, Math.floor(this.distance / 500) + 1));
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.slideTimer = Math.max(0, this.slideTimer - dt);
    this.sliding = this.slideTimer > 0;
    this.rollTimer = Math.max(0, this.rollTimer - dt);
    this.rolling = this.rollTimer > 0;
    if (this.rolling) this.rollAngle += dt * 14;
    this.x += (RUNNER_LANES[this.lane] - this.x) * Math.min(1, dt * 13);
    const previouslyAboveRoof = this.y >= TRUCK_ROOF_HEIGHT - .18;
    this.vy -= 20 * dt;
    this.y += this.vy * dt;
    this.roof = null;
    for (const truck of this.trucks) {
      const previousZ=truck.z;
      truck.z += rowSpeed * dt;
      truck.rollVelocity *= Math.max(0, 1 - dt * 2.4);
      truck.roll += truck.rollVelocity * dt;
      const sameLane = Math.abs(this.x - RUNNER_LANES[truck.lane]) < 1.35;
      const overlap = Math.abs(truck.z) < truck.length / 2 + .35;
      if (sameLane && overlap) {
        if (previouslyAboveRoof && this.vy <= 0 && this.y <= TRUCK_ROOF_HEIGHT + .1) {
          this.y = TRUCK_ROOF_HEIGHT;
          this.vy = 0;
          this.roof = truck.id;
        } else if (this.y < TRUCK_ROOF_HEIGHT - .2 && this.invulnerable <= 0 && !truck.hit) {
          truck.hit = true;
          this.lives--;
          this.invulnerable = 1.3;
          this.y = 0;
          this.vy = 0;
          if (this.lives <= 0) this.over = true;
        }
      }
      if(!truck.hit&&previousZ<=truck.length/2+.35&&truck.z>truck.length/2+.35)this.recordAvoidance(truck);
    }
    if (this.y < 0) { this.y = 0; this.vy = 0; }
    if(wasAirborne&&this.y===0) {
      const types=[];if(this.trickFlip)types.push('flip');if(this.trickSpin)types.push('spin');
      if(types.length){const bonus=types.length*150;this.score+=bonus;this.trickEvent={types,bonus};}
      this.trickFlip=false;this.trickSpin=false;
    }
    for (const obstacle of this.lowObstacles) {
      const previousZ=obstacle.z;
      obstacle.z += rowSpeed * dt;
      const sameLane = Math.abs(this.x - RUNNER_LANES[obstacle.lane]) < 1.35;
      const overlap = Math.abs(obstacle.z) < obstacle.length / 2 + .65;
      if (sameLane && overlap && this.y < obstacle.height - .2 && !this.sliding && this.invulnerable <= 0 && !obstacle.hit) {
        obstacle.hit = true;
        this.lives--;
        this.invulnerable = 1.3;
        if (this.lives <= 0) this.over = true;
      }
      if(!obstacle.hit&&previousZ<=obstacle.length/2+.65&&obstacle.z>obstacle.length/2+.65)this.recordAvoidance(obstacle);
    }
    for (const roadster of this.roadsters) {
      const previousZ=roadster.z;
      roadster.z += rowSpeed * dt;
      roadster.roll += dt * 8;
      const sameLane = Math.abs(this.x - RUNNER_LANES[roadster.lane]) < 1.45;
      const overlap = Math.abs(roadster.z) < roadster.length / 2 + .45;
      if (sameLane && overlap && !roadster.hit) {
        roadster.hit = true;
        const truck = this.trucks.find(item => item.lane === roadster.lane && Math.abs(item.z - roadster.z) < item.length / 2 + .8);
        if (truck) {
          truck.rollVelocity = 9;
          truck.roll += .2;
        }
      }
      if(!roadster.hit&&previousZ<=roadster.length/2+.45&&roadster.z>roadster.length/2+.45)this.recordAvoidance(roadster);
    }
    for (const pickup of this.pickups) {
      pickup.z += rowSpeed * dt;
      if (!pickup.taken && Math.abs(pickup.z) < 1.1 && Math.abs(this.x - RUNNER_LANES[pickup.lane]) < 1.25 && Math.abs(this.y - pickup.y) < .75) {
        pickup.taken = true;
        this.collected++;
      }
    }
    for (const powerup of this.powerups) {
      powerup.z += rowSpeed * dt;
      if (Math.abs(powerup.z) <= 1.2 && Math.abs(this.x - RUNNER_LANES[powerup.lane]) < 1.25) {
        if (powerup.type === POWERUP_WRENCH) this.lives = Math.min(3, this.lives + 1);
        if (powerup.type === POWERUP_ROCKET) this.rocketTimer = 3;
        powerup.collected = true;
      }
    }
    this.powerups = this.powerups.filter(powerup => powerup.z < 18 && !powerup.collected);
    this.rocketTimer = Math.max(0, this.rocketTimer - dt);
    this.trucks = this.trucks.filter(truck => truck.z < 18);
    this.lowObstacles = this.lowObstacles.filter(obstacle => obstacle.z < 18);
    this.pickups = this.pickups.filter(pickup => pickup.z < 18 && !pickup.taken);
    this.spawnDistance += rowSpeed * dt;
    if (this.spawnDistance > 29) {
      this.spawnDistance -= 29;
      this.spawnRow();
    }
  }

  getUpcomingHazards() {
    const hazards = [];
    for (const t of this.trucks) if (t.z >= -18 && t.z <= -8) hazards.push({ ...t, kind: 'truck' });
    for (const o of this.lowObstacles) if (o.z >= -18 && o.z <= -8) hazards.push({ ...o, kind: 'obstacle' });
    for (const r of this.roadsters) if (r.z >= -18 && r.z <= -8) hazards.push({ ...r, kind: 'roadster' });
    for (const p of this.powerups) if (p.z >= -18 && p.z <= -8) hazards.push({ ...p, kind: 'powerup' });
    return hazards;
  }
}
