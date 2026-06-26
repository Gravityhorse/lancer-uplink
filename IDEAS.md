# LANCER // UPLINK — Roadmap & QoL Ideas

The **To-Be-Implemented** list is at the very top. Below it, every shipped
version in descending order (newest first).

---

## ★ To-Be-Implemented (next up)

### Gameplay / Lancer rules
- **Conditions & statuses tracker** — Impaired, Jammed, Slowed, Lock On, Exposed,
  Shredded, Prone, Immobilized, Stunned. Toggle them on the sheet and stamp icons
  on the bonded token. Highest-value gap left; the token-bar baseline (2.8.7) is
  the place to build it.
- **Lock On auto-consume** — a "+1 Acc (Lock On)" tick on the attack bar that
  clears itself after the roll. Finishes the tag automation started in 2.8.4.
- **Loading / Ordnance tracking** — grey out a Loading weapon's ATK after it
  fires until a Reload action is clicked.
- **Multi-profile weapons** — a profile selector for swappable-ammo weapons
  (currently the first profile is used).
- **Structure / Overheat macro buttons** that roll the right dice and read the
  table result into the log.

### Fun / easter eggs (expand the theatre)
- **More Big Stupid Buttons** — a signature effect per dramatic frame: Tokugawa
  meltdown glow, Pegasus ATHENA shimmer, Metalmark cloak-fade, Goblin glitch
  storm, an SSC bloom, etc. (Manticore + Barbarossa shipped in 2.8.7.)
- **Per-faction roll flair** — the HORUS d20 music hook (2.8.7) generalised:
  optional roll stings per manufacturer.
- **The NHP CASCADE button** from the prototype — something appropriately
  unsettling, escalating with your running nat-1 count.

### Map / tokens
- **Extend the token bars** (baseline shipped 2.8.7): condition icons, a
  structure/stress pip row, a name tag, GM-only enemy bars.
- **True hover-reveal** for the token bars — Owlbear doesn't expose item hover;
  2.8.7 reveals numbers on selection instead. Worth revisiting if the SDK adds it.
- **Threat / engagement rings** around the bonded token that follow it.
- **Line-of-sight ruler** counting hexes through the terrain layer, flagging
  soft/hard cover.
- **Difficult-terrain-aware movement** — green field costs 2 per marked hex.

### Sync / multiplayer
- **Roll-history sync** for late joiners (store the last N rolls in scene
  metadata, not just live broadcasts).
- **Write HP/Heat to token metadata** so other health-bar extensions can read it.
- **Broadcast per-player dice schemes** so HORUS glitch shows on everyone's tray.

### Quality of life / tech health
- **Settings drawer** gathering the house-rule toggles in one place.
- **Keyboard shortcuts** — R to roll, C to clear, 1–6 to queue dice.
- **Collapsible-state memory** — remember which sections you keep closed.
- **A committed dice-math test harness** — Overkill / crit / Combat Drill are the
  most regression-prone code; a small test file would protect them.
- **A live Owlbear smoke-test pass** — grid auto-calibration, the token bars, the
  Move/Erase cursors, and the remote-roll popup all live in the VTT and want a
  real at-the-table check.

---

## ⚠ Known bugs / watch-list

- **Remote-roll popover positioning is unverified.** The separate on-screen roll
  window (2.8.9) anchors ~86px from the right edge — a guess at the toolbar width.
  May need nudging; the ready/closed handshake also wants a real two-client test.
- **Eraser click-and-drag is imperfect.** Single-click erase is solid; the
  hold-and-drag pass can miss fast sweeps. Needs tuning.
- **Everything Owlbear/WebGL is untested by the author of these changes** — grid
  auto-calibration, token bars, paint/pen, the overcharge deck recolor and the
  popover all want an at-the-table pass.
- **No multi-profile weapon support** — the first profile is always used.
- **Token bars can't hover-reveal** — Owlbear exposes no item-hover event, so exact
  values show on selection only.

---

## Shipped in 2.8.10 ✓

- ✓ **Paint & Pen finally fixed — it was the lifecycle, not the layer.** They were
  calling `addItems` on SHARED items *during* the tool drag (`onToolDragMove`), and
  Owlbear reverts mid-interaction adds on the next sync (visible ~1s, then gone).
  Rebuilt both to do exactly what the working templates do: show a LOCAL preview
  while you drag, then commit ONE real item on drag-END (via a never-dropped commit
  queue). Paint commits the swept hexes as one overlay; Pen commits the freehand
  path. Erase/undo/clear updated to match
- ✓ **Overcharge level meter**: four segmented cells next to CLEAR OC (same look as
  the Heat bar) that fill orange 0→4 with each overcharge. Shows only when
  Overcharge Dice is enabled
- ✓ **Overcharge recolors the deck on the FIRST level too** — the instant +1 Heat
  now flashes the reactor red like the rolled levels, instead of sitting on a calm
  blue map
- ✓ Toggle renamed **"Hide other players' dice rolls"** (off by default = shown);
  **"Overcharge" → "Overcharge Dice"**; **"Active mech" → "Active Mech"** with the
  pilot name as the dropdown group header and each mech's frame shown as its
  equipment
- ✓ The premature "Player → 10" toast is gone — the popover now fires it only after
  the dice settle. Lavender tooltip autoscroll eased slightly

## Shipped in 2.8.9 ✓

- ✓ **Token bars render fix**: Owlbear keeps an item's cached path mesh on
  `updateItems` (only its *position* re-renders, not `.commands` geometry), so the
  diffed bars showed a stale/empty fill. They now rebuild a token's set (delete +
  add) only when that token's data actually changes, gated by a per-token
  signature — no flicker, no brightness stacking, no vanish
- ✓ **Paint / Pen invisibility fixed — it was the layer.** They were drawing
  SHARED items onto the GM-owned `DRAWING` layer, which a player can't write, so
  the add rendered optimistically for ~1s then reverted on the next scene sync.
  Moved both to `PROP` (where the blast/cone/line templates already live and
  players CAN write). The Pen is also rebuilt from many short round-jointed
  `addItems` segments rather than one growing path
- ✓ **Remote rolls moved to a separate on-screen popover** (`roll-popup.html`):
  teammates' dice now replay in their own Owlbear popover anchored to the right of
  the *screen*, just left of the toolbar — never covering the panel. Fed over a
  same-client LOCAL broadcast with a ready/closed handshake. House Rules toggle
  "SHOW OTHER PLAYERS' DICE ROLLS" (on by default)
- ✓ **OVERCHARGE is now a House Rules opt-in** (off by default); the OC hex + CLEAR
  OC button only appear when enabled. Heat now reads exactly like Overkill — the
  number in an orange-outlined card with a tappable **+N HEAT** badge — and the
  first overcharge (flat 1 Heat) resolves instantly with no confusing empty roll
- ✓ **Eraser is click-and-drag**; the Pen icon turns 90° CCW; the ACC/DIF/OC hexes
  regained the subtle grey outline that matches the dice; CLEAR OC and TEMPLATE
  COLOR are plain grey buttons; the UNDO LAST ↶ glyph is gone
- ✓ **OVERCHARGE reworked to prime-to-roll**: the orange hex now PRIMES a molten
  die that you fire with ROLL (no more auto-roll, no top "OVERCHARGE #1" banner).
  Result reads cleanly — the value in an orange outline with a bold **+N HEAT**
  line. A **CLEAR OC** button (in the dice mod-row, between HIDDEN and the volume
  toggle) and right-click both reset the track to base after a full rest
- ✓ **OVERCHARGE recolors the real deck**: instead of a CSS overlay, `dice3d`
  washes the whole 3D tray molten red (floor glow, dust, walls, rails, rim light)
  and flips the back-wall readout from *UNION OMNINET LINK* to **OVERCHARGE —
  REACTOR CORE UNSTABLE** while the die is primed/rolling
- ✓ **Dice-picker icons cleaned up**: removed the clashing blue/purple/orange
  outlines on the ACC / DIF / OC buttons, dulled the OC hex to an easier orange,
  and swapped the flame for an **O flanked by bars** glyph
- ✓ **Template Color picker**: Paint's swatches became a *Template Color* button
  that smoothly drops to reveal the six colours (hidden by default — visible
  colours broke immersion). The chosen colour now drives **Blast, Cone, Line,
  Paint AND Pen**. Red default
- ✓ **Pen tool** (between Paint and Eraser): freehand drawing with NO grid snapping
  — a single stroke that follows the raw pointer, moderate thickness scaled to the
  tile size, in the shared Template Color. Honours ALL/ME visibility, erasable and
  undoable like Paint
- ✓ **Header + collapse polish**: the version + green dot sit flush right again (a
  `margin` shorthand had clobbered `margin-left:auto`), and collapsing no longer
  leaves a stray scrollable sliver under the tabs (the body is fully removed from
  layout and the popover shrinks to the exact header height)
- ✓ **Tooltip autoscroll actually works now** — it was stalling because
  `scrollTop += 0.22` floors back to the same integer every frame; switched to a
  float accumulator (hover + pinned, with manual-scroll override)
- ✓ **Eraser restored.** A `createAction` call for the paint swatches was throwing
  and aborting tool registration before the Eraser registered — removed it
- ✓ **FREE ACTIONS + REACTIONS** groups under Protocols (empty-hex glyph): Free →
  Free Actions, Reaction → Reactions, with base Brace/Overwatch. Free/reaction
  WEAPONS (Autogun → Free, Autopod → Reaction) get a plaque while staying in
  WEAPONS
- ✓ **Pilot-scale sheet**: the pilot, on foot, is now the last entry in the Active
  Mech list — HP/armour/evasion, pilot weapons, gear-as-systems, same talents,
  straight from the embedded loadout
- ✓ Weapon-mod added range/threat now merges into the placed template's size

## Shipped in 2.8.8 ✓

- ✓ **Token bars reworked to rhombus cells** matching the pilot HP/Heat UI — a
  faint dark track with black outlines, the first N cells lit; the bar is now
  CENTRED on the token (was hanging off the right edge)
- ✓ Enabling the bars now requests every client's status, so **other players'**
  bonded tokens show bars too (disabled = none, enabled = all)
- ✓ **Mobile collapse**: tap the version (top-right) to fold the panel down to
  just the header + tabs and back, with a smooth slide and a generous hitbox;
  plus tap-highlight/touch-action polish
- ✓ **Paint tool** added to the LANCER templates (brush icon): freely highlight
  tiles in the holographic style. A six-colour sub-palette (Red/Blue/Green/
  Orange/Purple/Yellow) appears only while Paint is active. Paint is its own
  layer (kind:"paint") — it never touches Sensors/Move/Range. The Eraser removes
  it
- ✓ **Eraser auto-swaps to Move** when a click erases nothing
- ✓ Tooltip autoscroll re-enabled (including on pinned tooltips); a manual
  wheel/touch scroll overrides it
- ✓ Trimmed the token-bars tutorial line in House Rules

## Shipped in 2.8.7 ✓

- ✓ **d10 / d12 faces fixed**: the old rounded-normal grouping mis-counted faces
  (d12 showed 13–17 and doubled numbers, d10 was wrong). Now triangles cluster by
  normal direction and merge down to the die's true face count — verified against
  three.js (d10 self-reads 10/10, faces well-separated)
- ✓ **HORUS d20 roll music**: drop your own loop at `audio/horus.mp3` and a HORUS
  d20 plays a random slice of it while it tumbles, cutting out the instant it
  lands. (Can't ship a song for copyright reasons — Caramelldansen is the vibe.)
- ✓ **Live HP/Heat bars over bonded tokens** (House Rules toggle): subtle blue HP
  + orange Heat % bars on a dark track with a light border, scaled to token size
  and grid, following the token; select a token to read exact X/Y values. Built
  as an extensible baseline (conditions etc. slot in next)
- ✓ **Frame easter eggs**: Manticore gets **CASTIGATE THE ENEMIES OF THE GODHEAD**
  in the CORE tab — flashes the Eye of Horus and charges every panel with an
  electric glow (toggle). Barbarossa gets an **Apocalypse Rail** charge counter +
  **FIRE APOCALYPSE RAIL** button that screams a beam across the UI
- ✓ Heat Cap limited to 60 in Field Telemetry; raising Max HP fills the new bars
  (Max Heat stays empty); manual heat + resets to 0 after taking Stress while
  Overkill still carries the overflow
- ✓ Confirmed Combat Drill Overclock math: a 1 → 2d6 normally, 3d6 under crit
  (bonus pair = roll 2 keep highest), compounding on further 1s

## Shipped in 2.8.6 ✓

- ✓ Target-lock accuracy roll drops the "[LOCK: FIRE after accuracy]" tag
- ✓ NPC cards: HP/HEAT labels left-aligned with EVA/SPD, and HP bars now WRAP
  every 20 into rows that stack upward (cap 60 = three rows) instead of shoving
  the numbers off-card
- ✓ Move tool uses the white LANCER hex (matches the toolbar) with a normal cursor
- ✓ Import hint: "remembered between sessions. Re-upload to update."
- ✓ The status line under Core is hidden once a pilot sheet is showing

## Shipped in 2.8.5 ✓

- ✓ **Heat cascades**: adding heat past Heat Capacity carries the overflow into
  the next Stress level(s) — a big spike can blow through several at once
- ✓ **Core-bonus weapon range mods**: Gyges +1 Threat to melee, Neurolink
  Targeting +3 Range to ranged, External Batteries, etc. — affects the sheet and
  the placed template's size; only boosts a range a weapon actually has
- ✓ Dice picker pre-loads IPS-N blue (no more Union-red flash on startup)
- ✓ Tray side walls pulled in + throw spread tightened so dice stay on-camera
- ✓ TECHS action glyphs moved onto the group headers (uniform per group)
- ✓ Move tool = hand icon + grab cursor; Eraser = white cursor (no red circle)
- ✓ AUTO grid fully re-fits the scene whenever it triggers
- ✓ Trimmed text: bond status, House Rules wording, Structure/Stress 0 flavour

## Shipped in 2.8.4 ✓

- ✓ **Crit × Overkill reordered**: every 1 is rerolled first (+1 Heat each,
  including 1s in a crit pair), THEN highest-of-pair is kept — exhaustively tested
- ✓ **Combat Drill Overclock**: a molten OVERCLOCK button by FIRE — the exploding
  "dice hydra" (a 1 → reroll + bonus; under crit the bonus is its own doubled
  pair, all recursive, Heat per 1). FIRE stays plain Overkill
- ✓ Overkill visually pulls the rerolled 1 OFF the 3D tray
- ✓ Accurate → +1 Accuracy die, Inaccurate → +1 Difficulty die; Reliable N floors
  damage to N (noted in the log)
- ✓ **Weapon mods**: a box under each weapon (or "NO WEAPON MOD"), hover for the
  effect; mod bonus damage rolls into FIRE
- ✓ **PROTOCOLS group** in TECHS; deployables (Lotus Projector) surface as
  "Deploy X" Quick Tech; per-group glyphs; tech labels blue, Core green
- ✓ Free/reactionary weapons (Autogun, Autopod) get the empty-hex glyph
- ✓ **FRAME TRAITS** under Core; Liturgicode-style traits auto-add tech Accuracy
- ✓ A native **Move** mode leads the LANCER tool bar
- ✓ ADD NPC form reflowed (no overflow), reordered, Tier removed; HP/Heat get a
  left max stepper beside the current stepper
- ✓ Grid AUTO default + re-runs on grid change; navy sliders; modifiers reset on
  leaving the DICE tab

## Shipped in 2.8.3 ✓

- ✓ **Overkill → RAW**: a 1 is rerolled (replaced), +1 Heat per reroll, chaining
- ✓ **Combat Drill** keeps exploding-1s on top of the RAW reroll (auto-detected)
- ✓ Crit label "⚡ CRIT"; FIRE drops "(CRIT)" (gold glow tell); Target Lock honours
  the CRIT/OVERKILL toggles
- ✓ ATK + Target Lock are one button (`ATK ⬢` / `TECH ATK ⬢`)
- ✓ **HASE fix**: Systems adds E-Defense (was missing)
- ✓ **Core Bonus modifiers** apply via a generic `bonuses[]` scan (also
  generalises system bonuses; Personalizations no longer special-cased)
- ✓ **TECHS tab** (Tech Attack / Invade / Quick Tech / Full Tech) and **CORE tab**
  (core power + bonuses); SYSTEMS purple, Core green; Systems show flavour, TECHS
  the mechanics
- ✓ Cone marks its origin; Blast marks its centre
- ✓ NHP nat-1 lines reworked + five new; "Trust me." glitch; multi-line centring
- ✓ NPC stats inline-editable; remote rolls in a dedicated side popup; deeper,
  glossier dice with env reflections; IPS-N default; themed scrollbars;
  scrollable pinned tooltips; FORGET PILOT clears the sheet; Iconoclast cased;
  flat-top grid trusting Owlbear's type; A+/A− re-pin; instructional blurbs cut

## Shipped in 2.8.1 ✓

- ✓ EVA / SAVE / SENS quick-edit steppers on each NPC card
- ✓ Tap/click pins the lavender tooltip with a dark-purple ✕ to dismiss
- ✓ Squad Telemetry kick: blue ✕, SURE? confirm, removes one mech from every
  player's squad view (they rejoin on their next update)

## Shipped in 2.8.0 ✓

- ✓ Range fields follow the token only when it ACTUALLY moves; offset toggle
  hands you Owlbear's move tool
- ✓ NPC import accepts COMP/CON pilot files + generic NPC JSON; Sensors added;
  names go red at 0 HP / orange at max heat
- ✓ Deeper, quieter stone impact sounds + speaker mute toggle
- ✓ Optional real stone texture: drop `textures/stone.jpg`
- ✓ Scan / Lock On toggle sensor range; GM tabs wrap at large text; calmer tooltip

## Shipped in 2.7.0 ✓

- ✓ FIELD TELEMETRY: GM-local NPC roster behind a sliding holo tab
- ✓ GM click-to-ping a lancer's bonded token (viewport fly + pulse rings)
- ✓ Mission Control: pilot/LL left-aligned; CompCon segmented HP/Heat bars
- ✓ Templates: cursor distance counter, farthest-tile label, line origin, UNDO
  LAST, free-angle lines, grouped erase
- ✓ Cone vertex aims widened; click-drag offset reworked (fields draggable)
- ✓ Stone dice + weighty impact audio; roll queue one entry per roll; staged
  camera order; per-die HORUS glitch; acc/dis picker hex icons

## Shipped in 2.6.0 ✓

- ✓ Cone slimmed a tile per side; first-click lock race fixed; replays in the
  roller's colours; deeper glossier dice + crystal Acc/Dis; gold faction
  engravings; dice-icon picker; taller tray; UI text-size control; CLICK-DRAG
  OFFSET tool mode; version in the header

## Shipped in 2.5.0 ✓

- ✓ Overshield off the COMP/CON view; free tray rolls show just the number; clean
  d6 "6"; live grid-offset on active fields; templates render above range fields

## Shipped in 2.4.0 ✓

- ✓ Cone restored to the solid filled triangle; camera re-frames every throw;
  dice are numbers again; MISSION//CONTROL keeps DICE+MAP; grid nudge steppers;
  O.SHLD on the STRUCT/STRESS row

## Shipped in 2.3.0 ✓

- ✓ Grid calibration actually works (`OBR.scene.grid`, not `OBR.grid`); symmetric
  cone rows; faction sigils + engraved frames; staging-close-up camera; dressed-up
  tray; NAT 1 label removed

## Shipped in 2.2.0 ✓

- ✓ RAW cone math; manual CRIT toggle; Lancer-correct 20+ crits; NHP nat-1
  commentary; MOVE cycle; grid calibration controls; preview/erase races fixed;
  holographic tray; Superheavy = Barrage

## Shipped in 2.1.0 ✓

- ✓ Token bond (follow-on-move); persisted pilot + reactor state; heat auto-apply;
  crit damage helper; auto structure/overheat macro; square-grid support;
  MISSION//CONTROL squad telemetry; talent/core/weapon tooltips; Personalizations
