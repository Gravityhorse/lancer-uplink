# LANCER // UPLINK — Roadmap & QoL Ideas

Things that would make this tool genuinely great, roughly ordered by
bang-for-buck.

## Shipped in 2.8.3 ✓

- ✓ **Overkill fixed to RAW**: a damage die showing 1 is REROLLED (replaced),
  +1 Heat per reroll, chaining indefinitely — it no longer keeps the 1
- ✓ **Combat Drill exception**: still rerolls the original 1 but ALSO spawns a
  bonus die each trigger (one 1 → two dice, up to four on snake-eyes), detected
  automatically from the weapon
- ✓ Crit label trimmed to "⚡ CRIT"; FIRE button drops "(CRIT)" (gold glow tell)
- ✓ Target Lock respects the CRIT and OVERKILL toggles — a crit confirmed any
  way rolls crit damage even if accuracy totalled < 20
- ✓ ATK + Target Lock are ONE button (solid red `ATK ⬢` / blue `TECH ATK ⬢`),
  sized to match the ◈ range/sensors button beside it
- ✓ **HASE fix**: Systems now adds E-Defense (was missing); Agility→Evasion,
  Systems→Tech Attack etc. all verified against the rules
- ✓ **Core Bonus modifiers** apply (Full Subjectivity Sync +2 Evasion, Fomorian
  +1 Size…) via a generic `bonuses[]` scan — same hook generalises system
  bonuses, so Personalizations +2 HP is no longer special-cased
- ✓ **TECHS tab** (was TECH ATTACK): Tech Attack + Invade + Quick Tech + Full
  Tech sub-groups, ported straight from installed systems & talents. Invade and
  the other chips are reference-only (hover/click pins the header — no rolling)
- ✓ **CORE tab** (HORUS green): the frame's core power + every core bonus with
  mechanical effects; SYSTEMS tab is now Harrison-Armory purple (no twin reds)
- ✓ Systems show flavour text; the same item under TECHS shows the mechanics
- ✓ Cone marks its origin tile and Blast marks its centre, like Line
- ✓ NHP nat-1 lines reworked + five new ones; a glitch effect on "Trust me.";
  multi-line quips centre cleanly (arrow lines on their own rows)
- ✓ Mission Control: every NPC stat (incl. E-DEF / SPD / ARMOR) is now an inline
  −/+ stepper right on the card
- ✓ Remote rolls play in a **dedicated right-side popup tray** — never touch
  your dice, queue with readable timing, result stays dim until the dice land
- ✓ Dice are deeper & glossier: PMREM environment reflections, thicker
  clearcoat, jewel-deepened colours (stone & crystal)
- ✓ IPS-Northstar is the default scheme (top of the list, Union at the bottom)
- ✓ Themed dark scrollbars; pinned tooltips are hand-scrollable
- ✓ FORGET SAVED PILOT actually clears the loaded sheet
- ✓ "Iconoclast" (and any id-derived talent) title-cased
- ✓ Grid: flat-top default, orientation trusts Owlbear's grid type, FIT TO
  SCENE re-anchors on the bonded token; grid-type labels simplified
- ✓ A+/A− re-pin the clicked button so repeat clicks land on the same spot
- ✓ Trimmed the four instructional blurbs (Range Fields / Token Bond /
  Templates / Invade)

## Shipped in 2.8.5 ✓

- ✓ **Heat now cascades**: adding heat past Heat Capacity carries the overflow
  into the next Stress level(s) — a big spike can blow through several at once
  (unit-tested)
- ✓ **Core-bonus weapon range mods** apply: Gyges +1 Threat to melee, Neurolink
  Targeting +3 Range to ranged, External Batteries, etc. — affects the sheet and
  the placed template's size; only boosts a range a weapon actually has
- ✓ Dice picker pre-loads IPS-N blue (no more Union-red flash on startup)
- ✓ Tray side walls pulled in and throw spread tightened so dice stop rolling
  off-camera; scales cleanly on resize
- ✓ TECHS action glyphs moved onto the group headers (uniform per group) — chips
  are clean text now
- ✓ Move tool uses a hand icon + grab cursor; Eraser uses a white cursor (no more
  red "no" circle)
- ✓ AUTO grid fully re-fits the scene whenever it triggers (acts like FIT TO
  SCENE); sliders already navy
- ✓ Trimmed text: bond status, House Rules (cap→Heat Capacity, result→results,
  combat log→Combat Log, parentheticals removed), and the Structure/Stress 0
  flavour lines

## Shipped in 2.8.4 ✓

- ✓ **Crit × Overkill resolution reordered**: every 1 is rerolled first (+1 Heat
  each, including 1s sitting in a crit pair), THEN highest-of-pair is kept —
  exhaustively unit-tested
- ✓ **Combat Drill Overclock**: a molten OVERCLOCK button appears next to FIRE
  after target-locking the drill. FIRE = standard Overkill; OVERCLOCK = the
  exploding "dice hydra" (a 1 spawns a reroll + a bonus die; under crit the
  bonus is its own doubled pair, all recursive, Heat per 1)
- ✓ Overkill now visually pulls the rerolled 1 OFF the 3D tray (no lingering 1s)
- ✓ Accurate weapons auto-add an Accuracy die, Inaccurate a Difficulty die;
  Reliable N floors damage to N (noted in the combat log)
- ✓ **Weapon mods**: a box under each weapon shows the mod (or "NO WEAPON MOD"),
  hover for its effect; mod bonus damage rolls into FIRE automatically
- ✓ **TECHS gains a PROTOCOLS group** (Protocol + free non-weapon actions like
  Transmuting Spark). Deployables (Lotus Projector) surface as "Deploy X" Quick
  Tech. Action glyphs per group: half-hex (Invade/Quick), full-hex (Full),
  empty-hex (Protocols). All tech labels blue; Core groups green; TECHS header
  deepened
- ✓ Free/reactionary WEAPONS (Autogun, Autopod) get the empty-hex glyph
- ✓ **CORE tab gains FRAME TRAITS** (Scout/Cloak/etc.) below Core Bonuses
- ✓ Frame traits / core bonuses that grant tech-attack accuracy (Goblin's
  **Liturgicode**) auto-add the Accuracy die to TECH ATK
- ✓ A native **Move** mode leads the LANCER tool bar (Move/Blast/Cone/Line/
  Erase) — pans the board and selects tokens like Owlbear's own tool
- ✓ Mission Control: ADD NPC form no longer overflows; fields reordered (HP,
  Heat Capacity, Speed, Sensors, Armor, Save, Evasion, E-Defense), Tier removed;
  HP/Heat rows get a LEFT max stepper (adjust totals) beside the existing
  current stepper
- ✓ Grid AUTO is the default again and re-runs on grid type/size change; range
  sliders are navy, not the bright Windows blue
- ✓ Flat / Crit / Overkill reset when you leave the DICE tab

## Notes & next suggestions (post-2.8.4, Claude)

Decisions worth knowing, and ideas still on the table:

- **Combat Drill Overclock is opt-in via the molten button** (you choose when
  the prone/immobilized/stunned bonus applies, since Uplink can't see the target
  condition). Standard FIRE is plain Overkill.
- **Reactions still ride in Quick Tech** (each chip shows its true activation).
  Now that PROTOCOLS exists, a dedicated REACTIONS group would be a clean follow.
- **Content-pack talents** (e.g. Iconoclast) only surface their tech actions if
  COMP/CON embedded the talent data in the export. The parser reads embedded
  data, but if your export only references the id and it isn't in public
  `lancer-data`, the actions can't be shown — worth confirming against your file.
- **Lock On isn't auto-consumed yet.** A "consume Lock On (+1 Acc)" checkbox on
  the attack bar (that clears after the roll) would finish the tag automation.
- **Mod-added tags beyond damage**: a mod that grants Overkill/Reliable is
  honoured, but mod-added *range/threat* changes aren't merged into the template
  sizing yet.
- **Loading / Ordnance tracking** (grey out ATK after firing until Reload).
- **Conditions tracker** (Impaired, Jammed, Lock On, Exposed) that also stamps
  the bonded token — pairs naturally with the new TECHS panel.
- **Overcharge button** that rolls the escalating heat cost (1 / 1d3 / 1d6 /
  1d6+4) and applies it.
- **Write HP/Heat to token metadata** so health-bar extensions can read it.
- **Multi-profile weapons**: a profile selector (swappable ammo) — currently the
  first profile is used.

## Shipped in 2.8.1 ✓

- ✓ EVA / SAVE / SENS quick-edit steppers right on each NPC card
- ✓ Tap/click pins the lavender tooltip (mobile-friendly) with a dark-purple ✕
  to dismiss — hover behaviour untouched
- ✓ Squad Telemetry kick: blue ✕ on each lancer card, SURE? confirm, removes
  that one mech from every player's squad view (they rejoin automatically on
  their next status update)

## Shipped in 2.8.0 ✓

- ✓ Range fields follow the token only when it ACTUALLY moves — drag offsets
  survive scene activity; offset toggle hands you Owlbear's move tool
- ✓ NPC import accepts COMP/CON pilot files (fully compendium-resolved) and
  generic NPC JSON; Sensors stat added; names go red at 0 HP / orange at max heat
- ✓ Deeper, quieter stone impact sounds + speaker mute toggle (persisted)
- ✓ Optional real stone texture: drop textures/stone.jpg in the repo
- ✓ Scan / Lock On toggle sensor range instead of opening the dice tray
- ✓ GM telemetry tabs wrap to two lines at large text sizes; 140% zoom cap
- ✓ Slower, calmer tooltip scroll & fade

## Shipped in 2.7.0 ✓

- ✓ FIELD TELEMETRY: GM-local NPC roster (add/edit/delete/import JSON,
  HP/Heat trackers, clear-all confirm) behind a sliding holo tab
- ✓ GM click-to-ping a lancer's bonded token (viewport fly + pulse rings)
- ✓ Mission Control: pilot/LL left-aligned under the callsign; CompCon
  segmented HP/Heat bars on cards
- ✓ Templates: distance counter above the cursor while dragging, white
  distance label on the farthest tile, line origin highlighted, UNDO LAST,
  free-angle lines; grouped erase
- ✓ Cone: vertex aims widened to 2/3/4 rows; edge aims untouched
- ✓ Click-drag offset reworked: fields themselves become draggable (smooth),
  siblings follow, offset commits on release; auto-disables with no fields
- ✓ Stone dice (granite speckle, marble veins, low metalness) + subtle
  impact audio with real weight; engravings inset per face (no d20 overlap)
- ✓ Roll queue: one entry per roll; multiplayer replays play back-to-back
- ✓ Camera order: add at home view → slight zoom on throw → result zoom
- ✓ HORUS glitch is per-die (scheme switching can't retro-glitch old dice)
- ✓ Acc/Dis picker icons: green hex +, red hex −
- ✓ Tooltip auto-grows, then leisurely scroll-loops long text
- ✓ A+/A− keeps the House Rules section pinned; sticky ROLL/CLEAR in the tray

## Shipped in 2.6.0 ✓

- ✓ Cone slimmed one tile per side (boundary rails trimmed)
- ✓ First-click target-lock race fixed (shared dice-tray init promise)
- ✓ Replays render in the ROLLER's faction colours
- ✓ Deeper, glossier dice; crystal blue/gold Accuracy & purple/white Difficulty
- ✓ Gold faction engravings: lotus (SSC), circuit (HORUS), rigid (HA),
  star (Union), naval (IPS-N); silver gem facets on the crystal dice
- ✓ Dice picker is a left-hand column of colour-matched die icons; taller
  tray; scheme select in the modifier row; queue count lives on the Combat Log
- ✓ Weapon rolls scroll the dice tab to the top and collapse the Combat Log
- ✓ GM: trimmed telemetry note, stats always visible, long names soft-hyphen wrap
- ✓ UI text size control (A− / A+ / Default, persisted)
- ✓ CLICK-DRAG OFFSET tool mode — drag your range fields into alignment
- ✓ Version number in the header and README

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
