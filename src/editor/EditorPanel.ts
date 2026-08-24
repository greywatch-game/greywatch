/**
 * editor/EditorPanel.ts — The editor's DOM overlay: title bar, live camera
 * readout, the add menu, the inspector, the validation list, key help.
 * Owns: its own root element and every node inside it. Owns no editor state —
 * it is handed values and displays them, and hands edits straight back.
 *
 * Follows the HUD/DeployScreen pattern: build the tree once from an innerHTML
 * template, cache the nodes that change, then only ever write textContent and
 * classList. Styling lives in index.html with the rest.
 *
 * The root is appended to #hud, which is pointer-events: none so gameplay
 * clicks fall through to the canvas — so the panel MUST re-enable
 * pointer-events on itself or none of its controls will ever be clickable.
 * #deploy does the same thing for the same reason.
 *
 * The inspector is rebuilt only when its SHAPE changes — a different selection,
 * or a kind change that swaps the param set. A rebuild on every value change
 * would destroy the input the user is typing into, and the inspector's values
 * also move under them during a gizmo drag. So a same-shape update writes
 * values into the existing controls instead, and skips the focused one so a
 * half-typed number is never overwritten.
 */
import "./panel.css";
import type { FieldSpec, FieldValue } from "./fields";

/** The subset of a validation finding the panel needs to render it. */
export interface PanelFinding {
  severity: "error" | "warning" | "info";
  text: string;
}

/** What the inspector does when a control is used. */
export interface InspectorActions {
  onChange: (key: string, value: FieldValue) => void;
  /** Absent when the selection cannot be deleted; then no button is drawn. */
  onDelete?: () => void;
}

/** One row of the add menu: a layout list and what may be added to it. */
export interface AddGroup {
  list: string;
  label: string;
  /** Builder kinds or scatter props; empty for lists with only one shape. */
  choices: string[];
}

export class EditorPanel {
  private root: HTMLDivElement;
  private posEl: HTMLElement;
  private speedEl: HTMLElement;
  private workLightEl: HTMLElement;
  private navEl: HTMLElement;
  private statusEl: HTMLElement;
  private terrainHelpEl: HTMLElement;
  private toolEl: HTMLElement;
  private toolHintEl: HTMLElement;
  private overlayEl: HTMLElement;
  private findingsEl: HTMLElement;
  private inspector: HTMLElement;
  private addList: HTMLSelectElement;
  private addChoice: HTMLSelectElement;
  private addButton: HTMLButtonElement;
  private floorButton: HTMLButtonElement;
  private groups: AddGroup[] = [];

  /** Controls of the inspector as currently drawn, by field key. */
  private controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  /**
   * The field keys currently drawn. A change forces a rebuild; the TITLE is
   * deliberately not part of it, because a flag's title is built from its `id`
   * and rebuilding on every keystroke would take the focus away mid-word.
   * It also means clicking between two cottages reuses the same controls.
   */
  private shape = "";
  private titleEl: HTMLElement | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "editor-panel";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <h2>MAP EDITOR</h2>
      <div class="ed-row"><span class="ed-key">pos</span><span id="ed-pos">—</span></div>
      <div class="ed-row"><span class="ed-key">speed</span><span id="ed-speed">—</span></div>
      <div class="ed-row"><span class="ed-key">work light</span><span id="ed-worklight">—</span></div>
      <div class="ed-row"><span class="ed-key">walkable</span><span id="ed-nav">—</span></div>
      <div class="ed-row"><span class="ed-key">nav overlay</span><span id="ed-overlay">off</span></div>
      <div class="ed-warn">editor build: ~10x the draw calls of play — never judge performance here</div>
      <div id="ed-status" class="ed-status idle">—</div>
      <div id="ed-add" class="ed-add">
        <div class="ed-title">add</div>
        <select id="ed-add-list"></select>
        <select id="ed-add-choice"></select>
        <button id="ed-add-go" type="button">add at view centre</button>
      </div>
      <div id="ed-map" class="ed-add">
        <div class="ed-title">map</div>
        <button id="ed-map-floor" type="button">floor &mdash; colour &amp; surface</button>
      </div>
      <div id="ed-inspector" class="ed-inspector"></div>
      <div id="ed-findings" class="ed-findings"></div>
      <div class="ed-help">
        <div><b>RMB</b> hold to look</div>
        <div><b>WASD</b> fly &nbsp; <b>Q/E</b> down/up</div>
        <div><b>Shift</b> boost &nbsp; <b>Wheel</b> speed</div>
        <div><b>LMB</b> select &nbsp; <b>Esc</b> deselect</div>
        <div><b>Alt</b> hold to place off-grid</div>
        <div><b>Del</b> delete selection &nbsp; <b>Ctrl+S</b> save</div>
        <div><b>N</b> nav overlay &nbsp; <b>L</b> work light</div>
        <div><b>T</b> terrain mode &nbsp; <b>[ ]</b> brush size</div>
        <div class="ed-terrain-help">
          <div><b>F</b> tool: <span id="ed-tool">sculpt</span></div>
          <div id="ed-tool-hint"><b>LMB drag</b> &uarr;&darr; raise / lower ground</div>
        </div>
        <div><b>F2</b> back to the game (discards unsaved)</div>
      </div>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    this.posEl = this.root.querySelector("#ed-pos")!;
    this.speedEl = this.root.querySelector("#ed-speed")!;
    this.workLightEl = this.root.querySelector("#ed-worklight")!;
    this.navEl = this.root.querySelector("#ed-nav")!;
    this.statusEl = this.root.querySelector("#ed-status")!;
    this.terrainHelpEl = this.root.querySelector(".ed-terrain-help")!;
    this.toolEl = this.root.querySelector("#ed-tool")!;
    this.toolHintEl = this.root.querySelector("#ed-tool-hint")!;
    this.setMode("object");
    this.overlayEl = this.root.querySelector("#ed-overlay")!;
    this.findingsEl = this.root.querySelector("#ed-findings")!;
    this.inspector = this.root.querySelector("#ed-inspector")!;
    this.addList = this.root.querySelector("#ed-add-list")!;
    this.addChoice = this.root.querySelector("#ed-add-choice")!;
    this.addButton = this.root.querySelector("#ed-add-go")!;
    this.floorButton = this.root.querySelector("#ed-map-floor")!;
  }

  /**
   * The map's own properties, which have nothing to click in the viewport.
   * A button rather than a pick: the floor is under everything, so making it
   * selectable would take every click meant for what stands on it — the same
   * competition terrain mode exists to settle.
   */
  setMapMenu(onFloor: () => void): void {
    this.floorButton.addEventListener("click", () => onFloor());
  }

  /**
   * Fills the add menu. `onAdd` receives the layout list and the chosen kind
   * (empty for lists whose entries have no kind, like a water rect).
   */
  setAddMenu(groups: AddGroup[], onAdd: (list: string, choice: string) => void): void {
    this.groups = groups;
    this.addList.innerHTML = "";
    for (const g of groups) {
      this.addList.appendChild(option(g.list, g.label));
    }
    this.addList.addEventListener("change", () => this.syncAddChoices());
    this.addButton.addEventListener("click", () => {
      onAdd(this.addList.value, this.addChoice.value);
    });
    this.syncAddChoices();
  }

  private syncAddChoices(): void {
    const group = this.groups.find((g) => g.list === this.addList.value);
    const choices = group?.choices ?? [];
    this.addChoice.innerHTML = "";
    for (const c of choices) this.addChoice.appendChild(option(c, c));
    this.addChoice.classList.toggle("hidden", choices.length === 0);
  }

  /**
   * Draws (or updates) the inspector. Rebuilt only when the field shape
   * changes; otherwise the existing controls are updated in place so typing
   * and dragging don't fight each other.
   */
  setInspector(title: string, fields: FieldSpec[], actions: InspectorActions | null): void {
    const shape = fields.map((f) => `${f.kind}:${f.key}`).join(",");
    if (shape === this.shape && this.titleEl) {
      this.titleEl.textContent = title;
      this.syncFields(fields);
      return;
    }
    this.shape = shape;
    this.controls.clear();
    this.titleEl = null;
    this.inspector.innerHTML = "";

    if (!fields.length) {
      this.inspector.classList.add("hidden");
      return;
    }
    this.inspector.classList.remove("hidden");

    const head = document.createElement("div");
    head.className = "ed-title ed-head";
    const label = document.createElement("span");
    label.textContent = title;
    head.appendChild(label);
    this.titleEl = label;
    if (actions?.onDelete) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ed-delete";
      del.textContent = "delete";
      del.addEventListener("click", () => actions.onDelete!());
      head.appendChild(del);
    }
    this.inspector.appendChild(head);

    for (const f of fields) {
      this.inspector.appendChild(this.buildField(f, actions));
    }
  }

  private buildField(f: FieldSpec, actions: InspectorActions | null): HTMLElement {
    const row = document.createElement("div");
    row.className = "ed-row ed-field";
    const key = document.createElement("span");
    key.className = "ed-key";
    key.textContent = f.label;
    row.appendChild(key);

    if (f.kind === "note") {
      const v = document.createElement("span");
      v.textContent = f.value;
      row.appendChild(v);
      return row;
    }

    const emit = (value: FieldValue): void => actions?.onChange(f.key, value);

    if (f.kind === "choice") {
      const sel = document.createElement("select");
      for (const o of f.options) sel.appendChild(option(o.value, o.label));
      sel.value = f.value;
      sel.addEventListener("change", () => emit(sel.value));
      row.appendChild(sel);
      this.controls.set(f.key, sel);
      return row;
    }

    const input = document.createElement("input");
    if (f.kind === "boolean") {
      input.type = "checkbox";
      input.checked = f.value;
      input.addEventListener("change", () => emit(input.checked));
    } else if (f.kind === "color") {
      input.type = "color";
      input.value = f.value;
      // `input`, not `change`: a colour picker reports every step of a drag,
      // and watching the ground change under the swatch is the entire point of
      // choosing it here rather than in the file. What it costs is a rebuild
      // per step, which is exactly what the caller's debounce is for.
      input.addEventListener("input", () => emit(input.value));
    } else if (f.kind === "number") {
      input.type = "number";
      input.step = String(f.step);
      input.min = String(f.min);
      input.max = String(f.max);
      input.value = f.value === null ? "" : String(f.value);
      if (f.def !== undefined) input.placeholder = String(f.def);
      input.addEventListener("input", () => {
        if (input.value.trim() === "") return emit(null);
        const n = Number(input.value);
        if (Number.isFinite(n)) emit(n);
      });
    } else {
      input.type = "text";
      input.value = f.value;
      input.addEventListener("input", () => emit(input.value));
    }
    row.appendChild(input);
    this.controls.set(f.key, input);
    return row;
  }

  /**
   * Pushes new values into controls that are already drawn. The focused
   * control is skipped: it holds what the user is typing, and a half-typed
   * "1" must not be rewritten as the "1" the layout stored.
   */
  private syncFields(fields: FieldSpec[]): void {
    for (const f of fields) {
      const el = this.controls.get(f.key);
      if (!el || el === document.activeElement) continue;
      if (f.kind === "boolean" && el instanceof HTMLInputElement) {
        el.checked = f.value;
      } else if (f.kind === "number" && el instanceof HTMLInputElement) {
        el.value = f.value === null ? "" : String(f.value);
      } else if (f.kind === "choice" || f.kind === "text" || f.kind === "color") {
        el.value = f.value;
      }
    }
  }

  setWorkLight(on: boolean): void {
    this.workLightEl.textContent = on ? "on" : "off — night grade";
  }

  /**
   * The validation list. Each row is clickable and flies the camera to the
   * spot — a finding you cannot find is not much use.
   */
  setFindings(findings: readonly PanelFinding[], onPick: (i: number) => void): void {
    this.findingsEl.innerHTML = "";
    if (!findings.length) {
      this.findingsEl.innerHTML = `<div class="ed-ok">no problems found</div>`;
      return;
    }
    const errors = findings.filter((f) => f.severity === "error").length;
    const head = document.createElement("div");
    head.className = "ed-title";
    head.textContent = errors
      ? `${errors} error${errors > 1 ? "s" : ""}, ${findings.length} total`
      : `${findings.length} note${findings.length > 1 ? "s" : ""}`;
    this.findingsEl.appendChild(head);

    findings.forEach((f, i) => {
      const el = document.createElement("div");
      el.className = `ed-finding ${f.severity}`;
      el.textContent = f.text;
      el.title = "click to fly there";
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        onPick(i);
      });
      this.findingsEl.appendChild(el);
    });
  }

  /** Nav overlay state and per-bucket instance counts. */
  setNavOverlay(
    on: boolean,
    counts: { walkable: number; island: number; unrouted: number },
  ): void {
    this.overlayEl.textContent = on
      ? `on — ${counts.island} cut off, ${counts.unrouted} unrouted`
      : "off";
  }

  /** Save/scan feedback. `tone` colours it; the text is shown verbatim. */
  /**
   * Terrain mode owns the pointer, so the panel says so plainly and shows the
   * one extra binding that only exists there. A mode you cannot see you are in
   * is a mode that makes every click feel broken.
   */
  setMode(mode: "object" | "terrain"): void {
    const on = mode === "terrain";
    this.root.classList.toggle("ed-mode-terrain", on);
    this.terrainHelpEl.style.display = on ? "" : "none";
  }

  /**
   * Which terrain tool the left button draws. Same reasoning as the mode
   * itself, one level down: sculpt and level both answer a left drag and do
   * entirely different things with it, so the armed one has to be legible.
   */
  setTerrainTool(tool: "sculpt" | "level"): void {
    const level = tool === "level";
    this.root.classList.toggle("ed-tool-level", level);
    this.toolEl.textContent = level ? "level" : "sculpt";
    this.toolHintEl.innerHTML = level
      ? "<b>LMB</b> click a height, drag to spread it"
      : "<b>LMB drag</b> &uarr;&darr; raise / lower ground";
  }

  setStatus(text: string, tone: "idle" | "busy" | "ok" | "error"): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `ed-status ${tone}`;
  }

  /**
   * Walkable-surface count after the last navigation rebuild. A single number,
   * but the useful one: a wall dropped across a gate or a deck lifted out of
   * step range shows up here as a sudden drop.
   */
  setNav(walkable: number): void {
    this.navEl.textContent = walkable.toLocaleString();
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle("hidden", !on);
  }

  /** Called every frame while the editor is open. */
  update(x: number, y: number, z: number, speed: number): void {
    this.posEl.textContent = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    this.speedEl.textContent = `${speed.toFixed(0)} m/s`;
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
