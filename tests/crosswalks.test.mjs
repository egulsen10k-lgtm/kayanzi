import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoadMeshes} from '../src/road-mesh.js';
import {buildCrosswalkMesh,crosswalkLayout} from '../src/crosswalks.js';
import {buildTrafficGraph} from '../src/traffic-routes.js';
const road=(points,extra={})=>({points,width:8,highway:'residential',...extra});
const crossing=()=>({roads:[road([[-100,0],[100,0]]),road([[0,-100],[0,100]])]});
test('malformed roads and graph edges are skipped without throwing or non-finite geometry',()=>{
 const malformed=[
  {points:null,width:8,highway:'residential'},
  {points:[[0,0],[NaN,1]],width:8,highway:'residential'},
  {points:[[0,0],[1,1]],width:0,highway:'residential'},
  {points:[[0,0],[1,1]],width:8,elevations:[0,Infinity],highway:'residential'}
 ];
 assert.doesNotThrow(()=>assert.equal(buildCrosswalkMesh({roads:malformed}),null));
 assert.equal(crosswalkLayout(null),null);
 assert.equal(crosswalkLayout({road:road([[0,0],[1,1]]),to:{}}),null);
});

test('zebra crossings cover each urban junction approach in one mesh',()=>{
 const group=buildRoadMeshes(crossing()),mesh=group.getObjectByName('crosswalks');assert.ok(mesh);
 assert.equal(mesh.userData.crossings.length,4);assert.equal(mesh.geometry.attributes.position.count,4*8*6);
 const positions=mesh.geometry.attributes.position;
 for(let i=0;i<positions.count;i++){
  assert.ok(Number.isFinite(positions.getX(i))&&Number.isFinite(positions.getZ(i)));
  assert.ok(Math.abs(positions.getY(i)-.089)<1e-6);
  assert.ok(Math.min(Math.abs(positions.getX(i)),Math.abs(positions.getZ(i)))<=4,'stripe left the asphalt');
 }
 assert.equal(group.children.filter(m=>m.name==='crosswalks').length,1);
});
test('road centre dashes stop before crossing paint',()=>{
 const group=buildRoadMeshes(crossing()),crossings=group.getObjectByName('crosswalks').userData.crossings,marks=group.getObjectByName('markings').geometry.attributes.position;
 for(let i=0;i<marks.count;i++)for(const c of crossings){const dx=marks.getX(i)-c.x,dy=-marks.getZ(i)-c.y;assert.ok(Math.abs(dx*c.tangent[0]+dy*c.tangent[1])>c.depth/2||Math.abs(dx*c.normal[0]+dy*c.normal[1])>c.width/2);}
});
test('crosswalks are excluded from bridges, motorways and ordinary bends',()=>{
 const world=crossing();world.roads[1]={...world.roads[1],bridge:true,elevations:[5,5]};assert.equal(buildCrosswalkMesh(world),null);
 const motorway=crossing();motorway.roads[1].highway='motorway';assert.equal(buildCrosswalkMesh(motorway),null);
 assert.equal(buildCrosswalkMesh({roads:[road([[0,0],[0,50],[50,50]])]}),null);
});
test('invalid road fragments cannot introduce floating crosswalk geometry',()=>{
 assert.equal(buildCrosswalkMesh({roads:[road([[0,-50],[0,50]]),road([[-50,0],[NaN,0],[50,0]])]}),null);
 assert.equal(buildCrosswalkMesh({roads:[road([[0,-50],[0,50]]),{width:8,highway:'residential'}]}),null);
});
test('stop lines sit behind the zebra stripes',()=>{
 const graph=buildTrafficGraph(crossing());
 for(const edge of graph.edges){const layout=crosswalkLayout(edge);if(!layout)continue;
  const stop=[edge.end[0]-edge.tangent[0]*layout.stopOffset,edge.end[1]-edge.tangent[1]*layout.stopOffset];
  assert.ok((layout.x-stop[0])*edge.tangent[0]+(layout.y-stop[1])*edge.tangent[1]>layout.depth/2+.5);
 }
});
