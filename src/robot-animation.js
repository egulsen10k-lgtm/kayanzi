const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// The same articulated gait drives the street robot and the truck-run robot.
// Speed is metres per second; the caller owns the robot's world position.
export function animateRobot(robot,{dt=1/60,speed=0,grounded=true,verticalVelocity=0,lateral=0}={}) {
  const rig=robot.userData.rig;
  if(!rig)return;
  dt=clamp(Number.isFinite(dt)?dt:0,0,.05);
  speed=Math.max(0,Number.isFinite(speed)?speed:0);
  const state=robot.userData.animation??(robot.userData.animation={phase:0,weight:0,air:0,landing:0,wasAirborne:false});
  const moving=clamp(speed/5,0,1);
  state.weight+=(moving-state.weight)*Math.min(1,dt*9);
  const airborne=!grounded;
  if(state.wasAirborne && !airborne)state.landing=1;
  state.wasAirborne=airborne;
  state.air+=((airborne?1:0)-state.air)*Math.min(1,dt*13);
  state.landing=Math.max(0,state.landing-dt*5);
  state.phase=(state.phase+dt*(9+Math.min(speed,24)*.34))%(Math.PI*2);
  const stride=Math.sin(state.phase)*state.weight*(1-state.air);
  const rise=Math.max(0,verticalVelocity);
  const falling=Math.max(0,-verticalVelocity);
  const tuck=state.air*clamp(.55+rise*.035-falling*.018,.25,.9);
  const impact=state.landing;
  rig.leftLeg.rotation.x=.95*stride+.34*tuck-.12*impact;
  rig.rightLeg.rotation.x=-.95*stride+.34*tuck-.12*impact;
  rig.leftLeg.position.y=1.16+.18*Math.max(0,stride);
  rig.rightLeg.position.y=1.16+.18*Math.max(0,-stride);
  rig.leftLeg.position.z=-.15*stride;
  rig.rightLeg.position.z=.15*stride;
  rig.leftKnee.rotation.x=-.08-.85*Math.max(0,-stride)-.88*tuck-.4*impact;
  rig.rightKnee.rotation.x=-.08-.85*Math.max(0,stride)-.88*tuck-.4*impact;
  rig.leftAnkle.rotation.x=-rig.leftLeg.rotation.x*.5-rig.leftKnee.rotation.x*.3;
  rig.rightAnkle.rotation.x=-rig.rightLeg.rotation.x*.5-rig.rightKnee.rotation.x*.3;
  rig.leftArm.rotation.x=-.85*stride+.85*state.air;
  rig.rightArm.rotation.x=.85*stride+.85*state.air;
  rig.leftArm.rotation.z=-.08-.16*state.weight;
  rig.rightArm.rotation.z=.08+.16*state.weight;
  rig.leftElbow.rotation.x=-.45-.3*Math.max(0,stride)-.25*state.air;
  rig.rightElbow.rotation.x=-.45-.3*Math.max(0,-stride)-.25*state.air;
  rig.torso.rotation.x=-.18*state.weight-.18*state.air+.13*impact;
  rig.torso.rotation.y=.09*stride;
  rig.torso.rotation.z=.035*stride;
  rig.head.rotation.x=-rig.torso.rotation.x*.55;
  rig.motion.position.y=(Math.abs(Math.sin(state.phase))*.14-.025)*state.weight-.12*impact;
  rig.motion.rotation.z=-clamp(lateral,-4,4)*.055;
}
