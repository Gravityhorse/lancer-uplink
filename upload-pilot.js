// upload-pilot.js — the right-click "Upload Pilot" embed. A file button lives IN
// the embed so the OS file picker opens from a real user gesture (a context-menu
// onClick can't reliably open a file dialog). The chosen file's text is read here
// and LOCAL-broadcast to the panel, which parses + imports it.

import { OBR, CH_UPLOAD } from "./sdk.js";

OBR.onReady(() => {
  const input = document.getElementById("up-file");
  const status = document.getElementById("up-status");
  input?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (status) status.textContent = `Reading ${f.name}…`;
    try {
      const text = await f.text();
      OBR.broadcast.sendMessage(CH_UPLOAD, { text, name: f.name }, { destination: "LOCAL" });
      if (status) status.textContent = `Sent ${f.name} — check the panel.`;
    } catch (_) {
      if (status) status.textContent = "Couldn't read that file.";
    }
    e.target.value = ""; // allow re-picking the same file
  });
});
