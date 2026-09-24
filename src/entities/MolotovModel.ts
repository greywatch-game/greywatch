/**
 * MolotovModel.ts — What a molotov looks like: a bottle, its neck, and the
 * lit rag stuffed in it.
 * Owns: the three meshes. Owns NO behaviour — nothing here flies, breaks or
 * burns; the fire it leaves is `GrenadeSystem`'s and is drawn in the world's
 * one fire material.
 * Invariants: DRESSING, never a collider — no `solid`, no `WorldBox`, not
 * pickable — on every side of the wire, for `GrenadeModel`'s reason. Built at
 * the origin with the bottle's middle there, so a tumble about the mesh's own
 * origin is a bottle turning end over end rather than swinging round its base.
 *
 * A file of its own for `GrenadeModel`'s reason, and there are THREE builders
 * of it rather than two: `GrenadeSystem`'s pool, `net/NetGrenades`' drawn
 * copies, and the viewmodel's fist. The first two have to be the same object on
 * screen, and the third has to read as that object before it is thrown — which
 * is what the RAG is for: a lit wick is the one detail that says "this will be
 * on fire" from across a street and from inside your own hand.
 */
import { Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";

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

/**
 * Builds one molotov, hidden. Every material comes out of the factory's cache,
 * so a pool of twenty costs three materials and not sixty.
 */
export function buildMolotov(
  scene: Scene,
  mats: CelMaterialFactory,
  name: string,
): MolotovMeshes {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { height: BODY_H, diameter: BODY_D, tessellation: 8 },
    scene,
  );
  mesh.material = mats.get(GLASS);
  mesh.isVisible = false;
  mesh.isPickable = false;

  const neck = MeshBuilder.CreateCylinder(
    `${name}Neck`,
    {
      height: NECK_H,
      diameterTop: NECK_D,
      diameterBottom: NECK_D * 1.6,
      tessellation: 6,
    },
    scene,
  );
  neck.parent = mesh;
  neck.position.y = (BODY_H + NECK_H) / 2;
  neck.material = mats.get(GLASS);
  neck.isPickable = false;
  neck.isVisible = false;

  // The rag: a collar of cloth round the mouth, which is what the wick is
  // tied off with and what stops the lit end reading as a bulb on a stalk.
  const cloth = MeshBuilder.CreateCylinder(
    `${name}Cloth`,
    { height: 0.045, diameter: NECK_D * 1.35, tessellation: 6 },
    scene,
  );
  cloth.parent = neck;
  cloth.position.y = NECK_H / 2;
  cloth.material = mats.get(CLOTH);
  cloth.isPickable = false;
  cloth.isVisible = false;

  const wick = MeshBuilder.CreateSphere(
    `${name}Wick`,
    { diameter: 0.05, segments: 4 },
    scene,
  );
  wick.parent = cloth;
  wick.position.y = 0.04;
  wick.scaling.y = 1.5;
  wick.material = mats.getEmissive(FLAME);
  // Proud of the cloth's ink shell for the pip's reason, and uninked itself:
  // a lit rag is a light, and a light with a contour is a sticker.
  wick.metadata = { noInk: true };
  wick.isPickable = false;
  wick.isVisible = false;

  return { mesh, wick };
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
