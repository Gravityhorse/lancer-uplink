// dice.js — Lancer's dice, done correctly.
//
// ACCURACY / DIFFICULTY (not D&D advantage):
//   Accuracy and Difficulty cancel 1:1. For the net remainder you roll that
//   many d6 and apply ONLY THE SINGLE HIGHEST, +highest for net Accuracy,
//   -highest for net Difficulty. They never stack by summing.
//
// OVERKILL:
//   RAW   — any damage die showing 1 is rerolled until it isn't a 1;
//           the attacker takes +1 Heat per reroll.
//   HOUSE — (this table's rule) a 1 stays on the board and spawns an extra
//           die; new dice can themselves explode, theoretically forever.
//           +1 Heat per 1 rolled, same as RAW.

const d = (faces) => 1 + Math.floor(Math.random() * faces);

export function rollAttack({ netAccuracy = 0, flat = 0 }) {
  const d20 = d(20);
  const n = Math.abs(netAccuracy);
  const accDice = Array.from({ length: n }, () => d(6));
  const highest = n ? Math.max(...accDice) : 0;
  const accApplied = netAccuracy > 0 ? highest : netAccuracy < 0 ? -highest : 0;
  return {
    d20,
    flat,
    accDice,
    accApplied,
    netAccuracy,
    total: d20 + flat + accApplied,
    crit: d20 === 20,
    isCritRange: d20 + flat + accApplied >= 20 && d20 !== 1, // Lancer: total ≥ 20 crits
  };
}

// dice: [{ n, faces }], e.g. [{n:2,faces:6},{n:1,faces:3}]
export function rollDamage({ dice = [], flat = 0, overkill = false, mode = "house", safety = 200 }) {
  const groups = [];
  let heat = 0;
  let guard = 0;

  for (const g of dice) {
    const faces = g.faces;
    const rolls = []; // { v, exploded?:bool, spawn?:bool, rerolls?:number }
    const queue = Array.from({ length: g.n }, () => ({ spawn: false }));
    while (queue.length && guard < safety) {
      guard++;
      const meta = queue.shift();
      let v = d(faces);
      if (!overkill) { rolls.push({ v }); continue; }

      if (mode === "raw") {
        // Reroll 1s until they aren't; each reroll = +1 Heat.
        let chain = 0;
        while (v === 1 && guard < safety) { guard++; heat++; chain++; v = d(faces); }
        rolls.push({ v, rerolls: chain });
      } else {
        // HOUSE: the 1 stays on the board and spawns another die of this type.
        const entry = { v, spawn: meta.spawn };
        if (v === 1) { heat++; entry.exploded = true; queue.push({ spawn: true }); }
        rolls.push(entry);
      }
    }
    groups.push({ faces, rolls });
  }

  const total =
    groups.reduce((s, g) => s + g.rolls.reduce((a, r) => a + r.v, 0), 0) + flat;
  const truncated = guard >= safety;
  return { groups, flat, total, heat, overkill, mode, truncated };
}

export function formatAttack(res) {
  const parts = [`d20→${res.d20}`];
  if (res.netAccuracy !== 0) {
    const sign = res.netAccuracy > 0 ? "ACC" : "DIFF";
    parts.push(`${sign}[${res.accDice.join(",")}]→${res.accApplied >= 0 ? "+" : ""}${res.accApplied}`);
  }
  if (res.flat) parts.push(`${res.flat >= 0 ? "+" : ""}${res.flat}`);
  return parts.join(" ");
}
