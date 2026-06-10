// main.js — boots the HUD, wires every panel to the Owlbear scene.

import { OBR, CH_ROLL, CH_CASCADE } from "./sdk.js";
import { calibrate, grid, pixelToHex, hexesInRange, hexDistance } from "./hex.js";
import {
  showLocalOverlay, clearLocalOverlay, clearAllLocalOverlays,
  clearMyTemplates, clearTerrain, renderTerrain, getTerrainSet,
} from "./overlay.js";
import { keyToHex } from "./hex.js";
import { loadCompendium, parsePilotFile, resolveMech } from "./compcon.js";
import { rollAttack, rollDamage } from "./dice.js";
import { registerTool, templateConfig } from "./tool.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const LS = {
  pilot: "lu.pilotRaw",
  mechIdx: "lu.mechIdx",
  token: "lu.tokenId",
  status: (mech) => `lu.status.${mech}`,
};

const state = {
  pilot: null,        // parsed pilot
  mechsRaw: [],
  mech: null,         // resolved mech
  tokenId: null,
  tokenPos: null,
  status: null,       // { hp, heat, structure, stress, repairs, core, overshield }
  acc: 0, flat: 0,
  dmg: { d3: 0, d6: 0, flat: 0 },
  overlays: new Map(), // slot -> { compute(centerHex) -> hexes, opts, btn }
};

const COLORS = { move: "#58c178", tech: "#3fa7d6", weapon: "#d22f3d" };

const WEAPON_ICONS = {
  rifle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 14 L16 14 L16 11 L21 11 M16 14 L16 17 M6 14 L6 18 M12 14 L12 16.5"/><path d="M2 14 L2 12 L9 12"/></svg>`,
  cqb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 10 H18 V13 H10 L9 17 H5 L6 13 H3 Z M18 10.5 H21"/></svg>`,
  cannon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 13 H17 L21 9 M2 13 V16 H8 M11 13 V16"/><circle cx="6" cy="18.5" r="1.6"/></svg>`,
  launcher: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="9" width="13" height="6"/><path d="M16 12 H20 L22 10 M22 14 L20 12 M5 9 V7 M9 9 V7 M13 9 V7"/></svg>`,
  melee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 19 L17 7 L20 4 L20 7 L8 19 M5 19 L4 20 M7 15 L10 18"/></svg>`,
  nexus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="6" r="1.6"/><circle cx="12" cy="20" r="1.6"/><path d="M6.3 7 L10 10.4 M17.7 7 L14 10.4 M12 15 V18.4"/></svg>`,
};

const setFooter = (t) => { $("#footer-status").textContent = t; };

// =============================================================== boot

OBR.onReady(async () => {
  $("#conn-status").textContent = "LINK ESTABLISHED";
  bindStaticUI();
  loadCompendium((s) => { $("#compendium-status").textContent = s; })
    .then(() => { if (state.pilot) selectMech(getMechIdx()); });

  const start = async () => {
    await calibrate();
    renderGridReadout();
    try { await registerTool(); } catch (e) { console.warn("tool registration", e); }
    restoreLocal();
    watchTokenMovement();
    setFooter("⟢ UPLINK READY — ALL SYSTEMS NOMINAL");
  };
  if (await OBR.scene.isReady()) await start();
  OBR.scene.onReadyChange(async (ready) => { if (ready) await start(); });

  OBR.broadcast.onMessage(CH_ROLL, (ev) => appendLog(ev.data));
  OBR.broadcast.onMessage(CH_CASCADE, (ev) => runCascade(ev.data?.who, false));
});

function restoreLocal() {
  const raw = localStorage.getItem(LS.pilot);
  if (raw) {
    try { importPilot(JSON.parse(raw), false); } catch (_) {}
  }
  state.tokenId = localStorage.getItem(LS.token) || null;
  refreshBondStatus();
}

// =============================================================== static UI

function bindStaticUI() {
  // tabs
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      $$(".pane").forEach((p) =>
        p.classList.toggle("active", p.id === `pane-${t.dataset.tab}`));
    })
  );

  // file import
  const dz = $("#dropzone"), fi = $("#file-input");
  dz.addEventListener("click", () => fi.click());
  fi.addEventListener("change", () => fi.files[0] && readFile(fi.files[0]));
  ["dragover", "dragenter"].forEach((e) =>
    dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) =>
    dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (ev) => {
    const f = ev.dataTransfer?.files?.[0];
    if (f) readFile(f);
  });

  $("#mech-select").addEventListener("change", (e) => selectMech(Number(e.target.value)));
  $("#btn-claim").addEventListener("click", claimToken);
  $("#btn-full-repair").addEventListener("click", fullRepair);

  // steppers & misc +/- buttons
  document.body.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.stat) adjustStatus(b.dataset.stat, Number(b.dataset.d));
    if (b.dataset.step) adjustStepper(b.dataset.step, Number(b.dataset.d));
  });

  // actions
  $("#act-move").addEventListener("click", () => toggleStatOverlay("move", () => state.mech.stats.speed, COLORS.move, $("#act-move")));
  $("#act-boost").addEventListener("click", () => toggleStatOverlay("boost", () => state.mech.stats.speed, COLORS.move, $("#act-boost")));
  $("#act-sensors").addEventListener("click", () => toggleStatOverlay("sensors", () => state.mech.stats.sensors, COLORS.tech, $("#act-sensors")));
  $("#act-tech").addEventListener("click", () => toggleStatOverlay("tech", () => state.mech.stats.sensors, COLORS.tech, $("#act-tech")));
  $("#btn-clear-overlays").addEventListener("click", powerDownOverlays);

  // dice
  $("#chip-grit").addEventListener("click", () => { state.flat += state.mech?.stats.attackBonus || 0; renderDiceState(); });
  $("#chip-tech").addEventListener("click", () => { state.flat += state.mech?.stats.techAttack || 0; renderDiceState(); });
  $("#btn-attack").addEventListener("click", doAttack);
  $$(".die-chip").forEach((c) =>
    c.addEventListener("click", () => {
      const k = `d${c.dataset.die}`;
      state.dmg[k] = (state.dmg[k] + 1) % 10;
      renderDiceState();
    }));
  $("#btn-dice-reset").addEventListener("click", () => { state.dmg = { d3: 0, d6: 0, flat: 0 }; renderDiceState(); });
  $("#overkill-mode").addEventListener("change", (e) => {
    $("#ok-mode-label").textContent = e.target.checked ? "RAW" : "HOUSE";
  });
  $("#btn-damage").addEventListener("click", doDamage);

  // map
  $$(".swatch").forEach((s) =>
    s.addEventListener("click", () => {
      $$(".swatch").forEach((x) => x.classList.toggle("sel", x === s));
      templateConfig.color = s.dataset.color;
    }));
  $("#btn-clear-mine").addEventListener("click", () => clearMyTemplates().catch(console.warn));
  $("#btn-clear-terrain").addEventListener("click", async () => {
    await clearTerrain();
    await renderTerrain([], keyToHex);
  });
  $("#btn-recal").addEventListener("click", async () => {
    await calibrate(); renderGridReadout(); refreshOverlays();
  });

  // cascade
  $("#btn-cascade").addEventListener("click", async () => {
    const name = await OBR.player.getName().catch(() => "UNKNOWN NHP");
    OBR.broadcast.sendMessage(CH_CASCADE, { who: name }, { destination: "REMOTE" }).catch(() => {});
    runCascade(name, true);
  });
}

function adjustStepper(which, d) {
  if (which === "acc") { state.acc = Math.max(-6, Math.min(6, state.acc + d)); }
  if (which === "flat") { state.flat += d; }
  if (which === "dflat") { state.dmg.flat += d; }
  if (which === "tsize") {
    templateConfig.size = Math.max(1, Math.min(20, templateConfig.size + d));
    $("#tsize-val").textContent = templateConfig.size;
  }
  renderDiceState();
}

// =============================================================== pilot import

function readFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      importPilot(JSON.parse(r.result), true);
    } catch (e) {
      setFooter(`⟢ IMPORT FAILED — ${e.message}`);
    }
  };
  r.readAsText(file);
}

function importPilot(json, persist) {
  const { pilot, mechs } = parsePilotFile(json);
  state.pilot = pilot;
  state.mechsRaw = mechs;
  if (persist) localStorage.setItem(LS.pilot, JSON.stringify(json));

  const sel = $("#mech-select");
  sel.innerHTML = "";
  sel.disabled = mechs.length === 0;
  mechs.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = `${m.name} — ${m.frameId.replace(/^mf_/, "").replace(/_/g, " ").toUpperCase()}`;
    sel.appendChild(o);
  });
  const idx = Math.min(getMechIdx(), Math.max(0, mechs.length - 1));
  const activeIdx = mechs.findIndex((m) => m.active);
  selectMech(activeIdx >= 0 ? activeIdx : idx);
  setFooter(`⟢ PILOT REGISTERED — ${pilot.callsign.toUpperCase()}`);
}

const getMechIdx = () => Number(localStorage.getItem(LS.mechIdx) || 0);

function selectMech(idx) {
  if (!state.mechsRaw.length) return;
  idx = Math.max(0, Math.min(idx, state.mechsRaw.length - 1));
  localStorage.setItem(LS.mechIdx, idx);
  $("#mech-select").value = idx;
  state.mech = resolveMech(state.mechsRaw[idx], state.pilot);
  loadStatus();
  renderHeader();
  renderStatus();
  renderActions();
  renderDiceState();
  powerDownOverlays();
}

// =============================================================== header / status

function renderHeader() {
  const p = state.pilot, m = state.mech;
  $("#hud-eyebrow").textContent = p ? `${p.name.toUpperCase()} // UNION-REGISTERED PILOT` : "NO PILOT REGISTERED";
  const cs = p ? p.callsign.toUpperCase() : "UPLINK";
  const csEl = $("#hud-callsign");
  csEl.textContent = cs;
  csEl.dataset.text = cs;
  $("#hud-frame").textContent = m ? `${m.name} — ${m.stats.frameName}` : "IMPORT A COMP/CON FILE TO BEGIN";
  $("#hud-ll").textContent = p ? p.level : "—";
}

function defaultStatus() {
  const s = state.mech.stats, c = state.mech.current || {};
  return {
    hp: c.hp ?? s.hpMax,
    heat: c.heat ?? 0,
    structure: c.structure ?? s.structureMax,
    stress: c.stress ?? s.stressMax,
    repairs: c.repairs ?? s.repMax,
    core: c.core ?? 1,
    overshield: c.overshield ?? 0,
  };
}

function loadStatus() {
  const key = LS.status(state.mech.name);
  try {
    state.status = { ...defaultStatus(), ...(JSON.parse(localStorage.getItem(key)) || {}) };
  } catch (_) { state.status = defaultStatus(); }
}
const saveStatus = () =>
  localStorage.setItem(LS.status(state.mech.name), JSON.stringify(state.status));

function adjustStatus(stat, d) {
  if (!state.mech) return;
  const s = state.status, m = state.mech.stats;
  const caps = { hp: m.hpMax, heat: m.heatMax, overshield: 99 };
  s[stat] = Math.max(0, Math.min(caps[stat] ?? 99, (s[stat] ?? 0) + d));
  saveStatus(); renderStatus();
}

function fullRepair() {
  if (!state.mech) return;
  state.status = {
    ...defaultStatus(),
    hp: state.mech.stats.hpMax, heat: 0,
    structure: state.mech.stats.structureMax,
    stress: state.mech.stats.stressMax,
    repairs: state.mech.stats.repMax,
    core: 1, overshield: 0,
  };
  saveStatus(); renderStatus();
  setFooter("⟢ FULL REPAIR COMPLETE — REACTOR NOMINAL");
}

function pipRow(el, count, max, kind, onSet) {
  el.innerHTML = "";
  for (let i = 1; i <= max; i++) {
    const b = document.createElement("button");
    b.className = `pip ${kind} ${i <= count ? "on" : ""}`;
    b.title = `${i}/${max}`;
    b.addEventListener("click", () => onSet(i === count ? i - 1 : i));
    el.appendChild(b);
  }
}

function renderStatus() {
  const m = state.mech;
  $("#status-card").hidden = !m;
  if (!m) return;
  const s = state.status, st = m.stats;

  $("#hp-fill").style.width = `${(100 * s.hp) / st.hpMax}%`;
  $("#hp-text").textContent = `${s.hp} / ${st.hpMax}${s.overshield ? `  (+${s.overshield})` : ""}`;
  $("#heat-fill").style.width = `${(100 * s.heat) / st.heatMax}%`;
  $("#heat-text").textContent = `${s.heat} / ${st.heatMax}`;
  $(".meter.heat").classList.toggle("danger", s.heat >= Math.ceil(st.heatMax / 2));
  $("#overshield-val").textContent = s.overshield;

  pipRow($("#pips-structure"), s.structure, st.structureMax, "", (v) => { s.structure = v; saveStatus(); renderStatus(); });
  pipRow($("#pips-stress"), s.stress, st.stressMax, "", (v) => { s.stress = v; saveStatus(); renderStatus(); });
  pipRow($("#pips-repairs"), s.repairs, st.repMax, "", (v) => { s.repairs = v; saveStatus(); renderStatus(); });
  pipRow($("#pips-core"), s.core, st.coreMax, "core", (v) => { s.core = v; saveStatus(); renderStatus(); });

  const cells = [
    [st.evasion, "EVADE"], [st.edef, "E-DEF"], [st.speed, "SPEED"], [st.sensors, "SENSOR"],
    [st.armor, "ARMOR"], [`+${st.techAttack}`, "T.ATK"], [st.save, "SAVE"], [st.size, "SIZE"],
  ];
  $("#stat-grid").innerHTML = cells
    .map(([v, k]) => `<div class="stat-cell"><div class="v">${v}</div><div class="k">${k}</div></div>`)
    .join("");

  $("#systems-list").innerHTML = (m.systems || [])
    .map((n) => `<span class="sys-chip">${esc(n)}</span>`)
    .join("");
}

// =============================================================== token bond

async function claimToken() {
  const sel = await OBR.player.getSelection();
  if (!sel?.length) {
    setFooter("⟢ SELECT A TOKEN ON THE MAP FIRST");
    OBR.notification.show("Select your token on the map, then press CLAIM.", "WARNING").catch(() => {});
    return;
  }
  state.tokenId = sel[0];
  localStorage.setItem(LS.token, state.tokenId);
  await refreshBondStatus();
  refreshOverlays();
}

async function refreshBondStatus() {
  const el = $("#bond-status");
  if (!state.tokenId) { el.textContent = "UNBONDED"; el.classList.remove("bonded"); renderActions(); return; }
  try {
    const [item] = await OBR.scene.items.getItems([state.tokenId]);
    if (item) {
      el.textContent = `⬡ BONDED — ${item.name || "TOKEN"}`;
      el.classList.add("bonded");
      state.tokenPos = { ...item.position };
    } else {
      el.textContent = "BOND LOST (token missing)";
      el.classList.remove("bonded");
      state.tokenId = null;
    }
  } catch (_) {}
  renderActions();
}

async function getTokenHex() {
  if (!state.tokenId) return null;
  const [item] = await OBR.scene.items.getItems([state.tokenId]);
  if (!item) return null;
  const snapped = await OBR.grid.snapPosition(item.position).catch(() => item.position);
  return pixelToHex(snapped);
}

// Re-render active overlays whenever the bonded token moves.
function watchTokenMovement() {
  OBR.scene.items.onChange((items) => {
    if (!state.tokenId || !state.overlays.size) return;
    const t = items.find((i) => i.id === state.tokenId);
    if (!t) return;
    const moved =
      !state.tokenPos ||
      Math.hypot(t.position.x - state.tokenPos.x, t.position.y - state.tokenPos.y) > grid.R * 0.5;
    if (moved) {
      state.tokenPos = { ...t.position };
      refreshOverlays();
    }
  });
}

// =============================================================== overlays

async function toggleStatOverlay(slot, sizeFn, color, btn) {
  if (!state.mech) return;
  if (state.overlays.has(slot)) {
    state.overlays.delete(slot);
    btn?.classList.remove("on");
    await clearLocalOverlay(slot);
    return;
  }
  const center = await getTokenHex();
  if (!center) { setFooter("⟢ BOND A TOKEN FIRST (PILOT TAB)"); return; }
  state.overlays.set(slot, { sizeFn, color, btn });
  btn?.classList.add("on");
  await drawOverlay(slot, center);
}

async function drawOverlay(slot, center) {
  const o = state.overlays.get(slot);
  if (!o) return;
  const n = Math.max(0, o.sizeFn());
  await showLocalOverlay(slot, hexesInRange(center, n, true), {
    color: o.color,
    fillOpacity: 0.16,
    strokeOpacity: 0.7,
    strokeWidth: 2.5,
    name: `LANCER ${slot}`,
  });
}

async function refreshOverlays() {
  if (!state.overlays.size) return;
  const center = await getTokenHex();
  if (!center) return;
  for (const slot of state.overlays.keys()) await drawOverlay(slot, center);
}

async function powerDownOverlays() {
  state.overlays.clear();
  $$(".action-btn.on, .w-range-btn.on").forEach((b) => b.classList.remove("on"));
  await clearAllLocalOverlays();
}

// =============================================================== actions tab

function renderActions() {
  const m = state.mech;
  const ready = !!m;
  $("#act-move").disabled = !ready;
  $("#act-boost").disabled = !ready;
  $("#act-sensors").disabled = !ready;
  $("#act-tech").disabled = !ready;
  if (m) {
    $("#move-sub").textContent = `SPD ${m.stats.speed}`;
    $("#boost-sub").textContent = `+SPD ${m.stats.speed}`;
    $("#sensors-sub").textContent = `RNG ${m.stats.sensors}`;
    $("#tech-sub").textContent = `+${m.stats.techAttack} / RNG ${m.stats.sensors}`;
    $("#chip-grit").textContent = `+GRIT ${m.stats.attackBonus}`;
    $("#chip-tech").textContent = `+TECH ${m.stats.techAttack}`;
  }

  const list = $("#mounts-list");
  if (!m || !m.mounts.length) {
    list.innerHTML = `<p class="hint">Load a mech and bond a token to arm the rack.</p>`;
    return;
  }
  list.innerHTML = "";
  m.mounts.forEach((mt, mi) => {
    const block = document.createElement("div");
    block.className = "mount-block";
    block.innerHTML = `<div class="mount-head">${esc(mt.label)}</div>`;
    if (!mt.weapons.length) {
      block.insertAdjacentHTML("beforeend", `<div class="weapon-row"><span class="hint" style="margin:0">— empty —</span></div>`);
    }
    mt.weapons.forEach((w, wi) => {
      const slot = `w:${mi}:${wi}`;
      const rangeVal = w.range || w.threat || 0;
      const aoe = [
        w.blast ? `BLAST ${w.blast}` : "",
        w.cone ? `CONE ${w.cone}` : "",
        w.line ? `LINE ${w.line}` : "",
        w.burst ? `BURST ${w.burst}` : "",
      ].filter(Boolean).join(" · ");
      const meta = [
        w.range ? `RNG ${w.range}` : "",
        w.threat ? `THR ${w.threat}` : "",
        aoe,
        w.damage,
        w.overkill ? `<span class="ok-tag">OVERKILL</span>` : "",
      ].filter(Boolean).join(" · ");

      const row = document.createElement("div");
      row.className = "weapon-row";
      row.innerHTML = `
        <span class="w-icon">${WEAPON_ICONS[w.icon] || WEAPON_ICONS.rifle}</span>
        <span class="w-info">
          <div class="w-name">${esc(w.name)}</div>
          <div class="w-meta">${meta}</div>
        </span>
        <button class="w-range-btn" ${rangeVal ? "" : "disabled"}>RNG ${rangeVal}</button>`;
      const btn = row.querySelector(".w-range-btn");
      btn.addEventListener("click", () =>
        toggleStatOverlay(slot, () => rangeVal, COLORS.weapon, btn));
      block.appendChild(row);
    });
    list.appendChild(block);
  });
}

// =============================================================== dice tab

function renderDiceState() {
  $("#acc-val").textContent = state.acc;
  const lab = $("#acc-label");
  if (state.acc > 0) { lab.textContent = `ACCURACY ×${state.acc}`; lab.className = "step-label acc"; }
  else if (state.acc < 0) { lab.textContent = `DIFFICULTY ×${-state.acc}`; lab.className = "step-label diff"; }
  else { lab.textContent = "NEUTRAL"; lab.className = "step-label"; }
  $("#flat-val").textContent = (state.flat >= 0 ? "+" : "") + state.flat;
  $("#n-d3").textContent = state.dmg.d3;
  $("#n-d6").textContent = state.dmg.d6;
  $("#dflat-val").textContent = (state.dmg.flat >= 0 ? "+" : "") + state.dmg.flat;
}

async function doAttack() {
  const res = rollAttack({ netAccuracy: state.acc, flat: state.flat });
  const out = $("#attack-out");
  out.hidden = false;
  const accBit = res.netAccuracy !== 0
    ? ` <span class="roll-detail">${res.netAccuracy > 0 ? "ACC" : "DIFF"} ${res.accDice.map((d) => `<span class="die-face">${d}</span>`).join("")} → ${res.accApplied >= 0 ? "+" : ""}${res.accApplied}</span>`
    : "";
  out.innerHTML = `
    <span class="roll-total ${res.total >= 20 ? "crit" : ""}">${res.total}</span>
    ${res.total >= 20 ? `<span class="heat-warn"> CRITICAL</span>` : ""}
    <div class="roll-detail">d20 <span class="die-face">${res.d20}</span>${res.flat ? ` ${res.flat > 0 ? "+" : ""}${res.flat}` : ""}${accBit}</div>`;
  broadcastRoll({
    kind: "attack",
    text: `d20[${res.d20}]${res.flat ? (res.flat > 0 ? "+" : "") + res.flat : ""}${res.netAccuracy ? ` ${res.netAccuracy > 0 ? "ACC" : "DIFF"}[${res.accDice.join(",")}]→${res.accApplied >= 0 ? "+" : ""}${res.accApplied}` : ""}`,
    total: res.total,
    crit: res.total >= 20,
  });
}

async function doDamage() {
  const dice = [];
  if (state.dmg.d6) dice.push({ n: state.dmg.d6, faces: 6 });
  if (state.dmg.d3) dice.push({ n: state.dmg.d3, faces: 3 });
  if (!dice.length && !state.dmg.flat) { setFooter("⟢ ADD SOME DICE FIRST"); return; }
  const overkill = $("#overkill-toggle").checked;
  const mode = $("#overkill-mode").checked ? "raw" : "house";
  const res = rollDamage({ dice, flat: state.dmg.flat, overkill, mode });

  const out = $("#damage-out");
  out.hidden = false;
  const facesHtml = res.groups
    .map((g) =>
      `<span class="roll-detail">d${g.faces}:</span> ` +
      g.rolls.map((r) => {
        const cls = r.exploded ? "die-face one" : r.spawn ? "die-face spawn" : "die-face";
        const rr = r.rerolls ? `<sup>×${r.rerolls + 1}</sup>` : "";
        return `<span class="${cls}" title="${r.exploded ? "rolled a 1 — exploded" : r.spawn ? "spawned by Overkill" : ""}">${r.v}${rr}</span>`;
      }).join("")
    ).join("<br/>");
  out.innerHTML = `
    <span class="roll-total">${res.total}</span>
    <span class="roll-detail"> DMG${res.flat ? ` (incl ${res.flat > 0 ? "+" : ""}${res.flat})` : ""}</span>
    ${res.heat ? `<div class="heat-warn">⚠ OVERKILL — TAKE ${res.heat} HEAT</div>` : ""}
    ${res.truncated ? `<div class="heat-warn">…chain truncated at safety limit. Incredible.</div>` : ""}
    <div style="margin-top:4px">${facesHtml}</div>`;

  if (res.heat && state.mech) {
    adjustStatus("heat", res.heat); // auto-apply Overkill heat to your own reactor
  }
  broadcastRoll({
    kind: "damage",
    text: res.groups.map((g) => `d${g.faces}[${g.rolls.map((r) => r.v).join(",")}]`).join(" ")
      + (res.flat ? ` ${res.flat > 0 ? "+" : ""}${res.flat}` : "")
      + (res.heat ? ` ⚠+${res.heat} HEAT` : ""),
    total: res.total,
  });
}

async function broadcastRoll(payload) {
  const who = state.pilot?.callsign?.toUpperCase()
    || (await OBR.player.getName().catch(() => "PILOT"));
  const data = { who, ...payload };
  appendLog(data);
  OBR.broadcast.sendMessage(CH_ROLL, data, { destination: "REMOTE" }).catch(() => {});
}

function appendLog(d) {
  const log = $("#roll-log");
  log.querySelector(".log-empty")?.remove();
  const e = document.createElement("div");
  e.className = "log-entry";
  e.style.borderLeftColor = d.kind === "attack" ? "var(--red)" : "var(--amber)";
  e.innerHTML = `<span class="who">${esc(d.who)}</span> <span class="what">${d.kind === "attack" ? "attacks" : "deals"}</span> <span class="tot">${d.total}</span>${d.crit ? ' <span class="heat-warn">CRIT</span>' : ""}<br/><span class="what">${esc(d.text)}</span>`;
  log.prepend(e);
  while (log.children.length > 40) log.lastChild.remove();
}

// =============================================================== cascade

const GLYPHS = "▚▞▙▟█▓▒░ΞΨΔ01ERROR//";
let cascadeTimer = null;

function runCascade(who = "UNKNOWN", local = true) {
  document.body.classList.add("cascading");
  OBR.notification.show(`⚠ NHP CASCADE DETECTED — SOURCE: ${who}`, "ERROR").catch(() => {});
  setFooter(`⟢ ███ CASCADE EVENT ░░ CONTAINMENT IN PROGRESS ███`);

  const csEl = $("#hud-callsign");
  const original = csEl.dataset.text || csEl.textContent;
  const scramble = setInterval(() => {
    csEl.textContent = original
      .split("")
      .map((c) => (Math.random() < 0.4 ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c))
      .join("");
  }, 70);

  clearTimeout(cascadeTimer);
  cascadeTimer = setTimeout(() => {
    clearInterval(scramble);
    csEl.textContent = original;
    document.body.classList.remove("cascading");
    setFooter("⟢ CASCADE CONTAINED — SHACKLES HOLDING. PROBABLY.");
  }, 4500);
}

// =============================================================== map tab

function renderGridReadout() {
  const el = $("#grid-readout");
  if (!grid.isHexGrid) {
    el.innerHTML = `⚠ This scene's grid is <b>not hex</b>. Templates assume hexes — switch the room grid to Hex for correct shapes.`;
    return;
  }
  el.innerHTML = `Hex grid locked: <b>${grid.pointy ? "pointy-top" : "flat-top"}</b> · spacing ${Math.round(grid.R * Math.sqrt(3))}px · dpi ${grid.dpi}. If overlays look offset, re-probe.`;
}

// =============================================================== utils

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
