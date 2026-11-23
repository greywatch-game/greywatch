/**
 * kit/city/street.ts — The street furniture that makes a roadway read as one:
 * buildQuay and buildStreetLight; the parked car is `car.ts` and the
 * barrier `barrier.ts`.
 * Part of the downtown set: follows the contract in kit/core.ts and the set's
 * rules in `./index.ts` — a street light carries a lens always and a light
 * only when a layout marks it `lit`.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  ALLOY,
  CONCRETE,
  KERB,
  KERB_WORN,
  LAMP_SODIUM,
} from "../core";

/**
 * A QUAY: the retaining mass a waterfront city stands on, the parapet along its
 * edge and the bollards behind it. Runs along local X with the WATER on local
 * -Z, which is the kit's front.
 *
 * **It is a RETAINING wall, so the thing it is built against is the floor and
 * not the water.** The mass hangs DOWN from the placement's own ground plane —
 * the deck's top face is y = 0 — and a map lays it exactly where its
 * heightfield falls away, so the street carries on over the drop instead of
 * stopping at a lip. That is the whole reason this is a structure rather than
 * a terrace: a terrace stands ON the ground and this one stands IN a hole in
 * it, and everything below the coping is there to be seen from a boat.
 *
 * **The parapet is a `Build.guard` and it is load-bearing in the literal
 * sense**: there is no swimming in this game, so a frontage a body can walk
 * off is a body underwater on the seabed with the leash counting down. It is
 * also the one thing here that has to be CONTINUOUS — a 40 m run with a gap
 * between it and the next one is a gap somebody finds — so a caller lays these
 * end to end at exactly `length` apart and the pedestals fall where they fall.
 *
 * **The bollards are `strut`s and the coping and the pedestals are neither.**
 * A bollard is iron a round stops on and no part of a body's problem, which is
 * the pair `Build.strut` exists for; a coping cap is 14 cm of stone on top of
 * a rail whose collider already owns that line, and giving it one of its own
 * would put a second box round the thing the guard is already standing off the
 * edge to avoid.
 */
export function buildQuay(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "quay");
  const len = p.length ?? 40;
  /** How far the deck reaches out over the water from the ground's own edge. */
  const deck = p.depth ?? 4;
  /** How far the face reaches below the deck — under the bed, not down to it. */
  const drop = p.height ?? 6;
  /** Chest-high, and deliberately under `cover.crouchHeight` — see the layout. */
  const PARAPET = 1.0;

  // The mass. Top face at y = 0, so it is the street continuing rather than a
  // step onto something; one collider, because a body only ever meets its top.
  b.box(len, drop, deck, 0, -drop / 2, -deck / 2, CONCRETE);
  b.block({ w: len, h: drop, d: deck, x: 0, y: -drop / 2, z: -deck / 2 });

  // The parapet, standing outboard of the seaward face for `Build.guard`'s own
  // reason, and the coping cap over it — wider than the rail, which is what
  // stops 0.16 m of collider reading as a sheet of card on edge.
  b.guard("-z", -deck, 0, len, 0, { height: PARAPET, color: CONCRETE });
  b.box(len, 0.16, 0.72, 0, PARAPET + 0.08, -deck - 0.08, KERB_WORN);

  // Pedestals at the quarter points: the parapet's own rhythm, and the thing
  // that makes a 40 m run read as built rather than extruded.
  for (let i = 1; i < 4; i++) {
    const x = -len / 2 + (i * len) / 4;
    b.box(0.72, PARAPET + 0.3, 0.66, x, (PARAPET + 0.3) / 2, -deck - 0.08, CONCRETE);
    b.box(0.86, 0.16, 0.8, x, PARAPET + 0.38, -deck - 0.08, KERB_WORN);
  }

  // Mooring bollards, set back a metre and a half so there is room to work a
  // rope round one, and a course of kerb along the back of the deck where the
  // paving changes.
  for (let i = 0; i < 4; i++) {
    const x = -len / 2 + (i + 0.5) * (len / 4);
    b.strut(0.3, 0.62, 0.3, x, 0.31, -deck + 1.5, ALLOY);
    b.cyl(0.17, 0.52, 0.38, 8, x, 0.7, -deck + 1.5, ALLOY);
  }
  b.box(len, 0.06, 0.5, 0, 0.03, -0.25, KERB);
  return b;
}

/**
 * A street lamp: an alloy column with a cantilevered head over the roadway.
 *
 * It carries NO light, and that is the set's header's argument rather than an
 * omission — under a daylit sky there is nothing for one to do, and a fixture
 * light always wins one of the sixteen shader slots whether or not it is
 * adding anything.
 *
 * **The lens is not emissive either, and that was a fix rather than a
 * simplification.** It was a `glow` at a tenth of a lantern's strength, on the
 * argument that the head should still read at distance — and the glow
 * does not scale with the sky: a pale emissive against a bright afternoon
 * blooms to a hard white disc, so every junction on the map had a lamp burning
 * in broad daylight. What reads at distance instead is the SILHOUETTE, which is
 * what a cantilevered arm against the sky already is.
 */
export function buildStreetLight(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "streetlight");
  const h = p.height ?? 7.5;
  const reach = 2.2;
  b.cyl(h, 0.16, 0.3, 8, 0, h / 2, 0, ALLOY);
  b.box(reach, 0.16, 0.16, reach / 2, h - 0.1, 0, ALLOY);
  b.box(0.9, 0.18, 0.42, reach, h - 0.24, 0, ALLOY);
  // The lens, and it is `glow` rather than a flat tone for the reason the whole
  // fixture argument turns on: an emissive box costs no light slot, takes the
  // glow's bloom, and is fogged per pixel like everything
  // else `getEmissive` hands out. Sodium orange rather than a pale white — a
  // pale lens against a lit sky blooms to a hard white disc, which is why the
  // lens was left off this model in the first place; a saturated one reads as a
  // lamp at any hour and goes to the fog with the rest of the skyline.
  b.glow(0.7, 0.06, 0.3, reach, h - 0.35, 0, LAMP_SODIUM);
  // And the light itself, only where the map asks. See `BuildParams.lit`: the
  // lens says the lamp is on and this says the shader can afford to prove it.
  // Steady — a sodium lamp does not flicker, and the term exists for flame.
  if (p.lit) b.light(LAMP_SODIUM, 16, 0.9, 0, reach, h - 0.5, 0);
  b.block({ w: 0.4, h, d: 0.4, x: 0, y: h / 2, z: 0 });
  return b;
}
