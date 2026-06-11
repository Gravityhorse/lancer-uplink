// main.js — wires the whole LANCER//UPLINK popover together:
//   • COMP/CON pilot import + resolved mech sheet     (compcon.js)
//   • One unified 3D dice system: picker, modifiers,
//     weapon Atk / target-lock→FIRE flow, tech attacks,
//     Overkill chains, broadcast replays               (dice3d.js)
//   • Hex template tool + in-panel template bar        (tool.js / hex.js / overlay.js)
//
// The pilot sheet works the instant the popover opens. Owlbear-specific
// features (template tool, broadcasts) are wired once OBR signals ready and
// guarded so a missing API never bricks the rest of the UI.

import { OBR, CH_ROLL3D } from "./sdk.js";
import * as hex from "./hex.js";
import * as tool from "./tool.js";
import {
  clearMyTemplates,
  clearLocalTemplates,
  clearAllLocalOverlays,
  clearTerrain,
  renderTerrain,
} from "./overlay.js";
import { loadCompendium, listPilots, parsePilot, resolveMech } from "./compcon.js";
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
  document.getElementById("tab-dice")?.classList.contains("active");

function switchToDiceTab() {
  document.querySelector('nav.tabs button[data-tab="dice"]')?.click();
}

// ========================================================== TEMPLATE BAR ======
// The persistent strip under the tabs: pick a shape, then click-drag the map.
document.querySelectorAll("#tmplbar .tb[data-mode]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("#tmplbar .tb").forEach((b) =>
      b.classList.toggle("sel", b === btn)
    );
    try {
      await tool.activateMode(btn.dataset.mode);
      setStatus(`Template tool: ${btn.textContent} — click-drag on the map.`, "status-ok");
    } catch (e) {
      setStatus("Template tool unavailable — open this panel inside an Owlbear scene.", "status-err");
    }
  });
});

const visBtn = $("vis-toggle");
visBtn?.addEventListener("click", () => {
  const next = tool.getTemplateVisibility() === "all" ? "me" : "all";
  tool.setTemplateVisibility(next);
  visBtn.textContent = next === "all" ? "👁 ALL" : "👁 ME";
  visBtn.classList.toggle("all", next === "all");
});

$("clearmine")?.addEventListener("click", async () => {
  try { await clearMyTemplates(); await clearLocalTemplates(); }
  catch (e) { console.warn("[LANCER//UPLINK] clear templates failed", e); }
});
$("clearterrain")?.addEventListener("click", async () => {
  try { await clearTerrain(); await renderTerrain([], hex.keyToHex); }
  catch (e) { console.warn("[LANCER//UPLINK] clear terrain failed", e); }
});
$("clearranges")?.addEventListener("click", async () => {
  try { await clearAllLocalOverlays(); } catch (_) {}
});

// ============================================================ PILOT IMPORT ====
let currentPilot = null;
let currentMechs = [];
let currentMech = null; // resolved mech (stats/mounts/systems)
let rosterPilots = [];

$("pilotfile").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  setStatus(`Reading ${file.name}…`);
  try {
    const json = JSON.parse(await file.text());
    rosterPilots = listPilots(json);
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
  } catch (err) {
    console.error("[LANCER//UPLINK] import failed", err);
    setStatus(`Import failed: ${err.message || err}`, "status-err");
  }
});

$("pilotselect")?.addEventListener("change", (e) => selectPilot(Number(e.target.value)));

function selectPilot(idx) {
  const raw = rosterPilots[idx];
  if (!raw) return;
  try {
    const { pilot, mechs } = parsePilot(raw);
    currentPilot = pilot;
    currentMechs = mechs;

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
    const activeIdx = Math.max(0, mechs.findIndex((m) => m.active));
    sel.value = String(activeIdx);
    renderMech(activeIdx);
    $("sec-import")?.removeAttribute("open"); // tidy up once loaded
    setStatus(`Loaded ${pilot.callsign} — “${pilot.name}”.`, "status-ok");
  } catch (err) {
    console.error("[LANCER//UPLINK] pilot parse failed", err);
    setStatus(`Import failed: ${err.message || err}`, "status-err");
  }
}

$("mechselect").addEventListener("change", (e) => renderMech(Number(e.target.value)));

// ---- live reactor state (local; lets the CompCon bars be clickable) ----------
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
}

function renderMech(idx) {
  const raw = currentMechs[idx];
  if (!raw || !currentPilot) return;
  const m = resolveMech(raw, currentPilot);
  currentMech = m;
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
  renderSystems(m);

  $("sheet").classList.remove("hidden");
}

// ---- MOVE & SENSORS row (above the stat blocks, below the name) --------------
function renderMobility(s) {
  const el = $("mobility");
  el.innerHTML = `
    <button class="mob-btn green" data-mob="move">MOVE<small>${s.speed} HEX</small></button>
    <button class="mob-btn green" data-mob="boost">BOOST<small>${s.speed} HEX</small></button>
    <button class="mob-btn blue" data-mob="sensors">SENSORS<small>${s.sensors} HEX</small></button>
    <button class="mob-btn blue" data-mob="techatk">TECH ATK<small>${s.techAttack >= 0 ? "+" : ""}${s.techAttack}</small></button>`;
  const arm = async (shape, size, name) => {
    try {
      await tool.armTemplate({ shape, size, name });
      setStatus(`Armed ${name} (${size} hex). Click your token's hex on the map.`, "status-ok");
    } catch (_) {
      setStatus("Template tool unavailable (open inside an Owlbear scene).", "status-err");
    }
  };
  el.querySelector('[data-mob="move"]').addEventListener("click", () => arm("move", s.speed, `Move ${s.speed}`));
  el.querySelector('[data-mob="boost"]').addEventListener("click", () => arm("move", s.speed, `Boost ${s.speed}`));
  el.querySelector('[data-mob="sensors"]').addEventListener("click", () => arm("tech", s.sensors, `Sensors ${s.sensors}`));
  el.querySelector('[data-mob="techatk"]').addEventListener("click", () => prepareTechAttack());
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
  const row = (key, label, cur, max, color) => `
    <div class="ccrow">
      <span class="lbl">${label}</span>
      <button class="pm" data-cc="${key}" data-d="-1">−</button>
      ${segBar(cur, max, color)}
      <button class="pm" data-cc="${key}" data-d="1">+</button>
      <span class="val">${cur}/${max}</span>
    </div>`;
  el.innerHTML =
    row("hp", "HP", live.hp, s.hpMax, "var(--hpblue)") +
    row("heat", "HEAT", live.heat, s.heatMax, "var(--heatred)") +
    row("repairs", "REPAIR", live.repairs, s.repMax, "#e84545") +
    row("core", "CORE", live.core, s.coreMax, "var(--good)") +
    `<div class="ccpips">
      <span>STRUCT <b>${"◆".repeat(live.structure)}${"◇".repeat(Math.max(0, s.structureMax - live.structure))}</b></span>
      <span>STRESS <b>${"◆".repeat(live.stress)}${"◇".repeat(Math.max(0, s.stressMax - live.stress))}</b></span>
      <span>O.SHLD <b>${live.overshield}</b></span>
    </div>
    <div class="ccpips">
      <span>EVA <b>${s.evasion}</b></span><span>E-DEF <b>${s.edef}</b></span>
      <span>ARMOR <b>${s.armor}</b></span><span>SAVE <b>${s.save}</b></span>
      <span>GRIT <b>+${s.attackBonus}</b></span>
    </div>`;
  el.querySelectorAll(".pm[data-cc]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.cc, d = Number(b.dataset.d);
      const maxes = { hp: s.hpMax, heat: s.heatMax, repairs: s.repMax, core: s.coreMax };
      live[k] = Math.max(0, Math.min(maxes[k], live[k] + d));
      renderCC(s);
    });
  });
}

function renderStatGrid(s) {
  const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const stats = [
    ["HP", `${live.hp}/${s.hpMax}`], ["Armor", s.armor], ["Evasion", s.evasion],
    ["E-Def", s.edef], ["Heat", `${live.heat}/${s.heatMax}`], ["Speed", s.speed],
    ["Sensors", s.sensors], ["Save", s.save], ["Size", s.size],
    ["Structure", `${live.structure}/${s.structureMax}`], ["Stress", `${live.stress}/${s.stressMax}`], ["Repair", `${live.repairs}/${s.repMax}`],
    ["Tech Atk", sign(s.techAttack)], ["Grit", sign(s.attackBonus)], ["Core", s.coreMax],
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

// Map a weapon's range data to the template it should arm.
function weaponTemplateSpec(w) {
  if (w.blast > 0) return { shape: "blast", size: w.blast, name: `${w.name} · Blast ${w.blast}` };
  if (w.cone > 0) return { shape: "cone", size: w.cone, name: `${w.name} · Cone ${w.cone}` };
  if (w.line > 0) return { shape: "line", size: w.line, name: `${w.name} · Line ${w.line}` };
  if (w.burst > 0) return { shape: "blast", size: w.burst, name: `${w.name} · Burst ${w.burst}` };
  if (w.range > 0) return { shape: "blast", size: w.range, name: `${w.name} · Range ${w.range}` };
  if (w.threat > 0) return { shape: "blast", size: w.threat, name: `${w.name} · Threat ${w.threat}` };
  return null;
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
    mt.weapons.forEach((w) => mountsEl.appendChild(weaponCard(w)));
  });
}

function weaponCard(w) {
  const el = document.createElement("div");
  el.className = "weapon";
  const tags = [];
  if (w.overkill) tags.push("OVERKILL");
  if (w.loading) tags.push("LOADING");
  const spec = weaponTemplateSpec(w);
  const tmplBtn = spec
    ? `<button class="btn small ghost" data-act="tmpl" title="Arm ${spec.name} template">◈</button>`
    : "";
  el.innerHTML = `
    <div class="top">
      <span class="wname">${w.name}</span>
      <span>
        ${tmplBtn}
        <button class="btn small" data-act="atk" title="Attack roll: d20 + grit">ATK</button>
        <button class="btn small lock" data-act="lock" title="Target lock: roll accuracy, then FIRE for damage">⬢</button>
        <button class="btn small ghost" data-act="dmg" title="Damage roll only">DMG</button>
      </span>
    </div>
    <div class="meta">${[w.mountSize, w.type].filter(Boolean).join(" ")} — ${rangeBits(w)} — <b>${w.damage}</b></div>
    ${tags.length ? `<div class="tags">${tags.join(" · ")}</div>` : ""}
  `;
  el.querySelector('[data-act="atk"]').addEventListener("click", () => prepareWeaponAttack(w, false));
  el.querySelector('[data-act="lock"]').addEventListener("click", () => prepareWeaponAttack(w, true));
  el.querySelector('[data-act="dmg"]').addEventListener("click", () => prepareWeaponDamage(w, false));
  if (spec) {
    el.querySelector('[data-act="tmpl"]').addEventListener("click", async () => {
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

// ---- tech attack card (blue) ---------------------------------------------------
function renderTechCard(s) {
  const el = $("techcard");
  const sign = s.techAttack >= 0 ? `+${s.techAttack}` : `${s.techAttack}`;
  el.innerHTML = `
    <div class="weapon techw" style="margin-bottom:0">
      <div class="top">
        <span class="wname">TECH ATTACK</span>
        <span>
          <button class="btn small blue" data-act="tatk" title="Tech attack: d20 ${sign}">TECH ATK</button>
          <button class="btn small lock blue" data-act="tlock" title="Roll tech accuracy with the lock flow">⬢</button>
        </span>
      </div>
      <div class="meta">d20 ${sign} vs E-DEF — Sensors ${s.sensors} — invade, fragment signal, etc.</div>
    </div>`;
  el.querySelector('[data-act="tatk"]').addEventListener("click", () => prepareTechAttack());
  el.querySelector('[data-act="tlock"]').addEventListener("click", () => prepareTechAttack());
}

// ---- systems + hover tooltip -----------------------------------------------------
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
    div.addEventListener("mouseenter", (e) => showTooltip(sys, e));
    div.addEventListener("mousemove", (e) => moveTooltip(e));
    div.addEventListener("mouseleave", hideTooltip);
    wrap.appendChild(div);
  });
}

const tipEl = $("tooltip");
function showTooltip(sys, ev) {
  const bits = [];
  if (sys.activation) bits.push(sys.activation.toUpperCase());
  if (sys.sp != null) bits.push(`${sys.sp} SP`);
  $("tt-head").textContent = `${sys.name}${bits.length ? " — " + bits.join(" · ") : ""}`;
  $("tt-body").textContent = sys.description || "No description in compendium.";
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
// One unified flow. Everything — picker buttons, weapon ATK / DMG, the ⬢
// target-lock → FIRE chain, tech attacks — loads dice into the same 3D tray
// and resolves through the same math + broadcast path.

let diceTray = null;
let diceInit = false;
let diceBusy = false;

// What's queued in the tray, parallel to the tray's internal dice order.
// { type, role, as } — `as: "d3"` marks a d6 being read as a d3 (ceil(v/2)).
let trayQueue = [];

// Pending roll context: how to label/compute the current tray contents.
// kind: "atk" | "dmg" | "tech" | "free"; followUp: weapon for the FIRE stage.
let pending = { label: "", kind: "free", followUp: null };

function setContext(label, kind = "free", followUp = null) {
  pending = { label, kind, followUp };
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
    }
    diceTray = mod.createDiceTray($("dicetray"), {
      scheme: () => $("scheme")?.value || "union",
      height: 250,
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

function addQueued(type, role = "normal", as = null) {
  if (!diceTray || diceBusy) return;
  diceTray.addDie(type, role);
  trayQueue.push({ type, role, as });
  diceTray.resetCamera();
  hideResult(); // a fresh queue means the last result no longer matches
  updateAdvCount();
}

function clearTrayAll() {
  if (!diceTray || diceBusy) return;
  diceTray.clearTray();
  trayQueue = [];
  updateAdvCount();
}

// picker
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

// flat modifier stepper
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
const rollsHidden = () => $("hideroll")?.checked || false;

// ---- result popup -------------------------------------------------------------
function showResult({ total, sub, kind = "atk", crit = "" }) {
  $("result-num").textContent = String(total);
  $("result-sub").textContent = sub || "";
  $("result-crit").textContent = crit;
  const card = $("resultcard");
  card.className = ""; // reset
  card.id = "resultcard";
  if (kind === "dmg") card.classList.add("dmg");
  if (kind === "tech") card.classList.add("tech");
  $("resultbox").classList.add("show");
}
function hideResult() {
  $("resultbox").classList.remove("show");
  $("firebtn").classList.remove("show");
}
$("resultclear")?.addEventListener("click", () => {
  hideResult();
  clearContext();
  clearTrayAll();
  diceTray?.resetCamera();
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

// ATK (or ⬢ target lock): d20 + grit, ready to roll. Lock keeps the weapon
// around so the FIRE button can chain straight into its damage.
async function prepareWeaponAttack(w, lock) {
  switchToDiceTab();
  if (!(await ensureDiceTray())) return;
  if (diceBusy) return;
  clearTrayAll();
  hideResult();
  const grit = currentPilot ? currentPilot.grit : 0;
  setFlat(grit);
  setOverkill(false);
  addQueued("d20", "normal");
  setContext(
    `${w.name.toUpperCase()} — ATTACK · d20 +${grit} GRIT${lock ? "  [LOCK: FIRE after accuracy]" : ""}`,
    "atk",
    lock ? w : null
  );
}

// DMG: the weapon's damage dice (+ overkill if tagged). `fire=true` adds grit
// (this table's house rule for the FIRE chain) and auto-rolls.
async function prepareWeaponDamage(w, fire) {
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
  const grit = currentPilot ? currentPilot.grit : 0;
  setFlat(parsed.flat + (fire ? grit : 0));
  setOverkill(!!w.overkill);
  for (const g of parsed.dice) {
    for (let i = 0; i < g.n; i++) {
      if (g.faces === 3) addQueued("d6", "normal", "d3");      // d3 = d6 read as ceil(v/2)
      else if (g.faces === 20 || g.faces === 12 || g.faces === 10 || g.faces === 8 || g.faces === 6 || g.faces === 4) addQueued(`d${g.faces}`, "normal");
      else addQueued("d6", "normal"); // unknown faces — approximate with d6
    }
  }
  setContext(
    `${w.name.toUpperCase()} — DAMAGE · ${w.damage}${fire ? ` +${grit} GRIT` : ""}${w.overkill ? " · OVERKILL" : ""}`,
    "dmg",
    null
  );
  if (fire) {
    // brief hover so the dice are seen falling in, then send it
    setTimeout(() => doRoll(), 650);
  }
}

// Blue flow: tech attack = d20 + tech attack bonus.
async function prepareTechAttack() {
  switchToDiceTab();
  if (!(await ensureDiceTray())) return;
  if (diceBusy) return;
  clearTrayAll();
  hideResult();
  const t = currentMech ? currentMech.stats.techAttack : 0;
  setFlat(t);
  setOverkill(false);
  addQueued("d20", "normal");
  setContext(`TECH ATTACK · d20 ${t >= 0 ? "+" : ""}${t} vs E-DEF`, "tech", null);
}

// FIRE: chains the locked weapon's damage right after its accuracy roll.
$("firebtn")?.addEventListener("click", () => {
  const w = pending.followUp;
  if (!w) return;
  $("firebtn").classList.remove("show");
  prepareWeaponDamage(w, true);
});

// ---- THE roll -------------------------------------------------------------------

// effective value of a die (d3s are d6s halved)
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
    const ctx = { ...pending };

    let raw = await diceTray.roll(1); // [{type, role, value}] in queue order
    if (!raw || !raw.length) return;
    let metas = trayQueue.slice();

    // ---- Overkill: every damage die showing (effective) 1 explodes into a
    // bonus die of the same kind; +1 Heat per 1. Chains, capped for sanity.
    let heat = 0;
    if (overkill) {
      let iter = 0;
      let scanFrom = 0;
      while (iter < 8) {
        const ones = [];
        for (let i = scanFrom; i < raw.length; i++) {
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
        ones.forEach((o) => metas.push({ type: o.type, role: "normal", as: o.as }));
        raw = raw.concat(extra);
        trayQueue = metas.slice();
        iter++;
      }
    }

    // ---- compute the Lancer total
    const eff = raw.map((r, i) => ({ ...r, value: effVal(metas[i], r.value) }));
    const compute = window.__computeResult;
    const res = compute(eff, { keepHighest, flat });

    // crit & labels (Lancer: an attack totalling 20+ crits; nat 1 always whiffs)
    let critTxt = "";
    if (res.d20 != null) {
      if (res.d20 === 20) critTxt = "⚡ NAT 20 — CRIT";
      else if (res.d20 === 1) critTxt = "✘ NAT 1";
      else if ((ctx.kind === "atk" || ctx.kind === "tech") && res.total >= 20) critTxt = "⚡ CRIT (20+)";
    }

    const facesTxt = eff.map((d, i) => {
      const tag = d.role === "acc" ? "+acc" : d.role === "dis" ? "−dif" : "";
      const dieName = metas[i]?.as || d.type;
      return `${dieName}${tag ? ` ${tag}` : ""}:${d.value}`;
    }).join("  ");
    let detail = facesTxt;
    if (res.accApplied) detail += `  | ${res.accApplied > 0 ? "+" : ""}${res.accApplied} ${res.accApplied > 0 ? "accuracy" : "difficulty"}`;
    if (flat) detail += `  | ${flat >= 0 ? "+" : ""}${flat} flat`;
    if (heat) detail += `  | +${heat} HEAT (overkill)`;

    const label = ctx.label || (res.d20 != null ? "Attack" : "Roll");
    const kind = ctx.kind === "free" ? (res.d20 != null ? "atk" : "dmg") : ctx.kind;
    const priv = rollsHidden();

    // ---- present: zoom the camera in and pop the result top-left
    diceTray.zoomToDice();
    const sub = ctx.kind === "dmg" ? "DAMAGE" : ctx.kind === "tech" ? "TECH" : (res.d20 != null ? "ACCURACY" : "TOTAL");
    showResult({ total: res.total, sub, kind, crit: critTxt + (heat ? `  +${heat} HEAT` : "") });

    // FIRE stage available?
    if (ctx.followUp) {
      pending.followUp = ctx.followUp; // keep the weapon for the FIRE click
      $("firebtn").classList.add("show");
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
      } catch (_) { /* OBR not ready — local-only is fine */ }
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

// ---- remote replays --------------------------------------------------------------
// Someone else rolled: replay their physical dice in our tray (forced to land
// on their real values), flash their result, then tidy up after a few seconds.
let remoteCleanup = 0;

async function onRemoteRoll(d) {
  logRoll({
    kind: d.kind === "dmg" ? "dmg" : d.kind === "tech" ? "tech" : "atk",
    remote: true,
    who: d.who,
    title: `${d.label} → ${d.total}`,
    detail: d.detail || "",
    critTxt: d.crit ? `<span class="crit"> ${d.crit}</span>` : "",
  });
  try { OBR.notification.show(`${d.who}: ${d.label} → ${d.total}`, "INFO"); } catch (_) {}

  // replay only if the dice tab is up and we're not mid-roll ourselves
  if (!diceTabActive()) return;
  await ensureDiceTray();
  if (!diceTray || diceBusy || diceTray.isRolling()) return;

  clearTimeout(remoteCleanup);
  const banner = $("remote-banner");
  banner.textContent = `▸ ${d.who} ROLLS…`;
  banner.style.display = "block";
  trayQueue = []; // replay owns the tray now
  await diceTray.replay(d.dice || []);
  diceTray.zoomToDice();
  showResult({
    total: d.total,
    sub: `${d.who} — ${d.kind === "dmg" ? "DAMAGE" : d.kind === "tech" ? "TECH" : "ACCURACY"}`,
    kind: d.kind || "atk",
    crit: d.crit || "",
  });
  // visible "for a few seconds after the result", then clean up
  remoteCleanup = setTimeout(() => {
    if (diceBusy || diceTray.isRolling()) return;
    diceTray.clearTray();
    trayQueue = [];
    hideResult();
    diceTray.resetCamera();
    banner.style.display = "none";
  }, 4500);
}

// ---- roll log ----------------------------------------------------------------------
function logRoll({ kind, title, detail, critTxt = "", remote = false, who = "", priv = false }) {
  const log = $("rolllog");
  const div = document.createElement("div");
  div.className = `roll ${kind === "dmg" ? "dmg" : ""} ${kind === "tech" ? "tech" : ""} ${remote ? "remote" : ""} ${priv ? "private" : ""}`.trim();
  const badge = priv ? `<span class="private-badge"> · PRIVATE</span>` : "";
  div.innerHTML = `
    <div class="who">${remote ? who || "Table" : myName}${badge}</div>
    <div class="big">${title}${critTxt}</div>
    <div class="detail">${detail}</div>`;
  log.prepend(div);
  while (log.children.length > 40) log.removeChild(log.lastChild);
}
$("clearlog")?.addEventListener("click", () => { $("rolllog").innerHTML = ""; });

// ============================================================== OBR STARTUP ====
async function refreshGridReadout() {
  const el = $("grid-readout");
  if (!el) return;
  const g = hex.grid;
  el.textContent = g.isHexGrid
    ? `HEX ${g.pointy ? "(pointy-top)" : "(flat-top)"} · DPI ${g.dpi} · R ${g.R.toFixed(1)}px`
    : `Non-hex grid detected — hex math approximated.`;
}

async function start() {
  obrReady = true;
  $("conn-dot")?.classList.add("on");
  try { myName = await OBR.player.getName(); } catch (_) {}

  try {
    await hex.calibrate();
    await tool.registerTool();
    await refreshGridReadout();
  } catch (e) {
    console.error("[LANCER//UPLINK] template tool setup failed", e);
    setStatus("Template tool failed to register — check console.", "status-err");
  }

  $("btn-recal")?.addEventListener("click", async () => {
    try { await hex.calibrate(); await refreshGridReadout(); } catch (_) {}
  });

  try {
    OBR.broadcast.onMessage(CH_ROLL3D, (event) => onRemoteRoll(event.data || {}));
  } catch (e) {
    console.warn("[LANCER//UPLINK] roll channel unavailable", e);
  }
}

setStatus("Ready. Upload a COMP/CON pilot export to begin.");
try {
  if (OBR.isReady) start();
  else OBR.onReady(start);
} catch (e) {
  console.warn("[LANCER//UPLINK] OBR unavailable — pilot/dice still usable.", e);
}
