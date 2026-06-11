# LANCER // UPLINK

A utility extension for [Owlbear Rodeo](https://www.owlbear.rodeo/) that brings
[LANCER](https://massifpress.com/lancer) tooling to the virtual tabletop. Import
a pilot straight out of [COMP/CON](https://compcon.app/), read the resolved mech
sheet, roll Lancer's dice, and drop blast/cone/line templates and difficult
terrain onto a hex map.

## Install

Add this manifest URL as a custom extension in Owlbear Rodeo
(**Profile → Extensions → Add Custom Extension**):

```
https://gravityhorse.github.io/lancer-uplink/manifest.json
```

Open the **Lancer Uplink** action panel from the right-hand toolbar.

## Features

**Pilot import.** Export a pilot from COMP/CON (*Pilot Roster → Export → Download
pilot as JSON*) and upload the `.json` file in the **Pilot** tab. Uplink resolves
the loadout against Massif Press's open [`lancer-data`](https://github.com/massif-press/lancer-data)
compendium and renders a full mech sheet — derived HP / Heat / Save / Evasion and
the rest computed from the frame plus the pilot's HASE and Grit — with all mounted
weapons (range, damage, tags) and installed systems.

**Dice.** A Lancer-correct roller in the **Dice** tab. Accuracy/Difficulty cancel
1:1 and apply only the single highest die; Overkill rerolls/explodes 1s and tracks
Heat. Each weapon on the mech sheet has one-click **Atk** / **Dmg** buttons. Rolls
are broadcast to everyone else at the table.

**Templates.** The **LANCER Templates** tool in Owlbear's left toolbar places
Blast (click), Cone and Line (drag to aim) templates, paints difficult terrain,
and erases them. Size and colour are set in the **Templates** tab. The hex math
self-calibrates against the live Owlbear grid.

## Project layout

| File | Role |
| --- | --- |
| `manifest.json` | Owlbear extension manifest (action popover -> `index.html`). |
| `index.html` / `main.js` | Popover UI and the wiring that ties every module together. |
| `compcon.js` | COMP/CON pilot parsing + `lancer-data` lookups + derived mech stats. |
| `dice.js` | Lancer attack/damage dice (Accuracy/Difficulty, Overkill). |
| `tool.js` | Registers the template tool and its five modes. |
| `hex.js` | Cube-coordinate hex math, calibrated to the live grid. |
| `overlay.js` | Builds shared template / terrain / local range path items. |
| `sdk.js` | Single import point for the Owlbear Rodeo SDK + shared constants. |

No build step — everything is plain ES modules served straight from GitHub Pages,
with the Owlbear SDK and `lancer-data` pulled from a CDN.

## Credits

LANCER is © Massif Press. `lancer-data` and COMP/CON are open projects by Massif
Press. This is an unofficial fan tool.
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
