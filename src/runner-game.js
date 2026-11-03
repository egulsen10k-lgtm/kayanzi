export const RUNNER_LANES = [-4, 0, 4];
export const TRUCK_ROOF_HEIGHT = 2.25;
export const LOW_OBSTACLE_HEIGHT = 1.55;
export const SLIDE_DURATION = .72;
export const ROADSTER_HEIGHT = 2.8;
export const ROLL_DURATION = .68;

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
    this.distance = 0;
    this.collected = 0;
    this.lives = 3;
    this.invulnerable = 0;
    this.spawnDistance = 0;
    this.nextId = 1;
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
    this.vy = 10.5;
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
    this.trucks.push({ id, lane, z, length: 9, hit: false, roll: 0, rollVelocity: 0 });
    this.pickups.push({ id:this.nextId++, lane, z:z - 1.2, y:TRUCK_ROOF_HEIGHT, truckId:id, taken:false });
    if (this.random() > .35) this.lowObstacles.push({
      id: this.nextId++, lane: (lane + 1 + Math.floor(this.random() * 2)) % 3,
      z: z - 7, length: 2.2, height: LOW_OBSTACLE_HEIGHT, hit: false
    });
    if (this.random() > .65) this.roadsters.push({
      id: this.nextId++, lane: (lane + 2) % 3, z: z - 16,
      length: 4.8, height: ROADSTER_HEIGHT, hit: false, roll: 0
    });
    const openLane = (lane + 1 + Math.floor(this.random() * 2)) % 3;
    this.pickups.push({ id:this.nextId++, lane:openLane, z:z + 2.5, y:0, truckId:null, taken:false });
  }

  update(dt) {
    if (this.over) return;
    dt = Math.max(0, Math.min(.05, Number.isFinite(dt) ? dt : 0));
    const speed = Math.min(25, 14 + this.distance / 500);
    this.distance += speed * dt;
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
      truck.z += speed * dt;
      truck.rollVelocity *= Math.max(0, 1 - dt * 2.4);
      truck.roll += truck.rollVelocity * dt;
      const sameLane = Math.abs(this.x - RUNNER_LANES[truck.lane]) < 1.35;
      const overlap = Math.abs(truck.z) < truck.length / 2 + .35;
      if (!sameLane || !overlap) continue;
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
    if (this.y < 0) { this.y = 0; this.vy = 0; }
    for (const obstacle of this.lowObstacles) {
      obstacle.z += speed * dt;
      const sameLane = Math.abs(this.x - RUNNER_LANES[obstacle.lane]) < 1.35;
      const overlap = Math.abs(obstacle.z) < obstacle.length / 2 + .35;
      if (sameLane && overlap && this.y < obstacle.height - .2 && !this.sliding && this.invulnerable <= 0 && !obstacle.hit) {
        obstacle.hit = true;
        this.lives--;
        this.invulnerable = 1.3;
        if (this.lives <= 0) this.over = true;
      }
    }
    for (const roadster of this.roadsters) {
      roadster.z += speed * dt;
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
    }
    for (const pickup of this.pickups) {
      pickup.z += speed * dt;
      if (!pickup.taken && Math.abs(pickup.z) < 1.1 && Math.abs(this.x - RUNNER_LANES[pickup.lane]) < 1.25 && Math.abs(this.y - pickup.y) < .75) {
        pickup.taken = true;
        this.collected++;
      }
    }
    this.trucks = this.trucks.filter(truck => truck.z < 18);
    this.lowObstacles = this.lowObstacles.filter(obstacle => obstacle.z < 18);
    this.pickups = this.pickups.filter(pickup => pickup.z < 18 && !pickup.taken);
    this.spawnDistance += speed * dt;
    if (this.spawnDistance > 29) {
      this.spawnDistance -= 29;
      this.spawnRow();
    }
  }
}
