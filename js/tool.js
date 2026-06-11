// tool.js — registers a "LANCER Templates" tool in Owlbear's toolbar with five
// modes: Blast (click), Cone (drag to aim), Line (drag to aim), Difficult
// Terrain paint (click/drag), and Erase. Sizes/colors come from the panel.

import { OBR, ID } from "./sdk.js";
import { pixelToHex, hexesInRange, hexCone, hexLine, snapAngle, keyToHex, hexToPixel } from "./hex.js";
import {
  buildHexOverlay, addSharedTemplate, getTerrainSet, toggleTerrainHex,
  removeTerrainHex, renderTerrain,
} from "./overlay.js";
import { META } from "./sdk.js";

const TOOL = `${ID}/tool`;
const MODES = {
  blast: `${ID}/mode-blast`,
  cone: `${ID}/mode-cone`,
  line: `${ID}/mode-line`,
  terrain: `${ID}/mode-terrain`,
  erase: `${ID}/mode-erase`,
};

// Panel-controlled config (lives in this module; the action panel stays loaded).
export const templateConfig = { size: 3, color: "#d22f3d" };

let previewIds = [];
async function setPreview(hexes, color) {
  await clearPreview();
  if (!hexes.length) return;
  const item = buildHexOverlay(hexes, {
    color, fillOpacity: 0.18, strokeOpacity: 0.6, strokeWidth: 2,
    name: "Template preview", kind: "preview",
  });
  await OBR.scene.local.addItems([item]);
  previewIds = [item.id];
}
async function clearPreview() {
  if (previewIds.length) {
    try { await OBR.scene.local.deleteItems(previewIds); } catch (_) {}
    previewIds = [];
  }
}

let dragOrigin = null;

export async function registerTool() {
  await OBR.tool.create({
    id: TOOL,
    icons: [{ icon: "/icons/tool.svg", label: "LANCER Templates" }],
    defaultMode: MODES.blast,
  });

  const filter = { activeTools: [TOOL] };

  await OBR.tool.createMode({
    id: MODES.blast,
    icons: [{ icon: "/icons/blast.svg", label: "Blast (click to place)", filter }],
    cursors: [{ cursor: "crosshair" }],
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
      await setPreview(hexesInRange(h, templateConfig.size, true), templateConfig.color);
    },
    onDeactivate: clearPreview,
  });

  const directional = (kind) => ({
    id: MODES[kind],
    icons: [{ icon: `/icons/${kind}.svg`, label: `${kind === "cone" ? "Cone" : "Line"} (drag to aim)`, filter }],
    cursors: [{ cursor: "crosshair" }],
    async onToolDragStart(_ctx, ev) {
      dragOrigin = pixelToHex(ev.pointerPosition);
    },
    async onToolDragMove(_ctx, ev) {
      if (!dragOrigin) return;
      const o = hexToPixel(dragOrigin);
      const rad = snapAngle(Math.atan2(ev.pointerPosition.y - o.y, ev.pointerPosition.x - o.x));
      const hexes = kind === "cone"
        ? hexCone(dragOrigin, rad, templateConfig.size)
        : hexLine(dragOrigin, rad, templateConfig.size);
      await setPreview(hexes, templateConfig.color);
    },
    async onToolDragEnd(_ctx, ev) {
      if (!dragOrigin) return;
      const o = hexToPixel(dragOrigin);
      const rad = snapAngle(Math.atan2(ev.pointerPosition.y - o.y, ev.pointerPosition.x - o.x));
      const hexes = kind === "cone"
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
    onToolDragCancel() { dragOrigin = null; return clearPreview(); },
    onDeactivate: clearPreview,
  });

  await OBR.tool.createMode(directional("cone"));
  await OBR.tool.createMode(directional("line"));

  await OBR.tool.createMode({
    id: MODES.terrain,
    icons: [{ icon: "/icons/terrain.svg", label: "Difficult terrain (click hexes)", filter }],
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
    icons: [{ icon: "/icons/erase.svg", label: "Erase template / terrain", filter }],
    cursors: [{ cursor: "not-allowed" }],
    async onToolClick(_ctx, ev) {
      const h = pixelToHex(ev.pointerPosition);
      // Terrain first…
      const set = await getTerrainSet();
      const key = `${h.q},${h.r}`;
      if (set.has(key)) {
        await removeTerrainHex(h);
        const next = await getTerrainSet();
        await renderTerrain([...next], keyToHex);
        return;
      }
      // …then any of OUR templates under the pointer.
      const me = await OBR.player.getId();
      const items = await OBR.scene.items.getItems(
        (i) => i.metadata?.[META]?.kind === "template" && i.createdUserId === me
      );
      const p = ev.pointerPosition;
      const hit = items.filter((i) => {
        // cheap test: any MOVE command vertex within ~1.5 hexes of the click
        return (i.commands || []).some((c) =>
          c[0] === 0 && Math.hypot(c[1] - p.x, c[2] - p.y) < 200
        );
      });
      if (hit.length) await OBR.scene.items.deleteItems([hit[0].id]);
    },
  });
}
