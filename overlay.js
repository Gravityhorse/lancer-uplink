// overlay.js — builds and manages shared LANCER template and terrain overlays.

import { OBR, buildPath, ID, META } from "./sdk.js";
import { hexCorners, hexKey } from "./hex.js";

const TERRAIN_KEY = `${ID}/terrain`;
const TERRAIN_ITEM_ID = `${ID}/terrain-overlay`;

function hexToPathCommands(hexes) {
  const commands = [];

  for (const h of hexes) {
    const corners = hexCorners(h);

    if (!corners.length) continue;

    commands.push([0, corners[0].x, corners[0].y]);

    for (let i = 1; i < corners.length; i++) {
      commands.push([1, corners[i].x, corners[i].y]);
    }

    commands.push([2]);
  }

  return commands;
}

export function buildHexOverlay(
  hexes,
  {
    color = "#d22f3d",
    fillOpacity = 0.22,
    strokeOpacity = 0.85,
    strokeWidth = 2,
    name = "LANCER Template",
    kind = "template",
  } = {}
) {
  const commands = hexToPathCommands(hexes);

  return buildPath()
    .id(`${ID}/${kind}/${crypto.randomUUID()}`)
    .name(name)
    .layer("DRAWING")
    .commands(commands)
    .fillColor(color)
    .fillOpacity(fillOpacity)
    .strokeColor(color)
    .strokeOpacity(strokeOpacity)
    .strokeWidth(strokeWidth)
    .metadata({
      [META]: {
        kind,
        source: ID,
      },
    })
    .build();
}

export async function addSharedTemplate(hexes, options = {}) {
  const item = buildHexOverlay(hexes, {
    ...options,
    kind: "template",
  });

  await OBR.scene.items.addItems([item]);

  return item;
}

export async function getTerrainSet() {
  const metadata = await OBR.scene.getMetadata();
  const values = metadata?.[TERRAIN_KEY];

  if (Array.isArray(values)) {
    return new Set(values);
  }

  return new Set();
}

async function saveTerrainSet(set) {
  await OBR.scene.setMetadata({
    [TERRAIN_KEY]: [...set],
  });
}

export async function toggleTerrainHex(hex) {
  const set = await getTerrainSet();
  const key = hexKey(hex);

  if (set.has(key)) {
    set.delete(key);
  } else {
    set.add(key);
  }

  await saveTerrainSet(set);

  return set;
}

export async function removeTerrainHex(hex) {
  const set = await getTerrainSet();
  const key = hexKey(hex);

  set.delete(key);

  await saveTerrainSet(set);

  return set;
}

export async function renderTerrain(keys, keyToHex) {
  try {
    await OBR.scene.items.deleteItems([TERRAIN_ITEM_ID]);
  } catch (_) {
    // Ignore if the terrain overlay does not exist yet.
  }

  const hexes = keys.map(keyToHex);

  if (!hexes.length) return null;

  const item = buildHexOverlay(hexes, {
    color: "#7a5cff",
    fillOpacity: 0.2,
    strokeOpacity: 0.75,
    strokeWidth: 2,
    name: "Difficult Terrain",
    kind: "terrain",
  });

  item.id = TERRAIN_ITEM_ID;

  await OBR.scene.items.addItems([item]);

  return item;
}
