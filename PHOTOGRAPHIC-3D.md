# Optional photographic 3D preview

The default game uses OpenStreetMap geometry. It is not Street View. The optional
preview uses Google's Photorealistic 3D Tiles: textured reconstructed meshes rather
than a flat aerial photograph. Driving must remain paused in this preview; the
mesh is not a road collision model, and its highest surface may be a tree or roof.

Configure `VITE_GOOGLE_MAPS_API_KEY` in `.env.local`, then restart Vite. The Google
Cloud project needs billing and the Map Tiles API enabled. Restrict the browser
key to the application's HTTP referrers and Map Tiles API. Vite exposes `VITE_`
values to the browser by design; do not use a server secret here.

No key was available during implementation. Live imagery, local coverage, visual
quality and billing behavior are therefore **not verified**. Unit tests cover the
WGS84 coordinate transform and the no-key path only. A configured deployment must
check imagery loading, error states and attribution before advertising this mode.

`PhotorealWorld` initializes its renderer lazily, transforms ECEF coordinates into
east/up/south around the current location, and raycasts at most four times per
second to anchor the preview. Start its camera above ground (approximately 1200 m)
until `groundReady`, then move to the elevated neighborhood observation position. The raycast
is a visual anchor, not proof that a road is present. Call `dispose()` on exit.

The renderer uses screen-space LOD, frustum selection, four download jobs, two
parse jobs, two Draco workers, and an in-memory LRU with a 160 MiB/200-tile target.
Visible tiles and temporary decoding buffers can exceed the target. It does not
download offline packs or persist tiles. The browser handles HTTP cache headers.
The Draco decoder is shipped locally from the installed Three.js distribution.

Always show `photorealstatus.detail.attribution` when the preview is visible; it
combines Google Maps and the visible tiles' copyright strings. Keep it unobscured.
Coverage varies and reconstructed street details are not Street View panoramas.

Sources:

- [Google Photorealistic 3D Tiles setup](https://developers.google.com/maps/documentation/tile/3d-tiles)
- [Google Map Tiles attribution and caching policies](https://developers.google.com/maps/documentation/tile/policies)
- [Versioned Three.js renderer integration example](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/v0.3.40/example/googleMapsAerial.js)
