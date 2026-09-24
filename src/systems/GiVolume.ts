/**
 * GiVolume.ts — The irradiance volume: this game's answer to what Lumen does,
 * sized for a browser and cut to the cel look.
 * Owns: a camera-centred window of light probes, the compute passes that trace
 * them against the collider world (`shaders/wgsl/giTrace.ts`), the seven 3D
 * textures the cel shader reads them through, and the choice each frame of
 * which lights bounce.
 * Invariants: constructed BEFORE the first cel material, and it keeps a full
 * set of seven textures published to `CelMaterialFactory.setGi` for its whole
 * life — whatever the setting, and before any map — because every cel material
 * declares all seven and an unbound one loses the draw. It adds NO draw calls
 * (the frame is draw-call bound, `FINDINGS.md` 17): everything it does is
 * compute and three texture fetches in a shader that already runs. It reads
 * the scene's light off `CelMaterialFactory.readLighting`, never off the map,
 * so the editor's work light and a map switch reach the bounce with no second
 * path. `update` runs after `LightingSystem.update` in the same frame, because
 * it hands each of that frame's point-light slots a visibility channel.
 * Contract: `docs/rendering.md`, "The irradiance volume".
 *
 * WHAT IT IS. A grid of probes, `columns` x `columns` across and `layers` up
 * from the ground, centred on the eye and scrolling with it. Each probe holds
 * the light arriving at that point from every direction — as order-1
 * spherical harmonics: a colour, and which way the light leans — and the cel
 * shader reads the eight around a pixel instead of assuming the whole sky and
 * a flat ambient reach everything. That is bounce light (a sunlit wall warming
 * the one opposite), sky occlusion (an alley is darker than a square), and —
 * because each probe also knows which of the lights holding the sixteen
 * point-light slots it can see — lanterns that stop at walls.
 *
 * HOW IT STAYS STILL. Lumen and DDGI both randomise their rays per frame and
 * accumulate, and what that looks like is light that crawls while it
 * converges — a clock you can see, which this renderer does not allow. Here
 * every probe is traced with the SAME ray set every time, so a static scene's
 * average converges to a fixed point and then stops moving. It is still
 * CONTINUOUS: a rolling slice of the window is re-traced every frame, so a
 * broken pane, a parked tank or a lamp that has come on all reach the bounce
 * within a sweep.
 *
 * AND HOW IT MOVES WHEN IT SHOULD. A light that changes faster than that
 * sweep can follow — a muzzle flash, a blast, a thrown fire, the flicker of a
 * burning drum, the lamp a player carries — would be averaged into nothing.
 * Those are FAST lights (`RoomLight.fast`, plus every transient and carried
 * light), and they are re-bounced from scratch every frame near the eye and
 * never remembered, so their bounce rises and dies exactly with the light.
 */
import {
  Color3,
  ComputeShader,
  Constants,
  RawTexture3D,
  type Scene,
  StorageBuffer,
  Texture,
  Vector3,
  Vector4,
  type WebGPUEngine,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { GiQuality } from "../core/settings";
import {
  type CelMaterialFactory,
  GI_SAMPLER_NAMES,
  type GiBinding,
  type PointLightData,
} from "../shaders/CelShader";
import {
  GI_HULL_SLOTS,
  GI_LAYOUT,
  GI_MAX_FAST,
  GI_MAX_SLOW,
  GI_SLOTS,
  GI_STATE_VEC4,
  giComposeSource,
  giTraceSource,
  giVisSource,
} from "../shaders/wgsl/giTrace";
import type { GameMap, WorldBox } from "../world/MapBuilder";
import type { RayHull } from "../world/RayWorld";
import type { LightingSystem, RoomLight } from "./LightingSystem";

type Tier = (typeof CONFIG.gi.tiers)[keyof typeof CONFIG.gi.tiers];

/** Bucket edge of the trace's box grid, metres — `RayWorld`'s own. */
const CELL = 8;
/** Above this in either footprint axis a box is boundary, not furniture. */
const MAP_SIZED = 200;
/**
 * How far into the borderland the grid reaches. Past a few hundred metres of
 * margin nothing the window can see is standing out there, and a grid over
 * Cinderhaven's 2,000 m of it would be a quarter of a million empty cells.
 */
const GRID_REACH = 300;
/** Probes per workgroup in the two per-probe passes. */
const GROUP = 64;
/** `CONFIG.gi.hullAlbedo`, parsed once. */
const HULL_ALBEDO = Color3.FromHexString(CONFIG.gi.hullAlbedo);

type TextureName = (typeof GI_SAMPLER_NAMES)[number];

/** One light as the params buffer carries it. */
interface GiLight {
  x: number;
  y: number;
  z: number;
  range: number;
  r: number;
  g: number;
  b: number;
  /** Sort key: distance beyond the light's own reach. */
  score: number;
}

export class GiVolume {
  private quality: GiQuality;
  private tier: Tier | null = null;
  private textures: Record<TextureName, RawTexture3D>;
  private readonly binding: GiBinding;

  private trace: ComputeShader | null = null;
  private compose: ComputeShader | null = null;
  private vis: ComputeShader | null = null;

  private readonly paramData = new Float32Array(GI_LAYOUT.size * 4);
  private readonly params: StorageBuffer;
  private state: StorageBuffer | null = null;
  /** Per probe: the visibility mask and the column/validity it was traced for. */
  private visState: StorageBuffer | null = null;
  private boxes: StorageBuffer | null = null;
  private index: StorageBuffer | null = null;
  private heights: StorageBuffer | null = null;
  /** The hull slots' scratch, rewritten into the box buffer every frame. */
  private readonly hullData = new Float32Array(GI_HULL_SLOTS * 16);

  private map: GameMap | null = null;
  /** The scene half of the params — fixed per map; see `writeScene`. */
  private sceneRows = new Float32Array(16 * 4);
  private readonly floorAlbedo = new Color3(0.4, 0.4, 0.4);
  /** The highest point of the map's floor — see `marchTerrain`. */
  private topY = 0;

  /** The window's first column in world probe units, and whether placed. */
  private ox = 0;
  private oz = 0;
  private placed = false;
  private refY = 0;
  private cursor = 0;
  /** Frames left at the warm budget — a fresh map, or a jump across it. */
  private warmFrames = 0;

  private slow: GiLight[] = [];
  /** `chooseFast`'s candidates and the records behind them and `fast`. */
  private readonly fastCands: GiLight[] = [];
  private readonly candPool: GiLight[] = [];
  private readonly fastPool: GiLight[] = [];
  private candUsed = 0;
  private slowAt = new Vector3(Infinity, 0, Infinity);
  /** `LightingSystem.fixtureVersion` the slow list was chosen at; -1 forces one. */
  private slowOf = -1;
  /** The fixtures behind `slow`, entry for entry — see `slowChanged`. */
  private slowSrc: RoomLight[] = [];
  private readonly fast: GiLight[] = [];

  /**
   * Which light owns each visibility channel, and where it stood when its
   * channel was last traced. A channel is kept while its light keeps a slot,
   * so a lantern is traced once — see `assignChannels`.
   */
  private readonly chanLight: (PointLightData | null)[] = new Array(GI_SLOTS).fill(null);
  private readonly chanAt = new Float32Array(GI_SLOTS * 4);
  private readonly chanDirty = new Uint8Array(GI_SLOTS);
  private readonly chanSeen = new Int32Array(GI_SLOTS);
  private readonly chanTaken = new Uint8Array(GI_SLOTS);
  private readonly chanPending: number[] = [];
  private frame = 0;

  constructor(
    private readonly engine: WebGPUEngine,
    private readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    quality: GiQuality,
  ) {
    this.quality = quality;
    this.params = new StorageBuffer(
      engine,
      this.paramData.byteLength,
      Constants.BUFFER_CREATIONFLAG_READ | Constants.BUFFER_CREATIONFLAG_WRITE,
      "gi-params",
    );
    this.binding = {
      textures: {} as Record<TextureName, RawTexture3D>,
      grid: new Vector4(1, 1, 1, 1),
      window: new Vector4(0, 1, 0, 0),
      shade: new Vector4(0, 0, 0, 0),
      band: new Vector4(3, 1, 1, 0),
      extra: new Vector4(2, 0, 0, 0),
      slotChannel: new Float32Array(GI_SLOTS),
    };
    this.textures = this.makeTextures(null);
    this.binding.textures = this.textures;
    this.applyTier();
  }

  /** The current setting — `Game.applySettings` compares before calling in. */
  get setting(): GiQuality {
    return this.quality;
  }

  /**
   * Changes the tier. A different grid is a different set of textures, so
   * this stands a new set up, republishes it to every cel material and throws
   * the old one away — which is the one walk of the material cache this class
   * ever causes. The volume re-converges from scratch at the warm budget.
   */
  /**
   * The lightning's sky fill, 0 when no flash is up. Written into the binding's
   * own vector, which every cel material holds by reference, so nothing is
   * walked; it rides whatever the tier, `off` included — the shader answers
   * "sees the sky" where there is no volume to ask.
   */
  setFlash(amount: number): void {
    this.binding.extra.y = amount;
  }

  setQuality(q: GiQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyTier();
    if (this.map) this.uploadMap(this.map);
  }

  /**
   * The map the volume traces: its boxes and their albedo, its floor, its
   * floor's colour. Called from `installMap` after the build, so the old
   * map's buffers are simply replaced — the probes restart unconverged, and
   * spend the first sweeps at the warm budget.
   */
  setMap(map: GameMap, floorColor: string): void {
    this.map = map;
    this.floorAlbedo.copyFrom(Color3.FromHexString(floorColor));
    this.slowOf = -1;
    this.uploadMap(map);
  }

  /**
   * The standing map's boxes moved in place — the editor's drag, released.
   * Re-uploads them and starts the history again, as a fresh install does;
   * the boxes are copied to the GPU at `setMap`, so nothing else would notice.
   */
  worldMoved(): void {
    if (this.map) this.uploadMap(this.map);
  }

  /**
   * One frame: scroll the window, choose the lights, trace the slice, compose,
   * and write the point-light visibility. After `LightingSystem.update`, whose
   * slots the visibility is written against.
   */
  update(eye: Vector3, lighting: LightingSystem, hulls: readonly RayHull[]): void {
    const tier = this.tier;
    const map = this.map;
    if (!tier || !map || !this.trace || !this.compose || !this.vis) return;
    if (!this.state || !this.boxes || !this.index || !this.heights) return;

    const sp = tier.spacing;
    const n = tier.columns;
    const total = n * n * tier.layers;
    const ox = Math.floor(eye.x / sp) - Math.floor(n / 2);
    const oz = Math.floor(eye.z / sp) - Math.floor(n / 2);
    if (!this.placed || ox !== this.ox || oz !== this.oz) {
      const jump = this.placed ? Math.max(Math.abs(ox - this.ox), Math.abs(oz - this.oz)) : n;
      // A jump of more than half the window is a new window, not a scrolled
      // one: nearly every probe now stands for a column it has never traced.
      if (jump > n / 2) this.warmFrames = this.sweepFrames(tier, total) * 2;
      this.ox = ox;
      this.oz = oz;
      this.placed = true;
      // The height the stored floors are relative to — keeps them inside
      // half-float precision whatever the map's altitude.
      this.refY = Math.round(map.terrain.heightAt(eye.x, eye.z));
      const half = ((n - 1) / 2) * sp;
      this.binding.window.set(
        (ox + (n - 1) / 2) * sp,
        half,
        (oz + (n - 1) / 2) * sp,
        this.refY,
      );
    }

    this.chooseSlow(lighting, tier);
    this.chooseFast(eye, lighting);
    this.writeHulls(hulls);
    this.assignChannels(lighting.activeLights);
    const budget = Math.min(
      total,
      this.warmFrames > 0 ? tier.warmProbesPerFrame : tier.probesPerFrame,
    );
    if (this.warmFrames > 0) this.warmFrames--;
    this.writeParams(tier, total, hulls.length);

    // Nothing is advanced until the three pipelines exist: a dispatch before
    // its shader has compiled returns false and did nothing, and a cursor
    // that moved anyway would skip the slice it thinks it traced.
    if (!this.trace.isReady() || !this.compose.isReady() || !this.vis.isReady()) {
      return;
    }
    this.trace.dispatch(budget, 1, 1);
    this.cursor = (this.cursor + budget) % total;
    const groups = Math.ceil(total / GROUP);
    this.compose.dispatch(groups, 1, 1);
    this.vis.dispatch(groups, 1, 1);
    // Only now is a channel's trace recorded, so a frame that returned early
    // above leaves its dirty channels dirty for the next one.
    this.chanDirty.fill(0);
    this.binding.shade.w = 1;
  }

  dispose(): void {
    this.disposeTier();
    for (const t of Object.values(this.textures)) t.dispose();
    this.params.dispose();
    this.disposeMapBuffers();
  }

  // --- the tier -------------------------------------------------------------

  private applyTier(): void {
    this.disposeTier();
    const tier = this.quality === "off" ? null : CONFIG.gi.tiers[this.quality];
    this.tier = tier;
    const old = this.textures;
    this.textures = this.makeTextures(tier);
    this.binding.textures = this.textures;
    const g = CONFIG.gi;
    if (tier) {
      this.binding.grid.set(
        1 / tier.spacing,
        tier.columns,
        tier.layers,
        1 / (tier.layerHeight * tier.layers),
      );
      this.binding.band.set(
        g.bands,
        1,
        g.normalOffset * tier.spacing,
        g.pointOcclusion ? 1 : 0,
      );
      this.buildShaders(tier);
      const total = tier.columns * tier.columns * tier.layers;
      this.state = new StorageBuffer(
        this.engine,
        total * GI_STATE_VEC4 * 16,
        Constants.BUFFER_CREATIONFLAG_READWRITE,
        "gi-state",
      );
      this.visState = new StorageBuffer(
        this.engine,
        total * 16,
        Constants.BUFFER_CREATIONFLAG_READWRITE,
        "gi-vis",
      );
      this.forgetChannels();
      this.cursor = 0;
      this.placed = false;
      this.warmFrames = this.sweepFrames(tier, total) * 2;
    }
    this.binding.shade.set(g.strength, g.floor, g.aoKeep, 0);
    this.binding.extra.set(g.bandSpan, 0, 0, 0);
    this.mats.setGi(this.binding);
    // After the republish, so no material is ever left holding a disposed one.
    if (old !== this.textures) for (const t of Object.values(old)) t.dispose();
    this.bindShaders();
  }

  private disposeTier(): void {
    this.state?.dispose();
    this.state = null;
    this.visState?.dispose();
    this.visState = null;
    // ComputeShader has no dispose of its own; dropping it releases the
    // pipeline with the effect cache.
    this.trace = null;
    this.compose = null;
    this.vis = null;
  }

  /** How many warm frames one sweep of the window takes. */
  private sweepFrames(tier: Tier, total: number): number {
    return Math.ceil(total / tier.warmProbesPerFrame);
  }

  /**
   * The seven textures, at the tier's size — or a single texel each when the
   * setting is off, because they have to EXIST either way.
   */
  private makeTextures(tier: Tier | null): Record<TextureName, RawTexture3D> {
    const n = tier ? tier.columns : 1;
    const l = tier ? tier.layers : 1;
    const make = (name: string, half: boolean): RawTexture3D => {
      const tex = new RawTexture3D(
        null,
        n,
        l,
        n,
        Constants.TEXTUREFORMAT_RGBA,
        this.scene,
        false,
        false,
        Texture.BILINEAR_SAMPLINGMODE,
        half ? Constants.TEXTURETYPE_HALF_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE,
        Constants.TEXTURE_CREATIONFLAG_STORAGE,
      );
      tex.name = `gi-${name}`;
      // Toroidal across, clamped up: see `celGi` for why the hardware's own
      // wrap is the whole of the scrolling window's addressing.
      tex.wrapU = Texture.WRAP_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      tex.wrapR = Texture.WRAP_ADDRESSMODE;
      return tex;
    };
    return {
      giIrr: make("irr", true),
      giDir: make("dir", true),
      giAux: make("aux", false),
      giVis0: make("vis0", false),
      giVis1: make("vis1", false),
      giVis2: make("vis2", false),
      giVis3: make("vis3", false),
    };
  }

  private buildShaders(tier: Tier): void {
    const common = {
      P: { group: 0, binding: 0 },
      B: { group: 0, binding: 1 },
      I: { group: 0, binding: 2 },
      H: { group: 0, binding: 3 },
      S: { group: 0, binding: 4 },
    };
    this.trace = new ComputeShader(
      "gi-trace",
      this.engine,
      { computeSource: giTraceSource(tier.rays) },
      {
        bindingsMapping: common,
      },
    );
    this.compose = new ComputeShader(
      "gi-compose",
      this.engine,
      { computeSource: giComposeSource(tier.fastRays) },
      {
        bindingsMapping: {
          ...common,
          outIrr: { group: 0, binding: 5 },
          outDir: { group: 0, binding: 6 },
          outAux: { group: 0, binding: 7 },
        },
      },
    );
    this.vis = new ComputeShader(
      "gi-vis",
      this.engine,
      { computeSource: giVisSource() },
      {
        bindingsMapping: {
          ...common,
          V: { group: 0, binding: 5 },
          outVis0: { group: 0, binding: 6 },
          outVis1: { group: 0, binding: 7 },
          outVis2: { group: 0, binding: 8 },
          outVis3: { group: 0, binding: 9 },
        },
      },
    );
  }

  /** Hands every pass what it reads and writes. Re-run whenever one changes. */
  private bindShaders(): void {
    const { trace, compose, vis, state, visState, boxes, index, heights } = this;
    if (!trace || !compose || !vis || !state || !visState || !boxes || !index || !heights) {
      return;
    }
    for (const cs of [trace, compose, vis]) {
      cs.setStorageBuffer("P", this.params);
      cs.setStorageBuffer("B", boxes);
      cs.setStorageBuffer("I", index);
      cs.setStorageBuffer("H", heights);
      cs.setStorageBuffer("S", state);
    }
    const t = this.textures;
    compose.setStorageTexture("outIrr", t.giIrr);
    compose.setStorageTexture("outDir", t.giDir);
    compose.setStorageTexture("outAux", t.giAux);
    vis.setStorageBuffer("V", visState);
    vis.setStorageTexture("outVis0", t.giVis0);
    vis.setStorageTexture("outVis1", t.giVis1);
    vis.setStorageTexture("outVis2", t.giVis2);
    vis.setStorageTexture("outVis3", t.giVis3);
  }

  // --- the map --------------------------------------------------------------

  private disposeMapBuffers(): void {
    this.boxes?.dispose();
    this.index?.dispose();
    this.heights?.dispose();
    this.boxes = null;
    this.index = null;
    this.heights = null;
  }

  /**
   * Uploads a map's traceable world: the boxes a ray can stop on (the
   * ordinary colliders — not a fence's porous run, not glass, which light goes
   * through), a uniform grid over them, and the heightfield.
   */
  private uploadMap(map: GameMap): void {
    this.disposeMapBuffers();
    this.binding.shade.w = 0;
    if (!this.tier) return;

    const all = map.colliderBoxes;
    const albedo = map.colliderAlbedo;
    const statics: { box: WorldBox; at: number }[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].porous) continue;
      statics.push({ box: all[i], at: i });
    }

    const reach = Math.min(map.margin, GRID_REACH);
    const extent = map.size + 2 * reach;
    const dim = Math.ceil(extent / CELL) + 2;
    const origin = -extent / 2 - CELL;
    const cellOf = (v: number): number => {
      const c = Math.floor((v - origin) / CELL);
      return c < 0 ? 0 : c > dim - 1 ? dim - 1 : c;
    };

    const boxData = new Float32Array((GI_HULL_SLOTS + statics.length) * 16);
    const counts = new Uint32Array(dim * dim + 1);
    const big: number[] = [];
    const footprints: [number, number, number, number][] = [];
    statics.forEach(({ box, at }, k) => {
      const bi = GI_HULL_SLOTS + k;
      writeBox(boxData, bi, box);
      const o = bi * 16 + 12;
      if (albedo && albedo.length >= at * 3 + 3) {
        boxData[o] = albedo[at * 3];
        boxData[o + 1] = albedo[at * 3 + 1];
        boxData[o + 2] = albedo[at * 3 + 2];
      } else {
        boxData[o] = boxData[o + 1] = boxData[o + 2] = 0.45;
      }
      if (box.w > MAP_SIZED || box.d > MAP_SIZED) {
        big.push(bi);
        footprints.push([1, 0, 0, -1]);
        return;
      }
      // `RayWorld.eachCell`'s footprint: the yawed extents grown by the pitch.
      const c = Math.abs(Math.cos(box.rotY));
      const s = Math.abs(Math.sin(box.rotY));
      const hw = box.w / 2;
      const hd =
        (box.d / 2) * Math.abs(Math.cos(box.rotX)) +
        (box.h / 2) * Math.abs(Math.sin(box.rotX));
      const x0 = cellOf(box.cx - (hw * c + hd * s));
      const x1 = cellOf(box.cx + (hw * c + hd * s));
      const z0 = cellOf(box.cz - (hw * s + hd * c));
      const z1 = cellOf(box.cz + (hw * s + hd * c));
      footprints.push([x0, x1, z0, z1]);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) counts[cz * dim + cx + 1]++;
      }
    });
    for (let c = 0; c < dim * dim; c++) counts[c + 1] += counts[c];
    const cellBoxOff = dim * dim + 1;
    const entries = counts[dim * dim];
    const bigOff = cellBoxOff + entries;
    const idx = new Uint32Array(bigOff + Math.max(big.length, 1));
    idx.set(counts, 0);
    const cursor = counts.slice(0, dim * dim);
    footprints.forEach(([x0, x1, z0, z1], k) => {
      if (z1 < z0) return;
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          idx[cellBoxOff + cursor[cz * dim + cx]++] = GI_HULL_SLOTS + k;
        }
      }
    });
    idx.set(big, bigOff);

    this.boxes = new StorageBuffer(
      this.engine,
      boxData.byteLength,
      Constants.BUFFER_CREATIONFLAG_READ | Constants.BUFFER_CREATIONFLAG_WRITE,
      "gi-boxes",
    );
    this.boxes.update(boxData);
    this.index = new StorageBuffer(
      this.engine,
      idx.byteLength,
      Constants.BUFFER_CREATIONFLAG_READ | Constants.BUFFER_CREATIONFLAG_WRITE,
      "gi-index",
    );
    this.index.update(idx);

    const f = map.terrain.field;
    const hData = f ? Float32Array.from(f.heights) : new Float32Array(4);
    let top = 0;
    for (let i = 0; i < hData.length; i++) if (hData[i] > top) top = hData[i];
    this.topY = top;
    this.heights = new StorageBuffer(
      this.engine,
      hData.byteLength,
      Constants.BUFFER_CREATIONFLAG_READ | Constants.BUFFER_CREATIONFLAG_WRITE,
      "gi-heights",
    );
    this.heights.update(hData);

    const rows = this.sceneRows;
    rows.fill(0);
    rows.set([origin, origin, CELL, dim], 0);
    rows.set([big.length, statics.length, cellBoxOff, bigOff], 4);
    rows.set(
      f ? [f.size, f.cell, (f.size * f.cell) / 2, 0] : [1, 1, map.size / 2, 1],
      8,
    );

    // A fresh history: every probe starts unconverged, and so stale.
    this.state?.clear();
    this.visState?.clear();
    this.forgetChannels();
    this.cursor = 0;
    this.placed = false;
    this.warmFrames = this.sweepFrames(this.tier, this.total()) * 2;
    this.bindShaders();
  }

  private total(): number {
    const t = this.tier;
    return t ? t.columns * t.columns * t.layers : 0;
  }

  // --- the lights -----------------------------------------------------------

  /**
   * The steady fixtures the trace lights its hits with: every non-fast
   * fixture whose reach touches the window, nearest the window's centre
   * first. Re-chosen when the window has moved a block, when the fixture SET
   * has changed (`fixtureVersion` — a count misses a fire going out on the
   * frame another is lit), or when a chosen fixture has itself moved or been
   * re-lit in place; not every frame — it is the input to an average.
   */
  private chooseSlow(lighting: LightingSystem, tier: Tier): void {
    const w = this.binding.window;
    const fixtures = lighting.fixtures;
    const moved =
      Math.max(Math.abs(w.x - this.slowAt.x), Math.abs(w.z - this.slowAt.z)) >
      tier.spacing * 4;
    if (!moved && lighting.fixtureVersion === this.slowOf && !this.slowChanged()) return;
    this.slowAt.set(w.x, 0, w.z);
    this.slowOf = lighting.fixtureVersion;
    const out: GiLight[] = [];
    const src = new Map<GiLight, RoomLight>();
    for (const l of fixtures) {
      if (l.fast) continue;
      const far = Math.max(Math.abs(l.position.x - w.x), Math.abs(l.position.z - w.z));
      if (far > w.y + l.range) continue;
      const g = lightOf(l, l.baseIntensity, far);
      src.set(g, l);
      out.push(g);
    }
    out.sort(byScore);
    this.slow = out.slice(0, Math.min(CONFIG.gi.slowLights, GI_MAX_SLOW));
    this.slowSrc = this.slow.map((g) => src.get(g)!);
  }

  /**
   * Whether a chosen fixture no longer matches what was taken of it — moved,
   * re-ranged or re-lit in place. Only the chosen few are compared, which is
   * the whole of the per-frame cost; its BASE intensity, since the flicker is
   * the fast layer's.
   */
  private slowChanged(): boolean {
    const slow = this.slow;
    const src = this.slowSrc;
    for (let i = 0; i < slow.length; i++) {
      const g = slow[i];
      const l = src[i];
      const k = l.baseIntensity;
      if (
        g.x !== l.position.x ||
        g.y !== l.position.y ||
        g.z !== l.position.z ||
        g.range !== l.range ||
        g.r !== l.color.r * k ||
        g.g !== l.color.g * k ||
        g.b !== l.color.b * k
      ) {
        return true;
      }
    }
    return false;
  }

  /** The next free candidate record from the pool. */
  private takeCand(): GiLight {
    return (this.candPool[this.candUsed++] ??= blankLight());
  }

  /**
   * This frame's fast lights: the pulses, the carried lights, anything
   * registered `fast`, and the FLICKER of the steady fires nearest the eye —
   * as the difference from their base, since the base is already bounced by
   * the slow layer. Clustered, so a spreading fire costs one light, and
   * nearest the eye first.
   */
  private chooseFast(eye: Vector3, lighting: LightingSystem): void {
    // Every record here is POOLED: this runs every frame, and a candidate
    // object, a closure and a spread per light is garbage per frame.
    // And no DOUBLE crosses a call: a number handed to or returned from a
    // function V8 does not inline is boxed, and `Vector3.Distance`, a score
    // argument and `Object.assign` were ~3 kB a frame of exactly that. So the
    // distances are inline arithmetic and `fillCand` takes objects and a flag.
    const cands = this.fastCands;
    cands.length = 0;
    this.candUsed = 0;
    // Indexed loops, not `for...of`: on the tier this function runs at, an
    // array iterator is an allocation per loop, and the cluster test's inner
    // loop runs once per candidate.
    const transients = lighting.transients;
    for (let i = 0; i < transients.length; i++) this.fillCand(transients[i], eye, false);
    const carried = lighting.carriedLights;
    for (let i = 0; i < carried.length; i++) this.fillCand(carried[i], eye, false);
    const fixtures = lighting.fixtures;
    for (let i = 0; i < fixtures.length; i++) {
      const l = fixtures[i];
      const kind = this.fastKind(l, eye);
      if (kind !== FAST_NONE) this.fillCand(l, eye, kind === FAST_FLICKER);
    }
    sortByScore(cands);
    const cluster2 = CONFIG.gi.fastCluster * CONFIG.gi.fastCluster;
    const cap = Math.min(CONFIG.gi.fastLights, GI_MAX_FAST);
    const fast = this.fast;
    fast.length = 0;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      let into: GiLight | null = null;
      for (let j = 0; j < fast.length; j++) {
        const f = fast[j];
        const dx = f.x - c.x;
        const dy = f.y - c.y;
        const dz = f.z - c.z;
        if (dx * dx + dy * dy + dz * dz < cluster2) {
          into = f;
          break;
        }
      }
      if (into) {
        // Weighted by how much light each carries, so the merged light stands
        // where the fire is brightest.
        const wa = Math.abs(into.r + into.g + into.b) + 1e-4;
        const wb = Math.abs(c.r + c.g + c.b) + 1e-4;
        const k = wb / (wa + wb);
        into.x += (c.x - into.x) * k;
        into.y += (c.y - into.y) * k;
        into.z += (c.z - into.z) * k;
        into.r += c.r;
        into.g += c.g;
        into.b += c.b;
        into.range = Math.max(into.range, c.range);
        continue;
      }
      if (fast.length >= cap) continue;
      // A copy, because a merge writes into it and the candidate is pooled.
      fast.push(copyLight((this.fastPool[fast.length] ??= blankLight()), c));
    }
  }

  /**
   * Whether a fixture is a fast candidate this frame, and which kind — an
   * integer, and no double in or out. It is its own method for the JIT rather
   * than for the reader: `chooseFast` runs once a frame and V8 leaves it on
   * its mid tier, which does not inline `Vector3`'s getters, so every
   * `position.x` there was a boxed number — ~6 kB a frame over Hollowmere's
   * fixtures, measured. Called once per fixture, this reaches the top tier,
   * where the getters inline and nothing is boxed.
   */
  private fastKind(l: RoomLight, eye: Vector3): number {
    const p = l.position;
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d - l.range > this.binding.window.y) return FAST_NONE;
    if (l.fast) return FAST_WHOLE;
    return l.flicker > 0 && d < CONFIG.gi.flickerReach ? FAST_FLICKER : FAST_NONE;
  }

  /**
   * One pooled candidate for `chooseFast`, scored nearest-first past its own
   * reach. `flicker` takes only what the flame adds over its base, which the
   * slow layer already bounces. Computes its own distance rather than taking
   * one, so no double is passed in (see `chooseFast`).
   */
  private fillCand(l: PointLightData, eye: Vector3, flicker: boolean): void {
    const c = this.takeCand();
    const p = l.position;
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const k = flicker ? l.intensity - (l as RoomLight).baseIntensity : l.intensity;
    c.x = p.x;
    c.y = p.y;
    c.z = p.z;
    c.range = l.range;
    c.r = l.color.r * k;
    c.g = l.color.g * k;
    c.b = l.color.b * k;
    c.score = Math.sqrt(dx * dx + dy * dy + dz * dz) - l.range;
    this.fastCands.push(c);
  }

  /**
   * Hands each light holding a slot this frame a visibility CHANNEL, and marks
   * the channels whose trace is out of date.
   *
   * **A channel follows a light, not a slot**, which is the whole of why the
   * visibility pass is cheap: `LightingSystem` orders its slots transients
   * first, so one muzzle flash would shift every lantern down a slot and — if
   * the answer were per slot — re-trace all sixteen. Here a lantern keeps its
   * channel for as long as it keeps a slot, and is traced again only if it
   * MOVES (the carried lamp, every frame it walks). A light that has lost its
   * slot leaves its channel to the next newcomer, oldest-unused first, so a
   * lantern flickering in and out of the nearest sixteen usually finds its
   * old answer still there.
   */
  private assignChannels(slots: readonly PointLightData[]): void {
    const frame = ++this.frame;
    const map = this.binding.slotChannel;
    const count = Math.min(slots.length, GI_SLOTS);
    map.fill(0);
    const taken = this.chanTaken;
    taken.fill(0);
    const pending = this.chanPending;
    pending.length = 0;
    for (let i = 0; i < count; i++) {
      const ch = this.chanLight.indexOf(slots[i]);
      if (ch < 0) {
        pending.push(i);
        continue;
      }
      taken[ch] = 1;
      map[i] = ch;
      this.chanSeen[ch] = frame;
      this.stamp(ch, slots[i]);
    }
    for (const i of pending) {
      // The free channel that has gone unused longest.
      let best = -1;
      for (let ch = 0; ch < GI_SLOTS; ch++) {
        if (taken[ch]) continue;
        if (best < 0 || this.chanSeen[ch] < this.chanSeen[best]) best = ch;
      }
      taken[best] = 1;
      map[i] = best;
      this.chanLight[best] = slots[i];
      this.chanSeen[best] = frame;
      this.chanDirty[best] = 1;
      this.stamp(best, slots[i]);
    }
  }

  /** Records where a channel's light stands, dirtying it if it has moved. */
  private stamp(ch: number, l: PointLightData): void {
    const a = this.chanAt;
    const o = ch * 4;
    // NaN compares false, so a fresh channel reads as not moved here — which
    // is why a newcomer is dirtied by its caller rather than by this test.
    const moved =
      Math.abs(a[o] - l.position.x) > 0.05 ||
      Math.abs(a[o + 1] - l.position.y) > 0.05 ||
      Math.abs(a[o + 2] - l.position.z) > 0.05 ||
      Math.abs(a[o + 3] - l.range) > 0.05;
    a[o] = l.position.x;
    a[o + 1] = l.position.y;
    a[o + 2] = l.position.z;
    a[o + 3] = l.range;
    if (moved) this.chanDirty[ch] = 1;
  }

  /** Every channel unowned and dirty — a fresh map, a fresh tier. */
  private forgetChannels(): void {
    this.chanLight.fill(null);
    this.chanAt.fill(0);
    this.chanDirty.fill(1);
    this.chanSeen.fill(0);
  }

  /** Rewrites the hull slots at the front of the box buffer. */
  private writeHulls(hulls: readonly RayHull[]): void {
    if (!this.boxes) return;
    const data = this.hullData;
    data.fill(0);
    const albedo = HULL_ALBEDO;
    const count = Math.min(hulls.length, GI_HULL_SLOTS);
    for (let i = 0; i < count; i++) {
      const box = hulls[i].rayBox();
      if (!box) continue;
      writeBox(data, i, box);
      data[i * 16 + 12] = albedo.r;
      data[i * 16 + 13] = albedo.g;
      data[i * 16 + 14] = albedo.b;
    }
    this.boxes.update(data, 0);
  }

  /**
   * The whole params buffer for this frame: the map's rows, the light the
   * surfaces are lit by (read live, so the editor's work light reaches the
   * bounce), the window, and the three light lists.
   */
  private writeParams(tier: Tier, total: number, hullCount: number): void {
    const p = this.paramData;
    const g = CONFIG.gi;
    p.fill(0);
    p.set(this.sceneRows, GI_LAYOUT.scene * 4);
    const lit = this.mats.readLighting();
    const d = lit.lightDir;
    const s = GI_LAYOUT.scene * 4;
    const fa = this.floorAlbedo;
    // Written element by element rather than through `set([...])`: this runs
    // every frame, and an array literal per row is garbage per frame.
    put4(p, s + 12, d.x, d.y, d.z, g.rayLength);
    put4(p, s + 16, lit.lightColor.r, lit.lightColor.g, lit.lightColor.b, g.sunRayLength);
    put4(p, s + 20, lit.ambient.r, lit.ambient.g, lit.ambient.b, g.lightClearance);
    put4(p, s + 24, lit.sky.r, lit.sky.g, lit.sky.b, g.blend);
    put4(p, s + 28, fa.r, fa.g, fa.b, this.topY);
    put4(p, s + 32, tier.spacing, tier.columns, tier.layers, tier.layerHeight);
    put4(
      p,
      s + 36,
      this.slow.length,
      this.fast.length,
      0,
      Math.min(hullCount, GI_HULL_SLOTS),
    );
    put4(p, s + 40, this.ox, this.oz, this.refY, total);
    put4(p, s + 44, this.cursor, 0, 0, 0);

    for (let i = 0; i < this.slow.length; i++) {
      writeLight(p, (GI_LAYOUT.slow + i * 2) * 4, this.slow[i]);
    }
    for (let i = 0; i < this.fast.length; i++) {
      writeLight(p, (GI_LAYOUT.fast + i * 2) * 4, this.fast[i]);
    }
    // The visibility channels: where each one's light stands, whether it
    // must be re-traced this frame, and whether it has a light at all.
    for (let i = 0; i < GI_SLOTS; i++) {
      const o = (GI_LAYOUT.slots + i * 2) * 4;
      p[o] = this.chanAt[i * 4];
      p[o + 1] = this.chanAt[i * 4 + 1];
      p[o + 2] = this.chanAt[i * 4 + 2];
      p[o + 3] = this.chanAt[i * 4 + 3];
      p[o + 4] = this.chanDirty[i];
      p[o + 5] = this.chanLight[i] ? 1 : 0;
    }
    this.params.update(p);

    // The band reference: the unoccluded sky's own brightness, so the traced
    // term's steps land where the flat sky fill's used to.
    const ref =
      0.2126 * (lit.ambient.r + lit.sky.r) +
      0.7152 * (lit.ambient.g + lit.sky.g) +
      0.0722 * (lit.ambient.b + lit.sky.b);
    this.binding.band.y = 1 / Math.max(ref, 1e-3);
  }
}

function put4(p: Float32Array, o: number, a: number, b: number, c: number, d: number): void {
  p[o] = a;
  p[o + 1] = b;
  p[o + 2] = c;
  p[o + 3] = d;
}

function lightOf(l: PointLightData, intensity: number, score: number): GiLight {
  return lightInto(blankLight(), l, intensity, score);
}

/** `GiVolume.fastKind`'s answers. */
const FAST_NONE = 0;
const FAST_WHOLE = 1;
const FAST_FLICKER = 2;

function blankLight(): GiLight {
  return { x: 0, y: 0, z: 0, range: 0, r: 0, g: 0, b: 0, score: 0 };
}

/** `Object.assign` for a `GiLight`, field by field so nothing is boxed. */
function copyLight(out: GiLight, src: GiLight): GiLight {
  out.x = src.x;
  out.y = src.y;
  out.z = src.z;
  out.range = src.range;
  out.r = src.r;
  out.g = src.g;
  out.b = src.b;
  out.score = src.score;
  return out;
}

/** Writes `l` into `out` and hands it back — `lightOf` without the object. */
function lightInto(
  out: GiLight,
  l: PointLightData,
  intensity: number,
  score: number,
): GiLight {
  out.x = l.position.x;
  out.y = l.position.y;
  out.z = l.position.z;
  out.range = l.range;
  out.r = l.color.r * intensity;
  out.g = l.color.g * intensity;
  out.b = l.color.b * intensity;
  out.score = score;
  return out;
}

function byScore(a: GiLight, b: GiLight): number {
  return a.score - b.score;
}

/**
 * `byScore` as an in-place INSERTION sort, for the per-frame list: V8's
 * `Array.prototype.sort` allocates a work array on every call, and the fast
 * candidates are a handful of lights. Stable, as `sort` is.
 */
function sortByScore(list: GiLight[]): void {
  for (let i = 1; i < list.length; i++) {
    const c = list[i];
    let j = i - 1;
    while (j >= 0 && list[j].score > c.score) {
      list[j + 1] = list[j];
      j--;
    }
    list[j + 1] = c;
  }
}

function writeLight(p: Float32Array, o: number, l: GiLight): void {
  p[o] = l.x;
  p[o + 1] = l.y;
  p[o + 2] = l.z;
  p[o + 3] = l.range;
  p[o + 4] = l.r;
  p[o + 5] = l.g;
  p[o + 6] = l.b;
}

/** One box as the trace reads it: centre and yaw, half extents, pitch, alive. */
function writeBox(data: Float32Array, bi: number, box: WorldBox): void {
  const o = bi * 16;
  data[o] = box.cx;
  data[o + 1] = box.cy;
  data[o + 2] = box.cz;
  data[o + 3] = Math.cos(box.rotY);
  data[o + 4] = box.w / 2;
  data[o + 5] = box.h / 2;
  data[o + 6] = box.d / 2;
  data[o + 7] = Math.sin(box.rotY);
  data[o + 8] = Math.cos(box.rotX);
  data[o + 9] = Math.sin(box.rotX);
  data[o + 10] = 1;
  data[o + 11] = 0;
}
