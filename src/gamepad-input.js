const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));

export function applyDeadzone(value, deadzone = 0.16) {
  const axis = clamp(value, -1, 1);
  const zone = clamp(deadzone, 0, 0.95);
  if (Math.abs(axis) <= zone) return 0;
  return Math.sign(axis) * (Math.abs(axis) - zone) / (1 - zone);
}

const buttonValue = button => typeof button === 'number' ? clamp(button, 0, 1) : button?.pressed ? Math.max(.5, clamp(button.value ?? 1, 0, 1)) : clamp(button?.value ?? 0, 0, 1);

export class GamepadInput {
  constructor({ navigatorRef = globalThis.navigator, onConnectionChange = () => {}, onHornStart = () => {}, onHornEnd = () => {}, onCameraCycle = () => {} } = {}) {
    this.navigator = navigatorRef;
    this.onConnectionChange = onConnectionChange;
    this.onHornStart = onHornStart;
    this.onHornEnd = onHornEnd;
    this.onCameraCycle = onCameraCycle;
    this.connected = false;
    this.hornDown = false;
    this.dpadUp = false;
    this.dpadDown = false;
    this.state = { steering: 0, throttle: 0, brake: 0, handbrake: false, connected: false };
  }

  poll() {
    let pad = null;
    try {
      const pads = this.navigator?.getGamepads?.();
      pad = pads ? Array.from(pads).find(item => item?.connected !== false) ?? null : null;
    } catch { /* Browser or permission does not expose gamepads. */ }
    const connected = Boolean(pad);
    if (connected !== this.connected) {
      this.connected = connected;
      this.onConnectionChange(connected);
    }
    if (!pad) {
      if (this.hornDown) this.onHornEnd();
      this.hornDown = this.dpadUp = this.dpadDown = false;
      this.state = { steering: 0, throttle: 0, brake: 0, handbrake: false, connected: false };
      return this.state;
    }
    const buttons = pad.buttons ?? [];
    const horn = buttonValue(buttons[3]) > .5;
    if (horn && !this.hornDown) this.onHornStart();
    if (!horn && this.hornDown) this.onHornEnd();
    this.hornDown = horn;
    const up = buttonValue(buttons[12]) > .5, down = buttonValue(buttons[13]) > .5;
    if (up && !this.dpadUp) this.onCameraCycle(1);
    if (down && !this.dpadDown) this.onCameraCycle(-1);
    this.dpadUp = up; this.dpadDown = down;
    const axes = pad.axes ?? [];
    this.state = {
      connected: true,
      steering: applyDeadzone(axes[0] ?? 0),
      throttle: Math.max(buttonValue(buttons[7]), buttonValue(buttons[7]) === 0 && buttons[7]?.pressed ? 1 : 0),
      brake: Math.max(buttonValue(buttons[6]), buttonValue(buttons[6]) === 0 && buttons[6]?.pressed ? 1 : 0),
      handbrake: buttonValue(buttons[0]) > .5
    };
    return this.state;
  }
}

// Temporarily blend controller analogs through physics' existing analog input
// path. Held keyboard and touch keys keep their normal priority.
export function updateWithGamepad(physics, gamepad, update) {
  const previousTilt = physics.tiltInput;
  const previousSpace = physics.keys.Space;
  const tilt = previousTilt ?? { throttle: 0, steering: 0 };
  const steeringKey = physics.keys.ArrowLeft || physics.keys.KeyA || physics.keys.ArrowRight || physics.keys.KeyD;
  const pedalKey = physics.keys.ArrowUp || physics.keys.KeyW || physics.keys.ArrowDown || physics.keys.KeyS;
  physics.tiltInput = {
    ...tilt,
    steering: steeringKey || Math.abs(physics.wheelSteering ?? 0) > .02 || Math.abs(tilt.steering ?? 0) > .02 ? tilt.steering ?? 0 : gamepad.steering,
    throttle: pedalKey || Math.abs(tilt.throttle ?? 0) > .02 ? tilt.throttle ?? 0 : gamepad.throttle - gamepad.brake
  };
  physics.keys.Space = Boolean(previousSpace || gamepad.handbrake);
  try { return update(); }
  finally {
    physics.tiltInput = previousTilt;
    physics.keys.Space = previousSpace;
  }
}
