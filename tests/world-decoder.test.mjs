import test from 'node:test';
import assert from 'node:assert/strict';

const tick = () => new Promise(resolve => queueMicrotask(resolve));
let moduleId = 0;
async function decoder(t, WorkerClass) {
  const previous = globalThis.Worker;
  globalThis.Worker = WorkerClass;
  t.after(() => { globalThis.Worker = previous; });
  return (await import(`../src/world-decoder.js?test=${++moduleId}`)).decodeWorldAsync;
}
function mockWorker() {
  const instances = [];
  class MockWorker {
    constructor() { this.messages = []; instances.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    finish(network = { roads: [] }) {
      this.onmessage({ data: { id: this.messages.at(-1).id, network: { center: {lat:48,lng:11}, roads: [], ...network } } });
    }
  }
  return { MockWorker, instances };
}
const invoke = (decode, signal) => decode([], 48, 11, 350, signal);

test('serializes worker work and removes canceled queued requests before cloning', async t => {
  const { MockWorker, instances } = mockWorker();
  const decode = await decoder(t, MockWorker);
  const first = invoke(decode);
  const controller = new AbortController();
  const canceled = invoke(decode, controller.signal);
  const rejection = assert.rejects(canceled, { name: 'AbortError' });
  const third = invoke(decode);
  await tick();
  assert.equal(instances.length, 1);
  assert.equal(instances[0].messages.length, 1);
  controller.abort();
  await rejection;
  instances[0].finish({ marker: 'first' });
  assert.equal((await first).marker, 'first');
  await tick();
  assert.equal(instances[0].messages.length, 2);
  instances[0].finish({ marker: 'third' });
  assert.equal((await third).marker, 'third');
});

test('aborting active decode terminates obsolete worker and ignores its late result', async t => {
  const { MockWorker, instances } = mockWorker();
  const decode = await decoder(t, MockWorker);
  const controller = new AbortController();
  const canceled = invoke(decode, controller.signal);
  const rejection = assert.rejects(canceled, { name: 'AbortError' });
  await tick();
  const staleMessage = instances[0].onmessage;
  const oldId = instances[0].messages[0].id;
  const next = invoke(decode);
  controller.abort();
  await rejection;
  await tick();
  assert.ok(instances[0].terminated);
  assert.equal(instances.length, 2);
  staleMessage({ data: { id: oldId, network: { wrong: true } } });
  instances[1].finish({ fresh: true });
  assert.equal((await next).fresh, true);
});

for (const failure of ['constructor', 'postMessage', 'runtime', 'messageerror']) {
  test(`${failure} failure falls back locally and subsequent requests still decode`, async t => {
    const { MockWorker, instances } = mockWorker();
    class FailingWorker extends MockWorker {
      constructor(...args) {
        super(...args);
        if (failure === 'constructor') throw new Error('Worker blocked');
      }
      postMessage(message) {
        if (failure === 'postMessage') throw new Error('Clone failed');
        super.postMessage(message);
      }
    }
    const decode = await decoder(t, FailingWorker);
    const first = invoke(decode);
    const second = invoke(decode);
    await tick();
    if (failure === 'runtime') instances[0].onerror({ preventDefault() {} });
    if (failure === 'messageerror') instances[0].onmessageerror({});
    for (const result of await Promise.all([first, second, invoke(decode)])) {
      assert.deepEqual(result.roads, []);
      assert.deepEqual(result.center, { lat: 48, lng: 11 });
    }
    assert.equal(instances.length, 1, 'unavailable worker is not repeatedly recreated');
    if (failure !== 'constructor') assert.ok(instances[0].terminated);
  });
}

test('unavailable Worker uses local decode, and aborted requests never start', async t => {
  const decode = await decoder(t, undefined);
  const controller = new AbortController();
  controller.abort(new Error('superseded'));
  await assert.rejects(invoke(decode, controller.signal), /superseded/);
  assert.deepEqual((await invoke(decode)).roads, []);
});

test('worker data error rejects only its request and cleans abort listener', async t => {
  const { MockWorker, instances } = mockWorker();
  const decode = await decoder(t, MockWorker);
  const controller = new AbortController();
  const first = invoke(decode, controller.signal);
  const rejection = assert.rejects(first, /invalid map/);
  const second = invoke(decode);
  await tick();
  const worker = instances[0];
  worker.onmessage({ data: { id: worker.messages[0].id, error: 'invalid map' } });
  await rejection;
  controller.abort();
  await tick();
  assert.equal(worker.terminated, undefined);
  worker.finish({ valid: true });
  assert.equal((await second).valid, true);
});

test('local decode exceptions reject asynchronously without blocking later requests', async t => {
  const decode = await decoder(t, undefined);
  let invalid;
  assert.doesNotThrow(() => { invalid = decode(null, 48, 11, 350); });
  const rejection = assert.rejects(invalid, TypeError);
  const valid = invoke(decode);
  await rejection;
  assert.deepEqual((await valid).roads, []);
});

test('silent worker times out, releases queued requests and ignores late results',async t=>{
  const timers=new Map();let timerId=0;
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{assert.equal(delay,15000);timers.set(++timerId,callback);return timerId;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  const {MockWorker,instances}=mockWorker();const decode=await decoder(t,MockWorker);
  const first=invoke(decode),second=invoke(decode);await tick();
  const stale=instances[0].onmessage,oldId=instances[0].messages[0].id;
  [...timers.values()][0]();
  assert.deepEqual((await first).roads,[]);
  assert.deepEqual((await second).roads,[]);
  assert.equal(instances[0].terminated,true);
  assert.equal(timers.size,0);
  stale({data:{id:oldId,network:{wrong:true}}});
  assert.deepEqual((await invoke(decode)).roads,[]);
  assert.equal(instances.length,1);
});

test('worker watchdog is cleared on success and cancellation',async t=>{
  const timers=new Map();let timerId=0;
  t.mock.method(globalThis,'setTimeout',callback=>{timers.set(++timerId,callback);return timerId;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  const {MockWorker,instances}=mockWorker();const decode=await decoder(t,MockWorker);
  const first=invoke(decode);await tick();assert.equal(timers.size,1);
  instances[0].finish();await first;assert.equal(timers.size,0);
  const controller=new AbortController();const canceled=invoke(decode,controller.signal);
  const rejected=assert.rejects(canceled,{name:'AbortError'});await tick();
  assert.equal(timers.size,1);controller.abort();await rejected;
  assert.equal(timers.size,0);
});

for(const network of [undefined,null,42,[], 'broken',{}, {roads:[],center:null}, {roads:[],center:{lat:NaN,lng:11}}]) {
  test(`invalid worker result ${JSON.stringify(network)} falls back without blocking the queue`,async t=>{
    const {MockWorker,instances}=mockWorker();const decode=await decoder(t,MockWorker);
    const first=invoke(decode),second=invoke(decode);await tick();
    const instance=instances[0];
    instance.onmessage({data:{id:instance.messages[0].id,network}});
    for(const result of await Promise.all([first,second])) {
      assert.deepEqual(result.center,{lat:48,lng:11});
      assert.deepEqual(result.roads,[]);
    }
    assert.equal(instance.terminated,true);
    assert.equal(instances.length,1);
  });
}
