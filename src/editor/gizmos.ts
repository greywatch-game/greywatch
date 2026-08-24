/**
 * editor/gizmos.ts — Drag handles for moving and rotating the selection.
 * Owns: the utility layer, the position/rotation gizmos, and the anchor node
 * they are attached to.
 *
 * The gizmos attach to an anchor TransformNode this file owns, never to map
 * geometry. Map meshes are disposed and rebuilt underneath the editor whenever
 * a param changes, and a gizmo holding a disposed mesh is a crash waiting for
 * the next drag.
 *
 * The utility layer renders into its own virtual scene with post-processing
 * off, on `onAfterRenderCameraObservable` — after the frame is graded — so the
 * handles land crisp on top and cannot disturb the cel pipeline, the
 * GlowLayer, or HorrorPost. Its internal HemisphericLight lives in that scene
 * only, so the "adding a Babylon light does nothing to cel meshes" rule is not
 * violated in the one that matters.
 *
 * Snapping defaults to the layout's own hygiene rule — 0.5 m and quarter
 * turns — with Alt for free placement, because scatter and clutter are
 * supposed to sit at organic angles.
 */
import {
  PositionGizmo,
  RotationGizmo,
  TransformNode,
  UtilityLayerRenderer,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { EDITOR } from "./tuning";

export interface GizmoHandlers {
  /** Fired continuously during a drag, with snapped values. */
  onChange: (position: Vector3, rotY: number) => void;
  /** Fired once when a drag finishes. */
  onCommit: () => void;
}

export class EditorGizmos {
  private layer: UtilityLayerRenderer;
  private move: PositionGizmo;
  private rotate: RotationGizmo;
  private anchor: TransformNode;
  private free = false;
  private dragging = false;

  constructor(
    scene: Scene,
    private handlers: GizmoHandlers,
  ) {
    this.layer = new UtilityLayerRenderer(scene);
    this.anchor = new TransformNode("ed-anchor", scene);

    this.move = new PositionGizmo(this.layer);
    this.rotate = new RotationGizmo(this.layer);
    // Y only: layouts rotate about the vertical axis and nothing else. A
    // pitched or rolled building has no representation in Placement at all.
    this.rotate.xGizmo.isEnabled = false;
    this.rotate.zGizmo.isEnabled = false;

    this.applySnap();
    this.detach();

    for (const g of [this.move, this.rotate]) {
      g.onDragStartObservable.add(() => {
        this.dragging = true;
      });
      g.onDragEndObservable.add(() => {
        this.dragging = false;
        this.handlers.onCommit();
      });
    }
    // PositionGizmo/RotationGizmo write the attached node directly; this is
    // where the result is snapped and handed back.
    this.move.onDragObservable.add(() => this.emit());
    this.rotate.onDragObservable.add(() => this.emit());
  }

  /** True while a handle is being dragged — the camera stays out of the way. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Alt disables snapping for as long as it is held. */
  setFreeMode(free: boolean): void {
    if (free === this.free) return;
    this.free = free;
    this.applySnap();
  }


  private applySnap(): void {
    const s = EDITOR.snap;
    const pos = this.free ? 0 : s.position;
    const rot = this.free ? 0 : s.rotation;
    this.move.xGizmo.snapDistance = pos;
    this.move.yGizmo.snapDistance = pos;
    this.move.zGizmo.snapDistance = pos;
    this.rotate.yGizmo.snapDistance = rot;
  }

  private emit(): void {
    const p = this.anchor.position;
    this.handlers.onChange(p, this.anchor.rotation.y);
  }

  /** Points the handles at a placement. Pass null to hide them. */
  attachTo(position: Vector3 | null, rotY = 0): void {
    if (!position) {
      this.detach();
      return;
    }
    this.anchor.position.copyFrom(position);
    this.anchor.rotation.set(0, rotY, 0);
    this.move.attachedNode = this.anchor;
    this.rotate.attachedNode = this.anchor;
  }

  /** Hides the handles without destroying them. */
  private detach(): void {
    this.move.attachedNode = null;
    this.rotate.attachedNode = null;
  }

  /** Rotation is meaningless for a circular region or a rect; hide that ring. */
  setRotatable(on: boolean): void {
    this.rotate.yGizmo.isEnabled = on;
  }

  dispose(): void {
    this.move.dispose();
    this.rotate.dispose();
    this.anchor.dispose();
    this.layer.dispose();
  }
}
