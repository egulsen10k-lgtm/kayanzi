import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRoads, decodeWorld } from '../src/road-network.js';

const response = (elements, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ elements })
});

const coordinatesAt = (northMeters) => northMeters / 111195;

test('loads drivable OSM ways as clipped local-meter road geometry', async () => {
  let request;
  const result = await loadRoads({
    lat: 0,
    lng: 0,
    radiusMeters: 250,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response([
        { type: 'way', id: 12, tags: { highway: 'residential', name: 'Main St', lanes: '2' }, geometry: [
          { lat: coordinatesAt(-600), lon: 0 },
          { lat: coordinatesAt(600), lon: 0 }
        ] },
        { type: 'way', id: 13, tags: { highway: 'footway' }, geometry: [
          { lat: 0, lon: 0 }, { lat: 0.0001, lon: 0 }
        ] }
      ]);
    }
  });

  assert.equal(request.url, '/api/overpass');
  assert.equal(request.options.method, 'POST');
  const query = new URLSearchParams(request.options.body).get('data');
  assert.match(query, /around:250,0,0/);
  assert.match(query, /motorway_link/);
  assert.match(query, /tertiary_link/);
  assert.match(query, /residential/);
  assert.equal(result.center.lat, 0);
  assert.equal(result.roads.length, 1);
  assert.equal(result.roads[0].id, 'way/12/0');
  assert.equal(result.roads[0].name, 'Main St');
  assert.equal(result.roads[0].highway, 'residential');
  assert.equal(result.roads[0].width, 6.4);
  assert.ok(Math.abs(result.roads[0].points[0][1] + 250) < 0.1);
  assert.ok(Math.abs(result.roads[0].points.at(-1)[1] - 250) < 0.1);
});

test('uses public global Overpass mirrors when the primary service is unavailable', async () => {
  const attempts = [];
  const network = await loadRoads({
    lat: 48.1764,
    lng: 11.5583,
    radiusMeters: 300,
    fetchImpl: async (url) => {
      attempts.push(url);
      return url === '/api/overpass'
        ? response([], 406)
        : response([]);
    }
  });

  assert.deepEqual(attempts, ['/api/overpass', '/api/overpass/private']);
  assert.equal(network.roads.length, 0);
});

test('projects roads across the antimeridian and parses tagged width units', async () => {
  const result = await loadRoads({
    lat: 0,
    lng: 179.999,
    radiusMeters: 500,
    fetchImpl: async () => response([
      {
        type: 'way', id: 14, tags: { highway: 'primary', width: '9.5 m' }, geometry: [
          { lat: 0, lon: -179.999 }, { lat: 0.001, lon: -179.999 }
        ]
      },
      {
        type: 'way', id: 16, tags: { highway: 'residential', width: '20 ft' }, geometry: [
          { lat: 0, lon: 179.999 }, { lat: 0.001, lon: 179.999 }
        ]
      }
    ])
  });

  assert.equal(result.roads[0].width, 9.5);
  assert.ok(Math.abs(result.roads[1].width - 6.096) < 1e-9);
  assert.ok(result.roads.every((road) => road.points.every(([east, north]) => Math.hypot(east, north) <= 500.01)));
});

test('rejects invalid coordinates and radius before making a request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response([]); };
  await assert.rejects(loadRoads({ lat: 91, lng: 0, fetchImpl }), RangeError);
  await assert.rejects(loadRoads({ lat: 0, lng: 0, radiusMeters: 5001, fetchImpl }), RangeError);
  assert.equal(calls, 0);
});

test('does not join geometry across invalid OSM coordinates', async () => {
  const result = await loadRoads({
    lat: 0,
    lng: 0,
    fetchImpl: async () => response([{
      type: 'way', id: 15, tags: { highway: 'residential' }, geometry: [
        { lat: 0, lon: 0 },
        { lat: 0.001, lon: 0 },
        { lat: 91, lon: 0 },
        { lat: 0, lon: 0.001 },
        { lat: 0.001, lon: 0.001 }
      ]
    }])
  });

  assert.equal(result.roads.length, 2);
  assert.ok(result.roads.every((road) => road.points.length >= 2));
  assert.notDeepEqual(result.roads[0].points.at(-1), result.roads[1].points[0]);
});

test('rejects malformed JSON response shapes and reports service failures', async () => {
  await assert.rejects(
    loadRoads({ lat: 0, lng: 0, fetchImpl: async () => response([], 503) }),
    /HTTP 503/
  );
  await assert.rejects(
    loadRoads({ lat: 0, lng: 0, fetchImpl: async () => ({ ok: true, json: async () => null }) }),
    /JSON object/
  );
  await assert.rejects(
    loadRoads({ lat: 0, lng: 0, fetchImpl: async () => ({ ok: true, json: async () => [] }) }),
    /JSON object/
  );
});

test('coalesces identical native-fetch requests and returns isolated cached results', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    return response([{ type: 'way', id: 21, tags: { highway: 'residential' }, geometry: [
      { lat: 12.345678, lon: 23.456789 },
      { lat: 12.345678 + coordinatesAt(100), lon: 23.456789 }
    ] }]);
  };

  try {
    const firstPromise = loadRoads({ lat: 12.345678, lng: 23.456789, radiusMeters: 300 });
    const secondPromise = loadRoads({ lat: 12.345678, lng: 23.456789, radiusMeters: 300 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    first.roads[0].points[0][0] = 999;

    const cached = await loadRoads({ lat: 12.345678, lng: 23.456789, radiusMeters: 300 });
    assert.equal(calls, 1);
    assert.notEqual(second.roads[0].points[0][0], 999);
    assert.notEqual(cached.roads[0].points[0][0], 999);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bounds successful-response cache and keys entries by the full request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response([]); };

  try {
    for (let index = 0; index < 17; index++) {
      await loadRoads({ lat: index, lng: 50, radiusMeters: 300 });
    }
    await loadRoads({ lat: 0, lng: 50, radiusMeters: 300 });
    assert.equal(calls, 18);

    await loadRoads({ lat: 1, lng: 50, radiusMeters: 301 });
    assert.equal(calls, 19);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expires cached native-fetch responses after five minutes', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response([]); };
  Date.now = () => now;

  try {
    await loadRoads({ lat: 33.234567, lng: 43.234567, radiusMeters: 300 });
    now += 5 * 60 * 1000 - 1;
    await loadRoads({ lat: 33.234567, lng: 43.234567, radiusMeters: 300 });
    assert.equal(calls, 1);

    now++;
    await loadRoads({ lat: 33.234567, lng: 43.234567, radiusMeters: 300 });
    assert.equal(calls, 2);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test('shared requests abort upstream only after every waiter cancels', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamSignal;
  globalThis.fetch = (_url, { signal }) => {
    upstreamSignal = signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };

  const firstController = new AbortController();
  const secondController = new AbortController();
  try {
    const first = loadRoads({ lat: 34.234567, lng: 44.234567, radiusMeters: 300, signal: firstController.signal });
    const second = loadRoads({ lat: 34.234567, lng: 44.234567, radiusMeters: 300, signal: secondController.signal });
    await new Promise((resolve) => setImmediate(resolve));

    firstController.abort(new Error('first caller cancelled'));
    await assert.rejects(first, /first caller cancelled/);
    assert.equal(upstreamSignal.aborted, false);

    secondController.abort(new Error('last caller cancelled'));
    await assert.rejects(second, /last caller cancelled/);
    assert.equal(upstreamSignal.aborted, true);
  } finally {
    firstController.abort();
    secondController.abort();
    globalThis.fetch = originalFetch;
  }
});

test('caches only successful native-fetch responses and keeps injected fetches isolated', async () => {
  const originalFetch = globalThis.fetch;
  let nativeCalls = 0;
  globalThis.fetch = async () => {
    nativeCalls++;
    return nativeCalls <= 3 ? response([], 503) : response([]);
  };

  try {
    await assert.rejects(loadRoads({ lat: 31.234567, lng: 41.234567 }), /HTTP 503/);
    assert.equal(nativeCalls, 3);
    await loadRoads({ lat: 31.234567, lng: 41.234567 });
    await loadRoads({ lat: 31.234567, lng: 41.234567 });
    assert.equal(nativeCalls, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }

  let injectedCalls = 0;
  const fetchImpl = async () => { injectedCalls++; return response([]); };
  await loadRoads({ lat: 32.234567, lng: 42.234567, fetchImpl });
  await loadRoads({ lat: 32.234567, lng: 42.234567, fetchImpl });
  assert.equal(injectedCalls, 2);
});

test('grade-separated ways retain distinct approximate elevations', async () => {
  const tags = [
    {highway:'residential'}, {highway:'residential',bridge:'no',layer:'0'},
    {highway:'primary',bridge:'yes'}, {highway:'primary',bridge:'viaduct'},
    {highway:'primary',layer:'1'}, {highway:'primary',layer:'-1'},
    {highway:'primary',tunnel:'building_passage'}, {highway:'primary',tunnel:'yes'},
    {highway:'primary',location:'underground'}
  ];
  const network = await loadRoads({lat:0,lng:0,fetchImpl:async()=>response(tags.map((tags,id)=>({
    type:'way',id,tags,geometry:[{lat:0,lon:0},{lat:.001,lon:0}]
  })))});
  assert.equal(network.roads.length, 9);
  assert.equal(network.omittedGradeSeparatedRoads, 0);
  assert.ok(network.roads[2].elevations.every(h=>h===5));
  assert.ok(network.roads[7].elevations.every(h=>h===-5));
});

test('node-based map decoding preserves elevated roads like Overpass', () => {
  const network = decodeWorld([
    {type:'node',id:1,lat:0,lon:0},
    {type:'node',id:2,lat:.001,lon:0},
    {type:'way',id:3,nodes:[1,2],tags:{highway:'primary',layer:'1'}},
    {type:'way',id:4,nodes:[1,2],tags:{highway:'residential'}}
  ],0,0,300);
  assert.deepEqual(network.roads.map(r=>r.id), ['way/3/0','way/4/0']);
  assert.equal(network.omittedGradeSeparatedRoads, 0);
});
