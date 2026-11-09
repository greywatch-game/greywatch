/**
 * LocalShadows.ts — shadows from the POINT and SPOT lights: one depth atlas,
 * which lights get tiles in it, and the passes that fill them.
 * Owns the atlas's tile allocation, the static cache per fixture, each
 * frame's work (which tiles are cleared, which static faces baked, the
 * proxies every moving shadow is drawn as), the per-slot cone/tile arrays the
 * shaders read (written into `ShadowBindings`' own arrays, which every
 * `celShadow` consumer holds by reference), the proxies' arrays and the face
 * records (`AtlasWork`'s: our renderer draws the atlas, `render/LampAtlas.ts`),
 * and Babylon's wrapped view of the atlas. Owns no light — `LightingSystem`
 * decides which lights exist and which won a slot, and this decides only
 * which of THOSE cast.
 * Invariants:
 * - A tile holds the RADIAL distance to the nearest caster over the light's
 *   range, from BACK faces (the moon map's rule, for its reason), and
 *   `celShadow`'s `localLayer` is the reader. The face order (+X -X +Y -Y +Z
 *   -Z) and each face's frame (`faceFrame`) are stated twice, here and there,
 *   and must agree.
 * - A slot's layers are published to the shader only once they are drawn: a
 *   static layer after every face has been baked, a dynamic one after its
 *   first pass. Until then the slot keeps the volume's visibility.
 * - Nothing here draws. Every pass renders INTO the atlas without clearing
 *   it — a static tile survives the frames it is not redrawn on — so every
 *   tile a pass writes is cleared first (`AtlasWork.clear`, `LampAtlas`).
 * - THE ATLAS IS OUR RENDERER'S (`render/LampAtlas.ts`, `BABYLON_EXIT.md`
 *   X3.6b, X3.7b), as the world's maps are (`ShadowSystem`): the handover
 *   hands it the casters on every rung (`LampAtlas.casters`, set by
 *   `BlockHandover`), and casters ours cannot draw are the world's failure
 *   (`BlockHandover`, X3.7b). This file DECIDES — which lights cast, their
 *   tiles, which faces bake when, and what is published — and hands the
 *   drawing over once a frame as `AtlasWork`. Until the first map hands ours
 *   its casters there is no atlas, its readers bound to the lit 1x1, and once
 *   ours holds it it keeps it. Babylon's own atlas — its render target, its
 *   depth and clear programs, the proxy mesh and the clear sheet — drew it
 *   for the map editor's build alone after X3.7b, cleared it once at the boot,
 *   and was deleted at X5.3d.
 * Contract: `docs/rendering.md`.
 *
 * ## WHY ONE ATLAS
 *
 * The cel shader binds fourteen textures against WebGPU's default sixteen, so a
 * map per light was never available: every shadowed lamp in the frame has to
 * be reachable through ONE binding. A cube face is a square tile, a spot is
 * one more, and the lookup picks the tile off the slot's base and the face
 * the receiver is on.
 *
 * ## SPLIT BY REFRESH RATE
 *
 * The moon's shadows are two maps because the world is static and the bodies
 * are not, and a lamp's are split the same way. A FIXTURE's world geometry is
 * drawn once into a STATIC tile and kept for as long as the light holds its
 * tiles; the bodies and hulls within its reach go into a DYNAMIC tile redrawn
 * every frame, and the shader takes the `min`. A light that MOVES has nothing
 * static to keep, so the whole of it — the collider boxes it can see as well
 * as the bodies — is dynamic, and it is affordable because a moving light's
 * casters are PROXIES: thin instances of one unit box. Every dynamic tile in
 * the frame is ONE draw call, whatever it holds.
 *
 * A fixture's static tile is the REAL geometry (on the rungs with `meshes`),
 * and it can be because it is drawn once: a block-merged face is a handful of
 * draws, spent over `staticFacesPerFrame` faces a frame so walking into a lit
 * street is a queue rather than a hitch. On the phone rung it is proxies too.
 *
 * ## ONE PASS, MANY TILES
 *
 * A pass draws its list once, through one projection, and a cube is six. So
 * the projection is the face's own perspective, SCALED AND OFFSET in clip
 * space into that face's tile of the atlas — an affine map, so it commutes
 * with the divide — and the fragment stage discards whatever fell outside the
 * face's frustum, which is the clipping the hardware can no longer do per
 * tile (`render/lampDepth.ts`, which reads the face records written here). A
 * proxy's instance names its tile, so one draw covers every face of every
 * moving light; a static bake is a pass per face with the tile as a uniform.
 */
import {
  type BaseTexture,
  Matrix,
  Quaternion,
  type Scene,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { ProxyBoxes, type ShadowBody, type ShadowHull } from "../core/proxyBoxes";
import type { ShadowQuality } from "../core/settings";
import { litShadowTexture } from "../core/shadowWindow";
import { wrapShadowTexture } from "../core/wrappedTextures";
import type { AtlasWork, LampAtlas } from "../render/LampAtlas";
import { MAX_TILES } from "../render/lampDepth";
import {
  type CelMaterialFactory,
  MAX_POINT_LIGHTS,
  type PointLightData,
} from "../shaders/CelShader";
import { BOX_BUCKET, buildBoxIndex, type BoxIndex } from "../world/boxIndex";
import type { WorldBox } from "../world/MapBuilder";

/** The cube's faces, in the order `celShadow`'s `localLayer` numbers them. */
const CUBE: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/**
 * A face's right and up off its forward — `celShadow`'s `localUp` rule:
 * built on world up, unless the face looks straight up or down.
 */
function faceFrame(f: Vector3, right: Vector3, up: Vector3): void {
  const u = Math.abs(f.y) > 0.99 ? Vector3.Forward() : Vector3.Up();
  Vector3.CrossToRef(u, f, right);
  right.normalize();
  Vector3.CrossToRef(f, right, up);
}

/** One candidate in `choose`'s ranking. */
interface Ranked {
  e: PointLightData;
  score: number;
  moving: boolean;
}

function byRankScore(a: Ranked, b: Ranked): number {
  return a.score - b.score;
}

/** One light holding tiles. Keyed by the light object's identity. */
interface Entry {
  light: PointLightData;
  /** All of it redrawn every frame from proxies; else a baked fixture. */
  moving: boolean;
  /** 6 for a point light, 1 for a spot. */
  faces: number;
  staticBase: number;
  dynBase: number;
  /** Static faces baked so far; the layer is published at `faces`. */
  baked: number;
  /** Whether the dynamic layer has been drawn at least once. */
  dynDrawn: boolean;
  /** Where the static layer and the face records were taken. */
  at: Vector3;
  range: number;
  axis: Vector3;
  cosOuter: number;
  /** Collider boxes gathered for a moving light, and where. */
  boxes: number[];
  gatheredAt: Vector3;
  gatheredRange: number;
  /** The last frame this light had a body in reach — its dynamic tile's lease. */
  bodiesSeen: number;
}

export class LocalShadows {
  /**
   * The atlas is our renderer's (`LampAtlas`), and Babylon reads `wrapped`:
   * false only until the first map hands ours its casters — see the header.
   */
  private ours = false;
  /** Babylon's view of our renderer's atlas, while it is ours and has one. */
  private wrapped: BaseTexture | null = null;
  /**
   * The atlas has been stood up once — false only until the constructor's
   * `setQuality`, which must stand it up even at a rung equal to `tier`'s
   * starting value.
   */
  private standing = false;
  private tier: (typeof CONFIG.graphics.localShadows.tiers)[ShadowQuality] =
    CONFIG.graphics.localShadows.tiers.off;
  private tilesPerRow = 0;
  private tileCount = 0;
  /** Which entry owns each tile, or null. */
  private owner: (Entry | null)[] = [];
  private readonly entries = new Map<PointLightData, Entry>();
  private frame = 0;

  /** The face records, `MAX_TILES * 16` floats, which our renderer's depth program reads. */
  private readonly faces = new Float32Array(MAX_TILES * 16);
  private readonly clearFlags = new Float32Array(MAX_TILES);

  private readonly proxyMatrices: Float32Array<ArrayBuffer>;
  private readonly proxyTiles: Float32Array<ArrayBuffer>;
  private proxyCount = 0;

  /** The collider boxes a moving light can see, and each as a matrix. */
  private boxes: readonly WorldBox[] = [];
  private boxMatrices = new Float32Array(0);
  /** Each box's world AABB: centre xyz, half-extent xyz. */
  private boxBounds = new Float32Array(0);
  private index: BoxIndex | null = null;
  private readonly boxStamp: number[] = [];
  private stamp = 0;

  private readonly bodyBoxes = new ProxyBoxes();
  /** This frame's body matrices, packed once and copied per face. */
  private readonly bodyMatrices: Float32Array;
  private readonly bodyAt: Vector3[] = [];
  /** Where a hull's box stands, a frame's scratch (`ProxyBoxes.hullCentreToRef`). */
  private readonly hullAt = new Vector3();
  /** A box for `reaches` whose caller does not already hold one in an array. */
  private readonly probe = new Float64Array(6);
  /** Nearest-a-light selection scratch, reused frame to frame. See `packBodies`. */
  private readonly pickedBodies: (ShadowBody | null)[] = [];
  /** `rootAt`'s answer, reused. */
  private readonly rootScratch = new Vector3();
  private readonly pickedGap: number[] = [];
  /** Boxes in each packed slot: a soldier's bones, or a hull's one. */
  private readonly bodyBoxCount: number[] = [];
  private bodyCount = 0;

  /** This frame's work, built in `update` and handed over as `work`. */
  private bakeQueue: { entry: Entry; face: number }[] = [];
  /** The same work as our renderer reads it: one object over the arrays above, refilled each frame. */
  private readonly work: AtlasWork;
  private drawDynamic = false;

  private readonly scratchR = new Vector3();
  private readonly scratchU = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    quality: ShadowQuality,
    /** Our renderer's atlas: who draws it whenever the handover holds every caster. */
    private readonly lamps: LampAtlas,
  ) {
    const c = CONFIG.graphics.localShadows;
    for (const t of Object.values(c.tiers)) {
      if (t.atlas > 0 && (t.atlas / t.tile) ** 2 > MAX_TILES) {
        throw new Error(`LocalShadows: a ${t.atlas}/${t.tile} atlas is past ${MAX_TILES} tiles`);
      }
    }

    this.proxyMatrices = new Float32Array(c.maxProxies * 16);
    this.proxyTiles = new Float32Array(c.maxProxies);

    const bodies = CONFIG.graphics.bodyShadows.maxBodies + CONFIG.graphics.bodyShadows.maxHulls;
    this.bodyMatrices = new Float32Array(bodies * this.bodyBoxes.perBody * 16);

    this.work = {
      faces: this.faces,
      clear: this.clearFlags,
      bakeTiles: new Int32Array(c.staticFacesPerFrame),
      bakes: 0,
      proxyMatrices: this.proxyMatrices,
      proxyTiles: this.proxyTiles,
      proxies: 0,
      dynamic: false,
    };

    this.setQuality(quality);
  }

  /**
   * Stands the atlas up at a rung's size, or takes it down, while ours holds
   * it (`remake`). A rung of the same size leaves it alone.
   */
  setQuality(quality: ShadowQuality): void {
    const tier = CONFIG.graphics.localShadows.tiers[quality];
    const same = tier.atlas === this.tier.atlas && tier.tile === this.tier.tile && this.standing;
    this.tier = tier;
    if (same) return;
    this.remake();
  }

  /**
   * Hands the atlas to our renderer (`ours`), once, made at the rung's size.
   * Nothing once ours holds it.
   */
  private takeOver(): void {
    if (this.ours) return;
    this.ours = true;
    this.remake();
  }

  /**
   * The atlas at `tier`'s size while ours holds it — none on a rung without
   * one, nor before ours holds it — bound to every reader. Every light loses its tiles,
   * because a tile's index means a different rectangle at a different size
   * and a fresh texture holds none of them. Babylon's view of our texture is
   * let go first, which destroys the texture it wraps, so ours is re-made
   * AFRESH whatever its size (`wrapShadowTexture`).
   */
  private remake(): void {
    const tier = this.tier;
    this.releaseAll();
    this.wrapped?.dispose();
    this.wrapped = null;
    this.lamps.setSize(0, 0);
    this.tilesPerRow = 0;
    this.tileCount = 0;
    this.owner = [];
    if (tier.atlas > 0) {
      this.tilesPerRow = Math.floor(tier.atlas / tier.tile);
      this.tileCount = this.tilesPerRow * this.tilesPerRow;
      this.owner = new Array(this.tileCount).fill(null);
      if (this.ours) {
        this.lamps.setSize(tier.atlas, tier.tile);
        this.wrapped = wrapShadowTexture(this.scene, this.lamps.texture!, "localShadowAtlas");
      }
    }
    this.standing = true;
    const side = 1 / Math.max(1, this.tilesPerRow);
    const slots = this.mats.shadows.localSlots;
    slots.atlas.set(
      Math.max(1, this.tilesPerRow),
      side,
      1 / Math.max(1, tier.atlas),
      tier.taps,
    );
    const c = CONFIG.graphics.localShadows;
    slots.params.set(c.bias, c.normalBias, 0, 0);
    this.mats.shadows.setLocalShadowMap(
      this.wrapped ?? litShadowTexture(this.scene),
      this.wrapped ? this.lamps.own : null,
    );
    this.publish([]);
  }

  /**
   * The map's collider boxes, from `installMap`. The boxes a moving light can
   * see are indexed once here — glass and porous boxes out, as a round sees
   * them — and each is composed into its matrix once.
   *
   * **And it is where the atlas comes to our renderer**: after
   * `BlockHandover.install`, which hands `LampAtlas` the casters when it
   * holds every one, so the atlas is ours from the first map that did
   * (`takeOver`); with none of ours it stays as it is.
   */
  setWorld(
    size: number,
    boxes: readonly WorldBox[],
    rayGroups: readonly (readonly WorldBox[])[],
  ): void {
    this.releaseAll();
    const kept: WorldBox[] = [];
    for (const b of boxes) if (!b.glass && !b.porous) kept.push(b);
    for (const g of rayGroups) for (const b of g) kept.push(b);
    this.index = buildBoxIndex(kept, size, 0);
    this.boxes = this.index.boxes;
    const n = this.boxes.length;
    this.boxMatrices = new Float32Array(n * 16);
    this.boxBounds = new Float32Array(n * 6);
    this.boxStamp.length = n;
    this.boxStamp.fill(0);
    const m = new Matrix();
    const q = new Quaternion();
    const scale = new Vector3();
    const at = new Vector3();
    for (let i = 0; i < n; i++) {
      const b = this.boxes[i];
      // The collider's own transform: pitched about X, then yawed about Y —
      // `RayWorld.boxCast` inverts exactly this.
      Quaternion.RotationYawPitchRollToRef(b.rotY, b.rotX, 0, q);
      scale.set(b.w, b.h, b.d);
      at.set(b.cx, b.cy, b.cz);
      Matrix.ComposeToRef(scale, q, at, m);
      m.copyToArray(this.boxMatrices, i * 16);
      // The AABB of the rotated box, off the matrix's absolute rows.
      const r = m.m;
      for (let a = 0; a < 3; a++) {
        const e =
          0.5 * (Math.abs(r[a]) + Math.abs(r[4 + a]) + Math.abs(r[8 + a]));
        this.boxBounds[i * 6 + a] = r[12 + a];
        this.boxBounds[i * 6 + 3 + a] = e;
      }
    }
    if (this.lamps.casters !== null) this.takeOver();
  }

  /**
   * No world at all: `Game.teardownMap`, for the menu. Every tile is given
   * up and nothing of the disposed map is held; `update` finds no index and
   * releases, as it does before the first `setWorld`. Ours keeps the atlas —
   * there is nothing to cast — so a round does not re-make it on its way out.
   */
  clearWorld(): void {
    this.releaseAll();
    this.index = null;
    this.boxes = [];
    this.boxMatrices = new Float32Array(0);
    this.boxBounds = new Float32Array(0);
    this.boxStamp.length = 0;
  }

  /**
   * Chooses this frame's shadowed lights, lays out their tiles and packs what
   * the passes will draw. Runs after `LightingSystem.update`, whose winning
   * slots are `active`; the draw itself is our renderer's (`queueOurs`).
   */
  update(
    active: readonly PointLightData[],
    eye: Vector3,
    bodies: readonly ShadowBody[],
    hulls: readonly ShadowHull[],
  ): void {
    // Work our renderer never recorded — a frame that prepared nothing — was
    // counted baked and drawn when it was laid out, so every light gives its
    // tiles back and starts again rather than publishing a tile nobody drew;
    // the work is dropped too, or a later frame would draw it into tiles now
    // free, mid-refill.
    if (this.ours && this.lamps.owed) {
      this.lamps.drop();
      this.releaseAll();
    }
    this.frame++;
    this.bakeQueue.length = 0;
    this.drawDynamic = false;
    this.proxyCount = 0;
    this.clearFlags.fill(0);
    const tier = this.tier;
    if (!this.hasAtlas || tier.lights === 0 || !this.index || !this.ready()) {
      this.releaseAll();
      this.publish(active);
      return;
    }

    const chosen = this.choose(active, eye, tier);

    this.packBodies(bodies, hulls);
    const c = CONFIG.graphics.localShadows;
    const dynamicFrame = this.frame % tier.every === 0;
    let bakeBudget = c.staticFacesPerFrame;
    for (const e of chosen) {
      this.refresh(e);
      const reach = e.range + 1.5;
      const nearBody = this.anyBodyWithin(e.at, reach);
      if (nearBody) e.bodiesSeen = this.frame;
      if (!e.moving) {
        // The static layer, a face at a time off the frame's budget.
        while (e.baked < e.faces && bakeBudget > 0) {
          this.bakeQueue.push({ entry: e, face: e.baked });
          this.clearFlags[e.staticBase + e.baked] = 1;
          e.baked++;
          bakeBudget--;
        }
        // A dynamic tile only while a body is near, held for a second past
        // the last one so a soldier crossing the edge of the reach does not
        // allocate and free it every other frame.
        const wantDyn = this.frame - e.bodiesSeen < 60;
        if (wantDyn && e.dynBase < 0) {
          e.dynBase = this.alloc(e.faces, e);
          e.dynDrawn = false;
          if (e.dynBase >= 0) this.writeFaces(e, e.dynBase);
        } else if (!wantDyn && e.dynBase >= 0) {
          this.freeBlock(e.dynBase, e.faces);
          e.dynBase = -1;
        }
      }
      if (e.dynBase >= 0 && (dynamicFrame || !e.dynDrawn)) {
        this.packDynamic(e);
        for (let f = 0; f < e.faces; f++) this.clearFlags[e.dynBase + f] = 1;
        e.dynDrawn = true;
        this.drawDynamic = true;
      }
    }
    this.queueOurs();
    this.publish(active);
  }

  /** Whether the atlas stands: ours holds it, at a rung that has one. */
  private get hasAtlas(): boolean {
    return this.ours && this.lamps.texture !== null;
  }

  /**
   * This frame's work handed to our renderer, which records it as the main
   * pass begins — before the main pass reads the slots `update` publishes,
   * which is what lets a static layer be published once its last face is
   * QUEUED.
   */
  private queueOurs(): void {
    const work = this.work;
    const bake = this.bakeQueue;
    for (let j = 0; j < bake.length; j++) work.bakeTiles[j] = bake[j].entry.staticBase + bake[j].face;
    work.bakes = bake.length;
    work.proxies = this.proxyCount;
    work.dynamic = this.drawDynamic;
    this.lamps.queue(work);
  }

  /** Whether the atlas can be drawn: its pipelines and the casters built (`LampAtlas.ready`). */
  private ready(): boolean {
    return this.lamps.ready;
  }

  /**
   * The lights that get tiles: what may cast, ranked MOVING before FIXTURE
   * (a moving shadow is the one the player is looking at, and the cheaper
   * one to lose is the fixture's), then by distance past the light's own
   * reach, with a light already holding tiles given `keepMargin`.
   */
  private readonly ranked: Ranked[] = [];
  /** The records behind `ranked`, reused frame to frame. */
  private readonly rankPool: Ranked[] = [];
  private readonly chosen: Entry[] = [];
  /** Every light gives its tiles back. */
  private releaseAll(): void {
    // Skipped when empty, which is every frame on the `off` rung.
    if (this.entries.size === 0) return;
    this.entries.forEach(this.releaseOne);
    this.entries.clear();
  }
  private readonly releaseOne = (e: Entry): void => this.release(e);
  /** `choose`'s release walk, bound once rather than a closure per frame. */
  private readonly dropUnwanted = (e: Entry, light: PointLightData): void => {
    if (this.wanted.has(light)) return;
    this.release(e);
    this.entries.delete(light);
  };
  /** The top of `ranked` this frame, by light — reused, never reallocated. */
  private readonly wanted = new Set<PointLightData>();
  private choose(
    active: readonly PointLightData[],
    eye: Vector3,
    tier: (typeof CONFIG.graphics.localShadows.tiers)[ShadowQuality],
  ): Entry[] {
    const c = CONFIG.graphics.localShadows;
    const ranked = this.ranked;
    ranked.length = 0;
    const slots = Math.min(active.length, MAX_POINT_LIGHTS);
    for (let i = 0; i < slots; i++) {
      const l = active[i];
      const intent = l.shadow ?? "none";
      if (intent === "none") continue;
      if (intent === "blast" && !tier.transients) continue;
      const moving = intent !== "fixture" || !tier.meshes;
      let score = Vector3.Distance(eye, l.position) - l.range;
      if (this.entries.has(l)) score -= c.keepMargin;
      if (!moving) score += 1e4;
      const r = (this.rankPool[ranked.length] ??= { e: l, score, moving });
      r.e = l;
      r.score = score;
      r.moving = moving;
      ranked.push(r);
    }
    ranked.sort(byRankScore);
    const want = Math.min(ranked.length, tier.lights);
    // Everything outside the top `want` gives its tiles back — its static
    // cache with them, which is what `keepMargin` exists to make rare — and
    // BEFORE anything is admitted. Admitting first let a light that had lost its place keep
    // its tiles through the frame a better one asked for them — and a blast,
    // which lives a third of a second, never found room at all.
    const wanted = this.wanted;
    wanted.clear();
    for (let i = 0; i < want; i++) wanted.add(ranked[i].e);
    // `forEach` rather than `for…of`: no iterator, and no [key, value]
    // tuple per entry, on a walk that runs every frame. Deleting the entry
    // being visited is safe in a Map's `forEach`.
    this.entries.forEach(this.dropUnwanted);
    const chosen = this.chosen;
    chosen.length = 0;
    for (let i = 0; i < want; i++) {
      const r = ranked[i];
      let e: Entry | null | undefined = this.entries.get(r.e);
      if (e && e.moving !== r.moving) {
        this.release(e);
        this.entries.delete(r.e);
        e = undefined;
      }
      if (!e) {
        e = this.admit(r.e, r.moving);
        // Still no room — six cube faces is a big run, and the fixtures'
        // dynamic tiles hold the rest: holders ranked BELOW this light give
        // their tiles up until it fits. Only ever downward, so no light
        // evicts one that outranks it.
        if (!e && this.evictFor(r.e.spot ? 1 : 6, ranked, i, want)) {
          e = this.admit(r.e, r.moving);
        }
        if (!e) continue;
        this.entries.set(r.e, e);
      }
      chosen.push(e);
    }
    return chosen;
  }

  /**
   * Frees a run of `n` tiles by evicting holders ranked between `above` and
   * `want`, and reports whether it did. Nothing is released until a run is
   * FOUND: the candidates are taken lowest rank first, and the first time the
   * tiles that are free or held by one of them contain `n` in a row, only the
   * holders inside that run go.
   *
   * Evicting one at a time and retrying — what this replaced — is exact while
   * every block is a six-face cube, since any victim frees a run of six. A
   * one-tile SPOT breaks that: its freed tile need not join any run, so the
   * old loop could throw away a baked static layer and still not fit the
   * newcomer.
   */
  private evictFor(n: number, ranked: readonly Ranked[], above: number, want: number): boolean {
    const victims = this.victims;
    victims.length = 0;
    const owner = this.owner;
    for (let j = want - 1; j > above; j--) {
      const v = this.entries.get(ranked[j].e);
      if (!v) continue;
      victims.push(v);
      let run = 0;
      for (let t = 0; t < this.tileCount; t++) {
        const o = owner[t];
        run = !o || victims.includes(o) ? run + 1 : 0;
        if (run < n) continue;
        for (let k = t - n + 1; k <= t; k++) {
          const o2 = owner[k];
          if (!o2) continue;
          this.release(o2);
          this.entries.delete(o2.light);
        }
        victims.length = 0;
        return true;
      }
    }
    victims.length = 0;
    return false;
  }
  /** `evictFor`'s candidates, reused. */
  private readonly victims: Entry[] = [];

  /** A new entry with its first tiles, or null when the atlas has no room. */
  private admit(light: PointLightData, moving: boolean): Entry | null {
    const faces = light.spot ? 1 : 6;
    const e: Entry = {
      light,
      moving,
      faces,
      staticBase: -1,
      dynBase: -1,
      baked: 0,
      dynDrawn: false,
      at: light.position.clone(),
      range: light.range,
      axis: light.spot ? light.spot.dir.clone() : new Vector3(0, 0, 1),
      cosOuter: light.spot?.cosOuter ?? -2,
      boxes: [],
      gatheredAt: new Vector3(Infinity, 0, 0),
      gatheredRange: 0,
      bodiesSeen: -1e9,
    };
    if (moving) {
      e.dynBase = this.alloc(faces, e);
      if (e.dynBase < 0) return null;
      this.writeFaces(e, e.dynBase);
    } else {
      e.staticBase = this.alloc(faces, e);
      if (e.staticBase < 0) return null;
      this.writeFaces(e, e.staticBase);
    }
    return e;
  }

  /**
   * Follows a light that moved: a moving one re-writes its face records every
   * frame. A FIXTURE does not move — its static layer is baked where it stood
   * when it took its tiles; a fixture that moved re-baked from scratch for the
   * map editor's drag alone, which went at `BABYLON_EXIT.md` X5.3c, and that
   * re-bake at X5.3d (no bank row, draw-log state or live check reached it).
   */
  private refresh(e: Entry): void {
    const l = e.light;
    const spot = l.spot;
    const moved =
      Vector3.DistanceSquared(l.position, e.at) > 0.0025 ||
      Math.abs(l.range - e.range) > 0.05 ||
      (spot !== undefined &&
        (Vector3.DistanceSquared(spot.dir, e.axis) > 1e-5 ||
          spot.cosOuter !== e.cosOuter));
    if (!moved) return;
    e.at.copyFrom(l.position);
    e.range = l.range;
    if (spot) {
      e.axis.copyFrom(spot.dir);
      e.cosOuter = spot.cosOuter;
    }
    if (e.dynBase >= 0) this.writeFaces(e, e.dynBase);
  }

  /** The four face records for one block of tiles. */
  private writeFaces(e: Entry, base: number): void {
    const near = CONFIG.graphics.localShadows.nearClear;
    const r = this.scratchR;
    const u = this.scratchU;
    for (let f = 0; f < e.faces; f++) {
      const fwd = e.light.spot ? e.axis : CUBE[f];
      let tanHalf = 1;
      if (e.light.spot) {
        const c = Math.min(Math.max(e.cosOuter, 0.2), 0.9999);
        tanHalf = Math.sqrt(1 - c * c) / c;
      }
      faceFrame(fwd, r, u);
      const t = base + f;
      const o = t * 16;
      const rec = this.faces;
      rec[o] = e.at.x;
      rec[o + 1] = e.at.y;
      rec[o + 2] = e.at.z;
      rec[o + 3] = e.range;
      rec[o + 4] = fwd.x;
      rec[o + 5] = fwd.y;
      rec[o + 6] = fwd.z;
      rec[o + 7] = tanHalf;
      rec[o + 8] = r.x;
      rec[o + 9] = r.y;
      rec[o + 10] = r.z;
      rec[o + 11] = t;
      rec[o + 12] = u.x;
      rec[o + 13] = u.y;
      rec[o + 14] = u.z;
      rec[o + 15] = Math.min(near, e.range * 0.5);
    }
  }

  /**
   * Whether an axis-aligned box (centre, half extents) can reach a tile's
   * face: inside the light's range and inside the face's four side planes,
   * each tested as a half-space through the light.
   *
   * The box is READ from `v` at `at` — centre then half extents, `boxBounds`'
   * own layout — rather than passed as six numbers: this runs per box per
   * face every frame, and a double handed to a call V8 does not inline is a
   * boxed number. A caller whose box is not already in an array fills
   * `probe`.
   */
  private reaches(t: number, v: Float32Array | Float64Array, at: number): boolean {
    const cx = v[at];
    const cy = v[at + 1];
    const cz = v[at + 2];
    const ex = v[at + 3];
    const ey = v[at + 4];
    const ez = v[at + 5];
    const o = t * 16;
    const f = this.faces;
    const lx = cx - f[o];
    const ly = cy - f[o + 1];
    const lz = cz - f[o + 2];
    const range = f[o + 3];
    const rad = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (lx * lx + ly * ly + lz * lz > (range + rad) ** 2) return false;
    const th = f[o + 7];
    // Side planes: forward * tanHalf +/- right, forward * tanHalf +/- up.
    for (let s = 0; s < 4; s++) {
      const a = s < 2 ? 8 : 12;
      const sign = s % 2 === 0 ? 1 : -1;
      const nx = f[o + 4] * th + sign * f[o + a];
      const ny = f[o + 5] * th + sign * f[o + a + 1];
      const nz = f[o + 6] * th + sign * f[o + a + 2];
      const d = lx * nx + ly * ny + lz * nz;
      const reach = ex * Math.abs(nx) + ey * Math.abs(ny) + ez * Math.abs(nz);
      if (d + reach < 0) return false;
    }
    return true;
  }

  /**
   * This frame's soldiers and hulls, packed once — the ones NEAREST a
   * shadowed light, not the first to arrive. A body is worth a slot only
   * while it stands inside some chosen light's reach, and on a map fielding
   * twenty-four a side more than `maxBodies` can be; so a full frame keeps the
   * bodies deepest inside a light, by the same replace-the-worst selection
   * `BodyShadows` spends its budget with, and the common frame compares
   * nothing. Hulls have their own `maxHulls` slots, as in `BodyShadows`: they
   * came after the soldiers in one shared budget and never got one.
   */
  private packBodies(
    bodies: readonly ShadowBody[],
    hulls: readonly ShadowHull[],
  ): void {
    this.bodyCount = 0;
    if (this.chosen.length === 0) return;
    const c = CONFIG.graphics.bodyShadows;
    const per = this.bodyBoxes.perBody;
    const picked = this.pickedBodies;
    const gap = this.pickedGap;
    let m = 0;
    for (const b of bodies) {
      if (!b.rig.enabled) continue;
      // The body box is 1.3 m either way of its root — see `packDynamic`. The
      // root's world position, composed fresh: its float32 translation.
      const g = this.lightGap(this.rootAt(b.rig));
      if (g > 1.5) continue;
      if (m < c.maxBodies) {
        picked[m] = b;
        gap[m] = g;
        m++;
        continue;
      }
      let worst = 0;
      for (let i = 1; i < m; i++) if (gap[i] > gap[worst]) worst = i;
      if (g >= gap[worst]) continue;
      picked[worst] = b;
      gap[worst] = g;
    }
    let n = 0;
    for (let i = 0; i < m; i++) {
      const rig = picked[i]!.rig;
      this.bodyBoxes.writeRig(rig, this.bodyMatrices, n * per);
      this.bodyBoxCount[n] = per;
      (this.bodyAt[n] ??= new Vector3()).copyFrom(this.rootAt(rig));
      n++;
      // Dropped so a pooled rig cannot be held alive by this list.
      picked[i] = null;
    }
    // A hull takes a soldier's slot and uses one box of it, so the two
    // index alike; `bodyMatrices` is sized for both budgets.
    let hullsIn = 0;
    for (const h of hulls) {
      if (hullsIn >= c.maxHulls) break;
      // The hull's own fields, never its mesh (`ShadowHull`): on the field,
      // and where its box stands as the box's matrix has it.
      if (!h.present) continue;
      const at = this.bodyBoxes.hullCentreToRef(h, this.hullAt);
      // A hull's box is 4 m either way.
      if (this.lightGap(at) > 4) continue;
      this.bodyBoxes.writeHull(h, this.bodyMatrices, n * per);
      this.bodyBoxCount[n] = 1;
      (this.bodyAt[n] ??= new Vector3()).copyFrom(at);
      n++;
      hullsIn++;
    }
    this.bodyCount = n;
  }

  /**
   * A rig's root in the world, composed fresh off its joints (the root was a
   * mesh whose `absolutePosition` this read until `BABYLON_EXIT.md` X4.1a).
   * Into one scratch vector: read it before asking again.
   */
  private rootAt(rig: ShadowBody["rig"]): Vector3 {
    const m = rig.tree.computeChain(rig.root).m;
    return this.rootScratch.set(m[12], m[13], m[14]);
  }

  /** How far `p` stands outside the nearest chosen light's reach (negative inside). */
  private lightGap(p: Vector3): number {
    let best = Infinity;
    for (const e of this.chosen) {
      best = Math.min(best, Vector3.Distance(p, e.at) - e.range);
    }
    return best;
  }

  private anyBodyWithin(at: Vector3, reach: number): boolean {
    const r2 = reach * reach;
    for (let i = 0; i < this.bodyCount; i++) {
      if (Vector3.DistanceSquared(this.bodyAt[i], at) < r2) return true;
    }
    return false;
  }

  /**
   * Whether `p` is inside box `i` itself, in the box's OWN frame. The AABB in
   * `boxBounds` is only the early-out: a 10 m wall yawed 45 degrees has a 7 m
   * square AABB, and a lamp hung 0.3 m off that wall stands inside it — so an
   * AABB verdict dropped the wall from the lamp's casters and lit the room
   * behind it. The matrix's first three rows are the box's axes scaled by its
   * size, so `p`'s coordinate along each, over that axis's squared length, is
   * in unit-box units and inside is under a half on all three.
   */
  private contains(i: number, p: Vector3): boolean {
    const m = this.boxMatrices;
    const o = i * 16;
    const dx = p.x - m[o + 12];
    const dy = p.y - m[o + 13];
    const dz = p.z - m[o + 14];
    for (let a = 0; a < 3; a++) {
      const ax = m[o + a * 4];
      const ay = m[o + a * 4 + 1];
      const az = m[o + a * 4 + 2];
      const len2 = ax * ax + ay * ay + az * az;
      if (len2 <= 0) return false;
      if (Math.abs(dx * ax + dy * ay + dz * az) >= 0.5 * len2) return false;
    }
    return true;
  }

  /** One light's dynamic layer into the proxy buffer. */
  private packDynamic(e: Entry): void {
    if (e.moving) {
      this.gather(e);
      const bb = this.boxBounds;
      for (const i of e.boxes) {
        const o = i * 6;
        for (let f = 0; f < e.faces; f++) {
          const t = e.dynBase + f;
          if (!this.reaches(t, bb, o)) continue;
          if (!this.emit(this.boxMatrices, i, t)) return;
        }
      }
    }
    const per = this.bodyBoxes.perBody;
    const probe = this.probe;
    for (let b = 0; b < this.bodyCount; b++) {
      const p = this.bodyAt[b];
      // A body as a box of 1.3 m either way of its root — a hull as 4 —
      // generous, and the fragment stage clips whatever lands outside.
      const size = this.bodyBoxCount[b] === 1 ? 4 : 1.3;
      probe[0] = p.x;
      probe[1] = p.y;
      probe[2] = p.z;
      probe[3] = size;
      probe[4] = size;
      probe[5] = size;
      for (let f = 0; f < e.faces; f++) {
        const t = e.dynBase + f;
        if (!this.reaches(t, probe, 0)) continue;
        for (let k = 0; k < this.bodyBoxCount[b]; k++) {
          if (!this.emit(this.bodyMatrices, b * per + k, t)) return;
        }
      }
    }
  }

  /** Copies one matrix into the proxy buffer for tile `t`. False when full. */
  private emit(src: Float32Array, i: number, t: number): boolean {
    if (this.proxyCount >= this.proxyTiles.length) return false;
    // A loop rather than `set(src.subarray(..))`: a subarray is a new view
    // object per call, and this is per box per face — ~5 kB a frame of them.
    const dst = this.proxyMatrices;
    const from = i * 16;
    const to = this.proxyCount * 16;
    for (let k = 0; k < 16; k++) dst[to + k] = src[from + k];
    this.proxyTiles[this.proxyCount] = t;
    this.proxyCount++;
    return true;
  }

  /**
   * The collider boxes within a moving light's reach, re-gathered only when
   * it has moved a metre — the list is a superset by that margin, and the
   * per-face test does the rest.
   */
  private gather(e: Entry): void {
    const index = this.index;
    if (!index) return;
    const slack = 1;
    if (
      Vector3.DistanceSquared(e.gatheredAt, e.at) < slack * slack &&
      e.gatheredRange >= e.range
    ) {
      return;
    }
    e.gatheredAt.copyFrom(e.at);
    e.gatheredRange = e.range;
    e.boxes.length = 0;
    const reach = e.range + slack;
    const stamp = ++this.stamp;
    const { dim, origin, cells } = index;
    const cell = (v: number) =>
      Math.max(0, Math.min(dim - 1, Math.floor((v - origin) / BOX_BUCKET)));
    const x0 = cell(e.at.x - reach);
    const x1 = cell(e.at.x + reach);
    const z0 = cell(e.at.z - reach);
    const z1 = cell(e.at.z + reach);
    const bb = this.boxBounds;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = cells[cz * dim + cx];
        if (!list) continue;
        for (const i of list) {
          if (this.boxStamp[i] === stamp) continue;
          this.boxStamp[i] = stamp;
          const o = i * 6;
          // A box the light stands INSIDE is its own housing, and would put
          // the whole light out — `nearClear`'s reason, for the proxies.
          if (
            Math.abs(e.at.x - bb[o]) < bb[o + 3] &&
            Math.abs(e.at.y - bb[o + 1]) < bb[o + 4] &&
            Math.abs(e.at.z - bb[o + 2]) < bb[o + 5] &&
            this.contains(i, e.at)
          ) {
            continue;
          }
          const dx = bb[o] - e.at.x;
          const dy = bb[o + 1] - e.at.y;
          const dz = bb[o + 2] - e.at.z;
          const rad = Math.hypot(bb[o + 3], bb[o + 4], bb[o + 5]);
          if (dx * dx + dy * dy + dz * dz > (reach + rad) ** 2) continue;
          e.boxes.push(i);
        }
      }
    }
  }

  /**
   * Re-deals the published tiles onto slots `LightingSystem` has just
   * re-ordered, for a frame that re-ran the light choice without running
   * `update` — the kit stage, whose lamps take the first slots. The tiles are
   * keyed by LIGHT, so a lantern still in the list keeps its own in its new
   * slot and a kit lamp gets none; without this, a slot keeps the tiles of
   * whichever light held it last and is shadowed against the wrong position.
   * Allocates, bakes and draws nothing.
   */
  reslot(active: readonly PointLightData[]): void {
    this.publish(active);
  }

  /**
   * Writes every slot's cone and tiles into `ShadowBindings`' arrays — every
   * slot, shadowed or not, because a spot's CONE is owed whatever the rung.
   */
  private publish(active: readonly PointLightData[]): void {
    const { spot, shade } = this.mats.shadows.localSlots;
    const n = Math.min(active.length, MAX_POINT_LIGHTS);
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const o = i * 4;
      const l = i < n ? active[i] : null;
      const cone = l?.spot;
      if (cone) {
        spot[o] = cone.dir.x;
        spot[o + 1] = cone.dir.y;
        spot[o + 2] = cone.dir.z;
        spot[o + 3] = cone.cosOuter;
        shade[o] = cone.cosInner;
      } else {
        spot[o] = 0;
        spot[o + 1] = 0;
        spot[o + 2] = 0;
        spot[o + 3] = -2;
        shade[o] = 1;
      }
      const e = l ? this.entries.get(l) : undefined;
      // A static layer is live once its last face is QUEUED: the queue is
      // drawn in this frame's render, which runs after this and before the
      // main pass that reads it.
      shade[o + 1] = e && e.staticBase >= 0 && e.baked >= e.faces ? e.staticBase : -1;
      shade[o + 2] = e && e.dynBase >= 0 && e.dynDrawn ? e.dynBase : -1;
    }
  }

  /** First-fit run of `n` free tiles, or -1. */
  private alloc(n: number, e: Entry): number {
    for (let base = 0; base + n <= this.tileCount; base++) {
      let free = true;
      for (let k = 0; k < n; k++) {
        if (this.owner[base + k]) {
          free = false;
          base += k;
          break;
        }
      }
      if (!free) continue;
      for (let k = 0; k < n; k++) this.owner[base + k] = e;
      return base;
    }
    return -1;
  }

  private freeBlock(base: number, n: number): void {
    for (let k = 0; k < n; k++) this.owner[base + k] = null;
  }

  private release(e: Entry): void {
    if (e.staticBase >= 0) this.freeBlock(e.staticBase, e.faces);
    if (e.dynBase >= 0) this.freeBlock(e.dynBase, e.faces);
    e.staticBase = -1;
    e.dynBase = -1;
  }

  dispose(): void {
    this.wrapped?.dispose();
    this.wrapped = null;
  }

  /** How many tiles are held, for the profiler and the debug overlay. */
  get tilesHeld(): number {
    let n = 0;
    for (const o of this.owner) if (o) n++;
    return n;
  }
}
