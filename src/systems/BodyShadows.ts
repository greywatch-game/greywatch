/**
 * BodyShadows.ts — the SECOND shadow map: soldiers and hulls, and nothing else.
 * Decides everything about it — where its window stands (its own light's
 * direction and position, texel-snapped), the light's matrix, which bodies
 * cast and as what — and hands each frame's proxies to OUR renderer, which
 * owns the map and draws it (`render/BodyShadowMap.ts`, `BABYLON_EXIT.md`
 * X4.1c). Owns no combatant, no rig and no vehicle — it is handed what to
 * draw and reads transforms off it — and no Babylon light, generator or mesh
 * any more.
 * Invariants:
 * - The map is OUR renderer's in every state and on every rung that has one:
 *   Babylon's readers (the cel materials, the grass, the water, the
 *   volumetric march) sample a wrapped view of its texture
 *   (`wrapShadowTexture`), our frame binds the texture itself (rule 5), and
 *   there is no generator to fall back to — a map ours cannot draw is the
 *   round's failure (`BodyShadowMap.setFailure`, wired by `Game`).
 * - It is drawn every frame it is UPDATED, whole, from the proxies packed
 *   that frame, as Babylon's generator re-rendered every frame from the
 *   proxy's thin instances; a frame that packs none clears it.
 * - The light matrix is `getTransformMatrix`'s arithmetic
 *   (`lightTransformToRef`, the one copy the world's maps read too), rewritten
 *   in place in one `Matrix` the materials hold by reference, and recomputed
 *   whenever what it is made of moves: the window, the direction, the rung.
 * - The map records BACK FACES ONLY. See "Why back faces" below.
 * - The map may be OFF (`CONFIG.graphics.shadowTiers`): no texture, the lit
 *   1x1 is bound in its place, the matrix is the identity and nothing is
 *   packed. A rung also sets the map's SIZE and its WINDOW, so the texel
 *   budget moves as a pair and not only the resolution.
 * - A hull is its collider box off its OWN fields (`core/proxyBoxes.ts`,
 *   `hullBodyToRef`), never its mesh.
 * Contract: `docs/rendering.md`.
 *
 * ## WHY A SECOND MAP RATHER THAN MORE CASTERS IN THE FIRST ONE
 *
 * `ShadowSystem` re-renders its depth pass only when the texel-snapped focus
 * MOVES, which is the whole reason ~150 static casters are affordable. One
 * animated caster in that list turns it into a per-frame redraw of the village,
 * and that is the cost the volumetric march was designed around rather than a
 * detail — `Volumetrics.ts`'s header says so, and says to measure before
 * "fixing" it. A map of its own pays for the bodies and nothing else.
 *
 * It buys two things beside the one it was built for. Its window is sized to
 * the BODIES rather than to the map, so 48 m over 1024 texels is 4.7 cm against
 * the world map's 5.4 at a quarter of the area — a body's shadow is finer than
 * the wall it falls on. And it can cull front faces without the world having to.
 *
 * ## ONE DRAW CALL, WHATEVER THE ROSTER
 *
 * Every proxy is an instance of ONE unit box. A soldier is twelve instances —
 * `RAGDOLL_BONES`, which is the shape of a body already measured against the
 * drawn boxes and already driven by the joints the pose drives — and a hull is
 * one, its own collider box. So the pass is one draw at 8v8 and one draw at
 * 24v24, and the CPU cost is the matrices: one multiply per instance.
 *
 * **Using `RAGDOLL_BONES` is the load-bearing choice, not a convenience.** The
 * shadow follows a crouch, a stance, a turn and a RAGDOLL for free, because
 * those boxes hang off the same joints — `RagdollSystem` poses those joints
 * off Havok's pose arrays (`Joint.pose`, `WorldBody.pose`) and the shadow goes
 * with the corpse without this file knowing physics exists. A hand-authored capsule would have been a pill that slid
 * along the ground under a walking body, which is the artefact the blob disc
 * already is.
 *
 * ## WHY BACK FACES
 *
 * A proxy box ENCLOSES the geometry it stands for, so a body's own visible
 * surfaces are inside their own caster. Recording front faces puts every one of
 * them behind the depth they are compared against, and a soldier comes out
 * uniformly in shadow — which reads as a black cut-out rather than as a bug.
 * The map records the FAR side of each box instead (Babylon's generator was
 * told `forceBackFacesOnly`; ours culls the faces it dropped): a surface
 * inside the box is nearer than that and tests lit, and the ground behind the
 * body is further and tests shadowed. The boxes are closed and convex, so there
 * is no case where this is approximate — the one thing it gives up is the few
 * centimetres between a boot's near and far faces, which is why the blob disc
 * stays (`CONFIG.graphics.shadows.blobRadius` says the rest).
 *
 * Limb-on-limb self-shadowing survives that and is wanted: an arm's box is in
 * front of the torso, so its back face still is, and bodies that had no
 * self-shading at all now have some.
 *
 * ## WHAT DOES NOT CAST
 *
 * **The local player**, because in first person there is no rig to read — the
 * camera is inside the head and `SoldierModel` builds nothing for them. They
 * keep their contact disc. The death cam's stand-in is a real rig and would
 * cast if it were handed over; it is not, because three seconds of your own
 * corpse is not worth a second list.
 *
 * **A flying hull's shadow, most of the time.** A gunship 40 m up throws its
 * shadow 150 m along a low sun, and no window a client can afford contains
 * that. It casts when it is low, which is when a player is under it.
 */
import { type BaseTexture, Matrix, type Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { ProxyBoxes, type ShadowBody, type ShadowHull } from "../core/proxyBoxes";
import {
  depthBias,
  lightTransformToRef,
  litShadowTexture,
  SHADOW_NEAR,
  type ShadowLight,
  ShadowWindow,
} from "../core/shadowWindow";
import { wrapShadowTexture } from "../core/wrappedTextures";
import type { ShadowQuality } from "../core/settings";
import type { BodyShadowMap } from "../render/BodyShadowMap";
import { RAGDOLL_BONES } from "../entities/soldierBones";
import type { CelMaterialFactory } from "../shaders/CelShader";

export type { ShadowBody, ShadowHull };

/**
 * The most proxies one frame packs — the bodies' budget in boxes and the
 * hulls' — which our renderer's map is sized for (`BodyShadowMap`).
 */
export const BODY_SHADOW_PROXIES =
  CONFIG.graphics.bodyShadows.maxBodies * RAGDOLL_BONES.length + CONFIG.graphics.bodyShadows.maxHulls;

export class BodyShadows {
  /**
   * Where the map's light points and stands — the window's to place
   * (`ShadowWindow.place`) and the matrix's to read. It is a pair and not a
   * Babylon `DirectionalLight`: the light only ever defined a generator's
   * frustum, and there is no generator. It starts where a `DirectionalLight`
   * does, at minus its direction.
   */
  private readonly light: ShadowLight;
  /** The rung's resolution (0 is off, -1 not yet set) and its window's side. */
  private mapSize = -1;
  private window: number = CONFIG.graphics.bodyShadows.window;
  private readonly offMatrix = Matrix.Identity();
  /**
   * The light's view-projection, rewritten IN PLACE whenever the window, the
   * direction or the rung moves it — the one object every reader is handed
   * (`setBodyShadowMatrix`), as the generator's was.
   */
  private readonly matrix = new Matrix();
  /** Babylon's view of our texture, while the map has one. */
  private wrapped: BaseTexture | null = null;
  /** Instance matrices, packed. Never reallocated. */
  private readonly matrices: Float32Array<ArrayBuffer>;
  /** How many of `matrices` are live this frame. */
  private count = 0;
  /**
   * Where this window stands — `core/shadowWindow.ts`, the same texel snap
   * `ShadowSystem` places its own window with.
   *
   * **The arithmetic is shared and the INSTANCE is not**, which is the whole
   * of what these two maps do and do not have in common: the snap is in texels
   * of a particular map size, so 48 m over 1024 and 110 m over 2048 land on two
   * different grids off the same focus. What would be a bug is the two
   * DISAGREEING about the arithmetic, and that is exactly what one module
   * rather than two copies removes.
   */
  private readonly win = new ShadowWindow();
  /** What a soldier and a hull are as boxes — shared with `LocalShadows`. */
  private readonly boxes = new ProxyBoxes();
  /** Nearest-first selection scratch, reused frame to frame. See `packBodies`. */
  private readonly picked: (ShadowBody | null)[] = [];
  private readonly pickedDist: number[] = [];

  /** The bodies' depth map, for `ShadowBindings` and `Volumetrics`: our texture's wrapped view, or the lit 1x1. */
  get depthMap(): BaseTexture {
    return this.wrapped ?? litShadowTexture(this.scene);
  }

  /**
   * The light's view*projection — the identity while the map is off. It is
   * MUTATED IN PLACE, so a caller holding it tracks the window whether it asks
   * again or not — the same caveat `ShadowSystem.lightMatrix` carries, and the
   * same advice: re-read.
   */
  get lightMatrix(): Matrix {
    return this.mapSize > 0 ? this.matrix : this.offMatrix;
  }

  constructor(
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    quality: ShadowQuality,
    /** Our renderer's map: what every proxy packed here is drawn into. */
    private readonly map: BodyShadowMap,
  ) {
    const direction = new Vector3(-0.3, -0.85, 0.42).normalize();
    this.light = { direction, position: direction.scale(-1) };
    this.matrices = new Float32Array(BODY_SHADOW_PROXIES * 16);
    this.setQuality(quality);
  }

  /**
   * Stands the map up at a rung's size and window, or takes it down.
   *
   * The texture is re-made rather than resized, AFRESH whatever its size:
   * disposing Babylon's view of the old one destroys the texture it wraps
   * (at the end of Babylon's frame), so nothing is kept under a view that is
   * going. The fresh map is drawn from the proxies last packed, from where
   * the light stands now — what a fresh generator rendered on its first
   * frame — and the window is invalidated because its texel snap is in
   * texels of the size and side that just changed.
   */
  setQuality(quality: ShadowQuality): void {
    const c = CONFIG.graphics.bodyShadows;
    const tier = CONFIG.graphics.shadowTiers[quality];
    if (tier.bodies === this.mapSize && tier.bodyWindow === this.window) return;
    this.wrapped?.dispose();
    this.wrapped = null;
    this.map.setSize(0);
    this.mapSize = tier.bodies;
    this.window = tier.bodyWindow;
    this.win.invalidate();
    if (tier.bodies > 0) {
      this.map.setSize(tier.bodies);
      this.wrapped = wrapShadowTexture(this.scene, this.map.texture!, "bodyShadow");
      this.restate();
    } else {
      this.count = 0;
    }
    this.mats.shadows.setBodyShadowMap(this.depthMap, this.wrapped ? this.map.own : null);
    this.mats.shadows.setBodyShadowParams(depthBias(c.bias, c.depthRange));
    this.mats.shadows.setBodyShadowMatrix(this.lightMatrix);
  }

  /**
   * Points this window along the same key light the world's shadows use.
   *
   * `Game` pushes it to both systems from one place, which is what keeps them
   * from disagreeing: two maps lit from two directions is two shadows off one
   * body, and the failure looks like the body map being broken rather than like
   * a direction that was not forwarded.
   */
  setLightDirection(direction: readonly [number, number, number]): void {
    this.light.direction.set(direction[0], direction[1], direction[2]).normalize();
    this.win.invalidate();
    // A generator read its light at every render: until the next update
    // places the window, the map stands where it was, lit from here.
    if (this.mapSize > 0) this.restate();
  }

  /**
   * One frame's proxies, and the window they are drawn in.
   *
   * The window follows the same focus the world's shadows do, snapped to this
   * map's own texel grid. **It is snapped even though this map re-renders every
   * frame**, and the two are unrelated: the refresh rate decides whether the
   * depths are current and the snap decides whether a STANDING body's shadow
   * edge crawls as the camera walks. Both are wanted.
   *
   * `mats` takes the matrix on the frames the window actually moved, which is
   * `ShadowSystem.update`'s argument verbatim — outside that guard this is a
   * `setMatrix` on every cel material plus the grass and the water, every
   * frame, to re-hand them a matrix that had not changed.
   */
  update(
    focus: Vector3,
    mats: CelMaterialFactory,
    bodies: readonly ShadowBody[],
    hulls: readonly ShadowHull[],
  ): void {
    const c = CONFIG.graphics.bodyShadows;
    if (this.mapSize <= 0) {
      // Off: nothing draws the proxies, so nothing is worth packing.
      this.count = 0;
      return;
    }
    if (this.win.place(this.light, focus, this.window, this.mapSize, c.distance)) {
      this.transform();
      mats.shadows.setBodyShadowMatrix(this.matrix);
    }

    this.count = 0;
    this.packBodies(focus, bodies);
    this.packHulls(hulls);
    // Drawn whole on the next frame our renderer prepares — or, with nobody
    // in the window, OWED a clear on that same next frame, the cleared pass
    // Babylon's generator drew for an empty frame and at its timing; cleared
    // at once only in a state that prepares no frame of ours (an editor
    // build: `BodyShadowMap.draw`).
    this.map.draw(this.matrix.m, this.matrices, this.count);
  }

  /** `matrix` off where the light stands now, over the window and the volume. */
  private transform(): void {
    lightTransformToRef(
      this.light,
      this.window,
      SHADOW_NEAR,
      CONFIG.graphics.bodyShadows.depthRange,
      this.scene.getEngine().isNDCHalfZRange,
      this.matrix,
    );
  }

  /** The matrix re-made and the proxies last packed drawn again with it: the map re-stated where it stands. */
  private restate(): void {
    this.transform();
    this.map.draw(this.matrix.m, this.matrices, this.count);
  }

  /**
   * The bodies worth drawing, nearest the window's focus first.
   *
   * **The common path neither sorts nor allocates**: while the candidates fit
   * the budget they are taken in the order they arrive and nothing is compared
   * at all. Only a frame with more bodies in one window than `maxBodies` pays
   * for the selection, and it pays with the same insertion `LightingSystem`
   * spends its light slots with — a partial selection over a small list, which
   * is cheaper than sorting the roster to throw most of it away.
   *
   * The gather radius is the window's own side rather than its half-side, on
   * purpose: a body just OUTSIDE the window still throws its shadow into it,
   * and the ortho projection clips whatever genuinely misses for free. Being
   * over-inclusive costs one instance; being under-inclusive is a shadow that
   * pops as its owner walks toward you.
   */
  private packBodies(focus: Vector3, bodies: readonly ShadowBody[]): void {
    const c = CONFIG.graphics.bodyShadows;
    const reach = this.window * this.window;
    const picked = this.picked;
    const dist = this.pickedDist;
    let n = 0;
    for (const body of bodies) {
      const rig = body.rig;
      // Whether the body is DRAWN, which is the only question that matters
      // here: a pooled rig nobody is wearing is switched off, a living bot is
      // on, and a corpse under Havok is still on — which is what makes a
      // ragdoll's shadow follow it without this file knowing it fell.
      if (!rig.enabled) continue;
      // The root's world position, composed fresh: its float32 translation.
      const p = rig.tree.computeChain(rig.root).m;
      const dx = p[12] - focus.x;
      const dy = p[13] - focus.y;
      const dz = p[14] - focus.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reach) continue;
      if (n < c.maxBodies) {
        picked[n] = body;
        dist[n] = d2;
        n++;
        continue;
      }
      // Full: replace the furthest held, and only if this one beats it.
      let worst = 0;
      for (let i = 1; i < n; i++) if (dist[i] > dist[worst]) worst = i;
      if (d2 >= dist[worst]) continue;
      picked[worst] = body;
      dist[worst] = d2;
    }
    for (let i = 0; i < n; i++) this.packRig(picked[i]!.rig);
    // Dropped so a pooled rig cannot be held alive by this list between frames.
    for (let i = 0; i < n; i++) picked[i] = null;
  }

  /** One rig's twelve boxes, each at its joint's current world transform. */
  private packRig(rig: ShadowBody["rig"]): void {
    this.count += this.boxes.writeRig(rig, this.matrices, this.count);
  }

  /**
   * One box per hull ON THE FIELD, off the collider the rest of the game
   * already uses — the hull's own fields, never its mesh.
   */
  private packHulls(hulls: readonly ShadowHull[]): void {
    for (const hull of hulls) {
      if (this.count >= BODY_SHADOW_PROXIES) return;
      if (!hull.present) continue;
      this.boxes.writeHull(hull, this.matrices, this.count);
      this.count++;
    }
  }
}
