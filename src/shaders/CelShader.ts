/**
 * CelShader.ts — The look's MATERIALS: `CelMaterialFactory`, the cache every
 * lit material comes from, and what each one is drawn WITH. A material is a
 * KEY of our own (`MaterialKey.ts`, since `BABYLON_EXIT.md` X6.1c: a Babylon
 * `ShaderMaterial` or `StandardMaterial` until then, none of which drew or
 * compiled after X5.3d), and what our renderer draws is the RECIPE the
 * factory keeps beside the key (`celRecipe`, `render/celMaterial.ts`) under
 * the FRAME the factory fills off its own fields (`fillFrame`,
 * `render/frame.ts`): the cel program — banded directional key + up to
 * MAX_POINT_LIGHTS=16 dynamic point lights + ambient, fog, ground mist, rim,
 * hard stepped shadows, opt-in toon specular — whose body is
 * `wgsl/celSurface.ts` and `wgsl/celVertex.ts` and whose declarations are our
 * renderer's (`render/celFragment.ts`, `render/celVertex.ts`; what each name
 * means is written beside its declaration there). The shadows every material
 * samples are the frame's too, published through `ShadowBindings`
 * (`mats.shadows`). A material's OWN textures (a ground's albedo and height
 * map) are our renderer's, made off their `Picture`s through the renderer's
 * `TextureMaker` and kept in the material's recipe alone (`ownTexture`,
 * `BABYLON_EXIT.md` X5.4d).
 * Invariants: the scene holds NO Babylon light (a map's shadow light is
 * ShadowSystem's `MapLight`, a plain pair since `BABYLON_EXIT.md` X5.3d), and
 * no material ever read one — light arrives via the frame's uniforms, which
 * LightingSystem publishes into here once per frame. Flat/faceted shading is
 * recovered in the fragment shader from screen-space derivatives — NEVER call
 * convertToFlatShadedMesh(). Output is display-ready color, which is why
 * `scene.imageProcessingConfiguration.isEnabled` must stay false (`Game`). Output is also opaque, and
 * an opaque cel fragment writes `opaqueAlpha` rather than 1 — the frame's alpha
 * channel is TRANSLUCENT COVERAGE and a probe's is the cube's own mask, so the
 * two passes want opposite values out of the same line (see that field in
 * `render/frame.ts`, and CelInk). Every variant but getGlass() writes it; that
 * one, the world's one alpha-blended material, writes a Fresnel alpha, needs
 * no depth write (see there, and MapBuilder's pane rules), carries the one
 * depth bias in the renderer — GLASS_DEPTH_UNITS, without which a pane past
 * ~100 m is not drawn at all — and is the one variant that samples anything
 * the renderer drew for itself (a probe's cube, which ReflectionSystem bakes
 * and the glazing draw binds, `glassProbeRecipe`). Materials are
 * cached/shared per colour — don't create per-mesh materials: a key is an
 * IDENTITY, which every merge groups by, so two keys of one colour are two
 * merge groups and twice the draws. A new material reaches the cache only
 * through `remember`, the one door into `cache`, so no creation path files
 * one by omission. Nothing is PUSHED onto a material: what every cel material
 * shares (the environment, the eye, the wind, the point lights, every shadow,
 * the irradiance volume, the map's palette, the relief setting) is held here
 * and copied into the frame once a frame, and what a material is born with
 * is written into its recipe as it is made (`own`). Effect meshes use
 * getEmissive() (an unlit emissive key). **Nothing here registers a mesh for
 * INK any more**: the ink is one full-screen pass over the frame's own depth
 * (`shaders/CelInk.ts`), so it takes no per-mesh bookkeeping, no back-face
 * shell and no second material — `metadata.noInk` survives as a record of
 * INTENT that nothing reads to decide ink, and what actually keeps a part out
 * of the line work is the glow's mask, the near-depth band or being coplanar
 * (CLAUDE.md).
 * Also owns the fog as a published fact: setEnvironment writes it once, the cel
 * program reads it off the frame, CelInk takes the same band as `fadeBand`,
 * our renderer's unlit emissive draws take it as `emissiveFogRange`, and
 * fogAmountAt() hands the same curve to the glow's rules. Anything else drawn
 * unshaded owes that fade, or it hangs in front of the fog wall at full
 * strength.
 *
 * The program is hand-written WGSL, assembled by our renderer, and **its
 * defines make the material block's LAYOUTS** (`render/celMaterial.ts`,
 * CEL_SMOOTH guarding nothing of its own), so a field moved into or out of a
 * guard moves offsets for that variant alone. See `docs/rendering.md` for the
 * rest of what the dialect decides.
 */
import { Color3, Vector2, Vector3, Vector4 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { GeometryBuffer } from "../geometry/buffer";
import { EmissiveWorldMaterial } from "./EmissiveWorld";
import { MAX_EMISSIVE_PALETTE } from "./wgsl/emissiveWorld";
import { FlameMaterial } from "./FlameShader";
import { BlastPaint } from "./BlastShader";
import { MaterialKey } from "./MaterialKey";
import type { Color3Like, Vector3Like } from "../math";
import type { EmissiveRecipe } from "../render/emissiveWorld";
import type { FrameTextures, FrameUniforms } from "../render/frame";
import {
  createMaterialUniforms,
  type CelMaterialField,
  type CelMaterialTexture,
  type CelRecipe,
} from "../render/celMaterial";
import type { OwnTexture } from "../render/HostBindGroup";
import type { Picture, TextureMaker } from "../render/TextureMaker";
import { ShadowBindings } from "./ShadowBindings";
// The two shader-sized numbers live with the fragment's body, which our own
// renderer reads.
import { MAX_PALETTE, MAX_POINT_LIGHTS } from "./wgsl/celSurface";

export { MAX_PALETTE, MAX_POINT_LIGHTS };

/**
 * Custom cel-shading: quantized diffuse bands, a hard stylized rim highlight,
 * flat colors (or a world-XZ-mapped texture albedo, for ground surfaces like
 * cobblestone roads), and per-theme
 * atmosphere blended in the fragment shader. Ground-textured materials may
 * also carry a matching height map (CEL_BUMP): the facet normal is perturbed
 * by the height slope, measured from world-space taps a texel apart — never
 * from screen-space derivatives, which make the relief boil as the player walks
 * (see perturbNormal in wgsl/celSurface.ts, where every function this
 * comment names lives) — so the light bands ripple across individual
 * cobblestones. The same height map is also marched for DEPTH — parallax and
 * a hard self-shadow toward the key (reliefParallax, reliefLit) — so a stone
 * hides the mortar behind it and throws a shadow off its far side.
 * Outlines are drawn by the ink's one full-screen pass (CelInk), not here.
 *
 * Lighting has four parts, all banded so the toon look survives:
 * - a directional key light (moon/sun) quantized into 4 hard bands and gated
 *   by a hard two-level shadow term (ShadowSystem's depth map — lit or not,
 *   never a soft penumbra),
 * - up to `MAX_POINT_LIGHTS` dynamic point lights (torches, neon, muzzle
 *   flashes) quantized into 3 bands with a smooth radial falloff, and
 * - a flat ambient term that sets how black the unlit side goes — the main
 *   dial for the horror mood. Point lights deliberately ignore the shadow
 *   map, so a lantern still warms ground the moon can't reach.
 * Opt-in per material (getGlossy / getGroundTextured's spec): a toon
 * specular — one two-band Blinn highlight from the key light, gated by the
 * same shadow. Everything not explicitly glossy stays matte.
 * Opt-in the same way (getTranslucent): a translucency band — the key light
 * coming THROUGH a thin surface rather than off it, for awnings and foliage.
 * Everything not explicitly translucent stays opaque.
 * Opt-in at COMPILE time (getGlass, `#define CEL_GLASS`): a pane of glazing —
 * a Fresnel between what is behind it and a reflection of the sky with the
 * city composited into it, written out as a per-pixel alpha. A define rather
 * than a uniform because, unlike the two above, its terms cannot be multiplied
 * out to nothing by a zero colour: a reflect(), a pow(), a sky gradient and a
 * cube fetch on every pixel of the world is not a price the other thousand
 * meshes should pay to keep the roster uniform.
 *
 * The rim highlight is gated OFF near-level surfaces, and must stay that way:
 * on a plane the grazing angle is just the distance from the eye, so an
 * ungated rim draws a hard-edged, camera-locked disc on the floor that slides
 * around with the player. See the gate itself for the measurement.
 *
 * Atmosphere is distance fog plus a separate height-based ground mist, so
 * arenas fade into darkness and the floor sits in a low-lying haze.
 *
 * Shading is faceted: the fragment shader recovers each triangle's geometric
 * normal from screen-space derivatives of the world position rather than
 * using the interpolated vertex normal. Every mesh in the game is built from
 * coarse primitives, so hard facets are the intended look — and doing it in
 * the shader avoids `convertToFlatShadedMesh()`, which would unweld vertices
 * on every prop, enemy, and clone.
 */

/**
 * Stamps one source part's palette slot into its buffer's `uv2.x`, before it
 * is merged.
 *
 * **Before, because after is too late**: a merge (`mergeTransformed`, as
 * `MergeMeshes` before it) concatenates vertex buffers, so the index has to
 * already be per vertex for the merge to carry it. That is also what makes the
 * whole scheme safe against interpolation — a merge never re-triangulates, so
 * every corner of a triangle keeps the index of the part it came from.
 *
 * `uv2` and not the colour buffer, which has the room: the colour buffer is
 * written by `vertexShading.ts` AFTER every merge and from scratch, so a value
 * put there now would be overwritten by the bake, and teaching the bake to
 * preserve a channel would couple it to this. `uv2` is untouched by all of it.
 *
 * The all-or-nothing rule `CLAUDE.md` records for `colors` applies here too —
 * the merge throws when one member of a group has an attribute and another
 * does not — and it is kept by construction rather than by a check: a part
 * gets a slot exactly when it is going into the paletteised group, and every
 * part in that group got one.
 *
 * **It lives here rather than with either caller because there are TWO**, and
 * the two index different tables: the map's merge (`world/merge.ts`) writes
 * slots in the map palette `setPalette` publishes, and `SoldierModel` writes
 * slots in the kit palette `bodyCelRecipe` holds. What they share is this
 * attribute and the varying that reads it, which is the shader's, so the one
 * thing neither of them may state twice is where the index goes. Both write a
 * `GeometryBuffer`, never a mesh: the map merges parts
 * and a soldier merges buffers (`SoldierModel`'s `mergeByColor`), so a merge
 * of parts carries the array exactly as `MergeMeshes` carried a mesh's.
 */
export function writePaletteIndex(buffer: GeometryBuffer, slot: number): void {
  buffer.uvs2 = paletteIndexArray(buffer.vertexCount, slot);
}

/** `slot` in `uv2.x` of every one of `count` vertices, as a `Float32Array`. */
function paletteIndexArray(count: number, slot: number): Float32Array {
  const uv2 = new Float32Array(count * 2);
  // Only x is read. y is left at 0 rather than given a second meaning: the
  // slot's whole value is that it is the ONE thing this attribute says.
  for (let i = 0; i < count; i++) uv2[i * 2] = slot;
  return uv2;
}

/**
 * The irradiance volume's seven textures, as `GiVolume` publishes them and
 * the frame binds them (`render/frame.ts`' `FRAME_TEXTURES`).
 */
export type GiTextureName = "giIrr" | "giDir" | "giAux" | "giVis0" | "giVis1" | "giVis2" | "giVis3";

/** The volume's window as the shader reads it: five vectors and the slot table, held by reference. */
export interface GiWindow {
  grid: Vector4;
  window: Vector4;
  shade: Vector4;
  band: Vector4;
  extra: Vector4;
  /** Slot to visibility channel, held by reference like the vectors. */
  slotChannel: Float32Array;
}

/**
 * What `GiVolume` publishes to the factory — see `setGi`: the window and the
 * seven textures as OUR renderer owns them (`render/GiCompute.ts`,
 * `BABYLON_EXIT.md` X5.1b), the same seven objects for the volume's life,
 * their views rewritten in place by a tier change.
 */
export interface GiBinding extends GiWindow {
  textures: Record<GiTextureName, OwnTexture>;
}

/** A `CelRecipe` as the factory writes it. */
interface MutableRecipe extends CelRecipe {
  readonly textures: Partial<Record<CelMaterialTexture, OwnTexture>>;
}

/** The variants a recipe-keeping getter makes, bare — one statement each, the recipe's `defines`. */
const PLAIN_VARIANT: readonly string[] = [];
const PALETTE_VARIANT: readonly string[] = ["CEL_PALETTE"];
const GROUND_VARIANT: readonly string[] = ["CEL_GROUND_TEX"];
const GROUND_BUMP_VARIANT: readonly string[] = ["CEL_GROUND_TEX", "CEL_BUMP"];
const CLOTH_VARIANT: readonly string[] = ["CEL_SMOOTH"];
const GLASS_VARIANT: readonly string[] = ["CEL_GLASS"];
const GLASS_BACKED_VARIANT: readonly string[] = ["CEL_GLASS", "CEL_GLASS_BACKED"];

/** One dynamic light as uploaded to the cel shader. */
export interface PointLightData {
  position: Vector3;
  color: Color3;
  /** Radius at which the contribution reaches zero. */
  range: number;
  intensity: number;
  /**
   * A CONE, which makes this a spot: its axis (unit, world space) and the
   * cosines of the angles at which it is fully on and fully off. Absent is a
   * light that shines every way — every light that existed before this did.
   */
  spot?: SpotCone;
  /**
   * What `LocalShadows` may do for it — see `ShadowIntent`. Absent is `none`,
   * which is the old rule exactly: the volume's visibility and nothing else.
   */
  shadow?: ShadowIntent;
}

/** A spot light's cone. The axis is held by reference and may be moved in place. */
export interface SpotCone {
  dir: Vector3;
  cosInner: number;
  cosOuter: number;
}

/**
 * How a light casts, which `LocalShadows` spends differently:
 * - `fixture` — it does not move, so its world geometry is drawn ONCE into a
 *   static tile and kept; bodies near it go in a dynamic tile beside.
 * - `moving` — it does, so all of it is redrawn every frame from collider
 *   proxies, which is what keeps that affordable.
 * - `blast` — `moving`, on the rungs that shadow a transient at all
 *   (`localShadows.tiers[].transients`): a third of a second of light that
 *   is the brightest thing in the valley while it lasts.
 * - `none` — it casts nothing of its own (a muzzle flash, the player's own
 *   shoulder lamp, whose shadows fall behind everything it lights).
 */
export type ShadowIntent = "none" | "fixture" | "moving" | "blast";

/** Toon specular settings for one glossy material (see CONFIG.graphics.spec). */
export interface SpecSpec {
  /** Highlight tint, e.g. "#aecbf2"; scaled by intensity on upload. */
  color: string;
  intensity: number;
  /** Blinn exponent — high is a pinpoint glint, low a broad wet sheen. */
  shininess: number;
  /**
   * How much of the ENVIRONMENT the surface hands back face-on, 0..1 — a
   * reflection rather than a highlight, and the one thing that separates a
   * mirror from a metal that is merely very shiny.
   *
   * Absent (and zero) on every surface in the game but the gloss ladder's top
   * rung: the shader's whole mirror block is behind a uniform branch on it,
   * so a material that says nothing here pays for none of it. A surface that
   * claims it also catches the POINT lights, which nothing else in the game
   * does — both halves of that rule are in the fragment shader.
   */
  mirror?: number;
}

/**
 * Translucency settings for one thin material (see
 * CONFIG.graphics.translucency). One colour and nothing else: the term's
 * shape — how sharply it fires as the eye comes round into the key light —
 * is the band count in the shader, which belongs to the look rather than to
 * the material, the same way the diffuse's four bands do.
 */
export interface TranslucencySpec {
  /**
   * The colour the light arrives as after passing through — canvas warms it,
   * needles green it. Scaled by intensity on upload; unlike the rim, it does
   * NOT pick up the surface's own albedo, so a dark night-time canvas can
   * still glow pale.
   */
  color: string;
  intensity: number;
  /**
   * Absent for a THIN SHEET, which transmits across its whole face. Present
   * for a SOLID — a pine's tier, a canopy's clump — as how many METRES of it
   * the key may cross and still come out the other side: a face turned away
   * from the light transmits only when it lies within this distance, along the
   * light, behind the first lit surface of any solid in front of it. So a
   * crown glows where it is thin, and one crown behind another does not.
   *
   * Measured against `ShadowSystem`'s foliage map, which only materials that
   * state this are drawn into.
   */
  depth?: number;
}

/**
 * Glazing settings for one pane material (see CONFIG.graphics.glass).
 *
 * Four numbers describing one surface, and they are read together: `tint` and
 * `reflectance` are the two layers a pane is made of, and `falloff` is how
 * fast the second takes over from the first as the angle opens out.
 */
export interface GlassSpec {
  /**
   * How much of the sky a pane returns FACE-ON, 0..1. Real glass is 0.04-0.08
   * and this is allowed to sit a little above it: the reflection is the only
   * thing telling the player a window is glass rather than a hole, and at a
   * physical 0.04 an office frontage seen square-on has nothing on it at all.
   */
  reflectance: number;
  /**
   * The Fresnel exponent. 5 is Schlick's; lower brings the sheen on sooner as
   * the angle opens, which is what makes a street of glass read as glass while
   * you walk down the middle of it rather than only at the far end of it.
   */
  falloff: number;
  /**
   * Cosine half-width of the sun's halo in the reflection — 1 is a point and
   * 0.9 is a 25-degree wash. Broad on purpose: this stands in for a disc the
   * sky does not draw (see the shader), and a hard glint would advertise that.
   */
  halo: number;
  /**
   * How much of the pane's own colour a face-on view keeps, 0..1 — so this is
   * how DARK the glass is, and it is the number that decides what can be seen
   * through a shopfront.
   *
   * It has a fairness dimension and not only a look: a bot's line of sight
   * already passes through glass (`RayWorld.castRound` subtracts a pane), so a window
   * the player cannot see through is one the AI can shoot them through. Tint
   * it enough to read as glass and no further.
   */
  tint: number;
}


/** What `CelMaterialFactory.readLighting` hands back — live, read-only. */
export interface LightingView {
  readonly lightDir: Vector3;
  readonly lightColor: Color3;
  readonly ambient: Color3;
  readonly sky: Color3;
  /**
   * The clouds' shadow field and the two vectors that place and read it — see
   * `celCloud` — so the sun a traced ray finds on a wall is the sun the wall
   * itself is lit by. The area is the UNHELD one: a reflection bake's hold is
   * about the cube, not the bounce.
   */
  readonly cloudMap: OwnTexture;
  readonly cloudArea: Vector4;
  readonly cloudRay: Vector4;
}

/**
 * Creates and caches one cel material per colour (a key, and the recipe it is
 * drawn with), and holds the shared environment (light, fog, mist, camera,
 * dynamic lights) that our renderer's frame is filled from.
 */
export class CelMaterialFactory {
  /**
   * How far toward the eye a pane is biased in the depth test, in polygon
   * offset UNITS — one unit being the depth buffer's own smallest resolvable
   * step at that fragment. **Without it, glazing past ~100 m is not drawn at
   * all**, which is the bug this exists for and it is a depth-precision one
   * rather than anything about the shading.
   *
   * A pane stands a few centimetres off the wall behind it (a tower's curtain
   * wall in `kit/city/tower.ts`: 0.04 m of glass over the shaft, the collars
   * proud of that again), and the depth buffer stops being able to tell the two
   * apart with distance. The camera's near plane is 5 cm — it has to be, the
   * viewmodel's optics sit inside 5 cm of the eye — and against a buffer
   * resolving 2^-24 of the range that leaves a step of 1 cm at 90 m, 3 cm at
   * 160 m and 27 cm at the fog wall, while the standoff stays what the builder
   * gave it. Measured on Coldharbour's curtain wall, square on, with the pane
   * held at a constant size on screen: full at 40 and 90 m, **gone entirely
   * from 130 m out** — the tower goes back to being blank concrete, with
   * nothing wrong in the shader and nothing wrong in the geometry. (That
   * reading was taken on WebGL2's 24-bit buffer; the cliff is at ~180 m on
   * `depth32float` and the table below is the current one.)
   *
   * A polygon offset is the fix rather than a workaround because it is stated
   * in exactly the units the problem is: it scales with the buffer's step at
   * the fragment's own depth, so it is millimetres up close, where the pane
   * needs nothing, and metres at the far end of the map, where the buffer's own
   * step is that coarse. Nothing else on offer moves: `maxZ` is worth nothing
   * (measured — the near plane is the whole of the precision), a bigger
   * standoff would have to be half a metre of glass proud of the wall by the
   * fog wall, and the near plane is spoken for.
   *
   * **THE BUFFER IS `depth32float` NOW AND THE UNIT IS DEFINED DIFFERENTLY FOR
   * A FLOAT FORMAT, so this is sixteen by re-measurement rather than by
   * carrying a number across.** `stencil: false` in `main.ts` is what picks the
   * format, and for a float one `r` is `2^(exponent(the primitive's own depth)
   * - 23)` rather than a constant — which happens to land on the same `2^-24`
   * everywhere a shipped map is drawn, because a depth in [0.5, 1) is every
   * fragment past a few metres. Re-run on the north tower's 542-sheet curtain
   * wall with the rest of the map hidden and the glass tinted so a surviving
   * sheet is countable (`plans/webgpu-ref/depth.mjs`), the pane's own share of
   * the frame goes:
   *
   *     units    40 m    90 m   130 m   180 m   220 m   260 m
   *        0    83.9    68.1    67.0     0.6     0.6     0.0   goes by 180 m
   *       -4    83.9    68.1    67.1    65.2    57.3     8.4   thins, then goes
   *       -8    83.9    68.2    67.1    65.3    64.9    63.9
   *      -12    83.9    68.2    67.2    72.2    72.5    71.9   far end complete
   *      -16    83.9    68.3    67.8    72.4    72.8    72.3   SHIPPED
   *      -24    83.9    68.6    75.0    72.6    73.2    72.4   transoms eaten
   *      -64    83.9    77.6    75.7    72.8    73.0    72.3
   *
   * **It is bracketed on both sides now, which it never was before.** -12 is
   * the floor — under it the far end thins and then goes, and the unbiased
   * cliff has moved out from ~130 m to ~180 m with the format. -24 is the
   * CEILING, and what it costs is legible rather than statistical: at 130 m the
   * horizontal transoms across the curtain wall stop being drawn, which is the
   * +7.4 points of "extra" glass in that row. Sixteen sits between the two with
   * room on each side, and what it costs at the far end is unchanged — the fins
   * and collars standing 0.1-0.2 m proud of the glass are overdrawn past
   * ~100 m, where they are a pixel or two of trim against a whole elevation of
   * glazing.
   *
   * Blended glazing is the same shape and far less of it: Coldharbour's biggest
   * unbacked group is eight sheets of shopfront, and the bias roughly triples
   * what survives past 90 m. It is 2% of the map's glazing and it is all at
   * street range, so the reading that decides this number is the backed one.
   *
   * Only the depth TEST is biased: a blended draw writes no depth (see
   * `getGlass`), so nothing downstream inherits the offset.
   */
  private static readonly GLASS_DEPTH_UNITS = -16;

  /**
   * The bias for an emissive plane hung in FRONT of a `backed` pane — a lit
   * room on a tower's curtain wall or in a brick block's punched window.
   *
   * **It has to be MORE than the glass's, never the same.** The glow stands
   * 4.5 cm off the sheet's face, and that is exactly the gap
   * `GLASS_DEPTH_UNITS` exists to beat: past ~100 m sixteen units is more
   * than 4.5 cm, so an unbiased glow LOST the depth test to the glass it was
   * drawn over and the two fought per pixel as the eye moved. Equal units only
   * hand the tie back to that same 4.5 cm. Measured head-on at a Coldharbour
   * curtain wall, glass tinted and rooms keyed: unbiased, every lit room is
   * gone by 120 m and none survive at 180-300 m; at -24 all of them are drawn
   * at every range, bloom included. Eight past the glass is the roads' doubled
   * margin. It lands on the -24 at which a biased SHEET started eating the
   * trim in front of it, and that cost does not carry over: the glow is inset
   * 0.45 m from every edge of its bay, so no fin or collar stands over it
   * head on.
   */
  private static readonly OVER_GLASS_DEPTH_UNITS =
    CelMaterialFactory.GLASS_DEPTH_UNITS - 8;

  private readonly cache = new Map<string, MaterialKey>();
  private emissiveCache = new Map<string, MaterialKey>();

  // The key light as every material HOLDS it: these two objects are handed
  // out by reference and never replaced, only written into, so a map's key
  // reaches the grass and the water in the frame each copies them
  // (`GrassSystem.commit`, `WaterSystem.commit`).
  private readonly lightDir = new Vector3(-0.5, -0.9, 0.4).normalize();
  private readonly lightColor = new Color3(0.55, 0.62, 0.8);
  private keyWrap = 0;
  private ambientColor = new Color3(0.16, 0.18, 0.24);
  private skyLightColor = new Color3(0.08, 0.11, 0.18);
  /**
   * The top of the sky dome, as glazing reflects it — a picture of the sky
   * rather than the light it throws, which is what `skyLightColor` above is
   * and why the two are different values. Falls back to the map's flat
   * `skyColor` when it states no dome at all (`world/environment.ts`).
   */
  private skyZenithColor = new Color3(0.1, 0.14, 0.22);
  private rimColor = new Color3(0.18, 0.2, 0.26);
  private mistColor = new Color3(0.1, 0.12, 0.15);
  // A map with no `wear` block is CLEAN, and the amount is what says so — the
  // colour is then never read. Defaulted here rather than left undefined so a
  // material created before the first `setEnvironment` binds a real vec3 rather
  // than whatever an unwritten uniform holds; uniforms read as zeros when
  // unwritten, which would be black dirt at amount 0 and invisible, but relying
  // on that is relying on the amount never being raised before an environment
  // lands.
  private wearColor = new Color3(0.1, 0.1, 0.1);
  private wearAmount = 0;
  private mistParams = new Vector2(2.2, 0.45);

  // Packed point-light uniforms, re-used every frame to avoid allocation.
  private pointPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointColor = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointRange = new Float32Array(MAX_POINT_LIGHTS);
  private pointCount = 0;

  /**
   * The eye the frame is filled with (`fillFrame`), written by `updateCamera`
   * every frame. The origin until the first, which is what an unwritten
   * `vec3` uniform already is.
   *
   * It was also what every Babylon material in the cache HELD, seeded on
   * create so that a material minted on a still frame — a paused round, a kit
   * screen, the viewer's camera at rest — fogged against the eye rather than
   * the origin while the guarded walk skipped it (the map editor's
   * floor-colour field once repainted the whole terrain in a material that
   * thought the viewer stood in the middle of the map). The frame is filled
   * whole every frame, so no material can hold a stale one
   * (`BABYLON_EXIT.md` X6.1c).
   */
  private readonly camPos = Vector3.Zero();
  /**
   * What an opaque fragment writes into the FRAME's alpha channel (see
   * `opaqueAlpha` in `render/frame.ts`): 0, and nothing flips it — our
   * renderer's bake states its own 1 (`fillBakeFrame`).
   */
  private readonly opaqueAlpha = 0;

  /**
   * The wind's clock, in seconds of WORLD time — see `updateWind` for why that
   * is not the same as seconds of wall clock. Shared by every material in the
   * cache, so a gust crossing the valley crosses every mesh in it at once.
   */
  private windTime = 0;

  /** The materials that state a `TranslucencySpec.depth` — see `isSolid`. */
  private readonly solids = new Set<MaterialKey>();
  /**
   * The irradiance volume's textures and uniforms, as `GiVolume` last
   * published them — see `setGi`. Null only before `GiVolume` is constructed,
   * which is before the first material is. OUR renderer's frame reads it
   * (`fillFrame`, `fillFrameTextures`).
   */
  private gi: GiBinding | null = null;
  /**
   * The flat albedo each single-colour material was minted with, for the one
   * reader that needs a colour back from a MATERIAL: `MapBuilder`, which hands
   * the GI trace a colour per collider box. Weak, because the cache is not the
   * only thing that could ever hold a material.
   */
  private readonly albedos = new WeakMap<object, Color3>();

  /**
   * What each glazing material was built FROM: which glass it is (`glassKind`).
   *
   * The reflection is the one piece of shared state that is not shared: every
   * other uniform in here is the same on every material in the cache, and a
   * cube is one probe's picture of one place. So a group's probe is a recipe
   * of its own (`glassProbeRecipe`), its cube bound by the glazing draw, and
   * no material is minted a slot (`BABYLON_EXIT.md` X4.6e).
   */
  private glassRecipes = new Map<
    MaterialKey,
    { hex: string; glass: GlassSpec; backed: string | null }
  >();
  /**
   * The current map's albedo palette, flattened, as the shader indexes it.
   *
   * Held here for the reason `camPos` and `windTime` are: `installMap` mints
   * materials mid-round, so a material created after `setPalette` has to be
   * born holding it rather than waiting for the next environment change that
   * may never come.
   */
  private palette = new Float32Array(MAX_PALETTE * 3);

  /**
   * Every shadow a lit material samples — see `shaders/ShadowBindings.ts`. Published into by the systems
   * that render the maps; the factory's part is only to copy it into the
   * frame (`fillFrame`, `fillFrameTextures`).
   */
  readonly shadows: ShadowBindings;

  constructor(
    /**
     * Our renderer's maker of the textures the game paints: a ground's albedo
     * and height map are made through it (`ownTexture`), and the shadows' lit
     * texel and no-cloud texel (`ShadowBindings`).
     */
    private readonly textures: TextureMaker,
  ) {
    this.shadows = new ShadowBindings(textures);
  }

  /**
   * Publishes the palette `MapBuilder` assembled while it merged, into the
   * frame every material that reads one is drawn under (`fillFrame`).
   *
   * **Called once per map build, after the merge and before anything draws**,
   * because the palette is DISCOVERED by the merge rather than declared by the
   * layout — a builder's colours are not knowable until its meshes exist. That
   * ordering is safe for the same reason the bake's is: nothing renders between
   * `installMap` building the world and the round starting.
   *
   * Entries past `MAX_PALETTE` are the caller's problem and it has already
   * solved it — see `MapBuilder.paletteIndex`, which stops handing out indices
   * and lets the overflow colours keep their own materials.
   *
   * **This is the MAP's palette and it never reaches a body**: the soldier
   * kit's is its own (`bodyCelRecipe`), drawn by our renderer alone since
   * `BABYLON_EXIT.md` X4.1d, so the frame holds no table but this.
   */
  setPalette(colors: readonly Color3[]): void {
    this.palette.fill(0);
    const n = Math.min(colors.length, MAX_PALETTE);
    for (let i = 0; i < n; i++) {
      this.palette[i * 3] = colors[i].r;
      this.palette[i * 3 + 1] = colors[i].g;
      this.palette[i * 3 + 2] = colors[i].b;
    }
  }

  /**
   * Files a freshly built material in the cache — the one door into `cache`,
   * so that no creation path can file one by omission. It was also where a
   * Babylon `ShaderMaterial` was FROZEN, which that class needed to stop
   * rebuilding its define set on every ask (`docs/rendering.md`); a key of
   * ours has no define set to rebuild (`BABYLON_EXIT.md` X6.1c).
   */
  private remember(key: string, mat: MaterialKey): void {
    this.cache.set(key, mat);
  }

  /**
   * What each material our renderer may draw was BORN with, kept beside it:
   * its variant, its depth bias and its own block and textures, written by
   * `own` and `ownTexture` in the same call that sets them on the material.
   * Only the getters our renderer draws keep one — `getWorldCel`, `get`,
   * `getGlossy`, `getTranslucent`, `getGroundTextured`, `getCloth`, and since
   * `BABYLON_EXIT.md` X4.6e `getGlass` (a round's glazing is ours; a group's
   * probe is `glassProbeRecipe`'s) — and a body has no material at all, only
   * a recipe (`bodyCelRecipe`, X4.1d).
   */
  private readonly recipes = new Map<MaterialKey, MutableRecipe>();

  /**
   * Moves every time a value in any recipe is written, birth included — so a
   * reader that copied the recipes knows when to copy them again
   * (`setGroundSpec` re-applies the sheen to a cached ground mid-session).
   */
  materialEpoch = 0;

  /**
   * What our renderer draws `mat` with, or null for a material it does not
   * draw. A PULL off what the factory kept as it made the material, never a
   * read of it: the values are the very arrays `own` writes, so a reader
   * holding one sees every later rewrite (and `materialEpoch` says when).
   */
  celRecipe(mat: unknown): CelRecipe | null {
    return this.recipes.get(mat as MaterialKey) ?? null;
  }

  /** Starts `mat`'s recipe — before the first `own`, which is what it keeps. */
  private bear(mat: MaterialKey, variant: readonly string[], depthUnits: number): void {
    this.recipes.set(mat, {
      defines: variant,
      depthBias: depthUnits,
      values: createMaterialUniforms(variant),
      textures: {},
    });
  }

  /**
   * One of a material's OWN uniforms (`render/celMaterial.ts`), kept in its
   * recipe when its variant declares the field — as a `Float32Array` rounds
   * it, which is what the Babylon material's uniform held for it until
   * `BABYLON_EXIT.md` X6.1c.
   */
  private own(
    mat: MaterialKey,
    name: CelMaterialField,
    value: Color3 | Vector2 | Vector3 | Vector4 | number,
  ): void {
    const out = this.recipes.get(mat)?.values[name];
    if (!out) return;
    if (typeof value === "number") out[0] = value;
    else if (value instanceof Color3) value.toArray(out);
    else value.toArray(out);
    this.materialEpoch++;
  }

  /**
   * `own` for one of a material's own textures — kept in its recipe alone, the
   * picture made into OUR texture (`TextureMaker.picture`, once per canvas,
   * `BABYLON_EXIT.md` X5.4d).
   */
  private ownTexture(mat: MaterialKey, name: CelMaterialTexture, picture: Picture): void {
    const recipe = this.recipes.get(mat);
    if (!recipe) return;
    recipe.textures[name] = this.textures.picture(picture);
    this.materialEpoch++;
  }

  /**
   * The ONE matte cel material the whole village wears, whatever colour it is
   * painted: the albedo comes from `celPalette` indexed per vertex instead of
   * from this material's `baseColor`, which is never set and never read.
   *
   * **This exists to take the colour out of the merge KEY.** `mergeByMaterial`
   * splits a group once per material instance, so a 48 m block of a city held
   * ten meshes because it held ten paint colours — and each of those was drawn
   * four times over, once for itself, once for its ink, once as a glow occluder
   * and once into the shadow map. Measured on Coldharbour: 416 world meshes and
   * 1,565 draws, against 90 and ~305 with the colour moved per vertex.
   * `docs/rendering.md`'s "The paint palette: why colour left the merge key"
   * has the whole measurement.
   *
   * It is a define and not a branch on the shared material because the palette
   * is a 2 KB uniform array and there are 217 materials in a Coldharbour round,
   * of which exactly two — this and its ink — ever index it.
   */
  getWorldCel(): MaterialKey {
    const key = `\0world-cel`;
    let mat = this.cache.get(key);
    if (!mat) {
      mat = new MaterialKey(WORLD_CEL_NAME, "cel");
      this.bear(mat, PALETTE_VARIANT, 0);
      // `baseColor` is deliberately NOT set. Every vertex this material ever
      // draws carries an index, because `MapBuilder` only hands a mesh to this
      // material when it has one — so the uniform path is unreachable here and
      // seeding it would only invite somebody to rely on it.
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      this.remember(key, mat);
    }
    return mat;
  }

  /**
   * What every SOLDIER's matte segments are drawn with — `getWorldCel`'s twin
   * for bodies, and since `BABYLON_EXIT.md` X4.1d no material at all: our
   * renderer draws every body (`render/BodyDraw.ts`) and Babylon is made no
   * rig mesh, so this is the RECIPE alone — the variant, and the values the
   * `ShaderMaterial` it replaced was born with (no spec, no translucency, no
   * `baseColor`: a matte part off the kit palette is refused at the build,
   * `SoldierModel.paint`).
   *
   * **The palette is its OWN** (`CEL_OWN_PALETTE`, the material's block, not
   * the frame's). The world's is discovered by `MapBuilder`'s merge and
   * republished per install; a kit's is nine fixed hexes that outlive every
   * map, so folding them into the map's table would put the rigs' albedo at
   * the mercy of a rebuild and spend map slots on colours no map paints with.
   *
   * What it buys is the rig's draw COUNT: a segment used to split once per
   * paint colour, so a torso was three meshes and a head four, and since the
   * kit palette a segment is one — fifteen to a rig, and since X4.1d a RANK:
   * every body's `r`th segment nearest the eye in one draw, at most two draws
   * a segment (matte, visor) for the whole roster, each running to the
   * longest segment any body has at that rank (`SoldierModel` has the
   * arithmetic, and what a new segment or a longer one costs).
   *
   * **The palette is bound at the FIRST call**, every later one getting that
   * recipe back — which is safe because the only caller hands it a module
   * constant.
   */
  bodyCelRecipe(colors: readonly Color3[]): CelRecipe {
    if (!this.bodyCel) this.bodyCel = this.ownPaletteRecipe(colors);
    return this.bodyCel;
  }

  private bodyCel: CelRecipe | null = null;

  /**
   * What every HULL is drawn with — `bodyCelRecipe`'s twin, and since
   * `BABYLON_EXIT.md` X4.2b no material either: our renderer draws every hull
   * (`render/HullDraw.ts`) and Babylon is made no hull mesh, so this is the
   * RECIPE alone, its palette every colour a hull kit is painted in and the
   * charred paint (`vehicleRig.hullPalette`). What it replaces is one
   * `get(hex)` material a colour, each born with that hex's `baseColor` and
   * `applySpec(null)` and `applyTranslucency(null)`'s values: a segment is one
   * colour, so the slot its vertices carry reads the same three floats out of
   * this table that the `baseColor` uniform held — `Color3.FromHexString` of
   * the same hex, in float32 — and every other value is the one those
   * materials were born with.
   *
   * **The palette is bound at the FIRST call**, for `bodyCelRecipe`'s reason:
   * the only caller hands it the kits' colours, which are module constants. A
   * table longer than `MAX_PALETTE` is REFUSED rather than cut, since a slot
   * past it would read black.
   */
  hullCelRecipe(colors: readonly Color3[]): CelRecipe {
    if (colors.length > MAX_PALETTE) {
      throw new Error(`hullCelRecipe: ${colors.length} hull colours, past the palette's ${MAX_PALETTE}`);
    }
    if (!this.hullCel) this.hullCel = this.ownPaletteRecipe(colors);
    return this.hullCel;
  }

  private hullCel: CelRecipe | null = null;

  /**
   * A recipe of the cel program under `CEL_OWN_PALETTE` with `colors` its own
   * table — the bodies' and the hulls' (`bodyCelRecipe`, `hullCelRecipe`).
   */
  private ownPaletteRecipe(colors: readonly Color3[]): CelRecipe {
    const defines = ["CEL_PALETTE", "CEL_OWN_PALETTE"];
    const values = createMaterialUniforms(defines) as Record<CelMaterialField, Float32Array>;
    // The kit's own table, sized like the map's so the two are the same
    // uniform to the shader; a kit spends a few of the hundred and
    // twenty-eight and the rest stay black, which nothing indexes.
    const table = values.celPalette;
    const n = Math.min(colors.length, MAX_PALETTE);
    for (let i = 0; i < n; i++) {
      table[i * 3] = colors[i].r;
      table[i * 3 + 1] = colors[i].g;
      table[i * 3 + 2] = colors[i].b;
    }
    // `applySpec(null)` and `applyTranslucency(null)`'s values, which the
    // materials these replaced were born with: matte, opaque. `baseColor`
    // stays zero: a palette slot is read in its place.
    values.specShininess[0] = 1;
    this.materialEpoch++;
    return { defines, depthBias: 0, values, textures: {} };
  }

  /**
   * What every soldier's VISOR is drawn with — the emissive palette's
   * program, its colour a slot in `uv2.x` of this recipe's own table, one per
   * side (`colors`), and the factory's fog band by reference, as the map's
   * palette holds it: what `getEmissive(visor)`'s unlit `StandardMaterial`
   * and `EmissiveFog` drew until `BABYLON_EXIT.md` X4.1d, number for number
   * (`render/emissiveWorld.ts`). Bound at the first call, for
   * `bodyCelRecipe`'s reason.
   */
  bodyEmissiveRecipe(colors: readonly Color3[]): EmissiveRecipe {
    if (!this.bodyVisor) {
      const table = new Float32Array(MAX_EMISSIVE_PALETTE * 3);
      const n = Math.min(colors.length, MAX_EMISSIVE_PALETTE);
      for (let i = 0; i < n; i++) {
        table[i * 3] = colors[i].r;
        table[i * 3 + 1] = colors[i].g;
        table[i * 3 + 2] = colors[i].b;
      }
      this.bodyVisor = { depthBias: 0, values: { emissivePalette: table, fogRange: this.emissiveFogRange } };
      this.materialEpoch++;
    }
    return this.bodyVisor;
  }

  private bodyVisor: EmissiveRecipe | null = null;

  /**
   * What every unlit part of the player's own WEAPON is drawn with — a
   * reticle, a bead, a post, the fist's pip, the bottle's wick, the muzzle
   * flash: `bodyEmissiveRecipe`'s twin over the viewmodel's own table, one
   * slot a colour (`colors`, the `getEmissive` colours its parts wear), the
   * factory's fog band by reference — what each part's unlit
   * `StandardMaterial` and `EmissiveFog` drew until `BABYLON_EXIT.md` X4.3c,
   * number for number (`render/ViewDraw.ts`). Bound at the first call, for
   * `bodyCelRecipe`'s reason; a table longer than `MAX_EMISSIVE_PALETTE` is
   * REFUSED rather than cut, since a slot past it would read black.
   */
  viewEmissiveRecipe(colors: readonly Color3Like[]): EmissiveRecipe {
    if (!this.viewEmissive) {
      if (colors.length > MAX_EMISSIVE_PALETTE) {
        throw new Error(`viewEmissiveRecipe: ${colors.length} weapon emissives, past the palette's ${MAX_EMISSIVE_PALETTE}`);
      }
      const table = new Float32Array(MAX_EMISSIVE_PALETTE * 3);
      for (let i = 0; i < colors.length; i++) {
        table[i * 3] = colors[i].r;
        table[i * 3 + 1] = colors[i].g;
        table[i * 3 + 2] = colors[i].b;
      }
      this.viewEmissive = { depthBias: 0, values: { emissivePalette: table, fogRange: this.emissiveFogRange } };
      this.materialEpoch++;
    }
    return this.viewEmissive;
  }

  private viewEmissive: EmissiveRecipe | null = null;

  /**
   * What one of the effect POOLS' draws paints its CEL segments with
   * (`BABYLON_EXIT.md` X4.4b, `render/PoolDraw.ts`) — `hullCelRecipe`'s twin,
   * a recipe with no material: its palette `colors`, every colour a `get(hex)`
   * material held as its `baseColor` until the pool's meshes went, and every
   * other value the one those materials were born with — and `depthBias`
   * their `zOffsetUnits`, which is pipeline state (the marks' `get(hex,
   * MARK_DEPTH_UNITS)`). A fresh recipe a call: each caller asks once, at
   * construction, for a draw it keeps for the session. A table longer than
   * `MAX_PALETTE` is REFUSED rather than cut, since a slot past it would read
   * black.
   */
  poolCelRecipe(colors: readonly Color3[], depthBias = 0): CelRecipe {
    if (colors.length > MAX_PALETTE) {
      throw new Error(`poolCelRecipe: ${colors.length} colours, past the palette's ${MAX_PALETTE}`);
    }
    const recipe = this.ownPaletteRecipe(colors);
    return depthBias === 0 ? recipe : { ...recipe, depthBias };
  }

  /**
   * One slot of a pool's cel palette (`poolCelRecipe`) painted `color`
   * afresh — the debris draw's EARTH, which is the map's (`BABYLON_EXIT.md`
   * X4.4c: `BlastDebrisSystem.setEnvironment`'s `get(earth)` held it as its
   * `baseColor`) — and `materialEpoch` moved, so the draw copies it again.
   * `slot` is 1-based, as a vertex names it.
   */
  repaintPool(recipe: CelRecipe, slot: number, color: Color3): void {
    if (slot < 1 || slot > MAX_PALETTE) throw new Error(`repaintPool: slot ${slot} is outside the palette`);
    const table = recipe.values.celPalette;
    if (!table) throw new Error("repaintPool: the recipe has no palette of its own");
    table[(slot - 1) * 3] = color.r;
    table[(slot - 1) * 3 + 1] = color.g;
    table[(slot - 1) * 3 + 2] = color.b;
    this.materialEpoch++;
  }

  /**
   * What one of the effect POOLS' draws paints its UNLIT segments with — a
   * tracer, a pip, a wick, a motor, a fuze lamp (`BABYLON_EXIT.md` X4.4b):
   * `viewEmissiveRecipe`'s twin over the pool's own table, one slot a colour
   * (`colors`, the `getEmissive` colours its meshes wore), the factory's fog
   * band by reference — what each unlit `StandardMaterial` and `EmissiveFog`
   * drew, number for number. A fresh recipe a call, for `poolCelRecipe`'s
   * reason; a table longer than `MAX_EMISSIVE_PALETTE` is REFUSED.
   */
  poolEmissiveRecipe(colors: readonly Color3[]): EmissiveRecipe {
    if (colors.length > MAX_EMISSIVE_PALETTE) {
      throw new Error(`poolEmissiveRecipe: ${colors.length} colours, past the palette's ${MAX_EMISSIVE_PALETTE}`);
    }
    const table = new Float32Array(MAX_EMISSIVE_PALETTE * 3);
    for (let i = 0; i < colors.length; i++) {
      table[i * 3] = colors[i].r;
      table[i * 3 + 1] = colors[i].g;
      table[i * 3 + 2] = colors[i].b;
    }
    this.materialEpoch++;
    return { depthBias: 0, values: { emissivePalette: table, fogRange: this.emissiveFogRange } };
  }

  /**
   * Returns the shared cel material for a hex color, creating it on demand.
   *
   * `depthUnits` biases the depth TEST toward the eye in polygon-offset units,
   * one unit being the depth buffer's own smallest resolvable step at that
   * fragment — the same unit `GLASS_DEPTH_UNITS` is stated in, and against the
   * same class of problem. Its one caller is a ROAD (`ROAD_DEPTH_UNITS` in
   * `world/roads.ts`), a sheet lying a centimetre over the floor that loses
   * that centimetre to the buffer's own step long before the fog wall.
   * It is part of the cache KEY for `getGlossy`'s reason: the offset is
   * renderer state rather than a uniform, so one hex asked for at two biases
   * is two materials, and keying on the colour alone would hand whichever
   * asked first to both — a car's underbody lifted off the ground because a
   * road had already minted its colour.
   */
  get(hex: string, depthUnits = 0): MaterialKey {
    const cacheKey = depthUnits === 0 ? hex : `\0proud-${hex}-${depthUnits}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new MaterialKey(depthUnits === 0 ? `cel-${hex}` : `cel-proud-${hex}`, "cel", {
        zOffsetUnits: depthUnits,
      });
      this.bear(mat, PLAIN_VARIANT, depthUnits);
      this.own(mat, "baseColor", Color3.FromHexString(hex));
      this.albedos.set(mat, Color3.FromHexString(hex));
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * The same flat cel colour as get(), but with the toon specular band
   * enabled — a hard key-light highlight for metal, glass, wet stone.
   * Cached under its own key so the matte variant of the same colour is
   * untouched, and named `cel-gloss-#rrggbb` to stay in the one naming scheme
   * the merge readers parse.
   *
   * **The SPEC is part of the cache key and the NAME is not**, and both
   * halves of that are load-bearing. The spec is a uniform rather than a
   * define, so one hex asked for at two gloss levels is two materials that
   * differ only in what was uploaded to them — keyed on the colour alone,
   * whichever level asked first would silently answer for both, which is a
   * weapon finish coming out matte because some other finish had already
   * minted its colour. The NAME still carries the palette colour and nothing
   * else, because a name is what `world/merge.ts`'s `plainCelHex` reads to
   * decide whether a mesh can join the palette merge — the one reader left now
   * that the hull ink's own `inkColorFor` has gone with it.
   */
  getGlossy(hex: string, spec: SpecSpec): MaterialKey {
    const cacheKey =
      `\0gloss-${hex}-${spec.color}-${spec.intensity}-${spec.shininess}` +
      `-${spec.mirror ?? 0}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new MaterialKey(`cel-gloss-${hex}`, "cel");
      this.bear(mat, PLAIN_VARIANT, 0);
      this.own(mat, "baseColor", Color3.FromHexString(hex));
      this.albedos.set(mat, Color3.FromHexString(hex));
      this.applySpec(mat, spec);
      this.applyTranslucency(mat, null);
      this.remember(cacheKey, mat);
    }
    return mat;
  }


  /**
   * The same flat cel colour as get(), but with the translucency band enabled
   * — the key light coming through the surface rather than off it, for the
   * thin things it should read through: canvas awnings, foliage, anything a
   * silhouette is meant to glow at the edges of when the moon is behind it.
   *
   * Deliberately a third variant beside matte and glossy rather than a fourth
   * combination with it: a surface thin enough to transmit is not one with a
   * hard Blinn glint on it, and the cache is per colour, so an axis that
   * multiplies is an axis that costs.
   *
   * Cached under its own key and named `cel-trans-#rrggbb`, in the same naming
   * scheme as the other two and for the same reason `getGlossy` gives.
   */
  getTranslucent(hex: string, trans: TranslucencySpec): MaterialKey {
    const cacheKey = `\0trans-${hex}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new MaterialKey(`cel-trans-${hex}`, "cel");
      this.bear(mat, PLAIN_VARIANT, 0);
      this.own(mat, "baseColor", Color3.FromHexString(hex));
      this.albedos.set(mat, Color3.FromHexString(hex));
      this.applySpec(mat, null);
      this.applyTranslucency(mat, trans);
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * `getTranslucent` for a sheet that BENDS — today the flags over the
   * control points (`systems/FlagCloth.ts`, drawn off this recipe by our
   * renderer since `BABYLON_EXIT.md` X4.6b) and nothing else. The one
   * difference is `CEL_SMOOTH`: shaded off the interpolated normal rather
   * than the per-triangle facet, because cloth is a fine grid and a facet per
   * triangle of it reads as a lattice rather than a fold. The bands stay hard.
   *
   * A surface wearing one carries no vertex colour buffer, and nothing else
   * wears one. Cached under its own key and named `cel-cloth-#rrggbb`, outside the three
   * names the merge readers parse — cloth is never merged.
   */
  getCloth(hex: string, trans: TranslucencySpec): MaterialKey {
    const cacheKey = `\0cloth-${hex}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new MaterialKey(`cel-cloth-${hex}`, "cel");
      this.bear(mat, CLOTH_VARIANT, 0);
      this.own(mat, "baseColor", Color3.FromHexString(hex));
      this.applySpec(mat, null);
      this.applyTranslucency(mat, trans);
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * The glazing material: the same flat cel colour as get(), composited over
   * what is behind it and carrying a reflection of the sky.
   *
   * **It comes in two, and which one is a statement about what stands BEHIND
   * the sheet rather than about how it should look.** `backed` glazing has a
   * solid mass a hand behind it — a tower's curtain wall on its shaft, a
   * shophouse's drawn sash, a clerestory on brick — so nothing is ever seen
   * through it and it is drawn OPAQUE: one shading of that pixel instead of
   * two, and the mass behind it rejected on depth before it is shaded at all.
   * Everything else is blended, and it is blended because something back there
   * is meant to be legible: the twenty-four shopfronts with a room behind them
   * (`tint` exists so a lit interior reads from the pavement) and a car's
   * greenhouse, which `buildCar` models a dash and seat backs into for exactly
   * that reason. `Build.pane` is where the claim is made; see it for why a
   * `backed` sheet can never also be `breakable`.
   *
   * **The blended one is the only ALPHA-BLENDED material in the world layer**,
   * and it is the only thing that has any business being one. Everything else
   * here is a flat opaque cel colour, the water fakes its depth with a fresnel
   * between two opaque colours rather than showing the bed through itself, and
   * the only other transparent thing in the scene at all is the capture zone's
   * skirt, which is annotation rather than world. What blending costs is the
   * two things it always costs and they are paid for below in `MapBuilder`: a
   * pane writes no depth and so is sorted rather than z-buffered, and it must
   * be neither an outline nor a shadow caster. A `backed` pane wants the last
   * two anyway — the mass it hangs on already casts the shadow and carries the
   * ink — so both flags stay on both kinds and only the depth changes.
   *
   * **Both carry the depth BIAS**, and that is not about transparency at all:
   * a pane hangs centimetres off the wall behind it, which is a gap the depth
   * buffer loses with distance. See `GLASS_DEPTH_UNITS`. On a `backed` sheet it
   * earns a second job — biased toward the eye, the pane wins the depth test
   * against its own mass rather than z-fighting it at range.
   *
   * Cached under its own key and named `cel-glass-#rrggbb` (`-backed` for the
   * opaque twin), like the glossy and translucent variants — though unlike them
   * nothing recovers ink from it, because glass is not outlined. **The key
   * matters beyond the cache**: both of `MapBuilder`'s merges group by
   * MATERIAL, so two variants in one placement fall into two merged meshes
   * without either merge being told that glazing now comes in two kinds.
   */
  getGlass(hex: string, glass: GlassSpec, backed: string | null = null): MaterialKey {
    const kind = backed ? `glass-backed-${backed}` : "glass";
    const cacheKey = `\0${kind}-${hex}`;
    const name = backed ? `cel-glass-${hex}-on-${backed}` : `cel-glass-${hex}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      const variant = backed ? GLASS_BACKED_VARIANT : GLASS_VARIANT;
      mat = new MaterialKey(name, "cel", {
        // Biased toward the eye by the depth buffer's own step, which is what
        // keeps a distant window a window — see GLASS_DEPTH_UNITS.
        zOffsetUnits: CelMaterialFactory.GLASS_DEPTH_UNITS,
        // What puts a see-through pane in the blended run at all
        // (`BlockHandover`'s pass masks). The material's own `alpha` stays
        // 1: the alpha that matters is written per pixel by the shader, and
        // a material-wide one would fade the reflection along with
        // everything else.
        //
        // A `backed` sheet writes 1 for every pixel and belongs with the
        // OPAQUE draws, which is where its saving comes from — see the
        // header, and `CEL_GLASS_BACKED` in `wgsl/celSurface.ts` for why its
        // colour needs nothing from the framebuffer to be right.
        blended: !backed,
      });
      // A recipe, as every material our renderer draws keeps one: a round's
      // glazing is ours (`render/GlassDraw.ts`, `BABYLON_EXIT.md` X4.6e).
      this.bear(mat, variant, CelMaterialFactory.GLASS_DEPTH_UNITS);
      this.own(mat, "baseColor", Color3.FromHexString(hex));
      if (backed) {
        this.own(mat, "glassBackdrop", Color3.FromHexString(backed));
      }
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      this.applyGlass(mat, glass);
      this.applyReflection(mat);
      this.glassRecipes.set(mat, { hex, glass, backed });
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * A cel material whose albedo is a texture sampled in world space
   * (`vPosW.xz * texScale`) rather than from UVs — for flat ground surfaces
   * only (walls would streak). World mapping means every mesh sharing it
   * tiles seamlessly at a constant real-world scale no matter how it is
   * sized, rotated about Y, or merged, and primitives need no UV authoring.
   * Cached per key in the shared map so environment, point-light, and camera
   * updates reach it like any flat colour.
   *
   * @param key cache key, e.g. "cobble" — one material per texture/scale pair
   * @param tex tiling picture; mipmaps + anisotropy are the caller's job
   *   (its `Picture`), its texture made here, once per canvas
   * @param texScale texture repeats per metre (1 / metres-per-tile)
   * @param opts.spec enables the toon specular band (wet sheen); omit for matte
   * @param opts.bump height map matching the albedo texel-for-texel — the
   *   shader perturbs the normal by its slope (CEL_BUMP). Must tile exactly
   *   like the albedo.
   * @param opts.bumpScale metres of fake relief at height value 1.0
   * @param opts.depthUnits polygon offset toward the eye, exactly as `get()`
   *   takes it and keyed the same way — the cobbled road's half of
   *   `ROAD_DEPTH_UNITS`
   */
  getGroundTextured(
    key: string,
    tex: Picture,
    texScale: number,
    opts: {
      spec?: SpecSpec;
      bump?: Picture;
      bumpScale?: number;
      depthUnits?: number;
    } = {},
  ): MaterialKey {
    const { spec, bump } = opts;
    const depthUnits = opts.depthUnits ?? 0;
    const cacheKey =
      `\0ground-${key}${spec ? "-spec" : ""}${bump ? "-bump" : ""}` +
      (depthUnits === 0 ? "" : `-proud${depthUnits}`);
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      const variant = bump ? GROUND_BUMP_VARIANT : GROUND_VARIANT;
      mat = new MaterialKey(`cel-ground-${key}`, "cel", { zOffsetUnits: depthUnits });
      this.bear(mat, variant, depthUnits);
      this.ownTexture(mat, "baseColorTex", tex);
      this.own(mat, "texScale", texScale);
      // Set once here rather than in the frame beside the flat colours' pair:
      // these two come from CONFIG and not from the map, so nothing an
      // environment change carries could move them.
      const groundVar = CONFIG.graphics.groundVariation;
      this.own(mat, "groundVariationScale", 1 / Math.max(0.001, groundVar.metersPerCell));
      this.own(mat, "groundVariationAmount", groundVar.amount);
      if (bump) {
        this.ownTexture(mat, "bumpTex", bump);
        this.own(mat, "bumpScale", opts.bumpScale ?? 0.1);
        // CONFIG's and never the map's, for groundVariation's reason above.
        const relief = CONFIG.graphics.relief;
        this.own(
          mat,
          "reliefFade",
          new Vector4(
            relief.parallaxFade[0],
            relief.parallaxFade[1],
            relief.shadowFade[0],
            relief.shadowFade[1],
          ),
        );
        this.own(mat, "reliefShade", new Vector2(relief.shadowStrength, relief.cavity));
      }
      // The CALLER decides whether this ground is glossy at all; the installed
      // MAP decides how glossy — see `setGroundSpec`. That split matters here
      // because materials are built during `installMap`, which runs after
      // `setEnvironment`: taking the caller's values would hand a freshly
      // built material the shipped night sheen and never revisit it, since the
      // override has already been applied to a cache this material was not yet
      // in.
      this.applySpec(mat, spec ? this.groundSpec : null);
      this.applyTranslucency(mat, null);
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * Shared unlit emissive material (used for neon/glow/effect meshes).
   * `overGlass` biases it past a `backed` pane it is hung in front of — see
   * `OVER_GLASS_DEPTH_UNITS` — and is part of the key; `GlowPass`'s mask
   * copies the bias so the two draws still tie.
   */
  getEmissive(hex: string, overGlass = false): MaterialKey {
    const depthUnits = overGlass ? CelMaterialFactory.OVER_GLASS_DEPTH_UNITS : 0;
    const key = overGlass ? `${hex}-over-glass` : hex;
    let mat = this.emissiveCache.get(key);
    if (!mat) {
      // Unlit means unfogged, which at village scale would be a lit window
      // burning through the fog wall at full saturation: every draw of an
      // unlit part is our renderer's, and each fogs it on the cel shader's
      // curve (`emissiveFogRange`), as Babylon's `EmissiveFog` plugin did
      // until `BABYLON_EXIT.md` X5.4h.
      mat = new MaterialKey(`emissive-${key}`, "emissive", {
        emissiveColor: Color3.FromHexString(hex),
        zOffsetUnits: depthUnits,
      });
      this.emissiveCache.set(key, mat);
    }
    return mat;
  }

  /**
   * The ONE emissive material a map's merged world wears, whatever colour it
   * emits — `getEmissive`'s twin as `getWorldCel` is `get`'s, the colour read
   * per vertex out of `setEmissivePalette`'s table (`EmissiveWorld.ts` has the
   * argument). Two of them, because `overGlass` is a polygon offset and an
   * offset is a property of the MATERIAL: the block merge picks by the source's
   * key, so a lit room behind a `backed` pane keeps its bias.
   *
   * Held outside `cache` for the flame's reason: not a cel material, and none
   * of the uniforms that cache's walks write.
   */
  getEmissiveWorld(overGlass: boolean): EmissiveWorldMaterial {
    const i = overGlass ? 1 : 0;
    let mat = this.emissiveWorld[i];
    if (!mat) {
      const depthUnits = overGlass ? CelMaterialFactory.OVER_GLASS_DEPTH_UNITS : 0;
      mat = new EmissiveWorldMaterial(overGlass ? "emissive-world-over-glass" : "emissive-world", depthUnits);
      // What our renderer draws it with in every pass: the table and the fog
      // band, held here and read by reference (`emissiveRecipe`). The
      // material holds none of it (`EmissiveWorld.ts`).
      const recipe: EmissiveRecipe = {
        depthBias: depthUnits,
        values: { emissivePalette: this.emissivePalette, fogRange: this.emissiveFogRange },
      };
      this.emissiveRecipes.set(mat, recipe);
      this.emissiveMaterials.set(recipe, mat);
      this.emissiveWorld[i] = mat;
    }
    return mat;
  }

  private readonly emissiveWorld: (EmissiveWorldMaterial | null)[] = [null, null];

  /** What our renderer draws each palette material with (`emissiveRecipe`), and the other way round. */
  private readonly emissiveRecipes = new Map<EmissiveWorldMaterial, EmissiveRecipe>();
  private readonly emissiveMaterials = new Map<EmissiveRecipe, EmissiveWorldMaterial>();

  /**
   * The palette's fog band — start, and the reciprocal of the band, on the
   * CPU, so it rounds as Babylon's uniform for the same pair did — for our
   * renderer's draw of the palette, which reads it by reference.
   */
  private readonly emissiveFogRange = new Float32Array(2);

  /**
   * What our renderer draws `mat` with if it is one of the emissive
   * palette's two materials (`render/emissiveWorld.ts`): its depth bias, and
   * the palette and fog band by reference — `celRecipe`'s twin, a PULL off
   * what the factory holds, never a read of the material; null otherwise.
   * `materialEpoch` moves when either is rewritten.
   */
  emissiveRecipe(mat: unknown): EmissiveRecipe | null {
    return this.emissiveRecipes.get(mat as EmissiveWorldMaterial) ?? null;
  }

  /**
   * `emissiveRecipe` the other way round: the palette material `recipe`
   * draws, or null for a recipe this factory did not make. What a question
   * about the MATERIAL is asked of when our renderer draws the recipe — the
   * glow's rules, which read a material's emissive colour, intensity and
   * alpha (`render/WorldGlow.ts`).
   */
  emissiveMaterialOf(recipe: EmissiveRecipe): EmissiveWorldMaterial | null {
    return this.emissiveMaterials.get(recipe) ?? null;
  }

  /** The map's emissive palette, flattened — `palette`'s twin. */
  private readonly emissivePalette = new Float32Array(MAX_EMISSIVE_PALETTE * 3);

  /**
   * Publishes the emissive palette `MapBuilder` assembled while it merged —
   * `setPalette`'s twin, on the same deadline and for the same reason.
   */
  setEmissivePalette(colors: readonly Color3[]): void {
    this.emissivePalette.fill(0);
    const n = Math.min(colors.length, MAX_EMISSIVE_PALETTE);
    for (let i = 0; i < n; i++) {
      this.emissivePalette[i * 3] = colors[i].r;
      this.emissivePalette[i * 3 + 1] = colors[i].g;
      this.emissivePalette[i * 3 + 2] = colors[i].b;
    }
    this.materialEpoch++;
  }

  /**
   * The one material every open fire wears (`FlameShader`), created on first
   * ask. Held OUTSIDE `cache` because it is not a cel material; what it does
   * share with one — the world clock — is written into its `values` beside
   * the frame's (`updateWind`), and the eye, the fog and the opaque alpha it
   * is drawn under ARE the frame's, so a fire can never keep different time
   * or weather from the wall behind it. Since `BABYLON_EXIT.md` X4.4d our
   * renderer draws every fire of a round off its `values`; the material is a
   * recipe key and draws nothing.
   */
  getFlame(): FlameMaterial {
    if (!this.flame) {
      this.flame = new FlameMaterial();
      this.flame.setClock(this.windTime);
    }
    return this.flame;
  }

  private flame: FlameMaterial | null = null;

  /**
   * What every blast's billows are drawn with (`BlastShader`'s `BlastPaint`),
   * made on first ask and held outside `cache`: a key and its values, no
   * Babylon material since `BABYLON_EXIT.md` X4.4c — our renderer draws every
   * billow (`render/BlastDraw.ts`) — the world clock written into them beside
   * the frame's (`updateWind`). The light, the eye and the
   * fog it is drawn under are the frame's (`fillFrame`), which this factory
   * pushed onto the billow's material, off these same fields, until then.
   */
  getBlast(): BlastPaint {
    if (!this.blast) {
      this.blast = new BlastPaint();
      this.blast.setClock(this.windTime);
    }
    return this.blast;
  }

  private blast: BlastPaint | null = null;

  /** Takes a theme's lighting/atmosphere, which the frame is filled from (`fillFrame`). */
  setEnvironment(env: {
    lightDir: Vector3;
    lightColor: Color3;
    keyWrap: number;
    ambientColor: Color3;
    skyLightColor: Color3;
    skyZenithColor: Color3;
    rimColor: Color3;
    fogColor: Color3;
    fogStart: number;
    fogEnd: number;
    mistColor: Color3;
    mistHeight: number;
    mistStrength: number;
    wearColor: Color3;
    wearAmount: number;
  }): void {
    this.lightDir.copyFrom(env.lightDir).normalize();
    this.lightColor.copyFrom(env.lightColor);
    this.keyWrap = env.keyWrap;
    this.ambientColor = env.ambientColor;
    this.skyLightColor = env.skyLightColor;
    this.skyZenithColor = env.skyZenithColor;
    this.rimColor = env.rimColor;
    fogState.color.copyFrom(env.fogColor);
    fogState.start = env.fogStart;
    fogState.end = env.fogEnd;
    // The passes that never run the cel shader read the same band, which is
    // what keeps them from ever describing different weather to the frame:
    // the ink (`fogBand`) and the unlit emissive draws behind every window,
    // flame and tracer, which take it off this pair by reference.
    this.emissiveFogRange[0] = fogState.start;
    this.emissiveFogRange[1] = 1 / Math.max(0.001, fogState.end - fogState.start);
    this.materialEpoch++;
    this.mistColor = env.mistColor;
    this.mistParams.set(env.mistHeight, env.mistStrength);
    this.wearColor = env.wearColor;
    this.wearAmount = env.wearAmount;
  }

  /**
   * Takes the active dynamic lights (already reduced to the nearest
   * `MAX_POINT_LIGHTS` by the LightingSystem) into the packed arrays the frame
   * is filled from (`fillFrame`). Called once per frame.
   *
   * It walked the cache too, pushing the arrays onto every Babylon material,
   * and skipped that walk when the arrays came out unchanged — the guard
   * compared against `Math.fround` of each input, since a `Float32Array`
   * keeps only that. No material holds a copy since `BABYLON_EXIT.md` X6.1c,
   * so there is no walk to save and the arrays are simply written.
   */
  setPointLights(lights: PointLightData[]): void {
    const count = Math.min(lights.length, MAX_POINT_LIGHTS);
    for (let i = 0; i < count; i++) {
      const l = lights[i];
      const b = i * 3;
      this.pointPos[b] = l.position.x;
      this.pointPos[b + 1] = l.position.y;
      this.pointPos[b + 2] = l.position.z;
      this.pointColor[b] = l.color.r * l.intensity;
      this.pointColor[b + 1] = l.color.g * l.intensity;
      this.pointColor[b + 2] = l.color.b * l.intensity;
      this.pointRange[i] = l.range;
    }
    this.pointCount = count;
  }

  /**
   * Advances the wind: the clock the frame's sway reads (`fillFrame`), and the
   * fire's and the blast's own, beside it.
   *
   * **Called from the same place in the frame the grass field's clock is**, and
   * that is the whole of why it is a method rather than a uniform pushed from
   * `tick` beside `updateCamera`. The shader's EYE is owed by the states that
   * simulate nothing — a menu, a building card, a kit turntable all fog against
   * it — but a CLOCK is not: a pause holds the world, the grass stops, and a
   * canopy still leaning over a frozen field would be the one thing in the
   * valley the pause did not reach.
   *
   */
  updateWind(dt: number): void {
    this.windTime += dt;
    this.flame?.setClock(this.windTime);
    this.blast?.setClock(this.windTime);
  }

  /**
   * Call once per frame so the shading's fog and rim track the active camera:
   * the eye the frame is filled with (`fillFrame`), every cel draw's, the
   * fire's and the billows' alike.
   */
  updateCamera(camPos: Vector3): void {
    this.camPos.copyFrom(camPos);
  }

  /**
   * Copies the frame every cel material holds — the environment, the eye, the
   * wind, the point lights, every shadow, the irradiance volume, the map's
   * palette and the relief setting — into our renderer's frame
   * (`render/frame.ts`), once a frame as its main pass begins
   * (`render/Renderer.ts`). Off the FIELDS, never off a material: a material
   * is what this factory writes, and the factory is what holds the values.
   * The camera's matrix is not here — the factory never had it; the
   * renderer's host fills `viewProjection` from the scene's camera.
   * With `bake`, the clouds' shadow is held off as a reflection bake holds it
   * (`fillBakeFrame`).
   */
  fillFrame(out: FrameUniforms, bake = false): void {
    this.camPos.toArray(out.camPos);
    out.opaqueAlpha[0] = this.opaqueAlpha;
    this.lightDir.toArray(out.lightDir);
    out.keyWrap[0] = this.keyWrap;
    this.lightColor.toArray(out.lightColor);
    this.ambientColor.toArray(out.ambientColor);
    this.skyLightColor.toArray(out.skyLightColor);
    this.skyZenithColor.toArray(out.skyZenithColor);
    this.rimColor.toArray(out.rimColor);
    fogState.color.toArray(out.fogColor);
    out.fogParams[0] = fogState.start;
    out.fogParams[1] = fogState.end;
    this.mistColor.toArray(out.mistColor);
    this.mistParams.toArray(out.mistParams);
    // Weathering is a property of the LOOK rather than of the map, so it comes
    // from CONFIG and not from the environment.
    const look = surfaceLook;
    out.variationScale[0] = look.variationScale;
    out.variationAmount[0] = look.variationAmount;
    // The map's grime, and the AMOUNT is the one piece of state in this block
    // that IS the map's — see `EnvironmentSpec.wear` for why dirt is a claim
    // about a place where the albedo variation above is a claim about the
    // renderer. Everything else here is CONFIG's: the vertical fade's edge, the
    // ramp's shape and the grain are the physics of splash-back and rising damp
    // and are the same in every village. The falloff rides here rather than in
    // the bake because a curve baked at a wall's two corners arrives as a
    // straight line; see the fragment's WEAR block.
    this.wearColor.toArray(out.wearColor);
    out.wearParams[0] = this.wearAmount;
    out.wearParams[1] = look.wearVertical;
    out.wearParams[2] = look.wearFalloff;
    out.wearParams[3] = look.wearEdgeBreak;
    out.wearGrain.set(look.wearGrain);
    out.reliefMarch[0] = this.reliefMarch;
    const w = windShape;
    out.windTime[0] = this.windTime;
    windBearing.toArray(out.windDir);
    out.windParams.set(w.params);
    out.windFrond.set(w.frond);
    out.windFrondRate.set(w.frondRate);
    out.windBough.set(w.bough);
    out.windBoughRate.set(w.boughRate);
    out.windBoughFade.set(w.boughFade);
    out.pointPos.set(this.pointPos);
    out.pointColor.set(this.pointColor);
    out.pointRange.set(this.pointRange);
    out.pointCount[0] = this.pointCount;
    this.shadows.fillFrame(out, bake);
    const gi = this.gi;
    if (gi) {
      gi.grid.toArray(out.giGrid);
      gi.window.toArray(out.giWindow);
      gi.shade.toArray(out.giShade);
      gi.band.toArray(out.giBand);
      gi.extra.toArray(out.giExtra);
      out.giSlotChannel.set(gi.slotChannel);
    }
    out.celPalette.set(this.palette);
  }

  /**
   * A reflection probe's frame for our renderer's bake (`render/ProbeBake.ts`,
   * `BABYLON_EXIT.md` X3.6c), the only bake there is since X3.7c:
   * `fillFrame`'s, with what a bake changes stated HERE — the eye at the
   * probe, the opaque alpha 1 and the clouds' shadow held off
   * (`ShadowBindings.fillFrame`'s `bake`). The eye is PASSED, never
   * borrowed: nothing the factory holds moves for it.
   */
  fillBakeFrame(out: FrameUniforms, eye: Vector3Like): void {
    this.fillFrame(out, true);
    out.camPos[0] = eye.x;
    out.camPos[1] = eye.y;
    out.camPos[2] = eye.z;
    out.opaqueAlpha[0] = 1;
  }

  /**
   * The frame's TEXTURES for our renderer (`render/frame.ts`,
   * `FRAME_TEXTURES`): this hands over the same objects off the same fields —
   * `ShadowBindings`' maps (ours, or the lit texel where a map is off, and the
   * clouds' field, `BABYLON_EXIT.md` X5.4d) and the irradiance volume's seven, OUR renderer's own since
   * `BABYLON_EXIT.md` X5.1b (`OwnTexture`s, read where they lie: no Babylon
   * material holds them). A pull, beside `fillFrame`; allocates nothing.
   */
  fillFrameTextures(out: FrameTextures): void {
    this.shadows.fillFrameTextures(out);
    const gi = this.gi;
    if (!gi) return;
    // The volume's own seven, OUR renderer's (X5.1b): read where they lie,
    // never through the host.
    out.giIrr = gi.textures.giIrr;
    out.giDir = gi.textures.giDir;
    out.giAux = gi.textures.giAux;
    out.giVis0 = gi.textures.giVis0;
    out.giVis1 = gi.textures.giVis1;
    out.giVis2 = gi.textures.giVis2;
    out.giVis3 = gi.textures.giVis3;
  }

  /**
   * What ONE glazing group is drawn WITH in a round (`render/GlassDraw.ts`,
   * `BABYLON_EXIT.md` X4.6e): `base`'s recipe — the same colour, backdrop and
   * four glass numbers — with that group's probe in it: where its cube was
   * baked from and at what strength, and the box its ray is corrected
   * against. A fresh recipe a call, its arrays its own, which is what the
   * per-slot material twin it replaced was until X4.6e — the CUBE is not in
   * it: it is the bake's, and the draw binds it where it lies
   * (`GlassDraw.point`). Null for a material that is no glazing.
   */
  glassProbeRecipe(
    base: unknown,
    refl: { readonly at: Vector3Like; readonly strength: number; readonly boxMin: Vector3Like; readonly boxMax: Vector3Like },
  ): CelRecipe | null {
    const recipe = this.glassRecipes.has(base as MaterialKey) ? this.recipes.get(base as MaterialKey) : undefined;
    if (!recipe) return null;
    const values: Partial<Record<CelMaterialField, Float32Array>> = {};
    for (const [name, value] of Object.entries(recipe.values) as [CelMaterialField, Float32Array][]) {
      values[name] = new Float32Array(value);
    }
    // As the twin's `setVector3`s and `setVector4` wrote them: each double to
    // a float32, in the order the uniform holds it.
    const min = values.reflectBoxMin!;
    min[0] = refl.boxMin.x;
    min[1] = refl.boxMin.y;
    min[2] = refl.boxMin.z;
    const max = values.reflectBoxMax!;
    max[0] = refl.boxMax.x;
    max[1] = refl.boxMax.y;
    max[2] = refl.boxMax.z;
    const probe = values.reflectProbe!;
    probe[0] = refl.at.x;
    probe[1] = refl.at.y;
    probe[2] = refl.at.z;
    probe[3] = refl.strength;
    this.materialEpoch++;
    return { defines: recipe.defines, depthBias: recipe.depthBias, values, textures: {} };
  }

  /**
   * The key light, the flat ambient and the sky fill exactly as the surfaces
   * are currently lit by them — for `GiVolume`, which lights the points its
   * rays hit with the same numbers, so a bounce can never describe different
   * weather from the wall it came off. Live references: read, never write.
   *
   * One VIEW, built once, whose getters follow the fields — the volume asks
   * every frame, and `setEnvironment` replaces the ambient and sky objects
   * rather than copying into them, so a snapshot of references would go stale.
   */
  readLighting(): LightingView {
    return this.lightingView;
  }
  private readonly lightingView: LightingView = (() => {
    const f = this;
    return {
      get lightDir() {
        return f.lightDir;
      },
      get lightColor() {
        return f.lightColor;
      },
      get ambient() {
        return f.ambientColor;
      },
      get sky() {
        return f.skyLightColor;
      },
      get cloudMap() {
        return f.shadows.cloudMap;
      },
      get cloudArea() {
        return f.shadows.cloudArea;
      },
      get cloudRay() {
        return f.shadows.cloudRay;
      },
    };
  })();

  /**
   * The flat albedo a material was minted with, or null for one that has no
   * single colour (a ground texture, the palette materials, glazing). Read by
   * `MapBuilder` to hand the irradiance volume a colour per collider box.
   */
  albedoOf(mat: unknown): Color3 | null {
    if (!mat) return null;
    return this.albedos.get(mat as object) ?? null;
  }

  /**
   * Publishes the irradiance volume — its seven textures and the five
   * vectors describing the window — to the frame our renderer draws with
   * (`fillFrame`, `fillFrameTextures`), which pulls it every frame, so a tier
   * change standing up a new set walks nothing.
   *
   * No material is handed it: the frame is the one holder.
   */
  setGi(binding: GiBinding): void {
    this.gi = binding;
  }

  /**
   * The key light's two live objects, for what is outside the cache and lit by
   * the same key (the grass, the water): hold these rather than a copy, and copy
   * them in the frame that draws.
   */
  get keyLight(): { dir: Vector3; color: Color3 } {
    return { dir: this.lightDir, color: this.lightColor };
  }

  /**
   * Whether a material is a translucent SOLID — one that states a depth and so
   * belongs in the foliage map. `ShadowSystem.setCasters` asks this of every
   * caster, which is how that map stays foliage and nothing else.
   */
  isSolid(mat: unknown): boolean {
    return this.solids.has(mat as MaterialKey);
  }

  /**
   * Whether a material is one of `getGlass`'s, and which kind: `"backed"`
   * (it writes depth, with the opaque draws) or `"seeThrough"` (blended, in the
   * back-to-front run); null for any other. `BlockHandover` asks it of each
   * surface a round builds, which is how the glazing becomes our renderer's
   * (`BABYLON_EXIT.md` X4.6e).
   */
  glassKind(mat: unknown): "backed" | "seeThrough" | null {
    const recipe = this.glassRecipes.get(mat as MaterialKey);
    if (!recipe) return null;
    return recipe.backed ? "backed" : "seeThrough";
  }

  /**
   * The spec each glossy material was BUILT with, so a later override can
   * find them again.
   *
   * This exists because the cache keys — `\0gloss-<hex>` and
   * `\0ground-<key>-spec-bump` — deliberately do not include the spec's
   * values, and the factory outlives a map: the second map to ask for the
   * same colour gets the first map's material, uniforms and all. Re-applying
   * over the cache is how `setEnvironment` already solves exactly this, and
   * doing it that way rather than widening the key keeps one material per
   * colour instead of one per colour per map ever loaded.
   */
  private readonly specs = new Map<MaterialKey, SpecSpec>();

  /** Specular is per-material, never theme-wide: null keeps a material matte. */
  private applySpec(mat: MaterialKey, spec: SpecSpec | null): void {
    if (!spec) {
      this.own(mat, "specColor", Color3.Black());
      // Shininess 1 is a no-op exponent — the zero specColor wins anyway.
      this.own(mat, "specShininess", 1);
      // Zero is WRITTEN rather than left where the last spec put it: these
      // materials are cached and re-applied over (see `specs`), so an
      // unwritten uniform on a re-used material is the previous map's answer,
      // and this one is the branch the mirror block is behind.
      this.own(mat, "specMirror", 0);
      return;
    }
    this.specs.set(mat, spec);
    this.own(mat, "specColor", Color3.FromHexString(spec.color).scale(spec.intensity));
    this.own(mat, "specShininess", Math.max(1, spec.shininess));
    this.own(mat, "specMirror", Math.min(1, Math.max(0, spec.mirror ?? 0)));
  }

  /** What a ground material created from here on is built with. */
  private groundSpec: SpecSpec = CONFIG.graphics.spec.cobble;

  /**
   * Replaces the sheen on the GROUND material — the map's weather and the
   * elevation of its key light, which is what `CONFIG.graphics.spec.cobble`'s
   * own note says to re-check whenever the light moves.
   *
   * Passing `undefined` restores the shipped value, so switching back to a map
   * that states nothing genuinely undoes this rather than leaving the previous
   * map's streets behind. Scoped to the ground on purpose: the rifle's spec is
   * the player's weapon, which no map owns.
   */
  setGroundSpec(spec: SpecSpec | undefined): void {
    const next = spec ?? CONFIG.graphics.spec.cobble;
    this.groundSpec = next;
    this.specs.forEach((_, mat) => {
      if (mat.name.startsWith("cel-ground-")) this.applySpec(mat, next);
    });
  }

  /** 1 with the Ground relief setting on, 0 off — the frame's, so every bumped ground reads it. */
  private reliefMarch = 1;

  /**
   * The Ground relief setting. Off zeroes both marches' fade amounts, so
   * `reliefParallax` and `reliefLit` take their early return on every pixel —
   * a uniform branch, no variant compiled — and the ground keeps its bumped
   * slope and its cavity: flatter up close, the same from the far side of the
   * fade, where the marches had already gone to nothing.
   */
  setGroundRelief(on: boolean): void {
    const march = on ? 1 : 0;
    this.reliefMarch = march;
  }

  /**
   * Translucency is per-material for the same reason specular is: null keeps
   * a material opaque, and the zero colour is what the shader's term
   * multiplies out to nothing against.
   */
  private applyTranslucency(
    mat: MaterialKey,
    trans: TranslucencySpec | null,
  ): void {
    this.own(
      mat,
      "transColor",
      trans ? Color3.FromHexString(trans.color).scale(trans.intensity) : Color3.Black(),
    );
    const depth = trans?.depth ?? 0;
    this.own(mat, "transDepth", depth);
    if (depth > 0) this.solids.add(mat);
    else this.solids.delete(mat);
  }

  /**
   * Glazing is per-material like the other two, but unlike them it has no
   * null arm: `CEL_GLASS` is a compile-time define, so the only material this
   * is ever called on is one built to be glass and there is no "off" value to
   * push onto the rest of the cache.
   */
  private applyGlass(mat: MaterialKey, glass: GlassSpec): void {
    this.own(mat, "glassParams", new Vector4(glass.reflectance, glass.falloff, glass.halo, glass.tint));
  }

  /**
   * What a glazing material's recipe is BORN with: a probe of strength
   * zero, which is a pane that reflects the sky and nothing else.
   *
   * Unlike every other `apply*` here this is not a copy of shared state, and
   * that is the whole shape of the reflection: `glassProbeRecipe` is what
   * gives a round's group a real one, on the spot rather than from a walk.
   * The cube is no part of a recipe (`GlassDraw.point` binds it); the default
   * cube a Babylon glazing material was bound to went with the map editor's
   * build that sampled it, at `BABYLON_EXIT.md` X5.3d.
   */
  private applyReflection(mat: MaterialKey): void {
    this.own(mat, "reflectBoxMin", Vector3.Zero());
    this.own(mat, "reflectBoxMax", Vector3.Zero());
    this.own(mat, "reflectProbe", new Vector4(0, 0, 0, 0));
  }
}

/**
 * The installed map's fog, as the passes that are NOT the cel shader see it.
 * Written by `CelMaterialFactory.setEnvironment`, which is also what the
 * frame's fog is filled from (`fillFrame`) — one fact, one writer, so the ink and
 * the wall it hangs in front of cannot disagree.
 *
 * It is module state rather than a factory field because the passes that need
 * it reach it from outside any material. They take it two different ways, and
 * the difference is what each pass can be told:
 *
 * - The INK takes the band itself, as `CelInk`'s `fadeBand` uniform, and fades
 *   per PIXEL off the distance it already holds. It has to be per pixel:
 *   `BlockMerge` gives one mesh per 48 m block, so a per-MESH ink fade left the
 *   far half of a block in clear ink over a wall that had already gone to fog
 *   (measured, while the ink was still a hull: 50 of 687 outlined meshes span
 *   the entire fog band). That measurement is why the hull needed a shader-store
 *   patch to fade correctly and why a full-screen pass gets it for nothing.
 * - The GLOW layer gets it through `fogAmountAt`, and fades per MESH, because
 *   its bloom is generated from a material's emissive colour and there is no
 *   per-pixel hook at all. That is affordable where the ink's was not: a bloom
 *   is a soft blob with no edge to misplace.
 */
const fogState = { color: new Color3(0.05, 0.06, 0.08), start: 24, end: 78 };



/**
 * The wind's bearing, normalised once.
 *
 * A module constant rather than a field for the reason `CONFIG.wind` is one
 * table rather than a per-map override: the air over a valley is not something
 * a map states, and nothing in the game changes it at runtime. `GrassSystem`
 * normalises the same pair for its own block — two readers of one bearing,
 * which is exactly what moving it out of `CONFIG.grass` bought.
 */


/**
 * The name of the one material every matte surface in the village wears.
 *
 * **It deliberately carries no hex**, because there is no single colour to
 * name — the palette arrives per vertex (`getWorldCel`, `vPalette`) — and the
 * name is what says so to every reader that parses one: `MapBuilder`'s
 * `plainCelHex` refuses it, so a mesh already wearing the palette material is
 * never offered to the palette merge a second time.
 *
 * It used to matter to two more readers and both went with the hull ink, which
 * is worth knowing only because it is why the rule reads as bigger than it now
 * is: the ink's own name regex had to skip this material, and `MapBuilder` had
 * to keep it out of Babylon's per-MESH outline pass, which could not tint one
 * shell for a mesh holding ten colours. A full-screen ink asks the name
 * nothing.
 */
const WORLD_CEL_NAME = "cel-world";


const windBearing = new Vector2(
  CONFIG.wind.dir[0],
  CONFIG.wind.dir[1],
).normalize();

/**
 * The wind's SHAPE, read once from `CONFIG.wind` — what `fillFrame` copies
 * into our renderer's frame, one statement of it. `params.z` is the gust's wavenumber: a wavelength in
 * metres is what the config states, because that is the number anyone tuning
 * it can pace out.
 */
const windShape = (() => {
  const w = CONFIG.wind;
  const f = w.frond;
  const b = w.bough;
  return {
    params: [w.foliage.travel, w.foliage.speed, (Math.PI * 2) / w.foliage.gust],
    frond: [f.lean, f.flap, f.swing, f.flutter],
    frondRate: [f.calm, f.flapRate, f.flutterRate, (Math.PI * 2) / f.flutterWave],
    bough: [b.lean, b.flap, b.swing, b.rustle],
    boughRate: [b.calm, b.flapRate, b.rustleRate, b.swellRate],
    boughFade: [b.rustleFade[0], b.rustleFade[1]],
  } as const;
})();

/**
 * The renderer's own share of the surface — the albedo variation and the
 * wear ramp's shape and grain, all `CONFIG`'s — read once, for the reason
 * `windShape` is: `fillFrame` reads one copy. The wear
 * AMOUNT is the map's and is not here (`EnvironmentSpec.wear`).
 */
const surfaceLook = (() => {
  const v = CONFIG.graphics.albedoVariation;
  const w = CONFIG.wear;
  return {
    variationScale: 1 / Math.max(0.001, v.metersPerCell),
    variationAmount: v.amount,
    wearVertical: Math.sin((w.verticalDegrees * Math.PI) / 180),
    wearFalloff: w.falloff,
    wearEdgeBreak: w.edgeBreak,
    wearGrain: [1 / Math.max(0.001, w.metersPerCell), w.streak, w.contrast],
  } as const;
})();

/**
 * How much of the fog colour a surface `dist` from the eye is buried under, on
 * the cel shader's own curve — the `t * t` in `celSurface`'s atmosphere block,
 * repeated here for the passes that cannot run that shader.
 *
 * **Anything drawn unshaded owes this curve**, through here or through a band
 * of its own the way `CelInk` takes one, or it hangs in front of the fog wall
 * at full strength
 * while the world behind it dissolves. That was two separate bugs on Greyfen,
 * and neither showed on Hollowmere: with a near-black fog, unfogged ink is
 * invisible against the wall and a glow reads as a lamp. A bright fog is what
 * makes an un-attenuated pass obvious.
 */
export function fogAmountAt(dist: number): number {
  const span = Math.max(0.001, fogState.end - fogState.start);
  const t = Math.min(1, Math.max(0, (dist - fogState.start) / span));
  return t * t;
}

/**
 * The same curve's two ends, for the one reader that evaluates it PER PIXEL in
 * a shader of its own rather than calling `fogAmountAt` per mesh.
 *
 * `CelInk` is that reader. It owes the curve for the reason stated above — an
 * unfogged line hangs in front of the fog wall at full strength while the wall
 * behind it dissolves — and it is the map's band and not a constant, so it has
 * to be read after `setEnvironment` rather than captured once. Handed out as
 * the raw pair because the shader needs the ends to interpolate between, where
 * every other caller wants the answer.
 */
export function fogBand(): { start: number; end: number } {
  return { start: fogState.start, end: fogState.end };
}



