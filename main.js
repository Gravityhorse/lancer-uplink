// main.js — wires the whole Lancer Uplink popover together:
//   • COMP/CON pilot import + resolved mech sheet  (compcon.js)
//   • Lancer dice roller, broadcast to the table     (dice.js)
//   • Hex template tool registration                 (tool.js / hex.js / overlay.js)
//
// The pilot sheet and dice roller are pure and work the instant the popover
// opens. Owlbear-specific features (template tool, roll broadcast) are wired
// up once OBR signals ready, and are guarded so a missing API never bricks
// the rest of the UI.

import { OBR, CH_ROLL } from "./sdk.js";
import * as hex from "./hex.js";
import * as tool from "./tool.js";
import { clearMyTemplates } from "./overlay.js";
import { loadCompendium, listPilots, parsePilot, resolveMech } from "./compcon.js";
import { rollAttack, rollDamage, formatAttack } from "./dice.js";
// dice3d.js (three + cannon-es from CDN) is loaded lazily the first time the
// DICE tab is opened, so a CDN hiccup never bricks the pilot/template UI.

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
function setStatus(msg, cls = "") {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = cls;
}

// ---------------------------------------------------------------- tab nav ----
document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll("nav button").forEach((b) =>
      b.classList.toggle("active", b === btn)
    );
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.id === `tab-${tab}`)
    );
    if (tab === "dice") ensureDiceTray();
  });
});

// ============================================================ PILOT IMPORT ====
let currentPilot = null;
let currentMechs = [];
let rosterPilots = []; // raw pilot objects pulled from the uploaded file

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

    // Roster files can hold many pilots — offer a picker when they do.
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
    setStatus(`Loaded ${pilot.callsign} — “${pilot.name}”.`, "status-ok");
  } catch (err) {
    console.error("[LANCER//UPLINK] pilot parse failed", err);
    setStatus(`Import failed: ${err.message || err}`, "status-err");
  }
}

$("mechselect").addEventListener("change", (e) => renderMech(Number(e.target.value)));

function renderMech(idx) {
  const raw = currentMechs[idx];
  if (!raw || !currentPilot) return;
  const m = resolveMech(raw, currentPilot);
  const s = m.stats;

  $("m-name").textContent = m.name || "MECH";
  $("m-frame").textContent = s.frameName;
  $("m-pilot").textContent =
    `${currentPilot.callsign} · ${currentPilot.name} · LL${currentPilot.level} · ` +
    `H${currentPilot.hase.hull} A${currentPilot.hase.agi} S${currentPilot.hase.sys} E${currentPilot.hase.eng}`;

  const cur = m.current || {};
  const hp = cur.hp != null ? `${cur.hp}/${s.hpMax}` : s.hpMax;
  const heat = cur.heat != null ? `${cur.heat}/${s.heatMax}` : s.heatMax;
  const struct = cur.structure != null ? `${cur.structure}/${s.structureMax}` : s.structureMax;
  const stress = cur.stress != null ? `${cur.stress}/${s.stressMax}` : s.stressMax;
  const rep = cur.repairs != null ? `${cur.repairs}/${s.repMax}` : s.repMax;
  const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

  const stats = [
    ["HP", hp], ["Armor", s.armor], ["Evasion", s.evasion],
    ["E-Def", s.edef], ["Heat", heat], ["Speed", s.speed],
    ["Sensors", s.sensors], ["Save", s.save], ["Size", s.size],
    ["Structure", struct], ["Stress", stress], ["Repair", rep],
    ["Tech Atk", sign(s.techAttack)], ["Grit", sign(s.attackBonus)], ["Core", s.coreMax],
  ];
  $("statgrid").innerHTML = stats
    .map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`)
    .join("");

  // Range tools: arm a green movement circle (speed) or blue sensor circle.
  const rt = $("rangetools");
  if (rt) {
    rt.innerHTML = `
      <button class="btn small green" data-arm="move" title="Arm movement range">◧ Move (${s.speed})</button>
      <button class="btn small blue" data-arm="tech" title="Arm sensor range">◫ Sensors (${s.sensors})</button>`;
    rt.querySelector('[data-arm="move"]').addEventListener("click", async () => {
      try {
        await tool.armTemplate({ shape: "move", size: s.speed, name: `Move ${s.speed}` });
        setStatus(`Armed movement (${s.speed}). Click the map to place it.`, "status-ok");
      } catch (_) { setStatus("Template tool unavailable (open inside an Owlbear scene).", "status-err"); }
    });
    rt.querySelector('[data-arm="tech"]').addEventListener("click", async () => {
      try {
        await tool.armTemplate({ shape: "tech", size: s.sensors, name: `Sensors ${s.sensors}` });
        setStatus(`Armed sensors (${s.sensors}). Click the map to place it.`, "status-ok");
      } catch (_) { setStatus("Template tool unavailable (open inside an Owlbear scene).", "status-err"); }
    });
  }

  const mountsEl = $("mounts");
  mountsEl.innerHTML = "";
  if (!m.mounts.length) {
    mountsEl.innerHTML = `<div class="muted">No weapons mounted.</div>`;
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

  $("systems").innerHTML = m.systems.length
    ? m.systems.map((x) => `<div class="system">${x}</div>`).join("")
    : `<div class="muted">No systems installed.</div>`;

  $("sheet").classList.remove("hidden");
}

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

// Map a resolved weapon's range data to the red template it should arm.
// Priority: explicit AoE (blast/cone/line/burst) > reach (range/threat).
function weaponTemplateSpec(w) {
  if (w.blast > 0) return { shape: "blast", size: w.blast, name: `${w.name} · Blast ${w.blast}` };
  if (w.cone > 0) return { shape: "cone", size: w.cone, name: `${w.name} · Cone ${w.cone}` };
  if (w.line > 0) return { shape: "line", size: w.line, name: `${w.name} · Line ${w.line}` };
  if (w.burst > 0) return { shape: "blast", size: w.burst, name: `${w.name} · Burst ${w.burst}` };
  if (w.range > 0) return { shape: "blast", size: w.range, name: `${w.name} · Range ${w.range}` };
  if (w.threat > 0) return { shape: "blast", size: w.threat, name: `${w.name} · Threat ${w.threat}` };
  return null;
}

function weaponCard(w) {
  const el = document.createElement("div");
  el.className = "weapon";
  const tags = [];
  if (w.overkill) tags.push("OVERKILL");
  if (w.loading) tags.push("LOADING");
  const spec = weaponTemplateSpec(w);
  const tmplBtn = spec
    ? `<button class="btn small tmpl" data-act="tmpl" title="Arm ${spec.name}">◈</button>`
    : "";
  el.innerHTML = `
    <div class="top">
      <span class="wname">${w.name}</span>
      <span>
        ${tmplBtn}
        <button class="btn small" data-act="atk">Atk</button>
        <button class="btn small ghost" data-act="dmg">Dmg</button>
      </span>
    </div>
    <div class="meta">${[w.mountSize, w.type].filter(Boolean).join(" ")} — ${rangeBits(w)} — <b>${w.damage}</b></div>
    ${tags.length ? `<div class="tags">${tags.join(" · ")}</div>` : ""}
  `;
  el.querySelector('[data-act="atk"]').addEventListener("click", () => {
    const flat = currentPilot ? currentPilot.grit : 0;
    doAttack(0, flat, w.name);
  });
  el.querySelector('[data-act="dmg"]').addEventListener("click", () => {
    const parsed = parseDamage(w.damage);
    if (!parsed.dice.length && !parsed.flat) {
      setStatus(`${w.name} has no rollable damage.`, "status-err");
      return;
    }
    doDamage(parsed.dice, parsed.flat, w.overkill, w.name);
  });
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

// ================================================================== DICE ======
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

$("rollatk").addEventListener("click", () => {
  doAttack(Number($("acc").value) || 0, Number($("flat").value) || 0, "Attack");
});
$("rolldmg").addEventListener("click", () => {
  const parsed = parseDamage($("dmgdice").value);
  parsed.flat += Number($("dmgflat").value) || 0;
  doDamage(parsed.dice, parsed.flat, $("overkill").checked, "Damage");
});

function doAttack(netAccuracy, flat, label) {
  const res = rollAttack({ netAccuracy, flat });
  const critTxt = res.crit ? `<span class="crit"> ⚡CRIT</span>` : "";
  logRoll({
    kind: "atk",
    title: `${label} → ${res.total}`,
    detail: `${formatAttack(res)}${res.crit ? "  (natural 20!)" : ""}`,
    critTxt,
    priv: rollsHidden(),
  });
}

function doDamage(dice, flat, overkill, label) {
  const res = rollDamage({ dice, flat, overkill, mode: "house" });
  const faces = res.groups
    .map((g) => `[${g.rolls.map((r) => (r.exploded ? `${r.v}*` : r.v)).join(",")}]d${g.faces}`)
    .join(" ");
  const heatTxt = res.heat ? `  +${res.heat} Heat (overkill)` : "";
  logRoll({
    kind: "dmg",
    title: `${label} → ${res.total} dmg`,
    detail: `${faces}${flat ? ` +${flat}` : ""}${heatTxt}`,
    priv: rollsHidden(),
  });
}

let myName = "You";
function logRoll({ kind, title, detail, critTxt = "", remote = false, priv = false }) {
  const log = $("rolllog");
  const div = document.createElement("div");
  div.className = `roll ${kind === "dmg" ? "dmg" : ""} ${remote ? "remote" : ""} ${priv ? "private" : ""}`.trim();
  const badge = priv ? `<span class="private-badge"> · PRIVATE</span>` : "";
  div.innerHTML = `
    <div class="who">${remote ? (title.who || "Table") : myName}${badge}</div>
    <div class="big">${remote ? title.title : title}${critTxt}</div>
    <div class="detail">${remote ? title.detail : detail}</div>`;
  log.prepend(div);

  // Private rolls stay local; everything else is shared with the table.
  // destination REMOTE = everyone except us (we already logged it above).
  if (!remote && !priv) {
    try {
      OBR.broadcast.sendMessage(
        CH_ROLL,
        { who: myName, title, detail, kind, critTxt },
        { destination: "REMOTE" }
      );
    } catch (_) { /* OBR not ready — local-only is fine */ }
  }
}

// One switch hides EVERY kind of roll (3D tray, quick roller, weapon buttons).
const rollsHidden = () => $("hideroll")?.checked || false;

// ============================================================ 3D DICE TRAY ====
// Loaded lazily so a three/cannon CDN hiccup never bricks the pilot UI.
let diceTray = null;       // the createDiceTray() handle, once loaded
let diceInit = false;      // have we attempted init yet?
let diceBusy = false;      // a roll is in flight

const SCHEME_LABELS = {
  ssc: "SSC — Gold / White",
  union: "Union — Red / Black",
  horus: "HORUS — Green / Pink",
  ha: "HA — Purple / White",
};

function updateAdvCount() {
  const el = $("advcount");
  if (!el) return;
  const n = diceTray ? diceTray.count() : 0;
  el.textContent = n === 1 ? "1 die queued" : `${n} dice queued`;
}

async function ensureDiceTray() {
  if (diceInit) { if (diceTray) diceTray.resize(); return; }
  diceInit = true;
  try {
    const mod = await import("./dice3d.js");
    // populate the colour-scheme dropdown from the module's SCHEMES
    const sel = $("scheme");
    if (sel && !sel.options.length) {
      for (const key of Object.keys(mod.SCHEMES)) {
        const o = document.createElement("option");
        o.value = key;
        o.textContent = mod.SCHEMES[key].label || SCHEME_LABELS[key] || key;
        sel.appendChild(o);
      }
    }
    diceTray = mod.createDiceTray($("dicetray"), {
      scheme: () => $("scheme")?.value || "ssc",
      height: 280,
    });
    window.__computeResult = mod.computeResult; // used by the roll handler
    diceTray.resize();
    updateAdvCount();
  } catch (e) {
    console.warn("[LANCER//UPLINK] 3D dice unavailable — quick-roll only.", e);
    diceTray = null;
    $("trayfallback")?.classList.remove("hidden");
  }
}

// dice picker — each button adds a 3D die of that type
document.querySelectorAll(".die-btn[data-die]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!diceTray) return;
    diceTray.addDie(btn.dataset.die);
    updateAdvCount();
  });
});

$("addadv")?.addEventListener("click", () => {
  if (!diceTray) return;
  diceTray.addAccDie("acc");
  updateAdvCount();
});
$("adddis")?.addEventListener("click", () => {
  if (!diceTray) return;
  diceTray.addAccDie("dis");
  updateAdvCount();
});

$("cleardice")?.addEventListener("click", () => {
  if (!diceTray) return;
  diceTray.clearTray();
  updateAdvCount();
});

// hold-to-charge: longer press = harder throw
let chargeStart = 0;
function powerFromHold() {
  const held = Math.min(1200, Date.now() - chargeStart); // cap at 1.2s
  return 0.7 + (held / 1200) * 1.6; // 0.7 .. 2.3
}
async function doDiceRoll() {
  if (!diceTray || diceBusy || !diceTray.count()) return;
  diceBusy = true;
  const rollBtn = $("rolldice");
  rollBtn?.classList.add("rolling");
  try {
    const power = chargeStart ? powerFromHold() : 1;
    chargeStart = 0;
    const results = await diceTray.roll(power);
    if (!results || !results.length) return;
    logDiceResult(results);
  } catch (e) {
    console.warn("[LANCER//UPLINK] dice roll failed", e);
  } finally {
    rollBtn?.classList.remove("rolling");
    diceBusy = false;
    updateAdvCount();
  }
}
const rollBtn = $("rolldice");
if (rollBtn) {
  rollBtn.addEventListener("pointerdown", () => { chargeStart = Date.now(); });
  rollBtn.addEventListener("pointerup", doDiceRoll);
  rollBtn.addEventListener("pointerleave", () => {
    if (chargeStart && !diceBusy) doDiceRoll();
  });
}

function logDiceResult(results) {
  const compute = window.__computeResult;
  const priv = $("hideroll")?.checked || false;
  const keepHighest = $("keephigh")?.checked || false;
  const r = compute(results, { keepHighest });

  // human-readable breakdown of every die that landed
  const faces = results.map((d) => {
    const tag = d.role === "acc" ? "+acc" : d.role === "dis" ? "−dif" : "";
    return `${d.type}${tag ? ` ${tag}` : ""}:${d.value}`;
  }).join("  ");

  let title = `Roll → ${r.total}`;
  let critTxt = "";
  if (r.d20 === 20) critTxt = `<span class="crit"> ⚡NAT 20</span>`;
  else if (r.d20 === 1) critTxt = `<span class="crit"> ✘NAT 1</span>`;

  let detail = faces;
  if (r.accApplied) {
    detail += `  →  ${r.base} ${r.accApplied > 0 ? "+" : "−"} ${Math.abs(r.accApplied)} (${r.accApplied > 0 ? "accuracy" : "difficulty"})`;
  } else if (keepHighest && r.normals.length > 1) {
    detail += `  →  kept highest ${r.base}`;
  }

  logRoll({ kind: "atk", title, detail, critTxt, priv });
}

// ============================================================== TEMPLATES =====
$("clearmine").addEventListener("click", async () => {
  try { await clearMyTemplates(); }
  catch (e) { console.warn("[LANCER//UPLINK] clear templates failed", e); }
});

// ============================================================ OBR STARTUP =====
async function start() {
  try { myName = await OBR.player.getName(); } catch (_) {}

  try {
    await hex.calibrate();
    await tool.registerTool();
  } catch (e) {
    console.error("[LANCER//UPLINK] template tool setup failed", e);
  }

  try {
    OBR.broadcast.onMessage(CH_ROLL, (event) => {
      const d = event.data || {};
      logRoll({
        kind: d.kind === "dmg" ? "dmg" : "atk",
        remote: true,
        critTxt: d.critTxt || "",
        title: { who: d.who, title: d.title, detail: d.detail },
      });
    });
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
