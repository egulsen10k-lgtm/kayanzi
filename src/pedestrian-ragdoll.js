import * as CANNON from 'cannon-es';

// A small articulated body uses a local origin: large map coordinates never
// enter the solver. East/up/south is the same coordinate system as Three.js.
export class PedestrianRagdoll {
  constructor({ heading = 0, height = 0, velocity = {} } = {}) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    this.world.solver.iterations = 12;
    this.world.defaultContactMaterial.friction = .65;
    this.world.defaultContactMaterial.restitution = .06;
    this.bodies = {};
    this.bindCenters = {
      torso: [0, 1.09, 0], head: [0, 1.52, .015],
      leftArm: [-.235, 1.04, 0], rightArm: [.235, 1.04, 0],
      leftLeg: [-.095, .43, 0], rightLeg: [.095, .43, 0]
    };
    const rotation = new CANNON.Quaternion();
    rotation.setFromEuler(0, Math.PI - heading, 0);
    const dimensions = { torso: [.18,.25,.13], head:[.15,.18,.15], leftArm:[.065,.27,.075], rightArm:[.065,.27,.075], leftLeg:[.085,.43,.12], rightLeg:[.085,.43,.12] };
    for (const [name, center] of Object.entries(this.bindCenters)) {
      const body = new CANNON.Body({ mass: name === 'torso' ? 24 : name === 'head' ? 5 : name.endsWith('Leg') ? 10 : 4 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(...dimensions[name])));
      rotation.vmult(new CANNON.Vec3(...center), body.position);
      body.position.y += height;
      body.quaternion.copy(rotation);
      body.velocity.set(velocity.vx ?? 0, velocity.vy ?? 0, -(velocity.vz ?? 0));
      body.angularVelocity.set(1.6, .3, -.8);
      body.linearDamping = .18; body.angularDamping = .45;
      this.world.addBody(body); this.bodies[name] = body;
    }
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floor);
    const joints = [
      ['head',[0,1.36,0],.5], ['leftArm',[-.235,1.29,0],1.5],
      ['rightArm',[.235,1.29,0],1.5], ['leftLeg',[-.095,.86,0],.95], ['rightLeg',[.095,.86,0],.95]
    ];
    for (const [name, anchor, angle] of joints) {
      const a = this.bindCenters.torso, b = this.bindCenters[name];
      const joint = new CANNON.ConeTwistConstraint(this.bodies.torso, this.bodies[name], {
        pivotA: new CANNON.Vec3(...anchor.map((v,i)=>v-a[i])),
        pivotB: new CANNON.Vec3(...anchor.map((v,i)=>v-b[i])),
        axisA: new CANNON.Vec3(0,1,0), axisB: new CANNON.Vec3(0,1,0),
        angle, twistAngle: .65, maxForce: 1e5, collideConnected: false
      });
      this.world.addConstraint(joint);
    }
    this.age = 0;
  }
  update(age) {
    const dt = Math.max(0, Math.min(.1, age - this.age));
    this.age = age;
    if (dt) this.world.step(1/60, dt, 6);
  }
  dispose() {
    for (const constraint of [...this.world.constraints]) this.world.removeConstraint(constraint);
    for (const body of [...this.world.bodies]) this.world.removeBody(body);
  }
}
