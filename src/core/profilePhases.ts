/**
 * profilePhases.ts — the frame profiler's phase list and the tree it nests in.
 * Owns: `PHASES`, the slot ids derived from it (`P`, `SLOTS`), `PARENT_OF`
 * and `ROOTS`. Nothing else: no ring, no clock, no report.
 *
 * Invariants:
 *  - **It is the vocabulary BOTH halves of the profiler are written in**, which
 *    is why it is a module of its own rather than the top of either: the
 *    recorder (`FrameProfile.ts`) indexes its ring by these slots and calls the
 *    reporter (`profileReport.ts`) at capture, and the reporter labels the
 *    slots and ships the tree. Kept in either file, the other would import it
 *    back and the two would be a cycle.
 *  - **The list is stated once and everything is derived from it** — the slot
 *    ids, the slot count, the roots. A phase added here owes a parent in
 *    `PARENT_OF` (it does not compile otherwise) and a `begin`/`end` pair in
 *    `Game`; the ring, the report and the trace follow by themselves.
 *  - It imports nothing, so it can never be the reason a disarmed profiler
 *    loads something.
 */

/**
 * The phases, in the order a frame runs them. **An index into this list IS a
 * phase's slot id**, which is what keeps the recording loop free of strings.
 *
 * They NEST and they do not partition: `frame` contains `gameplay` contains
 * `world` contains `bots`, and what is left over inside each is the lines
 * nobody thought worth naming. Read a report as an attribution, exactly as
 * `buildProfile`'s header says to read the build's.
 *
 * Adding one is a name here and a `begin`/`end` pair in `Game`. Nothing else
 * moves — the ring, the report and the trace are all sized and labelled off
 * this list.
 */
export const PHASES = [
  /**
   * The whole `tick`, wall to wall. Opened by `FrameProfile.beginFrame`, not
   * by `begin`.
   */
  "frame",
  "input",
  "roundBehind",
  /** The `playing` arm of the state switch: `updateGameplay` entire. */
  "gameplay",
  "driver",
  "onFoot",
  "world",
  "net",
  "conquest",
  /** The crews, the hulls and the tracks' sweep — one span over the armour. */
  "vehicles",
  "bots",
  "combat",
  "grenades",
  "antiTank",
  /** Havok's step and its three clients, which is the order they must run in. */
  "physics",
  "camera",
  "zones",
  /** `updateHud` — what a gameplay frame pushes at the chrome. */
  "hud",
  /** `HUD.update` — the chrome's own clock, which every state owes. */
  "hudDraw",
  /** The post chain, the sky and the shafts. */
  "post",
  /** The cull cells, the mote field, the rotors' dust and the shader's eye. */
  "culling",
  /**
   * `LocalShadows.update` — which lamps cast and packing their proxies. CPU
   * only: the atlas passes are drawn inside `render`, from the scene.
   */
  "localShadows",
  /**
   * `GiVolume.update` — choosing the lights, the params upload and recording
   * the three compute passes. The GPU's share of it is in `gpu.frame`.
   */
  "gi",
  /** `pushHullEngines` — the fleet's voices. */
  "audio",
  /** `scene.render()`. The big one, and see `FrameProfile`'s header on why. */
  "render",
  /**
   * The four spans INSIDE `render`, and the only ones in this list that
   * `Game` does not bracket — see `FrameProfile.hookRender`, which is also
   * where the argument that they cannot overlap each other is written down.
   */
  "shadowPass",
  "glow",
  "drawWorld",
  "drawOverlay",
  /**
   * The engine's own END of the frame: everything `endFrame` does after `tick`
   * has returned, which on WebGPU is closing the render pass and
   * `queue.submit`.
   *
   * **It is the one phase in this list that is NOT inside `frame`**, and it is
   * here because the residue outside the tick was the whole of an unexplained
   * hitch: a real capture read 42.2 ms of wall clock against a 15.1 ms tick
   * with no collection on it, and nothing in the instrument could say which
   * side of the submit the missing 27 ms was on. See
   * `FrameProfile.recordPresent`, and `PARENT_OF`, where being a root is
   * declared.
   *
   * What is still outside everything, after this, is the gap from the submit to
   * the next frame opening: the rAF wait, the compositor, the panel. A report
   * where `frame` + `present` falls well short of `frame.mean` is saying the
   * time is THERE, and that is a real answer rather than a gap in the tree.
   */
  "present",
] as const;

export type Phase = (typeof PHASES)[number];

export const SLOTS = PHASES.length;

/**
 * `P.bots` is the slot id for `"bots"`.
 *
 * Derived from `PHASES` rather than written out, so the list is stated once
 * and an id cannot drift from its label. The values are plain numbers by the
 * time a call site sees one, which is exactly what the ring wants.
 */
export const P = Object.fromEntries(
  PHASES.map((name, i) => [name, i]),
) as Readonly<Record<Phase, number>>;

/**
 * Which span each phase sits INSIDE.
 *
 * **The nesting is a fact about `Game.ts`'s bracket placement, and until this
 * existed the only written statement of it was prose in `docs/profiling.md`.**
 * That was enough while a report was read by a person, and stopped being enough
 * the moment `public/profile_viewer.html` had to draw the containment: a reader
 * that guesses the tree draws a wrong picture confidently, and one that carries
 * its own copy goes stale the first time a phase is added here.
 *
 * So the tree is declared once, beside the list it is about, and **shipped in
 * every capture** (`ProfileReport.tree`) — a report states its own shape for
 * the same reason it states its own clock grain and its own overhead.
 *
 * `Exclude<Phase, "frame" | "present">` is what makes it safe: every phase but
 * the two ROOTS must name a parent, so **a phase added to `PHASES` does not
 * compile until it has said where it sits** — the arrangement `ScreenStack`'s
 * `SCREENS` uses to stop a new screen shipping without answering its four
 * questions.
 *
 * **There are two roots because the frame has two parts and only one of them
 * is the tick.** `frame` is `Game.tick`, wall to wall; `present` is what the
 * engine does after it returns. Neither contains the other, they cannot
 * overlap, and a reader that drew `present` inside `frame` would be drawing a
 * containment that does not exist — which is exactly what the fallback tree in
 * `public/profile_viewer.html` does to any phase it has not been told about, so
 * that copy must gain this one too.
 */
export const PARENT_OF: Readonly<
  Record<Exclude<Phase, "frame" | "present">, Phase>
> = {
  input: "frame",
  roundBehind: "frame",
  gameplay: "frame",
  driver: "gameplay",
  onFoot: "gameplay",
  world: "gameplay",
  net: "world",
  conquest: "world",
  vehicles: "world",
  bots: "world",
  combat: "world",
  grenades: "world",
  antiTank: "world",
  physics: "world",
  camera: "gameplay",
  zones: "gameplay",
  hud: "gameplay",
  hudDraw: "frame",
  post: "frame",
  culling: "frame",
  // Bracketed inside `updateSceneForCamera`, which the `camera` span holds.
  localShadows: "camera",
  gi: "frame",
  audio: "frame",
  render: "frame",
  shadowPass: "render",
  glow: "render",
  drawWorld: "render",
  drawOverlay: "render",
};

/**
 * The phases nothing contains: `frame` (the tick) and `present` (what the
 * engine does after it).
 *
 * DERIVED from the two tables above rather than written out, so it cannot go
 * stale the way a hand-kept list would, and SHIPPED in every capture — because
 * a reader given only a child→parent map cannot tell a root from a phase the
 * map has not heard of, and those two want opposite renderings: a root is a
 * top-level bar, and an unknown phase is a warning that the reader is stale.
 * `public/profile_viewer.html` drew the second for both until this existed.
 */
export const ROOTS: readonly Phase[] = PHASES.filter(
  (name) => !(name in PARENT_OF),
);