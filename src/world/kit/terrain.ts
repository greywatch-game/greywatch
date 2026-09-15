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
  CREEPER,
  DARK_STONE,
  DIRT,
  GUARD_THICKNESS,
  KERB,
  KERB_WORN,
  PLANK,
  ROAD_PAINT,
  TEAK,
  TIMBER,
} from "./core";

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
 * The deck slab's thickness, placed by its TOP face so the walked surface is
 * WALK_DECK however this changes.
 *
 * It is deliberately deeper than the height it stands at. `OutlineRenderer`
 * draws the outline shell with a slope-scaled negative depth offset, and at the
 * grazing angle you see a walked surface from, the shell's underside wins the
 * depth test unless there is real depth behind the top face — which paints the
 * deck flat in its own ink. The manor's 0.14 m board deck is the worked failure
 * (see CLAUDE.md); `boardDeck` in kit/manor.ts is the worked fix. Everything
 * else the boardwalk draws hangs BELOW this box, because a batten laid on top
 * of the walked surface would be a thin slab again with nothing behind it.
 */
const WALK_DECK_T = 0.64;
/** Metres between pile bents. */
const WALK_BENT = 3.5;

/**
 * A plank causeway on piles: the connective tissue between stilt huts, and the
 * way across marsh that is too shallow to be worth a bridge.
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
 * merge into one nav surface, so the joints cost nothing.
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
): Structure {
  const b = new Build(scene, mats, "boardwalk");
  const len = p.length ?? 14;
  const w = p.width ?? 2.4;
  const rails = p.railSide ?? "both";

  // The deck: visual and collider in one box, placed by its top face.
  b.wall(w, WALK_DECK_T, len, 0, WALK_DECK - WALK_DECK_T / 2, 0, PLANK);

  const under = WALK_DECK - WALK_DECK_T;
  const bents = Math.max(1, Math.round(len / WALK_BENT));
  for (let i = 0; i <= bents; i++) {
    const z = -len / 2 + (i / bents) * len;
    // Cross-bearer, tucked directly under the deck so the slab reads as boards
    // carried on timber rather than as one extruded block.
    b.box(w + 0.24, 0.18, 0.22, 0, under - 0.09, z, TEAK);
    for (const sx of [-1, 1]) {
      // Piles. Visual only, and they must stay that way: a collider here would
      // sever the links under the walk, spend a nav surface below the deck, and
      // give bots something to wedge on. buildJetty makes the same call.
      b.cyl(1.5, 0.2, 0.26, 5, (sx * w) / 2.6, under - 0.18 - 0.75, z, TEAK);
    }
    // Creeper down alternate outer piles — the jungle read, and the reason a
    // boardwalk over a channel does not look like decking.
    if (i % 2 === 1) {
      b.box(0.07, 0.9, 0.16, (-w) / 2.6 - 0.13, under - 0.55, z, CREEPER);
    }
  }

  // Rails. `guard` stands them OUTBOARD of the deck edge — a rail sitting on the
  // walked surface would steal whichever 1.5 m nav cell its sample lands in.
  for (const side of ["-x", "+x"] as const) {
    if (rails !== "both" && rails !== side) continue;
    const sx = side === "+x" ? 1 : -1;
    b.guard(side, (sx * w) / 2, 0, len, WALK_DECK, { color: TEAK });
    // Posts on the rail's own centreline, which is half a thickness outboard —
    // drawn at the deck edge they would be inside the guard box and invisible.
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    for (let i = 0; i <= bents; i++) {
      const z = -len / 2 + (i / bents) * len;
      b.box(0.17, 1.1, 0.17, postX, WALK_DECK + 0.55, z, TIMBER);
    }
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
 * `SERVICE_DROP`: `Build.flight` skips every tread below the local ground line,
 * so what is buried costs nothing and what is exposed is a step more of stair.
 */
const STAIR_OVERRUN = 0.6;
/** Metres between the trestles under the flight. */
const STAIR_BENT = 2.2;

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

  // The flight, overrunning its foot into the ground. One pitched collider
  // slab: treads are visual, per Build.flight.
  b.flight({
    x: 0,
    w,
    topZ,
    topY: rise,
    run: run + STAIR_OVERRUN,
    rise: rise + STAIR_OVERRUN * STAIR_GRADE,
    dir: 1,
    steps: Math.max(2, Math.round(rise / STAIR_RISER)),
    color: PLANK,
  });

  // Trestles carrying the span, and a pair of stringer piles at the head where
  // it meets the deck. Visual only — the same call `buildBoardwalk` and
  // `buildJetty` make about their piles, and here it also keeps the space under
  // a stair open, which is what stops the flight severing the links beside it.
  const bents = Math.max(1, Math.round(run / STAIR_BENT));
  for (let i = 1; i <= bents; i++) {
    const z = -run / 2 + (i / bents) * run;
    const head = surfaceAt(z) - 0.34;
    if (head < 0.5) continue;
    b.box(w + 0.2, 0.16, 0.2, 0, head, z, TEAK);
    for (const sx of [-1, 1]) {
      b.cyl(head + 0.5, 0.2, 0.26, 5, (sx * w) / 2.6, (head - 0.5) / 2, z, TEAK);
    }
    // Creeper up alternate legs. The jungle read the boardwalk already carries,
    // so a flight up to one does not arrive as fresh carpentry.
    if (i % 2 === 0) {
      b.box(0.07, Math.min(1.1, head), 0.16, -w / 2.6 - 0.13, head / 2, z, CREEPER);
    }
  }

  // Rails, standing OUTBOARD of the treads: `guard` owns that argument, and a
  // pitched run is why it takes a pitch at all. The walked height at the run's
  // centre is half the rise, since the flight passes through the ground line at
  // its foot.
  for (const side of ["-x", "+x"] as const) {
    if (rails !== "both" && rails !== side) continue;
    const sx = side === "+x" ? 1 : -1;
    b.guard(side, (sx * w) / 2, 0, run, rise / 2, { pitch, color: TEAK });
    // Newels at the foot and the head, on the rail's own centreline — drawn at
    // the tread edge they would be inside the guard box and invisible.
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    for (const z of [-run / 2, topZ]) {
      b.box(0.17, 1.3, 0.17, postX, surfaceAt(z) + 0.65, z, TIMBER);
    }
  }
  return b;
}

/** Rotting jetty over the bog, running along Z. */
export function buildJetty(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "jetty");
  const len = p.length ?? 18;
  const w = 3;
  // Deck top must stay under CONFIG.nav.stepHeight above the mud, or the
  // flood fill never reaches it and bots treat the jetty as a wall.
  b.box(w, 0.24, len, 0, 0.45, 0, PLANK);
  b.block({ w, h: 0.24, d: len, x: 0, y: 0.45, z: 0 });
  const posts = Math.round(len / 3);
  for (let i = 0; i <= posts; i++) {
    const z = -len / 2 + (i / posts) * len;
    for (const sx of [-1, 1]) {
      b.cyl(1.3, 0.26, 0.32, 5, (sx * w) / 2.5, 0.05, z, TIMBER);
    }
  }
  return b;
}
