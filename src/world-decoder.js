import { decodeWorld } from './road-network.js';

let worker, active, nextId = 0;
let workerUnavailable = false;
let pumpScheduled = false;
// Keep the worker's expensive structured-clone/decode queue bounded to one.
// Waiting requests stay here, where cancellation can remove them immediately.
const pending = new Map();
const abortReason = signal => signal.reason ?? new DOMException('Aborted', 'AbortError');

function resetWorker() {
  const previous = worker;
  worker = undefined;
  if (previous) {
    previous.onmessage = previous.onerror = previous.onmessageerror = null;
    previous.terminate();
  }
}

function settle(request, error, network) {
  if (!pending.delete(request.id)) return;
  request.signal?.removeEventListener('abort', request.abort);
  if (active === request) active = undefined;
  if (error) request.reject(error);
  else request.resolve(network);
  schedulePump();
}

function decodeLocally(request) {
  try {
    if (request.signal?.aborted) throw abortReason(request.signal);
    const { elements, lat, lng, radius } = request;
    settle(request, null, decodeWorld(elements, lat, lng, radius));
  } catch (error) {
    settle(request, error);
  }
}

function workerFailed() {
  // Some browsers disallow workers (CSP, unavailable modules). Keep the world
  // usable instead of repeatedly spawning workers that cannot start.
  workerUnavailable = true;
  resetWorker();
  if (active) decodeLocally(active);
  else schedulePump();
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  queueMicrotask(() => {
    pumpScheduled = false;
    if (active || !pending.size) return;
    const request = pending.values().next().value;
    active = request;
    if (workerUnavailable || typeof Worker === 'undefined') {
      decodeLocally(request);
      return;
    }
    try {
      if (!worker) {
        const instance = new Worker(new URL('./world-decoder-worker.js', import.meta.url), { type: 'module' });
        worker = instance;
        instance.onmessage = ({ data }) => {
          if (worker !== instance || !active || active.id !== data?.id) return;
          settle(active, data.error ? new Error(data.error) : null, data.network);
        };
        instance.onerror = event => {
          if (worker !== instance) return;
          event.preventDefault?.();
          workerFailed();
        };
        instance.onmessageerror = () => { if (worker === instance) workerFailed(); };
      }
      const { id, elements, lat, lng, radius } = request;
      worker.postMessage({ id, elements, lat, lng, radius });
    } catch {
      workerFailed();
    }
  });
}

export function decodeWorldAsync(elements, lat, lng, radius, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const request = { id: ++nextId, elements, lat, lng, radius, signal, resolve, reject };
    request.abort = () => {
      if (!pending.has(request.id)) return;
      // A worker cannot receive an abort while its decoder is running. Terminate
      // it so obsolete work never delays the newly requested district.
      if (active === request) resetWorker();
      settle(request, abortReason(signal));
    };
    pending.set(request.id, request);
    signal?.addEventListener('abort', request.abort, { once: true });
    schedulePump();
  });
}
