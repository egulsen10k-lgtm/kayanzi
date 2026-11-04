export class PauseState {
  constructor(onChange = () => {}) { this.paused = false; this.onChange = onChange; }
  set(paused) {
    const next = Boolean(paused);
    if (next === this.paused) return this.paused;
    this.paused = next;
    this.onChange(next);
    return this.paused;
  }
  toggle() { return this.set(!this.paused); }
  shouldSkipFrame(runnerActive = false) { return this.paused && !runnerActive; }
  runIfActive(update) {
    if (this.paused) return false;
    update();
    return true;
  }
}
