/**
 * Game.ts — Orchestrator: scene init, main loop, and ALL cross-system
 * wiring. The only place systems meet — systems never import each other; new
 * cross-system behavior is a callback wired here.
 * WHERE THINGS ARE, because this is a long file and a change should not need a
 * read of it: the constructor is CONSTRUCTION ONLY (a linear list of `new X`,
 * which has to stay there — those fields are what strictPropertyInitialization
 * checks) and ends in three calls. Cross-system callbacks are `wireSystems` and
 * the four subject methods under it (`wireDeaths`, `wireGrenades`, `wireBattle`,
 * `wireConquest`) — a new one goes in whichever names its subject. Browser
 * listeners are `installDomListeners`. Screen callbacks are `wireScreens`.
 * `tick` is a dispatch: the input handling for each screen is its own
 * `update*Screen`/`updateMenuCard`/`updatePauseMenu` method, and only `playing`,
 * `dying` and `editor` are inline, because they are two lines each.
 * The remembered difficulty/map/loadout live in `prefs.ts`, the display
 * settings in `settings.ts`; neither applies anything, that is this file's job.
 * Which SERVER is `net/RegionBook.ts` — the list, the pick, and the automatic
 * pick — and it neither stores nor draws, for the same split: `setRegion` here
 * is what writes the pref and what tells the lobby screen.
 * State machine: menu -> deploy -> playing (deploy re-entered on each death)
 * -> roundover. The 3D scene renders live behind every state. The SHAPE of it
 * is `ScreenStack.ts` and not this file: what a screen may cover, what it holds
 * offline, what it owes a netplay round and whether the scoreboard is owed to
 * it are one declared row per state there. This file holds one `ScreenStack`,
 * moves it with `go`/`raiseLid`/`lowerLid`, and never assigns a state —
 * `Game.state` is a getter. `takeDown` is the one place that knows what putting
 * a screen away means, and every transition goes through it.
 * Load-bearing frame order at the end of updateGameplay: camera update ->
 * carried lights -> lighting.update() -> sfx.setListener(). The shader's eye
 * (mats.updateCamera) is NOT in that chain — it is pushed once per frame in
 * `tick`, because every state renders and only some of them simulate.
 * ConquestSystem.update runs before BattleSystem.update (bots see this frame's
 * flag ownership). Muzzle-flash light budget is spent here
 * (spendMuzzleLightBudget) — new per-bot transient lights need the same
 * treatment; a grenade's blast light is deliberately outside it (seconds
 * apart, not eighty a second). A bot goes down through registerBotKill
 * whichever of the three things killed it — rifle, player rifle, grenade — and
 * whoever put it there is credited through creditKill, one door each: the
 * victim's death is known where it fell and the kill only where it was fired.
 * The map is a `MapDef` held in one field (`mapDef`) and built in one method
 * (`installMap`), which both a round start and an editor rebuild go through —
 * no map's layout or environment may be named anywhere else in here.
 * Also owns: GlowLayer scan (construction-time only; metadata.noGlow contract)
 * and its distance fade (customEmissiveColorSelector — the bloom is the one
 * pass that reads a material and never asks where the mesh stands, so without
 * it a glow is the last thing left when the world around it has gone to fog;
 * infiniteDistance exempts the moon),
 * ShadowSystem wiring (casters re-registered per round from map.visuals),
 * WorldCulling wiring (the map filed per install, the eye pushed from `tick` in
 * every state beside the shader's own — it decides how much of the map Babylon
 * walks each frame and writes nothing onto any mesh),
 * pipeline.imageProcessingEnabled === false, window.__celshock debug handle.
 */
import {
  Color3,
  DefaultRenderingPipeline,
  GlowLayer,
  Matrix,
  Mesh,
  Scene,
  type StandardMaterial,
  type SubMesh,
  Vector3,
  Viewport,
  type WebGPUEngine,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  CelMaterialFactory,
  fogAmountAt,
  updateOutlineScales,
} from "../shaders/CelShader";
import { GodRays } from "../shaders/GodRays";
import { HorrorPost } from "../shaders/HorrorPost";
import { MotionBlur } from "../shaders/MotionBlur";
import { Bot } from "../entities/Bot";
import { difficultyNames } from "../entities/BotSkill";
import { callsign } from "../entities/callsigns";
import { OTHER_TEAM, type Combatant, type Team } from "../entities/Combatant";
import { NetSession, type LocalHull } from "../net/NetSession";
import { clearRequestTimings, fetchMatches } from "../net/lobby";
import { RegionBook } from "../net/RegionBook";
import { SNAPSHOT_HZ, TICK_HZ, type ServerEvent } from "../net/protocol";
import { type FinishId } from "../entities/finishes";
import { Player } from "../entities/Player";
import { SHELL_SHOT, type DriveInput, type Tank } from "../entities/Tank";
import {
  ordnanceEffect,
  type EquipmentId,
} from "../entities/equipment";
import { type SightId } from "../entities/sights";
import { VIEWMODEL_GROUP } from "../entities/ViewModel";
import {
  carriedSetup,
  isWeaponId,
  PRIMARY_WEAPON_IDS,
  type PrimaryWeaponId,
  type ReportVoice,
} from "../entities/weapons";
import { AimAssistSystem } from "../systems/AimAssistSystem";
import { Atmosphere } from "../systems/Atmosphere";
import { BattleSystem } from "../systems/BattleSystem";
import { CaptureZoneSystem } from "../systems/CaptureZoneSystem";
import {
  CombatSystem,
  type DamageKind,
  type Hittable,
} from "../systems/CombatSystem";
import { ConquestSystem, type ControlPoint } from "../systems/ConquestSystem";
import { DeathCam } from "../systems/DeathCam";
import { VehicleCamera } from "../systems/VehicleCamera";
import { TankCrew } from "../systems/TankCrew";
import {
  VehicleSystem,
  type VehicleOrders,
} from "../systems/VehicleSystem";
import { GrassSystem } from "../systems/GrassSystem";
import { BlastDebrisSystem } from "../systems/BlastDebrisSystem";
import { DebrisSystem } from "../systems/DebrisSystem";
import { GlassSystem } from "../systems/GlassSystem";
import { AntiTankSystem, type OrdnanceHit } from "../systems/AntiTankSystem";
import { GrenadeSystem, type BlastGround } from "../systems/GrenadeSystem";
import { PhysicsWorld, type HavokInstance } from "../systems/PhysicsWorld";
import { RagdollSystem } from "../systems/RagdollSystem";
import { ReflectionSystem } from "../systems/ReflectionSystem";
import { ScoreBook, awardKill } from "../systems/ScoreBook";
import { LightingSystem } from "../systems/LightingSystem";
import { ShadowSystem } from "../systems/ShadowSystem";
import { Sky } from "../systems/Sky";
import { WaterSystem } from "../systems/WaterSystem";
import { WorldCulling } from "../systems/WorldCulling";
import { applyEnvironment, type EnvironmentSpec } from "../world/environment";
import { Leash, LEASH_KILLER } from "../world/leash";
import type { EditorSession } from "../editor";
import { MAPS, type MapDef } from "../world/maps";
import { MapBuilder, type BuildOptions, type GameMap } from "../world/MapBuilder";
import { DeployScreen } from "../ui/DeployScreen";
import { HUD, type CaptureStatus, type ScoreRow } from "../ui/HUD";
import { OverlayScreen } from "../ui/OverlayScreen";
import { kitLabel, LoadoutScreen } from "../ui/LoadoutScreen";
import { SettingsScreen } from "../ui/SettingsScreen";
import { LobbyScreen } from "../ui/LobbyScreen";
import { Minimap } from "../ui/Minimap";
import { TouchControls } from "../ui/TouchControls";
import { enterFullscreenOnTouch } from "../pwa/register";
import { CameraSystem } from "./CameraSystem";
import { InputManager } from "./InputManager";
import {
  readDifficulty,
  readEquipment,
  readFinish,
  readMap,
  readRegion,
  readSight,
  readWeapon,
  writeDifficulty,
  writeEquipment,
  writeFinish,
  writeMap,
  writeRegion,
  writeSight,
  writeWeapon,
} from "./prefs";
import {
  ScreenStack,
  type GameState,
  type LidState,
  type StepState,
} from "./ScreenStack";
import { readSettings, writeSettings, type Settings } from "./settings";
import { Sfx } from "./Sfx";

/** Grass bends around combatants; in the editor there are none. */
const EMPTY_PUSHERS: readonly Combatant[] = [];

/**
 * The camera's own local forward, for `getDirection`. A module constant because
 * the one caller runs per frame and `Axis.Z` would be the same object read
 * through another import.
 */
const FORWARD_Z = new Vector3(0, 0, 1);

/**
 * A hull the player is being offered, and which of the two offers it is: an
 * empty one, or one they may turn a bot crew out of. See `Game.offeredSeat`.
 */
interface Seat {
  tank: Tank;
  /** True when taking it evicts somebody. The prompt says so. */
  crewed: boolean;
  label: string;
}

/**
 * How far a laid mine's centre sits above the surface it is laid on.
 *
 * Half the plate's own height, so the thing rests ON the road rather than
 * half-buried in it — an art constant and therefore here rather than in
 * `CONFIG.equipment`, which is where the numbers a designer tunes live. It has
 * to agree with `buildMineBody`'s cylinder, which is the one other place the
 * plate's size is written.
 */
const MINE_LIFT = 0.04;

/**
 * Squared eye distance to a submesh's bounding-sphere centre, for the
 * front-to-back opaque sort installed in the constructor.
 *
 * Squared because a sort only needs the ORDER, and the centre rather than the
 * near point because this is picking a drawing order rather than measuring
 * anything: a merged block's near point would order two overlapping blocks
 * more correctly and cost a radius lookup per comparison to do it, and getting
 * that pair the wrong way round costs one block's early rejection rather than
 * a wrong picture.
 */
function eyeDistanceSq(sub: SubMesh, eye: Vector3): number {
  const c = sub.getBoundingInfo().boundingSphere.centerWorld;
  const dx = c.x - eye.x;
  const dy = c.y - eye.y;
  const dz = c.z - eye.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * The carried-light id for one of the kit screen's bench lamps. A function so
 * that putting them up and taking them down cannot disagree about the name —
 * a carried light nobody removes never gives its shader slot back.
 */
const kitLampId = (n: number) => `kit-lamp-${n}`;

/**
 * Top-level orchestrator: owns the scene, all systems, the game state machine,
 * and the per-frame update loop. The ENGINE is the one thing here it does not
 * own — `main.ts` builds it (WebGPU's is async) and hands it in, exactly as it
 * hands in Havok.
 *
 * Systems never import each other — `Game` is the only place they meet, and
 * cross-system behavior belongs in this wiring rather than in an import.
 */
export class Game {
  private engine: WebGPUEngine;
  private scene: Scene;
  private mats: CelMaterialFactory;
  private input: InputManager;
  private cameraSys: CameraSystem;
  private hud: HUD;
  /** The menu, the round-over card and the pause list. */
  private overlayScreen: OverlayScreen;
  private deployScreen: DeployScreen;
  private loadoutScreen: LoadoutScreen;
  private settingsScreen: SettingsScreen;
  private lobbyScreen: LobbyScreen;
  private minimap: Minimap;
  /**
   * The on-screen controls, drawn only while a phone is what is playing.
   *
   * It is a screen like the five above it and NOT a system: it draws, it is
   * polled, and it decides nothing. `InputManager` reads it as a third device
   * (`setTouchSource`), which is why nothing in gameplay below this line has
   * heard of it — the one exception being the pause button, which is a callback
   * out like every other screen's.
   */
  private touch: TouchControls;
  private sfx: Sfx;
  private mapBuilder: MapBuilder;
  private combat: CombatSystem;
  /** Thrown grenades — the one thing on the map that is not hitscan. */
  private grenades: GrenadeSystem;
  /**
   * The anti-tank kit in the world: rockets in the air, mines on the ground.
   *
   * Offline only, and on a map with armour only — the same gate the hulls
   * themselves take in `installMap`, for the same reason. Built unconditionally
   * all the same: its two pools are eight bodies and sixteen plates, and a
   * system that exists and is never asked anything costs one `update` call a
   * frame over two empty loops.
   */
  private antiTank: AntiTankSystem;
  /** The only physics engine in the game, and the two things that use it. */
  private physics: PhysicsWorld;
  /** Corpses under physics. */
  private ragdolls: RagdollSystem;
  /** Glass shards. The second physics client. */
  private debris: DebrisSystem;
  /**
   * The two blast layers that are under Havok: the rubble a detonation throws
   * and the mark it leaves. The third `PhysicsClient`, and the one that has to
   * be told what the map is made of — see `installMap`.
   */
  private blastDebris: BlastDebrisSystem;
  /** Breakable glazing — the one part of the world that is not static. */
  private glass: GlassSystem;
  /** The player's own death: a stand-in body, and the camera that watches it. */
  private deathCam: DeathCam;
  private aimAssist: AimAssistSystem;
  /**
   * The armour on the field. Empty on every map that states no hardstandings,
   * which is two of the four shipped.
   *
   * In a NETPLAY round it is built exactly the same way and OWNED differently:
   * the fleet is `predicted`, so no hull here takes local damage and neither
   * hardstanding clock runs — the authority decides all of it, and everything
   * but the hull this player is sitting in is posed from the wire. See
   * `docs/vehicles.md`.
   */
  private vehicles: VehicleSystem;
  /** The view from outside the hull you are driving. `DeathCam`'s shape. */
  private vehicleCam: VehicleCamera;
  /**
   * The bots that drive. Empty on a map with no hardstandings, because the
   * boarding sweep walks a fleet that has nothing in it — and empty in a
   * NETPLAY round for a different reason: the hulls are there, but this client
   * runs no AI at all, so the crews inside them are the authority's and a
   * local one would be a second brain steering a hull posed from the wire.
   *
   * It is a system of its own rather than a branch inside `BattleSystem`
   * because a bot in a hull is not a bot doing something unusual: it is out of
   * `Bot`'s FSM entirely, and everything about how it moves, what it can see
   * and what it shoots with belongs to the vehicle. See `TankCrew`'s header.
   */
  private crew: TankCrew;
  private battle: BattleSystem;
  private conquest: ConquestSystem;
  /** The flags' in-world markers — rings, skirts and beacons. */
  private zones: CaptureZoneSystem;
  private lighting: LightingSystem;
  private shadows: ShadowSystem;
  /**
   * The world as the glazing reflects it — one cube, baked per map install.
   * The only render target here besides the shadow map.
   */
  private reflections: ReflectionSystem;
  /**
   * How much of the map the frame's own mesh walk is offered. Owns nothing
   * that draws and writes nothing onto a mesh — see `WorldCulling`, which is
   * `ENGINE_UPGRADE.md` S1.
   */
  private culling: WorldCulling;
  private atmosphere: Atmosphere;
  private sky: Sky;
  private water: WaterSystem;
  private grass: GrassSystem;
  private post: HorrorPost;
  /** Moon shafts. Driven from the sky's own moon direction every frame. */
  private godRays: GodRays;
  /**
   * Whether the shaft pass is on the camera, and which slot of the camera's
   * post-process list it occupies. True to begin with — the constructor
   * attaches it — and the first `syncGodRays` takes it off if the moon is not
   * in frame.
   */
  private godRaysAttached = true;
  private godRaysSlot = 0;
  private motionBlur: MotionBlur;
  /** The environment the sky is currently painted for — see applySky(). */
  private skyEnv: EnvironmentSpec | null = null;
  private player: Player;
  private canvas: HTMLCanvasElement;
  /**
   * Kept as a field, not a constructor local: the exclusion scan in the
   * constructor runs once, so anything created later (the editor's proxies and
   * overlays) has to exclude itself by hand and needs the layer to do it.
   */
  private glow: GlowLayer;
  /** Non-null only while the state is "editor". Dev builds only. */
  private editor: EditorSession | null = null;
  /**
   * Held across `toggleEditor`'s dynamic `import()`, because `this.editor` is
   * not the latch it looks like: it is not assigned until the session has been
   * built, which is a map build and a screenful of teardown after the await
   * returns. Two F2s inside a cold import both got past `if (this.editor)` and
   * ran the whole opening twice — a second `installMap` disposing the map the
   * first had just handed to `createEditor`, and the first session leaked with
   * no reference left to dispose it. Dev builds only, and the window is one
   * cold load wide, but it is exactly the failure `installMap` exists to stop.
   */
  private editorLoading = false;

  /**
   * Viewport height in CSS pixels, refreshed by `applyRenderScale` — which is
   * also the resize handler, so it is exactly the moment this can change. Only
   * the crosshair's spread projection reads it.
   */
  private viewportHeight = window.innerHeight;
  /**
   * The map being played, as the layout/environment pair `src/world/maps.ts`
   * keeps together. The single place either half is named: everything from the
   * round start to the editor session reads it off here, so a second map is a
   * `MapDef` in that registry and a write to this field, not a hunt through the
   * orchestrator for the fourteen places the old constants were spelled out.
   */
  private mapDef: MapDef = readMap();

  /**
   * The state machine: the step the game is on, and the screens raised over it.
   *
   * Everything about what a state IS — whether it is a step or a lid, what a lid
   * may cover, whether the world under it is held, whether it owes the netplay
   * frame, whether it is owed the scoreboard — is declared per state in
   * `ScreenStack.ts` rather than written out at the call sites that ask. This
   * file's three moves are `go`, `raiseLid` and `lowerLid`, and there is no
   * fourth: nothing here assigns a state.
   */
  private screens = new ScreenStack();

  /**
   * The state this frame is in — the topmost screen, which is the step itself
   * when nothing is over it.
   *
   * Read-only on purpose: the fifty-odd places that ASK are unchanged by the
   * stack underneath, and the fifteen that used to ANSWER by assignment have to
   * go through a move instead. What is under the lids is `screens.under` and is
   * a different question — see `pushScoreboard` for a case that deliberately
   * wants this one.
   */
  private get state(): GameState {
    return this.screens.current;
  }
  /**
   * Whether the pointer was locked as of the last `pointerlockchange`. Losing
   * the lock is what pauses the game, and only a *transition* out of it counts
   * — a pad player who never took the lock has none to lose.
   */
  private hadPointerLock = false;
  /**
   * `performance.now()` of the last time the lock was TAKEN. A loss inside
   * `CONFIG.input.lockGrace` of it is the browser finishing an Escape it had
   * already started rather than the player leaving, and does not pause.
   */
  private lockTakenAt = 0;
  /**
   * A resume that still owes the pointer lock: how long it has been owed, and
   * how long until the next attempt. See `updatePendingLock`.
   */
  private lockPending = false;
  private lockPendingT = 0;
  private lockRetryT = 0;
  private map: GameMap | null = null;
  /** Small delay so overlay confirms aren't triggered by held buttons. */
  private overlayT = 0;
  /**
   * Selected enemy-skill tier, applied on every round start. Persisted, because
   * re-picking it after each reload is exactly the friction that makes people
   * leave a difficulty setting alone.
   */
  private difficulty = readDifficulty();
  /**
   * The kit. Unlike the difficulty tier this applies immediately — both of
   * these re-pose a weapon that is put away everywhere the loadout screen can
   * be opened from, so there is nothing to defer to the next round.
   */
  private sight: SightId = readSight();
  private weapon: PrimaryWeaponId = readWeapon();
  /**
   * Which anti-tank item the third slot holds — remembered on every map, and
   * carried only on the ones with armour.
   *
   * **`armourOffered` is what decides whether the slot exists at all**, and it
   * is a question about the MAP rather than about this pick: a launcher is
   * two-thirds of a hull's health and a mine catches nothing but a hull, so on
   * a map with none they would be a heavy anti-infantry weapon and a paperweight
   * respectively. The pick survives the maps that do not offer it, because it
   * is the player's and not the map's.
   */
  private equipment: EquipmentId = readEquipment();
  /**
   * What each weapon is PAINTED in — one entry per primary, because a finish
   * belongs to a gun rather than to the loadout (see `finishes.ts`). The whole
   * record is held rather than just the carried weapon's so that stepping
   * across the weapon row shows each gun in the colours it was last left in,
   * which is the only way the row means anything.
   *
   * Purely cosmetic, and the one part of the kit that reaches nothing but the
   * viewmodel: no camera, no captions, and nothing on the wire.
   */
  private finishes: Record<PrimaryWeaponId, FinishId> = Object.fromEntries(
    PRIMARY_WEAPON_IDS.map((id) => [id, readFinish(id)]),
  ) as Record<PrimaryWeaponId, FinishId>;
  /** The display settings. Which states their screen may cover is the table's. */
  private settings: Settings = readSettings();
  /** Reused each frame: the player plus every bot, for objective occupancy. */
  /**
   * The networked round, or null offline.
   *
   * A field and a branch rather than a mode flag threaded through everything:
   * with no session, every path below runs exactly as it always has, and
   * nothing in `src/net/` is even constructed. What the branch buys is that the
   * two authorities — this machine and the server — can never both be running,
   * which is the failure that would be invisible and unfixable.
   */
  private net: NetSession | null = null;

  /**
   * Which server this client is browsing and joining, and the read behind both.
   *
   * A module rather than the six fields it replaces, because that cluster
   * answers only to itself: the list, the read of it, the player's pick, the
   * automatic one, the pings the automatic one ranks by and a server named on
   * the URL are used by nothing in here except the lobby methods below. It
   * touches no system, no mesh and no frame — which is the test for what may
   * leave this file, and the reason the netplay wiring next door may not.
   *
   * The two halves it deliberately does NOT own are the two this file does: the
   * remembered pick is `prefs.ts`'s to store and this file's to spend (the
   * constructor takes it in, `choose` hands the next one back), and every push
   * at the lobby screen is still made from here.
   */
  private readonly regionBook = new RegionBook(readRegion());

  /**
   * Which lobby refresh is current.
   *
   * Every region is asked at once and each answers when it answers, so a second
   * Refresh can land its fast region's list before the first one's slow region
   * has timed out — and a four-second-old answer painted over a fresh one is a
   * row that lies about who is in it. A counter is the whole guard: an answer
   * from a superseded generation is dropped.
   */
  private lobbyFetch = 0;

  /**
   * What to call this player on the wire. Server-side it is truncated and
   * stripped (see `MAX_NAME_LENGTH`); this is only what gets offered.
   *
   * Still `?name=` and a default, because the menu has no text entry anywhere
   * in it and adding one is its own feature — a focused input has to be kept
   * from feeding the game's own key handling, and neither the pad nor the
   * on-screen path exists. Named as a field rather than read at the join so
   * there is one obvious place for that feature to land.
   */
  private playerName = "player";

  private readonly combatants: Combatant[] = [];
  /** Scratch for the shadow focus point — no per-frame allocation. */
  private readonly shadowFocus = new Vector3();
  /**
   * Four scratch aim directions, one per per-frame reader of
   * `CameraSystem.forward`. Separate rather than shared because the shadow
   * focus SCALES the vector it is handed: one scratch between them would work
   * today only because the aim assist happens to read its copy before that
   * happens, which is a property of two files agreeing rather than of either.
   * The kit stage's is its own for the weaker version of the same reason — it
   * runs in a state where the other three do not, so sharing would rest on
   * which states are lids rather than on anything this line can hold.
   */
  private readonly aimForward = new Vector3();
  private readonly shadowForward = new Vector3();
  private readonly listenerForward = new Vector3();
  private readonly kitForward = new Vector3();
  /** …and the kit stage's flat right, the one per-frame reader of that pair. */
  private readonly kitRight = new Vector3();
  /** …and for the carried lamp, which rides a little above the player. */
  private readonly lampPos = new Vector3();
  /** …and for the kit screen's bench lamp, placed relative to the camera. */
  private readonly kitLampPos = new Vector3();
  /** …and for where a thrown grenade leaves the player's hand. */
  private readonly grenadeHand = new Vector3();
  /** Counts down while the player is waiting to redeploy. */
  private respawnT = 0;
  /**
   * The player's leash, on a map whose boundary is open — how long they have
   * been out of the play square and how long that leaves them.
   *
   * Held by `Game` rather than by `Player` because it is a rule about the MAP
   * and a body knows nothing about which one it is standing on; `installMap`
   * is what points it at one, and on the three maps closed by the rim it is
   * pointed at nothing and never says a word.
   *
   * **It kills offline and draws in a match.** In a netplay round the
   * authority runs a leash of its own against the position this client
   * reported, and that one is what ends a life — this one is a prediction off
   * predicted movement, kept because the countdown has to be on screen the
   * instant the line is crossed rather than a round trip later, and it is the
   * same class stepping the same arithmetic so the two agree to within the
   * ping. See `world/leash.ts`.
   */
  private readonly leash = new Leash();

  /**
   * The hull the player is inside, or null on foot. **The single fact the whole
   * feature turns on**, and it is here rather than on `Player` or on
   * `VehicleSystem` for the reason every other cross-system fact is: `Player`
   * is a body and knows nothing about vehicles, `VehicleSystem` owns hulls and
   * knows nothing about players, and the pairing of the two is exactly what
   * this file is for.
   *
   * Everything that changes while it is non-null is listed in `mount` and undone
   * in `clearVehicle`; nothing else in this file may write it.
   */
  private driving: Tank | null = null;

  /**
   * This frame's orders to that hull. A held object rather than one built per
   * frame, the same arrangement `Player.shotOptions` uses and for the same
   * reason — it is passed on the one path that runs on every frame of every
   * round.
   */
  private readonly drive: DriveInput = {
    throttle: 0,
    steer: 0,
    aimYaw: 0,
    aimPitch: 0,
  };
  /**
   * Who is telling which hull what to do, asked once per hull per frame by
   * `VehicleSystem.update`.
   *
   * **This file is the only place that can answer**, because it is the only
   * place that knows both about the player's seat and about the bot crews —
   * which is the same reason `driving` lives here. Built once and held, so the
   * lookup on the one path that runs every frame of every round allocates
   * nothing.
   *
   * The player is asked FIRST, and that ordering is not arbitrary: `evict`
   * takes a crew out of a hull on the frame the player mounts it, but a crew
   * disbanded and a seat taken are two writes and this is read between them on
   * exactly nothing. Asking the player's hull first means the answer is right
   * whichever order they land in.
   */
  private readonly vehicleOrders: VehicleOrders = {
    driveFor: (tank) =>
      tank === this.driving ? this.drive : this.crew.driveFor(tank),
    /**
     * In a netplay round every hull but the one under this player is posed
     * from the wire — the mirror of the authority's own answer, where only the
     * hulls with a PERSON in them are.
     *
     * Asked before `driveFor` by `VehicleSystem.update`, so the player's own
     * hull needs no term here: `stateFor` answers null for it, because
     * `NetVehicles` skips the samples for a hull carrying the local slot.
     */
    remoteFor: (tank) =>
      this.net && tank !== this.driving
        ? this.net.vehicles.stateFor(this.vehicles.tanks.indexOf(tank))
        : null,
  };

  /**
   * The offer `updateOnFoot` makes when the player is stood beside their own
   * armour, rewritten in place. Held for `drive`'s reason: it is answered on
   * every frame of every round a body spends on foot.
   */
  private readonly seat: Seat = { tank: null!, crewed: false, label: "" };

  /** Scratch for putting a hull the wire has just named back on the field. */
  private readonly hullPlace = new Vector3();
  /** Scratch for the shell: the muzzle, the gun's axis, and the marker's point. */
  private readonly shellFrom = new Vector3();
  private readonly shellDir = new Vector3();
  /** …and for where a rocket leaves the tube, or a mine goes down. */
  private readonly ordnanceAt = new Vector3();
  /** …and the line a launcher bot's rocket goes down. */
  private readonly rocketAim = new Vector3();
  private readonly markerAt = new Vector3();
  private readonly markerOut = new Vector3();
  private readonly markerViewport = new Viewport(0, 0, 1, 1);
  /**
   * What this life owes before the next one, latched by `enterDying` and spent
   * by `updateDeathCam` when the shot is over. Offline it is the config
   * constant; in a networked round it is whatever the `died` event said.
   */
  private deathRespawnIn: number = CONFIG.conquest.respawnDelay;
  /** Where the player's feet were when they died — scratch for `enterDying`. */
  private readonly deathFeet = new Vector3();
  /**
   * The round's board, OFFLINE: kills, deaths and points, one row per roster
   * SLOT.
   *
   * Per body rather than per team, because the team totals are the sum of the
   * rows and a second set of counters for them is a second set that can drift.
   * Indexed by slot rather than split between the bot pool and a pair of
   * fields for the player, which is what it was before points arrived: a human
   * holds a roster slot like everybody else (`BattleSystem.seatPlayer`) and the
   * bot sitting in it is benched, so the player's line simply IS that slot's
   * line and nothing has to reconcile a seventeenth body with a sixteen-row
   * board.
   *
   * **Netplay writes none of this.** In a match the board is the authority's
   * and arrives whole (`NetSession.slotKills`): this client runs no AI, its
   * local `BattleSystem` is a pool of dead bodies nobody steps, and a client
   * that added up the kill events it happened to receive would show a
   * different board on every screen. `scoreRows` is where the two sources
   * meet, and it is the only reader of either.
   */
  private readonly scores = new ScoreBook();

  /**
   * **The two things the game cannot start without are both arguments now, and
   * they are arguments for the same reason.** `havok` is the instantiated WASM
   * module (see `PhysicsWorld`); `engine` is a `WebGPUEngine` whose
   * `initAsync` has already resolved. Both are REQUIRED, both are awaited by
   * `main.ts` before this constructor is reached, and a failure of either is
   * the boot screen's business — so nothing in here has to be written twice
   * for a machine that never got one.
   *
   * The engine used to be built here, back when it was a `WebGLEngine` and its
   * constructor was synchronous. WebGPU's is not: an adapter and a device are
   * both `await`s. What did NOT change is that this constructor stays
   * synchronous — `Game` is not a `static async create()`, because
   * `window.__celshock` existing with every pool non-null the moment the
   * constructor returns is what ~40 smoke scripts rest on (`VERIFYING.md`).
   * Awaiting in `main.ts` and injecting the result is what keeps both of those
   * true at once, and it is the move `havok` already made.
   *
   * The MSAA and stencil arguments moved with the options they are about, and
   * are in `main.ts` beside the `initAsync` call — where there is also a note
   * on why `WebGPUEngine.CreateAsync` is not what builds this.
   */
  constructor(
    canvas: HTMLCanvasElement,
    havok: HavokInstance,
    engine: WebGPUEngine,
  ) {
    this.canvas = canvas;
    this.engine = engine;
    this.scene = new Scene(this.engine);
    this.scene.collisionsEnabled = true;
    // The scene has no Babylon lights at all: cel materials carry their own
    // key/ambient/point-light uniforms (fed by the LightingSystem) and every
    // effect material is unlit emissive.
    this.mats = new CelMaterialFactory(this.scene);
    // Stepped moon shadows + contact blobs. Must exist before any cel
    // material is created so the shadow map binds on creation.
    this.shadows = new ShadowSystem(this.scene, this.mats);
    this.input = new InputManager(canvas);
    this.cameraSys = new CameraSystem(this.scene);

    // **Draw the opaque queue front to back**, which Babylon does not do on its
    // own: its default is `PainterSortCompare`, grouping by material id and
    // leaving depth to chance. That is the right default for a scene whose cost
    // is state changes and the wrong one for this scene, whose cost is PIXELS —
    // a street of towers occludes most of itself, and a fragment is only
    // rejected before it shades if whatever stands in front of it was drawn
    // first. Ordering is the whole of the win; nothing about the picture moves,
    // because opaque draws are order-independent through the depth buffer.
    //
    // It is also what makes `backed` glazing pay (see `CelMaterialFactory
    // .getGlass`): a curtain wall only saves the shading of the shaft behind it
    // if the pane is down first, and by material id it would be a coin toss.
    //
    // The comparator is ours rather than `RenderingGroup.frontToBackSortCompare`
    // because that one reads `subMesh._distanceToCamera`, which Babylon fills in
    // only on the transparent path. Cost is two bounding-sphere reads per
    // comparison over a couple of hundred submeshes — microseconds, against the
    // fill it is buying back.
    this.scene.setRenderingOrder(0, (a, b) => {
      const eye = this.scene.activeCamera?.globalPosition;
      if (!eye) return 0;
      return eyeDistanceSq(a, eye) - eyeDistanceSq(b, eye);
    });

    // Post-processing: FXAA smooths the hard cel/outline edges. Glow comes
    // from a GlowLayer rather than threshold bloom — it keys off material
    // emissive color, so neon/reticle/tracer meshes bloom while bright
    // non-emissive surfaces stay crisp.
    const g = CONFIG.graphics;
    const pipeline = new DefaultRenderingPipeline("post", false, this.scene, [
      this.cameraSys.camera,
    ]);
    // The cel shader outputs display-ready colors; the default image
    // processing pass would re-apply gamma and wash them out.
    pipeline.imageProcessingEnabled = false;
    pipeline.fxaaEnabled = true;
    const glow = new GlowLayer("glow", this.scene, {
      blurKernelSize: g.glowKernel,
    });
    glow.intensity = g.glowIntensity;
    // The bloom is the ONE pass that reads a material and never asks where the
    // mesh carrying it stands, so without this a glow is the last thing left
    // when everything around it has gone to fog: Greyfen's chapel windows are
    // 0.08 m slivers whose whole read at 60 m is bloom, and they sat on a wall
    // faded almost to white as three saturated cyan bars. Fogging the emissive
    // MATERIAL cannot fix it — the glow map is generated from the emissive
    // colour directly, so the base pass and the bloom have to be attenuated
    // separately, and the bloom is by far the larger term.
    //
    // This replaces Babylon's own selector wholesale, so it owes the default's
    // two other behaviours: `emissiveIntensity`, and the neutral colour for a
    // material with no emissive at all (every cel ShaderMaterial in the scene
    // reaches here, since the layer holds everything not explicitly excluded).
    // It does NOT reproduce an emissive texture's `level`, which is sound only
    // while nothing in this game pairs a texture with a glow — the moon is the
    // one textured emissive and it is exempt below.
    //
    // `infiniteDistance` is the exemption and it is exactly the right test:
    // every sky mesh sets it (see Sky.prepare), it means "this rides with the
    // camera", and the moon is the one glowing thing that must never fog — it
    // is not in the valley, and its bounding sphere is a dome radius away, so
    // any distance fade would delete it outright.
    glow.customEmissiveColorSelector = (mesh, _subMesh, material, result) => {
      // The kit screen hangs a dark card behind the weapon (see
      // `inspect.backdrop`), and the one thing in the game that card cannot
      // cover is this: a glow layer is composited over the FINISHED frame, so
      // a lamp the bench is standing in front of blooms straight through it.
      // Only what is on the stage may bloom while the stage is up, which
      // still leaves the reticle and the hot parts of the weapon itself
      // glowing — exactly what the screen is for. "On the stage" is the
      // viewmodel's rendering group MINUS the sky, which shares it (see
      // `Sky`'s constructor) and is picked back out by the same
      // `infiniteDistance` the fog exemption below turns on: without that
      // second half the moon hangs its bloom over the bench.
      if (
        this.state === "loadout" &&
        (mesh.renderingGroupId !== VIEWMODEL_GROUP || mesh.infiniteDistance)
      ) {
        result.set(0, 0, 0, material.alpha);
        return;
      }
      const emissive = (material as StandardMaterial).emissiveColor;
      if (!emissive) {
        const n = glow.neutralColor;
        result.set(n.r, n.g, n.b, n.a);
        return;
      }
      // Read off the base Material: only PBR declares it, and this selector
      // runs for whatever the layer holds.
      const level =
        (material as { emissiveIntensity?: number }).emissiveIntensity ?? 1;
      let k = level;
      if (!mesh.infiniteDistance) {
        // The sphere's CENTRE, deliberately — not the near point
        // `updateOutlineScales` thins width by. A bloom is a soft blob with no
        // edge to speak of, so its middle is where it reads from; the near
        // point of a block-merged mesh (the chapel's six windows are one, 8.5 m
        // of radius) sits a whole radius early and fogged them by 16% where the
        // wall behind was at 35%. Every glowing mesh here is a fitting or a
        // window, so a centre is never far from the light it stands for.
        const sphere = mesh.getBoundingInfo().boundingSphere;
        const d = Vector3.Distance(
          sphere.centerWorld,
          this.cameraSys.camera.globalPosition,
        );
        k *= 1 - fogAmountAt(d);
      }
      result.set(emissive.r * k, emissive.g * k, emissive.b * k, material.alpha);
    };
    this.glow = glow;
    // Moon shafts read the finished frame and add light back into it, so they
    // come after FXAA and before the grade — the vignette and grain have to
    // land on top of the beams, not under them.
    this.godRays = new GodRays(this.scene);
    // Attached here rather than by the pass itself, so the slot it lands in is
    // known: `syncGodRays` takes it off and puts it back in the same hole all
    // round, and Babylon has no way to ask where a pass used to be.
    this.godRaysSlot = this.cameraSys.camera.attachPostProcess(
      this.godRays.pass,
    );
    // Then the look smears, with the shafts already in the frame — they belong
    // to the same instant as the geometry, so they have to blur with it.
    this.motionBlur = new MotionBlur(this.scene, this.cameraSys.camera);
    // Vignette/grain/aberration go last, over the finished frame. Grain in
    // particular has to land AFTER the blur: smeared grain reads as smudge.
    this.post = new HorrorPost(this.scene, this.cameraSys.camera);
    this.sfx = new Sfx();
    this.hud = new HUD();
    // After the HUD: its root is the element every screen appends to.
    this.overlayScreen = new OverlayScreen();
    this.deployScreen = new DeployScreen();
    this.loadoutScreen = new LoadoutScreen();
    this.settingsScreen = new SettingsScreen(this.settings);
    this.lobbyScreen = new LobbyScreen();
    this.minimap = new Minimap();
    this.touch = new TouchControls();
    this.lighting = new LightingSystem();
    this.atmosphere = new Atmosphere(this.scene);
    // `mats` is not for building materials here — both systems own their own
    // shader. It is the publisher of the shadow map, its matrix and its params,
    // which both now sample (see `celShadow`).
    this.water = new WaterSystem(this.scene, glow, this.mats);
    this.grass = new GrassSystem(this.scene, glow, this.mats);
    // Same relationship to `mats` as the two above, in the other direction:
    // this one PUBLISHES to it — the cube the glazing samples, baked from the
    // map itself. Built here so a pane material is born holding the sampler.
    this.reflections = new ReflectionSystem(this.scene, this.mats);
    // Takes over `scene.getActiveMeshCandidates`, and offers the WHOLE scene
    // until a map is installed — so where in this constructor it stands
    // decides nothing: it rebuilds its list off `scene.meshes` wholesale the
    // first time it is asked, and the scene's own observables only ever set a
    // flag. Nothing it does is visible to a ray, a collision, a shadow caster
    // or a cube probe; see `WorldCulling`, which is the whole argument.
    this.culling = new WorldCulling(this.scene);
    this.mapBuilder = new MapBuilder(this.scene, this.mats, this.lighting);
    this.combat = new CombatSystem(this.scene, this.mats);
    this.grenades = new GrenadeSystem(this.scene, this.mats);
    // The one physics engine, and its three clients. `PhysicsWorld` is INJECTED
    // into both rather than imported by either — see its header, and the
    // `BattleSystem`←`CombatSystem` precedent in CLAUDE.md. It is stood up
    // synchronously on the module `main.ts` already awaited, so both clients
    // build their pools in their own constructors and nothing below ever has
    // to ask whether physics has arrived yet.
    this.physics = new PhysicsWorld(this.scene, havok);
    this.ragdolls = new RagdollSystem(this.scene, this.physics);
    this.debris = new DebrisSystem(this.scene, this.mats, this.physics);
    this.blastDebris = new BlastDebrisSystem(this.scene, this.mats, this.physics);
    this.glass = new GlassSystem();
    this.deathCam = new DeathCam(this.scene, this.mats);
    this.vehicles = new VehicleSystem(this.scene, this.mats);
    this.vehicleCam = new VehicleCamera();
    // The crew's context, built once exactly as `BattleSystem`'s `BattleCtx`
    // is: everything a driver may ask about the rest of the game, and nothing
    // else. The two lists are asked for rather than captured, because what
    // `vehicles` and `battle` hand out is replaced every round.
    this.crew = new TankCrew({
      hulls: () => this.vehicles.tanks,
      roster: () => this.battle.bots,
      aside: (bot) => this.battle.aside(bot),
      setOccupied: (tank, on) => this.vehicles.setOccupied(tank, on),
      exitSpot: (tank) => this.vehicles.exitSpot(tank),
      targetsFor: (team) => this.battle.hittablesAgainst(team),
      // The hull is taken out of its own pick for the length of the ray, which
      // is `VehicleCamera`'s trick and `VehicleSystem.groundAt`'s: a crew's
      // eye sits five centimetres above the top of its own collider, so every
      // sightline to anything shorter than the cupola dives straight back into
      // it. Two property writes and no allocation — `world/solid.ts` forbids
      // minting a predicate that closes over the hull, and this is a per-think
      // call.
      visibleFrom: (tank, to) => {
        const was = tank.body.isPickable;
        tank.body.isPickable = false;
        const seen = this.battle.losBetween(tank.eyePos, to);
        tank.body.isPickable = was;
        return seen;
      },
      fireShell: (tank, by) => this.resolveShell(tank, by),
    });
    // The anti-tank kit in the world. It owns the flight and the trigger and
    // nothing else: what a detonation is WORTH is `ordnanceEffect`'s and
    // spending it is `wireAntiTank`'s, through the same `blastAt` the tank
    // shell already goes through.
    this.antiTank = new AntiTankSystem(this.scene, this.mats);
    this.aimAssist = new AimAssistSystem();
    this.battle = new BattleSystem(this.scene, this.mats, this.combat);
    this.conquest = new ConquestSystem();
    this.zones = new CaptureZoneSystem(this.scene, glow);
    // The weapon is parented to the camera, so the camera has to exist first.
    this.player = new Player(this.scene, this.mats, this.cameraSys.camera);
    this.player.setBodyHidden(true); // hidden until a round starts
    for (const m of this.scene.meshes) {
      if (m.metadata && m.metadata.noGlow === true) glow.addExcludedMesh(m as Mesh);
    }
    // The sky hangs behind every state (menu included), so it is dressed
    // once here and re-applied per round alongside the environment.
    this.sky = new Sky(this.scene, glow);
    this.applySky();

    // Everything above is CONSTRUCTION, and stays here because the fields it
    // assigns are what `strictPropertyInitialization` checks. Everything below
    // is wiring, and lives in a named method so a change has an obvious
    // destination — see `wireSystems` for the rule they all serve.
    this.wireSystems();
    this.installDomListeners(canvas);
    this.wireScreens();
    // Apply the remembered kit before anything is drawn: the viewmodel is
    // built with the defaults and the camera's zoom follows from the fit, so
    // deploying straight off a reload must not start on the wrong weapon.
    this.applyLoadout();
    // …and the remembered display settings, for the same reason: the blur is
    // attached by its own constructor, so a stored "off" has to be applied
    // before the first frame rather than on the first visit to the screen.
    this.applySettings();
    this.showMenu();
    // Debug/test handle (used by automated smoke tests).
    (window as unknown as { __celshock: Game }).__celshock = this;
    this.joinFromUrl();
    this.engine.runRenderLoop(() => this.tick());
  }

  /**
   * Installs every cross-system callback. **This is the wiring rule's one
   * home**: systems never import each other, so anything one has to tell
   * another is a callback assigned here or in one of the four methods below.
   *
   * Split by SUBJECT rather than by system, because that is how a change
   * arrives — a grenade behaviour is `wireGrenades`, a death is
   * `wireDeaths`. Order is irrelevant: these are property assignments on
   * objects the constructor has already built, and none reads another.
   */
  private wireSystems(): void {
    // Systems never import each other; every cross-system behaviour is a
    // callback installed here.
    this.player.onDamaged = (amount, died, from, kind) =>
      this.onPlayerDamaged(amount, died, from, kind);
    this.battle.setPlayer(this.player);
    // A bot's round killed somebody. The two halves are taken separately
    // because they are known in different places: the shooter is credited
    // whoever it hit — including the player, which is the one kill on the board
    // a bot used to be denied — while the ticket, the killfeed line and the
    // corpse are owed only when a BOT fell. The player's own death goes through
    // `onPlayerDamaged`, which `takeDamage` reached before this callback ran.
    this.battle.onBotKill = (victim, by) => {
      this.creditKill(by, victim);
      if (victim instanceof Bot) this.registerBotKill(victim, by.team, false);
    };
    // The score feed, OFFLINE: every body on the roster earns, and the one
    // row this screen belongs to is the filter. In a match the same feed is
    // fed by the `score` event instead, because the awards are the
    // authority's — see `onNetEvent`.
    this.scores.onAward = (slot, kind, points) => {
      if (slot === this.battle.playerSlot) this.hud.addScore(kind, points);
    };
    this.wireDeaths();
    this.wireGrenades();
    this.wireBattle();
    this.wireConquest();
    this.wireVehicles();
    this.wireAntiTank();
  }

  /**
   * The anti-tank kit: what a rocket or a mine may find, and what happens when
   * it finds it.
   *
   * **Two halves, and the split is the whole design.** `AntiTankSystem` knows
   * where a rocket is and how long a mine has been armed; it does not know
   * what a tank is, what a team means beyond passing one back out, or what an
   * explosion looks like. So it asks one question — is there a hostile hull
   * within this many metres — and raises one event, and both of them land
   * here.
   *
   * **The damage is TWO resolutions and they cannot double-count a kill**, the
   * same arrangement `fireShell` makes and for the same reason: `hittablesFor`
   * is fetched INSIDE `blastAt`, after the direct hit has been dealt, so a
   * hull finished by the strike is no longer `alive` and no longer in the
   * list. What it does mean is that a hull takes both — a direct hit and the
   * splash it is standing in the middle of — which is exactly what being hit
   * by a rocket is.
   */
  private wireAntiTank(): void {
    // Hostile by construction: the team passed is the ordnance's own, and
    // `hostileNear` answers with the OTHER side's hulls only. That is where
    // friendly fire is excluded on this path — the same bargain the target
    // lists make everywhere else in this game.
    this.antiTank.hullNear = (at, radius, team) =>
      this.vehicles.hostileNear(at, radius, team);
    this.antiTank.onDetonated = (hit) => this.resolveOrdnance(hit);
  }

  /**
   * One rocket or one mine going off: the hull it struck, then the blast.
   *
   * `hit.at` is the system's own live vector and is valid for the length of
   * this call — `blastAt` clones what it keeps, and nothing here holds it.
   */
  private resolveOrdnance(hit: OrdnanceHit): void {
    // **In a match none of this is ours.** The rocket that reached here is the
    // local PREDICTION of one the authority is also flying — see
    // `launchRocket` — and it decides nothing: the hull refuses local damage
    // (`Tank.predicted`), the splash has an empty list to resolve against, and
    // the fireball arrives on the server's `explode` event with the right
    // power on it. Drawing one here as well would be two blasts a round trip
    // apart, at two points that agree only to within the flight — which for a
    // rocket that detonated on a hull this client has drawn a tenth of a
    // second behind is metres, not centimetres. `resolveShell` skips its own
    // splash for the same reason and in the same words.
    if (this.net) return;
    const e = ordnanceEffect(hit.kind);
    // The direct hit, which is the thing a falloff cannot express: a rocket
    // that stopped ON a hull, or a mine a hull drove over. `shell` is what
    // gets through `CONFIG.vehicles.tank.resist`, and it is the whole reason
    // this kit exists.
    if (hit.hull) hit.hull.takeDamage(e.damage, hit.at, "shell");
    // …and the splash, through the one implementation of a blast in the game.
    // `by` is whoever fired it, so a kill lands on their row exactly as a
    // grenade's does — `wireGrenades` is already wired for this and needed no
    // arm.
    this.grenades.blastAt(hit.at, hit.team, hit.by, {
      radius: e.blast.radius,
      inner: e.blast.inner,
      damage: e.blast.damage,
      kind: "shell",
      power: e.blast.power,
    });
  }

  /**
   * The armour: what a destroyed hull owes the body inside it, and what a fresh
   * one owes the screen.
   *
   * Both are one-way announcements out of a system that has never heard of a
   * player — the same shape `wireGrenades` uses for a blast, and for the same
   * reason.
   */
  private wireVehicles(): void {
    this.vehicles.onDestroyed = (tank) => {
      if (tank.team === this.player.team) {
        this.hud.toast(
          `ARMOUR DESTROYED - ${Math.round(CONFIG.vehicles.respawnDelay)}s`,
        );
      }
      // The hull burning is not the same event as the crew dying, and only one
      // of the two is conditional: everybody hears the toast, and the body is
      // only killed if it was the one inside THIS hull.
      // A bot crew burns with the hull exactly as the player does, and the
      // two are mutually exclusive by construction: `Tank.occupied` is written
      // on both transitions, so nobody can be in a hull somebody else is in.
      this.crew.hullDestroyed(tank);
      if (tank !== this.driving) return;
      // **In a match none of the rest is this client's.** The authority put
      // this body down beside the wreck and killed it before this frame ever
      // ran: the `seat` event is what takes the camera off the hull and the
      // `damage`/`died` pair is what raises the death cam, exactly as they do
      // for a round through the chest. Running the three lines below as well
      // would place the body a second time, charge a local ticket and start a
      // respawn clock the server already owns.
      if (this.net) return;
      // Beside the wreck, not inside it — the death cam stands a corpse at the
      // player's last position, and a body falling through a hull that is still
      // solid is the one thing this ordering exists to avoid. Then the kill
      // goes through `takeDamage`, which is the one door a death offline takes:
      // it is what charges the ticket, files the row and raises the cam.
      //
      // **The hull BREWING UP is the blow, and saying so is what fixes three
      // things at once** — this is the same event `onCrewLost` spends on a bot
      // crew below and the two must say the same thing about it. `tank.center`
      // is where it came from, so the corpse is thrown clear of its own wreck
      // rather than lying down beside it and the damage arc points at the
      // thing that killed them; `"shell"` is what it was, so a driver burned
      // out of a hull leaves the ground exactly as anyone else caught by an
      // explosion does; and the bearing is also what `onPlayerDamaged` derives
      // the KILLFEED from, which without one read `OUT OF BOUNDS killed YOU` —
      // the leash's line, on a death the leash had nothing to do with. Nobody
      // can destroy their own side's hull (every list a shell, a rocket and a
      // mine resolve against is the other team's by construction), so the
      // enemy team that line names is right by the same derivation every other
      // death uses.
      this.player.placeAt(this.vehicles.exitSpot(tank));
      this.clearVehicle();
      this.player.takeDamage(this.player.health, tank.center, "shell");
    };
    this.vehicles.onRespawned = (tank) => {
      if (tank.team === this.player.team) this.hud.toast("ARMOUR READY");
    };
    // What being in a hull COSTS a bot, applied here rather than inside
    // `TankCrew` for the reason every cross-system consequence is applied
    // here: that system owns the pairing and `BattleSystem` owns the roster,
    // and neither may reach for the other. It is the same pair of lines
    // `mount`/`clearVehicle` spend on the player, one layer along.
    this.crew.onBoarded = (bot) => this.battle.setCrewed(bot, true);
    this.crew.onLeft = (bot) => this.battle.setCrewed(bot, false);
    // …and what it costs him when it burns. The body has already been put down
    // beside the wreck and handed back to the fight by the time this runs, so
    // there is nothing to do but kill it through the door every other bot
    // death offline takes — which is what charges the ticket, files the row
    // and offers the corpse to the ragdoll pool.
    //
    // `tank.center` as the bearing the blow came from and `"shell"` as what it
    // was: a crewman is thrown clear of his own hull, which is the only reading
    // of a burning tank that is not a man lying down beside one, and it takes
    // BOTH to get it — the bearing alone would have him fold at the wreck's
    // edge, because a round drops a body where an explosion throws it. The
    // player's half of this event is in `onDestroyed` above and passes the same
    // pair; they are one thing happening to whoever was inside.
    this.crew.onCrewLost = (bot, tank) => {
      if (bot.takeDamage(bot.hp, tank.center, "shell")) {
        this.registerBotKill(bot, OTHER_TEAM[bot.team], false);
      }
    };
  }

  /**
   * Corpses: where a fallen body's shadow goes, and how the death cam borrows
   * the same ragdoll pool every bot goes through.
   */
  private wireDeaths(): void {
    // A corpse under physics is metres from where its feet were when it died,
    // and `Bot.position` stops updating at that moment — so the body itself
    // has to say where its shadow goes. Only the ragdoll system knows; every
    // other dead bot answers 0 and keeps the old no-shadow behaviour.
    // The player answers through the death cam's stand-in body rather than
    // through itself, for the same reason and with the same result: `Player`
    // has no rig to have fallen anywhere, and the corpse does.
    this.shadows.corpseShadow = (cbt, out) => {
      const subject =
        cbt instanceof Bot
          ? cbt
          : cbt === this.player
            ? this.deathCam.subject
            : null;
      const strength = subject ? this.ragdolls.shadowFor(subject, out) : 0;
      if (strength > 0) out.y = this.standableAt(out.x, out.z, out.y);
      return strength;
    };
    // The death cam offers and retires its body through the same pool every
    // bot goes through — a callback rather than an import, because a system
    // may not reach into another one.
    //
    // It used to pass a `priority` flag here, the one place it was allowed,
    // so a pool held by four bot corpses could not spend the cam's four
    // seconds on a body standing to attention. Every offer evicts the oldest
    // corpse now, and the cam's body is the freshest in the pool for the whole
    // shot — so it is protected by the ordering rather than by a flag. See
    // `RagdollSystem.takeSlot`.
    this.deathCam.onSpawnRagdoll = (corpse) =>
      this.ragdolls.spawn(corpse, this.cameraSys.camera.position);
    this.deathCam.onRetireRagdoll = (corpse) => this.ragdolls.retire(corpse);
  }

  /**
   * The one non-hitscan weapon: who a blast may hurt, and what a hit reports.
   */
  private wireGrenades(): void {
    // Grenades resolve their blast against the thrower's own target list, the
    // same way a bullet does — so friendly fire is excluded by construction
    // here too, and this system never learns what a team is.
    this.grenades.hittablesFor = (team) => this.battle.hittablesAgainst(team);
    // Netplay: the blast belongs to the authority and arrives as an `explode`
    // event, which reaches the thrower like everybody else. The local copy is
    // the ARC — the thing the thrower watched leave their hand — and firing
    // this as well would flash, bang and shake twice, a fraction of a second
    // apart, at two points that agree only to within the round trip.
    this.grenades.onExploded = (at, power, ground) => {
      if (!this.net) this.onExplosion(at, power, ground);
    };
    this.grenades.onBlastHit = (victim, thrower, by, killed) => {
      // "Was that ours" is a comparison against our own `Player`, which is why
      // the grenade carries the thrower rather than a flag saying so — that
      // system has no way to know what a player is.
      const byPlayer = by === this.player;
      // The killer's row, whoever fell, and before the victim filter below:
      // a blast that finishes the player is still a kill somebody threw.
      if (killed) this.creditKill(by, victim);
      // The player's own death is already handled, all the way down to the
      // deploy screen, by `onPlayerDamaged` — `takeDamage` routed it there
      // before this callback ran. Only bots are this handler's business.
      if (!(victim instanceof Bot)) return;
      if (byPlayer) this.hud.flashHitmarker(killed);
      if (killed) this.registerBotKill(victim, thrower, byPlayer);
    };
    // A bot asking for a grenade on a position. The arm has the last word — a
    // solve it cannot make returns false and the bot spends nothing.
    this.battle.throwGrenadeFor = (bot, from, at) =>
      this.grenades.throwAt(from, at, bot.team, bot);
    // A launcher bot's rocket. Flat: the ask is a POINT and a rocket flies
    // more or less straight, so unlike the grenade there is no solve to
    // refuse — the direction is the line to the hull and the pool has the only
    // word. `considerRocket` has already decided the target is armour.
    this.battle.fireRocketFor = (bot, from, at) => {
      this.rocketAim.copyFrom(at).subtractInPlace(from);
      if (this.rocketAim.lengthSquared() < 1e-4) return false;
      this.rocketAim.normalize();
      if (!this.antiTank.launch(from, this.rocketAim, bot.team, bot)) return false;
      // Heard exactly as the player's launcher is, and by the same door: a
      // rocket leaving is the loudest thing on the map after a tank gun, and
      // the side that fired it has just told everybody where it is.
      this.battle.hearGunshot(from, bot.team);
      this.sfx.launcher(from);
      return true;
    };
  }

  /**
   * What the bots need from the rest of the game: their sounds, their spawns,
   * their squad orders, and what standing on a flag means to them.
   */
  private wireBattle(): void {
    // Bots fire constantly and all over the map, so their shots are
    // spatialised and voice-capped rather than played flat like the player's.
    this.battle.onBotFired = (bot, at) => {
      this.sfx.botShot(at);
      // Gunfire gives an enemy away on the minimap for a couple of seconds.
      if (bot.team !== this.player.team) this.minimap.reveal(bot);
    };
    // A bot reloading is a window the player can push into, so it has to be
    // audible. Spatialised for the same reason bot fire is.
    this.battle.onBotReloaded = (bot) => this.sfx.botReload(bot.position);
    // Boots, from bots close enough for them to carry. `Sfx.botStep` rejects
    // the rest on distance — this fires for all 16 of them, so nothing
    // upstream should do work per step.
    this.battle.onBotStepped = (bot) => this.sfx.botStep(bot.position);
    // A round cracking past is a cue, not a hit. CombatSystem finds these
    // inside the target loop it already runs per shot, and has no business
    // knowing what a bot is — so the routing happens here.
    // The same event is the player's only warning that the rounds are meant
    // for them: a bot's report is spatialised and late, but the round itself
    // goes supersonic past the ear first. `suppress` ignores anything that
    // isn't a bot, so both handlers can take every near miss.
    // `at` is CombatSystem's scratch vector — `suppress` keeps only `from`
    // and `nearMiss` reads it inside the call, so nothing outlives it here.
    this.combat.onNearMiss = (near, from, at) => {
      this.battle.suppress(near, from);
      if (near === this.player) {
        this.sfx.nearMiss(at);
        this.player.suppress();
      }
    };
    // A round arriving. Routed here rather than called directly for the same
    // reason the near miss is: `CombatSystem` fires the player's rounds and
    // all sixteen bots' and has no business knowing what `Sfx` is. Every gate
    // on this — distance, rate, the voice reserve — is on the far side, with
    // the budget it protects.
    this.combat.onImpact = (at, kind) => this.sfx.impact(at, kind);
    // The segment a round flew, offered to the glass. Every round from every
    // shooter comes through here, so the sweep is bounded on the far side and
    // this is one call.
    //
    // **The client is authoritative over glass only when there is no server.**
    // In a netplay round its own shot is a prediction: the pane goes and the
    // shards fly at once, and the collider is left standing until the
    // authority's `glass` event confirms it. Bots' rounds in a netplay round
    // decide nothing at all here — a bot on this side is a body being drawn,
    // and `BattleSystem` is not stepped in a match.
    this.combat.onShotPath = (origin, dir, dist) => {
      this.glass.shoot(origin, dir, dist, !this.net);
    };
    // A pane going in: the crack, and the shards. `at` is the crossing point
    // and `dir` the round's own direction, which is what throws them — but the
    // burst is cut from the PANE, so the sheet is what it is handed. The map is
    // where that comes from rather than the event, because the pane's index is
    // its identity on both sides of the wire and its geometry is the map's.
    this.glass.onBreak = (pane, at, dir) => {
      this.sfx.impact(at, "glass");
      const geom = this.map?.panes[pane];
      if (geom) this.debris.burst(geom, at, dir, this.cameraSys.camera.position);
    };
    this.battle.spawnPointFor = (bot) => this.spawnPointFor(bot.team);
    // Squad orders are planned as a group, so squads can be spread across
    // objectives — or deliberately stacked on the one that decides the round.
    this.battle.planSquads = (team, centroids, previous) =>
      this.conquest.planSquads(team, centroids, previous);
    // A bot is "on" a flag only when it is the one it was sent to. Whether that
    // means contesting it or holding it is the squad's posture.
    this.battle.zoneFor = (bot) => {
      const p = this.conquest.pointAt(bot.position);
      if (!p || p.def.id !== bot.objective) return "none";
      return bot.defending && p.owner === bot.team ? "hold" : "contest";
    };
  }

  /**
   * Flags changing hands, and the two ways the player is told about it.
   */
  private wireConquest(): void {
    this.conquest.onCaptured = (point, by) => {
      this.awardZone(point, by, "capture");
      if (by === this.player.team) this.sfx.capture();
      else this.sfx.flagLost();
      const who = CONFIG.teams[by].name.toUpperCase();
      this.hud.showMessage(`${point.def.name.toUpperCase()} CAPTURED BY ${who}`, 2.5);
    };
    this.conquest.onNeutralised = (point, by) => {
      this.awardZone(point, by, "neutralise");
      this.hud.toast(`${point.def.name} — neutralised`);
    };
  }

  /**
   * Pays everyone of `by` standing in `point` for what the flag just did.
   *
   * **Presence at the moment it happened is the whole rule**, which is why
   * this runs from inside the conquest callback rather than off a snapshot of
   * who was there a moment ago: the meter moved because those bodies were in
   * the ring, and the ring is `pointAt` — the same test that moved it, so the
   * board cannot pay somebody the capture never counted.
   *
   * Not split between them. A squad that takes a flag in a third of the time
   * one body would has done the thing the mode is about, and dividing the
   * award would pay each of them less for doing it better.
   *
   * The dead and the benched are skipped by the same `alive` test the
   * occupancy pass uses — a benched bot is `alive = false` (see
   * `BattleSystem.setBenched`), which matters here for a sharper reason than
   * tidiness: its slot is the PLAYER's, so counting it would pay the player's
   * own row twice for one capture.
   *
   * Offline only, and by construction rather than by a gate: no client steps
   * `ConquestSystem`, so neither callback above ever fires in a match. There
   * the authority runs this same pass over its own bodies.
   */
  private awardZone(
    point: ControlPoint,
    by: Team,
    kind: "capture" | "neutralise",
  ): void {
    for (const unit of this.combatants) {
      if (!unit.alive || unit.team !== by) continue;
      if (this.conquest.pointAt(unit.position) !== point) continue;
      this.scores.award(this.slotOf(unit), kind);
    }
  }

  /**
   * The browser-facing listeners: the user gesture that unlocks audio and takes
   * the pointer, the pointer-lock transition that PAUSES the round (read the
   * block below before changing it — Escape belongs to the UA, so the
   * transition is the trigger rather than the key), resize/orientation, and the
   * dev-only F2.
   *
   * Never removed: `Game` lives as long as the page does.
   */
  private installDomListeners(canvas: HTMLCanvasElement): void {
    // Pointer lock + audio unlock must happen inside a user gesture.
    // (pointerdown, not click: Babylon may preventDefault the pointer event,
    // which suppresses the compatibility click event entirely.)
    document.addEventListener("pointerdown", (e) => {
      this.sfx.unlock();
      // Not for a finger. There is no lock to take on a touch screen, and
      // asking for one on every press of the fire button is a rejected promise
      // per shot — plus, where a browser DOES grant it, it hides the cursor a
      // phone does not have and buys nothing at all.
      if (
        e.pointerType !== "touch" &&
        e.pointerType !== "pen" &&
        !this.input.pointerLocked &&
        this.state === "playing"
      ) {
        this.requestLock();
      }
      // The touch-device equivalent of the pointer lock: on a phone opened in
      // a browser tab there is no lock to take, and the URL bar is what is
      // eating the top of the screen. No-ops on the desktop and in an
      // installed app, which comes up fullscreen from the manifest.
      enterFullscreenOnTouch();
    });

    // Losing the pointer lock is the pause trigger, and it has to be, because
    // Escape belongs to the browser: it is the UA's own gesture for dropping
    // the lock and the keydown behind it is not reliably delivered to the page.
    // This catches every way out of a locked pointer — Escape, alt-tab, a
    // focus change — which is the same set of things that should stop the
    // round. `input.pausePressed` is the second trigger, for the pad player
    // (Start) and for the keyboard player who was not locked to begin with.
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) this.lockTakenAt = performance.now();
      // A lock granted and revoked in the same beat is the browser refusing,
      // not the player leaving: the request a resume makes lands while the UA
      // still owes an Escape-exit, and it takes back what it just gave. Pausing
      // on that is how a dismissed pause menu reappeared a split second later,
      // with nothing but the browser between the two. The retry in
      // `updatePendingLock` is what carries the resume from here.
      const refused =
        performance.now() - this.lockTakenAt < CONFIG.input.lockGrace * 1000;
      // `dying` counts too. The death cam deliberately KEEPS the lock — there
      // is nothing to click, and dropping it on the way in would pause the
      // very shot it is about to show — so it has a lock to lose like any
      // other live frame, and an alt-tab out of one must hold the round.
      // …and neither is a lock the game itself gave up because the player put
      // the mouse down and reached for the screen (`pushTouchControls`). That
      // is the one hand-over that looks exactly like an alt-tab from here.
      if (
        !locked &&
        this.hadPointerLock &&
        !refused &&
        !this.input.touchActive &&
        (this.state === "playing" || this.state === "dying")
      ) {
        this.pause();
      }
      this.hadPointerLock = locked;
    });
    window.addEventListener("keydown", () => this.sfx.unlock(), { once: true });
    // Through `applyRenderScale` rather than straight to `engine.resize`,
    // because `devicePixelRatio` is not a constant: it changes when a window
    // crosses to a monitor with a different density and when the page is
    // zoomed, and the scaling level is computed from it. Setting the level
    // resizes as a side effect, so nothing is lost by going the long way.
    window.addEventListener("resize", () => this.applyRenderScale());
    // A phone turned on its side reports the rotation before it has finished
    // laying the page out, so the resize that rides along with it can carry
    // the old dimensions — leaving the canvas stretched across a viewport it
    // no longer matches. The second, late resize is the one that lands.
    window.addEventListener("orientationchange", () => {
      this.applyRenderScale();
      window.setTimeout(() => this.applyRenderScale(), 300);
    });

    // The map editor is a development tool: the whole of src/editor is behind
    // a dynamic import so none of it reaches a production bundle.
    if (import.meta.env.DEV) {
      window.addEventListener("keydown", (e) => {
        if (e.code === "F2") {
          e.preventDefault();
          void this.toggleEditor();
        }
      });
    }
  }

  /**
   * The interface talking back: every screen's callbacks into `Game`.
   *
   * These are the only route from a click to a state change, which is why the
   * Deploy handlers are guarded on the state rather than trusted — the markup
   * they are bound to is thrown away and rebuilt around them.
   */
  private wireScreens(): void {
    this.overlayScreen.onDifficulty = (tier) => this.setDifficulty(tier);
    this.overlayScreen.onMap = (index) => this.setMap(index);
    this.overlayScreen.onOpenLoadout = () => this.openLoadout();
    // The menu's and the round-over card's Deploy button. Guarded on the state
    // rather than trusted, because the overlay's markup outlives neither: the
    // handler is bound to a button that `hideOverlay` throws away, and a click
    // landing between that and the next repaint must not start a second round.
    this.overlayScreen.onStart = () => {
      if (this.state === "menu" || this.state === "roundover") this.startRound();
    };
    this.deployScreen.onOpenLoadout = () => this.openLoadout();
    this.loadoutScreen.onWeapon = (id) => this.setWeapon(id);
    this.loadoutScreen.onSight = (id) => this.setSight(id);
    this.loadoutScreen.onFinish = (id) => this.setFinish(id);
    this.loadoutScreen.onEquipment = (id) => this.setEquipment(id);
    this.loadoutScreen.onClose = () => this.closeLoadout();
    this.player.onCarryChanged = () => this.applyCarry();
    // A reload beginning, however it began — the key, or the last round leaving
    // the magazine inside `tryShot`. The clacks are keyed to the gesture's own
    // length, and in a match the authority is told so that the people around
    // this player hear the magazine change: a reload is the cue to push, and
    // it is the one thing a person does that the server has no way to derive.
    this.player.onReload = () => {
      this.sfx.reload(this.player.reloadTime, this.player.report);
      this.net?.sendReload();
    };
    // The controls talk to `InputManager` rather than to `Game`: they are a
    // DEVICE, and the one thing on them that is not input is the pause button.
    // A phone has no Escape key, so that button is the only way off a round —
    // guarded on the state like the Deploy handlers above, because the layer it
    // is drawn on outlives none of them.
    this.input.setTouchSource(this.touch);
    this.touch.onPause = () => {
      if (this.state === "playing") this.pause();
    };
    this.overlayScreen.onOpenSettings = () => this.openSettings();
    this.overlayScreen.onOpenMultiplayer = () => this.openLobby();
    this.settingsScreen.onChange = (key, value) => this.setSetting(key, value);
    this.settingsScreen.onClose = () => this.closeSettings();
    // The row's own map and its own SERVER travel with its id: a match is
    // played on the map it is running and joined where it is running, and the
    // row the player picked is where both are already known. A match id is
    // minted per process, so the region is not decoration on this call — `m1`
    // exists in every region, and an id alone would open a socket to whichever
    // server this client last spoke to.
    this.lobbyScreen.onJoin = (regionId, matchId, mapId) =>
      this.joinMatch({ regionId, matchId, mapId });
    // A new match is the one join that DOES take this client's map and its
    // chosen region — the two picker rows on that screen — and `joinMatch`
    // sends the map for the server to spend on the match it builds.
    this.lobbyScreen.onCreate = () => this.joinMatch({ create: true });
    this.lobbyScreen.onPickRegion = (index) => this.setRegion(index);
    this.lobbyScreen.onPickMap = (index) => this.setMap(index);
    this.lobbyScreen.onRefresh = () => void this.refreshLobby();
    this.lobbyScreen.onClose = () => this.closeLobby();
    this.overlayScreen.onPauseAction = (action) => {
      // Restart needs nothing put back by hand: `startRound` lifts the lid,
      // hides the overlay and ends in `enterDeploy`, which sets the state.
      if (action === "resume") this.resume();
      else if (action === "settings") this.openSettings();
      else if (action === "restart") this.startRound();
      else this.enterMenu();
    };
    // Guarded for the same reason `onStart` is, and it is the weaker of the
    // two: `spawnPlayer` sets the state outright, so a click that arrives from
    // under a screen raised over the deploy map would drop the player into the
    // world with that screen still up. The kit and settings scrims both take
    // pointer events across their whole area today, so nothing currently gets
    // through — which is a property of two stylesheets rather than of this
    // wiring, and is not what the guard should rest on.
    this.deployScreen.onDeploy = (spawn) => {
      if (this.state !== "deploy") return;
      // In a netplay round this is a REQUEST and not a deployment. The
      // authority owns the body: it decides whether that spawn is still one
      // this team may use and when the reinforcement clock allows it, and the
      // `spawn` event it answers with is what actually puts the player in the
      // world — through the same `spawnPlayer` this line calls offline. Putting
      // them there here as well would be the client deciding an outcome, and
      // the outcome it would decide is the one thing on this screen the server
      // cannot afford to have a second opinion about: where somebody is.
      if (this.net) {
        this.net.sendDeploy(this.conquest.spawnIndex(spawn));
        this.deployScreen.setPending();
        return;
      }
      this.spawnPlayer(spawn);
    };
  }


  /**
   * Dresses the sky and hands the moon shafts their colour. The two belong
   * together: the shafts are the moon's own light in the air, so they take the
   * halo's tint rather than a colour of their own, and re-applying the sky
   * without re-tinting them would leave last environment's beams in the frame.
   *
   * Called on every round start, and deliberately a no-op when the environment
   * has not changed. `Sky.apply` repaints an 8-megapixel dome (two thousand
   * stars, a galactic band, a stretched halo) and two fBm cloud masks, and the
   * sky over the same map is the same sky it was last round — unlike the map
   * itself, which genuinely has to be rebuilt. The test is object identity,
   * which is why a `MapDef` has to be a module constant; switching maps brings
   * a different spec object and repaints, as it should.
   */
  private applySky(): void {
    const env = this.mapDef.environment;
    if (this.skyEnv === env) return;
    this.skyEnv = env;
    this.sky.apply(env);
    if (env.sky) {
      const tint = Color3.FromHexString(env.sky.moonGlowColor);
      this.godRays.setTint(tint.r, tint.g, tint.b);
    }
    // The shafts' own two numbers, and this is pushed UNCONDITIONALLY where the
    // tint above is not: a map with no `sky` block draws no disc and detaches
    // the pass, but the pass is shared and the next map to attach it would
    // otherwise inherit whatever the last one set. `setRays(undefined)` is what
    // puts `CONFIG.godRays` back.
    this.godRays.setRays(env.sky?.rays);
  }

  /**
   * Redraws the menu overlay. The difficulty row is re-rendered rather than
   * patched because `showMenu` writes the whole overlay anyway — and the round
   * -over screen shares that overlay, so there is nothing to keep in sync.
   */
  private showMenu(): void {
    this.overlayScreen.showMenu({
      // The maps themselves. The card draws a schematic of the highlighted one
      // out of its layout and colours it out of its environment, and reads the
      // flag count and the extent off the same object — which is what the card
      // used to be handed separately and trusted to keep in step. Nothing about
      // a map is stated twice.
      maps: MAPS,
      selectedMap: MAPS.indexOf(this.mapDef),
      difficulties: difficultyNames(),
      selected: this.difficulty,
      weapon: this.weapon,
      sight: this.sight,
    });
  }

  /**
   * Moves the game on to a step, taking down every screen the player had raised
   * over the last one.
   *
   * The three transitions that leave a round — the menu, a round starting, F2
   * into the editor — each used to write out the same list of screens to put
   * away, and the copies had already drifted: F2 from the lobby left the match
   * list hanging over the editor's own panel, because that one list was written
   * before the lobby existed. The other twelve transitions wrote none of it and
   * were not merely untidy but broken, and only in a netplay round, where a step
   * can be decided by the wire while a lid is up: a `died` landing under the
   * settings screen used to overwrite `settings` with `deploy` and strand the
   * screen on top — visible, uncloseable (`closeSettings` guards on a state that
   * was gone), with the deploy screen live and taking input underneath it.
   *
   * So no caller decides which screens to take down. `ScreenStack.go` hands back
   * what was up and `takeDown` knows what each one means, which is the same
   * bargain the rest of this file makes with the table: the obligation is
   * discharged once, here, for screens that did not exist when it was written.
   */
  private go(step: StepState): void {
    for (const lid of this.screens.go(step)) this.takeDown(lid);
  }

  /**
   * Raises a lid, if the table says it may cover what is on screen. `false` is
   * "it may not" and every caller returns on it — the guard each `open*` used to
   * write out for itself is `ScreenSpec.covers` now.
   */
  private raiseLid(lid: LidState): boolean {
    return this.screens.raise(lid);
  }

  /**
   * Takes the named lid off, and puts its screen away with it. `false` is "that
   * is not what is on top" — the guard each `close*` used to open with.
   */
  private lowerLid(lid: LidState): boolean {
    if (!this.screens.lower(lid)) return false;
    this.takeDown(lid);
    return true;
  }

  /**
   * What putting one screen away MEANS. The elements are here rather than in
   * `ScreenStack`, which knows the names of the screens and not one of the
   * screens themselves.
   *
   * Exhaustive over `LidState`, and the `never` is what makes it so: a fifth
   * screen does not compile until it says how it comes down, and every
   * transition in the file above is then correct for it on the day it is
   * written. That is the same guarantee the table gives, spent on the half of
   * the problem that is DOM.
   *
   * Each arm undoes exactly what the matching `open*` did and decides nothing
   * else — where the game goes next is the caller's, which is why `resume` and
   * `go("menu")` can share this.
   */
  private takeDown(lid: LidState): void {
    switch (lid) {
      case "paused":
        this.overlayScreen.hide();
        this.clearPause();
        return;
      case "loadout":
        this.stowKit();
        return;
      case "settings":
        this.settingsScreen.hide();
        return;
      case "lobby":
        this.lobbyScreen.hide();
        return;
      default: {
        const unhandled: never = lid;
        throw new Error(`no way down from screen ${String(unhandled)}`);
      }
    }
  }

  /**
   * Opens the loadout screen over whatever is on top of it. Closing it puts that
   * back — the same lid-and-return shape the pause menu has, and for the same
   * reason: it is not a step in the menu -> deploy -> playing cycle, it is a
   * thing laid over two of them.
   *
   * Deliberately unreachable from `playing` and from the pause menu: a round
   * you are already standing in is not somewhere you get to change what you
   * are carrying. That is `loadout`'s `covers` in `ScreenStack.ts`, which is
   * what refuses the raise here.
   */
  private openLoadout(): void {
    if (!this.raiseLid("loadout")) return;
    this.loadoutScreen.setFit(
      this.weapon,
      this.sight,
      this.finishes[this.weapon],
      this.equipment,
      this.armourOffered,
    );
    this.loadoutScreen.show();
    // The weapon comes out to be looked at. It is the real viewmodel on the
    // real camera — the kit screen shows what will be in the player's hands,
    // not a picture of it — which is why the screen's stage half is a hole in
    // its own scrim rather than a panel.
    this.player.inspectWeapon(true);
  }

  /**
   * Puts the kit screen away — the screen, the weapon on its stage, and the
   * lamp lighting it — without saying where the game goes next.
   *
   * Every exit owes all three, and there is now exactly one — `takeDown`, which
   * every way out of the screen goes through. The lamp is the one that bites if
   * it is missed. A carried light never loses its shader slot and survives
   * `lighting.clear()` between rounds, so one left behind follows the player
   * into the fight as a lantern nobody is holding.
   */
  private stowKit(): void {
    this.loadoutScreen.hide();
    this.player.inspectWeapon(false);
    CONFIG.lighting.kitLamps.forEach((_, n) =>
      this.lighting.removeCarried(kitLampId(n)),
    );
  }

  /**
   * Raises the settings lid over the menu, the deploy screen or a pause.
   *
   * Unlike the kit screen there is nothing to pose and nothing to light: the
   * screen is DOM over whatever is already rendering, so opening it is the
   * state change and the `show`. The pause card underneath stays up on purpose
   * — the settings screen is opaque where it matters and the card returning is
   * then the same element, not a redraw.
   */
  private openSettings(): void {
    if (!this.raiseLid("settings")) return;
    this.settingsScreen.setValues(this.settings);
    this.settingsScreen.show();
  }

  private closeSettings(): void {
    if (!this.lowerLid("settings")) return;
    // The menu paints its own markup and was covered while the settings were
    // changed, so it is redrawn on the way out — the same reason
    // `closeLoadout` does it. The pause card was never taken down.
    if (this.state === "menu") this.showMenu();
  }

  /**
   * Raises the lobby over the menu, and asks the server what it is running.
   *
   * The fetch is fired here rather than by the screen, which renders what it is
   * handed and nothing else — the same split `SettingsScreen` keeps. It is not
   * awaited: the screen goes up in its loading state on this frame, and the
   * answer lands on whatever frame it lands on.
   *
   * Menu-only, unlike the settings lid. A lobby raised over a live round would
   * be offering to join a second match while standing in one.
   */
  private openLobby(): void {
    if (!this.raiseLid("lobby")) return;
    // The map row starts on whatever the menu underneath is offering — there is
    // one map choice in this game and two places it is shown, so the screen is
    // handed the standing one rather than keeping a second copy that could
    // disagree with it.
    this.lobbyScreen.setMapChoice(MAPS.indexOf(this.mapDef));
    this.lobbyScreen.show();
    void this.refreshLobby();
  }

  /**
   * The player PICKING a region: the lobby's Region row.
   *
   * The book clamps the index and decides whether anything moved; what is left
   * here is the two things it is not allowed to do — remember the pick, and
   * tell the screen. The state guard stays on this side for the reason it
   * always did: a keypress that arrives after the lid came down is not a pick.
   */
  private setRegion(index: number): void {
    if (this.state !== "lobby") return;
    const picked = this.regionBook.choose(index);
    if (!picked) return;
    writeRegion(picked.id);
    this.lobbyScreen.setRegionChoice(picked.index);
  }

  private closeLobby(): void {
    if (!this.lowerLid("lobby")) return;
    // Redrawn on the way out, for the reason `closeSettings` states: the menu
    // owns its markup and has been covered.
    this.showMenu();
  }

  /**
   * Asks every region what it is running, and hands each answer to the screen
   * as it lands.
   *
   * **Every region is asked, on every refresh, and that is what the ping column
   * is.** There is no separate probe: the list request IS the measurement —
   * same host, same path, an endpoint that stringifies a Map of at most a
   * handful of matches — so a screen that shows what each server is running and
   * a screen that shows how far away each server is are the same fetch. A
   * dedicated ping endpoint would be a second thing to deploy, a second thing
   * to proxy, and a number measured against a path nobody plays on.
   *
   * They are asked TOGETHER and rendered SEPARATELY. Waiting for the set would
   * make every lobby as slow as the worst server in the file — including one
   * that is down, whose answer is the full timeout — and the near region's rows
   * are worth having on screen while the far one is still being waited for.
   *
   * Two guards, and each is a different kind of stale. The screen still being
   * open, because the fetch has a timeout of several seconds and a player who
   * pressed Back is entitled to have meant it — a late answer must not repaint
   * a screen that is down, or worse, put one back up over the menu. And the
   * generation, because a second Refresh can have its fast region answer before
   * the first one's slow region has given up.
   */
  private async refreshLobby(): Promise<void> {
    const generation = ++this.lobbyFetch;
    const regions = await this.regionBook.ensure();
    if (this.state !== "lobby" || generation !== this.lobbyFetch) return;
    // The screen is told what there is to ask before any of it answers, so its
    // region row and its "asking…" lines are drawn against the real list rather
    // than appearing when the first result does.
    this.lobbyScreen.setRegions(regions, this.regionBook.selectedIndex());
    // Before the requests, and once for all of them: the timings they are about
    // to be measured by are not recorded at all unless there is room in a buffer
    // this page filled while it was loading. See `clearRequestTimings`.
    clearRequestTimings();
    for (const region of regions) {
      void fetchMatches(region).then((result) => {
        if (this.state !== "lobby" || generation !== this.lobbyFetch) return;
        // The auto-pick answers with the row to light up, or null when the
        // player has already chosen and nothing may move. Pushed from here
        // because every write to that screen is.
        if (result.ok) {
          const moved = this.regionBook.note(region, result.ping);
          if (moved !== null) this.lobbyScreen.setRegionChoice(moved);
        }
        this.lobbyScreen.setResult(region.id, result);
      });
    }
  }

  /**
   * One pick from the settings screen: stored, persisted, applied, and pushed
   * back to the screen. The screen never writes its own state — it renders
   * what it is given — so this is the only path a toggle can take, and a
   * setting cannot show as applied when it is not.
   */
  private setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.settings[key] === value) return;
    this.settings = { ...this.settings, [key]: value };
    writeSettings(this.settings);
    this.applySettings();
    this.settingsScreen.setValues(this.settings);
  }

  /** Pushes every setting at whatever owns it. Called on load and on change. */
  private applySettings(): void {
    this.hud.setFpsVisible(this.settings.fpsCounter);
    this.applyRenderScale();
    this.setMotionBlurEnabled(this.settings.motionBlur);
    // After the blur, and that is the order rather than a preference: the
    // blur's own toggle takes the grade off and puts it back to keep the
    // chain's tail, so the grade has the last word on whether it is attached.
    this.post.setEnabled(this.settings.horrorGrade);
    // The look speeds go to the camera and stop there: the aim assist reads its
    // own bound off `stickYawRate`, which already carries the stick's.
    this.cameraSys.setLookScale(
      this.settings.mouseSensitivity,
      this.settings.stickSensitivity,
      this.settings.touchSensitivity,
    );
    // And to the chase camera, which is a second camera rather than a mode on
    // that one and therefore does not inherit anything from it. A player who
    // has halved their look speed has halved it in a tank too, or the setting
    // is a lie about one of the two views.
    this.vehicleCam.setLookScale(
      this.settings.mouseSensitivity,
      this.settings.stickSensitivity,
      this.settings.touchSensitivity,
    );
  }

  /**
   * Sizes the backing store from the player's render scale and the display.
   *
   * Babylon's scaling level is the RECIPROCAL of the resolution — level 1 means
   * one backing pixel per CSS pixel, which is what the engine has always run at
   * because `adaptToDeviceRatio` was never passed. On a 2x panel that is a
   * quarter of the display's pixels, upscaled by the compositor. The setting is
   * expressed against the DISPLAY instead (see `CONFIG.graphics.renderScales`),
   * so `renderScale` 1.0 is the panel's own resolution on every machine and the
   * default derives back to the old behaviour.
   *
   * Read fresh every call rather than cached: this is also the resize handler,
   * and the density is exactly what a resize can have changed.
   */
  private applyRenderScale(): void {
    const dpr = window.devicePixelRatio || 1;
    this.engine.setHardwareScalingLevel(1 / (dpr * this.settings.renderScale));
    // The crosshair's spread projection needs the viewport height in CSS
    // pixels, and this is the one place that can have changed. Read here rather
    // than in `updateHud` because that read sits BETWEEN two batches of HUD
    // writes, and a geometry read with style mutations pending is what forces
    // an early layout — the one shape of layout thrashing the frame path had.
    this.viewportHeight = window.innerHeight;
  }

  /**
   * Adds or removes the motion blur pass, keeping the chain's order.
   *
   * The order is load-bearing and documented on both passes: GodRays, then the
   * blur, then the grade — the shafts belong to the frame they smear with, and
   * grain over a smear reads as a dirty lens. Babylon's `attachPostProcess`
   * APPENDS, so simply re-attaching the blur would put it behind the grade.
   * Taking the grade off and putting it back after is what restores the order
   * without computing an index into a chain that also holds the pipeline's own
   * FXAA — and it is Game's job because Game is what assembled the chain.
   *
   * Nothing throws if this is wrong. The symptom is smeared grain.
   */
  /**
   * Adds or removes the moon-shaft pass as the moon comes into frame and goes
   * out of it, for a reason the shafts state on themselves: a detached pass
   * costs nothing, while an attached one reads and writes the whole frame
   * however early its shader gives up. `GodRays.update` has already decided;
   * this is only the attachment.
   *
   * It goes back into the SLOT IT CAME OUT OF, and that is the whole reason
   * Game does the first attach. `detachPostProcess` nulls the entry rather
   * than removing it, and `attachPostProcess` with no index APPENDS — so the
   * detach-the-tail-and-put-it-back dance `setMotionBlurEnabled` does would
   * leave one more hole in the camera's list on every cycle here, in an array
   * that is walked every frame. Re-attaching into the hole leaves the list the
   * same length and the order exact, and never touches the other passes.
   *
   * This toggles as the moon crosses the edge of the fade, which is why it
   * has to be the cheap version rather than the rare one.
   */
  private syncGodRays(): void {
    const on = this.godRays.isLive;
    if (on === this.godRaysAttached) return;
    const camera = this.cameraSys.camera;
    if (on) {
      this.godRaysSlot = camera.attachPostProcess(
        this.godRays.pass,
        this.godRaysSlot,
      );
    } else {
      camera.detachPostProcess(this.godRays.pass);
    }
    this.godRaysAttached = on;
  }

  private setMotionBlurEnabled(on: boolean): void {
    if (on === this.motionBlur.isEnabled) return;
    const camera = this.cameraSys.camera;
    const pass = this.motionBlur.pass;
    if (on) {
      this.post.detach();
      camera.attachPostProcess(pass);
      this.post.attach();
    } else {
      camera.detachPostProcess(pass);
    }
    this.motionBlur.setEnabled(on);
  }

  private closeLoadout(): void {
    if (!this.lowerLid("loadout")) return;
    // The menu paints the kit into its own markup and was covered while it
    // changed, so it is redrawn on the way out. The deploy screen's caption is
    // a text node `applyLoadout` already patched.
    if (this.state === "menu") this.showMenu();
  }

  /**
   * Turns the weapon on the kit screen's stage, and keeps it lit while it is
   * there.
   *
   * The kit screen is the one overlay showing live 3D, so it owes by hand what
   * only `updateGameplay` normally does. That used to include the shader's eye
   * — a kit opened straight off the main menu would otherwise put the weapon a
   * whole map's width from where the shader thought the viewer was, and fog it
   * out to a flat grey silhouette — but `tick` now pushes that for every state,
   * and a screen showing live 3D is exactly why it has to. What is left is the
   * drag, which is read consume-on-read from the screen and mixed with the
   * pad's right stick, so both devices turn the same turntable.
   *
   * The bench lamps are the third thing, and they go through `LightingSystem`
   * like every other light rather than being uploaded from here: carried
   * lights always win a slot, so one frame of `lighting.update` is all it
   * takes to put them on the weapon. `stowKit` takes them away again.
   */
  private updateKitStage(dt: number): void {
    const i = CONFIG.viewmodel.inspect;
    const drag = this.loadoutScreen.consumeDrag();
    const camera = this.cameraSys.camera;
    // Both axes are negated: a drag takes hold of the near face of the weapon,
    // so pulling right has to turn the far side left.
    this.player.updateInspect(
      -(drag.x * i.dragRate + this.input.stickLookX * i.stickRate * dt),
      -(drag.y * i.dragRate + this.input.stickLookY * i.stickRate * dt),
      camera.fov,
      this.engine.getAspectRatio(camera),
    );
    const eye = camera.position;
    // Into scratches: this is a per-frame path, so the plain getters would
    // mint two vectors a frame for as long as the screen is up.
    const forward = this.cameraSys.forwardToRef(this.kitForward);
    const right = this.cameraSys.flatRightToRef(this.kitRight);
    CONFIG.lighting.kitLamps.forEach((lamp, n) => {
      this.kitLampPos.set(
        eye.x + forward.x * lamp.ahead + right.x * lamp.side,
        eye.y + forward.y * lamp.ahead + right.y * lamp.side + lamp.up,
        eye.z + forward.z * lamp.ahead + right.z * lamp.side,
      );
      this.lighting.setCarried(
        kitLampId(n),
        this.kitLampPos,
        lamp.color,
        lamp.range,
        lamp.intensity,
      );
    });
    this.lighting.update(dt, camera.position, this.mats);
  }

  /**
   * Picks up a weapon, from the loadout screen and nowhere else.
   *
   * Applied immediately, magazine and all: it is only reachable from the menu
   * and the deploy screen, where the gun is already put away, so there is no
   * round in flight for a swap to interrupt.
   */
  private setWeapon(id: PrimaryWeaponId): void {
    if (id === this.weapon) return;
    this.weapon = id;
    writeWeapon(id);
    this.applyLoadout();
  }

  /**
   * Picks the anti-tank item. Same reachability and same immediacy as the
   * weapon, and remembered on every map — see the field.
   */
  private setEquipment(id: EquipmentId): void {
    if (id === this.equipment) return;
    this.equipment = id;
    writeEquipment(id);
    this.applyLoadout();
  }

  /**
   * Whether this round has armour in it, and therefore whether the kit has a
   * third slot at all.
   *
   * ONE term, and it is the map's: a hardstanding is stated or it is not.
   * There is deliberately no second term asking whether this is a netplay
   * round — the authority fields the same hulls off the same layout and
   * resolves the third slot off the join (see `Match.admit`), so the slot is
   * offered online and off or the same kit would mean two different things on
   * the two sides of the wire.
   *
   * It used to be two terms, and the second was "the round has to be offline".
   * That is what this comment said until armour crossed the wire; the term was
   * removed with it.
   */
  private get armourOffered(): boolean {
    return (this.mapDef.layout.vehicles?.length ?? 0) > 0;
  }

  /** Fits an optic. Same reachability, same immediacy. */
  private setSight(id: SightId): void {
    if (id === this.sight) return;
    this.sight = id;
    writeSight(id);
    this.applyLoadout();
  }

  /**
   * Paints the weapon in the player's hands.
   *
   * It writes the CARRIED weapon's entry and no other, which is what makes the
   * record a per-gun memory rather than one setting with five copies: the kit
   * screen only ever offers this weapon's schemes, so a pick can only ever be
   * about this weapon.
   */
  private setFinish(id: FinishId): void {
    if (id === this.finishes[this.weapon]) return;
    this.finishes[this.weapon] = id;
    writeFinish(this.weapon, id);
    this.applyLoadout();
  }

  /**
   * Pushes the kit to everything that reads it: the player (what the rounds
   * do, which model ADS poses, and what it is painted in), the camera (how far
   * it zooms, how much it slows, how fast it gets there), and the three
   * captions. Split from the setters because the constructor owes the same
   * push for a kit nobody just picked, and because every slot of the loadout
   * owes all of it — a weapon change re-derives the aimed pose exactly as an
   * optic change does, and turns the finish row over as well.
   */
  private applyLoadout(): void {
    this.player.setWeapon(this.weapon);
    this.player.setSight(this.sight);
    // The third slot, or no third slot. `setWeapon` above has already put the
    // primary in the hands, so a slot going away here can never be the one
    // being carried — which is the ordering, not a coincidence.
    this.player.setEquipment(this.armourOffered ? this.equipment : null);
    // The paint, which is the one slot of the three that reaches nothing but
    // the model: no camera, no caption, and nothing below. Only the carried
    // weapon's is pushed — it is the only rig that can be looked at, and the
    // other four are repainted the moment the weapon row steps onto them.
    this.player.setFinish(this.weapon, this.finishes[this.weapon]);
    this.applyCarry();
    const label = kitLabel(this.weapon, this.sight);
    this.deployScreen.setKit(label);
    this.loadoutScreen.setFit(
      this.weapon,
      this.sight,
      this.finishes[this.weapon],
      this.equipment,
      this.armourOffered,
    );
    // The menu draws the kit into its own markup, so it has to be rebuilt;
    // the other two were just patched above.
    if (this.state === "menu") this.showMenu();
  }

  /**
   * Pushes what is actually IN THE PLAYER'S HANDS, which the kit alone cannot
   * say: the sidearm is swapped to mid-round, and both of the things below
   * follow the weapon rather than the loadout.
   *
   * The camera is the load-bearing one. How far it zooms and how much it slows
   * are the fitted optic's, how fast it gets there and how much the aim wanders
   * are the weapon's, and the sidearm looks through its own sights whatever the
   * kit chose — so a swap that left the camera on the last weapon's fit would
   * aim a pistol down a scope's FOV. `player.carriedSight` is the one answer
   * both this and the aimed pose are derived from.
   *
   * Wired to `player.onCarryChanged`, so the three things that change the hands
   * — a kit pick, a swap completing, and a fresh body coming up with the
   * primary — all reach it without any of them having to remember to.
   */
  private applyCarry(): void {
    const weapon = this.player.carriedWeapon;
    const sight = this.player.carriedSight;
    this.cameraSys.setLoadout(weapon, sight);
    this.hud.setKit(kitLabel(weapon, sight));
    // …and what is NOT in them, which is the same push for the same reason:
    // the stowed row names the other slot, so it turns over exactly when this
    // one does. The short name rather than the full one — it is a caption on a
    // row that has to stay quieter than the readout above it.
    this.hud.setStowedKit(
      carriedSetup(this.player.slungWeapon).short,
      this.player.slungSlot + 1,
    );
    // Its magazine as well, even though `updateHud` pushes that every frame:
    // this is the only path that runs before the first round and on the way
    // out of one, and a row reading "PISTOL /" on the deploy screen is worse
    // than the count it would otherwise be waiting a frame for.
    this.hud.setStowedAmmo(this.player.slungAmmo, this.player.slungMagSize);
  }

  /**
   * Picks an enemy-skill tier. Applied at the next round start rather than
   * immediately: `assignSkills` re-rolls the whole roster, and doing that
   * mid-round would change the bots you are currently fighting.
   */
  private setDifficulty(tier: number): void {
    const n = difficultyNames().length;
    const next = tier < 0 ? 0 : tier >= n ? n - 1 : tier;
    if (next === this.difficulty) return;
    this.difficulty = next;
    writeDifficulty(next);
    if (this.state === "menu") this.showMenu();
  }

  /**
   * The player PICKING the map: the menu's Map row, and the lobby's — which is
   * the map a match this client creates will be started on.
   *
   * **Only from the menu or the lobby over it, and that guard is the whole
   * safety argument.** `startRound` reads `mapDef` to apply the environment,
   * paint the sky and build the map, and hands the result to battle, conquest,
   * the flag markers and the minimap. Writing this field at any other time
   * leaves all four pointing into a `GameMap` that `installMap` has already
   * disposed — which throws nothing and renders last round's world over this
   * one's. The lobby is safe for the same reason the menu is: it is a lid over
   * it, no round is standing, and the next thing to read the field is a build.
   *
   * This is the PREFERENCE and is remembered as one. A map that arrives from a
   * match server is not a pick and goes through `applyMatchMap`, which
   * deliberately does not persist it — what you chose here is what the menu
   * offers you again after the match, not the map somebody else's round
   * happened to be on.
   *
   * The value assigned is an entry OUT OF `MAPS`; see `readMap`.
   */
  private setMap(index: number): void {
    if (this.state !== "menu" && this.state !== "lobby") return;
    const n = MAPS.length;
    const next = index < 0 ? 0 : index >= n ? n - 1 : index;
    if (MAPS[next] === this.mapDef) return;
    this.mapDef = MAPS[next];
    writeMap(this.mapDef.id);
    // Whichever of the two is on screen. The menu is redrawn whole because it
    // owns its markup; the lobby is handed the new choice and repaints its own
    // row — and the menu underneath it is redrawn by `closeLobby` anyway.
    if (this.state === "lobby") this.lobbyScreen.setMapChoice(next);
    else this.showMenu();
  }

  /**
   * The map the AUTHORITY says a match is on, applied to the standing choice.
   *
   * **A client never picks the map of a match it joins.** Both sides build the
   * world locally from the same layout module and nothing about it crosses the
   * wire, so a client that builds a different one is not playing the same game:
   * its walls, its flags and its spawns are somewhere else, and every position
   * that arrives is nonsense in the world it is drawn into. The map is stated in
   * the welcome and again on every rotation, and this is the one place that
   * answer is spent.
   *
   * Three answers, because the callers do two different things with it:
   *
   * - `same` — the standing map is already the match's, which is the ordinary
   *   case once the lobby has handed the row's map down to `joinMatch`.
   * - `changed` — applied here, and the caller owes a BUILD. Nothing else may
   *   write `mapDef` from a state that is not `menu`/`lobby`, and this is
   *   allowed to only because every caller rebuilds within the same frame.
   * - `unknown` — an id this build does not have (a server one version ahead).
   *   Nothing is written, and the caller's answer is `leaveUnknownMap`: there is
   *   no world to build, so there is no round to play.
   *
   * It does NOT persist the choice — see `setMap` for why.
   */
  private applyMatchMap(mapId: string): "same" | "changed" | "unknown" {
    const def = MAPS.find((m) => m.id === mapId);
    if (!def) return "unknown";
    if (def === this.mapDef) return "same";
    this.mapDef = def;
    return "changed";
  }

  /**
   * The authority is running a map this build does not have.
   *
   * The same three moves `NetSession.onRejected` makes and for the same reason:
   * the round is torn down, the player is put back where they chose from, and
   * the toast says what happened. A refusal that left them in a match would be
   * worse than useless — they would be standing in a world nobody else is in.
   */
  private leaveUnknownMap(mapId: string): void {
    this.enterMenu();
    this.hud.toast(`this server is running "${mapId}", which this build does not have`);
    this.openLobby();
  }

  private tick(): void {
    const real = this.engine.getDeltaTime() / 1000;
    const dt = Math.min(real, 0.05);
    this.input.update();
    // Every state, including the ones that simulate nothing: the readout is an
    // instrument, and a frame rate that stops being reported the moment you
    // open a menu is a frame rate you cannot investigate. It takes the real
    // delta rather than the clamped one — see `HUD.setFps`.
    this.hud.setFps(this.engine.getFps(), real);

    // A round running without you, drawn under whatever you have on screen —
    // every state that owes it, asked once. Before the switch rather than after,
    // because `dt` is time that has already passed and the screen that was up
    // for it is the one this frame belongs to; and before the arms rather than
    // inside four of them, because that was the arrangement nothing but prose
    // held together. Offline, and in every state that is either IN the fight or
    // has none behind it, this returns on its first line.
    this.updateRoundBehind(dt);

    switch (this.state) {
      case "menu":
      case "roundover":
        this.updateMenuCard(dt);
        break;
      // `loading` deliberately has no arm and must not grow one. There is no
      // map to simulate against and no input worth taking — the whole reason
      // it is a state is that the frame between the confirm and the build
      // belongs to nobody, and anything given to it here is something that
      // could run twice or run against a map that is half torn down. The
      // frame still renders (below), which is what draws the card.
      case "loading":
        break;
      case "deploy":
        this.updateDeployScreen(dt);
        break;
      case "loadout":
        this.updateLoadoutScreen(dt);
        break;
      case "settings":
        this.updateSettingsScreen();
        break;
      case "lobby":
        this.updateLobbyScreen();
        break;
      // The netplay frame a pause does not stop is `updateRoundBehind`'s, above.
      // The lid stays on the half of the frame that is genuinely this client's:
      // the player does not move, does not shoot, and reports nothing while the
      // menu is up — `updateNet` sends no move sample because it asks for
      // `state === "playing"`, so being paused is already indistinguishable on
      // the wire from standing still.
      case "paused":
        this.updatePauseMenu();
        break;
      case "playing":
        if (this.input.pausePressed) {
          this.pause();
          break;
        }
        // After the pause check, so a frame that ends the round's hold never
        // also chases a lock for it. Both live states owe it, for the same
        // reason the resume gives the lock back to both.
        this.updatePendingLock(dt);
        this.updateGameplay(dt);
        break;
      case "dying":
        // Pausable like any other live frame — a death cam is four seconds
        // during which the round is still going, so it must not be four
        // seconds during which Escape does nothing.
        if (this.input.pausePressed) {
          this.pause();
          break;
        }
        this.updatePendingLock(dt);
        this.updateDeathCam(dt);
        break;
      case "editor":
        this.updateEditor(dt);
        break;
    }

    // A pause stops the HUD's clock too: the killfeed, the toasts and the
    // damage vignette are all part of the frozen frame, and a fight fading off
    // the screen while nothing in the world moves is the tell that the pause
    // is only skin deep. Every other state passes the real dt.
    //
    // A NETWORKED pause is not a frozen frame and the test inverts with it:
    // the fight behind the card is live, kills keep arriving from the wire,
    // and a killfeed held at zero would stack them unread and then fade the
    // lot at once on the resume — the same tell, from the other side. So the
    // question is not which screen is up but whether what is under it moves,
    // which is what `worldHeld` answers.
    this.hud.update(this.worldHeld ? 0 : dt);
    this.post.update(dt);
    this.sky.update(dt);
    // After every state has had its go at the camera, and before the render
    // that the shafts are drawn into.
    this.godRays.update(
      this.scene,
      this.cameraSys.camera,
      this.sky.moonDirection,
    );
    // …and then off the camera entirely when it has nothing to add. Straight
    // after the update that decided it, and before the render it applies to.
    this.syncGodRays();
    // Every frame in every state, so the basis it reprojects against can never
    // go stale while the player sits in a menu. In the editor the free-fly cam
    // drives the Babylon camera directly and never touches these angles, so
    // the pass sees no rotation and stays inert — which is what we want in an
    // authoring tool.
    this.motionBlur.update(this.cameraSys.aimYaw, this.cameraSys.aimPitch);
    // The eye the cel shader fogs and rims against, last of all and in EVERY
    // state, because every state renders and only some of them simulate. It
    // used to be pushed from `updateSceneForCamera` and by hand from the kit
    // screen, which covered the four states that run a camera and left the
    // scene behind the menu, the building card and the deploy screen fogged
    // against wherever the last live frame stood — the origin, before there
    // has been one. That was 8.5 m of error on a fresh boot's first deploy
    // screen and exactly none anywhere else, and the reason it was only ever
    // 8.5 m is that nothing currently MOVES the camera in a state that does
    // not simulate. A deploy screen that flew to an overlook, or a menu that
    // panned, would have broken it silently and looked like a shader bug. Here
    // it cannot: `updateCamera` guards on the position, so a still camera in
    // any state costs one comparison and no walk.
    this.mats.updateCamera(this.cameraSys.camera.position);
    // And on the same terms and for the same reason: the map around the eye,
    // rather than the map. Every state renders and only some of them simulate,
    // so a menu, a building card or a deploy screen with a live view behind it
    // would otherwise be offered whatever neighbourhood the last live frame
    // stood in — which on a map big enough for this to matter is a hole where
    // the city is. It guards on the position exactly as the line above does.
    this.culling.update(this.cameraSys.camera.position);
    // In every state too, and AFTER the switch above rather than inside any of
    // its arms: what decides whether the board is up is the state this frame
    // ENDS in, so a frame that deployed the player, killed them or ended the
    // round has already changed it by the time this reads it. That is what
    // makes "the board goes away when the round does" a property of one line
    // rather than a call every one of those boundaries has to remember.
    this.pushTouchControls();
    this.pushScoreboard();
    this.scene.render();
  }

  /**
   * The title card and the round-over card, which share one overlay element.
   *
   * The menu is a LIST — the cursor keys move and step it, and the dedicated
   * keys are accelerators rather than the only way to reach a row. The
   * round-over card has no cursor, so it only takes the confirm.
   */
  private updateMenuCard(dt: number): void {
    this.overlayT += dt;
    // Menu only: `roundover` shares the overlay element but shows the
    // victory text, and redrawing the picker over it would wipe the result.
    if (this.state === "menu") {
      // The menu is a LIST: up/down move the cursor, left/right step
      // whatever it is resting on, and A fires it. The dedicated keys below
      // are accelerators now rather than the only way to reach a row —
      // which is what they were, and is why a pad could not open the
      // settings screen from here at all.
      if (this.input.menuUpPressed) this.overlayScreen.moveMenuSelection(-1);
      if (this.input.menuDownPressed) this.overlayScreen.moveMenuSelection(1);
      if (this.input.menuLeftPressed) this.overlayScreen.stepMenuItem(-1);
      if (this.input.menuRightPressed) this.overlayScreen.stepMenuItem(1);
      // Enter and pad A fire the cursor's row, and BREAK — they raise
      // `confirmPressed` on the same frame, and the fall-through below
      // would otherwise start the round out from under whichever screen
      // the row just opened. The same shape the paused branch uses to keep
      // Start from confirming behind its own resume.
      if (this.input.menuConfirmPressed && this.overlayT > 0.5) {
        this.overlayScreen.activateMenu();
        return;
      }
      if (this.input.loadoutPressed) {
        this.openLoadout();
        return;
      }
      if (this.input.settingsPressed) {
        this.openSettings();
        return;
      }
      if (this.input.multiplayerPressed) {
        this.openLobby();
        return;
      }
    }
    // What is left of the confirm is Enter, pad A and Start — no pointer
    // at all. On the menu card the first two have already been spent on the
    // cursor's row and broken out above, so this is Start, "start the game"
    // wherever the cursor happens to be resting; on the round-over card,
    // which has no cursor to fire, it is all three. The mouse and a tap
    // deploy through the Deploy button and nowhere else, or a click on the
    // map or difficulty row would start the round out from under the pick.
    if (this.input.confirmPressed && this.overlayT > 0.5) {
      this.startRound();
    }
  }

  /**
   * Waiting out a respawn: step the reinforcement clock, drive the spawn
   * picker, and take the confirm that deploys.
   */
  private updateDeployScreen(dt: number): void {
    if (this.input.pausePressed) {
      this.pause();
      return;
    }
    // The same key, and the reason the deploy screen offers it at all:
    // the wait for reinforcements is the one moment inside a round when
    // the weapon is already put away.
    if (this.input.loadoutPressed) {
      this.openLoadout();
      return;
    }
    if (this.input.settingsPressed) {
      this.openSettings();
      return;
    }
    this.respawnT -= dt;
    // The round carries on without us, and this is the screen that reads it —
    // the map below is drawn from `conquest.points`, which the wire keeps
    // current, and the bodies behind the card and the tickets on the strip are
    // stepped from a frame. That frame is `updateRoundBehind`'s and has already
    // run when this arm is reached, which is what leaves this method with only
    // the clock and the input that are its own.
    //
    // Stepped before the redraw, so the marker and the status line move on
    // the frame the key was pressed. Both axes step the same list — the
    // spawns are a handful of points scattered over a map rather than a
    // row or a column, so there is no axis that "means" anything, and a
    // d-pad direction that does nothing reads as a screen that ignores the
    // pad.
    if (this.input.menuRightPressed || this.input.menuDownPressed) {
      this.deployScreen.moveSelection(1);
    }
    if (this.input.menuLeftPressed || this.input.menuUpPressed) {
      this.deployScreen.moveSelection(-1);
    }
    this.deployScreen.update(this.respawnT);
    // Enter / gamepad A deploys at the current selection; the map takes its
    // own clicks and the kit button takes its own, so the MOUSE IS LEFT OUT
    // (`menuConfirmPressed`) — the same rule the pause and kit screens
    // follow, and here it is load-bearing rather than tidy. The menu's
    // Deploy button changes the state on the down edge, which puts this
    // case in front of the very click that asked for it; a confirm that
    // counted the mouse would deploy the player through the screen they
    // just opened, at whichever spawn the list happened to start on.
    if (this.input.menuConfirmPressed) this.deployScreen.confirm();
  }

  /**
   * The kit screen. Two axes for two slots, and every way out closes it —
   * there is nothing to confirm, each pick is already on the weapon behind.
   */
  private updateLoadoutScreen(dt: number): void {
    // The lid that hides the most — the scrim is opaque except for the stage the
    // weapon turns on — and it makes no difference to what is owed: the round is
    // still being played by fifteen other people and the reinforcement clock is
    // still running down. `updateRoundBehind` has already stepped both, on this
    // screen's own say-so (`ScreenSpec.roundBehind`).
    //
    // Two axes, two slots: up/down chooses which half of the kit is being
    // edited, left/right steps through it. Back, confirm and pause all
    // close — there is nothing to confirm here, every pick has already been
    // applied to the weapon behind the screen, so B and A do the same
    // thing and B is the one a pad player will reach for. The mouse is left
    // out of the confirm (`menuConfirmPressed`) because a click on the
    // empty half of the screen is not a choice, the same rule the pause
    // menu follows.
    if (
      this.input.menuBackPressed ||
      this.input.pausePressed ||
      this.input.menuConfirmPressed ||
      this.input.loadoutPressed
    ) {
      this.closeLoadout();
      return;
    }
    if (this.input.menuUpPressed) this.loadoutScreen.moveSlot(-1);
    if (this.input.menuDownPressed) this.loadoutScreen.moveSlot(1);
    if (this.input.menuLeftPressed) this.loadoutScreen.cycle(-1);
    if (this.input.menuRightPressed) this.loadoutScreen.cycle(1);
    this.updateKitStage(dt);
  }

  /**
   * The settings list. The one screen where the confirm is NOT an exit: a
   * boolean has nothing to step through, so A and Enter flip the row.
   */
  private updateSettingsScreen(): void {
    // The one lid that can be raised over another, and so the only one that can
    // cover a round from two states away — which changes nothing about what it
    // owes, because the round underneath does not care which screen is on top of
    // it, only whether the authority is still running it. That is why the two
    // gauges and the reinforcement clock are `updateRoundBehind`'s and not this
    // method's: four screens deciding it for themselves is four chances to
    // decide it differently.
    //
    // Up/down picks the row, left/right and Enter flip it. The confirm is
    // NOT an exit here, which is the one place this screen departs from the
    // kit screen's shape: a boolean has nothing to step through, so A and
    // Enter are the natural "toggle this" and spending them on closing
    // would leave a pad with no way to change a setting at all. B, Escape
    // and `O` are the ways out, and every pick is already applied.
    if (
      this.input.menuBackPressed ||
      this.input.pausePressed ||
      this.input.settingsPressed
    ) {
      // B is the pad's crouch toggle as well; the press that closed this
      // screen has already flipped the latch behind it. Same correction the
      // pause branch and `spawnPlayer` make, and for the same reason.
      if (this.input.menuBackPressed) this.input.clearCrouchToggle();
      this.closeSettings();
      return;
    }
    if (this.input.menuUpPressed) this.settingsScreen.moveRow(-1);
    if (this.input.menuDownPressed) this.settingsScreen.moveRow(1);
    // Left/right step and CLAMP; confirm steps forward and WRAPS. With a
    // boolean these were the same move, and with a ladder on the screen they
    // stop being — see `SettingsScreen.stepRow`.
    if (this.input.menuLeftPressed) this.settingsScreen.stepRow(-1, false);
    if (this.input.menuRightPressed) this.settingsScreen.stepRow(1, false);
    if (this.input.menuConfirmPressed) this.settingsScreen.stepRow(1, true);
  }

  /**
   * The lobby. A list like the settings screen, and with one row that steps:
   * the map a new match would be started on. Left/right is spent there and
   * NOWHERE else — a horizontal nudge on a match row has nothing to change,
   * because that match's map is the authority's, and a nudge that did something
   * anyway would make the cursor's own edges feel like traps (the reasoning
   * `stepMenuItem` states next door).
   */
  private updateLobbyScreen(): void {
    // B, Escape and `M` all leave, matching the settings screen's three ways
    // out. Enter is spent on joining, which is what the screen is for.
    if (
      this.input.menuBackPressed ||
      this.input.pausePressed ||
      this.input.multiplayerPressed
    ) {
      // B is the pad's crouch toggle as well; the press that closed this screen
      // has already flipped the latch behind it. The same correction the pause
      // and settings branches make.
      if (this.input.menuBackPressed) this.input.clearCrouchToggle();
      this.closeLobby();
      return;
    }
    if (this.input.menuUpPressed) this.lobbyScreen.moveRow(-1);
    if (this.input.menuDownPressed) this.lobbyScreen.moveRow(1);
    // Left/right CLAMP and the confirm WRAPS, the same pair the menu's own map
    // row keeps: a slider you have to watch is worse than one you can feel, and
    // a confirm that answers nothing is worse than one that always moves.
    if (this.input.menuLeftPressed) this.lobbyScreen.stepRow(-1);
    if (this.input.menuRightPressed) this.lobbyScreen.stepRow(1);
    if (this.input.menuConfirmPressed) this.lobbyScreen.activate();
  }

  /**
   * The pause list. Nothing simulates while it is up; this only moves the
   * cursor and takes the choice.
   */
  private updatePauseMenu(): void {
    // Pause is checked first and breaks: Start raises `pausePressed` and
    // `confirmPressed` on the same frame, and resuming must not also fire
    // whichever item the selection happens to be on.
    // B backs out of a pause the same way it backs out of the kit screen:
    // the lid comes off and the state under it comes back, which is what
    // "Resume" does anyway.
    if (this.input.pausePressed || this.input.menuBackPressed) {
      // B is also the pad's crouch toggle, so the press that lifted the lid
      // has already flipped the latch. Only a B resume owes the correction
      // — clearing it on every resume would stand up a player who paused
      // deliberately crouched behind cover.
      if (this.input.menuBackPressed) this.input.clearCrouchToggle();
      this.resume();
      return;
    }
    // The one lid that can be raised over another. Checked after the
    // resume, so a frame carrying both keys ends the pause rather than
    // opening a screen over a round that is about to un-hold.
    if (this.input.settingsPressed) {
      this.openSettings();
      return;
    }
    if (this.input.menuUpPressed) this.overlayScreen.movePauseSelection(-1);
    if (this.input.menuDownPressed) this.overlayScreen.movePauseSelection(1);
    // Keyboard/pad confirm only — the buttons handle their own clicks, and
    // a click on the empty half of the screen is not a menu choice.
    if (this.input.menuConfirmPressed) this.overlayScreen.activatePause();
  }

  /**
   * Takes the pointer lock back, tolerating the browser saying no.
   *
   * Chrome refuses a fresh lock for about a second after the user pressed
   * Escape to leave one — which is precisely the sequence a pause menu ends
   * with — and reports it by rejecting the promise. That is not an error worth
   * surfacing: `updatePendingLock` asks again a moment later, and if the
   * browser holds out, the lock hint is already on screen and the player's next
   * click takes the lock through the `pointerdown` handler above. Older
   * browsers return nothing at all from this call, hence the shape of the
   * check.
   */
  private requestLock(): void {
    const pending = this.canvas.requestPointerLock() as unknown as
      | Promise<void>
      | undefined;
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {});
    }
  }

  /**
   * Puts a lid on the round. Reachable from `playing` and from `deploy` — a
   * player waiting out a respawn timer should not have to watch it run down
   * before they can leave — and it remembers which, because resuming has to
   * put the game back where it was rather than moving it on.
   *
   * Nothing here stops the render loop: `tick` simply stops calling
   * `updateGameplay`, so the scene, the sky and the post chain all keep
   * drawing the frozen frame. That is what the menu and the round-over screen
   * already do, and it is why a paused round reads as held rather than gone.
   */
  private pause(): void {
    if (!this.raiseLid("paused")) return;
    // A pause outranks a resume that never got its lock: a second pause taken
    // while one was still being chased must not have the round grab the mouse
    // out from under the menu it just raised.
    this.lockPending = false;
    this.hud.setPaused(true);
    this.overlayScreen.showPause();
    // Suspends the audio clock, so the tail of the last shot is still there
    // when the round starts again instead of ringing out over the menu.
    //
    // OFFLINE ONLY, and not merely because a live fight should be audible.
    // Suspending stops `AudioContext.currentTime`, and a networked round goes
    // on making noise the moment it is stopped: `hit`, `damage` and `explode`
    // all sound straight off the wire, from the message handler, in whatever
    // state the client happens to be in. Scheduled against a clock that is not
    // running, none of them plays and none of them ENDS — so each holds a
    // voice against the cap until the resume, at which point the whole
    // pause-worth of them fires on the same instant. The choice is between a
    // menu with gunfire behind it and a menu that saves the gunfire up.
    if (!this.net) this.sfx.setSuspended(true);
    document.exitPointerLock();
  }

  /**
   * What a pause leaves running, undone. It is half of `takeDown("paused")` and
   * is called from nowhere else — a lid is only ever lifted there.
   */
  private clearPause(): void {
    this.hud.setPaused(false);
    this.sfx.setSuspended(false);
  }

  private resume(): void {
    if (!this.lowerLid("paused")) return;
    // `dying` too. The death cam is a live frame that holds the lock, so a
    // pause over it has to give back what it took — the alternative is a cam
    // that resumes unlocked and a player who is silently mouse-free for the
    // rest of it and into whatever comes next.
    if (this.state === "playing" || this.state === "dying") {
      // The click that chose "Resume" is still held, and it is about to become
      // the click that takes the pointer lock back — the same trap the deploy
      // map's click documents in `spawnPlayer`.
      this.input.consumeFire();
      // NOT a bare `requestLock()`: a resume driven by Escape is asking for the
      // lock with the browser's own release-the-lock key still down. See
      // `updatePendingLock`.
      this.lockPending = true;
      this.lockPendingT = 0;
      this.lockRetryT = 0;
    }
  }

  /**
   * Carries a resume's pointer lock until the browser agrees to it.
   *
   * A pause taken with Escape ends with Escape, and that one key is both the
   * resume and the UA's gesture for dropping a lock — so the request a resume
   * makes is the one request the browser is least willing to grant. Chrome
   * refuses outright for about a second after an Escape-exit, and a lock taken
   * while the key is still down is dropped again by its auto-repeat, which
   * `pointerlockchange` would read as a player leaving and pause on. Both look
   * to the player like the same thing: a menu that flickers off and back on,
   * and a round that eventually resumes with the mouse still loose.
   *
   * So the request waits for the key to come UP and is then retried on an
   * interval until the lock lands, or until the window runs out — at which
   * point the round is still running, the lock hint is on screen, and the next
   * click takes it through the `pointerdown` handler. Nothing here can pause:
   * a refusal is not a state change.
   */
  private updatePendingLock(dt: number): void {
    if (!this.lockPending) return;
    if (this.input.pointerLocked) {
      this.lockPending = false;
      return;
    }
    this.lockPendingT += dt;
    if (this.lockPendingT > CONFIG.input.lockRetryWindow) {
      this.lockPending = false;
      return;
    }
    if (this.input.pauseKeyHeld) return;
    // Nothing to chase on a phone: see the note in `spawnPlayer`.
    if (this.input.touchActive) {
      this.lockPending = false;
      return;
    }
    this.lockRetryT -= dt;
    if (this.lockRetryT > 0) return;
    this.lockRetryT = CONFIG.input.lockRetryInterval;
    this.requestLock();
  }

  /**
   * Back to the main menu, from the pause screen. Mirrors `endRound` minus a
   * result: the round is abandoned rather than finished, so there is no winner
   * to show and nothing to keep.
   *
   * The map is deliberately left standing. `startRound` rebuilds it anyway,
   * and disposing it here would only trade a live backdrop for an empty one.
   * That is exactly why the death cam has to be told: the body is standing in
   * the backdrop this leaves up, so a round abandoned from a pause taken over
   * `dying` would put the main menu over the player's own frozen corpse, with
   * `.dying` still on the HUD and a ragdoll slot still held until the next
   * round's `enterDeploy` happened to clear both.
   */
  private enterMenu(): void {
    // Takes down the pause card, the kit screen and the settings with it —
    // whichever of them the player was looking at when they quit. All three used
    // to be listed here by hand; see `go`.
    this.go("menu");
    // A networked round ends HERE, and the socket is closed rather than left to
    // time out: a peer that merely goes quiet holds its roster slot until the
    // server notices, and the bot that should have taken the seat back stays
    // benched for as long as that takes.
    //
    // This was inert while `?mp` was the only way into a match — there was no
    // route from the menu back into one, so a stale session could never be hit.
    // The lobby is that route, and without this the second join is refused by
    // `joinMatch`'s own guard and looks like a dead button.
    this.leaveMatch();
    // The match's map went with it. A netplay round is played on whatever the
    // authority is running (`applyMatchMap`), which is not a choice this player
    // made and was deliberately never persisted — so the menu goes back to
    // offering the one they did pick, rather than to whichever stranger's round
    // they last dropped into. Legal here because the state is already `menu`.
    this.mapDef = readMap();
    this.deployScreen.hide();
    this.deathCam.stop();
    this.hud.setDeathCam(false);
    this.minimap.setVisible(false);
    this.player.setBodyHidden(true);
    this.hud.clearDamageDirections();
    this.hud.setCapture(null);
    this.hud.setLeash(null);
    this.battle.reset();
    document.exitPointerLock();
    // Same gate the round-over screen uses: the confirm that got here must not
    // fall through into starting the next round.
    this.overlayT = 0;
    this.showMenu();
  }

  /**
   * A map is mid-build with a `buildRound` already queued for the next frame.
   *
   * A method rather than `this.state === "loading"` written out twice, because
   * `toggleEditor` has to ask it on both sides of an await and TypeScript
   * carries the first check's narrowing straight through one — it calls the
   * second comparison dead, which is precisely the assumption the second check
   * exists to refuse. Behind a call it cannot narrow, so the question stays
   * askable.
   */
  private buildPending(): boolean {
    return this.state === "loading";
  }

  /**
   * Enters or leaves the map editor. Dev-only, and the import is dynamic so
   * `src/editor` never reaches a production bundle.
   *
   * Leaving always restarts the round rather than resuming. BattleSystem,
   * ConquestSystem, Minimap and DeployScreen all cache the GameMap they were
   * handed, so the only safe way back from a session that may have rebuilt the
   * map is to build a fresh one and re-point all of them — which is exactly
   * what `startRound` does.
   */
  private async toggleEditor(): Promise<void> {
    // Gating the whole body, not just the keybind: this is what makes the
    // dynamic import unreachable under `vite build`, so Rollup drops the
    // editor chunk entirely rather than emitting an orphan nobody fetches.
    if (!import.meta.env.DEV) return;
    // A map is mid-build and a `buildRound` is already queued for the next
    // frame. Opening the editor into that would put a second build behind it
    // and leave the editor holding a map that the first one had disposed —
    // the failure `installMap` exists to prevent, arriving by the one door it
    // does not cover. One frame, and F2 works on the next.
    if (this.buildPending()) return;
    // A previous F2 is still waiting on the import. Its `createEditor` has not
    // run yet, so `this.editor` is still null and would wave this one through.
    if (this.editorLoading) return;
    if (this.editor) {
      // Leaving rebuilds the map from the layout module, so anything edited
      // and not written to disk is gone. Until the editor can save, that is
      // every edit — ask before throwing the work away.
      if (
        this.editor.hasUnsavedChanges &&
        !window.confirm("Discard unsaved map edits and return to the game?")
      ) {
        return;
      }
      this.editor.dispose();
      this.editor = null;
      this.hud.setEditing(false);
      this.startRound();
      return;
    }

    this.editorLoading = true;
    let createEditor;
    try {
      ({ createEditor } = await import("../editor"));
    } finally {
      // Cleared before the opening rather than after it: everything below this
      // point is synchronous, so nothing can interleave with it, and a throw in
      // the import must not wedge F2 for the rest of the session.
      this.editorLoading = false;
    }
    // Both pre-await guards owe a second look. The import is a task boundary,
    // so the `loading` state that was clear a moment ago may not be — a round
    // started underneath would have its build stomped to "editor" here.
    if (this.buildPending() || this.editor) return;

    // F2 is reachable from every screen in the game — the pause card, whose
    // suspended audio context and hidden crosshair an editor session would
    // otherwise inherit; the kit screen and the settings, either of which would
    // sit over the editor's own panel; and the lobby, which used to be missing
    // from the list here and did exactly that. `go` takes down whichever it was.
    this.go("editor");
    const map = this.buildEditorMap();
    // Not a lid: the menu's own card is on the same element and F2 is reachable
    // from there too.
    this.overlayScreen.hide();
    this.hud.setEditing(true);
    this.deployScreen.hide();
    // And from the death cam, whose body would otherwise be left standing in
    // the map the editor is about to rebuild — `installMap` frees the ragdoll
    // slot underneath it, so the cam has to be told rather than find out.
    this.deathCam.stop();
    this.hud.setDeathCam(false);
    this.minimap.setVisible(false);
    this.player.setBodyHidden(true);
    if (document.pointerLockElement) document.exitPointerLock();

    this.editor = createEditor({
      canvas: this.canvas,
      camera: this.cameraSys.camera,
      input: this.input,
      scene: this.scene,
      glow: this.glow,
      map,
      rebuildMap: () => this.buildEditorMap(),
      mapId: this.mapDef.id,
      layout: this.mapDef.layout,
      environment: this.mapDef.environment,
      fixtures: this.lighting.fixtures,
      applyEnvironment: (env) => applyEnvironment(this.scene, env, this.mats),
      invalidateShadows: () => this.shadows.invalidate(),
    });
    // Open where the player was standing, looking the way they were looking.
    this.editor.warpTo(
      this.cameraSys.camera.position.clone(),
      this.cameraSys.aimYaw,
      this.cameraSys.aimPitch,
    );
  }

  /**
   * Throws the standing map away, builds `this.mapDef` afresh, and hands the
   * result to everything that reads geometry or environment off it.
   *
   * THE ONE PLACE A MAP IS BUILT. Both callers — a round starting and an editor
   * rebuild — owe this whole sequence, and before it was one method they were
   * two copies of it that had already drifted apart. The failure mode is silent
   * in the worst way: a system added to the round's copy and forgotten in the
   * editor's keeps a cached pointer into a disposed map, so the editor renders
   * last build's water over this build's terrain and nothing throws. Anything
   * new that consumes a `GameMap` or an `EnvironmentSpec` goes here, and both
   * callers get it.
   *
   * What deliberately stays with the callers is what they genuinely disagree
   * about: the round applies the environment and repaints the sky, while the
   * editor drives `applyEnvironment` itself so it can toggle its work light;
   * and the round alone owns the things that are about a FIGHT rather than a
   * map — battle, conquest, the flag markers and the minimap.
   *
   * The particle field is the one thing the editor gains by being folded in
   * here, and it is a fix rather than a side effect: `atmosphere.apply` used to
   * be the round's alone, so an editor opened from a live round drifted ash and
   * one opened from the main menu did not. It is the map's own weather and it
   * now runs in both. What strips the night back for authoring is the work
   * light, which is the editor's to toggle.
   *
   * `editor: true` keeps geometry per layout item instead of block-merging it,
   * which is what makes an individual placement selectable. It costs ~10x the
   * draw calls — never judge frame cost from the editor.
   */
  private installMap(opts?: BuildOptions): GameMap {
    const { layout, environment } = this.mapDef;
    // Before a single thing is disposed: the seat, because the hull it belongs
    // to is about to stop existing. See the vehicle build at the bottom.
    this.clearVehicle();
    this.map?.dispose();
    this.combat.clearTransient();
    // A grenade whose fuse outlived the map it was thrown across would go off
    // over terrain that no longer exists — and, in the editor, in the middle
    // of a rebuild.
    this.grenades.reset();
    // …and everything the AT kit has left lying about. A mine that outlived
    // its map would be waiting under a street that no longer exists, which is
    // the same failure a live fuse would be.
    this.antiTank.reset();
    // The flag markers are geometry hung off the old map's terrain. The editor
    // draws proxies of its own and would double every ring; a round rebuilds
    // them below. Either way they cannot survive the map they were placed on.
    this.zones.dispose();
    const map = this.mapBuilder.build(layout, environment, opts);
    this.map = map;
    // The shadow camera follows the environment's key light, and its casters
    // are the fresh map's visuals — last build's meshes are now disposed.
    this.shadows.setLightDirection(environment.lighting.direction);
    // And how far that light's shadows are allowed to reach. It travels with
    // the direction rather than beside it, because it is a consequence of the
    // direction's elevation — see `EnvironmentSpec.lighting.shadowWindow`.
    this.shadows.setShadowWindow(
      environment.lighting.shadowWindow ?? CONFIG.graphics.shadows.frustumSize,
    );
    this.shadows.setFogRange(environment.fogStart, environment.fogEnd);
    // The same fog range, to the three systems that gate on where it ENDS: past
    // it there is nothing to see, so a rig is not drawn, a remote body is not
    // drawn and a corpse is not worth tumbling.
    //
    // It used to be stated twice — here, where it is painted, and in CONFIG,
    // where those three read it — with a dev warning when a map disagreed. It
    // is now stated once, by the map, for a reason that warning could only
    // report: a map is allowed to have no fog, and on one that can see three
    // hundred metres a body vanishing at seventy-eight vanishes in plain sight.
    // `FOG_WALL` is what each of them carries until a map is installed, which
    // is the shipped valleys' number.
    this.battle.setViewDistance(environment.fogEnd);
    this.ragdolls.setViewDistance(environment.fogEnd);
    this.net?.roster.setViewDistance(environment.fogEnd);
    // And a fourth reader of the same number, for the same reason turned
    // inside out: past the fog wall there is nothing to see, so there is
    // nothing to WALK either. `WorldCulling` files the fresh map's meshes and
    // decides which of them Babylon's per-frame active-mesh pass is offered —
    // it writes nothing onto any of them, so unlike the three lines above it,
    // and unlike every other line in this method, nothing downstream can tell
    // it ran. See `ENGINE_UPGRADE.md` wall 1.
    this.culling.setMap(map, environment.fogEnd);
    // How hard the grade is pushed is the map's; whether it runs at all stays
    // the player's (`applySettings`). A vignette that reads as dread over a
    // night village reads as a lens fault over a bright one.
    this.post.setGrade(environment.grade);
    this.shadows.setCasters(map.visuals);
    // And the other thing baked off the fresh map's visuals: what its glass
    // reflects. Same reason as the line above it — last build's meshes are
    // disposed, and this one holds a render list of them until it is told.
    // Editor builds park the probes and bake nothing, exactly as the physics
    // world below refuses one: a bake is a build step, and the editor is where
    // a build stops being rare.
    this.reflections.build(map, opts?.editor === true);
    this.atmosphere.apply(environment.particles, map.size, map.size);
    // And what the map's WATER reflects, which is the same bake from a second
    // set of points — handed in as a callback rather than reached for, and
    // called from INSIDE the build because a probe has to stand where the
    // water is and only the bed-depth bake knows where that is.
    this.water.build(map.water, environment, map.terrain, (sites) =>
      this.reflections.bakeWater(sites, map, opts?.editor === true),
    );
    this.grass.build(
      map.grass,
      environment,
      map.colliderBoxes,
      map.terrain,
      map.size,
    );
    // Where the edge of the map is, and whether it is a rule rather than a
    // wall. `margin` is 0 on every map closed by the rim, which turns the leash
    // off outright — see `world/leash.ts`.
    this.leash.setMap(map.size, map.margin);
    // The three places the ground under a body's feet is kept: the heightfield,
    // the collider boxes bucketed over it, and the hulls, which are in neither
    // because they move. `probeGround` takes the highest of them and was a
    // whole-scene ray pick until it could. The deck supplier is bound HERE and
    // once per install rather than per frame — `VehicleSystem` is a system and
    // `Player` may not reach for one, which is what this wiring is for.
    this.player.setGround(map.terrain, map.obstacles, (x, z, ceiling, floor) =>
      this.vehicles.deckAt(x, z, ceiling, floor),
    );
    // **The solid world as a SEGMENT QUERY, to the six systems that used to ask
    // the scene.** This is the whole of `ENGINE_UPGRADE.md` wall 2 on this
    // side: `scene.pickWithRay` walked every mesh in the scene to answer where
    // a round stopped, so the eight sites that asked it were priced on the size
    // of the MAP rather than on the length of the ray. They read
    // `colliderBoxes`, the strut groups and the heightfield now, exactly as
    // `Player.probeGround` was made to. Nothing about what any of them decides
    // has changed — see `world/RayWorld.ts` for the two questions and which
    // caller asks which.
    //
    // `BattleSystem` and `VehicleSystem` are not in this list and are not
    // exceptions: both are handed the whole `GameMap` already, and both take it
    // off `map.rays` where they take `nav`, `cover` and `obstacles`.
    this.combat.setWorld(map.rays);
    this.grenades.setWorld(map.rays);
    this.antiTank.setWorld(map.rays);
    this.aimAssist.setWorld(map.rays);
    this.deathCam.setWorld(map.rays);
    this.vehicleCam.setWorld(map.rays);
    // The floor a grenade comes to rest on, as a backstop under the collider
    // proxies — the same terrain the player's ground probe falls back to, and
    // the map's own mist and moon, which are what colour the blast dust.
    this.grenades.setTerrain(map.terrain);
    this.grenades.setEnvironment(environment);
    // The same backstop under a rocket's flight, and for the same reason. The
    // AT kit has no environment of its own to be given: everything it draws
    // that is weather-dependent is drawn by the blast, which is the grenades'.
    this.antiTank.setTerrain(map.terrain);
    // What THIS map's blast throws: the rubble is the map's own `floorColor`
    // mixed toward subsoil, so a crater in a jungle and one in a business
    // district turn up different ground. (The scorch needs no telling — it
    // multiplies the floor rather than painting a colour on it.)
    this.blastDebris.setEnvironment(environment);
    // The static world corpses and shards land on. Same reason the grenades are
    // cleared above: a physics world still holding shapes built from the map
    // that was just disposed is geometry that no longer exists, and in the
    // editor that means in the middle of a rebuild. Editor builds register
    // nothing at all.
    this.physics.setMap(map, opts?.editor === true);
    // The panes, and the collider meshes standing behind them. Same
    // reason as every line above it: a system holding last build's geometry is
    // holding meshes that are already disposed, and glass is the one that would
    // then write vertices into them.
    this.glass.setMap(map);
    // The armour, last, and it is the one line in this method with two reasons
    // to build NOTHING.
    //
    // A hull the player is inside cannot survive the map it is standing on, so
    // the seat is given up first — this is the same class of failure the funnel
    // exists to prevent, and it is the sharp version of it: `driving` would be
    // a live pointer into a disposed `Tank`, which is not a stale picture but a
    // crash the next time the camera framed it.
    //
    // **A netplay round builds the same fleet and owns none of it.** The
    // authority runs its own `VehicleSystem` off the same `vehicleSpawns`, so
    // a hull exists on both sides with the same collider in the same place —
    // and `predicted` is what says which side decides: every hull in a match
    // refuses local damage, runs neither hardstanding clock, and is posed from
    // the wire by `NetVehicles`, except the one this player is sitting in.
    // See `docs/vehicles.md` and `docs/multiplayer.md`.
    //
    // Nothing is built for the EDITOR: a vehicle is not level data to be
    // authored — the hardstanding is, and that is a layout entry — and a
    // solid, pickable mesh with no `SelectionRef` behind it is something the
    // centre-screen pick can land on and fail to resolve.
    // Everybody out BEFORE the fleet is torn down, and before `battle.reset()`
    // kills the roster: a crew left holding a disposed hull is the same stale
    // pointer `clearVehicle` is called from here to prevent, and one holding a
    // bot the reset has just killed would steer a tank with a corpse in it.
    this.crew.clear();
    if (opts?.editor === true) this.vehicles.dispose();
    else this.vehicles.build(map, this.net !== null);
    // The bearing half of a driver's steering. Null in the editor, and null in
    // a NETPLAY round for a different reason worth stating: the hulls are
    // there, but the crews inside them are the authority's — this client runs
    // no AI at all, and a local `TankCrew` would be a second brain steering a
    // hull that is being posed from the wire.
    this.crew.setMap(!this.net && !this.vehicles.empty ? map : null);
    return map;
  }

  /**
   * The editor's rebuild. Called on entry and again whenever it changes
   * something the builders read — a param, a kind, an added or deleted entry.
   *
   * Deliberately does NOT re-point battle/conquest/minimap: those keep pointing
   * at a map that is now disposed, which is safe only because leaving the
   * editor always runs `startRound` and hands them a fresh, properly merged
   * build.
   */
  private buildEditorMap(): GameMap {
    return this.installMap({ editor: true });
  }

  /**
   * The editor frame. Same tail as gameplay minus the player: no aim assist,
   * no blob shadows, no carried lamp, no grass pushers.
   */
  private updateEditor(dt: number): void {
    const editor = this.editor;
    if (!editor) return;
    editor.update(dt);
    // The shadow window follows the camera itself here — there is no player to
    // centre it on, and the same forward bias keeps what's ahead covered.
    this.shadowFocus
      .copyFrom(this.cameraSys.camera.position)
      .addInPlace(editor.forward.scale(8));
    this.updateSceneForCamera(dt, this.shadowFocus, null, EMPTY_PUSHERS);
  }

  /**
   * Puts the building card up and hands the round itself to the next frame.
   *
   * The split is the whole point. Everything `buildRound` does is synchronous
   * and adds up to the better part of a second — merges, the occlusion bake,
   * the nav grid — and a browser paints between TASKS, not inside one, so
   * before this the card the player had just confirmed stayed on screen,
   * frozen, for the entire build and the deploy screen appeared straight out
   * of it. Nothing was slow that is not slow now; what was missing was any
   * sign that the game had heard the button. So: raise the card, yield, and
   * let the freeze happen with something on screen that explains it.
   *
   * `requestAnimationFrame` rather than a timeout, because what is owed is a
   * PAINT and rAF is the only thing that tracks one — and TWO of them, which
   * is the part that is easy to get wrong and was, once, here. A frame runs
   * its animation callbacks and THEN paints, so a single rAF booked from
   * ordinary task code fires before the card it is waiting on has ever been
   * on the glass: the build blocks, and what stands frozen for the whole
   * second is the menu, exactly as before the split. Caught on a screencast,
   * which is the only thing that can see it — every DOM assertion passes,
   * because the markup is right and it is the compositor that never got a
   * turn. One rAF *is* enough from inside the render loop, which is where the
   * real callers are, but that makes correctness a property of the call site
   * rather than of this method. The second one costs a frame and owes nothing
   * to anybody's ordering. `main.ts` defers taking the boot screen down the
   * same way and for the same reason.
   *
   * The lids come down HERE rather than in `buildRound` — a kit screen that
   * stayed up over the building card would be the same lie in a smaller frame.
   */
  private startRound(): void {
    // One round at a time. `tick` dispatches nothing in `loading`, so no input
    // can reach here twice on its own — but the guard is kept LOCAL to the
    // method that owns the invariant rather than left resting on the three
    // callers all continuing to be careful. A second build over a queued one
    // leaves the systems holding a map the first one disposed, which is the
    // silent failure `installMap` exists to prevent.
    if (this.state === "loading") return;
    // The menu's own card, which is not a lid and so is not `go`'s to take.
    this.overlayScreen.hide();
    // Reachable from the menu, so any lid may still be up over it — including
    // the lobby, which is the one that got here on a networked round — and
    // straight from the pause menu ("Restart round").
    this.go("loading");
    this.overlayScreen.showBuilding(this.mapDef.name);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => this.buildRound()),
    );
  }

  /**
   * Builds the map and everything standing on it, then opens the deploy
   * screen. Always entered from `startRound`, one frame later — see there for
   * why the two are not one method.
   */
  private buildRound(): void {
    // The welcome beat the build. Read here for the same reason the team is —
    // it can land on either side of this method, and the half that arrives
    // first has nothing on screen to correct. `NetSession.onSeated` is the
    // other half and defers to this one while the state is `loading`.
    //
    // FIRST, before a single line of the build: everything below reads
    // `mapDef` — the environment, the sky, `installMap` — so a map applied
    // after any of them is a round half built out of each.
    if (this.net?.seated) {
      if (this.applyMatchMap(this.net.mapId) === "unknown") {
        this.leaveUnknownMap(this.net.mapId);
        return;
      }
    }
    // Re-draw skills for the chosen tier. The rig pool is never disposed, so
    // this is the only place the roster's difficulty can change.
    this.battle.setDifficulty(this.difficulty);

    // The environment goes on before the build: the sky is painted from it,
    // and the cel materials the map's meshes are created against read their
    // fog and key light off the uniforms this writes.
    const env = this.mapDef.environment;
    applyEnvironment(this.scene, env, this.mats);
    this.applySky();
    const map = this.installMap();

    this.battle.setMap(map);
    this.battle.reset();
    // Who is in the fight but is not a bot: the player, and every hull on the
    // field. `setPlayer` resets that list to the player alone, which is exactly
    // what makes this safe to run every round — last round's tanks were
    // disposed by `installMap` and a bare `addHuman` would leave them in it.
    //
    // A tank is in the list for two reasons and neither is optional: bots must
    // be able to ACQUIRE one (nothing else would make them fire at it) and
    // `hittablesAgainst` must return one (nothing else would let a round land
    // on it). It is deliberately NOT in `this.combatants`, which is the list
    // `ConquestSystem` counts occupancy from — armour does not capture flags,
    // and the crew inside it already counts for itself.
    this.battle.setPlayer(this.player);
    for (const tank of this.vehicles.tanks) this.battle.addHuman(tank);
    // Every rig goes back to the pool restored; a corpse cannot outlive the
    // round it fell in.
    this.ragdolls.reset();
    this.debris.reset();
    this.blastDebris.reset();
    this.conquest.start(map);
    // The flags' markers read the same radius ConquestSystem tests against,
    // and follow the same terrain the ring is drawn across.
    this.zones.build(map.controlPoints, map.terrain, map.nav, env);
    this.player.fullReset();
    // The AT slot is the MAP's and the ROUND's, not the kit screen's, so it is
    // re-decided here as well as in `applyLoadout` — a player who chose a
    // launcher on Coldharbour and then joined a match would otherwise still be
    // carrying one into a round with no armour in it and no authority that has
    // heard of a rocket. `fullReset` runs first, so the slot is installed with
    // a full pouch either way.
    this.player.setEquipment(this.armourOffered ? this.equipment : null);
    // Offline the player is team 0 for the life of the process. In a netplay
    // round the side is the authority's, and the session has it whenever the
    // welcome beat this build; when it did not, the welcome applies it itself.
    // Either way it goes in through the one funnel — see `applyPlayerTeam`.
    this.applyPlayerTeam(this.net?.seated ? this.net.team : 0, map);
    // …and the glass as the authority left it, for the same "either side of the
    // build" reason: a joiner mid-round has missed every break in it, and the
    // welcome may have landed before this map existed to apply them to. See
    // `NetSession.brokenPanes`, and `onSeated` for the other half.
    if (this.net?.brokenPanes.length) this.glass.catchUp(this.net.brokenPanes);
    // …and offline they take a SLOT on that side rather than standing beside
    // the roster: the bot in it is benched, so the fight is eight a side with
    // the player as one of the eight. In a match the authority does this on
    // its own roster and the local pool is not the fight — see
    // `BattleSystem.seatPlayer`.
    if (!this.net) this.battle.seatPlayer(this.player.team);
    // A new round is a new board. Sized from the pool here rather than at
    // construction, so it is the roster that says how many rows there are —
    // and after `seatPlayer` above, so the slot the player's own line is kept
    // in is one this book has a row for.
    this.scores.reset(this.battle.bots.length);
    // The building card comes down on the far side of the work it covered, and
    // with it `.overlaid` — the deploy screen is one of the two that reads the
    // HUD underneath it rather than hiding it.
    this.overlayScreen.hide();
    this.enterDeploy(0);
  }

  /**
   * Which side the player is on, and everything already standing in its
   * colours.
   *
   * Offline the answer is always team 0. In a netplay round it is the
   * authority's — `Roster.claim` seats the second human on team 1 — and it
   * arrives in the welcome, which can land on EITHER side of the local build
   * because `joinMatch` books the round before the socket is open. So this is
   * called from both ends: `buildRound` deals whatever the session already
   * has, and `NetSession.onSeated` deals it again when it turns out to
   * disagree. That is why nothing here may assume it is running on a fresh
   * round.
   *
   * Almost everything downstream reads `player.team` live, every frame, and
   * needs nothing from this. What it collects is the things that take a COPY
   * and would otherwise wear the old side's colours for the rest of the round:
   * the death cam's stand-in body is built once, the minimap's backdrop is
   * prerendered once, and the HUD's strip is only re-read inside `playing` —
   * which the deploy screen the welcome usually lands under is not.
   */
  private applyPlayerTeam(team: Team, map: GameMap): void {
    this.player.team = team;
    // Built here, not at the moment of death: nine merged meshes and their GL
    // buffers is not a cost to pay on the frame the player is killed on. A
    // change of side is the one thing that rebuilds it, and `prepare` is the
    // one that knows how to do that safely — see there.
    this.deathCam.prepare(team);
    this.minimap.setMap(map, team);
    this.hud.setTickets(
      [CONFIG.teams[0].name, CONFIG.teams[1].name],
      this.conquest.tickets,
      team,
    );
    this.hud.setFlags(this.conquest.points, team);
    // Only when it is already up. `enterDeploy` shows it a moment after a
    // build, so doing it there too would be the same paint twice — and a team
    // that changed UNDER a standing deploy screen has to go back through
    // `show`, because the spawn list it is offering belongs to the other side.
    if (this.deployScreen.visible) {
      this.deployScreen.show(map, this.conquest, team);
    }
  }

  private spawnPlayer(at?: { pos: Vector3; yaw: number }): void {
    this.player.fullReset();
    // A fresh body has never been anywhere, least of all outside the map. The
    // clock is not merely stopped by a death — it has to be FORGOTTEN, or a
    // player who died out in the borderland comes back inside a flag with four
    // seconds already spent.
    this.leash.clear();
    const spawn = at ?? this.spawnPointFor(this.player.team);
    // Scatter slightly so redeploying onto a busy flag doesn't drop the player
    // inside a squadmate.
    const jitter = new Vector3(
      (Math.random() - 0.5) * 5,
      0,
      (Math.random() - 0.5) * 5,
    );
    this.player.placeAt(spawn ? spawn.pos.add(jitter) : new Vector3(0, 0, 0));
    this.cameraSys.reset(spawn ? spawn.yaw : 0);
    // The aim just jumped to the spawn heading. Reprojecting through that jump
    // would greet the player with one frame smeared across the whole screen.
    this.motionBlur.reset();
    this.deployScreen.hide();
    this.player.setBodyHidden(false);
    this.minimap.setVisible(true);
    // Deploying by clicking the map arrives here from a pointerdown whose
    // button is still down, and which is about to grab pointer lock on its way
    // up the DOM — so the fire gate below would be satisfied by the very click
    // that spawned the player. Hold the trigger until it is released.
    this.input.consumeFire();
    // Both stances latch, and a fresh body neither crouches nor runs. The
    // crouch one also catches the pad's B doing double duty: backing out of
    // the kit screen on the way to deploying flips the latch, and nothing else
    // would clear it.
    this.input.clearCrouchToggle();
    this.input.clearSprintToggle();
    this.go("playing");
    // `enterDeploy` dropped the lock, and until now the only thing that ever
    // took it back was a click — the `pointerdown` handler in the constructor,
    // which is the deploy map's own click arriving a moment later. A pad player
    // never generates one, so every deployment left them in the world with the
    // OS cursor sitting over the crosshair until they reached for the mouse.
    // Taking it here covers both: the click path asks twice in the same gesture
    // (harmless — the second request resolves onto the same lock) and the pad
    // path asks at all. It is a best effort, exactly as `requestLock`'s note
    // says: a browser that insists on a user gesture refuses, and a pad player
    // there is no worse off than before.
    //
    // Never for a THUMB, and that is a correctness rule rather than a saving.
    // A held lock zeroes `clientX/clientY` on EVERY pointer event, touch ones
    // included — so the floating stick would be born at the top-left corner of
    // the screen and the look drag would read one long jump to it. Measured:
    // with the lock granted, both read exactly zero.
    if (!this.input.touchActive) this.requestLock();
  }

  /**
   * Where a combatant of `team` deploys. Home spawns only until
   * ConquestSystem starts handing out captured flags.
   */
  private spawnPointFor(team: 0 | 1): { pos: Vector3; yaw: number } | null {
    if (!this.map) return null;
    const pick = this.conquest.spawnFor(team);
    if (!pick) return null;
    // Scatter a little so a whole squad doesn't stack on one point.
    return {
      pos: pick.pos.add(
        new Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6),
      ),
      yaw: pick.yaw,
    };
  }

  private updateGameplay(dt: number): void {
    // The hull the frame belongs to, read ONCE and up front.
    //
    // It has to be a local rather than `this.driving` re-read below, because a
    // hull can be destroyed inside `updateWorld` — a bot's round, a shell, a
    // grenade — and `clearVehicle` nulls the field on that same frame. Read
    // again after the world step, the camera branch would fall through to the
    // on-foot path and snap the eye from twelve metres behind a burning tank
    // into a head that is about to be a corpse, for exactly one frame. Held
    // here, the view stays on the wreck and the death cam takes it next frame,
    // which is what the cut should look like.
    const driven = this.driving;
    if (driven) this.updateDriver(dt, driven);
    else this.updateOnFoot(dt);

    if (!this.updateWorld(dt)) return;

    if (driven) this.frameVehicleCamera(dt, driven);
    else this.updateCameraAndLighting(dt);
    // Reads the camera (it fades the markers into the fog wall) but never
    // moves it, so it belongs after the tail above rather than inside it.
    this.zones.update(
      dt,
      this.conquest.points,
      this.player.team,
      this.cameraSys.camera.position,
    );
    this.updateHud(dt);
  }

  /**
   * The half of a gameplay frame that is about a body ON FOOT: the movement,
   * the leash, the trigger, and the one key that gets into a vehicle.
   *
   * Split out of `updateGameplay` when armour arrived, and the split is the
   * same one `updateWorld` already is: what is about the FIGHT is shared by
   * every way of being in it, and what is about a body standing up is not.
   * Nothing moved when it was extracted.
   */
  private updateOnFoot(dt: number): void {
    // --- player ---
    const ev = this.player.update(dt, this.input, this.cameraSys);
    if (ev.jumped) this.sfx.jump();
    if (ev.footstep > 0) this.sfx.step(ev.footstep);
    // Landing is scaled across the fall speeds that count as one at all, so a
    // hop off a kerb is a step and a drop off the terrace is not.
    if (ev.landed > 0) {
      const f = CONFIG.audio.footstep;
      if (ev.landed >= f.landMinSpeed) {
        this.sfx.land(
          Math.min(
            1,
            (ev.landed - f.landMinSpeed) / (f.landFullSpeed - f.landMinSpeed),
          ),
        );
      }
    }
    // The sound and, in a match, the announcement are `player.onReload`'s —
    // wired once in `wireScreens`, because the key is only one of the two ways
    // a reload begins and the other one is inside `tryShot`.
    if (this.input.reloadPressed) this.player.startReload();
    // The weapon swap, asked for either way round: the wheel and pad Y want
    // "the other one", the number keys name a slot. Both land on the same
    // gesture, and `drawSlot` is what refuses a request for the weapon already
    // up — so a second press of `1` costs nothing rather than replaying half a
    // second of animation.
    //
    // Nothing else is owed here: the hands, the camera's fit and the HUD's
    // caption are all pushed from `player.onCarryChanged` when the weapons
    // actually change places, which is partway through the gesture rather
    // than now.
    const swapped = this.input.swapPressed
      ? this.player.swapWeapon()
      : this.input.slotPressed >= 0 &&
        this.player.drawSlot(this.input.slotPressed);
    if (swapped) this.sfx.swap(this.player.swapTotal);
    // A throw is a gesture with a release inside it, so it is two checks a
    // frame apart rather than one call: the button starts the arm, and the
    // grenade leaves when the arm gets there. The release is tested here,
    // straight after `player.update`, because that is the call that posed the
    // hand it comes out of.
    if (this.player.throwReleaseDue()) this.releaseGrenade();
    if (this.input.grenadePressed) this.player.beginThrow();

    // --- the leash ---
    // Stepped here rather than with the world rules below because it is a
    // question about where `player.update` just put the body, and the answer is
    // owed to the HUD this same frame: on a map with an open boundary this
    // countdown is the only thing marking the edge of the map, so a frame's
    // delay is a frame of a player walking out of the world with nothing on
    // screen to say so.
    //
    // **The kill is offline's alone.** In a match the authority runs the same
    // clock against the position this client reported and issues the death like
    // any other; killing here as well would charge the round two deaths for one
    // walk, and the local one would arrive first and be wrong about when.
    const leash = this.leash.update(
      this.player.position.x,
      this.player.position.z,
      dt,
    );
    if (leash === "expired" && !this.net) {
      // Through `takeDamage` rather than by setting health to 0, because that
      // is the one door a death goes through offline: it is what charges the
      // ticket, files the row on the board and raises the death cam. `from` is
      // undefined on purpose — nobody shot you, so there is no bearing for a
      // damage arc and nothing for the flinch to lean away from.
      this.player.takeDamage(this.player.health);
    }

    // --- shooting (hitscan from the camera through the crosshair) ---
    // Mouse fire requires pointer lock so UI clicks never discharge the gun.
    // The deploy map's click is the exception that gate cannot see — it is the
    // click that TAKES the lock — and `spawnPlayer` calls `consumeFire()` for it.
    // The trigger goes IN rather than gating the call: a semi-automatic weapon
    // has to be told when it comes up, and only Player knows whether the one
    // being carried cares.
    // A phone has no pointer lock to take and never will, so the gate has a
    // third term rather than an exception: the trigger is a button on the
    // controls, and a button that only exists while the round is being played
    // cannot be the UI click this gate was written to catch.
    const canFire =
      this.input.pointerLocked ||
      this.input.gamepadConnected ||
      this.input.touchActive;
    // **The third slot takes the trigger down a path of its own**, because
    // none of the round handling below applies to it: there is no hitscan to
    // resolve, no spread to roll, no hitmarker to guess at and no tracer to
    // draw. What it DOES share is everything inside `tryShot` — the rate
    // limit, the magazine, the semi-automatic latch, the recoil vector — which
    // is the whole reason an AT item is carried as a weapon rather than bolted
    // on beside one. Two calls, one of which runs.
    const carriedAt = this.player.carriedEquipment;
    if (carriedAt) {
      if (this.player.tryShot(this.input.fire && canFire)) {
        this.fireOrdnance(carriedAt);
      }
    } else if (this.player.tryShot(this.input.fire && canFire)) {
      const blend = this.cameraSys.adsBlend;
      const spread = this.player.spread(blend);
      // Tracers, the flash light and the noise all start at the viewmodel's
      // muzzle — about half a metre in front of the eye. That is the rifle
      // on screen, so it is the one the shot has to appear to come from.
      const muzzle = this.player.muzzleWorld();
      const shot = this.combat.fire(
        this.cameraSys.camera.position,
        this.cameraSys.forward,
        spread,
        this.player.damage,
        muzzle,
        this.enemyTargets(),
        this.player.range,
        this.player.shotOptions,
      );
      // Networked: report the round. Everything above stays exactly as it is —
      // the local resolve is what draws the tracer, flashes the hitmarker and
      // kicks the weapon, and none of that may wait on a round trip. What it
      // no longer does is decide anything: in a netplay round `enemyTargets`
      // answers with the `NetSoldier`s the roster is drawing, whose
      // `takeDamage` returns false and changes nothing, so the hitmarker below
      // is a PREDICTION and the server's `hit` event is the truth.
      //
      // `shot.dir` and not `cameraSys.forward`: the spread was rolled inside
      // `fire`, and the server has to re-resolve this bullet rather than a
      // differently-jittered one.
      this.net?.sendShot(this.cameraSys.camera.position, shot.dir, 0);

      // Bots hear the player's rifle the same way they hear each other's. This
      // is the only place the player's own gunfire enters the world, so it is
      // the only place that can say so.
      this.battle.hearGunshot(muzzle, this.player.team);
      // Recoil: kick the aim up and off toward the weapon's own bias, softened
      // braced and stiffened on the move. It decays on its own, so the burst
      // climbs and settles.
      //
      // The vector is built by `Player.recoilKick` and not here: every number
      // in it is the weapon's, and `docs/weapons.md` has always said the recoil
      // multipliers reach nothing but `Player`. Wiring it to the camera is this
      // call site's whole job, which is what a call site in `Game` is for.
      // Exactly once per shot — it reads the string counter and the drift
      // `tryShot` just advanced.
      const kick = this.player.recoilKick(blend);
      this.cameraSys.addRecoil(kick.pitch, kick.yaw);
      // Cosmetic view punch: FOV spike + shove + a nudge thrown the way this
      // round went, on the rendered camera only — the bullets above already
      // left with the clean aim.
      this.cameraSys.addPunch(this.player.kickDrift);
      // Muzzle flash: a hard, very short pulse that lights whatever is in
      // front of the player — the main reason to keep shooting in the dark.
      const lc = CONFIG.lighting;
      this.lighting.pulse(
        muzzle,
        lc.muzzleColor,
        lc.muzzleRange,
        lc.muzzleIntensity,
        lc.muzzleLife,
      );
      this.sfx.shoot(this.player.report);
      const haptic = CONFIG.rumble;
      this.input.rumble(haptic.shotStrong, haptic.shotWeak, haptic.shotMs);
      if (shot.target) {
        const killed = shot.killed && shot.target instanceof Bot;
        // Resolved before the marker so a kill gets the red one — the cue to
        // stop putting rounds into a body that is already going down. A
        // headshot is the second axis and loses to a kill on the marker,
        // because "stop shooting" is the more urgent thing to say; it keeps
        // its own sound either way, which is where the read actually lands.
        this.hud.flashHitmarker(killed, shot.headshot);
        if (shot.headshot) this.sfx.headshot();
        else this.sfx.hit();
        // Netplay: this marker is a guess, and remembering that it was made is
        // what keeps the authority's answer from repeating it a round trip
        // later. See `claimPredictedHit`.
        if (this.net) this.creditPredictedHit(shot.headshot);
        this.input.rumble(
          killed ? haptic.killStrong : haptic.hitStrong,
          killed ? haptic.killWeak : haptic.hitWeak,
          killed ? haptic.killMs : haptic.hitMs,
        );
        if (killed && shot.target instanceof Bot) {
          // Both doors, one line apart: our row, and the body's. Offline only
          // — in a netplay round `killed` is false above, because the roster's
          // bodies refuse local damage and the authority scores this round.
          this.creditKill(this.player, shot.target, shot.headshot);
          this.registerBotKill(shot.target, this.player.team, true);
        }
      }
      // Nothing here for the reload the last round in the magazine just
      // started: `tryShot` began it, and `player.onReload` is what hears about
      // it — sound and announcement together, from the one door.
    }

    // The one verb that is not on the mouse or a stance key. Last in this
    // method on purpose: it is tested against where `player.update` has just
    // put the body, so walking up to a hull offers it on the frame you arrive
    // rather than the frame after.
    const seat = this.vehicles.empty ? null : this.offeredSeat();
    this.offerUse(seat ? seat.label : null);
    if (!seat || !this.input.usePressed) return;
    // **In a match, getting in is an ASK.** Nothing local changes here: the
    // authority re-derives the whole offer against its own copy of the hull,
    // the team, the distance and the crew, and answers with a `seat` event —
    // which is where `mount` is finally called. Mounting locally and letting
    // the server catch up would be a client deciding it is inside a tank
    // somebody else may already be sitting in.
    if (this.net) {
      this.net.sendMount(this.vehicles.tanks.indexOf(seat.tank));
      return;
    }
    // The eviction and the mount are one gesture and must land on the same
    // frame: `mount` writes `Tank.occupied` through `setOccupied`, and a
    // crew taken out without somebody taking its place would leave the hull
    // open for the boarding sweep to re-crew before the player's key is even
    // read again.
    if (seat.crewed) this.crew.evict(seat.tank);
    this.mount(seat.tank);
  }

  /**
   * The hull this player could get into right now, and what the prompt should
   * call it: an empty one of their own side, or — failing that — their own
   * side's hull with a bot crew in it, which they may turn out of it.
   *
   * **Empty first**, which matters on nothing shipped today (a map states one
   * hardstanding per side) and matters immediately on the day one states two:
   * given the choice, take the tank nobody is using.
   *
   * The whole of "a bot crew never denies the player their own armour" is
   * these six lines and `TankCrew.evict`. Without them a single hull a side
   * makes whether the player ever drives a race to the yard, which is a worse
   * feature than bots not driving at all.
   */
  /**
   * The hull this client is driving, as the upload needs it, or null on foot.
   *
   * Rebuilt in place rather than allocated, because it is read at `INPUT_HZ`
   * for as long as somebody is driving. Every field is the `Tank`'s own — this
   * is a view of it and never a copy that could drift.
   */
  private localHull(): LocalHull | null {
    const tank = this.driving;
    if (!tank) return null;
    const hull = this.hullReport;
    hull.tank = this.vehicles.tanks.indexOf(tank);
    hull.position = tank.position;
    hull.yaw = tank.yaw;
    hull.turretYaw = tank.turretYaw;
    hull.gunPitch = tank.gunPitch;
    return hull;
  }

  /** See `localHull`. Held so the upload path allocates nothing. */
  private readonly hullReport: LocalHull = {
    tank: -1,
    position: Vector3.Zero(),
    yaw: 0,
    turretYaw: 0,
    gunPitch: 0,
  };

  /**
   * The vehicle verb, offered or withdrawn — the ONE door, because the same
   * fact has to reach two places that draw it differently and a second caller
   * is how they come to disagree.
   *
   * The HUD says it with a KEY, and which key depends on what is in the
   * player's hands: a pad player who is told to press `E` has been told to go
   * and find a keyboard. On glass the prompt is left off entirely — the button
   * `TouchControls` puts on screen carries the same sentence and is the thing
   * being pressed, and a caption over a labelled button is one instruction
   * twice.
   */
  private offerUse(label: string | null): void {
    this.useOffer = label;
    this.hud.setUsePrompt(
      label === null || this.input.touchActive
        ? null
        : this.input.padInHand
          ? "D-PAD ↑"
          : "E",
      label ?? "",
    );
  }

  /**
   * What `offerUse` last offered, for the touch layer alone: it is pushed from
   * `pushTouchControls` with the crouch lamp and the empty magazine rather than
   * written straight through above, because the controls belong to `playing`
   * and to a finger, and that is the one place that already knows both.
   */
  private useOffer: string | null = null;

  private offeredSeat(): Seat | null {
    const at = this.player.position;
    const team = this.player.team;
    const seat = this.seat;
    const free = this.vehicles.enterable(at, team);
    if (free) {
      seat.tank = free;
      seat.crewed = false;
      seat.label = "ENTER TANK";
      return seat;
    }
    const held = this.vehicles.occupiedNear(at, team);
    if (held && this.crewedByBot(held)) {
      seat.tank = held;
      seat.crewed = true;
      seat.label = "TAKE OVER TANK";
      return seat;
    }
    return null;
  }

  /**
   * Is this hull being driven by a BOT — somebody who may be turned out of it?
   *
   * Offline it is `TankCrew`'s own pairing. In a match nothing local runs the
   * crews, so it is the roster: `VehicleState.by` says which slot is inside,
   * and the roster message says whether that slot is a person. **This is the
   * one place the client is allowed to care which**, and it is the same
   * exception the scoreboard already is — a slot changing hands is invisible
   * everywhere that draws a body, and this is drawing a PROMPT. A person's
   * hull is simply not offered: you cannot evict a human, and a prompt that
   * said you could would be a key that does nothing.
   */
  private crewedByBot(tank: Tank): boolean {
    if (!this.net) return this.crew.crewOf(tank) !== null;
    const by = this.net.vehicles.occupant(this.vehicles.tanks.indexOf(tank));
    if (by < 0) return false;
    // Found by `index` rather than subscripted. The roster is laid out in slot
    // order and the two agree today, but a slot's INDEX is what identifies it
    // everywhere else on the wire, and a lookup that only works because of an
    // ordering nothing states is one that breaks silently.
    return (
      this.net.slots.find((s) => s.index === by)?.occupant.kind === "bot"
    );
  }

  /**
   * The half of a gameplay frame that is about a body IN A HULL: the look, the
   * throttle, the trigger, and the one key that gets back out.
   *
   * **`Player.update` is deliberately not called here, and that is a budget
   * decision as much as a correctness one.** A driver is not walking, not
   * jumping, not crouching and not probing the ground — the tank is doing all
   * four — so running it would step a body through a world it is not in. What
   * the body still owes is its VITALS, which is why `Player.updateVitals`
   * exists: a driver who mounted at forty health has to heal like anybody else.
   * The tank's own ground probe then REPLACES the player's rather than adding
   * to it, so the most expensive call in the frame is still paid exactly once.
   *
   * The order inside is the one thing here that is load-bearing. The camera's
   * AIM is integrated first, because the turret is walking toward it and this
   * frame's look should be this frame's order; the hull itself is moved later,
   * inside `updateWorld`, and the camera is PLACED after that in
   * `frameVehicleCamera`. Splitting the camera's two halves across the world
   * step is the whole reason `VehicleCamera` has `aim` and `place` rather than
   * one `update`.
   */
  private updateDriver(dt: number, tank: Tank): void {
    this.player.updateVitals(dt);
    // The body rides the hull. Slaved rather than simulated: every downstream
    // reader — the conquest occupancy count, the minimap arrow, the audio
    // listener's fallback, the leash — asks where the player IS, and the honest
    // answer is "in that tank". `nudgeTo` rather than `placeAt` because this is
    // a body being carried, not one arriving: `placeAt` would zero a fall and
    // claim the ground every frame.
    this.player.nudgeTo(tank.position);

    // The look, into the ORDERS the turret walks toward. Never into the gun.
    this.vehicleCam.aim(dt, this.input);
    this.drive.throttle = this.input.moveY;
    this.drive.steer = this.input.moveX;
    this.drive.aimYaw = this.vehicleCam.yaw;
    this.drive.aimPitch = this.vehicleCam.pitch;

    // The same three-way gate the rifle's trigger takes, and for the same
    // reason: a UI click must never discharge anything. A tank gun has no
    // semi-automatic question to ask, so the trigger is simply held or not —
    // `Tank.fireGun` is what refuses a round that is not loaded yet.
    const canFire =
      this.input.pointerLocked ||
      this.input.gamepadConnected ||
      this.input.touchActive;
    if (this.input.fire && canFire) this.fireShell(tank);

    // The way out, said out loud. A driver used to be told nothing at all,
    // which is survivable on a keyboard (the same key got you in a moment ago)
    // and is not on a pad or on glass — on glass it is the whole difference
    // between a hull you can leave and one you are stuck in until it burns.
    this.offerUse("EXIT TANK");

    // …and getting out is an ask too, for the reason getting in is: WHERE the
    // body lands is the authority's, exactly as a spawn is, and a client that
    // put its own feet down beside the hull would be choosing a position
    // fifteen other clients are about to be told about.
    if (this.input.usePressed) {
      if (this.net) this.net.sendDismount();
      else this.dismount();
    }
  }

  /**
   * The third slot's trigger: a rocket out of the tube, or a mine on the
   * ground.
   *
   * `Player.tryShot` has already spent the charge and built the recoil by the
   * time this runs — an AT item is carried as a weapon and that is the point —
   * so the two things this owes are the object appearing in the world and the
   * kick reaching the camera. It is the second half of `updateOnFoot`'s
   * shooting block for the launcher and the mine, standing where
   * `combat.fire` stands for everything else.
   *
   * The switch is exhaustive by construction: a third AT item fails to
   * compile here rather than silently doing nothing, which is the same
   * guarantee `WEAPON_BUILDERS`' `Record` gives the models.
   */
  private fireOrdnance(id: EquipmentId): void {
    switch (id) {
      case "rpg":
        this.launchRocket();
        break;
      case "mine":
        this.layMine();
        break;
      default: {
        const unreachable: never = id;
        void unreachable;
      }
    }
    // The kick, wired exactly as the rifle's is: the vector is `Player`'s and
    // this call site's whole job is handing it to the camera. The launcher's
    // `recoilMult` is the heaviest in the game and the mine's is zero, so one
    // pair of lines serves both.
    const kick = this.player.recoilKick(this.cameraSys.adsBlend);
    this.cameraSys.addRecoil(kick.pitch, kick.yaw);
    this.cameraSys.addPunch(this.player.kickDrift);
  }

  /**
   * One rocket, from the tube on screen and down the reticle.
   *
   * **From the MUZZLE and along the camera's forward**, which are two
   * different things and deliberately not reconciled: a rocket that appeared
   * on the camera axis would read as coming out of the middle of the screen —
   * the exact failure `releaseGrenade` documents from the other side — and one
   * aimed from the muzzle at a converging angle would put the reticle a hair
   * off the flight at every range but one. Launched from the muzzle ALONG the
   * aim it flies parallel to the line the reticle draws, a hand's breadth
   * under it, which is what a launcher held under the eye actually does.
   *
   * `launchAhead` is a floor on that point rather than the point itself, for
   * `releaseGrenade`'s reason: a shot taken with a wall at your shoulder must
   * not spawn the warhead inside it.
   */
  private launchRocket(): void {
    const cfg = CONFIG.equipment.rpg.rocket;
    const eye = this.cameraSys.camera.position;
    const forward = this.cameraSys.forward;
    this.ordnanceAt.copyFrom(this.player.muzzleWorld());
    const ahead =
      (this.ordnanceAt.x - eye.x) * forward.x +
      (this.ordnanceAt.y - eye.y) * forward.y +
      (this.ordnanceAt.z - eye.z) * forward.z;
    if (ahead < cfg.launchAhead) {
      this.ordnanceAt
        .copyFrom(eye)
        .addInPlaceFromFloats(
          forward.x * cfg.launchAhead,
          forward.y * cfg.launchAhead,
          forward.z * cfg.launchAhead,
        );
    }
    // The pool has the last word, and a refusal gives the rocket back — the
    // same contract the grenade pool has with `spendGrenade`, arrived at from
    // the other direction because the trigger and the round are one call here.
    // It cannot happen with eight slots and five possible shooters; what
    // matters is that it costs a cooldown rather than a rocket if it ever does.
    if (
      !this.antiTank.launch(
        this.ordnanceAt,
        forward,
        this.player.team,
        this.player,
      )
    ) {
      this.player.returnRound();
      return;
    }
    // **Networked: the authority fires its own rocket and owns everything it
    // does.** The local one above still flies — it is what the shooter
    // watches leave the tube, and a warhead that appeared six metres downrange
    // a round trip later would read as a misfire — but it hurts nobody:
    // `hullNear` answers with hulls that refuse local damage and the splash
    // goes through `hittablesFor`, which is `battle`'s empty list in a match.
    // The authority's copy comes back with our slot on it and `NetOrdnance`
    // filters it out, exactly as it does for a thrown grenade.
    this.net?.sendOrdnance(this.ordnanceAt, forward);
    // Bots hear a launcher the way they hear a rifle. This is the only place
    // the player's own launcher enters the world as a noise, so it is the only
    // place that can say so.
    this.battle.hearGunshot(this.ordnanceAt, this.player.team);
    this.sfx.launcher(this.ordnanceAt);
    // The next rocket going into the tube, laid out across the fire cooldown
    // the shot above has just set — which on a two-shot weapon IS the loader,
    // and which `ViewModel` is playing the gesture off at the same moment.
    // Zero on the last rocket: there is nothing behind it and `tryShot` is
    // already putting the empty tube away.
    const load = this.player.loadTime;
    if (load > 0) this.sfx.rpgLoad(load);
    const lc = CONFIG.lighting;
    this.lighting.pulse(
      this.ordnanceAt,
      lc.muzzleColor,
      lc.muzzleRange * 1.8,
      lc.muzzleIntensity,
      lc.muzzleLife * 2,
    );
    const haptic = CONFIG.rumble;
    this.input.rumble(1, 1, haptic.shotMs * 2.5);
  }

  /**
   * One mine, on the ground in front of the player.
   *
   * **It is never refused for want of somewhere to put it.** The spot ahead is
   * tried first and the player's own feet are the fallback, because the
   * alternative — a trigger pull that spends a mine and produces nothing, or
   * one that silently does nothing at all — is the worst thing this could hand
   * somebody backing away from a tank. `dropMax` is what rules the spot ahead
   * out: a mine laid over the edge of a terrace has to land on the terrace.
   */
  private layMine(): void {
    const cfg = CONFIG.equipment.mine.mine;
    const feet = this.player.position;
    const forward = this.cameraSys.forward;
    // Flattened: a mine goes on the ground, so where the player is LOOKING
    // matters only as a bearing.
    const flat = Math.hypot(forward.x, forward.z);
    const fx = flat > 1e-4 ? forward.x / flat : 0;
    const fz = flat > 1e-4 ? forward.z / flat : 1;
    const x = feet.x + fx * cfg.placeAhead;
    const z = feet.z + fz * cfg.placeAhead;
    const y = this.standableAt(x, z, feet.y);
    const reachable = Math.abs(y - feet.y) <= cfg.dropMax;
    this.ordnanceAt.set(
      reachable ? x : feet.x,
      (reachable ? y : this.standableAt(feet.x, feet.z, feet.y)) + MINE_LIFT,
      reachable ? z : feet.z,
    );
    // **Networked: the mine is the authority's and there is no local copy.**
    // This is where it differs from the rocket beside it, and the difference is
    // what the two objects ARE: a mine is laid at the feet and never moves, so
    // the round trip before it appears is invisible, while a second plate on
    // the ground would be one to reconcile against the `mines` table for the
    // rest of the round. The pouch is spent either way — the count in the hand
    // is the client's picture of a number the server is also keeping, exactly
    // as the grenade pouch is.
    if (this.net) {
      this.net.sendOrdnance(this.ordnanceAt, this.cameraSys.forward);
      this.sfx.mineSet();
      return;
    }
    if (!this.antiTank.place(this.ordnanceAt, this.player.team, this.player)) {
      this.player.returnRound();
      return;
    }
    this.sfx.mineSet();
  }

  /**
   * One round out of the main gun: hitscan down the GUN's own axis, a blast
   * where it lands, and the noise.
   *
   * **Down the gun, not down the camera**, which is the whole of why the HUD
   * draws a marker instead of a crosshair. The player's look is a request the
   * turret is still walking toward; firing along it would put the shell
   * somewhere the barrel is visibly not pointing, and `docs/weapons.md`'s rule
   * that the picture and the axis are one fact would be broken by the frame.
   *
   * The direct hit and the splash are two separate resolutions on purpose, and
   * they cannot double-count a kill: `hittablesFor` is fetched INSIDE
   * `blastAt`, after the direct hit has already been dealt, and a body killed
   * by it is no longer `alive` and no longer in the list.
   */
  private fireShell(tank: Tank): void {
    if (!this.resolveShell(tank, this.player)) return;
    // Everything below this line is about the person holding the trigger, and
    // that is the whole of the split: a bot crew's round goes through the same
    // call above and gets none of it.
    this.vehicleCam.addKick(CONFIG.vehicles.tank.gun.cameraKick);
    const haptic = CONFIG.rumble;
    this.input.rumble(1, 1, haptic.shotMs * 3);
  }

  /**
   * One round out of a tank gun, whoever pulled the trigger. Returns false
   * when the gun was not loaded, and a caller that gets a false has fired
   * nothing.
   *
   * **The one implementation of a shell**, and it is one for the reason the
   * blast is one: the player's tank and a bot's are the same vehicle, and two
   * copies of a damage figure, a splash and a noise are two things that drift.
   * `by` is who the kill belongs to — the player, or the crewman inside the
   * hull — and it is the ONLY thing that differs between the two callers below
   * the trigger.
   *
   * The direct hit and the splash are two separate resolutions and they cannot
   * double-count a kill: `hittablesFor` is fetched INSIDE `blastAt`, after the
   * direct hit has already been dealt, and a body killed by it is no longer
   * `alive` and no longer in the list.
   */
  private resolveShell(tank: Tank, by: Combatant): boolean {
    if (!tank.fireGun()) return false;
    const g = CONFIG.vehicles.tank.gun;
    const muzzle = tank.muzzleToRef(this.shellFrom);
    const dir = tank.gunDirToRef(this.shellDir);
    const byPlayer = by === this.player;
    // **In a match this is a PREDICTION**, and everything below behaves
    // accordingly without a second path: the targets refuse damage
    // (`NetSoldier.takeDamage`, `Tank.predicted`), so `shot.killed` is false
    // and neither the credit nor the killfeed line below can be reached. What
    // it still buys is what the shooter is owed on their own screen the frame
    // the trigger goes — the tracer, the impact, the report and the light —
    // and the report goes up for the authority to re-fire down its own gun.
    if (byPlayer) this.net?.sendShell(muzzle, dir);
    // No spread: a tank gun is a rifled barrel with a fire-control system, and
    // the thing that makes it hard to hit with is the traverse rate, not a
    // cone. (A bot crew's error is on the AIM POINT instead — see
    // `CONFIG.vehicles.crew.scatter` — which is a ranging mistake rather than
    // a loose barrel, and unlike a cone it is something the driver being shot
    // at can watch the gun make.) No `headMult` either — the head zone is the
    // player's alone and an upgrade to a body hit, and a shell that landed on
    // a body has already spent more than a headshot's worth on it.
    const shot = this.combat.fire(
      muzzle,
      dir,
      0,
      g.damage,
      muzzle,
      // The tank's own side's enemies. In a match `battle`'s list is empty for
      // the reason `enemyTargets` gives at length, and the driver's team is
      // the hull's — a bot crew reaches this line only offline.
      this.net ? this.enemyTargets() : this.battle.hittablesAgainst(tank.team),
      g.range,
      SHELL_SHOT,
    );
    // The splash, through the one implementation of a blast in the game. `by`
    // is whoever fired, so a kill lands on their row exactly as a grenade's
    // does — see `wireGrenades`, which is already wired for this and needed no
    // arm.
    //
    // **Skipped outright in a match**, which is where this differs from the
    // grenade next door: a thrown grenade's local copy is the ARC the thrower
    // watched and its blast goes off where that copy came to rest, a few
    // centimetres from the authority's. A shell's local blast would go off at
    // whatever this client's own ray happened to find — a body the server
    // rewound somewhere else, a pane it has already broken — which can be a
    // street away. The authority's `explode` event draws the only fireball,
    // and the round trip is what it costs.
    if (!this.net) {
      this.grenades.blastAt(shot.hitPoint, tank.team, by, {
        radius: g.blastRadius,
        inner: g.blastInner,
        damage: g.blastDamage,
        kind: "shell",
        // How big it LOOKS, with the grenade as 1. Deliberately not derived
        // from `blastRadius`, which is SMALLER than a frag's — see
        // `blastPower`.
        power: g.blastPower,
      });
    }
    // A direct hit is the shooter's own to mark. The blast's victims are marked
    // by `onBlastHit` like any other blast's, so this covers only the body the
    // ray itself found.
    if (shot.target) {
      const killed = shot.killed && shot.target instanceof Bot;
      if (byPlayer) {
        this.hud.flashHitmarker(killed, false);
        this.sfx.hit();
      }
      if (killed && shot.target instanceof Bot) {
        this.creditKill(by, shot.target, false);
        this.registerBotKill(shot.target, tank.team, byPlayer);
      }
    }
    // Bots hear a tank gun the way they hear a rifle — this is the only place
    // armour enters the world as a noise, so it is the only place that can say
    // so. The TANK's side, not the player's: a hull the AI is driving is heard
    // by the other team exactly as one the player is driving is.
    this.battle.hearGunshot(muzzle, tank.team);
    const lc = CONFIG.lighting;
    this.lighting.pulse(
      muzzle,
      lc.muzzleColor,
      lc.muzzleRange * 2.2,
      lc.muzzleIntensity,
      lc.muzzleLife * 2.5,
    );
    this.sfx.cannon(muzzle);
    return true;
  }

  /**
   * The camera half of a driver's frame, after the hull has moved.
   *
   * Everything `updateCameraAndLighting` does for a body on foot, minus the two
   * things a driver has neither of: the aim assist (the turret is the assist —
   * a rotation added on top of an angle the gun is still walking toward would
   * be an assist the gun cannot follow) and the blob shadow and carried lamp,
   * which `updateSceneForCamera` gates on a `player` and is therefore passed
   * null for.
   */
  private frameVehicleCamera(dt: number, tank: Tank): void {
    this.vehicleCam.place(tank);
    this.cameraSys.place(this.vehicleCam.eye, this.vehicleCam.look);
    // Around the HULL rather than the eye, and with no forward bias: the tank
    // is the thing the frame is about and it is already twelve metres inside
    // the window, so pushing the window further along the view would walk the
    // vehicle's own shadow out of it.
    this.shadowFocus.copyFrom(tank.center);
    this.updateSceneForCamera(dt, this.shadowFocus, null, this.combatants);
    this.sfx.engineDrive(
      Math.min(1, Math.abs(this.input.moveY)),
      Math.min(1, tank.travel / CONFIG.vehicles.tank.drive.maxSpeed),
    );
  }

  /**
   * Getting in. Everything that changes for as long as `driving` is non-null is
   * here, and `clearVehicle` is the exact inverse — the two are meant to be
   * read side by side, because a state that is set in one and not cleared in
   * the other is a player who never really got out.
   */
  private mount(tank: Tank): void {
    this.driving = tank;
    this.vehicles.setOccupied(tank, true);
    // The viewmodel goes away: there is no rifle in a driver's hands, and it is
    // parented to the camera that is now twelve metres behind a tank.
    this.player.setBodyHidden(true);
    // Nothing may hurt the body — the HULL is what is being shot at. Both of
    // the next two lines are needed and they do different jobs: this one stops
    // rounds landing, and the one below stops bots AIMING. A bot that could
    // still acquire an unkillable target would stand there firing at it for the
    // rest of the round.
    this.player.invulnerable = true;
    this.battle.removeHuman(this.player);
    this.vehicleCam.take(tank);
    this.sfx.engineOn();
    // The mount key is not the trigger, but a player who mounts with the mouse
    // held down should not fire the main gun on the frame they arrive.
    this.input.consumeFire();
    this.offerUse(null);
  }

  /**
   * Getting out because the player asked. The body is put down beside the hull
   * and the camera is handed back to the head.
   *
   * `cameraSys.reset` rather than leaving the aim where it was: the first-person
   * camera has not been updated for as long as the drive lasted, so its yaw is
   * wherever the player was looking when they walked up to the tank — a snap of
   * up to half a turn on the frame they step out. Resetting to the CHASE
   * camera's own yaw is the only answer that keeps facing what you were facing,
   * and it clears the recoil, punch and landing springs that have been sitting
   * frozen the whole time as a side effect worth having.
   */
  private dismount(): void {
    const tank = this.driving;
    if (!tank) return;
    this.player.placeAt(this.vehicles.exitSpot(tank));
    const yaw = this.vehicleCam.yaw;
    this.clearVehicle();
    this.cameraSys.reset(yaw);
    // The aim just jumped. Reprojecting through it would greet the player with
    // one frame smeared across the whole screen — the same reason `spawnPlayer`
    // does this.
    this.motionBlur.reset();
    this.input.consumeFire();
  }

  /**
   * Giving up the seat, for any reason at all: the player asked, the hull
   * burned, the round ended, the map is being rebuilt.
   *
   * Idempotent, and it deliberately does NOT move the body — the two callers
   * that need it somewhere else put it there first. That split is what lets
   * this be safe to call from `installMap`, where moving a player to a spot
   * beside a hull that is about to be disposed would be nonsense.
   */
  private clearVehicle(): void {
    if (!this.driving) return;
    this.vehicles.setOccupied(this.driving, false);
    this.driving = null;
    this.player.invulnerable = false;
    this.player.setBodyHidden(false);
    this.battle.addHuman(this.player);
    this.sfx.engineOff();
    this.hud.setVehicle(null);
    this.hud.setGunMarker(null);
  }

  /**
   * Everything in a frame that is about the FIGHT rather than about the player:
   * the objectives, the bots, the rounds already in the air, and the bodies on
   * the ground. Returns false when the round ended on this frame, which is the
   * caller's cue to do nothing else with a game that is over.
   *
   * It is its own method because the death cam needs every line of it and not
   * one line of what surrounds it. The whole point of watching your own body
   * fall is that the fight carries on around it — tickets bleed, a squad takes
   * the flag you died on, your killer walks past — and a death cam over a world
   * that stopped is a screenshot. Splitting it here is what makes that true by
   * construction rather than by keeping two copies of the sequence in step, the
   * same failure `installMap` exists to prevent one layer down.
   */
  /**
   * What the URL says about multiplayer, read once at construction.
   *
   * Three parameters, and only the first is needed in a deployed build:
   *
   * - `?name=` — what to call this player, until the lobby grows text entry.
   * - `?server=ws://host:port/ws` — which match server the LOBBY should list
   *   and join. Purely a dev affordance: the client is on Vite's port and the
   *   server on its own, so same-origin does not reach it. It REPLACES the
   *   region list rather than adding to it — a developer who has named the one
   *   process they want is not choosing between deployments.
   * - `?mp` — skip the menu and join immediately, optionally naming the server
   *   the way `?server=` does. It predates the lobby and is kept because it is
   *   how the smoke tests get into a networked round in one navigation; the
   *   menu's Multiplayer row is the way a player gets there.
   *
   * A bare `?mp` is the one form that has to WAIT: with no server named, the
   * region it joins is the remembered one, and the file that says where that is
   * has not been read yet. It is a few hundred bytes off this page's own origin
   * and the join is asynchronous anyway.
   */
  private joinFromUrl(): void {
    const params = new URLSearchParams(location.search);
    const name = params.get("name");
    if (name) this.playerName = name;
    const server = params.get("server");
    if (server) this.regionBook.nameDev(server);
    const mp = params.get("mp");
    if (mp === null) return;
    // A value on `?mp` names the server too, so the one-navigation form does
    // not also need `?server=`.
    if (mp !== "") this.regionBook.nameDev(mp);
    if (this.regionBook.hasDev) {
      this.joinMatch();
      return;
    }
    void this.regionBook.ensure().then(() => {
      // Still on the menu, because this is the one join with a WAIT in front of
      // it. The read is milliseconds off this page's own origin in every
      // healthy case, but a deployment whose regions file does not answer holds
      // it for the full timeout — long enough for the menu to be up, its
      // confirm gate to have opened and a player to have started an offline
      // round. Yanking them out of one is worse than an `?mp` that lost a race
      // it only ever loses when somebody was already playing.
      if (this.state === "menu") this.joinMatch();
    });
  }

  /**
   * Joins a networked match: a specific one from the lobby, a fresh one, or
   * whatever has room when neither is asked for.
   *
   * The map is built LOCALLY exactly as an offline round builds it — the server
   * has the same layout and the same baked colliders, so the world both sides
   * reason about is the same one without a byte of it crossing the wire. What
   * comes over the wire is only what MOVES.
   *
   * **Which map that is belongs to the MATCH, never to this menu.** `opts.mapId`
   * is the row's, straight off the list the lobby is showing, and it is applied
   * before the build so the common case builds the right world first time. It is
   * an optimisation and not the guarantee: an unnamed join has no row to read,
   * and a match can rotate between the fetch and the pick, so the welcome is
   * still what settles it — see `applyMatchMap`. What travels the other way is
   * `map`, the map to start a match on if this join CREATES one.
   *
   * **Which SERVER is `opts.regionId`, and it is the row's rather than the
   * player's.** A match id means nothing outside the process that minted it —
   * every region has an `m1` — so a join that took the id from one row and the
   * address from the standing pick would ask the wrong server for a match that
   * probably exists there, and land the player in a stranger's round on another
   * continent. Absent is the join that names no row (`?mp`, and New match),
   * which is the only case the standing pick answers.
   */
  joinMatch(
    opts: { matchId?: string; create?: boolean; mapId?: string; regionId?: string } = {},
  ): void {
    if (this.net) return;
    // Refused before anything is built or connected, which is the cheapest of
    // the three places this can be caught and the only one that leaves the
    // player looking at the list they picked from.
    if (opts.mapId !== undefined && this.applyMatchMap(opts.mapId) === "unknown") {
      this.hud.toast(`that match is on "${opts.mapId}", which this build does not have`);
      return;
    }
    // Resolved ONCE, here, and spent on the socket below. Null only when the
    // region file has not been read yet — a state the lobby cannot be in, since
    // it awaits that read before it draws a row — and it means the same thing
    // it always did: whatever is answering `/ws` on this page's own origin.
    const region = this.regionBook.resolve(opts.regionId);
    const net = new NetSession(this.scene, this.mats);
    this.net = net;

    // The server placed us. This is the only thing that spawns the local body
    // in a networked round — there is no local respawn timer, because a
    // reinforcement is the authority's to spend.
    net.onSpawn = (pos, yaw) => {
      this.spawnPlayer({ pos: pos.clone(), yaw });
    };

    // A rejected position. Small disagreements are eased so an occasional
    // refusal is not a visible jerk; a large one is a genuine desync and
    // easing it would mean spending seconds visibly inside a wall.
    net.onCorrection = (pos, reason) => {
      const off = Vector3.Distance(this.player.position, pos);
      if (off > CONFIG.net.correctionSnap) {
        this.player.placeAt(pos.clone());
        this.hud.toast(`resynced (${reason})`);
      } else {
        this.player.nudgeTo(pos);
      }
    };

    // The side the authority put us on, arriving after the round was booked.
    // The build below is optimistic about everything, and about this it was
    // wrong for the second person into a match: `Roster.claim` fills the
    // thinner team, so they are on team 1 while every screen here is painted
    // for team 0.
    //
    // Two cases and one of them is not this callback's: a welcome that beats
    // the build has nothing on screen to correct and is read straight off the
    // session by `buildRound`, which is what the `loading` test defers to. The
    // team not having changed is the ordinary case — every first joiner, and
    // every reconnect that lands back on the same side — and it repaints
    // nothing there, because re-showing the deploy screen would throw away the
    // spawn the player is in the middle of choosing.
    net.onSeated = (team) => {
      if (this.state === "loading" || !this.map) return;
      // The map before the team, because a map that disagrees rebuilds the
      // whole round and `buildRound` deals the team itself on the way through.
      // This is the case the lobby's row could not cover: an unnamed join, or a
      // match that rotated between the list and the pick. The wasted build is
      // the price of booking the round before the socket is open, and it is
      // paid rarely — the welcome usually lands while `loading` is still up,
      // where the branch above defers to `buildRound`.
      switch (this.applyMatchMap(net.mapId)) {
        case "unknown":
          this.leaveUnknownMap(net.mapId);
          return;
        case "changed":
          this.startRound();
          return;
      }
      if (team !== this.player.team) this.applyPlayerTeam(team, this.map);
      // The welcome landed AFTER the build, so the glass it named has to be
      // applied here. `buildRound` covers the other order and `catchUp` is
      // idempotent, so exactly one of the two does the work and neither has to
      // know which.
      if (net.brokenPanes.length) this.glass.catchUp(net.brokenPanes);
      // A seat is a body the authority is holding until it is ASKED for, and
      // this callback is raised again on every reconnect — where the client is
      // usually in the middle of the round it thinks it is still playing. Its
      // old slot is gone, the new one is dead with a zero clock, and every
      // movement sample it sends from here on is dropped as "a dead player
      // reports nothing worth keeping": it would walk the map as a ghost that
      // nobody can see, be hit by nothing, and hit nothing back.
      //
      // So the screen that asks goes back up. After the team above, so the
      // spawns it offers belong to the new seat.
      //
      // `deploy` is deliberately not in this list: that screen is already up
      // and asking, and re-showing it would reset a selection the player is in
      // the middle of making — the same reason `applyPlayerTeam` re-shows it
      // only when the side has actually changed. A request made before the
      // reconnect is not lost with the socket either: `NetSession` holds it
      // until the authority answers with a spawn, and re-sends it on the seat
      // that answers.
      //
      // What is UNDER the screens and not what is on top of them, because a
      // reconnect is the authority's news and does not wait for the player to
      // close anything. Asked of `this.state`, a reseat taken while the pause
      // card was up read as `paused`, matched neither arm, and left the client
      // believing it was still playing — which is precisely the ghost the
      // paragraph above exists to prevent, arrived at through the one door that
      // was not watched. The lid comes down with the state, because `enterDeploy`
      // goes through `go`: this screen has to be answered, so it cannot be
      // raised behind one.
      const under = this.screens.under;
      if (under === "playing" || under === "dying") {
        this.enterDeploy(0);
      }
    };

    net.onEvent = (event) => this.onNetEvent(event);

    // Somebody else's body went down. The same pool and the same offer every
    // bot's corpse goes through — the only difference is that offline
    // `registerBotKill` reaches this line having just charged a ticket and
    // written a killfeed line, and here the authority did both before the news
    // arrived. A callback rather than a reach into the roster for the reason
    // every other cross-system effect in this file is one.
    //
    // The one refusal left is the view distance, and a body refused there is
    // one the server's own `EntityState.dead` will hide on its clock — see
    // `NetSoldier`'s dead branch, which is all that is left of the tween that
    // used to cover the other four.
    net.roster.onDeath = (soldier) =>
      this.ragdolls.spawn(soldier, this.cameraSys.camera.position);
    net.roster.onRetire = (soldier) => this.ragdolls.retire(soldier);

    // How far a body is worth drawing, from the standing map. `installMap`
    // pushes it too and is the usual path — a rotation rebuilds the world — but
    // a roster is built when the session is, which on a join into a match
    // already in progress is after the map that decides this. Both, because
    // neither one on its own covers both orders.
    net.roster.setViewDistance(this.mapDef.environment.fogEnd);

    // Boots. The exact counterpart of `wireBattle`'s `onBotStepped`, down to
    // the callback being handed the body rather than a position, and the one
    // sound in a netplay round that crosses no wire at all: a footfall is a
    // point on the walk cycle, and that cycle is already being integrated from
    // the ground this body covers (see `NetSoldier.onStep`). It fires for all
    // fifteen of them, so nothing here may do work per step — `Sfx.botStep`
    // rejects the far ones, which is where that decision belongs.
    net.roster.onStep = (soldier) => this.sfx.botStep(soldier.position);

    // A new round on a new map, same seat. The world is rebuilt LOCALLY from
    // the same layout the server is using — the map never crosses the wire —
    // and the server's spawn event puts the body back afterwards.
    //
    // Through `applyMatchMap` and not `setMap`, which is the player picking one
    // and refuses to run outside the menu: a rotation arrives in `roundover`,
    // so every one of them used to leave the client rebuilding the map it was
    // already on while the server moved to the next.
    net.onRoundStart = (mapId) => {
      if (this.applyMatchMap(mapId) === "unknown") {
        this.leaveUnknownMap(mapId);
        return;
      }
      this.startRound();
    };
    net.onStateChange = (state) => {
      if (state === "closed") this.hud.toast("disconnected");
    };

    // The handshake was refused — a match that filled or retired between the
    // list and the pick, or a server speaking a protocol this build does not.
    // The round that was optimistically started is torn down and the player is
    // put back where they chose from, with the server's own words for why.
    net.onRejected = (reason) => {
      // `enterMenu` drops the session and tears the round down; the lobby then
      // goes back up over it and re-fetches, so the row that refused is gone
      // from the list by the time the player reads why.
      this.enterMenu();
      this.hud.toast(reason);
      this.openLobby();
    };

    // The screen stays up under the build, showing which row is being joined,
    // and `startRound` takes it down on the way into `loading`. Qualified by
    // region for the reason the row itself is: the same match id is being shown
    // by every server on the screen.
    if (opts.matchId && region) this.lobbyScreen.setJoining(region.id, opts.matchId);

    this.startRound();
    net.connect({
      name: this.playerName,
      url: region?.socketUrl,
      weapon: this.weapon,
      // The third slot, sent on every join for `map`'s reason: the map a join
      // lands on decides whether there is a third slot at all, and the client
      // does not know which map that will be. The server resolves it once and
      // spends it whenever a round with armour in it comes round.
      equipment: this.equipment,
      matchId: opts.matchId,
      create: opts.create,
      // Sent on every join rather than only on a create, because "there is room
      // somewhere" can end in a fresh match too — the server spends this only
      // when it actually builds one, and ignores it otherwise.
      map: this.mapDef.id,
    });
  }

  /**
   * Drops the networked session, if there is one. Idempotent, and safe to call
   * from a state that never had one — which is most of `enterMenu`'s callers.
   */
  private leaveMatch(): void {
    this.net?.dispose();
    this.net = null;
    // Nothing can claim these now. They would time out on their own inside the
    // second, and clearing them is what makes that a property of the boundary
    // rather than of the window's length.
    this.hitCredits.length = 0;
  }

  /** What a server event does to this client's screen. Presentation only. */
  private onNetEvent(event: ServerEvent): void {
    switch (event.e) {
      case "kill": {
        // -1 is a death with no killer, which is the leash and only the leash —
        // see `ServerEvent`'s `kill`. Guarded rather than assumed: `killer`
        // indexes a two-row table, and the alternative to this line is reading
        // `CONFIG.teams[-1].name` off the end of it.
        const killer =
          event.killer >= 0 ? CONFIG.teams[event.killer].name : LEASH_KILLER;
        const victimSlot = this.net?.roster.soldiers[event.victim];
        const victim = victimSlot ? CONFIG.teams[victimSlot.team].name : "";
        this.hud.addKill(killer, victim, event.killer === this.player.team);
        // Arm the corpse with the round that felled it. It is SPENT later, by
        // `NetRoster` when the interpolated death arrives — this event is real
        // time and the body is drawn `interpDelay` behind it, so throwing it
        // here would throw a body that has not visibly been hit yet.
        if (victimSlot) {
          victimSlot.deathFrom.set(event.from[0], event.from[1], event.from[2]);
          victimSlot.deathDamage = event.amount;
          victimSlot.deathKind = event.kind ?? "bullet";
        }
        // The flat "a body went down" cue, which offline every bot death gets
        // through `registerBotKill` — this event is the authority's version of
        // that call, raised once per death whoever fell. Our own is the one
        // exception, exactly as offline: a player's own death is the death cam
        // and `playerHurt`, not somebody else falling over.
        if (event.victim !== this.net?.slot) this.sfx.enemyDie();
        break;
      }
      // The same pair `wireConquest` plays offline, from the authority's
      // version of the same event: a flag taken is worth hearing and a flag
      // lost is worth hearing more, and neither `ConquestSystem` callback fires
      // on a client that is not stepping one.
      case "captured":
        if (event.by === this.player.team) this.sfx.capture();
        else this.sfx.flagLost();
        this.hud.showMessage(
          `${event.point.toUpperCase()} CAPTURED BY ${CONFIG.teams[event.by].name.toUpperCase()}`,
          2.5,
        );
        break;
      case "neutralised":
        this.hud.toast(`${event.point} — neutralised`);
        break;
      // We were paid for something. Offline the same line comes off
      // `ScoreBook.onAward`; in a match it is a receipt the authority
      // addressed to us, and the client neither adds it up nor checks it —
      // what the board shows is the `scores` table, and this is the reason.
      case "score":
        this.hud.addScore(event.kind, event.points);
        break;
      case "roundover":
        this.endRound(event.winner);
        break;
      // Our own round landed — or, as often, did not. The local hitmarker was
      // a prediction made against interpolated bodies; this is the authority
      // re-resolving it against what we were actually looking at. When the two
      // disagree the server wins, and what is cued here is the CORRECTION and
      // nothing else: a round the shooter has already been told about is
      // claimed silently, because a marker and a tick arriving twice for one
      // bullet — a round trip apart, so plainly a second event rather than an
      // echo — reads as two hits and makes the cue worth less than it was.
      //
      // The server addresses this one to the shooter, so the slot test is a
      // GUARD and not the filter it used to be. It stays because the two halves
      // ship as separate images: during a rolling deploy this client may be
      // talking to a server old enough to still broadcast the event, and a
      // hitmarker for somebody else's round is exactly the failure a version
      // check at the handshake cannot catch, since the shape did not change.
      case "hit":
        if (
          event.shooter === this.net?.slot &&
          !this.claimPredictedHit(event.killed, event.headshot)
        ) {
          this.hud.flashHitmarker(event.killed, event.headshot);
          if (event.headshot) this.sfx.headshot();
          else this.sfx.hit();
        }
        break;

      // We were hit. Health is the server's, so it is assigned rather than
      // subtracted — a client that decremented its own would drift out of step
      // with the authority over a firefight and disagree about who is alive.
      // `applyServerHealth` also arms the regen lock, which is the half of the
      // hit that never crosses the wire: the server holds the health down for
      // `regenDelay` and then heals it back, and the client runs the identical
      // curve locally rather than being told about every point of it.
      //
      // Addressed to the victim by the server, so — exactly as with `hit` above
      // — the slot test is a rolling-deploy guard rather than the filter it was.
      case "damage":
        if (event.victim === this.net?.slot) {
          this.player.applyServerHealth(event.health);
          this.netDamageFrom.set(event.from[0], event.from[1], event.from[2]);
          this.netDamageAmount = event.amount;
          this.netDamageKind = event.kind ?? "bullet";
          this.onPlayerDamaged(
            event.amount,
            false,
            this.netDamageFrom,
            this.netDamageKind,
          );
        }
        break;

      // A death, decided elsewhere. `killPlayer` is the local path and must not
      // run here: it charges a ticket and starts a respawn clock, both of which
      // the server already owns.
      //
      // What it DOES owe is the four seconds of watching, because a death cam
      // decides nothing — it is a camera and a stand-in body, and the round
      // carries on underneath it either way. The bearing and the size of the
      // killing blow are the `damage` event's, which the server queues
      // immediately ahead of this one and which is the only thing that knows
      // them: `died` carries a slot and a clock and nothing to throw a body
      // with. `enterDying` falls through to the deploy screen on its own if the
      // cam cannot come up, so this is not a state that can strand a player.
      case "died":
        if (event.slot === this.net?.slot) {
          this.player.health = 0;
          this.player.alive = false;
          if (this.state === "playing") {
            this.enterDying(
              this.netDamageFrom,
              this.netDamageAmount,
              this.netDamageKind,
              event.respawnIn,
            );
          } else {
            this.enterDeploy(event.respawnIn);
          }
        }
        break;

      // Somebody's weapon went off, and it is worth exactly what offline's
      // `BattleSystem.onBotFired` is worth: a report to place by ear, and — for
      // an enemy — a couple of seconds on the minimap. Both are `wireBattle`
      // reading a callback offline, and that callback fires on nothing here,
      // because this client runs no AI and never hears another person's
      // trigger. So the authority says it instead.
      //
      // The two halves differ in who they are about, exactly as offline: every
      // shot in the village is audible whoever fired it, while the reveal is
      // the enemy's alone — a friendly is drawn on that map whether they are
      // shooting or not.
      //
      // Our own slot is skipped outright. `sfx.shoot` already played that round
      // at the player's own ear the frame the trigger went, and the roster's
      // copy of this body is deliberately never sampled, so its position is
      // wherever the pool was built.
      //
      // Public, and it may name a body across the map behind a wall — exactly
      // as offline, where any enemy bot firing anywhere is revealed. It gives
      // nothing away that the snapshot has not already handed over: every
      // position is in there, and what the minimap withholds it withholds by
      // choice rather than by ignorance.
      case "fire": {
        if (event.slot === this.net?.slot) break;
        const shooter = this.net?.roster.soldiers[event.slot];
        if (!shooter) break;
        // The eye rather than the feet: a rifle goes off at a shoulder, and
        // this is the only height on a net body that is near one. Offline the
        // same sound is placed at the bot's own muzzle.
        //
        // One event carries every round that slot fired inside a snapshot
        // interval, so they are laid back out across it rather than stacked on
        // one instant — a burst played as a single louder shot reads as one
        // shot, and the rate is most of what says which weapon is being fired
        // at you. Bounded by the ticks in an interval, which is the most a
        // rate-gated slot can physically have spent, because the count came off
        // a socket.
        const rounds = Math.min(Math.max(event.n ?? 1, 1), TICK_HZ / SNAPSHOT_HZ);
        const spacing = 1 / SNAPSHOT_HZ / rounds;
        // Voiced by the weapon the authority says is in that slot's hands, so
        // a match can be read by ear the way an offline round can be read by
        // eye: a DMR two streets away is not the SMG beside you. A slot with
        // no weapon named is a bot, and a bot fires the flat round.
        const voice = this.netVoice(event.w);
        for (let i = 0; i < rounds; i++) {
          this.sfx.botShot(shooter.eyePos, i * spacing, voice);
        }
        if (shooter.team !== this.player.team) this.minimap.reveal(shooter);
        break;
      }

      // Somebody is changing a magazine. Spatialised, because knowing WHICH of
      // the enemies in front of you has just gone dry is the whole point of
      // hearing it, and it is the same `Sfx.botReload` offline hangs off
      // `BattleSystem.onBotReloaded`.
      //
      // Our own is skipped for the reason our own fire is: `player.onReload`
      // played it locally and sent the announcement that came back as this.
      case "reload": {
        if (event.slot === this.net?.slot) break;
        const who = this.net?.roster.soldiers[event.slot];
        if (who) this.sfx.botReload(who.position, this.netVoice(event.w));
        break;
      }

      // A round cracked past us. Not a hit and not a hit sound — the supersonic
      // N-wave, which arrives before the report of the rifle that sent it and is
      // the only thing that says the fire is meant for YOU rather than merely
      // near you. Offline it is `CombatSystem.onNearMiss` finding the player
      // inside the target loop of somebody else's shot; here no client resolves
      // anybody else's rounds, so the authority is the only thing that can see
      // one happen.
      //
      // Both halves of the offline handler, and they are a pair: the crack is
      // what the player hears and `suppress` is what it does to their hands.
      // Addressed to us by the server, so there is no slot to guard on — see
      // the event's own note.
      case "nearmiss":
        this.netNearPoint.set(event.at[0], event.at[1], event.at[2]);
        this.sfx.nearMiss(this.netNearPoint);
        this.player.suppress();
        break;

      // A blast the authority resolved. The light, the noise and the
      // concussion are `onExplosion`'s, exactly as they are offline — the
      // difference is only who decided it happened.
      // The blast itself, and the one case where the PICTURE is raised from
      // outside `GrenadeSystem`. `drawBlast` puts the six drawn layers up and
      // hands back what the blast went off on; `onExplosion` does the rest with
      // it. Before this the event was a light and a bang with nothing burning
      // in the middle of it — somebody else's grenade had no fireball at all.
      case "explode": {
        this.netDamageFrom.set(event.at[0], event.at[1], event.at[2]);
        // How big it LOOKS. A grenade is 1 by definition and says nothing;
        // a tank shell, a rocket and a mine each carry their own, which is
        // the only way this client can tell them apart — no other field on
        // this event says what went off.
        const power = event.power ?? 1;
        const ground = this.grenades.drawBlast(this.netDamageFrom, power);
        this.onExplosion(this.netDamageFrom, power, ground);
        break;
      }

      // The authority's answer to a mount or a dismount, and the ONLY thing
      // that puts this player in a hull or takes them out of one in a match.
      // It reaches `mount`/`clearVehicle` — the same pair an offline round
      // uses, so everything either of them owns is owned identically here.
      //
      // A refusal arrives as `tank: -1` on a player who is already on foot,
      // which `clearVehicle` reads as the no-op it documents itself to be.
      case "seat": {
        if (event.slot !== this.net?.slot) break;
        if (event.tank >= 0) {
          const tank = this.vehicles.tanks[event.tank];
          if (tank && tank !== this.driving) this.mount(tank);
          break;
        }
        if (!this.driving) break;
        // Where the body goes is the authority's, exactly as a spawn's is —
        // and it is placed BEFORE the seat is given up for `dismount`'s
        // reason: `clearVehicle` deliberately does not move anybody, and the
        // camera hand-off below reads the chase yaw that is about to be gone.
        if (event.pos) {
          this.netDamageFrom.set(event.pos[0], event.pos[1], event.pos[2]);
          this.player.placeAt(this.netDamageFrom);
        }
        const yaw = event.yaw ?? this.vehicleCam.yaw;
        this.clearVehicle();
        // The aim just jumped a long way — see `dismount`, which spends the
        // same two lines for the same reason on the offline path.
        this.cameraSys.reset(yaw);
        this.motionBlur.reset();
        this.input.consumeFire();
        break;
      }

      // A tank gun went off somewhere. The report and nothing else: the flash,
      // the light and the round itself are all the authority's, and the hull
      // it came out of is already being drawn where the snapshot put it — so
      // the noise is placed on the MUZZLE of that hull, which is the same rule
      // `fire` follows one scale down.
      case "cannon": {
        const tank = this.vehicles.tanks[event.tank];
        if (!tank || tank === this.driving) break;
        this.sfx.cannon(tank.muzzleToRef(this.shellFrom));
        const lc = CONFIG.lighting;
        this.lighting.pulse(
          this.shellFrom,
          lc.muzzleColor,
          lc.muzzleRange * 2.2,
          lc.muzzleIntensity,
          lc.muzzleLife * 2.5,
        );
        break;
      }

      // The authority's word on the glass. It arrives for our OWN shots too,
      // and that is what completes them: `onShotPath` predicted the pane away
      // and left the collider standing, and this is the half that takes it out
      // of the world. `applyBreak` is idempotent for the visual and reports
      // false for a pane already gone, so a predicted break plays its shards
      // once and this call is silent.
      case "glass": {
        this.netDamageFrom.set(event.at[0], event.at[1], event.at[2]);
        this.netGlassDir.set(event.dir[0], event.dir[1], event.dir[2]);
        for (const pane of event.panes) {
          this.glass.applyBreak(pane, this.netDamageFrom, this.netGlassDir, true);
        }
        break;
      }

      case "spawn":
        break;
    }
  }

  /**
   * The report a remote slot's shot or magazine is voiced through, from the
   * weapon id the authority put on the event.
   *
   * **Guarded rather than indexed.** That id came off a socket, and a build on
   * the far side naming a weapon this one has never heard of must degrade to
   * the flat round rather than reach into the table with it. `undefined` is
   * exactly what `Sfx` reads as that round, so the guard, an absent field and
   * a bot's shot all land in the same place without a second branch.
   */
  private netVoice(w: string | undefined): ReportVoice | undefined {
    return w !== undefined && isWeaponId(w) ? CONFIG.weapons[w].report : undefined;
  }

  /**
   * Who the local player's own rounds may find: the bots offline, the bodies
   * drawn from the wire in a netplay round.
   *
   * Two callers — the shot resolve and the gamepad aim assist — and the whole
   * reason this is a method is that they must never be handed different lists:
   * the assist's job is to hold an aim the rounds can use.
   *
   * `battle` is not merely the wrong list in a netplay round, it is an EMPTY
   * one, and empty in a way no team check reveals. `buildRound` calls
   * `battle.reset()`, which leaves every bot in the pool dead, and `updateWorld`
   * returns before `battle.update` is ever reached, so nothing respawns them;
   * the only other combatant that side knows about is the local player, whom the
   * team check drops. Reading that list there cost the shooter every local cue a
   * hit is owed — sparks landed on the wall behind the man who was hit, no
   * hitmarker arrived until the server's `hit` event had made the round trip,
   * and aim assist had nothing to hold on to at all.
   *
   * The result is a scratch array owned by whichever side answered. Consume it
   * inside the call, exactly as `BattleSystem.hittablesAgainst`'s own contract
   * requires — both callers do.
   */
  private enemyTargets(): Hittable[] {
    if (!this.net) return this.battle.hittablesAgainst(this.player.team);
    // The bodies, plus the armour. A hull is a `Hittable` on this side too and
    // has to be in the list for the local cue a hit is owed — without it a
    // round fired at a tank sparks off the collider with no hitmarker, and the
    // aim assist has nothing to hold. What it CANNOT do is damage the thing:
    // `Tank.predicted` refuses every blow in a match, exactly as
    // `NetSoldier.takeDamage` does, so this list is a prediction and nothing
    // more.
    //
    // Copied into this file's own scratch rather than pushed onto the roster's:
    // that array is `NetRoster`'s and is handed out again on the next call, and
    // a class that has deliberately never heard of a vehicle should not come
    // back holding two.
    const out = this.netTargets;
    out.length = 0;
    out.push(...this.net.roster.hittablesAgainst(this.player.team));
    for (const tank of this.vehicles.tanks) {
      if (tank.alive && tank.team !== this.player.team) out.push(tank);
    }
    return out;
  }

  /** See `enemyTargets`. Reused, so a shot in a netplay round allocates nothing. */
  private readonly netTargets: Hittable[] = [];

  /**
   * Every body but the local player's, as the minimap draws them.
   *
   * The same substitution `enemyTargets` makes, for the same reason and with
   * the same failure behind it: in a netplay round `battle.bots` is a pool
   * `battle.reset()` left dead and `updateWorld` never steps again, so the map
   * drew no friendlies at all and a reveal had nobody to name. It was not a
   * missing feature so much as a list that had quietly gone empty — the panel
   * still drew, the flags still moved, and only the blips were gone.
   *
   * Unlike `enemyTargets` this is a plain READ — no shot is resolved against
   * it, no team is filtered out of it — so it hands back the array as it
   * stands rather than a scratch list, and both teams are in it because the
   * minimap decides for itself which half it may draw.
   *
   * The local player's own slot IS in the netplay array, and is left dead by
   * `NetRoster.applyRoster` for the life of the session (its snapshots are
   * skipped, so nothing revives it). That is what keeps a friendly blip from
   * sitting under the arrow that already stands for the player.
   */
  private mapBodies(): readonly Combatant[] {
    return this.net ? this.net.roster.soldiers : this.battle.bots;
  }

  /**
   * Rounds this client has already cued a hitmarker for, waiting on the
   * authority to say whether it agrees.
   *
   * The pair of methods below is the whole of the rule that a landed round is
   * announced ONCE. Both ends have an opinion about the same bullet — the local
   * resolve the instant the trigger went, the server's `hit` a round trip later
   * — and the second is worth a marker and a noise only when it carries
   * something the first did not.
   *
   * A queue rather than a counter because several rounds are in flight at
   * automatic rates, and each is claimed in the order it was fired: the server
   * re-resolves them in that order and reports them down one socket, so
   * first-in-first-out pairs them without the protocol carrying a shot id.
   * Entries expire on their own, which is what stops a round the authority
   * scored as a MISS — no event ever arrives for one — from leaving a credit
   * standing to swallow the next real correction.
   *
   * Only bullets are ever in here: `Match` raises `hit` from the shot path and
   * from nowhere else, so a blast can neither leave a credit nor claim one.
   */
  private readonly hitCredits: { headshot: boolean; until: number }[] = [];

  /** Drops credits the authority never claimed. Ordered, so the front is oldest. */
  private pruneHitCredits(now: number): void {
    while (this.hitCredits.length > 0 && this.hitCredits[0].until <= now) {
      this.hitCredits.shift();
    }
  }

  /** A local resolve says this round landed, and the marker is already up. */
  private creditPredictedHit(headshot: boolean): void {
    const now = performance.now();
    this.pruneHitCredits(now);
    this.hitCredits.push({
      headshot,
      until: now + CONFIG.net.hitCreditWindow * 1000,
    });
  }

  /**
   * The authority's verdict on a round. True when this client has already said
   * everything the verdict has to say, and the event owes no second cue.
   *
   * The credit is spent either way — this round's answer has arrived, whatever
   * it is. Two things override agreement:
   *
   * - **A kill.** The prediction cannot make that claim (`NetSoldier.takeDamage`
   *   returns false, so the local resolve never reports one), and the red marker
   *   is the one that means STOP SHOOTING — the most useful thing a hitmarker
   *   ever says, and never a repetition.
   * - **A headshot the prediction missed.** The bodies here are drawn
   *   `interpDelay` behind, so the head zone the server found on its rewound
   *   copy is not always the one this client tested against.
   *
   * The other direction — this client called a headshot and the server scored a
   * body hit — is deliberately silent. It is a hit either way, the marker for it
   * is already on screen, and correcting the flavour downward is worth less than
   * the doubled cue it would cost.
   */
  private claimPredictedHit(killed: boolean, headshot: boolean): boolean {
    this.pruneHitCredits(performance.now());
    const credit = this.hitCredits.shift();
    if (!credit) return false;
    if (killed) return false;
    return !(headshot && !credit.headshot);
  }

  /** Scratch for a networked damage bearing; never allocated per hit. */
  private readonly netDamageFrom = new Vector3();
  /** The same, for the direction a round crossed a pane it broke. */
  private readonly netGlassDir = new Vector3();
  /**
   * The same, for where a round came closest on its way past.
   *
   * Its own vector rather than a share of the one above, because a near miss
   * and a hit are different events that can land in the same tick's message —
   * and `netDamageFrom` has to survive until the `died` that reads it.
   */
  private readonly netNearPoint = new Vector3();
  /**
   * How much the last networked hit was for, kept alongside the bearing so the
   * `died` event that follows it has something to throw the corpse with.
   */
  private netDamageAmount = 0;
  /**
   * …and what delivered it, the third of the same triple and kept for the same
   * window. A server too old to name one says `bullet` by omission, which is
   * what every death on the wire was before a blast could throw a body.
   */
  private netDamageKind: DamageKind = "bullet";

  /**
   * The networked half of a frame.
   *
   * Called from `updateWorld` after the local player has moved, so what is
   * uploaded is this frame's position rather than last frame's, and before
   * anything reads where the other bodies are. `updateWorld` and not
   * `updateGameplay` because the death cam runs the former and not the latter,
   * and a death cam over sixteen bodies frozen mid-stride is the screenshot
   * that split is there to prevent.
   */
  private updateNet(dt: number): void {
    if (!this.net) return;
    this.net.update(
      dt,
      {
        position: this.player.position,
        // The chase camera's aim while driving, the body's otherwise. It is
        // one field either way because it answers one question — where is this
        // person LOOKING — and the authority measures a claimed round against
        // it whichever weapon fired.
        yaw: this.driving ? this.vehicleCam.yaw : this.cameraSys.aimYaw,
        pitch: this.driving ? this.vehicleCam.pitch : this.cameraSys.aimPitch,
        crouching: this.player.crouching,
        sprinting: this.player.sprinting,
        // The hull, or null on foot. Non-null is what switches the upload from
        // a body's step to a tank's — see `LocalState.hull`.
        hull: this.localHull(),
      },
      this.conquest.points,
      this.cameraSys.camera.position,
      // Only a player who is actually IN the round reports where they are. The
      // health flag alone is not that question any more, now that this runs
      // under the deploy screen too: a round opens with a live `Player` that
      // has never been placed, so a bare `alive` would upload the last round's
      // position — or the origin — on behalf of a body the authority holds as
      // dead and has not deployed yet. The server drops those samples anyway
      // (`onMove` returns on a dead player), which is exactly why the client
      // should not be sending them.
      this.state === "playing" && this.player.alive,
    );
    // The mirrored ticket counts, so the HUD strip reads the server's round
    // rather than a local `ConquestSystem` that is no longer being stepped.
    this.conquest.tickets[0] = this.net.tickets[0];
    this.conquest.tickets[1] = this.net.tickets[1];
  }

  /**
   * The half of a netplay frame that is this client's rather than the
   * authority's: everybody else's bodies, and the effects nobody else advances.
   *
   * One method because it has two callers that must never drift apart —
   * `updateWorld` for the states that are IN the round, and the deploy screen
   * for the one state that is not. A player waiting to come back is watching a
   * fight that has not stopped for them, and this screen is a live view of it
   * with a top-down map of the flags over the top; left unstepped, sixteen
   * bodies stand frozen behind the card and then snap to wherever they really
   * are on the frame the player deploys.
   *
   * `RagdollSystem` is in here for a reason sharper than symmetry: `updateNet`
   * is what raises an interpolated death, and a death raised while the pool is
   * not being stepped is a corpse that takes a rig, parents its joints to
   * proxies nothing writes, and hangs in the air for the rest of the round.
   * Stepping the roster without stepping the pool is not half the feature, it
   * is a haunting.
   *
   * This is still not simulation and may never become it. Nothing here decides
   * an outcome, which is what keeps it callable from a state that owns none —
   * and it stays out of `paused` and `menu` for the reason it belongs in
   * `deploy`: those two are a round that is not running, and this is a round
   * running without you.
   */
  private updateNetWorld(dt: number): void {
    this.updateNet(dt);
    this.combat.update(dt);
    this.grenades.update(dt);
    // The armour. It is here rather than in the simulation below for the
    // reason everything else in this method is: none of it decides anything.
    // The hulls are posed from the wire (`NetVehicles`), the one under this
    // player is simulated by them, and what the fleet still owes on both
    // counts is the ground it stands on, the lean, the belts and the masts —
    // which is `Tank.updateRemote`'s and `Tank.update`'s, and is dressing.
    //
    // Stepped under the DEPLOY screen too, like the bodies beside it: a tank
    // frozen in the street behind the card and then snapping across it on the
    // frame the player spawns is the same failure sixteen frozen bodies were.
    if (!this.vehicles.empty) {
      this.syncNetVehicles();
      this.vehicles.update(dt, this.vehicleOrders);
    }
    // The local player's own rocket, still flying — the one AT object this
    // client owns a copy of. Everything else about the kit is drawn by
    // `NetOrdnance` off the wire, and neither can hurt anybody.
    this.antiTank.update(dt);
    // The engine BEFORE its three clients, always. A corpse tested for stillness
    // or a shard aged before its own step would be reading last frame's
    // velocities — and this is the only place the world is stepped:
    // `scene.physicsEnabled` is false precisely so that a pause, the deploy map
    // and the menu, all of which render, cannot advance it.
    this.physics.update(dt);
    this.ragdolls.update(dt);
    this.debris.update(dt);
    this.blastDebris.update(dt);
    // A pane can break while the local player is on the deploy screen — the
    // authority is running the round without them — and the rebuild it owes has
    // to drain here too, or a whole deployment's worth of breaks lands as one
    // hitch on the frame they spawn.
    this.glass.update();
  }

  /**
   * The three transitions a hull makes in a match, applied from the wire.
   *
   * A hull is LIVE, a WRECK or GONE, and in a netplay round the authority owns
   * every step between them — `VehicleSystem`'s own two clocks stand down for
   * a `predicted` fleet. So this is the whole of what a client does about
   * them, and each arm is an edge rather than a state so a snapshot restating
   * the same thing twenty times a second costs three comparisons:
   *
   *   - **gone** — dropped from the snapshot, so it is taken off the field.
   *   - **arrived** — named again after being gone, so a fresh hull is put on
   *     its hardstanding. `placeAt` is what puts the collider, the paint and
   *     the gun's clock back, exactly as a respawn does offline.
   *   - **burned** — still there and no longer alive. `Tank.wreck` is the same
   *     door `destroy` takes, which is what keeps the toast, the crew and the
   *     charred repaint identical on both sides of the wire.
   *
   * `occupied` is written here as well, and it has to be: it is the flag
   * `enterable` and `occupiedNear` read, nothing local ever writes it in a
   * match, and without it this client would offer a seat in a tank somebody
   * else is already sitting in.
   */
  private syncNetVehicles(): void {
    const net = this.net;
    if (!net) return;
    for (const [i, tank] of this.vehicles.tanks.entries()) {
      const present = net.vehicles.present(i);
      if (!present) {
        if (tank.body.isEnabled()) tank.hide();
        continue;
      }
      const state = net.vehicles.stateFor(i);
      if (!tank.body.isEnabled()) {
        // A fresh hull, and it is placed at the position that arrived rather
        // than at the hardstanding: the two are the same on a respawn, and
        // they are NOT the same for a hull this client has only just been told
        // about — a joiner mid-round would otherwise put every tank back on
        // its pad for one frame before the wire dragged it to where it is.
        if (!state) continue;
        tank.placeAt(this.hullPlace.set(state.x, state.y, state.z), state.yaw);
      }
      // What is left of it, written straight in rather than through
      // `takeDamage` — which a `predicted` hull refuses by design. This is the
      // number the driver's own armour gauge draws, and it is the authority's
      // in a match exactly as the player's own health is.
      tank.health = net.vehicles.health(i);
      if (!net.vehicles.alive(i)) tank.wreck();
      this.vehicles.setOccupied(tank, net.vehicles.occupant(i) >= 0);
    }
  }

  /**
   * That same frame, plus the two gauges, for a card the round is running
   * behind. Offline both callers are a game genuinely held; in netplay neither
   * is, and the difference is the whole of this method.
   *
   * The two HUD pushes are `updateGameplay`'s, made here because the deploy
   * screen and the pause card are the two overlays that deliberately do NOT
   * hide the gauges under them: a flag falling while you pick where to drop in
   * — or while you sit in a menu — changes both, and a strip that only
   * refreshes once you are back in the world spends the whole of that showing
   * the round you left.
   *
   * One method rather than the same eight lines twice, for the reason
   * `updateNetWorld` is one method: two copies of a frame drift, and the way
   * they drift is that a screen added to one keeps drawing while the other
   * stands still.
   */
  private updateNetUnderCard(dt: number): void {
    if (!this.net) return;
    this.updateNetWorld(dt);
    this.hud.setTickets(
      [CONFIG.teams[0].name, CONFIG.teams[1].name],
      this.conquest.tickets,
      this.player.team,
    );
    this.hud.setFlags(this.conquest.points, this.player.team);
  }

  /**
   * True while the world on screen is genuinely stopped — an offline pause, and
   * whatever is raised over one. It is what the HUD's own clock keys off: the
   * killfeed and the toasts belong to the frame, so they freeze with it and fade
   * with it, and the failure either way round is a fight fading off a still
   * screen or a still screen catching up in one jump.
   *
   * The session test is the whole of the online half: in a netplay round nothing
   * on this client holds anything, because the authority never heard the key.
   * Which screens hold the world OFFLINE is `ScreenSpec.holdsWorld`, asked of
   * the whole stack — the deploy screen is deliberately not one of them even
   * though it holds the world just as hard, because the gauges under it are the
   * ones a player reads while choosing and the countdown on the card is a clock
   * of its own.
   */
  private get worldHeld(): boolean {
    return !this.net && this.screens.holdsWorld;
  }

  /**
   * The authority's round, carried on behind whatever this client has on screen:
   * the frame, the gauges, and the reinforcement clock when what is under the
   * stack is the deploy screen.
   *
   * Called once from `tick` for every state, which is the point of it. This was
   * four calls — one per screen that happened to know it owed one — and the rule
   * that kept them honest was a comment saying the next screen owed the same. Now
   * the screen answers `ScreenSpec.roundBehind` and `tick` does the asking, so a
   * fifth screen cannot be written without an answer and cannot be written with
   * the wrong one silently: the row is next to the four that are right.
   *
   * The clock is here rather than in `updateDeployScreen` because it is the
   * ROUND's and not the screen's. The authority runs `NetPlayer.respawnT` down
   * whatever this client has on top, and the local copy is a countdown drawn on
   * the card plus the gate on its own Deploy button — so a lid that stops it
   * makes a player wait out time the server has already given them back, and the
   * number on the card is wrong the whole while. Offline that same lid genuinely
   * holds the round and the clock is right to stop with it. Under no lid the
   * deploy screen runs its own, which is why this asks for both.
   */
  private updateRoundBehind(dt: number): void {
    if (!this.net || !this.screens.roundBehind) return;
    this.updateNetUnderCard(dt);
    if (!this.screens.lidUp || this.screens.under !== "deploy") return;
    this.respawnT -= dt;
    this.deployScreen.update(this.respawnT);
  }

  private updateWorld(dt: number): boolean {
    // A networked round is somebody else's simulation. Everything below this
    // decides an outcome — who owns a flag, where a bot is going, who died —
    // and the authority has already decided all of it, so the client draws what
    // it was told and runs none of it. The bodies, the flags and the tickets
    // all arrive through `NetSession`, which is stepped from `updateGameplay`
    // where the local player's own frame is.
    //
    // What it still owes is the DRESSING on what it was told, and that is a
    // shorter list than "everything below": a tracer, the impact at the end of
    // it and the grenade the thrower watched leave their own hand decide
    // nothing, are owned by this client alone, and are stepped by nobody else.
    // Left out they do not merely stop moving — a tracer is spawned AT the
    // muzzle a hundredth of a metre long and it is `update` that flies it and
    // hides it again, so every shot left a lit dot hanging in the air where
    // the muzzle had been, and a thrown grenade hung at the release point with
    // a fuse that never ran down. Nothing in here may decide an outcome; that
    // is what keeps this from growing back into the simulation below.
    //
    // The bodies are drawn from here rather than from `updateGameplay` so that
    // the DEATH CAM gets them too. Every line of this method is what a death
    // cam needs and none of what surrounds it — that is the split the header
    // above argues — and a networked round left `updateNet` on the other side
    // of it, so the four seconds spent watching your own body fall were four
    // seconds during which nobody else moved. The order is unchanged: this is
    // still the first thing after the local player has been simulated and
    // before anything reads where anybody is.
    if (this.net) {
      this.updateNetWorld(dt);
      return true;
    }

    // --- objectives ---
    // Runs before the bots so their think tick sees this frame's ownership.
    this.combatants.length = 0;
    this.combatants.push(this.player, ...this.battle.bots);
    this.conquest.update(dt, this.combatants);
    if (this.conquest.winner !== null) {
      this.endRound(this.conquest.winner);
      return false;
    }

    // --- the armour ---
    // Before the bots, for the reason `ConquestSystem` runs before them: a
    // bot's think tick tests line of sight against the solid world, and a hull
    // is part of that world. Stepped after the flags and before the AI, a tank
    // that has just pulled across a street breaks the sightline on the same
    // frame it visibly blocked it rather than one frame late.
    //
    // It is also what MOVES the hull the camera is about to be framed against —
    // see `VehicleCamera`'s note on why its two halves straddle this call.
    //
    // The bot crews go first, for the reason `updateDriver` runs before this
    // for the player: what they write is the drive input this step consumes,
    // so a crew stepped afterwards would be steering a hull on last frame's
    // orders. It is also where a crew's shell is fired, which is why it lands
    // before the bots think — a hull destroyed by one is not a target on the
    // same frame's acquisition, exactly as a flag taken by `conquest.update`
    // is not still contested.
    this.crew.update(dt);
    this.vehicles.update(dt, this.vehicleOrders);

    // --- bots ---
    this.battle.update(dt, this.cameraSys.camera.position);
    this.spendMuzzleLightBudget();
    this.combat.update(dt);
    // After the bots, so a grenade thrown on this frame's think tick flies on
    // this frame rather than sitting in the thrower's hand until the next one.
    this.grenades.update(dt);
    // Beside them, and after `vehicles.update` for a second reason of its own:
    // a mine's trigger is a distance test against where a hull IS, and running
    // it before the hull moved would arm the road a frame behind the tank.
    this.antiTank.update(dt);
    // After the grenades, because a blast kill resolves in there — so a body
    // taken this frame gets its first step this frame rather than hanging in
    // the air for one. Together with the one in `updateNetWorld` this is the
    // ONLY place the physics world is stepped: `scene.physicsEnabled` is false
    // precisely so that a pause, the deploy map and the menu — all of which
    // render — cannot advance it.
    //
    // The ENGINE first and its three clients after, always: a corpse tested for
    // stillness or a shard aged before its own step would be reading last
    // frame's velocities.
    this.physics.update(dt);
    this.ragdolls.update(dt);
    this.debris.update(dt);
    this.blastDebris.update(dt);
    // Last, and it is not an effect: this drains the flow-field rebuild a
    // broken pane owes, one field per frame. After the bots on purpose — a
    // field swapped in mid-frame would be read by half this frame's think ticks
    // and not the other half, and next frame's are the ones that should see it.
    this.glass.update();
    return true;
  }

  /**
   * The frame while the player is down: the same fight, watched from outside.
   *
   * It runs the world first and the camera second, the same order
   * `updateGameplay` does and for the same reason — everything downstream of
   * the camera (shader fog, light slots, audio panning) keys off where the
   * viewer is, and the viewer here is following a body that the ragdoll step
   * above has just moved.
   *
   * The wait is not additive: the deploy screen opens with `respawnDelay` minus
   * the time already spent here, so a life still costs the same eight seconds
   * it did before there was anything to watch.
   */
  private updateDeathCam(dt: number): void {
    if (!this.updateWorld(dt)) return;
    this.deathCam.update(dt);
    // The one place the camera is allowed off the player's eye.
    this.cameraSys.place(this.deathCam.eye, this.deathCam.look);
    // The body, not the corpse's last standing position: the shadow window has
    // to cover what is on screen, and what is on screen is wherever the tumble
    // ended up.
    this.shadowFocus.copyFrom(this.deathCam.look);
    this.updateSceneForCamera(dt, this.shadowFocus, this.player, this.combatants);
    this.zones.update(
      dt,
      this.conquest.points,
      this.player.team,
      this.cameraSys.camera.position,
    );
    this.updateHud(dt, true);
    // A cam that is no longer up ends this state as surely as one that ran its
    // course. The clock alone would not: `stop()` zeroes it, so a cam dropped
    // by anything that did not also move the state on would leave `elapsed` at
    // 0 for the rest of the round — a state whose exit condition is a clock
    // that has stopped ticking, which is a player who never respawns. Every
    // stop site does move the state today, and this is what keeps the exit from
    // depending on all of them continuing to.
    const dc = CONFIG.player.deathCam;
    if (!this.deathCam.active || this.deathCam.elapsed >= dc.time) {
      this.enterDeploy(Math.max(0, this.deathRespawnIn - dc.time));
    }
  }

  /**
   * The player's throw, at the moment the hand reaches full extension. It
   * leaves from the VIEWMODEL's throwing hand rather than from a point
   * measured off the eye, which is the difference between a grenade that was
   * thrown and one that was fired: the eye follows the same object out of the
   * same hand it watched cock back, off the camera's axis and on the off-hand
   * side, instead of finding it already in flight down the middle of the
   * screen on the frame the button went down.
   *
   * `handAhead` survives as a FLOOR on that point for the reason it was there
   * in the first place — a throw taken with a wall at your shoulder must not
   * spawn the grenade inside the wall, where its first act would be to bounce
   * back into your face. The extended hand clears it comfortably.
   *
   * The count is spent only once the pool has agreed to carry it: a grenade
   * debited for a throw that never happened is the most confusing thing this
   * feature could hand a player, which is why `Player` splits the release from
   * the booking. A refusal here costs the arm's cooldown and nothing else.
   */
  private releaseGrenade(): void {
    const g = CONFIG.grenade;
    const eye = this.cameraSys.camera.position;
    const forward = this.cameraSys.forward;
    this.grenadeHand.copyFrom(this.player.throwHandWorld());
    const ahead =
      (this.grenadeHand.x - eye.x) * forward.x +
      (this.grenadeHand.y - eye.y) * forward.y +
      (this.grenadeHand.z - eye.z) * forward.z;
    if (ahead < g.handAhead) {
      const d = g.handAhead - ahead;
      this.grenadeHand.addInPlaceFromFloats(
        forward.x * d,
        forward.y * d,
        forward.z * d,
      );
    }
    if (
      !this.grenades.throwAlong(
        this.grenadeHand,
        forward,
        this.player.team,
        this.player,
      )
    ) {
      return;
    }
    this.player.spendGrenade();
    // Networked: the authority throws its own copy and owns the blast. The
    // local one above still flies — it is what the thrower watches arc — but
    // it hurts nobody, because `hittablesFor` is wired to `battle`, and in a
    // netplay round that list is empty: the local bot pool is reset dead and
    // never stepped. A bullet is given the roster's bodies instead
    // (`enemyTargets`) because a shot owes the shooter an immediate tracer and
    // hitmarker; a blast owes nothing of the kind — its light, noise and
    // concussion all arrive on the server's `explode` event — so pointing this
    // at them would buy a line-of-sight ray per body within the radius and
    // nothing else. The pouch is the server's count too; spending here only
    // keeps the HUD honest.
    this.net?.sendGrenade(this.grenadeHand, this.cameraSys.forward);
    this.sfx.grenadeThrow();
    // The body's own follow-through, through the spring the landing and the
    // blast concussion already share — one integrator on the eye, never a
    // shake of its own.
    this.cameraSys.land(g.throwShake);
  }

  /**
   * Camera & rendering support. This tail order is LOAD-BEARING: light slot
   * selection, the shader's fog, and audio panning all key off the camera
   * position, so anything that moves the camera must run before them:
   * aim assist -> camera update -> shadows (window, blobs, outline thinning)
   * -> carried lights -> lighting.update() -> water.update() -> grass.update()
   * -> mats.updateWind() -> sfx.setListener(), and then `tick` pushes the
   * shader's eye for every state on the way into the render.
   * Nothing after this method may move the camera.
   */
  private updateCameraAndLighting(dt: number): void {
    // Aim assist reads last frame's aim and this frame's enemy list (consumed
    // synchronously — the battle scratch array is safe to pass), and is inert
    // unless the player is looking with a gamepad stick. It takes the EYE
    // rather than the rendered camera on purpose: its tracking term
    // differences the target's direction frame to frame, and the camera's bob
    // would land in that difference as a shake. It also takes the camera's
    // current full-stick turn rate, which is what bounds the assist below the
    // player's own look speed at every optic.
    const assist = this.aimAssist.update(
      dt,
      this.input,
      this.player.eyePos,
      this.cameraSys.forwardToRef(this.aimForward),
      this.cameraSys.aimYaw,
      this.cameraSys.aimPitch,
      // The rate the assist is bounded below, from whichever device is in the
      // player's hands — a drag has no full deflection of its own, so touch
      // brings its own reference. Picked here rather than inside either system:
      // the camera does not read input and the assist does not read the camera.
      this.input.touchActive
        ? this.cameraSys.touchYawRate
        : this.cameraSys.stickYawRate,
      this.enemyTargets(),
    );
    // First person: the camera goes to the eye the bots shoot at, so what a
    // bot can see of you is exactly what you can see of it.
    this.cameraSys.update(dt, this.input, this.player.eyePos, assist);
    // Shadows follow the player (biased a little along the view so the
    // window covers what's ahead); outline ink thins with the same camera.
    // From the body's CENTRE, not its feet: the shadow window is placed around
    // this point and it should sit in the middle of the body it follows.
    this.shadowFocus
      .copyFrom(this.player.center)
      .addInPlace(this.cameraSys.forwardToRef(this.shadowForward).scaleInPlace(8));
    this.updateSceneForCamera(dt, this.shadowFocus, this.player, this.combatants);
  }

  /**
   * The half of the tail that needs only a posed camera — shared with the map
   * editor, which has no player, no bots and no aim assist but still has to
   * keep fog, shadows, outlines, lights, water, grass and audio agreeing about
   * where the viewer is.
   *
   * The order here is the load-bearing part of the sequence above and must not
   * be rearranged. `player` is null in the editor: it gates exactly the two
   * steps that need a body — blob shadows and the carried shoulder lamp — and
   * gating them in place is what keeps both callers on one ordering.
   *
   * The shader's own eye is deliberately NOT here. It is the one thing in this
   * list a state that simulates nothing still owes, so `tick` pushes it for
   * every state instead — see the call above `scene.render()`.
   */
  private updateSceneForCamera(
    dt: number,
    shadowFocus: Vector3,
    player: Player | null,
    pushers: readonly Combatant[],
  ): void {
    this.shadows.update(shadowFocus, this.mats);
    if (player) {
      this.shadows.updateBlobs(
        player,
        this.battle.bots,
        this.cameraSys.camera.position,
        player.floorY,
      );
    }
    updateOutlineScales(this.cameraSys.camera.position);
    if (player) {
      const lc = CONFIG.lighting;
      // The map decides whether the player carries a lamp at all. A carried
      // light always wins one of the sixteen slots, so a daylight map leaving
      // it on does not merely add nothing — it costs a lantern somewhere.
      const lampIntensity =
        this.mapDef.environment.lighting.lampIntensity ?? lc.lampIntensity;
      if (lampIntensity > 0) {
        this.lighting.setCarried(
          "player-lamp",
          // Above the body's CENTRE. `lampHeight` is measured from there — a
          // lamp is carried, so it rides the chest and drops with a crouch
          // rather than being pinned to the ground the player stands on.
          this.lampPos.set(
            player.center.x,
            player.center.y + lc.lampHeight,
            player.center.z,
          ),
          lc.lampColor,
          lc.lampRange,
          lampIntensity,
        );
      } else {
        this.lighting.removeCarried("player-lamp");
      }
    }
    this.lighting.update(dt, this.cameraSys.camera.position, this.mats);
    // Water reads the same camera and the same winning light set, so it
    // updates here too — before anything later can move the camera.
    this.water.update(
      dt,
      this.cameraSys.camera.position,
      this.lighting.activeLights,
    );
    // Grass reads the same camera and light set, plus the combatant list
    // (assembled above for the conquest occupancy pass) as its pushers —
    // that list is what bends the blades around running bodies.
    this.grass.update(
      dt,
      this.cameraSys.camera.position,
      this.lighting.activeLights,
      pushers,
    );
    // The world's foliage leans in the same air the field does, so its clock is
    // advanced HERE rather than in `tick` beside the shader's eye. The eye is
    // owed by every state, including the ones that simulate nothing; a clock is
    // owed by none of them, and a canopy still moving over a frozen field under
    // the pause card would be the one thing the pause did not reach.
    this.mats.updateWind(dt);
    // Same rule as the lights and the fog: this has to follow the camera.
    this.sfx.setListener(
      this.cameraSys.camera.position,
      this.cameraSys.forwardToRef(this.listenerForward),
    );
  }

  /**
   * Pushes this frame's state to the DOM HUD and the minimap.
   *
   * `dying` is the death cam's frame: the gauges are still true and still
   * wanted (the round is live, and watching the tickets while you wait is half
   * the point of showing it at all), but everything about AIMING has stopped
   * being. The crosshair, the capture panel and the arcs are the three the cam
   * has to switch off, and each is off for its own reason rather than because
   * the state changed — see below.
   */
  private updateHud(dt: number, dying = false): void {
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setAmmo(this.player.ammo, this.player.magSize, this.player.reloading);
    this.hud.setStowedAmmo(this.player.slungAmmo, this.player.slungMagSize);
    this.hud.setGrenades(this.player.grenades, CONFIG.grenade.carried);
    this.pushAntiTankHud();
    // The armour half of the bottom band, and the marker that replaces the
    // crosshair with it. Pushed unconditionally like every other gauge — null
    // is what takes both away, and `HUD.setVehicle` is what knows that means
    // putting the magazine back.
    this.hud.setVehicle(
      this.driving
        ? {
            health: this.driving.health,
            maxHealth: CONFIG.vehicles.tank.maxHealth,
            load: this.driving.loadProgress,
          }
        : null,
    );
    this.pushGunMarker(dying);
    if (!dying) {
      // The crosshair ring IS the live spread: radians at the aim plane,
      // projected through the current FOV into screen pixels. Skipped rather
      // than merely hidden while dying — there is no weapon being aimed, so
      // there is no spread to project.
      const spreadPx =
        (Math.tan(this.player.spread(this.cameraSys.adsBlend)) /
          Math.tan(this.cameraSys.camera.fov / 2)) *
        (this.viewportHeight / 2);
      this.hud.setCrosshair(this.cameraSys.adsBlend, spreadPx);
    }
    // Damage arcs are world-anchored, so they need this frame's aim yaw to be
    // re-projected onto the screen — pushed here like every other HUD input.
    this.hud.setViewYaw(dying ? this.deathCam.yaw : this.cameraSys.aimYaw);
    this.hud.setTickets(
      [CONFIG.teams[0].name, CONFIG.teams[1].name],
      this.conquest.tickets,
      this.player.team,
    );
    this.hud.setFlags(this.conquest.points, this.player.team);
    // Null while dying: `captureStatus` asks which zone the PLAYER is standing
    // in, and a body on the ground is not standing in one — a panel counting a
    // capture nobody is contributing to is worse than no panel.
    this.hud.setCapture(dying ? null : this.captureStatus());
    // The leash's countdown, and null the moment the player is back inside — or
    // dead, where the clock has already stopped and the panel would otherwise
    // hang over the death cam counting down a body that has stopped walking.
    this.hud.setLeash(
      dying || !this.leash.outside ? null : this.leash.remaining,
    );
    this.hud.setLockHint(
      !this.input.pointerLocked &&
        !this.input.gamepadConnected &&
        !this.input.touchActive,
    );
    this.minimap.update(
      dt,
      this.player.position,
      // The cam's own bearing, so the map keeps agreeing with the picture
      // above it while the camera orbits away from the player's last heading.
      dying ? this.deathCam.yaw : this.cameraSys.yaw,
      this.conquest.points,
      this.mapBodies(),
      this.player.team,
    );
  }

  /**
   * The flag the player is standing in, as the HUD wants it — null when they
   * are outside every zone, which is what hides the panel. The zone test is
   * `ConquestSystem.pointAt`, the same one that decides occupancy, so the
   * panel appears exactly when the player starts counting toward the meter.
   */
  /**
   * Puts the gun marker where the BARREL is pointing, projected onto the glass.
   *
   * **This is the honest half of a third-person tank**, and the whole reason
   * `#gun-marker` exists rather than the crosshair simply staying up. The eye
   * is twelve metres behind the hull and the turret is walking toward the
   * player's look at 40 deg/s, so the middle of the screen is the ORDER and
   * this is the gun. `docs/weapons.md`'s rule — the reticle may not lie — is
   * kept by drawing the second one.
   *
   * Two things it has to get right and neither is the projection:
   *
   * - **Where along the axis to draw it.** Anywhere: a point on a ray projects
   *   to the same pixel wherever it is taken from, so long as it is in FRONT of
   *   the eye. It is taken at the gun's own range rather than at the muzzle
   *   because the muzzle is close enough to the camera to sit off the edge of
   *   the frame at full traverse, and a marker that leaves the screen while the
   *   gun is still on it reads as broken.
   * - **Behind the camera.** `Vector3.Project` happily returns a point for one,
   *   mirrored — a gun swung round over the back deck would put its marker on
   *   the opposite side of the screen from the barrel. The dot product against
   *   the view axis is what refuses it, and a hidden marker is the right answer
   *   there: the gun is genuinely not pointing at anything you can see.
   */
  private pushGunMarker(dying: boolean): void {
    const tank = this.driving;
    if (!tank || dying) {
      this.hud.setGunMarker(null);
      return;
    }
    tank.muzzleToRef(this.markerAt);
    tank.gunDirToRef(this.shellDir);
    this.markerAt.addInPlace(
      this.shellDir.scaleInPlace(CONFIG.vehicles.tank.gun.range),
    );
    const cam = this.cameraSys.camera;
    // In front of the eye? `getDirection` is the camera's own forward, which
    // during a drive is whatever `place` last pointed it at.
    const fwd = cam.getDirection(FORWARD_Z);
    if (
      (this.markerAt.x - cam.position.x) * fwd.x +
        (this.markerAt.y - cam.position.y) * fwd.y +
        (this.markerAt.z - cam.position.z) * fwd.z <=
      0
    ) {
      this.hud.setGunMarker(null);
      return;
    }
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    this.markerViewport.width = w;
    this.markerViewport.height = h;
    Vector3.ProjectToRef(
      this.markerAt,
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      this.markerViewport,
      this.markerOut,
    );
    this.hud.setGunMarker(this.markerOut.x / w, this.markerOut.y / h);
  }

  private captureStatus(): CaptureStatus | null {
    const p = this.conquest.pointAt(this.player.position);
    if (!p) return null;
    const mine = this.player.team;
    const theirs = 1 - mine;
    // The meter runs -1 (team 0) .. +1 (team 1), so "my way" is negative for
    // team 0 and positive for team 1.
    const mineWay = mine === 0 ? -1 : 1;
    return {
      id: p.def.id,
      name: p.def.name,
      owner: p.owner === null ? "neutral" : p.owner === mine ? "mine" : "theirs",
      progress: Math.abs(p.meter),
      held: p.meter * mineWay >= 0 ? "mine" : "theirs",
      // Which way it is MOVING, which is a question about bodies, not about
      // the meter: walk onto a flag the enemy holds outright and you are
      // capturing it, even though the bar is still full red. The player is in
      // the zone by construction here, so `mine` is never zero.
      taking: p.present[mine] >= p.present[theirs] ? "mine" : "theirs",
      contested: p.contested,
      enemies: p.present[theirs],
    };
  }

  /**
   * Opens the deploy screen. `delay` is the reinforcement wait — zero at the
   * start of a round, so the first deployment is immediate.
   */
  private enterDeploy(delay: number): void {
    this.respawnT = delay;
    // Whatever the player was in, they are out of it — this is the funnel every
    // way of leaving a life goes through, and a seat kept across one would mean
    // a fresh body wired to a hull the last one died in. First, because it puts
    // the viewmodel back and the line below is what puts it away again.
    this.clearVehicle();
    this.offerUse(null);
    // The single funnel for "the death cam's job is over", so every path out
    // of it — the clock running down, the round ending, F2 — retires the body
    // and hands the rig back without any of them remembering to. Idempotent,
    // and a no-op for the deploy that starts a round.
    this.deathCam.stop();
    this.hud.setDeathCam(false);
    this.minimap.setVisible(false);
    // `updateGameplay` stops here, so the viewmodel would freeze mid-pose in
    // front of a dead player's last view. In third person the body simply
    // stood where it fell; a rifle stuck to the camera has to be put away.
    this.player.setBodyHidden(true);
    this.hud.clearDamageDirections();
    // updateHud stops running outside `playing`, so the panel has to be told
    // to go — otherwise the zone the player died in stays on screen. The
    // SCOREBOARD is deliberately not told anything here: it is pushed from
    // `tick` in every state that has a round behind it, and this screen is one
    // of them — a player waiting out a reinforcement is exactly who wants it.
    this.hud.setCapture(null);
    this.hud.setLeash(null);
    if (this.map) this.deployScreen.show(this.map, this.conquest, this.player.team);
    this.deployScreen.update(this.respawnT);
    // A netplay death is decided by the wire and arrives in whatever state this
    // client is in — including under a lid, which is where this used to leave a
    // screen stranded over a live deploy screen. `go` takes it down.
    this.go("deploy");
    document.exitPointerLock();
  }

  private endRound(winner: Team): void {
    // Ends under a lid for the same reason a death does: the authority's
    // `roundover` does not wait for the player to close their settings.
    this.go("roundover");
    // The round can end on a frame the death cam is up — a squad taking the
    // last flag while the player watches their own body — and the result card
    // is not somewhere a corpse follows them to.
    this.deathCam.stop();
    this.hud.setDeathCam(false);
    this.deployScreen.hide();
    // Same reason as `enterDeploy`, and it has to come BEFORE the line under it
    // for the same reason: giving up the seat puts the viewmodel back, and a
    // round-over card is not something to watch from behind a tank.
    this.clearVehicle();
    this.player.setBodyHidden(true); // same reason as enterDeploy
    this.hud.clearDamageDirections();
    this.hud.setCapture(null);
    this.hud.setLeash(null);
    this.offerUse(null);
    // `updateGameplay` stops running here, so push the final state once more —
    // otherwise the ticket bar sits frozen a frame behind the result text.
    this.hud.setTickets(
      [CONFIG.teams[0].name, CONFIG.teams[1].name],
      this.conquest.tickets,
      this.player.team,
    );
    this.hud.setFlags(this.conquest.points, this.player.team);
    this.overlayT = 0;
    this.minimap.setVisible(false);
    this.battle.reset();
    document.exitPointerLock();
    const won = winner === this.player.team;
    this.overlayScreen.showRoundOver(
      CONFIG.teams[winner].name,
      won,
      this.conquest.tickets[0],
      this.conquest.tickets[1],
      this.mapDef.name,
    );
  }

  /** Called from `Player.takeDamage`, whoever pulled the trigger. */
  private onPlayerDamaged(
    amount: number,
    died: boolean,
    from?: Vector3,
    kind: DamageKind = "bullet",
  ): void {
    if (this.state !== "playing") return;
    this.hud.flashDamage();
    // The vignette says "hit"; the arc says "from there". Bearing is taken
    // once, in world space, from the shot's origin — the HUD re-projects it
    // against the view every frame from then on.
    if (from) {
      const dx = from.x - this.player.position.x;
      const dz = from.z - this.player.position.z;
      if (dx * dx + dz * dz > 1e-6) {
        this.hud.addDamageDirection(Math.atan2(dx, dz), amount);
      }
    }
    // The blow itself, on the aim rather than on the picture. Skipped on the
    // frame that killed you: `enterDying` hands the camera to `DeathCam` a
    // few lines below, and a flinch on a body nobody is looking through is
    // state left behind for the next life to inherit.
    if (!died) {
      const pc = CONFIG.player;
      this.cameraSys.addFlinch(
        amount * pc.flinchPitchPerDamage,
        (Math.random() * 2 - 1) * amount * pc.flinchYawPerDamage,
      );
    }
    this.post.flashDamage();
    this.sfx.playerHurt();
    const haptic = CONFIG.rumble;
    this.input.rumble(
      died ? haptic.deathStrong : haptic.hurtStrong,
      died ? haptic.deathWeak : haptic.hurtWeak,
      died ? haptic.deathMs : haptic.hurtMs,
    );
    if (died) {
      this.conquest.registerDeath(this.player.team);
      // Our own row's death, offline: the victim's door, and the bot that shot
      // us was credited at its own by `battle.onBotKill`. The row is the SLOT
      // we are sitting in, which is the same one the board draws us on.
      this.scores.registerDeath(this.battle.playerSlot);
      // Who to blame, and the test is `from`. Friendly fire is excluded by
      // construction everywhere in this game, so the side that killed a player
      // is always the other one — every death in the game was that until the
      // leash, which kills with nothing behind it and passes no origin. `from`
      // is already what says "nobody shot you" two blocks up, where it decides
      // whether there is a damage arc to draw at all.
      //
      // **The leash is the ONLY death without one, and that is a thing to keep
      // true rather than a thing that is.** Burning inside a hull passed no
      // origin once and so announced itself here as `OUT OF BOUNDS` — a death
      // the enemy had earned, credited to the map. `wireVehicles` hands one
      // over now (the wreck's own centre), which is the same vector the corpse
      // is thrown by. A new way to die owes this line an origin unless nobody
      // caused it.
      this.hud.addKill(
        from ? CONFIG.teams[1 - this.player.team].name : LEASH_KILLER,
        "YOU",
        true,
      );
      this.enterDying(from, amount, kind);
    }
  }

  /**
   * Raises the death cam: a stand-in body where the player was standing, thrown
   * by the round that killed them, and the camera out of the head to watch it.
   *
   * The pointer lock is deliberately KEPT. There is nothing to click for four
   * seconds, and dropping it would trip the lock-loss pause on the very frame
   * the shot begins — pausing the thing the player was about to be shown.
   * `enterDeploy` is still what releases it, one state later.
   *
   * If the cam cannot come up at all — no rig, which means no round has started
   * — this falls straight through to the deploy screen at the full delay. A
   * state whose exit condition is a clock that never starts is a game that
   * never respawns you, and that is the one failure here worth spelling out.
   *
   * `respawnIn` is how long this life owes before the next one, and it is a
   * parameter rather than the config constant because in a networked round the
   * clock is the SERVER's. It happens to be the same number today — both sides
   * read `conquest.respawnDelay` — and the point of taking it here is that
   * nothing breaks quietly on the day one of them stops.
   */
  private enterDying(
    from: Vector3 | undefined,
    amount: number,
    kind: DamageKind,
    // Annotated, because `CONFIG` is `as const` and the bare default would give
    // this parameter the literal type `8` — see the convention in CLAUDE.md.
    respawnIn: number = CONFIG.conquest.respawnDelay,
  ): void {
    this.deathRespawnIn = respawnIn;
    this.deathFeet.set(
      this.player.position.x,
      this.player.floorY,
      this.player.position.z,
    );
    this.deathCam.start(
      this.deathFeet,
      this.cameraSys.yaw,
      this.cameraSys.camera.position,
      this.cameraSys.forward,
      from,
      amount,
      kind,
      this.player.stance,
    );
    if (!this.deathCam.active) {
      this.enterDeploy(respawnIn);
      return;
    }
    // The weapon is parented to the camera, so it would ride the cam out of
    // the head and hang in front of the body — the same reason `enterDeploy`
    // puts it away, arriving one state earlier.
    this.player.setBodyHidden(true);
    // Anything on the HUD that is about aiming is now a lie: there is no
    // crosshair to believe and the damage arcs are anchored to a view yaw that
    // has stopped being the player's.
    this.hud.setDeathCam(true);
    this.hud.clearDamageDirections();
    this.go("dying");
  }

  /**
   * A bot went down: the sound, the ticket, its line on the board and the
   * killfeed.
   *
   * One method rather than three copies because there are now three ways to
   * kill one — a bot's rifle, the player's rifle, and either side's grenade —
   * and they disagree about nothing except whose name goes on the line.
   * `byPlayer` is what separates the player's own kill from their team's, and
   * it is the only thing the three callers pass differently.
   *
   * This is the VICTIM's door, so it counts the death and not the kill: the
   * killer is credited by `creditKill` at whichever call site actually knows
   * who they were. Every caller here raises both, one line apart.
   *
   * Deliberately NOT the hitmarker or the rumble: those are about the shot
   * that landed rather than the body that fell, and they belong with whichever
   * weapon put it there.
   */
  private registerBotKill(bot: Bot, killer: Team, byPlayer: boolean): void {
    // The one place all three ways a bot can die converge, so the one place
    // the body has to be offered to the physics pool. It needs no impact
    // vector passed down: `Bot.takeDamage` already captured where the killing
    // blow came from, which every damage path in the game hands it.
    this.ragdolls.spawn(bot, this.cameraSys.camera.position);
    this.sfx.enemyDie();
    this.conquest.registerDeath(bot.team);
    this.scores.registerDeath(this.battle.bots.indexOf(bot));
    this.hud.addKill(
      byPlayer ? "YOU" : CONFIG.teams[killer].name,
      CONFIG.teams[bot.team].name,
      byPlayer,
    );
  }

  /**
   * The scoreboard, pushed once per frame from `tick` in EVERY state that has a
   * round behind it — playing, the death cam, and the deploy screen.
   *
   * It is here rather than in `updateHud` for the reason `mats.updateCamera` is
   * in `tick`: `updateHud` runs while you are alive and holding a weapon, and
   * this panel is owed to two states that are neither. **The deploy screen is
   * where a player most wants it** — it is the one screen in the game you sit
   * on while the round carries on without you, for a reinforcement clock's
   * worth of every death in a match, and it is where you decide where to come
   * back in. A board that goes dark exactly then is dark for a good share of
   * the round.
   *
   * `ScreenSpec.inRound` is answered by the state the frame is IN and
   * deliberately not by what is under the lids: a lid is a screen the player
   * ASKED for and put in front of the round, so every lid answers `false` and
   * the board goes away under one without anything having to remember to hide
   * it. That is the whole reason this is a per-frame push rather than a call at
   * each boundary: the six ways out of a round (deploying, dying, the round
   * ending, a pause, the kit screen, the menu) each used to owe a
   * `setScoreboard(false)`, and the one that forgot would leave last round's
   * numbers hanging over the next screen.
   *
   * Assembled only while the board is actually up: the payload is an object
   * and four arrays, and `flagsHeld` counts the control points twice.
   */
  /**
   * The on-screen controls: whether they are up, and the two things drawn on
   * them that they cannot know.
   *
   * Pushed from `tick` after the switch, in the same place and for the same
   * reason as `pushScoreboard` below — what decides is the state the frame ENDS
   * in, so a frame that paused, died or deployed has already taken them away by
   * the time this reads it, and no boundary owes a call of its own.
   *
   * `playing` alone, and that is narrower than `inRound` on purpose: the deploy
   * screen is a MAP the player taps a spawn on and the death cam is four
   * seconds of watching, so in both there is a body's worth of controls over a
   * body nobody is driving. Taking them away also drops whatever they were
   * holding — see `setVisible`.
   */
  private pushTouchControls(): void {
    const live = this.state === "playing" && this.input.touchActive;
    this.touch.setVisible(live);
    // Pushed either way, and BEFORE the early return: the chrome has to get out
    // of the thumbs' way while they are there and go back to full size the
    // moment they are not. It is the HUD's own class because `#hud` is the
    // HUD's — the same arrangement `setPaused` and `setDeathCam` have.
    this.hud.setTouching(live);
    if (!live) return;
    // A machine can have both, and a lock held while a finger drives is not a
    // preference — it is broken input: the lock zeroes `clientX/clientY` on
    // every pointer event, so the stick would be born in the corner of the
    // screen. Giving it up is what hands a touchscreen laptop over cleanly, and
    // `pointerlockchange` knows not to read this particular loss as the player
    // leaving. The mouse takes it back on its next click, as it always did.
    if (document.pointerLockElement) document.exitPointerLock();
    this.touch.setCrouched(this.player.crouching);
    // "The magazine wants attention", which is either state it can be in: empty
    // and waiting, or filling. A phone player has no eye spare for the corner
    // of the screen, and the weapon reloads itself on the last round anyway —
    // so the button is where that news can be seen without looking for it.
    this.touch.setReloadDue(this.player.reloading || this.player.ammo === 0);
    // The vehicle verb: a button that is only there when it would do
    // something, carrying the same sentence the HUD's prompt carries on a
    // keyboard. `E` and the d-pad's north are keys a player finds by pressing
    // them; glass has nothing to press until this puts it there, which is why
    // a phone could not get into a tank at all.
    this.touch.setUse(this.useOffer);
  }

  private pushScoreboard(): void {
    if (!this.screens.inRound || !this.input.scoreboard) {
      this.hud.setScoreboard(false);
      return;
    }
    const rows = this.scoreRows();
    // The team totals are SUMMED from the rows rather than counted beside
    // them, so the header and the columns under it cannot disagree — one
    // number that is wrong and one that is right is worse than two that are
    // wrong together, because nothing on screen shows which is which.
    const kills: [number, number] = [0, 0];
    const deaths: [number, number] = [0, 0];
    const score: [number, number] = [0, 0];
    for (const r of rows) {
      kills[r.team] += r.kills;
      deaths[r.team] += r.deaths;
      score[r.team] += r.score;
    }
    this.hud.setScoreboard(true, {
      map: this.mapDef.name,
      teams: [CONFIG.teams[0].name, CONFIG.teams[1].name],
      tickets: this.conquest.tickets,
      flags: [this.conquest.flagsHeld(0), this.conquest.flagsHeld(1)],
      kills,
      deaths,
      score,
      playerTeam: this.player.team,
      // Whether there is a connection to report at all, which is a fact about
      // the ROUND rather than about the rows: the column is there for every
      // frame of a match, dashes and all, and never offline.
      pings: this.net !== null,
      rows,
    });
  }

  /**
   * One row per body in the round, for the scoreboard.
   *
   * **The two sources meet HERE and nowhere else.** Offline the board is this
   * client's own `ScoreBook`, one line per roster slot. In a match it is the
   * authority's, read off the session: a slot's name from the roster, its
   * points, kills and deaths from the last `scores` message, and the row order
   * straight from the roster, because a slot index is the same number on both
   * sides of the wire and on both sides of this branch.
   *
   * A bot's name is DERIVED rather than sent (`callsign`), which is what keeps
   * "a bot and a person are the same body on screen" true while still letting
   * this one screen tell them apart: nothing about the row changes how anything
   * is drawn, and the server spends no bandwidth naming sixteen bodies that
   * already have a number each.
   *
   * Assembled only while Tab is held — see the caller.
   */
  private scoreRows(): ScoreRow[] {
    const rows: ScoreRow[] = [];
    if (this.net) {
      for (const slot of this.net.slots) {
        const occupant = slot.occupant;
        rows.push({
          name:
            occupant.kind === "human" ? occupant.name : callsign(slot.index),
          team: slot.team,
          kills: this.net.slotKills[slot.index] ?? 0,
          deaths: this.net.slotDeaths[slot.index] ?? 0,
          score: this.net.slotScores[slot.index] ?? 0,
          you: slot.index === this.net.slot,
          // The authority's own measurement of the connection to that slot,
          // and -1 for a bot — which is also what a slot reads as before the
          // first table has arrived. See `PingsMessage` for why this is the
          // server's to state rather than each client's to measure.
          ping: this.net.slotPings[slot.index] ?? -1,
        });
      }
      return rows;
    }
    // Offline the whole board is one loop over the pool, the player's line
    // included: they hold a slot like everybody else and the bot in it is
    // benched for as long as they do (`BattleSystem.seatPlayer`), so the row
    // that used to be pushed separately and then skipped in the loop is simply
    // the row at their own slot. Drawing both would put a seventeenth body on a
    // sixteen-slot board and count one that is not in the fight into the team
    // totals.
    // Every offline row's ping is -1 and the board draws no column for it:
    // there is no server in a single-player round to be any distance from.
    for (let i = 0; i < this.battle.bots.length; i++) {
      const you = i === this.battle.playerSlot;
      const row = this.scores.row(i);
      rows.push({
        name: you ? "YOU" : callsign(i),
        team: you ? this.player.team : this.battle.bots[i].team,
        kills: row.kills,
        deaths: row.deaths,
        score: row.points,
        you,
        ping: -1,
      });
    }
    return rows;
  }

  /**
   * Somebody put a body down: the kill, and everything it earned, on their own
   * row, OFFLINE.
   *
   * **The kill is counted at the killer's door and the death at the victim's,
   * once each**, because the two are known in different places. Every death in
   * the game already arrives somewhere — `registerBotKill` for a bot,
   * `onPlayerDamaged` for the player — while who fired is known only to
   * whatever pulled the trigger, and a single door would mean one of the two
   * inventing the half it cannot see. It is also what lets a bot be credited
   * for killing the PLAYER, which no bot-shaped kill callback could carry.
   *
   * Silent in a netplay round by the same rule that empties every other local
   * count there: the board is the authority's, this is only ever the offline
   * one, and a kill is credited to a bot the server is not simulating. Nothing
   * gates it — the callers that could fire in a match are the ones whose local
   * `takeDamage` returns false, so no kill is ever raised to be counted.
   */
  private creditKill(
    by: Combatant | null,
    victim: Hittable,
    headshot = false,
  ): void {
    if (!by) return;
    // The flag the VICTIM fell on decides whether this was an attack or a
    // defence, and `awardKill` is where that rule lives — shared with the
    // authority, so the two boards pay a kill the same way. A body that fell
    // nowhere near a ring is `null` and earns the kill alone.
    //
    // `eyePos` rather than a body's feet because the victim is a `Hittable`
    // here — every path that resolves a kill has one, and only some of them
    // have a `Combatant`. It costs nothing: `pointAt` is a radius test on x
    // and z, and a head is directly over the feet under it.
    awardKill(
      this.scores,
      this.slotOf(by),
      by.team,
      this.conquest.pointAt(victim.eyePos),
      headshot,
    );
  }

  /**
   * Which roster slot a body holds, or -1 for one that holds none.
   *
   * The player's is `BattleSystem.seatPlayer`'s and a bot's IS its index in the
   * pool — the same identity the authority's `HeadlessGame.slotOf` rests on,
   * which is what lets one `ScoreBook` mean the same thing on both sides.
   */
  private slotOf(c: Combatant | null): number {
    if (c === this.player) return this.battle.playerSlot;
    return c instanceof Bot ? this.battle.bots.indexOf(c) : -1;
  }

  /**
   * A grenade went off. The light, the noise and the concussion — none of
   * which the grenade system may reach on its own, which is why they arrive
   * here as one event with a position on it.
   *
   * The light is deliberately outside `spendMuzzleLightBudget`. Transients
   * always win a shader slot, and the budget exists because sixteen bots firing
   * is up to eighty flashes a second; there are seconds between blasts, so one
   * slot each is never what blacks the village out.
   *
   * The camera's concussion reuses `land()` rather than growing a shake of its
   * own: the eye taking a pressure wave and the eye taking a landing are the
   * same damped spring, and the alternative is a second integrator writing the
   * same offset — the trap the bob phase documents from the other side. It
   * falls off over twice the blast radius, so a grenade you survived at the
   * edge still registers as one. What it does NOT reuse is the punch's
   * direction: `addPunch` takes one, so the shove is thrown away from where
   * the blast actually was rather than being the same nudge every time.
   */
  private onExplosion(at: Vector3, power: number, ground: BlastGround): void {
    const lc = CONFIG.lighting;
    // The light, scaled by the same `power` the picture is. RANGE goes with it
    // linearly because that is what a bigger fireball actually lights; the
    // INTENSITY and the LIFE are pulled toward 1 instead, because a transient
    // that is twice as bright and half again as long stops reading as a flash
    // and starts reading as somebody switching a lamp on.
    this.lighting.pulse(
      at,
      lc.explosionColor,
      lc.explosionRange * power,
      lc.explosionIntensity * (0.6 + 0.4 * power),
      lc.explosionLife * (0.75 + 0.25 * power),
    );
    // The two layers under Havok — the rubble and the mark. They are drawn from
    // here rather than from `GrenadeSystem` because that system runs on the
    // authority, which has neither a physics world nor a canvas, and because a
    // system may not reach into another one.
    this.blastDebris.burst(at, power, ground, this.cameraSys.camera.position);
    this.sfx.explosion(at, power);
    if (this.state !== "playing") return;
    const g = CONFIG.grenade;
    const reach = g.blastRadius * 2 * power;
    const d = Vector3.Distance(at, this.cameraSys.camera.position);
    if (d >= reach) return;
    this.cameraSys.land(g.shakeSpeed * power * (1 - d / reach));
    // Which side it went off, as the punch's drift: the sign of the blast's
    // bearing across the view. A grenade behind a shoulder throws the view the
    // other way, which is free here because the punch already takes a
    // direction for the gun and a pressure wave has one just as much.
    const right = this.cameraSys.flatRight;
    const bearing = (at.x - this.cameraSys.camera.position.x) * right.x +
      (at.z - this.cameraSys.camera.position.z) * right.z;
    this.cameraSys.addPunch(d > 0.001 ? -bearing / d : 0);
    const haptic = CONFIG.rumble;
    this.input.rumble(haptic.hurtStrong, haptic.hurtWeak, haptic.hurtMs);
  }

  /**
   * The anti-tank row: what is left in the pouch, and — for mines — how many
   * of yours are already on the field.
   *
   * The caption is composed here rather than in the HUD because what it has to
   * say differs per item and only one side knows each half: the name is the
   * kit's and the laid count is `AntiTankSystem`'s. It matters because the cap
   * means laying a third mine LIFTS the first, so "two set" is the difference
   * between a mine going down and a mine moving.
   *
   * A kit with no third slot pushes null and the row is not drawn at all —
   * see `HUD.setAntiTank`, and `armourOffered` for who decides.
   */
  private pushAntiTankHud(): void {
    const id = this.armourOffered ? this.equipment : null;
    if (!id) {
      this.hud.setAntiTank(null, 0, 0);
      return;
    }
    const cfg = CONFIG.equipment[id];
    // Offline the local system knows; in a match the authority does, and the
    // count arrives on the mine table. It is the one gauge here that is not
    // simply the slot's own magazine, and it is worth the branch: the cap
    // retires your oldest when you lay a third, so this is what a player is
    // deciding against.
    const laid =
      id !== "mine"
        ? 0
        : this.net
          ? this.net.ordnance.minesFor(this.net.slot)
          : this.antiTank.minesFor(this.player);
    this.hud.setAntiTank(
      laid > 0 ? `${cfg.short} · ${laid} SET` : cfg.short,
      // What is in the HANDS, which is not always what is carried: the slot
      // holds its own magazine like any other, so this is read off the slot
      // rather than off a count of its own.
      this.player.equipmentLeft,
      cfg.carried,
    );
  }

  /**
   * The surface something at (x, z) would be STANDING on, resolved nearest the
   * height `near` — the drawn terrain, or a deck or slab above it.
   *
   * The same pair of questions `CaptureZoneSystem` asks to lay a ring on the
   * ground, and asked here for the same reason: the terrain alone buries
   * anything on a boathouse deck or a paved square, and the nav graph alone
   * has nothing to say about the stretches nothing walks on. `surfaceAt(...,
   * true)` is the upper envelope, because the floor is flat triangles across a
   * bilinear field and the smooth value sits under the mesh on a twisted cell.
   */
  private standableAt(x: number, z: number, near: number): number {
    if (!this.map) return near;
    const floor = this.map.terrain.surfaceAt(x, z, true);
    const surface = this.map.nav.surfaceAt(x, near, z);
    return surface < 0 ? floor : Math.max(floor, this.map.nav.heightOf(surface));
  }

  /**
   * Muzzle flashes are transient lights, and transients always win a shader
   * slot. Sixteen bots firing would take all sixteen and black out the
   * village's own lanterns, so only the nearest few close-range flashes get one.
   */
  private spendMuzzleLightBudget(): void {
    const lc = CONFIG.lighting;
    const camera = this.cameraSys.camera.position;
    const flashes = this.battle.muzzleFlashes;
    if (flashes.length === 0) return;
    if (flashes.length > lc.muzzleBudgetPerFrame) {
      flashes.sort(
        (a, b) =>
          Vector3.DistanceSquared(a, camera) - Vector3.DistanceSquared(b, camera),
      );
    }
    const max = Math.min(flashes.length, lc.muzzleBudgetPerFrame);
    for (let i = 0; i < max; i++) {
      if (Vector3.Distance(flashes[i], camera) > lc.muzzleMaxDistance) break;
      this.lighting.pulse(
        flashes[i],
        lc.muzzleColor,
        lc.muzzleRange,
        lc.muzzleIntensity,
        lc.muzzleLife,
      );
    }
  }
}
