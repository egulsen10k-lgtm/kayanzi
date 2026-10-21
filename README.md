# BMW Earth Drive

Play: https://egulsen10k-lgtm.github.io/kayanzi/


A browser driving prototype with procedural BMW-inspired cars, geometric roads,
and 3D buildings generated from OpenStreetMap footprints.

## Run

```sh
npm install
npm run dev
```

Open the printed URL and choose **Start driving**. Munich includes a bundled
real map district, so its roads and buildings load without a map service.
Other destinations stream bounded local districts through the Vite server.

## Driving

- W / Up: accelerate. S / Down: brake; keep held at rest briefly to reverse.
- A / D or Left / Right: steer. Space: handbrake. H: horn.
- Touch buttons provide the same controls on phones.
- Studio controls select model, paint, camera and destination.
- **Reset to nearest road** recovers a car stopped at an awkward boundary.

Roads are solid meshes with thickness, raised edge curbs and joined corners.
The car automatically spawns on a suitable mapped street. Swept movement checks
cover the entire vehicle footprint, prevent jumping across off-road gaps,
and block building volumes. Road boundaries cannot be disabled in the UI.
Without map coverage the car remains stopped; loaded roads stay usable when
fetching the next district fails. Teleporting clears old road permissions.

Building footprints are real map geometry. Heights use height/level tags where
available and a 10-meter estimate otherwise. Windows and materials are stylized.
The ground is locally flat; this is not photogrammetry or an elevation-accurate
Google Earth simulation. Mapped bridges and tunnels use separate approximate
levels (5m per OSM layer) and connected approaches with an estimated 8% grade.
The vehicle, collision checks, camera and route ribbon follow the road level.
Underground mode hides the flat imagery/ground plane; it is not excavated terrain. Public map completeness and availability vary.

## Data and hosting

OpenStreetMap data © OpenStreetMap contributors, licensed under ODbL:
https://www.openstreetmap.org/copyright

`public/data/munich.json` contains attributed OSM ways downloaded October 17,
2026; its metadata records the source bbox and license. The minimap offers Esri
World Imagery and OpenStreetMap Streets, each with attribution. The main driving
scene combines real aerial imagery with solid asphalt geometry, raised curbs, and
road collision boundaries. Aerial imagery is flat ground imagery; buildings are
simplified extrusions of mapped footprints, not photorealistic 3D scans.

Vite proxies `/api/osm` and `/api/overpass` in development and preview.
The GitHub Pages build uses public map endpoints directly for other locations;
those services must permit browser access. Munich and the Akanzi world pack load
from bundled files without those endpoints. Global requests are bounded, timed out, cancellable,
and cached locally. No API key is required for this prototype.

Cars and physics are simplified, not validated manufacturer specifications.
Same-origin browser tabs can share driver positions; internet multiplayer,
traffic simulation and surveyed terrain elevations are outside the current scope.
Independent fan prototype, not an official BMW product.

## Validation

```sh
npm test
npm run build
```

Tests cover driving dynamics, map loading, model contracts, wheel animation,
road meshes and curbs, whole-car boundary checks, fast-motion gaps, reversing,
building collisions, teleport invalidation, and the bundled starter district.

## Akanzi coastal route

Choose **Studio → Drive Akanzi** for the bundled 20.3 km route:
Bağdat Caddesi → Caddebostan Sahil → Bostancı → Maltepe → Kartal → Pendik Sahil.
A cyan road ribbon and minimap line show the route, with remaining distance,
next stop, and maneuver guidance. Completion requires driving along the route;
teleporting to its endpoint does not complete it. Restart and End route controls
are in Studio. Choosing another destination exits route mode.

The route centerline is an OSRM car route based on OpenStreetMap, downloaded
October 17, 2026. Available mapped streets provide the driving geometry, with
normal junctions and mapped widths. The bundled starting district works offline.
If a later district cannot load, a clearly labelled offline corridor uses a
9-meter gameplay width; its bridge/elevation accuracy is unknown. “All the way” currently ends at Pendik Sahil.
Data and attribution are recorded in `public/data/akanzi-route.json` and
`public/data/akanzi-start.json` (OpenStreetMap contributors, ODbL).


## Handling and world streaming

Steering uses a 2.85m bicycle model with speed-sensitive steering and lateral
acceleration limits. Physics advances in steps of at most 1/120 second; braking
stops forward travel before reverse engages, and collisions stop without an
artificial bounce. Low grip reduces cornering traction; it is not a tire-slip
drift simulation. This remains a simplified planar vehicle model.

The next district is requested up to 100m ahead based on speed and heading.
Nearby cached districts are reused (8 entries, 5-minute lifetime); stale
requests are cancelled and a replacement that does not safely cover the car is
rejected without teleporting it. Map decoding runs in a worker. Building meshes
are merged into 100m spatial chunks with two material groups per chunk, allowing
frustum culling with far fewer draw calls. Imagery uses bounded concurrent
requests, coarse/fine detail rings and GPU cache eviction.

## Optional photographic 3D

See [PHOTOGRAPHIC-3D.md](PHOTOGRAPHIC-3D.md) for Google Map Tiles API setup.
Configure `VITE_GOOGLE_MAPS_API_KEY` in `.env.local`, restart Vite, then choose
**Studio → Open 3D preview**. No key is included. Actual provider imagery has not
been tested in this workspace. The preview pauses driving and supports A/D view
rotation; returning to driving restores the mapped-road scene.

Street View panoramas are not a collision-ready 3D world. Full photographic
street-level driving through photographic meshes still needs terrain-aware
collision and suitable licensed 3D coverage. The preview does not provide that.


## Free Akanzi world pack and scenery

`public/data/akanzi-world/manifest.json` indexes 46 overlapping OSM districts,
about 8.90 MiB total. Districts along Bağdat Caddesi–Caddebostan–Pendik load locally
on demand, with an eight-patch raw-data cache. They contain mapped roads,
buildings, parks, water boundaries and tree points. No provider key is needed.
The aerial background still requires an internet connection; these bundled
geometric districts do not. `scripts/download-akanzi-world.mjs` reproduces the
pack using sequential, resumable, bounded map requests and records attribution.

Coastal water uses the directed mapped shoreline's seaward side, with animated
surface shading. Incomplete shoreline coverage is left unfilled. Park trees are
instanced; some represent mapped tree points and others are decorative placement
inside mapped parks. Multipolygon holes and accurate terrain are not reconstructed.
Bridge decks have rails and supports; tunnels have walls and a ceiling. Bridge
heights and approach gradients are gameplay estimates rather than surveyed data.
Subterranean building footprints (including Bostancı station) do not block streets.

Sound is synthesized locally: inline-six, V8 and electric profiles, load/RPM
harmonics, shifts, exhaust, horn, tire slip, road and wind noise. These are not
recorded BMW engines. [Car model notes](CAR-MODELS.md) explain the local procedural
models and the absence of an authenticated manufacturer model download.

Validation sampled 4,306 points along Akanzi with incremental road height and
streamed district changes: no missing road surfaces or elevation jumps above
0.1m. Two tight corner centerline samples require different vehicle headings;
this sampling is not proof of a complete end-to-end driving run.

Pedestrians spawn near ground-level urban streets (maximum 16 active figures).
Press H or the mobile KORNA button to call people within 55m. They run toward the
car for up to 18 seconds and board within 2.8m when it is travelling below 8 km/h.
Capacity includes the visible driver: two seats in the M4 CSL, five in other
current models. Changing to a smaller car reduces the passenger count to fit.
Pedestrians avoid mapped buildings; their local steering is not a full sidewalk
pathfinder. Their body parts use instanced rendering to limit mobile draw calls.
Ground urban streets have 1.6m climbable sidewalks, with a 14cm rise above asphalt.
A tighter vehicle collision envelope permits closer maneuvering while buildings,
bridge/tunnel boundaries and unloaded areas remain blocked.

The Controls menu switches between touch buttons, phone tilt and a virtual wheel,
and adjusts traffic from Off through High while driving. Mobile controls sit above
the screen edge. Traffic follows road points with lane offsets and proximity
braking; it is a lightweight local simulation, not traffic-light routing.
The Milli Akanzi Song button beside Studio plays/pauses the supplied MP3.
Up to four overflow NPCs can hold onto the outside of a full car. They fall only
at 80 km/h or above after a left/right steering reversal. Six joined rigid bodies
produce the ragdoll fall, followed by recovery; seated passenger capacity is unchanged.
