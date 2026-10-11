/**
 * GrenadeFx.ts — The PICTURE of the grenade pool: every flight's body
 * tumbling through the air, the fuse pip blinking, a fire's flames, and the
 * six billowed layers of a blast (`BlastFx`).
 * Owns: one `GrenadeBody` per simulation slot, one set of flames per fire
 * slot, the `BlastFx` a blast and an ignition are drawn in, and its own floor
 * probe for the flames. All FIXED SIZE and built once.
 * Invariants: it READS `GrenadeSystem` and never writes it — the pools through
 * `flights` and `fireSlots` (read-only by type), everything else as a call
 * `Game` makes from the simulation's events (`blast` on `onBlast`, `ignite` on
 * `onIgnited`, `burntOut` on `onBurntOut`). Nothing here decides where a
 * grenade goes, whom a blast hurts or where a fire burns, and every random in
 * it is a PICTURE's (`Math.random`, never a round stream). The authority never
 * builds one (`BABYLON_EXIT.md` X2.2): the simulation half is all
 * `server/HeadlessGame.ts` holds, so nothing here has to survive a NullEngine.
 * Contract: `docs/grenades.md`.
 *
 * Split out of `GrenadeSystem` at X2.2 C3, on the line `CombatFx` drew one
 * system over: the simulation keeps the name, the pools and every rule, and
 * this file keeps everything a GPU is needed for. It imports two helpers from
 * the simulation's module that hold no state of the simulation's —
 * `fireStrength`, a pure function of a fire's age, and `floorUnder`, which
 * casts against the world it is handed and writes only the buffers its caller
 * passes in — and is handed the instance by `Game`; it holds no other system.
 *
 * - **A body follows its SLOT and starts over on a new FLIGHT.** A slot's
 *   `id` is monotonic and never reused, so a body that sees a different id in
 *   its slot gives the new flight its own attitude (a random tumble start — a
 *   picture, so nothing has to reproduce it) before it is shown, and a slot
 *   that is no longer live is hidden on the next `update`. `update` runs
 *   straight after `GrenadeSystem.update` every frame either runs, so a
 *   grenade that went off is gone on the frame its fireball appears.
 * - **The tumble reads the SPEED**, `|vel| · dt` metres of roll a frame, so a
 *   rolling grenade rolls and a resting one is still — the same metres
 *   `net/NetGrenades` reads off the distance its ghost covered, through the
 *   same `GrenadeBody`.
 * - **A flame's floor is its OWN probe.** Every flame is stood on the floor
 *   under it once, at the ignition, by `floorUnder` with this file's own ray
 *   buffer and scratch — never the simulation's, which a flame probe raised
 *   from inside `onIgnited` would otherwise be writing over. A flame the
 *   fire's middle cannot see is not lit at all: petrol runs across a floor and
 *   not through a wall, which is also where the burn's own line of sight
 *   stops.
 */
import { Mesh, Scene } from "@babylonjs/core";
import { CONFIG } from "../config";
import { buildGrenade, pipLit } from "../entities/GrenadeModel";
import {
  buildMolotov,
  showMolotov,
  type MolotovMeshes,
} from "../entities/MolotovModel";
import type { ThrowableId } from "../entities/throwables";
import { Vector3, type Vector3Like } from "../math";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { EnvironmentSpec } from "../world/environment";
import { flameData } from "../world/flame";
import { vertexDataOf } from "../world/parts";
import { newRayHit, type RayWorld } from "../world/RayWorld";
import { TerrainField } from "../world/TerrainField";
import { BlastFx } from "./BlastFx";
import {
  fireStrength,
  floorUnder,
  type BlastGround,
  type GrenadeSystem,
} from "./GrenadeSystem";

/**
 * One grenade on screen — a frag with its pip, and a bottle — and the moves a
 * flight makes on it. Both bodies are built into every one and `kind` says
 * which is out, for the reason the simulation's slot serves both.
 *
 * Exported because two pools draw a grenade: this file's, from the local
 * simulation, and `net/NetGrenades`', from the wire. They have to be the same
 * object on screen tumbling at the same rates, and the way that stays true is
 * one set of moves rather than two that agree on the day they were written.
 */
export class GrenadeBody {
  private readonly mesh: Mesh;
  /** The fuse tell — blinks faster as the fuse runs out. */
  private readonly pip: Mesh;
  /** The bottle, when this flight is a molotov. Hidden otherwise. */
  private readonly bottle: MolotovMeshes;
  /** Which of the two is on screen, or null while hidden. */
  private shown: ThrowableId | null = null;

  constructor(scene: Scene, mats: CelMaterialFactory, name: string, bottleName: string) {
    const { mesh, pip } = buildGrenade(scene, mats, name);
    this.mesh = mesh;
    this.pip = pip;
    this.bottle = buildMolotov(scene, mats, bottleName);
  }

  /** The mesh a `kind`'s position lives on. */
  private body(kind: ThrowableId): Mesh {
    return kind === "molotov" ? this.bottle.mesh : this.mesh;
  }

  /**
   * A new flight's attitude to tumble from, so twenty grenades are not all
   * facing the same way. `Math.random` is fine here and only here: this is an
   * effect, not world building — nothing navigates by it and no other client
   * has to reproduce it.
   */
  begin(): void {
    this.mesh.rotation.set(
      Math.random() * 3,
      Math.random() * 3,
      Math.random() * 3,
    );
    this.bottle.mesh.rotation.copyFrom(this.mesh.rotation);
  }

  /** Puts `kind`'s body on screen, and takes the other one off if it was. */
  show(kind: ThrowableId): void {
    if (this.shown === kind) return;
    this.hide();
    this.shown = kind;
    if (kind === "molotov") {
      showMolotov(this.bottle, true);
    } else {
      this.mesh.isVisible = true;
      this.pip.isVisible = true;
    }
  }

  /** Where the flight is. */
  place(kind: ThrowableId, x: number, y: number, z: number): void {
    this.body(kind).position.set(x, y, z);
  }

  /**
   * `metres` of roll: a frag turns on two axes, a bottle end over end, which
   * is the one axis a cylinder shows it on.
   */
  tumble(kind: ThrowableId, metres: number): void {
    const bottle = kind === "molotov";
    const body = this.body(kind);
    body.rotation.x += metres * (bottle ? 0.9 : 2.4);
    body.rotation.z += metres * (bottle ? 0.25 : 1.7);
  }

  /**
   * The tell, off the fraction of fuse left — `pipLit`, from the model file,
   * so a grenade drawn off the wire blinks in step with a simulated one. A
   * bottle has no fuse to tell; its lit rag is the tell and it is always lit.
   */
  fuse(kind: ThrowableId, left: number): void {
    if (kind !== "molotov") this.pip.isVisible = pipLit(left);
  }

  hide(): void {
    if (this.shown === null) return;
    this.shown = null;
    this.mesh.isVisible = false;
    this.pip.isVisible = false;
    showMolotov(this.bottle, false);
  }

  dispose(): void {
    this.pip.dispose();
    this.mesh.dispose();
    // The neck, the cloth and the wick are its children and go with it.
    this.bottle.mesh.dispose();
  }
}

/** One flame in a fire: where it stands off the fire's middle, and how big it is. */
interface Flame {
  mesh: Mesh;
  /** Offset on the ground from the fire's middle, metres. */
  dx: number;
  dz: number;
  /** Its own size against the rest, around 1. */
  size: number;
  /** Whether it is lit in THIS fire — false where a wall stands between it and the middle. */
  on: boolean;
}

/** One fire slot's flames, and which fire they are drawing (`-1` while none). */
interface FlameSet {
  id: number;
  flames: Flame[];
}

/** What this view reads of the simulation — the pools, and nothing it could write. */
type GrenadeReader = Pick<GrenadeSystem, "flights" | "fireSlots">;

/** The flames' own probe scratch — never the simulation's (see the header). */
const _middle = new Vector3();
const _probe = new Vector3();
const _lifted = new Vector3();
const _floor = new Vector3();

export class GrenadeFx {
  private readonly bodies: GrenadeBody[] = [];
  /** The flight each body is drawing — its slot's `id` — or -1 while hidden. */
  private readonly drawing: number[] = [];
  private readonly fires: FlameSet[] = [];
  /** The blast's picture — six of its eight layers. */
  private readonly fx: BlastFx;
  /** What a flame stands on: the same pair the flight lands on, read with this file's own buffer. */
  private rays: RayWorld | null = null;
  private terrain: TerrainField = new TerrainField();
  private readonly hit = newRayHit();

  constructor(
    scene: Scene,
    mats: CelMaterialFactory,
    private readonly sim: GrenadeReader,
  ) {
    this.fx = new BlastFx(scene, mats);
    for (let i = 0; i < CONFIG.grenade.poolSize; i++) {
      this.bodies.push(new GrenadeBody(scene, mats, `grenade${i}`, `molotov${i}`));
      this.drawing.push(-1);
    }

    // The flames. One geometry, cloned: every flame in every fire is the same
    // vertex data at its own scale, and the shader phases each one off its
    // WORLD position, so no two in a street move together however many share
    // the buffer.
    const m = CONFIG.molotov;
    const source = new Mesh("molotovFlameSource", scene);
    vertexDataOf(flameData({ radius: m.flameRadius, height: m.flameHeight })).applyToMesh(source);
    source.material = mats.getFlame();
    source.metadata = { noInk: true, noShadowCaster: true };
    source.isPickable = false;
    source.isVisible = false;
    for (let i = 0; i < m.fires; i++) {
      const flames: Flame[] = [];
      for (let j = 0; j < m.flames; j++) {
        const mesh = source.clone(`molotovFlame${i}-${j}`);
        mesh.metadata = { noInk: true, noShadowCaster: true };
        mesh.isPickable = false;
        mesh.isVisible = false;
        // The first flame stands in the middle and the rest walk out on the
        // golden angle to most of the radius, so the disc reads as burning to
        // its edge rather than as one fire with a halo. Keyed on the fire
        // SLOT's index, so a slot's fire is the same shape every time.
        const r =
          j === 0 ? 0 : m.fire.radius * (0.3 + 0.55 * Math.sqrt(j / (m.flames - 1)));
        const a = j * 2.399963 + i * 0.7;
        flames.push({
          mesh,
          dx: Math.cos(a) * r,
          dz: Math.sin(a) * r,
          size: j === 0 ? 1.25 : 0.7 + 0.35 * (((j * 5) % 4) / 3),
          on: false,
        });
      }
      this.fires.push({ id: -1, flames });
    }
  }

  /** The floor a flame stands on, as a backstop under the colliders. */
  setTerrain(terrain: TerrainField): void {
    this.terrain = terrain;
  }

  /** And the colliders over it. Null while no map is installed. */
  setWorld(rays: RayWorld | null): void {
    this.rays = rays;
  }

  /**
   * The only thing in here a map's look reaches: what colour the blast dust
   * is. Called from `installMap` with the environment the map was built
   * against.
   */
  setEnvironment(env: EnvironmentSpec): void {
    this.fx.setEnvironment(env);
  }

  /**
   * Poses every flight and every fire off the simulation's pools, and ages the
   * blasts. Called straight after `GrenadeSystem.update`, every frame that
   * runs.
   */
  update(dt: number): void {
    const g = CONFIG.grenade;
    const flights = this.sim.flights;
    for (let i = 0; i < flights.length; i++) {
      const n = flights[i];
      const body = this.bodies[i];
      if (!n.live) {
        if (this.drawing[i] >= 0) {
          body.hide();
          this.drawing[i] = -1;
        }
        continue;
      }
      if (this.drawing[i] !== n.id) {
        // A new flight in this slot — see the header.
        this.drawing[i] = n.id;
        body.begin();
        body.show(n.kind);
      }
      body.place(n.kind, n.pos.x, n.pos.y, n.pos.z);
      body.fuse(n.kind, n.fuse / g.fuse);
      if (!n.resting) {
        const v = n.vel;
        body.tumble(n.kind, Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * dt);
      }
    }

    const slots = this.sim.fireSlots;
    for (let i = 0; i < slots.length; i++) {
      const f = slots[i];
      const set = this.fires[i];
      if (f.t >= 0 && set.id === f.id) this.poseFire(set, fireStrength(f.t));
    }

    this.fx.update(dt);
  }

  /** A blast — the six billowed layers, on `GrenadeSystem.onBlast`. */
  blast(at: Vector3Like, power: number, ground: BlastGround): void {
    this.fx.blast(at, power, ground);
  }

  /**
   * A fire starting, on `GrenadeSystem.onIgnited`: its flames stood on their
   * floors, and the ignition — the one blast's own flash and fireball at
   * `molotov.ignition` of a frag, its sparks on the same scale, and a column
   * at `molotov.smoke`, but no surge and no burning fragments, because petrol
   * going up is a whoosh and not a pressure wave.
   */
  ignite(id: number, at: Vector3Like): void {
    const slots = this.sim.fireSlots;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].id !== id) continue;
      const set = this.fires[i];
      set.id = id;
      // Every flame on its own floor, found ONCE here: a fire on a slope or
      // across a kerb that stood every flame at the middle's height would be
      // half of it buried and half of it floating. One short ray each, at the
      // ignition and never again.
      _middle.set(at.x, at.y + 0.3, at.z);
      for (const fl of set.flames) {
        _probe.set(at.x + fl.dx, at.y + 0.3, at.z + fl.dz);
        fl.on = !this.rays?.blocked(_middle, _probe);
        if (!fl.on) continue;
        _probe.y = at.y + 1.2;
        const floor = floorUnder(this.rays, this.terrain, this.hit, _lifted, _probe, 2.4, _floor);
        fl.mesh.position.set(floor.x, floor.y, floor.z);
      }
      this.poseFire(set, fireStrength(0));
      break;
    }
    const m = CONFIG.molotov;
    this.fx.ignite(at, m.ignition, m.smoke);
  }

  /** The fire `ignite` named is out — on `GrenadeSystem.onBurntOut`. */
  burntOut(id: number): void {
    for (const set of this.fires) {
      if (set.id !== id) continue;
      set.id = -1;
      for (const fl of set.flames) fl.mesh.isVisible = false;
    }
  }

  /**
   * The flames, at the fire's swell: grown out of the ground over `grow`,
   * held, and sunk back into it over `fade`. Scaled rather than faded — the
   * fire material is hard-banded and has no alpha to fade, and a flame that
   * shrinks is what a fire going out actually looks like.
   */
  private poseFire(set: FlameSet, k: number): void {
    for (const fl of set.flames) {
      const s = fl.size * k;
      if (!fl.on || s < 0.02) {
        fl.mesh.isVisible = false;
        continue;
      }
      // Width grows faster than height, so a fire starting is a spreading
      // pool first and a wall of flame a moment later — the whoosh.
      fl.mesh.scaling.set(fl.size * Math.sqrt(k), s, fl.size * Math.sqrt(k));
      fl.mesh.isVisible = true;
    }
  }

  /**
   * The blast's billows and one molotov flame shown, or taken back off, for
   * the frames of the building card's pipeline warm-up — see `BlastFx.warm`. A
   * map with no fire of its own standing has never drawn the flame's material,
   * so a round's first molotov compiled it. The flame is the first of the LAST
   * fire slot, used only while that slot is free, at a fire's own stretch.
   */
  warm(on: boolean): void {
    this.fx.warm(on);
    const set = this.fires[this.fires.length - 1];
    const flame = set?.flames[0];
    if (!flame || set.id >= 0) return;
    if (on) flame.mesh.scaling.set(1, 1.5, 1);
    flame.mesh.isVisible = on;
  }

  /**
   * Everything off the screen — every body, every flame and every cloud —
   * beside `GrenadeSystem.reset`, wherever the map under it is thrown away. A
   * cloud left up would hang in the middle of an editor rebuild.
   */
  reset(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      this.bodies[i].hide();
      this.drawing[i] = -1;
    }
    for (const set of this.fires) {
      set.id = -1;
      for (const fl of set.flames) fl.mesh.isVisible = false;
    }
    this.fx.reset();
  }
}
