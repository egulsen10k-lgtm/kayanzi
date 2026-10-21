// Virtual steering wheel for touch devices
const clamp = value => Math.max(-1, Math.min(1, value));

export function createSteeringWheel({ container, onChange, win = typeof window !== 'undefined' ? window : {}, doc = typeof document !== 'undefined' ? document : {} }) {
  let wheelElement = null;
  let active = false;
  let touchId = null;
  let center = { x: 0, y: 0 };
  let maxRadius = 60;
  let currentSteering = 0;

  const createWheel = () => {
    const el = doc.createElement('div');
    el.id = 'virtual-steering-wheel';
    el.style.cssText = `
      position: fixed;
      bottom: calc(72px + env(safe-area-inset-bottom));
      left: 94px;
      transform: translateX(-50%);
      z-index: 17;
      width: 140px;
      height: 140px;
      background: rgba(8,20,30,.35);
      border: 8px solid #506f7d;
      box-shadow: inset 0 0 0 2px #9ac9d4, 0 3px 12px #0007;
      border-radius: 50%;
      backdrop-filter: blur(10px);
      touch-action: none;
      cursor: pointer;
      transition: opacity 0.3s ease;
    `;
    el.hidden = true;

    // Wheel marker (top indicator)
    const marker = doc.createElement('div');
    marker.style.cssText = `
      position: absolute;
      top: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 4px;
      height: 10px;
      background: var(--accent-cyan, #79d9f0);
      border-radius: 2px;
    `;
    el.appendChild(marker);

    for (const angle of [-30,90,210]) {
      const spoke=doc.createElement('div');
      spoke.style.cssText=`position:absolute;left:50%;top:50%;width:53px;height:8px;background:#657e88;transform-origin:left center;transform:rotate(${angle}deg);border-radius:4px;pointer-events:none;`;
      el.appendChild(spoke);
    }
    // Center hub
    const hub = doc.createElement('div');
    hub.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 40px;
      height: 40px;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle, rgba(255,255,255,.15) 0%, rgba(0,0,0,.5) 100%);
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,.1);
    `;
    el.appendChild(hub);

    container.appendChild(el);
    return el;
  };

  const getPosition = (touch) => {
    const rect = wheelElement.getBoundingClientRect();
    return {
      x: touch.clientX - rect.left - rect.width / 2,
      y: touch.clientY - rect.top - rect.height / 2
    };
  };

  const updateSteering = (pos) => {
    const dx = pos.x;
    let steering = -dx / 50;
    steering = clamp(steering);
    currentSteering = steering;
    onChange?.(steering);
  };

  const reset = () => {
    if (!wheelElement) return;
    active = false;
    touchId = null;
    currentSteering = 0;
    onChange?.(0);
    wheelElement.style.transform = 'translateX(-50%) rotate(0deg)';
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || active) return;
    e.preventDefault();
    touchId = e.pointerId;
    active = true;
    wheelElement.setPointerCapture(touchId);
    wheelElement.style.transform = 'translateX(-50%) scale(1.05)';
  };

  const onPointerMove = (e) => {
    if (!active || e.pointerId !== touchId) return;
    e.preventDefault();
    const pos = getPosition(e);
    const distance = Math.hypot(pos.x, pos.y);
    const maxRadius = wheelElement.offsetWidth / 2 - 30;

    if (distance > maxRadius) {
      const angle = Math.atan2(pos.x, -pos.y);
      pos.x = Math.sin(angle) * maxRadius;
      pos.y = -Math.cos(angle) * maxRadius;
    }

    // Visual rotation based on steering
    const rotation = clamp(pos.x / maxRadius) * 60;
    wheelElement.style.transform = `translateX(-50%) rotate(${rotation}deg)`;

    updateSteering(pos);
  };

  const onPointerUp = (e) => {
    if (e.pointerId !== touchId) return;
    const captured=touchId;
    reset();
    if (wheelElement.hasPointerCapture(captured)) wheelElement.releasePointerCapture(captured);
    wheelElement.style.transform = 'translateX(-50%)';
  };

  if (!wheelElement) {
    wheelElement = createWheel();
  }

  wheelElement.addEventListener('pointerdown', onPointerDown);
  wheelElement.addEventListener('pointermove', onPointerMove);
  wheelElement.addEventListener('pointerup', onPointerUp);
  wheelElement.addEventListener('pointercancel', onPointerUp);
  wheelElement.addEventListener('lostpointercapture', reset);
  win.addEventListener?.('blur', reset);
  win.addEventListener?.('resize', reset);

  wheelElement.hidden = false;

  return {
    wheelElement,
    stop() {
      reset();
      win.removeEventListener?.('blur',reset);win.removeEventListener?.('resize',reset);
      wheelElement?.remove();
      wheelElement = null;
      active = false;
    },
    show() { wheelElement.hidden = false; },
    hide() { wheelElement.hidden = true; },
    setSteering(steering) {
      const maxRadius = wheelElement.offsetWidth / 2 - 30;
      const x = clamp(steering) * maxRadius;
      const rotation = clamp(steering) * 60;
      wheelElement.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
    }
  };
}

export function bindSteeringWheelInput({ physics, onChange, win = typeof window !== 'undefined' ? window : {}, doc = typeof document !== 'undefined' ? document : {} }) {
  let wheel = null;

  const start = () => {
    if (wheel) return;
    const container = doc.getElementById('main-viewport');
    if (!container) return;
    wheel = createSteeringWheel({
      container,
      doc,
      win,
      onChange(steering) {
        physics.wheelSteering = steering;
        onChange?.(steering);
      }
    });
  };

  const stop = () => {
    wheel?.stop();
    wheel = null;
    physics.wheelSteering = 0;
  };

  return { start, stop, isActive: () => !!wheel };
}
