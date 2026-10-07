/**
 * props/fern.ts — buildFernClump: the shuttlecock fern, with the pinnate blade
 * its fronds are laid as. Part of the scatter set: follows the contract in
 * `./index.ts`.
 */
import { Mesh, Scene } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partCylinder, partSurface } from "../parts";
import { frondBend, marksSway, swayRig } from "../sway";
import {
  loft,
  newSheet,
  rachisAt,
  type RachisFrame,
  rachisFrames,
  type Ring,
  type Sheet,
  sheetData,
  sheetFace,
  sheetVert,
  type V3,
  v3add,
  v3dist,
  v3lerp,
} from "./geometry";
import { LEAF, LEAF_LIT } from "./palette";

/** How `pinnateBlade` cuts and folds a blade. */
interface BladeCut {
  /** The blade's half-width a fraction `f` of the way along the rachis. */
  width: (f: number) => number;
  /** How far each half falls from the rib, per metre of its own width. */
  fold: number;
  /** How much further a pinna's point droops below the fold, per metre. */
  droop: number;
  /** How far in toward the rib the cut between two pinnae runs, as a share
   *  of the half-width (small is deep). */
  notch: number;
  /** How far forward a pinna's point is swept, in metres. */
  sweep: number;
  /** How far under the top's rib the underside's runs, at the stalk. */
  thick: number;
  /** How far the two sides' pinnae are staggered, in intervals. */
  stagger: number;
  /** Extra droop per point, `[side][pinna]`, for a fringe that is not ruled. */
  ragged?: readonly (readonly number[])[];
  /**
   * ROUNDS each pinna's end: the point becomes two, this share of an
   * interval apart along the rachis and drawn a little way back toward the
   * rib, so the end is blunt where it was a spike. One vertex a pinna more.
   * Absent is pointed, the fern's.
   */
  blunt?: number;
  /**
   * The blade's sway RIG, for a frond on the rigged layer (`world/sway.ts`):
   * the frond's phase, and the half-width a pinna's point is `edge` 1 at.
   * Every vertex is then written where it is along the rachis and how far out
   * from it — so the top and the underside, which meet at the notches and the
   * points, are written the same there and cannot part. Absent is filler, the
   * fern's, whose layer is a ramp.
   */
  rig?: { phase: number; reach: number };
}

/**
 * A PINNATE blade along a rachis, one pinna per interval a side — the fern's
 * frond and the jungle palm's.
 *
 * Each half is FOLDED down from the rib, so the bands put a lit half and a
 * shade half on every blade and the ink draws the rib where they meet; its
 * edge runs out to a point and back in to a notch once per pinna, the two
 * sides staggered. Every blade is a CLOSED lens — a flatter fold under the
 * top one meeting it at the points and the notches — because the world's
 * shadow map records back faces and the translucency term measures a crown's
 * thickness off its front ones. Smooth along the blade, creased at the rib.
 */
function pinnateBlade(
  pts: readonly V3[],
  frames: readonly RachisFrame[],
  cut: BladeCut,
  top: Sheet,
  under: Sheet,
): void {
  const S = pts.length - 1;
  const { width, fold, droop, notch, sweep, thick, stagger, ragged, blunt, rig } = cut;
  // `f` along the rachis and `out` metres from it, as the rig the vertex owes.
  const at = (f: number, out: number): [number, number] | undefined =>
    rig ? swayRig(frondBend(f), rig.phase, out / rig.reach) : undefined;
  [-1, 1].forEach((s, k) => {
    // The top half and the underside, which meet at the notches and the
    // points; the underside's rib is the blade's thickness under the top's.
    for (const below of [false, true]) {
      const into = below ? under : top;
      const normal = (side: V3, up: V3, fall: number): V3 =>
        below ? v3add(v3add([0, 0, 0], up, -1), side, -s * fold * 0.6) : v3add(up, side, s * fall);
      const ribs: number[] = [];
      const notches: number[] = [];
      for (let i = 0; i <= S; i++) {
        const { side, up } = frames[i];
        const w = width(i / S) * notch;
        const n = normal(side, up, fold);
        ribs.push(sheetVert(into, below ? v3add(pts[i], up, -thick * (1 - 0.6 * (i / S))) : pts[i], n, at(i / S, 0)));
        notches.push(sheetVert(into, v3add(v3add(pts[i], side, s * w), up, -fold * w), n, at(i / S, w)));
      }
      for (let i = 0; i < S; i++) {
        const f = (i + 0.5 + s * stagger) / S;
        const { p, t, side, up } = rachisAt(pts, frames, f);
        const w = width(f);
        const fall = ragged ? fold + droop + ragged[k][i] : fold + droop;
        const tip = v3add(v3add(v3add(p, side, s * w), up, -fall * w), t, sweep);
        const n = normal(side, up, fall);
        if (!blunt) {
          const point = sheetVert(into, tip, n, at(f, w));
          sheetFace(into, ribs[i], notches[i], point);
          sheetFace(into, ribs[i], point, ribs[i + 1]);
          sheetFace(into, ribs[i + 1], point, notches[i + 1]);
          continue;
        }
        // Back from the point along the pinna, toward the middle of its foot,
        // and either side of that along the rachis: a short square end, which
        // the bands and the ink draw as a round one at any range it is seen at.
        const half = (blunt * v3dist(pts[i], pts[i + 1])) / 2;
        const foot = v3add(v3add(p, side, s * w * notch), up, -fold * w * notch);
        const end = v3lerp(tip, foot, 0.07);
        // The two corners are a share of an interval either side of `f`, and
        // written there: the bend is steep out at the tip, and two corners of
        // one pinna on one number would move as a slab against its neighbours.
        const df = blunt / (2 * S);
        const back = sheetVert(into, v3add(end, t, -half), n, at(f - df, w * 0.93));
        const front = sheetVert(into, v3add(end, t, half), n, at(f + df, w * 0.93));
        sheetFace(into, ribs[i], notches[i], back);
        sheetFace(into, ribs[i], back, front);
        sheetFace(into, ribs[i], front, ribs[i + 1]);
        sheetFace(into, ribs[i + 1], front, notches[i + 1]);
      }
    }
  });
}

/**
 * Fern clump: a SHUTTLECOCK fern — a crown of arching fronds out of one
 * rootstock, the youngest standing up in the middle and the oldest spread
 * round them to the ground, each frond a folded blade whose edge is cut into
 * pinnae, with a fiddlehead or two uncurling at the heart. The one fern serves
 * both of its maps: a male fern under a Harrowmead hedgerow and the understory
 * between Greyfen's buttresses are the same plant to anybody not carrying a
 * flora.
 *
 * **It was a starfish of green planks**: seven to ten boxes out of a green
 * stump, each bent once at the knee, so it read as boards laid in the dirt from
 * every side and a cog from above. What makes it a fern is three things, each
 * an edge the bands or the ink can find, never a texture:
 *
 * - **A frond is FOLDED along its midrib** — a shallow roof with the rachis as
 *   its ridge — so the bands put a lit half and a shade half on every frond and
 *   the ink draws the rib where the two meet.
 * - **Its edge is PINNAE**: the outline runs out to a forward-swept point and
 *   back in to a notch once per pinna pair, the two sides staggered, so the
 *   silhouette is a saw from every side. That is where the COUNT of edges a
 *   clump is read by comes from now; a blade's size no longer has to supply it.
 * - **The fronds are a SHUTTLECOCK, not a ring**: turned by the golden angle,
 *   and by AGE — a young frond leaves steep and arches over, an old one leaves
 *   low and runs out to lie on the ground — so the clump is a vase with a skirt
 *   rather than a star of identical blades.
 *
 * Every frond is a CLOSED lens — a flatter fold under the top one, meeting it
 * at the pinnae — because the world's shadow map records back faces and the
 * translucency term measures a crown's thickness off its front ones. The
 * halves are smooth along the frond and creased at the rib, so the arch bands
 * light-to-shade from the rise to the droop while the fold stays a hard edge.
 *
 * **Non-blocking, and that is the load-bearing decision here.** The canopy tree
 * keeps its foliage out of its collider because there is nothing to shoot nine
 * metres up; a fern sits at exactly the height of the hit sphere, so the same
 * reasoning inverts — anything soft at chest height must be either genuinely
 * solid or genuinely absent, never visible and shot straight through. And
 * solid is the wrong answer, because the one promise a jungle-tree belt makes
 * is that the canopy starts nine metres up and the sight lines under it stay
 * open. A bullet-stopping box in every gap between the trunks would contradict
 * that, punch nav holes through the understory and give bots one more thing to
 * wedge on. You walk through ferns. `bramble` makes the same call.
 *
 * **It takes exactly the draws from the shared stream the plank fern took** —
 * its blade count, then two plus four per blade — and spends none of them:
 * `rng` is the map's scatter stream, and every draw from it moves every prop
 * sown after this one. Its detail comes from `sub`, the per-prop stream
 * `MapBuilder` mints for exactly this.
 *
 * Budgeted as DRESSING: about 750 stand on Harrowmead and 370 on Greyfen, so a
 * vertex here is seven hundred in the scene. Two sheets (the lit colour and
 * the shade), the fiddleheads and the rootstock, in the three materials the
 * plank fern wore, so it costs no draw call the old one did not.
 */
export function buildFernClump(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  sub: () => number,
): Mesh {
  // The plank fern's draws, taken and not spent (see the header).
  const planks = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < 1 + planks * 4; i++) rng();
  const own = sub;

  const frondShade = mats.getTranslucent(LEAF, CONFIG.graphics.translucency.canopy);
  const frondLit = mats.getTranslucent(LEAF_LIT, CONFIG.graphics.translucency.canopy);

  // The rootstock: a low green mound of old frond bases the fronds grow out
  // of. Sunk under the foot so a slope cannot lift it out, and NOT marked —
  // it is the one part of a fern that is genuinely planted.
  const stock = partCylinder(
    "fern-stock",
    { height: 0.22, diameterTop: 0.15, diameterBottom: 0.3, tessellation: 6 },
    scene,
  );
  stock.position.y = 0.03;
  stock.material = mats.get(LEAF);

  // One sheet per colour. Every frond half is its own run of vertices — the
  // rib is a crease, so the two halves cannot share one — smooth along its
  // length, with each triangle wound off its own vertex normal.
  const lit = newSheet();
  const shade = newSheet();

  // Stations along a frond. Nine intervals is nine pinna pairs a side: a
  // real frond has twenty, and at the range a clump is read from nine
  // leaflets a side is already a frond where one was a plank.
  const S = 9;
  // Where the stipe ends and the blade begins, as a fraction of the frond.
  const STIPE = 0.14;
  // How far each half falls from the rib, per metre of its own width: the
  // fold that puts a lit half and a shade half on every frond.
  const FOLD = 0.36;
  // How much further a pinna's point droops below the fold.
  const DROOP = 0.24;
  // How far in toward the rib the cut between two pinnae runs, as a share of
  // the blade's half-width, and how far forward a pinna's point is swept, as a
  // share of one interval. Deep and nearly square to the rib is a LEAFLET; a
  // shallow cut swept well forward read as the teeth of a saw.
  const NOTCH = 0.26;
  const SWEEP = 0.22;

  const fronds = 7 + Math.floor(own() * 4);
  const turn = own() * Math.PI * 2;
  for (let k = 0; k < fronds; k++) {
    // 0 is the youngest, in the middle and upright; 1 the oldest, outermost
    // and lying on the ground.
    const age = k / (fronds - 1);
    const a = turn + k * 2.39996 + (own() - 0.5) * 0.3;
    const len = 0.78 + age * 0.22 + own() * 0.14;
    const e0 = 1.45 - age * 0.62 + (own() - 0.5) * 0.14;
    const e1 = e0 - 0.85 - age * 0.65 - own() * 0.18;
    const W = len * (0.17 + own() * 0.04);
    const roll = (own() - 0.5) * 0.5;
    const width = (t: number): number => {
      if (t <= STIPE) return 0.012;
      const u = (t - STIPE) / (1 - STIPE);
      return Math.max(0.012 * (1 - u), W * Math.sin(Math.PI * Math.pow(u, 0.75)));
    };

    // The rachis: out of the rootstock and arching over, its elevation
    // falling steadily along it, and held off the ground where an old frond
    // runs out onto it.
    const pts: V3[] = [[Math.sin(a) * 0.05, 0.1, Math.cos(a) * 0.05]];
    for (let i = 1; i <= S; i++) {
      const e = e0 + ((e1 - e0) * (i - 0.5)) / S;
      const d = len / S;
      const p = pts[i - 1];
      pts.push([
        p[0] + Math.sin(a) * Math.cos(e) * d,
        Math.max(0.03, p[1] + Math.sin(e) * d),
        p[2] + Math.cos(a) * Math.cos(e) * d,
      ]);
    }
    // Young fronds are the fresh green, old ones the dark.
    const top = own() < 0.9 - age * 0.6 ? lit : shade;
    pinnateBlade(
      pts,
      rachisFrames(pts, a, roll),
      { width, fold: FOLD, droop: DROOP, notch: NOTCH, sweep: (len / S) * SWEEP, thick: 0.02, stagger: 0.14 },
      top,
      shade,
    );
  }

  const surface = (name: string, s: Sheet, material: typeof frondLit): void => {
    if (!s.indices.length) return;
    const mesh = partSurface(name, sheetData(s), scene);
    mesh.parent = stock;
    mesh.position.y = -stock.position.y;
    mesh.material = material;
    // The understory layer, which is the one the player walks THROUGH. A
    // frond leaves the rootstock at 0.1 m, where the ramp has given it a few
    // millimetres, inside a stock 0.15 m across, so the join is buried.
    marksSway(mesh, "understory");
  };
  surface("fern-fronds-lit", lit, frondLit);
  surface("fern-fronds", shade, frondShade);

  // Fiddleheads: a young frond not yet unrolled, a stalk out of the heart of
  // the crown curling over outward into a coil. Fat in the coil, where the
  // pinnae are still packed, and in the fresh green.
  const heads = 1 + Math.floor(own() * 3);
  for (let h = 0; h < heads; h++) {
    const b = turn + h * 2.1 + own() * 0.8;
    const tall = 0.2 + own() * 0.12;
    const rc = 0.035 + own() * 0.012;
    const at = (u: number, v: number, r: number): Ring => ({ x: Math.sin(b) * u, y: v, z: Math.cos(b) * u, r });
    const rings: Ring[] = [at(0.01, 0.06, 0.011), at(0.02, tall * 0.5, 0.011), at(0.03, tall - 0.01, 0.012)];
    // A spiral about a centre just outward of the stalk's head: up and over,
    // down the far side and back in under itself, tightening as it goes.
    for (let j = 1; j <= 8; j++) {
      const f = j / 8;
      const th = Math.PI - f * Math.PI * 2.4;
      const r = rc * (1 - 0.62 * f);
      rings.push(at(0.03 + rc + Math.cos(th) * r, tall + Math.sin(th) * r, 0.016 - 0.008 * f));
    }
    const head = loft(`fern-head${h}`, rings, 4, scene);
    head.parent = stock;
    head.position.y = -stock.position.y;
    head.material = frondLit;
    marksSway(head, "understory");
  }
  return stock;
}
