// dice3d.js — the LANCER//UPLINK 3D physics dice tray.
//
// Features:
//   • Faction colour schemes (body colour only — numbers are always white so
//     they stay readable; the exception is the white Accuracy die, which uses
//     gold numbers).
//   • Procedural "tech" texture on every die body (circuit traces + panel
//     lines) so dice read as machined hardware, not plastic blobs.
//   • Staged dice hover & shake above the tray before the throw, then drop in.
//   • Camera gently zooms onto the settled dice once a roll resolves.
//   • replay(): rebuilds someone else's roll locally and *forces* each die to
//     land on the broadcast value (physics for show, truth from the network).
//   • rollExtra(): throws additional dice into a settled tray without
//     disturbing it — used for Overkill explosion chains.
//
// Lancer rules note: Accuracy / Difficulty cancel 1:1 and only the single
// highest remaining d6 applies. That math lives in computeResult().
//
// No build step: three + cannon-es are pulled from jsDelivr as ES modules.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

// ---- faction colour schemes -------------------------------------------------
// Numbers are white across the board for readability.
export const SCHEMES = {
  union: { label: "Union",           body: "#9e2b30", num: "#ffffff", emissive: "#2a0000", trace: "#ff8a8a" },
  ssc:   { label: "SSC",             body: "#b8923d", num: "#ffffff", emissive: "#3a2c00", trace: "#ffe9b0" },
  horus: { label: "HORUS",           body: "#1f6e3a", num: "#ffffff", emissive: "#062b13", trace: "#7dffb0", glitch: true },
  ha:    { label: "Harrison Armory", body: "#5c2f9e", num: "#ffffff", emissive: "#1a0633", trace: "#d6b7ff" },
  ips:   { label: "IPS-Northstar",   body: "#34506e", num: "#ffffff", emissive: "#04101e", trace: "#9fd2ff" },
};

// Accuracy: white die, gold numbers. Difficulty: black-purple die, white numbers.
const ACC = { body: "#f4f1e8", num: "#c9920e", emissive: "#3d3526", trace: "#e6c878" };
const DIS = { body: "#221330", num: "#ffffff", emissive: "#0d0418", trace: "#9a6bd0" };

// Die geometry + which face is read after settling.
const DIE = {
  d4:  { geom: () => new THREE.TetrahedronGeometry(0.95),  faces: 4,  read: "bottom" },
  d6:  { geom: () => new THREE.BoxGeometry(1.4, 1.4, 1.4), faces: 6,  read: "top" },
  d8:  { geom: () => new THREE.OctahedronGeometry(1.0),    faces: 8,  read: "top" },
  d10: { geom: () => makeD10(0.95),                        faces: 10, read: "top" },
  d12: { geom: () => new THREE.DodecahedronGeometry(0.95), faces: 12, read: "top" },
  d20: { geom: () => new THREE.IcosahedronGeometry(1.0),   faces: 20, read: "top" },
};

// ---- d10 (pentagonal trapezohedron) geometry --------------------------------
function makeD10(r) {
  const a = (Math.PI * 2) / 10;
  const verts = [
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let i = 0; i < 10; i++) {
    const b = i * a;
    verts.push([Math.cos(b), Math.sin(b), 0.105 * (i % 2 ? 1 : -1)]);
  }
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

// Merge triangles into logical faces keyed by rounded normal.
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

// ---- procedural "tech" body texture ------------------------------------------
// Base colour + panel grid + circuit traces + solder pads. Cached per colour.
const bodyTexCache = new Map();
function techTexture(baseColor, traceColor) {
  const key = `${baseColor}|${traceColor}`;
  if (bodyTexCache.has(key)) return bodyTexCache.get(key);
  const s = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");

  // base + subtle radial shading
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, s, s);
  const rg = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.75);
  rg.addColorStop(0, "rgba(255,255,255,0.10)");
  rg.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, s, s);

  // faint panel grid
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= s; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
  }

  // circuit traces: right-angle polylines with pads (seeded-ish randomness ok)
  ctx.strokeStyle = traceColor;
  ctx.globalAlpha = 0.30;
  ctx.lineWidth = 2;
  for (let t = 0; t < 14; t++) {
    let x = Math.random() * s, y = Math.random() * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < steps; k++) {
      if (Math.random() < 0.5) x = Math.max(0, Math.min(s, x + (Math.random() - 0.5) * 90));
      else y = Math.max(0, Math.min(s, y + (Math.random() - 0.5) * 90));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    // pad at the end of the trace
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  // tiny glow dots
  ctx.fillStyle = traceColor;
  for (let t = 0; t < 22; t++) {
    ctx.globalAlpha = 0.18 + Math.random() * 0.25;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  bodyTexCache.set(key, tex);
  return tex;
}

// ---- number-label texture cache ----------------------------------------------
const numTexCache = new Map();
function numberTexture(value, fg) {
  const key = `${value}|${fg}`;
  if (numTexCache.has(key)) return numTexCache.get(key);
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, s, s);
  // soft dark halo behind the glyph so white numbers pop on light faces too
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = fg;
  ctx.font = `bold ${value >= 10 ? 64 : 78}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), s / 2, s / 2 + 4);
  if (value === 6 || value === 9) {
    ctx.fillRect(s / 2 - 22, s / 2 + 30, 44, 7); // disambiguate 6 / 9
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  numTexCache.set(key, tex);
  return tex;
}

// ---- the tray controller -------------------------------------------------------
export function createDiceTray(container, opts = {}) {
  const getScheme = () => SCHEMES[opts.scheme?.() || "union"] || SCHEMES.union;

  const W = container.clientWidth || 360;
  const H = opts.height || 300;
  const TRAY = 9;
  const HOVER_Y = 3.2; // staging altitude

  const CAM_HOME = new THREE.Vector3(0, 21, 8.5);
  const LOOK_HOME = new THREE.Vector3(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
  camera.position.copy(CAM_HOME);
  camera.lookAt(LOOK_HOME);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(6, 18, 8);
  key.castShadow = true;
  key.shadow.camera.left = -TRAY; key.shadow.camera.right = TRAY;
  key.shadow.camera.top = TRAY; key.shadow.camera.bottom = -TRAY;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.95, metalness: 0.0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(TRAY * 2, TRAY * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(TRAY * 2, 12, 0x343c4a, 0x232832);
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
  const floorBody = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floorBody);
  const wall = (x, z, ry) => {
    const b = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
    b.quaternion.setFromEuler(0, ry, 0);
    b.position.set(x, 0, z);
    world.addBody(b);
  };
  wall(0, -TRAY, 0);
  wall(0, TRAY, Math.PI);
  wall(-TRAY, 0, Math.PI / 2);
  wall(TRAY, 0, -Math.PI / 2);

  // dice: { type, role, mesh, body, faces, values, read, staged, basePos, phase,
  //         forceTo (replay target value), snap ({from,to,t} quaternion tween) }
  let dice = [];
  let rolling = false;

  function dieColors(role) {
    const scheme = getScheme();
    if (role === "acc") return ACC;
    if (role === "dis") return DIS;
    return scheme;
  }

  function buildDie(type, role) {
    const def = DIE[type];
    const geometry = def.geom();
    const faces = extractFaces(geometry);
    const values = faces.map((_, i) => i + 1);
    if (type === "d10") { for (let i = 0; i < values.length; i++) values[i] = (i + 1) % 10; }

    const c = dieColors(role);
    const mat = new THREE.MeshStandardMaterial({
      map: techTexture(c.body, c.trace || "#ffffff"),
      color: "#ffffff",
      roughness: 0.42, metalness: 0.38,
      emissive: new THREE.Color(c.emissive || "#000000"),
      emissiveIntensity: role === "normal" ? 0.35 : 0.18,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;

    faces.forEach((f, i) => {
      const disp = type === "d10" ? (values[i] === 0 ? 10 : values[i]) : values[i];
      const tex = numberTexture(disp, c.num);
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

    const shape = convexShape(geometry);
    const body = new CANNON.Body({ mass: 1, material: diceMat });
    body.addShape(shape);
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit = 0.25;
    world.addBody(body);

    return {
      type, role, mesh, body, faces, values, read: def.read,
      staged: false, basePos: new THREE.Vector3(), phase: Math.random() * Math.PI * 2,
      forceTo: null, snap: null,
    };
  }

  function convexShape(geometry) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = geo.getAttribute("position");
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

  // Stage dice in a hover grid above the tray (only the given dice; default all).
  function stage(subset) {
    const list = subset || dice;
    const n = list.length;
    if (!n) return;
    const cols = Math.ceil(Math.sqrt(n));
    list.forEach((die, i) => {
      const cx = (i % cols) - (cols - 1) / 2;
      const cz = Math.floor(i / cols) - (cols - 1) / 2;
      die.basePos.set(cx * 2.2, HOVER_Y, cz * 2.2 + 1.5);
      die.staged = true;
      die.body.sleep();
      die.body.velocity.set(0, 0, 0);
      die.body.angularVelocity.set(0, 0, 0);
      die.body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      die.body.position.set(die.basePos.x, die.basePos.y, die.basePos.z);
      syncOne(die);
    });
  }

  function syncOne(die) {
    die.mesh.position.copy(die.body.position);
    die.mesh.quaternion.copy(die.body.quaternion);
  }

  // public: add / clear -------------------------------------------------------
  function addDie(type, role = "normal") {
    if (rolling || !DIE[type]) return dice.length;
    dice.push(buildDie(type, role));
    stage(); // restage everything so the hover grid stays tidy
    return dice.length;
  }
  function addAccDie(role) { return addDie("d6", role); } // role: "acc" | "dis"

  function clearTray() {
    if (rolling) return;
    dice.forEach((d) => { scene.remove(d.mesh); world.removeBody(d.body); });
    dice = [];
    resetCamera();
  }

  function listDice() {
    return dice.map((d) => ({ type: d.type, role: d.role }));
  }

  // read the settled face value of one die
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

  // Force a settled die to show `target` by rotating the matching face up.
  function planSnap(die, target) {
    const want = die.type === "d10" ? (target === 10 ? 0 : target) : target;
    let idx = die.values.indexOf(want);
    if (idx < 0) idx = 0;
    const up = new THREE.Vector3(0, die.read === "bottom" ? -1 : 1, 0);
    const worldDir = die.faces[idx].dir.clone().applyQuaternion(die.mesh.quaternion);
    const R = new THREE.Quaternion().setFromUnitVectors(worldDir, up);
    const to = R.multiply(die.mesh.quaternion.clone()).normalize();
    die.snap = { from: die.mesh.quaternion.clone(), to, t: 0 };
  }

  // throw a set of dice (defaults to all) and resolve when they settle
  function throwDice(list, power = 1) {
    return new Promise((resolve) => {
      if (rolling || !list.length) { resolve(null); return; }
      rolling = true;
      stage(list);
      list.forEach((die) => {
        die.staged = false;
        const s = 6 + 6 * power;
        die.body.wakeUp();
        die.body.velocity.set((Math.random() - 0.5) * s, 2 + Math.random() * 2, -(2 + Math.random() * s));
        die.body.angularVelocity.set(
          (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18
        );
      });
      let settleTimer = 0;
      const start = performance.now();
      const check = () => {
        const allSlow = list.every((d) =>
          d.body.sleepState === CANNON.Body.SLEEPING ||
          (d.body.velocity.lengthSquared() < 0.05 && d.body.angularVelocity.lengthSquared() < 0.05)
        );
        const elapsed = performance.now() - start;
        if (allSlow) settleTimer += 1; else settleTimer = 0;
        if (settleTimer > 12 || elapsed > 7000) {
          // forced-value snap (replay mode)
          const snappers = list.filter((d) => d.forceTo != null);
          snappers.forEach((d) => planSnap(d, d.forceTo));
          const finish = () => {
            rolling = false;
            const results = list.map((d) => ({
              type: d.type, role: d.role,
              value: d.forceTo != null ? d.forceTo : readDie(d),
            }));
            list.forEach((d) => { d.forceTo = null; });
            resolve(results);
          };
          if (snappers.length) setTimeout(finish, 320); // let the snap tween play
          else finish();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  function roll(power = 1) { return throwDice(dice.slice(), power); }

  // Overkill chain: add `types` (e.g. ["d6","d6"]) and roll ONLY them.
  async function rollExtra(types) {
    if (rolling) return null;
    const fresh = types.filter((t) => DIE[t]).map((t) => {
      const d = buildDie(t, "normal");
      dice.push(d);
      return d;
    });
    if (!fresh.length) return null;
    // hover them briefly so the player sees the explosion incoming
    stage(fresh);
    await new Promise((r) => setTimeout(r, 350));
    return throwDice(fresh, 1);
  }

  // Replay someone else's roll: spawn their dice, roll for show, force values.
  async function replay(specs, power = 1) {
    if (rolling) return null;
    clearTray();
    specs.forEach((s) => {
      const d = buildDie(DIE[s.type] ? s.type : "d6", s.role || "normal");
      d.forceTo = s.value;
      dice.push(d);
    });
    stage();
    await new Promise((r) => setTimeout(r, 250));
    return throwDice(dice.slice(), power);
  }

  // ---- camera tween -----------------------------------------------------------
  let camTween = null; // { fromP, toP, fromL, toL, t, dur }
  let lookAtPt = LOOK_HOME.clone();

  function tweenCam(toP, toL, dur = 0.6) {
    camTween = {
      fromP: camera.position.clone(), toP: toP.clone(),
      fromL: lookAtPt.clone(), toL: toL.clone(),
      t: 0, dur,
    };
  }

  function zoomToDice() {
    if (!dice.length) return;
    const center = new THREE.Vector3();
    dice.forEach((d) => center.add(d.mesh.position));
    center.multiplyScalar(1 / dice.length);
    let radius = 2;
    dice.forEach((d) => { radius = Math.max(radius, center.distanceTo(d.mesh.position) + 1.6); });
    // pull the camera in along its home direction, scaled to fit the cluster
    const dist = Math.max(7, radius * 2.6);
    const dir = CAM_HOME.clone().sub(new THREE.Vector3(center.x, 0, center.z)).normalize();
    const toP = center.clone().add(dir.multiplyScalar(dist));
    toP.y = Math.max(6.5, dist * 0.85);
    tweenCam(toP, center, 0.65);
  }

  function resetCamera() { tweenCam(CAM_HOME, LOOK_HOME, 0.5); }

  // ---- render + physics loop ----------------------------------------------------
  let glitchT = 0;
  let raf = 0;
  const clock = new THREE.Clock();
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  function loop() {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const now = performance.now() / 1000;
    world.step(1 / 60, dt, 4);

    dice.forEach((die) => {
      if (die.staged) {
        // hover bob + nervous jitter above the tray
        const bob = Math.sin(now * 3.1 + die.phase) * 0.16;
        const jx = Math.sin(now * 13.7 + die.phase * 2) * 0.03;
        const jz = Math.cos(now * 11.3 + die.phase * 3) * 0.03;
        die.body.position.set(die.basePos.x + jx, die.basePos.y + bob, die.basePos.z + jz);
        die.mesh.rotation.x += dt * 0.6;
        die.mesh.rotation.y += dt * 0.8;
        die.mesh.position.copy(die.body.position);
        die.body.quaternion.copy(die.mesh.quaternion);
      } else if (die.snap) {
        die.snap.t = Math.min(1, die.snap.t + dt / 0.25);
        die.mesh.quaternion.slerpQuaternions(die.snap.from, die.snap.to, easeInOut(die.snap.t));
        die.body.quaternion.copy(die.mesh.quaternion);
        if (die.snap.t >= 1) die.snap = null;
      } else {
        syncOne(die);
      }
    });

    // HORUS glitch shimmer
    const scheme = getScheme();
    if (scheme.glitch) {
      glitchT += dt;
      const f = 0.3 + 0.7 * Math.abs(Math.sin(glitchT * 9.3));
      dice.forEach((d) => { if (d.role === "normal") d.mesh.material.emissiveIntensity = f; });
    }

    if (camTween) {
      camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
      const k = easeInOut(camTween.t);
      camera.position.lerpVectors(camTween.fromP, camTween.toP, k);
      lookAtPt.lerpVectors(camTween.fromL, camTween.toL, k);
      camera.lookAt(lookAtPt);
      if (camTween.t >= 1) camTween = null;
    }

    renderer.render(scene, camera);
  }
  loop();

  function resize() {
    const w = container.clientWidth || W;
    const h = container.clientHeight || H;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return {
    addDie, addAccDie, clearTray, listDice, roll, rollExtra, replay,
    zoomToDice, resetCamera, resize, dispose,
    count: () => dice.length,
    isRolling: () => rolling,
  };
}

// ---- Lancer result maths from read dice ----------------------------------------
// results: [{ type, role:"normal"|"acc"|"dis", value }]
export function computeResult(results, { keepHighest = false, flat = 0 } = {}) {
  const normals = results.filter((r) => r.role === "normal");
  const acc = results.filter((r) => r.role === "acc").map((r) => r.value);
  const dis = results.filter((r) => r.role === "dis").map((r) => r.value);

  // Accuracy / Difficulty cancel 1:1; apply the single highest of the remainder.
  const net = acc.length - dis.length;
  let accApplied = 0;
  if (net > 0) accApplied = Math.max(...acc);
  else if (net < 0) accApplied = -Math.max(...dis);

  const normalVals = normals.map((r) => r.value);
  const base = keepHighest && normalVals.length
    ? Math.max(...normalVals)
    : normalVals.reduce((a, b) => a + b, 0);

  return {
    normals, acc, dis, accApplied, flat,
    base, keepHighest,
    total: base + accApplied + flat,
    d20: (normals.find((r) => r.type === "d20") || {}).value,
  };
}
