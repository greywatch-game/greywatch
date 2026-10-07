/**
 * props/maple.ts — The temple valley's three: buildMaple, buildLeafLitter and
 * buildBamboo. Part of the scatter set: follows the contract in `./index.ts`.
 */
import { Matrix, Mesh, Scene, VertexData } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partBox, partCylinder, partSurface } from "../parts";
import { mulberry32 } from "../rng";
import { boughRig, frondBend, marksSway, rigPhase } from "../sway";
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

// The temple valley's three, and every one is set against the MAPLE rather
// than against the other trees in this set: Kurenai is a valley where the
// red is the point, so the bark is dark enough to draw every crown on a
// stroke, the bamboo is the one cool green for a hundred metres, and what lies
// on the ground is the crown's own colour gone a shade browner.
const MAPLE_BARK = "#3b2d26";
/**
 * Four crowns, each a SHADE and a LIT tone: crimson, scarlet, flame and a
 * deep oxblood. One valley's maples do not turn together, and a hillside of
 * them in a single red reads as a flat colour rather than as trees — so each
 * tree draws one of these. Four is the budget rather than a taste: a merged
 * block carries a draw per material, and eight tones is eight draws a block.
 */
const MAPLE_CROWNS: readonly [string, string][] = [
  ["#6a1410", "#a61e17"],
  ["#7d1d12", "#b8301a"],
  ["#86300f", "#c4521c"],
  ["#5c1512", "#931b1a"],
];
/**
 * The HEART under each crown's leaf, in `MAPLE_CROWNS`' order: that crown's
 * shade tone taken most of the way down — the deep red of the reference
 * frame's shadowed interior, never black, because what is seen between two
 * maple leaves is more maple leaves in the shade. Matte, so they go into the
 * block's palette and cost no draw of their own.
 */
const MAPLE_HEARTS = ["#5c120e", "#6c1a10", "#73290d", "#4f120f"];
/** What the maples have dropped — the crowns' tones, browned and dulled. */
const FALLEN = ["#8e2a1b", "#b33c20", "#c9602a", "#6f2a1d"];
const BAMBOO_CULM = "#71803e";
const BAMBOO_OLD = "#8f8b4c";
const BAMBOO_LEAF = "#4b682b";
const BAMBOO_LEAF_LIT = "#789441";

/**
 * Takes from the shared scatter stream exactly what the crown of slabs this
 * tree replaced took — a number that VARIED with the tree, so it is replayed
 * rather than stated, the ash's `ASH_SHARED_DRAWS` being the same promise for
 * a crown that took a fixed count. The stream draws each tree's yaw and the
 * next tree's spot straight after `buildMaple` returns, so a draw more or
 * fewer here would move every prop on Kurenai and re-roll the collision bake.
 *
 * Returns the three it still spends, as the old tree did: two for the lean
 * and one for which crown it wears, so every maple keeps the colour it had.
 */
function mapleSharedDraws(rng: () => number): [number, number, number] {
  const lz = rng();
  const lx = rng();
  const crown = rng();
  const limbs = 3 + Math.floor(rng() * 2);
  rng();
  for (let i = 0; i < limbs * 3; i++) rng();
  const clumps = 30 + Math.floor(rng() * 8);
  for (let i = 0; i < clumps; i++) {
    const t = Math.pow(rng(), 1.25);
    const reach = 3.4 * (1 - 0.8 * t * t) * Math.sqrt(rng());
    for (let k = 0; k < 6; k++) rng();
    if (!(t > 0.45) && reach > 2.2) rng();
    rng();
  }
  return [lz, lx, crown];
}

/**
 * The seven lobes of a Japanese maple's leaf, as [bearing off the leaf's
 * midrib, length as a share of its reach]: the middle three long and nearly
 * equal, the next pair shorter, and the basal pair half the length and swept
 * back either side of the stalk — which leaves a gap at the back of the leaf
 * where the stalk enters, so the outline is a HAND rather than a star.
 */
const MAPLE_LOBES: readonly Flat[] = [
  [-1.9, 0.55],
  [-1.24, 0.82],
  [-0.62, 0.96],
  [0, 1],
  [0.62, 0.96],
  [1.24, 0.82],
  [1.9, 0.55],
];

/**
 * One leaf of a Japanese maple (`buildMaple`): seven pointed lobes cut most of
 * the way to the stalk, laid on a billow whose outward normal at `p` is `out`,
 * `L` its reach from the stalk to the tip of the middle lobe.
 *
 * An `ashCluster` in every way but its rim (`leafStalk` is both): a closed,
 * gently cupped lens tipped down the billow's slope like a fish scale, so its
 * lower lobes stand off the leaf below and are a step in depth the ink draws.
 * The rim is what differs, and it is the whole of why this reads as a MAPLE —
 * the ash's rosette is a round mass with a serrated edge, and this is a hand
 * of narrow pointed fingers with sky between them, the middle one down the
 * slope and the stalk's notch up it, toward the shoot it hangs from. Each lobe
 * is a sinus-tip-sinus triangle: lanceolate at this size, and the cheapest
 * outline that keeps the points. The tips droop past the cup and the sinuses
 * stay up, so each lobe is creased along its own midrib into a lit and a
 * shade half.
 *
 * `2 + 2 * 7` vertices, the ash cluster's count. `rig` as `ashCluster`'s.
 */
function mapleLeaf(
  into: Sheet,
  p: V3,
  out: V3,
  L: number,
  lift: number,
  rnd: () => number,
  rig: (q: V3, edge: number) => [number, number],
): void {
  // Knocked off the billow's face a little each way: a maple's leaves lie
  // along their shoots at every angle, and a skin laid square to its billow
  // read as stars painted on a disc.
  const face = v3unit([out[0] + (rnd() - 0.5) * 0.4, out[1] + (rnd() - 0.5) * 0.3, out[2] + (rnd() - 0.5) * 0.4]);
  const { m, fwd, side, cup, base, top, under, tilt } = leafStalk(
    into, p, face, L, lift, 0.12, 0.1, L * 1.1, rnd, rig,
  );
  // Turned a little off the fall line: a leaf hangs down its shoot, but no two
  // hang square to it.
  const turn = (rnd() - 0.5) * 0.8;
  const rim: number[] = [];
  const at = (a: number, r: number, fall: number): void => {
    const dir = v3unit(v3add(v3add([0, 0, 0], fwd, Math.cos(a)), side, Math.sin(a)));
    const q = v3add(v3add(base, dir, r), m, -cup * fall);
    rim.push(sheetVert(into, q, dir, rig(q, tilt(q))));
  };
  for (let k = 0; k < MAPLE_LOBES.length; k++) {
    const [a, len] = MAPLE_LOBES[k];
    at(turn + a + (rnd() - 0.5) * 0.12, L * len * (0.9 + rnd() * 0.2), 1.3);
    // The sinus to the next lobe, cut two thirds of the way in — or, after
    // the last, the notch at the back where the stalk enters.
    const last = k === MAPLE_LOBES.length - 1;
    const next = last ? MAPLE_LOBES[0][0] + Math.PI * 2 : MAPLE_LOBES[k + 1][0];
    at(turn + (a + next) / 2, L * (last ? 0.12 : 0.42 + rnd() * 0.07), last ? 0.2 : 0.65);
  }
  leafFaces(into, top, under, rim);
}

/**
 * The maple's skin — see `buildMaple`. Flatter billows than the ash's with a
 * shallower belly, smaller leaves laid thicker, and lifted less, because a
 * maple's leaf lies out flat along its shoot where the ash's cluster stands up.
 *
 * **The leaves are laid ON the heart, not around it**: the stalks a tenth of
 * the billow outside it, which on the biggest billow is 0.14 m against a
 * leaf's 0.4 m reach. A smaller heart under a wider skin was tried first, to
 * keep the heart from showing, and the leaves read as floating a hand's
 * breadth off the blob; what keeps the heart from showing is the leaves
 * covering it, which is why the belly is fully laid too (`thinBelly`).
 */
const MAPLE_SKIN: BillowSkin = {
  heart: 0.76,
  skin: 0.86,
  density: 2.5,
  belly: 0.55,
  // A garden maple's crown is walked under, and its belly is what is seen.
  thinBelly: false,
  salt: 0x6b1c2f09,
  size: (rnd) => 0.36 + rnd() * 0.08,
  lift: (rnd) => 0.22 + rnd() * 0.3,
  leaf: mapleLeaf,
};

/**
 * Japanese maple (Acer palmatum): a short, dark, sinewy bole on a spread of
 * surface roots, forking a little over head height into three or four limbs
 * that climb steeply out of the fork and then level off, each throwing a
 * drooping branch to the skirt and a climbing one to the shoulder, and a
 * leader up the middle — and on the ends of them a broad, LAYERED crown of
 * flat BILLOWS of seven-lobed leaves, a tier at the skirt, a tier at the
 * shoulder and a cap, with sky and limbs between them. Wider than it is tall,
 * as a garden maple is: the tree the whole map is named for and the one the
 * reference frame (`reference-media/new-map.jpg`) is made of.
 *
 * **It was a crown of red slabs on a pole** — thirty-odd five-sided plates a
 * metre and a half across, tipped every way through a dome over a straight
 * cylinder — and in this look a plate is one shape and one tone however it is
 * tipped, so a crown of them read as boards. What the reference draws is
 * LEAVES: masses of red with a hand-shaped leaf at every edge, the lit ones
 * scarlet on the shoulders and the shadowed interior a deep crimson. So this
 * is the ash's crown (`skinBillows`, argued in `buildAshTree`) with two things
 * changed, and both are what make it a MAPLE rather than an ash in red:
 *
 * - **The leaf is a HAND** (`mapleLeaf`): seven narrow pointed lobes cut most
 *   of the way to the stalk, where the ash's is a rosette with a serrated rim.
 *   That is the one shape anyone recognises a maple by, and at every crown's
 *   edge it is drawn against the sky leaf by leaf. Built on the same stalk
 *   (`leafStalk`) for the same count of vertices.
 * - **The crown is TIERED**: flat billows — a third as deep as they are wide
 *   — at the ends of limbs that level off, the skirt's hung low and far out
 *   on drooping branches. A palmatum carries its leaf in layers along
 *   horizontal sprays, and that layering is its silhouette from across the
 *   valley, where no leaf can be told apart.
 *
 * The HEART under each billow is the crown's own deep red (`MAPLE_HEARTS`),
 * never the ash's near-black — between two maple leaves is more leaf in the
 * shade. **The whole crown is RIGGED on the ash's `bough` layer** and for its
 * reasons: it bends from the fork, every leaf rustles whole on its stalk, and
 * the limbs sway with the leaf they carry (`world/sway.ts`).
 *
 * Four things about the shape are load-bearing:
 *
 * - **The bole stays inside the collider's 0.23 m half-width** from 0.25 m
 *   up to a little short of the fork, lean and bend included, so the column a
 *   round stops on is the column you see. The surface roots are what is
 *   outside it, under 0.3 m where they leave the box and falling to a few
 *   centimetres — a thing a boot steps over. Above the fork the limbs leave
 *   the box over every head.
 * - **The lowest leaf is at ~2.6 m at scale 1**, clear of the 1.7 m hit sphere
 *   at the 0.9 the margin's maples are sown at. A billow's belly is held over
 *   `LOWEST` where it is placed, not hoped for. The collider is the bole only
 *   (see `PROP_BODIES`), so everything above is leaf a round passes through.
 * - **The top leaf is under 7 m**, inside `PROP_BODIES.maple.visualTop` (7.2),
 *   which is frozen: the burial test every prop runs reads it.
 * - **It takes from the shared stream exactly what the slab crown took**
 *   (`mapleSharedDraws`), so no prop on Kurenai moved and the collision bake
 *   is the one it was. Everything structural is a stream of the tree's own,
 *   and every billow's leaf one of the billow's, so the foliage setting
 *   (`detail`) lays fewer, bigger leaves without moving a limb.
 *
 * Budgeted as DRESSING, a busy one: a few hundred stand in a valley 240 m
 * across. Sixteen vertices a leaf, about three hundred and fifty leaves a tree
 * at full detail — ~6.6 k vertices a tree, ~4.1 k at a phone's rung (the slab
 * crown was ~1 k). Built from parts (`world/parts.ts`), merged to five: the
 * bole, the limbs, the hearts and the two leaf sheets. The limbs and hearts
 * are matte and go into the block's palette, but being RIGGED they are a merge
 * group of their own — one draw a block the slab crown did not cost.
 */
export function buildMaple(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
  _sub: () => number = rng,
  detail = 1,
): Mesh {
  const [lz, lx, pick] = mapleSharedDraws(rng);
  const crown = Math.floor(pick * MAPLE_CROWNS.length);
  const [shadeHex, litHex] = MAPLE_CROWNS[crown];
  const bark = mats.get(MAPLE_BARK);
  const leafMat = (hex: string) => mats.getTranslucent(hex, CONFIG.graphics.translucency.maple);
  const seed = Math.floor(lz * 4294967296);
  const own = mulberry32(seed ^ 0x3ac3e1d5);

  // Everything is in the trunk's own frame, whose origin is the FOOT.
  // The FORK: a little over head height, where the bole stops being one stem.
  const FORK = 2.4 + own() * 0.3;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots and a column tapering to the fork, inside the collider's 0.23 m
  // half-width from 0.25 m up with the lean and the bend added.
  const GIRTH: readonly Flat[] = [
    [-0.4, 0.3],
    [0, 0.27],
    [0.25, 0.212],
    [0.8, 0.2],
    [1.6, 0.188],
    [FORK, 0.172],
    [FORK + 0.7, 0.12],
  ];
  // A maple's bole wanders where an ash's stands: a slow S, held off below
  // chest height so the collider still holds it, and spent above.
  const bendAmp = 0.04 + own() * 0.04;
  const bendRate = 1.2 + own() * 0.6;
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
    const w = bendAmp * Math.sin(h * bendRate + bendPhase) * Math.min(1, Math.max(0, h - 1.9) / 1.2);
    return { x: Math.cos(bendDir) * w, y: h, z: Math.sin(bendDir) * w, r };
  };
  const SIDES = 7;
  // Sinewy rather than ridged: an old maple's trunk is smooth bark over
  // muscle, a section a few per cent out of round held the whole height.
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.1);

  const forkAt = bole(FORK);
  const fork: V3 = [forkAt.x, forkAt.y, forkAt.z];
  // How far from the fork the crown's rim is — the distance a vertex's bend
  // is measured against (`buildAshTree`).
  const SPAN = 4.2;
  const rigAt = (p: V3, phase: number, tilt = 0, leaf = 0): [number, number] =>
    boughRig(frondBend(v3dist(p, fork) / SPAN), phase, tilt, leaf);
  const rigged = (data: VertexData, phase: number): VertexData => rigVerts(data, (p) => rigAt(p, phase));

  // The bole, to a little over the fork, where the limbs bury their roots.
  const boleParts: VertexData[] = [
    loftData(
      GIRTH.filter(([h]) => h < FORK + 0.4).map(([h]) => bole(h)).concat([bole(FORK + 0.4)]),
      SIDES,
      flute,
    ),
  ];
  // The surface roots — the spread a garden maple is prized for, five or six
  // long low spurs leaving the flare and running out over the ground. Under
  // 0.3 m where they leave the collider and falling to a few centimetres, sunk
  // 0.4 m under the foot so a slope the tree does not know it stands on cannot
  // lift one out.
  const roots = own() < 0.5 ? 5 : 6;
  const rootTurn = own() * Math.PI * 2;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rootTurn + (own() - 0.5) * 0.5;
    const end = 0.7 + own() * 0.45;
    const root = prismData(
      [
        [0.08, -0.4],
        [0.08, 0.36],
        [0.24, 0.2],
        [0.48, 0.09],
        [end, 0.02],
        [end - 0.06, -0.4],
      ],
      [0.17, 0.17, 0.14, 0.1, 0.05, 0.05],
      // Inside the bole, and under the ground.
      { skip: [0, 5] },
    );
    root.transform(Matrix.RotationY(a));
    boleParts.push(root);
  }

  // The CROWN: its wood, every member rigged, and the billows it carries.
  const wood: VertexData[] = [];
  const clumps: Billow[] = [];
  // No billow's belly under this — what holds the lowest leaf where the
  // header says it is.
  const LOWEST = 2.85;
  // A billow's half-height for its half-width: a layer, not a dome.
  const SQUAT = 0.52;
  const addClump = (c: V3, r: number, phase: number): void => {
    const h = r * SQUAT;
    // Lifted rather than shrunk, and held under the crown's ceiling the same
    // way: a billow keeps its size.
    const y = Math.min(Math.max(c[1], LOWEST + h * 0.8), 6.35 - h * 1.1);
    clumps.push({ c: [c[0], y, c[2]], r, h, phase });
  };
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
  // A limb from `from` out on bearing `a`, leaving at elevation `e0` and
  // easing to `e1` by its end, `len` long in `n` steps — and SINUOUS, its
  // bearing swinging through a slow wave of its own rather than kinking where
  // a shoot grew, which is the difference between a maple's limb and an
  // ash's.
  const run = (from: V3, a: number, e0: number, e1: number, len: number, n: number): V3[] => {
    const pts: V3[] = [from];
    const wave = (own() - 0.5) * 0.8;
    const wavePhase = own() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const e = e0 + (e1 - e0) * u + (own() - 0.5) * 0.1;
      const b = a + wave * Math.sin(u * Math.PI * 1.6 + wavePhase) + (own() - 0.5) * 0.1;
      const d = len / n;
      const p = pts[pts.length - 1];
      pts.push([p[0] + Math.sin(b) * Math.cos(e) * d, p[1] + Math.sin(e) * d, p[2] + Math.cos(b) * Math.cos(e) * d]);
    }
    return pts;
  };

  // The LEADER: up the middle from the fork to the CAP, the crown's top
  // billow. It leans a little, as a maple's crown is never quite centred.
  const leaderPhase = rigPhase(seed * 1e-9, 0.5);
  {
    const lead = run(fork, own() * Math.PI * 2, 1.35, 1.0, 2.2 + own() * 0.4, 4);
    member(lead, forkAt.r * 0.75, 0.05, 6, leaderPhase);
    const tip = lead[lead.length - 1];
    addClump([tip[0], tip[1] + 0.35, tip[2]], 1.4 + own() * 0.2, leaderPhase);
    // And the HEART of the crown: a billow off the leader's first bend, out
    // over the fork on a short spur, that closes the hole the limbs leave in
    // the middle of the dome.
    const spur = run(lead[1], own() * Math.PI * 2, 0.6, 0.3, 0.9 + own() * 0.3, 2);
    member(spur, 0.06, 0.035, 5, leaderPhase);
    const end = spur[spur.length - 1];
    addClump([end[0], end[1] + 0.1, end[2]], 1.15 + own() * 0.2, leaderPhase);
  }

  // The LIMBS: three or four out of the fork at staggered heights, climbing
  // steeply and levelling off — the vase a palmatum grows into. Each ends in
  // a billow of the middle tier; most throw a branch off their first bend
  // that droops out to the SKIRT, the low, wide tier that is the maple's
  // silhouette, and many a second off their shoulder that climbs to a billow
  // between the middle tier and the cap. Sky between all of them.
  const limbs = own() < 0.5 ? 4 : 3;
  const limbTurn = own() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + limbTurn + (own() - 0.5) * 0.6;
    const phase = rigPhase(a, i + lz);
    const root = bole(FORK - 0.15 + (i / limbs) * 0.45);
    const len = 2.8 + own() * 0.6;
    const pts = run([root.x, root.y, root.z], a, 0.85 + own() * 0.15, 0.02 + own() * 0.15, len, 5);
    member(pts, root.r * 0.72, 0.045, 6, phase);
    const tip = pts[pts.length - 1];
    addClump([tip[0], tip[1] + 0.15, tip[2]], 1.25 + own() * 0.25, phase);

    if (own() < 0.85) {
      // To the skirt: out of the limb's first bend, flatter than it, and
      // drooping to its end — a palmatum's tips hang.
      const base = pts[2];
      const side = a + (own() < 0.5 ? -1 : 1) * (0.5 + own() * 0.4);
      const bp = run(base, side, 0.15 + own() * 0.15, -0.35, 2.0 + own() * 0.5, 4);
      member(bp, 0.07, 0.035, 5, phase);
      const end = bp[bp.length - 1];
      addClump([end[0], end[1] + 0.12, end[2]], 1.1 + own() * 0.2, phase);
    }
    if (own() < 0.7) {
      // To the shoulder: off the limb's last bend, climbing back in toward
      // the cap.
      const base = pts[3];
      const side = a + (own() < 0.5 ? -1 : 1) * (0.35 + own() * 0.3);
      const sp = run(base, side, 0.9, 0.5, 1.3 + own() * 0.4, 3);
      member(sp, 0.055, 0.03, 5, phase);
      const end = sp[sp.length - 1];
      addClump([end[0], end[1] + 0.15, end[2]], 1.1 + own() * 0.2, phase);
    }
  }

  // The HEARTS and the LEAVES on them.
  const lit = newSheet();
  const shade = newSheet();
  const hearts = skinBillows(clumps, seed, detail, MAPLE_SKIN, rigAt, rigged, lit, shade);

  const trunk = partSurface("maple-trunk", boleParts[0].merge(boleParts.slice(1)), scene);
  trunk.material = bark;
  // A garden tree leans, but its collider does not, so not by much.
  trunk.rotation.z = (lz - 0.5) * 0.04;
  trunk.rotation.x = (lx - 0.5) * 0.03;
  // Emitted leaf first and hearts last: the merge keeps the order, so the
  // depth test rejects the heart behind the leaves instead of shading it.
  crownPart(scene, trunk, "maple-leaf-lit", lit, leafMat(litHex), true);
  crownPart(scene, trunk, "maple-leaf", shade, leafMat(shadeHex), true);
  crownPart(scene, trunk, "maple-limbs", wood, bark, true);
  crownPart(scene, trunk, "maple-hearts", hearts, mats.get(MAPLE_HEARTS[crown]), true);
  return trunk;
}

/**
 * Fallen leaves: a drift of red chips lying flat on the ground under the
 * maples, the other half of the reference frame's red. Non-blocking, casts
 * nothing (a 3 cm chip in the sun's map is acne and not a shadow), and inked,
 * which is what makes a drift read as leaves rather than as a stain.
 *
 * It lies LEVEL at the height of the prop's own centre, so a region of it is
 * only honest on gentle ground — the generator sows it where the gradient is
 * under 0.05 and nowhere else — and a drift is 1.6 m across so the error at
 * its edge is about the chip's own thickness.
 */
export function buildLeafLitter(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  const chip = (i: number): Mesh => {
    const m = partBox(
      `leaves${i}`,
      { width: 0.15 + rng() * 0.12, height: 0.025, depth: 0.12 + rng() * 0.1 },
      scene,
    );
    m.material = mats.get(FALLEN[Math.floor(rng() * FALLEN.length)]);
    m.rotation.y = rng() * Math.PI * 2;
    m.rotation.z = (rng() - 0.5) * 0.1;
    m.metadata = { noShadowCaster: true };
    return m;
  };
  const root = chip(0);
  root.position.y = 0.02;
  const n = 24 + Math.floor(rng() * 14);
  for (let i = 1; i < n; i++) {
    const m = chip(i);
    m.parent = root;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.8;
    m.position.set(Math.cos(a) * r, (rng() - 0.5) * 0.008, Math.sin(a) * r);
  }
  return root;
}

/**
 * A clump of bamboo: eight to eleven culms nine metres high, leaning out from
 * the clump a little, with the leaf carried in tufts over the top half — the
 * one cool green in a red valley, and the thing a hillside path is walked
 * between.
 *
 * NON-BLOCKING, the bramble's rule and for the fern's reason: a culm is ten
 * centimetres thick and a clump is mostly air at head height, so a box round
 * one would stop rounds through a metre of daylight. The tufts start at half
 * the height, far clear of the hit sphere.
 */
export function buildBamboo(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number = Math.random,
): Mesh {
  let root: Mesh | null = null;
  const culms = 8 + Math.floor(rng() * 4);
  for (let i = 0; i < culms; i++) {
    const h = 7.5 + rng() * 3;
    const a = rng() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.2 + rng() * 0.7;
    const culm = partCylinder(
      `bamboo${i}`,
      { height: h, diameterTop: 0.07, diameterBottom: 0.12 + rng() * 0.05, tessellation: 5 },
      scene,
    );
    culm.material = mats.get(rng() < 0.3 ? BAMBOO_OLD : BAMBOO_CULM);
    const lean = 0.03 + r * 0.06;
    if (!root) {
      root = culm;
      culm.position.y = h / 2;
    } else {
      culm.parent = root;
      // Relative to the root culm's centre.
      culm.position.set(Math.cos(a) * r, h / 2 - root.position.y, Math.sin(a) * r);
    }
    culm.rotation.z = -Math.cos(a) * lean;
    culm.rotation.x = Math.sin(a) * lean;
    const tufts = 3;
    for (let k = 0; k < tufts; k++) {
      const tuft = partBox(
        `bamboo-leaf${i}-${k}`,
        { width: 1.5 + rng() * 0.6, height: 0.4, depth: 0.8 + rng() * 0.4 },
        scene,
      );
      tuft.parent = culm;
      const f = 0.55 + (k / tufts) * 0.42;
      tuft.position.set(0, h * f - h / 2, 0);
      tuft.rotation.y = rng() * Math.PI * 2;
      tuft.rotation.z = (rng() - 0.5) * 0.5;
      tuft.material = mats.getTranslucent(
        k === tufts - 1 ? BAMBOO_LEAF_LIT : BAMBOO_LEAF,
        CONFIG.graphics.translucency.canopy,
      );
      marksSway(tuft, "canopy");
    }
  }
  return root!;
}
