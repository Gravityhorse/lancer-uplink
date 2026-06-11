// main.js — wires the whole LANCER//UPLINK popover together.
//
//   • COMP/CON pilot import (persisted in localStorage) + resolved mech sheet
//   • One unified 3D dice system: picker, modifiers, weapon ATK / ⬢ lock →
//     FIRE chain (with crit doubling), tech attacks, Overkill chains with
//     heat auto-apply, broadcast replays
//   • Template tool (registered immediately; grid calibrates when the scene
//     is ready) + token bond so range fields follow your mech
//   • Reactor management: HP↘0 → structure, Heat over cap → stress, with an
//     optional auto structure/overheat table macro
//   • MISSION//CONTROL — a GM view fed by live squad telemetry broadcasts
//
// Lancer rules note: GRIT applies to attack rolls only, never to damage.

import { OBR, CH_ROLL3D, CH_STATUS } from "./sdk.js";
import * as hex from "./hex.js";
import * as tool from "./tool.js";
import {
  clearMyTemplates,
  clearLocalTemplates,
  clearAllLocalOverlays,
  clearLocalOverlay,
  showLocalOverlay,
  showBoostField,
  clearBoostField,
} from "./overlay.js";
import {
  loadCompendium, listPilots, parsePilot, resolveMech,
  resolveTalents, coreInfo,
} from "./compcon.js";
// dice3d.js (three + cannon-es from CDN) loads lazily the first time the DICE
// tab opens, so a CDN hiccup never bricks the pilot/template UI.

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
function setStatus(msg, cls = "") {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = cls;
}

let myName = "You";
let obrReady = false;

// ---- action-economy icons: full hexagon = Full Action, half = Quick ----------
const ICON_FULL = `<svg class="acticon" viewBox="0 0 20 20" aria-label="Full action"><polygon points="10,1.5 17.5,5.75 17.5,14.25 10,18.5 2.5,14.25 2.5,5.75" fill="currentColor"/></svg>`;
const ICON_QUICK = `<svg class="acticon" viewBox="0 0 20 20" aria-label="Quick action"><polygon points="10,1.5 17.5,5.75 17.5,14.25 10,18.5 2.5,14.25 2.5,5.75" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 1.5 L2.5 5.75 L2.5 14.25 L10 18.5 Z" fill="currentColor"/></svg>`;

// ============================================================ PERSISTENCE =====
const STORE_KEY = "lancer-uplink/state/v2";
let restoreLive = null;     // saved live reactor state applied on first render
let restoreMechIdx = null;
let saveTimer = 0;

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null") || {}; }
  catch (_) { return {}; }
}
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        pilot: curRawPilot || null,
        mechIdx: curMechIdx,
        live,
        scheme: $("scheme")?.value || null,
        vis: tool.getTemplateVisibility(),
        gridMode: $("grid-mode")?.value || "auto",
        cellSize: hex.grid.cellOverride,
        macro: $("macro-toggle")?.checked || false,
        bond,
      }));
    } catch (_) { /* storage may be unavailable in some embeds */ }
  }, 250);
}
function forgetState() {
  try { localStorage.removeItem(STORE_KEY); } catch (_) {}
}

// ================================================================ TAB NAV =====
document.querySelectorAll("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll("nav.tabs button").forEach((b) =>
      b.classList.toggle("active", b === btn)
    );
    document.querySelectorAll(".tabpane").forEach((t) =>
      t.classList.toggle("active", t.id === `tab-${tab}`)
    );
    if (tab === "dice") ensureDiceTray();
  });
});
const diceTabActive = () =>
  document.getElementById("tab-dice")?.classList.contains("active") && !gmMode;

function switchToDiceTab() {
  document.querySelector('nav.tabs button[data-tab="dice"]')?.click();
}

// ====================================================== MISSION//CONTROL ======
let gmMode = false;
const squad = new Map(); // who -> last status payload

$("hdr-icon")?.addEventListener("click", () => setGmMode(!gmMode));

function setGmMode(on) {
  gmMode = on;
  $("hdr-icon")?.classList.toggle("rot", on);
  const t = $("hdr-title");
  if (t) {
    t.classList.toggle("gm", on);
    t.innerHTML = on
      ? 'MISSION<span class="slash">//</span>CONTROL'
      : 'LANCER<span class="slash">//</span>UPLINK';
  }
  $("player-main")?.classList.toggle("hidden", on);
  $("tabnav")?.classList.toggle("hidden", on);
  $("gm-pane")?.classList.toggle("active", on);
  if (on) {
    renderGM();
    requestSquadStatus();
  }
}

function requestSquadStatus() {
  if (!obrReady) return;
  try { OBR.broadcast.sendMessage(CH_STATUS, { type: "req" }, { destination: "REMOTE" }); }
  catch (_) {}
}

let statusTimer = 0;
function broadcastStatus() {
  if (!obrReady || !currentMech || !currentPilot || !live) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    const s = currentMech.stats;
    try {
      OBR.broadcast.sendMessage(CH_STATUS, {
        type: "status",
        who: myName,
        callsign: currentPilot.callsign,
        pilot: currentPilot.name,
        ll: currentPilot.level,
        mech: currentMech.name,
        frame: s.frameName,
        live: { ...live },
        stats: {
          hpMax: s.hpMax, heatMax: s.heatMax,
          structureMax: s.structureMax, stressMax: s.stressMax,
          repMax: s.repMax, coreMax: s.coreMax,
          evasion: s.evasion, edef: s.edef, armor: s.armor, save: s.save,
          speed: s.speed, sensors: s.sensors, techAttack: s.techAttack, size: s.size,
        },
        ts: Date.now(),
      }, { destination: "REMOTE" });
    } catch (_) {}
  }, 400);
}

function renderGM() {
  const wrap = $("squad");
  if (!wrap) return;
  const entries = [...squad.values()].sort((a, b) => (a.callsign || "").localeCompare(b.callsign || ""));
  if (!entries.length) {
    wrap.innerHTML = `<div class="gm-empty">NO TELEMETRY YET.<br/>Players need their LANCER//UPLINK panel open with a pilot loaded.</div>`;
    return;
  }
  wrap.innerHTML = "";
  const now = Date.now();
  for (const e of entries) {
    const st = e.stats || {}, lv = e.live || {};
    const bar = (cur, max, cls = "") => {
      const pct = max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
      return `<div class="lc-bar ${cls}"><div class="fill" style="width:${pct}%"></div></div>`;
    };
    const pips = (cur, max) => "◆".repeat(Math.max(0, cur)) + "◇".repeat(Math.max(0, (max || 0) - (cur || 0)));
    const card = document.createElement("div");
    card.className = `lancer-card${now - (e.ts || 0) > 60000 ? " lc-stale" : ""}`;
    card.innerHTML = `
      <div class="lc-head">
        <span class="lc-callsign">${e.callsign || "PILOT"}</span>
        <span class="lc-mech">${e.mech || ""} · ${e.frame || ""}</span>
        <span class="lc-player">${e.who || ""} · LL${e.ll ?? "?"}</span>
      </div>
      <div class="lc-bars">
        <div class="lc-barrow"><span class="k">HP</span>${bar(lv.hp, st.hpMax)}<span class="v">${lv.hp ?? "?"}/${st.hpMax ?? "?"}${lv.overshield ? ` (+${lv.overshield})` : ""}</span></div>
        <div class="lc-barrow"><span class="k">HEAT</span>${bar(lv.heat, st.heatMax, "heat")}<span class="v">${lv.heat ?? "?"}/${st.heatMax ?? "?"}</span></div>
      </div>
      <div class="lc-pips">
        <span>STRUCT <b>${pips(lv.structure, st.structureMax)}</b></span>
        <span>STRESS <b>${pips(lv.stress, st.stressMax)}</b></span>
        <span>REP <b>${lv.repairs ?? "?"}/${st.repMax ?? "?"}</b></span>
        <span>CORE <b>${lv.core ?? "?"}</b></span>
      </div>
      <div class="lc-detail">
        <div class="lc-pips" style="padding:0">
          <span>EVA <b>${st.evasion ?? "?"}</b></span><span>E-DEF <b>${st.edef ?? "?"}</b></span>
          <span>ARMOR <b>${st.armor ?? "?"}</b></span><span>SAVE <b>${st.save ?? "?"}</b></span>
          <span>SPD <b>${st.speed ?? "?"}</b></span><span>SENS <b>${st.sensors ?? "?"}</b></span>
          <span>TECH <b>${st.techAttack >= 0 ? "+" : ""}${st.techAttack ?? "?"}</b></span>
          <span>SIZE <b>${st.size ?? "?"}</b></span>
        </div>
      </div>`;
    card.addEventListener("click", () => card.classList.toggle("open"));
    wrap.appendChild(card);
  }
}

// ============================================================ PILOT IMPORT ====
let currentPilot = null;
let currentMechs = [];
let currentMech = null;     // resolved mech (stats/mounts/systems)
let curRawPilot = null;     // raw pilot object — what gets persisted
let curMechIdx = 0;
let rosterPilots = [];

$("pilotfile").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  setStatus(`Reading ${file.name}…`);
  try {
    const json = JSON.parse(await file.text());
    await importPilots(listPilots(json), json);
  } catch (err) {
    console.error("[LANCER//UPLINK] import failed", err);
    setStatus(`Import failed: ${err.message || err}`, "status-err");
  }
});

async function importPilots(pilots, json) {
  rosterPilots = pilots;
  if (!rosterPilots.length) {
    const keys =
      json && typeof json === "object"
        ? Object.keys(json).slice(0, 12).join(", ")
        : typeof json;
    throw new Error(
      `No pilots found in this file (top-level keys: ${keys}). ` +
      `Export from COMP/CON via Pilot Roster → your pilot → Export.`
    );
  }
  setStatus("Loading LANCER compendium…");
  await loadCompendium((s) => setStatus(s));

  const psel = $("pilotselect");
  if (psel) {
    psel.innerHTML = "";
    rosterPilots.forEach((p, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${p.callsign || "PILOT"} — ${p.name || `Pilot ${i + 1}`}`;
      psel.appendChild(o);
    });
    $("pilotpicker")?.classList.toggle("hidden", rosterPilots.length < 2);
  }
  selectPilot(0);
}

$("pilotselect")?.addEventListener("change", (e) => selectPilot(Number(e.target.value)));

function selectPilot(idx) {
  const raw = rosterPilots[idx];
  if (!raw) return;
  try {
    const { pilot, mechs } = parsePilot(raw);
    currentPilot = pilot;
    currentMechs = mechs;
    curRawPilot = raw;

    const sel = $("mechselect");
    sel.innerHTML = "";
    mechs.forEach((m, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = m.name || `Mech ${i + 1}`;
      sel.appendChild(o);
    });
    $("mechpicker").classList.toggle("hidden", mechs.length < 2);

    if (!mechs.length) {
      $("sheet").classList.add("hidden");
      setStatus(`${pilot.callsign} has no mechs in this export.`, "status-err");
      return;
    }
    let activeIdx = Math.max(0, mechs.findIndex((m) => m.active));
    if (restoreMechIdx != null && mechs[restoreMechIdx]) {
      activeIdx = restoreMechIdx;
      restoreMechIdx = null;
    }
    sel.value = String(activeIdx);
    renderMech(activeIdx);
    $("sec-import")?.removeAttribute("open");
    $("forgetpilot")?.classList.remove("hidden");
    setStatus(`Loaded ${pilot.callsign} — “${pilot.name}”.`, "status-ok");
  } catch (err) {
    console.error("[LANCER//UPLINK] pilot parse failed", err);
    setStatus(`Import failed: ${err.message || err}`, "status-err");
  }
}

$("mechselect").addEventListener("change", (e) => renderMech(Number(e.target.value)));

$("forgetpilot")?.addEventListener("click", () => {
  forgetState();
  curRawPilot = null;
  setStatus("Saved pilot forgotten. It won't auto-load next time.", "status-ok");
});

// ---- live reactor state -------------------------------------------------------
let live = null;

function initLive(m) {
  const s = m.stats, cur = m.current || {};
  const pick = (v, max) => (v == null || Number.isNaN(Number(v)) ? max : Number(v));
  live = {
    hp: pick(cur.hp, s.hpMax),
    heat: pick(cur.heat, 0) || 0,
    structure: pick(cur.structure, s.structureMax),
    stress: pick(cur.stress, s.stressMax),
    repairs: pick(cur.repairs, s.repMax),
    core: pick(cur.core, s.coreMax),
    overshield: pick(cur.overshield, 0) || 0,
  };
  if (restoreLive) {
    live = { ...live, ...restoreLive };
    restoreLive = null;
  }
}

function onLiveChanged() {
  if (!currentMech) return;
  renderCC(currentMech.stats);
  renderStatGrid(currentMech.stats);
  saveState();
  broadcastStatus();
}

function renderMech(idx) {
  const raw = currentMechs[idx];
  if (!raw || !currentPilot) return;
  const m = resolveMech(raw, currentPilot);
  currentMech = m;
  curMechIdx = idx;
  const s = m.stats;
  initLive(m);

  $("m-name").textContent = m.name || "MECH";
  $("m-frame").textContent = s.frameName;
  $("m-size").textContent = `SIZE ${s.size}`;
  $("m-pilot").textContent =
    `${currentPilot.callsign} · ${currentPilot.name} · LL${currentPilot.level} · ` +
    `H${currentPilot.hase.hull} A${currentPilot.hase.agi} S${currentPilot.hase.sys} E${currentPilot.hase.eng} · GRIT +${currentPilot.grit}`;

  renderMobility(s);
  renderCC(s);
  renderStatGrid(s);
  renderMounts(m);
  renderTechCard(s);
  renderInvades(m);
  renderSystems(m);
  renderTalentChips();

  $("sheet").classList.remove("hidden");
  saveState();
  broadcastStatus();
}

// =========================================================== RANGE FIELDS =====
// MOVE / BOOST / SENSORS. With a bonded token they centre on it instantly and
// follow it; without one they arm the click-to-place tool. Click again to clear.
// Boost shows DOUBLE the speed with a strong boundary where standard move ends.

let bond = null;            // { id, name }
let activeFields = {};      // kind -> { size, boost }
let followTimer = 0;

function updateBondUI() {
  const el = $("bond-status");
  if (!el) return;
  el.textContent = bond
    ? `BONDED: ${bond.name || bond.id} — fields snap to this token and follow it.`
    : "UNBONDED — fields are placed by clicking the map.";
  el.classList.toggle("on", !!bond);
}

async function getBondItem() {
  if (!bond || !obrReady) return null;
  try {
    const items = await OBR.scene.items.getItems([bond.id]);
    return items[0] || null;
  } catch (_) { return null; }
}

$("btn-bond")?.addEventListener("click", async () => {
  if (!obrReady) return setStatus("Owlbear link not ready.", "status-err");
  try {
    const sel = await OBR.player.getSelection();
    if (!sel || !sel.length) {
      return setStatus("Select your mech's token on the map first, then bond it.", "status-err");
    }
    const items = await OBR.scene.items.getItems([sel[0]]);
    bond = { id: sel[0], name: items[0]?.name || items[0]?.text?.plainText || "token" };
    updateBondUI();
    saveState();
    setStatus(`Bonded to "${bond.name}".`, "status-ok");
  } catch (e) {
    setStatus("Could not read the selection — open a scene first.", "status-err");
  }
});

$("btn-unbond")?.addEventListener("click", async () => {
  bond = null;
  updateBondUI();
  saveState();
  for (const kind of Object.keys(activeFields)) await removeField(kind);
});

const fieldColor = (kind) =>
  kind === "sensors" ? "#3da5ff" : kind === "weapon" ? "#d22f3d" : "#5ad17a";

async function placeFieldAt(kind, center, size, boost, label) {
  if (boost) {
    await showBoostField("field-boost", center, size, { color: fieldColor(kind), name: `Boost ${size}` });
  } else {
    await showLocalOverlay(`field-${kind}`, hex.hexesInRange(center, size, true), {
      color: fieldColor(kind),
      fillOpacity: 0.18, strokeOpacity: 0.85, strokeWidth: 3,
      name: label || `${kind === "sensors" ? "Sensors" : kind === "weapon" ? "Range" : "Move"} ${size}`,
      kind: "range",
    });
  }
}

async function removeField(kind) {
  if (activeFields[kind]?.boost) await clearBoostField("field-boost");
  else await clearLocalOverlay(`field-${kind}`);
  delete activeFields[kind];
  markMobilityActive();
}

async function toggleField(kind, size, boost = false, label = null) {
  if (activeFields[kind]) { await removeField(kind); return; }
  const item = await getBondItem();
  if (item) {
    await placeFieldAt(kind, hex.pixelToHex(item.position), size, boost, label);
    activeFields[kind] = { size, boost };
    markMobilityActive();
    setStatus(`${kind.toUpperCase()} field on "${bond.name}". Click the button again to clear.`, "status-ok");
    return;
  }
  // no bond — fall back to click-to-place via the toolbar tool
  try {
    await tool.armTemplate({
      shape: kind === "sensors" ? "tech" : kind === "weapon" ? "weapon" : "move",
      size, boost,
      name: label || `${kind === "boost" ? "Boost" : kind === "sensors" ? "Sensors" : kind === "weapon" ? "Range" : "Move"} ${size}`,
    });
    setStatus(`Armed ${kind} (${size}${boost ? `+${size} boost` : ""}). Click your hex on the map — or bond a token in the MAP tab to skip this step.`, "status-ok");
  } catch (_) {
    setStatus("Template tool unavailable — open this panel inside an Owlbear scene.", "status-err");
  }
}

// MOVE button cycle: off → MOVE → MOVE+BOOST (double radius, boundary ring) → off
let moveState = 0; // 0 off, 1 move, 2 move+boost
async function cycleMove() {
  if (!currentMech) return setStatus("Load a pilot first.", "status-err");
  const speed = currentMech.stats.speed;
  if (activeFields.move) await removeField("move");
  if (activeFields.boost) await removeField("boost");
  moveState = (moveState + 1) % 3;
  if (moveState === 1) {
    await toggleField("move", speed);
  } else if (moveState === 2) {
    await toggleField("boost", speed, true);
  }
  markMobilityActive();
}

async function toggleSensors() {
  if (!currentMech) return setStatus("Load a pilot first.", "status-err");
  await toggleField("sensors", currentMech.stats.sensors);
}

function markMobilityActive() {
  const moveOn = !!(activeFields.move || activeFields.boost);
  document.querySelectorAll('[data-mob="move"]').forEach((b) => {
    b.classList.toggle("on", moveOn);
    const sm = b.querySelector("small");
    if (sm && currentMech) {
      const sp = currentMech.stats.speed;
      sm.textContent = moveState === 2 ? `BOOST ${sp}+${sp}` : `${sp} HEX`;
    }
  });
  document.querySelectorAll('[data-mob="sensors"]').forEach((b) => {
    b.classList.toggle("on", !!activeFields.sensors);
  });
}

// ---- MOVE & SENSORS row (above the stat blocks, below the name) --------------
function renderMobility(s) {
  const el = $("mobility");
  el.innerHTML = `
    <button class="mob-btn green" data-mob="move" title="Cycle: move → move+boost → off">MOVE<small>${s.speed} HEX</small></button>
    <button class="mob-btn blue" data-mob="sensors" title="Toggle sensor range">SENSORS<small>${s.sensors} HEX</small></button>`;
  el.querySelector('[data-mob="move"]').addEventListener("click", cycleMove);
  el.querySelector('[data-mob="sensors"]').addEventListener("click", toggleSensors);

  // mirror buttons on the MAP tab
  const mm = $("map-move"), ms = $("map-sensors");
  if (mm) {
    mm.disabled = false;
    mm.dataset.mob = "move";
    mm.innerHTML = `MOVE<small>${s.speed} HEX</small>`;
    mm.onclick = cycleMove;
  }
  if (ms) {
    ms.disabled = false;
    ms.dataset.mob = "sensors";
    ms.innerHTML = `SENSORS<small>${s.sensors} HEX</small>`;
    ms.onclick = toggleSensors;
  }
  markMobilityActive();
}

// ---- COMP/CON view: slanted segment bars --------------------------------------
$("btn-view-cc")?.addEventListener("click", () => setView("cc"));
$("btn-view-grid")?.addEventListener("click", () => setView("grid"));
function setView(which) {
  $("btn-view-cc")?.classList.toggle("sel", which === "cc");
  $("btn-view-grid")?.classList.toggle("sel", which === "grid");
  $("view-cc")?.classList.toggle("hidden", which !== "cc");
  $("view-grid")?.classList.toggle("hidden", which !== "grid");
}

function segBar(cur, max, color) {
  const n = Math.max(1, Math.min(24, max));
  let segs = "";
  for (let i = 0; i < n; i++) {
    segs += `<span class="seg ${i < cur ? "on" : ""}" style="--segc:${color}"></span>`;
  }
  return `<span class="segbar">${segs}</span>`;
}

function renderCC(s) {
  const el = $("view-cc");
  if (!el || !live) return;
  const row = (key, label, cur, max, color, help = false) => `
    <div class="ccrow" data-key="${key}">
      <span class="lbl${help ? " help" : ""}">${label}</span>
      <button class="pm" data-cc="${key}" data-d="-1">−</button>
      ${segBar(cur, max, color)}
      <button class="pm" data-cc="${key}" data-d="1">+</button>
      <span class="val">${cur}/${max}</span>
    </div>`;
  const pp = (key) =>
    `<button class="pp" data-pp="${key}" data-d="-1">−</button><button class="pp" data-pp="${key}" data-d="1">+</button>`;
  el.innerHTML =
    row("hp", "HP", live.hp, s.hpMax, "var(--hpblue)") +
    row("heat", "HEAT", live.heat, s.heatMax, "var(--heatred)") +
    row("repairs", "REPAIR", live.repairs, s.repMax, "var(--good)") +
    row("core", "CORE", live.core, s.coreMax, "var(--corewhite)", true) +
    `<div class="ccpips">
      <span>STRUCT <b>${"◆".repeat(live.structure)}${"◇".repeat(Math.max(0, s.structureMax - live.structure))}</b> ${pp("structure")}</span>
      <span>STRESS <b>${"◆".repeat(live.stress)}${"◇".repeat(Math.max(0, s.stressMax - live.stress))}</b> ${pp("stress")}</span>
    </div>
    <div class="ccpips">
      <span>EVA <b>${s.evasion}</b></span><span>E-DEF <b>${s.edef}</b></span>
      <span>ARMOR <b>${s.armor}</b></span><span>SAVE <b>${s.save}</b></span>
      <span>GRIT <b>+${s.attackBonus}</b></span>
      <span>O.SHLD <b>${live.overshield}</b> ${pp("overshield")}</span>
    </div>`;

  // HP / Heat / Repair / Core steppers — with structure & stress automation
  el.querySelectorAll(".pm[data-cc]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.cc, d = Number(b.dataset.d);
      const maxes = { hp: s.hpMax, heat: s.heatMax, repairs: s.repMax, core: s.coreMax };
      if (k === "hp" && d < 0) {
        if (live.overshield > 0) { live.overshield--; }       // overshield absorbs first
        else if (live.hp > 0) {
          live.hp--;
          if (live.hp === 0) structureDamage();
        }
      } else if (k === "heat" && d > 0) {
        if (live.heat >= s.heatMax) overheatDamage();
        else live.heat++;
      } else {
        live[k] = Math.max(0, Math.min(maxes[k], live[k] + d));
      }
      onLiveChanged();
    });
  });

  // Structure / Stress / Overshield manual steppers (no auto tables on manual edits)
  el.querySelectorAll(".pp[data-pp]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.pp, d = Number(b.dataset.d);
      const maxes = { structure: s.structureMax, stress: s.stressMax, overshield: 99 };
      live[k] = Math.max(0, Math.min(maxes[k], live[k] + d));
      onLiveChanged();
    });
  });

  // CORE bar hover → core power tooltip
  const coreRow = el.querySelector('.ccrow[data-key="core"]');
  const ci = coreInfo(currentMech?.frame);
  if (coreRow && ci) {
    coreRow.style.cursor = "help";
    coreRow.addEventListener("mouseenter", (e) =>
      showTip(`CORE: ${ci.name}${ci.activation ? ` — ${ci.activation}` : ""}`, ci.description, e));
    coreRow.addEventListener("mousemove", moveTooltip);
    coreRow.addEventListener("mouseleave", hideTooltip);
  }
}

// ---- reactor automation: structure & overheat ---------------------------------
const macroOn = () => $("macro-toggle")?.checked || false;
const d6 = () => 1 + Math.floor(Math.random() * 6);

function structureDamage() {
  const s = currentMech.stats;
  live.structure = Math.max(0, live.structure - 1);
  if (live.structure > 0) {
    live.hp = s.hpMax; // HP refills after taking structure
    logRoll({ kind: "sys", title: "STRUCTURE DAMAGE", detail: `Structure ${live.structure}/${s.structureMax} — HP resets to ${s.hpMax}.` });
    if (macroOn()) rollStructureTable();
  } else {
    live.hp = 0;
    logRoll({ kind: "sys", title: "STRUCTURE 0 — MECH DESTROYED", detail: "The frame comes apart." });
    setStatus("STRUCTURE 0 — mech destroyed.", "status-err");
  }
}

function overheatDamage() {
  const s = currentMech.stats;
  live.stress = Math.max(0, live.stress - 1);
  live.heat = 0;
  if (live.stress > 0) {
    logRoll({ kind: "sys", title: "OVERHEAT", detail: `Reactor stress ${live.stress}/${s.stressMax} — heat clears to 0.` });
    if (macroOn()) rollOverheatTable();
  } else {
    logRoll({ kind: "sys", title: "STRESS 0 — REACTOR MELTDOWN", detail: "Catastrophic reactor failure." });
    setStatus("STRESS 0 — reactor meltdown.", "status-err");
  }
}

// Paraphrased core-rules tables. Roll a d6; severity scales with what's left.
function rollStructureTable() {
  const v = d6();
  let out;
  if (v >= 5) out = "GLANCING BLOW — mech is IMPAIRED until the end of its next turn.";
  else if (v >= 2) out = "SYSTEM TRAUMA — roll 1d6: 1–3 a weapon/mount is destroyed, 4–6 a system is destroyed.";
  else out =
    live.structure >= 3 ? "DIRECT HIT — mech is STUNNED until the end of its next turn."
    : live.structure === 2 ? "DIRECT HIT — make a HULL check: success = STUNNED, failure = mech DESTROYED."
    : "DIRECT HIT — mech is DESTROYED.";
  postTableRoll("Structure check", v, out);
}

function rollOverheatTable() {
  const v = d6();
  let out;
  if (v >= 5) out = "EMERGENCY SHUNT — mech is IMPAIRED until the end of its next turn.";
  else if (v >= 2) out = "DESTABILIZED POWER PLANT — mech is EXPOSED (all damage doubled) until cleared.";
  else out =
    live.stress >= 2 ? "MELTDOWN — make an ENGINEERING check: failure = reactor meltdown imminent."
    : "MELTDOWN — irreversible reactor meltdown.";
  postTableRoll("Overheat check", v, out);
}

function postTableRoll(label, v, out) {
  logRoll({ kind: "sys", title: `${label} → ${v}`, detail: out });
  if (obrReady) {
    try {
      OBR.broadcast.sendMessage(CH_ROLL3D, {
        who: myName, label, kind: "sys", detail: out, total: v, crit: "",
        dice: [{ type: "d6", role: "normal", value: v }],
      }, { destination: "REMOTE" });
    } catch (_) {}
  }
}

function renderStatGrid(s) {
  const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const stats = [
    ["HP", `${live.hp}/${s.hpMax}`], ["Armor", s.armor], ["Evasion", s.evasion],
    ["E-Def", s.edef], ["Heat", `${live.heat}/${s.heatMax}`], ["Speed", s.speed],
    ["Sensors", s.sensors], ["Save", s.save], ["Size", s.size],
    ["Structure", `${live.structure}/${s.structureMax}`], ["Stress", `${live.stress}/${s.stressMax}`], ["Repair", `${live.repairs}/${s.repMax}`],
    ["Tech Atk", sign(s.techAttack)], ["Grit", sign(s.attackBonus)], ["O.Shield", live.overshield],
  ];
  $("statgrid").innerHTML = stats
    .map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`)
    .join("");
}

// ---- weapons -------------------------------------------------------------------
function rangeBits(w) {
  const bits = [];
  if (w.range) bits.push(`Range ${w.range}`);
  if (w.threat) bits.push(`Threat ${w.threat}`);
  if (w.blast) bits.push(`Blast ${w.blast}`);
  if (w.cone) bits.push(`Cone ${w.cone}`);
  if (w.line) bits.push(`Line ${w.line}`);
  if (w.burst) bits.push(`Burst ${w.burst}`);
  return bits.join(" · ") || "—";
}

// AoE shapes arm a placeable template; plain range/threat shows a private
// red range FIELD around your token instead (field: true).
function weaponTemplateSpec(w) {
  if (w.blast > 0) return { shape: "blast", size: w.blast, name: `${w.name} · Blast ${w.blast}` };
  if (w.cone > 0) return { shape: "cone", size: w.cone, name: `${w.name} · Cone ${w.cone}` };
  if (w.line > 0) return { shape: "line", size: w.line, name: `${w.name} · Line ${w.line}` };
  if (w.burst > 0) return { shape: "blast", size: w.burst, name: `${w.name} · Burst ${w.burst}` };
  if (w.range > 0) return { shape: "weapon", size: w.range, name: `${w.name} · Range ${w.range}`, field: true };
  if (w.threat > 0) return { shape: "weapon", size: w.threat, name: `${w.name} · Threat ${w.threat}`, field: true };
  return null;
}

// Action-economy exceptions: weapons that fire outside the normal
// Skirmish / Barrage economy.
const ACTION_OVERRIDES = [
  { re: /autopod/i, full: false, title: "Protocol — fires automatically at a target with LOCK ON, no attack roll" },
  { re: /autogun/i, full: false, title: "Automated — fires on its own (see system text)" },
  { re: /nexus.*swarm|swarm.*nexus/i, full: false, title: "Quick action (Skirmish) — see nexus rules" },
];

function weaponActionInfo(w, mountLabel) {
  for (const o of ACTION_OVERRIDES) {
    if (o.re.test(w.name || "")) {
      return { icon: o.full ? ICON_FULL : ICON_QUICK, title: o.title };
    }
  }
  const isFull = /superheavy/i.test(w.mountSize || "") || /superheavy/i.test(mountLabel || "");
  return isFull
    ? { icon: ICON_FULL, title: "Full action (Barrage — Superheavy weapons cannot Skirmish)" }
    : { icon: ICON_QUICK, title: "Quick action (Skirmish)" };
}

function renderMounts(m) {
  const mountsEl = $("mounts");
  mountsEl.innerHTML = "";
  if (!m.mounts.length) {
    mountsEl.innerHTML = `<div class="muted">No weapons mounted.</div>`;
    return;
  }
  m.mounts.forEach((mt) => {
    const lbl = document.createElement("div");
    lbl.className = "mount-label";
    lbl.textContent = mt.label;
    mountsEl.appendChild(lbl);
    if (!mt.weapons.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "— empty —";
      mountsEl.appendChild(empty);
      return;
    }
    mt.weapons.forEach((w) => mountsEl.appendChild(weaponCard(w, mt.label)));
  });
}

function weaponCard(w, mountLabel) {
  const el = document.createElement("div");
  el.className = "weapon";
  const tags = [];
  if (w.overkill) tags.push("OVERKILL");
  if (w.loading) tags.push("LOADING");
  const spec = weaponTemplateSpec(w);
  const tmplBtn = spec
    ? `<button class="btn small ghost" data-act="tmpl" title="${spec.field ? `Toggle ${spec.name} field around your token` : `Arm ${spec.name} template`}">◈</button>`
    : "";
  const act = weaponActionInfo(w, mountLabel);
  el.innerHTML = `
    <div class="top">
      <span class="wname" data-act="info" title="${act.title} — hover for weapon details">${act.icon}${w.name}</span>
      <span>
        ${tmplBtn}
        <button class="btn small" data-act="atk" title="Attack roll: d20 + grit">ATK</button>
        <button class="btn small lock" data-act="lock" title="Target lock: roll accuracy, then FIRE for damage">⬢</button>
      </span>
    </div>
    <div class="meta">${[w.mountSize, w.type].filter(Boolean).join(" ")} — ${rangeBits(w)} — <b>${w.damage}</b></div>
    ${tags.length ? `<div class="tags">${tags.join(" · ")}</div>` : ""}
  `;
  el.querySelector('[data-act="atk"]').addEventListener("click", () => prepareWeaponAttack(w, false));
  el.querySelector('[data-act="lock"]').addEventListener("click", () => prepareWeaponAttack(w, true));
  // hover the weapon name → full tooltip
  const nameEl = el.querySelector('[data-act="info"]');
  const body = [
    `${[w.mountSize, w.type].filter(Boolean).join(" ")} — ${rangeBits(w)} — ${w.damage}`,
    w.tagNames?.length ? `TAGS: ${w.tagNames.join(", ")}` : "",
    w.effect || "",
  ].filter(Boolean).join("  •  ");
  nameEl.addEventListener("mouseenter", (e) => showTip(`${w.name} — ${act.title}`, body, e));
  nameEl.addEventListener("mousemove", moveTooltip);
  nameEl.addEventListener("mouseleave", hideTooltip);
  if (spec) {
    el.querySelector('[data-act="tmpl"]').addEventListener("click", async () => {
      if (spec.field) {
        // plain Range / Threat → red private field around your token
        await toggleField("weapon", spec.size, false, spec.name);
        return;
      }
      try {
        await tool.armTemplate(spec);
        setStatus(`Armed ${spec.name}. Click the map to place it.`, "status-ok");
      } catch (e) {
        setStatus("Template tool unavailable (open inside an Owlbear scene).", "status-err");
      }
    });
  }
  return el;
}

// ---- tech attack card + invade options ------------------------------------------
function renderTechCard(s) {
  const el = $("techcard");
  const sign = s.techAttack >= 0 ? `+${s.techAttack}` : `${s.techAttack}`;
  el.innerHTML = `
    <div class="weapon techw" style="margin-bottom:0">
      <div class="top">
        <span class="wname" title="Quick action (Quick Tech)">${ICON_QUICK}TECH ATTACK</span>
        <span>
          <button class="btn small ghost" data-act="trange" title="Toggle sensor range field (tech attacks reach anything in Sensors)">◈</button>
          <button class="btn small blue" data-act="tatk" title="Tech attack: d20 ${sign}">TECH ATK</button>
          <button class="btn small lock blue" data-act="tlock" title="Roll tech accuracy with the lock flow">⬢</button>
        </span>
      </div>
      <div class="meta">d20 ${sign} vs E-DEF — Sensors ${s.sensors}</div>
    </div>`;
  el.querySelector('[data-act="trange"]').addEventListener("click", toggleSensors);
  el.querySelector('[data-act="tatk"]').addEventListener("click", () => prepareTechAttack());
  el.querySelector('[data-act="tlock"]').addEventListener("click", () => prepareTechAttack());
}

// Core quick-tech options every mech has, plus any Invade options granted by
// installed systems. Hover for the rules text; click to roll the tech attack.
const INVADE_BASE = [
  { name: "Invade — Fragment Signal", activation: "Quick Tech", detail: "Tech attack vs E-Defense. On hit: the target takes 2 Heat and is IMPAIRED and SLOWED until the end of its next turn." },
  { name: "Scan", activation: "Quick Tech", detail: "Choose a character within Sensors: view its full stat block, hidden information (e.g. one piece of GM knowledge), or its last known orders. No attack roll needed." },
  { name: "Lock On", activation: "Quick Tech", detail: "Choose a character within Sensors and line of sight: it gains LOCK ON. Any attacker may consume LOCK ON for +1 Accuracy on an attack against it. No attack roll needed." },
];

function renderInvades(m) {
  const wrap = $("invades");
  if (!wrap) return;
  wrap.innerHTML = "";
  // Any system-granted tech option shows up here: dedicated Invade options
  // (Markerlight, HUNTER logic, the HORUS OS suites…) plus Quick/Full Tech
  // actions from installed systems.
  const sysInvades = [];
  for (const sys of m.systems) {
    for (const a of sys.actionsFull || []) {
      const act = a.activation || "";
      if (/invade/i.test(act)) {
        sysInvades.push({ name: `Invade — ${a.name}`, activation: "Quick Tech (Invade)", detail: a.detail || sys.description || "" });
      } else if (/tech/i.test(act)) {
        sysInvades.push({ name: a.name, activation: act, detail: a.detail || sys.description || "" });
      }
    }
  }
  [...INVADE_BASE, ...sysInvades].forEach((opt) => {
    const div = document.createElement("div");
    div.className = "system invade";
    div.textContent = opt.name;
    div.addEventListener("mouseenter", (e) => showTip(`${opt.name} — ${opt.activation}`, opt.detail, e));
    div.addEventListener("mousemove", moveTooltip);
    div.addEventListener("mouseleave", hideTooltip);
    div.addEventListener("click", () => prepareTechAttack(opt.name.toUpperCase()));
    wrap.appendChild(div);
  });
}

// ---- systems + talents (hover tooltips) -------------------------------------------
function renderSystems(m) {
  const wrap = $("systems");
  wrap.innerHTML = "";
  if (!m.systems.length) {
    wrap.innerHTML = `<div class="muted">No systems installed.</div>`;
    return;
  }
  m.systems.forEach((sys) => {
    const div = document.createElement("div");
    div.className = "system";
    div.textContent = sys.name;
    const bits = [];
    if (sys.activation) bits.push(sys.activation.toUpperCase());
    if (sys.sp != null) bits.push(`${sys.sp} SP`);
    div.addEventListener("mouseenter", (e) =>
      showTip(`${sys.name}${bits.length ? " — " + bits.join(" · ") : ""}`, sys.description || "No description in compendium.", e));
    div.addEventListener("mousemove", moveTooltip);
    div.addEventListener("mouseleave", hideTooltip);
    wrap.appendChild(div);
  });
}

function renderTalentChips() {
  const wrap = $("talents");
  if (!wrap) return;
  wrap.innerHTML = "";
  const talents = resolveTalents(currentPilot?.talents || []);
  if (!talents.length) {
    wrap.innerHTML = `<div class="muted">No talents in this export (or compendium offline).</div>`;
    return;
  }
  talents.forEach((t) => {
    const div = document.createElement("div");
    div.className = "system talent";
    div.textContent = `${t.name} ${"I".repeat(Math.max(1, Math.min(3, t.rank)))}`;
    div.addEventListener("mouseenter", (e) =>
      showTip(`${t.name} — RANK ${t.rank}`, t.description || "No description in compendium.", e));
    div.addEventListener("mousemove", moveTooltip);
    div.addEventListener("mouseleave", hideTooltip);
    wrap.appendChild(div);
  });
}

// ---- tooltip --------------------------------------------------------------------
const tipEl = $("tooltip");
function showTip(head, body, ev) {
  $("tt-head").textContent = head;
  $("tt-body").textContent = body || "";
  tipEl.style.display = "block";
  moveTooltip(ev);
}
function moveTooltip(ev) {
  const pad = 12;
  const r = tipEl.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > window.innerWidth - 4) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 4) y = ev.clientY - r.height - pad;
  tipEl.style.left = `${Math.max(4, x)}px`;
  tipEl.style.top = `${Math.max(4, y)}px`;
}
function hideTooltip() { tipEl.style.display = "none"; }

// ============================================================== DICE SYSTEM ====
let diceTray = null;
let diceInit = false;
let diceBusy = false;

// What's queued in the tray, parallel to the tray's internal dice order.
// { type, role, as, pair } — as:"d3" reads a d6 as ceil(v/2); dice sharing a
// `pair` id are crit pairs: only the highest of the pair counts.
let trayQueue = [];
let pairSeq = 0;

// Pending roll context. kind: "atk" | "dmg" | "tech" | "free".
// followUp = weapon for the FIRE stage; crit = last accuracy roll crit.
let pending = { label: "", kind: "free", followUp: null, crit: false };
let pendingHeat = 0;

function setContext(label, kind = "free", followUp = null) {
  pending = { label, kind, followUp, crit: false };
  const el = $("roll-context");
  el.textContent = label;
  el.classList.toggle("tech", kind === "tech");
}
function clearContext() { setContext("", "free", null); }

function updateAdvCount() {
  const el = $("advcount");
  if (!el) return;
  const n = trayQueue.length;
  el.textContent = n === 1 ? "1 die queued" : `${n} dice queued`;
}

async function ensureDiceTray() {
  if (diceInit) { if (diceTray) diceTray.resize(); return diceTray; }
  diceInit = true;
  try {
    const mod = await import("./dice3d.js");
    const sel = $("scheme");
    if (sel && !sel.options.length) {
      for (const key of Object.keys(mod.SCHEMES)) {
        const o = document.createElement("option");
        o.value = key;
        o.textContent = mod.SCHEMES[key].label || key;
        sel.appendChild(o);
      }
      const savedScheme = readStore().scheme;
      if (savedScheme && mod.SCHEMES[savedScheme]) sel.value = savedScheme;
      sel.addEventListener("change", saveState);
    }
    diceTray = mod.createDiceTray($("dicetray"), {
      scheme: () => $("scheme")?.value || "union",
      height: 270,
    });
    window.__computeResult = mod.computeResult;
    diceTray.resize();
    updateAdvCount();
  } catch (e) {
    console.warn("[LANCER//UPLINK] 3D dice unavailable.", e);
    diceTray = null;
    $("trayfallback")?.classList.remove("hidden");
  }
  return diceTray;
}

function addQueued(type, role = "normal", as = null, pair = null) {
  if (!diceTray || diceBusy) return;
  diceTray.addDie(type, role);
  trayQueue.push({ type, role, as, pair });
  diceTray.stageView(); // close-up on the hovering dice while you build the pool
  hideResult();
  updateAdvCount();
}

function clearTrayAll() {
  if (!diceTray || diceBusy) return;
  diceTray.clearTray();
  trayQueue = [];
  updateAdvCount();
}

document.querySelectorAll(".die-btn[data-die]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    await ensureDiceTray();
    addQueued(btn.dataset.die, "normal");
  });
});
$("addadv")?.addEventListener("click", async () => { await ensureDiceTray(); addQueued("d6", "acc"); });
$("adddis")?.addEventListener("click", async () => { await ensureDiceTray(); addQueued("d6", "dis"); });
$("cleardice")?.addEventListener("click", () => {
  clearTrayAll();
  clearContext();
  hideResult();
  diceTray?.resetCamera();
});

const flatInput = $("flat-input");
$("flat-minus")?.addEventListener("click", () => { flatInput.value = String((Number(flatInput.value) || 0) - 1); });
$("flat-plus")?.addEventListener("click", () => { flatInput.value = String((Number(flatInput.value) || 0) + 1); });
const getFlat = () => Number(flatInput?.value) || 0;
const setFlat = (n) => { if (flatInput) flatInput.value = String(n); };

const okToggle = $("overkill-toggle");
okToggle?.addEventListener("change", () => $("ok-wrap")?.classList.toggle("ok-on", okToggle.checked));
const setOverkill = (on) => {
  if (okToggle) { okToggle.checked = on; $("ok-wrap")?.classList.toggle("ok-on", on); }
};
const critToggle = $("crit-toggle");
critToggle?.addEventListener("change", () => $("crit-wrap")?.classList.toggle("ok-on", critToggle.checked));
const setCrit = (on) => {
  if (critToggle) { critToggle.checked = on; $("crit-wrap")?.classList.toggle("ok-on", on); }
};
const rollsHidden = () => $("hideroll")?.checked || false;

// ---- NHP commentary on a natural 1 ------------------------------------------------
const NHP_QUIPS = [
  "Such a shame.",
  "Feeling a bit desperate, aren't we?",
  ">It's alright. >I'm not one to judge.",
  "It's been a long day. Have some soup.",
  "I ran the numbers. All of them. You still did that.",
  "Statistically fascinating. Tactically… less so.",
  "I will not be mentioning this in the after-action report. You're welcome.",
  "The dice are not broken. I checked. Twice.",
  "A bold interpretation of 'aim'.",
  "Recalibrating expectations…",
  "Your ancestors are watching. They've seen worse. Barely.",
  ">>query: was that intentional?",
];
let quipTimer = 0;
function showQuip() {
  const el = $("nhp-quip");
  if (!el) return;
  el.textContent = NHP_QUIPS[Math.floor(Math.random() * NHP_QUIPS.length)];
  el.classList.remove("show");
  void el.offsetWidth; // restart the CSS animation
  el.classList.add("show");
  clearTimeout(quipTimer);
  quipTimer = setTimeout(() => el.classList.remove("show"), 3900);
}

// ---- result popup -------------------------------------------------------------
function showResult({ total, sub, kind = "atk", crit = "" }) {
  $("result-num").textContent = String(total);
  $("result-sub").textContent = sub || "";
  $("result-crit").textContent = crit;
  const card = $("resultcard");
  card.classList.remove("dmg", "tech");
  if (kind === "dmg") card.classList.add("dmg");
  if (kind === "tech") card.classList.add("tech");
  $("resultbox").classList.add("show");
}
function hideResult() {
  $("resultbox").classList.remove("show");
  $("firebtn").classList.remove("show");
  $("heatapply").classList.remove("show");
}
$("resultclear")?.addEventListener("click", () => {
  hideResult();
  clearContext();
  clearTrayAll();
  diceTray?.resetCamera();
});

// heat auto-apply (Overkill)
$("heatapply")?.addEventListener("click", () => {
  if (!pendingHeat || !currentMech || !live) return;
  const s = currentMech.stats;
  if (live.heat + pendingHeat > s.heatMax) overheatDamage();
  else live.heat += pendingHeat;
  onLiveChanged();
  setStatus(`Applied +${pendingHeat} Heat (now ${live.heat}/${s.heatMax}).`, "status-ok");
  pendingHeat = 0;
  $("heatapply").classList.remove("show");
});

// ---- roll preparation (weapon / tech flows) -------------------------------------
function parseDamage(str) {
  const dice = [];
  let flat = 0;
  const s = String(str || "");
  const diceRe = /(\d+)\s*d\s*(\d+)/gi;
  let m;
  while ((m = diceRe.exec(s))) dice.push({ n: +m[1], faces: +m[2] });
  const rest = s.replace(/(\d+)\s*d\s*(\d+)/gi, " ");
  const numRe = /[+-]?\s*\d+/g;
  let nm;
  while ((nm = numRe.exec(rest))) flat += parseInt(nm[0].replace(/\s+/g, ""), 10) || 0;
  return { dice, flat };
}

// ATK (or ⬢ target lock): d20 + grit, ready to roll.
async function prepareWeaponAttack(w, lock) {
  switchToDiceTab();
  if (!(await ensureDiceTray())) return;
  if (diceBusy) return;
  clearTrayAll();
  hideResult();
  const grit = currentPilot ? currentPilot.grit : 0;
  setFlat(grit);
  setOverkill(false);
  setCrit(false);
  addQueued("d20", "normal");
  setContext(
    `${w.name.toUpperCase()} — ATTACK · d20 +${grit} GRIT${lock ? "  [LOCK: FIRE after accuracy]" : ""}`,
    "atk",
    lock ? w : null
  );
}

// DMG: the weapon's damage dice only — grit is NEVER added to damage.
// crit=true doubles every die; each pair keeps only its highest result.
async function prepareWeaponDamage(w, fire, crit) {
  switchToDiceTab();
  if (!(await ensureDiceTray())) return;
  if (diceBusy) return;
  const parsed = parseDamage(w.damage);
  if (!parsed.dice.length && !parsed.flat) {
    setStatus(`${w.name} has no rollable damage.`, "status-err");
    return;
  }
  clearTrayAll();
  hideResult();
  setFlat(parsed.flat);
  setOverkill(!!w.overkill);
  setCrit(!!crit); // doRoll doubles the dice (keep highest per pair) when set
  const queueOne = (faces) => {
    if (faces === 3) addQueued("d6", "normal", "d3");
    else if ([4, 6, 8, 10, 12, 20].includes(faces)) addQueued(`d${faces}`, "normal");
    else addQueued("d6", "normal"); // unknown faces — approximate
  };
  for (const g of parsed.dice) {
    for (let i = 0; i < g.n; i++) queueOne(g.faces);
  }
  setContext(
    `${w.name.toUpperCase()} — DAMAGE · ${w.damage}${crit ? " · CRIT (dice doubled, keep highest)" : ""}${w.overkill ? " · OVERKILL" : ""}`,
    "dmg",
    null
  );
  if (fire) {
    setTimeout(() => doRoll(), 650); // let the dice hover in before the throw
  }
}

// Blue flow: tech attack = d20 + tech attack bonus.
async function prepareTechAttack(label = "TECH ATTACK") {
  switchToDiceTab();
  if (!(await ensureDiceTray())) return;
  if (diceBusy) return;
  clearTrayAll();
  hideResult();
  const t = currentMech ? currentMech.stats.techAttack : 0;
  setFlat(t);
  setOverkill(false);
  setCrit(false);
  addQueued("d20", "normal");
  setContext(`${label} · d20 ${t >= 0 ? "+" : ""}${t} vs E-DEF`, "tech", null);
}

// FIRE: chains the locked weapon's damage right after its accuracy roll.
$("firebtn")?.addEventListener("click", () => {
  const w = pending.followUp;
  if (!w) return;
  $("firebtn").classList.remove("show");
  prepareWeaponDamage(w, true, pending.crit);
});

// ---- THE roll -------------------------------------------------------------------
const effVal = (meta, v) => (meta?.as === "d3" ? Math.ceil(v / 2) : v);

async function doRoll() {
  if (!diceTray || diceBusy || !trayQueue.length) return;
  diceBusy = true;
  const rollBtn = $("rolldice");
  rollBtn?.classList.add("rolling");
  try {
    const flat = getFlat();
    const keepHighest = $("keephigh")?.checked || false;
    const overkill = okToggle?.checked || false;
    const critOn = critToggle?.checked || false;
    const ctx = { ...pending };

    // CRIT toggle: duplicate every (non-d20) damage die into a pair before
    // the throw — only the highest of each pair will count.
    if (critOn) {
      const snapshot = trayQueue.slice();
      snapshot.forEach((meta, i) => {
        if (meta.role === "normal" && meta.type !== "d20" && meta.pair == null) {
          const pid = ++pairSeq;
          trayQueue[i] = { ...meta, pair: pid };
          diceTray.addDie(meta.type, meta.role);
          trayQueue.push({ type: meta.type, role: meta.role, as: meta.as, pair: pid });
        }
      });
      updateAdvCount();
    }

    let raw = await diceTray.roll(1); // [{type, role, value}] in queue order
    if (!raw || !raw.length) return;
    let metas = trayQueue.slice();

    // ---- crit pairs: keep only the highest die of each pair
    const eff0 = raw.map((r, i) => ({ ...r, value: effVal(metas[i], r.value) }));
    const dropIdx = new Set();
    const pairBest = new Map(); // pair -> { idx, val }
    eff0.forEach((d, i) => {
      const p = metas[i]?.pair;
      if (p == null || d.role !== "normal") return;
      const cur = pairBest.get(p);
      if (!cur || d.value > cur.val) {
        if (cur) dropIdx.add(cur.idx);
        pairBest.set(p, { idx: i, val: d.value });
      } else {
        dropIdx.add(i);
      }
    });

    // ---- Overkill: kept damage dice showing 1 explode; +1 Heat per 1
    let heat = 0;
    if (overkill) {
      let iter = 0;
      let scanFrom = 0;
      while (iter < 8) {
        const ones = [];
        for (let i = scanFrom; i < raw.length; i++) {
          if (dropIdx.has(i)) continue;
          const r = raw[i], meta = metas[i];
          if (r.role === "normal" && r.type !== "d20" && effVal(meta, r.value) === 1) {
            ones.push({ type: r.type, as: meta?.as || null });
          }
        }
        if (!ones.length) break;
        heat += ones.length;
        scanFrom = raw.length;
        const extra = await diceTray.rollExtra(ones.map((o) => o.type));
        if (!extra || !extra.length) break;
        ones.forEach((o) => metas.push({ type: o.type, role: "normal", as: o.as, pair: null }));
        raw = raw.concat(extra);
        trayQueue = metas.slice();
        iter++;
      }
    }

    // ---- compute the Lancer total (paired drops excluded)
    const eff = raw.map((r, i) => ({ ...r, value: effVal(metas[i], r.value) }));
    const effKept = eff.filter((_, i) => !dropIdx.has(i));
    const compute = window.__computeResult;
    const res = compute(effKept, { keepHighest, flat });

    // crit & labels (Lancer: an attack totalling 20+ crits; nat 1 always whiffs)
    // Lancer crit rule: ANY attack totalling 20+ crits — there are no special
    // natural 20s. A natural 1 gets no label; the NHP says enough.
    let critTxt = "";
    let isCrit = false;
    if (res.d20 != null) {
      if (res.d20 === 1) {
        showQuip();
      } else if ((ctx.kind === "atk" || ctx.kind === "tech") && res.total >= 20) {
        critTxt = "⚡ CRIT (20+)";
        isCrit = true;
      }
    }

    const facesTxt = eff.map((d, i) => {
      const tag = d.role === "acc" ? "+acc" : d.role === "dis" ? "−dif" : "";
      const dieName = metas[i]?.as || d.type;
      return `${dieName}${tag ? ` ${tag}` : ""}:${d.value}${dropIdx.has(i) ? "✗" : ""}`;
    }).join("  ");
    let detail = facesTxt;
    if (dropIdx.size) detail += `  | crit: paired dice, ✗ dropped`;
    if (res.accApplied) detail += `  | ${res.accApplied > 0 ? "+" : ""}${res.accApplied} ${res.accApplied > 0 ? "accuracy" : "difficulty"}`;
    if (flat) detail += `  | ${flat >= 0 ? "+" : ""}${flat} flat`;
    if (heat) detail += `  | +${heat} HEAT (overkill)`;

    const label = ctx.label || (res.d20 != null ? "Attack" : "Roll");
    const kind = ctx.kind === "free" ? (res.d20 != null ? "atk" : "dmg") : ctx.kind;
    const priv = rollsHidden();

    // ---- present: zoom in, pop the result, surface FIRE / heat-apply buttons
    diceTray.zoomToDice();
    const sub = ctx.kind === "dmg" ? "DAMAGE" : ctx.kind === "tech" ? "TECH" : (res.d20 != null ? "ACCURACY" : "TOTAL");
    showResult({ total: res.total, sub, kind, crit: critTxt });

    if (ctx.followUp) {
      pending.followUp = ctx.followUp;
      pending.crit = isCrit;
      $("firebtn").classList.add("show");
      if (isCrit) $("firebtn").textContent = "⬢ FIRE (CRIT)";
      else $("firebtn").textContent = "⬢ FIRE";
    }
    if (heat > 0 && currentMech) {
      pendingHeat = heat;
      const hb = $("heatapply");
      hb.textContent = `+${heat} HEAT`;
      hb.classList.add("show");
    }

    logRoll({ kind, title: `${label} → ${res.total}`, detail, critTxt: critTxt ? `<span class="crit"> ${critTxt}</span>` : "", priv });

    // ---- broadcast the physical roll so the table sees it (unless hidden)
    if (!priv && obrReady) {
      try {
        OBR.broadcast.sendMessage(
          CH_ROLL3D,
          {
            who: myName,
            label, kind, detail,
            total: res.total,
            crit: critTxt,
            dice: raw.map((r) => ({ type: r.type, role: r.role, value: r.value })),
          },
          { destination: "REMOTE" }
        );
      } catch (_) {}
    }
  } catch (e) {
    console.warn("[LANCER//UPLINK] dice roll failed", e);
  } finally {
    rollBtn?.classList.remove("rolling");
    diceBusy = false;
    updateAdvCount();
  }
}
$("rolldice")?.addEventListener("click", doRoll);

// ---- remote replays ----------------------------------------------------------------
let remoteCleanup = 0;

async function onRemoteRoll(d) {
  logRoll({
    kind: d.kind === "dmg" ? "dmg" : d.kind === "tech" ? "tech" : d.kind === "sys" ? "sys" : "atk",
    remote: true,
    who: d.who,
    title: `${d.label} → ${d.total}`,
    detail: d.detail || "",
    critTxt: d.crit ? `<span class="crit"> ${d.crit}</span>` : "",
  });
  try { OBR.notification.show(`${d.who}: ${d.label} → ${d.total}`, "INFO"); } catch (_) {}

  if (!diceTabActive()) return;
  await ensureDiceTray();
  if (!diceTray || diceBusy || diceTray.isRolling()) return;

  clearTimeout(remoteCleanup);
  const banner = $("remote-banner");
  banner.textContent = `▸ ${d.who} ROLLS…`;
  banner.style.display = "block";
  trayQueue = []; // the replay owns the tray now
  await diceTray.replay(d.dice || []);
  diceTray.zoomToDice();
  showResult({
    total: d.total,
    sub: `${d.who} — ${d.kind === "dmg" ? "DAMAGE" : d.kind === "tech" ? "TECH" : d.kind === "sys" ? "CHECK" : "ACCURACY"}`,
    kind: d.kind === "sys" ? "atk" : d.kind || "atk",
    crit: d.crit || "",
  });
  remoteCleanup = setTimeout(() => {
    if (diceBusy || diceTray.isRolling()) return;
    diceTray.clearTray();
    trayQueue = [];
    hideResult();
    diceTray.resetCamera();
    banner.style.display = "none";
  }, 4500);
}

// ---- roll log -------------------------------------------------------------------------
function logRoll({ kind, title, detail, critTxt = "", remote = false, who = "", priv = false }) {
  const log = $("rolllog");
  const div = document.createElement("div");
  div.className = `roll ${kind === "dmg" ? "dmg" : ""} ${kind === "tech" ? "tech" : ""} ${kind === "sys" ? "sys" : ""} ${remote ? "remote" : ""} ${priv ? "private" : ""}`.trim();
  const badge = priv ? `<span class="private-badge"> · PRIVATE</span>` : "";
  div.innerHTML = `
    <div class="who">${remote ? who || "Table" : myName}${badge}</div>
    <div class="big">${title}${critTxt}</div>
    <div class="detail">${detail}</div>`;
  log.prepend(div);
  while (log.children.length > 40) log.removeChild(log.lastChild);
}
$("clearlog")?.addEventListener("click", () => { $("rolllog").innerHTML = ""; });

// ============================================================ MAP TAB WIRING ====
const visBtn = $("vis-toggle");
function refreshVisBtn() {
  const all = tool.getTemplateVisibility() === "all";
  visBtn.textContent = all ? "👁 TEMPLATES: ALL PLAYERS" : "👁 TEMPLATES: ONLY ME";
  visBtn.classList.toggle("all", all);
}
visBtn?.addEventListener("click", () => {
  tool.setTemplateVisibility(tool.getTemplateVisibility() === "all" ? "me" : "all");
  refreshVisBtn();
  saveState();
});

$("clearmine")?.addEventListener("click", async () => {
  try { await clearMyTemplates(); await clearLocalTemplates(); }
  catch (e) { console.warn("[LANCER//UPLINK] clear templates failed", e); }
});
$("clearranges")?.addEventListener("click", async () => {
  try { await clearAllLocalOverlays(); } catch (_) {}
  activeFields = {};
  moveState = 0;
  markMobilityActive();
});

// ---- grid calibration controls -----------------------------------------------
$("grid-mode")?.addEventListener("change", () => {
  hex.setGridOverride($("grid-mode").value);
  refreshGridReadout();
  saveState();
});

const cellSlider = $("cell-size");
function syncCellSlider() {
  if (!cellSlider) return;
  const px = Math.round(hex.grid.dpi);
  cellSlider.value = String(Math.max(30, Math.min(600, px)));
  const v = $("cell-size-val");
  if (v) v.textContent = `${px} px${hex.grid.cellOverride ? " (manual)" : ""}`;
}
cellSlider?.addEventListener("input", () => {
  hex.setCellSize(Number(cellSlider.value));
  const v = $("cell-size-val");
  if (v) v.textContent = `${cellSlider.value} px (manual)`;
  refreshGridReadout();
  saveState();
});

$("btn-fit")?.addEventListener("click", async () => {
  hex.setCellSize(null); // drop the manual override, trust the probe
  await recalibrate();
  syncCellSlider();
  saveState();
  setStatus("Grid re-probed and matched to the scene.", "status-ok");
});

$("macro-toggle")?.addEventListener("change", saveState);

function refreshGridReadout() {
  const el = $("grid-readout");
  if (!el) return;
  const g = hex.grid;
  if (!g.ready) { el.textContent = "Waiting for a scene…"; return; }
  const mode = g.square ? "SQUARE (king-move)" : `HEX ${g.pointy ? "POINTY-TOP" : "FLAT-TOP"}`;
  const src = g.modeOverride ? "manual" : `auto (room: ${g.isHexGrid ? "hex" : "square"})`;
  el.textContent = `${mode} · tile ${Math.round(g.dpi)}px${g.cellOverride ? " (manual)" : ""} · ${src}`;
}

// ============================================================== OBR STARTUP ====
async function recalibrate() {
  try {
    await hex.calibrate();
    refreshGridReadout();
    syncCellSlider();
  } catch (e) {
    console.warn("[LANCER//UPLINK] calibration failed", e);
    const el = $("grid-readout");
    if (el) el.textContent = "Calibration failed — open a scene, then FIT TO SCENE.";
  }
}

async function start() {
  obrReady = true;
  $("conn-dot")?.classList.add("on");
  try { myName = await OBR.player.getName(); } catch (_) {}

  // 1) Register the template tool IMMEDIATELY — it must never wait on the
  //    grid probe (this is what used to leave the toolbar empty).
  try {
    await tool.registerTool();
  } catch (e) {
    console.error("[LANCER//UPLINK] template tool registration failed", e);
    setStatus("Template tool failed to register — check console.", "status-err");
  }

  // 2) Calibrate the grid when (and whenever) a scene is actually ready.
  try {
    if (await OBR.scene.isReady()) await recalibrate();
    OBR.scene.onReadyChange((ready) => { if (ready) recalibrate(); });
  } catch (e) {
    console.warn("[LANCER//UPLINK] scene readiness check failed", e);
  }

  // 3) Bonded-token follow: re-centre active range fields when it moves.
  try {
    OBR.scene.items.onChange((items) => {
      if (!bond || !Object.keys(activeFields).length) return;
      const it = items.find((i) => i.id === bond.id);
      if (!it) return;
      clearTimeout(followTimer);
      followTimer = setTimeout(async () => {
        const c = hex.pixelToHex(it.position);
        for (const [kind, f] of Object.entries(activeFields)) {
          await placeFieldAt(kind, c, f.size, f.boost);
        }
      }, 250);
    });
  } catch (_) {}

  // 4) Broadcast channels: dice replays + squad telemetry.
  try {
    OBR.broadcast.onMessage(CH_ROLL3D, (event) => onRemoteRoll(event.data || {}));
    OBR.broadcast.onMessage(CH_STATUS, (event) => {
      const d = event.data || {};
      if (d.type === "req") { broadcastStatus(); return; }
      if (d.type === "status" && d.who) {
        squad.set(d.who, d);
        if (gmMode) renderGM();
      }
    });
  } catch (e) {
    console.warn("[LANCER//UPLINK] broadcast channels unavailable", e);
  }

  broadcastStatus();
}

// ============================================================== BOOT ==========
(function restoreSettings() {
  const st = readStore();
  if (st.vis) tool.setTemplateVisibility(st.vis);
  refreshVisBtn();
  // grid: mode override + manual tile size (also handles pre-2.2 "square" key)
  const mode = st.gridMode || (st.square ? "square" : "auto");
  if ($("grid-mode")) $("grid-mode").value = mode;
  hex.setGridOverride(mode);
  if (st.cellSize) hex.setCellSize(st.cellSize);
  syncCellSlider();
  refreshGridReadout();
  if ($("macro-toggle")) $("macro-toggle").checked = !!st.macro;
  if (st.bond && st.bond.id) bond = st.bond;
  updateBondUI();
  if (st.live) restoreLive = st.live;
  if (st.mechIdx != null) restoreMechIdx = st.mechIdx;
})();

async function tryRestorePilot() {
  const st = readStore();
  if (!st.pilot) return;
  try {
    setStatus("Restoring saved pilot…");
    await importPilots([st.pilot], st.pilot);
    setStatus(`Restored ${currentPilot?.callsign || "pilot"} from last session.`, "status-ok");
  } catch (e) {
    console.warn("[LANCER//UPLINK] pilot restore failed", e);
    setStatus("Saved pilot could not be restored — upload the JSON again.", "status-err");
  }
}

setStatus("Ready. Upload a COMP/CON pilot export to begin.");
tryRestorePilot();
try {
  if (OBR.isReady) start();
  else OBR.onReady(start);
} catch (e) {
  console.warn("[LANCER//UPLINK] OBR unavailable — pilot/dice still usable.", e);
}
