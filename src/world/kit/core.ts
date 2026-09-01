/**
 * kit/core.ts — Shared foundation for the parametric structure builders:
 * the Structure/BoxSpec/BuildParams/LocalLight types, the village palette,
 * and the Build accumulator every builder uses.
 *
 * Contract (applies to every builder in this directory):
 * - Builders assemble geometry AT THE ORIGIN, UNROTATED and return parallel
 *   local-space lists (meshes / colliders / lights). MapBuilder merges the
 *   meshes per colour and then transforms all three into place — building at
 *   identity is what makes MergeMeshes safe (same trick as
 *   RifleModel.buildRifle).
 * - A builder may take a BuildCtx to read where it is about to end up (the
 *   road bends onto the ground under it). That is a licence to SAMPLE the
 *   world, not to build in it: the geometry returned is still origin-local,
 *   because MapBuilder still rotates and translates it.
 * - Geometry here is a PART, not a mesh in the ordinary sense: `Build` makes
 *   everything through `world/parts.ts`, so a part holds its vertices and has
 *   no device buffer, no bounding info and no submesh. It may be read,
 *   transformed, merged and disposed, and may never be DRAWN, PICKED or
 *   COLLIDED WITH — uploading parts a merge throws away was half of a 1500 m
 *   build (`FINDINGS.md` 24). Anything new here uses those factories; a raw
 *   `MeshBuilder` call puts its geometry on the device on the way to being
 *   thrown away, and buys back its share of that silently.
 * - Builders NEVER set metadata.solid, checkCollisions, or isPickable — the
 *   visual/collider split is MapBuilder's job; builders only declare where
 *   collider boxes go, and what kind: `BoxSpec.porous` is the one property of
 *   a collider a builder decides, because only the builder knows its box is
 *   standing in for a shape that is mostly gaps.
 * - Collider top faces must stay within CONFIG.nav.stepHeight of adjacent
 *   ground or the nav flood fill never reaches them. Ramp colliders need
 *   rotX, not just the visual.
 * - A rail at the edge of a walkable surface is `guard()`, never a bare `box()`
 *   and never a `wall()` on the edge itself. It has to be solid (a rail you
 *   walk through is a fall) AND it has to stand off the surface (a rail on it
 *   costs the nav grid a cell). That method owns the argument; the watchtower,
 *   the bridge and the barn were each written the wrong way first.
 * - No Hollowmere special-casing; register new builders in
 *   BuildingKit.ts's BUILDERS.
 */
import { Mesh, Scene, VertexData } from "@babylonjs/core";
import type { ShaderMaterial } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type {
  CelMaterialFactory,
  TranslucencySpec,
} from "../../shaders/CelShader";
import type { LightSpec } from "../environment";
import { partBox, partCylinder, partSurface } from "../parts";
import type { TerrainField } from "../TerrainField";
import {
  COBBLE_TEX_SCALE,
  getCobblestoneBumpTexture,
  getCobblestoneTexture,
} from "../textures";

/**
 * A collider box in the structure's local space. `rotX` exists for ramps —
 * an inclined collider is what lets the player's ground probe walk up one.
 */
export interface BoxSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  rotX?: number;
  rotY?: number;
  /**
   * A box that stops a BODY but not a ROUND: rounds, sightlines, grenades and
   * blast fragments pass straight through it. Movement, the nav graph, the
   * obstacle field and the ground probe are unchanged — a porous box is as
   * solid to walk into and to stand on as any other.
   *
   * This exists for open-frame geometry, whose collider is honest about the
   * silhouette and a lie about the surface. A fence run is the case it was
   * added for: one box the length of the run, 1.4 m of it, standing in for two
   * 0.12 m rails and a post every 2.5 m. To a body that box is the fence; to a
   * bullet it is a wall across ground that is nine parts air, and the shot
   * stopping in mid-air between two rails is the bug this answers.
   *
   * The cost is the other half of the same approximation and is deliberate: a
   * round aimed at a post passes through it too. The alternative is a collider
   * per post and per rail — some 160 more boxes on Hollowmere against the 824
   * it has, on every ray in the game — to catch hits on 0.18 m of timber at a
   * distance where the crosshair covers it.
   *
   * Porous is also not COVER: `CoverMap` skips these boxes entirely, or bots
   * would take cover behind something that stops nothing.
   *
   * What catches the rounds instead is `strut`: the timber is declared as its
   * own ray geometry, so a shot that hits a post stops on the post and one
   * aimed between the rails goes through. The pair is the whole design — the
   * coarse box owns the BODY, the struts own the ROUND — and a porous box
   * without struts is a fence rounds pass through entirely.
   */
  porous?: true;

  /**
   * Stops a round and a sightline, and is not a body at all: no
   * `checkCollisions`, invisible to `SOLID_ONLY`, and — the part with teeth —
   * **no `WorldBox`**, so the nav grid, the cover bake, the obstacle field and
   * the AO bake never see it. Declared by `Build.strut`, which is where the
   * reasoning lives.
   *
   * The exemption from navigation is what makes it safe to describe geometry
   * this fine. `NavGrid` samples one column per 1.5 m cell, so a 0.1 m rail is
   * a shape it can only get wrong: it invents a standable surface at rail
   * height that the flood fill can never reach, and can silently overflow
   * `MAX_SURFACES` where it lands. A strut is only ever ray geometry, and the
   * coarse box beside it is what navigation reads.
   */
  rayOnly?: true;

  /**
   * A `porous` box that can stop being one: the collider half of a BREAKABLE
   * pane. Declared by `Build.pane({ breakable: true })` and by nothing else.
   *
   * Intact, it is exactly `porous` — a body walks into it, a round goes
   * through — which is why the two pick predicates in `solid.ts` need no new
   * term for glass at all. Broken, `GlassSystem` clears `solid` outright and
   * it leaves both. That is the whole of the mechanism; the flag exists so the
   * things that must NOT see a pane can name it.
   *
   * Three of them: `CoverMap` (bots would take cover behind a window),
   * `vertexShading` (glass casts no ambient shadow), and the collision bake,
   * which carries the flag to the server so both sides can break the same pane.
   *
   * A pane is the ONE mutable thing in the world layer, and monotonically so —
   * it only ever goes from blocking to not-blocking within a round, so the nav
   * graph only ever gains links and no cached route can become invalid, only
   * stale. See `MapBuilder.panes` and `systems/GlassSystem.ts`.
   */
  glass?: true;
}

/**
 * A pane of glass: a sheet in a wall, drawn see-through.
 *
 * Declared by `Build.pane`, which is the only place one is made. Same six
 * numbers a `BoxSpec` carries, because a pane IS a thin box — what makes it a
 * pane is the material, and what makes a `breakable` one a pane rather than a
 * box is that `MapBuilder` keeps it addressable through both merge passes so
 * one sheet can be taken out of the world at runtime.
 */
export interface PaneSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  rotY?: number;
  /**
   * A way IN once it is shot out — and the ONLY kind of pane that breaks.
   *
   * **Glass is worth breaking exactly where there is enterable space behind
   * it, and that is a design rule before it is a cost one.** A sheet hung on a
   * solid mass is decoration: the round stops on the concrete either way, so
   * breaking it changes nothing you can play with and takes the elevation's
   * word for what is inside with it — a shopfront that shatters into a blank
   * grey shaft says plainly that the building is a box. A tower's curtain wall
   * hangs 4 cm off one and a punched window is drawn on the same shaft, so
   * neither breaks; an office's upper window band is not even glazed, because
   * glass over a spandrel that already stops a body would buy nothing at all,
   * and a shophouse's sash windows are the same case one floor up. The
   * ground-floor SHOPFRONTS — the two offices' and the eight shophouses' — are
   * the whole of what does break, because behind those there is a room.
   *
   * So the collider comes WITH this flag rather than beside it: a pane with
   * somewhere to get into is by construction the only thing in the way, which
   * is a body's barrier until it goes. Set this and `MapBuilder.paneGroup`
   * spawns the `glass` collider, records the `WorldPane` that gives the sheet
   * its index on the wire, and bakes it for the authority; leave it off and the
   * geometry is drawn and nothing else knows it exists.
   *
   * **That is also what keeps the cost honest.** `MapBuilder.struts`'s header
   * records what loose collider boxes cost: 161 of them put ~17% on every ray
   * in the game — the hitscan, sixteen bots' LOS, the grenade, the death cam.
   * (The ground probe was the worst of them when that was measured and has since
   * stopped being a ray; the ~17% stands for everything that still is one.)
   * Coldharbour draws some six thousand sheets of glass, and six
   * thousand pickable boxes is not a trade, it is a regression. Twenty-four is
   * — and it is twenty-four rather than the forty a terrace of eight
   * shophouses would have cost, because a shophouse cuts its frontage into one
   * bay or two by its own width rather than into three regardless.
   */
  breakable?: true;
}

/**
 * The union of every builder's options. One flat bag rather than per-builder
 * types keeps the layout data terse and the dispatch in `MapBuilder` trivial;
 * builders ignore what they don't use.
 */
export interface BuildParams {
  width?: number;
  depth?: number;
  height?: number;
  length?: number;
  /** Cottage: punch a doorway and hollow the interior. */
  enterable?: boolean;
  litWindows?: boolean;
  ruined?: boolean;
  /** Terrace: which Z face the access ramp runs off. */
  rampSide?: -1 | 1;
  /** Gatehouse: banner colour identifying the owning team. */
  teamColor?: string;
  /** Road: cobblestone street (default), the flat dirt track, or blacktop. */
  surface?: "cobble" | "dirt" | "asphalt";
  /**
   * How many WALKED levels a city building has, ground floor included — so 3
   * is a ground floor and two storeys over it, reached by two flights.
   *
   * Not `height`, which every other builder means as "how tall", because in
   * here the two are not the same question: a storey's height is fixed by what
   * a stair at `MAX_WALKABLE_GRADE` can climb inside the footprint, and the
   * building's height is that times this. Naming the count is what keeps a
   * layout from asking for a storey a flight cannot reach.
   *
   * **Every level costs a `NavGrid` surface slot in the whole footprint**, so a
   * map full of these owes `MapLayout.surfaces`; see that field.
   */
  floors?: number;
  /**
   * A body colour, for the pieces in the kit that come in more than one: a
   * parked car's paint, and a shophouse's blind. Deliberately not `teamColor`,
   * which is already spoken for and means "whose gatehouse is this" — a field
   * that answers two questions is a field that will be read for the wrong one.
   *
   * Both readers mean the same thing by it — "the one part of this that is not
   * the city's grey" — which is what keeps it one field rather than two.
   */
  tint?: string;
  /**
   * Boardwalk: which long edges carry a guard rail.
   *
   * Deliberately not `rampSide`, which is already spoken for and means "which Z
   * face" — reusing it would be a name lying about what it selects. A walk
   * between two huts wants no rail (you step off it anywhere, and a rail would
   * make a corridor of it); a walk along a channel wants one on the wet side.
   */
  railSide?: "both" | "none" | "-x" | "+x";
  /**
   * Street light: carry a real `LocalLight` as well as the lens, and NOT
   * whether the lamp is on — every lamp on a map is on together, so the lens
   * is unconditional and this is only whether the shader can afford to prove
   * it.
   *
   * The two are different questions because they cost different things. A lens
   * is `Build.glow` — an emissive box that takes the GlowLayer's bloom and
   * `EmissiveFog`'s per-pixel fade for free and spends NO light slot. A light
   * is one of sixteen, uploaded nearest-first, and a street full of them
   * evicts the interior fixtures a lit building is legible by. So a map lights
   * the few columns whose pool of light is somewhere a player stands, and lets
   * the rest be lamps you can see rather than lamps that light you.
   *
   * This is the same split `litWindows` already makes across a terrace, for
   * the same reason and out of the same budget.
   */
  lit?: boolean;
  /**
   * Shophouse: the frontage sign's colour, and what makes its face emissive.
   *
   * The bracket sign is drawn either way — it is geometry the builder has
   * always emitted, in the blind's own colour. Naming a colour here is what
   * turns its FACE into a `Build.glow`, which is why this is a colour rather
   * than a flag: an unlit sign is a board and a lit one is a board with a
   * lamp behind it, and the only thing that differs is what colour is coming
   * off the front of it.
   *
   * No light comes with it, deliberately — see `lit` on the budget, and note a
   * `flicker` is only visible on a light, so `LightSpec`'s anticipated
   * "neon ~.9" stays unused until something can afford a slot for it.
   */
  sign?: string;
}

/**
 * Where a placement is about to be put, for the builders whose shape depends on
 * it. Only the ground-hugging ones take it — everything else is the same object
 * wherever it stands, and declaring the parameter is the opt-in.
 */
export interface BuildCtx {
  terrain: TerrainField;
  x: number;
  /** The world Y MapBuilder will translate by: the authored offset plus floor. */
  y: number;
  z: number;
  rotY: number;
}

/** A fixture light in the structure's local space. */
export interface LocalLight extends Omit<LightSpec, "offset"> {
  x: number;
  y: number;
  z: number;
}

/** What every builder returns. */
export interface Structure {
  meshes: Mesh[];
  colliders: BoxSpec[];
  lights: LocalLight[];
  /**
   * Glazing, kept apart from `meshes` for the whole of its life.
   *
   * Two reasons, and the first covers every sheet: glass is the world's one
   * alpha-blended material and the one visual with no ink, so it merges on its
   * own path (`MapBuilder.paneGroup`, then `PaneBlocks`) rather than through
   * `mergeByMaterial` and `BlockMerge`, which would ink it and cast it. The
   * second covers the handful that are `breakable`: a pane that can be taken
   * out has to stay addressable through both of those merges, and `meshes` is
   * the list that gets merged into oblivion.
   *
   * `panes` is the parallel spec list `MapBuilder` reads world rects and vertex
   * ranges off. The two are index-for-index, exactly as `meshes`/`colliders`
   * are not.
   */
  paneMeshes: Mesh[];
  panes: PaneSpec[];
}

// --- village palette -------------------------------------------------------
// Art constants, deliberately not in CONFIG: these are material choices, not
// gameplay tunables.

export const TIMBER = "#453b31";
export const PLASTER = "#6b6459";
export const STONE = "#5a5f5c";
export const DARK_STONE = "#3d423f";
export const SLATE = "#33383a";
export const THATCH = "#5c5340";
export const IRON = "#2f3338";
export const PLANK = "#4a4034";
export const DIRT = "#4a4438";
/** Fired clay: chimney stacks, the forge, the charcoal kiln. */
export const BRICK = "#5b4038";
/** Lichened field stone — the dry walls and roadside shrines. */
export const MOSS_STONE = "#4f574c";

export const FLAME = "#ffbe63";
/** Forge/kiln mouth — hotter and redder than a lantern's FLAME. */
export const EMBER = "#ff7a2a";

// --- the tropical end of the same palette ----------------------------------
// A second climate rather than a second map's private colours: the kit stays
// map-agnostic, so anything built out of these is available to Hollowmere too.
// They are deliberately drawn from the same muted, desaturated family as the
// village above — a jungle read comes from CREEPER against STUCCO, not from
// saturation, which the cel shader's flat bands would post-erise.

/** Lime-washed stucco gone green-grey under a wet canopy. */
export const STUCCO = "#7f8474";
/** Oiled tropical hardwood: posts, shutters, balustrades, louvres. */
export const TEAK = "#4a3a2c";
/**
 * Sheet copper left out for a century — the roof of anything colonial.
 *
 * Deliberately dark for a green: this is the largest single area of colour any
 * building here puts on screen, and the sky term lifts an up-facing surface
 * hard. A tone picked to look right in isolation came back mint.
 */
export const VERDIGRIS = "#3f6055";
/** Creeper, vine and moss: what the forest has already taken back. */
export const CREEPER = "#41552f";

// --- the built city --------------------------------------------------------
// A third climate, on the same terms as the tropical set above: colours, not a
// map's private palette, so anything made of them is available everywhere. The
// restraint is the same and the reason is stronger here — a downtown is one
// material repeated over acres, so the whole read has to come from VALUE (a
// pale spandrel against a dark reveal) rather than from hue, which the cel
// shader's flat bands would post-erise into stripes.
//
// Everything here is darker than the swatch it is named for, and deliberately.
// The sky term is applied by `n.y` and lands on every up-facing surface at
// once, so a slab picked to look right held in the hand comes back chalk white
// the moment it is a roof. Greyfen's `floorColor` note is the same lesson from
// the ground.

/** Poured concrete: slabs, cores, spandrels, plinths. The city's `PLASTER`. */
export const CONCRETE = "#57564f";
/** Concrete in shadow — reveals, soffits, the inside of a car-park deck. */
export const DARK_CONCRETE = "#3a3936";
/** Blacktop: the roadway, and the flat roofs that are the same stuff. */
export const ASPHALT = "#26272c";
/**
 * Curtain-wall glazing: the TINT, not the pane.
 *
 * This is the colour a round of daylight picks up on its way through the
 * glass, and it is all this hex decides — what the pane actually shows is
 * composited from it and a reflection of the sky by `CelMaterialFactory
 * .getGlass`. So it is dark for the reason a tinted commercial glazing is
 * dark, and NOT because it is standing in for a reflection the way it did
 * while a pane was an opaque box.
 */
export const GLASS = "#2a333b";
/** Anodised mullions, handrails, lamp columns, signal poles. */
export const ALLOY = "#4a4f54";
/** Fired brick on the older, lower stock between the towers. */
export const CITY_BRICK = "#6b463a";
/** Painted steel: shutters, barriers, plant housings, a parked car's body. */
export const ENAMEL = "#3f4b52";
/** Lane markings and kerb paint — the one thing here allowed to be bright. */
export const ROAD_PAINT = "#9c9887";
/**
 * A vehicle's rear lens: the one saturated hue this palette allows itself, and
 * the only colour a car adds to a map that did not already have it.
 *
 * It is allowed because of how little of it there is — two lenses the size of
 * a hand on each parked car, against a downtown made of grey — and it is dark
 * for the reason everything else here is: the cel bands posterise a bright hue
 * into stripes, and a tail lamp has to read as a lamp rather than as a light.
 * Nothing about it is emissive; see `buildCar` on why no car on this map has
 * its headlights on.
 */
export const LAMP_RED = "#7b2f2c";
/** A lit window or a shopfront at dusk; the city's `FLAME`. */
export const WINDOW_LIGHT = "#ffd79a";
/**
 * A street lamp's lens, and the one emissive on this map that is meant to be
 * seen from the far side of it.
 *
 * **Saturated on purpose, where `WINDOW_LIGHT` is pale.** A lit window is seen
 * against the wall it is cut into and wants to read as warm light on a room; a
 * lamp head is a hand-sized emissive hanging in open sky at the top of a
 * column, and a pale one blooms through the GlowLayer into a hard white disc —
 * which is exactly why `buildStreetLight` carried no lens at all until the map
 * moved to an hour that wanted one. Sodium orange survives the bloom as a
 * colour rather than as a hole in the frame, and it holds its hue as
 * `EmissiveFog` takes it into the haze.
 */
export const LAMP_SODIUM = "#ff9a3c";
/**
 * Painted render over masonry: the older mixed-use stock between the towers.
 *
 * Warmer and lighter than `CONCRETE` and greyer than the jungle's `STUCCO`,
 * which is the whole reason it is a colour of its own — a rendered terrace
 * beside a poured-concrete office has to read as a different DECADE, and value
 * is the only axis the cel bands leave to say it with.
 */
export const RENDER = "#6e6a5e";
/**
 * Shop canvas: a blind over a pavement, and the one warm accent the downtown
 * palette allows itself.
 *
 * It is the default for `BuildParams.tint` on a shophouse rather than a fixed
 * colour in the builder, because a terrace of them wants four different blinds
 * — that variation is what stops a row of identical plates reading as one
 * building, and it costs a layout one field per placement.
 */
export const AWNING = "#7c4a3f";

// --- guard rails -----------------------------------------------------------

/**
 * The standard guard-rail section. One pair of numbers for the whole kit, so a
 * rail running off a ramp onto a deck is one continuous line rather than two
 * that nearly agree.
 */
export const GUARD_HEIGHT = 1.1;
export const GUARD_THICKNESS = 0.16;

/** Which face of a walkable surface a guard stands off. */
export type GuardSide = "+x" | "-x" | "+z" | "-z";

/**
 * Accumulator handed to each builder. Keeps the builders declarative — they
 * describe a shape as a list of boxes and cylinders rather than juggling
 * Babylon handles.
 */
export class Build implements Structure {
  meshes: Mesh[] = [];
  colliders: BoxSpec[] = [];
  lights: LocalLight[] = [];
  paneMeshes: Mesh[] = [];
  panes: PaneSpec[] = [];

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
    private tag: string,
    /**
     * How far toward the eye everything this builder PAINTS is biased in the
     * depth test, in polygon-offset units (`CelMaterialFactory.get`).
     *
     * Zero for every structure but the ROAD, which is the one thing in the kit
     * that is a sheet lying ON the floor rather than a mass standing on it —
     * see `ROAD_DEPTH_UNITS` in `world/roads.ts` for what a centimetre of lift
     * is worth against the depth buffer's own step at 500 m.
     *
     * **It is on the BUILDER and not on a call**, which is what keeps a
     * structure's own internal ladder intact: the slab and the lane markings
     * laid on it move toward the eye together, so the 2 cm the paint stands
     * proud of its carriageway still decides that pair exactly as it did.
     */
    private depthUnits = 0,
  ) {}

  /** A cel-shaded box. Visual only. */
  box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
    rot?: { x?: number; y?: number; z?: number },
  ): Mesh {
    const m = partBox(
      `${this.tag}-box${this.meshes.length}`,
      { width: w, height: h, depth: d },
      this.scene,
    );
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
    m.material = this.mats.get(color, this.depthUnits);
    this.meshes.push(m);
    return m;
  }

  /**
   * A box the key light comes THROUGH — canvas stretched over a frame. Same
   * geometry as `box`; the difference is entirely the material, which carries
   * the cel shader's translucency band, so the sheet glows where the moon is
   * behind it. Visual only, and worth staying rare: the term reads as
   * transmission precisely because almost nothing else in the village does it.
   */
  translucentBox(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
    trans: TranslucencySpec,
    rot?: { x?: number; y?: number; z?: number },
  ): Mesh {
    const m = partBox(
      `${this.tag}-sheet${this.meshes.length}`,
      { width: w, height: h, depth: d },
      this.scene,
    );
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
    m.material = this.mats.getTranslucent(color, trans);
    this.meshes.push(m);
    return m;
  }

  /**
   * A box surfaced with a world-mapped ground texture (cobblestone). The
   * shader samples by world XZ, so no UV authoring is needed and the pattern
   * keeps a constant real-world size however the box is sized — and tiles
   * seamlessly across separate structures sharing the material. For
   * up-facing surfaces only; walls would streak.
   */
  groundBox(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const m = partBox(
      `${this.tag}-ground${this.meshes.length}`,
      { width: w, height: h, depth: d },
      this.scene,
    );
    m.position.set(x, y, z);
    m.material = this.groundMaterial();
    this.meshes.push(m);
    return m;
  }

  /**
   * A surface handed in as finished vertices rather than described as a
   * primitive — a road tessellated to follow the ground under it. Takes the
   * same two materials `box` and `groundBox` do: a palette colour, or the
   * world-mapped cobblestone when `color` is omitted.
   *
   * Still origin-local: whoever built the vertices did so in the structure's
   * own frame, because MapBuilder rotates and translates the result.
   */
  surface(data: VertexData, color?: string): Mesh {
    const m = partSurface(
      `${this.tag}-surface${this.meshes.length}`,
      data,
      this.scene,
    );
    m.material =
      color === undefined
        ? this.groundMaterial()
        : this.mats.get(color, this.depthUnits);
    this.meshes.push(m);
    return m;
  }

  /**
   * Wet-stone sheen + per-sett bump: the street catches a hard streak looking
   * moonward, and the light bands ripple over individual stones. Shared by
   * `groundBox` and `surface` so a flat road and a contoured one cannot end up
   * on two different materials — they merge into one draw call only while they
   * are on the same one.
   */
  private groundMaterial(): ShaderMaterial {
    return this.mats.getGroundTextured(
      "cobble",
      getCobblestoneTexture(this.scene),
      COBBLE_TEX_SCALE,
      {
        spec: CONFIG.graphics.spec.cobble,
        bump: getCobblestoneBumpTexture(this.scene),
        bumpScale: CONFIG.graphics.cobbleBumpScale,
        depthUnits: this.depthUnits,
      },
    );
  }

  /**
   * A visible member that stops a ROUND exactly where it is drawn, and is not
   * a body obstacle: a fence post, a rail. The third of the three box words,
   * and the one to reach for when a structure is mostly air.
   *
   * `box` is drawn and nothing else, `wall` is drawn and stops both a body and
   * a round, and a strut is drawn and stops only the round — because the body
   * is already handled by a `block` covering the whole run, coarsely, the way
   * a fence's one 1.4 m slab stands in for a line of posts. Splitting them is
   * what lets the coarse box be `porous` (a body walks into a fence, a round
   * does not stop on the gaps) while the timber still stops what hits it.
   *
   * A strut costs a collider that is NOT a `WorldBox`: no nav grid, no cover,
   * no obstacle field, no AO. That is deliberate and it is why the coarse box
   * is not optional — the navigation half of a fence is that box's job, and a
   * 0.18 m post is a shape `NavGrid` cannot represent anyway (see `guard`).
   * `MapBuilder` merges a placement's struts into ONE collider mesh, which is
   * what makes the fidelity affordable: measured over Hollowmere's fences, 161
   * loose post/rail boxes cost every ray in the game ~17%, and the same
   * geometry merged per fence costs the ground probe 1.4% and a shot 0.3%.
   */
  strut(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
    rot?: { x?: number; y?: number; z?: number },
  ): Mesh {
    this.colliders.push({
      w,
      h,
      d,
      x,
      y,
      z,
      rotX: rot?.x,
      rotY: rot?.y,
      rayOnly: true,
    });
    return this.box(w, h, d, x, y, z, color, rot);
  }

  /**
   * A pane of glass — and, where something can get in behind it, the one thing
   * in the world a round can take away.
   *
   * The fourth box word, and the only one whose geometry leaves `meshes`. A
   * pane passes a round like a `porous` `block` and is the only thing in the
   * world drawn SEE-THROUGH (`CelMaterialFactory.getGlass` — a reflection of
   * the sky over the tint of whatever stands behind it). A `breakable` one
   * also keeps an identity through both of `MapBuilder`'s merges, so
   * `GlassSystem` can collapse this sheet and no other when something crosses
   * it; the rest are glazing, drawn and nothing more. See `PaneSpec` for which
   * a sheet should be and why the answer is what is BEHIND it.
   *
   * The colour is the caller's because a shopfront and a windscreen are not the
   * same glass, but it is `GLASS` by default for the same reason `surface` has
   * one: the common case should need no thought.
   *
   * **A sheet may RAKE, and only in the drawing.** `rotZ` tilts one out of
   * vertical — a windscreen is the whole reason it exists, and that tilt is
   * what makes a car's cabin a cabin rather than a glass box — and it stops at
   * this mesh, which is why it is an option here and NOT a field on
   * `PaneSpec`. Everything downstream of the spec describes a sheet in a wall
   * with six numbers and a yaw: the collider a breakable pane spawns, the
   * `WorldPane` the wire names it by, and `GlassSystem`'s sweep, which tests a
   * plane it assumes is upright. All three would silently stand a raked sheet
   * back up, so the two are mutually exclusive and the guard is a throw rather
   * than a comment. Glazing may lean; glass that BREAKS is a sheet in a wall.
   *
   * **A sheet may also be `backed`, which is a claim about the WORLD and the
   * one thing here a builder can get wrong invisibly.** It says there is an
   * opaque surface a hand behind this glass, so nothing is ever seen through
   * it — a curtain wall on its shaft, a sash drawn on a solid wall, a
   * clerestory on brick. What it buys is that the sheet is drawn OPAQUE
   * (`CelMaterialFactory.getGlass`), which is one shading of that pixel
   * instead of two and lets the mass behind it be rejected on depth before it
   * is shaded at all; on a map whose elevations are mostly glass that is the
   * largest per-pixel saving there is.
   *
   * **The value is that mass's own palette colour, not a flag**, and that is
   * what makes the drawing exact rather than merely close: the shader folds
   * the blend it is replacing into one expression over the backdrop (see
   * `CEL_GLASS_BACKED` in `CelShader.ts`), so naming the wall reproduces what
   * you would have seen through the glass instead of guessing at it. Pass what
   * the wall behind is actually built from — `b.box(..., CONCRETE)` behind it
   * means `{ backed: CONCRETE }` — and the two move together when a builder
   * repaints.
   *
   * What it costs if the claim is FALSE is a window with a flat sheet where the
   * room should be, and nothing throws, because the geometry is legal either
   * way. So it is opt-in, it is never inferred, and the test is what a ROUND
   * does: if a round stops on something solid within centimetres, the eye stops
   * there too.
   *
   * `backed` and `breakable` are opposites rather than merely exclusive —
   * `PaneSpec.breakable` means enterable space behind, which is the one thing
   * `backed` swears there is not — so claiming both is a contradiction and
   * throws rather than picking one.
   *
   * Like `rotZ` and unlike `breakable`, this stops at the material and is NOT
   * a field on `PaneSpec`: nothing downstream of the spec has heard of it,
   * because a `backed` sheet by construction never becomes a `WorldPane`.
   */
  pane(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    opts?: {
      color?: string;
      rotY?: number;
      rotZ?: number;
      breakable?: true;
      /** The palette colour of the mass behind the sheet. See the header. */
      backed?: string;
    },
  ): Mesh {
    if (import.meta.env.DEV && opts?.rotZ !== undefined && opts.breakable) {
      throw new Error(
        "pane: a raked sheet cannot be breakable — a PaneSpec carries no " +
          "pitch, so the collider, the wire and GlassSystem would all stand " +
          "it back up. See Build.pane.",
      );
    }
    if (import.meta.env.DEV && opts?.backed && opts.breakable) {
      throw new Error(
        "pane: a sheet cannot be both backed and breakable — `backed` swears " +
          "there is a solid mass behind it and `breakable` swears there is a " +
          "room. See Build.pane.",
      );
    }
    const m = partBox(
      `${this.tag}-pane${this.paneMeshes.length}`,
      { width: w, height: h, depth: d },
      this.scene,
    );
    m.position.set(x, y, z);
    if (opts?.rotY) m.rotation.y = opts.rotY;
    if (opts?.rotZ) m.rotation.z = opts.rotZ;
    // The one alpha-blended material in the world, and the only builder call
    // that reaches it: a pane is glass because `pane` made it, not because
    // somebody passed the glass colour to `box`.
    m.material = this.mats.getGlass(
      opts?.color ?? GLASS,
      CONFIG.graphics.glass,
      0,
      opts?.backed ?? null,
    );
    this.paneMeshes.push(m);
    this.panes.push({ w, h, d, x, y, z, rotY: opts?.rotY, breakable: opts?.breakable });
    return m;
  }

  /** A box that also blocks movement and stops bullets. */
  wall(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
  ): Mesh {
    this.colliders.push({ w, h, d, x, y, z });
    return this.box(w, h, d, x, y, z, color);
  }

  /** A cel-shaded cylinder. Visual only. */
  cyl(
    height: number,
    dTop: number,
    dBot: number,
    tess: number,
    x: number,
    y: number,
    z: number,
    color: string,
    rot?: { x?: number; y?: number; z?: number },
  ): Mesh {
    const m = partCylinder(
      `${this.tag}-cyl${this.meshes.length}`,
      { height, diameterTop: dTop, diameterBottom: dBot, tessellation: tess },
      this.scene,
    );
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
    m.material = this.mats.get(color, this.depthUnits);
    this.meshes.push(m);
    return m;
  }

  /**
   * An unlit emissive detail — a flame, a window's glow. Tagged `noInk`
   * because the outline shell would otherwise swallow it.
   */
  glow(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
  ): Mesh {
    const m = partBox(
      `${this.tag}-glow${this.meshes.length}`,
      { width: w, height: h, depth: d },
      this.scene,
    );
    m.position.set(x, y, z);
    m.material = this.mats.getEmissive(color);
    m.metadata = { noInk: true };
    this.meshes.push(m);
    return m;
  }

  /** A collider with no geometry — invisible blocking, or a walkable surface. */
  block(spec: BoxSpec): void {
    this.colliders.push(spec);
  }

  /**
   * A guard rail along the edge of a walkable surface: solid, and standing
   * OUTBOARD of the surface it guards.
   *
   * This exists because a rail is a third thing the kit had no word for, and
   * every builder that wanted one had to rederive it. `box` is a visual and
   * `wall` is a visual plus a collider — but a rail is thin, and thinness is
   * what `NavGrid` cannot represent. It samples ONE point per 1.5 m cell, so a
   * 0.16 m rail is invisible to it about nine times in ten and, the tenth time,
   * catches a cell centre and does two things: invents a standable surface a
   * rail's height in the air that the flood fill can never reach, and blanks
   * the real floor underneath. Only the first is fixable in the grid — stop
   * `clearBlocked` blanking the cell and `severLinks` isolates it instead, and
   * `severLinks` cannot be relaxed by width because a fence is 0.4 m deep and a
   * dry-stone wall 0.5 m and both must go on severing.
   *
   * So the cell is lost whenever a sample lands in a rail, and the only fix is
   * to not put the rail where the walked surface is sampled. Standing it off
   * the edge is that fix, and having it here rather than in each builder is
   * what stops the next one forgetting: the barn's rails were left visual-only
   * for exactly this reason and you could walk straight off its ramp.
   *
   * **A guard is not a `strut`, and the difference is what is behind it.** A
   * deck rail is a solid surface at the edge of somewhere a body stands: it has
   * to stop a body (a rail you walk through is a fall) and it stops rounds like
   * any other timber, so it is an ordinary collider. A strut is for the case
   * where a COARSER box already owns the body and the fine geometry is only
   * there to catch rounds. Using a strut here would drop the player off the
   * ramp; using a guard for a fence's posts would put its rails in the nav
   * graph, which is the pathology this comment already describes.
   *
   * `edge` is the guarded surface's OUTER face on `side`'s axis, `along` and
   * `length` describe the run on the other horizontal axis, and `surface` is
   * the walked height at the run's centre. A pitched run (`pitch`, positive
   * rising toward +Z) must run along Z, so its `side` is ±x; its section is cut
   * by `cos` so the top face sits `height` above the walked surface at every
   * point rather than `height / cos`, which is what lets a ramp's rail meet a
   * deck's in one line.
   */
  guard(
    side: GuardSide,
    edge: number,
    along: number,
    length: number,
    surface: number,
    opts: { pitch?: number; height?: number; color?: string } = {},
  ): void {
    const t = GUARD_THICKNESS;
    const height = opts.height ?? GUARD_HEIGHT;
    const pitch = opts.pitch ?? 0;
    const color = opts.color ?? TIMBER;
    const alongZ = side === "+x" || side === "-x";
    if (import.meta.env.DEV && pitch !== 0 && !alongZ) {
      throw new Error(
        `guard: a pitched run turns about X, so it must run along Z (side ±x), not ${side}`,
      );
    }
    // Outboard: half a thickness past the face, so the rail never overlaps the
    // footprint the nav grid samples.
    const off = edge + ((side === "+x" || side === "+z" ? 1 : -1) * t) / 2;
    // Cut perpendicular to the run. A pitched box of section `h` presents
    // `h / cos` vertically, so `height * cos` is what stands `height` up.
    const section = height * Math.cos(pitch);
    // Bottom face on the surface: `surface + section / 2 / cos` — which is
    // `surface + height / 2` however the run is pitched.
    const y = surface + height / 2;
    const spec: BoxSpec = alongZ
      ? {
          w: t,
          h: section,
          d: length / Math.cos(pitch),
          x: off,
          y,
          z: along,
          rotX: -pitch,
        }
      : { w: length, h: section, d: t, x: along, y, z: off };
    this.box(spec.w, spec.h, spec.d, spec.x, spec.y, spec.z, color, {
      x: spec.rotX,
    });
    this.colliders.push(spec);
  }

  /**
   * One flight of stairs running along Z: the pitched collider slab, and the
   * treads drawn on it.
   *
   * The two mistakes this exists to stop being made a third time are
   * `buildBarn`'s: the pitch is `atan(rise / run)` — the RUN, never the slab's
   * own length, which is `hypot` of the two and gives a flight that lands short
   * of the deck — and the slab is placed by its top face, whose half-thickness
   * is measured VERTICALLY, so the term is `h / 2 / cos`.
   *
   * The treads are visual and sit ON the slab plane rather than replacing it: a
   * real stepped collider would be `steps` boxes, each a wall to
   * `moveWithCollisions`, and the walked surface has to be the smooth plane the
   * nav graph rasterises anyway. `steps` is high enough that the plane never
   * parts company with a tread by more than half a riser.
   *
   * It lives here rather than in the manor that first needed it for `guard`'s
   * reason: `buildStairs` is the second caller, and a flight is exactly the
   * shape whose second copy drifts. Everything below the local ground line is
   * skipped, which is what lets a caller overrun its own foot and bury it.
   */
  flight(opts: {
    x: number;
    w: number;
    /** Where the walked surface arrives, and at what height. */
    topZ: number;
    topY: number;
    /** Horizontal run and total rise. Grade is their ratio, never derived. */
    run: number;
    rise: number;
    /** +1 when the flight climbs toward +Z. */
    dir: 1 | -1;
    steps: number;
    color: string;
  }): void {
    const { x, w, topZ, topY, run, rise, dir, steps, color } = opts;
    const grade = rise / run;
    const pitch = Math.atan(grade);
    const footZ = topZ - dir * run;
    const thick = 0.3;
    const surfaceAt = (z: number): number => topY - dir * (topZ - z) * grade;

    const midZ = (topZ + footZ) / 2;
    this.box(
      w,
      thick,
      Math.hypot(run, rise),
      x,
      surfaceAt(midZ) - thick / 2 / Math.cos(pitch),
      midZ,
      color,
      { x: -dir * pitch },
    );
    this.block({
      w,
      h: thick,
      d: Math.hypot(run, rise),
      x,
      y: surfaceAt(midZ) - thick / 2 / Math.cos(pitch),
      z: midZ,
      rotX: -dir * pitch,
    });

    const tread = run / steps;
    const riser = rise / steps;
    for (let i = 0; i < steps; i++) {
      const zc = footZ + dir * (i + 0.5) * tread;
      const y = surfaceAt(zc);
      // Nothing below the ground line: the overrun at the foot is buried.
      if (y < 0.12) continue;
      this.box(w - 0.08, 0.1, tread + 0.05, x, y - 0.03, zc, color);
      this.box(
        w - 0.08,
        riser + 0.1,
        0.09,
        x,
        y - riser / 2 - 0.02,
        zc - dir * tread * 0.5,
        TEAK,
      );
    }
  }

  light(
    color: string,
    range: number,
    intensity: number,
    flicker: number,
    x: number,
    y: number,
    z: number,
  ): void {
    this.lights.push({ color, range, intensity, flicker, x, y, z });
  }

  /**
   * A wall with a doorway punched through it, as two jambs plus a lintel.
   * Runs along X, centred on the local origin offset.
   */
  doorWall(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
    gapWidth: number,
    gapHeight: number,
  ): void {
    const side = (w - gapWidth) / 2;
    if (side > 0.05) {
      const off = gapWidth / 2 + side / 2;
      this.wall(side, h, d, x - off, y, z, color);
      this.wall(side, h, d, x + off, y, z, color);
    }
    const lintel = h - gapHeight;
    if (lintel > 0.05) {
      this.wall(gapWidth, lintel, d, x, y + h / 2 - lintel / 2, z, color);
    }
  }

  /**
   * The triangular panel that closes off the end of a pitched roof: base
   * corners at `±w / 2`, apex `rise` above them, `t` thick through Z, placed
   * by the centre of its base.
   *
   * Vertices rather than a box because the silhouette is the entire point. A
   * box here fills the roof's bounding rectangle, so its top corners stand
   * proud of the slabs it is meant to close by nearly the whole rise, and the
   * roof reads as a solid block with two diagonal strips laid across it rather
   * than as a peak.
   *
   * Wound for Babylon's LEFT-handed default (`scene.useRightHandedSystem` is
   * false), where a front face is clockwise seen from the front — the order
   * you get from working the cross product out on paper is inverted here, and
   * fails silently (see TerrainField's `assertFacesUp`).
   */
  gableEnd(
    w: number,
    rise: number,
    t: number,
    x: number,
    y: number,
    z: number,
    color: string,
  ): Mesh {
    // Cross-section, counter-clockwise in XY. The +Z face walks it in order,
    // the -Z face walks it reversed, and the quad bridging edge i is
    // front[i], back[i], back[i+1], front[i+1].
    const section = [
      [-w / 2, 0],
      [w / 2, 0],
      [0, rise],
    ];
    const front = section.map((p) => [p[0], p[1], t / 2]);
    const back = section.map((p) => [p[0], p[1], -t / 2]);

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    // Each face carries its own vertices, so ComputeNormals returns true face
    // normals — the same hard edges CreateBox gives every other piece here.
    const tri = (a: number[], b: number[], c: number[]): void => {
      for (const v of [a, b, c]) {
        positions.push(v[0], v[1], v[2]);
        uvs.push(v[0], v[1]);
        indices.push(indices.length);
      }
    };
    tri(front[0], front[1], front[2]);
    tri(back[0], back[2], back[1]);
    for (let i = 0; i < section.length; i++) {
      const j = (i + 1) % section.length;
      tri(front[i], back[i], back[j]);
      tri(front[i], back[j], front[j]);
    }

    const data = new VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.normals = normals;

    const m = this.surface(data, color);
    m.position.set(x, y, z);
    return m;
  }

  /** A gabled roof: two slanted slabs meeting at a ridge. */
  gableRoof(
    w: number,
    d: number,
    rise: number,
    x: number,
    y: number,
    z: number,
    color: string,
    overhang = 0.35,
  ): void {
    const slopeW = w / 2 + overhang;
    const len = Math.sqrt(slopeW * slopeW + rise * rise);
    const pitch = Math.atan2(rise, slopeW);
    for (const s of [-1, 1]) {
      this.box(
        len,
        0.18,
        d + overhang * 2,
        x + (s * slopeW) / 2,
        y + rise / 2,
        z,
        color,
        { z: -s * pitch },
      );
    }
    // The gable ends, so you don't see straight into the roof void. Spanning
    // the slabs rather than the wall (`slopeW`, not `w / 2`) puts the panel's
    // sloped edges on the roof planes themselves: cut to the wall it stops
    // short of the eaves, and the wedge left over is a slit into the void at
    // exactly the corner the panel exists to close.
    for (const s of [-1, 1]) {
      this.gableEnd(slopeW * 2, rise, 0.16, x, y, z + (s * d) / 2, color);
    }
    // Roofs block bullets and sight, but the collider is a flat slab at the
    // eaves rather than two rotated planes — cheaper, and nothing walks up there.
    this.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x, y, z });
  }
}
