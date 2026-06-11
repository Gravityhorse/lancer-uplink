// tool.js — registers the LANCER Templates tool in Owlbear's toolbar.
//
// Toolbar modes (top-centre bar when the tool is selected): BLAST, CONE,
// LINE, ERASE. Move / sensor / weapon-range fields are placed from the
// panel — when armed they ride the Blast mode's click handler, keeping
// their own colour and always-private visibility.
//
// Placement model: click-and-drag — the press point is the ORIGIN, the
// release point sets size (blast radius) or size + direction (cone / line).
// Everything snaps to the grid. A template can be "armed" from the mech
// sheet with a fixed size, then a single click drops it.
//
// Robustness notes (fixes for ghost previews / sticky blasts):
//   • Preview updates are SERIALIZED — pointer events fire faster than the
//     OBR add/delete round-trips, and overlapping updates used to strand
//     orphan preview items that looked like phantom templates and survived
//     until a reload. Only one preview op runs at a time; the newest
//     requested preview wins.
//   • clearPreview() deletes every preview-kind local item by metadata, not
//     just the ones we remember creating.
//   • The eraser hit-tests shared templates, private templates, range
//     fields AND stray previews, with a radius scaled to the live grid.

import { OBR, ID, META } from "./sdk.js";
import {
  pixelToHex,
  hexesInRange,
  hexCone,
  hexLine,
  snapAngle,
  keyToHex,
  hexToPixel,
  hexDistance,
  grid,
} from "./hex.js";
import {
  buildHexOverlay,
  addSharedTemplate,
  addLocalTemplate,
  getTerrainSet,
  removeTerrainHex,
  renderTerrain,
  showBoostField,
} from "./overlay.js";

const TOOL = `${ID}/tool`;
const iconUrl = (name) => new URL(`./icons/${name}`, import.meta.url).href;

export const MODES = {
  blast: `${ID}/mode-blast`,
  cone: `${ID}/mode-cone`,
  line: `${ID}/mode-line`,
  erase: `${ID}/mode-erase`,
};

// Semantic shapes (drive colour + visibility). move/tech/weapon are panel-
// armed only and use the blast mode for placement.
const COLORS = {
  move: "#5ad17a",
  tech: "#3da5ff",
  weapon: "#d22f3d",
  blast: "#d22f3d",
  cone: "#d22f3d",
  line: "#d22f3d",
};

const LABELS = {
  move: "Move",
  tech: "Sensors",
  weapon: "Range",
  blast: "Blast",
  cone: "Cone",
  line: "Line",
};

// Which toolbar mode handles an armed shape.
const MODE_FOR_SHAPE = {
  blast: "blast", move: "blast", tech: "blast", weapon: "blast",
  cone: "cone", line: "line",
};

// Private range fields: only you see them.
const ALWAYS_LOCAL = new Set(["move", "tech", "weapon"]);

let registered = false;
export const isRegistered = () => registered;

// ---- visibility (set from the MAP tab toggle) ---------------------------------
let templateVisibility = "all"; // "all" | "me"
export function setTemplateVisibility(v) {
  templateVisibility = v === "me" ? "me" : "all";
}
export function getTemplateVisibility() {
  return templateVisibility;
}

async function placeTemplate(shape, hexes, name) {
  const color = COLORS[shape] || COLORS.blast;
  const local = ALWAYS_LOCAL.has(shape) || templateVisibility === "me";
  if (local) {
    await addLocalTemplate(hexes, { color, name });
  } else {
    await addSharedTemplate(hexes, { color, name });
  }
}

// ---- armed (panel) state --------------------------------------------------------
// { shape, size, name, boost }
let armed = null;
let boostSeq = 0;

export async function armTemplate(spec) {
  if (!spec || !MODE_FOR_SHAPE[spec.shape]) return;
  armed = {
    shape: spec.shape,
    size: Math.max(0, spec.size | 0),
    name: spec.name || LABELS[spec.shape],
    boost: !!spec.boost,
  };
  await activateMode(MODE_FOR_SHAPE[spec.shape]);
  return armed;
}

export async function activateMode(mode) {
  await OBR.tool.activateTool(TOOL);
  await OBR.tool.activateMode(MODES[mode] || MODES.blast);
}

const disarm = () => { armed = null; };

// ---- live preview overlay — SERIALIZED ---------------------------------------------
let previewBusy = false;
let previewNext = null; // latest requested { hexes, color } | "clear"
let previewIds = [];

function requestPreview(hexes, color) {
  previewNext = { hexes, color };
  pumpPreview();
}
function requestPreviewClear() {
  previewNext = "clear";
  pumpPreview();
}

async function pumpPreview() {
  if (previewBusy || previewNext == null) return;
  previewBusy = true;
  const job = previewNext;
  previewNext = null;
  try {
    await deleteAllPreviews();
    if (job !== "clear" && job.hexes.length) {
      const item = buildHexOverlay(job.hexes, {
        color: job.color,
        fillOpacity: 0.18,
        strokeOpacity: 0.6,
        strokeWidth: 2,
        name: "Template preview",
        kind: "preview",
      });
      await OBR.scene.local.addItems([item]);
      previewIds = [item.id];
    }
  } catch (_) { /* scene not ready — ignore */ }
  previewBusy = false;
  if (previewNext != null) pumpPreview(); // run the newest pending job
}

async function deleteAllPreviews() {
  try {
    const items = await OBR.scene.local.getItems(
      (i) => i.metadata?.[META]?.kind === "preview"
    );
    if (items.length) await OBR.scene.local.deleteItems(items.map((i) => i.id));
  } catch (_) {}
  previewIds = [];
}

let dragOrigin = null;
let placing = false; // guards against double placements from event bursts

async function placeOnce(fn) {
  if (placing) return;
  placing = true;
  try { await fn(); }
  finally { setTimeout(() => { placing = false; }, 150); }
}

// ---- mode factories -------------------------------------------------------------------

// Blast mode also hosts armed move/tech/weapon fields (their colour follows
// the armed shape). Manual use: drag from centre to set the radius.
function blastMode(icon) {
  const colorOf = () => COLORS[armed?.shape || "blast"];
  return {
    id: MODES.blast,
    icons: [{ icon, label: "Blast", filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "crosshair" }],

    async onToolMove(_ctx, ev) {
      if (!armed) return requestPreviewClear();
      const h = pixelToHex(ev.pointerPosition);
      const r = armed.boost ? armed.size * 2 : armed.size;
      requestPreview(hexesInRange(h, r, true), colorOf());
    },

    async onToolClick(_ctx, ev) {
      if (!armed) return; // manual placement uses drag
      const a = armed;
      disarm();
      requestPreviewClear();
      await placeOnce(async () => {
        const h = pixelToHex(ev.pointerPosition);
        if (a.boost) {
          await showBoostField(`tool-boost-${++boostSeq}`, h, a.size, { color: COLORS[a.shape], name: a.name });
        } else {
          await placeTemplate(a.shape, hexesInRange(h, a.size, true), a.name);
        }
      });
    },

    async onToolDragStart(_ctx, ev) {
      dragOrigin = pixelToHex(ev.pointerPosition);
    },
    async onToolDragMove(_ctx, ev) {
      if (!dragOrigin) return;
      const n = armed ? armed.size : hexDistance(dragOrigin, pixelToHex(ev.pointerPosition));
      requestPreview(hexesInRange(dragOrigin, n, true), colorOf());
    },
    async onToolDragEnd(_ctx, ev) {
      if (!dragOrigin) return;
      const origin = dragOrigin;
      dragOrigin = null;
      const a = armed;
      disarm();
      requestPreviewClear();
      await placeOnce(async () => {
        const n = a ? a.size : hexDistance(origin, pixelToHex(ev.pointerPosition));
        const name = a ? a.name : `Blast ${n}`;
        const shape = a ? a.shape : "blast";
        if (a && a.boost) {
          await showBoostField(`tool-boost-${++boostSeq}`, origin, a.size, { color: COLORS[a.shape], name: a.name });
        } else {
          await placeTemplate(shape, hexesInRange(origin, n, true), name);
        }
      });
    },
    onToolDragCancel() {
      dragOrigin = null;
      requestPreviewClear();
    },
    onDeactivate() {
      dragOrigin = null;
      requestPreviewClear();
    },
  };
}

// Directional modes (cone / line): origin = press point, pointer sets direction.
function directionalMode(shape, icon, fn) {
  const color = COLORS[shape];
  const angleOf = (origin, ev) => {
    const o = hexToPixel(origin);
    return snapAngle(Math.atan2(ev.pointerPosition.y - o.y, ev.pointerPosition.x - o.x));
  };
  const sizeOf = (origin, ev) =>
    armed && armed.shape === shape
      ? armed.size
      : Math.max(1, hexDistance(origin, pixelToHex(ev.pointerPosition)));

  return {
    id: MODES[shape],
    icons: [{ icon, label: LABELS[shape], filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "crosshair" }],

    async onToolDragStart(_ctx, ev) {
      dragOrigin = pixelToHex(ev.pointerPosition);
    },
    async onToolDragMove(_ctx, ev) {
      if (!dragOrigin) return;
      requestPreview(fn(dragOrigin, angleOf(dragOrigin, ev), sizeOf(dragOrigin, ev)), color);
    },
    async onToolDragEnd(_ctx, ev) {
      if (!dragOrigin) return;
      const origin = dragOrigin;
      dragOrigin = null;
      const n = sizeOf(origin, ev);
      const hexes = fn(origin, angleOf(origin, ev), n);
      const name = armed && armed.shape === shape ? armed.name : `${LABELS[shape]} ${n}`;
      disarm();
      requestPreviewClear();
      if (!hexes.length) return;
      await placeOnce(() => placeTemplate(shape, hexes, name));
    },
    onToolDragCancel() {
      dragOrigin = null;
      requestPreviewClear();
    },
    onDeactivate() {
      dragOrigin = null;
      requestPreviewClear();
    },
  };
}

// ---- eraser -----------------------------------------------------------------------------
// Removes, in priority order: stray previews → my private templates / range
// fields → my shared templates → legacy terrain. Hit radius scales with grid.
async function eraseAt(p) {
  const radius = Math.max(60, (grid.square ? grid.S : grid.R * 1.9) * 1.2);
  const near = (i) =>
    (i.commands || []).some((c) => c[0] === 0 && Math.hypot(c[1] - p.x, c[2] - p.y) < radius);

  // 1) stray previews — always purge on any erase click
  await deleteAllPreviews();

  // 2) my local (private) templates and range fields
  try {
    const locals = await OBR.scene.local.getItems((i) => {
      const k = i.metadata?.[META]?.kind;
      return (k === "template-local" || k === "range" || k === "overlay") && near(i);
    });
    if (locals.length) {
      await OBR.scene.local.deleteItems(locals.map((i) => i.id));
      return true;
    }
  } catch (_) {}

  // 3) my shared templates
  try {
    const me = await OBR.player.getId();
    const items = await OBR.scene.items.getItems(
      (i) => i.metadata?.[META]?.kind === "template" && i.createdUserId === me && near(i)
    );
    if (items.length) {
      await OBR.scene.items.deleteItems(items.map((i) => i.id));
      return true;
    }
  } catch (_) {}

  // 4) legacy difficult terrain (feature retired, but old marks may linger)
  try {
    const h = pixelToHex(p);
    const set = await getTerrainSet();
    if (set.has(`${h.q},${h.r}`)) {
      await removeTerrainHex(h);
      const next = await getTerrainSet();
      await renderTerrain([...next], keyToHex);
      return true;
    }
  } catch (_) {}
  return false;
}

export async function registerTool() {
  if (registered) return;
  await OBR.tool.create({
    id: TOOL,
    icons: [{ icon: iconUrl("tool.svg"), label: "LANCER Templates" }],
    defaultMode: MODES.blast,
  });

  await OBR.tool.createMode(blastMode(iconUrl("blast.svg")));
  await OBR.tool.createMode(directionalMode("cone", iconUrl("cone.svg"), hexCone));
  await OBR.tool.createMode(directionalMode("line", iconUrl("line.svg"), hexLine));

  await OBR.tool.createMode({
    id: MODES.erase,
    icons: [{ icon: iconUrl("erase.svg"), label: "Erase", filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "not-allowed" }],
    async onToolClick(_ctx, ev) {
      await eraseAt(ev.pointerPosition);
    },
  });

  registered = true;
}
