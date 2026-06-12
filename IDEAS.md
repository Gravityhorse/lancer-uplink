# LANCER // UPLINK — Roadmap & QoL Ideas

Things that would make this tool genuinely great, roughly ordered by
bang-for-buck.

## Shipped in 2.5.0 ✓

- ✓ Overshield removed from the COMP/CON view (still in the stat grid)
- ✓ Free tray rolls show just the number; result card border is tray-blue
- ✓ d6s show a clean 6 (underline only on dice that also have a 9)
- ✓ Grid offset updates LIVE on active fields, with stepper/slider toggle
- ✓ Templates render above range fields (PROP layer); the eraser can no
  longer delete range fields by accident

## Shipped in 2.4.0 ✓

- ✓ Cone restored to the solid filled triangle (the "symmetric rows" version
  left a hole in the middle — interlocking wedge fill is the right shape)
- ✓ Camera re-frames on every throw and dice land on-camera (no more staring
  at empty floor on re-rolls)
- ✓ Dice are numbers again (sigils retired); tick rings and HUD flicker removed
- ✓ MISSION//CONTROL keeps DICE and MAP — only PILOT swaps to LANCERS telemetry
- ✓ Grid offset X/Y nudge steppers (⅛-tile steps, persisted) for fine alignment
- ✓ O.SHLD sits on the STRUCT/STRESS row — nothing wraps

## Shipped in 2.3.0 ✓

- ✓ Grid calibration actually works (the SDK's grid API lives at
  `OBR.scene.grid`, not `OBR.grid` — every probe was silently throwing,
  which caused both the snap offset and the FIT TO SCENE failure)
- ✓ Cone rows are now symmetric rulebook triangles (pair-group selection)
- ✓ Faction sigil replaces the 20 on d20s; engraved frames on every face;
  saturation boosted
- ✓ Camera stays in the staging close-up through the throw, then zooms the result
- ✓ Tray dressed up: hex-etched glowing deck, counter-rotating landing-pad
  tick rings, drifting dust motes, pulsing field walls, flickering holo HUD strip
- ✓ NAT 1 label removed (the NHP's commentary stands alone)

## Shipped in 2.2.0 ✓

- ✓ RAW cone math (width = distance: 1/2/3…) on hex and square grids
- ✓ Manual CRIT toggle in the dice tray (doubles dice, keep highest per pair)
- ✓ Lancer-correct crits: any attack total 20+ (no special nat 20s)
- ✓ NHP commentary on natural 1s
- ✓ MOVE button cycles move → move+boost → off; weapon ◈ shows a red range field
- ✓ Grid calibration controls: pointy/flat/square select, tile-size slider, FIT TO SCENE
- ✓ Template preview/erase race conditions fixed (no more ghost blasts)
- ✓ Holographic tray walls, glossier dice, close-up staging camera
- ✓ Superheavy = Barrage (full action) with overrides for Autopod & friends

## Shipped in 2.1.0 ✓

- ✓ Token bond (with follow-on-move)
- ✓ Pilot + reactor state persisted in localStorage
- ✓ Heat auto-apply button on Overkill rolls
- ✓ Crit damage helper (FIRE doubles dice, keeps highest per pair)
- ✓ Auto structure / overheat table macro (toggle in MAP → HOUSE RULES)
- ✓ Square grid support (manual toggle + auto-detect)
- ✓ MISSION//CONTROL GM squad telemetry view
- ✓ Talents, core power, weapon + invade hover tooltips
- ✓ Personalizations +2 HP

## High value, low effort

- **Loading / Ordnance tracking.** Grey out a Loading weapon's ATK/FIRE
  buttons after it fires until a Reload action is clicked.
- **More system-granted stat bonuses** (the Personalizations hook generalises:
  scan `lancer-data` bonuses arrays instead of special-casing IDs).
- **GM click-to-ping**: in MISSION//CONTROL, click a lancer to flash their
  bonded token on the map.

## Dice & rolls

- **Roll history sync.** Late joiners see the last N rolls (store the log in
  scene metadata, not just broadcasts).
- **Per-player dice schemes** broadcast with the replay, so HORUS players'
  dice glitch on *everyone's* screen.
- **Reserve / smart-ammo prompts**: tick-boxes on the attack context bar for
  common +1 accuracy sources (Lock On consumes itself after the roll).
- **Structure / Overheat macro buttons** that roll the right number of d6 and
  read the table result out loud in the log.
- **Sound effects** (toggleable): dice clatter, a klaxon on NAT 1, a
  satisfying *thunk* on FIRE.

## Map & templates

- **Threat/engagement rings** around the bonded token that follow it.
- **Line-of-sight ruler** that counts hexes through the terrain layer and
  flags soft/hard cover.
- **Difficult-terrain-aware movement preview**: the green field could cost 2
  per marked hex instead of 1.
- **Template library per weapon profile** — multi-profile weapons (e.g.
  swappable ammo) currently use the first profile only.
- **Square-grid support** for tables that don't use hexes.

## Sheet & sync

- **Write HP/Heat to token metadata** so the GM (and other extensions, e.g.
  health bars) can see everyone's reactor status live.
- **Conditions tracker** (Impaired, Jammed, Lock On, Exposed…) with icons that
  also stamp the bonded token.
- **NPC mode for the GM**: paste a stat block / pick an NPC class and get the
  same weapon buttons without a COMP/CON file.
- **Pilot-scale sheet** (HP, armor, pilot weapons) for on-foot scenes.
- **Talent / core power quick-reference** tab pulled from `lancer-data`.

## Polish

- **Settings drawer** (house-rule toggles: Overkill RAW vs explode, grit on
  damage on/off, auto-FIRE delay).
- **Collapsible-state memory** — remember which sections you keep closed.
- **Keyboard shortcuts**: R to roll, C to clear, 1–6 to queue dice.
- **A proper cascade easter egg.** The NHP CASCADE button from the prototype
  deserves to come back and do something appropriately unsettling.
