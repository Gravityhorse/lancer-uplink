// hex.js — cube-coordinate hex math, self-calibrated against the live Owlbear grid.

import { OBR } from "./sdk.js?v=10";

const SQRT3 = Math.sqrt(3);

export const grid = {
  ready: false,
  pointy: true,
  R: 75 / SQRT3,
  origin: { x: 0, y: 0 },
  dpi: 150,
  isHexGrid: true,
};

export async function calibrate() {
  grid.dpi = await OBR.scene.grid.getDpi();
  const type = await OBR.scene.grid.getType();

  grid.isHexGrid = type === "HEX_VERTICAL" || type === "HEX_HORIZONTAL";
  grid.pointy = type !== "HEX_HORIZONTAL";
  grid.R = grid.dpi / SQRT3;

  if (!grid.isHexGrid) {
    grid.ready = true;
    return grid;
  }

  try {
    const c0 = await OBR.scene.grid.snapPosition(
      { x: 5000.37, y: 4097.91 },
      1,
      false
    );

    grid.origin = c0;

    const neighbors = [];
    const probeDist = grid.dpi * 1.02;

    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;

      const p = await OBR.scene.grid.snapPosition(
        {
          x: c0.x + probeDist * Math.cos(rad),
          y: c0.y + probeDist * Math.sin(rad),
        },
        1,
        false
      );

      const dx = p.x - c0.x;
      const dy = p.y - c0.y;
      const d = Math.hypot(dx, dy);

      if (d > 1) {
        neighbors.push({ d, ang: Math.atan2(dy, dx) });
      }
    }

    if (neighbors.length) {
      neighbors.sort((a, b) => a.d - b.d);

      const near = neighbors.filter((n) => n.d < neighbors[0].d * 1.15);
      const spacing = near.reduce((s, n) => s + n.d, 0) / near.length;

      grid.R = spacing / SQRT3;

      const degMod = ((Math.abs(near[0].ang) * 180) / Math.PI) % 60;
      const offAxis = Math.min(degMod, 60 - degMod);

      grid.pointy = offAxis < 15;
    }
  } catch (error) {
    console.warn("[LANCER//UPLINK] grid calibration fell back to defaults", error);
  }

  grid.ready = true;
  return grid;
}

export function hexToPixel(h) {
  const R = grid.R;
  const o = grid.origin;

  if (grid.pointy) {
    return {
      x: o.x + R * SQRT3 * (h.q + h.r / 2),
      y: o.y + R * 1.5 * h.r,
    };
  }

  return {
    x: o.x + R * 1.5 * h.q,
    y: o.y + R * SQRT3 * (h.r + h.q / 2),
  };
}

export function pixelToHex(p) {
  const R = grid.R;
  const x = p.x - grid.origin.x;
  const y = p.y - grid.origin.y;

  let q;
  let r;

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

  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);

  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);

  if (dq > dr && dq > ds) {
    q = -r - s;
  } else if (dr > ds) {
    r = -q - s;
  }

  return { q, r };
}

export const hexKey = (h) => `${h.q},${h.r}`;

export const keyToHex = (k) => {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
};

export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;

  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function hexCorners(h) {
  const c = hexToPixel(h);
  const start = grid.pointy ? -90 : 0;
  const pts = [];

  for (let i = 0; i < 6; i++) {
    const a = ((start + i * 60) * Math.PI) / 180;

    pts.push({
      x: c.x + grid.R * Math.cos(a),
      y: c.y + grid.R * Math.sin(a),
    });
  }

  return pts;
}

export function hexesInRange(center, n, includeCenter = true) {
  const out = [];

  for (let dq = -n; dq <= n; dq++) {
    for (
      let dr = Math.max(-n, -dq - n);
      dr <= Math.min(n, -dq + n);
      dr++
    ) {
      if (!includeCenter && dq === 0 && dr === 0) continue;

      out.push({
        q: center.q + dq,
        r: center.r + dr,
      });
    }
  }

  return out;
}

export function snapAngle(rad) {
  const step = Math.PI / 6;
  return Math.round(rad / step) * step;
}

export function hexLine(origin, rad, n) {
  const o = hexToPixel(origin);
  const out = [];
  const seen = new Set([hexKey(origin)]);
  const step = grid.R * SQRT3 * 0.5;

  let i = 1;

  while (out.length < n && i < n * 4 + 8) {
    const p = {
      x: o.x + Math.cos(rad) * step * i,
      y: o.y + Math.sin(rad) * step * i,
    };

    const h = pixelToHex(p);
    const k = hexKey(h);

    if (!seen.has(k)) {
      seen.add(k);
      out.push(h);
    }

    i++;
  }

  return out;
}

export function hexCone(origin, rad, n) {
  const o = hexToPixel(origin);
  const candidates = hexesInRange(origin, n, false);
  const halfAngle = Math.PI / 6 + 0.02;
  const out = [];

  for (const h of candidates) {
    const p = hexToPixel(h);
    const ang = Math.atan2(p.y - o.y, p.x - o.x);

    let diff = Math.abs(ang - rad);

    if (diff > Math.PI) {
      diff = 2 * Math.PI - diff;
    }

    if (diff <= halfAngle && hexDistance(origin, h) <= n) {
      out.push(h);
    }
  }

  return out;
}
