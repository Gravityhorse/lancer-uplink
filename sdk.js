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
