import { OBR } from "./sdk.js";
import { calibrate } from "./hex.js";
import { registerTool, templateConfig } from "./tool.js";

async function init() {
  await OBR.onReady();

  await calibrate();
  await registerTool();

  const sizeInput = document.getElementById("size");
  const colorInput = document.getElementById("color");

  if (sizeInput) {
    sizeInput.addEventListener("change", () => {
      templateConfig.size = Number(sizeInput.value) || 3;
    });
  }

  if (colorInput) {
    colorInput.addEventListener("change", () => {
      templateConfig.color = colorInput.value;
    });
  }

  document.getElementById("status").textContent =
    "Loaded. Use the LANCER Templates tool from the Owlbear toolbar.";
}

init().catch((error) => {
  console.error("[LANCER//UPLINK] Failed to initialize", error);

  document.body.innerHTML = `
    <h1>Lancer Uplink</h1>
    <p>Extension failed to load.</p>
    <pre style="white-space: pre-wrap; color: #ff9b9b;">${String(error)}</pre>
  `;
});
