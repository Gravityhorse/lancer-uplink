// roll-popup.js — the standalone on-screen popover that replays OTHER players'
// dice. It lives in its own Owlbear popover window (opened by the panel anchored
// to the right of the screen), so a teammate's roll never covers the panel.
//
// The panel feeds rolls over the same-client LOCAL broadcast (CH_RP). On load we
// announce ourselves (CH_RP_READY) so the panel can flush anything sent before
// our listener existed. When the queue stays empty we close ourselves (telling
// the panel via CH_RP_CLOSED so it reopens us next time).

import { OBR, CH_RP, CH_RP_READY, CH_RP_CLOSED, RP_POPOVER } from "./sdk.js";
import { createDiceTray } from "./dice3d.js";

const $ = (id) => document.getElementById(id);
let tray = null;
let queue = [];
let active = false;
let idleTimer = 0;
const seen = new Set(); // uids already rendered (dedupe re-sends)

OBR.onReady(async () => {
  try {
    tray = createDiceTray($("rp-tray"), { scheme: () => "ips", sound: () => false, height: 180 });
    tray.resize();
    window.addEventListener("resize", () => { try { tray && tray.resize(); } catch (_) {} });
  } catch (e) {
    console.warn("[LANCER//UPLINK] popup tray failed", e);
  }
  try { OBR.broadcast.onMessage(CH_RP, (ev) => enqueue(ev.data)); } catch (_) {}
  // tell the panel we're alive — it will (re)send any pending rolls
  try { OBR.broadcast.sendMessage(CH_RP_READY, {}, { destination: "LOCAL" }); } catch (_) {}
  const close = document.getElementById("rp-close");
  if (close) close.addEventListener("click", closeNow);
});

async function closeNow() {
  clearTimeout(idleTimer);
  queue = [];
  try { OBR.broadcast.sendMessage(CH_RP_CLOSED, {}, { destination: "LOCAL" }); } catch (_) {}
  try { await OBR.popover.close(RP_POPOVER); } catch (_) {}
}

function enqueue(d) {
  if (!d || !d.uid || seen.has(d.uid)) return;
  seen.add(d.uid);
  if (seen.size > 200) seen.clear();
  queue.push(d);
  clearTimeout(idleTimer);
  pump();
}

async function pump() {
  if (active || !tray) return;
  const d = queue.shift();
  if (!d) { scheduleClose(); return; }
  active = true;
  const res = $("rp-result");
  try {
    $("rp-who").textContent = d.who || "TABLE";
    $("rp-q").textContent = queue.length ? `+${queue.length} queued` : "";
    $("rp-label").textContent =
      d.kind === "dmg" ? "DAMAGE" : d.kind === "tech" ? "TECH" : d.kind === "sys" ? "CHECK" : "ACCURACY";
    $("rp-total").textContent = "—";
    $("rp-crit").textContent = "";
    res.className = ""; // dim until the dice settle
    if (d.kind === "dmg") res.classList.add("dmg");
    if (d.kind === "tech") res.classList.add("tech");
    tray.resize();
    await tray.replay(d.dice || [], 1, d.scheme || null); // roller's faction colours
    tray.zoomToDice();
    $("rp-total").textContent = String(d.total);
    $("rp-crit").textContent = d.crit || "";
    res.classList.add("revealed");
    // the toast is shown HERE — only once the dice have settled — so it never
    // spoils the number early (the panel no longer fires it on receipt)
    try { OBR.notification.show(`${d.who || "Table"}: ${d.label} → ${d.total}`, "INFO"); } catch (_) {}
    await new Promise((r) => setTimeout(r, queue.length ? 2200 : 3200));
    if (!tray.isRolling()) { tray.clearTray(); tray.resetCamera(); }
  } catch (e) {
    console.warn("[LANCER//UPLINK] popup replay failed", e);
  } finally {
    active = false;
    if (queue.length) pump(); else scheduleClose();
  }
}

function scheduleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (queue.length || active) return;
    try { OBR.broadcast.sendMessage(CH_RP_CLOSED, {}, { destination: "LOCAL" }); } catch (_) {}
    try { await OBR.popover.close(RP_POPOVER); } catch (_) {}
  }, 3200);
}
