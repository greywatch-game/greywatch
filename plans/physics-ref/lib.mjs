/**
 * What the two physics oracles share: the hash, and the page-side helpers that
 * reach Havok's RAW `HP_*` API — which is the one spelling of the engine that
 * survives `BABYLON_EXIT.md` X2.4 taking Babylon's plugin out from under it.
 *
 * **Every helper that names where the engine LIVES is one short function in
 * `pageHelpers`, and each one answers for BOTH eras of the game**: the
 * plugin-era tree the oracles were banked against (fb90b7d, X2.4 C0 — the
 * module in `HavokPlugin._hknp`, a body's handle in
 * `PhysicsBody._pluginData.hpBodyId`, a step through the scene's physics
 * engine) and the raw one since C4 (`PhysicsWorld`'s own `havok.hk` and
 * `havok.world`, its own `substep`, a `WorldBody`'s `id`). A helper asks
 * which tree it is in and reaches accordingly, so a strengthened check can be
 * BANKED on the pre-port source (`git checkout fb90b7d -- src`, run, restore)
 * and graded on the port — which is the only way a new check proves anything
 * about the port rather than about itself. A hash read through
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
  /** True in the raw tree (X2.4 C4 on), false in the plugin-era one. */
  const raw = (g) => !!(g.physics.havok && g.physics.havok.hk);
  /** A pooled body's raw handle: a `WorldBody`'s `id`, or the plugin's. */
  const idOf = (body) => (body.id !== undefined ? body.id : body._pluginData.hpBodyId);
  window.__physref = {
    /** Which tree the page is running, for the log: "raw" or "plugin". */
    era(g) {
      return raw(g) ? "raw" : "plugin";
    },
    /**
     * The raw module and the world handle every `HP_*` call takes:
     * `PhysicsWorld`'s own (`havok.ts`'s `hk` and `world`) since X2.4 C4,
     * Babylon's plugin's (`_hknp`, `world`) before it.
     */
    hp(g) {
      if (raw(g)) {
        const havok = g.physics.havok;
        return { HK: havok.hk, world: havok.world };
      }
      const plugin = g.physics.plugin;
      return { HK: plugin._hknp, world: plugin.world };
    },
    /**
     * One substep, taken exactly as `PhysicsWorld.update` takes one. Raw:
     * its own `substep` (private to TypeScript, reachable here) — every
     * pending teleport, `HP_World_SetIdealStepTime` and `HP_World_Step` at
     * `death.substep` (the `dt` handed in is that), and every dynamic body
     * synced back. Plugin era: through Babylon's physics engine, which
     * pre-stepped every body whose prestep was on, stepped at the plugin's
     * FIXED 1/60 and synced every non-static body back onto its node.
     */
    step(g, dt) {
      if (raw(g)) g.physics.substep(dt);
      else g.scene.getPhysicsEngine()._step(dt);
    },
    /**
     * Every pooled body of the three clients, in pool order, as
     * `[label, hpBodyId]`. A body's handle is fixed for the life of the
     * process — the pools are built once — so this is asked once per run.
     */
    clientBodies(g) {
      const out = [];
      for (const [s, slot] of g.ragdolls.slots.entries()) {
        for (const bone of slot.bones) {
          out.push([`corpse${s}.${bone.joint}`, idOf(bone.body)]);
        }
      }
      for (const [b, burst] of g.debris.bursts.entries()) {
        for (const [i, shard] of burst.shards.entries()) {
          out.push([`shard${b}.${i}`, idOf(shard.body)]);
        }
      }
      for (const [b, burst] of g.blastDebris.bursts.entries()) {
        for (const [i, chunk] of burst.chunks.entries()) {
          out.push([`chunk${b}.${i}`, idOf(chunk.body)]);
        }
      }
      return out;
    },
    /**
     * How many static bodies the MAP is built as — one per bucket.
     * `PhysicsWorld.worldBodies` in both trees (handles in the raw one,
     * `PhysicsBody`s in the plugin's), private to TypeScript and reachable
     * here: the count, not the bodies, is what is wanted.
     */
    staticCount(g) {
      return g.physics.worldBodies.length;
    },
    /**
     * The STATIC bodies in the world: the map's, and every pooled body
     * parked between uses — `drop.mjs`'s reading of what the world was built
     * as, the same count in either tree.
     */
    staticBodies(g) {
      const { HK } = this.hp(g);
      let n = this.staticCount(g);
      for (const [, id] of this.clientBodies(g)) if (!this.live(HK, id)) n++;
      return n;
    },
    /**
     * Every body in the Havok WORLD, as the engine counts them
     * (`HP_World_GetNumBodies`) — the map's, the pools' and anything an
     * oracle added. What a teardown that leaked a body would raise.
     */
    worldCount(g) {
      const { HK, world } = this.hp(g);
      return HK.HP_World_GetNumBodies(world)[1];
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
