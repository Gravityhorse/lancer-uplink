const status = document.getElementById("status");

if (status) {
  status.textContent = "main.js v10 is running.";
}

console.log("[LANCER//UPLINK] main.js v10 loaded successfully.");

try {
  const sdk = await import("./sdk.js?v=10");
  console.log("[LANCER//UPLINK] sdk.js imported.", sdk);

  const hex = await import("./hex.js?v=10");
  console.log("[LANCER//UPLINK] hex.js imported.", hex);

  const tool = await import("./tool.js?v=10");
  console.log("[LANCER//UPLINK] tool.js imported.", tool);

  if (status) {
    status.textContent = "Files loaded. Waiting for Owlbear...";
  }

  const { OBR } = sdk;

  async function start() {
    try {
      if (status) {
        status.textContent = "Owlbear is ready. Registering tool...";
      }

      await hex.calibrate();
      await tool.registerTool();

      const sizeInput = document.getElementById("size");
      const colorInput = document.getElementById("color");

      if (sizeInput) {
        tool.templateConfig.size = Number(sizeInput.value) || 3;

        sizeInput.addEventListener("change", () => {
          tool.templateConfig.size = Number(sizeInput.value) || 3;
        });
      }

      if (colorInput) {
        tool.templateConfig.color = colorInput.value;

        colorInput.addEventListener("change", () => {
          tool.templateConfig.color = colorInput.value;
        });
      }

      if (status) {
        status.textContent =
          "Loaded. Use the LANCER Templates tool from Owlbear's left toolbar.";
      }
    } catch (error) {
      console.error("[LANCER//UPLINK] Tool registration failed:", error);

      if (status) {
        status.textContent = `Tool failed: ${error.message || String(error)}`;
      }
    }
  }

  if (OBR.isReady) {
    start();
  } else {
    OBR.onReady(start);
  }
} catch (error) {
  console.error("[LANCER//UPLINK] Import failed:", error);

  if (status) {
    status.textContent = `Import failed: ${error.message || String(error)}`;
  }
}
