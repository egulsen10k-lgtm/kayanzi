// Keep keyboard and individual fingers independent: releasing one cannot cancel another.
export function bindDrivingInput({ physics, buttons, onHorn = () => {}, onHornStart = onHorn, onHornEnd = () => {}, isRobotMode = () => false, onRobotJump = () => {}, win = window, doc = document }) {
  const codes = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
  const keyboard = new Set();
  const held = new Map();
  const sync = (code) => { physics.keys[code] = keyboard.has(code) || [...held.values()].some(v => v.code === code); };
  const release = (id) => {
    const item = held.get(id);
    if (!item) return;
    held.delete(id);
    item.button.setAttribute('aria-pressed', 'false');
    if (item.button.hasPointerCapture(id)) item.button.releasePointerCapture(id);
    sync(item.code);
  };
  const clear = () => {
    onHornEnd();
    keyboard.clear();
    for (const id of [...held.keys()]) release(id);
    for (const code of codes) physics.keys[code] = false;
  };
  win.addEventListener('keydown', e => {
    const active = doc.activeElement;
    if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) return;
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
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) clear(); });
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
      button.setPointerCapture(e.pointerId);
      held.set(e.pointerId, { button, code });
      button.setAttribute('aria-pressed', 'true');
      sync(code);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, e => release(e.pointerId));
    button.addEventListener('contextmenu', e => e.preventDefault());
  }
  return { clear };
}
