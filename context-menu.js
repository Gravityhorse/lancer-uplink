// context-menu.js — the embedded "Lancer Uplink" right-click panel on the bonded
// token. It's a tiny self-contained page; its buttons LOCAL-broadcast commands
// to the main panel (which owns the mech data + range-field logic) and receive
// the weapon list back over the same channel. Same handshake as the roll popover.

import { OBR, CH_CM, CH_CM_READY, CH_CM_DATA } from "./sdk.js";

const $ = (id) => document.getElementById(id);
let collapsed = false;

OBR.onReady(() => {
  try { OBR.broadcast.onMessage(CH_CM_DATA, (ev) => applyData(ev.data)); } catch (_) {}
  try { OBR.broadcast.sendMessage(CH_CM_READY, {}, { destination: "LOCAL" }); } catch (_) {}

  $("cm-head")?.addEventListener("click", toggleFlip);
  document.querySelectorAll(".cm-btn[data-act]").forEach((b) =>
    b.addEventListener("click", () => send({ action: b.dataset.act }))
  );
  $("cm-wpn-go")?.addEventListener("click", () => {
    const v = $("cm-weapon")?.value;
    if (v !== "" && v != null) send({ action: "weapon", weapon: Number(v) });
  });
  $("cm-more")?.addEventListener("click", () => {
    $("cm-more-body")?.classList.toggle("open");
    $("cm-more")?.classList.toggle("open");
  });
});

function send(cmd) {
  try { OBR.broadcast.sendMessage(CH_CM, cmd, { destination: "LOCAL" }); } catch (_) {}
}

// the LANCER//UPLINK header flip — spins the logo 180° and folds the controls
function toggleFlip() {
  collapsed = !collapsed;
  $("cm-head")?.classList.toggle("flipped", collapsed);
  $("cm-body")?.classList.toggle("collapsed", collapsed);
}

function applyData(d) {
  if (!d) return;
  const sel = $("cm-weapon");
  if (sel) {
    sel.innerHTML = "";
    if (!d.weapons || !d.weapons.length) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = d.hasPilot ? "No ranged weapons" : "Load a pilot first";
      sel.appendChild(o);
    } else {
      d.weapons.forEach((w) => {
        const o = document.createElement("option");
        o.value = String(w.i);
        o.textContent = w.name;
        sel.appendChild(o);
      });
    }
  }
  const more = $("cm-more-body");
  if (more) {
    more.innerHTML = (d.weapons && d.weapons.length)
      ? d.weapons.map((w) => `<div class="cm-plaque">${escapeHtml(w.name)}</div>`).join("")
      : `<div class="cm-note">Load a pilot to see its weapons. A full mini-compendium (Techs / Systems / Talents / Core) lands here in a later version.</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
