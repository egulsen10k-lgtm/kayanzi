import * as CANNON from 'cannon-es';
const BODY_HALF_HEIGHT={torso:.25,head:.18,leftArm:.27,rightArm:.27,leftLeg:.43,rightLeg:.43};

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
    this.phase='fall';
    this.phaseTime=0;
    this.bounceVelocityY=0;
    this.bounceCount=0;
    this.opacity=1;
    this.disposed=false;
  }
  update(age,roadHeight=0) {
    if(this.disposed)return;
    const nextAge=Number.isFinite(age)?Math.max(this.age,age):this.age;
    const dt=Math.max(0,Math.min(.1,nextAge-this.age));
    this.age=nextAge;
    if(!dt)return;
    if(this.phase==='fall') {
      this.world.step(1/60,dt,6);
      if(this.age>=4) {
        this.phase='bouncing';this.phaseTime=0;this.bounceVelocityY=2.5;this.bounceCount=0;
      }
      return;
    }
    if(this.phase==='bouncing') {
      this.phaseTime+=dt;
      let contactedRoad=false;
      for(const [name,body] of Object.entries(this.bodies)) {
        body.position.y+=this.bounceVelocityY*dt;
        const minimumY=roadHeight+(BODY_HALF_HEIGHT[name]??0);
        if(body.position.y<minimumY) {body.position.y=minimumY;contactedRoad=true;}
      }
      this.bounceVelocityY=(this.bounceVelocityY-9.8*dt)*.55;
      if(contactedRoad) {
        this.bounceCount++;
        this.bounceVelocityY=Math.abs(this.bounceVelocityY)*.55;
      }
      if(this.bounceCount>=3||this.phaseTime>=2.5) {
        this.phase='fading';this.phaseTime=0;this.opacity=1;
      }
      return;
    }
    if(this.phase==='fading') {
      this.phaseTime+=dt;
      this.opacity=Math.max(0,1-this.phaseTime/.8);
      if(this.phaseTime>=.8) {this.opacity=0;this.phase='disposed';this.dispose();}
    }
  }
  dispose() {
    if(this.disposed)return;
    this.disposed=true;
    this.phase='disposed';
    this.opacity=0;
    for (const constraint of [...this.world.constraints]) this.world.removeConstraint(constraint);
    for (const body of [...this.world.bodies]) this.world.removeBody(body);
  }
}
