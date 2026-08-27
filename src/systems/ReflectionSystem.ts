/**
 * ReflectionSystem.ts — The world as glass sees it: one cube map PER GLAZED
 * BLOCK, baked from the map's own geometry once per map install, and the box
 * the shader parallax-corrects the mirrored ray against.
 *
 * The only render target in the game besides the shadow map, and the only
 * thing in the renderer that draws the world again. It is affordable for
 * exactly one reason: the world is static, so a bake is not a pass, it is a
 * build step that happens to run on the GPU.
 *
 * Invariants:
 * - One probe per `GameMap.paneGroups` entry, standing at the CENTRE of that
 *   group's own glazing, and the group's mesh gets a material of its own
 *   carrying that probe's cube. Costs no draw call: the glazing is already one
 *   merged mesh per map block.
 * - A probe's render list is the map's opaque visuals MINUS whatever encloses
 *   it — see `encloses`, and read it before touching this, because a probe
 *   standing inside a tower with the tower still in the bake reflects the
 *   inside of that tower onto every window in it.
 * - The renderList must be replaced on every install, before the next frame:
 *   last build's meshes are disposed by then, exactly as for
 *   `ShadowSystem.setCasters`.
 * - The bake renders the world from the probe, so the cel materials' eye is
 *   moved for it and put back around the whole render-target block — never
 *   per probe, or 37 bakes are 37 chances to put it back wrong.
 * - Probes are pooled and never disposed, like the bot rigs: a `ReflectionProbe`
 *   is six scene uniform buffers and a cube, and a round is not the place to
 *   build one.
 * - A map with no glazing bakes nothing. The default cube stays bound to the
 *   glazing material regardless; see `CelMaterialFactory.setDefaultReflection`.
 * - **An EDITOR build bakes nothing either**, for the reason the whole file is
 *   affordable: a bake is a build step because the world is static, and the
 *   editor is the one place it is not. See `build`.
 */
import {
  Color4,
  type Mesh,
  ReflectionProbe,
  RenderTargetTexture,
  type Scene,
  type ShaderMaterial,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type {
  CelMaterialFactory,
  CubeReflection,
  ProbeReflection,
} from "../shaders/CelShader";
import type { GameMap, WorldBox } from "../world/MapBuilder";

/**
 * A cube per glazed block, and why the count is what it is.
 *
 * **One cube for the whole map cannot show the building opposite**, which is
 * the only thing a reflection in a city is really made of. A pane returns what
 * lies in the mirrored direction, and a bake taken 150 m away has the right
 * city in it seen from the wrong place — the tower across the street lands in
 * the pane at the angle it subtends from the middle of the map. That was the
 * first version of this file, and it was a decal with parallax on it.
 *
 * **A cube per PANE is the other end and is not on offer**: Coldharbour draws
 * 6,139 sheets. What makes a middle affordable is that the glazing is already
 * merged into one mesh per map block — 37 of them — so one probe per merged
 * mesh costs 40 cubes and not one extra draw call. A probe then stands within
 * ~25 m of every pane it serves rather than ~150, and the building opposite is
 * genuinely in its cube.
 *
 * **The probe stands at the centre of the glass it serves**, which puts it
 * inside the shaft of a tower's wrap-around curtain wall and exactly ON the
 * plane of a flat shopfront. Both are right, for the same reason: a pane only
 * ever reflects the hemisphere in front of it, so what matters is that the
 * probe sees OUT in every direction its own panes face. For the shopfront that
 * is free — the office behind it is behind the probe too. For the tower it is
 * what `encloses` is for.
 */
export class ReflectionSystem {
  /**
   * The probe pool, indexed by slot. Grown on demand and never shrunk: a map
   * with fewer glazed blocks than the last one leaves the spare probes parked
   * with an empty render list, which costs a refresh-counter check a frame.
   */
  private readonly probes: ReflectionProbe[] = [];
  /**
   * The WATER pool, indexed by body. Held apart from the glazing's for the
   * reason `bakeWater` states: the two are baked at different moments of one
   * install, and `build` parks everything it owns on the way in.
   */
  private readonly waterProbes: ReflectionProbe[] = [];
  /** Scratch for the box handed to the factory, which copies it. */
  private readonly boxMin = Vector3.Zero();
  private readonly boxMax = Vector3.Zero();
  /** The eye the cel materials held before the render targets ran. */
  private readonly savedEye = Vector3.Zero();

  constructor(
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
  ) {
    // The eye is borrowed around the whole render-target block rather than
    // around each probe. Every cel material fogs and rims against `camPos`, so
    // a bake has to move it — and putting it back is then ONE restore for
    // however many probes ran, instead of a pair of hooks per probe that have
    // to agree with each other. The shadow map renders in this window too and
    // does not care: a depth pass reads no eye.
    //
    // Both are guarded walks (`updateCamera` skips a still camera), so on the
    // thousands of frames that bake nothing this is a vector copy and a
    // comparison.
    scene.onBeforeRenderTargetsRenderObservable.add(() => {
      this.mats.readEye(this.savedEye);
    });
    scene.onAfterRenderTargetsRenderObservable.add(() => {
      this.mats.updateCamera(this.savedEye);
    });
    // Probe 0 exists before any map does, because `MapBuilder` asks for a
    // glazing material during the build and that material has to be born with
    // a cube bound to it — see `CelMaterialFactory.setDefaultReflection`.
    this.mats.setDefaultReflection(this.probeAt(0).cubeTexture);
  }

  /**
   * Bakes the installed map's glazing, one cube per glazed block, and hands
   * each block's mesh the material that samples its own.
   *
   * Called from `Game.installMap` for the reason every line around it is: the
   * meshes this holds are the ones the next build disposes.
   *
   * **Editor builds park the probes and bake nothing**, which is the same
   * refusal `PhysicsWorld.setMap` makes one line below it in `installMap` and
   * for a sharper version of the same reason. A bake is affordable because the
   * world is static, so it is a BUILD STEP rather than a pass — and the editor
   * is the one place in the game where the world is not static and a build is
   * not rare. Every tier-3 rebuild pays for one, and an editor build makes it
   * worse from both ends: `PaneBlocks` keys per PLACEMENT there, so
   * Coldharbour's 40 glazed blocks become 82, and the render list is the
   * unmerged visuals. Measured on Coldharbour: 40 probes over 405 meshes in a
   * round against 82 over 610 in the editor, which is one frame of ~300,000
   * draw calls after every param edit, add, delete or brush stroke. With this
   * skip the same frame issues ~500, and the steady editor frame — ~420 draws,
   * all of them the shadow map and the main pass — is unchanged either way,
   * because a parked probe renders nothing.
   *
   * What the editor gives up is the city in its glass: a pane keeps the
   * glazing material `MapBuilder` gave it, which is born holding the default
   * cube at a strength of ZERO (`CelMaterialFactory.applyReflection`), so it
   * shows the analytic sky half of the reflection and no more. That is the
   * state a pane is in before any probe has claimed it rather than a new one,
   * and it is the right trade in a view that already strips the map's own
   * night back to a work light to author under.
   */
  build(map: GameMap, editor: boolean): void {
    const cfg = CONFIG.graphics.reflection;
    // Park everything first. A render list surviving into the next install is
    // a list of disposed meshes, and the probes this map does not reach never
    // get another one. This is what the editor's skip below leans on: it is
    // above the return, so a probe left over from the round the editor was
    // opened from is emptied rather than left holding a disposed map.
    for (const probe of this.probes) probe.cubeTexture.renderList = [];
    if (editor || map.paneGroups.length === 0) return;

    const opaque = opaqueWorld(map);

    // The lid of every probe's box: the tallest thing standing on the map. The
    // walls are the map's own boundary and the floor is per probe, because the
    // ground under one is the only part of that box a map's terrain moves.
    let roof = 0;
    for (const b of map.colliderBoxes) roof = Math.max(roof, top(b));
    const half = map.size / 2;

    const started = performance.now();
    let enclosing = 0;
    // **One probe per BLOCK, not per group.** A block's glazing arrives here as
    // one merged mesh per MATERIAL — two of them for any building that glazes
    // in more than one, which `backed` glazing (see `Build.pane`) made ordinary
    // — and a cube is a picture of the STREET rather than of the sheet, so
    // every group on a block wants the same one. Baking a second would spend
    // six more face renders on the same view from a few metres over, and it
    // would make what a map install costs a function of how many kinds of
    // glazing a builder reached for.
    //
    // `PaneGroup.block` is the merge's own key rather than a distance test:
    // "the same building" is a thing `PaneBlocks` already decided, and asking
    // it is exact where measuring between two centres — a tower's is the middle
    // of its shaft, a shopfront's is on the pavement — has to guess.
    const slots = new Map<string, number>();
    for (const group of map.paneGroups) {
      let slot = slots.get(group.block);
      const fresh = slot === undefined;
      if (slot === undefined) {
        slot = slots.size;
        slots.set(group.block, slot);
      }
      const probe = this.probeAt(slot);
      if (fresh) {
        centreOf(group.mesh, probe.position);
        const list = opaque.filter((m) => !encloses(m, group.block));
        enclosing += opaque.length - list.length;
        probe.cubeTexture.renderList = list;
        probe.cubeTexture.resetRefreshCounter();
      }

      const floor = map.terrain.surfaceAt(
        probe.position.x,
        probe.position.z,
        true,
      );
      this.boxMin.copyFromFloats(-half, floor, -half);
      this.boxMax.copyFromFloats(half, Math.max(roof, floor + 1), half);
      const base = group.mesh.material as ShaderMaterial | null;
      if (base) {
        const refl: ProbeReflection = {
          cube: probe.cubeTexture,
          boxMin: this.boxMin,
          boxMax: this.boxMax,
          at: probe.position,
          strength: cfg.strength,
        };
        group.mesh.material = this.mats.glassProbe(base, slot, refl);
      }
    }

    if (import.meta.env.DEV) {
      const n = slots.size;
      console.info(
        `[reflection] ${n} probes for ${map.paneGroups.length} glazing groups ` +
          `over ${opaque.length} meshes ` +
          `(${(enclosing / Math.max(n, 1)).toFixed(1)} enclosing each) queued ` +
          `in ${(performance.now() - started).toFixed(1)} ms`,
      );
    }
  }

  /**
   * Bakes what the map's WATER reflects — one cube per body, taken from a
   * point on that body's own surface — and hands back one `ProbeReflection`
   * per site, in the order the sites arrived.
   *
   * **A separate pool from the glazing's, and the reason is not tidiness.**
   * The two are baked at different moments of `installMap`: the glazing's
   * comes off `map.visuals` the line after the shadow casters do, and the
   * water's cannot run until `WaterSystem` has worked out where its bodies
   * actually are — which it only knows after baking their bed depth. Sharing
   * one pool would make the water's slots a function of how many glazed blocks
   * this map happens to have, and `build` parks every probe it owns on the way
   * in, so a shared pool would have to know not to park the ones the second
   * pass is about to want.
   *
   * **A cube is a defensible mirror for water for a reason that does not hold
   * for a wall.** A vertical pane returns the hemisphere in front of it and a
   * player walks ALONG it, which is what the parallax correction is for; a
   * horizontal surface returns the hemisphere above it, and what a player does
   * to a pond is walk AROUND it, which moves the mirrored ray far less. What
   * sells it beyond that is that the ray is bent by centimetres of chop before
   * it is ever sampled, so what comes back is read as motion and colour rather
   * than as a picture — the same trade the glazing makes, with a bigger margin.
   *
   * **One probe per RECT, and a rect is not where the water is.** Greyfen's
   * flood is a single 250 m rect of which 11% is wet, so the site is not the
   * rect's centre: `WaterSystem` hands over the centroid of the WET cells it
   * found while baking that body's depth map, which is a point in the water on
   * every map shipped. A body that genuinely spanned two basins would want two
   * probes, and the layout would say so by cutting two rects.
   *
   * Editor builds park the probes and return sites at strength 0, which is the
   * same refusal `build` makes above and leaves the water showing the analytic
   * sky half of its mirror. A bake is a build step because the world is static,
   * and the editor is the one place it is not.
   */
  bakeWater(
    sites: readonly Vector3[],
    map: GameMap,
    editor: boolean,
  ): CubeReflection[] {
    const cfg = CONFIG.graphics.reflection;
    // Park first, for the reason `build` does: a render list surviving into
    // the next install is a list of disposed meshes.
    for (const probe of this.waterProbes) probe.cubeTexture.renderList = [];
    if (sites.length === 0) return [];

    // No box: the water samples the cube at infinite distance and states why
    // in `celProbeBox`. Nothing here is per-site except the probe itself.
    const opaque = editor ? [] : opaqueWorld(map);

    const started = performance.now();
    const out = sites.map((site, slot) => {
      // Every material still needs a cube BOUND, or its sampler reads whatever
      // texture unit the last draw left there. Probe 0 of the glazing pool is
      // the one that exists before any map does — the cube
      // `setDefaultReflection` publishes — so it is what a strength of 0
      // returns.
      if (editor) {
        return { cube: this.probeAt(0).cubeTexture, at: site, strength: 0 };
      }
      const probe = this.waterProbeAt(slot);
      // Lifted clear of the surface it is a mirror of. On the plane exactly is
      // where a planar reflection would be taken from, but a probe there is
      // also in the mist, in the grass and a hair off the bed — half a metre
      // buys the six faces a clean view and moves the parallax by less than
      // the chop already does.
      probe.position.copyFrom(site);
      probe.position.y += 0.5;
      // Water has no block and so excludes nothing: the whole map stays in the
      // cube, which is what a mirror lying in the open is owed.
      probe.cubeTexture.renderList = opaque.slice();
      probe.cubeTexture.resetRefreshCounter();
      return {
        cube: probe.cubeTexture,
        at: probe.position,
        strength: cfg.strength,
      };
    });

    if (import.meta.env.DEV && !editor) {
      console.info(
        `[reflection] ${sites.length} water probes over ${opaque.length} ` +
          `meshes queued in ${(performance.now() - started).toFixed(1)} ms`,
      );
    }
    return out;
  }

  /** The water probe in a slot, built on first use and kept for the process. */
  private waterProbeAt(slot: number): ReflectionProbe {
    const standing = this.waterProbes[slot];
    if (standing) return standing;
    const probe = this.newProbe(`water-reflection-${slot}`);
    this.waterProbes[slot] = probe;
    return probe;
  }

  /** The glazing probe in a slot, built on first use and kept for the process. */
  private probeAt(slot: number): ReflectionProbe {
    const standing = this.probes[slot];
    if (standing) return standing;
    const probe = this.newProbe(`world-reflection-${slot}`);
    this.probes[slot] = probe;
    return probe;
  }

  /**
   * A probe, set up the one way every probe in the game is set up. Both pools
   * mint through here so a change to the clear colour, the refresh rate or the
   * eye hook cannot land on one kind of mirror and miss the other.
   */
  private newProbe(name: string): ReflectionProbe {
    const probe = new ReflectionProbe(
      name,
      CONFIG.graphics.reflection.size,
      this.scene,
    );
    const rtt = probe.cubeTexture;
    // Transparent black, and the alpha is the load-bearing half: it is how the
    // shader tells the city from the sky above it. Everything drawn here is a
    // cel material, and every cel variant but the glazing writes alpha 1.
    rtt.clearColor = new Color4(0, 0, 0, 0);
    // The world is static, so a bake is not a per-frame cost at all. `build` is
    // the only thing that ever asks for another one.
    rtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    rtt.renderList = [];
    // A ReflectionProbe registers itself with the scene but nothing renders it:
    // Babylon collects render targets off the materials it finds on active
    // meshes, and these are bound to ShaderMaterials by hand. So they are
    // custom targets, which is also what puts them before the main pass.
    this.scene.customRenderTargets.push(rtt);
    // Per face, and cheap: `updateCamera` guards on the position, so the six
    // faces of one probe cost one walk of the material cache between them.
    rtt.onBeforeRenderObservable.add(() => {
      this.mats.updateCamera(probe.position);
    });
    return probe;
  }
}

/**
 * The world a probe draws: `visuals` minus the glazing merged into it, and
 * minus every ink twin.
 *
 * A pane in a bake is a blended draw over a transparent clear, and what comes
 * back is a colour already multiplied by an alpha the shader divides out
 * again. It is the same list for both kinds of mirror — a pond has no more
 * business reflecting a window's own reflection than a window does.
 *
 * **An ink twin is an INVERTED HULL, and a probe stands INSIDE it.** That is
 * the fourth way a cube goes flat and it is the loudest of them. The twin is an
 * expanded copy drawn with its front faces culled, which is a thin line from
 * outside and a room with no way out from within: a probe parked against a
 * tower's glass is inside its own block's hull, so all six faces come back one
 * flat ink colour and the glazing reflects a grey card. Measured on
 * Coldharbour's curtain wall — 85% of the frame's pixels wrong, mean 36/255 —
 * and the same test with the twins dropped from the lists is a skyline again.
 *
 * `noReflect` and not a material-name test, because what disqualifies a mesh
 * here is what it IS rather than what it is painted with — see the metadata
 * contract in `CLAUDE.md`, which this is the seventh flag of.
 */
function opaqueWorld(map: GameMap): Mesh[] {
  const panes = new Set(map.paneGroups.map((g) => g.mesh));
  return map.visuals.filter(
    (m) => !panes.has(m) && m.metadata?.noReflect !== true,
  );
}

/** A box's top face. `rotX` is ignored: nothing that carries one is a room. */
function top(b: WorldBox): number {
  return b.cy + b.h / 2;
}

/** The centre of a mesh's world bounding box, into `out`. */
function centreOf(mesh: Mesh, out: Vector3): Vector3 {
  const box = mesh.getBoundingInfo().boundingBox;
  return box.minimumWorld.addToRef(box.maximumWorld, out).scaleInPlace(0.5);
}

/**
 * Whether this mesh is the STRUCTURE the probe is standing in — the geometry
 * that has to come out of the bake, or the cube is a picture of a wall.
 *
 * **It asks the block key, and that is the whole of it.** This used to be a
 * bounding-box containment test, and it worked because the opaque world was
 * merged per block per COLOUR: a colour that appeared once appeared in a mesh
 * of its own, so "inside its box" picked out one to five small meshes of the
 * probe's own building. The albedo palette took the colour out of that merge
 * key (`MapBuilder.mergeByMaterial`), which left the smallest thing a box test
 * could remove at one whole 48 m block — and a box test cannot tell a tower's
 * probe standing in its own shaft from a water probe floating in open marsh
 * inside the same block's extent. Greyfen's marsh is what that cost: one
 * exclusion, but the one was the near treeline, and the water reflected sky
 * where the jungle should be.
 *
 * So the question is asked of the thing that actually knows. `PaneBlocks` and
 * `BlockMerge` file under the SAME key, so a glazing group and the world it is
 * glazed onto agree on which building they are without measuring anything —
 * the argument `PaneGroup.block` already makes for baking one cube per block
 * rather than per group, used a second time. A probe with no block — every
 * water probe — excludes nothing, which is correct rather than merely
 * convenient: a probe lifted half a metre off open water is not inside
 * anything.
 *
 * The old rule that a flat receiver is never an enclosure is now kept by
 * construction and needs no test: the terrain patches, the roads and the valley
 * rim are not block-merged, so they carry no key and can never match one.
 */
function encloses(mesh: Mesh, block: string): boolean {
  return block !== "" && mesh.metadata?.block === block;
}
