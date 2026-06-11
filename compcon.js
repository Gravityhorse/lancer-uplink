// compcon.js - parses COMP/CON pilot exports and resolves frame/weapon IDs
// against Massif Press's open `lancer-data` compendium (fetched from a CDN,
// cached in memory). Also computes derived mech stats per Lancer core rules.

const DATA_SOURCES = [
  "https://cdn.jsdelivr.net/npm/lancer-data/lib",
  "https://unpkg.com/lancer-data/lib",
];

const compendium = { frames: null, weapons: null, systems: null, talents: null, loaded: false };

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
  const [frames, weapons, systems, talents] = await Promise.all([
    fetchJson("frames.json"),
    fetchJson("weapons.json"),
    fetchJson("systems.json"),
    fetchJson("talents.json"),
  ]);
  compendium.frames = frames || [];
  compendium.weapons = weapons || [];
  compendium.systems = systems || [];
  compendium.talents = talents || [];
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
      .map((s) => normEquip(s?.weapon))
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
    // COMP/CON talents: [{ id, rank }] (older exports may use bare ids)
    talents: (p.talents || []).map((t) =>
      typeof t === "string" ? { id: t, rank: 1 } : { id: t.id || "", rank: Number(t.rank ?? 1) }
    ).filter((t) => t.id),
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

export function resolveMech(mechRaw, pilot) {
  // Prefer the frame embedded in the export; fall back to the CDN compendium.
  const frame = mechRaw.frameData || findFrame(mechRaw.frameId);
  const fs = frame?.stats || {};
  const { hull, agi, sys, eng } = pilot.hase;
  const grit = pilot.grit;

  // Resolve systems first — some grant stat bonuses (e.g. Personalizations: +2 HP).
  const systems = mechRaw.systems
    .map((s) => resolveSystem(s))
    .filter(Boolean)
    .slice(0, 24);
  const hasPersonalizations = systems.some(
    (x) => (x.id || "").includes("personalizations") || /personalizations/i.test(x.name || "")
  );
  const hpBonus = hasPersonalizations ? 2 : 0;

  const stats = {
    frameName: frame
      ? `${frame.source || ""} ${frame.name || ""}`.trim()
      : mechRaw.frameId || "UNKNOWN FRAME",
    size: fs.size ?? 1,
    hpMax: (fs.hp ?? 8) + grit + hull * 2 + hpBonus,
    armor: fs.armor ?? 0,
    structureMax: fs.structure ?? 4,
    stressMax: fs.stress ?? 4,
    heatMax: (fs.heatcap ?? 6) + eng,
    repMax: (fs.repcap ?? 4) + Math.floor(hull / 2),
    evasion: (fs.evasion ?? 8) + agi,
    edef: fs.edef ?? 8,
    speed: (fs.speed ?? 4) + Math.floor(agi / 2),
    sensors: fs.sensor_range ?? 10,
    techAttack: (fs.tech_attack ?? 0) + sys,
    save: (fs.save ?? 10) + grit,
    attackBonus: grit,
    coreMax: 1,
  };

  const mounts = mechRaw.mounts.map((mt, i) => ({
    label: mt.type ? `${mt.type.toUpperCase()} MOUNT` : `MOUNT ${i + 1}`,
    weapons: mt.weapons.map(resolveWeapon).filter(Boolean),
  }));

  return { name: mechRaw.name, stats, mounts, systems, current: mechRaw.current, frame };
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
  if (!data) return { id, name: fallbackName, sp: null, activation: "", description: "" };

  const acts = Array.isArray(data.actions) ? data.actions : [];
  const activation = acts
    .map((a) => String(a.activation || "").trim())
    .filter(Boolean)
    .join(" / ");
  const description = [effectText(data.effect), effectText(data.description)]
    .filter(Boolean)
    .join(" — ");
  return {
    id,
    name: data.name || fallbackName,
    sp: data.sp ?? null,
    activation,
    description,
    // full action list, so Invade options granted by systems can be surfaced
    actionsFull: acts.map((a) => ({
      name: a.name || data.name || fallbackName,
      activation: String(a.activation || "").trim(),
      detail: effectText(a.detail || a.description || ""),
    })),
  };
}

// ---- talents ------------------------------------------------------------------
// pilotTalents: [{ id, rank }] → [{ id, name, rank, description }]
export function resolveTalents(pilotTalents) {
  return (pilotTalents || []).map((t) => {
    const data = findTalent(t.id);
    const fallbackName = (t.id || "").replace(/^t_/, "").replace(/_/g, " ") || "Talent";
    if (!data) return { id: t.id, name: fallbackName, rank: t.rank, description: "" };
    const ranks = Array.isArray(data.ranks) ? data.ranks : [];
    const owned = ranks.slice(0, Math.max(1, t.rank));
    const description = owned
      .map((r, i) => `${"I".repeat(i + 1)} — ${r.name || ""}: ${effectText(r.description || r.effect || "")}`)
      .join("  •  ");
    return { id: t.id, name: data.name || fallbackName, rank: t.rank, description };
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
  const damage = (w.damage || [])
    .map((d) => `${d.val ?? d.override ?? "?"} ${String(d.type || "").slice(0, 3)}`)
    .join(" + ") || "-";
  const tags = (w.tags || []).map((t) => t.id || t);
  // human-readable tag names for the hover tooltip
  const tagNames = tags.map((t) =>
    String(t).replace(/^tg_/, "").replace(/_/g, " ").toUpperCase()
  );
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
    overkill: tags.includes("tg_overkill"),
    loading: tags.includes("tg_loading"),
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
