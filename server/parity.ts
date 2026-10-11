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
 *
 * It builds the world exactly as the authority does — `buildServerWorld`, off
 * the bake, with no engine and no scene — so what it fingerprints is what a
 * match stands in rather than a stand-in for it.
 */
import { MAPS } from "../src/world/maps";
import { buildServerWorld } from "./world";
import { worldFingerprint } from "../src/world/fingerprint";

const out: Record<string, unknown> = {};

for (const def of MAPS) {
  const map = await buildServerWorld(def);
  out[def.id] = worldFingerprint(map);
  map.dispose();
}

// The only thing this process means to write to stdout, so the caller can
// parse it whole. The marker is kept although Babylon's banner, which used to
// share stdout, went with the engine (`BABYLON_EXIT.md` X2.3): anything else a
// shared module ever logs there must not be able to break the parse either.
console.log(`__PARITY__${JSON.stringify(out)}`);
