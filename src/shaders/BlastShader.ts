/**
 * BlastShader.ts — What every shape a detonation puts in the air is drawn
 * WITH: a lumpy BILLOW that is fire while it is hot, is eaten from its rim
 * inward by the smoke it turns into, and dissolves into wisps at the end — as
 * plain data since `BABYLON_EXIT.md` X4.4c, when our renderer took the billows
 * (`render/BlastDraw.ts`, its program `render/blastProgram.ts`, its bodies
 * `shaders/wgsl/blast.ts`) and Babylon was made no blast mesh, no
 * `ShaderMaterial` and no mask twin.
 * Owns: `BlastPaint` — the billow's own values (`BlastRecipe`: the drawing,
 * the fire's five inks from `FlameShader`, the soot, the dust, the clock and
 * the mesh's identity `world`) — the soot's colour, and the colour the glow
 * reads as the billow's (`emissiveColor`, the fire's body). Made only by
 * `CelMaterialFactory` (`getBlast`), which pushes the world clock onto it;
 * the light, the eye, the fog and the opaque alpha the billow is drawn under
 * are the FRAME's (`render/frame.ts`), the very fields the factory pushed onto
 * the material until X4.4c.
 * Invariants: every value is written in place into the array our renderer
 * reads (`values`), as `Float32Array` rounds it — what the material's uniform
 * buffer held, number for number — and nothing here allocates after
 * construction; it decides nothing about a blast and draws nothing.
 * Never: imports anything of Babylon's but its colour maths; restates the
 * WGSL (`shaders/wgsl/blast.ts` is the one copy).
 * Contract: `docs/grenades.md`, "The blast is EIGHT layers".
 *
 * WHY A BILLOW AND NOT A SPRITE. A blast was five flat emissive spheres, a
 * torus and two clouds of soft gradient quads — a photograph's smoke in a
 * frame of flat fills and ink, which is exactly the mismatch the water was
 * once reworked for. A drawn explosion is shapes with EDGES: overlapping
 * cauliflower billows, each banded light and dark by the key light, the fire
 * sitting inside them as hard bands of colour and shrinking as the smoke
 * closes over it, the whole thing breaking into wisps at the end rather than
 * fading. Every one of those is a thing this frame already does somewhere —
 * the cel bands, the ink, the flame's eaten edge — and none of them is a
 * gradient.
 *
 * WHY IT IS LIT WHERE THE FLAME IS NOT. `FlameShader` tried a soot plume and
 * every cut of it read as floating leather or black rock, and the reason is in
 * that sentence: it was opaque and UNLIT, so a smoke shape was one flat dark
 * silhouette. Here smoke is lit by the map's own key, ambient and sky fill,
 * banded in three like every wall, and mixed toward the map's mist — so its
 * top catches the moon, its underside is dark, and where the fire is still
 * burning under it the underside glows (`warmth`).
 *
 * THE HEAT OF A PIXEL, which is the one idea the fragment stage is built on:
 * the billow's heat, weighted up where the surface FACES the eye and down at
 * the silhouette, broken by a climbing noise field. A billow handed heat 1.5
 * is fire to its rim with a white heart; as the heat falls the red rim widens,
 * the smoke closes in from the outline, and an oxblood pen line runs where it
 * meets the fire — the flame's own eaten edge. At 0 it is smoke.
 *
 * IT IS OPAQUE AND CUT WITH `discard`, NEVER BLENDED: it writes depth, so the
 * screen-space ink finds the edges between billows and draws them, which is
 * the whole of what makes a cloud of these read as drawn. It never casts a
 * shadow. Its glow-mask draw is the same vertex stage writing the bloom per
 * band — the white heart hardest, the smoke not at all, which is what lets a
 * cloud of soot stand in FRONT of the fire in the bloom as well as in the
 * frame.
 *
 * **The drawing runs on twos** (`blast.fps`): the lumps and the bands change a
 * dozen times a second while the billow travels on the smooth clock, which is
 * the flame's bargain. The clock is the WORLD's, so a pause holds the cloud.
 */
import { Color3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { BlastField, BlastRecipe } from "../render/blastProgram";
import { FIRE_INKS } from "./FlameShader";

/**
 * Soot: the albedo of a blast's smoke, which the key light then paints. Warm
 * and dark, because a cloud off a charge is burnt, and warm rather than grey so
 * it sits with the fire under it instead of reading as a rain cloud.
 */
const SOOT = "#6a5f58";

/** What the glow reads as the billow's colour — the fire's body. */
const GLOW = "#ff8a2a";

/** The dust before a map has said what its floor is. */
const DUST = "#8a7d68";

/**
 * The billow's paint. One per `CelMaterialFactory`, shared by every blast in
 * the game.
 */
export class BlastPaint implements BlastRecipe {
  /** What `Game`'s glow rules read as the billow's bloom: the fire's body, at an alpha of 1. */
  readonly emissiveColor = Color3.FromHexString(GLOW);
  readonly alpha = 1;
  readonly values: Record<BlastField, Float32Array>;
  /** Moves when a value other than the clock is written. */
  epoch = 0;

  constructor() {
    const b = CONFIG.graphics.blast;
    const rgb = (hex: string): Float32Array => {
      const c = Color3.FromHexString(hex);
      return Float32Array.of(c.r, c.g, c.b);
    };
    this.values = {
      // The identity the thin-instanced mesh was frozen at.
      world: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
      shape: Float32Array.of(b.fps, b.lump, b.lumpScale, b.drift),
      field: Float32Array.of(b.grain, b.climb, b.ragged, b.erode),
      charColor: rgb(FIRE_INKS.char),
      time: new Float32Array(1),
      deepColor: rgb(FIRE_INKS.deep),
      air: Float32Array.of(b.air),
      midColor: rgb(FIRE_INKS.mid),
      rim: Float32Array.of(b.rim),
      hotColor: rgb(FIRE_INKS.hot),
      coreColor: rgb(FIRE_INKS.core),
      sootColor: rgb(SOOT),
      dustColor: rgb(DUST),
    };
  }

  /** The world clock: what the drawing runs on, and what the lumps drift by. */
  setClock(seconds: number): void {
    this.values.time[0] = seconds;
  }

  /**
   * What a blast's DUST is made of — the map's floor, which `BlastFx` works
   * out from the environment. Smoke is soot on every map; dust is the ground.
   */
  setDust(color: Color3): void {
    const d = this.values.dustColor;
    d[0] = color.r;
    d[1] = color.g;
    d[2] = color.b;
    this.epoch++;
  }
}
