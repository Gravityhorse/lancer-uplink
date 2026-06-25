// compcon.js - parses COMP/CON pilot exports and resolves frame/weapon IDs
// against Massif Press's open `lancer-data` compendium (fetched from a CDN,
// cached in memory). Also computes derived mech stats per Lancer core rules.

const DATA_SOURCES = [
  "https://cdn.jsdelivr.net/npm/lancer-data/lib",
  "https://unpkg.com/lancer-data/lib",
];

const compendium = { frames: null, weapons: null, systems: null, talents: null, coreBonuses: null, mods: null, loaded: false };

async function fetchJson(file) {
  for (const base of DATA_SOURCES) {
    try {
      const res = await fetch(`${base}/${file}`);
      if (res.ok) return await res.json();
    } catch (_) { /* try next mirror */ }
  }
  return null;
}

export async function loadCompendium(onStatus) {
  if (compendium.loaded) return compendium;
  onStatus?.("Downloading compendium...");
  const [frames, weapons, systems, talents, coreBonuses, mods] = await Promise.all([
    fetchJson("frames.json"),
    fetchJson("weapons.json"),
    fetchJson("systems.json"),
    fetchJson("talents.json"),
    fetchJson("core_bonuses.json"),
    fetchJson("mods.json"),
  ]);
  compendium.frames = frames || [];
  compendium.weapons = weapons || [];
  compendium.systems = systems || [];
  compendium.talents = talents || [];
  compendium.coreBonuses = coreBonuses || [];
  compendium.mods = mods || [];
  compendium.loaded = !!(frames && weapons);
  onStatus?.(compendium.loaded ? "Compendium online." : "Compendium offline - manual mode available.");
  return compendium;
}

export const findFrame = (id) =>
  compendium.frames?.find((f) => f.id === id) || null;
export const findWeapon = (id) =>
  compendium.weapons?.find((w) => w.id === id) || null;
export const findSystem = (id) =>
  compendium.systems?.find((s) => s.id === id) || null;
export const findTalent = (id) =>
  compendium.talents?.find((t) => t.id === id) || null;
export const findCoreBonus = (id) =>
  compendium.coreBonuses?.find((c) => c.id === id) || null;
export const findMod = (id) =>
  compendium.mods?.find((m) => m.id === id) || null;

// ---- pilot file parsing -----------------------------------------------------

// Does this object look like a pilot? (callsign / mechSkills / mechs are the tells)
const looksLikePilot = (p) =>
  p && typeof p === "object" &&
  (p.callsign != null || p.mechSkills != null || p.mech_skills != null ||
    Array.isArray(p.mechs));

// Pull EVERY pilot object out of whatever COMP/CON handed us.
//   - Modern export : { EXPORT_TYPE: "PILOT", data: <pilot> }
//   - Roster / bulk : { pilots: [...] } / { data: { pilots: [...] } } / [<pilot>, ...]
//   - Backup blobs  : { pilots: ["...stringified pilot json..."] } (some versions
//     of COMP/CON store each roster entry as a JSON *string*)
//   - Legacy        : the pilot object at the top level, or { pilot: <pilot> }
export function listPilots(json) {
  let root = json;
  // COMP/CON's own importer convention: payload under `data` when EXPORT_TYPE set.
  if (root && typeof root === "object" && !Array.isArray(root) &&
      root.EXPORT_TYPE && "data" in root) {
    root = root.data;
  }
  // Some backups nest once more: { data: { pilots: [...] } }
  if (root && typeof root === "object" && !Array.isArray(root) &&
      !looksLikePilot(root) && root.data && typeof root.data === "object") {
    if (Array.isArray(root.data.pilots) || Array.isArray(root.data)) root = root.data;
  }

  const coerce = (entry) => {
    // Roster backups sometimes store each pilot as a JSON string.
    if (typeof entry === "string") {
      try { entry = JSON.parse(entry); } catch (_) { return null; }
    }
    // Some shapes wrap the pilot one level down.
    if (entry && typeof entry === "object" && !looksLikePilot(entry)) {
      if (looksLikePilot(entry.pilot)) return entry.pilot;
      if (looksLikePilot(entry.data)) return entry.data;
    }
    return looksLikePilot(entry) ? entry : null;
  };

  let candidates = [];
  if (Array.isArray(root)) candidates = root;
  else if (root && typeof root === "object") {
    if (Array.isArray(root.pilots)) candidates = root.pilots;
    else if (root.pilot) candidates = [root.pilot];
    else candidates = [root];
  }
  return candidates.map(coerce).filter(Boolean);
}

function unwrapPilot(json) {
  return listPilots(json)[0] || null;
}

// A mounted weapon/system serializes as { id, data: <full compendium entry>, ... }.
// Older exports stored a bare id string. Normalise both to { id, data }.
function normEquip(s) {
  if (!s) return null;
  if (typeof s === "string") return { id: s, data: null };
  return { id: s.id || s.data?.id || "", data: s.data || s, selectedProfile: s.selectedProfile };
}

function gatherMounts(loadout) {
  const mounts = [];
  const pushMount = (mt) => {
    if (!mt) return;
    const slots = [...(mt.slots || []), ...(mt.extra || [])];
    const weapons = slots
      .map((s) => {
        const w = normEquip(s?.weapon);
        // COMP/CON hangs the weapon mod off the slot (or the weapon itself)
        if (w) w.mod = normEquip(s?.mod || s?.weapon?.mod);
        return w;
      })
      .filter((w) => w && (w.id || w.data));
    if (weapons.length) {
      mounts.push({ type: mt.mount_type || mt.type || "Mount", weapons });
    }
  };
  for (const mt of loadout.mounts || []) pushMount(mt);
  // Integrated / bonus mounts COMP/CON keeps separate from the main array.
  for (const im of loadout.integratedMounts || []) {
    const w = normEquip(im?.weapon);
    if (w && (w.id || w.data)) mounts.push({ type: "Integrated", weapons: [w] });
  }
  pushMount(loadout.integratedWeapon);
  pushMount(loadout.improved_armament);
  pushMount(loadout.superheavy_mounting);
  return mounts;
}

export function parsePilotFile(json) {
  const p = unwrapPilot(json);
  if (!p || typeof p !== "object" || (!p.callsign && !p.name && !p.mechs)) {
    const keys =
      json && typeof json === "object"
        ? Object.keys(json).slice(0, 12).join(", ")
        : typeof json;
    throw new Error(
      `This doesn't look like a COMP/CON pilot export. (top-level keys: ${keys})`
    );
  }
  return parsePilot(p);
}

// Parse a single (already unwrapped) raw pilot object.
export function parsePilot(p) {
  const skills = p.mechSkills || p.mech_skills || [0, 0, 0, 0];
  const level = Number(p.level ?? 0);
  const pilot = {
    name: p.name || "Unknown",
    callsign: p.callsign || "PILOT",
    level,
    grit: Math.ceil(level / 2),
    hase: {
      hull: Number(skills[0] ?? 0),
      agi: Number(skills[1] ?? 0),
      sys: Number(skills[2] ?? 0),
      eng: Number(skills[3] ?? 0),
    },
    // COMP/CON talents: [{ id, rank }] (older exports may use bare ids).
    // Preserve any embedded talent data (ranks/actions) so content-pack talents
    // COMP/CON didn't put in lancer-data (e.g. Iconoclast) still resolve.
    talents: (p.talents || []).map((t) => {
      if (typeof t === "string") return { id: t, rank: 1, data: null };
      const embedded = (t.data && Array.isArray(t.data.ranks)) ? t.data
        : (Array.isArray(t.ranks) ? t : null);
      return { id: t.id || "", rank: Number(t.rank ?? 1), data: embedded };
    }).filter((t) => t.id),
    // Core bonuses are pilot-level (bare id strings) but modify the active mech.
    coreBonuses: (p.core_bonuses || p.corebonuses || [])
      .map((c) => (typeof c === "string" ? c : c?.id || ""))
      .filter(Boolean),
    // the pilot's personal loadout (armour / weapons / gear) for the on-foot sheet
    loadout: p.loadout || null,
  };

  const mechs = (p.mechs || []).map((m) => {
    const loadout =
      (m.loadouts && (m.loadouts[m.active_loadout_index ?? 0] || m.loadouts[0])) ||
      m.loadout || {};
    const mounts = gatherMounts(loadout);
    const systems = [
      ...(loadout.systems || []),
      ...(loadout.integratedSystems || []),
    ]
      .map(normEquip)
      .filter((s) => s && (s.id || s.data));
    return {
      name: m.name || "Mech",
      frameId: m.frame || m.frame_id || "",
      // COMP/CON embeds the full frame in the export - use it if present.
      frameData: m.frameData || null,
      mounts,
      systems,
      current: {
        hp: m.current_hp, heat: m.current_heat,
        structure: m.current_structure, stress: m.current_stress,
        repairs: m.current_repairs, core: m.current_core_energy,
        overshield: m.current_overshield,
      },
      active: !!m.active,
    };
  });

  return { pilot, mechs };
}

// ---- derived stats (Lancer core rules) -------------------------------------

// Map a lancer-data bonus id onto a derived-stat key. Conditional/weapon-scoped
// bonuses (range with damage/weapon/range_types, SP, AI cap, etc.) are skipped —
// they aren't flat defensive stats.
const BONUS_STAT = {
  hp: "hpMax", armor: "armor", edef: "edef", evasion: "evasion",
  heatcap: "heatMax", save: "save", size: "size", speed: "speed",
  sensor: "sensors", sensor_range: "sensors", tech_attack: "techAttack",
  attack: "attackBonus", repcap: "repMax",
};

// Some frame traits / core bonuses grant accuracy specifically on tech attacks
// (Goblin's Liturgicode: "+1 accuracy on tech attacks"). Detect from the text
// so it can be auto-applied to the TECH ATK roll.
function detectTechAccuracy(texts) {
  let n = 0;
  for (const txt of texts) {
    const s = String(txt || "");
    if (/tech\s*attack/i.test(s) && /accuracy/i.test(s) && !/difficulty/i.test(s)) {
      const m = s.match(/\+\s*(\d+)\s*accuracy|accuracy\s*\+\s*(\d+)/i);
      n += m ? Number(m[1] || m[2]) : 1;
    }
  }
  return n;
}

function applyStatBonuses(stats, bonuses) {
  for (const b of bonuses || []) {
    if (!b) continue;
    // weapon-scoped range/damage bonuses don't touch flat stats
    if (b.weapon_types || b.damage_types || b.range_types) continue;
    const key = BONUS_STAT[b.id];
    if (!key) continue;
    const v = Number(b.val);
    if (!Number.isFinite(v)) continue;
    stats[key] = (stats[key] || 0) + v;
  }
}

// Weapon range bonuses from core bonuses / systems — Gyges (+1 Threat to Melee),
// Neurolink Targeting (+3 Range to ranged weapons), External Batteries, etc.
const RANGE_FIELD = { range: "range", threat: "threat", blast: "blast", line: "line", cone: "cone", burst: "burst" };
function applyRangeBonuses(weapon, rangeBonuses) {
  for (const b of rangeBonuses || []) {
    const val = Number(b.val);
    if (!Number.isFinite(val)) continue;
    // weapon-type filter (absent = all weapon types)
    if (Array.isArray(b.weapon_types) && b.weapon_types.length) {
      const wt = String(weapon.type || "").toLowerCase();
      if (!b.weapon_types.some((t) => String(t).toLowerCase() === wt)) continue;
    }
    // damage-type filter (absent = any)
    if (Array.isArray(b.damage_types) && b.damage_types.length) {
      const dts = (weapon.damageTypes || []).map((x) => x.toLowerCase());
      if (!b.damage_types.some((t) => dts.includes(String(t).toLowerCase()))) continue;
    }
    const rts = (Array.isArray(b.range_types) && b.range_types.length) ? b.range_types : ["Range"];
    for (const rt of rts) {
      const f = RANGE_FIELD[String(rt).toLowerCase()];
      // only boost a range the weapon actually has (don't give a melee a Range)
      if (f && (weapon[f] || 0) > 0) weapon[f] += val;
    }
  }
}

export function resolveMech(mechRaw, pilot) {
  // Prefer the frame embedded in the export; fall back to the CDN compendium.
  const frame = mechRaw.frameData || findFrame(mechRaw.frameId);
  const fs = frame?.stats || {};
  const { hull, agi, sys, eng } = pilot.hase;
  const grit = pilot.grit;

  // Resolve systems first — some grant stat bonuses (Personalizations: +2 HP,
  // and any other system carrying a lancer-data `bonuses` array).
  const systems = mechRaw.systems
    .map((s) => resolveSystem(s))
    .filter(Boolean)
    .slice(0, 24);

  // Resolve pilot core bonuses — they're pilot-level but modify this mech
  // (Full Subjectivity Sync: +2 Evasion, Fomorian Frame: +1 Size, etc.).
  const coreBonuses = resolveCoreBonuses(pilot.coreBonuses);

  const stats = {
    frameName: frame
      ? `${frame.source || ""} ${frame.name || ""}`.trim()
      : mechRaw.frameId || "UNKNOWN FRAME",
    size: fs.size ?? 1,
    hpMax: (fs.hp ?? 8) + grit + hull * 2,
    armor: fs.armor ?? 0,
    structureMax: fs.structure ?? 4,
    stressMax: fs.stress ?? 4,
    heatMax: (fs.heatcap ?? 6) + eng,
    repMax: (fs.repcap ?? 4) + Math.floor(hull / 2),
    evasion: (fs.evasion ?? 8) + agi,
    edef: (fs.edef ?? 8) + sys, // HASE: Systems adds E-Defense (was missing)
    speed: (fs.speed ?? 4) + Math.floor(agi / 2),
    sensors: fs.sensor_range ?? 10,
    techAttack: (fs.tech_attack ?? 0) + sys,
    save: (fs.save ?? 10) + grit,
    attackBonus: grit,
    coreMax: 1,
  };

  // Layer on every stat-affecting bonus from installed systems and core bonuses.
  for (const s of systems) applyStatBonuses(stats, s.bonuses);
  for (const c of coreBonuses) applyStatBonuses(stats, c.bonuses);

  // Frame chassis traits (Scout/Cloak/etc.) for the CORE tab.
  const frameTraits = (frame?.traits || []).map((t) => ({
    name: t.name || "Trait",
    description: effectText(t.description || t.effect || ""),
  }));

  // Auto tech-attack accuracy from traits / core bonuses (Liturgicode…).
  stats.techAccuracy = detectTechAccuracy([
    ...frameTraits.map((t) => t.description),
    ...coreBonuses.map((c) => c.effect),
  ]);

  const mounts = mechRaw.mounts.map((mt, i) => ({
    label: mt.type ? `${mt.type.toUpperCase()} MOUNT` : `MOUNT ${i + 1}`,
    weapons: mt.weapons.map(resolveWeapon).filter(Boolean),
  }));

  // Weapon range bonuses (id "range") come from core bonuses + systems and are
  // applied to each matching weapon — they change display AND template sizing.
  const rangeBonuses = [];
  for (const c of coreBonuses) for (const b of (c.bonuses || [])) if (b.id === "range") rangeBonuses.push(b);
  for (const sysObj of systems) for (const b of (sysObj.bonuses || [])) if (b.id === "range") rangeBonuses.push(b);
  if (rangeBonuses.length) {
    for (const mt of mounts) for (const wp of mt.weapons) applyRangeBonuses(wp, rangeBonuses);
  }

  return { name: mechRaw.name, stats, mounts, systems, coreBonuses, frameTraits, current: mechRaw.current, frame };
}

// On-foot pilot sheet — a mech-shaped object built from the pilot's own loadout
// (armour / weapons / gear), so it renders through the exact same path.
export function resolvePilotScale(pilot) {
  const lo = pilot.loadout || {};
  const armors = (lo.armor || []).map(normEquip).filter((a) => a && (a.id || a.data));
  const weapons = [...(lo.weapons || []), ...(lo.extendedWeapons || [])]
    .map(normEquip).filter((w) => w && (w.id || w.data));
  const gear = [...(lo.gear || []), ...(lo.extendedGear || [])]
    .map(normEquip).filter((g) => g && (g.id || g.data));

  // Base pilot stats; worn armour overrides Armour/Evasion/E-Def/Speed and adds HP.
  let hp = 6, armor = 0, evasion = 10, edef = 10, speed = 4, size = 0.5;
  for (const a of armors) {
    const d = a.data; if (!d) continue;
    hp += Number(d.hp_bonus ?? 0);
    if (d.armor != null) armor = Number(d.armor);
    if (d.evasion != null) evasion = Number(d.evasion);
    if (d.edef != null) edef = Number(d.edef);
    if (d.speed != null) speed = Number(d.speed);
    if (d.size != null) size = Number(d.size);
  }

  const stats = {
    frameName: `${pilot.callsign || "PILOT"} · ON FOOT`,
    size, hpMax: Math.max(1, hp), armor,
    structureMax: 0, stressMax: 0, heatMax: 0, repMax: 0, coreMax: 0,
    evasion, edef, speed, sensors: 5,
    techAttack: 0, techAccuracy: 0, save: 10 + pilot.grit, attackBonus: pilot.grit,
  };
  const mounts = weapons.length
    ? [{ label: "PILOT WEAPONS", weapons: weapons.map(resolveWeapon).filter(Boolean) }]
    : [];
  const systems = gear.map(resolveSystem).filter(Boolean);
  return {
    name: `${pilot.name || "Pilot"} (On Foot)`,
    stats, mounts, systems, coreBonuses: [], frameTraits: [],
    current: {}, frame: null, isPilot: true,
  };
}

// pilot core-bonus ids → [{ id, name, source, effect, description, bonuses }]
export function resolveCoreBonuses(ids) {
  return (ids || []).map((id) => {
    const data = findCoreBonus(id);
    const fallback = String(id || "").replace(/^cb_/, "").replace(/_/g, " ");
    if (!data) return { id, name: fallback || "Core Bonus", source: "", effect: "", description: "", bonuses: [] };
    return {
      id,
      name: data.name || fallback,
      source: data.source || "",
      // Tech-style "what it does" text comes from `effect`; description is flavour.
      effect: effectText(data.effect),
      description: effectText(data.description),
      bonuses: Array.isArray(data.bonuses) ? data.bonuses : [],
    };
  });
}

// ---- systems ----------------------------------------------------------------

// lancer-data "effect" fields are strings (sometimes with embedded HTML) or
// nested arrays/objects. Flatten to readable plain text.
function effectText(e) {
  if (e == null) return "";
  if (typeof e === "string") return e.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (Array.isArray(e)) return e.map(effectText).filter(Boolean).join(" — ");
  if (typeof e === "object") {
    return effectText(e.effect || e.detail || e.description || e.name || "");
  }
  return String(e);
}

// Returns { id, name, sp, activation, description } for the tooltip UI.
export function resolveSystem(ref) {
  if (!ref) return null;
  const r = typeof ref === "string" ? { id: ref, data: null } : ref;
  const id = r.id || r.data?.id || "";
  const data = r.data || findSystem(id);
  const fallbackName = (id || "").replace(/^ms_/, "").replace(/_/g, " ") || "System";
  if (!data) return { id, name: fallbackName, sp: null, activation: "", description: "", effect: "", flavor: "", bonuses: [], actionsFull: [] };

  const acts = Array.isArray(data.actions) ? data.actions : [];
  const activation = acts
    .map((a) => String(a.activation || "").trim())
    .filter(Boolean)
    .join(" / ");
  // SYSTEMS tab shows flavour-forward text; the TECHS tab wants the mechanical
  // effect. Keep them separate so each tab can pick the right one.
  const effect = effectText(data.effect);
  const flavor = effectText(data.description);
  const description = [effect, flavor].filter(Boolean).join(" — ");
  return {
    id,
    name: data.name || fallbackName,
    sp: data.sp ?? null,
    type: data.type || "",
    activation,
    description,
    effect,
    flavor,
    bonuses: Array.isArray(data.bonuses) ? data.bonuses : [],
    // full action list, so Invade options / Quick & Full Tech granted by
    // systems can be surfaced in the TECHS tab. Deployables (Lotus Projector…)
    // have no explicit action, but deploying one is a Quick action — synthesize
    // a "Deploy X" entry so it lands in Quick Tech.
    actionsFull: [
      ...acts.map((a) => ({
        name: a.name || data.name || fallbackName,
        activation: String(a.activation || "").trim(),
        detail: effectText(a.detail || a.description || ""),
      })),
      ...(Array.isArray(data.deployables) ? data.deployables : []).map((dep) => ({
        name: `Deploy ${dep.name || data.name || fallbackName}`,
        activation: dep.activation || "Quick",
        detail: effectText(dep.detail || data.effect || ""),
      })),
    ],
  };
}

// ---- talents ------------------------------------------------------------------
// pilotTalents: [{ id, rank }] → [{ id, name, rank, description }]
// Title-case a name that's entirely lowercase (an id-derived fallback such as
// "iconoclast" from a content pack COMP/CON didn't embed). Properly-cased
// compendium names ("Technophile", "HEXED") are left untouched.
const fixCase = (s) => {
  const str = String(s || "");
  return str && str === str.toLowerCase()
    ? str.replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    : str;
};

export function resolveTalents(pilotTalents) {
  return (pilotTalents || []).map((t) => {
    const data = t.data || findTalent(t.id);
    const fallbackName = (t.id || "").replace(/^t_/, "").replace(/_/g, " ") || "Talent";
    const name = fixCase(data?.name || fallbackName);
    const ranks = Array.isArray(data?.ranks) ? data.ranks : [];
    const owned = ranks.slice(0, Math.max(1, t.rank));
    // Tech actions this talent grants (Mimetic Spark, etc.) for the TECHS tab.
    const actions = [];
    owned.forEach((r) => {
      for (const a of (r.actions || [])) {
        actions.push({
          name: a.name || r.name || name,
          activation: String(a.activation || "").trim(),
          detail: effectText(a.detail || a.description || a.effect || ""),
        });
      }
    });
    const description = owned
      .map((r, i) => `${"I".repeat(i + 1)} — ${r.name || ""}: ${effectText(r.description || r.effect || "")}`)
      .join("  •  ");
    return { id: t.id, name, rank: t.rank, description: data ? description : "", actions };
  });
}

// ---- frame core system ----------------------------------------------------------
// Returns { name, activation, description } for the CORE bar tooltip.
export function coreInfo(frame) {
  const c = frame?.core_system;
  if (!c) return null;
  const bits = [];
  if (c.passive_name || c.passive_effect) {
    bits.push(`PASSIVE${c.passive_name ? ` (${c.passive_name})` : ""}: ${effectText(c.passive_effect || "")}`);
  }
  if (c.active_name || c.active_effect) {
    bits.push(`ACTIVE${c.active_name ? ` (${c.active_name})` : ""}: ${effectText(c.active_effect || "")}`);
  }
  if (!bits.length && c.description) bits.push(effectText(c.description));
  return {
    name: c.name || "Core System",
    activation: c.activation || "",
    description: bits.join("  •  ") || effectText(c.description || ""),
  };
}

// Weapon mod hanging off a mount slot. Returns null when the slot has no mod.
export function resolveMod(ref) {
  if (!ref) return null;
  const r = typeof ref === "string" ? { id: ref, data: null } : ref;
  const id = r.id || r.data?.id || "";
  if (!id && !(r.data && r.data.id)) return null;
  const data = r.data || findMod(id);
  const fallback = (id || "").replace(/^wm_/, "").replace(/_/g, " ") || "Weapon Mod";
  if (!data) return { id, name: fallback, sp: null, effect: "", addedDamage: [], addedTags: [], rawAddedTags: [], actions: [] };
  return {
    id,
    name: data.name || fallback,
    sp: data.sp ?? null,
    effect: [effectText(data.effect), effectText(data.description)].filter(Boolean).join("  •  "),
    addedDamage: Array.isArray(data.added_damage) ? data.added_damage : [],
    addedRange: Array.isArray(data.added_range) ? data.added_range : [],
    addedTags: (data.added_tags || []).map((t) => t.id || t),
    rawAddedTags: Array.isArray(data.added_tags) ? data.added_tags : [],
    actions: (Array.isArray(data.actions) ? data.actions : []).map((a) => ({
      name: a.name || data.name || fallback,
      activation: String(a.activation || "").trim(),
      detail: effectText(a.detail || a.description || ""),
    })),
  };
}

// Accepts either a normalised { id, data, selectedProfile } ref or a bare id.
export function resolveWeapon(ref) {
  const r = typeof ref === "string" ? { id: ref, data: null } : ref || {};
  const id = r.id || r.data?.id || "";
  let w = r.data || findWeapon(id);
  if (!w) {
    return {
      id, name: id.replace(/^mw_/, "").replace(/_/g, " ") || "Weapon",
      range: 5, threat: 0, blast: 0, cone: 0, line: 0, burst: 0,
      damage: "-", icon: "rifle", overkill: false, loading: false,
    };
  }
  // Multi-profile weapons store range/damage/tags under the selected profile.
  if (Array.isArray(w.profiles) && w.profiles.length) {
    const prof = w.profiles[r.selectedProfile || 0] || w.profiles[0];
    w = { ...w, ...prof, name: w.name };
  }
  let range = 0, threat = 0, blast = 0, cone = 0, line = 0, burst = 0;
  for (const rg of w.range || []) {
    const v = Number(rg.val) || 0;
    const t = String(rg.type || "").toLowerCase();
    if (t === "range") range = v;
    else if (t === "threat") threat = v;
    else if (t === "blast") blast = v;
    else if (t === "cone") cone = v;
    else if (t === "line") line = v;
    else if (t === "burst") burst = v;
  }
  // A weapon mod can add damage dice, tags AND range — fold them all in.
  const mod = resolveMod(r.mod);
  if (mod && mod.addedRange.length) {
    for (const rg of mod.addedRange) {
      const v = Number(rg.val) || 0;
      const t = String(rg.type || "").toLowerCase();
      if (t === "range") range += v;
      else if (t === "threat") threat += v;
      else if (t === "blast") blast += v;
      else if (t === "cone") cone += v;
      else if (t === "line") line += v;
      else if (t === "burst") burst += v;
    }
  }
  const dmgList = [...(w.damage || []), ...(mod ? mod.addedDamage : [])];
  const damage = dmgList
    .map((d) => `${d.val ?? d.override ?? "?"} ${String(d.type || "").slice(0, 3)}`)
    .join(" + ") || "-";
  const tags = [...(w.tags || []).map((t) => t.id || t), ...(mod ? mod.addedTags : [])];
  // human-readable tag names for the hover tooltip
  const tagNames = tags.map((t) =>
    String(t).replace(/^tg_/, "").replace(/_/g, " ").toUpperCase()
  );
  // Reliable carries its value on the tag instance (weapon or mod).
  const rawTags = [...(w.tags || []), ...(mod ? mod.rawAddedTags : [])];
  const reliableTag = rawTags.find((t) => (t.id || t) === "tg_reliable");
  const reliable = reliableTag ? (Number(reliableTag.val) || 0) : 0;
  const effect = [
    effectText(w.effect),
    w.on_attack ? `ON ATTACK: ${effectText(w.on_attack)}` : "",
    w.on_hit ? `ON HIT: ${effectText(w.on_hit)}` : "",
    w.on_crit ? `ON CRIT: ${effectText(w.on_crit)}` : "",
    effectText(w.description),
  ].filter(Boolean).join("  •  ");
  return {
    id, name: w.name, mountSize: w.mount, type: w.type,
    range, threat, blast, cone, line, burst, damage,
    damageTypes: dmgList.map((d) => String(d.type || "")).filter(Boolean),
    overkill: tags.includes("tg_overkill"),
    loading: tags.includes("tg_loading"),
    accurate: tags.includes("tg_accurate"),
    inaccurate: tags.includes("tg_inaccurate"),
    reliable,
    // free / reactionary weapons get an empty-hex icon and a plaque in the TECHS
    // tab: Autopod fires as a Reaction, Autogun as a Free action.
    free: /autopod|autogun|free action|as a free|as a reaction/i.test(`${w.name || ""} ${effectText(w.effect)}`),
    freeKind: (() => {
      const s = `${w.name || ""} ${effectText(w.effect)}`.toLowerCase();
      if (/autopod|as a reaction|\breaction\b/.test(s)) return "reaction";
      if (/autogun|free action|as a free/.test(s)) return "free";
      return null;
    })(),
    mod,
    tagNames,
    effect,
    icon: weaponIcon(w),
  };
}

function weaponIcon(w) {
  const t = `${w.type || ""} ${w.name || ""}`.toLowerCase();
  if (t.includes("melee") || t.includes("blade") || t.includes("hammer") || t.includes("axe")) return "melee";
  if (t.includes("launcher") || t.includes("missile") || t.includes("rocket")) return "launcher";
  if (t.includes("cannon") || t.includes("howitzer") || t.includes("mortar")) return "cannon";
  if (t.includes("nexus") || t.includes("drone")) return "nexus";
  if (t.includes("cqb") || t.includes("shotgun") || t.includes("pistol")) return "cqb";
  return "rifle";
}

// Manual fallback when no file / compendium is available.
export function manualMech(values) {
  return {
    name: values.name || "MANUAL UNIT",
    stats: {
      frameName: values.frameName || "MANUAL ENTRY",
      size: 1,
      hpMax: values.hp ?? 10, armor: values.armor ?? 0,
      structureMax: 4, stressMax: 4,
      heatMax: values.heat ?? 6, repMax: values.rep ?? 4,
      evasion: values.evasion ?? 8, edef: values.edef ?? 8,
      speed: values.speed ?? 4, sensors: values.sensors ?? 10,
      techAttack: values.tech ?? 0, save: 10,
      attackBonus: values.grit ?? 0, coreMax: 1,
    },
    mounts: [{
      label: "MOUNT 1",
      weapons: [{ id: "manual", name: values.weaponName || "Weapon", range: values.range ?? 10, threat: 1, blast: 0, cone: 0, line: 0, burst: 0, damage: "-", overkill: false, icon: "rifle" }],
    }],
    systems: [],
    current: {},
  };
}
