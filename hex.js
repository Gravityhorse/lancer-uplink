// hex.js — grid math for LANCER//UPLINK, self-calibrated against the live
// Owlbear grid. Supports BOTH hex grids (cube-coordinate math) and square
// grids (Chebyshev / "king move" distance, the standard way to play Lancer on
// squares). The mode is auto-detected from the room's grid type and can be
// overridden from the MAP tab.
//
// Calibration probes OBR.grid.snapPosition() to measure the real spacing,
// orientation and lattice origin, so templates land on the actual grid no
// matter how the room is configured. Calibration requires an open scene; the
// caller is responsible for invoking calibrate() once the scene is ready.

import { OBR } from "./sdk.js";

const SQRT3 = Math.sqrt(3);

export const grid = {
  ready: false,
  pointy: true,           // hex: pointy-top vs flat-top
  autoPointy: true,       // what calibration detected
  R: 75 / SQRT3,          // hex circumradius in px
  S: 150,                 // square cell size in px
  origin: { x: 0, y: 0 }, // a known cell center anchoring the lattice
  dpi: 150,
  isHexGrid: true,        // what the room reports
  square: false,          // the mode actually in use
  modeOverride: null,     // null/"auto" | "hexp" | "hexf" | "square" (MAP tab)
  cellOverride: null,     // manual cell size in px (MAP tab slider), or null
};

function applyMode() {
  const o = grid.modeOverride;
  if (o === "square") { grid.square = true; }
  else if (o === "hexp") { grid.square = false; grid.pointy = true; }
  else if (o === "hexf") { grid.square = false; grid.pointy = false; }
  else { grid.square = !grid.isHexGrid; grid.pointy = grid.autoPointy; }
}

// mode: null/"auto" | "hexp" | "hexf" | "square"
export function setGridOverride(mode) {
  grid.modeOverride = mode === "auto" ? null : mode;
  applyMode();
}

// Manual cell size (px). null = use what calibration measured.
export function setCellSize(px) {
  grid.cellOverride = px && px > 4 ? px : null;
  applyCellSize();
}

function applyCellSize() {
  const px = grid.cellOverride;
  if (px) {
    grid.dpi = px;
    grid.R = px / SQRT3;
    grid.S = px;
  }
}

export async function calibrate() {
  grid.dpi = await OBR.grid.getDpi();
  const type = await OBR.grid.getType();
  grid.isHexGrid = type === "HEX_VERTICAL" || type === "HEX_HORIZONTAL";
  grid.autoPointy = type !== "HEX_HORIZONTAL";
  grid.R = grid.dpi / SQRT3;
  grid.S = grid.dpi;
  applyMode();

  try {
    // Snap an arbitrary point to find one true cell center.
    const c0 = await OBR.grid.snapPosition({ x: 5000.37, y: 4097.91 });
    grid.origin = c0;

    if (grid.isHexGrid) {
      // Probe in 12 directions to find adjacent hex centers.
      const neighbors = [];
      const probeDist = grid.dpi * 1.02;
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        const p = await OBR.grid.snapPosition({
          x: c0.x + probeDist * Math.cos(rad),
          y: c0.y + probeDist * Math.sin(rad),
        });
        const dx = p.x - c0.x, dy = p.y - c0.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) neighbors.push({ d, ang: Math.atan2(dy, dx) });
      }
      if (neighbors.length) {
        neighbors.sort((a, b) => a.d - b.d);
        const near = neighbors.filter((n) => n.d < neighbors[0].d * 1.15);
        const spacing = near.reduce((s, n) => s + n.d, 0) / near.length;
        grid.R = spacing / SQRT3;
        const degMod = (Math.abs(near[0].ang) * 180) / Math.PI % 60;
        const offAxis = Math.min(degMod, 60 - degMod);
        grid.autoPointy = offAxis < 15;
        applyMode();
      }
    } else {
      // Square: measure cell size from a horizontal probe.
      const p = await OBR.grid.snapPosition({ x: c0.x + grid.dpi * 1.02, y: c0.y });
      const d = Math.abs(p.x - c0.x);
      if (d > 1) grid.S = d;
    }
  } catch (e) {
    console.warn("[LANCER//UPLINK] grid calibration fell back to defaults", e);
  }
  applyCellSize(); // a manual size override always wins over the probe
  grid.ready = true;
  return grid;
}

// ---- cell <-> pixel ---------------------------------------------------------
// Cells are {q, r}. On hex grids these are axial hex coordinates; on square
// grids q = column, r = row.

export function hexToPixel(h) {
  const o = grid.origin;
  if (grid.square) {
    return { x: o.x + grid.S * h.q, y: o.y + grid.S * h.r };
  }
  const R = grid.R;
  if (grid.pointy) {
    return { x: o.x + R * SQRT3 * (h.q + h.r / 2), y: o.y + R * 1.5 * h.r };
  }
  return { x: o.x + R * 1.5 * h.q, y: o.y + R * SQRT3 * (h.r + h.q / 2) };
}

export function pixelToHex(p) {
  const x = p.x - grid.origin.x, y = p.y - grid.origin.y;
  if (grid.square) {
    return { q: Math.round(x / grid.S), r: Math.round(y / grid.S) };
  }
  const R = grid.R;
  let q, r;
  if (grid.pointy) {
    q = ((SQRT3 / 3) * x - (1 / 3) * y) / R;
    r = ((2 / 3) * y) / R;
  } else {
    q = ((2 / 3) * x) / R;
    r = ((-1 / 3) * x + (SQRT3 / 3) * y) / R;
  }
  return cubeRound(q, r);
}

function cubeRound(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export const hexKey = (h) => `${h.q},${h.r}`;
export const keyToHex = (k) => {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
};

export function hexDistance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  if (grid.square) {
    return Math.max(Math.abs(dq), Math.abs(dr)); // Chebyshev: diagonals cost 1
  }
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Pixel corners of a cell, for path building.
export function hexCorners(h) {
  const c = hexToPixel(h);
  if (grid.square) {
    const half = grid.S / 2;
    return [
      { x: c.x - half, y: c.y - half },
      { x: c.x + half, y: c.y - half },
      { x: c.x + half, y: c.y + half },
      { x: c.x - half, y: c.y + half },
    ];
  }
  const start = grid.pointy ? -90 : 0;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((start + i * 60) * Math.PI) / 180;
    pts.push({ x: c.x + grid.R * Math.cos(a), y: c.y + grid.R * Math.sin(a) });
  }
  return pts;
}

// ---- area generators (all return arrays of {q,r}) ----------------------------

// All cells within range n of center (BURST / BLAST / RANGE / SENSORS).
export function hexesInRange(center, n, includeCenter = true) {
  const out = [];
  if (grid.square) {
    for (let dq = -n; dq <= n; dq++) {
      for (let dr = -n; dr <= n; dr++) {
        if (!includeCenter && dq === 0 && dr === 0) continue;
        out.push({ q: center.q + dq, r: center.r + dr });
      }
    }
    return out;
  }
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      if (!includeCenter && dq === 0 && dr === 0) continue;
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

// Snap an angle to the nearest grid-friendly direction
// (30° steps on hex, 45° steps on squares).
export function snapAngle(rad) {
  const step = grid.square ? Math.PI / 4 : Math.PI / 6;
  return Math.round(rad / step) * step;
}

// LINE n: n cells marching from origin (exclusive) along a snapped direction.
export function hexLine(origin, rad, n) {
  const o = hexToPixel(origin);
  const out = [];
  const seen = new Set([hexKey(origin)]);
  const step = (grid.square ? grid.S : grid.R * SQRT3) * 0.5;
  let i = 1;
  while (out.length < n && i < n * 4 + 8) {
    const p = { x: o.x + Math.cos(rad) * step * i, y: o.y + Math.sin(rad) * step * i };
    const h = pixelToHex(p);
    const k = hexKey(h);
    if (!seen.has(k)) { seen.add(k); out.push(h); }
    i++;
  }
  return out;
}

// CONE n — Lancer RAW: at every distance d from the origin the cone is
// exactly d cells wide (1 / 2 / 3 / …), forming the triangle from the core
// rulebook diagrams. We bucket candidate cells by distance and keep the d
// cells closest to the aim direction at each step.
export function hexCone(origin, rad, n) {
  const o = hexToPixel(origin);
  const buckets = new Map(); // distance -> [{ h, a (|angle diff|), s (signed) }]
  const limit = (grid.square ? Math.PI / 2 : Math.PI / 2) + 0.05; // never grab behind
  for (const h of hexesInRange(origin, n, false)) {
    const d = hexDistance(origin, h);
    if (d < 1 || d > n) continue;
    const p = hexToPixel(h);
    let diff = Math.atan2(p.y - o.y, p.x - o.x) - rad;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > limit) continue;
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d).push({ h, a: Math.abs(diff), s: diff });
  }
  const out = [];
  for (let d = 1; d <= n; d++) {
    const row = (buckets.get(d) || []).sort((x, y) => x.a - y.a || x.s - y.s);
    out.push(...row.slice(0, d).map((x) => x.h));
  }
  return out;
}
