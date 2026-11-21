/**
 * CullCheckPanel.ts — `?cullcheck`'s readings on the glass, for a phone with
 * no console to read them on (`render/CullCheck.ts`).
 * Owns: `#cullcheck` and the lines under it, one block a label, in the order
 * the labels first arrived.
 * Invariants: a DEVICE on `#hud` like `ProfileChip`, not a screen — no state,
 * covers nothing, takes no input (`pointer-events: none`); built only when
 * the flag is on, so a session without it has no element at all.
 * Never: decides anything; reads the cull — what it shows is pushed.
 */
import "./cullcheck.css";

export class CullCheckPanel {
  private readonly root: HTMLPreElement;
  private readonly blocks = new Map<string, readonly string[]>();

  constructor() {
    const hud = document.getElementById("hud")!;
    this.root = document.createElement("pre");
    this.root.id = "cullcheck";
    this.root.textContent = "cull check: waiting for the first reading";
    hud.appendChild(this.root);
  }

  /** `CullReport`: replaces `label`'s lines, and echoes them to the console. */
  readonly show = (label: string, lines: readonly string[]): void => {
    this.blocks.set(label, lines);
    this.root.textContent = [...this.blocks.values()].flat().join("\n");
    console.info(`[cullcheck] ${lines.join("\n")}`);
  };

  dispose(): void {
    this.root.remove();
  }
}
