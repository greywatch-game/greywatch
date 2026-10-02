// Audit a map's placements for the things a hand-edited or generated layout
// gets wrong without anything crashing: buildings on roads, in the water, on a
// slope, overlapping each other, with a door that opens onto a wall; spawns
// inside something; roads running into the water; and how far each side's home
// is from each flag.
//
// usage:
//   node .claude/skills/map-layout/scripts/audit.mjs <map|--all> [--verbose]
//
// No browser. It reads layout.ts and heights.ts as they are on disk, so run
// the generator (or save in the editor) first. Only the kinds in
// footprints.mjs are checked — the village, jungle, city and harbour kits; a
// desert or temple kind is counted as "not checked" rather than guessed at.
//
// ERROR is a mistake: fix it. WARN is worth a look: a door with no street in
// reach may still open onto a yard the check cannot see.
import { BUILDINGS, DOORS, FOOT, bounds, frontOf, inside, rotate } from "./footprints.mjs";
import { loadMap, mapIds } from "./load.mjs";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const ids = args.includes("--all") ? mapIds().filter((m) => m !== "proving") : args.filter((a) => !a.startsWith("--"));
if (!ids.length) {
  console.error("usage: audit.mjs <map|--all> [--verbose]");
  process.exit(1);
}

/** Pieces that may reach over the water on purpose, and pieces that are the road or stand on its kerb. */
const WET_OK = new Set(["mill", "boathouse", "jetty", "bridge", "ramp", "quay", "careenedHull"]);
const ROAD_OK = new Set(["lamp", "bridge", "stall", "well", "cart", "crates", "trough", "barrel", "gatehouse", "car", "streetLight"]);
/** Kerb furniture a body steps round: it does not block a door. */
const FURNITURE = new Set(["lamp", "streetLight", "car", "planter", "barrier", "crates", "stall", "cart", "trough", "barrel"]);
/**
 * Kinds that carry their own footings, plinths or first course down to the
 * ground under them (`CONFORMS_TO_TERRAIN`), so a slope under them is drawn
 * rather than left as daylight. The cottage and the townhouse are in that set
 * for their SEEDING only and still stand on one sample — they are held to FLAT.
 */
const CONFORMS = new Set(["chapel", "ruin", "shed", "cart", "stall", "woodpile"]);
/** How far a building may fall across its footprint, and a prop. */
const FLAT = 0.3;
const FLAT_PROP = 0.5;
/** How far a door looks for a street. */
const REACH = 14;

let errorsTotal = 0;
for (const id of ids) {
  const m = await loadMap(id);
  const { layout, floorAt, wet, onRoadAt, half } = m;
  const placed = layout.placements.filter((p) => p.kind !== "road");
  const checked = placed.filter((p) => FOOT[p.kind]);
  const solid = checked.filter((p) => !["lamp", "fence", "stoneWall", "bridge", "jetty", "ramp", "quay"].includes(p.kind));
  const blocking = solid.filter((p) => !FURNITURE.has(p.kind));
  const out = { ERROR: [], WARN: [] };
  const say = (level, p, what) =>
    out[level].push(`${level.padEnd(5)} ${p.kind} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) rotY ${(p.rotY ?? 0).toFixed(2)}: ${what}`);

  const samples = (p, n = 4) => {
    const b = bounds(p);
    const pts = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const x = b.x0 + (i / n) * (b.x1 - b.x0);
      const z = b.z0 + (j / n) * (b.z1 - b.z0);
      if (inside(p, x, z, 0.01)) pts.push([x, z]);
    }
    return pts;
  };

  for (const p of checked) {
    const pts = samples(p);
    const building = BUILDINGS.has(p.kind);
    // On a road.
    if (!ROAD_OK.has(p.kind) && !["fence", "stoneWall"].includes(p.kind)) {
      // No padding: the footprints include the eaves, and an eave over a
      // junction's kerb is a street, not a mistake.
      if (pts.some(([x, z]) => onRoadAt(x, z, 0))) say(building ? "ERROR" : "WARN", p, "stands on a road");
    }
    // In the water.
    if (!WET_OK.has(p.kind) && !["fence", "stoneWall"].includes(p.kind)) {
      if (pts.some(([x, z]) => wet(x, z, 0))) say(building ? "ERROR" : "WARN", p, "stands in the water");
    }
    // On a slope — the placement samples the floor once, at its centre.
    if (!CONFORMS.has(p.kind) && !WET_OK.has(p.kind) && !["fence", "stoneWall", "watchtower"].includes(p.kind)) {
      const h0 = floorAt(p.x, p.z);
      const relief = Math.max(...pts.map(([x, z]) => Math.abs(floorAt(x, z) - h0)));
      const limit = building ? FLAT : FLAT_PROP;
      if (relief > limit) say(building ? "ERROR" : "WARN", p, `ground falls ${relief.toFixed(2)} m across it (limit ${limit})`);
    }
    // Off the edge.
    const b = bounds(p);
    if (Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.z0), Math.abs(b.z1)) > half) say("WARN", p, "reaches past the play square");
  }

  // Buildings overlapping one another (props and runs are allowed to touch).
  const blds = checked.filter((p) => BUILDINGS.has(p.kind));
  for (let i = 0; i < blds.length; i++) {
    for (let k = i + 1; k < blds.length; k++) {
      const a = blds[i];
      const c = blds[k];
      const ba = bounds(a);
      const bc = bounds(c);
      if (ba.x1 < bc.x0 || bc.x1 < ba.x0 || ba.z1 < bc.z0 || bc.z1 < ba.z0) continue;
      if (samples(a, 6).some(([x, z]) => inside(c, x, z, -0.05))) say("ERROR", a, `overlaps the ${c.kind} at (${c.x.toFixed(1)}, ${c.z.toFixed(1)})`);
    }
  }

  // Doors: walk out of the front face and find a street before anything solid.
  for (const p of checked.filter((q) => DOORS.has(q.kind))) {
    const [z0, sign] = frontOf(p);
    const [fx, fz] = rotate(0, sign, p.rotY ?? 0);
    const [sx, sz] = rotate(0, z0, p.rotY ?? 0);
    let verdict = `no street within ${REACH} m of the door`;
    let level = "WARN";
    for (let t = 0.3; t <= REACH; t += 0.5) {
      const x = p.x + sx + fx * t;
      const z = p.z + sz + fz * t;
      if (onRoadAt(x, z)) {
        verdict = null;
        break;
      }
      const hit = blocking.find((q) => q !== p && inside(q, x, z));
      if (hit) {
        verdict = `door opens onto the ${hit.kind} at (${hit.x.toFixed(1)}, ${hit.z.toFixed(1)}), ${t.toFixed(1)} m out`;
        level = "ERROR";
        break;
      }
      if (wet(x, z, 0)) {
        verdict = `door opens onto the water ${t.toFixed(1)} m out`;
        // Past a doorstep, water is a bank the house looks over rather than a
        // door into the creek.
        level = p.kind === "boathouse" || t > 6 ? "WARN" : "ERROR";
        break;
      }
    }
    if (verdict) say(level, p, verdict);
  }

  // Spawns and flags.
  const flags = layout.controlPoints;
  for (const s of layout.spawns) {
    const hit = solid.find((q) => inside(q, s.pos.x, s.pos.z, 0.4));
    if (hit) out.ERROR.push(`ERROR spawn (${s.pos.x}, ${s.pos.z}) stands in the ${hit.kind} at (${hit.x}, ${hit.z})`);
    if (wet(s.pos.x, s.pos.z)) out.ERROR.push(`ERROR spawn (${s.pos.x}, ${s.pos.z}) is in the water`);
    if (s.controlPoint) {
      const f = flags.find((c) => c.id === s.controlPoint);
      if (f && Math.hypot(s.pos.x - f.pos.x, s.pos.z - f.pos.z) <= f.radius) out.WARN.push(`WARN  ${f.id}'s spawn is inside its own ring`);
    }
  }
  for (const f of flags) {
    const hit = solid.find((q) => inside(q, f.pos.x, f.pos.z));
    // A flag inside a building with a door is a flag fought over indoors (the
    // chapel, the barn, the boathouse) and is stated with `poleLift`.
    if (hit && !(DOORS.has(hit.kind) && f.poleLift)) out.WARN.push(`WARN  flag ${f.id} stands inside the ${hit.kind} at (${hit.x}, ${hit.z}) with no poleLift`);
  }

  // Roads in the water.
  let wetRoad = 0;
  let firstWet = null;
  for (let x = -half; x <= half; x += 1) {
    for (let z = -half; z <= half; z += 1) {
      if (onRoadAt(x, z) && wet(x, z, 0)) {
        wetRoad++;
        firstWet ??= `(${x}, ${z})`;
      }
    }
  }
  if (wetRoad) out.WARN.push(`WARN  ${wetRoad} m² of carriageway is under water, first at ${firstWet} — a ford only if the design says so`);

  // How far each side lives from each flag, as the crow flies.
  const homes = [0, 1].map((t) => {
    const s = layout.spawns.filter((q) => q.team === t);
    return s.length ? { x: s.reduce((a, q) => a + q.pos.x, 0) / s.length, z: s.reduce((a, q) => a + q.pos.z, 0) / s.length } : null;
  });

  const notChecked = [...new Set(placed.filter((p) => !FOOT[p.kind]).map((p) => p.kind))];
  console.log(`\n== ${id}: ${placed.length} placements, ${checked.length} checked — ${out.ERROR.length} errors, ${out.WARN.length} warnings`);
  if (notChecked.length) console.log(`   not checked (no footprint entry): ${notChecked.join(", ")}`);
  const cap = verbose ? Infinity : 25;
  for (const line of [...out.ERROR, ...out.WARN].slice(0, cap)) console.log("   " + line);
  if (out.ERROR.length + out.WARN.length > cap) console.log(`   … ${out.ERROR.length + out.WARN.length - cap} more (--verbose)`);
  if (homes[0] && homes[1]) {
    const rows = flags.map((f) => [f.id, ...homes.map((h) => Math.round(Math.hypot(f.pos.x - h.x, f.pos.z - h.z)))]);
    const sum = [1, 2].map((k) => rows.reduce((a, r) => a + r[k], 0));
    console.log(`   home → flag (m, straight line): ${rows.map((r) => `${r[0]} ${r[1]}/${r[2]}`).join("  ")}   total ${sum[0]}/${sum[1]}`);
  }
  errorsTotal += out.ERROR.length;
}
process.exit(errorsTotal ? 1 : 0);
