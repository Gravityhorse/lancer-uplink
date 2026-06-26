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

import { OBR, ID, META, buildLabel, buildPath, Command } from "./sdk.js";
import {
  pixelToHex,
  hexesInRange,
  hexCone,
  hexLine,
  snapAngle,
  hexToPixel,
  hexDistance,
  hexKey,
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
  move: `${ID}/mode-move`,
  blast: `${ID}/mode-blast`,
  cone: `${ID}/mode-cone`,
  line: `${ID}/mode-line`,
  paint: `${ID}/mode-paint`,
  pen: `${ID}/mode-pen`,
  erase: `${ID}/mode-erase`,
};

// Paint palette — exclusive to the Paint tool (kind:"paint"/"paint-local"), so
// it can never be confused with the Move/Sensors/Range/weapon overlays. The
// colour is chosen from the panel (the Owlbear-toolbar action approach broke
// tool registration), so these are exported for the panel to render.
export const PAINT_COLORS = [
  { key: "Red", color: "#d22f3d" },
  { key: "Blue", color: "#3da5ff" },
  { key: "Green", color: "#5ad17a" },
  { key: "Orange", color: "#ff8a3d" },
  { key: "Purple", color: "#b07ee6" },
  { key: "Yellow", color: "#ffd34d" },
];
let paintColor = PAINT_COLORS[0].color;
export const getPaintColor = () => paintColor;
export function setPaintColor(c) { paintColor = c; }
export async function armPaint() {
  try { await OBR.tool.activateTool(TOOL); await OBR.tool.activateMode(MODES.paint); } catch (_) {}
}

// Move / Sensors / Range keep their semantic colours. Blast / Cone / Line /
// Paint / Pen all draw in the shared "Template Color" the player picks in the
// panel (default red) — see PAINT_COLORS / setPaintColor above.
const FIXED_COLORS = { move: "#5ad17a", tech: "#3da5ff", weapon: "#d22f3d" };
const COLORS = { ...FIXED_COLORS, blast: "#d22f3d", cone: "#d22f3d", line: "#d22f3d" };
const shapeColor = (shape) => FIXED_COLORS[shape] || paintColor;

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
  const color = shapeColor(shape);
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
let previewNext = null;   // latest-wins preview job: {type:"hex"|"path"|"clear", ...}
let commitQueue = [];     // FIFO real-item commits — NEVER coalesced/dropped

function requestPreview(hexes, color, cursor) {
  previewNext = { type: "hex", hexes, color, cursor: cursor || null };
  pumpPreview();
}
function requestPathPreview(item) {
  previewNext = { type: "path", item };
  pumpPreview();
}
function requestPreviewClear() {
  previewNext = { type: "clear" };
  pumpPreview();
}
// Commit a real item the SAME way templates do — once, after the gesture ends.
// (Adding shared items mid-drag gets reverted by Owlbear on the next sync.)
function requestCommit(item, local, group) {
  previewNext = null; // the gesture is over — drop any pending preview so none
                      // re-appears on top of the committed item
  commitQueue.push({ item, local, group });
  pumpPreview();
}

async function pumpPreview() {
  if (previewBusy) return;
  if (!commitQueue.length && previewNext == null) return;
  previewBusy = true;
  try {
    if (commitQueue.length) {
      // commits take priority and run in order; clear previews then add the item
      const job = commitQueue.shift();
      await deleteAllPreviews();
      try {
        if (job.local) await OBR.scene.local.addItems([job.item]);
        else await OBR.scene.items.addItems([job.item]);
        undoStack.push({ local: job.local, group: job.group });
        if (undoStack.length > 40) undoStack.shift();
      } catch (_) {}
    } else {
      const job = previewNext;
      previewNext = null;
      await deleteAllPreviews();
      if (job.type === "hex") {
        const items = [];
        if (job.hexes.length) {
          items.push(buildHexOverlay(job.hexes, {
            color: job.color, fillOpacity: 0.18, strokeOpacity: 0.6, strokeWidth: 2,
            name: "Template preview", kind: "preview", layer: "PROP",
          }));
        }
        if (job.cursor) {
          items.push(distanceLabelItem(
            { x: job.cursor.pos.x, y: job.cursor.pos.y - (grid.dpi || 150) * 0.55 },
            job.cursor.n, null, "preview"
          ));
        }
        if (items.length) await OBR.scene.local.addItems(items);
      } else if (job.type === "path") {
        if (job.item) await OBR.scene.local.addItems([job.item]);
      }
      // "clear" → nothing after deleteAllPreviews
    }
  } catch (_) { /* scene not ready — ignore */ }
  previewBusy = false;
  if (commitQueue.length || previewNext != null) pumpPreview();
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
  const colorOf = () => shapeColor(armed?.shape || "blast");
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
          await showBoostField(`tool-boost-${++boostSeq}`, h, a.size, { color: shapeColor(a.shape), name: a.name });
        } else {
          await placeTemplate(a.shape, hexesInRange(h, a.size, true), {
            name: a.name, originHex: a.shape === "blast" ? h : null,
          });
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
          await showBoostField(`tool-boost-${++boostSeq}`, origin, a.size, { color: shapeColor(a.shape), name: a.name });
        } else {
          await placeTemplate(shape, hexesInRange(origin, n, true), {
            name, n, labelHex: pixelToHex(ev.pointerPosition),
            originHex: shape === "blast" ? origin : null, // blast marks its centre
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
      requestPreview(fn(dragOrigin, angleOf(dragOrigin, ev), n), shapeColor(shape),
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
        originHex: origin, // lines AND cones mark their origin tile
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

// ---- paint (free tile highlighting) -------------------------------------------
// Painted tiles honour the templates ALL/ME visibility (shared items when ALL,
// local when ME), carry their own kind so they never touch Move/Sensors/Range,
// are erasable, undoable (per stroke) and clearable. Painted in the palette colour.
// PAINT — accumulate the hexes you sweep, preview them locally, and commit ONE
// overlay on drag-END (the only thing that reliably persists). Honours ALL/ME
// visibility, its own kind (never touches Move/Sensors/Range), erasable + undoable.
let paintHexes = null; // Map hexKey -> hex
function paintBegin(p) { paintHexes = new Map(); paintTouch(p); }
function paintTouch(p) {
  if (!paintHexes) return false;
  const h = pixelToHex(p), k = hexKey(h);
  if (paintHexes.has(k)) return false;
  paintHexes.set(k, h);
  return true;
}
function paintPreview() { if (paintHexes) requestPreview([...paintHexes.values()], paintColor, null); }
function paintCommit() {
  const hexes = paintHexes ? [...paintHexes.values()] : [];
  paintHexes = null;
  if (!hexes.length) { requestPreviewClear(); return; }
  const local = templateVisibility === "me";
  const group = `paint-${Date.now()}-${++groupSeq}`;
  const item = buildHexOverlay(hexes, {
    color: paintColor, fillOpacity: 0.3, strokeOpacity: 0.7, strokeWidth: 2,
    name: "Paint", kind: local ? "paint-local" : "paint", layer: "PROP", extra: { group },
  });
  requestCommit(item, local, group);
}

export async function clearMyPaint() {
  try {
    const loc = await OBR.scene.local.getItems((i) => ["paint-local", "pen-local"].includes(i.metadata?.[META]?.kind));
    if (loc.length) await OBR.scene.local.deleteItems(loc.map((i) => i.id));
  } catch (_) {}
  try {
    const me = await OBR.player.getId();
    const sh = await OBR.scene.items.getItems((i) => ["paint", "pen"].includes(i.metadata?.[META]?.kind) && i.createdUserId === me);
    if (sh.length) await OBR.scene.items.deleteItems(sh.map((i) => i.id));
  } catch (_) {}
}

function paintMode(icon) {
  return {
    id: MODES.paint,
    icons: [{ icon, label: "Paint", filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "crosshair" }],
    onToolClick(_ctx, ev) { paintBegin(ev.pointerPosition); paintCommit(); },
    onToolDragStart(_ctx, ev) { paintBegin(ev.pointerPosition); paintPreview(); },
    onToolDragMove(_ctx, ev) { if (paintTouch(ev.pointerPosition)) paintPreview(); },
    onToolDragEnd() { paintCommit(); },
    onToolDragCancel() { paintHexes = null; requestPreviewClear(); },
  };
}

// PEN — freehand: accumulate the raw pointer path (NO hex snapping), preview a
// path locally, commit ONE path on drag-END. Same commit-on-end lifecycle as the
// templates, which is the only thing Owlbear reliably keeps.
let penPts = null, penLocal = false, penGroup = null;
const penWidth = () => Math.max(3, (grid.dpi || 150) * 0.11);
const penStep = () => (grid.dpi || 150) * 0.04; // min pointer travel between samples
const penPair = (pts) => (pts.length >= 2 ? pts : [pts[0], { x: pts[0].x + 0.8, y: pts[0].y + 0.8 }]);
function penPathItem(points, preview, group, local) {
  const cmds = [[Command.MOVE, points[0].x, points[0].y]];
  for (let i = 1; i < points.length; i++) cmds.push([Command.LINE, points[i].x, points[i].y]);
  let b = buildPath().position({ x: 0, y: 0 }).commands(cmds)
    .fillColor(paintColor).fillOpacity(0)
    .strokeColor(paintColor).strokeOpacity(preview ? 0.55 : 0.95).strokeWidth(penWidth())
    .layer("PROP").name("Pen")
    .metadata({ [META]: { kind: preview ? "preview" : (local ? "pen-local" : "pen"), group } });
  const opt = (fn, ...a) => { try { if (typeof b[fn] === "function") b = b[fn](...a); } catch (_) {} };
  opt("strokeCap", "round");
  opt("strokeJoin", "round");
  return b.build();
}
function penBegin(p) { penLocal = templateVisibility === "me"; penGroup = `pen-${Date.now()}-${++groupSeq}`; penPts = [{ x: p.x, y: p.y }]; }
function penTouch(p) {
  if (!penPts) return false;
  const last = penPts[penPts.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < penStep()) return false;
  penPts.push({ x: p.x, y: p.y });
  return true;
}
function penPreview() { if (penPts) requestPathPreview(penPathItem(penPair(penPts), true, penGroup, penLocal)); }
function penCommit() {
  if (!penPts) { requestPreviewClear(); return; }
  const item = penPathItem(penPair(penPts), false, penGroup, penLocal);
  const grp = penGroup, loc = penLocal;
  penPts = null; penGroup = null;
  requestCommit(item, loc, grp);
}

function penMode(icon) {
  return {
    id: MODES.pen,
    icons: [{ icon, label: "Pen", filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "crosshair" }],
    onToolClick(_ctx, ev) { penBegin(ev.pointerPosition); penCommit(); },
    onToolDragStart(_ctx, ev) { penBegin(ev.pointerPosition); penPreview(); },
    onToolDragMove(_ctx, ev) { if (penTouch(ev.pointerPosition)) penPreview(); },
    onToolDragEnd() { penCommit(); },
    onToolDragCancel() { penPts = null; penGroup = null; requestPreviewClear(); },
  };
}

// ---- eraser (group-aware) ------------------------------------------------------------------
// Removes the WHOLE template group (path + label + origin marker) of whatever
// you click, plus painted tiles. Range fields are cleared from the panel.
// Returns true if it removed anything (the mode auto-swaps to Move otherwise).
async function eraseAt(p) {
  const radius = Math.max(60, (grid.square ? grid.S : grid.R * 1.9) * 1.2);
  const near = (i) => {
    if (i.position && (i.position.x || i.position.y)) {
      if (Math.hypot(i.position.x - p.x, i.position.y - p.y) < radius) return true;
    }
    // test EVERY vertex (MOVE + LINE both carry x,y) so clicking anywhere along
    // a long freehand Pen stroke — not just its start point — erases it
    return (i.commands || []).some((c) => c.length >= 3 && Math.hypot(c[1] - p.x, c[2] - p.y) < radius);
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
  if (await wipeGroups(OBR.scene.local, "pen-local")) return true;
  if (await wipeGroups(OBR.scene.local, "paint-local")) return true;

  // shared templates / pen / paint: only my own
  const wipeSharedOwn = async (kind) => {
    try {
      const me = await OBR.player.getId();
      const all = await OBR.scene.items.getItems((i) => i.metadata?.[META]?.kind === kind);
      const hit = all.filter((i) => i.createdUserId === me && near(i));
      if (!hit.length) return false;
      const groups = new Set(hit.map((i) => i.metadata?.[META]?.group).filter(Boolean));
      const doomed = all.filter(
        (i) => i.createdUserId === me && (groups.has(i.metadata?.[META]?.group) || hit.includes(i))
      );
      await OBR.scene.items.deleteItems(doomed.map((i) => i.id));
      return true;
    } catch (_) { return false; }
  };
  if (await wipeSharedOwn("template")) return true;
  if (await wipeSharedOwn("pen")) return true;
  if (await wipeSharedOwn("paint")) return true;
  return false;
}

export async function registerTool() {
  if (registered) return;
  await OBR.tool.create({
    id: TOOL,
    icons: [{ icon: iconUrl("tool.svg"), label: "LANCER Templates" }],
    defaultMode: MODES.move, // open in the safe Move mode, not armed to place
  });

  // MOVE: a passthrough mode that hands map interaction back to Owlbear — an
  // empty preventDrag filter always returns true, so dragging uses the default
  // operation "which mimics the Move tool" (pan + drag tokens); clicks select.
  await OBR.tool.createMode({
    id: MODES.move,
    // white LANCER hex (matches the toolbar logo + other mode icons)
    icons: [{ icon: iconUrl("select.svg"), label: "Move", filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "default" }], // just the normal pointer
    preventDrag: {},
  });

  await OBR.tool.createMode(blastMode(iconUrl("blast.svg")));
  await OBR.tool.createMode(directionalMode("cone", iconUrl("cone.svg"), hexCone, true));
  await OBR.tool.createMode(directionalMode("line", iconUrl("line.svg"), hexLine, false));
  await OBR.tool.createMode(paintMode(iconUrl("paint.svg")));
  await OBR.tool.createMode(penMode(iconUrl("pen.svg"))); // freehand draw, no snapping
  // (Colour is the shared Template Color chosen from the panel — see PAINT_COLORS.)

  // white eraser cursor (data-URI SVG) — replaces the red "not-allowed" circle
  const eraseCursor =
    "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='22'%20height='22'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='white'%20stroke-width='2.2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M4%2015%20L11%208%20L18%2015%20L13%2020%20L9%2020%20Z'/%3E%3Cline%20x1='6'%20y1='20'%20x2='20'%20y2='20'/%3E%3C/svg%3E\") 4 18, crosshair";
  let eraseChain = Promise.resolve();
  const eraseDrag = (p) => { eraseChain = eraseChain.then(() => eraseAt(p)).catch(() => {}); return eraseChain; };
  await OBR.tool.createMode({
    id: MODES.erase,
    icons: [{ icon: iconUrl("erase.svg"), label: "Erase", filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: eraseCursor }],
    async onToolClick(_ctx, ev) {
      // erase what's under the click; if nothing was there, drop to Move mode
      const did = await eraseAt(ev.pointerPosition);
      if (!did) { try { await OBR.tool.activateMode(MODES.move); } catch (_) {} }
    },
    // hold-and-drag erases continuously (serialised so passes never race)
    async onToolDragStart(_ctx, ev) { await eraseDrag(ev.pointerPosition); },
    async onToolDragMove(_ctx, ev) { await eraseDrag(ev.pointerPosition); },
  });

  registered = true;
}
