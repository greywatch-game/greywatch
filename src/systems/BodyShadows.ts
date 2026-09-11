/**
 * BodyShadows.ts — the SECOND shadow map: soldiers and hulls, and nothing else.
 * Owns its own directional light, its own generator, its own texel-snapped
 * window and the one proxy mesh every body in the game is drawn as. Owns no
 * combatant, no rig and no vehicle — it is handed what to draw and reads
 * transforms off it.
 * Invariants:
 * - The MAIN PASS never sees the proxy: it carries `PROXY_LAYER`, which no
 *   camera's `layerMask` includes, and an explicit render list is the only
 *   thing that draws it (`ObjectRenderer` does not check `layerMask` against a
 *   custom list, where `Scene._evaluateActiveMeshes` does — those two facts
 *   together are the whole mechanism).
 * - The proxy must stay `isVisible` to be drawn at all, for the same reason:
 *   a custom render list still drops `!isVisible`. It is switched off by
 *   `thinInstanceCount === 0` instead, which is a frame with nothing to cast.
 * - Its light is never a lighting light. `includeOnlyWithLayerMask` pins it to
 *   the proxy layer, so no `StandardMaterial` in the tree gains a term and no
 *   cel material could read it anyway.
 * - The generator renders BACK FACES ONLY. See `forceBackFacesOnly` below.
 * - The proxy mesh's own world matrix stays IDENTITY. Thin instance matrices
 *   are absolute, and Babylon's shadow path multiplies by the mesh's world
 *   under `THIN_INSTANCES` and not under plain `INSTANCES` — identity is what
 *   makes those two the same answer.
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
 * Every proxy is a thin instance of ONE unit box. A soldier is ten instances —
 * `RAGDOLL_BONES`, which is the shape of a body already measured against the
 * drawn boxes and already driven by the joints the pose drives — and a hull is
 * one, its own collider box. So the pass is one draw at 8v8 and one draw at
 * 24v24, and the CPU cost is the matrices: one multiply per instance.
 *
 * **Using `RAGDOLL_BONES` is the load-bearing choice, not a convenience.** The
 * shadow follows a crouch, a stance, a turn and a RAGDOLL for free, because
 * those boxes hang off the same joints — `RagdollSystem` reparents them onto
 * Havok proxies and the shadow goes with the corpse without this file knowing
 * physics exists. A hand-authored capsule would have been a pill that slid
 * along the ground under a walking body, which is the artefact the blob disc
 * already is.
 *
 * ## WHY BACK FACES
 *
 * A proxy box ENCLOSES the geometry it stands for, so a body's own visible
 * surfaces are inside their own caster. Recording front faces puts every one of
 * them behind the depth they are compared against, and a soldier comes out
 * uniformly in shadow — which reads as a black cut-out rather than as a bug.
 * `forceBackFacesOnly` records the FAR side of each box instead: a surface
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
import {
  type BaseTexture,
  DirectionalLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  ShadowGenerator,
  type Scene,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { RAGDOLL_BONES, type SoldierRig } from "../entities/SoldierModel";
import { ShadowWindow } from "../core/shadowWindow";
import type { CelMaterialFactory } from "../shaders/CelShader";

/**
 * The layer bit the proxy wears, and the whole of how it stays out of the
 * frame.
 *
 * A camera's default `layerMask` is `0x0FFFFFFF`, so anything at or above
 * `0x10000000` is invisible to every camera in the tree without one of them
 * having to be told. `Scene._evaluateActiveMeshes` tests it, `ObjectRenderer`
 * does NOT when it is given an explicit render list, and those two facts
 * together are the mechanism: never drawn in the world, always drawn in this
 * map.
 *
 * It is not `isVisible = false`, which would have been the obvious move and is
 * the one thing that cannot work here — a custom render list still drops an
 * invisible mesh, which is `FINDINGS.md`'s note about the untried glow
 * occluder proxy running into the same wall.
 */
const PROXY_LAYER = 0x10000000;

/** What this needs of a soldier: a rig to read joints off. `Bot` satisfies it. */
export interface ShadowBody {
  readonly rig: SoldierRig;
}

/**
 * What this needs of a vehicle: its collider box and that box's size.
 *
 * The COLLIDER and not the drawn rig, which is the same substitution the rest
 * of the game already makes for a hull — it is what a round is tested against
 * and where a body may not stand, so it is also the shape the hull throws. It
 * encloses the turret on purpose (`CONFIG.vehicles.tank.hull.height` argues
 * it), which makes it a little generous as a silhouette rather than a little
 * mean. `Vehicle` satisfies this structurally.
 */
export interface ShadowHull {
  readonly body: Mesh;
  readonly spec: {
    readonly hull: {
      readonly length: number;
      readonly width: number;
      readonly height: number;
    };
  };
}

export class BodyShadows {
  private readonly light: DirectionalLight;
  private readonly generator: ShadowGenerator;
  /** The one mesh every proxy in the game is an instance of. */
  private readonly proxy: Mesh;
  /** Thin instance matrices, packed. Never reallocated. */
  private readonly matrices: Float32Array;
  /** How many of `matrices` are live this frame. */
  private count = 0;
  /**
   * `RAGDOLL_BONES` as "unit box -> this bone's box in its joint's frame",
   * composed once at boot because none of it varies.
   */
  private readonly boneLocal: Matrix[];
  /** The joint each entry of `boneLocal` hangs off, by rig field name. */
  private readonly boneJoint: readonly (keyof SoldierRig)[];
  /** Hull scales, one per kind met, keyed on the spec's own box. */
  private readonly hullLocal = new Map<string, Matrix>();
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
  /** Scratch for the one matrix multiply per instance. */
  private readonly scratch: Matrix;
  /** Nearest-first selection scratch, reused frame to frame. See `packBodies`. */
  private readonly picked: (ShadowBody | null)[] = [];
  private readonly pickedDist: number[] = [];

  /** The bodies' depth map, for `CelMaterialFactory` and `Volumetrics`. */
  get depthMap(): BaseTexture | null {
    return this.generator.getShadowMap();
  }

  /**
   * The light's view*projection. Babylon MUTATES this in place, so a caller
   * holding it tracks the window whether it asks again or not — the same
   * caveat `ShadowSystem.lightMatrix` carries, and the same advice: re-read.
   */
  get lightMatrix(): Matrix {
    return this.generator.getTransformMatrix();
  }

  constructor(scene: Scene, mats: CelMaterialFactory) {
    const c = CONFIG.graphics.bodyShadows;
    this.light = new DirectionalLight(
      "bodyShadow",
      new Vector3(-0.3, -0.85, 0.42).normalize(),
      scene,
    );
    // The one line that keeps a second Babylon light from being a second
    // Babylon LIGHT. No mesh in the world carries PROXY_LAYER, so
    // `Light.canAffectMesh` is false for all of them and no StandardMaterial in
    // the tree gains a term or a recompile. Cel materials could not read it
    // either way — they carry their own light as uniforms — but the shadow
    // generator needs a light to define a frustum, and this is the cheapest
    // honest way to have one that shades nothing.
    this.light.includeOnlyWithLayerMask = PROXY_LAYER;
    this.light.shadowFrustumSize = c.window;
    this.light.shadowMinZ = 1;
    this.light.shadowMaxZ = c.depthRange;
    this.light.autoUpdateExtends = false;

    this.generator = new ShadowGenerator(c.mapSize, this.light);
    // Bias is consumer-side, as it is for the world map: the receiver knows its
    // own facet normal and this pass does not.
    this.generator.bias = 0;
    // See the header. Without it every soldier and every hull is drawn inside
    // its own caster and comes out black.
    this.generator.forceBackFacesOnly = true;

    this.proxy = MeshBuilder.CreateBox("bodyShadowProxy", { size: 1 }, scene);
    this.proxy.layerMask = PROXY_LAYER;
    this.proxy.isPickable = false;
    // Neither flag can be reached through the layer mask — the ink is a
    // screen-space pass over depth this never writes, and the glow layer
    // accumulates over `_activeMeshes`, which this is never in. They are here
    // because a mesh in this scene that says nothing about either is a mesh
    // somebody has to work out the answer for.
    this.proxy.metadata = { noInk: true, noGlow: true, noShadowCaster: true };
    this.proxy.isVisible = true;
    this.generator.addShadowCaster(this.proxy, false);

    // Every bone box as a transform from the unit cube, composed once. Scale
    // then translate, in the joint's own frame — which is what the table
    // means by `size` and `center`.
    this.boneLocal = RAGDOLL_BONES.map((b) =>
      Matrix.Compose(
        new Vector3(b.size[0], b.size[1], b.size[2]),
        Quaternion.Identity(),
        new Vector3(b.center[0], b.center[1], b.center[2]),
      ),
    );
    this.boneJoint = RAGDOLL_BONES.map((b) => b.joint as keyof SoldierRig);
    this.scratch = Matrix.Identity();

    const slots = c.maxBodies * this.boneLocal.length + c.maxHulls;
    this.matrices = new Float32Array(slots * 16);
    // Established once with the buffer this will keep writing into;
    // `thinInstanceBufferUpdated` is what re-uploads it. `staticBuffer` false
    // because it changes every frame.
    this.proxy.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.proxy.thinInstanceCount = 0;

    mats.setBodyShadowMap(this.generator.getShadowMap()!);
    mats.setBodyShadowParams(c.bias, c.pcfRadiusTexels / c.mapSize);
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
    this.light.direction = new Vector3(
      direction[0],
      direction[1],
      direction[2],
    ).normalize();
    this.win.invalidate();
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
    if (this.win.place(this.light, focus, c.window, c.mapSize, c.distance)) {
      mats.setBodyShadowMatrix(this.generator.getTransformMatrix());
    }

    this.count = 0;
    this.packBodies(focus, bodies);
    this.packHulls(hulls);
    this.proxy.thinInstanceCount = this.count;
    // Switched off rather than drawn empty. A render list still drops
    // `!isVisible`, so this is how a frame with nobody in the window costs the
    // clear and nothing else — and it is the one place the invariant in the
    // header is deliberately used the other way round.
    this.proxy.isVisible = this.count > 0;
    if (this.count > 0) this.proxy.thinInstanceBufferUpdated("matrix");
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
    const reach = c.window * c.window;
    const picked = this.picked;
    const dist = this.pickedDist;
    let n = 0;
    for (const body of bodies) {
      const rig = body.rig;
      // Whether the body is DRAWN, which is the only question that matters
      // here: a pooled rig nobody is wearing is switched off at the root, a
      // living bot is on, and a corpse under Havok is still on — which is what
      // makes a ragdoll's shadow follow it without this file knowing it fell.
      if (!rig.root.isEnabled()) continue;
      const p = rig.root.absolutePosition;
      const dx = p.x - focus.x;
      const dy = p.y - focus.y;
      const dz = p.z - focus.z;
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

  /** One rig's ten boxes, each at its joint's current world transform. */
  private packRig(rig: SoldierRig): void {
    for (let i = 0; i < this.boneLocal.length; i++) {
      const joint = rig[this.boneJoint[i]] as { getWorldMatrix(): Matrix };
      // `getWorldMatrix` recomputes when the node's render id is stale, which
      // in `updateSceneForCamera` it always is — the scene's id has advanced
      // since this ran last frame. So these are THIS frame's poses, including
      // for a body off screen whose meshes the render walk will never activate,
      // which is the case the volumetric march exists for.
      this.boneLocal[i].multiplyToRef(joint.getWorldMatrix(), this.scratch);
      this.scratch.copyToArray(this.matrices, this.count * 16);
      this.count++;
    }
  }

  /** One box per hull, off the collider the rest of the game already uses. */
  private packHulls(hulls: readonly ShadowHull[]): void {
    const c = CONFIG.graphics.bodyShadows;
    const cap = c.maxBodies * this.boneLocal.length + c.maxHulls;
    for (const hull of hulls) {
      if (this.count >= cap) return;
      const body = hull.body;
      if (!body.isEnabled()) continue;
      this.hullBox(hull).multiplyToRef(body.getWorldMatrix(), this.scratch);
      this.scratch.copyToArray(this.matrices, this.count * 16);
      this.count++;
    }
  }

  /**
   * The unit-box-to-hull scale for one kind, cached on the box's own
   * dimensions — which is the kind's identity without this having to ask what
   * kind it is holding. Three kinds ship and a fourth is a row in
   * `VEHICLE_KINDS`; nothing here changes for it.
   */
  private hullBox(hull: ShadowHull): Matrix {
    const h = hull.spec.hull;
    const key = `${h.width}x${h.height}x${h.length}`;
    let m = this.hullLocal.get(key);
    if (!m) {
      const pad = CONFIG.graphics.bodyShadows.hullPad;
      m = Matrix.Compose(
        new Vector3(h.width + pad, h.height + pad, h.length + pad),
        Quaternion.Identity(),
        Vector3.Zero(),
      );
      this.hullLocal.set(key, m);
    }
    return m;
  }
}
