/**
 * props/ash.ts — buildAshTree: the hedgerow ash, its leaf cluster and its
 * colours. Part of the scatter set: follows the contract in `./index.ts`.
 */
import { Matrix, Mesh, Scene, VertexData } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partSurface } from "../parts";
import { mulberry32 } from "../rng";
import { boughRig, frondBend, rigPhase } from "../sway";
import {
  type Billow,
  type BillowSkin,
  crownPart,
  leafFaces,
  leafStalk,
  rigVerts,
  skinBillows,
} from "./crown";
import {
  type Flat,
  loftData,
  newSheet,
  prismData,
  type Ring,
  type Sheet,
  sheetVert,
  type V3,
  v3add,
  v3dist,
  v3unit,
} from "./geometry";
import { VINE } from "./palette";

// The temperate BROADLEAF, and all three of these are picked against the pine
// standing next to it rather than in the abstract — see `buildAshTree`, whose
// whole job is to be a second tree you can tell apart at two hundred metres.
// Pale grey-green bark, because at that range the only things left of a tree
// are its shape and its VALUE, and a bole a shade lighter than the conifer's is
// half of the difference before a single leaf is drawn.
const ASH_BARK = "#6b6553";
// Summer leaf: warmer and yellower than `NEEDLE`, which is the other half. A
// hedgerow ash in July is the lightest green in a farming valley and a spruce
// belt is the darkest, so the pair should not be a hue apart at fifty metres
// and the same grey at two hundred.
const ASH_LEAF = "#35602f";
const ASH_LEAF_LIT = "#62873a";
// The HEART of each billow of an ash crown (`buildAshTree`): the darkest green
// on the tree, seen in the gaps between leaf clusters and as the billow's
// belly. Plain matte, not translucent — the heart is what the light does NOT
// get through — so it goes into the block's palette with the crown's wood.
const ASH_HEART = "#29432a";
// Ivy on a hedgerow bole: darker and bluer than the ash's own leaf, as ivy is
// against anything deciduous, so the climber reads as a second plant on the
// tree rather than as the crown leaking down it.
const IVY = "#2a3f2b";

/**
 * How many draws `buildAshTree` takes from the shared scatter stream — the
 * number the plate crown it replaced took, and fixed there, so redrawing the
 * tree moved no prop on the map. See its header.
 */
const ASH_SHARED_DRAWS = 56;

/**
 * Hedgerow ash: a pale, faintly ridged bole on a flare of root knees, forking
 * a little over head height into three or four boughs that climb out at a
 * steep angle, each throwing a side branch, and a crown of BILLOWS — eight to
 * eleven separate masses of leaf at the ends of the boughs and up the leader,
 * each a dome of overlapping LEAF CLUSTERS, lit yellow-green on its shoulders
 * and dark in its belly, with sky between them. The temperate BROADLEAF, and
 * the counterpart to the pine in the same way the jungle palm is the
 * counterpart to nothing. A third of them carry ivy.
 * `reference-media/ash-tree.jpg` is the target.
 *
 * **Why a farming valley needed a second tree at all.** A vale dressed in one
 * conifer is a plantation, not farmland: every stand reads as the same dark
 * cone at every distance, so a shelterbelt, a copse and a field boundary all
 * say the same thing, and the ground between them reads as empty rather than
 * as fields. What breaks that is a tree with a different SILHOUETTE — a bare
 * bole under a broad crown against a cone that goes to the ground — because
 * silhouette is the one thing that survives to the far side of a 400 m map.
 * The bark and leaf tones (`ASH_BARK`, `ASH_LEAF`) are the second and third
 * differences and both were chosen against the pine's, not on their own.
 *
 * **It was lozenge plates at the bough ends** — three storeys of six-sided
 * slabs a metre and a half across — and read as green slabs stacked on a pole:
 * the look this game is drawn in gives a face one value per band and finds an
 * edge only where depth steps or bends, so a slab is one shape and one tone
 * however it is tipped. (Before that it was four tiers of boxes, and before
 * that a smooth-shaded crown of puffs, which was thrown out.) What the
 * reference draws is the opposite — every mass of leaf broken into CLUSTERS
 * whose lower edges are each a stroke, the shade deepening into the belly.
 * So each billow is two things:
 *
 * - **A HEART** (`ASH_HEART`): a lumpy, flat-bellied geodesic in the darkest
 *   green, two thirds of the billow's size — what is seen in the gaps between
 *   clusters and what the belly is, so a clump is a MASS and never a cloud of
 *   loose leaves you can see the sky through.
 * - **A skin of LEAF CLUSTERS over it** (`ashCluster`): each a cupped rosette
 *   of seven leaf points, laid down the dome's slope like a fish scale with
 *   its lower rim lifted off it, so every cluster overlaps the one below and
 *   its lower edge is a step in depth the ink draws — the reference's
 *   scalloped strokes, made of geometry, which is the only way this look can
 *   have them. The cup creases each point into a lit half and a shade half,
 *   and the points are the crown's serrated silhouette. Lit or shade by where
 *   on the dome a cluster sits and how high its billow is in the crown.
 *
 * The leaf clusters were a FAN of five, then seven, narrow leaflets first, and
 * both read as maple leaves — a star with sky between its points over a heart
 * that showed as a black ball. A full rosette covers what it is laid on, which
 * is what turned a cloud of stars into a mass of leaf.
 *
 * **The whole crown is RIGGED** (the `bough` layer, `world/sway.ts`), and that
 * is what lets the leaf RUSTLE rather than slide. Every vertex above the fork
 * — wood, heart and leaf alike — is written how far it is from the FORK
 * (`frondBend` of the distance, so the crown is stiff at the fork and free at
 * its rim) and the beat of the bough it grows on; every vertex of a leaf
 * cluster is also written where it sits across that cluster and the
 * cluster's own phase (`boughRig`), so each cluster TIPS whole on its stalk
 * (`CONFIG.wind.bough.rustle`). Bend is a function of POSITION
 * alone, so a bough and the billow it buries itself in agree where they meet
 * and nothing tears; the beats differ only between boughs, and every bough
 * meets the next at the fork, where the bend is zero. So the boughs are drawn
 * swaying now too — they bend from the fork, which a vertex ramp could never
 * do honestly (`world/sway.ts`).
 *
 * Four things about the shape are load-bearing rather than decorative:
 *
 * - **The lowest leaf hangs at ~3.6 m**, twice clear of the 1.7 m hit sphere.
 *   The collider is the bole only (see `PROP_BODIES`) — the pine's rule, and
 *   the reason the crown is carried high rather than skirted down toward the
 *   grass where it would be foliage rounds pass straight through. A billow's
 *   belly is never under `LOWEST`, and that is checked where each is placed,
 *   not hoped for. It survives scaling, since the whole tree is scaled — down
 *   to the hedgerow standards a generator sows at half size, where it is
 *   still at head height. The crown tops out under 9.75 m, inside
 *   `PROP_BODIES.ashTree.visualTop` (9.9), which is frozen.
 * - **The bole stays inside the collider's 0.34 m half-width** from 0.3 m up,
 *   flutes and bend included, so the column a round stops on is the column
 *   you see. The root knees are what is outside it, and they are under 0.4 m
 *   there and fall to a few centimetres — a thing a boot steps over. The ivy is
 *   pressed to the bark, a few centimetres proud of it.
 * - **Nothing under the fork moves.** The bole carries the collider, so it is
 *   not marked; the leader and every bough are, and each leaves the bole at
 *   the fork's height or above it with a bend of nearly zero.
 * - **Its detail comes from streams of its OWN.** `rng` is the map's shared
 *   scatter stream and every draw from it moves every prop after this one, so
 *   this takes exactly `ASH_SHARED_DRAWS` from it — the first the lean and
 *   the seed of `own`, the rest taken and not spent. Everything structural is
 *   `own`'s; every leaf cluster is a stream seeded per billow, so `detail`
 *   (below) can lay fewer of them without moving a bough.
 *
 * `detail` is the foliage setting (`CONFIG.graphics.foliage`): the share of
 * the clusters a billow is skinned with, each grown to cover what its missing
 * neighbours did. 1 is the full skin; a phone's tier lays fewer, bigger
 * clusters over the same hearts on the same boughs.
 *
 * Budgeted as DRESSING: some three hundred stand on Harrowmead, so a vertex
 * here is three hundred in the scene. Sixteen vertices a cluster, which its
 * top and underside share but for the stalk, about three hundred and forty
 * clusters a tree at full detail — ~6.5 k vertices a tree, ~4 k at a phone's
 * rung. `CONFIG.graphics.foliage` has what each costs, and the cost is mostly
 * PIXELS rather than vertices (half of it went with half the resolution): a
 * crown is a few layers of leaf deep wherever it is seen. Built from parts
 * (`world/parts.ts`), merged to seven at most, so none of it is uploaded on its
 * way to the merge: the bole, the crown's wood, the hearts, the two leaf
 * sheets and the ivy's two. The crown's wood and the hearts are matte, so they
 * go into the block's palette — but being RIGGED they are a merge group of
 * their own, one draw a block that the plate crown did not cost.
 *
 * Nothing here is scaled non-uniformly, for the reason `buildJungleTree`
 * states: a squashed part's normals are not renormalised by the merge.
 */
export function buildAshTree(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  _sub: () => number = rng,
  detail = 1,
): Mesh {
  const bark = mats.get(ASH_BARK);
  const heart = mats.get(ASH_HEART);
  const leaf = mats.getTranslucent(ASH_LEAF, CONFIG.graphics.translucency.canopy);
  const leafLit = mats.getTranslucent(ASH_LEAF_LIT, CONFIG.graphics.translucency.canopy);
  // A standard left in a hedge grows up rather than out — the pine's lean, and
  // for the pine's reason: the silhouette is the crown, so a tilted bole reads
  // as a tree coming down rather than as one with character. The first shared
  // draw, and the seed of this tree's own stream (see the header).
  const lean = rng();
  const seed = Math.floor(lean * 4294967296);
  const own = mulberry32(seed ^ 0x5a17e3b1);
  // The rest of the fifty-six the plate crown took, taken and not spent: the
  // scatter stream draws each tree's yaw and the next tree's spot straight
  // after this returns, so a draw fewer here moves every prop on Harrowmead.
  for (let i = 1; i < ASH_SHARED_DRAWS; i++) rng();

  // Everything below is in the trunk's own frame, whose origin is 4.3 m up
  // (MapBuilder scales that and stands it on the ground), so a height above
  // the FOOT is `h + FOOT`.
  const FOOT = -4.3;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots, the column, and the leader running on up the middle of the crown to
  // die inside the top billow. Inside the collider's 0.34 m half-width from
  // 0.3 m up, flutes and bend included — 0.30 at chest height.
  const GIRTH: readonly Flat[] = [
    [-0.5, 0.46],
    [0, 0.44],
    [0.3, 0.34],
    [0.9, 0.3],
    [2.2, 0.28],
    [3.4, 0.25],
    [4.6, 0.2],
    [6.0, 0.14],
    [7.9, 0.065],
  ];
  const bendAmp = 0.04 + own() * 0.05;
  const bendRate = 0.4 + own() * 0.3;
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
    const w = bendAmp * Math.sin(h * bendRate + bendPhase) * Math.min(1, Math.max(0, h - 1.5) / 3);
    return { x: Math.cos(bendDir) * w, y: h + FOOT, z: Math.sin(bendDir) * w, r };
  };
  const SIDES = 7;
  // Shallow flutes: an old ash's bark is ridged, and a section a few per cent
  // out of round is what the bands find as ridges running up the column.
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.08);

  // The FORK: where the boughs leave the bole, a little over head height —
  // the bare bole under a broad crown is the silhouette (see the header).
  // Everything above it sways and is measured from it; nothing below does.
  const FORK = 3.7 + own() * 0.4;
  const forkAt = bole(FORK);
  const fork: V3 = [forkAt.x, forkAt.y, forkAt.z];
  // How far from the fork the crown's rim is, the distance a vertex's bend
  // is measured against: 1 there, a cantilever's curve inside it.
  const SPAN = 4.6;
  // `tilt` and `leaf` are a leaf cluster's: where across it the vertex is
  // and the cluster's own phase (`boughRig`) — 0 for wood and hearts.
  const rigAt = (p: V3, phase: number, tilt = 0, leaf = 0): [number, number] =>
    boughRig(frondBend(v3dist(p, fork) / SPAN), phase, tilt, leaf);
  // Writes `rigAt` over every vertex of `data`, for a part the bough carries
  // whole — wood, a heart.
  const rigged = (data: VertexData, phase: number): VertexData => rigVerts(data, (p) => rigAt(p, phase));
  // A part's geometry turned and moved, as a mesh's rotation and position
  // would have — so a knee or an ivy leaf can be merged rather than parented.
  const placed = (data: VertexData, x: number, y: number, z: number, ry: number, rx = 0, rz = 0): VertexData => {
    data.transform(Matrix.RotationYawPitchRoll(ry, rx, rz).multiply(Matrix.Translation(x, y, z)));
    return data;
  };

  // The bole, to a little over the fork, where the boughs bury their roots.
  const boleParts: VertexData[] = [
    loftData(
      GIRTH.filter(([h]) => h < FORK + 0.3).map(([h]) => bole(h)).concat([bole(FORK + 0.3)]),
      SIDES,
      flute,
    ),
  ];
  // Root knees: the flare breaking into four or five low spurs where the bole
  // meets the ground — the thing that says a tree GREW here rather than was
  // stood here. Under 0.4 m where they leave the collider and falling to a few
  // centimetres, so each is something a boot steps over; sunk 0.4 m under the
  // foot so a slope the tree does not know it stands on cannot lift one out.
  const knees = own() < 0.5 ? 4 : 5;
  const kneeTurn = own() * Math.PI * 2;
  for (let i = 0; i < knees; i++) {
    const a = (i / knees) * Math.PI * 2 + kneeTurn + (own() - 0.5) * 0.6;
    const end = 0.62 + own() * 0.3;
    const knee = prismData(
      [
        [0.1, -0.4],
        [0.1, 0.55],
        [0.3, 0.38],
        [0.46, 0.16],
        [end, 0.04],
        [end - 0.06, -0.4],
      ],
      [0.2, 0.2, 0.18, 0.13, 0.07, 0.07],
      // Inside the bole, and under the ground.
      { skip: [0, 5] },
    );
    boleParts.push(placed(knee, 0, FOOT, 0, a));
  }

  // The CROWN's wood, every member of it rigged, and the billows it carries.
  const wood: VertexData[] = [];
  const clumps: Billow[] = [];
  // No billow's belly under this — what holds the lowest leaf where the
  // header says it is. A cluster hangs at most ~0.2 m under the belly.
  const LOWEST = 3.65 + FOOT;
  // A billow's half-height for its half-width: a dome on a flatter belly.
  const SQUAT = 0.68;
  const addClump = (c: V3, r: number, phase: number): void => {
    const h = r * SQUAT;
    // Lifted rather than shrunk: a billow keeps its size and stands higher.
    const y = Math.max(c[1], LOWEST + h * 0.85);
    clumps.push({ c: [c[0], y, c[2]], r, h, phase });
  };
  // A round member through `pts`, `r0` at its root and `r1` at its end.
  const member = (pts: readonly V3[], r0: number, r1: number, sides: number, phase: number): void => {
    const n = pts.length - 1;
    wood.push(
      rigged(
        loftData(
          pts.map(([x, y, z], i) => ({ x, y, z, r: r0 + ((r1 - r0) * i) / n })),
          sides,
        ),
        phase,
      ),
    );
  };
  // A run from `from` out on bearing `a`, leaving at elevation `e0` and
  // easing to `e1` by its end, `len` long in `n` steps, each kinked a little —
  // an ash's branching is in straight-ish runs that turn where a shoot grew,
  // not in smooth arcs.
  const run = (from: V3, a: number, e0: number, e1: number, len: number, n: number): V3[] => {
    const pts: V3[] = [from];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const e = e0 + (e1 - e0) * u + (own() - 0.5) * 0.18;
      const b = a + (own() - 0.5) * 0.22;
      const d = len / n;
      const p = pts[pts.length - 1];
      pts.push([p[0] + Math.sin(b) * Math.cos(e) * d, p[1] + Math.sin(e) * d, p[2] + Math.cos(b) * Math.cos(e) * d]);
    }
    return pts;
  };

  // The LEADER: on up the middle from the fork, carrying the top billow and
  // the crown's crest. Its beat is the first; each bough below has its own.
  const leaderPhase = rigPhase(seed * 1e-9, 0.5);
  const leaderPts: V3[] = [];
  for (let h = FORK - 0.25; h < 7.9; h += 0.9) {
    const b = bole(h);
    leaderPts.push([b.x, b.y, b.z]);
  }
  {
    const b = bole(7.9);
    leaderPts.push([b.x, b.y, b.z]);
  }
  wood.push(
    rigged(
      loftData(
        leaderPts.map(([x, y, z]) => ({ x, y, z, r: bole(y - FOOT).r * 0.97 })),
        6,
      ),
      leaderPhase,
    ),
  );
  // The top billow: the biggest, over the leader's end, its crest the top of
  // the tree (under 9.75 m with its clusters, inside `visualTop`).
  const topR = 1.45 + own() * 0.2;
  const crown = bole(8.6 - topR * SQUAT * 0.5);
  addClump([crown.x + (own() - 0.5) * 0.4, crown.y, crown.z + (own() - 0.5) * 0.4], topR, leaderPhase);

  // The BOUGHS: three or four, leaving the bole at staggered heights round
  // the fork and climbing out at forty to fifty-five degrees, each easing
  // flatter toward its end — the ash's habit. Each ends in a billow; most
  // throw a side branch off their first third to a billow lower and further
  // out, the skirt of the crown; and between each pair of boughs the leader
  // carries a billow of the upper crown on a twig of its own, which closes the
  // dome's shoulder. The crown is still OPEN — the billows are separate
  // masses, and the sky and the boughs seen between them are half of what an
  // ash is.
  const limbs = own() < 0.5 ? 4 : 3;
  const limbTurn = own() * Math.PI * 2;
  const bearings: number[] = [];
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + limbTurn + (own() - 0.5) * 0.6;
    bearings.push(a);
    const phase = rigPhase(a, i + lean);
    const rootH = FORK - 0.35 + (i / limbs) * 0.7 + own() * 0.2;
    const root = bole(rootH);
    const e = 0.55 + own() * 0.2;
    const len = 3.3 + own() * 0.8;
    const pts = run([root.x, root.y, root.z], a, e + 0.2, e - 0.3, len, 4);
    member(pts, root.r * 0.62, 0.06, 6, phase);
    const tip = pts[pts.length - 1];
    addClump([tip[0], tip[1] + 0.3, tip[2]], 1.35 + own() * 0.3, phase);

    if (own() < 0.9) {
      // Out of the bough's first bend, where it is still thick enough to bury
      // a branch half its girth, and out flatter than the bough.
      const base = pts[1];
      const side = a + (own() < 0.5 ? -1 : 1) * (0.55 + own() * 0.35);
      const bp = run(base, side, 0.4 + own() * 0.2, 0.0, 1.9 + own() * 0.6, 3);
      member(bp, 0.08, 0.04, 5, phase);
      const end = bp[bp.length - 1];
      addClump([end[0], end[1] + 0.2, end[2]], 1.1 + own() * 0.3, phase);
    }
  }
  // The shoulder: a billow between each pair of boughs, out from the leader
  // on a twig, in the upper crown.
  const sorted = [...bearings].sort((p, q) => p - q);
  for (let i = 0; i < sorted.length; i++) {
    if (own() < 0.1) continue;
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    const a = (sorted[i] + next) / 2 + (own() - 0.5) * 0.4;
    const from = bole(5.3 + own() * 0.8);
    const tp = run([from.x, from.y, from.z], a, 0.5, 0.25, 1.6 + own() * 0.6, 2);
    member(tp, 0.07, 0.04, 5, leaderPhase);
    const end = tp[tp.length - 1];
    addClump([end[0], end[1] + 0.25, end[2]], 1.2 + own() * 0.3, leaderPhase);
  }

  // The HEARTS and the LEAF CLUSTERS on them.
  const lit = newSheet();
  const shade = newSheet();
  const hearts = skinBillows(clumps, seed, detail, ASH_SKIN, rigAt, rigged, lit, shade);

  const part = (name: string, data: VertexData[] | Sheet, material: typeof bark, sways: boolean): void =>
    crownPart(scene, trunk, name, data, material, sways);
  const trunk = partSurface("ash-trunk", boleParts[0].merge(boleParts.slice(1)), scene);
  trunk.position.y = -FOOT;
  trunk.material = bark;
  trunk.rotation.z = (lean - 0.5) * 0.05;
  // Emitted leaf first and hearts last: the merge keeps the order, so the
  // depth test rejects the heart behind the clusters instead of shading it.
  part("ash-leaf-lit", lit, leafLit, true);
  part("ash-leaf", shade, leaf, true);
  part("ash-boughs", wood, bark, true);
  part("ash-hearts", hearts, heart, true);

  // IVY on some of the boles — the hedgerow's own climber, and the one detail
  // on this tree at the height a player actually looks. A dark stem winding up
  // the bark with small leaves pressed flat to it, never a hand's breadth off
  // the bark. Plain matte and NOT marked, for the jungle climber's reason: a
  // leaf flat on bark has no sky behind it to glow against and may not drift
  // off the trunk it grips, and a matte colour goes into the block's palette
  // with the bark and costs nothing but its vertices.
  if (own() < 0.35) {
    const from = 0.1;
    const to = 2.6 + own() * 1.2;
    const turns = (0.8 + own() * 0.7) * (own() < 0.5 ? 1 : -1);
    const phase = own() * Math.PI * 2;
    const wind = (t: number, off: number): Ring & { th: number } => {
      const b = bole(from + (to - from) * t);
      const th = phase + turns * Math.PI * 2 * t;
      const r = b.r * 1.04 + off;
      return { x: b.x + Math.sin(th) * r, y: b.y, z: b.z + Math.cos(th) * r, r: 0, th };
    };
    const steps = 8;
    const vineParts: VertexData[] = [
      loftData(
        Array.from({ length: steps }, (_, i) => ({
          ...wind(i / (steps - 1), 0.025),
          r: 0.03 - (0.015 * i) / (steps - 1),
        })),
        4,
      ),
    ];
    const darkParts: VertexData[] = [];
    const count = 12 + Math.floor(own() * 8);
    for (let k = 0; k < count; k++) {
      const at = wind((k + 0.5 + (own() - 0.5) * 0.8) / count, 0.03);
      // Offset round the stem a little either side, so the leaves read as a
      // growth on the bark rather than beads on a string.
      const s = 0.8 + own() * 0.5;
      const ivy = prismData(
        [
          [0, 0.02 * s],
          [0.09 * s, -0.05 * s],
          [0.05 * s, -0.12 * s],
          [0, -0.17 * s],
          [-0.05 * s, -0.12 * s],
          [-0.09 * s, -0.05 * s],
        ],
        0.025,
      );
      const y = at.y + (own() - 0.5) * 0.1;
      const ry = at.th + (own() - 0.5) * 0.35;
      const rz = (own() - 0.5) * 1.6;
      const rx = -(0.15 + own() * 0.25);
      (own() < 0.3 ? vineParts : darkParts).push(placed(ivy, at.x, y, at.z, ry, rx, rz));
    }
    part("ash-ivy", vineParts, mats.get(VINE), false);
    part("ash-ivy-leaf", darkParts, mats.get(IVY), false);
  }
  return trunk;
}

/**
 * One LEAF CLUSTER of an ash crown (`buildAshTree`): a ROSETTE of `ASH_TIPS`
 * leaf points round a stalk at `p`, laid on a billow whose outward normal
 * there is `out`, `L` its reach from stalk to point.
 *
 * Tipped DOWN the billow's slope by `lift` radians, so on a dome every
 * cluster's lower rim stands off the surface over the cluster below it like a
 * scale — a step in depth the ink draws as the reference's scalloped strokes
 * — and CUPPED, its stalk standing proud of its points, so each leaf point is
 * creased into a lit half and a shade half and the rosette bands as a little
 * dome of its own. Its rim runs out to a point and back to a notch once per
 * leaf, so where a cluster meets the sky the crown's edge is serrated rather
 * than round. A full rosette rather than a fan: a fan leaves the billow
 * showing through behind its stalk, and a rosette covers what it is laid on.
 *
 * Built as `featherBlade` builds a leaflet, and for its reasons: a CLOSED
 * lens (the world's shadow map records back faces), the top and the underside
 * SHARING every rim vertex, and each rim vertex given its own direction out
 * from the stalk as its normal — which lies in both faces it bounds on each
 * side, so the stalk's vertex alone decides which way a face looks.
 * `2 + 2 * ASH_TIPS` vertices a cluster. `rig` is each vertex's sway rig, from
 * where it is and where it sits across the cluster's tipping axis (`tilt`,
 * -1..1 through the stalk), so the cluster RUSTLES — turns whole on its stalk —
 * rather than warping (`boughRig`).
 */
function ashCluster(
  into: Sheet,
  p: V3,
  out: V3,
  L: number,
  lift: number,
  rnd: () => number,
  rig: (q: V3, edge: number) => [number, number],
): void {
  const { m, fwd, side, cup, base, top, under, tilt } = leafStalk(
    into, p, out, L, lift, 0.2, 0.12, L * 1.25 * 1.14, rnd, rig,
  );
  // The rim, pushed DOWN-slope of the stalk (the downslope points longest),
  // so the cluster hangs from its stalk as a leaf cluster does.
  const turn = rnd() * Math.PI * 2;
  const rim: number[] = [];
  for (let k = 0; k < ASH_TIPS * 2; k++) {
    const point = k % 2 === 0;
    const a = turn + (k / (ASH_TIPS * 2)) * Math.PI * 2 + (rnd() - 0.5) * (point ? 0.35 : 0.15);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const hang = 1 + 0.25 * ca;
    const r = L * hang * (point ? 0.78 + rnd() * 0.36 : 0.62 + rnd() * 0.12);
    const dir = v3unit(v3add(v3add([0, 0, 0], fwd, ca), side, sa));
    // A point falls a little further than a notch, so each leaf curls.
    const q = v3add(v3add(base, dir, r), m, -cup * (point ? 1.15 : 0.85));
    rim.push(sheetVert(into, q, dir, rig(q, tilt(q))));
  }
  leafFaces(into, top, under, rim);
}

/** How many leaf points round each of an ash crown's clusters. */
const ASH_TIPS = 7;

/** The hedgerow ash's skin — see `buildAshTree`. */
const ASH_SKIN: BillowSkin = {
  heart: 0.66,
  skin: 0.86,
  density: 2.0,
  belly: 0.62,
  thinBelly: true,
  salt: 0x2d9e61c7,
  size: (rnd) => 0.46 + rnd() * 0.14,
  lift: (rnd) => 0.25 + rnd() * 0.3,
  leaf: ashCluster,
};
