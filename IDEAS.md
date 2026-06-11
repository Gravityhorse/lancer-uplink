# LANCER // UPLINK — Roadmap & QoL Ideas

Things that would make this tool genuinely great, roughly ordered by
bang-for-buck.

## High value, low effort

- **Token bond.** Claim a token on the map; MOVE / SENSORS / weapon-range
  fields then auto-centre on it (and follow it when it moves) instead of
  needing a click. The old prototype had a "CLAIM SELECTED TOKEN" button —
  worth resurrecting.
- **Persist the loaded pilot** in `localStorage` (and the HP/Heat tracker
  state) so a page refresh or reconnect doesn't mean re-uploading the JSON.
- **Loading / Ordnance tracking.** Grey out a Loading weapon's ATK/FIRE
  buttons after it fires until a Reload action is clicked.
- **Heat auto-apply.** When an Overkill roll generates Heat, offer a one-click
  "+N HEAT" button that bumps the tracker (and warn at heat cap / suggest a
  structure-style overheat check).
- **Crit damage helper.** On a 20+ attack, the FIRE roll should offer Lancer
  crit rules: roll all damage dice twice, keep the highest of each.

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
