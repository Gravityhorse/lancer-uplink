// sdk.js — single import point for the Owlbear Rodeo SDK.
// Served via jsDelivr's ESM build so the extension needs no bundler.
import OBR, { buildPath, buildShape, Command } from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk/+esm";

export { OBR, buildPath, buildShape, Command };

// Namespaced metadata / broadcast keys.
export const ID = "tech.lancer-uplink";
export const META = `${ID}/meta`;
export const CH_ROLL = `${ID}/roll`;
export const CH_CASCADE = `${ID}/cascade`;
export const CH_STATUS = `${ID}/status`;
