/**
 * editor/index.ts — The map editor's entry point and the only module Game
 * knows about.
 * Owns: the editor session lifetime — what exists while the editor is open and
 * what is torn down when it closes.
 *
 * Game reaches this through a dynamic import behind an import.meta.env.DEV
 * gate. That is deliberate and load-bearing: a static import would keep every
 * editor module in the production bundle even with the branch eliminated.
 * Nothing in src/editor/ may be imported statically from src/core, src/world,
 * src/systems or src/entities.
 *
 * The editor borrows the running scene rather than building its own — same
 * materials, same lighting, same grade — so what you author is what you play.
 */
import type { FreeCamera, GlowLayer, Mesh, Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { InputManager } from "../core/InputManager";
import type { EnvironmentSpec } from "../world/environment";
import { CONFORMS_TO_TERRAIN } from "../world/BuildingKit";
import type { MapLayout } from "../world/layout";
import type { GameMap } from "../world/MapBuilder";
import { SOLID_ONLY } from "../world/solid";
import { EditorCamera } from "./EditorCamera";
import type { FieldValue } from "./fields";
import { EditorGizmos } from "./gizmos";
import { EditorPanel, type AddGroup } from "./EditorPanel";
import { inspect } from "./inspect";
import {
  addItem,
  applyTransform,
  deleteItem,
  isRotatable,
  originOf,
  quantize,
  rebuildNavigation,
  repositionScene,
  rotationOf,
  setField,
  setFloorField,
  tierFor,
  type Tier,
} from "./mutate";
import { NavOverlay } from "./navOverlay";
import { MAX_WALKABLE_GRADE, TerrainBrush } from "./terrainBrush";
import { BUILDER_KINDS, SCATTER_PROPS } from "./params";
import { ProxyLayer } from "./proxies";
import { LayoutSaver } from "./save";
import { EnvironmentSaver, floorEdits } from "./saveEnvironment";
import { EDITOR } from "./tuning";
import { validate, type Finding } from "./validate";
import {
  FLOOR_REF,
  pickRef,
  sameRef,
  SelectionHighlight,
  type SelectionList,
  type SelectionRef,
} from "./selection";
import { workLightEnvironment } from "./workLight";

/** What the add menu offers, and which layout list each entry lands in. */
const ADD_GROUPS: AddGroup[] = [
  { list: "placements", label: "structure", choices: [...BUILDER_KINDS] },
  { list: "scatter", label: "scatter field", choices: [...SCATTER_PROPS] },
  { list: "water", label: "water rect", choices: [] },
  { list: "grass", label: "grass rect", choices: [] },
  { list: "spawns", label: "spawn point", choices: [] },
  { list: "controlPoints", label: "control point", choices: [] },
];

/** True while the keyboard belongs to an inspector control, not the editor. */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

/** Everything the editor borrows from Game. */
export interface EditorDeps {
  canvas: HTMLCanvasElement;
  camera: FreeCamera;
  input: InputManager;
  scene: Scene;
  glow: GlowLayer;
  /** The map as currently built — an editor build, so it carries `editor`. */
  map: GameMap;
  /**
   * Disposes the current map and builds a fresh one from the (edited) layout,
   * re-pointing everything Game owns that caches it — shadow casters, water,
   * grass. Returns the new map.
   *
   * This is the editor's third rebuild tier and the expensive one (~570 ms
   * measured headless). It is the only correct answer to a param change, a new
   * entry or a deleted one: those change how many colliders an item emits,
   * which shifts every later index in `colliderBoxes` and invalidates the
   * per-item editor index wholesale.
   */
  rebuildMap: () => GameMap;
  /**
   * Which map this is, by `MapDef.id`. The editor is otherwise map-agnostic —
   * it works on whatever `layout` it is handed — but saving is not: the id
   * picks the source text to patch and the two files to write. It must be the
   * id of the map `layout` came from; `LayoutSaver` refuses if it is not.
   */
  mapId: string;
  /** The layout that map was built from. Edited in place by the editor. */
  layout: MapLayout;
  /** The map's own environment, so the work light can be derived from it. */
  environment: EnvironmentSpec;
  /** Registered static fixtures, for the 16-slot light-cluster check. */
  fixtures: readonly { position: Vector3 }[];
  /**
   * Pushes an environment into the scene. Game owns the scene and materials;
   * the editor only ever asks for a spec to be applied.
   */
  applyEnvironment: (env: EnvironmentSpec) => void;
  /**
   * Re-renders the shadow depth pass. It normally re-renders only when the
   * shadow window moves, which is right for a static map and wrong the moment
   * a caster is dragged.
   */
  invalidateShadows: () => void;
}

/**
 * A live editing session. Game drives `update` each frame while its state is
 * "editor" and calls `dispose` on the way out.
 */
export class EditorSession {
  private cam: EditorCamera;
  private panel: EditorPanel;
  private workLight = true;
  private proxies: ProxyLayer;
  private highlight = new SelectionHighlight();
  private gizmos: EditorGizmos;
  private selected: SelectionRef | null = null;
  private dirty = false;
  private saver: LayoutSaver;
  private envSaver: EnvironmentSaver;
  /**
   * Whether the map's environment has been edited. Tracked apart from `dirty`
   * because it is a second FILE: an untouched `environment.ts` should not be
   * rewritten by a save that only moved a fence.
   */
  private envDirty = false;
  private saving = false;
  private navOverlay: NavOverlay;
  private brush: TerrainBrush;
  /**
   * What the pointer is for. The ground is *under* everything, so a terrain
   * annotation and the water rect sitting on it compete for the same click and
   * whichever is on top wins. A mode settles it: in terrain mode only the
   * ground answers, in object mode terrain is not in the pick at all.
   */
  private mode: "object" | "terrain" = "object";
  private findings: Finding[] = [];
  private readonly detach: () => void;
  /**
   * The current map. Held here rather than read from `deps` because a param
   * change replaces it wholesale, and everything in this file that reaches for
   * geometry must see the map that is actually in the scene.
   */
  private map: GameMap;
  /** Coalesces the rebuild a run of typed characters would otherwise trigger. */
  private pending: Tier | null = null;
  private timer = 0;

  constructor(private deps: EditorDeps) {
    this.map = deps.map;
    this.cam = new EditorCamera(deps.camera, deps.canvas);
    this.panel = new EditorPanel();
    this.panel.setVisible(true);
    this.panel.setAddMenu(ADD_GROUPS, (list, choice) => this.onAdd(list, choice));
    this.panel.setMapMenu(() => this.select(FLOOR_REF));
    this.proxies = new ProxyLayer(deps.scene, deps.glow);
    this.proxies.build(this.map);
    this.proxies.buildScatter(deps.layout.scatter, this.map.terrain);
    this.gizmos = new EditorGizmos(deps.scene, {
      onChange: (at, rotY) => this.onDrag(at, rotY),
      onCommit: () => this.onDragEnd(),
    });
    // On by default: the first thing anyone opening the editor wants is to see
    // the map. Toggle it off to check how a placement actually reads at night.
    this.applyLighting();
    this.select(null);

    this.navOverlay = new NavOverlay(deps.scene, deps.glow);
    this.brush = new TerrainBrush(deps.scene, deps.glow, this.map);
    this.revalidate();
    this.saver = new LayoutSaver(deps.mapId, deps.layout);
    this.envSaver = new EnvironmentSaver(deps.mapId);
    const blocked = this.saver.blocked ?? this.envSaver.blocked;
    if (blocked) {
      this.panel.setStatus(`cannot save: ${blocked}`, "error");
    } else {
      this.panel.setStatus("ready", "idle");
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        // The browser's own save dialog is never what anyone wants here.
        e.preventDefault();
        void this.save();
        return;
      }
      // Every shortcut below is a bare letter, so an inspector control that
      // has focus must swallow them or typing a name into a flag would toggle
      // the nav overlay and the work light on the way past.
      if (isTyping(e)) {
        if (e.code === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        this.onDelete();
        return;
      }
      if (e.code === "KeyT") {
        this.setMode(this.mode === "terrain" ? "object" : "terrain");
      } else if (e.code === "BracketLeft" || e.code === "BracketRight") {
        if (this.mode !== "terrain") return;
        this.brush.resize(e.code === "BracketRight" ? 1 : -1);
        this.showBrushStatus();
      } else if (e.code === "KeyF") {
        if (this.mode !== "terrain") return;
        this.brush.setTool(this.brush.activeTool === "level" ? "sculpt" : "level");
        this.panel.setTerrainTool(this.brush.activeTool);
        this.showBrushStatus();
      } else if (e.code === "KeyL") {
        this.workLight = !this.workLight;
        this.applyLighting();
      } else if (e.code === "Escape") {
        if (this.mode === "terrain") this.setMode("object");
        else this.select(null);
      } else if (e.code === "KeyN") {
        // Building the overlay is the expensive half, so it is only built the
        // first time it is asked for, then kept in step with navigation.
        const on = !this.navOverlay.isVisible;
        if (on) this.navOverlay.build(this.map, this.fieldForOverlay());
        this.navOverlay.setVisible(on);
        this.panel.setNavOverlay(on, this.navOverlay.counts());
      }
    };
    // Left button only, and only when the camera is not being flown — the
    // right button owns look, so the two can never race for the same drag.
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || document.pointerLockElement) return;
      if ((e.target as HTMLElement)?.closest("#editor-panel")) return;
      if (this.mode === "terrain") {
        // Hover first: entering terrain mode and clicking without moving the
        // mouse would otherwise begin nothing, because the brush has never
        // been told where the pointer is.
        this.brush.hover(e.clientX, e.clientY);
        this.brush.begin(e.clientY);
        this.showBrushStatus();
        return;
      }
      // A click that started on a gizmo handle is a drag, not a reselect.
      if (this.gizmos.isDragging) return;
      this.select(pickRef(this.deps.scene, e.clientX, e.clientY));
    };
    // Terrain mode needs the pointer wherever it goes: hover to place the
    // brush, and drag to sculpt. Object mode wants none of it.
    const onPointerMove = (e: PointerEvent) => {
      if (this.mode !== "terrain" || document.pointerLockElement) return;
      if (this.brush.isDragging) this.brush.drag(e.clientX, e.clientY);
      else this.brush.hover(e.clientX, e.clientY);
      this.showBrushStatus();
    };
    const onPointerUp = () => {
      if (this.mode !== "terrain" || !this.brush.isDragging) return;
      // A stroke changes the floor's shape, so colliders, navigation and
      // everything whose y rides the ground are all stale. Debounced, so a run
      // of quick strokes coalesces into one rebuild.
      // `end` reports whether the ground actually moved, so a bare click in
      // terrain mode neither marks the map dirty nor buys a rebuild.
      if (!this.brush.end()) return;
      this.dirty = true;
      this.schedule("geometry");
    };
    document.addEventListener("keydown", onKeyDown);
    this.deps.canvas.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    this.detach = () => {
      document.removeEventListener("keydown", onKeyDown);
      this.deps.canvas.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }

  /**
   * Switches what the pointer does. Leaving terrain mode drops the brush;
   * entering it drops the selection, so the gizmo handles are never left
   * hanging over ground that is about to move under them.
   */
  private setMode(mode: "object" | "terrain"): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "terrain") this.select(null);
    // Pointer-up is gated on terrain mode, so a stroke still running when the
    // mode changes would never be ended. Roll it back rather than leave it.
    else this.brush.cancel();
    this.brush.setVisible(mode === "terrain");
    this.panel.setMode(mode);
    this.panel.setTerrainTool(this.brush.activeTool);
    if (mode === "terrain") this.showBrushStatus();
    else this.panel.setStatus(this.dirty ? "unsaved edits" : "ready", "idle");
  }

  /**
   * The brush readout. The gradient is the number that matters: past
   * MAX_WALKABLE_GRADE the nav graph stops linking across the slope, and that
   * is invisible in the viewport until you notice bots refusing to go there.
   */
  private showBrushStatus(): void {
    if (this.mode !== "terrain") return;
    const grade = this.brush.gradeUnderBrush();
    const h = this.brush.heightUnderBrush();
    // Mid-level-stroke the sampled height is the whole state of the tool, and
    // nothing else on screen says what it is.
    const target = this.brush.levelTarget;
    const tool = this.brush.activeTool === "level" ? "level" : "sculpt";
    const at = target === null ? `${h.toFixed(2)} m` : `${h.toFixed(2)} → ${target.toFixed(2)} m`;
    const text =
      `terrain · ${tool} · brush ${this.brush.size} · ${at} · ` +
      `slope ${grade.toFixed(2)}/${MAX_WALKABLE_GRADE.toFixed(2)}`;
    this.panel.setStatus(text, grade > MAX_WALKABLE_GRADE ? "error" : "idle");
  }

  /** The current selection, or null. */
  get selection(): SelectionRef | null {
    return this.selected;
  }

  private select(ref: SelectionRef | null): void {
    if (sameRef(ref, this.selected)) return;
    this.selected = ref;
    this.highlight.show(this.meshesFor(ref));
    this.refreshInspector();
    if (ref) {
      this.gizmos.setRotatable(isRotatable(this.deps.layout, ref));
      this.gizmos.attachTo(
        originOf(this.deps.layout, ref, this.map.terrain),
        rotationOf(this.deps.layout, ref),
      );
    } else {
      this.gizmos.attachTo(null);
    }
  }

  private refreshInspector(): void {
    const view = inspect(this.deps.layout, this.deps.environment, this.selected);
    // Controls are live whenever there are any; only the delete BUTTON is
    // conditional. The two used to travel together, which was fine while every
    // selection was a layout entry — the map's own floor is editable and is
    // not something a map can be without.
    this.panel.setInspector(
      view.title,
      view.fields,
      view.fields.length
        ? {
            onChange: (key, value) => this.onField(key, value),
            onDelete: view.deletable ? () => this.onDelete() : undefined,
          }
        : null,
    );
  }

  /**
   * One inspector control was used. The layout is written immediately — it is
   * the source of truth and the inspector must never show something the data
   * does not say — and the rebuild it implies is deferred, so holding an arrow
   * key on a spinner does not queue thirty map builds.
   */
  private onField(key: string, value: FieldValue): void {
    const ref = this.selected;
    if (!ref) return;
    // The floor is the map's environment, not one of the layout's arrays, so
    // it takes its own write — and reports whether anything moved, because a
    // colour picker fires on every step of a drag and each step would
    // otherwise buy the ~570 ms rebuild.
    if (ref.list === "floor") {
      if (!setFloorField(this.deps.environment, key, value)) return;
      this.envDirty = true;
      this.dirty = true;
      this.refreshInspector();
      this.schedule(tierFor(ref.list));
      return;
    }
    setField(this.deps.layout, ref, key, value);
    this.dirty = true;
    this.refreshInspector();
    // Typing a coordinate has to move the handles too, or the next drag snaps
    // the item back to where the gizmo still thinks it is. Which handles there
    // are can change with the value as well — a scatter region gains a rotation
    // ring the moment it becomes a rectangle.
    this.gizmos.setRotatable(isRotatable(this.deps.layout, ref));
    this.gizmos.attachTo(
      originOf(this.deps.layout, ref, this.map.terrain),
      rotationOf(this.deps.layout, ref),
    );
    this.schedule(tierFor(ref.list));
  }

  /** Appends a new entry at the view centre and selects it. */
  private onAdd(list: string, choice: string): void {
    const at = this.placementPoint();
    const ref = addItem(
      this.deps.layout,
      list as SelectionList,
      choice,
      at,
      this.map.terrain,
    );
    if (!ref) {
      this.panel.setStatus(`cannot add to ${list}`, "error");
      return;
    }
    this.dirty = true;
    this.panel.setStatus(`added ${choice || list} at the view centre`, "ok");
    this.applyStructural(ref.list, ref);
  }

  /** Deletes the selection. Indices shift, so the selection is dropped. */
  private onDelete(): void {
    const ref = this.selected;
    if (!ref) return;
    const what =
      inspect(this.deps.layout, this.deps.environment, ref).title || ref.list;
    if (!deleteItem(this.deps.layout, ref)) return;
    this.dirty = true;
    this.panel.setStatus(`deleted ${what}`, "ok");
    this.applyStructural(ref.list, null);
  }

  /**
   * Where a newly added item goes: whatever the view centre is pointing at.
   *
   * Picks against colliders rather than visuals, so a new building lands on
   * the terrace top or the road in front of you rather than on the roof shell
   * between you and it. With nothing under the crosshair it falls back to the
   * ground plane, and to a fixed distance ahead when the view is level or up.
   *
   * The height then comes from the NAV GRID rather than from the pick. Look at
   * the side of a barn and the pick lands halfway up a wall; a placement's `y`
   * is its base, so writing that would put the new item in mid-air and demand
   * a correction before anything else could be judged. Asking the grid what
   * can stand at that spot gives the same answer a bot would.
   */
  private placementPoint(): Vector3 {
    const { scene, canvas, camera } = this.deps;
    const hit = scene.pick(
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
      SOLID_ONLY,
    );

    let at: Vector3;
    if (hit?.hit && hit.pickedPoint) {
      at = hit.pickedPoint.clone();
    } else {
      const dir = this.cam.forward;
      const ground = dir.y < -0.05 ? -camera.position.y / dir.y : Infinity;
      at = camera.position.add(dir.scale(Math.min(Math.max(ground, 4), 120)));
      at.y = Math.max(0, at.y);
    }

    const surface = this.map.nav.surfaceAt(at.x, at.y, at.z);
    if (surface >= 0) at.y = this.map.nav.heightOf(surface);
    return at;
  }

  /**
   * An entry was added or removed: the rebuild happens now rather than on the
   * debounce, because a structural change is a single deliberate action and
   * leaving the scene disagreeing with the layout even briefly is confusing.
   */
  private applyStructural(list: SelectionList, select: SelectionRef | null): void {
    window.clearTimeout(this.timer);
    this.pending = null;
    if (tierFor(list) === "geometry") this.rebuildGeometry(select);
    else this.rebuildRouting(select);
  }

  /** Coalesces rebuilds; the heavier tier wins when both are asked for. */
  private schedule(tier: Tier): void {
    this.pending = this.pending === "geometry" ? "geometry" : tier;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const due = this.pending;
      this.pending = null;
      if (due === "geometry") this.rebuildGeometry(this.selected);
      else if (due === "navigation") this.rebuildRouting(this.selected);
    }, EDITOR.rebuildDelay);
  }

  /**
   * Tier 3: the whole map. Everything the editor holds that points at geometry
   * is invalidated by this — the per-item index, the collider boxes, the
   * highlight — so all of it is re-derived rather than patched.
   */
  private rebuildGeometry(select: SelectionRef | null): void {
    this.gizmos.attachTo(null);
    this.highlight.clear();
    this.selected = null;
    this.map = this.deps.rebuildMap();
    this.brush.setMap(this.map);
    this.rebuildProxies();
    this.deps.invalidateShadows();
    this.select(select);
    this.afterNavigationChanged();
  }

  /**
   * Tier 2: flags and spawns produce no geometry, so only the flow fields and
   * the proxies standing in for them need redoing.
   */
  private rebuildRouting(select: SelectionRef | null): void {
    const fresh = rebuildNavigation(this.map, this.deps.layout);
    this.map.nav = fresh.nav;
    this.map.obstacles = fresh.obstacles;
    this.selected = null;
    this.rebuildProxies();
    this.select(select);
    this.afterNavigationChanged();
  }

  /** Re-runs the checks and the overlay against the navigation just built. */
  private afterNavigationChanged(): void {
    this.revalidate();
    if (this.navOverlay.isVisible) {
      this.navOverlay.build(this.map, this.fieldForOverlay());
      this.navOverlay.setVisible(true);
      this.panel.setNavOverlay(true, this.navOverlay.counts());
    }
  }

  /**
   * Every frame of a drag: the layout is written and the geometry follows it.
   * Navigation is deliberately left stale until the drag ends.
   */
  private onDrag(raw: Vector3, rawRotY: number): void {
    const ref = this.selected;
    if (!ref) return;
    // Quantise once, then use the same numbers for the data and the geometry.
    const { at, rotY } = quantize(raw, rawRotY);
    applyTransform(this.deps.layout, ref, at, rotY, this.map.terrain);
    repositionScene(this.map, this.deps.layout, ref, at, rotY);
    if (ref.list !== "placements" && ref.list !== "scatter") {
      // Proxies carry their own geometry; rebuild the cheap layer wholesale
      // rather than tracking which mesh stands for which field.
      this.rebuildProxies();
    }
    this.deps.invalidateShadows();
    this.refreshInspector();
    this.dirty = true;
  }

  /** Drag finished: bring navigation back into agreement with the geometry. */
  private onDragEnd(): void {
    // A road's vertices were cut against the ground it started on, so a move
    // leaves it contoured to the wrong patch of floor — the one thing a
    // translate cannot fix. Rebuilding covers navigation too, so it replaces
    // the cheaper path rather than adding to it.
    if (this.draggedConformingKind()) {
      this.rebuildGeometry(this.selected);
      return;
    }
    const fresh = rebuildNavigation(this.map, this.deps.layout);
    this.map.nav = fresh.nav;
    this.map.obstacles = fresh.obstacles;
    this.afterNavigationChanged();
  }

  /** Whether the thing just dragged is one whose shape follows the floor. */
  private draggedConformingKind(): boolean {
    const ref = this.selected;
    if (!ref || ref.list !== "placements") return false;
    const p = this.deps.layout.placements[ref.index];
    return p !== undefined && CONFORMS_TO_TERRAIN.has(p.kind);
  }

  /**
   * Re-runs the checks and pushes them to the panel. Cheap next to the
   * navigation rebuild that precedes it, so it just runs every time.
   */
  private revalidate(): void {
    const { layout, fixtures } = this.deps;
    this.findings = validate(this.map, layout, fixtures);
    this.panel.setNav(this.map.nav.walkableCount);
    this.panel.setFindings(this.findings, (i) => this.goTo(i));
  }

  /** Routing is checked against whichever flag is selected, else flag A. */
  private fieldForOverlay(): string | null {
    const ref = this.selected;
    if (ref?.list === "controlPoints") {
      return this.deps.layout.controlPoints[ref.index]?.id ?? null;
    }
    return this.deps.layout.controlPoints[0]?.id ?? null;
  }

  /** Flies the camera to a finding and selects whatever it points at. */
  private goTo(index: number): void {
    const f = this.findings[index];
    if (!f) return;
    if (f.at) {
      // Stand off along -Z and above, so the spot is in frame rather than
      // inside the camera.
      this.cam.warpTo(
        new Vector3(f.at.x, f.at.y + 18, f.at.z - 22),
        0,
        -0.6,
      );
    }
    if (f.ref) this.select(f.ref);
  }

  private rebuildProxies(): void {
    this.proxies.dispose();
    this.proxies.build(this.map);
    this.proxies.buildScatter(this.deps.layout.scatter, this.map.terrain);
    // The highlight held meshes that have just been disposed.
    this.highlight.show(this.meshesFor(this.selected));
  }

  /** True when there are edits that have not been written to layout.ts. */
  get hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  /**
   * Writes the map back through the dev server: `layout.ts` (and `heights.ts`
   * with it), then `environment.ts` if the map's own palette was touched.
   * Entries nobody edited come back byte-identical, so the diff is only what
   * was actually changed.
   *
   * The environment goes LAST and only when dirty, for the same reason the
   * heights go after the layout: a file that nobody asked to change should not
   * be rewritten, and a failure must not land in the middle.
   */
  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.panel.setStatus("saving…", "busy");
    let result = await this.saver.save(this.deps.layout);
    if (result.ok && this.envDirty) {
      const env = await this.envSaver.save(floorEdits(this.deps.environment));
      if (env.ok) this.envDirty = false;
      result = env.ok
        ? { ok: true, message: `${result.message} + environment.ts` }
        : { ok: false, message: `layout saved, environment failed: ${env.message}` };
    }
    this.saving = false;
    if (result.ok) this.dirty = false;
    this.panel.setStatus(result.message, result.ok ? "ok" : "error");
  }

  /**
   * The geometry belonging to a selection. Placements and scatter come from
   * the build's own index; everything else has proxy meshes instead, which the
   * proxy layer finds by the same ref.
   */
  private meshesFor(ref: SelectionRef | null): Mesh[] {
    if (!ref) return [];
    const index = this.map.editor;
    if (index && (ref.list === "placements" || ref.list === "scatter")) {
      return index[ref.list][ref.index]?.visuals ?? [];
    }
    return this.proxies.meshesFor(ref);
  }

  private applyLighting(): void {
    const env = this.deps.environment;
    this.deps.applyEnvironment(this.workLight ? workLightEnvironment(env) : env);
    this.panel.setWorkLight(this.workLight);
  }

  /**
   * Opens looking at `from` — normally the player's last position — rather
   * than snapping to the map origin, so entering the editor keeps your place.
   */
  warpTo(from: Vector3, yaw: number, pitch: number): void {
    this.cam.warpTo(from, yaw, pitch);
  }

  /** The view direction, for Game's shadow focus. */
  get forward(): Vector3 {
    return this.cam.forward;
  }

  update(dt: number): void {
    // Alt is read per frame rather than latched on keydown: a keyup that
    // lands while the window is unfocused would otherwise leave snapping off.
    this.gizmos.setFreeMode(this.deps.input.altHeld);
    this.cam.update(dt, this.deps.input);
    const p = this.deps.camera.position;
    this.panel.update(p.x, p.y, p.z, this.cam.flySpeed);
  }

  dispose(): void {
    // A rebuild fired after Game has torn the session down would build a map
    // nothing is holding and leave it in the scene.
    window.clearTimeout(this.timer);
    this.pending = null;
    this.detach();
    this.navOverlay.dispose();
    this.brush.dispose();
    this.gizmos.dispose();
    this.highlight.clear();
    this.proxies.dispose();
    this.cam.dispose();
    this.panel.dispose();
    // Leaving restarts the round, which re-applies the map's own environment —
    // but restore it here too so the scene is never left work-lit if that
    // changes.
    this.deps.applyEnvironment(this.deps.environment);
  }
}

/** Constructed by Game's dynamic import; keeps the call site to one symbol. */
export function createEditor(deps: EditorDeps): EditorSession {
  return new EditorSession(deps);
}
