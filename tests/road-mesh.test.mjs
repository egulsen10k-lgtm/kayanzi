import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadMeshes, ROAD_SURFACE_HEIGHT } from '../src/road-mesh.js';

const make = (points, highway = 'residential') => buildRoadMeshes({roads:[{points, width:6, highway}]});
const bounds = mesh => {mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox;};

test('road surfaces have thickness and raised curbs only at their edges', () => {
  const group = make([[0,0], [0,100]]);
  const asphalt = bounds(group.getObjectByName('asphalt'));
  assert.equal(asphalt.min.x, -3);
  assert.equal(asphalt.max.x, 3);
  assert.equal(asphalt.min.z, -103);
  assert.ok(asphalt.min.y < 0 && Math.abs(asphalt.max.y - ROAD_SURFACE_HEIGHT) < 1e-6);
  const curbs = group.getObjectByName('curbs').geometry.attributes.position;
  for (let i=0; i<curbs.count; i++) {
    const x=curbs.getX(i), z=curbs.getZ(i);
    const nearestZ=Math.max(-100,Math.min(0,z));
    assert.ok(Math.hypot(x,z-nearestZ)>=3-1e-5, 'sidewalk stays outside the rounded asphalt surface');
  }
  assert.ok(Math.abs(bounds(group.getObjectByName('curbs')).max.x-4.6)<1e-6, 'sidewalk is 1.6m wide');
  assert.ok(bounds(group.getObjectByName('curbs')).max.y > asphalt.max.y);
});

test('joined corners have shared cross-sections and bounded miters', () => {
  const group = make([[0,0],[0,10],[10,10]]);
  const positions = group.getObjectByName('asphalt').geometry.attributes.position.array;
  assert.ok([...positions].every(Number.isFinite));
  const box = bounds(group.getObjectByName('asphalt'));
  assert.equal(box.min.x, -3);
  assert.equal(box.min.z, -13);
  // Top of each segment ends/starts on the same two mitered points.
  const triangles = [];
  for(let i=0;i<positions.length;i+=9) {
    const t = Array.from(positions.slice(i,i+9));
    if ([t[1],t[4],t[7]].every(y=>Math.abs(y-ROAD_SURFACE_HEIGHT)<1e-6)) triangles.push(t);
  }
  const shared = triangles.flatMap(t=>[[t[0],t[2]],[t[3],t[5]],[t[6],t[8]]]).filter(([x,z])=>x===3&&z===-7);
  assert.ok(shared.length >= 2);
});

test('invalid vertices do not bridge gaps and motorway edges have no urban curbs', () => {
  const group = make([[0,0],[0,10],[NaN,20],[100,100],[100,110]], 'motorway');
  assert.equal(group.getObjectByName('curbs'), undefined);
  const positions = group.getObjectByName('asphalt').geometry.attributes.position;
  for(let i=0;i<positions.count;i++) assert.ok(positions.getX(i)<=3 || positions.getX(i)>=97);
  assert.equal(make([[1,1],[1,1]]).children.length, 0);
});

test('marking cadence does not reset at each small map segment', () => {
  const group = make([[0,0],[0,2],[0,4],[0,6],[0,8],[0,10]]);
  const p = group.getObjectByName('markings').geometry.attributes.position;
  for(let i=0;i<p.count;i++) { const d=-p.getZ(i); assert.ok(d <=3 || d >=8); }
});

test('crossings halfway along long segments have no curb walls or crossing lane dashes', () => {
  const group = buildRoadMeshes({roads:[
    {points:[[-50,0],[50,0]],width:8,highway:'residential'},
    {points:[[0,-50],[0,50]],width:8,highway:'residential'}
  ]});
  const curbs = group.getObjectByName('curbs').geometry.attributes.position;
  // Check triangle centroids, not only endpoints: a wall may span the junction.
  for (let i=0;i<curbs.count;i+=3) {
    const x=(curbs.getX(i)+curbs.getX(i+1)+curbs.getX(i+2))/3;
    const z=(curbs.getZ(i)+curbs.getZ(i+1)+curbs.getZ(i+2))/3;
    assert.ok(Math.abs(x)>4.3 || Math.abs(z)>4.3, 'intersection must remain open');
  }
  const marks=group.getObjectByName('markings').geometry.attributes.position;
  for(let i=0;i<marks.count;i++) assert.ok(Math.abs(marks.getX(i))>4.3 || Math.abs(marks.getZ(i))>4.3);
  assert.ok(curbs.count>0, 'curbs should remain along the street away from intersections');
});

test('sidewalks wrap rounded street ends but do not extend bridge or tunnel decks',()=>{
  const street=make([[0,0],[0,100]]);
  const sidewalk=bounds(street.getObjectByName('curbs'));
  assert.ok(Math.abs(sidewalk.min.z+104.6)<1e-5);
  assert.ok(Math.abs(sidewalk.max.z-4.6)<1e-5);
  for(const tag of ['bridge','tunnel']) {
    const group=buildRoadMeshes({roads:[{width:6,highway:'residential',[tag]:true,points:[[0,0],[0,100]],elevations:[5,5]}]});
    assert.equal(group.getObjectByName('curbs'),undefined);
    assert.ok(group.getObjectByName('structures'));
  }
});
