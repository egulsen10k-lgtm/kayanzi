# CONTINUE WORK PROMPT - BMW Driving Sim

Copy this ENTIRE prompt into any new Claude Code session to keep work going:

---
LOCATION: /Users/emincanglsn/orca/workspaces/web race/queenfish
BRANCH: emncnglsn/feat-bmw-world-drive

LOOP - Run every 10 minutes until app is perfect or limits exhausted:

STEP 1: Tests
  npm test 2>&1 | tail -5

STEP 2: Git state
  git diff --stat

STEP 3: Enhance car (src/car-model.js)
  Read lines 1-145
  BEFORE return statement, ADD:
  
  // Hood character lines
  for (const side of [-1, 1]) {
    const line = mesh(new THREE.BoxGeometry(.015,.02,.95), black, 'hood-line', side*.32, p.height-.08, .15);
    group.add(line);
  }
  
  // Side air intakes
  for (const side of [-1, 1]) {
    const vent = mesh(new THREE.BoxGeometry(.08,.12,.35), black, 'side-vent', side*(p.width/2+.01), .55, .2);
    group.add(vent);
  }
  
  // Fog lamps
  for (const side of [-1, 1]) {
    const fog = mesh(new THREE.BoxGeometry(.12,.06,.04), amber, 'fog-lamp', side*.55, .32, .92);
    group.add(fog);
  }
  
  // Wiper arm
  const wiperArm = mesh(new THREE.BoxGeometry(.03,.03,.55), black, 'wiper-arm', .15, p.height-.15, .5);
  wiperArm.rotation.z = -.3; wiperArm.rotation.x = .15; group.add(wiperArm);
  
  // Rear spoiler on M5/CS
  if (modelType === 'm5') {
    const spoilerBase = mesh(new THREE.BoxGeometry(p.width*.7,.08,.12), black, 'spoiler-base', 0, p.height-.05, -half+.08);
    group.add(spoilerBase);
    const spoilerLip = mesh(new THREE.BoxGeometry(p.width*.75,.03,.08), black, 'spoiler-lip', 0, p.height+.02, -half+.08);
    group.add(spoilerLip);
  }

STEP 4: Build & Verify
  npm run build && npm test
  Report FULL output

STEP 5: Report Status
  Format: "Car: [done/pending], Tests: [X/Y passed], Build: [ok/fail], Files: [N modified]"

LOOP CONTINUE: Wait 10 minutes, then repeat from STEP 1.

ALREADY DONE:
✓ Exclude building=roof from extrusions (src/road-network.js:430-440)
✓ Enhanced engine audio (src/audio.js:83-95 - 4 oscillators + detune)
✓ New: Car geometry (add code above before return statement)

RULES:
- NO commits unless explicitly asked
- NO user interaction - just loop
- REPORT each iteration with format above
- If npm test fails, note what failed but continue loop
- If build fails, note warnings but continue

STOP when: user asks to stop, 1 hour elapses, or all AI limits exhausted.
---