// dice3d.js — a self-contained 3D physics dice tray for the Lancer Uplink
// popover. Inspired by Owlbear Rodeo's own dice UX: click a die in the picker
// to drop a 3D copy into the tray, then roll. Physics (cannon-es) decides the
// result; the up-facing number on each settled die is read back and fed to the
// Lancer maths layer.
//
// Lancer rules (not D&D): Accuracy / Difficulty each add a d6; they cancel 1:1
// and you apply ONLY the single highest remaining d6 — +highest for Accuracy,
// -highest for Difficulty — to the d20. Plain dice (e.g. damage) just sum.
//
// No build step: three + cannon-es are pulled from jsDelivr as ES modules.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

// ---- faction colour schemes -------------------------------------------------
export const SCHEMES = {
  ssc:   { label: "SSC — Gold / White",        body: "#d8b24a", num: "#ffffff", emissive: "#3a2c00" },
  union: { label: "Union — Red / Black",       body: "#b22b2b", num: "#0a0a0a", emissive: "#2a0000" },
  horus: { label: "HORUS — Green / Pink",      body: "#1f7a3d", num: "#ff5fd0", emissive: "#062b13", glitch: true },
  ha:    { label: "Harrison — Purple / White", body: "#6a37b8", num: "#ffffff", emissive: "#1a0633" },
};

// Accuracy / Difficulty d6 keep their own colours so they read at a glance.
const ACC_BODY = "#3fae5a", ACC_NUM = "#04140a";
const DIS_BODY = "#cf3b3b", DIS_NUM = "#1a0303";

// Die "radius" in world units and which face is read after settling.
const DIE = {
  d4:  { geom: () => new THREE.TetrahedronGeometry(0.95),   faces: 4,  read: "bottom" },
  d6:  { geom: () => new THREE.BoxGeometry(1.4, 1.4, 1.4),  faces: 6,  read: "top" },
  d8:  { geom: () => new THREE.OctahedronGeometry(1.0),     faces: 8,  read: "top" },
  d10: { geom: () => makeD10(0.95),                          faces: 10, read: "top" },
  d12: { geom: () => new THREE.DodecahedronGeometry(0.95),  faces: 12, read: "top" },
  d20: { geom: () => new THREE.IcosahedronGeometry(1.0),    faces: 20, read: "top" },
};

// ---- d10 (pentagonal trapezohedron) geometry --------------------------------
function makeD10(r) {
  const a = (Math.PI * 2) / 10;
  const verts = [
    [0, 0, 1],   // 0 top apex
    [0, 0, -1],  // 1 bottom apex
  ];
  for (let i = 0; i < 10; i++) {
    const b = i * a;
    verts.push([Math.cos(b), Math.sin(b), 0.105 * (i % 2 ? 1 : -1)]);
  }
  // 20 triangles → 10 coplanar kite faces (merged later by normal).
  const faces = [
    [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 6], [0, 6, 7],
    [0, 7, 8], [0, 8, 9], [0, 9, 10], [0, 10, 11], [0, 11, 2],
    [1, 3, 2], [1, 4, 3], [1, 5, 4], [1, 6, 5], [1, 7, 6],
    [1, 8, 7], [1, 9, 8], [1, 10, 9], [1, 11, 10], [1, 2, 11],
  ];
  const pos = [];
  for (const f of faces) {
    for (const idx of f) {
      pos.push(verts[idx][0] * r, verts[idx][1] * r, verts[idx][2] * r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Merge a geometry's triangles into logical faces keyed by rounded normal.
// Returns [{ dir:Vector3 (unit outward), centroid:Vector3 }, ...].
function extractFaces(geometry) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = geo.getAttribute("position");
  const groups = new Map();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const ab = new THREE.Vector3(), cb = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    vA.fromBufferAttribute(p, i);
    vB.fromBufferAttribute(p, i + 1);
    vC.fromBufferAttribute(p, i + 2);
    cb.subVectors(vC, vB); ab.subVectors(vA, vB);
    n.crossVectors(cb, ab).normalize();
    const key = `${n.x.toFixed(1)},${n.y.toFixed(1)},${n.z.toFixed(1)}`;
    let grp = groups.get(key);
    if (!grp) { grp = { normal: n.clone(), pts: [] }; groups.set(key, grp); }
    grp.pts.push(vA.clone(), vB.clone(), vC.clone());
  }
  const out = [];
  for (const grp of groups.values()) {
    const c = new THREE.Vector3();
    grp.pts.forEach((v) => c.add(v));
    c.multiplyScalar(1 / grp.pts.length);
    out.push({ dir: grp.normal.clone().normalize(), centroid: c });
  }
  return out;
}

// ---- number-label texture cache --------------------------------------------
const texCache = new Map();
function numberTexture(value, fg) {
  const key = `${value}|${fg}`;
  if (texCache.has(key)) return texCache.get(key);
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = fg;
  ctx.font = `bold ${value >= 10 ? 64 : 78}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = String(value);
  ctx.fillText(label, s / 2, s / 2 + 4);
  // underline 6 / 9 so they aren't ambiguous
  if (value === 6 || value === 9) {
    ctx.fillRect(s / 2 - 22, s / 2 + 30, 44, 7);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// ---- the tray controller ----------------------------------------------------
export function createDiceTray(container, opts = {}) {
  const getScheme = () => SCHEMES[opts.scheme?.() || "ssc"] || SCHEMES.ssc;

  const W = container.clientWidth || 360;
  const H = opts.height || 300;
  const TRAY = 9; // half-extent of the floor

  // renderer / scene / camera
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
  camera.position.set(0, 21, 8.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(6, 18, 8);
  key.castShadow = true;
  key.shadow.camera.left = -TRAY; key.shadow.camera.right = TRAY;
  key.shadow.camera.top = TRAY; key.shadow.camera.bottom = -TRAY;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  // visible floor
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.95, metalness: 0.0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(TRAY * 2, TRAY * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // subtle grid
  const grid = new THREE.GridHelper(TRAY * 2, 12, 0x2e3540, 0x232832);
  grid.position.y = 0.01;
  scene.add(grid);

  // physics
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.NaiveBroadphase();
  const groundMat = new CANNON.Material("ground");
  const diceMat = new CANNON.Material("dice");
  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMat, diceMat, { friction: 0.35, restitution: 0.28 })
  );
  // floor + 4 walls
  const floorBody = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floorBody);
  const wall = (x, z, ry) => {
    const b = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
    b.quaternion.setFromEuler(0, ry, 0);
    b.position.set(x, 0, z);
    world.addBody(b);
  };
  wall(0, -TRAY, 0);          // back
  wall(0, TRAY, Math.PI);     // front
  wall(-TRAY, 0, Math.PI / 2);// left
  wall(TRAY, 0, -Math.PI / 2);// right

  // active dice: { type, role, mesh, body, faces, values }
  let dice = [];
  let rolling = false;
  let settleTimer = 0;

  function buildDie(type, role) {
    const def = DIE[type];
    const geometry = def.geom();
    const faces = extractFaces(geometry);
    // assign values 1..N to faces (any bijection — physics is unbiased)
    const values = faces.map((_, i) => i + 1);
    if (type === "d10") { for (let i = 0; i < values.length; i++) values[i] = (i + 1) % 10; } // 0..9

    const scheme = getScheme();
    const bodyColor = role === "acc" ? ACC_BODY : role === "dis" ? DIS_BODY : scheme.body;
    const numColor  = role === "acc" ? ACC_NUM  : role === "dis" ? DIS_NUM  : scheme.num;

    const mat = new THREE.MeshStandardMaterial({
      color: bodyColor, roughness: 0.45, metalness: 0.35,
      emissive: new THREE.Color(scheme.emissive || "#000000"),
      emissiveIntensity: role === "normal" ? 0.4 : 0.15,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;

    // number labels as outward-facing planes
    faces.forEach((f, i) => {
      const disp = type === "d10" ? (values[i] === 0 ? 10 : values[i]) : values[i];
      const tex = numberTexture(disp, numColor);
      const size = type === "d6" ? 0.8 : type === "d20" ? 0.62 : 0.7;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      );
      const pos = f.centroid.clone().add(f.dir.clone().multiplyScalar(0.02));
      plane.position.copy(pos);
      plane.lookAt(pos.clone().add(f.dir));
      mesh.add(plane);
    });
    scene.add(mesh);

    // physics body — convex hull from the geometry vertices
    const shape = convexShape(geometry);
    const body = new CANNON.Body({ mass: 1, material: diceMat });
    body.addShape(shape);
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit = 0.25;
    world.addBody(body);

    return { type, role, mesh, body, faces, values, read: def.read };
  }

  function convexShape(geometry) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = geo.getAttribute("position");
    // dedupe vertices
    const map = new Map();
    const verts = [];
    const faceIdx = [];
    const keyOf = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    for (let i = 0; i < p.count; i += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
        const kk = keyOf(x, y, z);
        let vi = map.get(kk);
        if (vi === undefined) { vi = verts.length; verts.push(new CANNON.Vec3(x, y, z)); map.set(kk, vi); }
        tri.push(vi);
      }
      faceIdx.push(tri);
    }
    return new CANNON.ConvexPolyhedron({ vertices: verts, faces: faceIdx });
  }

  // place dice in a loose grid above the tray, ready to be thrown
  function stage() {
    const n = dice.length;
    const cols = Math.ceil(Math.sqrt(n));
    dice.forEach((die, i) => {
      const cx = (i % cols) - (cols - 1) / 2;
      const cz = Math.floor(i / cols) - (cols - 1) / 2;
      die.body.position.set(cx * 2.2, 3 + (i % 3), cz * 2.2);
      die.body.velocity.set(0, 0, 0);
      die.body.angularVelocity.set(0, 0, 0);
      die.body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      die.body.wakeUp();
      syncOne(die);
    });
  }

  function syncOne(die) {
    die.mesh.position.copy(die.body.position);
    die.mesh.quaternion.copy(die.body.quaternion);
  }

  // public: add / clear
  function addDie(type) {
    if (rolling || !DIE[type]) return;
    dice.push(buildDie(type, "normal"));
    stage();
    return dice.length;
  }
  function addAccDie(role) { // role: "acc" | "dis"
    if (rolling) return;
    dice.push(buildDie("d6", role));
    stage();
    return dice.length;
  }
  function clearTray() {
    if (rolling) return;
    dice.forEach((d) => { scene.remove(d.mesh); world.removeBody(d.body); });
    dice = [];
  }

  // read the up- (or down-) facing value of a settled die
  function readDie(die) {
    let best = -Infinity, val = die.values[0];
    const up = new THREE.Vector3(0, die.read === "bottom" ? -1 : 1, 0);
    die.faces.forEach((f, i) => {
      const wn = f.dir.clone().applyQuaternion(die.mesh.quaternion);
      const dot = wn.dot(up);
      if (dot > best) { best = dot; val = die.values[i]; }
    });
    return die.type === "d10" ? (val === 0 ? 10 : val) : val;
  }

  // throw with a randomized nudge; resolve when everything settles
  function roll(power = 1) {
    return new Promise((resolve) => {
      if (rolling || !dice.length) { resolve(null); return; }
      rolling = true;
      stage();
      dice.forEach((die) => {
        const s = 6 + 6 * power;
        die.body.velocity.set((Math.random() - 0.5) * s, 2 + Math.random() * 2, -(2 + Math.random() * s));
        die.body.angularVelocity.set(
          (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18
        );
        die.body.wakeUp();
      });
      settleTimer = 0;
      const start = performance.now();
      const check = () => {
        const allSlow = dice.every((d) =>
          d.body.sleepState === CANNON.Body.SLEEPING ||
          (d.body.velocity.lengthSquared() < 0.05 && d.body.angularVelocity.lengthSquared() < 0.05)
        );
        const elapsed = performance.now() - start;
        if (allSlow) settleTimer += 1; else settleTimer = 0;
        if ((settleTimer > 12 || elapsed > 7000) ) {
          rolling = false;
          const results = dice.map((d) => ({ type: d.type, role: d.role, value: readDie(d) }));
          resolve(results);
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  // render + physics loop
  let glitchT = 0;
  let raf = 0;
  const clock = new THREE.Clock();
  function loop() {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    world.step(1 / 60, dt, 4);
    dice.forEach(syncOne);
    // HORUS glitch: jitter emissive on normal dice
    const scheme = getScheme();
    if (scheme.glitch) {
      glitchT += dt;
      const f = 0.3 + 0.7 * Math.abs(Math.sin(glitchT * 9.3));
      dice.forEach((d) => { if (d.role === "normal") d.mesh.material.emissiveIntensity = f; });
    }
    renderer.render(scene, camera);
  }
  loop();

  function resize() {
    const w = container.clientWidth || W;
    renderer.setSize(w, H);
    camera.aspect = w / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return { addDie, addAccDie, clearTray, roll, resize, dispose, count: () => dice.length };
}

// ---- Lancer result maths from read dice -------------------------------------
// results: [{ type, role:"normal"|"acc"|"dis", value }]
export function computeResult(results, { keepHighest = false } = {}) {
  const normals = results.filter((r) => r.role === "normal");
  const acc = results.filter((r) => r.role === "acc").map((r) => r.value);
  const dis = results.filter((r) => r.role === "dis").map((r) => r.value);

  // Accuracy / Difficulty cancel 1:1; apply single highest of the remainder.
  const net = acc.length - dis.length;
  let accApplied = 0, accUsed = [];
  if (net > 0) { const h = Math.max(...acc); accApplied = h; accUsed = acc; }
  else if (net < 0) { const h = Math.max(...dis); accApplied = -h; accUsed = dis; }

  const normalVals = normals.map((r) => r.value);
  const base = keepHighest && normalVals.length
    ? Math.max(...normalVals)
    : normalVals.reduce((a, b) => a + b, 0);

  return {
    normals, acc, dis, accApplied,
    base, keepHighest,
    total: base + accApplied,
    d20: (normals.find((r) => r.type === "d20") || {}).value,
  };
}
