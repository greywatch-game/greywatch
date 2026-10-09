/**
 * bench/BenchScript.ts — What the benchmark (`?bench=<map>`) shows, frame by
 * frame: the bank's vantages turned through eight headings, one camera path
 * through the map's densest quarter, then a bot-only round from a fixed seed.
 * `BABYLON_EXIT.md` X0.3, and `docs/profiling.md`'s "The benchmark".
 * Owns: the PLAN — which frames are which segment, where the camera stands on
 * each frame that is a look, how many fixed steps each frame that is the
 * fight takes — and the two pieces of arithmetic the plan implies: the
 * spectator's bearing over the bot it follows, and `FightHash`, which says
 * whether two runs fought the same fight.
 * Invariants:
 *  - **Counted in FRAMES and fixed steps, never in wall clock** — see
 *    `CONFIG.profiling.bench`. `next()` is the only clock, so a phone and a
 *    desktop are shown the same MEASURED frames in the same order and differ
 *    only in what each one cost. The one length the device decides is a
 *    SETTLE's (`settles`), and a settle is never measured and steps nothing.
 *  - **Nothing allocates per frame.** Every bench frame is a measured frame,
 *    and a script that minted garbage would be measuring itself: the plan is
 *    built once at construction, the path into typed arrays, and `next`
 *    rewrites one reused cue.
 *  - **The plan is a function of the MAP alone** — its vantage rows, its
 *    collider boxes, its floor — so it is the same plan on every run and every
 *    device, and moves only when the map or `CONFIG.profiling.bench` does.
 * Never: touches a system, a mesh, the camera or the scene. It answers in
 * numbers and `Game.updateBench` spends them — the shape `PipelineWarmup` has
 * with the building card. Reached only through a dynamic import behind
 * `?bench`, so nothing in it is on the boot path.
 */
import { CONFIG } from "../config";
import { MAP_SHOTS } from "../ui/mapShots";
import type { WorldBox } from "../world/mapTypes";
import { DIFF_VANTAGES } from "./vantages";

/**
 * A labelled stretch of the run. `group` is what a report rolls segments up
 * into — every vantage's hold is its own segment and all of them are
 * `vantages` — and null is a stretch that is recorded but not a measurement:
 * the settles after a move and the round's lead-in.
 */
export interface BenchSegment {
  name: string;
  group: "vantages" | "path" | "fight" | null;
}

/** What the plan needs of a built map, handed in by `Game` at the bake's end. */
export interface BenchWorld {
  /** The play square's side, centred on the origin. */
  size: number;
  boxes: readonly WorldBox[];
  /** The floor as drawn: `TerrainField.surfaceAt` on its upper envelope. */
  surfaceAt(x: number, z: number): number;
}

/**
 * One frame's instruction. **Reused**: `next` rewrites the same object, so a
 * caller reads it before asking again.
 *
 * - `look` — the camera at `x, y, z` facing `yaw, pitch` (the camera's own
 *   convention: forward is `(cos p sin y, sin p, cos p cos y)`), the world held.
 * - `fight` — the world stepped `steps` fixed steps; the camera is the
 *   caller's, over whichever bot it follows.
 * - `done` — the script has run out.
 */
export interface BenchCue {
  kind: "look" | "fight" | "done";
  /** Index into `BenchScript.segments`. */
  segment: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  steps: number;
}

/** One stretch of frames of one kind. Built once; `next` walks the list. */
interface Leg {
  segment: number;
  /**
   * How many frames the leg is — or, for a SETTLE, how many QUIET frames in a
   * row end it (see `settles`).
   */
  frames: number;
  settle: boolean;
  kind: "look" | "fight";
  /** A look leg's source: a vantage index, or -1 for the path. */
  vantage: number;
  heading: number;
  /** A path leg that holds the path's FIRST pose for every frame (its settle). */
  hold: boolean;
  /** A fight leg's steps a frame, and on its last frame (the remainder). */
  steps: number;
  lastSteps: number;
}

/** The path's pitch: a little below level, so a roofline is a floor in frame. */
const PATH_PITCH = -0.18;
/**
 * How far the path looks INTO its own loop off the line of travel, radians.
 * Straight ahead is mostly the next stretch of the same street; straight in is
 * a turntable. Between the two the frame carries the quarter's middle and the
 * ground the camera is about to cross.
 */
const PATH_INWARD = 0.6;
/** Metres either side of a path sample whose roofs the camera has to clear. */
const PATH_ROOF_REACH = 12;
/** Metres around a path sample a box counts as under it. */
const PATH_FOOT = 3;
/**
 * The smallest footprint, in square metres, that LIFTS the path. A tree's
 * collider is its trunk and its crown is drawing only, so a camera lifted over
 * a trunk's top flew through the leaves on every forest map; trunks, posts and
 * lamps are walked past at eye height instead, the way a player passes them.
 */
const PATH_LIFT_AREA = 3;
/**
 * A box this wide is the rim or a boundary rather than a building — the
 * `w > 200 || d > 200` test every reader of the box list makes
 * (`CLAUDE.md`'s `MapLayout.size` row).
 */
const BOUNDARY_SPAN = 200;

export class BenchScript {
  /** The labelled stretches, in the order the run reaches them. */
  readonly segments: BenchSegment[] = [];
  /** Every frame the script will ask for — what the ring is sized to. */
  readonly frames: number;
  /** The vantages it stands at, by id, deduplicated by position. */
  readonly vantages: string[] = [];
  /** The path's loop, for the report: centre and radius in metres. */
  readonly path: { x: number; z: number; radius: number };

  private readonly legs: Leg[] = [];
  private leg = 0;
  private frame = 0;
  /** The fastest frame this settle has seen, and its quiet frames in a row. */
  private settleMin = Infinity;
  private settleQuiet = 0;
  private readonly cue: BenchCue = {
    kind: "look",
    segment: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    steps: 0,
  };

  /** Each vantage's eye and its heading 0, in the camera's convention. */
  private readonly vx: number[] = [];
  private readonly vy: number[] = [];
  private readonly vz: number[] = [];
  private readonly vyaw: number[] = [];
  private readonly vpitch: number[] = [];

  /** The path, one pose per measured frame. */
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly pyaw: Float32Array;

  /** The spectator: whom it follows, and the bearing it has reached. */
  private chaseFocus = -1;
  private chaseYaw = 0;

  constructor(mapId: string, world: BenchWorld) {
    const b = CONFIG.profiling.bench;
    const settle = this.segment("settle", null);

    // --- the vantages: the menu's first, as the bank shoots them ---
    const rows: { id: string; pos: readonly number[]; target: readonly number[] }[] =
      [];
    const menu = MAP_SHOTS[mapId]?.vantage;
    if (menu) rows.push({ id: "menu", pos: menu.pos, target: menu.target });
    for (const v of DIFF_VANTAGES[mapId] ?? []) rows.push(v);
    // One stop per POSITION. Eight headings make a row's own target moot but
    // for its pitch, and the bank stands several rows on one spot — the post
    // chain's six on `lanterns`, the ten viewmodel rows on the millpond — to
    // vary what is IN the frame rather than where it is taken from.
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.pos[0]},${row.pos[1]},${row.pos[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [x, above, z] = row.pos;
      const y = world.surfaceAt(x, z) + above;
      const dx = row.target[0] - x;
      const dy = row.target[1] - y;
      const dz = row.target[2] - z;
      this.vantages.push(row.id);
      this.vx.push(x);
      this.vy.push(y);
      this.vz.push(z);
      this.vyaw.push(Math.atan2(dx, dz));
      this.vpitch.push(Math.atan2(dy, Math.hypot(dx, dz)));
    }
    // **The REHEARSAL: every stop and every heading once, unmeasured, before
    // any of them is measured.** The first look at a place pays for things
    // the second does not — pipelines first USED, uploads, a lamp's first
    // shadow tiles — and on a GPU the CPU is running ahead of, that bill
    // arrives later as one frame that WAITS, 110-570 ms on the Windows box, at
    // a frame nobody can predict. Measured without this, a vantage's mean
    // moved up to 71% between three runs; the same run played three times in
    // one page had five such waits the first time and none in a hold after.
    // So what a hold measures is what a view costs once it has been seen —
    // which is the steady state a renderer change moves — and the first-look
    // bill stays on the path and in the fight, where every run pays it alike.
    const rehearsal = this.segment("rehearsal", null);
    for (let v = 0; v < this.vantages.length; v++) {
      this.look(rehearsal, b.arriveFrames, v, 0, false, true);
      for (let h = 1; h < b.headings; h++) this.look(rehearsal, b.turnFrames, v, h, false, true);
    }
    // Each heading's hold, stretched on a map with few stops so the vantages
    // between them are still measured for `vantageFrames` (see there).
    const holdFrames = Math.max(
      b.holdFrames,
      Math.ceil(b.vantageFrames / Math.max(1, this.vantages.length * b.headings)),
    );
    for (let v = 0; v < this.vantages.length; v++) {
      const hold = this.segment(`vantage ${this.vantages[v]}`, "vantages");
      this.look(settle, b.arriveFrames, v, 0, false, true);
      for (let h = 0; h < b.headings; h++) {
        if (h > 0) this.look(settle, b.turnFrames, v, h, false, true);
        this.look(hold, holdFrames, v, h, false, false);
      }
    }

    // --- the path ---
    const pathFrames = Math.round(b.pathSeconds / b.dt);
    this.px = new Float32Array(pathFrames);
    this.py = new Float32Array(pathFrames);
    this.pz = new Float32Array(pathFrames);
    this.pyaw = new Float32Array(pathFrames);
    this.path = this.layPath(world);
    this.look(settle, b.arriveFrames, -1, 0, true, true);
    this.look(this.segment("path", "path"), pathFrames, -1, 0, false, false);

    // --- the round ---
    const leadSteps = Math.round(b.leadSeconds / b.dt);
    const leadFrames = Math.ceil(leadSteps / b.leadSteps);
    this.legs.push({
      segment: this.segment("lead", null),
      frames: leadFrames,
      settle: false,
      kind: "fight",
      vantage: -1,
      heading: 0,
      hold: false,
      steps: b.leadSteps,
      lastSteps: leadSteps - (leadFrames - 1) * b.leadSteps,
    });
    const fightSteps = Math.round(b.fightSeconds / b.dt);
    this.legs.push({
      segment: this.segment("fight", "fight"),
      frames: fightSteps,
      settle: false,
      kind: "fight",
      vantage: -1,
      heading: 0,
      hold: false,
      steps: 1,
      lastSteps: 1,
    });

    // The most frames the run CAN take — a settle at its cap — which is what
    // the ring is sized to, so no run ever laps its own capture.
    let frames = 0;
    for (const leg of this.legs) frames += leg.settle ? leg.frames * b.settleCap : leg.frames;
    this.frames = frames;
  }

  /**
   * The next frame's instruction, or `done`. The ONLY clock the run has — see
   * the header. `lastMs` is the wall clock of the frame before this one, which
   * nothing but a settle reads (`settles`).
   */
  next(lastMs: number): BenchCue {
    const cue = this.cue;
    if (this.leg < this.legs.length && this.legs[this.leg].settle && this.frame > 0) {
      this.settles(lastMs);
    }
    while (this.leg < this.legs.length && this.legDone(this.legs[this.leg])) {
      this.leg++;
      this.frame = 0;
      this.settleMin = Infinity;
      this.settleQuiet = 0;
    }
    if (this.leg >= this.legs.length) {
      cue.kind = "done";
      return cue;
    }
    const leg = this.legs[this.leg];
    const f = this.frame++;
    cue.segment = leg.segment;
    cue.kind = leg.kind;
    if (leg.kind === "fight") {
      cue.steps = f === leg.frames - 1 ? leg.lastSteps : leg.steps;
      return cue;
    }
    cue.steps = 0;
    if (leg.vantage >= 0) {
      const v = leg.vantage;
      cue.x = this.vx[v];
      cue.y = this.vy[v];
      cue.z = this.vz[v];
      cue.yaw = this.vyaw[v] + (leg.heading / CONFIG.profiling.bench.headings) * Math.PI * 2;
      cue.pitch = this.vpitch[v];
      return cue;
    }
    const i = leg.hold ? 0 : f;
    cue.x = this.px[i];
    cue.y = this.py[i];
    cue.z = this.pz[i];
    cue.yaw = this.pyaw[i];
    cue.pitch = PATH_PITCH;
    return cue;
  }

  /**
   * The spectator's bearing over bot `focus`, looking where it looks, after
   * one fixed step `dt`. A new focus is SNAPPED to rather than turned to — the
   * cut to the next body is a cut, and a camera swinging round on the way
   * would be showing the frame something that is not the fight.
   *
   * The frame-lerp idiom, and it is exact here rather than frame-rate
   * dependent because `dt` is the fixed step on every device.
   */
  bearing(focus: number, lookYaw: number, dt: number): number {
    if (focus !== this.chaseFocus) {
      this.chaseFocus = focus;
      this.chaseYaw = lookYaw;
      return lookYaw;
    }
    let d = (lookYaw - this.chaseYaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    this.chaseYaw += d * Math.min(1, dt * CONFIG.profiling.bench.chaseTurn);
    return this.chaseYaw;
  }

  /**
   * Counts the frame a SETTLE has just drawn as quiet or not.
   *
   * **A settle ends when the device has caught up, and that is not a number
   * of frames.** Arriving at a new place puts the irradiance volume back on
   * its warm budget (a jump of more than half its window — `GiVolume.update`),
   * and that is a burst of GPU work the CPU does not wait for: measured on the
   * Windows box uncapped, it surfaced as ONE frame that waited 250-460 ms,
   * 60 to 92 frames after the camera arrived. Against a fixed 60-frame settle
   * it fell inside some runs' measured holds and not others', and one vantage's
   * mean moved 71% between three runs while the path and the fight, which
   * absorb their one jump the same way every time, agreed to 6%. So a settle
   * runs until its last `frames` frames were all quiet — none over
   * `quietFactor` times the fastest it has seen and `quietSlackMs` over it —
   * and `settleCap` times its own length whatever. `PipelineWarmup` leaves a vantage on the
   * same kind of rule.
   *
   * It is wall clock, and it is allowed to be only because of what a settle
   * is: never measured, and the world held through it, so its length moves
   * neither a measured frame nor the fight.
   */
  private settles(ms: number): void {
    const b = CONFIG.profiling.bench;
    if (ms < this.settleMin) this.settleMin = ms;
    const quiet = ms <= Math.max(this.settleMin * b.quietFactor, this.settleMin + b.quietSlackMs);
    this.settleQuiet = quiet ? this.settleQuiet + 1 : 0;
  }

  private legDone(leg: Leg): boolean {
    if (!leg.settle) return this.frame >= leg.frames;
    return (
      (this.frame >= leg.frames && this.settleQuiet >= leg.frames) ||
      this.frame >= leg.frames * CONFIG.profiling.bench.settleCap
    );
  }

  private segment(name: string, group: BenchSegment["group"]): number {
    this.segments.push({ name, group });
    return this.segments.length - 1;
  }

  private look(
    segment: number,
    frames: number,
    vantage: number,
    heading: number,
    hold: boolean,
    settle: boolean,
  ): void {
    if (frames <= 0) return;
    this.legs.push({
      segment,
      frames,
      settle,
      kind: "look",
      vantage,
      heading,
      hold,
      steps: 0,
      lastSteps: 0,
    });
  }

  /**
   * Lays the loop through the densest quarter and fills the path arrays.
   *
   * **Densest by COLLIDER BOXES**, which is the one measure of a place that
   * this plan's renderer change cannot move: the merge, the draw count and
   * the mesh list are all things the exit rebuilds, and a path chosen by any
   * of them would wander from one step to the next. The boxes are the map's
   * DATA — one per wall, roof and prop that stops a body.
   *
   * **Weighed by FOOTPRINT, not counted**, because a count is a census of
   * trees: every trunk in a wood is a box, and on Hollowmere the quarter with
   * the most boxes was the dead-tree wood rather than the village. Summing
   * `w * d` makes the quarter the one with the most BUILT ground — the town,
   * the harbour or the temple precinct — and centres the loop on it.
   *
   * The loop is centred on the quarter's boxes and sized by their spread, and
   * it rides `pathClearance` over whatever is under it within
   * `PATH_ROOF_REACH` either side — a street at eye height, and a roofline
   * lifted over rather than flown through, because a camera inside a wall is
   * drawing a frame nobody plays.
   */
  private layPath(world: BenchWorld): { x: number; z: number; radius: number } {
    const b = CONFIG.profiling.bench;
    const boxes = world.boxes.filter(
      (box) => !box.glass && box.w <= BOUNDARY_SPAN && box.d <= BOUNDARY_SPAN,
    );
    const quarterOf = (box: WorldBox) => (box.cx >= 0 ? 1 : 0) + (box.cz >= 0 ? 2 : 0);
    const built = [0, 0, 0, 0];
    for (const box of boxes) built[quarterOf(box)] += box.w * box.d;
    let quarter = 0;
    for (let q = 1; q < 4; q++) if (built[q] > built[quarter]) quarter = q;
    const weight = built[quarter];
    let cx = 0;
    let cz = 0;
    for (const box of boxes) {
      if (quarterOf(box) !== quarter) continue;
      cx += box.cx * box.w * box.d;
      cz += box.cz * box.w * box.d;
    }
    const half = world.size / 2;
    // A map with no boxes at all circles the middle of its quarter.
    if (weight <= 0) {
      cx = (quarter & 1 ? 1 : -1) * half * 0.5;
      cz = (quarter & 2 ? 1 : -1) * half * 0.5;
    } else {
      cx /= weight;
      cz /= weight;
    }
    let spread = 0;
    for (const box of boxes) {
      if (quarterOf(box) !== quarter) continue;
      spread += ((box.cx - cx) ** 2 + (box.cz - cz) ** 2) * box.w * box.d;
    }
    spread = weight > 0 ? Math.sqrt(spread / weight) : half * 0.25;
    const [rMin, rMax] = b.pathRadius;
    const radius = Math.min(rMax, Math.max(rMin, spread), half * 0.45);
    // Kept inside the play square, so the loop never leaves for the borderland.
    const reach = half - radius - 4;
    cx = Math.max(-reach, Math.min(reach, cx));
    cz = Math.max(-reach, Math.min(reach, cz));

    const n2 = this.px.length;
    // The ground and the highest roof under each sample, then the highest of
    // those within reach either side, then a moving mean over the same reach —
    // so the camera climbs before a building rather than into it and comes
    // down after one without a step.
    const top = new Float32Array(n2);
    for (let i = 0; i < n2; i++) {
      const a = (i / n2) * Math.PI * 2;
      const x = cx + Math.sin(a) * radius;
      const z = cz + Math.cos(a) * radius;
      this.px[i] = x;
      this.pz[i] = z;
      let t = world.surfaceAt(x, z);
      for (const box of boxes) {
        const dx = x - box.cx;
        const dz = z - box.cz;
        const c = Math.cos(box.rotY);
        const s = Math.sin(box.rotY);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (box.w * box.d < PATH_LIFT_AREA) continue;
        if (Math.abs(lx) > box.w / 2 + PATH_FOOT || Math.abs(lz) > box.d / 2 + PATH_FOOT) continue;
        const roof = box.cy + box.h / 2;
        if (roof > t) t = roof;
      }
      top[i] = t;
      // Along the line of travel, turned in toward the middle of the loop.
      const travel = Math.atan2(Math.cos(a), -Math.sin(a));
      this.pyaw[i] = travel - PATH_INWARD;
    }
    const step = (Math.PI * 2 * radius) / n2;
    const w = Math.max(1, Math.round(PATH_ROOF_REACH / step));
    const peak = new Float32Array(n2);
    for (let i = 0; i < n2; i++) {
      let m = -Infinity;
      for (let k = -w; k <= w; k++) m = Math.max(m, top[(i + k + n2) % n2]);
      peak[i] = m;
    }
    for (let i = 0; i < n2; i++) {
      let sum = 0;
      for (let k = -w; k <= w; k++) sum += peak[(i + k + n2) % n2];
      this.py[i] = sum / (2 * w + 1) + b.pathClearance;
    }
    return { x: round1(cx), z: round1(cz), radius: round1(radius) };
  }
}

/**
 * A hash of the fight as it happens — every award and every death, in order,
 * stamped with the fixed step it landed on — so two runs can be compared by
 * one string. `npm run simulate`'s `fight` is the same idea on the authority;
 * the two do not print the same hash, because a client's round and the
 * authority's are fed by different hooks, and nothing compares across them.
 *
 * Two FNV-1a lanes with different bases, which is 64 bits of "same or not" for
 * a comparison between a handful of runs. Nothing here allocates: an event is
 * folded in as it is reported, a string by its char codes.
 */
export class FightHash {
  /** The fixed step the fight has reached, advanced by `Game` per step. */
  step = 0;
  /** Awards and deaths folded in. */
  events = 0;
  private a = 0x811c9dc5;
  private b = 0x9e3779b9;

  award(slot: number, kind: string, points: number): void {
    this.fold(this.step);
    this.fold(1);
    this.fold(slot);
    for (let i = 0; i < kind.length; i++) this.fold(kind.charCodeAt(i));
    this.fold(points);
    this.events++;
  }

  death(slot: number): void {
    this.fold(this.step);
    this.fold(2);
    this.fold(slot);
    this.events++;
  }

  get hex(): string {
    return hex8(this.a) + hex8(this.b);
  }

  private fold(v: number): void {
    // Integers in practice (a step, a slot, a char, points); a fraction is
    // folded as its thousandths rather than dropped.
    let x = Math.round(v * 1000) | 0;
    for (let k = 0; k < 4; k++) {
      const byte = x & 0xff;
      x >>>= 8;
      this.a = Math.imul(this.a ^ byte, 0x01000193);
      this.b = Math.imul(this.b ^ byte, 0x01000193);
    }
  }
}

function hex8(v: number): string {
  return (v >>> 0).toString(16).padStart(8, "0");
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
