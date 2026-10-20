import { decodeWorld } from './road-network.js';
self.onmessage = ({data}) => {
  const {id, elements, lat, lng, radius} = data;
  try { self.postMessage({id, network:decodeWorld(elements,lat,lng,radius)}); }
  catch(error) { self.postMessage({id,error:error.message}); }
};
