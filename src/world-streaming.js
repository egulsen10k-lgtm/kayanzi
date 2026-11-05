const RADIUS = 6371008.8;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
const finiteLimit = (value, fallback, max) => Number.isFinite(Number(value))
  ? Math.max(0, Math.min(max, Math.floor(Number(value)))) : fallback;
const abortError = signal => signal?.reason ?? new DOMException('World request aborted', 'AbortError');

/** Bounded, coalescing request/cache helper for district streaming. */
export class WorldStreamingCoordinator {
  constructor({ maxConcurrent = 2, maxQueued = 2, maxCacheEntries = 8, cacheTtlMs = 300000 } = {}) {
    this.maxConcurrent = Math.max(1, finiteLimit(maxConcurrent, 2, 8));
    this.maxQueued = finiteLimit(maxQueued, 2, 16);
    this.maxCacheEntries = Math.max(1, finiteLimit(maxCacheEntries, 8, 64));
    this.cacheTtlMs = Math.max(0, finiteLimit(cacheTtlMs, 300000, 3600000));
    this.cache = new Map();
    this.inflight = new Map();
    this.queue = [];
    this.generation = 0;
    this.latestGeneration = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.abortedRequests = 0;
    this.activeRequests = 0;
  }

  getStats() {
    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      abortedRequests: this.abortedRequests,
      activeRequests: this.activeRequests
    };
  }

  _count(name) { this[name] = Math.min(MAX_COUNTER, this[name] + 1); }

  _key({ key, lat, lng }) {
    if (typeof key === 'string' && key.length > 0 && key.length <= 160) return key;
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
      throw new TypeError('A world request needs a valid key or geographic coordinates.');
    }
    return `${lat.toFixed(5)},${lng.toFixed(5)}`;
  }

  _read(key, now = Date.now()) {
    const entry = this.cache.get(key);
    if (entry && now - entry.savedAt < this.cacheTtlMs) {
      this._count('cacheHits');
      this.cache.delete(key); this.cache.set(key, entry);
      return entry.value;
    }
    if (entry) this.cache.delete(key);
    this._count('cacheMisses');
    return null;
  }

  _write(key, value, now = Date.now()) {
    this.cache.delete(key);
    this.cache.set(key, { value, savedAt: now });
    while (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value);
  }

  request({ key, lat, lng, signal, load, commit, cache = true } = {}) {
    if (typeof load !== 'function') return Promise.reject(new TypeError('World request load must be a function.'));
    if (signal?.aborted) { this._count('abortedRequests'); return Promise.reject(abortError(signal)); }
    let requestKey;
    try { requestKey = this._key({ key, lat, lng }); }
    catch (error) { return Promise.reject(error); }

    if (cache) {
      const cached = this._read(requestKey);
      if (cached !== null) {
        this.latestGeneration = ++this.generation;
        commit?.(cached);
        return Promise.resolve(cached);
      }
    }

    let entry = this.inflight.get(requestKey);
    if (entry) {
      // A request for this district became current again. Its existing work can
      // satisfy the newer intent, while older, different districts stay stale.
      entry.generation = ++this.generation;
      entry.commit = typeof commit === 'function' ? commit : entry.commit;
      this.latestGeneration = entry.generation;
      return this._attach(entry, signal);
    }

    if (this.activeRequests >= this.maxConcurrent && this.queue.length >= this.maxQueued) {
      return Promise.reject(new Error('World streaming queue is full.'));
    }
    entry = {
      key: requestKey, load, commit: typeof commit === 'function' ? commit : null,
      cache, controller: new AbortController(), waiters: new Set(), state: 'queued',
      generation: ++this.generation
    };
    this.latestGeneration = entry.generation;
    this.inflight.set(requestKey, entry);
    const promise = this._attach(entry, signal);
    if (this.activeRequests < this.maxConcurrent) this._start(entry);
    else this.queue.push(entry);
    return promise;
  }

  _attach(entry, signal) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: null };
      waiter.onAbort = () => {
        if (!entry.waiters.delete(waiter)) return;
        this._count('abortedRequests');
        signal?.removeEventListener('abort', waiter.onAbort);
        reject(abortError(signal));
        if (entry.waiters.size === 0) this._cancel(entry, abortError(signal));
      };
      entry.waiters.add(waiter);
      if (signal?.aborted) waiter.onAbort();
      else signal?.addEventListener('abort', waiter.onAbort, { once: true });
    });
  }

  _cancel(entry, reason) {
    if (entry.state === 'settled' || entry.state === 'cancelled') return;
    entry.state = 'cancelled';
    this.inflight.delete(entry.key);
    const queuedIndex = this.queue.indexOf(entry);
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
    entry.controller.abort(reason);
    this._drain();
  }

  async _start(entry) {
    if (entry.state !== 'queued') return;
    entry.state = 'active';
    this.activeRequests = Math.min(this.maxConcurrent, this.activeRequests + 1);
    try {
      const value = await entry.load({ signal: entry.controller.signal, key: entry.key });
      if (entry.controller.signal.aborted || entry.state === 'cancelled') throw abortError(entry.controller.signal);
      if (entry.cache && value !== null && value !== undefined) this._write(entry.key, value);
      if (entry.generation === this.latestGeneration) entry.commit?.(value);
      for (const waiter of entry.waiters) waiter.resolve(value);
    } catch (error) {
      for (const waiter of entry.waiters) waiter.reject(error);
    } finally {
      for (const waiter of entry.waiters) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      entry.waiters.clear();
      entry.state = 'settled';
      if (this.inflight.get(entry.key) === entry) this.inflight.delete(entry.key);
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      this._drain();
    }
  }

  _drain() {
    while (this.activeRequests < this.maxConcurrent && this.queue.length) {
      const next = this.queue.shift();
      if (next.state === 'queued' && next.waiters.size) this._start(next);
    }
  }
}

export function distanceMeters(a, b) {
  const longitude = ((b.lng - a.lng + 540) % 360) - 180;
  return Math.hypot((b.lat - a.lat) * Math.PI / 180 * RADIUS,
    longitude * Math.PI / 180 * RADIUS * Math.cos((a.lat + b.lat) * Math.PI / 360));
}

export function nearbyCachedWorld(cache, lat, lng, now = Date.now()) {
  let result = null, best = 80;
  for (const [key, entry] of cache) {
    if (now - entry.savedAt >= 300000) continue;
    const distance = distanceMeters(entry.network.center, {lat, lng});
    if (distance <= best) { best = distance; result = {key, ...entry}; }
  }
  return result;
}

// Request the district ahead before the current 350m patch runs out.
// Backward travel streams behind the car, not in the direction of its bonnet.
export function nextWorldLocation(position, heading, speed) {
  const distance = Math.min(100, Math.abs(speed) / 3.6 * 4) * Math.sign(speed);
  const angle = distance / RADIUS, latitude = position.lat * Math.PI / 180;
  const nextLat = Math.asin(Math.sin(latitude) * Math.cos(angle) + Math.cos(latitude) * Math.sin(angle) * Math.cos(heading));
  const delta = Math.atan2(Math.sin(heading) * Math.sin(angle) * Math.cos(latitude), Math.cos(angle) - Math.sin(latitude) * Math.sin(nextLat));
  return {lat:nextLat * 180 / Math.PI, lng:((position.lng + delta * 180 / Math.PI + 540) % 360) - 180};
}
