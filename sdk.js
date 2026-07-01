// sdk.js — single import point for the Owlbear Rodeo SDK.
// Served via jsDelivr's ESM build so the extension needs no bundler.
import OBR, { buildPath, buildShape, buildLabel, buildText, Command } from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk/+esm";

export { OBR, buildPath, buildShape, buildLabel, buildText, Command };

// Namespaced metadata / broadcast keys.
export const ID = "tech.lancer-uplink";
export const META = `${ID}/meta`;
export const CH_ROLL = `${ID}/roll`;       // text roll-log entries
export const CH_ROLL3D = `${ID}/roll3d`;   // full 3D dice replays (type/role/value per die)
export const CH_CASCADE = `${ID}/cascade`;
export const CH_STATUS = `${ID}/status`;
// Same-client (destination:"LOCAL") channels between the panel and the separate
// on-screen remote-roll popover window.
export const CH_RP = `${ID}/rp`;            // panel → popup: a roll to replay
export const CH_RP_READY = `${ID}/rp-ready`; // popup → panel: "I'm loaded, send me anything pending"
export const CH_RP_CLOSED = `${ID}/rp-closed`; // popup → panel: "I idle-closed, reopen me next time"

// The on-screen popover's id + served URL (base path matches the manifest).
export const RP_POPOVER = `${ID}/roll-popover`;
export const RP_POPOVER_URL = "/lancer-uplink/roll-popup.html";

// Right-click "Lancer Uplink" context-menu embed on the bonded token.
export const CM_ID = `${ID}/ctx-menu`;
export const CM_URL = "/lancer-uplink/context-menu.html";
export const CH_CM = `${ID}/cm`;              // embed → panel: a command {action, ...}
export const CH_CM_READY = `${ID}/cm-ready`;  // embed → panel: "loaded, send me data"
export const CH_CM_DATA = `${ID}/cm-data`;    // panel → embed: { name, weapons, active }
export const CH_UPLOAD = `${ID}/upload`;      // upload embed → panel: { text, name }
export const UPLOAD_URL = "/lancer-uplink/upload-pilot.html";
