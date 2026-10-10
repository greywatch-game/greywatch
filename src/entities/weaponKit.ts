/**
 * weaponKit.ts — The shared vocabulary every weapon model is built in: the
 * colour groups, the primitive helpers, the merge, and the shape of what a
 * builder returns.
 * Owns: the build accumulator (`weaponBuild`) and the `WeaponParts` contract.
 * Owns no geometry of its own — `RifleModel`, `CarbineModel`, `SmgModel`,
 * `LmgModel`, `DmrModel`, `SniperModel` and `PistolModel` are the builders,
 * and `optics.ts`
 * is the seventh.
 *
 * **It builds `Part`s, and `merge` is where they become meshes** (BABYLON_EXIT.md
 * X1.3). Every helper makes a `Part` (`world/parts.ts`) on a `src/geometry/`
 * buffer — `createBox`, `createCylinder`, `facet`'s lofts and slabs — and hangs
 * it from a `PartNode`: the build's `frame`, which stands in for the weapon's
 * live root, or a raking `pivot` under it. Nothing is in the scene until
 * `merge` hands one buffer per colour group to `drawnMesh` and parents that
 * mesh to the LIVE node it was given (the root, the magazine, the bolt, a
 * sight). So the pivots are build-time frames that are never meshes and never
 * nodes, and there is nothing to dispose once the build is done. A reticle or
 * a bead is drawn on its own, and `lit` is where it becomes a mesh; an optic's
 * glass, which wears a material of its own, is made one in `optics.ts`.
 *
 * Invariants:
 * - A builder assembles at the ORIGIN with its root at identity and merges
 *   before anything is moved. `mergeParts` bakes world matrices, as
 *   `MergeMeshes` did, so a merge under a transformed root bakes that
 *   transform in twice — which is also why the `frame` that stands in for the
 *   root during the build is a `PartNode` at identity and never moves. Same
 *   rule, same reason, as `BuildingKit` and `mergeByMaterial`
 *   (`world/merge.ts`).
 * - Nothing may be scaled non-uniformly. `mergeParts` carries normals across
 *   without re-normalising them, as `VertexData.transform` did, and
 *   `renderOutline` extrudes each vertex along its own normal, so a squashed
 *   part grows an ink shell that is fat on the squashed axis. Round shells are
 *   faceted slab rings (`shell`) for exactly that reason.
 * - A colour absent from `SECTIONS` is silently never merged: anything handed
 *   to `collect` has to appear there, or have been named by `paint` first.
 *   `paint` is for OPTICS — a colour an optic wears that no weapon does — and
 *   a painted group is never a finish part, so no finish can reach it.
 * - A colour group is also the unit a FINISH repaints, so `merge` records
 *   which group each merged mesh came from and `takeFinish` hands the list
 *   back at the seam between the weapon and its optics. What `collect`
 *   paints here IS the standard finish — see `finishes.ts`, whose
 *   `standard` entry is these same four constants and must stay them.
 * - Emissive parts go through `lit`, never `collect` — merged into a colour
 *   group they would take that group's cel material, and an outline shell
 *   around a glowing dot is a black smudge where the aim point should be.
 *
 * The landmarks a builder returns are POSITIONS, not nodes, because two
 * weapons are built at once and only one is enabled: the muzzle flash and the
 * ejection port have to hang off something that survives a loadout change, so
 * `ViewModel` owns those nodes and moves them to whichever weapon is fitted.
 */
import {
  Mesh,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { createBox, createCylinder } from "../geometry/primitives";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { extrude, loft, type ProfilePoint, type Ring } from "./facet";
import {
  bakePartTransform,
  detachPart,
  drawnMesh,
  mergeParts,
  Part,
  PartNode,
} from "../world/parts";
import type { SightId } from "./sights";

export const BODY = "#2b2b33"; // aluminium upper receiver, barrel, hinge block
export const POLYMER = "#1d232c"; // lower receiver, grip, magazine, handguard, stock
export const METAL = "#454e5e"; // rails, sights, charging handle, small fittings
export const RUBBER = "#15181d"; // the contact surfaces: butt pad, grip cap, foregrip
/**
 * Cartridge brass — the LMG's exposed belt and the rounds seen through the
 * DMR's magazine window, and nothing else in the kit. Every other weapon keeps
 * its ammunition out of sight, so this group is empty there and `merge` simply
 * skips it.
 *
 * A colour of its own rather than METAL, because it is the one part of a weapon
 * that is not part of the weapon: brass has to read as loose rounds hanging off
 * the gun, and merged into the fittings group it would be steel-coloured and
 * steel-glossy along with the rails.
 */
export const BRASS = "#a8823a";
const RETICLE = "#ff3b30";

/**
 * A colour group, by name — one merged mesh per weapon, and the unit a
 * FINISH repaints in. `entities/finishes.ts` is the table of those repaints
 * and the only thing that reads this type.
 */
export type FinishGroup = "body" | "polymer" | "metal" | "rubber" | "brass";

/**
 * Colour groups, merged into one mesh each. Order fixes the merged names, and
 * a colour absent from this list is silently never merged.
 */
const SECTIONS: ReadonlyArray<readonly [FinishGroup, string]> = [
  ["body", BODY],
  ["polymer", POLYMER],
  ["metal", METAL],
  ["rubber", RUBBER],
  ["brass", BRASS],
];

/**
 * One merged colour group, and which group it is — everything a finish needs
 * to repaint a built weapon without knowing anything about how it was built.
 *
 * The pair exists because the merge is the ONLY place the two facts are ever
 * in the same scope: after it, a colour group is an anonymous mesh whose
 * material happens to hold the colour it was assembled under. Recovering the
 * group from the merged mesh's NAME would work today and is exactly the kind
 * of thing that stops working the first time a suffix is renamed.
 */
export interface FinishPart {
  mesh: Mesh;
  group: FinishGroup;
}

/** Facets around a round shell. 14 reads round at arm's length and stays cheap. */
export const FACETS = 14;

/**
 * One fittable optic: everything it adds to the weapon, under a node that is
 * switched off while a different sight is fitted.
 */
export interface SightAssembly {
  root: TransformNode;
  /**
   * The optic's eye reference — the rear aperture, the holo window, the
   * scope's ocular. ADS puts THIS point on the camera axis, so it is what
   * makes the reticle the point of impact.
   */
  sightCenter: TransformNode;
  meshes: Mesh[];
}

/**
 * What sights a weapon carries, and it is a SHAPE rather than a convention.
 *
 * `fitted` is a rail: one assembly per optic, exactly one of them enabled, and
 * which one is the kit screen's choice. `fixed` is a weapon whose glass is not
 * a choice at all — the sidearm wears the notch and blade machined into its own
 * slide and there is no rail to bolt anything else to.
 *
 * A union rather than a `Record` with two of the keys left dark, because the
 * second shape is what makes asking a pistol for a 3.5x scope impossible to
 * spell. The eye reference is still one number per sight and still lives on the
 * assembly, so `ViewModel.applyFit` derives the aimed pose the same way for
 * both — see `wornSight`, which is the only place the two are told apart.
 */
export type WeaponSights =
  | { kind: "fitted"; assemblies: Record<SightId, SightAssembly> }
  | {
      kind: "fixed";
      sight: SightId;
      assembly: SightAssembly;
      /**
       * How far the eye is held behind THIS weapon's own sight, aimed (m), when
       * it is not the table's figure for `sight`. A sight bolted to a rail is
       * held at the table's eye relief because its size is drawn against it; a
       * sight machined into a slide is held wherever the arms put it, which on
       * a pistol is at arm's length — and the iron table's figure is a rifle's
       * cheek weld.
       */
      eyeRelief?: number;
    };

/**
 * The optic actually in front of the eye on this weapon, given what the kit has
 * fitted — the fitted one on a rail, and the weapon's own on a fixed sight,
 * whatever the kit says.
 *
 * The returned `id` is not decoration: it is what the aimed FOV, the look
 * rates and the zoom compensation are all resolved from, so the camera and the
 * viewmodel have to agree on it. `ViewModel.carriedSight` is how the rest of
 * the game reads the answer.
 */
export function wornSight(
  sights: WeaponSights,
  fitted: SightId,
): { id: SightId; assembly: SightAssembly } {
  return sights.kind === "fixed"
    ? { id: sights.sight, assembly: sights.assembly }
    : { id: fitted, assembly: sights.assemblies[fitted] };
}

/**
 * The axis a magazine raked by `rake` leaves its well along, weapon-local and
 * unit length — what a builder hands back as `WeaponParts.magDrop`.
 *
 * A pivot's positive `rotX` sends everything BELOW it backwards (the rule every
 * raked grip and magwell in the kit is built on), so the line down a raked
 * magazine's own body is down and back by that same angle. Sliding it out
 * straight down instead shears it through the front wall of the well it is
 * leaving, which at a pistol's grip rake is the whole magazine's width.
 */
export function magDropAxis(rake: number): Vector3 {
  return new Vector3(0, -Math.cos(rake), -Math.sin(rake));
}

/**
 * A loft section stated by where its FRONT and BACK faces are rather than by
 * a centre and a depth — which is how a grip is drawn: a finger groove moves
 * the front face and nothing else, and a palm swell the back. `front` is the
 * larger z. `k` is the corner cut, as on any `Ring`.
 */
export function spanRing(y: number, w: number, front: number, back: number, k = 0.4): Ring {
  return { y, w, d: front - back, z: (front + back) / 2, k };
}

/** Where one hand grips, and where its elbow trails, in weapon-local units. */
export interface GripSpec {
  hand: Vector3;
  elbow: Vector3;
}

/**
 * HOW a weapon is held while its magazine is changed — the pose the reload
 * works it in, which `CONFIG.viewmodel.reload.styles` states per id.
 *
 * It is a property of the weapon's LAYOUT rather than of its calibre, which is
 * why a model declares it: a bullpup's well is behind the firing hand, so the
 * weapon has to be turned the other way to bring it into view; a pistol's is
 * the bottom of its grip; a belt-fed box hangs off the left flank and weighs
 * what three magazines do.
 */
export type ReloadStyleId = "rifle" | "bullpup" | "pistol" | "bolt" | "belt";

/**
 * What a reload that ran the weapon DRY has to do to its action once the fresh
 * magazine is home — the last beat of the gesture, and the one a tactical
 * reload (a round still chambered) skips. Every position is weapon-local and
 * is the model's, because where a catch or a handle is is geometry.
 *
 * - `catch`: the heel of the support hand strikes a bolt catch on the left
 *   flank and the carrier slams home. `hand` is where the hand's grip point is
 *   at contact and `strike` the travel that delivers it, so the hand stands off
 *   at `hand - strike` and is driven in along it.
 * - `handle`: a charging handle is hooked, yanked back along `pull` and let
 *   go. `hand` is the hand's grip point on the knob. `arm` says WHICH hand,
 *   because a handle on the right flank is the firing hand's.
 * - `bolt`: the firing hand works the weapon's own bolt (`WeaponParts.bolt`),
 *   open at the start of the reload and shut at the end of it.
 * - `slide`: the slide (`WeaponParts.slide`) is locked back from the last
 *   round and goes forward off the slide stop. `travel` is how far back it is
 *   held, in model units along -z.
 */
export type ReloadAction =
  | { kind: "catch"; hand: Vector3; strike: Vector3 }
  | { kind: "handle"; arm: "support" | "trigger"; hand: Vector3; pull: Vector3 }
  | { kind: "bolt" }
  | { kind: "slide"; travel: number };

/**
 * Which of those a weapon has, or `none` — what the SOUND of a reload needs to
 * know about the weapon, without the geometry it has no use for.
 */
export type ReloadActionKind = ReloadAction["kind"] | "none";

/** How a weapon is reloaded: the pose it is held in and the action it closes. */
export interface ReloadSpec {
  style: ReloadStyleId;
  /** Absent on a weapon whose dry reload does nothing to the action. */
  action?: ReloadAction;
}

/** Handles into a built weapon: the pose root plus alignment landmarks. */
export interface WeaponParts {
  /** The whole weapon, at identity. Enabled only while this one is carried. */
  root: TransformNode;
  /** Barrel tip, weapon-local — tracer and muzzle-flash origin. */
  muzzle: Vector3;
  /** Ejection port, weapon-local — where the brass leaves. */
  ejectPort: Vector3;
  /** The trigger hand, and the support hand on the handguard. */
  grip: GripSpec;
  support: GripSpec;
  /**
   * Where the support hand holds the magazine, as an offset from its rest on
   * the handguard, when the default is wrong for this weapon. The default is
   * MEASURED off the magazine — the heel of the palm under its floorplate,
   * `CONFIG.viewmodel.reload.basePalm` below it — which is how a box magazine
   * is driven home and is right wherever the well is: under a receiver,
   * behind a bullpup's grip or up inside a pistol's. A container that is not
   * held by its floor — a belt box, carried by its flank — says so here.
   */
  magHand?: Vector3;
  /**
   * The magazine, under a node of its own so a reload can pull it OUT — the
   * one part of a weapon that is not welded to the rest of it. Merged by a
   * second `merge` call, exactly as an optic is, and for the same reason:
   * anything that has to move independently cannot be inside the weapon's own
   * colour groups.
   *
   * The node sits at identity, so the merged geometry is where it was built
   * and `position`/`rotation` are pure offsets from seated. `ViewModel` is the
   * only thing that may write them, and it always leaves the magazine seated
   * when no reload is in flight.
   *
   * Optional because a weapon may have nothing to drop — every one in the kit
   * does today, the belt-fed one included, but a fixed-magazine weapon would
   * simply not set it and reload with the weapon pose alone.
   */
  magazine?: TransformNode;
  /**
   * The direction a dropped magazine leaves along, weapon-local and unit
   * length. Defaults to straight down, which is right for anything standing
   * vertically in its well; a raked magazine (and a pistol's, which is up
   * inside a raked grip) has to leave along its OWN axis or it shears through
   * the well it is sliding out of.
   */
  magDrop?: Vector3;
  /**
   * The loaded ROUND on a weapon that is loaded through the muzzle, under a
   * node of its own so the load gesture can take it out and put a fresh one
   * back — the launcher's warhead, and the second part of a weapon that is
   * not welded to the rest of it.
   *
   * It is the magazine's twin and deliberately not the magazine itself: a
   * magazine is pulled DOWN out of a well and thrown away, and this goes
   * BACK out of a bore and comes home along it, so the two share the split
   * (a `merge` call of their own, `ViewModel` the only writer, seated
   * whenever nothing is in flight) and nothing else. A weapon may have
   * either, and no weapon in the kit has both.
   *
   * Optional for the reason `magazine` is: a weapon that sets neither simply
   * has nothing that comes out, which is what the mine does.
   */
  warhead?: TransformNode;
  /**
   * The BOLT, on a weapon whose action is worked by hand — under a node of its
   * own so the cycle can lift it, draw it, push it home and turn it down.
   *
   * The third of these nodes and the only one that never leaves the weapon: a
   * magazine is thrown away and a warhead flies off, and this travels a
   * centimetre and comes back. So it is the one whose REST state is the only
   * state anything but `ViewModel` may see, and the one that is not exclusive
   * with the other two — a bolt gun has a magazine as well.
   *
   * **Its geometry must be built about the BORE**, because the cycle rotates
   * this node about its own z to lift the handle, and `ViewModel` zeroes its
   * transform to put the part home. So the node's ORIGIN must be on the bore:
   * a weapon whose bore is not on y = 0 builds the parts on the axis and hangs
   * this node from a fixed parent at the bore's height (`SniperModel`'s
   * `boltSeat`), since an offset written on the node itself would be wiped.
   * That is not a constraint the animation imposes on the model, it is
   * how a bolt actually is: the bolt is in line with the barrel, and a model
   * that puts the raceway somewhere else is wrong before it is animated.
   *
   * Optional for the reason the other two are, and today exactly one weapon
   * sets it. A weapon that declares `boltCycle` without one still plays the
   * gesture — the pose, the aim break and the two impulses are the weapon's
   * and not the part's — it simply has nothing visible sliding in it.
   */
  bolt?: TransformNode;
  /**
   * The SLIDE, on a weapon whose top half recoils as one piece — under a node
   * of its own so a reload that ran it dry can show it locked back and drop
   * it home. The fourth of these nodes, and the bolt's rule holds for it: it
   * never leaves the weapon, its rest is the only state anything but
   * `ViewModel` may see, and it sits at identity so `position.z` is a pure
   * offset from battery. Whatever is machined INTO the slide — a pistol's
   * notch and blade — hangs off it and travels with it, which is what a slide
   * is.
   */
  slide?: TransformNode;
  /**
   * How this weapon is reloaded. Absent is a rifle's: held in the `rifle`
   * pose, with nothing done to the action — which is right for nothing in the
   * kit today and is the safe default for a weapon that has not said.
   */
  reload?: ReloadSpec;
  /** A rail's worth of optics, or the one sight this weapon was born with. */
  sights: WeaponSights;
  /**
   * The weapon's own colour groups, magazine included and optics excluded —
   * what a FINISH repaints. `WeaponBuild.takeFinish` is where it comes from
   * and says which side of the seam each part falls.
   */
  finish: FinishPart[];
  /** Every visible mesh, every optic's included. */
  meshes: Mesh[];
}

/** What a weapon model builder is: geometry at the origin, landmarks out. */
export type WeaponBuilder = (
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
) => WeaponParts;

/**
 * The primitive helpers a weapon model is written in, bound to one scene,
 * material factory, name prefix and root.
 *
 * `collect` gathers into the CURRENT colour-group map, which `merge` swaps out
 * — the weapon is merged before any optic is built, so a sight's parts can
 * never end up inside the weapon's colour groups.
 */
export class WeaponBuild {
  private target = new Map<string, Part[]>();
  /**
   * The ROOT, as the build sees it: a `PartNode` at identity that every part
   * and pivot hangs from by default, standing where `root` stands while the
   * weapon is assembled — at identity, and unmoved until the builder has
   * returned (see the header). The parts were once hung from `root` itself;
   * a merge under this is the same arithmetic, and nothing built here
   * reaches the scene but the meshes `merge` and `lit` make.
   *
   * A builder passes it where it names the root as a PART's parent, and
   * passes `root` where it hangs a LIVE node (a magazine, a sight) from the
   * weapon.
   */
  readonly frame: PartNode;
  /** Merged colour groups since the last `takeFinish()` — see there. */
  private finish: FinishPart[] = [];
  /**
   * Colours outside `SECTIONS`, by hex, with the group name `merge` gives
   * them and whether they take the fittings' gloss — see `paint`.
   */
  private readonly paints = new Map<string, { name: string; glossy: boolean }>();

  constructor(
    readonly scene: Scene,
    private readonly mats: CelMaterialFactory,
    private readonly prefix: string,
    readonly root: TransformNode,
  ) {
    this.frame = new PartNode(root.name);
  }

  private collect(color: string, p: Part): Part {
    // The small metal parts are a weapon's only glossy surface — a hard moon
    // glint on the rails/fittings sells them as steel against the matte
    // receiver and polymer.
    p.material =
      color === METAL || this.paints.get(color)?.glossy
        ? this.mats.getGlossy(color, CONFIG.graphics.spec.rifle)
        : this.mats.get(color);
    const g = this.target.get(color);
    if (g) g.push(p);
    else this.target.set(color, [p]);
    return p;
  }

  /**
   * Names a colour outside `SECTIONS` so `merge` will merge it, and returns the
   * colour so a builder can hold it as a constant. What it is FOR is the
   * optics: each sight wears a housing colour of its own so the kit's glass
   * is not five tubes in the rifle's black, and those colours are no weapon's.
   *
   * A painted group is merged into one mesh per colour like any other, but it
   * is NOT a `FinishPart` — an optic is never repainted by a finish, and this
   * keeps that true by construction rather than by where `takeFinish` is
   * called. A colour already in `SECTIONS` is ignored here, so it can never be
   * merged twice.
   */
  paint(name: string, color: string, glossy = false): string {
    if (!SECTIONS.some(([, c]) => c === color)) this.paints.set(color, { name, glossy });
    return color;
  }

  /** `rotZ` cants a part in the xy plane; `pivot` is the rotX equivalent. */
  box(
    name: string,
    color: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    parent: PartNode = this.frame,
    rotZ = 0,
  ): Part {
    const p = new Part(`${this.prefix}_${name}`, createBox({ width: w, height: h, depth: d }));
    p.parent = parent;
    p.position.set(x, y, z);
    p.rotation.z = rotZ;
    return this.collect(color, p);
  }

  /** Cylinder laid along the barrel axis. */
  tube(
    name: string,
    color: string,
    dFront: number,
    dRear: number,
    len: number,
    x: number,
    y: number,
    z: number,
  ): Part {
    const p = new Part(
      `${this.prefix}_${name}`,
      createCylinder({ height: len, diameterTop: dFront, diameterBottom: dRear, tessellation: 10 }),
    );
    p.parent = this.frame;
    p.rotation.x = Math.PI / 2; // +y axis -> +z barrel axis
    p.position.set(x, y, z);
    return this.collect(color, p);
  }

  /** Cylinder across the weapon: pins, hinges, turrets, battery caps. */
  pin(
    name: string,
    color: string,
    dia: number,
    len: number,
    x: number,
    y: number,
    z: number,
    axis: "x" | "y" = "x",
  ): Part {
    const p = new Part(
      `${this.prefix}_${name}`,
      createCylinder({ height: len, diameter: dia, tessellation: 10 }),
    );
    p.parent = this.frame;
    if (axis === "x") p.rotation.z = Math.PI / 2; // +y axis -> +x
    p.position.set(x, y, z);
    return this.collect(color, p);
  }

  /**
   * A SLAB: a side profile (`[z, y]` points, either winding, concave allowed)
   * extruded `width` across the weapon about `x`, every long edge bevelled back
   * by `bevel` — `facet.extrude`, which carries the argument. This is the
   * primitive for anything whose character is its outline from the side: a
   * receiver, a stock, a trigger guard.
   */
  slab(
    name: string,
    color: string,
    profile: readonly ProfilePoint[],
    width: number,
    bevel: number,
    x = 0,
    parent: PartNode = this.frame,
  ): Part {
    const p = extrude(`${this.prefix}_${name}`, profile, width, bevel, x);
    p.parent = parent;
    return this.collect(color, p);
  }

  /**
   * A faceted LOFT standing up its parent's y — `facet.loft` — for the parts a
   * hand closes round: grips, foregrips, the magazine. Hung off a raking
   * `pivot`, its rings are in the pivot's frame, so a grip's swell and grooves
   * are authored straight and the rake is the pivot's job.
   */
  upright(
    name: string,
    color: string,
    rings: readonly Ring[],
    parent: PartNode = this.frame,
  ): Part {
    const p = loft(`${this.prefix}_${name}`, rings);
    p.parent = parent;
    return this.collect(color, p);
  }

  /**
   * A round shell around an axis parallel to the bore: `sides` slabs, each
   * turned to face its own facet. Used for optic housings and muzzle cages.
   *
   * Built from slabs rather than from a primitive because a hollow tube is the
   * one shape the primitives will not give you. A capped cylinder has no bore;
   * an uncapped one is a single-sided shell whose far wall vanishes when you
   * look through it, which is precisely the view an optic is for; and a torus
   * stretched along the axis would need a non-uniform scale, whose un-
   * normalised normals `renderOutline` then extrudes into a lopsided shell.
   * Facets are what the cel shader wants anyway — it flat-shades from
   * screen-space derivatives, so a smooth ring would read as a faceted one.
   *
   * Slabs are cut to meet at the OUTER radius, so they overlap inward and the
   * shell has no seams. `span` below 1 opens those joints into slots (the
   * muzzle cage); `a0` turns the whole ring, which is what puts a slot rather
   * than a strut at top dead centre.
   *
   * `x` comes last and defaults to the bore, because on every weapon here but
   * one a housing stands over the barrel. The launcher's optic is mounted off
   * the side of its tube — a sight is the one thing whose axis is the EYE's
   * rather than the weapon's, and that one is the only caller that passes it.
   */
  shell(
    name: string,
    color: string,
    bore: number,
    wall: number,
    len: number,
    y: number,
    z: number,
    sides = FACETS,
    a0 = 0,
    span = 1,
    x = 0,
  ): void {
    const rMid = bore / 2 + wall / 2;
    const w = 2 * (bore / 2 + wall) * Math.tan(Math.PI / sides) * span;
    for (let i = 0; i < sides; i++) {
      const a = a0 + (i / sides) * Math.PI * 2;
      // rotZ = -a puts the slab's own +y (its thickness axis) on the radius.
      this.box(
        `${name}${i}`,
        color,
        w,
        wall,
        len,
        x + Math.sin(a) * rMid,
        y + Math.cos(a) * rMid,
        z,
        this.frame,
        -a,
      );
    }
  }

  /**
   * A PICATINNY rail: a narrow spine with a run of separate dovetailed teeth
   * stood on it, and real slots between them that go down to the spine.
   *
   * A rail modelled as a bar with ribs laid over its top reads as SOLID —
   * the ribs are proud by a couple of millimetres and the bar is as wide as
   * they are, so the eye sees a plank with a pattern on it. What makes a rail
   * read as one is that you can see INTO the slots and under the flare: the
   * teeth are wider at the shoulder than at the neck, so each carries a shadow
   * line down both flanks, and each gap is a genuine step in depth that
   * `CelInk` draws as a silhouette.
   *
   * `(x, y, z0)` is the base of the rail and the centre of its first tooth;
   * the rail runs `count` teeth at `pitch` along +z, standing `height` off its
   * base toward `facing`, `width` across the flare. The spine is `BODY` and
   * the teeth `METAL`, so the rail stays a receiver-dark bar whose lands catch
   * the light — and so a finish repaints them as the fittings they are.
   */
  picatinny(
    name: string,
    x: number,
    y: number,
    z0: number,
    count: number,
    {
      width,
      height,
      pitch = 0.02,
      facing = "up",
    }: { width: number; height: number; pitch?: number; facing?: "up" | "down" | "left" | "right" },
  ): void {
    const rotZ = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[facing];
    const n = new PartNode(`${this.prefix}_${name}`);
    n.parent = this.frame;
    n.position.set(x, y, z0);
    n.rotation.z = rotZ;
    const len = (count - 1) * pitch;
    const tooth = pitch * 0.55;
    const neck = height * 0.4;
    // The spine: continuous under the whole run, as deep as the slots are cut.
    this.box(`${name}Spine`, BODY, width * 0.62, neck, len + tooth, 0, neck / 2, len / 2, n);
    for (let i = 0; i < count; i++) {
      const p = loft(`${this.prefix}_${name}Tooth`, [
        { y: neck * 0.8, w: width * 0.66, d: tooth, z: i * pitch },
        { y: height * 0.55, w: width, d: tooth, z: i * pitch },
        { y: height * 0.8, w: width, d: tooth, z: i * pitch },
        { y: height, w: width * 0.86, d: tooth, z: i * pitch },
      ]);
      p.parent = n;
      this.collect(METAL, p);
    }
  }

  /**
   * Raked sub-assembly (grip, magazine, foregrip) hung off its own pivot — a
   * build-time frame (`PartNode`) that goes with its parts once they are
   * merged, and is never a node in the scene.
   */
  pivot(
    name: string,
    x: number,
    y: number,
    z: number,
    rotX: number,
    parent: PartNode = this.frame,
  ): PartNode {
    const n = new PartNode(`${this.prefix}_${name}`);
    n.parent = parent;
    n.position.set(x, y, z);
    n.rotation.x = rotX;
    return n;
  }

  /**
   * Merges everything `collect` has gathered since the last call into one mesh
   * per colour, hangs the results off `parent`, and arms a fresh group for the
   * next caller. Run once for the weapon, once for its magazine and once per
   * optic — which is what keeps a loadout change from touching the weapon
   * underneath it, and what lets the magazine leave the weapon at all.
   *
   * Everything is still at identity under `frame` here, so the bake leaves the
   * geometry exactly where it was built. `parent` is the LIVE node a group
   * hangs from: the root the frame stands in for, or a node at identity
   * under it (the magazine, the round, the bolt, a sight).
   *
   * This is where a weapon's surface first reaches the scene: each group's
   * mesh is made here by `drawnMesh`, and nowhere else but `lit`.
   */
  merge(suffix: string, parent: TransformNode): Mesh[] {
    const groups = this.target;
    this.target = new Map();
    const out: Mesh[] = [];
    const painted = [...this.paints].map(([color, p]) => [p.name, color, false] as const);
    const all = [...SECTIONS.map(([name, color]) => [name, color, true] as const), ...painted];
    for (const [name, color, finished] of all) {
      const parts = groups.get(color);
      if (!parts || parts.length === 0) continue;
      // A colour group of ONE is the case MergeMeshes would not do: it handed
      // the mesh straight back with its transform intact, which the new
      // parent would then apply a second time. So it is baked by hand,
      // detached first because the bake resets the local matrix — Babylon's
      // `setParent(null)` and `bakeCurrentTransformIntoVertices`, step for
      // step (`detachPart`, `bakePartTransform`), which rounds differently
      // from a merge and is why this path is kept rather than handed to
      // `mergeParts`. Same rule, and same reason, as ViewModel's arms and
      // mergeByMaterial (world/merge.ts).
      let merged: Mesh;
      if (parts.length === 1) {
        detachPart(parts[0]);
        merged = drawnMesh(bakePartTransform(parts[0]), this.scene);
      } else {
        merged = drawnMesh(`${parts[0].name}_merged`, mergeParts(parts), this.scene);
        merged.material = parts[0].material;
      }
      merged.name = `${this.prefix}_${suffix}_${name}`;
      merged.parent = parent;
      merged.isPickable = false;
      if (finished) this.finish.push({ mesh: merged, group: name as FinishGroup });
      out.push(merged);
    }
    return out;
  }

  /**
   * Every colour group merged since the last call, and arms a fresh list —
   * what a builder hands back as `WeaponParts.finish`.
   *
   * Called after the magazine's merge and BEFORE the optics are built, which
   * is the same seam `merge` itself is cut along and for the same reason: an
   * optic is a separate piece of kit on a rail, so a finish that repainted it
   * would paint the player's holo sight to match a rifle it is not part of.
   * A builder that forgets to call it hands back an empty list and its weapon
   * simply never takes a finish — which is what the sidearm does on purpose,
   * having none to take.
   */
  takeFinish(): FinishPart[] {
    const out = this.finish;
    this.finish = [];
    return out;
  }

  /**
   * Dresses a reticle or a tritium bead: unlit, un-outlined, and deliberately
   * NOT run through `collect` — see the header. A `Part` is made a mesh here
   * (`drawnMesh`), so a bead is in the scene from the line that built it, as
   * it was when it was a `MeshBuilder` sphere; a merged reticle arrives as the
   * mesh `drawnMesh` already made of its bars.
   */
  lit(part: Mesh | Part, parent: TransformNode, colour: string = RETICLE): Mesh {
    const m = part instanceof Part ? drawnMesh(part, this.scene) : part;
    m.parent = parent;
    m.material = this.mats.getEmissive(colour);
    m.metadata = { noInk: true };
    m.isPickable = false;
    return m;
  }

}
