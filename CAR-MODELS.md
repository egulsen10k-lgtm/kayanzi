# Car models

The four car models in `src/car-model.js` are original procedural interpretations of BMW-style sport sedans/coupes. They are **not official BMW CAD models, scans, or manufacturer-licensed reproductions**. The M3, M4, M5 and i4 names identify the intended visual/handling profiles. Geometry is generated locally and needs no external asset download.

The models include a tapered cabin, front/rear glass, roof pillars, mirrors, twin kidney-style grilles, front/rear lamps, wheel arches, split-spoke wheels, stationary brake calipers and exhausts on combustion profiles. Paint changes affect the painted panels only. Wheel steering and spin remain independent. Generic blue/white geometric badges are generated locally; no remote logo texture is fetched.

The previous unrelated Ferrari GLB overlay has been removed. It was not a BMW model and did not replace or align with the procedural wheels/body.

## Possible future replacement assets

Primary creator pages checked during this work:

- [BMW M3 (F80), Mona x Supercars](https://sketchfab.com/3d-models/bmw-m3-f80-7be23191bef447f68133afbf63f1e669): the creator page lists CC Attribution. Its approximately 1.4 million triangles need substantial optimization before mobile use.
- [Low Poly BMW G80 M3, SharkyStudios](https://sketchfab.com/3d-models/low-poly-bmw-g80-m3-ea3e807ff69e40fe82c5577ee9f0a2f4): the creator page lists CC Attribution.

Neither external model is bundled. Downloads were not available as a verified direct public GLB in this session. A future import should preserve the creator's attribution/license, check downloaded contents, normalize dimensions and forward direction, extract wheel pivots, identify paint materials, and replace the procedural shell rather than overlay it. A creator's asset license does not imply endorsement by BMW.
