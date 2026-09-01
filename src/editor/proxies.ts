/**
 * editor/proxies.ts — Stand-in geometry for the layout entities that have no
 * geometry of their own: scatter regions, control points, spawns, water rects
 * and grass rects.
 * Owns: the proxy meshes and their materials, and their disposal.
 *
 * Invariants, all of which follow from these being editor furniture and not
 * part of the world:
 * - NEVER `metadata.solid`, never `checkCollisions`, and never a WorldBox.
 *   `MapBuilder.collider()` is the only thing allowed to make a collider, and
 *   a proxy that leaked into the nav grid would wall off the very region it
 *   was drawn to describe.
 * - Every proxy sets noInk + noGlow + noShadowCaster AND calls
 *   glow.addExcludedMesh by hand. Game's GlowLayer exclusion scan runs once at
 *   construction, so nothing created later is ever picked up by it — the same
 *   reason WaterSystem and GrassSystem exclude their own meshes.
 * - Proxies carry `metadata.editorRef` so the same pick predicate finds them
 *   as finds real placements.
 */
import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  type GlowLayer,
} from "@babylonjs/core";
import { isScatterRect, type ScatterSpec } from "../world/layout";
import type { GameMap } from "../world/MapBuilder";
import { waterY, type TerrainField } from "../world/TerrainField";
import type { SelectionRef } from "./selection";
import { EDITOR } from "./tuning";

/** Proxies are drawn flat on the ground; lift them clear of z-fighting. */
const LIFT = 0.06;

export class ProxyLayer {
  private meshes: Mesh[] = [];
  private materials: StandardMaterial[] = [];

  constructor(
    private scene: Scene,
    private glow: GlowLayer,
  ) {}

  /** Rebuilds every proxy from the map's layout-derived data. */
  build(map: GameMap): void {
    this.dispose();
    const c = EDITOR.colors;

    map.controlPoints.forEach((cp, i) => {
      const ref: SelectionRef = { list: "controlPoints", index: i };
      this.ring(cp.pos, cp.radius, c.controlPoint, ref);
      // A pole as well as a ring: a 14 m ring read from inside is just a line
      // on the floor, and the flag is the thing you fly to.
      this.pole(cp.pos, 9, c.controlPoint, ref);
    });

    map.spawns.forEach((s, i) => {
      const ref: SelectionRef = { list: "spawns", index: i };
      const hex = s.team === 1 ? c.spawnEnemy : c.spawnFriendly;
      this.arrow(s.pos, s.yaw, hex, ref);
      this.pole(s.pos, 3, hex, ref);
    });

    // Water and grass sit on the TERRAIN, not on absolute zero. A proxy drawn
    // at the raw layout y hangs over a dug basin and — being a translucent
    // sheet — flattens the whole thing into one colour, which reads exactly
    // like the ground having vanished.
    map.water.forEach((r, i) => {
      this.rect(r.x, waterY(r, map.terrain), r.z, r.width, r.depth, c.water, {
        list: "water",
        index: i,
      });
    });

    map.grass.forEach((r, i) => {
      const y = (r.y ?? 0) + map.terrain.heightAt(r.x, r.z);
      this.rect(r.x, y, r.z, r.width, r.depth, c.grass, {
        list: "grass",
        index: i,
      });
    });

  }

  /**
   * Scatter regions are drawn separately because they come from the layout,
   * not from the built map — `GameMap` keeps no record of them.
   */
  buildScatter(regions: readonly ScatterSpec[], terrain: TerrainField): void {
    regions.forEach((s, i) => {
      const at = new Vector3(s.x, (s.y ?? 0) + terrain.heightAt(s.x, s.z), s.z);
      const ref: SelectionRef = { list: "scatter", index: i };
      // A boundary either way, never a filled sheet: a scatter region is drawn
      // over the ground it dresses, and water and grass already own the
      // translucent-rectangle reading.
      if (isScatterRect(s)) {
        this.frame(at, s.width, s.depth, s.rotY ?? 0, EDITOR.colors.scatter, ref);
      } else {
        this.ring(at, s.radius, EDITOR.colors.scatter, ref);
      }
    });
  }

  /** Every proxy mesh standing in for one layout item. */
  meshesFor(ref: SelectionRef): Mesh[] {
    return this.meshes.filter((m) => {
      const r = m.metadata?.editorRef as SelectionRef | undefined;
      return r?.list === ref.list && r.index === ref.index;
    });
  }

  private material(hex: string, alpha: number): StandardMaterial {
    const m = new StandardMaterial(`ed-proxy-${hex}-${alpha}`, this.scene);
    m.emissiveColor = Color3.FromHexString(hex);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.alpha = alpha;
    // Proxies are annotation: they should never hide the thing they annotate.
    m.disableDepthWrite = true;
    this.materials.push(m);
    return m;
  }

  private adopt(mesh: Mesh, ref: SelectionRef, hex: string, alpha: number): void {
    mesh.material = this.material(hex, alpha);
    mesh.isPickable = true;
    mesh.checkCollisions = false;
    mesh.metadata = {
      editorRef: ref,
      noGlow: true,
      noShadowCaster: true,
    };
    this.glow.addExcludedMesh(mesh);
    this.meshes.push(mesh);
  }

  private ring(at: Vector3, radius: number, hex: string, ref: SelectionRef): void {
    const m = MeshBuilder.CreateTorus(
      "ed-ring",
      { diameter: radius * 2, thickness: 0.35, tessellation: 48 },
      this.scene,
    );
    m.position.set(at.x, at.y + LIFT, at.z);
    this.adopt(m, ref, hex, 0.85);
  }

  /**
   * The ring's rectangular twin: four bars along the edges of an oriented
   * rectangle. Four meshes rather than one merged frame because `meshesFor`
   * already gathers every proxy carrying a ref — a flag is a ring plus a pole —
   * and each bar is one box.
   */
  private frame(
    at: Vector3,
    width: number,
    depth: number,
    rotY: number,
    hex: string,
    ref: SelectionRef,
  ): void {
    const t = 0.35;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const bars: [number, number, number, number][] = [
      // [local x, local z, size along local x, size along local z]
      [0, depth / 2, width + t, t],
      [0, -depth / 2, width + t, t],
      [width / 2, 0, t, depth],
      [-width / 2, 0, t, depth],
    ];
    for (const [lx, lz, w, d] of bars) {
      const m = MeshBuilder.CreateBox("ed-frame", { width: w, height: t, depth: d }, this.scene);
      // The same left-handed convention as MapBuilder's rotateY, so a region
      // and its proxy turn the same way.
      m.position.set(at.x + lx * c + lz * s, at.y + LIFT, at.z - lx * s + lz * c);
      m.rotation.y = rotY;
      this.adopt(m, ref, hex, 0.85);
    }
  }

  private pole(at: Vector3, height: number, hex: string, ref: SelectionRef): void {
    const m = MeshBuilder.CreateCylinder(
      "ed-pole",
      { height, diameter: 0.25, tessellation: 6 },
      this.scene,
    );
    m.position.set(at.x, at.y + height / 2, at.z);
    this.adopt(m, ref, hex, 0.7);
  }

  private arrow(at: Vector3, yaw: number, hex: string, ref: SelectionRef): void {
    // A flat triangle on the ground pointing along the spawn's facing — the
    // yaw is half of what a spawn point means and is invisible otherwise.
    const m = MeshBuilder.CreateCylinder(
      "ed-arrow",
      { height: 0.05, diameterTop: 0, diameterBottom: 2.6, tessellation: 3 },
      this.scene,
    );
    m.position.set(at.x, at.y + LIFT, at.z);
    m.rotation.set(Math.PI / 2, 0, -yaw);
    this.adopt(m, ref, hex, 0.9);
  }

  private rect(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    hex: string,
    ref: SelectionRef,
  ): void {
    const m = MeshBuilder.CreateGround(
      "ed-rect",
      { width, height: depth },
      this.scene,
    );
    m.position.set(x, y + LIFT, z);
    this.adopt(m, ref, hex, 0.18);
  }


  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const m of this.materials) m.dispose();
    this.meshes = [];
    this.materials = [];
  }
}
