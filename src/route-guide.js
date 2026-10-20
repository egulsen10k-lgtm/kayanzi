const METERS = 111195;
export function createRouteGuide(data) {
  const origin=data.coordinates[0],scaleX=METERS*Math.cos(origin[1]*Math.PI/180);
  const local=([lng,lat])=>[(lng-origin[0])*scaleX,(lat-origin[1])*METERS];
  const points=data.coordinates.map(local),cumulative=[0];
  for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const length=cumulative.at(-1),scale=data.distance/length;
  let index=0,progress=0;
  return {
    data,
    update(lat,lng) {
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
      const nextStop=data.stops.find(stop=>stop.distance>progress+25)??data.stops.at(-1);
      const turn=data.steps.find(step=>step.distance>progress+12&&step.length>0);
      const remaining=Math.max(0,data.distance-progress);
      const complete=!offRoute&&remaining<20;
      const modifier=turn?.maneuver?.modifier??'';
      const action=modifier.includes('left')?'Turn left':modifier.includes('right')?'Turn right':modifier==='uturn'?'Make a U-turn':'Continue';
      return {progress,remaining,offRoute,complete,nextStop:nextStop.name,
        instruction:complete?'Arrived at Pendik Sahil':offRoute?'Return to the cyan route':turn?`${action} in ${Math.max(0,Math.round((turn.distance-progress)/10)*10)} m · ${turn.name}`:'Continue to Pendik Sahil'};
    }
  };
}
