/**
 * What the two physics oracles share: the hash, and the page-side helpers that
 * reach Havok's RAW `HP_*` API — which is the one spelling of the engine that
 * survives `BABYLON_EXIT.md` X2.4 taking Babylon's plugin out from under it.
 *
 * **Every helper that names where the engine LIVES is one short function in
 * `pageHelpers`, and the sub-commit that moves it edits that function and
 * nothing else.** Today the world handle and the module are the plugin's
 * (`_hknp`, `world`) and a step is `PhysicsWorld`'s own substep, exactly as
 * `PhysicsWorld.update` takes one (since X2.4 C2); X2.4 C4 points `hp` at
 * `PhysicsWorld`'s own world, and C2/C3 point `clientBodies` at wherever the
 * three clients then keep their raw body handles (C2 moved the shards' and
 * the chunks'). A hash read through
 * `HP_Body_GetQTransform` reads the same floats either side of that move,
 * which is what lets the oracles grade it.
 *
 * Read `VERIFYING.md` before driving the page; `drop.mjs` and `clients.mjs`
 * headers say what each oracle is for.
 */
import { createHash } from "node:crypto";

/** A short, stable fingerprint of anything JSON can say. */
export const sha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/**
 * Installs `window.__physref` in the page. Run with `page.evaluate(pageHelpers)`
 * once the game's handle exists; the function is serialised into the page, so
 * nothing in it may reach a Node binding.
 */
export function pageHelpers() {
  window.__physref = {
    /**
     * The raw module and the world handle every `HP_*` call takes. The
     * plugin's today (`HavokPlugin` keeps the module in `_hknp` and the
     * default region's world in `world`); `PhysicsWorld`'s own from X2.4 C4.
     */
    hp(g) {
      const plugin = g.physics.plugin;
      return { HK: plugin._hknp, world: plugin.world };
    },
    /**
     * One substep, taken exactly as `PhysicsWorld.update` takes one: its own
     * `substep` (private to TypeScript, reachable here), which since X2.4 C2
     * pre-steps the plugin's bodies and then the raw ones, calls
     * `HP_World_SetIdealStepTime` and `HP_World_Step` at `death.substep`
     * (the `dt` handed in is that), and syncs both kinds back. X2.4 C4 takes
     * the plugin out from under it and this does not change.
     */
    step(g, dt) {
      g.physics.substep(dt);
    },
    /**
     * Every pooled body of the three clients, in pool order, as
     * `[label, hpBodyId]`. A body's handle is fixed for the life of the
     * process — the pools are built once — so this is asked once per run.
     * The shards and chunks are on the raw API since X2.4 C2 (a
     * `PhysicsWorld` `WorldBody`, whose `id` is the handle); the corpses
     * still reach through Babylon's `PhysicsBody._pluginData` until C3.
     */
    clientBodies(g) {
      const out = [];
      for (const [s, slot] of g.ragdolls.slots.entries()) {
        for (const bone of slot.bones) {
          out.push([`corpse${s}.${bone.joint}`, bone.body._pluginData.hpBodyId]);
        }
      }
      for (const [b, burst] of g.debris.bursts.entries()) {
        for (const [i, shard] of burst.shards.entries()) {
          out.push([`shard${b}.${i}`, shard.body.id]);
        }
      }
      for (const [b, burst] of g.blastDebris.bursts.entries()) {
        for (const [i, chunk] of burst.chunks.entries()) {
          out.push([`chunk${b}.${i}`, chunk.body.id]);
        }
      }
      return out;
    },
    /**
     * A body's pose as Havok holds it, `[px, py, pz, qx, qy, qz, qw]`, at full
     * precision. The `+ 0` is the plugin's sync (it adds the world region's
     * floating origin, which is zero here) and turns a `-0` into a `0`;
     * JSON spells both "0", so it is kept for the reading and not the hash.
     */
    pose(HK, id) {
      const [p, q] = HK.HP_Body_GetQTransform(id)[1];
      return [p[0] + 0, p[1] + 0, p[2] + 0, q[0], q[1], q[2], q[3]];
    },
    /** True while Havok is simulating the body — a pooled body is STATIC. */
    live(HK, id) {
      return HK.HP_Body_GetMotionType(id)[1] === HK.MotionType.DYNAMIC;
    },
  };
}
