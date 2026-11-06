import { projectCoordinate } from './road-network.js';
import { FuelEconomy } from './fuel-economy.js';
// Robust BMW Vehicle & Physics Controller with Edge Case Validation
import { sweepRoadMotionResult, nearestRoadSpawn, footprintOnRoad } from './road-safety.js';

const PEER_CONTACT_METERS = 3;
function boundedPeerCars(peers, localId) {
  if (!Array.isArray(peers)) return [];
  const result = [];
  for (const peer of peers) {
    if (!peer || typeof peer.peerId !== 'string' || !peer.peerId || peer.peerId === localId ||
        !Number.isFinite(peer.lat) || Math.abs(peer.lat) > 90 ||
        !Number.isFinite(peer.lng) || Math.abs(peer.lng) > 180 ||
        !Number.isFinite(peer.heading) || Math.abs(peer.heading) > 1000 ||
        !Number.isFinite(peer.speed)) continue;
    result.push({
      peerId: peer.peerId.slice(0, 64), lat: peer.lat, lng: peer.lng,
      heading: ((peer.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
      speed: Math.max(-400, Math.min(400, peer.speed))
    });
    if (result.length >= 8) break;
  }
  return result;
}

export class CarPhysics {
  constructor(peerId = 'local-driver') {
    this.peerId = peerId;
    this.lat = 48.1764; // Munich BMW Welt
    this.lng = 11.5583;
    this.elevation = 520;
    this.roadHeight = .08;
    this.supportHeight = .08;
    this.verticalVelocity = 0;
    this.airborne = false;
    this.pitch = 0;
    this.roll = 0;
    this.rollover = false;
    this.rolloverEvent = null;

    this.speed = 0; // km/h
    this.maxSpeed = 290;
    this.acceleration = 16;
    this.braking = 28;
    this.steering = 0;
    this.heading = 0;
    this.rpm = 800;
    this.gear = 1;
    this.throttle = 0;
    this.handbrake = false;
    this.drivetrain = 'RWD';

    this.bmwModel = 'M3 Competition';
    this.energy = new FuelEconomy(this.bmwModel);
    this.color = '#1c3fa8';
    this.handlingMode = 'Sport+';
    this.driveMode = 'Normal';
    this.brakeMode = 'Comfort';
    this.suspensionMode = 'Comfort';
    this.dscMode = 'On';
    this.driveGear = 'auto';
    this.nitroCharge = 1;
    this.nitroActive = false;
    this.nitroEngaged = false;
    this.nitroDepleted = false;
    this.driftDuration = 0;
    this.absActive = false;
    this.tractionControlActive = false;
    this.assistFeedbackEvent = null;

    this.driftFactor = 0;
    this.driftAngle = 0;
    this.driftDirection = 0;
    this.isDrifting = false;
    this.driftScore = 0;
    this.driftCombo = 0;
    this.driftEndEvent = null;
    this.keys = {};
    this.roadConstrained = true;
    this.roadBlocked = false;
    this.roadNetwork = null;
    this.impactEvent = null;
    this.impactCooldown = 0;
    this.reverseDelay = 0;
    this.peerCars = [];
    this.peerImpactCooldowns = new Map();
    this.onPeerImpact = null;
  }

  setModel(modelName) {
    this.bmwModel = modelName;
    this.energy.setModel(modelName);
    switch (modelName) {
      case 'M3 Competition':
        this.maxSpeed = 290;
        this.acceleration = 16;
        break;
      case 'M4 CSL':
        this.maxSpeed = 308;
        this.acceleration = 19;
        break;
      case 'M5 CS':
        this.maxSpeed = 305;
        this.acceleration = 20;
        break;
      case 'i4 M50 (EV)':
        this.maxSpeed = 235;
        this.acceleration = 22;
        break;
      case 'XM Label Red':
        this.maxSpeed = 290;
        this.acceleration = 18;
        break;
    }
  }

  setColor(hex) {
    this.color = hex;
  }

  setHandling(mode) {
    this.handlingMode = mode;
  }

  setDriveMode(mode) {
    if (mode === 'Comfort') mode = 'Normal';
    if (!['Normal', 'Sport', 'Sport+'].includes(mode)) return false;
    this.driveMode = mode;
    return true;
  }

  setWeatherGrip(g) { this.weatherGrip = g ?? 1; }

  setBrakeMode(mode) {
    if (!['Comfort', 'Sport'].includes(mode)) return false;
    this.brakeMode = mode;
    return true;
  }

  setSuspensionMode(mode) {
    if (!['Comfort', 'Sport'].includes(mode)) return false;
    this.suspensionMode = mode;
    return true;
  }

  setDscMode(mode) {
    if (!['On', 'Traction', 'Off'].includes(mode)) return false;
    this.dscMode = mode;
    return true;
  }

  setDriveGear(gear) {
    if (!['auto', 'D', 'N', 'R'].includes(gear)) return false;
    const forwardSwitch = ['auto', 'D'].includes(gear) && ['auto', 'D'].includes(this.driveGear);
    if (gear !== 'N' && gear !== this.driveGear && !forwardSwitch && Math.abs(this.speed) > 3) return false;
    this.driveGear = gear;
    this.reverseDelay = 0;
    return true;
  }

  setNitroActive(active) {
    this.nitroActive = Boolean(active);
  }

  refillNitro(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return this.nitroCharge;
    this.nitroCharge = Math.min(1, this.nitroCharge + value);
    this.nitroDepleted = this.nitroCharge <= 0;
    return this.nitroCharge;
  }

  activateNitro() {
    if (this.nitroCharge < 0.1) {
      this.nitroActive = false;
      return false;
    }
    this.nitroActive = true;
    this.nitroDepleted = false;
    return true;
  }

  setRoadNetwork(network) {
    this.roadNetwork = network;
    this.blockedSeconds = 0;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Bound suspension gaps, but integrate normal frames in small, equal steps.
    dt = Math.min(dt, 0.1);
    if (this.roadConstrained && !this.roadNetwork) {
      this.speed = 0; this.throttle = 0; this.rpm = 800; this.roadBlocked = true;
      return;
    }
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    if (!this.impactCooldown) this.impactEvent = null;
    const count = Math.ceil(dt / (1 / 120));
    for (let step = 0; step < count; step++) {
      const before={lat:this.lat,lng:this.lng},previousSpeed=this.speed,previousHeight=this.roadHeight;
      const moved=this.integrate(dt/count);
      const distance=Math.hypot(...projectCoordinate(this.lat,this.lng,before))/1000;
      this.energy.update(dt/count,this,distance,{
        acceleration:(Math.abs(this.speed)-Math.abs(previousSpeed))/3.6/(dt/count),
        grade:distance>.000001?(this.roadHeight-previousHeight)/(distance*1000):0
      });
      if (!moved) break;
    }
    if (this.roadConstrained && this.roadNetwork) {
      const point = projectCoordinate(this.lat, this.lng, this.roadNetwork.center);
      const supportHeight = this.airborne && Number.isFinite(this.supportHeight) ? this.supportHeight : this.roadHeight;
      const invalid = !point || !footprintOnRoad(this.roadNetwork, point, this.heading, supportHeight);
      this.blockedSeconds = this.roadBlocked || invalid ? (this.blockedSeconds || 0) + dt : 0;
      if (invalid || this.blockedSeconds > 1.5) this.recoverToRoad();
    }
    this.resolvePeerContacts(dt);
    const absSpeed = Math.abs(this.speed);
    this.gear = this.speed < -0.1 ? -1 : Math.min(6, 1 + Math.floor(absSpeed / 45));
    this.rpm = this.bmwModel === 'i4 M50 (EV)'
      ? 800 + absSpeed / this.maxSpeed * 12000
      : Math.min(8200, 800 + absSpeed / (Math.max(1, this.gear) * 50) * 6400 + Math.abs(this.throttle) * 1300);
  }

  setPeerCars(peers) {
    this.peerCars = boundedPeerCars(peers, this.peerId);
  }

  resolvePeerContacts(dt = 1 / 60) {
    for (const [id, cooldown] of this.peerImpactCooldowns) {
      const next = Math.max(0, cooldown - dt);
      if (next === 0) this.peerImpactCooldowns.delete(id);
      else this.peerImpactCooldowns.set(id, next);
    }
    for (const peer of this.peerCars) {
      const meanLat = (this.lat + peer.lat) * Math.PI / 360;
      let east = (this.lng - peer.lng) * Math.PI / 180 * 6371008.8 * Math.cos(meanLat);
      let north = (this.lat - peer.lat) * Math.PI / 180 * 6371008.8;
      let distance = Math.hypot(east, north);
      if (distance >= PEER_CONTACT_METERS) continue;
      if (distance < 0.001) {
        east = -Math.sin(this.heading); north = -Math.cos(this.heading); distance = 1;
      }
      const push = PEER_CONTACT_METERS - distance;
      east += east / distance * push;
      north += north / distance * push;
      this.lng += east / (6371008.8 * Math.max(0.01, Math.cos(this.lat * Math.PI / 180))) * 180 / Math.PI;
      this.lat += north / 6371008.8 * 180 / Math.PI;
      const relativeSpeed = Math.abs(this.speed - peer.speed) / 3.6;
      this.speed *= 0.72;
      if (!this.peerImpactCooldowns.has(peer.peerId)) {
        this.peerImpactCooldowns.set(peer.peerId, 0.45);
        this.onPeerImpact?.({ id: peer.peerId, relativeSpeed });
      }
    }
  }

  recoverToRoad() {
    if (!this.roadNetwork) return false;
    const spawn = nearestRoadSpawn(this.roadNetwork, this.lat, this.lng, this.roadHeight);
    if (!spawn) return false;
    const reverse = Math.cos(spawn.heading - this.heading) < 0;
    this.lat = spawn.lat; this.lng = spawn.lng;
    this.heading = spawn.heading + (reverse ? Math.PI : 0);
    this.roadHeight = spawn.roadHeight;
    this.supportHeight = spawn.roadHeight;
    this.verticalVelocity = 0;
    this.airborne = false;
    this.pitch = 0;
    this.roll = 0;
    this.rollover = false;
    this.rolloverEvent = null;
    this.speed = 0; this.steering = 0;
    this.driftFactor = 0; this.driftAngle = 0; this.driftDirection = 0;
    this.absActive = false; this.tractionControlActive = false; this.assistFeedbackEvent = null;
    this.roadBlocked = false; this.blockedSeconds = 0;
    return true;
  }

  updateVerticalDynamics(dt, targetHeight, distanceMeters) {
    const target = Number.isFinite(targetHeight) ? targetHeight : this.roadHeight;
    const support = Number.isFinite(this.supportHeight) ? this.supportHeight : this.roadHeight;
    const delta = target - support;
    const drop = support - target;
    const speedMs = Math.abs(Number.isFinite(this.speed) ? this.speed : 0) / 3.6;
    const safeDistance = Math.max(.5, Number.isFinite(distanceMeters) ? distanceMeters : 0);
    const rawPitch = Math.atan2(delta, safeDistance);
    const targetPitch = Math.max(-.65, Math.min(.65, rawPitch));
    const priorRoll = Number.isFinite(this.roll) ? this.roll : 0;
    const targetRoll = Math.max(-.65, Math.min(.65,
      Number.isFinite(this.steering) ? this.steering * Math.min(.55, speedMs / 35) : 0));
    this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-8 * dt));
    this.roll += (targetRoll - priorRoll) * (1 - Math.exp(-7 * dt));
    if (!Number.isFinite(this.pitch)) this.pitch = 0;
    if (!Number.isFinite(this.roll)) this.roll = 0;

    const extreme = Math.abs(rawPitch) > .85 || Math.abs(priorRoll) > .95;
    if (extreme) {
      if (!this.rollover) this.rolloverEvent = { pitch: this.pitch, roll: this.roll };
      this.rollover = true;
      this.speed = Math.max(-30, Math.min(290, this.speed * .65));
      this.verticalVelocity = 0;
      this.airborne = false;
      this.pitch = Math.max(-.8, Math.min(.8, this.pitch));
      this.roll = Math.max(-.8, Math.min(.8, this.roll));
      this.roadHeight = target;
      this.supportHeight = target;
      return;
    }
    this.rollover = false;
    if (!Number.isFinite(this.verticalVelocity)) this.verticalVelocity = 0;
    if (!this.airborne && drop > .12 && speedMs > 4) {
      this.airborne = true;
      this.supportHeight = support;
      this.verticalVelocity = Math.max(1.2, Math.min(4.5, drop / Math.max(dt, .01) * .35));
    }
    if (this.airborne) {
      this.verticalVelocity = Math.max(-12, Math.min(12, this.verticalVelocity - 9.81 * dt));
      this.roadHeight += this.verticalVelocity * dt;
      this.supportHeight = target;
      if (this.roadHeight <= target) {
        this.roadHeight = target;
        this.supportHeight = target;
        this.airborne = false;
        this.verticalVelocity = 0;
      }
    } else {
      this.supportHeight = target;
      this.roadHeight = target;
      this.verticalVelocity = 0;
    }
  }

  integrate(dt) {
    const keyForward = !!(this.keys.ArrowUp || this.keys.KeyW);
    const keyBackward = !!(this.keys.ArrowDown || this.keys.KeyS);
    const tilt = this.tiltInput || { throttle: 0, steering: 0 };
    // Touch/keyboard pedals override tilt, including an immediate brake override.
    const pedal = keyForward || keyBackward ? Number(keyForward) - Number(keyBackward) : tilt.throttle;
    const hasPower=this.energy.remaining>0;
    const selectedPedal = !hasPower||this.driveGear === 'N' ? 0 : this.driveGear === 'R' ? -Math.max(0, pedal) : pedal;
    const serviceBrake = (this.driveGear !== 'auto'||!hasPower) && pedal < 0;
    const forward = selectedPedal > 0 || (keyForward && keyBackward);
    const backward = selectedPedal < 0 || (keyForward && keyBackward);
    const pressure = Math.abs(pedal);
    this.handbrake = !!this.keys.Space;
    const oldHeading = this.heading;
    const previousSpeed = this.speed;
    const stop = (amount) => Math.sign(this.speed) * Math.max(0, Math.abs(this.speed) - amount);
    this.throttle = 0;
    const previousAbs = this.absActive;
    const previousTraction = this.tractionControlActive;
    const brakingPressure = pedal < -0.35 && previousSpeed > 12;
    const wheelSlip = Math.abs(this.driftFactor) > 0.18 || Math.abs(this.speed - previousSpeed) > 12 * dt;
    this.absActive = Boolean(brakingPressure && wheelSlip && Math.abs(previousSpeed) > 12);
    this.tractionControlActive = Boolean(!this.handbrake && forward && pressure > 0.7 && this.driftFactor > 0.12 && Math.abs(this.speed) > 18);
    if ((this.absActive && !previousAbs) || (this.tractionControlActive && !previousTraction)) {
      this.assistFeedbackEvent = { abs: this.absActive, tractionControl: this.tractionControlActive };
    }
    if (this.nitroCharge <= 0) this.nitroDepleted = true;
    if (this.nitroCharge >= .25) this.nitroDepleted = false;
    this.nitroEngaged = hasPower && this.nitroActive && !this.nitroDepleted && this.nitroCharge > 0 &&
      this.driveGear !== 'N' && this.driveGear !== 'R' && forward && this.speed > 5 && !this.handbrake;
    this.nitroCharge = Math.max(0, Math.min(1, this.nitroCharge +
      (this.nitroEngaged ? -0.4 : 0.045) * dt));
    if (this.nitroCharge <= 0) {
      this.nitroActive = false;
      this.nitroDepleted = true;
      this.nitroEngaged = false;
    }
    if (serviceBrake) {
      this.speed = stop(this.braking * (this.brakeMode === 'Sport' ? 1.25 : 1) * pressure * dt);
      this.throttle = -0.6 * pressure;
      this.reverseDelay = 0;
    } else if (forward && backward) {
      this.speed = stop(36 * dt);
      this.reverseDelay = 0;
    } else if (this.handbrake) {
      // Rear-wheel lock initiates the arcade slide in every handling mode.
      this.speed = stop(10 * dt);
      this.throttle = forward ? pressure : 0;
      this.reverseDelay = 0;
    } else if ((forward && this.speed < 0) || (backward && this.speed > 0)) {
      // Opposite pedal first brakes to rest. It cannot change direction in one step.
      this.speed = stop(this.braking * (this.brakeMode === 'Sport' ? 1.25 : 1) * pressure * dt);
      this.reverseDelay = 0;
      this.throttle = -0.6 * pressure;
    } else if (backward) {
      this.reverseDelay = (this.reverseDelay || 0) + dt;
      if (this.reverseDelay >= 0.3 || this.speed < 0) {
        this.throttle = -0.6 * pressure;
        this.speed = Math.max(-30, this.speed - this.acceleration * 0.45 * pressure * dt);
      }
    } else if (forward) {
      this.reverseDelay = 0;
      this.throttle = pressure;
      const mode = this.driveMode === 'Sport+' ? 1.2 : this.driveMode === 'Sport' ? 1.08 : 1;
      const speedLimit = this.maxSpeed + (this.nitroEngaged ? 40 : 0);
      const power = Math.max(0, 1 - (this.speed / speedLimit) ** 2);
      this.speed = this.speed > speedLimit ? Math.max(speedLimit, this.speed - 12 * dt) :
        Math.min(speedLimit, this.speed +
          (this.acceleration * mode + (this.nitroEngaged ? 38 : 0)) * power * pressure * dt);
    } else {
      this.reverseDelay = 0;
      // Rolling resistance plus aerodynamic drag; never changes travel direction.
      this.speed = stop((2.8 + 0.00015 * this.speed ** 2) * dt);
    }

    const left = !!(this.keys.ArrowLeft || this.keys.KeyA);
    const right = !!(this.keys.ArrowRight || this.keys.KeyD);
    const target = left || right ? Number(left) - Number(right) : (this.wheelSteering || tilt.steering);
    this.steering += (target - this.steering) * (1 - Math.exp(-7 * dt));
    if (Math.abs(this.steering) < 0.0001) this.steering = 0;
    const speedMs = (previousSpeed + this.speed) / 7.2;
    const absMs = Math.abs(speedMs);
    // Bicycle model: wheel angle / wheelbase sets turn radius. Tire grip bounds
    // lateral acceleration, preventing unrealistically rapid highway-speed spins.
    const wheelAngle = this.steering * 0.61 / (1 + (absMs / 18) ** 2);
    const requestedYaw = -speedMs * Math.tan(wheelAngle) / 2.85;
    const grip = ((this.handlingMode === 'Drift' ? 4.2 : 8.8) +
      (this.suspensionMode === 'Sport' ? .8 : 0) +
      (this.dscMode === 'Traction' ? .5 : this.dscMode === 'Off' ? 1.5 : 0)) * (this.weatherGrip ?? 1);
    const yawLimit = grip / Math.max(absMs, 0.1);
    const normalYaw = Math.max(-yawLimit, Math.min(yawLimit, requestedYaw));
    const steerDirection = Math.sign(this.steering);
    const arcadeInput = this.handbrake || (this.throttle > .55 && Math.abs(this.steering) > .35);
    const handbrakeTurn = this.handbrake && absMs > 7 && Math.abs(this.steering) > .08;
    const canDrift = this.drivetrain === 'RWD' && absMs > 7 && arcadeInput &&
      (Math.abs(this.steering) > .12 || this.handbrake);
    const counterSteering = this.driftDirection && steerDirection === -this.driftDirection;
    const speedSlip = Math.min(1, Math.max(0, (absMs - 7) / 18));
    const steerSlip = Math.min(1, Math.max(0, (Math.abs(this.steering) - .08) / .55));
    const driveSlip = this.handbrake ? 1 : .6 + Math.min(.4, Math.max(0, this.throttle));
    const stability = this.dscMode === 'On' ? .6 : this.dscMode === 'Traction' ? .85 : 1;
    // A handbrake locks the rear axle: it must create lateral slip even before
    // throttle is applied. DSC can damp it, but cannot make locked tires grip.
    const handbrakeSlip = this.handbrake ? speedSlip * (.55 + .45 * steerSlip) : 0;
    const targetSlip = canDrift ? Math.max(handbrakeSlip,
      speedSlip * steerSlip * driveSlip * stability * (counterSteering ? .7 : 1)) : 0;
    const response = 1 - Math.exp(-(targetSlip > this.driftFactor ? 4.0 : 6.0) * dt);
    this.driftFactor += (targetSlip - this.driftFactor) * response;
    if (this.driftFactor > .02 && steerDirection && (!this.driftDirection || !counterSteering)) this.driftDirection = steerDirection;
    if (this.driftFactor < .008) this.driftDirection = 0;
    this.driftAngle = this.driftDirection * this.driftFactor * (.12 + .52 * speedSlip);
    const wasDrifting = this.isDrifting;
    this.isDrifting = this.driftFactor > .06;
    if (this.isDrifting) {
      this.driftDuration += dt;
      if (this.driftDuration >= 0.5) {
        this.refillNitro(0.08);
        this.driftDuration = 0;
      }
      this.driftScore += this.driftFactor * Math.abs(this.driftAngle) * Math.abs(this.speed) * dt * 0.4;
    } else {
      this.driftDuration = 0;
    }
    if (!this.isDrifting && wasDrifting && this.driftScore > 0) {
      this.driftEndEvent = { score: Math.round(this.driftScore), combo: ++this.driftCombo };
      this.driftScore = 0;
    }
    const yaw = normalYaw;
    this.heading = ((oldHeading + yaw * dt) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const distanceMeters = speedMs * dt;
    if (!distanceMeters) return true;
    const latitude = this.lat * Math.PI / 180;
    const longitude = this.lng * Math.PI / 180;
    const distance = distanceMeters / 6371008.8;
    const destinationFor = travelHeading => {
      const nextLat = Math.asin(Math.max(-1, Math.min(1,
        Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(travelHeading)
      )));
      const nextLng = longitude + Math.atan2(
        Math.sin(travelHeading) * Math.sin(distance) * Math.cos(latitude),
        Math.cos(distance) - Math.sin(latitude) * Math.sin(nextLat)
      );
      return { lat: nextLat * 180 / Math.PI, lng: ((nextLng * 180 / Math.PI + 540) % 360) - 180 };
    };
    const prevLat = this.lat, prevLng = this.lng;
    const destination = destinationFor(oldHeading + normalYaw * dt / 2);
    const motion = this.roadConstrained ? sweepRoadMotionResult(this.roadNetwork,
      { ...this, heading: oldHeading }, { ...destination, heading: this.heading }) : {fraction:1,roadHeight:this.roadHeight};
    if (motion.fraction < 1) {
      const impactSpeed = Math.abs(this.speed);
      // Reject translation and rotation together: retaining the attempted yaw
      // can leave the footprint outside the road and lock every subsequent sweep.
      this.lat = prevLat;
      this.lng = prevLng;
      this.heading = oldHeading;
      if (motion.fraction > 0.35) {
        this.speed *= 0.7;
      } else {
        const bounceSpeed = -Math.sign(this.speed) * Math.min(16, Math.max(4, impactSpeed * 0.2));
        this.speed = bounceSpeed;
        this.heading = oldHeading;
      }
      this.roadBlocked = true;
      if (!this.impactCooldown && impactSpeed > 2) {
        this.impactEvent = { speed: impactSpeed, timestamp: globalThis.performance?.now() ?? Date.now() };
        this.impactCooldown = 0.5;
      }
      return false;
    }
    this.roadBlocked = false;
    this.updateVerticalDynamics(dt, motion.roadHeight, distanceMeters);
    this.lat = destination.lat;
    this.lng = destination.lng;
    return true;
  }

  teleport(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return false;
    }
    this.roadHeight = .08;
    this.supportHeight = .08;
    this.verticalVelocity = 0;
    this.airborne = false;
    this.pitch = 0;
    this.roll = 0;
    this.rollover = false;
    this.rolloverEvent = null;
    this.lat = lat;
    this.lng = lng;
    this.roadNetwork = null;
    this.roadBlocked = false;
    this.speed = 0;
    this.steering = 0;
    this.throttle = 0;
    this.heading = 0;
    this.rpm = 800;
    this.gear = 1;
    this.driftFactor = 0;
    this.driftAngle = 0;
    this.driftDirection = 0;
    this.isDrifting = false;
    this.driftScore = 0;
    this.driftEndEvent = null;
    this.absActive = false;
    this.tractionControlActive = false;
    this.assistFeedbackEvent = null;
    this.handbrake = false;
    this.keys = {};
    this.reverseDelay = 0;
    this.impactCooldown = 0;
    this.impactEvent = null;
    return true;
  }

  serializeState() {
    return {
      peerId: this.peerId,
      lat: this.lat,
      lng: this.lng,
      speed: this.speed,
      heading: this.heading,
      steering: this.steering,
      roadHeight: this.roadHeight,
      color: this.color,
      model: this.bmwModel,
      drivetrain: this.drivetrain
    };
  }
}
