// context-menu.js — the embedded right-click panel on the bonded token. The
// context-menu row is already labelled "Lancer Uplink", so this is just the
// three buttons. Each LOCAL-broadcasts a command to the main panel, which owns
// the mech data and range-field logic (same-client, no network traffic).

import { OBR, CH_CM } from "./sdk.js";

OBR.onReady(() => {
  document.querySelectorAll(".cm-btn[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      try { OBR.broadcast.sendMessage(CH_CM, { action: b.dataset.act }, { destination: "LOCAL" }); } catch (_) {}
    })
  );
});
