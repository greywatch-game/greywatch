/**
 * viewer/index.ts — The dev-only MAP VIEWER's entry point, and the only module
 * Game knows about (`BABYLON_EXIT.md` X5.3b, rows "X5.3, the viewer's key and
 * reach", "the viewer's overlays" and "environment tuning").
 * Owns: a viewer session's lifetime — the free-fly camera on the round's own
 * camera, the panel and its plan, the work light, the validation findings —
 * and putting back what it borrowed when it closes: the camera's pose and the
 * map's own environment.
 *
 * **It is a LID over a ROUND, not a build.** `F2` raises it over `playing`,
 * `dying` and `deploy` (`SCREENS.viewer`), so what is drawn is the round's own
 * frame — its GI, glazing, fires, grass, water, bodies and hulls — through the
 * round's own path, with nothing ported and no second one. The session reads
 * the standing map and changes nothing in it but the flow fields it sweeps on
 * the graph (`navPlan.fieldFor`), which decide nothing on the page. What the
 * lid owes the rest of the page — the HUD's chrome, the weapon, the audio, the
 * pointer lock, the camera tail — is `Game`'s (`toggleViewer`, `takeDown`).
 *
 * Game reaches this through ONE dynamic import behind an
 * `import.meta.env.DEV` gate, as the mixer is (`Game.toggleViewer`, the whole
 * method body). That is deliberate and load-bearing: a static import would keep
 * every viewer module in the production bundle even with the branch
 * eliminated. Nothing in src/viewer/ may be imported statically from anywhere
 * on the game's graph.
 *
 * Never: makes a mesh, a material, a draw or a pipeline (the overlays are a 2D
 * plan in the panel), writes the layout, or owns a camera.
 */
import type { FreeCamera } from "@babylonjs/core";
import type { InputManager } from "../core/InputManager";
import { Vector3, type Vector3Like } from "../math";
import type { EnvironmentSpec } from "../world/environment";
import type { MapLayout } from "../world/layout";
import type { GameMap } from "../world/MapBuilder";
import { marksOf, type PlanMarks } from "./marks";
import { cellsOf, classifyNav, fieldFor, type NavClasses } from "./navPlan";
import { VIEWER } from "./tuning";
import { validate, type Finding, type NavSnapshot } from "./validate";
import { ViewerCamera } from "./ViewerCamera";
import { ViewerPanel } from "./ViewerPanel";
import { ViewerPlan } from "./ViewerPlan";
import { workLightEnvironment } from "./workLight";

/** Everything the viewer borrows from Game. */
export interface ViewerDeps {
  canvas: HTMLCanvasElement;
  /** `CameraSystem`'s, which the post chain is bound to (see `ViewerCamera`). */
  camera: FreeCamera;
  input: InputManager;
  /** The ROUND's map, merged, as it stands. */
  map: GameMap;
  /** The layout that map was built from — for its scatter, its flags and spawns. */
  layout: MapLayout;
  /** The map's own environment: what the work light is derived from, and put back. */
  environment: EnvironmentSpec;
  /** Registered static fixtures, for the 16-slot light-cluster check. */
  fixtures: readonly { position: Vector3Like }[];
  /**
   * Pushes an environment into the scene. Game owns the scene and materials;
   * the viewer only ever asks for a spec to be applied.
   */
  applyEnvironment: (env: EnvironmentSpec) => void;
}

/**
 * A live viewing session. Game drives `update` each frame while its state is
 * "viewer" and calls `dispose` when the lid comes down, however it comes down.
 */
export class ViewerSession {
  private cam: ViewerCamera;
  private panel: ViewerPanel;
  private plan: ViewerPlan;
  private snap: NavSnapshot;
  private marks: PlanMarks;
  private classes: NavClasses | null = null;
  /**
   * The validation list against the standing map — read by a script as well
   * as drawn, which is how the viewer's findings were graded against the
   * map editor's (X5.3b's Verify).
   */
  readonly findings: Finding[];
  private workLight = true;
  private navOn = false;
  private marksOn = true;
  private layer: number | null = null;
  private route: string | null;
  /** The camera's pose as the lid found it, put back by `dispose`. */
  private readonly pose: readonly number[];
  private readonly detach: () => void;

  constructor(private deps: ViewerDeps) {
    const { camera, map, layout } = deps;
    const r = camera.rotation;
    const p = camera.position;
    this.pose = [p.x, p.y, p.z, r.x, r.y, r.z, camera.fov];
    this.cam = new ViewerCamera(camera, deps.canvas);
    // Opens where the eye already is, looking the way it looks — the player's
    // head, the death cam, a chase camera or the deploy screen's view — rather
    // than snapping anywhere. `setTarget` wrote yaw into `rotation.y` and the
    // pitch, negated, into `rotation.x`; the roll goes with the lid.
    this.cam.warpTo(p, r.y, -r.x);

    // The validation list's one check that wants flow fields (the flags from
    // each home spawn) reads the graph's own, which a round on the page builds
    // none of — so they are swept on the standing graph first.
    fieldFor(map.nav, layout, "home0");
    fieldFor(map.nav, layout, "home1");
    this.findings = validate(map, layout, deps.fixtures);
    this.snap = map.nav.debugSnapshot();
    this.marks = marksOf(map, layout.scatter);
    // Routing is checked against flag A until another is chosen, the editor's
    // default.
    this.route = layout.controlPoints[0]?.id ?? null;

    this.plan = new ViewerPlan(map, deps.environment);
    this.plan.onPick = (x, z) => this.flyTo(x, map.terrain.heightAt(x, z), z);
    this.panel = new ViewerPanel(
      this.plan.canvas,
      { maxSurfaces: this.snap.maxSurfaces, flags: layout.controlPoints.map((c) => c.id) },
      {
        onWorkLight: (on) => this.setWorkLight(on),
        onNav: (on) => this.setNav(on),
        onMarks: (on) => {
          this.marksOn = on;
          this.repaint();
        },
        onLayer: (layer) => {
          this.layer = layer;
          this.repaint();
        },
        onRoute: (id) => {
          this.route = id;
          this.classes = null;
          this.repaint();
        },
        onFinding: (i) => this.goTo(i),
      },
    );
    this.panel.setWalkable(map.nav.walkableCount);
    this.panel.setFindings(this.findings);
    this.applyLighting();
    this.repaint();

    const onKeyDown = (e: KeyboardEvent) => {
      // A focused control keeps its own keys; the panel hands focus back after
      // every change, so this is only ever a control mid-use.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "KeyN") this.setNav(!this.navOn);
      else if (e.code === "KeyL") this.setWorkLight(!this.workLight);
    };
    document.addEventListener("keydown", onKeyDown);
    this.detach = () => document.removeEventListener("keydown", onKeyDown);
  }

  private setWorkLight(on: boolean): void {
    this.workLight = on;
    this.applyLighting();
    this.syncPanel();
  }

  private setNav(on: boolean): void {
    this.navOn = on;
    this.repaint();
  }

  private applyLighting(): void {
    const env = this.deps.environment;
    this.deps.applyEnvironment(this.workLight ? workLightEnvironment(env) : env);
  }

  /**
   * The plan's layer over the map, re-derived. The nav buckets are classified
   * the first time they are asked for and again when the route changes — the
   * route's field swept then, on demand (`navPlan.fieldFor`) — and the layer
   * choice only re-reduces them.
   */
  private repaint(): void {
    let cells: Uint8Array | null = null;
    if (this.navOn) {
      if (!this.classes) {
        const field = this.route ? fieldFor(this.deps.map.nav, this.deps.layout, this.route) : null;
        this.classes = classifyNav(this.snap, field?.dist);
      }
      cells = cellsOf(this.snap, this.classes, this.layer);
      this.panel.setCounts(
        `${this.classes.island} cut off, ${this.classes.unrouted} unrouted` +
          (this.route ? ` (to ${this.route})` : ""),
      );
    } else {
      this.panel.setCounts("nav off");
    }
    this.plan.paintLayer(this.snap, cells, this.marksOn ? this.marks : null);
    this.syncPanel();
  }

  private syncPanel(): void {
    this.panel.setState({
      workLight: this.workLight,
      nav: this.navOn,
      marks: this.marksOn,
      layer: this.layer,
      route: this.route,
    });
  }

  /** Puts the camera over a spot, stood off so the spot is in frame. */
  private flyTo(x: number, y: number, z: number): void {
    const s = VIEWER.standOff;
    this.cam.warpTo(new Vector3(x, y + s.up, z - s.back), 0, s.pitch);
  }

  /** Flies the camera to a finding. */
  private goTo(index: number): void {
    const at = this.findings[index]?.at;
    if (at) this.flyTo(at.x, at.y, at.z);
  }

  /** The view direction, for Game's shadow focus. `src/math`'s, never Babylon's. */
  get forward(): Vector3 {
    return this.cam.forward;
  }

  update(dt: number): void {
    this.cam.update(dt, this.deps.input);
    const p = this.deps.camera.position;
    this.panel.update(p.x, p.y, p.z, this.cam.flySpeed);
    this.plan.draw(p.x, p.z, this.cam.heading);
  }

  /**
   * Takes the session down and puts back what it borrowed: the map's own
   * environment (the work light is uniforms and the clear colour, so the map's
   * spec applied again is the whole of undoing it) and the camera's pose as
   * the lid found it — position, the full rotation with its roll, and the field
   * of view — since the deploy screen under the lid writes no camera of its
   * own and would otherwise go on looking from wherever the viewer stopped.
   */
  dispose(): void {
    this.detach();
    this.cam.dispose();
    this.panel.dispose();
    this.deps.applyEnvironment(this.deps.environment);
    const [px, py, pz, rx, ry, rz, fov] = this.pose;
    const camera = this.deps.camera;
    camera.position.copyFromFloats(px, py, pz);
    camera.rotation.copyFromFloats(rx, ry, rz);
    camera.fov = fov;
  }
}

/** Constructed by Game's dynamic import; keeps the call site to one symbol. */
export function createViewer(deps: ViewerDeps): ViewerSession {
  return new ViewerSession(deps);
}
