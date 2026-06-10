import { OBR } from "./sdk.js";
import { calibrate } from "./hex.js";
import { registerTool, templateConfig } from "./tool.js";

async function startLancerUplink() {
  const status = document.getElementById("status");

  try {
    if (status) status.textContent = "Calibrating Owlbear grid...";

    await calibrate();

    if (status) status.textContent = "Registering LANCER template tool...";

    await registerTool();

    const sizeInput = document.getElementById("size");
    const colorInput = document.getElementById("color");

    if (sizeInput) {
      templateConfig.size = Number(sizeInput.value) || 3;

      sizeInput.addEventListener("change", () => {
        templateConfig.size = Number(sizeInput.value) || 3;
      });
    }

    if (colorInput) {
      templateConfig.color = colorInput.value;

      colorInput.addEventListener("change", () => {
        templateConfig.color = colorInput.value;
      });
    }

    if (status) {
      status.textContent =
        "Loaded. Select the LANCER Templates tool from Owlbear's left toolbar.";
    }
  } catch (error) {
    console.error("[LANCER//UPLINK] Failed to initialize", error);

    if (status) {
      status.textContent = `Failed to load: ${error?.message || String(error)}`;
    }
  }
}

if (OBR.isReady) {
  startLancerUplink();
} else {
  OBR.onReady(startLancerUplink);
}
