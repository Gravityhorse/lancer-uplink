// context-menu.js — the embedded "Lancer Uplink" right-click panel on the bonded
// token. Deliberately minimal: a flip header + Move / Boost / Sensors. Each
// button LOCAL-broadcasts a command to the main panel, which owns the mech data
// and range-field logic (same-client, so no network traffic).

import { OBR, CH_CM } from "./sdk.js";

const $ = (id) => document.getElementById(id);
let collapsed = false;

OBR.onReady(() => {
  $("cm-head")?.addEventListener("click", toggleFlip);
  document.querySelectorAll(".cm-btn[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      try { OBR.broadcast.sendMessage(CH_CM, { action: b.dataset.act }, { destination: "LOCAL" }); } catch (_) {}
    })
  );
});

// the LANCER//UPLINK header flip — spins the logo 180° and folds the controls
function toggleFlip() {
  collapsed = !collapsed;
  $("cm-head")?.classList.toggle("flipped", collapsed);
  $("cm-body")?.classList.toggle("collapsed", collapsed);
}
