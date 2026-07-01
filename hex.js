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
  pointy: false,          // hex: pointy-top vs flat-top — DEFAULT is flat-top
  autoPointy: false,      // what calibration detected (defaults flat-top)
  R: 75 / SQRT3,          // hex circumradius in px
  S: 150,                 // square cell size in px
  origin: { x: 0, y: 0 }, // a known cell center anchoring the lattice
  dpi: 150,
  isHexGrid: true,        // what the room reports
  square: false,          // the mode actually in use
  modeOverride: null,     // null/"auto" | "hexp" | "hexf" | "square" (MAP tab)
  cellOverride: null,     // manual cell size in px (MAP tab slider), or null
  nudge: { x: 0, y: 0 },  // manual lattice offset in px (MAP tab X/Y steppers)
};

// Manual X/Y lattice offset, layered on top of whatever the probe found —
// survives recalibration so a hand-tuned alignment isn't lost.
export function setNudge(x, y) {
  grid.nudge.x = Number(x) || 0;
  grid.nudge.y = Number(y) || 0;
}

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

// anchor: optional { x, y } (e.g. the bonded token's position) — the lattice
// origin snaps to the cell nearest it, so MOVE / SENSORS fields sit perfectly
// centred on your token.
export async function calibrate(anchor) {
  // The grid API lives at OBR.scene.grid (it belongs to the scene). Older SDK
  // builds exposed OBR.grid — accept either so this never silently breaks.
  const G = (OBR.scene && OBR.scene.grid) || OBR.grid;
  if (!G) throw new Error("grid API unavailable");

  try {
    grid.dpi = await G.getDpi();
    const type = await G.getType();
    grid.isHexGrid = type === "HEX_VERTICAL" || type === "HEX_HORIZONTAL";
    // Owlbear: HEX_VERTICAL = pointy-top, HEX_HORIZONTAL = flat-top. This is the
    // authoritative orientation source — far more reliable than guessing from
    // probe angles (which is what used to make AUTO land on the wrong shape).
    grid.autoPointy = type === "HEX_VERTICAL";
  } catch (e) {
    console.warn("[LANCER//UPLINK] grid type/dpi read failed — using flat-top defaults", e);
  }
  grid.R = grid.dpi / SQRT3;
  grid.S = grid.dpi;
  applyMode();

  try {
    // Snap a point to find one true cell CENTER — this anchors the whole
    // lattice, which is what makes templates land ON the scene's grid. Seed it
    // with the bonded token when we have one so the origin centres on it.
    //
    // CRITICAL: force full sensitivity + centre-only snapping (1, useCorners:
    // false, useCenter: true). The defaults use the *player's* snap preference,
    // so if they play with snapping low/off — or the token was dropped off-centre
    // in its tile — snapPosition would hand back the raw off-centre point and the
    // whole hex lattice would inherit that offset. Centre-snapping pins us to the
    // middle of the tile the token actually occupies, no matter where in the tile
    // it sits.
    const seed = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
      ? { x: anchor.x, y: anchor.y }
      : { x: 5000.37, y: 4097.91 };
    const c0 = await G.snapPosition(seed, 1, false, true);
    grid.origin = c0;

    if (grid.isHexGrid) {
      // Probe in 12 directions to MEASURE cell spacing (orientation already
      // comes from getType — the probe no longer flips pointy/flat).
      const neighbors = [];
      const probeDist = grid.dpi * 1.02;
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        const p = await G.snapPosition({
          x: c0.x + probeDist * Math.cos(rad),
          y: c0.y + probeDist * Math.sin(rad),
        }, 1, false, true); // centre-to-centre spacing
        const dx = p.x - c0.x, dy = p.y - c0.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) neighbors.push({ d, ang: Math.atan2(dy, dx) });
      }
      if (neighbors.length) {
        neighbors.sort((a, b) => a.d - b.d);
        const near = neighbors.filter((n) => n.d < neighbors[0].d * 1.15);
        const spacing = near.reduce((s, n) => s + n.d, 0) / near.length;
        grid.R = spacing / SQRT3;
        applyMode();
      }
    } else {
      // Square: measure cell size from a horizontal probe.
      const p = await G.snapPosition({ x: c0.x + grid.dpi * 1.02, y: c0.y }, 1, false, true);
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
  const o = { x: grid.origin.x + grid.nudge.x, y: grid.origin.y + grid.nudge.y };
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
  const x = p.x - grid.origin.x - grid.nudge.x, y = p.y - grid.origin.y - grid.nudge.y;
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

// CONE n — a SOLID wedge, kept deliberately SLIM: cells strictly INSIDE the
// ±30° aim window (±45° on squares), so the boundary "rails" that fattened
// the silhouette are trimmed off — one tile thinner on both sides. If the
// aim runs along a vertex the first ring would come up empty, so the two
// straddling cells are restored to keep the cone attached to its origin.
export function hexCone(origin, rad, n) {
  // Two aim regimes, auto-detected:
  //  • EDGE aim (a distance-1 cell sits ON the aim line): use the STRICT
  //    wedge — boundary rails trimmed, the slim triangle. Locked in; do not
  //    touch — these are the 12/2/4/6/8/10 o'clock cones.
  //  • VERTEX aim (no distance-1 cell inside the strict wedge): use the
  //    INCLUSIVE wedge so rows run 2/3/4… — strict trimming over-thinned
  //    these (row 2 collapsed to a single cell).
  const strict = coneScan(origin, rad, n, (grid.square ? Math.PI / 4 : Math.PI / 6) - 0.02);
  if (strict.hasD1) return strict.cells;
  const wide = coneScan(origin, rad, n, (grid.square ? Math.PI / 4 : Math.PI / 6) + 0.02);
  return wide.cells;
}

function coneScan(origin, rad, n, halfAngle) {
  const o = hexToPixel(origin);
  const cells = [];
  let hasD1 = false;
  for (const h of hexesInRange(origin, n, false)) {
    const d = hexDistance(origin, h);
    if (d > n) continue;
    const p = hexToPixel(h);
    let diff = Math.abs(Math.atan2(p.y - o.y, p.x - o.x) - rad);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff <= halfAngle) {
      cells.push(h);
      if (d === 1) hasD1 = true;
    }
  }
  return { cells, hasD1 };
}
