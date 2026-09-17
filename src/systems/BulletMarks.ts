/**
 * BulletMarks.ts — The holes a round leaves BEHIND, as a fixed pool of decal
 * quads owned by `CombatSystem`.
 * Owns: the mark geometry, the ring of pooled meshes and where each one is
 * stood. Nothing else in the game knows it exists — it is reached only from
 * `CombatSystem.spawnImpact`, on the frame the tracer's head arrives, so the
 * mark and the spark and the dust are one event.
 * Invariants: it is a POOL and never allocates per shot (the `CombatSystem`
 * rule, and this pool's slots are long-lived where the others' are not); it
 * marks the STATIC world only; it holds no clock at all.
 * Contract: this header. `docs/rendering.md` for the depth bias it borrows.
 *
 * WHY THE MARK IS A CEL MATERIAL AND THE DUST DISC IS NOT. Every other effect
 * in `CombatSystem` is `getEmissive` — unlit, because a spark and a puff of
 * dust are their own light and are gone in a fifth of a second. A mark is
 * neither: it is a bit of the WALL, it is still there a minute later, and an
 * unlit one is a sticker. Hollowmere is a night village and Sarab is a desert
 * at noon; a fixed grey that reads as chipped render on one of them GLOWS on
 * the other, because unlit means full value whatever the map's key light is
 * doing. Wearing `CelMaterialFactory.get` instead puts the mark in the same
 * banded key, ambient, point-light, shadow and fog terms as the surface it
 * was shot off, and nothing here has to be told what map it is on.
 *
 * WHAT THAT COSTS, AND WHY IT IS THE CHEAP WAY ROUND. A cel material cannot be
 * thin-instanced — the cel vertex shader declares no `world0..3`, and an
 * attribute that struct does not declare is a WGSL compile error that takes
 * the whole frame black (`CelShader`'s note) — so this is one mesh per mark
 * rather than one draw for all of them. It is affordable because a mark is
 * SMALL and `WorldCulling`'s size gate is exactly the thing that drops small:
 * a cel material has no `emissiveColor`, so a mark is NOT size-exempt the way
 * every other effect mesh in this system is, and at `culling.minPixels` a
 * 10 cm decal leaves the candidate list somewhere around 20-30 m — the gate is
 * a size on the SCREEN, so the distance moves with the resolution and the
 * field of view and there is no one number for it. The pool's whole draw cost
 * is therefore the marks in the room you are standing in.
 *
 * WHY THE CACHE KEY IS SAFE. `CelMaterialFactory`'s cache is keyed finely
 * enough that no material is ever worn by two meshes that disagree about a
 * vertex COLOUR buffer, instancing, bones or morph targets — the four things
 * the frozen define set varies with, and a disagreement is a mesh silently
 * drawn with the effect another mesh compiled. A mark carries no colour
 * buffer, and what PROVES it shares with nothing that does is the depth bias:
 * `get(hex, units)` keys on the pair, and `MARK_DEPTH_UNITS` is a value no
 * other caller asks for (the only other one is a road's -8). So these two
 * materials are this pool's alone by construction rather than by inspection.
 *
 * WHY THERE IS NO TIMER. A mark does not fade, does not shrink and is not
 * aged: it stands until the ring comes round to its slot and takes it, which
 * at `markPoolSize` is the better part of a magazine ago and somewhere you
 * have stopped looking. The alternative — a life and a fade — buys a wall
 * that tidies itself up, which is the opposite of the thing being asked for,
 * and costs a per-frame walk over the pool that this way does not exist at
 * all. `update` is not a method here.
 */
import {
  Matrix,
  Mesh,
  Quaternion,
  Scene,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { mulberry32 } from "../world/rng";

/**
 * The depth-test bias every mark wears, in the buffer's OWN smallest step at
 * that fragment — the unit `ROAD_DEPTH_UNITS` is stated in and against the
 * same problem: a sheet lying a couple of millimetres over the surface it
 * belongs to loses those millimetres to the buffer's own resolution long
 * before the fog wall, and a flickering mark reads as a broken decal.
 *
 * Bigger in magnitude than a road's -8 because a road is looked at from above
 * and a mark is looked at from anywhere, including nearly edge-on, where the
 * same geometric clearance projects to nothing.
 *
 * It is also, deliberately, the half of the material cache key that makes
 * these two materials unshareable — see the header.
 */
const MARK_DEPTH_UNITS = -14;

/**
 * How many distinct silhouettes the pool draws from, cycled across the slots.
 *
 * A mark is a chipped polygon rather than a circle, and the roll about its own
 * normal is random per mark — but a single shape rolled is still one stamp,
 * and a wall takes enough rounds for that to read. Four is where a burst stops
 * looking repeated; the cost is four vertex buffers of twenty vertices.
 */
const SHAPES = 4;

/** Rim vertices per mark. Low enough to read as CHIPPED rather than round. */
const RIM = 9;

/** The basis a mark is stood on, and the matrix it is read out of. */
const AX = new Vector3();
const AY = new Vector3();
const BX = new Vector3();
const BY = new Vector3();
const TMP = new Vector3();
const MTX = new Matrix();
/** The seed axis, swapped where the normal is the one it is parallel to. */
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);

/**
 * One chipped disc, built in the XY plane about the origin at unit radius and
 * facing +Z — which is the axis `place` turns onto the surface normal, the
 * same convention the dust disc's quad already uses.
 *
 * BOTH WINDINGS ARE EMITTED, which is not a look but a refusal to remember a
 * renderer convention: whether Babylon calls this fan's front face the one
 * facing +Z depends on the handedness and the front-face setting, and getting
 * it backwards is a mark that is simply never drawn — a failure with no
 * symptom but absence. The second copy costs nine triangles and is culled
 * from every eye the first one is not.
 *
 * **BOTH CARRY THE SAME +Z NORMAL, and that is the half of this that is not
 * obvious.** A second winding is Babylon's `DOUBLESIDE`, which flips the
 * normal with the face because it is built for a SHEET that is genuinely two
 * surfaces; this is one surface emitted twice so that one of the two survives,
 * and a decal lying on a wall has exactly one outward normal whichever triangle
 * carries it. Flipping it is not a subtle error: the cel shader lights off the
 * normal, so the copy that wins is lit from INSIDE the wall and the mark comes
 * out at ambient — measured on Sarab as a pure black hole in sunlit sand that
 * did not move when its albedo was doubled, which is the tell.
 */
function chipData(rand: () => number): VertexData {
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 0, 1];
  const indices: number[] = [];
  for (let i = 0; i < RIM; i++) {
    // The angle is jittered as well as the radius, and it carries MORE of the
    // irregularity than the radius does: evenly spaced vertices at uneven
    // radii still read as a wheel, because the eye finds the spokes — but a
    // radius allowed to vary by much more than a fifth stops being a chip and
    // starts being a torn scrap of paper, which is what a 0.62 floor looked
    // like against a wall at arm's length.
    const th = ((i + 0.55 * (rand() - 0.5)) / RIM) * Math.PI * 2;
    const r = 0.79 + rand() * 0.21;
    positions.push(Math.cos(th) * r, Math.sin(th) * r, 0);
    normals.push(0, 0, 1);
  }
  const back = RIM + 1;
  for (let i = 0; i < back; i++) {
    positions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    normals.push(0, 0, 1);
  }
  for (let i = 0; i < RIM; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % RIM);
    indices.push(0, a, b);
    indices.push(back, back + b, back + a);
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  return data;
}

/**
 * The marks a round leaves on the static world: a ring of pooled decal quads,
 * oldest reused.
 *
 * Built once with the scene and never rebuilt — a map change clears it
 * (`CombatSystem.clearTransient`) rather than disposing it, exactly as the
 * tracer, spark and disc pools are.
 */
export class BulletMarks {
  private pool: Mesh[] = [];
  /** The ring cursor: the slot the next mark takes, whatever is in it. */
  private next = 0;

  constructor(
    scene: Scene,
    private mats: CelMaterialFactory,
  ) {
    // Seeded, so a shape is a fact about the build rather than about the
    // session. Nothing downstream depends on it — this is not world-building
    // and no nav graph can hear it — but a silhouette that changes on every
    // page load is one a screenshot cannot be compared against.
    const rand = mulberry32(0x4d41524b);
    const shapes: VertexData[] = [];
    for (let i = 0; i < SHAPES; i++) shapes.push(chipData(rand));
    for (let i = 0; i < CONFIG.effects.markPoolSize; i++) {
      const mesh = new Mesh(`mark${i}`, scene);
      shapes[i % SHAPES].applyToMesh(mesh);
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.isVisible = false;
      // The world layer's rule, and it is the whole of what keeps a decal out
      // of the game: a mark is VISUAL, so it is in neither ray query, neither
      // sweep, nor the shadow map's caster list.
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      this.pool.push(mesh);
    }
  }

  /**
   * Stand a mark on the surface a round stopped on.
   *
   * `normal` is the face's outward normal, and is read here rather than held —
   * `CombatSystem` hands over its tracer's own copy.
   *
   * `radius` and `hex` are the impact KIND's, off the `IMPACTS` table beside
   * the spark and the dust, because what a round takes out of packed earth and
   * what it takes out of render are different sizes and different colours and
   * there is nothing else in the difference.
   */
  place(pos: Vector3, normal: Vector3, hex: string, radius: number): void {
    const mesh = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;

    // A basis on the face. The seed axis is swapped where the normal is the
    // one it is parallel to — a floor or a ceiling — or the cross product is
    // the zero vector and the mark has no orientation at all.
    const seed = Math.abs(normal.y) > 0.95 ? AXIS_X : AXIS_Y;
    Vector3.CrossToRef(seed, normal, AX);
    AX.normalize();
    Vector3.CrossToRef(normal, AX, AY);

    // Rolled about the normal, so the shared silhouette is not a stamp. The
    // roll is spent on the BASIS rather than composed as a second quaternion:
    // the order two rotations multiply in is a convention to get wrong, and a
    // pair of axes rotated in their own plane is not.
    const roll = Math.random() * Math.PI * 2;
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    BX.copyFrom(AX).scaleInPlace(c);
    TMP.copyFrom(AY).scaleInPlace(s);
    BX.addInPlace(TMP);
    BY.copyFrom(AY).scaleInPlace(c);
    TMP.copyFrom(AX).scaleInPlace(-s);
    BY.addInPlace(TMP);
    Matrix.FromXYZAxesToRef(BX, BY, normal, MTX);

    // A frozen world matrix, so seventy-odd standing decals are not recomputed
    // every frame for a transform that will not move again until the ring
    // comes back for this slot. It also puts the bounding info in world space
    // NOW: `WorldCulling.offer` runs before the render bakes matrices, so a
    // mark left to the render would be size-tested at wherever it last stood
    // for one frame.
    mesh.unfreezeWorldMatrix();
    Quaternion.FromRotationMatrixToRef(MTX, mesh.rotationQuaternion!);
    normal.scaleToRef(CONFIG.effects.markLift, TMP);
    mesh.position.copyFrom(pos).addInPlace(TMP);
    mesh.scaling.setAll(radius * (0.82 + Math.random() * 0.4));
    mesh.material = this.mats.get(hex, MARK_DEPTH_UNITS);
    mesh.isVisible = true;
    mesh.freezeWorldMatrix();
  }

  /** Takes every mark off the world. Called when a map is torn down. */
  clear(): void {
    for (const mesh of this.pool) mesh.isVisible = false;
    this.next = 0;
  }
}
