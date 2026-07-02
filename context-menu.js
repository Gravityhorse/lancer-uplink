// context-menu.js — the embedded "Lancer Uplink" right-click panel (shown on any
// token). Everything lives under this one dropdown: Move / Boost / Sensors, Move
// Lancer, Bond Token, and Upload Pilot. Buttons LOCAL-broadcast to the main panel
// (which owns the mech data + logic); the file input reads the JSON here (a real
// user gesture) and broadcasts its text for the panel to import.

import { OBR, CH_CM, CH_UPLOAD } from "./sdk.js";

OBR.onReady(() => {
  document.querySelectorAll(".cm-btn[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      try { OBR.broadcast.sendMessage(CH_CM, { action: b.dataset.act }, { destination: "LOCAL" }); } catch (_) {}
    })
  );
  const up = document.getElementById("cm-upload");
  up?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      OBR.broadcast.sendMessage(CH_UPLOAD, { text, name: f.name }, { destination: "LOCAL" });
    } catch (_) {}
    e.target.value = ""; // allow re-picking the same file
  });
});
