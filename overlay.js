// overlay.js — turns sets of hexes into Owlbear path items.
// Private range overlays (your MOVE / SENSORS / weapon ranges) are local items:
// only you see them, no scene spam. Templates (blast/cone/line) and difficult
// terrain are shared items everyone sees.

import { OBR, buildPath, Command, META } from "./sdk.js";
import { hexCorners, hexKey, hexesInRange, hexDistance } from "./hex.js";

const CMD = {
  MOVE: Command?.MOVE ?? 0,
  LINE: Command?.LINE ?? 1,
  CLOSE: Command?.CLOSE ?? 4,
};

// One subpath per cell; even-odd fill keeps shared edges crisp.
// (Cells have 6 corners on hex grids, 4 on square grids.)
export function hexSetCommands(hexes) {
  const cmds = [];
  for (const h of hexes) {
    const pts = hexCorners(h);
    cmds.push([CMD.MOVE, pts[0].x, pts[0].y]);
    for (let i = 1; i < pts.length; i++) cmds.push([CMD.LINE, pts[i].x, pts[i].y]);
    cmds.push([CMD.CLOSE]);
  }
  return cmds;
}

export function buildHexOverlay(hexes, opts) {
  const {
    color = "#d22f3d",
    fillOpacity = 0.28,
    strokeOpacity = 0.85,
    strokeWidth = 3,
    name = "LANCER overlay",
    kind = "overlay",
    extra = {},
    layer = "DRAWING",
    draggable = false, // offset-drag mode: fields become grabbable
  } = opts || {};
  return buildPath()
    .position({ x: 0, y: 0 })
    .commands(hexSetCommands(hexes))
    .fillColor(color)
    .fillOpacity(fillOpacity)
    .strokeColor(color)
    .strokeOpacity(strokeOpacity)
    .strokeWidth(strokeWidth)
    .fillRule("evenodd")
    .layer(layer)
    .locked(!draggable)
    .disableHit(!draggable)
    .name(name)
    .metadata({ [META]: { kind, ...extra } })
    .build();
}

// ---- private (local) range overlays ----------------------------------------

const localIds = new Map(); // overlay slot -> [itemIds]

export async function showLocalOverlay(slot, hexes, opts) {
  await clearLocalOverlay(slot);
  if (!hexes.length) return;
  const item = buildHexOverlay(hexes, opts);
  await OBR.scene.local.addItems([item]);
  localIds.set(slot, [item.id]);
}

export async function clearLocalOverlay(slot) {
  const ids = localIds.get(slot);
  if (ids?.length) {
    try { await OBR.scene.local.deleteItems(ids); } catch (_) {}
  }
  localIds.delete(slot);
}

export async function clearAllLocalOverlays() {
  for (const slot of [...localIds.keys()]) await clearLocalOverlay(slot);
}

export function activeLocalSlots() {
  return [...localIds.keys()];
}

export function hasLocalOverlay(slot) {
  return localIds.has(slot);
}

// ---- boost field: double-radius movement with a visible inner boundary -------
// Inner ring (0..n) = standard move, strongly drawn. Outer ring (n+1..2n) =
// boost-only ground, fainter. Both are local — only you see them.

export async function showBoostField(slotBase, center, n, opts = {}) {
  const color = opts.color || "#5ad17a";
  const name = opts.name || `Boost ${n}`;
  const inner = hexesInRange(center, n, true);
  const outer = hexesInRange(center, 2 * n, true).filter((h) => hexDistance(center, h) > n);
  await showLocalOverlay(`${slotBase}-in`, inner, {
    color, name: `${name} — move`, kind: "range",
    fillOpacity: 0.24, strokeOpacity: 0.95, strokeWidth: 5,
    draggable: !!opts.draggable,
  });
  await showLocalOverlay(`${slotBase}-out`, outer, {
    color, name: `${name} — boost`, kind: "range",
    fillOpacity: 0.10, strokeOpacity: 0.45, strokeWidth: 2,
    draggable: !!opts.draggable,
  });
}

export async function clearBoostField(slotBase) {
  await clearLocalOverlay(`${slotBase}-in`);
  await clearLocalOverlay(`${slotBase}-out`);
}

// ---- private (local) templates ----------------------------------------------
// Weapon templates placed in "only me" mode. Tracked so erase / clear work.

let localTmplSeq = 0;

// Templates live on the PROP layer — ABOVE range fields (DRAWING layer) — so
// dropping a blast never visually buries your movement/sensor field, and the
// eraser can hit templates without touching ranges.
export async function addLocalTemplate(hexes, opts) {
  const slot = `tmpl-${++localTmplSeq}`;
  await showLocalOverlay(slot, hexes, { ...opts, kind: "template-local", layer: "PROP" });
  return slot;
}

// Erase the most recently placed local template whose first vertex is near p.
export async function eraseLocalTemplateAt(p) {
  try {
    const items = await OBR.scene.local.getItems(
      (i) => i.metadata?.[META]?.kind === "template-local"
    );
    const hit = items.find((i) =>
      (i.commands || []).some((c) => c[0] === 0 && Math.hypot(c[1] - p.x, c[2] - p.y) < 200)
    );
    if (!hit) return false;
    await OBR.scene.local.deleteItems([hit.id]);
    for (const [slot, ids] of localIds) {
      if (ids.includes(hit.id)) { localIds.delete(slot); break; }
    }
    return true;
  } catch (_) {
    return false;
  }
}

export async function clearLocalTemplates() {
  try {
    const items = await OBR.scene.local.getItems(
      (i) => i.metadata?.[META]?.kind === "template-local"
    );
    if (items.length) await OBR.scene.local.deleteItems(items.map((i) => i.id));
  } catch (_) {}
  for (const [slot, ids] of [...localIds]) {
    if (slot.startsWith("tmpl-")) localIds.delete(slot);
  }
}

// ---- shared templates -------------------------------------------------------

export async function addSharedTemplate(hexes, opts) {
  const item = buildHexOverlay(hexes, { ...opts, kind: "template", layer: "PROP" });
  await OBR.scene.items.addItems([item]);
  return item.id;
}

export async function clearMyTemplates() {
  const me = await OBR.player.getId();
  const items = await OBR.scene.items.getItems(
    (i) => i.metadata?.[META]?.kind === "template" && i.createdUserId === me
  );
  if (items.length) await OBR.scene.items.deleteItems(items.map((i) => i.id));
}

export async function clearAllTemplates() {
  const items = await OBR.scene.items.getItems((i) => i.metadata?.[META]?.kind === "template");
  if (items.length) await OBR.scene.items.deleteItems(items.map((i) => i.id));
}

// ---- difficult terrain (one shared item rebuilt from scene metadata) -------

const TERRAIN_KEY = `${META}/terrain`;

export async function getTerrainSet() {
  const md = await OBR.scene.getMetadata();
  return new Set(md[TERRAIN_KEY] || []);
}

export async function toggleTerrainHex(h) {
  const set = await getTerrainSet();
  const k = hexKey(h);
  set.has(k) ? set.delete(k) : set.add(k);
  await OBR.scene.setMetadata({ [TERRAIN_KEY]: [...set] });
}

export async function removeTerrainHex(h) {
  const set = await getTerrainSet();
  if (set.delete(hexKey(h))) {
    await OBR.scene.setMetadata({ [TERRAIN_KEY]: [...set] });
  }
}

export async function clearTerrain() {
  await OBR.scene.setMetadata({ [TERRAIN_KEY]: [] });
}

// Rebuilds the single shared terrain item whenever metadata changes.
export async function renderTerrain(keys, keyToHexFn) {
  const existing = await OBR.scene.items.getItems(
    (i) => i.metadata?.[META]?.kind === "terrain"
  );
  if (existing.length) await OBR.scene.items.deleteItems(existing.map((i) => i.id));
  if (!keys.length) return;
  const hexes = keys.map(keyToHexFn);
  const item = buildHexOverlay(hexes, {
    color: "#ffb454",
    fillOpacity: 0.22,
    strokeOpacity: 0.7,
    strokeWidth: 2,
    name: "Difficult terrain",
    kind: "terrain",
  });
  await OBR.scene.items.addItems([item]);
}
