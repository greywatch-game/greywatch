/**
 * What the two physics oracles share: the hash, and the page-side helpers that
 * reach Havok's RAW `HP_*` API — which is the one spelling of the engine that
 * survives `BABYLON_EXIT.md` X2.4 taking Babylon's plugin out from under it.
 *
 * **Every helper that names where the engine LIVES is one short function in
 * `pageHelpers`, and the sub-commit that moves it edits that function and
 * nothing else.** The module and the world handle are `PhysicsWorld`'s own
 * (`havok.hk`, `havok.world`, since X2.4 C4 took Babylon's plugin out), a
 * step is `PhysicsWorld`'s own substep, exactly as `PhysicsWorld.update`
 * takes one (since C2), and `clientBodies` reads the raw handles the three
 * clients keep (the shards' and the chunks' since C2, the corpses' since
 * C3). A hash read through
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
     * The raw module and the world handle every `HP_*` call takes:
     * `PhysicsWorld`'s own (`havok.ts`'s `hk` and `world`) since X2.4 C4.
     * Until then they were Babylon's plugin's (`_hknp`, `world`).
     */
    hp(g) {
      const havok = g.physics.havok;
      return { HK: havok.hk, world: havok.world };
    },
    /**
     * One substep, taken exactly as `PhysicsWorld.update` takes one: its own
     * `substep` (private to TypeScript, reachable here): every pending
     * teleport, `HP_World_SetIdealStepTime` and `HP_World_Step` at
     * `death.substep` (the `dt` handed in is that), and every dynamic body
     * synced back. Unchanged since X2.4 C2.
     */
    step(g, dt) {
      g.physics.substep(dt);
    },
    /**
     * Every pooled body of the three clients, in pool order, as
     * `[label, hpBodyId]`. A body's handle is fixed for the life of the
     * process — the pools are built once — so this is asked once per run.
     * All three are on the raw API — the shards and chunks since X2.4 C2,
     * the corpses' bones since C3 — each a `PhysicsWorld` `WorldBody`, whose
     * `id` is the handle.
     */
    clientBodies(g) {
      const out = [];
      for (const [s, slot] of g.ragdolls.slots.entries()) {
        for (const bone of slot.bones) {
          out.push([`corpse${s}.${bone.joint}`, bone.body.id]);
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
