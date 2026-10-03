/**
 * kit/terrain.ts — Ground-shaping builders: terrace, ramp, road, jetty,
 * boardwalk, stairs.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata).
 * Extra care here: these are walkable surfaces, so their collider top faces
 * must stay within CONFIG.nav.stepHeight of adjacent ground and ramps need
 * rotX on the COLLIDER, not just the visual.
 */
import { Scene, VertexData } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  ROAD_DEPTH_UNITS,
  ROAD_LENGTH,
  ROAD_TOP,
  ROAD_WIDTH,
  onRoad,
  roadSurface,
  roadTop,
  type RoadFootprint,
} from "../roads";
import { stripSections, type RoadJoin } from "../roadPaths";
import {
  type TerrainField,
  terrainFan,
  terrainRibbon,
  terrainSlab,
} from "../TerrainField";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  DARK_STONE,
  GUARD_HEIGHT,
  DIRT,
  GUARD_THICKNESS,
  IRON,
  KERB,
  KERB_WORN,
  MOSS_STONE,
  PITCH,
  PLANK,
  ROAD_PAINT,
  SAILCLOTH,
  TEAK,
  TIMBER,
  type Point3,
  convexSolid,
  creeperClimb,
  creeperLeaf,
  rope,
  slab,
  streetSeed,
} from "./core";
import { mulberry32 } from "../rng";

/**
 * A raised earth terrace with a ramp on one side. Used for the chapel's
 * graveyard platform; the top face and the ramp are both walkable colliders.
 */
export function buildTerrace(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "terrace");
  const w = p.width ?? 30;
  const d = p.depth ?? 26;
  const h = p.height ?? 2;
  const side = p.rampSide ?? -1;

  b.box(w, h, d, 0, h / 2, 0, DIRT);
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  // Retaining wall, so the terrace edge reads as built rather than extruded.
  for (const sx of [-1, 1]) {
    b.box(0.4, h + 0.3, d, (sx * w) / 2, (h + 0.3) / 2, 0, DARK_STONE);
  }
  b.box(w, h + 0.3, 0.4, 0, (h + 0.3) / 2, (-side * d) / 2, DARK_STONE);

  // Ramp up the chosen face.
  const rampLen = h * 5;
  const pitch = Math.atan2(h, rampLen);
  const rz = (side * (d + rampLen)) / 2;
  b.box(7, 0.3, rampLen, 0, h / 2, rz, DIRT, { x: side * pitch });
  b.block({ w: 7, h: 0.3, d: rampLen, x: 0, y: h / 2, z: rz, rotX: side * pitch });
  return b;
}

/**
 * A standalone earth ramp, rising from -Z to +Z over `length`. Used to get in
 * and out of the creek at more than one point — a sunken lane with a single
 * exit is a trap, and the nav grid needs somewhere to route bots through.
 */
export function buildRamp(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "ramp");
  const w = p.width ?? 5;
  const len = p.length ?? 8;
  const h = p.height ?? 1.5;
  const pitch = Math.atan2(h, len);
  b.box(w, 0.3, len, 0, h / 2, 0, DIRT, { x: -pitch });
  b.block({ w, h: 0.3, d: len, x: 0, y: h / 2, z: 0, rotX: -pitch });
  // Kerb stones, so the ramp reads as built rather than as a floating slab.
  for (const sx of [-1, 1]) {
    b.box(0.4, h + 0.3, len, (sx * w) / 2, h / 2 - 0.2, 0, DARK_STONE, {
      x: -pitch,
    });
  }
  return b;
}

/**
 * Road surface. Visual only — it sits on the ground, so nothing ever stands on
 * the slab itself: feet rest on the floor from the ground probe and the nav
 * grid. The slab is therefore sunk so its top sits barely proud of the floor —
 * enough to avoid z-fighting the ground, but not enough to swallow a
 * character's ankles. Cobblestone by default; `surface: "dirt"` gives the
 * scraped track a farm lane is and `surface: "asphalt"` the blacktop a city
 * street is.
 *
 * **All three are world-mapped textures now and this builder no longer branches
 * on which**, which is a change from the version where the street was textured
 * and the other two were a flat cel colour apiece. What that cost was stated in
 * the dash note below and was worst exactly where it was least visible from:
 * every asphalt avenue on Sarab takes the contoured path, so it had neither a
 * texture nor a centre line, and 34,000 m² of `#26272c` reads as a hole cut in
 * the map rather than as a street. A surface is a FIELD (`world/textures.ts`),
 * `Build.groundMaterial` is the one place that turns one into a material, and
 * adding a fourth carriageway is a row in `ROAD_PATTERNS`, a field and a
 * palette — still not a code path here.
 *
 * **How far proud is the SURFACE's, and it is what settles a junction**
 * (`roadTop`, `world/roads.ts`). Two roads that cross are two coplanar sheets
 * in two different merged meshes — one per material — and coplanar is a tie
 * the depth buffer breaks per pixel, in favour of whichever mesh that frame's
 * front-to-back sort drew first: the winner changed as you walked round it.
 * Two millimetres per rank decide it by geometry instead, once, the same way
 * from every angle — a ladder sized to fit UNDER everything else that lies on
 * the ground, which `ROAD_RANK_STEP` is the argument for. The thickness grows
 * with the lift so the underside stays
 * the same distance INTO the ground however high the top rides — a slab whose
 * skirt stopped short of the floor would show daylight under its own kerb on
 * the first bank it crossed.
 *
 * It is the one builder whose shape depends on where it is going. MapBuilder
 * samples the floor once, at a placement's own centre, and translates the whole
 * structure by it — fine for a cottage, wrong for 130 m of street, which used
 * to float at one end and bury itself at the other over sculpted ground. So the
 * slab is re-cut against the heightfield by `terrainSlab`, which returns null
 * over level ground and leaves the single box the road has always been. That
 * fast path is why a flat map costs exactly what it used to.
 */
export function buildRoad(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  // Biased toward the eye, and it is the BUILDER that carries it so the slab
  // and the paint laid on it move together — see `ROAD_DEPTH_UNITS`, and the
  // note below on how far a centimetre of lift actually gets.
  const b = new Build(scene, mats, "road", ROAD_DEPTH_UNITS);
  const surface = roadSurface(p.surface);
  const top = roadTop(surface);
  // Sunk the same 7 cm into the floor whatever it is riding at — see the note
  // above.
  const h = 0.08 + (top - ROAD_TOP);
  // The two defaults are `roads.ts`'s, not this builder's: the footprint
  // `roadRects` derives has to be the slab that gets drawn, and two roads in
  // the shipped layouts state a length and no width.
  const w = p.width ?? ROAD_WIDTH;
  const len = p.length ?? ROAD_LENGTH;

  // A PATH road is not a slab at all: the network has already decided where
  // it runs, where each end stops and which junctions it paves (`ctx.road`),
  // and all that is left here is laying that plan over the ground. Each join
  // is paved in its own surface, which may not be this road's — a lane leaving
  // a street leaves from the street's apron — and sits at its own height, so
  // its skirt is sized the way this slab's is. No centre line: a dash is a box
  // on a plane, the contoured slab's reason for having none.
  if (p.path) {
    if (!ctx?.road) return b;
    const frame = { x: ctx.x, z: ctx.z, rotY: ctx.rotY, originY: ctx.y };
    const { strip, joins } = ctx.road;
    if (strip) {
      b.groundSurface(
        terrainRibbon(ctx.terrain, frame, stripSections(strip), top, h, [strip.free0, strip.free1]),
        surface,
      );
    }
    for (const j of joins) {
      const jh = 0.08 + (j.top - ROAD_TOP);
      b.groundSurface(
        terrainFan(ctx.terrain, frame, j.x, j.z, j.xs, j.zs, j.kerb, j.top, jh),
        j.surface,
      );
    }
    const site = kerbSite(ctx, frame.x, frame.z, frame.rotY);
    if (site) {
      if (strip && surface === "cobble") {
        const sec = stripSections(strip);
        const first = sec[0];
        const last = sec[sec.length - 1];
        // A side runs on past a FREE end to cover the corner the trimmed cap
        // leaves; at a joined end the junction's own kerb takes over from the
        // same point, and running on would lay one stone over the other.
        const e0 = strip.free0 ? KERB_WIDTH / 2 : 0;
        const e1 = strip.free1 ? KERB_WIDTH / 2 : 0;
        layKerb(site, sec.map((s) => [s.lx, s.lz]), e0, e1);
        layKerb(site, sec.map((s) => [s.rx, s.rz]), e0, e1);
        if (strip.free0) layKerb(site, [[first.lx, first.lz], [first.rx, first.rz]], -KERB_WIDTH / 2, -KERB_WIDTH / 2);
        if (strip.free1) layKerb(site, [[last.rx, last.rz], [last.lx, last.lz]], -KERB_WIDTH / 2, -KERB_WIDTH / 2);
      }
      for (const j of joins) {
        if (j.surface !== "cobble") continue;
        for (const run of joinKerbRuns(j)) layKerb(site, run, 0, 0);
      }
      flushKerbs(b, site);
    }
    return b;
  }

  const contoured =
    ctx &&
    terrainSlab(ctx.terrain, {
      w,
      len,
      x: ctx.x,
      z: ctx.z,
      rotY: ctx.rotY,
      originY: ctx.y,
      top,
      thickness: h,
    });
  if (contoured) b.groundSurface(contoured, surface);
  else b.groundBox(w, h, len, 0, top - h / 2, 0, surface);

  const site = surface === "cobble" && ctx ? kerbSite(ctx, ctx.x, ctx.z, ctx.rotY) : null;
  if (site) {
    // The four edges in the placement's own frame, taken out to the world so
    // the ground and the rest of the network can be asked about them. The
    // sides run the kerb's half-width past both ends and the caps stop the
    // same half-width short, so a corner is one stone and never two.
    const c = Math.cos(site.rotY);
    const s = Math.sin(site.rotY);
    const at = (lx: number, lz: number): KerbPoint => [
      site.x + lx * c + lz * s,
      site.z - lx * s + lz * c,
    ];
    const hw = w / 2;
    const hl = len / 2;
    const out = KERB_WIDTH / 2;
    layKerb(site, [at(-hw, -hl), at(-hw, hl)], out, out);
    layKerb(site, [at(hw, hl), at(hw, -hl)], out, out);
    layKerb(site, [at(-hw, hl), at(hw, hl)], -out, -out);
    layKerb(site, [at(hw, -hl), at(-hw, -hl)], -out, -out);
    flushKerbs(b, site);
  }

  // Blacktop gets a broken centre line, and what it is for has NARROWED rather
  // than gone away. It used to be carrying the whole surface — an untextured
  // 16 m carriageway is the largest flat tone anywhere in the game, and the
  // dashes were the only thing in it giving the eye a scale to measure by. The
  // aggregate and the crazing do that now. What no texture in this file can do
  // is say which way the road RUNS: every one of them is sampled at `vPosW.xz`
  // and so knows nothing about the slab it is painting, while wheel polish, a
  // kerb line and a centre line all run along a carriageway. The markings are
  // where a road states its direction, and that is the whole of their job.
  //
  // Only on the FLAT path. A dash is a box laid on a plane and the contoured
  // path is not one — over sculpted ground each would float or bury itself,
  // which is the whole problem `terrainSlab` exists to solve for the slab
  // itself and cannot solve for something laid on top of it. So a contoured
  // avenue (all three of Sarab's, and any Coldharbour one run past its ±150 m
  // stop) is an unmarked road: since the texture, that is a road with no centre
  // line, where before it was 860 m of one flat tone.
  if (surface === "asphalt" && !contoured) {
    // **The paint is only ever there because NO ROAD IS INKED**, and that used
    // to be a rule about this one slab. `addOutline` draws Babylon's outline as
    // a hull expanded along the mesh's own normals, and the half of it that
    // matters here is invisible: after the mesh is drawn the shell is drawn
    // AGAIN with colour write off and depth write ON, so the hull's own depth —
    // the slab's top face pushed 5 cm up, and pushed further toward the eye by
    // the renderer's slope-scaled offset — is what stands in the depth buffer
    // over the whole carriageway. Anything laid on the road then fails the
    // depth test against a surface 5 cm above the road that nobody can see.
    // Paint 4 cm proud simply was not there in play, and no clearance fixes it:
    // the slope-scaled half of the offset grows with the grazing angle, so
    // measured down an avenue at eye height, ink thinned to 1 cm still
    // swallowed every dash past ~35 m. What made this expensive to find is that
    // it did not happen in the EDITOR, where roads have always been left
    // uninked for a different reason — the markings were on screen the whole
    // time they were being authored.
    //
    // The same shell is what painted every mixed junction black, because a road
    // crossing a road is exactly "anything laid on the road": `MapBuilder` no
    // longer inks the road merge at all, and the paint below now rides on that
    // rather than on a flag of its own. A flat sheet lying on the ground has no
    // silhouette to ink in the first place, which is the same thing
    // `noShadowCaster` says about it one line later in MapBuilder.
    //
    // Clear of the slab's own top by more than the slab stands proud of the
    // floor: coplanar faces in two meshes are a depth-test tie broken per
    // pixel, which strobes into a line as you walk (see buildTavern).
    const paintY = top + 0.02;
    const dash = 3.2;
    const gap = 3.2;
    const n = Math.floor((len + gap) / (dash + gap));
    const run = n * (dash + gap) - gap;
    for (let i = 0; i < n; i++) {
      const z = -run / 2 + i * (dash + gap) + dash / 2;
      // `noInk`, and it is not a nicety. A dash is 4 cm tall and the ink
      // shell `addOutline` wraps it in is 5 cm of expansion along its own
      // normals — bigger than the thing it is outlining — so every marking came
      // out as a dark scratch rather than a pale one, which is the same
      // thin-slab failure the SLAB note in kit/city.ts describes from the other
      // end. Paint has no silhouette to ink; it is a colour on a surface.
      b.box(0.26, 0.04, dash, 0, paintY, z, ROAD_PAINT).metadata = {
        noInk: true,
      };
    }
  }
  return b;
}

// --- the kerb --------------------------------------------------------------

/*
 * A COBBLED STREET ENDS IN A KERB COURSE, because since the ground was given a
 * depth its edge cannot be a cut. The setts are carved down into the slab
 * (`CelShader`'s `reliefParallax`), and the slab's edge is a straight line the
 * world-mapped texture knows nothing about — so the street stopped by slicing
 * every stone along it in half, and the carving had no side to it: a
 * three-dimensional street that ended like a decal. A course of dressed stones
 * laid over that line is what a laid street actually ends in, and it is the
 * one fix that is geometry rather than a trick: it hides the cut, it stands a
 * few centimetres over the carriageway so the setts read as sunk between
 * kerbs, and the ink finds its edge on its own.
 *
 * **Visual only, like the road under it**: no collider, no `WorldBox`, nothing
 * a ray, a body, the nav grid or the collision bake can see. It stands
 * `KERB_PROUD` over the road, which is under a boot's sole and far under
 * `CONFIG.nav.stepHeight`.
 *
 * **Where a kerb stands is decided by the NETWORK, not by the placement**: a
 * stone is laid only where one side of it is paved and the other is not. That
 * one rule is what stops a kerb at a crossing, at a T, where a cap abuts
 * another street, along a junction patch's mouth and across a lane leaving the
 * street — for rectangles and paths alike, without either knowing about the
 * other. It is asked of `onRoad` on the footprint MapBuilder already resolved,
 * sampled along the edge and bisected at every change, so a kerb stops within
 * a centimetre of the carriageway it gives way to.
 */

/** Across a kerb stone, centred on the carriageway's edge line. */
const KERB_WIDTH = 0.28;
/** How far a kerb's top stands over the road's own top. */
const KERB_PROUD = 0.035;
/** Top to bottom: the rest is buried in the slab and the floor beside it. */
const KERB_HEIGHT = 0.16;
/** A stone's mean length along the course; each is jittered around it. */
const KERB_STONE = 0.7;
/** The joint left between two stones. */
const KERB_JOINT = 0.014;
/** How far either side of the edge line the footprint is asked about. */
const KERB_PROBE = 0.4;
/** Along-course spacing of that question, before the bisection. */
const KERB_SAMPLE = 0.5;
/** Stretches of kerb shorter than this are not laid. */
const KERB_MIN_RUN = 0.3;

type KerbPoint = [number, number];

/** What a kerb needs of the world: the ground, the network, and the frame. */
interface KerbSite {
  terrain: TerrainField;
  roads: RoadFootprint;
  x: number;
  z: number;
  rotY: number;
  originY: number;
  /** The road's top over the floor — `roadTop` of the street's surface. */
  top: number;
  /** The stones laid so far, by tone, in the placement's own frame. */
  sinks: Map<string, { positions: number[]; normals: number[]; indices: number[] }>;
}

function kerbSite(ctx: BuildCtx, x: number, z: number, rotY: number): KerbSite | null {
  if (!ctx.roads) return null;
  const sink = () => ({ positions: [], normals: [], indices: [] });
  return {
    sinks: new Map([
      [KERB, sink()],
      [KERB_WORN, sink()],
    ]),
    terrain: ctx.terrain,
    roads: ctx.roads,
    x,
    z,
    rotY,
    originY: ctx.y,
    top: roadTop("cobble"),
  };
}

/** A deterministic 0..1 roll off a world position — never `Math.random()`. */
function kerbRoll(x: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d);
  h ^= Math.imul(Math.round(z * 64) | 0, 0x165667b1);
  h ^= Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A junction patch's open-ground ring segments, joined into runs. The ring is
 * closed, so a run that wraps past the last segment is carried on from the
 * first rather than broken in two.
 */
function joinKerbRuns(j: RoadJoin): KerbPoint[][] {
  const n = j.xs.length;
  if (n < 2) return [];
  const runs: KerbPoint[][] = [];
  // Start just after a segment that is NOT kerb, so no run is split at k = 0.
  let start = j.kerb.findIndex((k) => !k);
  if (start < 0) {
    const ring: KerbPoint[] = j.xs.map((x, k) => [x, j.zs[k]]);
    ring.push([j.xs[0], j.zs[0]]);
    return [ring];
  }
  start = (start + 1) % n;
  let run: KerbPoint[] | null = null;
  for (let step = 0; step < n; step++) {
    const k = (start + step) % n;
    if (j.kerb[k]) {
      if (!run) run = [[j.xs[k], j.zs[k]]];
      const k1 = (k + 1) % n;
      run.push([j.xs[k1], j.zs[k1]]);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

/**
 * Lays a kerb course along a world-space polyline, extended by `ext0`/`ext1`
 * past its two ends (negative trims), wherever the network says the edge is
 * an edge. See the section note above.
 */
function layKerb(
  site: KerbSite,
  pts: readonly KerbPoint[],
  ext0: number,
  ext1: number,
): void {
  const acc: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = acc[acc.length - 1];
  if (total < KERB_MIN_RUN) return;

  // Position and unit direction at arc length s, carried straight on past
  // either end so an extension follows the edge it extends.
  const frameAt = (s: number): [number, number, number, number] => {
    let i = 0;
    while (i < pts.length - 2 && acc[i + 1] < s) i++;
    while (i < pts.length - 2 && acc[i + 1] - acc[i] < 1e-9) i++;
    const l = Math.max(acc[i + 1] - acc[i], 1e-9);
    const dx = (pts[i + 1][0] - pts[i][0]) / l;
    const dz = (pts[i + 1][1] - pts[i][1]) / l;
    const u = s - acc[i];
    return [pts[i][0] + dx * u, pts[i][1] + dz * u, dx, dz];
  };
  const paved = (x: number, z: number): boolean => onRoad(site.roads, x, z, 0);
  const isEdge = (s: number): boolean => {
    const [x, z, dx, dz] = frameAt(s);
    const a = paved(x - dz * KERB_PROBE, z + dx * KERB_PROBE);
    const c = paved(x + dz * KERB_PROBE, z - dx * KERB_PROBE);
    return a !== c;
  };
  // Where along the run the edge is an edge, to the centimetre: sampled, and
  // every change of answer bisected.
  const intervals: [number, number][] = [];
  const steps = Math.max(2, Math.ceil(total / KERB_SAMPLE));
  let prevS = 0;
  let prev = isEdge(Math.min(0.02, total / 2));
  let open = prev ? 0 : -1;
  for (let k = 1; k <= steps; k++) {
    const s = k === steps ? total : (total * k) / steps;
    const probeS = k === steps ? Math.max(total - 0.02, total / 2) : s;
    const now = isEdge(probeS);
    if (now !== prev) {
      let lo = prevS;
      let hi = s;
      for (let it = 0; it < 6; it++) {
        const mid = (lo + hi) / 2;
        if (isEdge(mid) === prev) lo = mid;
        else hi = mid;
      }
      const cut = (lo + hi) / 2;
      if (now) open = cut;
      else if (open >= 0) {
        intervals.push([open, cut]);
        open = -1;
      }
    }
    prev = now;
    prevS = s;
  }
  if (open >= 0) intervals.push([open, total]);

  const seed = kerbRoll(pts[0][0], pts[0][1], pts.length);
  for (const [i0, i1] of intervals) {
    // A run end is the caller's corner; an end the network cut is a junction,
    // and a kerb running half its width on into the other street's kerb is
    // what closes the corner there.
    const a = i0 <= 1e-6 ? -ext0 : i0 - KERB_WIDTH / 2;
    const z = i1 >= total - 1e-6 ? total + ext1 : i1 + KERB_WIDTH / 2;
    const span = z - a;
    if (span < KERB_MIN_RUN) continue;
    const n = Math.max(1, Math.round(span / KERB_STONE));
    const raw: number[] = [];
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const r = 0.75 + 0.5 * kerbRoll(i0 * 7.3 + k, seed * 97, k + 11);
      raw.push(r);
      sum += r;
    }
    let s = a;
    for (let k = 0; k < n; k++) {
      const len = (raw[k] / sum) * span;
      kerbStone(site, frameAt(s + KERB_JOINT / 2), frameAt(s + len - KERB_JOINT / 2), k);
      s += len;
    }
  }
}

/**
 * One stone, from one end of its chord to the other, stood on the floor as
 * drawn at both ends and pitched between them — written straight into the
 * site's vertex buffers rather than made as a box part. Cinderhaven lays
 * ~7,900 of them, and a part per stone is a `Mesh` object per stone for the
 * merge to throw away; a box's bottom face is buried and never written.
 */
function kerbStone(
  site: KerbSite,
  from: readonly number[],
  to: readonly number[],
  k: number,
): void {
  const [ax, az] = from;
  const [bx, bz] = to;
  const run = Math.hypot(bx - ax, bz - az);
  if (run < 0.05) return;
  const ya = site.terrain.surfaceAt(ax, az, true);
  const yb = site.terrain.surfaceAt(bx, bz, true);
  const roll = kerbRoll((ax + bx) / 2, (az + bz) / 2, k);
  const lift = site.top + KERB_PROUD - KERB_HEIGHT / 2 - site.originY + (roll - 0.5) * 0.008;
  // Into the placement's own frame, which MapBuilder rotates back out of.
  const c = Math.cos(site.rotY);
  const s = Math.sin(site.rotY);
  const local = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - site.x;
    const dz = z - site.z;
    return [dx * c - dz * s, y, dx * s + dz * c];
  };
  const a = local(ax, ya + lift, az);
  const b = local(bx, yb + lift, bz);
  // Forward along the stone (pitched), right across it (level), up = F x R.
  let fx = b[0] - a[0];
  let fy = b[1] - a[1];
  let fz = b[2] - a[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  const hl = Math.hypot(fx, fz);
  const rx = fz / hl;
  const rz = -fx / hl;
  const ux = fy * rz;
  const uy = fz * rx - fx * rz;
  const uz = -fy * rx;
  const hw = KERB_WIDTH / 2;
  const hh = KERB_HEIGHT / 2;
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const cz = (a[2] + b[2]) / 2;
  const hf = fl / 2;
  const corner = (i: number, j: number, m: number): [number, number, number] => [
    cx + rx * hw * i + ux * hh * j + fx * hf * m,
    cy + uy * hh * j + fy * hf * m,
    cz + rz * hw * i + uz * hh * j + fz * hf * m,
  ];
  const sink = site.sinks.get(roll < 0.35 ? KERB_WORN : KERB)!;
  // Each face as its four corners and its outward normal; the winding is
  // settled against the normal, so no face depends on getting an order right.
  const face = (n: [number, number, number], q: [number, number, number][]): void => {
    const base = sink.positions.length / 3;
    for (const p of q) {
      sink.positions.push(p[0], p[1], p[2]);
      sink.normals.push(n[0], n[1], n[2]);
    }
    // Babylon is left-handed: a front face's (p1 - p0) x (p2 - p0) points AWAY
    // from its normal (see TerrainField's `Accum.quad`).
    const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
    const e2 = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
    const cross =
      (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] +
      (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] +
      (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
    if (cross < 0) sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else sink.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  face([ux, uy, uz], [corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1)]);
  face([rx, 0, rz], [corner(1, -1, -1), corner(1, -1, 1), corner(1, 1, 1), corner(1, 1, -1)]);
  face([-rx, 0, -rz], [corner(-1, -1, 1), corner(-1, -1, -1), corner(-1, 1, -1), corner(-1, 1, 1)]);
  face([fx, fy, fz], [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)]);
  face([-fx, -fy, -fz], [corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1)]);
}

/** Hands a road's laid kerbs to its build, one surface per tone. */
function flushKerbs(b: Build, site: KerbSite): void {
  for (const [color, sink] of site.sinks) {
    if (sink.indices.length === 0) continue;
    const data = new VertexData();
    data.positions = sink.positions;
    data.normals = sink.normals;
    data.indices = sink.indices;
    b.surface(data, color);
  }
}

// --- the boardwalk --------------------------------------------------------

/**
 * Walked height of a boardwalk deck. Inside CONFIG.nav.stepHeight (0.6), which
 * is the whole design: every cell of the deck links to the ground beside it, so
 * a walk has no ramps and you step on and off it anywhere along its length.
 */
const WALK_DECK = 0.5;
/**
 * The deck's collider, placed by its TOP face so the walked surface is
 * WALK_DECK however this changes. It is no longer DRAWN: what is drawn is
 * boards across stringers on headstocks on piles, the stilt hut's carpentry,
 * and this box only says where a body stands and where a round stops.
 *
 * It is as deep as that carpentry — boards, a stringer and a headstock come to
 * 0.665 — so a round arriving at the side of the walk stops on timber, give or
 * take the band under the stringers between bents. Nothing drawn stands on the
 * walked surface but a rail outboard of it, and no board is proud of it.
 */
const WALK_DECK_T = 0.64;
/** Metres between pile bents. */
const WALK_BENT = 3.5;
/**
 * How far a span's END bents stand in from its ends. A run is authored as a
 * chain of spans (see `buildBoardwalk`), and a bent at the very end would put
 * two spans' piles in the same place at every joint — two seeded sets of piles
 * through each other. Inset, each span carries its own ends on a short
 * cantilever and a joint reads as two bents side by side, which is what two
 * spans built one after the other are.
 */
const WALK_END_BENT = 0.3;
/**
 * `NavGrid`'s HEADROOM. Under a deck with less clearance than this nobody can
 * walk, so the bents may be braced; over it the ground under the walk is a way
 * through, and nothing is drawn across it below the headstocks.
 */
const WALK_HEADROOM = 1.7;
/** Where a pile stops when there is no ground to read. */
const WALK_PILE_FOOT = -2.2;
/** Board widths, walked by a seed, so no two runs are laid alike. The stilt hut's. */
const BOARD_WIDTHS = [0.21, 0.24, 0.19, 0.26, 0.22, 0.2, 0.25, 0.23];

/**
 * The floor under a placement-local point, as a local height, or null with
 * nothing to read. `MapBuilder`'s rotation: local +X lands on (cos, -sin), +Z
 * on (sin, cos).
 */
function groundUnder(ctx: BuildCtx | undefined, lx: number, lz: number): number | null {
  if (!ctx) return null;
  const cos = Math.cos(ctx.rotY);
  const sin = Math.sin(ctx.rotY);
  return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
}

/**
 * A boarded balustrade over `guard`'s dark core — the stilt hut's, so a walk
 * and a stair up to one carry the rail the huts beside them do: a handrail, a
 * top rail and a bottom rail, boards standing between them with the core
 * showing through the gaps, and posts carried `drop` down over the rim.
 *
 * `surf` is the walked height along the run — level on a walk, pitched on a
 * stair — and `xg` the rail's centreline, half a core outboard of the edge.
 * `newels` makes the first and last posts newels, standing over the handrail
 * with a cap, for a run that ends rather than one that carries on into the
 * next span. All of it is visual: the collider is the guard's.
 */
function balustrade(
  b: Build,
  xg: number,
  z0: number,
  z1: number,
  surf: (z: number) => number,
  posts: readonly number[],
  drop: number,
  newels: boolean,
): void {
  const H = GUARD_HEIGHT;
  const rail = (dy: number, wide: number, thick: number): void => {
    slab(b, [xg, surf(z0) + dy, z0], [xg, surf(z1) + dy, z1], wide, thick, TEAK);
  };
  rail(H + 0.04, 0.28, 0.08);
  rail(H - 0.12, 0.2, 0.08);
  rail(0.12, 0.22, 0.1);
  for (const [i, z] of posts.entries()) {
    const end = newels && (i === 0 || i === posts.length - 1);
    const y0 = surf(z) - drop;
    const y1 = surf(z) + H + (end ? 0.2 : 0);
    b.box(end ? 0.24 : 0.22, y1 - y0, end ? 0.2 : 0.16, xg, (y0 + y1) / 2, z, TEAK);
    if (end) b.box(0.3, 0.06, 0.26, xg, y1 + 0.03, z, TEAK);
  }
  for (let z = z0 + 0.19; z < z1 - 0.1; z += 0.17) {
    if (posts.some((pz) => Math.abs(pz - z) < 0.14)) continue;
    const b0 = surf(z) + 0.17;
    const b1 = surf(z) + H - 0.16;
    b.box(0.2, b1 - b0, 0.1, xg, (b0 + b1) / 2, z, PLANK);
  }
}

/**
 * A plank causeway on piles: the connective tissue between stilt huts, and the
 * way across marsh that is too shallow to be worth a bridge.
 *
 * ## What it is drawn as
 *
 * The stilt hut's platform run out into a causeway, because it stands beside
 * them: boards laid ACROSS the walk, each a seeded width with its ends left
 * ragged past the edge, the odd one replaced in a darker wood and the odd one
 * worn a few millimetres down, over a dark bed so the gaps read as the shadow
 * under a floor. Under them four stringers along the run — the outer two flush
 * with the deck's sides, so the side of the walk is board ends over a timber
 * face — each spliced once over a bent, staggered, with an iron fish plate on
 * the outer pair, and a header across each end. The stringers bear on a
 * headstock at every bent, through-bolted, and each headstock on two piles cut
 * to the GROUND under them on footing stones, each a little different in girth
 * and a little off plumb. Where the walk is low enough that nobody can pass
 * under it the bents are cross-braced and each bay carries a sway brace down
 * the outer piles; where it is lifted past `WALK_HEADROOM` the ground under it
 * is a way through and nothing crosses it. A creeper climbs an outer pile or
 * two and runs on along the stringer.
 *
 * The boards, the splices, the piles and the vines are seeded, and every pile,
 * pad and brace is cut to the ground, off where the span stands — which is
 * what puts it in `CONFORMS_TO_TERRAIN`.
 *
 * ## Why this is not the trestle bridge with a height spinner
 *
 * The two have opposite navigation contracts, and it is geometry rather than a
 * parameter. A boardwalk's deck is under `stepHeight` above its own ground, so
 * it links along its whole length and needs no ramps; its underside is a
 * handspan off the ground, so `severLinks` cuts every link that crosses it and
 * `clearBlocked` blanks the ground beneath. It is a CAUSEWAY — you walk on it,
 * never under it, and that is correct. A trestle's deck is 1.6 m up: it links
 * only at its two ramped ends, and its underside clears `HEADROOM`, so the bed
 * stays walkable and you wade underneath. One builder with a `height` spinner
 * would cross 0.6 somewhere in the middle of its range and silently disconnect
 * itself from the map, with nothing to see and nothing thrown.
 *
 * ## Author it as a chain
 *
 * `MapBuilder` samples the terrain ONCE, at a placement's own centre, so a long
 * walk over anything but level ground floats at one end and buries itself at
 * the other — the problem `terrainSlab` solves for roads, which is not
 * available here because a boardwalk is a collider and a road is not. The fix
 * is authoring: lay a run as two or three 9–16 m placements so each samples its
 * own ground. Adjacent decks whose heights differ by less than `HEIGHT_EPS`
 * merge into one nav surface, so the joints cost nothing — and each span
 * carries its own end bents (`WALK_END_BENT`), so a joint draws as two.
 *
 * ## Raising one with a layout `y` is a different building
 *
 * Nothing stops a placement lifting a walk a storey — Greyfen's treeline hamlet
 * does exactly that — but it spends the causeway contract above: past
 * `stepHeight` the deck stops linking to the ground anywhere along its length,
 * and past `HEADROOM` the ground underneath comes back as an approach you can
 * fight along. That is a fine thing to build ON PURPOSE, and `buildStairs` is
 * then not decoration but the only way up. There is nothing in between: a walk
 * lifted into the dead band between the two is a deck nothing can reach and
 * nothing can pass under.
 */
export function buildBoardwalk(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "boardwalk");
  const len = p.length ?? 14;
  const w = p.width ?? 2.4;
  const rails = p.railSide ?? "both";
  const sides = (["-x", "+x"] as const).filter((s) => rails === "both" || rails === s);

  // ------------------------------------------------------------ the masses
  //
  // The deck, placed by its top face, and a rail on each railed side: the
  // boxes it has always emitted, in the order it has always emitted them. The
  // rails stand OUTBOARD of the deck edge — a rail sitting on the walked surface
  // would steal whichever 1.5 m nav cell its sample lands in — and each one's
  // box is the balustrade's dark core.
  b.block({ w, h: WALK_DECK_T, d: len, x: 0, y: WALK_DECK - WALK_DECK_T / 2, z: 0 });
  for (const side of sides) {
    b.guard(side, ((side === "+x" ? 1 : -1) * w) / 2, 0, len, WALK_DECK, { color: PITCH });
  }

  // ----------------------------------------------------------- the drawing
  const seed = streetSeed(w, len, WALK_DECK, ctx);
  const D = WALK_DECK;
  /** Board thickness, stringer depth, headstock depth. */
  const DB = 0.045;
  const SD = 0.42;
  const HD = 0.2;
  /** The stringers' top and bottom, and the headstocks' bottom. */
  const sTop = D - DB;
  const sBot = sTop - SD;
  const hBot = sBot - HD;
  const bents = Math.max(1, Math.round((len - 2 * WALK_END_BENT) / WALK_BENT));
  const bentZ = (i: number): number => -len / 2 + WALK_END_BENT + (i / bents) * (len - 2 * WALK_END_BENT);

  // ---- the boards, across the walk, on a dark bed sunk between the stringers
  // so the gaps read as the shadow under a floor rather than as the marsh. The
  // bed is emitted after everything over it (see the end of the drawing).
  {
    let z0 = -len / 2;
    for (let i = 0; z0 < len / 2 - 0.05; i++) {
      const bw = Math.min(BOARD_WIDTHS[(i + seed) % BOARD_WIDTHS.length], len / 2 - z0);
      // The odd board replaced in a different wood, and the odd one worn down.
      const tone = (i * 7 + seed) % 13 === 4 ? TEAK : PLANK;
      const worn = (i * 5 + (seed >>> 4)) % 11 === 3 ? 0.006 : 0;
      // Each end cut where the saw left it, a few centimetres past the stringer.
      const x0 = -w / 2 - 0.02 - ((i * 3 + seed) % 5) * 0.01;
      const x1 = w / 2 + 0.02 + ((i * 7 + (seed >>> 2)) % 5) * 0.01;
      b.box(x1 - x0, DB, bw - 0.018, (x0 + x1) / 2, D - DB / 2 - worn, z0 + bw / 2, tone);
      z0 += bw;
    }
  }

  // ---- four stringers along the run, the outer pair flush with the deck's
  // sides, each spliced once over a bent where the run is long enough to need
  // it — staggered, so no two joints share a bent — and a header across each end.
  const xs = [-1, -1 / 3, 1 / 3, 1].map((f) => f * (w / 2 - 0.06));
  for (const [k, x] of xs.entries()) {
    const outer = k === 0 || k === xs.length - 1;
    const cut = bents >= 2 && len > 7 ? bentZ(1 + ((k + seed) % (bents - 1))) : null;
    const spans = cut === null ? [[-len / 2, len / 2]] : [[-len / 2, cut - 0.006], [cut + 0.006, len / 2]];
    for (const [a, c] of spans) b.box(outer ? 0.12 : 0.1, SD, c - a, x, (sTop + sBot) / 2, (a + c) / 2, TIMBER);
    if (outer && cut !== null) {
      const fx = Math.sign(x) * (w / 2 + 0.006);
      b.box(0.012, 0.18, 0.7, fx, (sTop + sBot) / 2, cut, IRON);
      for (const dz of [-0.24, -0.1, 0.1, 0.24]) b.box(0.03, 0.045, 0.045, fx, (sTop + sBot) / 2, cut + dz, IRON);
    }
  }
  for (const sz of [-1, 1]) b.box(w, SD, 0.08, 0, (sTop + sBot) / 2, (sz * (len - 0.08)) / 2, TIMBER);
  // The bed under the boards, AFTER them: what is hidden is emitted after what
  // hides it, so the depth test rejects it rather than shading it twice.
  b.box(w - 0.04, 0.02, len - 0.04, 0, sTop - 0.04, 0, PITCH);

  // ---- the bents: a headstock under the stringers, through-bolted, on two
  // piles cut to the ground under them. Where the ground rises into the
  // headstock there is no pile, and the headstock bears on the ground.
  /** Each bent's pile feet, `[bent][side]`, or null where there is no pile. */
  const feet: (number | null)[][] = [];
  /** And the ground under each, or null with nothing to read. */
  const grounds: (number | null)[][] = [];
  const pileX = w / 2 - 0.12;
  let n = 0;
  for (let i = 0; i <= bents; i++) {
    const z = bentZ(i);
    b.box(w + 0.24, HD, 0.24, 0, (sBot + hBot) / 2, z, TEAK);
    feet.push([]);
    grounds.push([]);
    for (const sx of [-1, 1]) {
      const k = ++n;
      const px = sx * pileX;
      // A bolt head where the outer stringer bears on the headstock, and the
      // nuts of the bolt through the headstock into the pile, either face.
      b.box(0.025, 0.07, 0.07, sx * (w / 2 + 0.012), sBot + 0.09, z, IRON);
      for (const sz of [-1, 1]) b.box(0.075, 0.075, 0.025, px, (sBot + hBot) / 2, z + sz * 0.13, IRON);
      const g = groundUnder(ctx, px, z);
      grounds[i].push(g);
      if (g !== null && g > hBot - 0.05) {
        feet[i].push(null);
        continue;
      }
      const foot = g === null ? WALK_PILE_FOOT : g - 0.3;
      feet[i].push(foot);
      const top = hBot + 0.06;
      const dia = 0.26 + (0.07 * ((k * 5 + seed) % 7)) / 6;
      const lean = (m: number): number => (((k * m + seed) % 5) - 2) * 0.005;
      b.cyl(top - foot, dia * 0.9, dia, 7, px, (top + foot) / 2, z, TIMBER, { x: lean(3), z: lean(7) });
      if (g !== null) b.box(dia + 0.3, 0.14, dia + 0.24, px, g + 0.02, z, MOSS_STONE, { y: k * 0.7 });
    }
  }

  // ---- bracing, where the walk is too low for anyone to pass under it: a
  // pair of diagonals across each bent, one on either face, and a sway brace
  // down the outer piles in every bay, alternating. Over WALK_HEADROOM the
  // ground under the walk is a way through, and none of this is drawn.
  {
    /** The ground a bent's braces come down to, or null where it is not braced. */
    const low = (i: number): number | null => {
      const [fa, fb] = feet[i];
      if (fa === null || fb === null) return null;
      const g = Math.max(grounds[i][0] ?? fa + 0.3, grounds[i][1] ?? fb + 0.3);
      const clear = hBot - g;
      return clear > 0.7 && clear < WALK_HEADROOM ? g : null;
    };
    for (let i = 0; i <= bents; i++) {
      const g = low(i);
      if (g === null) continue;
      for (const sz of [-1, 1]) {
        const zf = bentZ(i) + sz * 0.2;
        slab(b, [-sz * pileX, hBot - 0.08, zf], [sz * pileX, g + 0.35, zf], 0.14, 0.05, TIMBER);
      }
    }
    for (let i = 0; i < bents; i++) {
      const [ia, ib] = i % 2 === 0 ? [i, i + 1] : [i + 1, i];
      const ga = low(ia);
      const gb = low(ib);
      if (ga === null || gb === null) continue;
      for (const sx of [-1, 1]) {
        const xf = sx * (pileX + 0.2);
        slab(b, [xf, hBot - 0.06, bentZ(ia)], [xf, gb + 0.35, bentZ(ib)], 0.14, 0.05, TIMBER);
      }
    }
  }

  // ---- a creeper up an outer pile or two, running on along the stringer.
  for (let v = 0; v < (bents >= 3 ? 2 : 1); v++) {
    const i = (seed + v * 2 + 1) % (bents + 1);
    const si = ((seed >>> (5 + v)) & 1) === 0 ? 0 : 1;
    const foot = feet[i][si];
    if (foot === null) continue;
    const sx = si === 0 ? -1 : 1;
    const z = bentZ(i);
    creeperClimb(b, seed + v, sx * pileX, z, Math.max(foot + 0.3, grounds[i][si] ?? foot + 0.3), hBot, sx * 0.15, 0.04);
    const dir = z > 0 ? -1 : 1;
    for (let j = 0; j < 8; j++) {
      const a = sx * (Math.PI / 2) + ((j % 3) - 1) * 0.7;
      creeperLeaf(b, sx * (w / 2 + 0.04), sBot + 0.06 + (j % 3) * 0.07, z + dir * (0.2 + j * 0.15), a, 0.85);
    }
  }

  // ---- the balustrades, a post on every bent carried down over the stringer.
  for (const side of sides) {
    const sx = side === "+x" ? 1 : -1;
    const posts = Array.from({ length: bents + 1 }, (_, i) => bentZ(i));
    balustrade(b, (sx * (w + GUARD_THICKNESS)) / 2, -len / 2, len / 2, () => D, posts, DB + SD, false);
  }
  return b;
}

// --- the stair -------------------------------------------------------------

/**
 * Rise per metre of run, for every stair the layout places.
 *
 * It is a CONSTANT and not a parameter, and that is the whole safety of this
 * builder. `NavGrid.link` connects neighbouring surfaces only within
 * `stepHeight`, so at `cellSize` 1.5 anything steeper than `MAX_WALKABLE_GRADE`
 * (0.4) severs its own links — a flight over that line is a ladder nothing can
 * climb, with nothing thrown and nothing to see. 0.35 is the manor's service
 * stair: the steepest the kit runs, and a cell of margin under the limit for
 * the ground the foot lands on to be a little off level. A `length` spinner
 * beside a `height` one would be exactly the "crosses 0.6 somewhere in the
 * middle of its range" trap `buildBoardwalk` refuses for the same reason.
 */
const STAIR_GRADE = 0.35;
/** Riser aimed for. The count is rounded off it, so treads come out even. */
const STAIR_RISER = 0.18;
/**
 * How far the flight runs on PAST its own foot, to be buried.
 *
 * `MapBuilder` samples the terrain once, at the placement's CENTRE, and the
 * foot is half a run away from that — so on anything but level ground the
 * bottom step lands in the air or in the soil. The overrun is the manor's
 * `SERVICE_DROP`: no tread is drawn below the ground line, so what is buried
 * costs nothing and what is exposed is a step more of stair.
 */
const STAIR_OVERRUN = 0.6;
/** Metres between the trestles under the flight. */
const STAIR_BENT = 2.2;
/** A string's thickness, and its depth measured plumb — to the collider's underside. */
const STAIR_STRING_T = 0.08;
const STAIR_STRING_D = 0.5;

/**
 * A free-standing flight of stairs: the way up to anything the kit raises past
 * a single step.
 *
 * ## What it is for
 *
 * `buildBoardwalk` puts its deck inside `stepHeight` so a causeway links to the
 * ground along its whole length and needs no access at all. Author the same
 * walk with a `y` in the layout — a village raised over marsh, a deck along a
 * bank — and every one of those links is gone: the deck is a surface in the air
 * with `HEADROOM` under it, walkable, reachable from nowhere, and silent about
 * it. This is the piece that reconnects it, and it serves a terrace lip, a
 * jetty over a cut bank or a hut platform on a rise just as well.
 *
 * ## What it is drawn as
 *
 * A carpenter's stair, in the boardwalk's timber: two closed strings, their
 * tops riding a hand over the nosings and coming level at the head so they
 * butt whatever the flight arrives at rather than standing proud of its deck,
 * and a carriage down the middle. Each tread is two boards housed into the
 * strings, the front one a nosing over a riser set back under it; the odd
 * tread is a replacement in a darker wood. A trestle at every bent but the
 * last carries the span — a headstock under the strings on two posts cut to
 * the ground on footing stones, cross-braced where nobody could stand under
 * it anyway — and the HEAD carries no trestle at all: it hangs off whatever it
 * arrives at, on an iron strap down each string, which is what lets one butt
 * a boardwalk's end or its side without two sets of piles in one place. The
 * feet stand on stones. A creeper climbs a trestle post. The balustrades are
 * the boardwalk's, pitched, with a newel at each end.
 *
 * The treads, the posts and the vine are seeded, and the posts, pads and the
 * strings' feet are cut to the ground off where the flight stands — which is
 * what puts it in `CONFORMS_TO_TERRAIN`.
 *
 * ## How to place one
 *
 * It climbs toward **+Z**, like `buildRamp`, and the placement point is the
 * MIDDLE of the run — so the treads arrive at `length / 2` ahead of it, where
 * `length` is `height / STAIR_GRADE` and is derived rather than authored (see
 * that constant). Butt that arrival against the deck's own edge and the joint
 * costs nothing: the last stair cell and the first deck cell are neighbours
 * within a step, and `NavGrid`'s `HEIGHT_EPS` merges them where they coincide.
 *
 * Two things to keep to. **Both ends want ground the placement's own centre
 * sample is honest about** — a flight is 7 m long at a 2.5 m rise and one
 * height sample serves all of it, which is the authoring rule the boardwalk's
 * header states from the other side. And **do not run one narrower than about
 * 1.6 m**: the nav grid samples one point per 1.5 m cell, so a narrow flight is
 * a chain of surfaces the sampler misses between, and it stops linking to
 * itself before it stops looking like a stair.
 */
export function buildStairs(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "stairs");
  const w = p.width ?? 2.4;
  const rise = p.height ?? 2.5;
  const rails = p.railSide ?? "both";
  const run = rise / STAIR_GRADE;
  const pitch = Math.atan(STAIR_GRADE);
  const topZ = run / 2;
  /** The walked surface at any point on the run. Zero at the foot. */
  const surfaceAt = (z: number): number => rise - (topZ - z) * STAIR_GRADE;
  const steps = Math.max(2, Math.round(rise / STAIR_RISER));
  const sides = (["-x", "+x"] as const).filter((s) => rails === "both" || rails === s);

  // ------------------------------------------------------------ the masses
  //
  // The flight's one pitched collider slab, overrunning its foot into the
  // ground, and a rail on each railed side standing OUTBOARD of the treads —
  // `guard` owns that argument, and a pitched run is why it takes a pitch at
  // all. The walked height at the run's centre is half the rise, since the
  // flight passes through the ground line at its foot. The boxes it has always
  // emitted, in the order it has always emitted them; the flight draws nothing
  // of its own, and each rail's box is the balustrade's dark core.
  b.flight({
    x: 0,
    w,
    topZ,
    topY: rise,
    run: run + STAIR_OVERRUN,
    rise: rise + STAIR_OVERRUN * STAIR_GRADE,
    dir: 1,
    steps,
    color: PLANK,
    drawn: false,
  });
  for (const side of sides) {
    b.guard(side, ((side === "+x" ? 1 : -1) * w) / 2, 0, run, rise / 2, { pitch, color: PITCH });
  }

  // ----------------------------------------------------------- the drawing
  //
  // The treads are stepped exactly as `Build.flight` steps them, so the plane
  // a body walks never parts company with a tread by more than half a riser.
  const seed = streetSeed(w, run, rise, ctx);
  const ground = (lx: number, lz: number): number => groundUnder(ctx, lx, lz) ?? 0;
  const RUN = run + STAIR_OVERRUN;
  const tread = RUN / steps;
  const riser = (rise + STAIR_OVERRUN * STAIR_GRADE) / steps;
  const footZ = topZ - RUN;
  const DB = 0.05;
  const SW = STAIR_STRING_T;
  /** The strings' top edge: a hand over the line through the nosings. */
  const lift = 0.02 + (tread / 2 + 0.03) * STAIR_GRADE + 0.06;
  const stringTop = (z: number): number => surfaceAt(z) + lift;
  const stringBot = (z: number): number => stringTop(z) - STAIR_STRING_D;
  const stringX = w / 2 - SW / 2;

  // ---- the treads: two boards housed into the strings, the front one a
  // nosing standing over a riser set back under it. None below the ground.
  {
    const tw = w - 2 * SW + 0.04;
    let lastTop: number | null = null;
    for (let i = 0; i < steps; i++) {
      const zc = footZ + (i + 0.5) * tread;
      if (surfaceAt(zc) < ground(0, zc) + 0.12) continue;
      const y = surfaceAt(zc) + 0.02;
      const tone = (i * 5 + seed) % 9 === 2 ? TEAK : PLANK;
      const back = i === steps - 1 ? topZ - 0.035 : zc + tread / 2 + 0.035;
      const front = zc - tread / 2 - 0.03;
      b.box(tw, DB, zc - 0.006 - front, 0, y - DB / 2, (front + zc - 0.006) / 2, tone);
      b.box(tw, DB, back - zc - 0.006, 0, y - DB / 2, (back + zc + 0.006) / 2, tone);
      const r0 = lastTop ?? y - riser - 0.1;
      b.box(tw - 0.02, y - DB - r0, 0.03, 0, (y - DB + r0) / 2, zc - tread / 2 + 0.015, TEAK);
      lastTop = y;
    }
    // The last riser, up to the deck the flight arrives at.
    if (lastTop !== null) {
      b.box(tw - 0.02, rise - 0.01 - lastTop, 0.03, 0, (rise - 0.01 + lastTop) / 2, topZ - 0.015, TEAK);
    }
  }

  // ---- the strings, from where they stand on the ground to the head, level
  // over the last tread so they butt the deck rather than stand over it; and a
  // carriage down the middle under the treads.
  /** Where a string's top edge meets the ground at its foot, cut plumb there. */
  const feetZ: number[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * stringX;
    const g = ground(x, -run / 2);
    const zf = Math.max(footZ, topZ - (rise + lift - g - 0.04) / STAIR_GRADE);
    feetZ.push(zf);
    const head = rise - 0.01;
    const zk = topZ - (lift + 0.01) / STAIR_GRADE;
    const face = (fx: number): Point3[] => {
      const pts: Point3[] = [[fx, stringTop(zf), zf]];
      if (zk > zf) pts.push([fx, head, zk]);
      pts.push([fx, head, topZ - 0.005], [fx, stringBot(topZ - 0.005), topZ - 0.005], [fx, stringBot(zf), zf]);
      return pts;
    };
    convexSolid(b, face(x - SW / 2), face(x + SW / 2), TIMBER);
    // The foot on a stone, and the head hung off the deck on an iron strap.
    b.box(0.36, 0.14, 0.6, x, g + 0.03, zf + 0.26, MOSS_STONE, { y: sx * 0.08 });
    const sx2 = x + sx * (SW / 2 + 0.006);
    b.box(0.012, 0.42, 0.07, sx2, stringBot(topZ - 0.04) + 0.25, topZ - 0.04, IRON);
    for (const dy of [0.1, 0.3]) b.box(0.025, 0.045, 0.045, sx2, stringBot(topZ - 0.04) + dy, topZ - 0.04, IRON);
  }
  if (w > 1.8) {
    const z0 = Math.max(...feetZ) + 0.4;
    const z1 = topZ - 0.05;
    slab(b, [0, surfaceAt(z0) - 0.2, z0], [0, surfaceAt(z1) - 0.2, z1], 0.1, 0.22, TIMBER);
  }

  // ---- the trestles, at every bent but the head: a headstock under the
  // strings on two posts cut to the ground, cross-braced where the flight is
  // too low to stand under. Where the ground comes up into the headstock there
  // is no post, and none where the strings are still in the ground.
  const bents = Math.max(1, Math.round(run / STAIR_BENT));
  /** A post's place, foot and ground, for the vine. */
  const posts: [number, number, number, number][] = [];
  let k = 0;
  for (let i = 1; i < bents; i++) {
    const z = -run / 2 + (i / bents) * run;
    const hTop = stringBot(z);
    const hb = hTop - 0.18;
    if (hb < ground(0, z) + 0.15) continue;
    b.box(w + 0.2, 0.18, 0.2, 0, hTop - 0.09, z, TEAK);
    const gs: number[] = [];
    for (const sx of [-1, 1]) {
      const px = sx * stringX;
      const g = ground(px, z);
      gs.push(g);
      for (const sz of [-1, 1]) b.box(0.07, 0.07, 0.025, px, hTop - 0.09, z + sz * 0.115, IRON);
      if (g > hb - 0.05) continue;
      const kk = ++k;
      const top = hb + 0.05;
      const dia = 0.22 + (0.06 * ((kk * 5 + seed) % 7)) / 6;
      const lean = (m: number): number => (((kk * m + seed) % 5) - 2) * 0.004;
      b.cyl(top - (g - 0.3), dia * 0.9, dia, 7, px, (top + g - 0.3) / 2, z, TIMBER, { x: lean(3), z: lean(7) });
      b.box(dia + 0.26, 0.12, dia + 0.22, px, g + 0.02, z, MOSS_STONE, { y: kk * 0.7 });
      posts.push([px, z, g, hb]);
    }
    const g = Math.max(...gs);
    const clear = hb - g;
    if (clear > 0.7 && clear < WALK_HEADROOM && gs.every((gg) => gg <= hb - 0.05)) {
      for (const sz of [-1, 1]) {
        const zf = z + sz * 0.17;
        slab(b, [-sz * stringX, hb - 0.06, zf], [sz * stringX, g + 0.3, zf], 0.13, 0.05, TIMBER);
      }
    }
  }
  if (posts.length > 0) {
    const [px, pz, g, hb] = posts[seed % posts.length];
    creeperClimb(b, seed, px, pz, g + 0.05, hb, Math.sign(px) * 0.13, 0.05);
  }

  // ---- the balustrades: newels at the foot and the head, posts between
  // carried down over the string. The head newel stands on the flight's side
  // of its arrival, so it never stands in the deck it arrives at.
  for (const side of sides) {
    const sx = side === "+x" ? 1 : -1;
    const z0 = -run / 2 + 0.1;
    const z1 = topZ - 0.11;
    const between = Math.max(0, Math.round((z1 - z0) / 1.9) - 1);
    const stops = Array.from({ length: between + 2 }, (_, i) => z0 + (i / (between + 1)) * (z1 - z0));
    balustrade(b, (sx * (w + GUARD_THICKNESS)) / 2, z0, z1, surfaceAt, stops, lift + 0.12, true);
  }
  return b;
}

/**
 * A PILE-AND-HEADSTOCK LANDING STAGE running along Z: plank decking laid across
 * four stringers, tarred piles in pairs outboard of the deck edge, clamped at
 * each bent by a double waling bolted through, braced where the water is deep
 * enough to need it, with a ladder, two bollards and a coil of rope at the
 * seaward head and a sill and a step at the shore end. It was a plank slab with
 * the tops of six posts poking through it.
 *
 * **The collider is the one it has always had**: the deck slab, 0.24 thick,
 * its top 0.57 over local zero. That height is load-bearing — it must stay
 * under `CONFIG.nav.stepHeight` above the mud, or the flood fill never reaches
 * it and bots treat the jetty as a wall — and it means the whole understructure
 * stands in the band between the slab and the water, a few tens of centimetres
 * on every placement. So what reads from the side is the plank ends, the outer
 * stringer, the walings and the pile heads; the braces are drawn and mostly
 * drowned.
 *
 * **Nothing walked is drawn proud of the collider**: the planks' tops are the
 * slab's top (a worn one a few millimetres under it), and the outer stringers'
 * faces and the headers across both ends are flush with its sides, so no round
 * arriving at the edge stops on air. What stands on the deck — the bollards, the
 * cleats, the coil, the fish box — is under 0.3 m and walked over; the pile heads
 * stand outboard of the deck and no higher; the ladder is laid flat on the end.
 *
 * Seeded off where it stands (`streetSeed`) — the planks' widths and wear, the
 * piles' heads and lean, the ladder's side, the fish box — and cut to the
 * ground: each pile is carried into the bed under its own foot and left out
 * where the bank has risen over it, the braces are drawn only where the bed
 * falls away far enough to want one, and the HEAD is whichever end the ground
 * falls away under. That is what puts `jetty` in `CONFORMS_TO_TERRAIN`. The
 * palette is the boathouse's, which stands beside almost every jetty in the
 * game, so it costs no colour a block near one did not already draw. Without a
 * `BuildCtx` (a preview) it is drawn from a bank at +Z out over a bed 0.6 deep.
 */
export function buildJetty(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "jetty");
  const len = p.length ?? 18;
  const w = 3;

  // --- the collider: unchanged ---------------------------------------------
  // Deck top must stay under CONFIG.nav.stepHeight above the mud, or the
  // flood fill never reaches it and bots treat the jetty as a wall.
  b.block({ w, h: 0.24, d: len, x: 0, y: 0.45, z: 0 });

  // --- everything after this is drawing ------------------------------------
  /** The walked surface: the slab's top. */
  const top = 0.57;
  const rnd = mulberry32(streetSeed(w, len, top, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) {
      // A preview: a bank at +Z shelving down to a bed 0.6 under zero.
      const t = Math.min(1, Math.max(0, (lz + len / 2 - len * 0.6) / (len * 0.4)));
      return -0.6 + t * 1.25;
    }
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  /** The lowest of three samples across the deck at `z`. */
  const across = (z: number): number => Math.min(ground(-w / 2, z), ground(0, z), ground(w / 2, z));

  // The head is the end the ground falls away under; the shore end is the
  // other. A level placement keeps its head at -Z.
  const head = across(len / 2) < across(-len / 2) - 0.02 ? 1 : -1;
  const headZ = (head * len) / 2;
  const shoreZ = -headZ;

  const plankT = 0.07;
  /** The stringers' tops: the planks' undersides. */
  const bed = top - plankT;
  const stringerH = 0.2;
  /** The stringers' undersides, which the walings and braces hang from. */
  const soffit = bed - stringerH;
  const pileD = 0.26;
  /** A pile's centre, |x|: outboard, against the outer stringer's face. */
  const pileX = w / 2 + pileD / 2 + 0.01;

  // The decking: planks across, of seeded widths with a gap the ink finds,
  // their ends ragged past the outer stringers, a few worn hollow and a few
  // replaced in fresher timber.
  for (let z = -len / 2; z < len / 2 - 0.05; ) {
    let pw = 0.2 + rnd() * 0.08;
    if (z + pw > len / 2 - 0.12) pw = len / 2 - z;
    const xl = -(w / 2 + 0.02 + rnd() * 0.05);
    const xr = w / 2 + 0.02 + rnd() * 0.05;
    const sink = rnd() < 0.2 ? 0.004 + rnd() * 0.008 : 0;
    const colour = rnd() < 0.08 ? TIMBER : PLANK;
    b.box(xr - xl, plankT, pw - 0.016, (xl + xr) / 2, top - sink - plankT / 2, z + pw / 2, colour);
    z += pw;
  }
  // The stringers the planks are spiked to, emitted after the planks that
  // hide their tops. The outer pair's faces are flush with the slab's sides.
  for (const x of [-(w / 2 - 0.08), -0.5, 0.5, w / 2 - 0.08]) {
    b.box(Math.abs(x) > 1 ? 0.16 : 0.14, stringerH, len, x, bed - stringerH / 2, 0, TIMBER);
  }
  // A header across each end, its face flush with the slab's end.
  for (const s of [-1, 1]) {
    b.box(w, stringerH, 0.1, 0, bed - stringerH / 2, (s * len) / 2 - s * 0.05, TIMBER);
  }

  // The bents: a pair of tarred piles outboard of the deck, clamped by a
  // waling either side of them, bolted through. At most 2.6 m apart.
  const n = Math.max(2, Math.ceil((len - 0.7) / 2.6));
  const bents: number[] = [];
  for (let i = 0; i <= n; i++) bents.push(-len / 2 + 0.35 + (i * (len - 0.7)) / n);
  /** The bed under each pile, for the braces. Null where no pile stands. */
  const feet: (number | null)[][] = [];
  const walH = 0.18;
  const walY = soffit + 0.04 + walH / 2;
  const walT = 0.08;
  for (const z of bents) {
    const row: (number | null)[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * pileX;
      const g = ground(x, z);
      // Cut off a little over the deck, never higher than a step, and a
      // weathered chamfer on the cut.
      const cap = top + 0.06 + rnd() * 0.18;
      const foot = g - 0.4;
      if (g > cap - 0.1) {
        row.push(null);
        continue;
      }
      row.push(g);
      const lean = (rnd() - 0.5) * 0.03;
      b.cyl(cap - 0.04 - foot, pileD, pileD + 0.02, 7, x, (cap - 0.04 + foot) / 2, z, PITCH, { z: lean });
      b.cyl(0.04, pileD * 0.62, pileD, 7, x - lean * (cap - foot) * 0.5, cap - 0.02, z, PITCH);
      // A bolt head on each waling's face.
      for (const dz of [-1, 1]) {
        b.box(0.05, 0.05, 0.03, x, walY, z + dz * (pileD / 2 + walT + 0.015), IRON);
      }
    }
    feet.push(row);
    // The walings: across under the stringers, over the piles' faces, their
    // ends run just past the piles.
    const reach = pileX + pileD / 2 + 0.1;
    for (const dz of [-1, 1]) {
      b.box(reach * 2, walH, walT, 0, walY, z + dz * (pileD / 2 + walT / 2), TIMBER);
    }
  }

  // Braces, where the bed falls far enough under the walings to want one: a
  // cross brace between each bent's pair, turned alternately, and one on the
  // outer face of each side from bent to bent.
  const braceTop = soffit - 0.02;
  bents.forEach((z, i) => {
    const [l, r] = feet[i];
    if (l === null || r === null) return;
    const low = Math.min(l, r);
    if (braceTop - low < 0.5) return;
    const d = i % 2 === 0 ? 1 : -1;
    slab(b, [-d * pileX, braceTop, z], [d * pileX, Math.max(low + 0.1, braceTop - 2 * pileX * 0.7), z], 0.06, 0.14, TIMBER);
  });
  for (const [k, sx] of [[0, -1], [1, 1]] as const) {
    const x = sx * (pileX + pileD / 2 + 0.03);
    for (let i = 0; i < bents.length - 1; i++) {
      const a = feet[i][k];
      const c = feet[i + 1][k];
      if (a === null || c === null) continue;
      const up = i % 2 === 0;
      const lowEnd = (up ? a : c) + 0.12;
      if (braceTop - lowEnd < 0.5) continue;
      const za = bents[i] + 0.18;
      const zc = bents[i + 1] - 0.18;
      slab(b, [x, up ? lowEnd : braceTop, za], [x, up ? braceTop : lowEnd, zc], 0.05, 0.14, TIMBER);
    }
  }

  // Cleats on the deck edge at alternate bents, low enough to walk over.
  bents.forEach((z, i) => {
    if (i % 2 === 1 || Math.abs(z - headZ) < 1) return;
    const x = (i % 4 === 0 ? 1 : -1) * (w / 2 - 0.14);
    b.box(0.07, 0.04, 0.12, x, top + 0.02, z - 0.1, TIMBER);
    b.box(0.07, 0.04, 0.12, x, top + 0.02, z + 0.1, TIMBER);
    b.box(0.08, 0.05, 0.4, x, top + 0.065, z, TIMBER);
  });

  // ---- the head ----
  // A pair of iron bollards near the corners, a coil of rope made fast to one
  // and run over the side, and a fish box by the other.
  const bz = headZ - head * 0.55;
  const ropeSide = rnd() < 0.5 ? -1 : 1;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.32);
    b.cyl(0.18, 0.16, 0.2, 8, x, top + 0.09, bz, IRON);
    b.cyl(0.05, 0.26, 0.2, 8, x, top + 0.2, bz, IRON);
  }
  {
    const bx = ropeSide * (w / 2 - 0.32);
    // Two turns round the bollard's neck.
    const turn: Point3[] = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 8) * Math.PI * 2;
      turn.push([bx + Math.cos(a) * 0.11, top + 0.1 + k * 0.004, bz + Math.sin(a) * 0.11]);
    }
    rope(b, turn, 0.035, 0.035, SAILCLOTH, 5);
    // Then out to the edge and down the side into the water, sagging.
    const edge = ropeSide * (w / 2 + 0.06);
    rope(
      b,
      [
        [bx + ropeSide * 0.1, top + 0.13, bz],
        [edge, top + 0.02, bz - head * 0.25],
        [edge + ropeSide * 0.12, top - 0.35, bz - head * 0.5],
        [edge + ropeSide * 0.2, top - 0.9, bz - head * 0.6],
      ],
      0.035,
      0.035,
      SAILCLOTH,
      5,
    );
    // The fall coiled down on the deck inboard of it: turns laid one on the
    // last, open in the middle — a flat spiral read as a plate.
    const cx = ropeSide * (w / 2 - 0.85);
    const cz = bz - head * 0.2;
    const coil: Point3[] = [];
    for (let k = 0; k <= 40; k++) {
      const a = (k / 10) * Math.PI * 2;
      const r = 0.24 - (k / 40) * 0.04;
      coil.push([cx + Math.cos(a) * r, top + 0.02 + (k / 40) * 0.1, cz + Math.sin(a) * r * 0.9]);
    }
    rope(b, coil, 0.04, 0.04, SAILCLOTH, 5);
  }
  if (rnd() < 0.7) {
    // A fish box, boarded, standing by the other bollard.
    const fx = -ropeSide * (w / 2 - 0.9);
    const fz = bz - head * (0.35 + rnd() * 0.3);
    const yaw = (rnd() - 0.5) * 0.5;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const at = (lx: number, lz: number): [number, number] => [fx + lx * c + lz * s, fz - lx * s + lz * c];
    const fw = 0.62;
    const fd = 0.42;
    const fh = 0.24;
    for (const k of [-1, 1]) {
      const [x1, z1] = at((k * fw) / 2, 0);
      b.box(0.025, fh, fd, x1, top + fh / 2, z1, PLANK, { y: yaw });
      const [x2, z2] = at(0, (k * fd) / 2);
      b.box(fw - 0.05, fh - 0.04, 0.025, x2, top + (fh - 0.04) / 2 + 0.02, z2, PLANK, { y: yaw });
    }
    // Hand-holes read as a dark cleat across each end, and the base inside.
    for (const k of [-1, 1]) {
      const [x1, z1] = at((k * (fw / 2 + 0.02)), 0);
      b.box(0.02, 0.04, fd * 0.8, x1, top + fh - 0.05, z1, TIMBER, { y: yaw });
    }
    const [x0, z0] = at(0, 0);
    b.box(fw - 0.05, 0.02, fd - 0.05, x0, top + 0.04, z0, TIMBER, { y: yaw });
  }
  // The ladder down the end, laid flat on the header, to the bed.
  {
    const g = across(headZ + head * 0.2);
    if (top - g > 0.45) {
      const lx = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.4);
      const lz = headZ + head * 0.14;
      const foot = g - 0.15;
      const stile = top - 0.02 - foot;
      for (const k of [-1, 1]) {
        b.box(0.07, stile, 0.08, lx + k * 0.22, (top - 0.02 + foot) / 2, lz, TIMBER);
      }
      for (let y = top - 0.18; y > foot + 0.1; y -= 0.28) {
        b.box(0.4, 0.045, 0.045, lx, y, lz + head * 0.01, TIMBER);
      }
    }
  }

  // ---- the shore end ----
  // A sill on the ground under the stringers where the deck clears it, with a
  // block under each; and where it clears it by more than a step's worth, a
  // timber step up onto the deck.
  {
    const sz = shoreZ + head * 0.35;
    const g = across(sz);
    const sillH = 0.2;
    const sillTop = Math.min(soffit, g + sillH - 0.05);
    if (soffit - g > 0.08) {
      b.box(w + 0.5, sillTop - (g - 0.15), 0.26, 0, (sillTop + g - 0.15) / 2, sz, TIMBER);
      if (soffit - sillTop > 0.04) {
        for (const x of [-(w / 2 - 0.08), -0.5, 0.5, w / 2 - 0.08]) {
          b.box(0.16, soffit - sillTop, 0.2, x, (soffit + sillTop) / 2, sz, TIMBER);
        }
      }
    }
    // Only where that end really is the bank: a jetty laid level along the
    // waterline has no shore end, and a step there stands in the sea.
    const eg = across(shoreZ - head * 0.3);
    if (top - eg > 0.32 && eg > across(headZ) + 0.15) {
      const stepTop = top - Math.min(0.29, (top - eg) / 2);
      const stepZ = shoreZ - head * 0.22;
      b.box(1.7, stepTop - (eg - 0.1), 0.4, 0, (stepTop + eg - 0.1) / 2, stepZ, PLANK);
      for (const x of [-0.7, 0.7]) {
        b.box(0.14, stepTop - (eg - 0.1) + 0.02, 0.14, x, (stepTop + eg - 0.1) / 2 + 0.01, stepZ - head * 0.2, PITCH);
      }
    }
  }
  return b;
}
