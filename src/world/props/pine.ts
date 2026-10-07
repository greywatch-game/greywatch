/**
 * props/pine.ts — buildPine: the spruce-habit conifer. Part of the scatter set:
 * follows the contract in `./index.ts`.
 */
import { Mesh, Scene, VertexData } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partSurface } from "../parts";
import { mulberry32 } from "../rng";
import { marksSway } from "../sway";
import { type Flat, loft, prism, type Ring, tri } from "./geometry";
import { BARK, NEEDLE, NEEDLE_LIT } from "./palette";

/**
 * How many draws `buildPine` takes from the shared scatter stream — the number
 * the four-cone pine it replaced took (the lean, then four per tier), and fixed
 * there, so redrawing the tree moved no prop on any map it stands on. See its
 * header.
 */
const PINE_SHARED_DRAWS = 17;

/**
 * Living pine: a planted conifer of the spruce habit — a straight, fluted bole
 * on a flare of root knees, carrying seven WHORLS of boughs that droop from the
 * trunk to pointed tips, each whorl's tips set between the ones above it, so
 * the crown is a cone with a SERRATED edge and a dark, ribbed underside. The
 * hilltop woods on Harrowmead, the plantings and woods on Coldharbour and the
 * pines on Cinderhaven's two arms are all this tree at different scales.
 *
 * **It was four smooth cones stacked on a hexagonal pole** and read as a stack
 * of lampshades: every tier's rim a horizontal edge, one over another, and from
 * under it a flat dark lid. The silhouette is still the cone — that is the
 * whole difference between this tree and the ash (`buildAshTree`) at two
 * hundred metres, and the rim's woods (`RIM_WOOD`) are the same cone in the
 * same paint — but each whorl is now BOUGHS: a star-rimmed shell, flat-shaded,
 * whose every bough is a RIDGE from the trunk out to its tip, so the bands put
 * a lit side and a shade side on each one and the ink draws the ridge. That is
 * the jungle hardwood's and the ash's lesson in this tree's own terms — the
 * detail is an OUTLINE the bands and the ink find, never a texture.
 *
 * Four things about it are load-bearing rather than decorative:
 *
 * - **The lowest needle is at ~1.84 m**, clear of the 1.7 m hit sphere, which
 *   is where the old lowest skirt was: the collider is the trunk only (see
 *   `PROP_BODIES`), so boughs hanging at chest height would be foliage you
 *   can shoot straight through — the complaint the prop bodies were measured
 *   to fix. That is the worst TIP, not the average, and the underside rises
 *   from the tips toward the trunk, so nothing under the skirt is lower.
 * - **The crown tops out at 6.95 m**, inside `PROP_BODIES.pine.visualTop`
 *   (7.0), which is frozen, and the leader dies inside the top whorl.
 * - **The bole stays inside the collider's 0.31 m half-width** from 0.3 m up,
 *   flutes and bow included, so the column a round stops on is the column you
 *   see; the root knees are what is outside it and they are under 0.35 m
 *   there, falling to a few centimetres — a thing a boot steps over.
 * - **Its detail comes from a stream of its OWN.** `rng` is the map's shared
 *   scatter stream and every draw from it moves every prop after this one, so
 *   this takes exactly `PINE_SHARED_DRAWS` from it — the first the lean and
 *   the seed of `own`, the rest taken and not spent.
 *
 * Every whorl's apex is ON the bole and its underside meets the bole lower
 * down, so a whorl sways (`world/sway.ts`) about a point inside the trunk and
 * the whorl over it; the bough never comes off the wood it grows from by more
 * than the few centimetres the ramp is entitled to at that height.
 *
 * Budgeted as DRESSING: some six hundred stand on Harrowmead and on
 * Coldharbour each, so a vertex here is six hundred in the scene. Built from
 * parts, in the three colours the cone pine wore, so it costs no draw call the
 * old one did not.
 */
export function buildPine(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
): Mesh {
  const bark = mats.get(BARK);
  // Translucent for the reason the cones were: a pine with the light behind it
  // should have a lit edge, and a stand of them between you and the moon should
  // read as a screen you see light past rather than a row of black shapes.
  const needle = mats.getTranslucent(NEEDLE, CONFIG.graphics.translucency.foliage);
  const needleLit = mats.getTranslucent(NEEDLE_LIT, CONFIG.graphics.translucency.foliage);
  // A fifth of the dead tree's lean, because a dead trunk reads as FAILING and
  // a live one has to read as the thing that hasn't. The first shared draw and
  // the seed of this tree's own stream (see the header).
  const lean = rng();
  const own = mulberry32(Math.floor(lean * 4294967296) ^ 0x3c1e9d27);
  for (let i = 1; i < PINE_SHARED_DRAWS; i++) rng();

  // Everything below is in the trunk's own frame, whose origin is 3.2 m up
  // (MapBuilder scales that and stands it on the ground), so a height above
  // the FOOT is `h + FOOT`.
  const FOOT = -3.2;
  // The bole's girth, as [height above the foot, radius]: a flare into the
  // roots, then a column tapering to a leader that dies inside the top whorl.
  // Inside the collider's 0.31 m half-width from 0.3 m up, flutes included.
  const GIRTH: readonly Flat[] = [
    [-0.4, 0.4],
    [0, 0.38],
    [0.3, 0.285],
    [1.0, 0.26],
    [1.9, 0.235],
    [3.2, 0.15],
    [4.8, 0.09],
    [6.7, 0.03],
  ];
  // A conifer's bole is the straightest thing in a wood; what it has is a
  // slight bow, most of it in the middle of the height.
  const bowDir = own() * Math.PI * 2;
  const bowAmp = 0.02 + own() * 0.03;
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
    const w = bowAmp * Math.sin(Math.PI * Math.min(1, Math.max(0, h / 6.7)));
    return { x: Math.cos(bowDir) * w, y: h + FOOT, z: Math.sin(bowDir) * w, r };
  };
  const SIDES = 7;
  // Deeper than the ash's flutes: pine bark is plates and furrows, and a
  // section this far out of round is what the bands find as bark running up.
  const flute = Array.from({ length: SIDES }, () => (own() - 0.5) * 0.12);
  const trunk = loft("pine-trunk", GIRTH.map(([h]) => bole(h)), SIDES, scene, flute);
  trunk.position.y = -FOOT;
  trunk.material = bark;
  trunk.rotation.z = (lean - 0.5) * 0.04;

  // Root knees: the flare breaking into low spurs where the bole meets the
  // ground, shallower than the ash's — a conifer roots wide and flat. Under
  // 0.35 m where they leave the collider, sunk 0.4 m under the foot so a
  // slope the tree does not know it stands on cannot lift one out.
  const knees = own() < 0.5 ? 4 : 5;
  const kneeTurn = own() * Math.PI * 2;
  for (let i = 0; i < knees; i++) {
    const a = (i / knees) * Math.PI * 2 + kneeTurn + (own() - 0.5) * 0.6;
    const end = 0.52 + own() * 0.25;
    const knee = prism(
      `pine-knee${i}`,
      [
        [0.1, -0.4],
        [0.1, 0.45],
        [0.26, 0.3],
        [0.4, 0.12],
        [end, 0.03],
        [end - 0.05, -0.4],
      ],
      [0.17, 0.17, 0.15, 0.11, 0.06, 0.06],
      scene,
      // Inside the bole, and under the ground.
      { skip: [0, 5] },
    );
    knee.parent = trunk;
    knee.position.y = FOOT;
    knee.rotation.y = a;
    knee.material = bark;
  }

  // One sheet of flat-shaded triangles, each wound to face UP (`side` 1) or
  // DOWN (-1) whichever way its three points were listed.
  type P3 = readonly [number, number, number];
  const sheet = (name: string, faces: readonly (readonly [P3, P3, P3, number])[], lit: boolean): void => {
    if (!faces.length) return;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const [a, b, c, side] of faces) {
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const s = (cy * side >= 0 ? 1 : -1) / (Math.hypot(cx, cy, cz) || 1);
      const nrm = [cx * s, cy * s, cz * s];
      const first = positions.length / 3;
      for (const p of [a, b, c]) {
        positions.push(p[0], p[1], p[2]);
        normals.push(nrm[0], nrm[1], nrm[2]);
        uvs.push(p[0], p[1] + p[2]);
      }
      tri(indices, positions, first, first + 1, first + 2, nrm);
    }
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    const mesh = partSurface(name, data, scene);
    mesh.parent = trunk;
    mesh.material = lit ? needleLit : needle;
    marksSway(mesh, "canopy");
  };

  // The WHORLS, as [the skirt's tip height above the foot, the apex's, how far
  // the tips reach, how many boughs]. Each overlaps the one under it by most of
  // its height, so the crown reads as one serrated cone rather than as tiers,
  // and the lowest tip, jittered down to its limit, is at 1.84 m (see the
  // header). The top whorl's apex is the crown's point.
  const WHORLS: readonly (readonly [number, number, number, number])[] = [
    [1.92, 3.2, 1.72, 9],
    [2.6, 3.85, 1.52, 9],
    [3.3, 4.5, 1.3, 8],
    [3.95, 5.1, 1.06, 7],
    [4.6, 5.7, 0.84, 6],
    [5.25, 6.3, 0.6, 5],
    [5.85, 6.95, 0.36, 4],
  ];
  WHORLS.forEach(([tipH, apexH, reach, n], w) => {
    const rise = apexH - tipH;
    const axis = bole(tipH);
    const top = bole(apexH);
    const apex: P3 = [top.x, top.y, top.z];
    // The underside meets the bole under the apex: the inside of an umbrella,
    // concave from below, so looking up into a whorl shows ribs in shade
    // rather than a lid.
    const low = bole(tipH + rise * 0.45);
    const under: P3 = [low.x, low.y, low.z];
    // The golden angle between whorls, so no tip stands over the one below.
    const turn = w * 2.39996 + own() * 0.5;
    const angles = Array.from({ length: n }, (_, k) => turn + ((k + (own() - 0.5) * 0.35) / n) * Math.PI * 2);
    // Each bough ENDS rather than tapering to a thorn: two points a hand or
    // two apart, because a spruce bough is a flat spray of twigs with a blunt,
    // ragged end, and a single point per bough read from under the crown as a
    // ring of blades.
    const tips: [P3, P3][] = angles.map((a) => {
      const r = reach * (0.86 + own() * 0.28);
      const half = (0.08 + own() * 0.05) / r;
      const y = tipH + (own() - 0.5) * 0.12 + FOOT;
      const end = (t: number, dy: number): P3 => [axis.x + Math.sin(t) * r, y + dy, axis.z + Math.cos(t) * r];
      return [end(a - half, (own() - 0.5) * 0.04), end(a + half, (own() - 0.5) * 0.04)];
    });
    // A valley between every pair of tips: the notch where one bough's needles
    // end and the next one's begin, set in and up from the tips.
    const valleys: P3[] = angles.map((a, k) => {
      const b = k + 1 < n ? angles[k + 1] : angles[0] + Math.PI * 2;
      const m = (a + b) / 2;
      const r = reach * (0.6 + own() * 0.12);
      return [axis.x + Math.sin(m) * r, tipH + rise * (0.26 + own() * 0.1) + FOOT, axis.z + Math.cos(m) * r];
    });
    // Two sheets: the boughs the light is on, and the shade — the boughs in
    // the lower crown and every whorl's underside. A real crown is not banded
    // by height, so each bough is drawn one or the other on a chance that
    // climbs the tree rather than by its whorl alone.
    const lit: [P3, P3, P3, number][] = [];
    const shade: [P3, P3, P3, number][] = [];
    const litChance = 0.2 + (w / (WHORLS.length - 1)) * 0.65;
    for (let k = 0; k < n; k++) {
      const prev = valleys[(k + n - 1) % n];
      const next = valleys[k];
      const into = own() < litChance ? lit : shade;
      const [l, r] = tips[k];
      into.push([apex, prev, l, 1], [apex, l, r, 1], [apex, r, next, 1]);
      shade.push([under, l, prev, -1], [under, r, l, -1], [under, next, r, -1]);
    }
    sheet(`pine-whorl${w}-lit`, lit, true);
    sheet(`pine-whorl${w}`, shade, false);
  });
  return trunk;
}
