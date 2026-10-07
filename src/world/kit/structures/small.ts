/**
 * kit/structures/small.ts — The eight structures that are a few dozen lines
 * apiece: buildSilo, buildFence, buildStoneWall, buildHaystack, buildLampPost,
 * buildCrates, buildTrough and buildShrine.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Matrix, Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { caskData } from "../../props/cask";
import { mulberry32 } from "../../rng";
import {
  Build,
  groundRun,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Structure,
  DARK_STONE,
  FLAME,
  IRON,
  MOSS_STONE,
  PLANK,
  SLATE,
  STONE,
  THATCH,
  TIMBER,
} from "../core";

/** Grain silo: a tall corrugated cylinder. Pure cover, not enterable. */
export function buildSilo(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "silo");
  const h = 12;
  const dia = 6;
  b.cyl(h, dia, dia * 1.06, 10, 0, h / 2, 0, DARK_STONE);
  for (let i = 1; i < 5; i++) {
    b.cyl(0.25, dia * 1.05, dia * 1.05, 10, 0, (i * h) / 5, 0, IRON);
  }
  b.cyl(2.4, 0.6, dia * 1.02, 10, 0, h + 1.2, 0, SLATE);
  b.block({ w: dia, h, d: dia, x: 0, y: h / 2, z: 0 });
  return b;
}

/**
 * Post-and-rail fence run along X. Blocks movement, not sight, and stops a
 * round on its timber and nowhere else.
 *
 * **The body and the round are described separately, and that is the whole of
 * it.** The `block` at the bottom is the fence to a BODY: 1.4 m of it, the
 * length of the run, `porous`, so the nav graph severs across it and a player
 * walks into it while no round ever stops on it. The posts and rails are
 * `strut`s, so a ROUND stops exactly where the timber is drawn and passes
 * through the gaps — which is most of a fence, and was the whole of it before
 * the slab was told to stop pretending.
 *
 * Neither half works alone: without the block a fence is walked through, and
 * without the struts it is a wall you can see your target through.
 *
 * On a slope it steps (`groundRun`) and only ever AT A POST, since a rail has
 * to end on something: where the ground wants a step between two posts, the
 * run gets another post instead.
 */
export function buildFence(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "fence");
  const len = p.length ?? 10;
  const run = groundRun(ctx, len, {
    pitch: 2.5,
    minGaps: 2,
    depth: 0.4,
    pad: 0.09,
    between: false,
  });
  for (const j of run.joints) {
    const top = j.ground + 1.5;
    b.strut(0.18, top - j.base, 0.18, j.x, (top + j.base) / 2, 0, TIMBER);
  }
  for (const s of run.spans) {
    const w = s.x1 - s.x0;
    const x = (s.x0 + s.x1) / 2;
    b.strut(w, 0.12, 0.1, x, s.ground + 1.2, 0, TIMBER);
    b.strut(w, 0.12, 0.1, x, s.ground + 0.6, 0, TIMBER);
  }
  for (const s of run.spans) {
    // Down to the footing, so a body cannot pass under the run where the floor
    // falls away beneath its ground line.
    const top = s.ground + 1.4;
    b.block({
      w: s.x1 - s.x0,
      h: top - s.base,
      d: 0.4,
      x: (s.x0 + s.x1) / 2,
      y: (top + s.base) / 2,
      z: 0,
      porous: true,
    });
  }
  return b;
}

/**
 * Dry-stone field wall run along X. Unlike `fence` this is chest-high and
 * opaque: it breaks a sightline rather than just a walking line, which is what
 * turns open ground into a fight instead of a shooting gallery. Author it in
 * runs with gaps — a sealed field is a wall the nav grid routes bots all the
 * way around.
 *
 * On a slope it STEPS (`groundRun`): each span stands its full height on its
 * own ground line with its footing under the floor, the coping steps with it,
 * and a step may fall between piers because that is how dry stone is laid up
 * a hill.
 */
export function buildStoneWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "stonewall");
  const len = p.length ?? 12;
  const h = p.height ?? 1.5;
  const run = groundRun(ctx, len, { pitch: 5, depth: 0.72, pad: 0.35, between: true });
  for (const s of run.spans) {
    const w = s.x1 - s.x0;
    const x = (s.x0 + s.x1) / 2;
    const top = s.ground + h;
    b.wall(w, top - s.base, 0.5, x, (top + s.base) / 2, 0, MOSS_STONE);
    // Capstones, and a stouter pier every few metres: the silhouette is what
    // sells dry stone, since the shader gives it no texture.
    b.box(w, 0.18, 0.66, x, top + 0.09, 0, DARK_STONE);
  }
  for (const j of run.joints) {
    const top = j.ground + h + 0.35;
    b.box(0.7, top - j.base, 0.72, j.x, (top + j.base) / 2, 0, MOSS_STONE);
  }
  return b;
}

/**
 * Haystack — soft cover in the paddocks.
 *
 * **The box is the rick's width at the height a round arrives at, not the
 * circle it is drawn inside.** The drum is a heptagon tapering 3.2 -> 2.6 over
 * its 2.2 m, and 3.2 is a CIRCUMdiameter: seven vertices touch it and the
 * silhouette between them never does, so a 3.2 box was a square drawn around
 * the widest circle and then held at that width all the way up. Measured, it
 * stopped rounds through 1.0 m of open air abreast of the rick and through
 * 1.5 m at the corners, and above 0.6 m there were bearings where it stopped
 * a round with nothing drawn on that line at all.
 *
 * 2.8 is the drawn silhouette across the middle of the drum (circumdiameter
 * 2.90 there, and a heptagon is about 0.95 of its own circumdiameter however
 * you stand to it). This is `PROP_BODIES`' rule in `MapBuilder.ts` — the trunk
 * at chest height rather than the flare it stands on — and the same rule the
 * silo next door already follows by taking its nominal `dia` rather than the
 * 1.06 it splays to at the foot. It errs small by about 4 cm abreast, which is
 * the cheap side of that file's trade: too small costs a round clipping a
 * silhouette, too large costs shots that visibly should have landed.
 *
 * The cap stays outside the collider, as it was: it is 1.4 m of hay starting
 * at 2.2, which is over every head in the game, and a box that held it would
 * be another square around another cone.
 */
export function buildHaystack(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "haystack");
  b.cyl(2.2, 2.6, 3.2, 7, 0, 1.1, 0, THATCH);
  b.cyl(1.4, 0.2, 2.6, 7, 0, 2.9, 0, THATCH);
  b.block({ w: 2.8, h: 2.2, d: 2.8, x: 0, y: 1.1, z: 0 });
  return b;
}

/** Iron lamp post, the village's standard fixture. Carries a light. */
export function buildLampPost(
  scene: Scene,
  mats: CelMaterialFactory,
): Structure {
  const b = new Build(scene, mats, "lamp");
  b.cyl(4, 0.14, 0.26, 6, 0, 2, 0, IRON);
  b.box(0.9, 0.1, 0.1, 0.35, 3.75, 0, IRON);
  b.cyl(0.62, 0.42, 0.3, 6, 0.75, 3.45, 0, IRON);
  b.glow(0.3, 0.3, 0.3, 0.75, 3.45, 0, FLAME);
  b.cyl(0.18, 0.1, 0.5, 6, 0.75, 3.85, 0, IRON);
  b.block({ w: 0.5, h: 4, d: 0.5, x: 0, y: 2, z: 0 });
  b.light(FLAME, 22, 2.2, 0.35, 0.75, 3.45, 0);
  return b;
}

/**
 * Stack of crates and a barrel — waist-to-chest cover for yards and docks.
 *
 * The barrel stood against the stack is the scatter's cask (`caskData` in
 * `props/cask.ts`), so it is the same barrel as the ones lying loose in the
 * yard round it — staves, hoops, a board head and whatever has happened to it —
 * painted from this kit's palette: the plank it always was, the crates'
 * timber for its head and the iron its hoops always were. Seeded off where
 * the stack stands (`streetSeed`) and stood on the ground under it, which is
 * what puts `crates` in `CONFORMS_TO_TERRAIN`; an open one's lost hoop lies on
 * the side away from the crates.
 *
 * The collider is unchanged and the cask stays inside it but for the hoop,
 * 4.5 cm high on the ground.
 */
export function buildCrates(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "crates");
  b.box(1.5, 1.2, 1.4, -0.6, 0.6, 0, PLANK);
  b.box(1.3, 1.1, 1.3, 0.8, 0.55, 0.3, TIMBER);
  b.box(1.2, 1.0, 1.1, -0.35, 1.7, -0.15, TIMBER, { y: 0.4 });
  b.block({ w: 3.2, h: 2.3, d: 2.6, x: 0.1, y: 1.15, z: 0 });

  // The barrel stood against the stack, on the ground where it stands.
  const bx = 0.9;
  const bz = -0.9;
  let foot = 0;
  if (ctx) {
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    foot = ctx.terrain.surfaceAt(ctx.x + bx * cos + bz * sin, ctx.z - bx * sin + bz * cos) - ctx.y;
  }
  const cask = caskData(mulberry32(streetSeed(3.2, 2.6, 2.3, ctx)), { a: Math.atan2(bx - 0.1, bz), spread: 1.4 });
  const at = Matrix.Translation(bx, foot, bz);
  b.surface(cask.wood.transform(at), PLANK);
  b.surface(cask.head.transform(at), TIMBER);
  b.surface(cask.iron.transform(at), IRON);
  return b;
}

/** Stone water trough and hitching rail. Low cover — cross it, don't hide. */
export function buildTrough(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "trough");
  b.box(3.0, 0.7, 1.1, 0, 0.35, 0, STONE);
  for (const sx of [-1, 1]) {
    b.box(0.18, 0.34, 1.1, (sx * 3.0) / 2, 0.87, 0, STONE);
  }
  for (const sz of [-1, 1]) {
    b.box(3.0, 0.34, 0.18, 0, 0.87, (sz * 1.1) / 2, STONE);
  }
  b.box(2.6, 0.06, 0.8, 0, 0.88, 0, DARK_STONE); // standing water
  b.block({ w: 3.0, h: 1.0, d: 1.1, x: 0, y: 0.5, z: 0 });
  // Hitching rail behind it.
  for (const sx of [-1, 1]) {
    b.box(0.16, 1.4, 0.16, sx * 1.3, 0.7, 1.6, TIMBER);
  }
  b.box(3.0, 0.14, 0.12, 0, 1.25, 1.6, TIMBER);
  b.block({ w: 3.0, h: 1.4, d: 0.4, x: 0, y: 0.7, z: 1.6 });
  return b;
}

/**
 * Roadside shrine: a stone pillar with a lit niche. Carries a small light, so
 * keep them spread — every one competes for a shader slot with the lamps.
 */
export function buildShrine(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "shrine");
  b.box(1.5, 0.4, 1.5, 0, 0.2, 0, DARK_STONE);
  b.box(1.0, 1.8, 1.0, 0, 1.3, 0, MOSS_STONE);
  // The niche: a shallow recess read as two jambs and a hood.
  for (const sx of [-1, 1]) {
    b.box(0.28, 0.8, 0.2, sx * 0.36, 1.9, -0.5, MOSS_STONE);
  }
  b.box(1.1, 0.22, 0.34, 0, 2.35, -0.45, DARK_STONE);
  b.glow(0.34, 0.5, 0.12, 0, 1.85, -0.52, FLAME);
  b.cyl(0.7, 0.28, 0.9, 4, 0, 2.55, 0, SLATE); // capstone
  b.block({ w: 1.5, h: 2.6, d: 1.5, x: 0, y: 1.3, z: 0 });
  b.light(FLAME, 12, 1.3, 0.5, 0, 1.9, -0.6);
  return b;
}
