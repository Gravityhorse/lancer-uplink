// tool.js — registers a LANCER Templates tool in Owlbear's toolbar.

import { OBR, ID, META } from "./sdk.js?v=10";
import {
  pixelToHex,
  hexesInRange,
  hexCone,
  hexLine,
  snapAngle,
  keyToHex,
  hexToPixel,
} from "./hex.js?v=10";
import {
  buildHexOverlay,
  addSharedTemplate,
  getTerrainSet,
  toggleTerrainHex,
  removeTerrainHex,
  renderTerrain,
} from "./overlay.js?v=10";

const TOOL = `${ID}/tool`;

const MODES = {
  blast: `${ID}/mode-blast`,
  cone: `${ID}/mode-cone`,
  line: `${ID}/mode-line`,
  terrain: `${ID}/mode-terrain`,
  erase: `${ID}/mode-erase`,
};

export const templateConfig = {
  size: 3,
  color: "#d22f3d",
};

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
  } catch (_) {
    // Ignore preview cleanup failures.
  }

  previewIds = [];
}

let dragOrigin = null;

export async function registerTool() {
  await OBR.tool.create({
    id: TOOL,
    icons: [
      {
        icon: "/lancer-uplink/icons/tool.svg",
        label: "LANCER Templates",
      },
    ],
    defaultMode: MODES.blast,
  });

  const filter = {
    activeTools: [TOOL],
  };

  await OBR.tool.createMode({
    id: MODES.blast,
    icons: [
      {
        icon: "/lancer-uplink/icons/blast.svg",
        label: "Blast",
        filter,
      },
    ],
    cursors: [
      {
        cursor: "crosshair",
      },
    ],
    async onToolClick(_ctx, ev) {
      const h = pixelToHex(ev.pointerPosition);
      const hexes = hexesInRange(h, templateConfig.size, true);

      await addSharedTemplate(hexes, {
        color: templateConfig.color,
        name: `Blast ${templateConfig.size}`,
      });
    },
    async onToolMove(_ctx, ev) {
      const h = pixelToHex(ev.pointerPosition);
      const hexes = hexesInRange(h, templateConfig.size, true);

      await setPreview(hexes, templateConfig.color);
    },
    onDeactivate: clearPreview,
  });

  const directional = (kind) => ({
    id: MODES[kind],
    icons: [
      {
        icon: `/lancer-uplink/icons/${kind}.svg`,
        label: kind === "cone" ? "Cone" : "Line",
        filter,
      },
    ],
    cursors: [
      {
        cursor: "crosshair",
      },
    ],
    async onToolDragStart(_ctx, ev) {
      dragOrigin = pixelToHex(ev.pointerPosition);
    },
    async onToolDragMove(_ctx, ev) {
      if (!dragOrigin) return;

      const o = hexToPixel(dragOrigin);
      const rad = snapAngle(
        Math.atan2(
          ev.pointerPosition.y - o.y,
          ev.pointerPosition.x - o.x
        )
      );

      const hexes =
        kind === "cone"
          ? hexCone(dragOrigin, rad, templateConfig.size)
          : hexLine(dragOrigin, rad, templateConfig.size);

      await setPreview(hexes, templateConfig.color);
    },
    async onToolDragEnd(_ctx, ev) {
      if (!dragOrigin) return;

      const o = hexToPixel(dragOrigin);
      const rad = snapAngle(
        Math.atan2(
          ev.pointerPosition.y - o.y,
          ev.pointerPosition.x - o.x
        )
      );

      const hexes =
        kind === "cone"
          ? hexCone(dragOrigin, rad, templateConfig.size)
          : hexLine(dragOrigin, rad, templateConfig.size);

      await clearPreview();

      if (hexes.length) {
        await addSharedTemplate(hexes, {
          color: templateConfig.color,
          name: `${kind === "cone" ? "Cone" : "Line"} ${templateConfig.size}`,
        });
      }

      dragOrigin = null;
    },
    onToolDragCancel() {
      dragOrigin = null;
      return clearPreview();
    },
    onDeactivate: clearPreview,
  });

  await OBR.tool.createMode(directional("cone"));
  await OBR.tool.createMode(directional("line"));

  await OBR.tool.createMode({
    id: MODES.terrain,
    icons: [
      {
        icon: "/lancer-uplink/icons/terrain.svg",
        label: "Difficult Terrain",
        filter,
      },
    ],
    cursors: [
      {
        cursor: "cell",
      },
    ],
    async onToolClick(_ctx, ev) {
      const h = pixelToHex(ev.pointerPosition);

      await toggleTerrainHex(h);

      const set = await getTerrainSet();
      await renderTerrain([...set], keyToHex);
    },
  });

  await OBR.tool.createMode({
    id: MODES.erase,
    icons: [
      {
        icon: "/lancer-uplink/icons/erase.svg",
        label: "Erase",
        filter,
      },
    ],
    cursors: [
      {
        cursor: "not-allowed",
      },
    ],
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
        (i) =>
          i.metadata?.[META]?.kind === "template" &&
          i.createdUserId === me
      );

      const p = ev.pointerPosition;

      const hit = items.filter((i) => {
        return (i.commands || []).some(
          (c) =>
            c[0] === 0 &&
            Math.hypot(c[1] - p.x, c[2] - p.y) < 200
        );
      });

      if (hit.length) {
        await OBR.scene.items.deleteItems([hit[0].id]);
      }
    },
  });
}
