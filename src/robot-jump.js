export class RobotJump {
  constructor() { this.reset(); }

  reset() {
    this.height=0;
    this.velocity=0;
  }

  jump() {
    if(this.height>0||this.velocity>0)return false;
    this.velocity=9.2;
    return true;
  }

  update(dt) {
    dt=Math.max(0,Math.min(.05,Number.isFinite(dt)?dt:0));
    if(this.height<=0&&this.velocity<=0)return;
    this.velocity-=22*dt;
    this.height+=this.velocity*dt;
    if(this.height<=0)this.reset();
  }
}
