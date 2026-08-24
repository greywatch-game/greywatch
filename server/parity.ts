/**
 * server/parity.ts — Prints a fingerprint of the world the SERVER builds, as
 * JSON on stdout. Consumed by `scripts/check-world-parity.mjs`, which compares
 * it against the same fingerprint taken from a real browser build.
 *
 * This exists because the entire multiplayer design rests on one claim: that a
 * world rebuilt from `<map>/collision.ts` is the world the clients are standing
 * in. If it is not, the failure is silent and horrible — shots that land on a
 * wall for the shooter and pass through it for everyone else, bots pathing
 * through a house that is solid on screen. So the claim is checked rather than
 * argued, and checked on the derived structures rather than on the input:
 * matching box counts would prove very little, whereas a matching nav graph
 * means every box ended up in the same place and the same shape.
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core";
import { MAPS } from "../src/world/maps";
import { buildServerWorld } from "./world";
import { worldFingerprint } from "../src/world/fingerprint";

const engine = new NullEngine();
const out: Record<string, unknown> = {};

for (const def of MAPS) {
  const scene = new Scene(engine);
  const map = await buildServerWorld(scene, def);
  out[def.id] = worldFingerprint(map);
  map.dispose();
  scene.dispose();
}

// The only thing this process writes to stdout, so the caller can parse it
// whole. Babylon's own banner goes to stdout too, hence the marker.
console.log(`__PARITY__${JSON.stringify(out)}`);
