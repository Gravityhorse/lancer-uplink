// tool.js — registers the LANCER Templates tool in Owlbear's toolbar.
//
// Templates are placed the way native Owlbear measurement works: click to set
// the origin, then drag outward to size/orient. No fixed "size" config.
//
// Colour is automatic by purpose:
//   GREEN  — movement (move / boost)            -> "move" mode
//   BLUE   — tech (tech attack / sensor range)  -> "tech" mode
//   RED    — weapons (blast / cone / line)      -> "blast" / "cone" / "line"
//
// The mech sheet can also "arm" a template: armTemplate({shape,size,name})
// activates the right mode with a pre-set size so the GM/player only has to
// click (circles) or drag-to-aim (cone/line) to drop it. After one placement
// the armed state clears and the mode reverts to manual drag-to-size.

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
  getTerrainSet,
  toggleTerrainHex,
  removeTerrainHex,
  renderTerrain,
} from "./overlay.js";

const TOOL = `${ID}/tool`;

const MODES = {
  move: `${ID}/mode-move`,
  tech: `${ID}/mode-tech`,
  blast: `${ID}/mode-blast`,
  cone: `${ID}/mode-cone`,
  line: `${ID}/mode-line`,
  terrain: `${ID}/mode-terrain`,
  erase: `${ID}/mode-erase`,
};

// Purpose -> colour. Movement green, tech blue, weapons red.
const COLORS = {
  move: "#5ad17a",
  tech: "#3da5ff",
  blast: "#d22f3d",
  cone: "#d22f3d",
  line: "#d22f3d",
};

const LABELS = {
  move: "Move",
  tech: "Tech",
  blast: "Blast",
  cone: "Cone",
  line: "Line",
};

// Circle-style shapes (centred burst). Directional shapes are cone/line.
const CIRCLE_SHAPES = new Set(["move", "tech", "blast"]);

// ---- armed (mech-sheet) state ----------------------------------------------
// { shape: "move"|"tech"|"blast"|"cone"|"line", size: number, name: string }
let armed = null;

export async function armTemplate(spec) {
  if (!spec || !MODES[spec.shape]) return;
  armed = { shape: spec.shape, size: Math.max(0, spec.size | 0), name: spec.name || LABELS[spec.shape] };
  try {
    await OBR.tool.activateTool(TOOL);
    await OBR.tool.activateMode(MODES[spec.shape]);
  } catch (_) {
    // Tool not registered yet / OBR not ready — arming is best-effort.
  }
  return armed;
}

const isArmed = (shape) => armed && armed.shape === shape;
const disarm = () => { armed = null; };

// ---- live preview overlay ---------------------------------------------------
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

// ---- mode factories ---------------------------------------------------------

// Circle / burst modes: click (when armed) or drag-to-size.
function circleMode(shape, icon) {
  const color = COLORS[shape];
  return {
    id: MODES[shape],
    icons: [{ icon, label: LABELS[shape], filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "crosshair" }],

    async onToolMove(_ctx, ev) {
      // Only show a hover preview when armed with a fixed size.
      if (!isArmed(shape)) return clearPreview();
      const h = pixelToHex(ev.pointerPosition);
      await setPreview(hexesInRange(h, armed.size, true), color);
    },

    async onToolClick(_ctx, ev) {
      if (!isArmed(shape)) return; // manual placement uses drag
      const h = pixelToHex(ev.pointerPosition);
      const n = armed.size;
      const name = armed.name;
      await clearPreview();
      await addSharedTemplate(hexesInRange(h, n, true), { color, name });
      disarm();
    },

    async onToolDragStart(_ctx, ev) {
      dragOrigin = pixelToHex(ev.pointerPosition);
    },
    async onToolDragMove(_ctx, ev) {
      if (!dragOrigin) return;
      const n = hexDistance(dragOrigin, pixelToHex(ev.pointerPosition));
      await setPreview(hexesInRange(dragOrigin, n, true), color);
    },
    async onToolDragEnd(_ctx, ev) {
      if (!dragOrigin) return;
      const n = hexDistance(dragOrigin, pixelToHex(ev.pointerPosition));
      await clearPreview();
      const name = isArmed(shape) ? armed.name : `${LABELS[shape]} ${n}`;
      await addSharedTemplate(hexesInRange(dragOrigin, n, true), { color, name });
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

// Directional modes (cone / line): drag sets orientation; size from drag
// distance, or from the armed size when armed.
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
        await addSharedTemplate(hexes, { color, name });
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
  await OBR.tool.create({
    id: TOOL,
    icons: [{ icon: "/lancer-uplink/icons/tool.svg", label: "LANCER Templates" }],
    defaultMode: MODES.move,
  });

  await OBR.tool.createMode(circleMode("move", "/lancer-uplink/icons/move.svg"));
  await OBR.tool.createMode(circleMode("tech", "/lancer-uplink/icons/tech.svg"));
  await OBR.tool.createMode(circleMode("blast", "/lancer-uplink/icons/blast.svg"));
  await OBR.tool.createMode(directionalMode("cone", "/lancer-uplink/icons/cone.svg", hexCone));
  await OBR.tool.createMode(directionalMode("line", "/lancer-uplink/icons/line.svg", hexLine));

  const filter = { activeTools: [TOOL] };

  await OBR.tool.createMode({
    id: MODES.terrain,
    icons: [{ icon: "/lancer-uplink/icons/terrain.svg", label: "Difficult Terrain", filter }],
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
    icons: [{ icon: "/lancer-uplink/icons/erase.svg", label: "Erase", filter }],
    cursors: [{ cursor: "not-allowed" }],
    async onToolClick(_ctx, ev) {
      const h = pixelToHex(ev.pointerPosition);
      const set = await getTerrainSet();
      const key = `${h.q},${h.r}`;
      if (set.has(key)) {
        await removeTerrainHex(h);
        const next = await getTerrainSet();
        await renderTerrain([...next], keyToHex);
        return;
      }
      const me = await OBR.player.getId();
      const items = await OBR.scene.items.getItems(
        (i) => i.metadata?.[META]?.kind === "template" && i.createdUserId === me
      );
      const p = ev.pointerPosition;
      const hit = items.filter((i) =>
        (i.commands || []).some((c) => c[0] === 0 && Math.hypot(c[1] - p.x, c[2] - p.y) < 200)
      );
      if (hit.length) {
        await OBR.scene.items.deleteItems([hit[0].id]);
      }
    },
  });
}

export { CIRCLE_SHAPES };
