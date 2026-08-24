/**
 * ScreenStack.ts — The state machine's SHAPE, declared rather than described:
 * every state the game can be in, which of them are screens laid over another
 * one, and what is still moving underneath.
 *
 * Owns: the `GameState` union, the `SCREENS` table that answers four questions
 * about each member of it, and the stack itself — the step the game is on and
 * the lids raised over it. `Game` holds exactly one and asks it; nothing else in
 * the tree knows this file exists.
 *
 * Invariants: there is always exactly one STEP at the bottom and it is never
 * popped; a lid may only be raised over a state its own `covers` names, so the
 * stacks that can exist are the ones this table describes and no others; `under`
 * is that bottom step however many lids are over it.
 *
 * Never: touches the DOM, a system, `Game`, or the wire. It knows the NAMES of
 * the screens and not one of the screens themselves — putting one away is
 * `Game.takeDown`, because that is where the elements live. This file decides
 * what is legal and what is owed; it never does any of it.
 *
 * WHY IT IS A FILE OF ITS OWN. This was three `-From` fields on `Game`, a
 * two-deep chain of `if`s that peeled them, and four screens that each had to
 * REMEMBER to step the half of a netplay frame a lid does not stop — a rule
 * enforced by a comment saying a fourth screen owed the same call the day it was
 * written. Every one of those obligations is a row here now, and the row is not
 * optional: `SCREENS` is a `Record<GameState, ScreenSpec>`, so a state added to
 * the union does not COMPILE until it has answered for itself, and `Game.tick`
 * asks the table rather than trusting the screen to volunteer. That is the whole
 * point of the file. Adding a field to `ScreenSpec` is the same move in the
 * other direction — it makes every existing screen answer a new question — and
 * it is the right move whenever a behaviour would otherwise be a list of state
 * names written out at the one call site that happens to need it.
 */

/**
 * The states the game is DOING rather than showing: `menu` -> `loading` ->
 * `deploy` -> `playing` -> `dying` -> `deploy`, with `roundover` when one side
 * runs out of tickets, and `editor` off to one side of all of it.
 *
 * `loading` is the map being built. It lasts exactly one frame of wall clock and
 * an indeterminate amount of it — the build is ~0.7 s of synchronous work, which
 * is a freeze if nothing says otherwise (see `Game.startRound`, the split that
 * lets the card be drawn first). It exists as a STATE rather than as a flag
 * because the frame in between belongs to nobody otherwise: `tick` would keep
 * dispatching to the menu it just left, and a second confirm in that window
 * would start a second round on top of the first. Nothing may simulate here —
 * there is no map yet.
 *
 * `dying` is the death cam: the player is down, a body is falling where they
 * stood, and the camera has left the head to watch it. It is a STEP in the cycle
 * rather than a lid, and that distinction is the whole feature — the fight
 * carries on underneath it (`updateWorld` runs in full), where a lid stops
 * everything. It ends on its own clock, and the deploy screen it opens subtracts
 * the time already spent, so a life costs what it always did.
 *
 * `deploy` simulates nothing and never may — offline the world is genuinely held
 * while the map is up. In a NETPLAY round it is the one state outside the fight
 * that still steps the netplay half of a frame, which is not the same thing: the
 * authority has not paused, and everything this screen shows — the flags its
 * offer is derived from, the tickets on the strip under it, the bodies moving
 * behind it — arrives from a frame. That is `roundBehind` below, and it is the
 * one STEP that declares it. It is also the state a player LEAVES by asking
 * rather than by acting: `onDeploy` sends a request and the server's own spawn
 * event is what puts them in the world.
 *
 * `editor` sits outside the cycle: a dev-only side state reachable from anywhere
 * with F2, and leaving it always restarts the round rather than resuming,
 * because the systems that cache the `GameMap` cannot be handed a map that was
 * rebuilt underneath them.
 */
export type StepState =
  | "menu"
  | "loading"
  | "deploy"
  | "playing"
  | "dying"
  | "roundover"
  | "editor";

/**
 * The states that are a SCREEN over another one. A lid is not a step in the
 * cycle — it is a thing laid over one, and taking it off puts back exactly what
 * it covered rather than moving the game on.
 *
 * `paused` is the one that stops something. Nothing simulates while it is up
 * offline; the scene still renders, which is what makes a paused round look held
 * rather than gone. In a netplay round it stops nothing at all — see
 * `holdsWorld`.
 *
 * `loadout` is the kit screen, and it is deliberately unreachable from `playing`
 * and from the pause menu: a round you are already standing in is not somewhere
 * you get to change what you are carrying. That is `covers` and nothing else
 * enforces it.
 *
 * `settings` also covers `paused`, because turning an effect off is something
 * you judge against the scene rather than from the title card — which makes it
 * the one lid that can be raised over another one, and the only reason a stack
 * is ever two lids deep.
 *
 * `lobby` covers `menu` and only `menu`. Picking a match out of it leaves
 * through `startRound` exactly as Deploy does, which is why the lobby is not a
 * step in the cycle — a networked round and a single-player one are the same
 * `loading -> deploy -> playing` cycle, differing only in whether `Game.net`
 * exists.
 */
export type LidState = "paused" | "loadout" | "settings" | "lobby";

export type GameState = StepState | LidState;

/**
 * The four questions every state answers. Each one is a behaviour in `Game.tick`
 * that used to be a list of state names written out where it was needed.
 */
export type ScreenSpec = {
  /**
   * For a LID, the states it may be raised over. `null` is what makes a state a
   * STEP — a thing the game is doing rather than a screen over one.
   *
   * This is the guard each `open*` method used to write out for itself, and
   * having it here buys more than tidiness: it is what BOUNDS the stack.
   * `settings` naming `paused` is the only reason a stack is ever two lids deep,
   * so the depth of the thing is a property of this table rather than of a chain
   * of `if`s somebody has to hold in their head. `under` was that chain, and is
   * now the bottom of what is actually there — which is what makes a third lid a
   * row in this table and not a rewrite.
   */
  covers: readonly GameState[] | null;

  /**
   * OFFLINE: is the world under this screen genuinely STOPPED?
   *
   * Only the pause card is, and it is asked of the whole stack rather than of
   * the top of it (`ScreenStack.holdsWorld`) — the settings screen holds nothing
   * by itself, and a pause underneath it is still a pause. It is what the HUD's
   * own clock keys off: the killfeed and the toasts belong to the frame, so they
   * freeze with it and fade with it, and the failure either way round is a fight
   * fading off a still screen or a still screen catching up in one jump.
   *
   * The deploy screen answers `false` even though offline it holds the world
   * just as hard: the gauges under it are the ones a player reads while
   * choosing, and the countdown on the card is a clock of its own.
   *
   * In a NETPLAY round nothing holds the world, because the authority never
   * heard the key — which is why `Game.worldHeld` asks whether there is a
   * session at all before it asks this.
   */
  holdsWorld: boolean;

  /**
   * ONLINE: does the authority's fight carry on behind this screen with nothing
   * else stepping the frame that draws it?
   *
   * True for every lid, and the answer is the same for all four for one reason:
   * the round underneath does not care which screen is on top of it, only
   * whether the authority is still running it. Left out, sixteen bodies stand
   * frozen behind the card and snap to where they really are on the frame the
   * player resumes.
   *
   * `playing` and `dying` answer `false`, and not because there is no round
   * behind them — they are IN it, and `Game.updateWorld` steps that same frame
   * already. Declaring it here would step it twice.
   *
   * `roundover` answers `false` because the round is over: what stands behind
   * the result card is its last frame and is owed no more.
   *
   * `lobby` answers `false` because `Game.enterMenu` leaves the match, so
   * `Game.net` is null in every state that reads back as `menu` and there is
   * nothing behind it to step. It is the one row here that would have to change
   * if a lid were ever allowed to cover a round it does not today.
   */
  roundBehind: boolean;

  /**
   * Is the player IN a round in this state — which is to say, are they owed the
   * Tab scoreboard?
   *
   * Every lid answers `false`, and that IS the rule "a lid takes the board
   * away": a lid is a screen the player asked for and put in front of the round,
   * so nothing has to remember to hide it. The three that answer `true` are the
   * three `paused` may cover, and they agree by intent rather than by
   * derivation — a state could join one list without joining the other.
   */
  inRound: boolean;
};

/**
 * Every state, and what it is. Exhaustive by type: a new member of `GameState`
 * fails to compile until it is described here, which is the point of the table.
 */
const SCREENS: Record<GameState, ScreenSpec> = {
  // Nothing behind the title card but the last round's scene, and no match
  // either — `enterMenu` closes the session on the way in.
  menu: { covers: null, holdsWorld: false, roundBehind: false, inRound: false },
  // There is no map yet. Anything given to this state is something that could
  // run against a world that is half torn down.
  loading: { covers: null, holdsWorld: false, roundBehind: false, inRound: false },
  // The one step with a round running behind it that it is not part of.
  deploy: { covers: null, holdsWorld: false, roundBehind: true, inRound: true },
  playing: { covers: null, holdsWorld: false, roundBehind: false, inRound: true },
  dying: { covers: null, holdsWorld: false, roundBehind: false, inRound: true },
  roundover: { covers: null, holdsWorld: false, roundBehind: false, inRound: false },
  editor: { covers: null, holdsWorld: false, roundBehind: false, inRound: false },

  // The three states a round is in are exactly the three a pause may cover, so
  // a pause taken while waiting out a respawn returns to the deploy map rather
  // than dropping the player into the world.
  paused: {
    covers: ["playing", "dying", "deploy"],
    holdsWorld: true,
    roundBehind: true,
    inRound: false,
  },
  loadout: {
    covers: ["menu", "deploy"],
    holdsWorld: false,
    roundBehind: true,
    inRound: false,
  },
  settings: {
    covers: ["menu", "deploy", "paused"],
    holdsWorld: false,
    roundBehind: true,
    inRound: false,
  },
  lobby: {
    covers: ["menu"],
    holdsWorld: false,
    roundBehind: false,
    inRound: false,
  },
};

/**
 * The step the game is on, and the screens the player has raised over it.
 *
 * Two fields rather than one array because they are two different things: the
 * step is where the game IS and always exists, the lids are what is in front of
 * it and are all droppable. Nothing outside can write either — `go`, `raise` and
 * `lower` are the only three moves, and each of them refuses what the table says
 * is illegal rather than trusting the caller to have checked.
 */
export class ScreenStack {
  private step: StepState = "menu";
  private lids: LidState[] = [];

  /** The state this frame is IN: the topmost lid, or the step if none is up. */
  get current(): GameState {
    return this.lids.length ? this.lids[this.lids.length - 1] : this.step;
  }

  /**
   * What the game is DOING, looked at through whatever is stacked over it.
   *
   * The question a lid must never answer for itself. It is the deploy screen's
   * reinforcement clock that cares most: the authority runs it down whatever
   * this client has on top, so a lid that stopped it would make a player wait
   * out time the server has already given them back.
   */
  get under(): StepState {
    return this.step;
  }

  /** Is there a screen the player asked for in front of the game? */
  get lidUp(): boolean {
    return this.lids.length > 0;
  }

  /**
   * OFFLINE: is the world on screen genuinely stopped? Asked of the whole stack,
   * because a pause under a settings screen is still a pause.
   */
  get holdsWorld(): boolean {
    return (
      SCREENS[this.step].holdsWorld || this.lids.some((l) => SCREENS[l].holdsWorld)
    );
  }

  /** ONLINE: does this frame owe the drawing half of the authority's? */
  get roundBehind(): boolean {
    return SCREENS[this.current].roundBehind;
  }

  /** Is the player in a round — the states the scoreboard is owed to? */
  get inRound(): boolean {
    return SCREENS[this.current].inRound;
  }

  /**
   * Moves the game on, and hands back every lid that was over it — top first, so
   * a caller can put them away in the order the player would see them go.
   *
   * A step transition happens for reasons that have nothing to do with what is
   * on screen: an authority's `roundover` lands while somebody sits in the
   * settings, a `died` arrives while the pause card is up. Before this was a
   * stack those cases wrote the new state straight over the lid's, which stranded
   * the screen — visible, uncloseable, with a live state taking input underneath
   * it. The state can no longer be stranded here, and the SCREEN cannot either
   * as long as the caller takes down what it is given (`Game.go`).
   */
  go(step: StepState): LidState[] {
    const dropped = [...this.lids].reverse();
    this.lids = [];
    this.step = step;
    return dropped;
  }

  /**
   * Raises a lid over whatever is on top, if the table allows it. `false` means
   * it does not, and the caller is expected to do nothing at all — every
   * `open*`/`pause` in `Game` is a call to this and its own guard is gone.
   *
   * A lid can never be raised over itself: no `covers` list names its own state.
   */
  raise(lid: LidState): boolean {
    const covers = SCREENS[lid].covers;
    if (!covers || !covers.includes(this.current)) return false;
    this.lids.push(lid);
    return true;
  }

  /**
   * Takes one named lid off, and refuses if it is not the one on top. Named
   * rather than bare so a close that raced something else cannot pop a screen
   * that is still up — `closeSettings` arriving after a `go` has already cleared
   * the stack is the case that matters, and it now does nothing instead of
   * dropping whatever the game moved on to.
   */
  lower(lid: LidState): boolean {
    if (this.current !== lid) return false;
    this.lids.pop();
    return true;
  }
}
