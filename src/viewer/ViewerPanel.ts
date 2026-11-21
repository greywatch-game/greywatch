/**
 * viewer/ViewerPanel.ts — The viewer's DOM panel: the camera readout, the plan
 * (`ViewerPlan`'s canvas), the overlay and work-light toggles, the validation
 * list, key help.
 * Owns: its own root element (`#viewer-panel`) and every node inside it. Owns
 * no viewer state — it is handed values and displays them, and hands the
 * toggles straight back.
 *
 * `editor/EditorPanel.ts` trimmed (`BABYLON_EXIT.md` X5.3b): no add menu, no
 * inspector, no terrain tools and no save status, because the viewer edits
 * nothing; what is left is the readout, the findings and the help, and the
 * plan in place of the editor's in-world overlay. The editor's pattern holds:
 * the tree is built once from a template, the nodes that change are cached,
 * and a frame writes only `textContent`.
 *
 * The root is appended to #hud, which is pointer-events: none so gameplay
 * clicks fall through to the canvas — so the panel MUST re-enable
 * pointer-events on itself or none of its controls will ever be clickable.
 * `viewer.css` does, as `panel.css` did for the editor's.
 *
 * A control hands the keyboard back as soon as it has been used (`blur`):
 * the viewer flies on WASD and toggles on N and L, and a select left focused
 * would eat the first and type-ahead on the second.
 */
import "./viewer.css";
import type { Finding } from "./validate";

/** What the panel's controls do. */
export interface PanelActions {
  onWorkLight: (on: boolean) => void;
  onNav: (on: boolean) => void;
  onMarks: (on: boolean) => void;
  /** A slot, or null for every slot in a cell. */
  onLayer: (layer: number | null) => void;
  /** A control point's id, or null for no route test. */
  onRoute: (id: string | null) => void;
  onFinding: (index: number) => void;
}

export class ViewerPanel {
  private root: HTMLDivElement;
  private posEl: HTMLElement;
  private speedEl: HTMLElement;
  private navEl: HTMLElement;
  private countsEl: HTMLElement;
  private findingsEl: HTMLElement;
  private workLight: HTMLInputElement;
  private nav: HTMLInputElement;
  private marks: HTMLInputElement;
  private layer: HTMLSelectElement;
  private route: HTMLSelectElement;
  private lastPos = "";
  private lastSpeed = "";

  constructor(
    plan: HTMLCanvasElement,
    opts: { maxSurfaces: number; flags: readonly string[] },
    private readonly actions: PanelActions,
  ) {
    this.root = document.createElement("div");
    this.root.id = "viewer-panel";
    this.root.innerHTML = `
      <h2>MAP VIEWER</h2>
      <div class="vw-row"><span class="vw-key">pos</span><span id="vw-pos">—</span></div>
      <div class="vw-row"><span class="vw-key">speed</span><span id="vw-speed">—</span></div>
      <div class="vw-row"><span class="vw-key">walkable</span><span id="vw-nav">—</span></div>
      <div class="vw-plan-box"></div>
      <div class="vw-controls">
        <label><input type="checkbox" id="vw-worklight"> work light</label>
        <label><input type="checkbox" id="vw-marks"> marks</label>
        <label><input type="checkbox" id="vw-navon"> nav</label>
      </div>
      <div class="vw-picks">
        <select id="vw-layer" title="which surface of a cell"></select>
        <select id="vw-route" title="amber: no route to this flag"></select>
      </div>
      <div id="vw-counts" class="vw-note">nav off</div>
      <div id="vw-findings" class="vw-findings"></div>
      <div class="vw-help">
        <div><b>RMB</b> hold to look</div>
        <div><b>WASD</b> fly &nbsp; <b>Q/E</b> down/up</div>
        <div><b>Shift</b> boost &nbsp; <b>Wheel</b> speed</div>
        <div><b>N</b> nav &nbsp; <b>L</b> work light</div>
        <div><b>Click</b> the plan or a finding to fly there</div>
        <div><b>F2</b> back to the round</div>
      </div>
    `;
    this.root.querySelector(".vw-plan-box")!.appendChild(plan);
    document.getElementById("hud")!.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.posEl = q("#vw-pos");
    this.speedEl = q("#vw-speed");
    this.navEl = q("#vw-nav");
    this.countsEl = q("#vw-counts");
    this.findingsEl = q("#vw-findings");
    this.workLight = q("#vw-worklight");
    this.nav = q("#vw-navon");
    this.marks = q("#vw-marks");
    this.layer = q("#vw-layer");
    this.route = q("#vw-route");

    this.layer.appendChild(option("all", "all layers"));
    for (let i = 0; i < opts.maxSurfaces; i++) {
      this.layer.appendChild(option(String(i), i === 0 ? "layer 1 (lowest)" : `layer ${i + 1}`));
    }
    this.route.appendChild(option("", "no route test"));
    for (const id of opts.flags) this.route.appendChild(option(id, `route to ${id}`));

    const used = (el: HTMLElement, fn: () => void) =>
      el.addEventListener("change", () => {
        fn();
        el.blur();
      });
    used(this.workLight, () => actions.onWorkLight(this.workLight.checked));
    used(this.nav, () => actions.onNav(this.nav.checked));
    used(this.marks, () => actions.onMarks(this.marks.checked));
    used(this.layer, () => actions.onLayer(this.layer.value === "all" ? null : Number(this.layer.value)));
    used(this.route, () => actions.onRoute(this.route.value || null));
  }

  /** The toggles as the session holds them, written back without firing them. */
  setState(s: { workLight: boolean; nav: boolean; marks: boolean; layer: number | null; route: string | null }): void {
    this.workLight.checked = s.workLight;
    this.nav.checked = s.nav;
    this.marks.checked = s.marks;
    this.layer.value = s.layer === null ? "all" : String(s.layer);
    this.route.value = s.route ?? "";
  }

  /** The bucket counts for the overlay as drawn, or `off`. */
  setCounts(text: string): void {
    this.countsEl.textContent = text;
  }

  /**
   * Walkable-surface count of the standing graph. A single number, but the
   * useful one, the editor's reason: a wall dropped across a gate or a deck
   * lifted out of step range shows up here as a sudden drop.
   */
  setWalkable(walkable: number): void {
    this.navEl.textContent = walkable.toLocaleString();
  }

  /**
   * The validation list. Each row is clickable and flies the camera to the
   * spot — a finding you cannot find is not much use.
   */
  setFindings(findings: readonly Finding[]): void {
    this.findingsEl.innerHTML = "";
    if (!findings.length) {
      this.findingsEl.innerHTML = `<div class="vw-ok">no problems found</div>`;
      return;
    }
    const errors = findings.filter((f) => f.severity === "error").length;
    const head = document.createElement("div");
    head.className = "vw-title";
    head.textContent = errors
      ? `${errors} error${errors > 1 ? "s" : ""}, ${findings.length} total`
      : `${findings.length} note${findings.length > 1 ? "s" : ""}`;
    this.findingsEl.appendChild(head);
    findings.forEach((f, i) => {
      const el = document.createElement("div");
      el.className = `vw-finding ${f.severity}`;
      el.textContent = f.text;
      el.title = f.at ? "click to fly there" : "";
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.actions.onFinding(i);
      });
      this.findingsEl.appendChild(el);
    });
  }

  /** Called every frame while the viewer is up; writes only what moved. */
  update(x: number, y: number, z: number, speed: number): void {
    const pos = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    if (pos !== this.lastPos) this.posEl.textContent = this.lastPos = pos;
    const sp = `${speed.toFixed(0)} m/s`;
    if (sp !== this.lastSpeed) this.speedEl.textContent = this.lastSpeed = sp;
  }

  dispose(): void {
    this.root.remove();
  }
}

function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}
