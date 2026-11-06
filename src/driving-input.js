// Keep keyboard and individual fingers independent: releasing one cannot cancel another.
export { GamepadInput, applyDeadzone, updateWithGamepad } from './gamepad-input.js';

export function bindDrivingInput({ physics, buttons, onHorn = () => {}, onHornStart = onHorn, onHornEnd = () => {}, isRobotMode = () => false, onRobotJump = () => {}, win = window, doc = document }) {
  const codes = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
  const keyboard = new Set();
  const held = new Map();
  const sync = (code) => { physics.keys[code] = keyboard.has(code) || [...held.values()].some(v => v.code === code); };
  const release = (id) => {
    const item = held.get(id);
    if (!item) return;
    held.delete(id);
    try { item.button.setAttribute('aria-pressed', 'false'); } catch {}
    sync(item.code);
    try {
      if (item.button.hasPointerCapture?.(id)) item.button.releasePointerCapture?.(id);
    } catch {}
  };
  const clearKeyboard = () => {
    onHornEnd();
    keyboard.clear();
    for (const code of codes) sync(code);
  };
  const clear = () => {
    clearKeyboard();
    for (const id of [...held.keys()]) release(id);
    for (const code of codes) physics.keys[code] = false;
  };
  const isEditable = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
  win.addEventListener('keydown', e => {
    const active = doc.activeElement;
    if (isEditable(active)) return;
    if(e.code==='Space'&&isRobotMode()) {
      e.preventDefault();
      physics.keys.Space=false;
      if(!e.repeat)onRobotJump();
      return;
    }
    if (codes.has(e.code)) { e.preventDefault(); keyboard.add(e.code); sync(e.code); }
    if (e.code === 'KeyH' && !e.repeat) onHornStart();
  });
  win.addEventListener('keyup', e => { keyboard.delete(e.code); if (codes.has(e.code)) sync(e.code); if (e.code === 'KeyH') onHornEnd(); });
  win.addEventListener('blur', clear);
  win.addEventListener('resize', clear);
  doc.addEventListener?.('visibilitychange', () => { if (doc.hidden) clear(); });
  doc.addEventListener?.('focusin', e => {
    if (isEditable(e.target || doc.activeElement)) clearKeyboard();
  });
  for (const event of ['pointerup', 'pointercancel']) {
    doc.addEventListener?.(event, e => {
      if (held.has(e.pointerId)) release(e.pointerId);
    });
  }
  for (const button of buttons) {
    const code = button.getAttribute('data-drive-key');
    button.addEventListener('pointerdown', e => {
      if (e.button !== 0 || [...held.values()].some(v => v.button === button)) return;
      if(code==='Space'&&isRobotMode()) {
        e.preventDefault();
        physics.keys.Space=false;
        onRobotJump();
        return;
      }
      e.preventDefault();
      try { button.setPointerCapture?.(e.pointerId); } catch {}
      held.set(e.pointerId, { button, code });
      try { button.setAttribute('aria-pressed', 'true'); } catch {}
      sync(code);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, e => release(e.pointerId));
    button.addEventListener('contextmenu', e => e.preventDefault());
  }
  return { clear };
}
