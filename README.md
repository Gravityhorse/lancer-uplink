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
