# LANCER // UPLINK — v2.8.3

A utility extension for [Owlbear Rodeo](https://www.owlbear.rodeo/) that brings
[LANCER](https://massifpress.com/lancer) tooling to the virtual tabletop. Import
a pilot straight out of [COMP/CON](https://compcon.app/), run attacks through a
3D dice tray the whole table can watch, and drop hex-snapped blast/cone/line
templates and range fields onto the map.

## Install

Add this manifest URL as a custom extension in Owlbear Rodeo
(**Profile → Extensions → Add Custom Extension**):

```
https://gravityhorse.github.io/lancer-uplink/manifest.json
```

Open the **Lancer Uplink** action panel from the right-hand toolbar.

## Features

**Pilot import.** Export a pilot from COMP/CON (*Pilot Roster → Export →
Download pilot as JSON*) and upload it in the **PILOT** tab. Uplink resolves the
loadout against Massif Press's open [`lancer-data`](https://github.com/massif-press/lancer-data)
compendium and renders a full mech sheet — a COMP/CON-style view with slanted
HP/Heat/Repair segment bars (toggleable to a plain stat grid), MOVE / BOOST /
SENSORS / TECH ATK shortcuts up top, every mounted weapon, and hover tooltips
for installed systems (action type + SP cost in the header, effect in the body).

**One unified dice system.** Everything rolls through the 3D tray in the
**DICE** tab. Queued dice hover and shake over the tray until you hit ROLL;
when they settle the camera zooms in and the total pops up in a rounded panel
in the top-left. Flat modifier and an Overkill toggle (1s explode into bonus
dice, +1 Heat each) are built into the tray. Accuracy/Difficulty cancel 1:1 and
only the single highest d6 applies — the Lancer way. Faction colour schemes
(Union, SSC, HORUS, Harrison Armory, IPS-N) skin the dice with a circuit-board
texture; numbers are always white. Accuracy dice are white with gold numbers,
Difficulty dice black-purple with white.

**Weapon flows.** Each weapon has **ATK** (d20 + grit, preloaded), **DMG**
(its damage dice + Overkill if tagged), **⬢** target-lock — roll accuracy
first, then a big red **FIRE** button chains straight into the damage roll —
and **◈** to arm its template at the right size. Tech attacks get their own
blue flow with the mech's tech attack bonus.

**Table broadcast.** Unless a roll is toggled **HIDDEN**, everyone else with
the panel open sees your physical dice tumble in their own tray (landing on
your real numbers), the result panel for a few seconds, a combat-log entry,
and an Owlbear notification.

**Templates.** The bar under the tabs (and the **LANCER** tool in Owlbear's
toolbar) places Blast / Cone / Line templates: click-drag — the press point is
the origin, drag out to size and aim, everything snaps to the hex grid. The 👁
toggle controls whether weapon templates are visible to **ALL** players or just
**ME**. MOVE and SENSORS fields (green / blue) are always private to you.
Difficult-terrain painting and an eraser are included.

## Project layout

| File | Role |
| --- | --- |
| `manifest.json` | Owlbear extension manifest (action popover → `index.html`). |
| `index.html` / `main.js` | Popover UI and the wiring that ties every module together. |
| `compcon.js` | COMP/CON pilot parsing + `lancer-data` lookups + derived mech stats. |
| `dice.js` | Pure Lancer dice math (Accuracy/Difficulty, Overkill) — no 3D. |
| `dice3d.js` | The 3D physics dice tray (three.js + cannon-es), replays, camera. |
| `tool.js` | Registers the template tool and its modes; visibility rules. |
| `hex.js` | Cube-coordinate hex math, calibrated to the live grid. |
| `overlay.js` | Shared template / terrain / private range-field path items. |
| `sdk.js` | Single import point for the Owlbear Rodeo SDK + shared constants. |

No build step — everything is plain ES modules served straight from GitHub
Pages, with the Owlbear SDK, three.js, cannon-es and `lancer-data` pulled from
a CDN.

See [IDEAS.md](IDEAS.md) for the QoL roadmap.

## Credits

LANCER is © Massif Press. `lancer-data` and COMP/CON are open projects by
Massif Press. This is an unofficial fan tool.
