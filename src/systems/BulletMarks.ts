/**
 * BulletMarks.ts — The holes a round leaves BEHIND, as a fixed pool of decal
 * quads owned by `CombatFx`.
 * Owns: the mark geometry (`MARK_SHAPES`, the kits our renderer draws a mark
 * as an instance of), the ring of pooled SLOTS — each one's shape, paint,
 * world matrix and world bounding sphere, stood once and frozen — and the
 * paints and depth bias every mark is drawn with (`MARK_PAINTS`,
 * `MARK_DEPTH_UNITS`). Nothing else in the game raises one — it is reached
 * only from `CombatFx.spawnImpact`, on the frame the tracer's head arrives,
 * so the mark and the spark and the dust are one event — and our renderer
 * reads the slots (`Game.drawMarks`, `BABYLON_EXIT.md` X4.4b): Babylon is
 * made no mesh of any.
 * Invariants: it is a POOL and never allocates per shot (the `CombatFx`
 * rule, and this pool's slots are long-lived where the others' are not); it
 * marks the STATIC world only; it holds no clock at all; a slot's matrix and
 * sphere are what `freezeWorldMatrix` left on the mesh it was until X4.4b —
 * `TransformNode.computeWorldMatrix` and `BoundingSphere._update`, operation
 * for operation in `src/math` — and it imports no Babylon.
 * Contract: this header. `docs/rendering.md` for the depth bias it borrows
 * and "The pools, ours" for how a mark is drawn.
 *
 * WHY THE MARK IS CEL-LIT AND THE DUST DISC IS NOT. Every other effect in
 * `CombatFx` is unlit (`getEmissive`'s colour) — because a spark and a puff
 * of dust are their own light and are gone in a fifth of a second. A mark is
 * neither: it is a bit of the WALL, it is still there a minute later, and an
 * unlit one is a sticker. Hollowmere is a night village and Sarab is a desert
 * at noon; a fixed grey that reads as chipped render on one of them GLOWS on
 * the other, because unlit means full value whatever the map's key light is
 * doing. Drawn by the CEL program instead — the cel material
 * `CelMaterialFactory.get(hex, MARK_DEPTH_UNITS)` was until X4.4b, now its
 * palette twin (`CelMaterialFactory.poolCelRecipe`, `MARK_PAINTS` its table)
 * — the mark takes the same banded key, ambient, point-light, shadow and fog
 * terms as the surface it was shot off, and nothing here has to be told what
 * map it is on.
 *
 * WHAT IT COSTS, AND THE SIZE GATE. Every standing mark is an INSTANCE of its
 * shape in one draw of our renderer's (`Game.drawMarks`, `render/PoolDraw.ts`)
 * — where Babylon drew one mesh a mark, a cel material having no thin
 * instances. A mark is SMALL, and the size gate is exactly the thing that
 * drops small: it is cel, so it is NOT size-exempt the way every unlit effect
 * is, and the drawing asks the gate of each mark's frozen sphere
 * (`WorldCulling.keepsSphere`) as the gate asked it of the mesh's — at
 * `culling.minPixels` a 10 cm decal drops somewhere around 20-30 m, the gate
 * being a size on the SCREEN, so the distance moves with the resolution and
 * the field of view and there is no one number for it.
 *
 * THE DEPTH BIAS IS PIPELINE STATE, and the marks' pipeline is theirs alone:
 * no other draw asks for `MARK_DEPTH_UNITS` (the only other biased cel
 * surface is a road's -8).
 *
 * WHY THERE IS NO TIMER. A mark does not fade, does not shrink and is not
 * aged: it stands until the ring comes round to its slot and takes it, which
 * at `markPoolSize` is the better part of a magazine ago and somewhere you
 * have stopped looking. The alternative — a life and a fade — buys a wall
 * that tidies itself up, which is the opposite of the thing being asked for,
 * and costs a per-frame walk over the pool that this way does not exist at
 * all. `update` is not a method here.
 */
import { CONFIG } from "../config";
import { Matrix, Quaternion, Vector3, type Vector3Like } from "../math";
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
 * It is pipeline state, so the marks' cel pipeline is theirs alone — see
 * the header.
 */
export const MARK_DEPTH_UNITS = -14;

/**
 * Every colour a mark is painted in — each impact kind's `IMPACTS.mark.hex`
 * in `CombatFx`, the two kinds that mark — in the order our renderer's
 * palette holds them. A slot names its paint by its index here. **A paint
 * not in it does not compile** — `IMPACTS.mark.hex` is a `MarkPaint`, so a
 * new one is added HERE first — and a hex `place` is handed that is not in it
 * anyway is refused rather than drawn black.
 */
export const MARK_PAINTS = ["#2b2723", "#4b3a26"] as const;

/** One of `MARK_PAINTS`: the only colour a mark may be asked to wear. */
export type MarkPaint = (typeof MARK_PAINTS)[number];

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
/** A slot's channels while it is stood, and the scale `_update` reads its radius off. */
const POS = new Vector3();
const ROT = new Quaternion();
const SCALE = new Vector3();
const NORMAL = new Vector3();
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
/** One silhouette's arrays, as the mesh was handed them (`number[]`, doubles). */
export interface MarkShape {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly indices: readonly number[];
  /** Its local bounding sphere (`extractMinAndMax`, `BoundingSphere.reConstruct`). */
  readonly centre: Vector3;
  readonly radius: number;
}

function chipData(rand: () => number): MarkShape {
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
  const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
  for (let i = 0; i < positions.length; i += 3) {
    min.minimizeInPlaceFromFloats(positions[i], positions[i + 1], positions[i + 2]);
    max.maximizeInPlaceFromFloats(positions[i], positions[i + 1], positions[i + 2]);
  }
  return {
    positions,
    normals,
    indices,
    centre: max.add(min).scaleInPlace(0.5),
    radius: Vector3.Distance(min, max) * 0.5,
  };
}

/**
 * The pool's silhouettes, built once off a fixed seed — so a shape is a fact
 * about the build rather than about the session. Nothing downstream depends
 * on it — this is not world-building and no nav graph can hear it — but a
 * silhouette that changes on every page load is one a screenshot cannot be
 * compared against. Slot `i` wears shape `i % SHAPES`, as its mesh did.
 */
export const MARK_SHAPES: readonly MarkShape[] = (() => {
  const rand = mulberry32(0x4d41524b);
  const shapes: MarkShape[] = [];
  for (let i = 0; i < SHAPES; i++) shapes.push(chipData(rand));
  return shapes;
})();

/** One mark slot: its shape, its paint and, once stood, its frozen world and world sphere. */
export interface MarkSlot {
  /** Its index in `MARK_SHAPES`. */
  readonly shape: number;
  /** Its index in `MARK_PAINTS`. */
  paint: number;
  /** Standing in the world (`isVisible`). */
  visible: boolean;
  /** Its world matrix, frozen when it was stood. */
  readonly world: Matrix;
  /** Its world bounding sphere, measured off that matrix. */
  readonly centre: Vector3;
  radius: number;
}

/**
 * The marks a round leaves on the static world: a ring of pooled decal quads,
 * oldest reused.
 *
 * Built once with the scene and never rebuilt — a map change clears it
 * (`CombatFx.clearTransient`) rather than disposing it, exactly as the
 * tracer, spark and disc pools are.
 */
export class BulletMarks {
  /**
   * Every slot, by index — what `Game.drawMarks` hands our renderer. A slot
   * never stood stands at the identity, its sphere the shape's own, as the
   * mesh it was did. The world layer's rule, and it is the whole of what
   * keeps a decal out of the game: a mark is VISUAL, so it is in neither ray
   * query, neither sweep, nor the shadow map's caster list — it has no
   * collider and casts nothing.
   */
  readonly slots: MarkSlot[] = [];
  /** The ring cursor: the slot the next mark takes, whatever is in it. */
  private next = 0;

  constructor() {
    for (let i = 0; i < CONFIG.effects.markPoolSize; i++) {
      const shape = MARK_SHAPES[i % SHAPES];
      this.slots.push({
        shape: i % SHAPES,
        paint: 0,
        visible: false,
        world: Matrix.Identity(),
        centre: shape.centre.clone(),
        radius: shape.radius,
      });
    }
  }

  /**
   * Stand a mark on the surface a round stopped on.
   *
   * `normal` is the face's outward normal, and is read here rather than held —
   * `CombatFx` hands over its tracer's own copy.
   *
   * `radius` and `hex` are the impact KIND's, off the `IMPACTS` table beside
   * the spark and the dust, because what a round takes out of packed earth and
   * what it takes out of render are different sizes and different colours and
   * there is nothing else in the difference.
   */
  place(pos: Vector3Like, normal: Vector3Like, hex: MarkPaint, radius: number): void {
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % this.slots.length;
    NORMAL.copyFrom(normal);

    // A basis on the face. The seed axis is swapped where the normal is the
    // one it is parallel to — a floor or a ceiling — or the cross product is
    // the zero vector and the mark has no orientation at all.
    const seed = Math.abs(NORMAL.y) > 0.95 ? AXIS_X : AXIS_Y;
    Vector3.CrossToRef(seed, NORMAL, AX);
    AX.normalize();
    Vector3.CrossToRef(NORMAL, AX, AY);

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
    Matrix.FromXYZAxesToRef(BX, BY, NORMAL, MTX);

    // A FROZEN world matrix, so seventy-odd standing decals are not
    // recomposed every frame for a transform that will not move again until
    // the ring comes back for this slot — composed here as `computeWorldMatrix`
    // composed the mesh's (`ComposeToRef` of its scale, its quaternion and its
    // position; no parent), and its bounding sphere measured off it NOW, as
    // `freezeWorldMatrix` measured the mesh's, so the size gate the drawing
    // asks (`Game.drawMarks`) reads where it stands.
    Quaternion.FromRotationMatrixToRef(MTX, ROT);
    NORMAL.scaleToRef(CONFIG.effects.markLift, TMP);
    POS.copyFrom(pos).addInPlace(TMP);
    SCALE.setAll(radius * (0.82 + Math.random() * 0.4));
    const paint = MARK_PAINTS.indexOf(hex);
    if (paint < 0) throw new Error(`BulletMarks: "${hex}" is no mark paint (MARK_PAINTS)`);
    slot.paint = paint;
    Matrix.ComposeToRef(SCALE, ROT, POS, slot.world);
    this.measure(slot);
    slot.visible = true;
  }

  /** `BoundingSphere._update` off the slot's world, from its shape's local sphere. */
  private measure(slot: MarkSlot): void {
    const shape = MARK_SHAPES[slot.shape];
    const world = slot.world;
    if (world.isIdentity()) {
      slot.centre.copyFrom(shape.centre);
      slot.radius = shape.radius;
      return;
    }
    Vector3.TransformCoordinatesToRef(shape.centre, world, slot.centre);
    Vector3.TransformNormalFromFloatsToRef(1.0, 1.0, 1.0, world, TMP);
    slot.radius = Math.max(Math.abs(TMP.x), Math.abs(TMP.y), Math.abs(TMP.z)) * shape.radius;
  }

  /** Takes every mark off the world. Called when a map is torn down. */
  clear(): void {
    for (const slot of this.slots) slot.visible = false;
    this.next = 0;
  }
}
