// context-menu.js — the embedded "Lancer Uplink" right-click panel (shown on any
// token). Every button just LOCAL-broadcasts its action to the main panel, which
// owns the mech data + logic. NOTE: no file input lives here any more — a context
// menu embed is torn down the moment the menu closes (which the OS file dialog
// itself can trigger), so a file it picked could never reliably reach us. "Choose
// COMP/CON JSON" now asks the panel to open a proper, stable MODAL window instead.

import { OBR, CH_CM } from "./sdk.js";

OBR.onReady(() => {
  document.querySelectorAll(".cm-btn[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      try { OBR.broadcast.sendMessage(CH_CM, { action: b.dataset.act }, { destination: "LOCAL" }); } catch (_) {}
    })
  );
});
