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
 * - One probe per glazed BLOCK, standing at the CENTRE of the first glazing
 *   group filed under it, and every group on that block gets a material of its
 *   own carrying that probe's cube. Costs no draw call: the glazing is already
 *   one merged mesh per map block.
 * - A probe's render list is the map's opaque visuals MINUS whatever encloses
 *   it — see `encloses`, and read it before touching this, because a probe
 *   standing inside a tower with the tower still in the bake reflects the
 *   inside of that tower onto every window in it — and MINUS whatever is
 *   further off than `CONFIG.graphics.reflection.radius`, which is the only
 *   term in the bake priced on the map's SIZE rather than on its glazing.
 * - **The bake is SPENT over frames rather than issued in one.** Every probe
 *   is refresh-once and they used to be released together, which is one frame
 *   of `probes x 6 x renderList` draws — 1.37 million on the 900 m proving
 *   ground against Coldharbour's 41,934, and 11.2 million at a true 1500 m —
 *   and the D3D12 device is lost inside it. `queue` and `releaseBatch` are
 *   what turn that into `drawsPerFrame` at a time. It is still a BUILD step;
 *   it is no longer a build step that happens in one command submission.
 * - **And the frames it is spent over are the LOADING card's**, not the
 *   round's. `Game` holds `loading` until `bakePending` reaches 0, which is
 *   the one thing outside this file that knows the bake is spread at all. A
 *   queue that cannot drain must not hang the card, so the wait is capped at
 *   the caller's end rather than here.
 * - **Each FACE draws only what that face can see** (`faceOf`, on
 *   `getCustomRenderList`). A cube target has no frustum culling of its own,
 *   so a probe used to draw its whole render list six times over; this is the
 *   only reduction to the bake in the file that cannot move a pixel, and the
 *   queue's budget is deliberately not told about it.
 * - **The probe count has a ceiling and it is stated in MEMORY**, because the
 *   count is the map's glazing and glazing has no natural bound: past
 *   `poolBudgetMiB` glazed blocks are grouped in twos, then fours, until the
 *   pool fits. Nothing in the tree groups anything today — the proving ground
 *   regenerated at 1500/0 is the first thing that ever has, at `perCell` 2.
 * - **Building a probe is not free either, and what it costs is the SCENE.**
 *   `newProbe` hides `scene.meshes` for the length of the construction, which
 *   is worth 1.3 s at 900 m and 6.6 at 1500. Read it before touching either
 *   pool: it is what keeps the glazing's and the water's fix in one place.
 * - The renderList must be replaced on every install, before the next frame:
 *   last build's meshes are disposed by then, exactly as for
 *   `ShadowSystem.setCasters`. The QUEUE is emptied on the same line and for
 *   the same reason — a probe waiting its turn is a probe holding a render
 *   list.
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
  type AbstractMesh,
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
import type { GameMap, PaneGroup, WorldBox } from "../world/MapBuilder";

/**
 * What the scene's mesh list is swapped for while a probe is being built, and
 * why it is one shared array rather than a fresh one per probe: a large map
 * mints hundreds of probes and this is not a place to allocate. See
 * `ReflectionSystem.newProbe`, which is the only thing that touches it, and
 * which puts anything that lands in it back into the real list.
 */
const NO_MESHES: AbstractMesh[] = [];

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
  /**
   * The probes that have been given a render list and are waiting for a frame
   * to bake on, oldest first, each with what it will cost when it does.
   *
   * **This is the whole of the spread**, and it is a queue rather than a rate
   * because what a frame can afford is DRAWS and a probe's render list is not
   * a constant: a map whose lists are short releases more probes per frame
   * than one whose lists are long, without either of them being told how big
   * it is.
   */
  private readonly queue: { probe: ReflectionProbe; draws: number }[] = [];
  /**
   * The probes released and not yet seen to bake, with what each will cost if
   * it renders again.
   *
   * **A released probe is not a baked one, and the gap is what makes this
   * list necessary.** Babylon's own render-list pass resets a target's refresh
   * counter and skips a mesh whose material has not compiled yet, so a probe
   * whose list contains anything unready re-bakes IN FULL on the next frame
   * and the one after, until the whole list is ready. Those re-renders are
   * draws the frame is about to issue, and if the queue does not know about
   * them it releases a fresh batch on top of a batch already thrashing — which
   * arrives at the one enormous frame this file exists to prevent, by the long
   * way round. `releaseBatch` spends them against the same budget.
   */
  private readonly inFlight: { probe: ReflectionProbe; draws: number }[] = [];
  /**
   * The list one FACE of one probe is actually drawn from — `renderList`
   * minus whatever that face cannot see. See `faceOf`, which is the only
   * thing that writes it, and which hands it straight to Babylon: it is
   * refilled at the top of every face and consumed inside the same
   * `ObjectRenderer.render` call, so one array serves all six faces of every
   * probe in the pool. A bake mints no garbage.
   */
  private readonly faceList: AbstractMesh[] = [];
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
      // And this frame's share of whatever bake is outstanding. It rides the
      // same hook rather than a `Game.tick` call, for a reason that is not
      // tidiness: Babylon asks each custom target whether it `_shouldRender()`
      // immediately AFTER this observable fires, so a probe released here
      // bakes on this frame and one released from `tick` a line later would
      // wait for the next. Nothing outside this file knows the bake is spread.
      this.releaseBatch();
    });
    scene.onAfterRenderTargetsRenderObservable.add(() => {
      this.mats.updateCamera(this.savedEye);
    });
    // Probe 0 exists before any map does, because `MapBuilder` asks for a
    // glazing material during the build and that material has to be born with
    // a cube bound to it — see `CelMaterialFactory.setDefaultReflection`. It
    // is released here holding the empty render list `newProbe` gave it, so
    // the default cube is a CLEARED cube rather than a texture nothing has
    // ever written: six empty face renders, once, before any map exists.
    const first = this.probeAt(0);
    this.release(first);
    this.mats.setDefaultReflection(first.cubeTexture);
  }

  /**
   * How much of this install's bake has NOT happened yet, in probes: every
   * probe still in the queue, plus every probe released and not yet seen to
   * render.
   *
   * **A released probe is not a baked one**, which is the same gap `inFlight`
   * exists for — a refresh-once target whose counter is still -1 is one
   * Babylon has been asked to draw and has not drawn, either because the
   * frame it was released on has not run yet or because something in its list
   * was not ready and it is re-baking in full. Counting only the queue would
   * report a bake finished one frame before its largest batch is issued,
   * which is the one frame the caller of this is trying not to spend in the
   * round.
   *
   * Read by `Game` while the building card is up and by nothing else. It
   * allocates nothing and walks at most the pool, so it is free to ask every
   * frame.
   */
  get bakePending(): number {
    let pending = this.queue.length;
    for (const held of this.inFlight) {
      if (held.probe.cubeTexture.currentRefreshId === -1) pending++;
    }
    return pending;
  }

  /**
   * Queues the installed map's glazing, one cube per glazed block, and hands
   * each block's mesh the material that samples its own.
   *
   * **It queues rather than bakes**, and the frames after it spend the queue —
   * see `releaseBatch`. Nothing waits on that: a pane whose probe has not
   * baked yet samples a cube that is empty, which is alpha 0 everywhere, which
   * is the analytic sky a pane shows before any probe has claimed it. That is
   * the state an editor build leaves every pane in permanently, so it is a
   * state the feature already ships rather than a new one.
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
    // And the queue with them. `build` is the top of an install, so this
    // empties the WHOLE of it, water included: a queued probe is one holding a
    // render list of meshes this line's caller has just disposed. The water
    // pool is queued later in the same install (`bakeWater`, called from
    // inside `WaterSystem.build`), which is what makes emptying everything
    // here safe rather than merely convenient.
    this.queue.length = 0;
    this.inFlight.length = 0;
    if (editor || map.paneGroups.length === 0) return;

    const opaque = opaqueWorld(map);

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
    const perCell = blocksPerCell(
      map.paneGroups,
      probeCap(cfg.size, cfg.poolBudgetMiB),
    );

    // Slots are assigned in one pass and FILLED in the next, because a probe's
    // render list has to leave out every block that probe serves and only the
    // last group on a cell says which those are. At `perCell` 1 that set is
    // the one block it has always been.
    const slots = new Map<string, number>();
    const served: Set<string>[] = [];
    const anchor: Mesh[] = [];
    const slotOf: number[] = [];
    for (const group of map.paneGroups) {
      const key = cellKey(group.block, perCell);
      let slot = slots.get(key);
      if (slot === undefined) {
        slot = slots.size;
        slots.set(key, slot);
        served.push(new Set());
        anchor.push(group.mesh);
      }
      served[slot].add(group.block);
      slotOf.push(slot);
    }

    let listed = 0;
    let dropped = 0;
    for (let slot = 0; slot < slots.size; slot++) {
      const probe = this.probeAt(slot);
      centreOf(anchor[slot], probe.position);
      const blocks = served[slot];
      // Two subtractions answering different questions: `encloses` takes out
      // the building the probe is STANDING IN, and the radius takes out the
      // city it could not see the far side of. Neither is a distance test
      // standing in for the other — see `encloses` on why the enclosure
      // stopped being one.
      const list = neighbourhood(
        opaque,
        probe.position,
        cfg.radius,
        (m) => !encloses(m, blocks),
      );
      dropped += opaque.length - list.length;
      listed += list.length;
      probe.cubeTexture.renderList = list;
      this.queue.push({ probe, draws: list.length * 6 });
    }

    for (let i = 0; i < map.paneGroups.length; i++) {
      const group = map.paneGroups[i];
      const slot = slotOf[i];
      const probe = this.probeAt(slot);
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
      const n = Math.max(slots.size, 1);
      const draws = listed * 6;
      console.info(
        `[reflection] ${slots.size} probes for ${map.paneGroups.length} ` +
          `glazing groups (${perCell} block${perCell === 1 ? "" : "s"} each) ` +
          `over ${opaque.length} meshes — ${(listed / n).toFixed(0)} listed ` +
          `and ${(dropped / n).toFixed(1)} dropped each, ${draws} draws over ` +
          `${Math.ceil(draws / cfg.drawsPerFrame)} frame(s), queued in ` +
          `${(performance.now() - started).toFixed(1)} ms`,
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
      // Water has no block and so excludes nothing: not one structure comes
      // out of this list, which is what a mirror lying in the open is owed.
      // The RADIUS still applies, for the reason it applies to the glazing and
      // without touching that one: what a pond is owed is the world around it
      // rather than the world entire, and on every map that has water the two
      // are the same list.
      const list = neighbourhood(opaque, probe.position, cfg.radius, keepAll);
      probe.cubeTexture.renderList = list;
      this.queue.push({ probe, draws: list.length * 6 });
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

  /**
   * Lets this frame's share of the outstanding bake go, oldest probe first.
   *
   * **The budget is DRAWS and not probes**, because a probe is expensive only
   * in proportion to its render list and the list is the map's. It is set just
   * over what the largest shipped map's whole bake costs
   * (`CONFIG.graphics.reflection.drawsPerFrame`), so Coldharbour still bakes
   * on the frame it always did and nothing about a shipped map's glass moves —
   * which is what keeps the banked reference frames a test of the shaders.
   *
   * **On a frame with nothing else to pay for, one probe goes through however
   * fat it is.** A probe whose own list exceeds a whole frame's allowance is
   * still cheaper than a probe that never bakes: the alternative is a queue
   * that cannot drain and glass showing sky for the rest of the round. On a
   * frame already committed to re-bakes it waits instead, which is the whole
   * of what `inFlight` is for.
   *
   * Releasing is `resetRefreshCounter()` and a push into the scene's custom
   * targets. A refresh-once target renders on the next frame its counter is -1
   * and never again, so a probe still in the queue costs a comparison here and
   * nothing at all in the scene — it is not a target yet. See `release`.
   */
  private releaseBatch(): void {
    if (this.queue.length === 0 && this.inFlight.length === 0) return;
    const budget = CONFIG.graphics.reflection.drawsPerFrame;
    // What this frame is going to spend before anything new is let go: every
    // probe released earlier whose counter is back at -1 is one Babylon is
    // about to draw again, because something in its list was not ready last
    // time. See `inFlight`. A probe whose counter has moved on has baked and
    // is dropped from the list.
    let spent = 0;
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const held = this.inFlight[i];
      if (held.probe.cubeTexture.currentRefreshId !== -1) {
        this.inFlight.splice(i, 1);
        continue;
      }
      spent += held.draws;
    }
    let taken = 0;
    for (const next of this.queue) {
      // One probe goes through on an EMPTY frame however fat it is, or a queue
      // whose head costs more than the whole budget would never drain. On a
      // frame already committed to re-bakes it waits, which is the point.
      if (spent > 0 && spent + next.draws > budget) break;
      this.release(next.probe);
      this.inFlight.push(next);
      spent += next.draws;
      taken++;
    }
    this.queue.splice(0, taken);
  }

  /**
   * Puts a probe's cube where the scene will draw it, and asks for a bake.
   *
   * **Being in `scene.customRenderTargets` is what "released" MEANS**, and
   * that is not tidiness — it is the only thing that can hold a fresh probe
   * back. A `ReflectionProbe` is born with its refresh counter at -1, which a
   * refresh-once target reads as "render on the next frame you are asked", and
   * `build` fills its render list before any frame happens. So a probe pushed
   * into the custom targets at CONSTRUCTION bakes in full on the frame after
   * the install however carefully the queue is spent — which on the first
   * install of a large map is every probe at once, the exact frame this file
   * exists to stop happening. Nothing but membership of that array can park
   * it: the counter has no public way back to "not yet", and a refresh RATE is
   * a schedule rather than a gate.
   *
   * A probe stays in the array once released. It has baked by then, and a
   * refresh-once target that has baked costs a `_shouldRender` that says no —
   * the same nothing a parked probe has always cost. `resetRefreshCounter` is
   * therefore for the SECOND release onward (a later install, or the reference
   * harness re-baking a frozen world) and is a no-op on the first.
   */
  private release(probe: ReflectionProbe): void {
    const rtt = probe.cubeTexture;
    if (!this.scene.customRenderTargets.includes(rtt)) {
      this.scene.customRenderTargets.push(rtt);
    }
    rtt.resetRefreshCounter();
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
   *
   * **And the scene's mesh list is hidden while the probe is CONSTRUCTED,
   * which is `ENGINE_UPGRADE.md` S5c and was 96% of what a first install spent
   * in this file.** A cube target is six render passes, so its `ObjectRenderer`
   * mints six render pass ids — and `_createRenderPassId` opens by RELEASING
   * the ids it is about to create, over an array that is still empty. That is
   * six `AbstractEngine.releaseRenderPassId(undefined)` calls, and each one
   * walks every mesh of every scene on the engine, and every submesh under it,
   * to clear a draw wrapper filed under `undefined`.
   *
   * **Nothing can ever have written that key, so the walk is provably a
   * no-op**: `SubMesh._getDrawWrapper` resolves an undefined pass id to the
   * engine's CURRENT one before it indexes, so `undefined` is not a slot the
   * map has. What the walk is priced on is the MAP — 265 probes x 6 x 9,002
   * meshes is 14.3 million mesh visits on the 900 m proving ground for
   * 1,298 ms, and 250 x 6 x 23,014 is 34.5 million at 1500 m for 6,551
   * (`FINDINGS.md` 25) — and it is paid at the worst moment available,
   * immediately after `MapBuilder.build` has put the whole map in the scene.
   * Handing it an empty list is the whole fix, and takes those to 38 ms and 72;
   * the loop is Babylon's, so the only lever is the multiplier.
   *
   * **It is a Babylon FIELD rather than a Babylon hook, so the two things that
   * make the swap safe are said out loud rather than enforced by its shape.**
   * (1) No frame renders inside `installMap`: the construction, the queueing
   * and the install around them are one synchronous call, and `releaseBatch`
   * rides a render observable that cannot fire inside it — so nothing walks
   * `scene.meshes` while it is hidden. (2) Probe construction creates no mesh,
   * so nothing is looking to be ADDED to the list while it is out; the
   * `finally` below is what turns a Babylon version that changes that from a
   * silent lost mesh into a loud one. `WorldCulling` replacing
   * `getActiveMeshCandidates` is the precedent for reaching into the scene like
   * this, and it is a weaker one than it looks: that is a documented hook and
   * this is an array.
   */
  private newProbe(name: string): ReflectionProbe {
    const meshes = this.scene.meshes;
    this.scene.meshes = NO_MESHES;
    let probe: ReflectionProbe;
    try {
      probe = new ReflectionProbe(
        name,
        CONFIG.graphics.reflection.size,
        this.scene,
      );
    } finally {
      // Anything that arrived while the real list was out of the scene goes
      // back into it rather than onto the floor: `Scene.addMesh` pushes into
      // whatever `scene.meshes` IS at the time, and a mesh lost here is one
      // the frame never walks, the shadow map never casts from and nothing
      // ever draws. Nothing in probe construction adds one today — see the
      // second half of the note above, which this is the enforcement of.
      if (NO_MESHES.length > 0) {
        if (import.meta.env.DEV) {
          console.error(
            `[reflection] ${NO_MESHES.length} mesh(es) were added to the ` +
              `scene while its list was hidden for probe construction — ` +
              `see ReflectionSystem.newProbe`,
          );
        }
        for (const stray of NO_MESHES) meshes.push(stray);
        NO_MESHES.length = 0;
      }
      this.scene.meshes = meshes;
    }
    const rtt = probe.cubeTexture;
    // Transparent black, and the alpha is the load-bearing half: it is how the
    // shader tells the city from the sky above it. Everything drawn here is a
    // cel material, and every cel variant but the glazing writes alpha 1.
    rtt.clearColor = new Color4(0, 0, 0, 0);
    // The world is static, so a bake is not a per-frame cost at all. `build`
    // and `bakeWater` are the only things that ever ask for another one, and
    // `releaseBatch` is what decides which frame it lands on.
    rtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    rtt.renderList = [];
    // **NOT pushed into `scene.customRenderTargets` here**, which is the one
    // line of this setup that is about the QUEUE rather than about the probe.
    // A ReflectionProbe registers itself with the scene but nothing renders
    // it: Babylon collects render targets off the materials it finds on active
    // meshes, and these are bound to ShaderMaterials by hand, so being a
    // custom target is what draws them at all — and what puts them before the
    // main pass. `release` is where that happens; see it for why construction
    // is too early.
    // Per face, and cheap: `updateCamera` guards on the position, so the six
    // faces of one probe cost one walk of the material cache between them.
    rtt.onBeforeRenderObservable.add(() => {
      this.mats.updateCamera(probe.position);
    });
    // **And the face is asked what it can SEE, which is the one question the
    // bake had never been asked.** See `faceOf`. It is registered here rather
    // than in `build` so both pools get it and neither can be given a probe
    // that draws its whole list six times.
    rtt.getCustomRenderList = (_face, list, length) => this.faceOf(list, length);
    return probe;
  }

  /**
   * This face's share of a probe's render list: the meshes inside the frustum
   * Babylon is about to rasterise with, and nothing else.
   *
   * **A cube target has no frustum culling of its own, and that is the whole
   * of what this is.** `ObjectRenderer._prepareRenderingManager` walks the
   * render list and dispatches every mesh in it — the readiness check, the LOD
   * get, `_activate` and a draw per submesh — with no `isInFrustum` anywhere,
   * because a render list is normally something a caller has already chosen.
   * So a probe drew its whole neighbourhood SIX TIMES, once per face, where
   * the main pass draws each mesh at most once and usually not at all: at
   * 1500 m that is 1,348 meshes x 6 against a frame that reaches 146 active
   * out of 23,031. `ENGINE_UPGRADE.md` S0c calls this the only lever on the
   * bake that removes work rather than moving it, and this is it.
   *
   * **It cannot move a pixel, and that is why it is preferred over every
   * other way of making the list shorter.** A shorter RADIUS drops geometry
   * the face would have drawn and leaves a hole the shader fills with sky; a
   * coarser `perCell` drops a building out of the middle of a cube. This drops
   * only what falls outside the six planes the rasteriser is about to clip
   * against anyway — the same test, by the same code, that
   * `_evaluateActiveMeshes` uses for the main pass, including
   * `alwaysSelectAsActiveMesh` so a mesh that opts out of the frame's cull
   * opts out of this one too. Nothing in `map.visuals` sets it today; it is
   * here so that a mesh which one day does cannot vanish out of the glass
   * silently.
   *
   * **`scene.frustumPlanes` is THIS FACE's, and the ordering that makes that
   * true is Babylon's rather than ours.** `ReflectionProbe` writes the face's
   * view and projection through `scene.setTransformMatrix` from the render
   * target's `onBeforeRenderObservable`, `setTransformMatrix` refreshes the
   * planes, and `ObjectRenderer.render` fires that observable immediately
   * before it calls `_prepareRenderingManager` — which is what calls this. A
   * Babylon version that moved either of those two lines would leave this
   * culling every face against the previous one's planes, and the tell would
   * be a seam of missing geometry that rotates with the probe.
   *
   * **What it deliberately does NOT do is make the queue's budget go further.**
   * A queued probe is still priced at `list.length * 6` — see `releaseBatch`
   * — so the frames a bake takes are exactly the frames it took before and
   * each one merely issues far fewer draws. That is the conservative
   * direction on the one number standing between this bake and a lost D3D12
   * device, and `drawsPerFrame` is not a lever this step was allowed to move.
   */
  private faceOf(
    list: readonly AbstractMesh[] | null,
    length: number,
  ): AbstractMesh[] {
    const planes = this.scene.frustumPlanes;
    const out = this.faceList;
    out.length = 0;
    if (!list) return out;
    for (let i = 0; i < length; i++) {
      const mesh = list[i];
      // The list can hold dummy entries — Babylon's own note on this hook —
      // so the null check is the contract rather than defensiveness.
      if (!mesh) continue;
      if (mesh.alwaysSelectAsActiveMesh || mesh.isInFrustum(planes)) {
        out.push(mesh);
      }
    }
    return out;
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
 * **There used to be a second term here and its removal is a rule rather than
 * a tidy-up.** `noReflect` excluded the ink TWINS, and what made them
 * disqualifying was that an inverted hull is a thin line seen from outside and
 * a SEALED ROOM seen from within: a probe parked against a tower's glass stood
 * inside its own block's hull, so all six faces baked one flat colour and the
 * glazing reflected a grey card — measured on Coldharbour's curtain wall at 85%
 * of the frame's pixels. The ink is a screen-space pass now and nothing in the
 * tree is inside-out, so the flag had no writer left. **Anything inside-out
 * that is ever added back owes this filter again**, on that argument and not on
 * a material-name test: what disqualifies a mesh here is what it IS.
 */
function opaqueWorld(map: GameMap): Mesh[] {
  const panes = new Set(map.paneGroups.map((g) => g.mesh));
  return map.visuals.filter((m) => !panes.has(m));
}

/** Every mesh survives this. `bakeWater`'s filter, named so it is not a lambda. */
function keepAll(): boolean {
  return true;
}

/**
 * The opaque world within `radius` of a point, minus whatever `keep` refuses.
 *
 * **Distance is to the NEAR SIDE of the bounding sphere, and that is the whole
 * of the care in it.** A landform is one mesh with an enormous radius whose
 * centre is nowhere near anything — the valley rim, the ridge rock, a terrain
 * patch — so a centre test drops exactly the geometry a reflection at this
 * range is made of. `distance - radiusWorld` keeps them all, at every radius
 * `FINDINGS.md` 10 tried.
 *
 * What this drops does not fade, it vanishes: the cube's alpha goes to 0 and
 * that is where the shader puts sky. It is the objection finding 10 refused a
 * 140 m cull over and it does not go away here — what changes is the radius,
 * which at 800 m is past the diagonal of every map that ships and past the
 * longest `fogEnd` any of them declares. On a fogged map of any size,
 * everything dropped here was already drawing as flat fog colour and the sky
 * replacing it is `fogColor` at the horizon. On an unfogged one it is a hole
 * at the edge of a picture of a street, which is what the map being bigger
 * than the bake can hold costs.
 */
function neighbourhood(
  opaque: readonly Mesh[],
  at: Vector3,
  radius: number,
  keep: (m: Mesh) => boolean,
): Mesh[] {
  const out: Mesh[] = [];
  for (const mesh of opaque) {
    if (!keep(mesh)) continue;
    const sphere = mesh.getBoundingInfo().boundingSphere;
    if (Vector3.Distance(sphere.centerWorld, at) - sphere.radiusWorld > radius) {
      continue;
    }
    out.push(mesh);
  }
  return out;
}

/**
 * How many probes `CONFIG.graphics.reflection.poolBudgetMiB` pays for at this
 * face size.
 *
 * A probe is six faces of RGBA8 plus a full mip chain — `6 * size^2 * 4 * 4/3`
 * bytes, which is exactly 512 KiB at the shipped 128 — and the pool is never
 * disposed, so this bounds a figure held for the PROCESS rather than for a
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
 * changing that is the one `encloses` ends on: a probe drops every block it
 * serves out of its own bake, so a cell of four blocks is a probe with 96 m of
 * city missing from the middle of its cube. That is a bad picture, and it is
 * still a better one than a device loss — which is what a map with 770 glazed
 * blocks costs instead (`FINDINGS.md` 19).
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
    const cells =
      per === 1 ? blocks : new Set([...blocks].map((k) => cellKey(k, per)));
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
  const comma = block.indexOf(",");
  if (comma < 0) return block;
  const bx = Number(block.slice(0, comma));
  const bz = Number(block.slice(comma + 1));
  if (!Number.isFinite(bx) || !Number.isFinite(bz)) return block;
  return `${Math.floor(bx / perCell)},${Math.floor(bz / perCell)}`;
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
 * Whether this mesh is one of the STRUCTURES the probe is standing in — the
 * geometry that has to come out of the bake, or the cube is a picture of a
 * wall.
 *
 * **It asks the block key, and that is the whole of it.** This used to be a
 * bounding-box containment test, and it worked because the opaque world was
 * merged per block per COLOUR: a colour that appeared once appeared in a mesh
 * of its own, so "inside its box" picked out one to five small meshes of the
 * probe's own building. The albedo palette took the colour out of that merge
 * key (`MapBuilder.mergeByMaterial`), which left the smallest thing a box test
 * could remove at one whole merge block — 48 m on every shipped map, and wider
 * on a map that states its own `blockSize` — and a box test cannot tell a tower's
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
 *
 * **It takes a SET because a probe may serve more than one block**, which is
 * what `blocksPerCell` does past the pool budget, and every block a probe
 * serves has to come out: the probe stands at one of them and the set is the
 * only honest statement of which. On every map in the tree the set holds one
 * key and this is the test it has always been.
 */
function encloses(mesh: Mesh, blocks: ReadonlySet<string>): boolean {
  const block = mesh.metadata?.block;
  return typeof block === "string" && block !== "" && blocks.has(block);
}
