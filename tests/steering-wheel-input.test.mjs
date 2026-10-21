import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteeringWheel, bindSteeringWheelInput } from '../src/steering-wheel-input.js';
import { CarPhysics } from '../src/physics.js';

class MockElement {
  constructor() {
    this.hidden = true;
    this.children = [];
    this.style = {};
    this.handlers={};
  }
  appendChild(child) { this.children.push(child); }
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 140, height: 140 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  addEventListener(name,handler) {this.handlers[name]=handler;}
  offsetWidth = 140;
}

class MockDocument {
  getElementById() { return new MockElement(); }
  createElement() { return new MockElement(); }
}

test('virtual steering wheel creation and steering range', () => {
  const container = new MockElement();
  const doc = new MockDocument();
  let latestSteering = 0;
  const wheel = createSteeringWheel({
    container,
    doc,
    onChange(val) { latestSteering = val; }
  });
  assert.ok(wheel.wheelElement);
  assert.equal(wheel.wheelElement.hidden, false);
  const event={button:0,pointerId:1,preventDefault(){},clientX:70,clientY:20};
  wheel.wheelElement.handlers.pointerdown(event);
  wheel.wheelElement.handlers.pointermove({...event,clientX:115,clientY:40});
  assert.ok(latestSteering<-.5,'right drag should steer right');
  wheel.wheelElement.handlers.pointercancel(event);assert.equal(latestSteering,0);
  wheel.stop();
});

test('bindSteeringWheelInput integration with physics', () => {
  const physics = new CarPhysics();
  const doc = new MockDocument();
  const binding = bindSteeringWheelInput({ physics, doc });
  binding.start();
  assert.ok(binding.isActive());
  binding.stop();
  assert.equal(binding.isActive(), false);
});

test('wheel input survives physics integration and returns to neutral',()=>{
 const physics=new CarPhysics();physics.roadConstrained=false;physics.speed=20;physics.wheelSteering=.7;
 physics.integrate(.1);assert.ok(physics.steering>.2);
 physics.wheelSteering=0;const before=physics.steering;physics.integrate(.1);assert.ok(physics.steering<before);
});
