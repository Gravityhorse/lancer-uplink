// hex.js — cube-coordinate hex math, self-calibrated against the live Owlbear grid.
// Rather than trusting assumptions about how OBR lays out HEX_VERTICAL vs
// HEX_HORIZONTAL, we probe OBR.grid.snapPosition() at startup to measure the
// real hex spacing, orientation, and lattice origin. Templates therefore land
// on the actual grid no matter how the room is configured.

import { OBR } from "./sdk.js";

const SQRT3 = Math.sqrt(3);

export const grid = {
  ready: false,
  pointy: true,        // pointy-top (neighbors at 0°,60°,...) vs flat-top (30°,90°,...)
  R: 75 / SQRT3,       // hex circumradius in px
  origin: { x: 0, y: 0 }, // a known hex center anchoring the lattice
  dpi: 150,
  isHexGrid: true,
};

export async function calibrate() {
  grid.dpi = await OBR.grid.getDpi();
  const type = await OBR.grid.getType();
  grid.isHexGrid = type === "HEX_VERTICAL" || type === "HEX_HORIZONTAL";
  grid.pointy = type !== "HEX_HORIZONTAL";
  grid.R = grid.dpi / SQRT3;

  if (!grid.isHexGrid) { grid.ready = true; return grid; }

  try {
    // Snap an arbitrary point to find one true hex center.
    const c0 = await OBR.grid.snapPosition({ x: 5000.37, y: 4097.91 });
    grid.origin = c0;

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
      // Orientation: pointy-top grids have a neighbor near angle 0 (mod 60°).
      const degMod = (Math.abs(near[0].ang) * 180) / Math.PI % 60;
      const offAxis = Math.min(degMod, 60 - degMod);
      grid.pointy = offAxis < 15;
    }
  } catch (e) {
    console.warn("[LANCER//UPLINK] grid calibration fell back to defaults", e);
  }
  grid.ready = true;
  return grid;
}

// ---- axial <-> pixel -------------------------------------------------------

export function hexToPixel(h) {
  const R = grid.R, o = grid.origin;
  if (grid.pointy) {
    return { x: o.x + R * SQRT3 * (h.q + h.r / 2), y: o.y + R * 1.5 * h.r };
  }
  return { x: o.x + R * 1.5 * h.q, y: o.y + R * SQRT3 * (h.r + h.q / 2) };
}

export function pixelToHex(p) {
  const R = grid.R, x = p.x - grid.origin.x, y = p.y - grid.origin.y;
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
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Pixel corners of a hex, for path building.
export function hexCorners(h) {
  const c = hexToPixel(h);
  const start = grid.pointy ? -90 : 0; // pointy-top first vertex up; flat-top right
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((start + i * 60) * Math.PI) / 180;
    pts.push({ x: c.x + grid.R * Math.cos(a), y: c.y + grid.R * Math.sin(a) });
  }
  return pts;
}

// ---- area generators (all return arrays of {q,r}) --------------------------

// All hexes within range n of center (BURST / BLAST / RANGE / SENSORS).
export function hexesInRange(center, n, includeCenter = true) {
  const out = [];
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      if (!includeCenter && dq === 0 && dr === 0) continue;
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

// Snap an arbitrary angle to the nearest of 12 hex-friendly directions (30° steps).
export function snapAngle(rad) {
  const step = Math.PI / 6;
  return Math.round(rad / step) * step;
}

// LINE n: n hexes marching from origin (exclusive) along a snapped direction.
export function hexLine(origin, rad, n) {
  const o = hexToPixel(origin);
  const out = [];
  const seen = new Set([hexKey(origin)]);
  const step = grid.R * SQRT3 * 0.5; // sub-hex sampling for clean lines on 30° diagonals
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

// CONE n: ±30° wedge from origin (exclusive), length n. Direction snaps to 30° steps,
// so cones can point at hex edges or vertices. Yields the classic 1/3/3/5/5... spread.
export function hexCone(origin, rad, n) {
  const o = hexToPixel(origin);
  const candidates = hexesInRange(origin, n, false);
  const halfAngle = (Math.PI / 6) + 0.02;
  const out = [];
  for (const h of candidates) {
    const p = hexToPixel(h);
    const ang = Math.atan2(p.y - o.y, p.x - o.x);
    let diff = Math.abs(ang - rad);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff <= halfAngle && hexDistance(origin, h) <= n) out.push(h);
  }
  return out;
}
