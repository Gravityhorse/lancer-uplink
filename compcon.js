// compcon.js - parses COMP/CON pilot exports and resolves frame/weapon IDs
// against Massif Press's open `lancer-data` compendium (fetched from a CDN,
// cached in memory). Also computes derived mech stats per Lancer core rules.

const DATA_SOURCES = [
  "https://cdn.jsdelivr.net/npm/lancer-data/lib",
  "https://unpkg.com/lancer-data/lib",
];

const compendium = { frames: null, weapons: null, systems: null, loaded: false };

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
  const [frames, weapons, systems] = await Promise.all([
    fetchJson("frames.json"),
    fetchJson("weapons.json"),
    fetchJson("systems.json"),
  ]);
  compendium.frames = frames || [];
  compendium.weapons = weapons || [];
  compendium.systems = systems || [];
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

// ---- pilot file parsing -----------------------------------------------------

// Pull a single pilot object out of whatever COMP/CON handed us.
//   - Modern export: { EXPORT_TYPE: "PILOT", data: <pilot> }   (the common case)
//   - Roster / bulk : { pilots: [<pilot>, ...] }  or  [<pilot>, ...]
//   - Legacy        : the pilot object at the top level, or { pilot: <pilot> }
function unwrapPilot(json) {
  let root = json;
  // COMP/CON's own importer: if EXPORT_TYPE is set, the payload is under `data`.
  if (root && typeof root === "object" && root.EXPORT_TYPE && "data" in root) {
    root = root.data;
  }
  if (Array.isArray(root)) return root[0];
  if (root && typeof root === "object") {
    if (Array.isArray(root.pilots)) return root.pilots[0];
    if (root.pilot) return root.pilot;
  }
  return root;
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
      p && typeof p === "object" ? Object.keys(p).slice(0, 12).join(", ") : typeof p;
    throw new Error(
      `This doesn't look like a COMP/CON pilot export. (found: ${keys})`
    );
  }
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

  const systems = mechRaw.systems
    .map((s) => {
      const data = s.data || findSystem(s.id);
      return (
        data?.name ||
        (s.id || "").replace(/^ms_/, "").replace(/_/g, " ")
      );
    })
    .slice(0, 12);

  return { name: mechRaw.name, stats, mounts, systems, current: mechRaw.current, frame };
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
  // Multi-profile weapons // compcon.js — parses COMP/CON pilot exports and resolves frame/weapon IDs
// against Massif Press's open `lancer-data` compendium (fetched from a CDN,
// cached in memory). Also computes derived mech stats per Lancer core rules.

const DATA_SOURCES = [
  "https://cdn.jsdelivr.net/npm/lancer-data/lib",
  "https://unpkg.com/lancer-data/lib",
];

const compendium = { frames: null, weapons: null, systems: null, loaded: false };

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
  onStatus?.("Downloading compendium…");
  const [frames, weapons, systems] = await Promise.all([
    fetchJson("frames.json"),
    fetchJson("weapons.json"),
    fetchJson("systems.json"),
  ]);
  compendium.frames = frames || [];
  compendium.weapons = weapons || [];
  compendium.systems = systems || [];
  compendium.loaded = !!(frames && weapons);
  onStatus?.(compendium.loaded ? "Compendium online." : "Compendium offline — manual mode available.");
  return compendium;
}

export const findFrame = (id) =>
  compendium.frames?.find((f) => f.id === id) || null;
export const findWeapon = (id) =>
  compendium.weapons?.find((w) => w.id === id) || null;
export const findSystem = (id) =>
  compendium.systems?.find((s) => s.id === id) || null;

// ---- pilot file parsing -----------------------------------------------------

// COMP/CON's export shape has shifted between versions; parse defensively.
export function parsePilotFile(json) {
  // Some exports wrap the pilot; some are the pilot object directly.
  const p = json?.pilot || (Array.isArray(json) ? json[0] : json);
  if (!p || (!p.callsign && !p.name && !p.mechs)) {
    throw new Error("This doesn't look like a COMP/CON pilot export.");
  }
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
  };

  const mechs = (p.mechs || []).map((m) => {
    const loadout =
      (m.loadouts && (m.loadouts[m.active_loadout_index ?? 0] || m.loadouts[0])) ||
      m.loadout || {};
    const mounts = [];
    for (const mt of loadout.mounts || []) {
      const slots = [
        ...(mt.slots || []),
        ...(mt.extra || []),
      ];
      const weapons = slots
        .map((s) => s?.weapon?.id || s?.weapon)
        .filter((id) => typeof id === "string");
      mounts.push({ type: mt.mount_type || mt.type || "Mount", weaponIds: weapons });
    }
    const systems = (loadout.systems || [])
      .map((s) => s?.id || s)
      .filter((id) => typeof id === "string");
    return {
      name: m.name || "Mech",
      frameId: m.frame || m.frame_id || "",
      mounts,
      systemIds: systems,
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
  const frame = findFrame(mechRaw.frameId);
  const fs = frame?.stats || {};
  const { hull, agi, sys, eng } = pilot.hase;
  const grit = pilot.grit;

  const stats = {
    frameName: frame ? `${frame.source} ${frame.name}` : mechRaw.frameId || "UNKNOWN FRAME",
    size: fs.size ?? 1,
    hpMax: (fs.hp ?? 8) + grit + hull * 2,
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
    weapons: mt.weaponIds.map(resolveWeapon).filter(Boolean),
  }));

  const systems = mechRaw.systemIds
    .map((id) => findSystem(id)?.name || id.replace(/^ms_/, "").replace(/_/g, " "))
    .slice(0, 12);

  return { name: mechRaw.name, stats, mounts, systems, current: mechRaw.current, frame };
}

export function resolveWeapon(id) {
  const w = findWeapon(id);
  if (!w) {
    return { id, name: id.replace(/^mw_/, "").replace(/_/g, " "), range: 5, threat: 1, damage: "?", icon: "rifle", overkill: false };
  }
  let range = 0, threat = 0, blast = 0, cone = 0, line = 0, burst = 0;
  for (const r of w.range || []) {
    const v = Number(r.val) || 0;
    const t = String(r.type || "").toLowerCase();
    if (t === "range") range = v;
    else if (t === "threat") threat = v;
    else if (t === "blast") blast = v;
    else if (t === "cone") cone = v;
    else if (t === "line") line = v;
    else if (t === "burst") burst = v;
  }
  const damage = (w.damage || [])
    .map((d) => `${d.val} ${String(d.type || "").slice(0, 3)}`)
    .join(" + ") || "—";
  const tags = (w.tags || []).map((t) => t.id || t);
  return {
    id, name: w.name, mountSize: w.mount, type: w.type,
    range, threat, blast, cone, line, burst, damage,
    overkill: tags.includes("tg_overkill"),
    loading: tags.includes("tg_loading"),
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
      weapons: [{ id: "manual", name: values.weaponName || "Weapon", range: values.range ?? 10, threat: 1, blast: 0, cone: 0, line: 0, burst: 0, damage: "—", overkill: false, icon: "rifle" }],
    }],
    systems: [],
    current: {},
  };
}
