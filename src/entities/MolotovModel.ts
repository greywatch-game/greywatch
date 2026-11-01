/**
 * MolotovModel.ts — What a molotov looks like: a bottle, its neck, and the
 * lit rag stuffed in it.
 * Owns: the bottle's four parts and both of their makers. Owns NO
 * behaviour — nothing here flies, breaks or burns; the fire it leaves is
 * `GrenadeSystem`'s, drawn by `GrenadeFx` in the world's one fire material.
 * Invariants: DRESSING, never a collider — no `solid`, no `WorldBox`, not
 * pickable — on every side of the wire, for `GrenadeModel`'s reason. Built at
 * the origin with the bottle's middle there, so a tumble about the mesh's own
 * origin is a bottle turning end over end rather than swinging round its base.
 * Each surface is a `Part` on a `src/geometry/` buffer, made a mesh by
 * `drawnMesh` for the world's bottle and a `ViewSegment` for the fist's
 * (`molotovSegments`, `BABYLON_EXIT.md` X4.3c: our renderer draws the
 * viewmodel, and Babylon is made no mesh of it).
 *
 * A file of its own for `GrenadeModel`'s reason, and there are THREE builders
 * of it rather than two: `GrenadeFx`'s pool, `net/NetGrenades`' drawn
 * copies, and the viewmodel's fist. The first two have to be the same object on
 * screen, and the third has to read as that object before it is thrown — which
 * is what the RAG is for: a lit wick is the one detail that says "this will be
 * on fire" from across a street and from inside your own hand.
 */
import { Mesh, Scene } from "@babylonjs/core";
import { createCylinder, createSphere } from "../geometry/primitives";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { drawnMesh, Part } from "../world/parts";
import { toSegment, type ViewSegment } from "./viewTree";

/** One bottle's meshes. The neck and the rag are parented to the body. */
export interface MolotovMeshes {
  mesh: Mesh;
  /** The lit rag — emissive, so it glows at night the way the pip does. */
  wick: Mesh;
}

/** Bottle glass: a dark green that still reads as glass once the ink is on it. */
const GLASS = "#3f5a32";
/** The rag wrapped round the neck, below the lit end. */
const CLOTH = "#b39a6c";
/** The lit end. Warm, and inside the glow on purpose. */
const FLAME = "#ffa23a";

/** Bottle dimensions, metres. The whole thing is about 0.3 m tall. */
const BODY_H = 0.19;
const BODY_D = 0.085;
const NECK_H = 0.075;
const NECK_D = 0.034;

/** One bottle's four parts, each standing where it hangs off the one before it. */
interface MolotovParts {
  body: Part;
  neck: Part;
  cloth: Part;
  wick: Part;
}

/**
 * The bottle's parts, painted and placed: the body at the origin, the neck on
 * it, the cloth round the neck's mouth, the wick in the cloth — each part's
 * transform stated in the one it hangs off, and no part parented, so the
 * caller makes its own tree of them. One statement of the bottle for both of
 * its makers (`buildMolotov`, `molotovSegments`). Every material comes out of
 * the factory's cache, asked in the order the meshes were.
 */
function molotovParts(mats: CelMaterialFactory, name: string): MolotovParts {
  const body = new Part(name, createCylinder({ height: BODY_H, diameter: BODY_D, tessellation: 8 }));
  body.material = mats.get(GLASS);

  const neck = new Part(
    `${name}Neck`,
    createCylinder({
      height: NECK_H,
      diameterTop: NECK_D,
      diameterBottom: NECK_D * 1.6,
      tessellation: 6,
    }),
  );
  neck.position.y = (BODY_H + NECK_H) / 2;
  neck.material = mats.get(GLASS);

  // The rag: a collar of cloth round the mouth, which is what the wick is
  // tied off with and what stops the lit end reading as a bulb on a stalk.
  const cloth = new Part(
    `${name}Cloth`,
    createCylinder({ height: 0.045, diameter: NECK_D * 1.35, tessellation: 6 }),
  );
  cloth.position.y = NECK_H / 2;
  cloth.material = mats.get(CLOTH);

  const wick = new Part(`${name}Wick`, createSphere({ diameter: 0.05, segments: 4 }));
  wick.position.y = 0.04;
  wick.scaling.y = 1.5;
  wick.material = mats.getEmissive(FLAME);
  // Proud of the cloth's ink shell for the pip's reason, and uninked itself:
  // a lit rag is a light, and a light with a contour is a sticker.
  wick.metadata = { noInk: true };
  return { body, neck, cloth, wick };
}

/**
 * Builds one molotov, hidden — the WORLD's bottle (`GrenadeFx`'s pool), four
 * Babylon meshes, the neck, the cloth and the wick each parented to the one
 * before it.
 */
export function buildMolotov(
  scene: Scene,
  mats: CelMaterialFactory,
  name: string,
): MolotovMeshes {
  const p = molotovParts(mats, name);
  const mesh = drawnMesh(p.body, scene);
  mesh.isVisible = false;
  mesh.isPickable = false;

  const neck = drawnMesh(p.neck, scene);
  neck.parent = mesh;
  neck.isPickable = false;
  neck.isVisible = false;

  const cloth = drawnMesh(p.cloth, scene);
  cloth.parent = neck;
  cloth.isPickable = false;
  cloth.isVisible = false;

  const wick = drawnMesh(p.wick, scene);
  wick.parent = cloth;
  wick.isPickable = false;
  wick.isVisible = false;

  return { mesh, wick };
}

/**
 * The same bottle as the viewmodel's fist holds it (`BABYLON_EXIT.md` X4.3c):
 * four SEGMENTS our renderer draws, no Babylon mesh made of any — the body,
 * with the neck, the cloth and the wick hung under it as part-tree children,
 * which `ViewTree.hang` makes a joint apiece, unparented, as it did the four
 * meshes. Hidden, as `buildMolotov`'s are.
 */
export function molotovSegments(mats: CelMaterialFactory, name: string): ViewSegment {
  const p = molotovParts(mats, name);
  const body = toSegment(p.body);
  const neck = toSegment(p.neck);
  const cloth = toSegment(p.cloth);
  const wick = toSegment(p.wick);
  neck.parent = body;
  cloth.parent = neck;
  wick.parent = cloth;
  for (const s of [body, neck, cloth, wick]) s.isVisible = false;
  return body;
}

/**
 * Shows or hides a whole bottle. The body, the neck, the cloth and the wick are
 * four meshes, and `isVisible` is not inherited — so a pooled bottle that only
 * hid its body would leave a burning rag hanging in the air.
 */
export function showMolotov(m: MolotovMeshes, on: boolean): void {
  m.mesh.isVisible = on;
  for (const child of m.mesh.getChildMeshes(false)) child.isVisible = on;
}
