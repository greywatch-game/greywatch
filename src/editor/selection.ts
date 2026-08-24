/**
 * editor/selection.ts — What "the selected thing" means, and how clicking the
 * scene finds it.
 * Owns: SelectionRef, the pick, and the selection highlight.
 *
 * The pick uses a PREDICATE on `metadata.editorRef` rather than relying on
 * `isPickable`. That is the load-bearing detail of this file: Babylon skips
 * the isPickable test entirely when a predicate is supplied, so the editor can
 * click visual meshes without MapBuilder ever making them pickable. The
 * visual/collider split — the single most load-bearing rule in the world layer
 * — is untouched by the editor's existence.
 */
import {
  Color3,
  Mesh,
  type AbstractMesh,
  type Scene,
} from "@babylonjs/core";
import type { EditorRef } from "../world/MapBuilder";
import { EDITOR } from "./tuning";

/**
 * Which layout array, and where in it. `EditorRef` (what MapBuilder tags real
 * geometry with) is a subset: the rest come from proxy meshes.
 *
 * `floor` is the one member that is not a layout array at all — it is the map's
 * own ground, on the `EnvironmentSpec` rather than the `MapLayout`, and there
 * is exactly one of it (hence the unused index, which every ref carries so
 * `sameRef` needs no special case). It rides this union rather than getting an
 * inspector of its own because everything downstream of a selection — the
 * panel, the shape-diffed rebuild, the debounced save — is written against a
 * ref, and a second path through all of that to edit two fields would be the
 * expensive way to spell it. It is reached from the panel, never from a click:
 * the floor is under everything, and picking it would take every click meant
 * for what is standing on it.
 */
export type SelectionRef =
  | EditorRef
  | { list: "controlPoints"; index: number }
  | { list: "spawns"; index: number }
  | { list: "water"; index: number }
  | { list: "grass"; index: number }
  | { list: "floor"; index: number };

/** The floor is a singleton; this is the only ref that ever names it. */
export const FLOOR_REF: SelectionRef = { list: "floor", index: 0 };

export type SelectionList = SelectionRef["list"];

export function sameRef(a: SelectionRef | null, b: SelectionRef | null): boolean {
  if (!a || !b) return a === b;
  return a.list === b.list && a.index === b.index;
}

function refOf(mesh: AbstractMesh): SelectionRef | null {
  const ref = mesh.metadata?.editorRef as SelectionRef | undefined;
  return ref ?? null;
}

/**
 * What the pointer is over, or null. Picks against anything tagged, which is
 * every placement, scatter field, and proxy — and nothing else in the scene.
 */
export function pickRef(scene: Scene, x: number, y: number): SelectionRef | null {
  const hit = scene.pick(x, y, (m) => m.metadata?.editorRef !== undefined);
  return hit?.pickedMesh ? refOf(hit.pickedMesh) : null;
}

/**
 * Outlines the selected item's meshes using Babylon's edge renderer.
 *
 * Deliberately NOT the cel outline (`addOutline`): that is a back-face shell
 * whose width is managed globally by `updateOutlineScales`, so borrowing it
 * for selection would fight the renderer over every mesh it touches every
 * frame. Edges are a separate pass and cost nothing here.
 */
export class SelectionHighlight {
  private lit: Mesh[] = [];

  clear(): void {
    for (const m of this.lit) {
      if (!m.isDisposed()) m.disableEdgesRendering();
    }
    this.lit = [];
  }

  show(meshes: readonly Mesh[]): void {
    this.clear();
    const c = Color3.FromHexString(EDITOR.colors.selection);
    for (const m of meshes) {
      if (m.isDisposed()) continue;
      m.edgesWidth = 6;
      m.edgesColor = c.toColor4(1);
      m.enableEdgesRendering(0.999);
      this.lit.push(m);
    }
  }
}
