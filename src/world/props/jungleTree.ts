/**
 * props/jungleTree.ts — buildJungleTree, the jungle palm, and buildLianaVeil,
 * the curtain it hangs from its crown, with the feather blade its fronds are
 * laid as. Part of the scatter set: follows the contract in `./index.ts`.
 */
import {
  CreateBoxVertexData,
  CreateCylinderVertexData,
  Mesh,
  MeshBuilder,
  Scene,
  VertexData,
} from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partSurface } from "../parts";
import { mulberry32 } from "../rng";
import { frondBend, marksSway, rigPhase, swayRig } from "../sway";
import {
  type Flat,
  loft,
  newSheet,
  prism,
  prismData,
  type RachisFrame,
  rachisFrames,
  type Ring,
  type Sheet,
  sheetData,
  sheetFace,
  sheetVert,
  type V3,
  v3add,
  v3cross,
  v3dist,
  v3lerp,
  v3unit,
} from "./geometry";
import { JUNGLE_BARK, LEAF, VINE } from "./palette";

// The jungle palm's crown, and the veil hung from it: the same two values as
// the broadleaf's, pulled most of the way to OLIVE. A feather frond is read as
// forty leaflets each with a lit half and a shade half, and at the broadleaf's
// saturation those bands posterise into stripes of grass green; a sage crown
// is read by its value, which is what the reference draws it in
// (`reference-media/jungletrees.jpg`). No draw call: the crown is its own
// merge group already, being the only thing on the `frond` layer with the veil.
const PALM_LEAF = "#36472c";
const PALM_LEAF_LIT = "#5e7346";

/**
 * Where one liana strand takes hold, in the trunk's own frame relative to the
 * veil's collar: `a` around the axis, `r` out from it, `y` up or down from the
 * collar's centre. Built by `buildJungleTree` out of the frond ring it has just
 * made and consumed by `buildLianaVeil` — see both for why the tree is what
 * decides this.
 */
export interface LianaHang {
  a: number;
  r: number;
  y: number;
  /**
   * The frond's motion where the strand takes hold — `frondBend` of how far
   * along it, and its phase — so the strand rides the blade it hangs off
   * (`world/sway.ts`). 0 for a strand on the bole, which does not move.
   */
  bend: number;
  phase: number;
}

/**
 * `data` with one sway RIG (`swayRig`) written over its filler `uv` on every
 * vertex — for a part that rides one point of a rigged frond whole.
 */
function withRig(data: VertexData, rig: readonly [number, number]): VertexData {
  const n = (data.positions?.length ?? 0) / 3;
  const uvs = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    uvs[i * 2] = rig[0];
    uvs[i * 2 + 1] = rig[1];
  }
  data.uvs = uvs;
  return data;
}

/** How `featherBlade` lays its leaflets. */
interface FeatherCut {
  /** How far out from the rachis, square to it, a leaflet's end reaches a
   *  fraction `f` of the way along the blade. */
  reach: (f: number) => number;
  /** How far each leaflet's end falls below the rib, per metre of reach. */
  fold: number;
  /** How far forward each leaflet's end lies, per metre of reach: 1 lays
   *  every leaflet along the frond at 45 degrees, whatever its length. */
  sweep: number;
  /** A leaflet's width at its widest, as a share of the room its foot has
   *  along the rachis: over 1 and each one overlaps the next like a shingle. */
  girth: number;
  /** How far the half of a leaflet toward the frond's tip stands above its
   *  foot and the half toward the stalk below, per metre of its width: what
   *  puts each leaflet OVER the next one out where they overlap, so the two
   *  never share a plane, and creases it down its midrib. */
  shingle: number;
  /** How far under the top's rib the underside's runs, at the blade's foot. */
  thick: number;
  /** Extra fall per leaflet, `[side][leaflet]`, so no two lie in one plane. */
  ragged: readonly (readonly number[])[];
  /** As `BladeCut.rig`, plus `from`: how far along the whole frond the blade
   *  starts, for a blade on a stalk that bends with it. */
  rig?: { phase: number; reach: number; from: number };
}

/**
 * A FEATHER blade — the jungle palm's frond: one LEAFLET per interval a side,
 * each its own narrow leaf rather than a tooth cut in a shared blade.
 *
 * A leaflet leaves the rachis across the whole of its interval, so the rachis
 * is drawn by the leaflets' own feet and the frond never parts along it, but
 * it swells to its widest a little under halfway out and closes to a ROUND
 * end, so between every pair there is a long lens of sky. Each is creased
 * down its midrib (`keel`), and each falls its own way (`ragged`), so the
 * bands give every leaflet a lit half and a shade half and the ink finds
 * every one of them — the reference's look, where a frond is read as forty
 * separate leaves.
 *
 * **The top and the underside SHARE every vertex but the rib**, which is
 * what makes this cheaper than `pinnateBlade` for twice the leaves. The cel
 * shader shades a FACET and asks the interpolated normal only which way the
 * facet faces, so a shared vertex is given a normal that takes no side: the
 * leaflet's own axis, which lies in every face that leaflet has. Every face
 * also has a rib vertex, top or underside, and that is what decides it. One
 * colour per frond, then, the underside included; it is darker for facing
 * the ground, as a leaf is.
 */
function featherBlade(pts: readonly V3[], frames: readonly RachisFrame[], cut: FeatherCut, into: Sheet): void {
  const S = pts.length - 1;
  const { reach, fold, sweep, girth, shingle, thick, ragged, rig } = cut;
  const at = (f: number, out: number): [number, number] | undefined =>
    rig ? swayRig(frondBend(rig.from + (1 - rig.from) * f), rig.phase, out / rig.reach) : undefined;
  // The rib, top and underside, each one vertex for both halves: the facet
  // shades, so the crease between the halves needs no normal of its own, and
  // the blade's own up and down are all a face here is asked.
  const top: number[] = [];
  const under: number[] = [];
  for (let i = 0; i <= S; i++) {
    const { up } = frames[i];
    top.push(sheetVert(into, pts[i], up, at(i / S, 0)));
    under.push(sheetVert(into, v3add(pts[i], up, -thick * (1 - 0.7 * (i / S))), v3add([0, 0, 0], up, -1), at(i / S, 0)));
  }
  // The rachis itself: a ribbon from the top rib down to the underside's, the
  // blade's thickness deep, so the rib is a line the ink can find between the
  // leaflets' feet, which do not cover it.
  for (let i = 0; i < S; i++) {
    sheetFace(into, top[i], top[i + 1], under[i]);
    sheetFace(into, under[i], top[i + 1], under[i + 1]);
  }
  [-1, 1].forEach((s, k) => {
    for (let i = 0; i < S; i++) {
      const f = i / S;
      const { t, side, up } = frames[i];
      const p = pts[i];
      const w = reach(f);
      const fall = fold + ragged[k][i];
      const end = v3add(v3add(v3add(p, side, s * w), up, -fall * w), t, sweep * w);
      const axis = v3unit(v3add(end, p, -1));
      // Square to the leaflet in its own plane, toward the frond's tip.
      const n = v3unit(v3add(up, side, s * fall));
      let across = v3unit(v3cross(n, axis));
      if (across[0] * t[0] + across[1] * t[1] + across[2] * t[2] < 0) across = v3add([0, 0, 0], across, -1);
      // The room its foot has, square to the leaflet: the interval it leaves
      // the rachis across, foreshortened by the sweep.
      const room = v3dist(pts[i], pts[i + 1]) * Math.abs(across[0] * t[0] + across[1] * t[1] + across[2] * t[2]);
      const half = (room * girth) / 2;
      const lift = shingle * half;
      const WAIST = 0.4;
      const mid = v3lerp(p, end, WAIST);
      // The round end: two corners either side of the point, drawn back.
      const tip = v3lerp(end, mid, 0.14);
      const fOut = (u: number): number => f + (u * sweep * w) / (S * v3dist(pts[i], pts[i + 1]) || 1);
      // Footed at ONE point on the rib, so it narrows into its stalk the way
      // a willow leaf does; it is the overlap with its neighbours that makes
      // the blade whole.
      const q = [
        sheetVert(into, v3add(v3add(mid, across, -half), n, -lift), axis, at(fOut(WAIST), w * WAIST)),
        sheetVert(into, v3add(tip, across, -half * 0.42), axis, at(fOut(0.95), w * 0.95)),
        sheetVert(into, v3add(tip, across, half * 0.42), axis, at(fOut(0.95), w * 0.95)),
        sheetVert(into, v3add(v3add(mid, across, half), n, lift), axis, at(fOut(WAIST), w * WAIST)),
      ];
      for (const a of [top[i], under[i]]) {
        sheetFace(into, a, q[0], q[1]);
        sheetFace(into, a, q[1], q[2]);
        sheetFace(into, a, q[2], q[3]);
      }
    }
  });
}

/**
 * Jungle palm: a buttressed, fluted bole running bare for two storeys into a
 * crown head, and a fountain of FEATHER FRONDS out of it on bare stalks — the
 * young ones standing up out of the middle and arching over, the old ones
 * spread round them and hanging, each a rachis carrying twenty-six leaflets a
 * side and twisting onto its edge toward the tip. The tall counterpart to
 * the pine — where a pine is a cone you see the whole of, this is a column
 * with the foliage held above the fight, so a stand of them roofs the sky
 * without closing the sight lines under it.
 *
 * **It was a hardwood crowned with slabs** — two tiers of lozenge plates under
 * rings of two-segment blades, carried on limbs — and from every distance a
 * player sees it from it read as green boards stacked on a post. The look this
 * game is drawn in finds an edge where depth steps or bends and gives a face
 * one value per band, so a slab is one shape and one tone however big it is.
 * A frond is the opposite: a feather of separate LEAFLETS (`featherBlade`),
 * each footed at a point on the rib, overlapping the next like a shingle and
 * creased down its midrib into a lit half and a shade half — fifty strokes a
 * frond the ink and the bands can find, made of geometry, which is the only
 * way this look can have them (`reference-media/jungletrees.jpg` is the
 * target). It was first a broad blade cut at its edge into a fringe of
 * fourteen pinnae a side, and beside the reference that read as a saw: the
 * reference's frond is read leaflet by leaflet. The crown lets the sky
 * through between the leaflets, so the forest floor is dappled rather than
 * shut.
 *
 * Four things about the shape are load-bearing rather than decorative:
 *
 * - **The lowest leaf hangs at ~6.5 m** on a scale-1 tree (5.6 m at the
 *   region's 0.85), three times clear of the 1.7 m hit sphere — the oldest
 *   frond's tip and the leaflets hanging off it. The collider is the trunk and
 *   its buttress core only (see `PROP_BODIES`), so anything at chest height
 *   would be foliage rounds pass straight through — the pine's rule. The
 *   climber below is the one leaf under the crown, and it is pressed flat on
 *   the bark.
 * - **The bole stays inside the collider's 0.5 m half-width up to the crown**
 *   — flare, flutes and bend together — so the column a round stops on is the
 *   column you see. The BUTTRESSES do not, and are shaped so that what is
 *   outside is low: steep against the bole and falling away, under a metre
 *   high at the box's corner and a surface root under 0.3 m past it. They are
 *   what makes the trunk read as tropical at all; a bare cylinder of this
 *   height is a telegraph pole.
 * - **The fronds sway and the crown head does not**, and every frond's root is
 *   inside it: `buildPalm`'s rule, for `world/sway.ts`'s reason. The stalk is
 *   part of the frond and rigged with it, its bend 0 at the root.
 * - **The crown stays under 11.6 m**, the frozen
 *   `PROP_BODIES.jungleTree.visualTop` — the youngest frond's arch reaches
 *   ~11.35, which is why the head sits LOW (9.0 to 10.2 m) and the fronds
 *   leave it climbing: the vertical room is the root to that ceiling.
 *
 * **Its detail comes from a stream of its OWN, and neither of the two it is
 * handed.** `rng` is the map's shared scatter stream and every draw from it
 * moves every tree, fern and flag walk after this one, so this takes exactly
 * the forty-eight draws it always took, in the same order; `sub` is the veil's
 * (below), and a draw taken from it would re-hang every curtain on the map.
 * So the flutes, the bend, the extra buttresses, the fronds, every leaflet and
 * the climber are drawn from `own`, a generator keyed off this tree's first
 * shared draw — distinct per tree, fixed per layout, and invisible to both of
 * the others. Most of the forty-eight are taken and thrown away now (see the
 * crown).
 *
 * **Some of them carry the belt's mid-story, and it is a CHILD of the trunk
 * rather than a prop placed near one.** `buildLianaVeil` is the curtain and
 * carries the argument for why the layer exists at all; what belongs here is
 * why it is built from inside a tree. A veil has to hang from a crown, and a
 * scattered prop cannot find one — `findSpot`'s burial test pushes anything
 * non-blocking out of a `blocking` tree's box, so a mid-story sampled as its
 * own region lands in the GAPS between the trunks, and neither the anchor's
 * height nor the tree's scale is known to the other. Hung here, all three
 * answer themselves: the veil is parented to the trunk, rides its scale, and
 * hangs at a fixed point on it.
 *
 * **`sub` is why that costs the map nothing, and it is load-bearing.** Every
 * draw the veil makes comes from a stream of its own, so the shared scatter
 * stream sees exactly the draws it saw before this existed and not one more —
 * which is what leaves all 354 trees, all 149 fern clumps and all five flag
 * walks on Greyfen where they already were. Drawing the veil from `rng` would
 * reroll the entire dressing field of any map with a jungle belt on it. It
 * defaults to `rng` so a caller with one stream stays a three-argument call;
 * `MapBuilder.scatterRegion` is what mints the real one.
 *
 * **It is the most-placed model on its map by a wide margin** — some fourteen
 * hundred on Greyfen — so it is budgeted as dressing, a vertex here being
 * fourteen hundred in the scene. That is what the shapes below are chosen
 * against: an outline where a box read as a board, a loft where a cylinder
 * read as a pole, a leaflet at four vertices that its top and its underside
 * SHARE, and nothing that only the far side of a leaf could see — about 4,300
 * vertices a tree on average, most of them fronds, at the Trees setting's
 * `high`; `low` lays fewer leaflets a side for ~2,700 (see the fronds). Built from parts
 * (`world/parts.ts`), like the maple, so none of it is uploaded to the device
 * on its way to the merge, and the whole crown is three of them (`Sheet`):
 * the lit sage, the shade sage and the dead fronds.
 *
 * Nothing here is scaled non-uniformly — `renderOutline` extrudes along vertex
 * normals and `VertexData.transform` does not re-normalise them, so a squashed
 * part grows a lopsided ink shell.
 */
export function buildJungleTree(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  sub: () => number = rng,
  detail = 1,
): Mesh {
  const bark = mats.get(JUNGLE_BARK);
  const vine = mats.get(VINE);
  const leaf = mats.getTranslucent(PALM_LEAF, CONFIG.graphics.translucency.canopy);
  const leafLit = mats.getTranslucent(PALM_LEAF_LIT, CONFIG.graphics.translucency.canopy);
  // A hardwood carries its own weight — a fifth of the pine's already-slight
  // lean, and only enough that a stand of them is not a row of posts. The
  // first shared draw, and the seed of this tree's own stream (see the
  // header): `mulberry32` hands out whole multiples of 2^-32, so the product
  // is an exact integer and no two trees on a map share it.
  const lean = rng();
  const own = mulberry32(Math.floor(lean * 4294967296) ^ 0x2c1b3c6d);

  // Everything below is in the trunk's own frame, whose origin is 5.6 m up
  // (MapBuilder scales that and stands it on the ground), so a height above
  // the FOOT is `h + FOOT`.
  const FOOT = -5.6;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots, a quick narrowing to the column, and a slow taper to the crown. The
  // whole of it is inside the collider's 0.5 m half-width from 0.4 m up, with
  // the flutes and the bend below included — 0.47 at chest height, and 5% of
  // flute puts that at 0.49.
  const GIRTH: readonly Flat[] = [
    [-0.6, 0.62],
    [0, 0.6],
    [0.4, 0.52],
    [1.1, 0.47],
    [2.6, 0.43],
    [5.4, 0.36],
    [7.8, 0.285],
    [9.9, 0.2],
  ];
  // It wanders, a few centimetres either way, and only above head height:
  // a straight bole of this height is the other half of the telegraph pole.
  const bendAmp = 0.05 + own() * 0.05;
  const bendRate = 0.35 + own() * 0.25;
  const bendPhase = own() * Math.PI * 2;
  const bendDir = own() * Math.PI * 2;
  const bole = (h: number): Ring => {
    let r = GIRTH[GIRTH.length - 1][1];
    for (let i = 1; i < GIRTH.length; i++) {
      if (h <= GIRTH[i][0]) {
        const [h0, r0] = GIRTH[i - 1];
        const [h1, r1] = GIRTH[i];
        r = r0 + ((r1 - r0) * (h - h0)) / (h1 - h0);
        break;
      }
    }
    const w = bendAmp * Math.sin(h * bendRate + bendPhase) * Math.min(1, Math.max(0, h - 1.5) / 4);
    return { x: Math.cos(bendDir) * w, y: h + FOOT, z: Math.sin(bendDir) * w, r };
  };
  const SIDES = 8;
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.1);
  // It stops at 9.9 m, inside the crown head, where it once ran on to 11.2 and
  // stood through the top of its own crown: from above, a forest of green
  // plates each with a stump in the middle. The collider still runs to 11.2 —
  // in among the fronds' stalks, where nothing can tell.
  const trunk = loft("jungle-trunk", GIRTH.map(([h]) => bole(h)), SIDES, scene, flute);
  trunk.position.y = -FOOT;
  trunk.material = bark;
  trunk.rotation.z = (lean - 0.5) * 0.05;

  // Buttress roots: plank fins standing out of the bole, steep against it and
  // falling away in a curve to a root that runs on along the ground. The
  // profile is concave on purpose — a fin cut as a triangle or a box reads as
  // cardboard propped against a post, and the curve is what reads as wood
  // that grew there. Thick at the bole and thinning to the tail.
  //
  // Four or five of them. The first three take their heights from the shared
  // stream, as the three boxes they replace did; the rest are the tree's own,
  // and lower.
  const finTurn = rng() * Math.PI * 2;
  const finRise = [rng(), rng(), rng()];
  const fins = own() < 0.5 ? 4 : 5;
  for (let i = 0; i < fins; i++) {
    const a = (i / fins) * Math.PI * 2 + finTurn + (own() - 0.5) * 0.5;
    const h = i < 3 ? 2.3 + finRise[i] * 0.5 : 1.5 + own() * 0.9;
    // Where it meets the ground, and where the root running on from it sinks.
    const foot = 0.75 + h * 0.12 + own() * 0.2;
    const end = foot + 0.3 + own() * 0.35;
    const fin = prism(
      `jungle-buttress${i}`,
      [
        // Inside the bole, from under the ground to above where it leaves.
        [0.1, -0.6],
        [0.1, h + 0.15],
        // Where it leaves the bole, and down the curve.
        [0.4, h],
        [0.55, h * 0.5],
        [0.8, h * 0.2 + 0.06],
        [foot, 0.22],
        // The root's tail, and down into the ground under it — deep enough to
        // stay buried on a slope the tree does not know it stands on.
        [end, 0.05],
        [end - 0.08, -0.6],
      ],
      [0.26, 0.26, 0.24, 0.2, 0.16, 0.12, 0.07, 0.08],
      scene,
      // Inside the bole, inside the bole, and under the ground.
      { skip: [0, 1, 7] },
    );
    fin.parent = trunk;
    fin.position.y = FOOT;
    fin.rotation.y = a;
    fin.material = bark;
  }

  // The rest of the shared stream's forty-eight. The crown they used to place
  // — two tiers of plates and two rings of blades — is gone, and these are
  // taken and not spent (bar the first, which turns the crown) so every tree,
  // fern and flag walk sown after this one stays where it was.
  const crownTurn = rng() * Math.PI * 2;
  for (let i = 0; i < 42; i++) rng();

  // The CROWN HEAD: the knot of frond bases the bole runs up into and every
  // frond leaves from. Unmarked, because it is what buries the fronds' roots
  // while they sway — `buildPalm`'s boss, for its reason. It starts inside the
  // bole, so it rises out of the trunk rather than sitting on it as a cap, and
  // its flutes are the old leaf bases standing proud.
  const HEAD: readonly Flat[] = [
    [9.0, 0.19],
    [9.4, 0.26],
    [9.7, 0.29],
    [9.95, 0.23],
    [10.1, 0.1],
    [10.16, 0.02],
  ];
  const boss = loft(
    "jungle-boss",
    HEAD.map(([h, r]) => ({ ...bole(h), r })),
    7,
    scene,
    Array.from({ length: 7 }, () => (own() - 0.5) * 0.24),
  );
  boss.parent = trunk;
  boss.material = vine;

  // The FRONDS, and the whole of what this tree is drawn by now. It was a
  // crown of slabs — two tiers of lozenge plates under rings of two-segment
  // blades — and at every distance a player sees it from it read as green
  // boards stacked on a post: one value per slab, and a silhouette of a dozen
  // straight edges. A frond here is a feather: a bare stalk out of the head,
  // then a rachis carrying a LEAFLET per interval a side (`featherBlade`).
  //
  // **The leaflets are separate leaves, and that was measured against the
  // reference rather than argued.** Three cuts came before this one. Loose
  // triangles strung along a stalk came back as combs of spikes, thin and
  // hard. A broad blade cut at its edge into fourteen teeth a side fixed the
  // weight and read as a saw, the teeth too few and too big beside the
  // reference's forty-odd leaves. The same blade cut into twenty swept straps
  // read as paper bunting. What reads as the reference is a leaflet shaped
  // like a willow leaf — footed at a point on the rib, widest two fifths of
  // the way out and closing to a round end — at about forty-five degrees to
  // the rachis, twenty-six a side, each overlapping the next and lying OVER it
  // (`shingle`), so the frond is full where they overlap and fringed where
  // they part, and every leaflet carries its own lit half and shade half.
  //
  // Each frond leaves the crown head climbing, on a stalk that stands out of
  // it like the spokes of a vase, and arches over, the turn gathered toward
  // the tip (`curl`) so the far end hangs where a circular arc would only
  // dip; the OLDER it is the lower it leaves, the longer it is and the harder
  // it falls, so the young ones stand up out of the middle and the old ones
  // spread round them and hang. Turned by the golden angle, so no two
  // neighbours lie over each other. The blade also TWISTS onto its side toward
  // the tip, as a king palm's does, so a frond seen from the side is a whole
  // feather rather than a fringe seen edge-on.
  //
  // **The lowest leaf hangs at ~6.5 m on a scale-1 tree** (5.6 at the
  // region's 0.85), measured over two hundred seeds — an old frond's tip and
  // the leaflets hanging off it. Three times the hit sphere's 1.7 m, so
  // nothing a round can find is up here. Hang the old fronds harder and that
  // is the number that moves.
  //
  // **The top is ~11.35 m**, the youngest frond's arch, under the frozen
  // `PROP_BODIES.jungleTree.visualTop` of 11.6. The collider still runs to
  // 11.2, a metre over the head now; up there it is inside the knot of stalks.
  //
  // Budget: some fourteen hundred of these stand on Greyfen, so a leaflet is
  // fourteen hundred in the scene and they are counted — four vertices a
  // leaflet, which its top and its underside share, and three at each rib
  // station for both halves; twenty-six a side on twelve to fourteen fronds,
  // ~4,300 vertices a tree. Measured against the blade crown it replaced, at
  // four vantages in the southern forest, the frame rate is inside the
  // run-to-run spread; what it costs is ~1.5 M scene vertices and ~3 s of
  // round install, and leaflets a side are the lever for both.
  //
  // **That lever is the foliage setting's** (`detail`, `CONFIG.graphics.
  // foliage`): a lower rung lays fewer leaflets a side on a rachis cut into
  // as many intervals, so the rib's stations go with them — a leaflet and its
  // share of the rib are ~10 vertices a frond. Each leaflet is footed across
  // its own interval, so a longer interval is a WIDER leaflet and the blade
  // stays as full as it was without anybody growing it. That is deliberately
  // NOT capped as the broadleaf's `maxGrow` caps a cluster: a frond held to
  // its full-detail leaflet width is a comb with sky between the teeth, and
  // fewer, broader leaflets read as the same full feather from anywhere past
  // a few metres. Nothing about where a frond goes moves: the rachis is the
  // same curve sampled more coarsely, and every frond draws the full count of
  // `ragged` whatever it lays, so every draw after it in `own` is the one it
  // always was. High is the tree it was, vertex for vertex.
  const pinnaeAt = (full: number): number => Math.max(6, Math.round(full * detail));
  const lit = newSheet();
  const shade = newSheet();
  const dry = newSheet();
  const stalkRing: number[] = [];
  // One frond out along bearing `a` from `from`, into `sheet`: a bare STALK
  // `stalk` metres long, then a blade `len` long with `full` leaflets a side
  // at full detail and `pinnaeAt(full)` on this rung,
  // the rachis leaving at elevation `e0` and turning to `e1` at the tip, the
  // turn gathered toward the tip by `curl` (1 is a circular arc). `W` is the
  // longest leaflet's reach square to the rachis, `fold` how hard the leaflets
  // hang from it, `roll` the blade's turn about it at the foot and `twist` how
  // much further it has turned by the tip. Returns the rachis.
  const frond = (
    a: number,
    from: V3,
    stalk: number,
    len: number,
    e0: number,
    e1: number,
    curl: number,
    full: number,
    W: number,
    fold: number,
    roll: number,
    twist: number,
    sheet: Sheet,
    phase?: number,
    limp = false,
  ): V3[] => {
    const K = 3;
    const pinnae = pinnaeAt(full);
    const total = stalk + len;
    const pts: V3[] = [from];
    let run = 0;
    for (let i = 0; i < K + pinnae; i++) {
      const d = i < K ? stalk / K : len / pinnae;
      const u = (run + d / 2) / total;
      run += d;
      const e = e0 + (e1 - e0) * Math.pow(u, curl);
      const p = pts[pts.length - 1];
      pts.push([
        p[0] + Math.sin(a) * Math.cos(e) * d,
        p[1] + Math.sin(e) * d,
        p[2] + Math.cos(a) * Math.cos(e) * d,
      ]);
    }
    const along = stalk / total;
    // The blade TWISTS onto its side toward the tip, as a king palm's does:
    // held flat where it leaves the stalk, it is near edge-up by the end, so a
    // frond seen from the side is a whole feather rather than a fringe.
    const frames = rachisFrames(pts, a, roll).map(({ t, side, up }, i): RachisFrame => {
      const r = twist * Math.pow(Math.max(0, i - K) / pinnae, 1.5);
      const c = Math.cos(r);
      const sn = Math.sin(r);
      return { t, side: v3add(v3add([0, 0, 0], side, c), up, sn), up: v3add(v3add([0, 0, 0], up, c), side, -sn) };
    });
    // The STALK: a round petiole, thick where it leaves the head and running
    // on into the rib.
    const SIDES = 5;
    for (let i = 0; i <= K; i++) {
      const r = 0.1 - (0.055 * i) / K;
      const { side, up } = frames[i];
      const rig = phase === undefined ? undefined : swayRig(frondBend((along * i) / K), phase, 0);
      for (let j = 0; j < SIDES; j++) {
        const th = (j / SIDES) * Math.PI * 2;
        const n = v3add(v3add([0, 0, 0], side, Math.cos(th)), up, Math.sin(th));
        stalkRing.push(sheetVert(sheet, v3add(pts[i], n, r), n, rig));
      }
    }
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < SIDES; j++) {
        const q = i * SIDES + j;
        const q1 = i * SIDES + ((j + 1) % SIDES);
        sheetFace(sheet, stalkRing[q], stalkRing[q + SIDES], stalkRing[q1]);
        sheetFace(sheet, stalkRing[q1], stalkRing[q + SIDES], stalkRing[q1 + SIDES]);
      }
    }
    stalkRing.length = 0;
    // The blade: its longest leaflets a third of the way out, long still at
    // its foot and running out to a short point — the feather's outline.
    const blade = pts.slice(K);
    // Drawn at the full count and laid at this rung's — see `pinnaeAt`.
    const ragged = [0, 1].map(() => Array.from({ length: full }, () => (own() - 0.5) * 0.3).slice(0, pinnae));
    featherBlade(
      blade,
      frames.slice(K),
      {
        reach: (f) => W * Math.max(0.12, Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * f)), 0.7) * (1 - 0.35 * f)),
        fold,
        // A dead frond's leaflets have shrivelled and fallen in along it.
        sweep: limp ? 2.2 : 1.05,
        girth: limp ? 0.7 : 1.3,
        shingle: 0.45,
        thick: 0.04,
        ragged,
        rig: phase === undefined ? undefined : { phase, reach: W, from: along },
      },
      sheet,
    );
    return pts;
  };

  // Where the older fronds ended up, for the veil's hang points below: a
  // liana hangs from foliage that EXISTS rather than from a radius that hopes
  // to be under some.
  const boughs: { a: number; pts: V3[]; phase: number }[] = [];
  const fronds = 12 + Math.floor(own() * 3);
  for (let k = 0; k < fronds; k++) {
    // 0 the youngest, upright in the middle; 1 the oldest, low and drooping.
    const age = k / (fronds - 1);
    const a = crownTurn + k * 2.39996 + (own() - 0.5) * 0.3;
    const len = 4.0 + age * 1.4 + own() * 0.6;
    const e0 = 0.8 - age * 0.45 + (own() - 0.5) * 0.12;
    const e1 = -1.0 - age * 0.5 - own() * 0.15;
    const root = bole(9.8 - age * 0.35);
    const from: V3 = [root.x - Math.sin(a) * 0.08, root.y, root.z - Math.cos(a) * 0.08];
    // Young fronds are the fresh green, old ones the dark.
    const sheet = own() < 0.95 - age * 0.75 ? lit : shade;
    const W = len * (0.13 + own() * 0.03);
    const roll = (own() - 0.5) * 0.4;
    const twist = (own() < 0.5 ? -1 : 1) * (0.35 + age * 0.35 + own() * 0.25);
    // The phase this frond moves on, from numbers already drawn — a draw from
    // `own` here would re-cut every leaflet after it.
    const phase = rigPhase(a, k + lean);
    const stalk = 0.9 + own() * 0.4;
    const pts = frond(a, from, stalk, len, e0, e1, 1.4, 26, W, 0.3 + age * 0.3, roll, twist, sheet, phase);
    if (age >= 0.5) boughs.push({ a, pts, phase });
  }

  // DEAD FRONDS on some, hanging down the bole under the crown in the bark's
  // colour — the skirt of old leaf a palm carries until it falls. Limp and
  // narrow, and turned over (`roll` of a half turn) so its leaflets fall AWAY
  // from the bole it hangs down rather than into it. Not marked — a dead
  // frond hangs stiff while the crown above it moves, and its root is inside
  // the head, which does not move either.
  const dead = own() < 0.45 ? 0 : own() < 0.6 ? 1 : 2;
  for (let k = 0; k < dead; k++) {
    const a = own() * Math.PI * 2;
    const root = bole(9.5 - own() * 0.3);
    const e0 = -0.85 - own() * 0.2;
    frond(a, [root.x, root.y, root.z], 0.5, 2.6 + own() * 0.8, e0, e0 - 0.4, 1, 14, 0.3, 1.6, Math.PI, 0, dry, undefined, true);
  }

  const crown = (name: string, s: Sheet, material: typeof leaf, sways: boolean): void => {
    if (!s.indices.length) return;
    const mesh = partSurface(name, sheetData(s), scene);
    mesh.parent = trunk;
    mesh.material = material;
    // The live crown is RIGGED rather than ramped: each frond bends from its
    // own root in the head, which does not move, so nothing slides over it.
    // It used to be on the canopy ramp and travelled as one piece — every
    // frond is nine to eleven metres up, so every frond got the same travel.
    if (sways) marksSway(mesh, "frond");
  };
  crown("jungle-fronds-lit", lit, leafLit, true);
  crown("jungle-fronds", shade, leaf, true);
  crown("jungle-fronds-dead", dry, bark, false);

  // A CLIMBER on some of them — a vine winding up the bole with broad leaves
  // pressed flat to the bark, the aroid every rainforest trunk carries. It is
  // the one leaf under the canopy, and it may be because it is ON the trunk:
  // flat on a face and never more than a hand's breadth off the bark, so it
  // changes nothing a round or a body meets. It is also the only detail on
  // this tree at the height a player actually looks, which is what it is for.
  // Not every tree, for the veil's reason — a climber on every trunk is a
  // plantation's stakes.
  if (own() < 0.3) {
    const from = 0.25;
    const to = 5.5 + own() * 2.5;
    const turns = (1.1 + own() * 0.8) * (own() < 0.5 ? 1 : -1);
    const phase = own() * Math.PI * 2;
    // Round the bole a clear hand off the widest flute, at `t` of the way up.
    const wind = (t: number, off: number): Ring & { th: number } => {
      const b = bole(from + (to - from) * t);
      const th = phase + turns * Math.PI * 2 * t;
      const r = b.r * 1.05 + off;
      return { x: b.x + Math.sin(th) * r, y: b.y, z: b.z + Math.cos(th) * r, r: 0, th };
    };
    const steps = 10;
    const stem = loft(
      "jungle-climber",
      Array.from({ length: steps }, (_, i) => ({
        ...wind(i / (steps - 1), 0.04),
        r: 0.045 - (0.02 * i) / (steps - 1),
      })),
      4,
      scene,
    );
    stem.parent = trunk;
    stem.material = vine;
    // The leaves are the canopy's green but NOT its material, and the
    // difference is a draw call a block. The crown's leaf is translucent and
    // marked to sway; this is neither — a leaf flat on bark has no sky behind
    // it to glow against, and it may not drift off the trunk it grips — and a
    // translucent mesh that disagrees with its fellows about the sway mark is
    // a merge group of its own in every block with a climber in it. Plain
    // matte, it goes into the block's palette with the bark (see
    // `mergeByMaterial`) and costs nothing but its vertices.
    const blade0 = mats.get(LEAF);
    const count = 5 + Math.floor(own() * 4);
    for (let k = 0; k < count; k++) {
      const at = wind((k + 0.5 + (own() - 0.5) * 0.6) / count, 0.035);
      // A broad blade hanging from its stalk, a hand's length and pointed —
      // the aroid's, not the creeper's fingernail: this one is read at the
      // ten metres a stand is crossed at, not at a wall's arm's length.
      const s = 0.8 + own() * 0.4;
      const blade = prism(
        "jungle-climber-leaf",
        [
          [0, 0],
          [0.11 * s, -0.09 * s],
          [0, -0.34 * s],
          [-0.11 * s, -0.09 * s],
        ],
        0.03,
        scene,
      );
      blade.parent = trunk;
      blade.position.set(at.x, at.y, at.z);
      // Face out from the bole (the blade's own +Z), turned in the bark's
      // plane, and its tip lifted off the bark a little.
      blade.rotation.y = at.th;
      blade.rotation.z = (own() - 0.5) * 1.2;
      blade.rotation.x = -(0.2 + own() * 0.3);
      blade.material = k % 3 === 0 ? vine : blade0;
    }
  }

  // The mid-story. Not every tree: a belt where every trunk wore the same
  // curtain would read as a manufactured screen, and the gaps are what let the
  // layer scatter through the stand rather than ring each trunk in it.
  //
  // **The share is stated per TREE and tuned against the STAND**, which is why
  // it fell from 0.45 to 0.16 when Greyfen's forest thickened. The veil was
  // added to fill eight metres of empty air between a fern and the lowest
  // frond, and at a trunk every ten metres it took nearly half of them to do
  // it. At a trunk every four that air is full of trunks, and the same share
  // would hang three times the curtain in the same volume — a screen, which is
  // the thing this fraction exists to avoid. Sixteen per cent of the denser
  // valley is about a hundred and sixty veils, which is what the sparse one
  // had: the layer keeps its absolute weight while the forest around it
  // triples. It is also the most expensive thing this builder can draw (a veil
  // is about as many triangles as the tree it hangs on), so the number is
  // worth getting right twice over.
  if (sub() < 0.16) {
    // The collar hangs at 4.05 above the trunk's own centre — 9.65 m up a
    // scale-1 tree, half sunk in the crown head (9.0 to 10.2 in the same
    // frame's heights above the foot), so it is gathered where the fronds
    // leave the bole rather than floating under them. Every hang below is
    // stated relative to that line.
    const hangs: LianaHang[] = [];
    // One on the bole, so the collar is visibly holding something. Everything
    // else is out under a frond.
    hangs.push({ a: sub() * Math.PI * 2, r: 0.55, y: 0.02, bend: 0, phase: 0 });
    // The rest, each under one of the older fronds, taken in turn from a
    // random start so no two trees drape the same way. `r` is where along the
    // frond the vine took hold and `y` is the rachis's own height there, which
    // is what puts the strand's top in the fringe instead of beside it.
    const first = Math.floor(sub() * boughs.length);
    for (let i = 0; i < 4; i++) {
      const b = boughs[(first + i) % boughs.length];
      // Out under the frond and BOUNDED there rather than run to its tip,
      // which falls further than `buildLianaVeil`'s hem may start.
      const r = 1.5 + sub() * 1.6;
      const at = b.pts.findIndex((p) => Math.hypot(p[0], p[2]) >= r);
      const p0 = b.pts[Math.max(0, at - 1)];
      const p1 = b.pts[at < 0 ? b.pts.length - 1 : at];
      const r0 = Math.hypot(p0[0], p0[2]);
      const r1 = Math.hypot(p1[0], p1[2]);
      const u = Math.min(1, Math.max(0, (r - r0) / (r1 - r0 || 1)));
      const under = p0[1] + (p1[1] - p0[1]) * u - 0.06;
      // Where along the frond it took hold, which is how much of the frond's
      // motion the strand rides: it hangs off the blade, so it moves with it.
      const along = at < 0 ? 1 : (Math.max(0, at - 1) + u) / (b.pts.length - 1);
      hangs.push({
        bend: frondBend(along),
        phase: b.phase,
        a: b.a + (sub() - 0.5) * 0.3,
        r,
        // FLOORED at -0.4 — 9.25 m up a scale-1 tree, the lowest a hang may
        // start and the number the veil's hem is derived against (see
        // `buildLianaVeil`). Where an old frond has already fallen below
        // that by `r`, the strand starts inside its fringe instead.
        y: Math.max(-0.4, under - 4.05),
      });
    }
    const veil = buildLianaVeil(scene, mats, sub, hangs);
    veil.parent = trunk;
    veil.position.y = 4.05;
  }
  return trunk;
}

/**
 * Liana veil: a curtain of vines hung from a canopy tree's own crown, leafed
 * along its length and ragged along its hem.
 *
 * **This exists to fill a band, and the band is the argument for it.** A fern
 * tops out at 1.2 m and a canopy tree's lowest frond hangs at 9, so a jungle
 * belt is a floor, eight metres of clear air, and a ceiling. That gap is what
 * makes a stand of trunks read as columns in a park rather than as jungle: the
 * eye gets no layer between its feet and the roof, so there is nothing for
 * distance to stack. Every other fix for it fights the belt's own promise —
 * more trunks is a thicker plantation, and foliage brought DOWN to chest height
 * is the thing `buildFernClump` explains at length must never exist. Hanging
 * the layer from ABOVE is the one direction that is free.
 *
 * **It is part of the TREE and not a prop of its own, and that is the whole of
 * why it hangs off anything.** It shipped as a `lianaVeil` scatter region
 * mirroring each tree region's footprint, on the reasoning that a region over a
 * belt puts a veil under a canopy. It does not, and the mechanism is the
 * opposite of incidental: `findSpot` rejects a spot buried in an existing
 * collider, a jungle tree is `blocking` with an 11.2 m box, and every tree
 * region builds before the veils — so the burial test pushed the mid-story into
 * the GAPS between the trunks by construction. Measured over the shipped
 * Greyfen: 179 veils, nearest trunk a median 4.62 m away against a canopy that
 * reaches 4.4 m, a hundred of them outside any canopy at all and thirty-nine
 * past six metres, hanging in open sky. No number could have fixed it, because
 * the anchor's height and the tree's scale were drawn independently and neither
 * knew the other. Hung from the crown there is nothing to keep in step: the
 * veil is a child of the trunk, rides its scale, and cannot be anywhere a tree
 * is not. See `buildJungleTree`, which is the only caller.
 *
 * **Nothing it draws is below 2.4 m, and that number is the whole safety
 * argument.** It clears the 1.7 m hit sphere by 0.7 m, so at any range worth
 * shooting across, a level sightline from a 1.55 m eye passes UNDER the hem —
 * the veil frames the shot instead of standing in it. That is what lets this be
 * non-blocking without repeating the fern's mistake: the fern rule is that
 * anything soft AT CHEST HEIGHT must be genuinely solid or genuinely absent,
 * and the way to obey it is to not be at chest height. So this carries no
 * collider, no `WorldBox` and nothing any ray in the game can find, which is
 * also why it can be hung at a density cover never could.
 *
 * The hem is DERIVED from that floor and the derivation now runs through the
 * TREE's scale rather than a scatter region's — see `drop` below. The tree is
 * the looser of the two (0.85 against the veil region's old 0.9) and the anchor
 * is a metre higher, which nets out as more rope: 6.4 m of fall against 5.6,
 * over a band that starts higher.
 *
 * **Where each strand starts is the CALLER's to say, and that is what makes the
 * layer worth having.** The obvious anchor is the bole, so anything within a
 * metre or so of the axis is under leaf from every angle. Built that way it is
 * genuinely attached and nearly useless: five strands inside a 2 m circle sit
 * within the trunk's own silhouette, so at the twenty metres a belt is read
 * across they thicken the column instead of filling the gap between columns,
 * and the eight metres of clear air the veil exists to close is still clear.
 * The older fronds reach four metres and more and are already built, so
 * `buildJungleTree` hands over the fronds it actually made and a strand hangs
 * from one — out where the curtain is between the trunks rather than on them,
 * and in leaf rather than beside it. That is the whole reason
 * this takes `hangs` instead of picking a radius.
 *
 * The collar is the one part meant to be seen at the top — the woody mass a
 * liana gathers where it meets the bole, sitting half inside the crown so it
 * emerges from the foliage, with one strand of its own so it is visibly
 * holding something.
 *
 * The hem is deliberately uneven. Strands cut to one length read as a curtain
 * rail; the whole silhouette is in the raggedness, which is the same lesson
 * `buildJungleTree` states about its fronds needing two segments.
 */
export function buildLianaVeil(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  hangs: readonly LianaHang[],
): Mesh {
  const bark = mats.get(JUNGLE_BARK);
  const vineMat = mats.get(VINE);
  // What hangs in the canopy's own light gets the canopy's own translucency, so
  // a veil between you and the sky glows the way the fronds above it do.
  const leafMat = mats.getTranslucent(
    PALM_LEAF,
    CONFIG.graphics.translucency.canopy,
  );
  const leafLitMat = mats.getTranslucent(
    PALM_LEAF_LIT,
    CONFIG.graphics.translucency.canopy,
  );

  // The collar, and the root of the hierarchy. Assembled at the ORIGIN like
  // every builder in this set, so its centre is the hang line and every Y
  // below is relative to that; `buildJungleTree` is what lifts it to the
  // crown, and it writes this mesh's own `position`.
  //
  // Proud of the bole by ~8 cm at the height it is hung (the trunk tapers to
  // 0.52 there), which is what makes it a thickening on the trunk rather than
  // a band painted round it. Half of it is inside the crown and half below,
  // so it emerges from the foliage instead of sitting under it.
  const collar = MeshBuilder.CreateCylinder(
    "liana-collar",
    { height: 0.55, diameterTop: 0.58, diameterBottom: 0.7, tessellation: 6 },
    scene,
  );
  // **Deliberately unrotated.** A hexagon's facet alignment is invisible at
  // this size, and turning the root would turn every strand with it — off the
  // blade whose azimuth the caller computed it against, which is the one thing
  // this whole arrangement exists to get right. The tree carries a yaw of its
  // own from `scatterRegion`, and the collar rides that.
  collar.material = bark;

  for (const hang of hangs) {
    // Where the strand takes hold: `a` around the trunk, `r0` out from it, and
    // `top` up or down from the collar — the underside of the blade the caller
    // picked, in the collar's own frame.
    const { a, r: r0, y: top } = hang;
    // The frond's motion at the hang, on every vertex of the strand: it rides
    // the blade it hangs off and has no motion of its own to disagree with it.
    const rig = swayRig(hang.bend, hang.phase, 0);
    // The hem, and the one number in here that is DERIVED rather than picked.
    // The floor is 2.4 m and the collar stands 9.65 m up the trunk, so a hang
    // is at `9.65 + top` — and the lowest a drooping blade offers is 9.25. The
    // veil rides the TREE's scale, so the hem lands at
    // `(9.65 + top - drop) * scale` and `jungleTree`'s minimum of 0.85 caps
    // the drop at 6.40. Anything here over that, or a `jungleTree` region
    // scattered below 0.85, and the veil's whole safety argument is gone with
    // no error to say so. Measured over 400 seeds at that worst case the
    // lowest thing any veil draws sits at 2.90 m.
    const drop = 3.6 + rng() * 2.3;
    const hem = top - drop;
    // How far the curtain swings out as it falls. A vine hangs plumb only if
    // nothing grew it outward, and a plumb one reads as a wire dropped down
    // the trunk. Modest, because `r0` is already out under a blade — the width
    // here is the ring's, not the swing's.
    const flare = 0.1 + rng() * 0.45;
    const sway = (rng() - 0.5) * 0.5;

    // Two segments per strand, the lower one leaning harder — a rope hanging
    // under its own weight is never straight, and the break is where a vine
    // stops reading as a wire. Each is positioned and turned so the pair
    // tracks the same outward line, which is what `radial` is for.
    const radial = (t: number, out: number) => ({
      x: Math.sin(a) * (r0 + flare * out) + Math.cos(a) * sway * t,
      z: Math.cos(a) * (r0 + flare * out) - Math.sin(a) * sway * t,
    });

    const upperLen = drop * 0.55;
    const upperAt = radial(0.28, 0.22);
    const upper = partSurface(
      "liana-strand",
      withRig(CreateBoxVertexData({ width: 0.13, height: upperLen, depth: 0.13 }), rig),
      scene,
    );
    upper.parent = collar;
    upper.position.set(upperAt.x, top - upperLen / 2, upperAt.z);
    upper.rotation.y = a;
    upper.rotation.x = -flare * 0.22;
    upper.material = vineMat;
    // On the FROND layer, with the frond's own rig at the hang: the crown it
    // hangs from is rigged, and a strand left on the canopy ramp would travel
    // a third of a metre under a blade that moves a few centimetres there —
    // hanging from nothing. The COLLAR is deliberately left out: it is a
    // thickening on the bole, and the bole does not move.
    marksSway(upper, "frond");

    const lowerLen = drop * 0.45;
    const lowerAt = radial(0.78, 0.78);
    const lower = partSurface(
      "liana-strand-low",
      withRig(CreateBoxVertexData({ width: 0.11, height: lowerLen, depth: 0.11 }), rig),
      scene,
    );
    lower.parent = collar;
    lower.position.set(lowerAt.x, top - upperLen - lowerLen / 2, lowerAt.z);
    lower.rotation.y = a;
    lower.rotation.x = -flare * 0.1;
    lower.material = vineMat;
    marksSway(lower, "frond");

    // Leaves down the strand, and they are what the layer is actually SEEN by:
    // a 13 cm vine is under a pixel at the range a belt is read across, so the
    // foliage on it is the mid-story as far as the eye is concerned. Each is a
    // pointed blade HANGING from its stalk, cut to a leaf's outline: they were
    // boxes, and next to the crown's pinnae a box on a vine read as a block
    // threaded on a string rather than as leaf.
    //
    // The lowest sits a clear margin above the hem so the bottom of the veil is
    // vine rather than foliage: a leaf is the widest thing here and the hem is
    // the one edge that must not creep downward.
    const leaves = 4;
    for (let j = 0; j < leaves; j++) {
      const t = 0.22 + (j / leaves) * 0.62;
      const at = radial(t, t);
      const s = 0.85 + rng() * 0.5;
      const blade = partSurface(
        "liana-leaf",
        withRig(
          prismData(
            [
              [0, 0],
              [0.13 * s, -0.16 * s],
              [0.04 * s, -0.42 * s],
              [0, -0.56 * s],
              [-0.04 * s, -0.42 * s],
              [-0.13 * s, -0.16 * s],
            ],
            0.03,
          ),
          rig,
        ),
        scene,
      );
      blade.parent = collar;
      blade.position.set(at.x, top - drop * t, at.z);
      blade.rotation.y = rng() * Math.PI;
      // Hanging off the vine, never plumb: a leaf straight down the strand is
      // lost in it, and one held level reads as a shelf.
      blade.rotation.x = -(0.25 + rng() * 0.5);
      blade.material = j === 0 ? leafLitMat : leafMat;
      marksSway(blade, "frond");
    }

    // A tangle at the hem on some strands — the knot of old growth a liana
    // gathers where it has been hanging longest.
    if (rng() < 0.55) {
      const at = radial(1, 1);
      const knot = partSurface(
        "liana-knot",
        withRig(
          CreateCylinderVertexData({ height: 0.4, diameterTop: 0.3, diameterBottom: 0.22, tessellation: 5 }),
          rig,
        ),
        scene,
      );
      knot.parent = collar;
      knot.position.set(at.x, hem + 0.2, at.z);
      knot.rotation.y = rng() * Math.PI;
      knot.material = vineMat;
      marksSway(knot, "frond");
    }
  }
  return collar;
}
