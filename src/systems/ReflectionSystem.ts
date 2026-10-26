/**
 * ReflectionSystem.ts — The world as glass sees it: one cube map PER GLAZED
 * BLOCK, baked from the map's own geometry once per map install, and the box
 * the shader parallax-corrects the mirrored ray against.
 *
 * It is affordable for exactly one reason: the world is static, so a bake is
 * not a pass, it is a build step that happens to run on the GPU.
 *
 * **This file decides everything about the bake and OUR renderer draws it**
 * (`render/ProbeBake.ts`, `BABYLON_EXIT.md` X3.6c, X3.7c): which probes there
 * are, where each stands, what it leaves out, how far it reaches and when it
 * is released are decided here; the cubes are our renderer's, their faces
 * culled and drawn from the main pass's own world with the probe's eye
 * PASSED, and Babylon's readers (the glazing, the water) are handed a
 * wrapped view of each (`wrapCubeTexture`). There is no other bake: Babylon's
 * `ReflectionProbe`s went with X3.7c, a world our bake cannot draw being the
 * world's failure (`BlockHandover`, `Game.worldFailed`). A bake that drained
 * depends on our renderer for nothing: its cubes stand.
 *
 * Invariants:
 * - One probe per glazed BLOCK, standing at the CENTRE of the first glazing
 *   group filed under it, and every group on that block gets a material of its
 *   own carrying that probe's cube. Costs no draw call: the glazing is already
 *   one merged mesh per map block.
 * - A probe draws the map's surfaces of ours MINUS whatever encloses it — the
 *   blocks it serves, told to the cull as numbers (`exclusionOf`; read it
 *   before touching this, because a probe standing inside a tower with the
 *   tower still in the bake reflects the inside of that tower onto every
 *   window in it) — and MINUS whatever is further off than
 *   `CONFIG.graphics.reflection.radius` (to the near side of a surface's
 *   sphere, `ProbeJob.reach`), which is the only term in the bake priced on
 *   the map's SIZE rather than on its glazing. Each FACE draws only what that
 *   face can see: the cull is the face's own frustum.
 * - **The bake is SPENT over frames rather than issued in one**, and the
 *   budget is PROBES — the bake's own (`ProbeBake.perFrame`, which this asks
 *   rather than reading the config) — off its own queue (`jobs`,
 *   `releaseOurs`), released only once the bake's pipelines are built
 *   (`ProbeBake.ready`) as well as through the gate; `bakePending` counts the
 *   queue and those released and not yet recorded. The bake's view of the
 *   culls is opened with the queue and closed when the queue and the bake
 *   have drained.
 * - **And the frames it is spent over are the LOADING card's**, not the
 *   round's. `Game` holds `loading` until `bakePending` reaches 0, which is
 *   the one thing outside this file that knows the bake is spread at all. A
 *   queue that cannot drain must not hang the card, so the wait is capped at
 *   the caller's end rather than here.
 * - The queue is emptied on every install, and by `clear` when no map
 *   follows: a probe waiting its turn is a probe of a map that is gone.
 * - Nothing moves for a bake: the eye, the opaque alpha and the held clouds
 *   are the bake's own frame's (`CelMaterialFactory.fillBakeFrame`).
 * - The cubes are pooled and never destroyed, like the bot rigs
 *   (`ProbeBake.cube`), each with the wrapped view its readers sample, which
 *   is never disposed either: disposing it destroys the cube.
 * - **The DEFAULT cube is a cube of ours that nothing ever bakes**, made in
 *   the constructor before any map exists (WebGPU makes it zeroed: alpha 0,
 *   the sky) and bound only at a strength of 0 — the glazing material a pane
 *   is born with (`CelMaterialFactory.setDefaultReflection`) and the water of
 *   a build that bakes nothing. It replaced Babylon's probe 0 at X3.7c.
 * - A map with no glazing bakes no glazing probe. The default cube stays
 *   bound to the glazing material regardless.
 * - **An EDITOR build bakes nothing either**, for the reason the whole file is
 *   affordable: a bake is a build step because the world is static, and the
 *   editor is the one place it is not. See `build`.
 */
import { type BaseTexture, type Mesh, type Scene, type ShaderMaterial, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { wrapCubeTexture } from "../core/wrappedTextures";
import { Vector3 as MathVector3 } from "../math";
import type { ProbeBake, ProbeExclusion, ProbeJob } from "../render/ProbeBake";
import { blockCoordsOf, blockKey } from "../render/wgsl/clusterCull";
import type { CelMaterialFactory, CubeReflection, ProbeReflection } from "../shaders/CelShader";
import type { GameMap, PaneGroup, WorldBox } from "../world/MapBuilder";

/** A cube of ours: the view Babylon's readers sample, and the probe our bake is handed. */
interface OurProbe {
  readonly wrapped: BaseTexture;
  readonly job: ProbeJob;
}

/** The two pools a probe is in. */
type Pool = "glazing" | "water";

/** What one install bakes, as `build` and `bakeWater` planned it. */
interface InstallPlan {
  readonly map: GameMap;
  /** One glazing probe a cell: where it stands, and the blocks it serves. */
  readonly glazing: { readonly slot: number; readonly at: Vector3; readonly served: Set<string> }[];
  /** One water probe a body. */
  readonly water: { readonly slot: number; readonly at: Vector3 }[];
  /** How many blocks a side share a glazing probe (`blocksPerCell`). */
  perCell: number;
  /** Each glazing group, the material it was built with, its probe and its box. */
  readonly bases: {
    readonly group: PaneGroup;
    readonly base: ShaderMaterial;
    readonly slot: number;
    readonly boxMin: Vector3;
    readonly boxMax: Vector3;
  }[];
}

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
 * what the exclusion is for (`exclusionOf`).
 */
export class ReflectionSystem {
  /**
   * The cubes, by pool and slot (`ProbeBake.cube`, which keeps no index of
   * its own), each with the wrapped view Babylon's readers are handed
   * (`wrapCubeTexture`) and the probe as our bake is handed it. Made on first
   * use and kept for the process: a wrapped view is never disposed, since
   * disposing one destroys the texture it wraps. Grown on demand and never
   * shrunk: a map with fewer glazed blocks than the last one leaves the spare
   * cubes holding the last map's picture, which nothing samples.
   */
  private readonly pools: Record<Pool, OurProbe[]> = { glazing: [], water: [] };
  /** The cube bound at a strength of 0 before any probe claims a reader — see the header. */
  private readonly defaultCube: BaseTexture;
  /**
   * The probes waiting for a frame, oldest first, released at the bake's own
   * budget (`ProbeBake.perFrame`) — see `releaseOurs`.
   */
  private readonly jobs: ProbeJob[] = [];
  /**
   * Whether a queued probe may be released yet — see `setBakeGate`. Open by
   * default, so a caller that wires nothing bakes exactly as before.
   */
  private bakeGate: () => boolean = () => true;
  /** The bake's view of the culls has been opened and has not yet drained. */
  private oursOpen = false;
  /**
   * What this install bakes, as `build` and `bakeWater` planned it: kept so
   * the reference harness can re-bake a frozen world (`rebake`). Null for a
   * build that bakes nothing.
   */
  private plan: InstallPlan | null = null;
  /** Scratch for the box handed to the factory, which copies it. */
  private readonly boxMin = Vector3.Zero();
  private readonly boxMax = Vector3.Zero();

  constructor(
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    /** Our renderer's half of the bake: the cubes and their faces. */
    private readonly bake: ProbeBake,
  ) {
    // This frame's share of whatever bake is outstanding. It rides the render
    // targets' hook rather than a `Game.tick` call because our renderer
    // records a probe released here as the same frame's main pass begins.
    // Nothing outside this file knows the bake is spread.
    scene.onBeforeRenderTargetsRenderObservable.add(() => this.releaseOurs());
    // The default cube exists before any map does, because `MapBuilder` asks
    // for a glazing material during the build and that material has to be
    // born with a cube bound to it — see `CelMaterialFactory
    // .setDefaultReflection`. Nothing bakes into it: WebGPU makes it zeroed,
    // alpha 0 on every face and level, which is the sky — and it is only ever
    // bound at a strength of 0 (`applyReflection`), so no pixel reads it.
    this.defaultCube = wrapCubeTexture(scene, bake.cube("default").texture, "reflection default");
    this.mats.setDefaultReflection(this.defaultCube);
  }

  /**
   * Holds the queue until `gate` says the scene is worth baking. A cube is
   * baked ONCE per install and every cel surface in it reads the irradiance
   * volume, which `installMap` has just cleared: released on the first frame,
   * as the queue otherwise is, every glazing cube and water mirror froze the
   * volume's first unconverged pass for the whole round. `Game` wires it to
   * `GiVolume.converged` — injected rather than imported, the wiring rule.
   *
   * Only RELEASING waits: `bakePending` still counts the queue, so the
   * building card stays up across the wait. The release waits for the bake's
   * own pipelines too (`ProbeBake.ready`).
   */
  setBakeGate(gate: () => boolean): void {
    this.bakeGate = gate;
  }

  /**
   * How much of this install's bake has NOT happened yet, in probes: every
   * probe still in the queue, plus every probe released and not yet
   * recorded (`ProbeBake.unrecorded`).
   *
   * Read by `Game` while the building card is up and by nothing else. It
   * allocates nothing, so it is free to ask every frame.
   */
  get bakePending(): number {
    return this.jobs.length + this.bake.unrecorded;
  }

  /**
   * How many pool SLOTS this process has baked, both pools — read off the
   * pools, each grown only to bake a slot. The default cube is none of them
   * (Babylon's glazing pool counted its probe 0 as a slot until X3.7c).
   */
  get probeCount(): number {
    return this.pools.glazing.length + this.pools.water.length;
  }

  /**
   * Queues the installed map's glazing, one cube per glazed block, and hands
   * each block's mesh the material that samples its own.
   *
   * **It queues rather than bakes**, and the frames after it spend the queue —
   * see `releaseOurs`. Nothing waits on that: a pane whose probe has not
   * baked yet samples a cube that is empty, or the last map's, under the
   * building card, which no round frame draws.
   *
   * Called from `Game.installMap` for the reason every line around it is: the
   * map this bakes is the one just built, and the last one's queue is gone.
   *
   * **A build our bake holds no world for bakes nothing** — an EDITOR build,
   * and a round whose world has already failed (`BlockHandover`, which hands
   * the bake its world a line earlier in `installMap`). A pane keeps the
   * glazing material `MapBuilder` gave it, born holding the default cube at a
   * strength of ZERO (`CelMaterialFactory.applyReflection`), so it shows the
   * analytic sky half of the reflection and no more.
   *
   * **Editor builds bake nothing**, which is the same refusal
   * `PhysicsWorld.setMap` makes one line below it in `installMap` and for a
   * sharper version of the same reason. A bake is affordable because the
   * world is static, so it is a BUILD STEP rather than a pass — and the editor
   * is the one place in the game where the world is not static and a build is
   * not rare. Every tier-3 rebuild would pay for one, and an editor build is
   * Babylon's whole, which our bake does not draw. That is the state a pane
   * is in before any probe has claimed it rather than a new one, and it is
   * the right trade in a view that already strips the map's own night back to
   * a work light to author under.
   */
  build(map: GameMap, editor: boolean): void {
    const cfg = CONFIG.graphics.reflection;
    // Empty the queue first: a probe left over from the last install is a
    // probe of a map that is gone. Above the return, so the editor's build
    // empties the round's it was opened from.
    this.clear();
    if (editor || !this.bake.holds) return;
    this.plan = { map, glazing: [], water: [], perCell: 1, bases: [] };
    if (map.paneGroups.length === 0) return;

    // The lid of every probe's box: the tallest thing standing on the map. The
    // walls are the map's own boundary and the floor is per probe, because the
    // ground under one is the only part of that box a map's terrain moves.
    let roof = 0;
    for (const b of map.colliderBoxes) roof = Math.max(roof, top(b));
    const half = map.size / 2;

    const started = performance.now();
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
    //
    // **`perCell` is 1 on every map in the tree and the grouping below is a
    // ceiling rather than a lever** — see `blocksPerCell`, and
    // `CONFIG.graphics.reflection.poolBudgetMiB` for what it protects.
    const perCell = blocksPerCell(map.paneGroups, probeCap(cfg.size, cfg.poolBudgetMiB));
    this.plan.perCell = perCell;

    // Slots are assigned in one pass and FILLED in the next, because a probe
    // has to leave out every block that probe serves and only the last group
    // on a cell says which those are. At `perCell` 1 that set is the one block
    // it has always been.
    const slots = new Map<string, number>();
    const glazing = this.plan.glazing;
    const slotOf: number[] = [];
    for (const group of map.paneGroups) {
      const key = cellKey(group.block, perCell);
      let slot = slots.get(key);
      if (slot === undefined) {
        slot = slots.size;
        slots.set(key, slot);
        const at = Vector3.Zero();
        centreOf(group.mesh, at);
        glazing.push({ slot, at, served: new Set() });
      }
      glazing[slot].served.add(group.block);
      slotOf.push(slot);
    }

    this.queueGlazing(this.plan);

    for (let i = 0; i < map.paneGroups.length; i++) {
      const group = map.paneGroups[i];
      const slot = slotOf[i];
      const at = glazing[slot].at;
      const floor = map.terrain.surfaceAt(at.x, at.z, true);
      // The box per GROUP, each its own.
      const boxMin = new Vector3(-half, floor, -half);
      const boxMax = new Vector3(half, Math.max(roof, floor + 1), half);
      const base = group.mesh.material as ShaderMaterial | null;
      if (base) this.plan.bases.push({ group, base, slot, boxMin, boxMax });
    }
    this.pointGlazing(this.plan);

    if (import.meta.env.DEV) {
      console.info(
        `[reflection] ${slots.size} probes for ${map.paneGroups.length} ` +
          `glazing groups (${perCell} block${perCell === 1 ? "" : "s"} each), ` +
          `queued in ${(performance.now() - started).toFixed(1)} ms`,
      );
    }
  }

  /**
   * Empties the bake queue and closes the bake's view of the culls: the
   * state before any map was built. The top of `build`, and
   * `Game.teardownMap` on its own when no map follows — the menu, which
   * stands on a photograph.
   *
   * The WHOLE queue, water included: a queued probe is one of a map the
   * caller has just disposed. On an install the water pool is queued again
   * later (`bakeWater`, from inside `WaterSystem.build`), which is what makes
   * emptying everything here safe rather than merely convenient.
   */
  clear(): void {
    this.jobs.length = 0;
    this.closeOurs();
    this.plan = null;
  }

  /**
   * Bakes what the map's WATER reflects — one cube per body, taken from a
   * point on that body's own surface — and hands back one `CubeReflection`
   * per site, in the order the sites arrived.
   *
   * **A separate pool from the glazing's, and the reason is not tidiness.**
   * The two are baked at different moments of `installMap`: the glazing's
   * comes off `map.paneGroups` the line after the shadow casters do, and the
   * water's cannot run until `WaterSystem` has worked out where its bodies
   * actually are — which it only knows after baking their bed depth. Sharing
   * one pool would make the water's slots a function of how many glazed blocks
   * this map happens to have.
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
   * A build that bakes nothing (an editor's, `build`) returns sites at
   * strength 0 on the default cube, which leaves the water showing the
   * analytic sky half of its mirror.
   */
  bakeWater(sites: readonly Vector3[], map: GameMap, editor: boolean): CubeReflection[] {
    const cfg = CONFIG.graphics.reflection;
    if (sites.length === 0) return [];

    // Every material still needs a cube BOUND, or its sampler reads whatever
    // texture unit the last draw left there: the default cube, which is what
    // a strength of 0 returns.
    if (editor || !this.plan || this.plan.map !== map) {
      return sites.map((site) => ({ cube: this.defaultCube, at: site, strength: 0 }));
    }
    const plan = this.plan;

    const started = performance.now();
    for (let slot = 0; slot < sites.length; slot++) {
      // Lifted clear of the surface it is a mirror of. On the plane exactly is
      // where a planar reflection would be taken from, but a probe there is
      // also in the mist, in the grass and a hair off the bed — half a metre
      // buys the six faces a clean view and moves the parallax by less than
      // the chop already does.
      const at = sites[slot].clone();
      at.y += 0.5;
      plan.water.push({ slot, at });
    }
    this.queueWater(plan);
    const out = plan.water.map((w) => ({
      cube: this.cubeOf("water", w.slot).wrapped,
      at: w.at,
      strength: cfg.strength,
    }));

    if (import.meta.env.DEV) {
      console.info(
        `[reflection] ${sites.length} water probes queued in ${(performance.now() - started).toFixed(1)} ms`,
      );
    }
    return out;
  }

  /**
   * Queues every probe of this install AGAIN: what the reference harness asks
   * of a frozen world (`plans/webgpu-ref/harness.mjs`, `freeze`), whose cubes
   * were baked before its clocks were pinned. It drains as an install's bake
   * does — `bakePending` says when.
   */
  rebake(): void {
    const plan = this.plan;
    if (!plan) return;
    this.jobs.length = 0;
    this.queueGlazing(plan);
    this.queueWater(plan);
  }

  /**
   * The glazing's probes of `plan` queued. Two subtractions answering
   * different questions: the exclusion takes out the building the probe is
   * STANDING IN, and the radius takes out the city it could not see the far
   * side of — both the cull's, told as numbers (`exclusionOf`,
   * `ProbeJob.reach`). Neither is a distance test standing in for the other —
   * see `exclusionOf` on why the enclosure stopped being one. A SCATTER
   * instance is reached by its own sphere.
   */
  private queueGlazing(plan: InstallPlan): void {
    for (const g of plan.glazing) {
      this.jobs.push(this.probeOf("glazing", g.slot, g.at, exclusionOf(g.served, plan.perCell)));
    }
    if (plan.glazing.length > 0) this.openOurs();
  }

  /**
   * The water's probes of `plan` queued. Water has no block and so excludes
   * nothing: not one structure comes out of its bake, which is what a mirror
   * lying in the open is owed. The RADIUS still applies, for the reason it
   * applies to the glazing: what a pond is owed is the world around it rather
   * than the world entire, and on every map that has water the two are the
   * same.
   */
  private queueWater(plan: InstallPlan): void {
    for (const w of plan.water) this.jobs.push(this.probeOf("water", w.slot, w.at, null));
    if (plan.water.length > 0) this.openOurs();
  }

  /** Every glazing group of `plan` handed the material sampling its slot's cube. */
  private pointGlazing(plan: InstallPlan): void {
    const strength = CONFIG.graphics.reflection.strength;
    for (const { group, base, slot, boxMin, boxMax } of plan.bases) {
      this.boxMin.copyFrom(boxMin);
      this.boxMax.copyFrom(boxMax);
      const refl: ProbeReflection = {
        cube: this.cubeOf("glazing", slot).wrapped,
        boxMin: this.boxMin,
        boxMax: this.boxMax,
        at: plan.glazing[slot].at,
        strength,
      };
      group.mesh.material = this.mats.glassProbe(base, slot, refl);
    }
  }

  /** The bake opened: its view of the culls built for the queue (`ProbeBake.open`). */
  private openOurs(): void {
    this.oursOpen = true;
    this.bake.open();
  }

  /** The bake closed: the queue drained, or the install gone. */
  private closeOurs(): void {
    if (!this.oursOpen) return;
    this.oursOpen = false;
    this.bake.close();
  }

  /**
   * This frame's share of the outstanding bake: up to the bake's own budget
   * (`ProbeBake.perFrame`) released, oldest first, as the gate and the bake's
   * pipelines allow — and, once the queue and the bake have both drained,
   * the bake closed, its view of the culls dropped. Released here, our bake
   * records them as this frame's main pass begins (`ProbeBake`), a frame
   * after the last one's submit, so closing here frees nothing a recorded
   * frame still holds.
   *
   * **The budget is PROBES and not draws**, because what a face costs is a
   * cull and a pass over the survivors rather than a draw per mesh: a probe
   * is six of them and its mips, whatever it reaches.
   */
  private releaseOurs(): void {
    if (!this.oursOpen) return;
    const jobs = this.jobs;
    if (jobs.length === 0) {
      if (this.bake.unrecorded === 0) this.closeOurs();
      return;
    }
    if (!this.bakeGate() || !this.bake.ready) return;
    const room = this.bake.perFrame - this.bake.unrecorded;
    const camera = this.scene.activeCamera;
    let taken = 0;
    for (; taken < room && taken < jobs.length; taken++) {
      const job = jobs[taken];
      // The camera's planes, which Babylon's probe projected each face with
      // on the frame it baked, and ours keeps.
      job.near = camera?.minZ ?? 1;
      job.far = camera?.maxZ ?? 10000;
      this.bake.release(job);
    }
    jobs.splice(0, taken);
  }

  /** The probe in `pool`'s `slot`, standing at `at` and leaving out `exclude`, re-pointed for this install. */
  private probeOf(pool: Pool, slot: number, at: Vector3, exclude: ProbeExclusion | null): ProbeJob {
    const job = this.cubeOf(pool, slot).job;
    job.eye.set(at.x, at.y, at.z);
    job.reach = CONFIG.graphics.reflection.radius;
    job.exclude = exclude;
    return job;
  }

  /** The cube in `pool`'s `slot`, made on first use with its wrapped view and its probe. */
  private cubeOf(pool: Pool, slot: number): OurProbe {
    const slots = this.pools[pool];
    // Grown to the slot.
    while (slots.length <= slot) {
      const name = `${pool} ${slots.length}`;
      const cube = this.bake.cube(name);
      slots.push({
        wrapped: wrapCubeTexture(this.scene, cube.texture, `reflection ${name}`),
        job: {
          cube,
          eye: new MathVector3(),
          near: 1,
          far: 10000,
          reach: CONFIG.graphics.reflection.radius,
          exclude: null,
        },
      });
    }
    return slots[slot];
  }
}

/**
 * How many probes `CONFIG.graphics.reflection.poolBudgetMiB` pays for at this
 * face size.
 *
 * A probe is six faces of RGBA8 plus a full mip chain — `6 * size^2 * 4 * 4/3`
 * bytes, which is exactly 512 KiB at the shipped 128 — and the pool is never
 * destroyed, so this bounds a figure held for the PROCESS rather than for a
 * round.
 */
function probeCap(size: number, budgetMiB: number): number {
  const bytes = 6 * size * size * 4 * (4 / 3);
  return Math.max(1, Math.floor((budgetMiB * 1024 * 1024) / bytes));
}

/**
 * How many map blocks share one probe: 1, then 2, then 4, doubling until the
 * probe count fits the pool budget.
 *
 * **It is 1 on every map in the tree**, and the sentence to read before
 * changing that is the one `exclusionOf` ends on: a probe drops every block it
 * serves out of its own bake, so a cell of four blocks is a probe with 96 m of
 * city missing from the middle of its cube. That is a bad picture, and it is
 * still a better one than a device loss — which is what a map with 770 glazed
 * blocks costs instead (`ENGINE_UPGRADE.md` S0 and its walls).
 *
 * The doubling is over the block GRID rather than over metres, so the cells
 * nest exactly and a group cannot land in two of them. A block key that does
 * not parse — the editor's, which keys per placement — is its own cell, and
 * the loop bails rather than spinning: an editor build bakes nothing anyway.
 */
function blocksPerCell(groups: readonly PaneGroup[], cap: number): number {
  const blocks = new Set(groups.map((g) => g.block));
  let per = 1;
  while (per < 512) {
    const cells = per === 1 ? blocks : new Set([...blocks].map((k) => cellKey(k, per)));
    if (cells.size <= cap) return per;
    per *= 2;
  }
  return per;
}

/**
 * The probe cell a block belongs to. `perCell` 1 is the block itself, which is
 * the identity every map in the tree takes, and is why nothing about a shipped
 * bake moves.
 *
 * `PaneGroup.block` is `"bx,bz"` off `BlockMerge`'s own grid (whose side is the
 * map's — see `MapLayout.blockSize`, and `BLOCK_SIZE` for the default), and it
 * is parsed rather than recomputed from a
 * position for the reason `ReflectionSystem` asks for the key at all: two
 * groups are the same building because the merge said so, not because their
 * centres are close. A key that is not a pair of integers is its own cell.
 */
function cellKey(block: string, perCell: number): string {
  if (perCell === 1) return block;
  const at = blockCoordsOf(block);
  if (!at) return block;
  return `${Math.floor(at[0] / perCell)},${Math.floor(at[1] / perCell)}`;
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
 * The blocks a glazing probe serving `served` leaves out of its own bake — the
 * STRUCTURES the probe is standing in, the geometry that has to come out of
 * the bake or the cube is a picture of a wall — as our renderer's cull is told
 * them (`ProbeExclusion`): the cell they share at `perCell`, and each of them a
 * bit of it.
 *
 * **It asks the block key, and that is the whole of it.** This used to be a
 * bounding-box containment test, and it worked because the opaque world was
 * merged per block per COLOUR: a colour that appeared once appeared in a mesh
 * of its own, so "inside its box" picked out one to five small meshes of the
 * probe's own building. The albedo palette took the colour out of that merge
 * key (`mergeByMaterial`), which left the smallest thing a box test could
 * remove at one whole merge block — 48 m on every shipped map, and wider on a
 * map that states its own `blockSize` — and a box test cannot tell a tower's
 * probe standing in its own shaft from a water probe floating in open marsh
 * inside the same block's extent. Greyfen's marsh is what that cost: one
 * exclusion, but the one was the near treeline, and the water reflected sky
 * where the jungle should be.
 *
 * So the question is asked of the thing that actually knows. `PaneBlocks` and
 * `BlockMerge` file under the SAME key, so a glazing group and the world it is
 * glazed onto agree on which building they are without measuring anything —
 * the argument `PaneGroup.block` already makes for baking one cube per block
 * rather than per group, used a second time — and the cull reads a surface's
 * block off its record (`WorldSurface.block`, and for a scatter instance the
 * REGION its copy was merged under, `ScatterSet.blocks`). A probe with no
 * block — every water probe — excludes nothing (null), which is correct
 * rather than merely convenient: a probe lifted half a metre off open water is
 * not inside anything. The terrain patches, the roads and the valley rim are
 * not block-merged, so they carry no key and can never match one.
 *
 * **It takes a SET because a probe may serve more than one block**, which is
 * what `blocksPerCell` does past the pool budget, and every block a probe
 * serves has to come out: the probe stands at one of them and the set is the
 * only honest statement of which. On every map in the tree the set holds one
 * key. A key that is not a pair of integers (an editor's, which bakes nothing)
 * leaves nothing out. **A cell of more than 32 blocks (`perCell` 6 and up,
 * which nothing in the tree reaches) leaves out the WHOLE cell**, served or
 * not: every bit is set here, and the cull drops a block past the 32nd
 * whatever the bits say (`probeExcludes`) — one rule, stated on both sides.
 */
function exclusionOf(served: ReadonlySet<string>, perCell: number): ProbeExclusion | null {
  let cell = -1;
  let bits = 0;
  for (const key of served) {
    const at = blockCoordsOf(key);
    if (!at) return null;
    const cx = Math.floor(at[0] / perCell);
    const cz = Math.floor(at[1] / perCell);
    cell = blockKey(cx, cz);
    bits = (bits | (1 << (at[0] - cx * perCell + (at[1] - cz * perCell) * perCell))) >>> 0;
  }
  if (cell < 0) return null;
  return { cell, perCell, served: perCell * perCell > 32 ? 0xffffffff : bits };
}
