# LANCER // UPLINK — Roadmap & QoL Ideas

Things that would make this tool genuinely great, roughly ordered by
bang-for-buck.

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
