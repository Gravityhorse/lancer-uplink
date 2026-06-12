// tool.js — registers the LANCER Templates tool in Owlbear's toolbar and
// backs the panel's range-field arming.
//
// Toolbar modes: BLAST, CONE, LINE, ERASE.
// Placement: click-and-drag — press point is the ORIGIN, release sets size
// (and direction for cone/line). Everything snaps to the grid. While
// dragging, a counter above the cursor shows the tile distance from the
// origin, and placed templates carry a white distance number on their
// farthest tile. Lines also get their origin hex outlined.
//
// Every template is a GROUP (path + label + origin marker) sharing a group
// id, so erase and UNDO remove the whole thing together.

import { OBR, ID, META, buildLabel } from "./sdk.js";
import {
  pixelToHex,
  hexesInRange,
  hexCone,
  hexLine,
  snapAngle,
  hexToPixel,
  hexDistance,
  grid,
} from "./hex.js";
import {
  buildHexOverlay,
  addSharedTemplate,
  addLocalTemplate,
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

const MODE_FOR_SHAPE = {
  blast: "blast", move: "blast", tech: "blast", weapon: "blast",
  cone: "cone", line: "line",
};

const ALWAYS_LOCAL = new Set(["move", "tech", "weapon"]);

let registered = false;
export const isRegistered = () => registered;

// ---- visibility (MAP tab toggle) ------------------------------------------------
let templateVisibility = "all";
export function setTemplateVisibility(v) {
  templateVisibility = v === "me" ? "me" : "all";
}
export function getTemplateVisibility() {
  return templateVisibility;
}

// ---- undo stack -------------------------------------------------------------------
// [{ local: bool, group: string }]
const undoStack = [];

export async function undoLastTemplate() {
  const entry = undoStack.pop();
  if (!entry) return false;
  try {
    const api = entry.local ? OBR.scene.local : OBR.scene.items;
    const items = await api.getItems((i) => i.metadata?.[META]?.group === entry.group);
    if (items.length) await api.deleteItems(items.map((i) => i.id));
    return true;
  } catch (_) {
    return false;
  }
}

// ---- placement (grouped: path + distance label + origin marker) --------------------
let groupSeq = 0;

// Defensive builder: style setters vary across SDK versions, so each call is
// applied only if the builder actually has it — a missing one can never brick
// template placement.
function distanceLabelItem(pos, n, group, kind) {
  let b = buildLabel().plainText(String(n)).position(pos);
  const opt = (fn, ...args) => { try { if (typeof b[fn] === "function") b = b[fn](...args); } catch (_) {} };
  opt("pointerHeight", 0);
  opt("pointerWidth", 0);
  opt("backgroundOpacity", 0.55);
  opt("layer", "PROP");
  opt("locked", true);
  opt("disableHit", true);
  opt("name", "Template distance");
  opt("metadata", { [META]: { kind, group } });
  return b.build();
}

function originMarkerItem(originHex, color, group, kind) {
  return buildHexOverlay([originHex], {
    color,
    fillOpacity: 0.05,
    strokeOpacity: 0.95,
    strokeWidth: 5,
    name: "Template origin",
    kind,
    layer: "PROP",
    extra: { group },
  });
}

// shape: semantic shape; hexes: cells; opts: { name, n, labelHex, originHex }
async function placeTemplate(shape, hexes, opts = {}) {
  if (!hexes.length) return;
  const color = COLORS[shape] || COLORS.blast;
  const local = ALWAYS_LOCAL.has(shape) || templateVisibility === "me";
  const kind = local ? "template-local" : "template";
  const group = `g${Date.now()}-${++groupSeq}`;
  const items = [];

  if (local) {
    await addLocalTemplate(hexes, { color, name: opts.name, extra: { group } });
  } else {
    await addSharedTemplate(hexes, { color, name: opts.name, extra: { group } });
  }
  if (opts.labelHex != null && opts.n != null) {
    items.push(distanceLabelItem(hexToPixel(opts.labelHex), opts.n, group, kind));
  }
  if (opts.originHex) {
    items.push(originMarkerItem(opts.originHex, color, group, kind));
  }
  if (items.length) {
    try {
      if (local) await OBR.scene.local.addItems(items);
      else await OBR.scene.items.addItems(items);
    } catch (_) {}
  }
  undoStack.push({ local, group });
  if (undoStack.length > 40) undoStack.shift();
}

// farthest cell from the origin (for the distance label)
function farthestHex(hexes, origin) {
  let best = null, bd = -1;
  for (const h of hexes) {
    const d = hexDistance(origin, h);
    if (d > bd) { bd = d; best = h; }
  }
  return best;
}

// ---- armed (panel) state -------------------------------------------------------------
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

// ---- live preview + cursor distance counter (SERIALIZED) ------------------------------
let previewBusy = false;
let previewNext = null; // { hexes, color, cursor: {pos, n} | null } | "clear"

function requestPreview(hexes, color, cursor) {
  previewNext = { hexes, color, cursor: cursor || null };
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
    if (job !== "clear") {
      const items = [];
      if (job.hexes.length) {
        items.push(buildHexOverlay(job.hexes, {
          color: job.color,
          fillOpacity: 0.18,
          strokeOpacity: 0.6,
          strokeWidth: 2,
          name: "Template preview",
          kind: "preview",
          layer: "PROP",
        }));
      }
      if (job.cursor) {
        items.push(distanceLabelItem(
          { x: job.cursor.pos.x, y: job.cursor.pos.y - (grid.dpi || 150) * 0.55 },
          job.cursor.n, null, "preview"
        ));
      }
      if (items.length) await OBR.scene.local.addItems(items);
    }
  } catch (_) { /* scene not ready — ignore */ }
  previewBusy = false;
  if (previewNext != null) pumpPreview();
}

async function deleteAllPreviews() {
  try {
    const items = await OBR.scene.local.getItems(
      (i) => i.metadata?.[META]?.kind === "preview"
    );
    if (items.length) await OBR.scene.local.deleteItems(items.map((i) => i.id));
  } catch (_) {}
}

let dragOrigin = null;
let placing = false;

async function placeOnce(fn) {
  if (placing) return;
  placing = true;
  try { await fn(); }
  finally { setTimeout(() => { placing = false; }, 150); }
}

// ---- modes -------------------------------------------------------------------------------

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
      requestPreview(hexesInRange(h, r, true), colorOf(),
        { pos: ev.pointerPosition, n: armed.size });
    },

    async onToolClick(_ctx, ev) {
      if (!armed) return;
      const a = armed;
      disarm();
      requestPreviewClear();
      await placeOnce(async () => {
        const h = pixelToHex(ev.pointerPosition);
        if (a.boost) {
          await showBoostField(`tool-boost-${++boostSeq}`, h, a.size, { color: COLORS[a.shape], name: a.name });
        } else {
          await placeTemplate(a.shape, hexesInRange(h, a.size, true), { name: a.name });
        }
      });
    },

    async onToolDragStart(_ctx, ev) {
      dragOrigin = pixelToHex(ev.pointerPosition);
    },
    async onToolDragMove(_ctx, ev) {
      if (!dragOrigin) return;
      const n = armed ? armed.size : hexDistance(dragOrigin, pixelToHex(ev.pointerPosition));
      requestPreview(hexesInRange(dragOrigin, n, true), colorOf(),
        { pos: ev.pointerPosition, n });
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
          await placeTemplate(shape, hexesInRange(origin, n, true), {
            name, n, labelHex: pixelToHex(ev.pointerPosition),
          });
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

// Directional modes. Cone snaps to grid-friendly angles; the LINE runs free
// in any direction (it samples cells along the true pointer bearing).
function directionalMode(shape, icon, fn, snap) {
  const color = COLORS[shape];
  const angleOf = (origin, ev) => {
    const o = hexToPixel(origin);
    const raw = Math.atan2(ev.pointerPosition.y - o.y, ev.pointerPosition.x - o.x);
    return snap ? snapAngle(raw) : raw;
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
      const n = sizeOf(dragOrigin, ev);
      requestPreview(fn(dragOrigin, angleOf(dragOrigin, ev), n), color,
        { pos: ev.pointerPosition, n });
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
      await placeOnce(() => placeTemplate(shape, hexes, {
        name, n,
        labelHex: farthestHex(hexes, origin),
        originHex: shape === "line" ? origin : null, // lines mark their origin
      }));
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

// ---- eraser (group-aware) ------------------------------------------------------------------
// Removes the WHOLE template group (path + label + origin marker) of whatever
// you click. Range fields are untouchable here — clear those from the panel.
async function eraseAt(p) {
  const radius = Math.max(60, (grid.square ? grid.S : grid.R * 1.9) * 1.2);
  const near = (i) => {
    if (i.position && (i.position.x || i.position.y)) {
      if (Math.hypot(i.position.x - p.x, i.position.y - p.y) < radius) return true;
    }
    return (i.commands || []).some((c) => c[0] === 0 && Math.hypot(c[1] - p.x, c[2] - p.y) < radius);
  };

  await deleteAllPreviews();

  const wipeGroups = async (api, kind) => {
    try {
      const all = await api.getItems((i) => i.metadata?.[META]?.kind === kind);
      const hit = all.filter(near);
      if (!hit.length) return false;
      const groups = new Set(hit.map((i) => i.metadata?.[META]?.group).filter(Boolean));
      const doomed = all.filter((i) => groups.has(i.metadata?.[META]?.group) || hit.includes(i));
      await api.deleteItems(doomed.map((i) => i.id));
      return true;
    } catch (_) { return false; }
  };

  if (await wipeGroups(OBR.scene.local, "template-local")) return true;

  // shared templates: only my own
  try {
    const me = await OBR.player.getId();
    const all = await OBR.scene.items.getItems((i) => i.metadata?.[META]?.kind === "template");
    const hit = all.filter((i) => i.createdUserId === me && near(i));
    if (hit.length) {
      const groups = new Set(hit.map((i) => i.metadata?.[META]?.group).filter(Boolean));
      const doomed = all.filter(
        (i) => i.createdUserId === me && (groups.has(i.metadata?.[META]?.group) || hit.includes(i))
      );
      await OBR.scene.items.deleteItems(doomed.map((i) => i.id));
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
  await OBR.tool.createMode(directionalMode("cone", iconUrl("cone.svg"), hexCone, true));
  await OBR.tool.createMode(directionalMode("line", iconUrl("line.svg"), hexLine, false));

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
