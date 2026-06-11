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
import { loadCompendium, parsePilotFile, resolveMech } from "./compcon.js";
import { rollAttack, rollDamage, formatAttack } from "./dice.js";

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
  });
});

// ============================================================ PILOT IMPORT ====
let currentPilot = null;
let currentMechs = [];

$("pilotfile").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  setStatus(`Reading ${file.name}…`);
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const { pilot, mechs } = parsePilotFile(json);
    if (!mechs.length) throw new Error("Pilot has no mechs in this export.");
    currentPilot = pilot;
    currentMechs = mechs;

    setStatus("Loading LANCER compendium…");
    await loadCompendium((s) => setStatus(s));

    const sel = $("mechselect");
    sel.innerHTML = "";
    mechs.forEach((m, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = m.name || `Mech ${i + 1}`;
      sel.appendChild(o);
    });
    const activeIdx = Math.max(0, mechs.findIndex((m) => m.active));
    sel.value = String(activeIdx);
    $("mechpicker").classList.toggle("hidden", mechs.length < 2);

    renderMech(activeIdx);
    setStatus(`Loaded ${pilot.callsign} — “${pilot.name}”.`, "status-ok");
  } catch (err) {
    console.error("[LANCER//UPLINK] import failed", err);
    setStatus(`Import failed: ${err.message || err}`, "status-err");
  }
});

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

function weaponCard(w) {
  const el = document.createElement("div");
  el.className = "weapon";
  const tags = [];
  if (w.overkill) tags.push("OVERKILL");
  if (w.loading) tags.push("LOADING");
  el.innerHTML = `
    <div class="top">
      <span class="wname">${w.name}</span>
      <span>
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
  });
}

let myName = "You";
function logRoll({ kind, title, detail, critTxt = "", remote = false }) {
  const log = $("rolllog");
  const div = document.createElement("div");
  div.className = `roll ${kind === "dmg" ? "dmg" : ""} ${remote ? "remote" : ""}`.trim();
  div.innerHTML = `
    <div class="who">${remote ? (title.who || "Table") : myName}</div>
    <div class="big">${remote ? title.title : title}${critTxt}</div>
    <div class="detail">${remote ? title.detail : detail}</div>`;
  log.prepend(div);

  if (!remote) {
    try {
      OBR.broadcast.sendMessage(
        CH_ROLL,
        { who: myName, title, detail, kind, critTxt },
        { destination: "ALL" }
      );
    } catch (_) { /* OBR not ready — local-only is fine */ }
  }
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
    const sizeInput = $("size");
    const colorInput = $("color");
    if (sizeInput) {
      tool.templateConfig.size = Number(sizeInput.value) || 3;
      sizeInput.addEventListener("change", () => {
        tool.templateConfig.size = Number(sizeInput.value) || 3;
      });
    }
    if (colorInput) {
      tool.templateConfig.color = colorInput.value;
      colorInput.addEventListener("change", () => {
        tool.templateConfig.color = colorInput.value;
      });
    }
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
