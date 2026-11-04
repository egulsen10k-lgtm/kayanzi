const METERS = 111195;
export function createRouteGuide(data) {
  const origin=data.coordinates[0],scaleX=METERS*Math.cos(origin[1]*Math.PI/180);
  const local=([lng,lat])=>[(lng-origin[0])*scaleX,(lat-origin[1])*METERS];
  const points=data.coordinates.map(local),cumulative=[0];
  for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const length=cumulative.at(-1),scale=data.distance/length;
  let index=0,progress=0,averageSpeedMs=null,speedSampleElapsed=0,pendingSpeedMs=0,elapsedSeconds=0,stopsVisited=0,visitedStops=new Set(),namedPings=new Set(),completed=false;
  const namedStops=data.stops.filter(s=>s.name&&s.lat!=null&&s.lng!=null);
  const guide={
    data,
    stopEvent:null,
    update(lat,lng,speedMs,deltaSeconds=1) {
      const delta=Math.max(0,Number.isFinite(deltaSeconds)?deltaSeconds:0);
      if(!completed)elapsedSeconds+=delta;
      if(Number.isFinite(speedMs)) {
        pendingSpeedMs=Math.abs(speedMs);
        speedSampleElapsed+=Math.max(0,Number.isFinite(deltaSeconds)?deltaSeconds:0);
        while(speedSampleElapsed>=1) {
          speedSampleElapsed-=1;
          averageSpeedMs=averageSpeedMs===null?pendingSpeedMs:averageSpeedMs*.95+pendingSpeedMs*.05;
        }
      }
      const p=local([lng,lat]);let best=null;
      // Local search prevents jumping to the final leg at a crossing or nearby parallel street.
      for(let i=Math.max(0,index-12);i<Math.min(points.length-1,index+35);i++) {
        const a=points[i],b=points[i+1],dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
        if(!squared)continue;
        const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared));
        const distance=Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);
        if(!best||distance<best.distance)best={index:i,distance,along:(cumulative[i]+Math.sqrt(squared)*t)*scale};
      }
      const offRoute=!best||best.distance>30;
      if(!offRoute){index=best.index;progress=Math.max(progress,best.along);}
      for(let i=0;i<data.stops.length;i++) {
        const stop=data.stops[i];
        if(!visitedStops.has(i)&&progress>=stop.distance-8){visitedStops.add(i);stopsVisited=visitedStops.size;}
      }
      // Named stop proximity pings (80 m radius, fires once per stop)
      const cp=local([lng,lat]);
      for(const stop of namedStops) {
        if(namedPings.has(stop.name))continue;
        const sp=local([stop.lng,stop.lat]);
        const dist=Math.hypot(cp[0]-sp[0],cp[1]-sp[1]);
        if(dist<=80){namedPings.add(stop.name);this.stopEvent={name:stop.name,number:namedPings.size,total:namedStops.length};}
      }
      const nextStop=data.stops.find(stop=>stop.distance>progress+25)??data.stops.at(-1);
      const turn=data.steps.find(step=>step.distance>progress+12&&step.length>0);
      const remaining=Math.max(0,data.distance-progress);
      const complete=!offRoute&&remaining<20;
      completed ||= complete;
      const modifier=turn?.maneuver?.modifier??'';
      const action=modifier.includes('left')?'Turn left':modifier.includes('right')?'Turn right':modifier==='uturn'?'Make a U-turn':'Continue';
      const offRouteDistance=offRoute?Math.max(0,best?.distance??0):0;
      const etaSeconds=remaining/(averageSpeedMs||11);
      return {progress,remaining,offRoute,offRouteDistance,etaSeconds,complete,nextStop:nextStop.name,elapsedSeconds,stopsVisited,
        instruction:complete?'Arrived at Pendik Sahil':offRoute?'Return to the cyan route':turn?`${action} in ${Math.max(0,Math.round((turn.distance-progress)/10)*10)} m · ${turn.name}`:'Continue to Pendik Sahil'};
    },
    get elapsedSeconds(){return elapsedSeconds;},
    get stopsVisited(){return stopsVisited;},
    restart(){index=0;progress=0;averageSpeedMs=null;speedSampleElapsed=0;pendingSpeedMs=0;elapsedSeconds=0;stopsVisited=0;visitedStops=new Set();namedPings=new Set();completed=false;this.stopEvent=null;}
  };
  return guide;
}
