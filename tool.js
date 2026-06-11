// tool.js — registers the LANCER Templates tool in Owlbear's toolbar and
// backs the in-panel template bar.
//
// Placement model (matches native Owlbear measuring):
//   • Click-and-drag: the press point is the ORIGIN, the release point sets
//     size (blast radius) or size + direction (cone / line). Everything snaps
//     to the hex grid.
//   • Blast is a radius centred on the origin. Cone / Line extend outward
//     from the origin toward the pointer (direction snaps to 30° steps).
//   • A template can be "armed" from the mech sheet (armTemplate) with a
//     fixed size — then a single click drops it.
//
// Colour by purpose: GREEN movement, BLUE tech/sensors, RED weapons.
//
// Visibility: move / tech (sensor) ranges are ALWAYS local (only you see
// them). Weapon templates (blast/cone/line) honour setTemplateVisibility():
//   "all" → shared scene items everyone sees
//   "me"  → local items only you see
//
// NOTE: icons resolve relative to this module's URL, so the tool registers
// correctly on GitHub Pages, localhost, or any other hosting path.

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
} from "./hex.js";
import {
  buildHexOverlay,
  addSharedTemplate,
  addLocalTemplate,
  eraseLocalTemplateAt,
  getTerrainSet,
  toggleTerrainHex,
  removeTerrainHex,
  renderTerrain,
  showBoostField,
} from "./overlay.js";

const TOOL = `${ID}/tool`;
const iconUrl = (name) => new URL(`./icons/${name}`, import.meta.url).href;

export const MODES = {
  move: `${ID}/mode-move`,
  tech: `${ID}/mode-tech`,
  blast: `${ID}/mode-blast`,
  cone: `${ID}/mode-cone`,
  line: `${ID}/mode-line`,
  terrain: `${ID}/mode-terrain`,
  erase: `${ID}/mode-erase`,
};

const COLORS = {
  move: "#5ad17a",
  tech: "#3da5ff",
  blast: "#d22f3d",
  cone: "#d22f3d",
  line: "#d22f3d",
};

const LABELS = {
  move: "Move",
  tech: "Sensors",
  blast: "Blast",
  cone: "Cone",
  line: "Line",
};

// move / tech are private range fields; weapons can be shared.
const ALWAYS_LOCAL = new Set(["move", "tech"]);

let registered = false;
export const isRegistered = () => registered;

// ---- visibility (set from the panel's ME / ALL toggle) -----------------------
let templateVisibility = "all"; // "all" | "me"
export function setTemplateVisibility(v) {
  templateVisibility = v === "me" ? "me" : "all";
}
export function getTemplateVisibility() {
  return templateVisibility;
}

async function placeTemplate(shape, hexes, name) {
  const color = COLORS[shape];
  const local = ALWAYS_LOCAL.has(shape) || templateVisibility === "me";
  if (local) {
    await addLocalTemplate(hexes, { color, name });
  } else {
    await addSharedTemplate(hexes, { color, name });
  }
}

// ---- armed (mech-sheet) state -------------------------------------------------
// { shape, size, name, boost } — boost makes a click place a double-radius
// movement field with a visible boundary at the standard-move edge.
let armed = null;
let boostSeq = 0;

export async function armTemplate(spec) {
  if (!spec || !MODES[spec.shape]) return;
  armed = {
    shape: spec.shape,
    size: Math.max(0, spec.size | 0),
    name: spec.name || LABELS[spec.shape],
    boost: !!spec.boost,
  };
  await activateMode(spec.shape);
  return armed;
}

export async function activateMode(shape) {
  await OBR.tool.activateTool(TOOL);
  await OBR.tool.activateMode(MODES[shape]);
}

const isArmed = (shape) => armed && armed.shape === shape;
const disarm = () => { armed = null; };

// ---- live preview overlay -------------------------------------------------------
let previewIds = [];

async function setPreview(hexes, color) {
  await clearPreview();
  if (!hexes.length) return;
  const item = buildHexOverlay(hexes, {
    color,
    fillOpacity: 0.18,
    strokeOpacity: 0.6,
    strokeWidth: 2,
    name: "Template preview",
    kind: "preview",
  });
  await OBR.scene.local.addItems([item]);
  previewIds = [item.id];
}

async function clearPreview() {
  if (!previewIds.length) return;
  try {
    await OBR.scene.local.deleteItems(previewIds);
  } catch (_) { /* ignore */ }
  previewIds = [];
}

let dragOrigin = null;

// ---- mode factories ---------------------------------------------------------------

// Circle / burst modes: drag from origin to size, or single click when armed.
function circleMode(shape, icon) {
  const color = COLORS[shape];
  return {
    id: MODES[shape],
    icons: [{ icon, label: LABELS[shape], filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "crosshair" }],

    async onToolMove(_ctx, ev) {
      if (!isArmed(shape)) return clearPreview();
      const h = pixelToHex(ev.pointerPosition);
      const r = armed.boost ? armed.size * 2 : armed.size;
      await setPreview(hexesInRange(h, r, true), color);
    },

    async onToolClick(_ctx, ev) {
      if (!isArmed(shape)) return; // manual placement uses drag
      const h = pixelToHex(ev.pointerPosition);
      const n = armed.size;
      const name = armed.name;
      const boost = armed.boost;
      await clearPreview();
      if (boost) {
        await showBoostField(`tool-boost-${++boostSeq}`, h, n, { color, name });
      } else {
        await placeTemplate(shape, hexesInRange(h, n, true), name);
      }
      disarm();
    },

    async onToolDragStart(_ctx, ev) {
      dragOrigin = pixelToHex(ev.pointerPosition);
    },
    async onToolDragMove(_ctx, ev) {
      if (!dragOrigin) return;
      const n = isArmed(shape)
        ? armed.size
        : hexDistance(dragOrigin, pixelToHex(ev.pointerPosition));
      await setPreview(hexesInRange(dragOrigin, n, true), color);
    },
    async onToolDragEnd(_ctx, ev) {
      if (!dragOrigin) return;
      const n = isArmed(shape)
        ? armed.size
        : hexDistance(dragOrigin, pixelToHex(ev.pointerPosition));
      await clearPreview();
      const name = isArmed(shape) ? armed.name : `${LABELS[shape]} ${n}`;
      await placeTemplate(shape, hexesInRange(dragOrigin, n, true), name);
      disarm();
      dragOrigin = null;
    },
    onToolDragCancel() {
      dragOrigin = null;
      return clearPreview();
    },
    onDeactivate: clearPreview,
  };
}

// Directional modes (cone / line): origin = press point, pointer sets direction;
// size from drag distance, or from the armed size when armed.
function directionalMode(shape, icon, fn) {
  const color = COLORS[shape];
  const angleOf = (origin, ev) => {
    const o = hexToPixel(origin);
    return snapAngle(Math.atan2(ev.pointerPosition.y - o.y, ev.pointerPosition.x - o.x));
  };
  const sizeOf = (origin, ev) =>
    isArmed(shape)
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
      await setPreview(fn(dragOrigin, angleOf(dragOrigin, ev), sizeOf(dragOrigin, ev)), color);
    },
    async onToolDragEnd(_ctx, ev) {
      if (!dragOrigin) return;
      const n = sizeOf(dragOrigin, ev);
      const hexes = fn(dragOrigin, angleOf(dragOrigin, ev), n);
      await clearPreview();
      if (hexes.length) {
        const name = isArmed(shape) ? armed.name : `${LABELS[shape]} ${n}`;
        await placeTemplate(shape, hexes, name);
      }
      disarm();
      dragOrigin = null;
    },
    onToolDragCancel() {
      dragOrigin = null;
      return clearPreview();
    },
    onDeactivate: clearPreview,
  };
}

export async function registerTool() {
  if (registered) return;
  await OBR.tool.create({
    id: TOOL,
    icons: [{ icon: iconUrl("tool.svg"), label: "LANCER Templates" }],
    defaultMode: MODES.blast,
  });

  await OBR.tool.createMode(circleMode("blast", iconUrl("blast.svg")));
  await OBR.tool.createMode(directionalMode("cone", iconUrl("cone.svg"), hexCone));
  await OBR.tool.createMode(directionalMode("line", iconUrl("line.svg"), hexLine));
  await OBR.tool.createMode(circleMode("move", iconUrl("move.svg")));
  await OBR.tool.createMode(circleMode("tech", iconUrl("tech.svg")));

  const filter = { activeTools: [TOOL] };

  await OBR.tool.createMode({
    id: MODES.terrain,
    icons: [{ icon: iconUrl("terrain.svg"), label: "Difficult Terrain", filter }],
    cursors: [{ cursor: "cell" }],
    async onToolClick(_ctx, ev) {
      const h = pixelToHex(ev.pointerPosition);
      await toggleTerrainHex(h);
      const set = await getTerrainSet();
      await renderTerrain([...set], keyToHex);
    },
  });

  await OBR.tool.createMode({
    id: MODES.erase,
    icons: [{ icon: iconUrl("erase.svg"), label: "Erase", filter }],
    cursors: [{ cursor: "not-allowed" }],
    async onToolClick(_ctx, ev) {
      const p = ev.pointerPosition;
      const h = pixelToHex(p);

      // 1) terrain hex under the cursor?
      const set = await getTerrainSet();
      const key = `${h.q},${h.r}`;
      if (set.has(key)) {
        await removeTerrainHex(h);
        const next = await getTerrainSet();
        await renderTerrain([...next], keyToHex);
        return;
      }

      // 2) one of my local (private) templates?
      if (await eraseLocalTemplateAt(p)) return;

      // 3) one of my shared templates?
      const me = await OBR.player.getId();
      const items = await OBR.scene.items.getItems(
        (i) => i.metadata?.[META]?.kind === "template" && i.createdUserId === me
      );
      const hit = items.filter((i) =>
        (i.commands || []).some((c) => c[0] === 0 && Math.hypot(c[1] - p.x, c[2] - p.y) < 200)
      );
      if (hit.length) {
        await OBR.scene.items.deleteItems([hit[0].id]);
      }
    },
  });

  registered = true;
}
