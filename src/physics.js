// Robust BMW Vehicle & Physics Controller with Edge Case Validation
import { sweepRoadMotionResult } from './road-safety.js';

export class CarPhysics {
  constructor(peerId = 'local-driver') {
    this.peerId = peerId;
    this.lat = 48.1764; // Munich BMW Welt
    this.lng = 11.5583;
    this.elevation = 520;
    this.roadHeight = .08;

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

    this.bmwModel = 'M3 Competition';
    this.color = '#1c3fa8';
    this.handlingMode = 'Sport+';

    this.driftFactor = 0;
    this.isDrifting = false;
    this.keys = {};
    this.roadConstrained = true;
    this.roadBlocked = false;
    this.roadNetwork = null;
    this.impactEvent = null;
    this.impactCooldown = 0;
    this.reverseDelay = 0;
  }

  setModel(modelName) {
    this.bmwModel = modelName;
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

  setRoadNetwork(network) {
    this.roadNetwork = network;
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
      if (!this.integrate(dt / count)) break;
    }
    const absSpeed = Math.abs(this.speed);
    this.gear = this.speed < -0.1 ? -1 : Math.min(6, 1 + Math.floor(absSpeed / 45));
    this.rpm = this.bmwModel === 'i4 M50 (EV)'
      ? 800 + absSpeed / this.maxSpeed * 12000
      : Math.min(8200, 800 + absSpeed / (Math.max(1, this.gear) * 50) * 6400 + Math.abs(this.throttle) * 1300);
  }

  integrate(dt) {
    const keyForward = !!(this.keys.ArrowUp || this.keys.KeyW);
    const keyBackward = !!(this.keys.ArrowDown || this.keys.KeyS);
    const tilt = this.tiltInput || { throttle: 0, steering: 0 };
    // Touch/keyboard pedals override tilt, including an immediate brake override.
    const pedal = keyForward || keyBackward ? Number(keyForward) - Number(keyBackward) : tilt.throttle;
    const forward = pedal > 0 || (keyForward && keyBackward);
    const backward = pedal < 0 || (keyForward && keyBackward);
    const pressure = Math.abs(pedal);
    this.handbrake = !!this.keys.Space;
    const oldHeading = this.heading;
    const previousSpeed = this.speed;
    const stop = (amount) => Math.sign(this.speed) * Math.max(0, Math.abs(this.speed) - amount);
    this.throttle = 0;
    if (this.handbrake || (forward && backward)) {
      this.speed = stop(36 * dt);
      this.reverseDelay = 0;
    } else if ((forward && this.speed < 0) || (backward && this.speed > 0)) {
      // Opposite pedal first brakes to rest. It cannot change direction in one step.
      this.speed = stop(this.braking * pressure * dt);
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
      const mode = this.handlingMode === 'Sport+' ? 1.2 : 1;
      const power = Math.max(0, 1 - (this.speed / this.maxSpeed) ** 2);
      this.speed = Math.min(this.maxSpeed, this.speed + this.acceleration * mode * power * pressure * dt);
    } else {
      this.reverseDelay = 0;
      // Rolling resistance plus aerodynamic drag; never changes travel direction.
      this.speed = stop((2.8 + 0.00015 * this.speed ** 2) * dt);
    }

    const left = !!(this.keys.ArrowLeft || this.keys.KeyA);
    const right = !!(this.keys.ArrowRight || this.keys.KeyD);
    const target = left || right ? Number(left) - Number(right) : tilt.steering;
    this.steering += (target - this.steering) * (1 - Math.exp(-7 * dt));
    if (Math.abs(this.steering) < 0.0001) this.steering = 0;
    const speedMs = (previousSpeed + this.speed) / 7.2;
    const absMs = Math.abs(speedMs);
    // Bicycle model: wheel angle / wheelbase sets turn radius. Tire grip bounds
    // lateral acceleration, preventing unrealistically rapid highway-speed spins.
    const wheelAngle = this.steering * 0.61 / (1 + (absMs / 18) ** 2);
    const requestedYaw = -speedMs * Math.tan(wheelAngle) / 2.85;
    const grip = this.handlingMode === 'Drift' ? 4.2 : 8.8;
    const yawLimit = grip / Math.max(absMs, 0.1);
    const yaw = Math.max(-yawLimit, Math.min(yawLimit, requestedYaw));
    this.heading = ((oldHeading + yaw * dt) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

    // Drift physics - lateral slide when turning at speed in Drift mode
    const isFastEnough = absMs > 7;
    const isTurned = Math.abs(this.steering) > 0.25;
    const drifting = this.handlingMode === 'Drift' && isFastEnough && isTurned;

    if (drifting) {
      this.lat += Math.cos(this.heading + Math.PI/2) * this.driftFactor * dt * 0.002;
      this.lng += Math.sin(this.heading + Math.PI/2) * this.driftFactor * dt * 0.002;
      this.heading += Math.sign(this.steering) * this.driftFactor * dt * 0.3;
      this.driftFactor = Math.min(3.5, this.driftFactor + dt * 2);
      this.isDrifting = true;
    } else {
      this.driftFactor = Math.max(0, this.driftFactor - dt * 4);
      this.isDrifting = false;
    }
    const distanceMeters = speedMs * dt;
    if (!distanceMeters) return true;
    const latitude = this.lat * Math.PI / 180;
    const longitude = this.lng * Math.PI / 180;
    const distance = distanceMeters / 6371008.8;
    const travelHeading = oldHeading + yaw * dt / 2;
    const nextLat = Math.asin(Math.max(-1, Math.min(1,
      Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(travelHeading)
    )));
    const nextLng = longitude + Math.atan2(
      Math.sin(travelHeading) * Math.sin(distance) * Math.cos(latitude),
      Math.cos(distance) - Math.sin(latitude) * Math.sin(nextLat)
    );
    const destination = { lat: nextLat * 180 / Math.PI, lng: ((nextLng * 180 / Math.PI + 540) % 360) - 180 };
    const motion = this.roadConstrained ? sweepRoadMotionResult(this.roadNetwork,
      { ...this, heading: oldHeading }, { ...destination, heading: this.heading }) : {fraction:1,roadHeight:this.roadHeight};
    if (motion.fraction < 1) {
      const impactSpeed = Math.abs(this.speed);
      this.speed = 0;
      this.heading = oldHeading;
      this.roadBlocked = true;
      if (!this.impactCooldown && impactSpeed > 2) {
        this.impactEvent = { speed: impactSpeed, timestamp: globalThis.performance?.now() ?? Date.now() };
        this.impactCooldown = 0.5;
      }
      return false;
    }
    this.roadBlocked = false;
    this.roadHeight = motion.roadHeight;
    this.lat = destination.lat;
    this.lng = destination.lng;
    return true;
  }

  teleport(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return false;
    }
    this.roadHeight = .08;
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
    this.isDrifting = false;
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
      model: this.bmwModel
    };
  }
}
