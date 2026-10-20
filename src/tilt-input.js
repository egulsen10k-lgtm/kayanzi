const clamp = value => Math.max(-1, Math.min(1, value));
const axis = degrees => Math.abs(degrees) < 4 ? 0 : Math.sign(degrees) * Math.min(1, (Math.abs(degrees) - 4) / 22);
const delta = (a, b) => ((a - b + 540) % 360) - 180;

// Rotate sensor axes into the current screen orientation before applying the neutral pose.
export function tiltAxes(sample, neutral, angle = 0) {
  const radians = angle * Math.PI / 180;
  const pitch = delta(sample.beta, neutral.beta);
  const roll = delta(sample.gamma, neutral.gamma);
  return {
    throttle: clamp(axis(-(pitch * Math.cos(radians) + roll * Math.sin(radians)))),
    steering: clamp(axis(-(roll * Math.cos(radians) - pitch * Math.sin(radians)))),
  };
}

export function bindTiltInput({ physics, button, calibrate, status, win = window, doc = document }) {
  let enabled = false, neutral = null, lastSample = null, lastAt = 0, generation = 0;
  const zero = () => { physics.tiltInput = { throttle: 0, steering: 0 }; };
  const angle = () => win.screen?.orientation?.angle ?? win.orientation ?? 0;
  let screenAngle = angle();
  const stop = (message = 'Touch controls active.') => {
    generation++; enabled = false; neutral = null; lastSample = null; zero();
    button.textContent = 'Enable tilt'; button.setAttribute('aria-pressed', 'false');
    calibrate.disabled = true; status.textContent = message;
  };
  button.addEventListener('click', async () => {
    if (enabled) { stop(); return; }
    const token = ++generation;
    if (!win.DeviceOrientationEvent) { stop('Tilt unavailable on this device. Use touch controls.'); return; }
    button.disabled = true;
    try {
      if (typeof win.DeviceOrientationEvent.requestPermission === 'function' &&
          await win.DeviceOrientationEvent.requestPermission() !== 'granted') {
        stop('Motion permission denied. Use touch controls.'); return;
      }
      if (token !== generation) return;
      enabled = true; neutral = null; lastSample = null; lastAt = Date.now(); screenAngle = angle(); zero();
      button.textContent = 'Disable tilt'; button.setAttribute('aria-pressed', 'true');
      calibrate.disabled = false;
      status.textContent = 'Hold comfortably still: calibrating…';
    } catch { stop('Motion access unavailable. Use touch controls.'); }
    finally { button.disabled = false; }
  });
  calibrate.addEventListener('click', () => {
    if (!enabled) return;
    neutral = null; zero(); status.textContent = 'Hold your neutral position…';
  });
  win.addEventListener('deviceorientation', event => {
    if (!enabled) return;
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) { zero(); return; }
    if (angle() !== screenAngle) { stop('Screen rotated. Enable tilt again to calibrate.'); return; }
    lastSample = { beta: event.beta, gamma: event.gamma }; lastAt = Date.now();
    if (!neutral) { neutral = lastSample; zero(); status.textContent = 'Forward: gas · Back: brake / reverse · Left / right: steer'; return; }
    physics.tiltInput = tiltAxes(lastSample, neutral, screenAngle);
  });
  // Never retain throttle when the sensor stream stops or the app loses focus.
  win.setInterval(() => {
    if (enabled && Date.now() - lastAt > 1500) stop('No motion signal. Use touch controls or enable tilt again.');
  }, 250);
  win.addEventListener('blur', () => stop('Tilt paused. Enable tilt to resume.'));
  win.addEventListener('orientationchange', () => stop('Screen rotated. Enable tilt again to calibrate.'));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stop('Tilt paused. Enable tilt to resume.'); });
  return { stop };
}
