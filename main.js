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

import { OBR, CH_ROLL3D, CH_STATUS, META, buildShape, buildLabel, buildPath, Command } from "./sdk.js";
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
// empty hexagon = free / reactionary (outside the normal action economy)
const ICON_FREE = `<svg class="acticon" viewBox="0 0 20 20" aria-label="Free / reactionary"><polygon points="10,1.5 17.5,5.75 17.5,14.25 10,18.5 2.5,14.25 2.5,5.75" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

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
        nudge: { ...hex.grid.nudge },
        uiScale,
        sound: sndOn,
        macro: $("macro-toggle")?.checked || false,
        tokenBars: tokenBarsOn,
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
    else resetDiceMods(); // leaving DICE clears stale flat/crit/overkill presets
    if (tab === "lancers") requestAnimationFrame(() => setGmView(gmView)); // re-render + holo position
  });
});
const diceTabActive = () =>
  document.getElementById("tab-dice")?.classList.contains("active");

// ---- collapse / expand (mobile): tap the version to fold the panel down to
// just the header + tabs, sliding smoothly. Overflow is only clamped during the
// animation so the sticky ROLL button still works when fully expanded.
(function setupCollapse() {
  const main = $("player-main");
  const ver = $("verbtn");
  if (!main || !ver) return;
  let animating = false;
  ver.addEventListener("click", () => {
    if (animating) return;
    animating = true;
    const collapsing = !document.body.classList.contains("collapsed");
    main.style.overflow = "hidden";
    main.style.maxHeight = main.scrollHeight + "px";
    const onEnd = () => {
      main.removeEventListener("transitionend", onEnd);
      animating = false;
      if (!collapsing) { main.style.maxHeight = ""; main.style.overflow = ""; } // restore sticky
    };
    main.addEventListener("transitionend", onEnd);
    requestAnimationFrame(() => {
      document.body.classList.toggle("collapsed", collapsing);
      main.style.maxHeight = collapsing ? "0px" : main.scrollHeight + "px";
    });
  });
})();

function switchToDiceTab() {
  document.querySelector('nav.tabs button[data-tab="dice"]')?.click();
  // land at the TOP of the dice tab with the combat log tucked away — no
  // more arriving mid-log and scrolling up to find the tray
  $("sec-log")?.removeAttribute("open");
  window.scrollTo({ top: 0, behavior: "auto" });
}

// ====================================================== MISSION//CONTROL ======
let gmMode = false;
const squad = new Map(); // who -> last status payload

$("hdr-icon")?.addEventListener("click", () => setGmMode(!gmMode));

// MISSION//CONTROL keeps the DICE and MAP tabs — only the first tab swaps
// between PILOT (player sheet) and LANCERS (live squad telemetry).
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
  const firstBtn = document.querySelector(
    'nav.tabs button[data-tab="pilot"], nav.tabs button[data-tab="lancers"]'
  );
  if (firstBtn) {
    const wasActive = firstBtn.classList.contains("active");
    firstBtn.dataset.tab = on ? "lancers" : "pilot";
    firstBtn.textContent = on ? "LANCERS" : "PILOT";
    if (wasActive) firstBtn.click(); // re-route to the new pane
  }
  if (on) {
    requestAnimationFrame(() => setGmView(gmView));
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
        bondId: bond?.id || null, // lets the GM ping our token
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
    const pips = (cur, max) => "◆".repeat(Math.max(0, cur)) + "◇".repeat(Math.max(0, (max || 0) - (cur || 0)));
    // soft hyphens let marathon names ("Supercalifragilistic…") wrap with a
    // visible hyphen instead of running off the card edge
    const softWrap = (t) => String(t || "").replace(/(\S{10})(?=\S)/g, "$1­");
    const card = document.createElement("div");
    card.className = `lancer-card${now - (e.ts || 0) > 60000 ? " lc-stale" : ""}`;
    card.title = e.bondId ? "Click to locate this lancer's token on the map" : "";
    card.innerHTML = `
      <button class="lc-kick" title="Remove this lancer from everyone's Squad Telemetry (they can rejoin any time)">✕</button>
      <div class="lc-head">
        <span class="lc-callsign">${softWrap(e.callsign) || "PILOT"}</span>
        <div class="lc-sub">
          <span class="lc-mech">${softWrap(e.mech)} · ${softWrap(e.frame)}</span>
          <span class="lc-player">${softWrap(e.who)} · LL${e.ll ?? "?"}</span>
        </div>
      </div>
      <div class="lc-bars">
        <div class="lc-barrow"><span class="k">HP</span>${segBar(lv.hp ?? 0, st.hpMax ?? 1, "var(--hpblue)")}<span class="v">${lv.hp ?? "?"}/${st.hpMax ?? "?"}${lv.overshield ? ` (+${lv.overshield})` : ""}</span></div>
        <div class="lc-barrow"><span class="k">HEAT</span>${segBar(lv.heat ?? 0, st.heatMax ?? 1, "var(--heatred)")}<span class="v">${lv.heat ?? "?"}/${st.heatMax ?? "?"}</span></div>
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
    if (e.bondId) card.addEventListener("click", () => pingToken(e.bondId)); // GM click-to-ping
    // kick: two-step confirm, then drop this lancer from EVERY squad view.
    // Their client re-reports on their next status change, so it's reversible.
    const kick = card.querySelector(".lc-kick");
    kick.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't trigger the ping
      if (kick.dataset.armed) {
        squad.delete(e.who);
        renderGM();
        try {
          OBR.broadcast.sendMessage(CH_STATUS, { type: "kick", who: e.who }, { destination: "REMOTE" });
        } catch (_) {}
      } else {
        kick.dataset.armed = "1";
        kick.classList.add("armed");
        kick.textContent = "SURE?";
        setTimeout(() => {
          delete kick.dataset.armed;
          kick.classList.remove("armed");
          kick.textContent = "✕";
        }, 2500);
      }
    });
    wrap.appendChild(card);
  }
}

// ---- GM click-to-ping: locate a lancer's bonded token --------------------------
async function pingToken(tokenId) {
  if (!obrReady || !tokenId) return;
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    const it = items[0];
    if (!it) return setStatus("That lancer's token isn't in this scene.", "status-err");
    const p = it.position;
    const r = (hex.grid.dpi || 150) * 2.2;
    try {
      await OBR.viewport.animateToBounds({ x: p.x - r * 2, y: p.y - r * 2, width: r * 4, height: r * 4 });
    } catch (_) {}
    // pulse a local ring on the token a few times
    for (let k = 0; k < 3; k++) {
      const ring = buildShape()
        .shapeType("CIRCLE")
        .position(p)
        .width(r * (1 + k * 0.15))
        .height(r * (1 + k * 0.15))
        .fillOpacity(0)
        .strokeColor("#7ee6ff")
        .strokeOpacity(0.9)
        .strokeWidth(8)
        .layer("POINTER")
        .locked(true)
        .disableHit(true)
        .metadata({ [META]: { kind: "ping" } })
        .build();
      await OBR.scene.local.addItems([ring]);
      await new Promise((res) => setTimeout(res, 280));
      await OBR.scene.local.deleteItems([ring.id]).catch?.(() => {});
    }
  } catch (e) {
    console.warn("[LANCER//UPLINK] ping failed", e);
  }
}

// ========================================================== TOKEN STATUS BARS ==
// House-rule overlay: small live HP (blue) + Heat (orange) bars above every
// bonded lancer token — mine plus everyone's via squad broadcasts. Local items
// only (each client draws what it knows), attached to the token so they follow
// it. Selecting a token reveals its exact X/Y values. Built to extend later
// (conditions, more stats) — add another `bar(...)` / label row per token.
let tokenBarsOn = false;
let selectedTokens = new Set();
const TBAR = "tokenbar";
const CMD = { MOVE: Command?.MOVE ?? 0, LINE: Command?.LINE ?? 1, CLOSE: Command?.CLOSE ?? 4 };

// [{ id, hp, hpMax, heat, heatMax, size }] for every bonded token we know about
function tokenBarTargets() {
  const out = [];
  const seen = new Set();
  const add = (id, hp, hpMax, heat, heatMax, size) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, hp: hp ?? 0, hpMax: Math.max(1, hpMax ?? 1), heat: heat ?? 0, heatMax: Math.max(1, heatMax ?? 1), size: size || 1 });
  };
  if (bond?.id && live && currentMech) {
    const s = currentMech.stats;
    add(bond.id, live.hp, s.hpMax, live.heat, s.heatMax, s.size);
  }
  for (const e of squad.values()) {
    if (e.bondId) add(e.bondId, e.live?.hp, e.stats?.hpMax, e.live?.heat, e.stats?.heatMax, e.stats?.size);
  }
  return out;
}

let tokenBarsBusy = false, tokenBarsPending = false;
async function renderTokenBars() {
  if (!obrReady) return;
  if (tokenBarsBusy) { tokenBarsPending = true; return; } // serialize rebuilds
  tokenBarsBusy = true;
  try {
    const old = await OBR.scene.local.getItems((i) => i.metadata?.[META]?.kind === TBAR);
    if (old.length) await OBR.scene.local.deleteItems(old.map((i) => i.id));
    if (!tokenBarsOn) return;
    const targets = tokenBarTargets();
    if (!targets.length) return;
    let tokens = [];
    try { tokens = await OBR.scene.items.getItems(targets.map((t) => t.id)); } catch (_) {}
    const byId = new Map(tokens.map((t) => [t.id, t]));
    const cell = hex.grid.dpi || 150;
    const meta = { [META]: { kind: TBAR } };
    const items = [];
    for (const t of targets) {
      const tok = byId.get(t.id);
      if (!tok || !tok.position) continue;
      const foot = cell * (t.size || 1);           // token footprint ≈ size cells
      const W = foot * 0.86, H = Math.max(6, cell * 0.1), gap = cell * 0.03;
      const cx = tok.position.x, left = cx - W / 2; // CENTRED on the token
      const hpY = tok.position.y - foot * 0.5 - cell * 0.16 - H;
      const heatY = hpY + H + gap;
      const attach = (it) => { it.attachedTo = t.id; it.disableAttachmentBehavior = ["ROTATION", "SCALE", "COPY"]; items.push(it); };
      // Skewed rhombus cells, matching the pilot HP/Heat UI: a faint dark track
      // with a black outline, with the first `filled` cells lit in colour.
      const cellBar = (y, cur, max, color) => {
        const cells = Math.max(1, Math.min(20, Math.round(max)));
        const filled = Math.max(0, Math.min(cells, Math.round((cur / Math.max(1, max)) * cells)));
        const cellW = W / cells, g = cellW * 0.16, skew = H * 0.42, ox = skew / 2;
        const quad = (i) => {
          const x0 = left + i * cellW + g + ox, x1 = left + (i + 1) * cellW - g + ox;
          return [[CMD.MOVE, x0, y + H], [CMD.LINE, x1, y + H], [CMD.LINE, x1 - skew, y], [CMD.LINE, x0 - skew, y], [CMD.CLOSE]];
        };
        const track = [];
        for (let i = 0; i < cells; i++) track.push(...quad(i));
        attach(buildPath().position({ x: 0, y: 0 }).commands(track)
          .fillColor("#0c0e13").fillOpacity(0.5).strokeColor("#000000").strokeOpacity(0.8).strokeWidth(Math.max(1, cell * 0.006))
          .fillRule("evenodd").layer("PROP").locked(true).disableHit(true).metadata(meta).build());
        if (filled > 0) {
          const fillCmds = [];
          for (let i = 0; i < filled; i++) fillCmds.push(...quad(i));
          attach(buildPath().position({ x: 0, y: 0 }).commands(fillCmds)
            .fillColor(color).fillOpacity(0.66).strokeColor("#000000").strokeOpacity(0.45).strokeWidth(Math.max(1, cell * 0.004))
            .fillRule("evenodd").layer("PROP").locked(true).disableHit(true).metadata(meta).build());
        }
      };
      cellBar(hpY, t.hp, t.hpMax, "#2196f3");    // blue HP (depletes)
      cellBar(heatY, t.heat, t.heatMax, "#ff7a1a"); // orange Heat (builds)
      // exact values only while the token is selected — keeps it subtle
      if (selectedTokens.has(t.id)) {
        const num = (y, txt) => {
          let b = buildLabel().plainText(txt).position({ x: cx, y });
          const opt = (fn, ...a) => { try { if (typeof b[fn] === "function") b = b[fn](...a); } catch (_) {} };
          opt("fontSize", Math.max(9, cell * 0.072));
          opt("pointerHeight", 0); opt("pointerWidth", 0);
          opt("backgroundOpacity", 0); opt("fillOpacity", 0);
          opt("layer", "TEXT"); opt("locked", true); opt("disableHit", true);
          opt("metadata", meta);
          const it = b.build();
          it.attachedTo = t.id;
          items.push(it);
        };
        num(hpY, `${t.hp}/${t.hpMax}`);
        num(heatY, `${t.heat}/${t.heatMax}`);
      }
    }
    if (items.length) await OBR.scene.local.addItems(items);
  } catch (e) {
    console.warn("[LANCER//UPLINK] token bars failed", e);
  } finally {
    tokenBarsBusy = false;
    if (tokenBarsPending) { tokenBarsPending = false; renderTokenBars(); }
  }
}

function setTokenBars(on) {
  tokenBarsOn = !!on;
  const cb = $("tokenbars-toggle");
  if (cb) cb.checked = tokenBarsOn;
  // ask every other client to report in so their bonded tokens get bars too
  if (tokenBarsOn) requestSquadStatus();
  renderTokenBars();
  saveState();
}
$("tokenbars-toggle")?.addEventListener("change", () => setTokenBars($("tokenbars-toggle").checked));

// ====================================================== FIELD TELEMETRY (NPCs) ==
// GM-side NPC roster — stored ONLY in this browser's localStorage, never
// broadcast, so players can't see it even by accident.
const NPC_KEY = "lancer-uplink/npcs/v1";
let npcs = [];
try { npcs = JSON.parse(localStorage.getItem(NPC_KEY) || "[]") || []; } catch (_) { npcs = []; }
function saveNpcs() {
  try { localStorage.setItem(NPC_KEY, JSON.stringify(npcs)); } catch (_) {}
}

// SQUAD / FIELD holo tab slider
let gmView = "squad";
function setGmView(which) {
  gmView = which;
  $("gmtab-squad")?.classList.toggle("sel", which === "squad");
  $("gmtab-field")?.classList.toggle("sel", which === "field");
  $("squad")?.classList.toggle("hidden", which !== "squad");
  $("field")?.classList.toggle("hidden", which !== "field");
  // slide the holographic selector over the active label
  const tab = $(which === "squad" ? "gmtab-squad" : "gmtab-field");
  const holo = $("gm-holo");
  if (tab && holo) {
    holo.style.left = `${tab.offsetLeft}px`;
    holo.style.width = `${tab.offsetWidth}px`;
  }
  if (which === "field") renderNpcs();
  if (which === "squad") renderGM();
}
$("gmtab-squad")?.addEventListener("click", () => setGmView("squad"));
$("gmtab-field")?.addEventListener("click", () => setGmView("field"));

// ---- NPC form ----------------------------------------------------------------------
function openNpcForm(npc) {
  $("npc-form")?.classList.remove("hidden");
  $("nf-id").value = npc?.id || "";
  $("nf-name").value = npc?.name || "";
  $("nf-hp").value = npc?.hpMax ?? 10;
  $("nf-heat").value = npc?.heatMax ?? 6;
  $("nf-eva").value = npc?.evasion ?? 8;
  $("nf-edef").value = npc?.edef ?? 8;
  $("nf-spd").value = npc?.speed ?? 4;
  $("nf-arm").value = npc?.armor ?? 0;
  $("nf-save").value = npc?.save ?? 10;
  $("nf-sens").value = npc?.sensors ?? 10;
  $("nf-notes").value = npc?.features || "";
  $("nf-name")?.focus();
}
function closeNpcForm() { $("npc-form")?.classList.add("hidden"); }

$("npc-add")?.addEventListener("click", () => openNpcForm(null));
$("nf-cancel")?.addEventListener("click", closeNpcForm);
$("nf-save-btn")?.addEventListener("click", () => {
  const id = $("nf-id").value || `npc-${Date.now()}`;
  const num = (el, dflt) => { const v = Number($(el)?.value); return Number.isFinite(v) ? v : dflt; };
  const existing = npcs.find((n) => n.id === id);
  const base = existing || { id, hp: null, heat: 0 };
  const next = {
    ...base,
    name: $("nf-name").value.trim() || "NPC",
    tier: existing?.tier || "", // tier kept for imports; no longer a form field
    hpMax: Math.max(1, Math.min(60, num("nf-hp", 10))),
    heatMax: Math.max(0, Math.min(60, num("nf-heat", 6))),
    evasion: num("nf-eva", 8),
    edef: num("nf-edef", 8),
    speed: num("nf-spd", 4),
    armor: num("nf-arm", 0),
    save: num("nf-save", 10),
    sensors: num("nf-sens", 10),
    features: $("nf-notes").value.trim(),
  };
  if (next.hp == null || next.hp > next.hpMax) next.hp = next.hpMax;
  if (!existing) npcs.push(next);
  else Object.assign(existing, next);
  saveNpcs();
  closeNpcForm();
  renderNpcs();
});

$("npc-clear")?.addEventListener("click", () => {
  if (!npcs.length) return;
  if (!window.confirm(`Delete ALL ${npcs.length} NPCs? This cannot be undone.`)) return;
  npcs = [];
  saveNpcs();
  renderNpcs();
});

// NPC import. Two paths:
//   1) COMP/CON PILOT exports (the same file you import on the PILOT tab) —
//      fully resolved through the compendium so the stats match exactly.
//   2) Generic NPC JSON (array or single object) with best-effort mapping.
$("npc-import")?.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    let added = 0;

    // Path 1: looks like a COMP/CON pilot file? Resolve it properly.
    const pilots = listPilots(json);
    if (pilots.length) {
      setStatus("Resolving COMP/CON file…");
      await loadCompendium(() => {});
      for (const rawPilot of pilots) {
        try {
          const { pilot, mechs } = parsePilot(rawPilot);
          const mechRaw = mechs.find((m) => m.active) || mechs[0];
          if (!mechRaw) continue;
          const m = resolveMech(mechRaw, pilot);
          const s = m.stats;
          const weapons = m.mounts.flatMap((mt) => mt.weapons.map((w) => `${w.name} (${w.damage})`));
          const systems = m.systems.map((x) => x.name);
          npcs.push({
            id: `npc-${Date.now()}-${added}`,
            name: `${pilot.callsign} — ${m.name}`,
            tier: `LL${pilot.level}`,
            hpMax: s.hpMax, hp: s.hpMax,
            heatMax: s.heatMax, heat: 0,
            evasion: s.evasion, edef: s.edef,
            speed: s.speed, armor: s.armor, save: s.save,
            sensors: s.sensors,
            features: [...weapons, ...systems].join(", "),
          });
          added++;
        } catch (_) { /* skip malformed pilot */ }
      }
    } else {
      // Path 2: generic NPC objects
      const list = Array.isArray(json) ? json : Array.isArray(json?.npcs) ? json.npcs : [json];
      for (const o of list) {
        if (!o || typeof o !== "object") continue;
        const s = o.stats || o;
        const featureNames = []
          .concat(o.items || [], o.features || [], o.systems || [], o.weapons || [])
          .map((x) => (typeof x === "string" ? x : x?.name || x?.id || ""))
          .filter(Boolean);
        npcs.push({
          id: `npc-${Date.now()}-${added}`,
          name: o.name || o.npc?.name || "Imported NPC",
          tier: String(o.tier ?? s.tier ?? ""),
          hpMax: Number(s.hp ?? s.max_hp ?? s.hp_max ?? 10) || 10,
          hp: Number(s.hp ?? s.max_hp ?? 10) || 10,
          heatMax: Number(s.heatcap ?? s.heat_cap ?? s.heat ?? 6) || 6,
          heat: 0,
          evasion: Number(s.evasion ?? s.evade ?? 8) || 8,
          edef: Number(s.edef ?? s.e_def ?? 8) || 8,
          speed: Number(s.speed ?? 4) || 4,
          armor: Number(s.armor ?? 0) || 0,
          save: Number(s.save ?? 10) || 10,
          sensors: Number(s.sensors ?? s.sensor_range ?? 10) || 10,
          features: featureNames.join(", ") || (o.notes || ""),
        });
        added++;
      }
    }
    saveNpcs();
    renderNpcs();
    setStatus(added ? `Imported ${added} NPC${added === 1 ? "" : "s"}.` : "No pilots or NPCs found in that file.", added ? "status-ok" : "status-err");
  } catch (e) {
    setStatus(`NPC import failed: ${e.message || e}`, "status-err");
  }
  ev.target.value = "";
});

// ---- NPC cards: same telemetry styling as the lancers --------------------------------
function renderNpcs() {
  const wrap = $("npc-list");
  if (!wrap) return;
  if (!npcs.length) {
    wrap.innerHTML = `<div class="gm-empty">NO HOSTILES LOGGED.<br/>ADD NPC or import a JSON file.</div>`;
    return;
  }
  wrap.innerHTML = "";
  for (const n of npcs) {
    const card = document.createElement("div");
    card.className = "npc-card";
    // every defensive stat gets the same inline −/+ stepper, right on the card
    const statStep = (label, key, val) =>
      `<span class="ss"><span class="ssl">${label}</span><button class="pp" data-stat="${key}" data-d="-1">−</button><b>${val}</b><button class="pp" data-stat="${key}" data-d="1">+</button></span>`;
    // status colour: red name at 0 HP, orange when heat is maxed
    const nameColor = n.hp <= 0 ? "#ff4d4d" : (n.heatMax > 0 && n.heat >= n.heatMax) ? "#ffae42" : "#ffffff";
    card.innerHTML = `
      <div class="nc-head">
        <span class="nc-name" style="color:${nameColor}">${n.name}</span>
        ${n.tier ? `<span class="nc-tier">${n.tier}</span>` : ""}
        <span class="nc-actions">
          <button class="btn ghost small" data-act="edit">EDIT</button>
          <button class="btn ghost small" data-act="del">✕</button>
        </span>
      </div>
      <div class="lc-barrow"><span class="k">HP</span><span class="maxstep" title="Adjust max HP"><button class="pp" data-max="hp" data-d="-1">−</button><b>${n.hpMax}</b><button class="pp" data-max="hp" data-d="1">+</button></span>${segBarRows(n.hp, n.hpMax, "var(--hpblue)")}<span class="v">${n.hp}/${n.hpMax}</span>
        <button class="pp" data-act="hp" data-d="-1" title="Current HP">−</button><button class="pp" data-act="hp" data-d="1" title="Current HP">+</button></div>
      <div class="lc-barrow"><span class="k">HEAT</span><span class="maxstep" title="Adjust heat capacity"><button class="pp" data-max="heat" data-d="-1">−</button><b>${n.heatMax}</b><button class="pp" data-max="heat" data-d="1">+</button></span>${segBarRows(n.heat, Math.max(1, n.heatMax), "var(--heatred)")}<span class="v">${n.heat}/${n.heatMax}</span>
        <button class="pp" data-act="heat" data-d="-1" title="Current heat">−</button><button class="pp" data-act="heat" data-d="1" title="Current heat">+</button></div>
      <div class="lc-pips lc-edit" style="padding:6px 0 0">
        ${statStep("EVA", "evasion", n.evasion)}
        ${statStep("E-DEF", "edef", n.edef)}
        ${statStep("ARMOR", "armor", n.armor)}
      </div>
      <div class="lc-pips lc-edit" style="padding:4px 0 0">
        ${statStep("SPD", "speed", n.speed)}
        ${statStep("SAVE", "save", n.save)}
        ${statStep("SENS", "sensors", n.sensors ?? 10)}
      </div>
      ${n.features ? `<div class="nc-notes">${n.features}</div>` : ""}`;
    card.querySelector('[data-act="edit"]').addEventListener("click", () => openNpcForm(n));
    const del = card.querySelector('[data-act="del"]');
    del.addEventListener("click", () => {
      if (del.dataset.armed) {
        npcs = npcs.filter((x) => x.id !== n.id);
        saveNpcs();
        renderNpcs();
      } else {
        del.dataset.armed = "1";
        del.textContent = "SURE?";
        setTimeout(() => { delete del.dataset.armed; del.textContent = "✕"; }, 2500);
      }
    });
    // right-side steppers adjust the CURRENT value
    card.querySelectorAll(".pp[data-act]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.act, d = Number(b.dataset.d);
        if (k === "hp") n.hp = Math.max(0, Math.min(n.hpMax, n.hp + d));
        if (k === "heat") n.heat = Math.max(0, Math.min(n.heatMax, n.heat + d));
        saveNpcs();
        renderNpcs();
      });
    });
    // left-side steppers adjust the MAX (total), clamping current to it
    card.querySelectorAll(".pp[data-max]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.max, d = Number(b.dataset.d);
        if (k === "hp") {
          const before = n.hpMax;
          n.hpMax = Math.max(1, Math.min(60, n.hpMax + d));
          const delta = n.hpMax - before;
          // raising Max HP fills the new bars (current follows); lowering clamps
          n.hp = Math.min(n.hpMax, Math.max(0, n.hp + (delta > 0 ? delta : 0)));
        }
        if (k === "heat") {
          n.heatMax = Math.max(0, Math.min(60, n.heatMax + d)); // cap 60
          if (n.heat > n.heatMax) n.heat = n.heatMax; // Heat Capacity stays empty
        }
        saveNpcs();
        renderNpcs();
      });
    });
    // quick-edit steppers for EVA / SAVE / SENS, right on the card
    card.querySelectorAll(".pp[data-stat]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.stat, d = Number(b.dataset.d);
        n[k] = Math.max(0, Math.min(99, (n[k] ?? 10) + d));
        saveNpcs();
        renderNpcs();
      });
    });
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
  // Actually clear the loaded pilot — wipe state AND the sheet, not just the
  // saved copy.
  curRawPilot = null;
  currentPilot = null;
  currentMech = null;
  currentMechs = [];
  rosterPilots = [];
  live = null;
  restoreLive = null;
  restoreMechIdx = null;
  $("sheet")?.classList.add("hidden");
  $("forgetpilot")?.classList.add("hidden");
  $("pilotpicker")?.classList.add("hidden");
  $("mechpicker")?.classList.add("hidden");
  $("sec-import")?.setAttribute("open", "");
  if ($("pilotfile")) $("pilotfile").value = "";
  setStatus("Saved pilot forgotten and cleared. Upload a COMP/CON export to begin.", "status-ok");
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
  if (tokenBarsOn) renderTokenBars();
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
  renderTechs(m);
  renderSystems(m);
  renderTalentChips();
  renderCore(m);

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
    ? `BONDED: ${bond.name || bond.id}`
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
    if (tokenBarsOn) renderTokenBars();
    setStatus(`Bonded to "${bond.name}".`, "status-ok");
  } catch (e) {
    setStatus("Could not read the selection — open a scene first.", "status-err");
  }
});

$("btn-unbond")?.addEventListener("click", async () => {
  bond = null;
  updateBondUI();
  saveState();
  if (tokenBarsOn) renderTokenBars();
  for (const kind of Object.keys(activeFields)) await removeField(kind);
});

const fieldColor = (kind) =>
  kind === "sensors" ? "#3da5ff" : kind === "weapon" ? "#d22f3d" : "#5ad17a";

async function placeFieldAt(kind, center, size, boost, label) {
  if (boost) {
    await showBoostField("field-boost", center, size, { color: fieldColor(kind), name: `Boost ${size}`, draggable: offsetDragMode });
  } else {
    await showLocalOverlay(`field-${kind}`, hex.hexesInRange(center, size, true), {
      color: fieldColor(kind),
      fillOpacity: 0.18, strokeOpacity: 0.85, strokeWidth: 3,
      name: label || `${kind === "sensors" ? "Sensors" : kind === "weapon" ? "Range" : "Move"} ${size}`,
      kind: "range",
      draggable: offsetDragMode, // CLICK-DRAG OFFSET mode makes fields grabbable
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
  updateDragOffsetBtn(); // offset toggle availability tracks the fields
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

// Like segBar, but wraps into rows of `perRow`, stacking UPWARD (bottom row =
// 1..20), so a big HP pool (capped at 60) doesn't shove the numbers off-card.
// Each row is padded to perRow with hidden cells so the columns stay aligned.
function segBarRows(cur, max, color, perRow = 20) {
  const total = Math.max(1, Math.min(perRow * 3, max));
  // up to one row: fill the width like the standard bar (no sparse padding)
  if (total <= perRow) {
    let segs = "";
    for (let i = 0; i < total; i++) segs += `<span class="seg ${i < cur ? "on" : ""}" style="--segc:${color}"></span>`;
    return `<span class="segbar">${segs}</span>`;
  }
  // more than perRow: wrap into rows, padded to perRow so columns stay aligned
  const rows = [];
  for (let start = 0; start < total; start += perRow) {
    let segs = "";
    for (let i = start; i < start + perRow; i++) {
      if (i < total) segs += `<span class="seg ${i < cur ? "on" : ""}" style="--segc:${color}"></span>`;
      else segs += `<span class="seg spacer"></span>`;
    }
    rows.push(`<span class="segrow">${segs}</span>`);
  }
  return `<span class="segbar multi">${rows.reverse().join("")}</span>`; // row 1..20 at the bottom
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
        applyHeat(1, false); // manual: take Stress and reset heat to 0 (no carry)
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
    const head = `CORE: ${ci.name}${ci.activation ? ` — ${ci.activation}` : ""}`;
    coreRow.style.cursor = "help";
    coreRow.addEventListener("mouseenter", (e) => showTip(head, ci.description, e));
    coreRow.addEventListener("mousemove", moveTooltip);
    coreRow.addEventListener("mouseleave", hideTooltip);
    coreRow.querySelector(".lbl")?.addEventListener("click", (e) => clickPin(head, ci.description, e));
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
    logRoll({ kind: "sys", title: "STRUCTURE 0 — MECH DESTROYED", detail: "" });
    setStatus("STRUCTURE 0 — mech destroyed.", "status-err");
  }
}

// Apply a Heat change. Positive heat that exceeds Heat Capacity cascades into
// Stress — and keeps going if the overflow is large enough to blow through
// several stress levels at once — carrying the remainder into the next level.
// carry=true (Overkill etc.) carries the overflow into the next stress level;
// carry=false (manual + button) just takes the stress and resets heat to 0.
function applyHeat(amount, carry = true) {
  if (!currentMech || !live) return;
  const s = currentMech.stats;
  if (amount < 0) { live.heat = Math.max(0, live.heat + amount); return; }
  live.heat += amount;
  let guard = 0;
  while (live.heat > s.heatMax && guard++ < 50) {
    live.stress = Math.max(0, live.stress - 1);
    live.heat = carry ? live.heat - s.heatMax : 0; // carry the overflow, or reset
    if (live.stress > 0) {
      logRoll({ kind: "sys", title: "OVERHEAT", detail: `Reactor stress ${live.stress}/${s.stressMax} — heat carries to ${live.heat}/${s.heatMax}.` });
      if (macroOn()) rollOverheatTable();
    } else {
      live.heat = 0;
      logRoll({ kind: "sys", title: "STRESS 0 — REACTOR MELTDOWN", detail: "" });
      setStatus("STRESS 0 — reactor meltdown.", "status-err");
      break;
    }
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
  { re: /autopod/i, free: true, title: "Free / reactionary — fires automatically at a LOCKED ON target, no attack roll" },
  { re: /autogun/i, free: true, title: "Free action — fires on its own (see frame trait)" },
  { re: /nexus.*swarm|swarm.*nexus/i, full: false, title: "Quick action (Skirmish) — see nexus rules" },
];

// Action-economy glyph: full hex = Barrage (full), half hex = Skirmish (quick),
// empty hex = free / reactionary (Autogun, Autopod…).
function weaponActionInfo(w, mountLabel) {
  for (const o of ACTION_OVERRIDES) {
    if (o.re.test(w.name || "")) {
      const icon = o.free ? ICON_FREE : o.full ? ICON_FULL : ICON_QUICK;
      return { icon, title: o.title };
    }
  }
  if (w.free) return { icon: ICON_FREE, title: "Free / reactionary weapon — fires outside the normal attack economy" };
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
    ? `<button class="btn small ghost icon-btn" data-act="tmpl" title="${spec.field ? `Toggle ${spec.name} field around your token` : `Arm ${spec.name} template`}">◈</button>`
    : "";
  const act = weaponActionInfo(w, mountLabel);
  // ATK and Target Lock are one button now: it always runs the lock flow
  // (roll accuracy → FIRE chains damage). The hex marks it as a lock.
  el.innerHTML = `
    <div class="top">
      <span class="wname" data-act="info" title="${act.title} — hover for weapon details">${act.icon}${w.name}</span>
      <span class="wbtns">
        ${tmplBtn}
        <button class="btn small atk-lock" data-act="lock" title="ATK / Target Lock — roll accuracy, then FIRE chains damage">ATK<span class="hexlogo">⬢</span></button>
      </span>
    </div>
    <div class="wmod${w.mod ? " has-mod" : ""}" data-act="mod">${w.mod ? `◈ ${w.mod.name}${w.mod.sp != null ? ` · ${w.mod.sp} SP` : ""}` : "NO WEAPON MOD"}</div>
    <div class="meta">${[w.mountSize, w.type].filter(Boolean).join(" ")} — ${rangeBits(w)} — <b>${w.damage}</b></div>
    ${tags.length ? `<div class="tags">${tags.join(" · ")}</div>` : ""}
  `;
  el.querySelector('[data-act="lock"]').addEventListener("click", () => prepareWeaponAttack(w, true));
  // weapon mod box — hover/click shows the mod's mechanical effect
  if (w.mod) {
    const modEl = el.querySelector('[data-act="mod"]');
    const mHead = `${w.mod.name}${w.mod.sp != null ? ` — ${w.mod.sp} SP` : ""}`;
    const mBody = w.mod.effect || "No effect text in compendium.";
    modEl.addEventListener("mouseenter", (e) => showTip(mHead, mBody, e));
    modEl.addEventListener("mousemove", moveTooltip);
    modEl.addEventListener("mouseleave", hideTooltip);
    modEl.addEventListener("click", (e) => clickPin(mHead, mBody, e));
  }
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
  nameEl.addEventListener("click", (e) => clickPin(`${w.name} — ${act.title}`, body, e));
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
  // TECH ATK and Target Lock are one button (mirrors the weapon ATK button).
  el.innerHTML = `
    <div class="weapon techw" style="margin-bottom:8px">
      <div class="top">
        <span class="wname" title="Quick action (Quick Tech)">${ICON_QUICK}TECH ATTACK</span>
        <span class="wbtns">
          <button class="btn small ghost icon-btn" data-act="trange" title="Toggle sensor range field (tech attacks reach anything in Sensors)">◈</button>
          <button class="btn small tech-lock" data-act="tlock" title="TECH ATK / Target Lock — d20 ${sign} vs E-DEF, then FIRE">TECH ATK<span class="hexlogo">⬢</span></button>
        </span>
      </div>
      <div class="meta">d20 ${sign} vs E-DEF — Sensors ${s.sensors}</div>
    </div>`;
  el.querySelector('[data-act="trange"]').addEventListener("click", toggleSensors);
  el.querySelector('[data-act="tlock"]').addEventListener("click", () => prepareTechAttack());
}

// ---- TECHS tab: Invade / Quick Tech / Full Tech reference -----------------------
// These are REFERENCE chips — hover shows the lavender header with the rules
// text, click PINS it. They never roll; the TECH ATTACK button above does that.
// Every mech has these universal options; the rest port straight from the
// pilot's installed systems and talents (no hard-coding per item).
const TECH_BASE = {
  invade: [
    { name: "Fragment Signal", activation: "Invade", detail: "Tech attack vs E-Defense. On a hit, the target takes 2 Heat and becomes IMPAIRED and SLOWED until the end of its next turn. The basic Invade available to every mech." },
  ],
  quick: [
    { name: "Scan", activation: "Quick Tech", detail: "Choose a character within Sensors and line of sight: learn its full stat block, one piece of hidden GM information about it, or its last orders. No attack roll." },
    { name: "Lock On", activation: "Quick Tech", detail: "Choose a character within Sensors and line of sight: it gains LOCK ON. Any attacker may consume LOCK ON for +1 Accuracy against it, and it can be hit by tech even through cover." },
  ],
  full: [
    { name: "Stabilize", activation: "Full Tech", detail: "Choose one — COOL: clear all Heat and end Burning, then either clear one of Impaired/Exposed or spend a Repair to restore HP to full. PATCH: reload all LOADING weapons, OR clear a condition from an adjacent ally, OR give an adjacent ally the benefits of cooling." },
  ],
};

// Bucket a tech action by activation. Invade → INVADE; "full" → FULL TECH;
// Protocol / Free → PROTOCOLS; everything else (Quick Tech, Quick, Reaction…)
// → QUICK TECH. Each chip still shows its TRUE activation in its header.
function techBucket(activation) {
  const a = (activation || "").toLowerCase();
  if (a.includes("invade")) return "invade";
  if (a.includes("full")) return "full";
  if (a.includes("protocol") || a.includes("free")) return "protocols";
  return "quick";
}

function gatherTechActions(m) {
  const groups = {
    invade: TECH_BASE.invade.map((x) => ({ ...x })),
    quick: TECH_BASE.quick.map((x) => ({ ...x })),
    full: TECH_BASE.full.map((x) => ({ ...x })),
    protocols: [],
  };
  const add = (name, activation, detail, src) => {
    if (!name) return;
    groups[techBucket(activation)].push({ name, activation: activation || "Tech", detail: detail || "", src });
  };
  // Mechanical text (effect / action detail) — NOT the flavour the SYSTEMS tab shows.
  for (const sys of m.systems) {
    for (const a of sys.actionsFull || []) add(a.name, a.activation, a.detail || sys.effect, sys.name);
  }
  for (const t of resolveTalents(currentPilot?.talents || [])) {
    for (const a of t.actions || []) add(a.name, a.activation, a.detail, t.name);
  }
  return groups;
}

function renderTechs(m) {
  const groups = gatherTechActions(m);
  // The action-economy glyph lives ONCE on each group header (the chips are
  // uniform within a group): half-hex Invade/Quick, full-hex Full, empty Protocols.
  const setLabel = (grpId, icon, text) => {
    const lbl = document.querySelector(`#${grpId} .tech-grouplbl`);
    if (lbl) lbl.innerHTML = `${icon}<span>${text}</span>`;
  };
  setLabel("grp-invade", ICON_QUICK, "INVADE");
  setLabel("grp-quick", ICON_QUICK, "QUICK TECH");
  setLabel("grp-full", ICON_FULL, "FULL TECH");
  setLabel("grp-protocols", ICON_FREE, "PROTOCOLS");
  const fill = (wrapId, list) => {
    const wrap = $(wrapId);
    if (!wrap) return;
    wrap.innerHTML = "";
    const grpEl = wrap.closest(".tech-group");
    if (!list.length) { grpEl?.classList.add("hidden"); return; }
    grpEl?.classList.remove("hidden");
    list.forEach((opt) => {
      const div = document.createElement("div");
      div.className = "system invade";
      div.textContent = opt.name;
      const head = `${opt.name} — ${opt.activation}${opt.src && opt.src !== opt.name ? ` · ${opt.src}` : ""}`;
      const body = opt.detail || "No mechanical description available for this option.";
      div.addEventListener("mouseenter", (e) => showTip(head, body, e));
      div.addEventListener("mousemove", moveTooltip);
      div.addEventListener("mouseleave", hideTooltip);
      div.addEventListener("click", (e) => clickPin(head, body, e)); // pin only — no roll
      wrap.appendChild(div);
    });
  };
  fill("invades", groups.invade);
  fill("quicktech", groups.quick);
  fill("fulltech", groups.full);
  fill("protocols", groups.protocols);
}

// ---- CORE tab: core system + core bonuses + frame chassis traits ----------------
function renderCore(m) {
  const wrap = $("core");
  if (!wrap) return;
  wrap.innerHTML = "";
  const ci = coreInfo(m.frame);
  const bonuses = m.coreBonuses || [];
  const traits = m.frameTraits || [];
  if (!ci && !bonuses.length && !traits.length) {
    wrap.innerHTML = `<div class="muted">No core system, core bonuses, or frame traits on this mech.</div>`;
    return;
  }
  if (ci) {
    const card = document.createElement("div");
    card.className = "weapon corew";
    card.innerHTML = `
      <div class="top"><span class="wname">${ICON_FULL}${ci.name}${ci.activation ? ` · ${ci.activation}` : ""}</span></div>
      <div class="meta core-effect">${ci.description || ""}</div>`;
    wrap.appendChild(card);
  }
  // a green labelled chip group (core bonuses, frame traits)
  const chipGroup = (label, items, empty) => {
    const lbl = document.createElement("div");
    lbl.className = "tech-grouplbl core-lbl";
    lbl.textContent = label;
    wrap.appendChild(lbl);
    const grp = document.createElement("div");
    grp.className = "sys-wrap";
    if (!items.length) {
      grp.innerHTML = `<div class="muted">${empty}</div>`;
    } else {
      items.forEach((it) => {
        const div = document.createElement("div");
        div.className = "system corebonus";
        div.textContent = it.name;
        const head = `${it.name}${it.source ? ` — ${it.source}` : ""}`;
        const body = it.effect || it.description || "No effect text in compendium.";
        div.addEventListener("mouseenter", (e) => showTip(head, body, e));
        div.addEventListener("mousemove", moveTooltip);
        div.addEventListener("mouseleave", hideTooltip);
        div.addEventListener("click", (e) => clickPin(head, body, e));
        grp.appendChild(div);
      });
    }
    wrap.appendChild(grp);
  };
  chipGroup("CORE BONUSES", bonuses, "None picked up yet.");
  if (traits.length) chipGroup("FRAME TRAITS", traits, "None.");
  renderFrameEgg(m, wrap);
}

// ---- frame easter eggs (the fun part) -------------------------------------------
// Big Stupid Buttons for the dramatic frames. These do nothing mechanical —
// Uplink doesn't roll for blowing up your own mech — they're pure theatre.
let railCharge = 0;
function renderFrameEgg(m, wrap) {
  const fid = `${m.frame?.id || ""} ${m.frame?.name || ""}`.toLowerCase();
  if (/manticore/.test(fid)) {
    const btn = document.createElement("button");
    btn.id = "castigate-btn";
    btn.className = "egg-btn manticore";
    btn.textContent = "CASTIGATE THE ENEMIES OF THE GODHEAD";
    btn.classList.toggle("armed", document.body.classList.contains("godhead"));
    btn.addEventListener("click", toggleGodhead);
    wrap.appendChild(btn);
  }
  if (/barbarossa/.test(fid)) wrap.appendChild(buildApocalypseRail());
}

// MANTICORE — flash the Eye of Horus and charge every panel with electric glow.
function toggleGodhead() {
  const on = !document.body.classList.contains("godhead");
  document.body.classList.toggle("godhead", on);
  $("castigate-btn")?.classList.toggle("armed", on);
  if (on) {
    const eye = $("godhead-eye");
    if (eye) { eye.classList.remove("flash"); void eye.offsetWidth; eye.classList.add("flash"); }
  }
}

// BARBAROSSA — a charge counter + a button that screams a rail beam across the UI.
function buildApocalypseRail() {
  const box = document.createElement("div");
  box.className = "rail-box";
  const render = () => {
    box.innerHTML = `
      <div class="rail-title">⚡ APOCALYPSE RAIL</div>
      <div class="rail-charge">CHARGE <b>${"◆".repeat(railCharge)}${"◇".repeat(4 - railCharge)}</b></div>
      <div class="row" style="margin-top:6px">
        <button class="btn ghost small" data-act="charge">CHARGE +</button>
        <button class="btn ghost small" data-act="discharge">VENT −</button>
      </div>
      <button class="egg-btn rail-fire${railCharge >= 4 ? " ready" : ""}" data-act="fire">FIRE APOCALYPSE RAIL</button>`;
    box.querySelector('[data-act="charge"]').onclick = () => { railCharge = Math.min(4, railCharge + 1); render(); };
    box.querySelector('[data-act="discharge"]').onclick = () => { railCharge = Math.max(0, railCharge - 1); render(); };
    box.querySelector('[data-act="fire"]').onclick = () => fireRail();
  };
  render();
  return box;
}
function fireRail() {
  const beam = $("rail-beam");
  if (beam) { beam.classList.remove("flash"); void beam.offsetWidth; beam.classList.add("flash"); }
  railCharge = 0;
  if (currentMech) renderCore(currentMech); // reset the charge display
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
    const head = `${sys.name}${bits.length ? " — " + bits.join(" · ") : ""}`;
    // SYSTEMS shows flavour-forward text (the mechanical "what it does" lives in
    // the TECHS tab); fall back to effect/description if there's no flavour.
    const body = sys.flavor || sys.effect || sys.description || "No description in compendium.";
    div.addEventListener("mouseenter", (e) => showTip(head, body, e));
    div.addEventListener("mousemove", moveTooltip);
    div.addEventListener("mouseleave", hideTooltip);
    div.addEventListener("click", (e) => clickPin(head, body, e));
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
    const head = `${t.name} — RANK ${t.rank}`;
    const body = t.description || "No description in compendium.";
    div.addEventListener("mouseenter", (e) => showTip(head, body, e));
    div.addEventListener("mousemove", moveTooltip);
    div.addEventListener("mouseleave", hideTooltip);
    div.addEventListener("click", (e) => clickPin(head, body, e));
    wrap.appendChild(div);
  });
}

// ---- tooltip --------------------------------------------------------------------
const tipEl = $("tooltip");
let tipScrollRaf = 0;
let tipScrollTimer = 0;

function stopTipScroll() {
  cancelAnimationFrame(tipScrollRaf);
  clearTimeout(tipScrollTimer);
  const b = $("tt-body");
  if (b) { b.scrollTop = 0; b.style.opacity = "1"; }
}

// If the text outgrows the (already enlarged) box, wait a beat, scroll through
// leisurely, pause at the end, fade out, and loop back to the top.
function startTipScroll() {
  const b = $("tt-body");
  if (!b || b.scrollHeight <= b.clientHeight + 4) return;
  const cycle = () => {
    tipScrollTimer = setTimeout(() => {
      const step = () => {
        b.scrollTop += 0.22; // truly leisurely
        if (b.scrollTop + b.clientHeight < b.scrollHeight - 1) {
          tipScrollRaf = requestAnimationFrame(step);
        } else {
          tipScrollTimer = setTimeout(() => {
            b.style.opacity = "0";
            tipScrollTimer = setTimeout(() => {
              b.scrollTop = 0;
              b.style.opacity = "1";
              cycle();
            }, 900);
          }, 1900);
        }
      };
      tipScrollRaf = requestAnimationFrame(step);
    }, 1500);
  };
  cycle();
}

// Click/tap PINS the tooltip in place (mobile lifesaver); the ✕ unpins it.
// Hover behaviour is untouched — mouseleave only hides when unpinned.
let tipPinned = false;

function showTip(head, body, ev) {
  if (tipPinned) return; // a pinned tip holds its ground
  $("tt-head").textContent = head;
  $("tt-body").textContent = body || "";
  tipEl.style.display = "block";
  stopTipScroll();
  startTipScroll();
  moveTooltip(ev);
}

function pinTip() {
  if (tipEl.style.display !== "block") return;
  tipPinned = true;
  tipEl.classList.add("pinned");
  // A pinned tooltip keeps auto-scrolling long text; a manual scroll (wheel or
  // touch, wired below) cancels the autoscroll and hands control to the player.
}

// cancel the autoscroll WITHOUT snapping scrollTop back — for manual override
function cancelTipAutoScroll() {
  cancelAnimationFrame(tipScrollRaf);
  clearTimeout(tipScrollTimer);
  const b = $("tt-body");
  if (b) b.style.opacity = "1";
}

$("tt-close")?.addEventListener("click", (e) => {
  e.stopPropagation();
  tipPinned = false;
  tipEl.classList.remove("pinned");
  tipEl.style.display = "none";
  stopTipScroll();
});
// a manual scroll on a pinned tooltip overrides (cancels) the autoscroll
["wheel", "touchmove"].forEach((ev) =>
  $("tt-body")?.addEventListener(ev, () => { if (tipPinned) cancelTipAutoScroll(); }, { passive: true })
);

// clicking a chip (re)pins its tooltip — even if another tip is already pinned
function clickPin(head, body, ev) {
  tipPinned = false;
  tipEl.classList.remove("pinned");
  showTip(head, body, ev);
  pinTip();
}
function moveTooltip(ev) {
  if (tipPinned) return; // pinned tips don't chase the cursor
  const pad = 12;
  const r = tipEl.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > window.innerWidth - 4) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 4) y = ev.clientY - r.height - pad;
  tipEl.style.left = `${Math.max(4, x)}px`;
  tipEl.style.top = `${Math.max(4, y)}px`;
}
function hideTooltip() {
  if (tipPinned) return; // only the ✕ closes a pinned tooltip
  tipEl.style.display = "none";
  stopTipScroll();
}

// ============================================================== DICE SYSTEM ====
let diceTray = null;
let diceInitPromise = null; // shared so concurrent callers await the SAME init
let diceMod = null;         // the dice3d module (for SCHEMES colour lookups)
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

// ROLL QUEUE — counts pending ROLLS (one per player roll), not dice. When the
// table all rolls at once, replays line up and play one after another.
let replayQueue = [];
let replayActive = false;
function updateAdvCount() {
  const el = $("advcount");
  if (!el) return;
  const n = replayQueue.length + (replayActive || diceBusy ? 1 : 0);
  el.textContent = n === 1 ? "1 roll queued" : `${n} rolls queued`;
}

// Single shared init promise — fixes the "first target-lock lands on an empty
// tray" race, where the tab-switch and the weapon-prep both started init and
// the second caller bailed out with a null tray mid-load.
function ensureDiceTray() {
  if (!diceInitPromise) diceInitPromise = initDiceTray();
  return diceInitPromise.then((t) => {
    if (t) t.resize();
    return t;
  });
}

async function initDiceTray() {
  try {
    const mod = await import("./dice3d.js");
    diceMod = mod;
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
      sel.addEventListener("change", () => { recolorDicePicker(); saveState(); });
    }
    diceTray = mod.createDiceTray($("dicetray"), {
      scheme: () => $("scheme")?.value || "ips",
      sound: () => sndOn,
      height: 348,
    });
    window.__computeResult = mod.computeResult;
    diceTray.resize();
    recolorDicePicker();
    updateAdvCount();
  } catch (e) {
    console.warn("[LANCER//UPLINK] 3D dice unavailable.", e);
    diceTray = null;
    $("trayfallback")?.classList.remove("hidden");
  }
  return diceTray;
}

// ---- dice picker: visual die shapes, coloured to the selected faction ---------
const DIE_SHAPES = {
  d4: { points: "20,4 36,34 4,34", num: 4, ty: 28 },
  d6: { points: "7,7 33,7 33,33 7,33", num: 6, ty: 25 },
  d8: { points: "20,3 36,20 20,37 4,20", num: 8, ty: 25 },
  d10: { points: "20,3 35,15 29,36 11,36 5,15", num: 10, ty: 27 },
  d12: { points: "20,3 36,15 30,35 10,35 4,15", num: 12, ty: 26 },
  d20: { points: "20,2 35,11 35,29 20,38 5,29 5,11", num: 20, ty: 25 },
};

function dieIconSvg(type, color) {
  const s = DIE_SHAPES[type];
  if (!s) return type;
  return `<svg viewBox="0 0 40 40" aria-label="${type}">
    <polygon points="${s.points}" fill="${color}" stroke="rgba(255,255,255,0.55)" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="20" y="${s.ty}" text-anchor="middle" font-size="13" font-weight="700" font-family="'IBM Plex Mono',monospace" fill="#ffffff" style="text-shadow:0 0 3px #000">${s.num}</text>
  </svg>`;
}

function recolorDicePicker() {
  const key = $("scheme")?.value || "ips";
  // before dice3d loads, paint IPS-N blue (the default) — not Union red
  const body = diceMod?.SCHEMES?.[key]?.body || "#1750cf";
  document.querySelectorAll('#dicepicker .die-btn[data-die]').forEach((btn) => {
    btn.innerHTML = dieIconSvg(btn.dataset.die, body);
  });
  // Accuracy: green pointy-top hexagon with a plus. Difficulty: red, minus.
  const hexIcon = (color, glyph) => `<svg viewBox="0 0 40 40">
    <polygon points="20,2 35,11 35,29 20,38 5,29 5,11" fill="${color}" stroke="rgba(255,255,255,0.55)" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="20" y="27" text-anchor="middle" font-size="20" font-weight="700" font-family="'IBM Plex Mono',monospace" fill="#ffffff">${glyph}</text>
  </svg>`;
  const acc = $("addadv"), dis = $("adddis");
  if (acc) acc.innerHTML = hexIcon("#2f7d49", "+");
  if (dis) dis.innerHTML = hexIcon("#a32630", "−");
}
recolorDicePicker(); // initial paint with the default scheme colour

function addQueued(type, role = "normal", as = null, pair = null) {
  if (!diceTray || diceBusy) return;
  diceTray.addDie(type, role);
  trayQueue.push({ type, role, as, pair });
  diceTray.resetCamera(); // home view while building the pool; zooms come with the roll
  hideResult();
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

// Reset the per-roll presets so last gun's flat/crit/overkill don't linger when
// you come back to the tray. Skipped mid-roll so it can't stomp an active flow.
function resetDiceMods() {
  if (diceBusy || replayActive) return;
  setFlat(0);
  setOverkill(false);
  setCrit(false);
}

// dice sound toggle — subtle speaker button, persisted
let sndOn = readStore().sound !== false;
function refreshSndBtn() {
  const b = $("snd-toggle");
  if (!b) return;
  b.textContent = sndOn ? "🔊" : "🔇";
  b.classList.toggle("off", !sndOn);
  b.title = sndOn ? "Dice sounds: on" : "Dice sounds: off";
}
$("snd-toggle")?.addEventListener("click", () => {
  sndOn = !sndOn;
  refreshSndBtn();
  saveState();
});
refreshSndBtn();

// ---- NHP commentary on a natural 1 ------------------------------------------------
// Author-controlled constants — rendered as innerHTML so we can break lines
// (<br>) and glitch a phrase (<span class="glitch-text">). No user input here.
const NHP_QUIPS = [
  "Such a shame.",
  "Feeling a bit desperate, aren't we?",
  ">It's alright.<br>>I'm not one to judge.",
  "It's been a long day.<br>Have some soup.",
  "I ran the numbers. All of them.",
  "Statistically fascinating.<br>Tactically… less so.",
  "I will not be mentioning this<br>in the after-action report.<br>You're welcome.",
  'The dice are not broken.<br><span class="glitch-text">Trust me.</span>',
  "A bold interpretation of 'aim'.",
  "Recalibrating expectations…",
  "Your ancestors are watching.<br>They've seen worse.",
  ">>Query:<br>Was that intentional?",
  "It's almost like I had a hand in this.",
  "In another timeline, perhaps.",
  "This happened every time.",
  "In a world without rolls,<br>we would have been heroes.",
  "In another life, I would have really liked<br>just doing corporate piracy with you.",
];
let quipTimer = 0;
function showQuip() {
  const el = $("nhp-quip");
  if (!el) return;
  el.innerHTML = NHP_QUIPS[Math.floor(Math.random() * NHP_QUIPS.length)];
  el.classList.remove("show");
  void el.offsetWidth; // restart the CSS animation
  el.classList.add("show");
  clearTimeout(quipTimer);
  quipTimer = setTimeout(() => el.classList.remove("show"), 4200);
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
  $("overclockbtn")?.classList.remove("show");
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
  applyHeat(pendingHeat); // cascades into Stress, carrying any overflow
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

const isCombatDrill = (w) => /combat[ _-]?drill/i.test(w?.name || "") || /combat_drill/i.test(w?.id || "");

// ATK (or ⬢ target lock): d20 + grit, ready to roll. Accurate weapons auto-add
// an Accuracy die; Inaccurate ones auto-add a Difficulty die.
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
  let tagNote = "";
  if (w.accurate) { addQueued("d6", "acc"); tagNote += "  · ACCURATE (+1 Acc)"; }
  if (w.inaccurate) { addQueued("d6", "dis"); tagNote += "  · INACCURATE (+1 Diff)"; }
  setContext(
    `${w.name.toUpperCase()} — ATTACK · d20 +${grit} GRIT${tagNote}`,
    "atk",
    lock ? w : null
  );
}

// DMG: the weapon's damage dice only — grit is NEVER added to damage.
// crit=true doubles every die; each pair keeps only its highest result.
async function prepareWeaponDamage(w, fire, crit, forceOverkill = false, drill = false) {
  switchToDiceTab();
  if (!(await ensureDiceTray())) return;
  if (diceBusy) return;
  const parsed = parseDamage(w.damage);
  if (!parsed.dice.length && !parsed.flat) {
    setStatus(`${w.name} has no rollable damage.`, "status-err");
    return;
  }
  // Combat Drill always carries Overkill; OVERCLOCK adds the exploding behaviour.
  const overkill = !!w.overkill || forceOverkill || drill;
  clearTrayAll();
  hideResult();
  setFlat(parsed.flat);
  setOverkill(overkill);
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
    `${w.name.toUpperCase()} — DAMAGE · ${w.damage}${crit ? " · CRIT (dice doubled, keep highest)" : ""}${drill ? " · OVERCLOCK (Combat Drill)" : overkill ? " · OVERKILL" : ""}${w.reliable ? ` · RELIABLE ${w.reliable}` : ""}`,
    "dmg",
    null
  );
  pending.combatDrill = !!drill;     // exploding chain only on OVERCLOCK
  pending.reliable = w.reliable || 0; // damage floor
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
  // Frame traits / core bonuses that grant tech-attack accuracy (Liturgicode…)
  const techAcc = currentMech?.stats?.techAccuracy || 0;
  let accNote = "";
  for (let i = 0; i < techAcc; i++) addQueued("d6", "acc");
  if (techAcc) accNote = `  · +${techAcc} ACC (frame)`;
  setContext(`${label} · d20 ${t >= 0 ? "+" : ""}${t} vs E-DEF${accNote}`, "tech", null);
}

// FIRE: chains the locked weapon's damage right after its accuracy roll.
// Respects the CRIT and OVERKILL toggles, so a crit confirmed by other means
// (or forced on) still rolls crit damage even if the accuracy total was < 20.
// FIRE = standard Overkill; OVERCLOCK = Combat Drill's exploding dice.
function fireLocked(drill) {
  const w = pending.followUp;
  if (!w) return;
  $("firebtn").classList.remove("show");
  $("overclockbtn")?.classList.remove("show");
  const critForce = pending.crit || (critToggle?.checked || false);
  const okForce = okToggle?.checked || false;
  prepareWeaponDamage(w, true, critForce, okForce, drill);
}
$("firebtn")?.addEventListener("click", () => fireLocked(false));
$("overclockbtn")?.addEventListener("click", () => fireLocked(true));

// ---- THE roll -------------------------------------------------------------------
const effVal = (meta, v) => (meta?.as === "d3" ? Math.ceil(v / 2) : v);

async function doRoll() {
  if (!diceTray || diceBusy || !trayQueue.length) return;
  diceBusy = true;
  updateAdvCount(); // our own roll occupies the queue
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

    // ---- Resolution order (Lancer): reroll EVERY 1 first (Overkill, +1 Heat
    // each, chaining), THEN keep the highest of each Crit pair. A 1 sitting in a
    // crit pair is still rerolled and still costs Heat *before* the pair is
    // judged. Combat Drill Overclock: each rerolled 1 ALSO spawns a bonus die;
    // under crit that bonus is itself a fresh doubled pair — the dice hydra.
    const rerolled = new Set(); // indices pulled by an Overkill reroll
    let heat = 0;
    if (overkill) {
      const drill = !!ctx.combatDrill;
      let scanFrom = 0, guard = 0;
      while (guard++ < 60) {
        const spawn = []; // { type, as, pair }
        for (let i = scanFrom; i < raw.length; i++) {
          if (rerolled.has(i)) continue;
          const r = raw[i], meta = metas[i];
          if (r.role === "normal" && r.type !== "d20" && effVal(meta, r.value) === 1) {
            rerolled.add(i);
            diceTray.hideDie(i);   // visually pull the 1 off the 3D tray
            heat += 1;             // +1 Heat per Overkill trigger
            // the reroll replaces the 1 inside its own pair (keep-highest holds)
            spawn.push({ type: r.type, as: meta?.as || null, pair: meta?.pair ?? null });
            if (drill) {
              // bonus damage die — a fresh doubled pair under crit, else a loner
              if (critOn) {
                const bp = ++pairSeq;
                spawn.push({ type: r.type, as: meta?.as || null, pair: bp });
                spawn.push({ type: r.type, as: meta?.as || null, pair: bp });
              } else {
                spawn.push({ type: r.type, as: meta?.as || null, pair: null });
              }
            }
          }
        }
        if (!spawn.length) break;
        scanFrom = raw.length;
        const extra = await diceTray.rollExtra(spawn.map((o) => o.type));
        if (!extra || !extra.length) break;
        spawn.forEach((o) => metas.push({ type: o.type, role: "normal", as: o.as, pair: o.pair }));
        raw = raw.concat(extra);
        trayQueue = metas.slice();
      }
    }

    // ---- crit pairs: keep only the highest of each pair (AFTER the rerolls)
    const dropIdx = new Set(rerolled);
    {
      const pairBest = new Map(); // pair -> { idx, val }
      raw.forEach((r, i) => {
        if (rerolled.has(i)) return;
        const meta = metas[i];
        const p = meta?.pair;
        if (p == null || r.role !== "normal") return;
        const v = effVal(meta, r.value);
        const cur = pairBest.get(p);
        if (!cur || v > cur.val) {
          if (cur) dropIdx.add(cur.idx);
          pairBest.set(p, { idx: i, val: v });
        } else {
          dropIdx.add(i);
        }
      });
    }
    const okDropCount = rerolled.size;
    const critDropCount = dropIdx.size - okDropCount;

    // ---- compute the Lancer total (rerolled + paired drops excluded)
    const eff = raw.map((r, i) => ({ ...r, value: effVal(metas[i], r.value) }));
    const effKept = eff.filter((_, i) => !dropIdx.has(i));
    const compute = window.__computeResult;
    const res = compute(effKept, { keepHighest, flat });

    // ---- Reliable N: weapon damage can't fall below its Reliable value
    if (ctx.kind === "dmg" && ctx.reliable && res.total < ctx.reliable) {
      res.reliableFloor = ctx.reliable;
      res.total = ctx.reliable;
    }

    // crit & labels (Lancer: an attack totalling 20+ crits; nat 1 always whiffs)
    // Lancer crit rule: ANY attack totalling 20+ crits — there are no special
    // natural 20s. A natural 1 gets no label; the NHP says enough.
    let critTxt = "";
    let isCrit = false;
    if (res.d20 != null) {
      if (res.d20 === 1) {
        showQuip();
      } else if ((ctx.kind === "atk" || ctx.kind === "tech") && res.total >= 20) {
        critTxt = "⚡ CRIT";
        isCrit = true;
      }
    }

    const facesTxt = eff.map((d, i) => {
      const tag = d.role === "acc" ? "+acc" : d.role === "dis" ? "−dif" : "";
      const dieName = metas[i]?.as || d.type;
      return `${dieName}${tag ? ` ${tag}` : ""}:${d.value}${dropIdx.has(i) ? "✗" : ""}`;
    }).join("  ");
    let detail = facesTxt;
    if (critDropCount) detail += `  | crit: paired dice, ✗ dropped`;
    if (okDropCount) detail += `  | overkill: ${okDropCount} ✗ rerolled`;
    if (res.accApplied) detail += `  | ${res.accApplied > 0 ? "+" : ""}${res.accApplied} ${res.accApplied > 0 ? "accuracy" : "difficulty"}`;
    if (flat) detail += `  | ${flat >= 0 ? "+" : ""}${flat} flat`;
    if (heat) detail += `  | +${heat} HEAT (overkill)`;
    if (res.reliableFloor) detail += `  | RELIABLE ${res.reliableFloor} (floored)`;

    const label = ctx.label || (res.d20 != null ? "Attack" : "Roll");
    const kind = ctx.kind === "free" ? (res.d20 != null ? "atk" : "dmg") : ctx.kind;
    const priv = rollsHidden();

    // ---- present: zoom in, pop the result, surface FIRE / heat-apply buttons
    diceTray.zoomToDice();
    // free rolls from the tray show just the number — no sub-label
    const sub = ctx.kind === "dmg" ? "DAMAGE"
      : ctx.kind === "tech" ? "TECH"
      : ctx.kind === "atk" ? "ACCURACY"
      : "";
    showResult({ total: res.total, sub, kind, crit: critTxt });

    if (ctx.followUp) {
      pending.followUp = ctx.followUp;
      pending.crit = isCrit;
      $("firebtn").classList.add("show");
      $("firebtn").classList.toggle("crit", isCrit);
      $("firebtn").textContent = "⬢ FIRE";
      // Combat Drill gets a second, molten OVERCLOCK button for the exploding dice
      $("overclockbtn")?.classList.toggle("show", isCombatDrill(ctx.followUp));
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
            scheme: $("scheme")?.value || "ips",
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
    // remote rolls replay in their own popup now, so they never wait on us
  }
}
$("rolldice")?.addEventListener("click", doRoll);

// ---- remote replays: a dedicated right-side popup tray --------------------------
// Other players' rolls replay in their OWN tray on the right, so they never
// interfere with your dice. The result stays dim until the dice actually land.
let remoteTray = null;
let remoteInitPromise = null;
function ensureRemoteTray() {
  if (!remoteInitPromise) remoteInitPromise = (async () => {
    try {
      const mod = diceMod || await import("./dice3d.js");
      diceMod = mod;
      remoteTray = mod.createDiceTray($("remote-dicetray"), {
        scheme: () => "ips",
        sound: () => false, // teammates' dice stay quiet on your end
        height: 170,
      });
      remoteTray.resize();
    } catch (e) {
      console.warn("[LANCER//UPLINK] remote tray unavailable", e);
      remoteTray = null;
    }
    return remoteTray;
  })();
  return remoteInitPromise;
}

function onRemoteRoll(d) {
  // Hidden rolls are never broadcast, so everything that arrives here is public.
  logRoll({
    kind: d.kind === "dmg" ? "dmg" : d.kind === "tech" ? "tech" : d.kind === "sys" ? "sys" : "atk",
    remote: true,
    who: d.who,
    title: `${d.label} → ${d.total}`,
    detail: d.detail || "",
    critTxt: d.crit ? `<span class="crit"> ${d.crit}</span>` : "",
  });
  try { OBR.notification.show(`${d.who}: ${d.label} → ${d.total}`, "INFO"); } catch (_) {}

  replayQueue.push(d);
  updateAdvCount();
  pumpReplayQueue();
}

async function pumpReplayQueue() {
  if (replayActive) return; // popup busy — one teammate roll at a time
  const tray = await ensureRemoteTray();
  if (!tray) { replayQueue = []; updateAdvCount(); return; } // no 3D — the log still has it
  if (tray.isRolling()) { setTimeout(pumpReplayQueue, 400); return; }
  const d = replayQueue.shift();
  if (!d) return;
  replayActive = true;
  updateAdvCount();
  const popup = $("remote-popup");
  const res = $("rp-result");
  try {
    $("rp-who").textContent = d.who || "TABLE";
    const more = replayQueue.length;
    $("rp-q").textContent = more ? `+${more} queued` : "";
    $("rp-label").textContent =
      d.kind === "dmg" ? "DAMAGE" : d.kind === "tech" ? "TECH" : d.kind === "sys" ? "CHECK" : "ACCURACY";
    $("rp-total").textContent = "—";
    $("rp-crit").textContent = "";
    res.className = "rp-result"; // dim — result not highlighted until it lands
    if (d.kind === "dmg") res.classList.add("dmg");
    if (d.kind === "tech") res.classList.add("tech");
    popup?.classList.add("show");
    tray.resize();
    await tray.replay(d.dice || [], 1, d.scheme || null); // roller's faction colours
    tray.zoomToDice();
    // reveal + highlight ONLY now that the dice have settled
    $("rp-total").textContent = String(d.total);
    $("rp-crit").textContent = d.crit || "";
    res.classList.add("revealed");
    // hold long enough to read; quicker when more rolls are waiting
    await new Promise((r) => setTimeout(r, replayQueue.length ? 2200 : 3400));
    if (!tray.isRolling()) { tray.clearTray(); tray.resetCamera(); }
    if (!replayQueue.length) popup?.classList.remove("show"); // slide away when done
  } catch (e) {
    console.warn("[LANCER//UPLINK] remote replay failed", e);
    popup?.classList.remove("show");
  } finally {
    replayActive = false;
    updateAdvCount();
    if (replayQueue.length) setTimeout(pumpReplayQueue, 250);
  }
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

$("btn-undo-tmpl")?.addEventListener("click", async () => {
  const ok = await tool.undoLastTemplate();
  setStatus(ok ? "Last template removed." : "Nothing left to undo.", ok ? "status-ok" : "status-err");
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
  const v = $("grid-mode").value;
  hex.setGridOverride(v);
  if (v === "auto") { recalibrate(); syncCellSlider(); } // AUTO re-fits the scene
  refreshGridReadout();
  refreshActiveFields(); // live update
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
  refreshActiveFields(); // live update
  saveState();
});

$("btn-fit")?.addEventListener("click", async () => {
  hex.setCellSize(null); // drop the manual override, trust the probe
  await recalibrate();
  syncCellSlider();
  refreshActiveFields(); // live update
  saveState();
  setStatus("Grid re-probed and matched to the scene.", "status-ok");
});

// Re-place every active range field in place — makes grid tweaks (offset,
// tile size) update LIVE instead of needing a sensors off/on cycle.
async function refreshActiveFieldsNow() {
  if (!Object.keys(activeFields).length) return;
  const item = await getBondItem();
  if (!item) return;
  const c = hex.pixelToHex(item.position);
  for (const [kind, f] of Object.entries(activeFields)) {
    await placeFieldAt(kind, c, f.size, f.boost);
  }
}
let refreshFieldsTimer = 0;
function refreshActiveFields() {
  clearTimeout(refreshFieldsTimer);
  refreshFieldsTimer = setTimeout(refreshActiveFieldsNow, 120);
}

// manual lattice offset — steppers shift by ⅛ tile; slider mode for sweeps
function refreshNudgeVal() {
  const v = $("nudge-val");
  if (v) v.textContent = `${Math.round(hex.grid.nudge.x)}, ${Math.round(hex.grid.nudge.y)} px`;
  const sx = $("nudge-x"), sy = $("nudge-y");
  if (sx) sx.value = String(Math.max(-300, Math.min(300, Math.round(hex.grid.nudge.x))));
  if (sy) sy.value = String(Math.max(-300, Math.min(300, Math.round(hex.grid.nudge.y))));
}
function applyNudge(x, y) {
  hex.setNudge(x, y);
  refreshNudgeVal();
  refreshActiveFields(); // live update — no sensors off/on dance
  saveState();
}
function nudgeBy(dx, dy) {
  const step = Math.max(4, Math.round(hex.grid.dpi / 8));
  applyNudge(hex.grid.nudge.x + dx * step, hex.grid.nudge.y + dy * step);
}
$("nx-minus")?.addEventListener("click", () => nudgeBy(-1, 0));
$("nx-plus")?.addEventListener("click", () => nudgeBy(1, 0));
$("ny-minus")?.addEventListener("click", () => nudgeBy(0, -1));
$("ny-plus")?.addEventListener("click", () => nudgeBy(0, 1));
$("n-reset")?.addEventListener("click", () => applyNudge(0, 0));

$("nudge-mode")?.addEventListener("change", () => {
  const slider = $("nudge-mode").checked;
  $("nudge-steppers")?.classList.toggle("hidden", slider);
  $("nudge-sliders")?.classList.toggle("hidden", !slider);
});
$("nudge-x")?.addEventListener("input", () => applyNudge(Number($("nudge-x").value), hex.grid.nudge.y));
$("nudge-y")?.addEventListener("input", () => applyNudge(hex.grid.nudge.x, Number($("nudge-y").value)));

$("macro-toggle")?.addEventListener("change", saveState);

// ---- UI text size (zoom-based: scales text AND layout together cleanly) -------
let uiScale = 1;
function applyUiScale() {
  uiScale = Math.max(0.8, Math.min(1.4, uiScale)); // 140% cap — beyond that the page grows a sideways scrollbar
  document.body.style.zoom = uiScale;
  const v = $("font-val");
  if (v) v.textContent = `${Math.round(uiScale * 100)}%`;
  diceTray?.resize(); // the tray canvas needs to know about the new layout size
  requestAnimationFrame(() => setGmView(gmView)); // re-measure the holo tab slider
}
// Keep the CLICKED button locked under the pointer while the layout reflows,
// so repeated A+/A− clicks always land on the same spot (the button used to
// climb away as the boxes grew).
function fontStep(delta, btn) {
  const anchor = btn || $("font-plus");
  const before = anchor ? anchor.getBoundingClientRect().bottom : 0;
  uiScale += delta;
  applyUiScale();
  saveState();
  requestAnimationFrame(() => {
    if (!anchor) return;
    const after = anchor.getBoundingClientRect().bottom;
    window.scrollBy(0, after - before); // re-pin the button's bottom edge
  });
}
$("font-minus")?.addEventListener("click", (e) => fontStep(-0.05, e.currentTarget));
$("font-plus")?.addEventListener("click", (e) => fontStep(0.05, e.currentTarget));
$("font-reset")?.addEventListener("click", () => { uiScale = 1; applyUiScale(); saveState(); });

// ---- click-drag offset: the FIELDS THEMSELVES become draggable -----------------
// Owlbear's own move tool drags them (perfectly smooth), siblings follow live,
// and the displacement commits into the grid offset on release.
let offsetDragMode = false;
let offsetCommitTimer = 0;
let offsetCommitting = false;

function updateDragOffsetBtn() {
  const b = $("btn-dragoffset");
  if (!b) return;
  const has = Object.keys(activeFields).length > 0;
  if (!has && offsetDragMode) setOffsetDrag(false); // auto-disable, stays off until clicked
  b.disabled = !has;
  b.textContent = `✥ CLICK-DRAG OFFSET: ${offsetDragMode ? "ON" : "OFF"}`;
  b.classList.toggle("blue", offsetDragMode);
  b.classList.toggle("ghost", !offsetDragMode);
}

async function setOffsetDrag(on) {
  offsetDragMode = on;
  await refreshActiveFieldsNow(); // rebuild fields grabbable / locked
  updateDragOffsetBtn();
  if (on) {
    // hand the player Owlbear's MOVE tool so the drag starts instantly
    try { await OBR.tool.activateTool("rodeo.owlbear.tool/move"); } catch (_) {}
  }
}

$("btn-dragoffset")?.addEventListener("click", async () => {
  if (!Object.keys(activeFields).length) return; // deliberately inert
  await setOffsetDrag(!offsetDragMode);
  setStatus(
    offsetDragMode
      ? "Grab a range field on the map (with Owlbear's move tool) and drag it into place."
      : "Fields locked back down.",
    "status-ok"
  );
});

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
    // In AUTO mode, behave like FIT TO SCENE: drop any manual tile-size override
    // so the grid fully re-fits whenever auto re-triggers.
    if (!hex.grid.modeOverride) hex.setCellSize(null);
    // Seed calibration with the bonded token so the lattice centres on it.
    let anchor = null;
    try { const it = await getBondItem(); if (it) anchor = it.position; } catch (_) {}
    await hex.calibrate(anchor);
    refreshGridReadout();
    syncCellSlider();
    await refreshActiveFieldsNow(); // re-place active fields on the aligned grid
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

  // 2) Calibrate the grid when (and whenever) a scene is actually ready, and
  //    re-AUTO whenever the room's grid itself changes (type / size / dpi).
  try {
    if (await OBR.scene.isReady()) await recalibrate();
    OBR.scene.onReadyChange((ready) => { if (ready) recalibrate(); });
    const G = (OBR.scene && OBR.scene.grid) || OBR.grid;
    if (G && typeof G.onChange === "function") G.onChange(() => recalibrate());
  } catch (e) {
    console.warn("[LANCER//UPLINK] scene readiness check failed", e);
  }

  // 3) Bonded-token follow: re-centre active range fields ONLY when the token
  //    actually moves. (It used to refire on ANY scene change — every template
  //    drop or other player's token nudge would re-place the fields, stomping
  //    a freshly dragged offset. The offset is the new point of origin and it
  //    travels WITH the token, not in spite of it.)
  let lastBondPos = null;
  try {
    OBR.scene.items.onChange((items) => {
      if (!bond || !Object.keys(activeFields).length) return;
      const it = items.find((i) => i.id === bond.id);
      if (!it) return;
      const p = it.position;
      if (lastBondPos && Math.hypot(p.x - lastBondPos.x, p.y - lastBondPos.y) < 1) return;
      const moved = !!lastBondPos;
      lastBondPos = { x: p.x, y: p.y };
      if (!moved) return; // first sighting — just record the position
      clearTimeout(followTimer);
      followTimer = setTimeout(async () => {
        if (offsetCommitting || offsetDragMode) return; // never fight an active drag
        const c = hex.pixelToHex(lastBondPos);
        for (const [kind, f] of Object.entries(activeFields)) {
          await placeFieldAt(kind, c, f.size, f.boost);
        }
      }, 250);
    });
  } catch (_) {}

  // 3b) CLICK-DRAG OFFSET: when a field is dragged (Owlbear's own smooth item
  // drag), shift its siblings live, then commit the displacement to the grid
  // offset shortly after the drag stops.
  try {
    OBR.scene.local.onChange((items) => {
      if (!offsetDragMode || offsetCommitting) return;
      const moved = items.find(
        (i) => i.metadata?.[META]?.kind === "range" && (i.position.x !== 0 || i.position.y !== 0)
      );
      if (!moved) return;
      const d = { x: moved.position.x, y: moved.position.y };
      // siblings follow live so the whole layout slides as one
      const lagging = items.filter(
        (i) => i.metadata?.[META]?.kind === "range" && i.id !== moved.id &&
               (i.position.x !== d.x || i.position.y !== d.y)
      );
      if (lagging.length) {
        OBR.scene.local.updateItems(lagging.map((i) => i.id), (its) => {
          its.forEach((it) => { it.position = { ...d }; });
        }).catch(() => {});
      }
      clearTimeout(offsetCommitTimer);
      offsetCommitTimer = setTimeout(async () => {
        offsetCommitting = true;
        hex.setNudge(hex.grid.nudge.x + d.x, hex.grid.nudge.y + d.y);
        refreshNudgeVal();
        await refreshActiveFieldsNow(); // rebuild at position 0 with new offset
        saveState();
        offsetCommitting = false;
      }, 350);
    });
  } catch (_) {}

  // 4) Broadcast channels: dice replays + squad telemetry.
  try {
    OBR.broadcast.onMessage(CH_ROLL3D, (event) => onRemoteRoll(event.data || {}));
    OBR.broadcast.onMessage(CH_STATUS, (event) => {
      const d = event.data || {};
      if (d.type === "req") { broadcastStatus(); return; }
      if (d.type === "kick" && d.who) {
        // a GM removed this lancer from squad telemetry everywhere
        squad.delete(d.who);
        if (gmMode) renderGM();
        return;
      }
      if (d.type === "status" && d.who) {
        squad.set(d.who, d);
        if (gmMode) renderGM();
        if (tokenBarsOn) renderTokenBars(); // a teammate's HP/Heat changed
      }
    });
  } catch (e) {
    console.warn("[LANCER//UPLINK] broadcast channels unavailable", e);
  }

  // Token status bars: reveal numbers on selection; redraw if a tracked token
  // moves (attachment follows it, but a re-draw keeps things crisp).
  try {
    OBR.player.onChange((p) => {
      selectedTokens = new Set(p.selection || []);
      if (tokenBarsOn) renderTokenBars();
    });
  } catch (_) {}
  try {
    let barTimer = 0;
    OBR.scene.items.onChange(() => {
      if (!tokenBarsOn) return;
      clearTimeout(barTimer);
      barTimer = setTimeout(renderTokenBars, 250);
    });
  } catch (_) {}
  if (tokenBarsOn) { requestSquadStatus(); renderTokenBars(); }

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
  if (st.nudge) hex.setNudge(st.nudge.x, st.nudge.y);
  refreshNudgeVal();
  syncCellSlider();
  refreshGridReadout();
  if (st.uiScale) { uiScale = st.uiScale; applyUiScale(); }
  if ($("macro-toggle")) $("macro-toggle").checked = !!st.macro;
  if (st.tokenBars) { tokenBarsOn = true; if ($("tokenbars-toggle")) $("tokenbars-toggle").checked = true; }
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
