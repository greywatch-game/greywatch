/**
 * server/wire.ts — Is a decoded client message actually shaped like the message
 * it claims to be?
 * Owns: the shape gate every inbound client message passes before any handler
 * on this server sees it, and nothing else. It owns no game rules — whether a
 * position is REACHABLE is `validate.ts`'s question and whether a spawn is
 * ALLOWED is conquest's; this asks only whether the fields are present and are
 * numbers.
 * Invariants: this is the only thing on the server that turns a frame into a
 * `ClientMessage`. Never let it touch a socket, a peer or a round — it is
 * called from two files and must stay a pure function of the bytes.
 *
 * **`decode` is not this check and never was.** It answers "is this JSON with a
 * string `t` on it" and then asserts the result to `ClientMessage`, so the
 * static type past that point is a claim about a well-behaved client rather
 * than a fact about the bytes — the same thing `cleanName`'s `typeof` guard
 * says about a name. Every field a handler reads off that message is a field a
 * socket chose, and there are two distinct ways that went wrong:
 *
 * - **A missing array took the process.** `onMove`, `onShot` and `onGrenade`
 *   each destructure a `Vec3` straight off the message (`const [x, y, z] =
 *   msg.pos`), and destructuring `undefined` THROWS — out of the socket's
 *   `message` listener, through ws's receiver, and out of the process, taking
 *   every other match in it down mid-round. `{"t":"move"}` is thirty bytes and
 *   needs nothing but a seat, and with `restart: unless-stopped` in front of it
 *   the result is a server that can be held down indefinitely by one client
 *   sending one message every few seconds. Reproduced on all three handlers.
 *
 * - **A non-numeric field walked through every check downstream.** Sending
 *   `pos: ["x","y","z"]` passes the whole of `validate.ts`, because each of its
 *   tests is a comparison and every comparison against `NaN` is false: speed,
 *   bounds, ground and solid all fall through, no `correct` is sent, and the
 *   server broadcasts the strings to all sixteen clients. It also bypasses the
 *   shot origin gate for the same reason — `Math.hypot(NaN, ...) >
 *   MAX_ORIGIN_SLIP` is false — so a client that has poisoned its own position
 *   can fire an accepted round from half a kilometre away. Confirmed against a
 *   live match.
 *
 * **The line is drawn at what can crash or poison arithmetic**, which is why
 * this file checks numbers and arrays and leaves the strings and the booleans
 * alone. Those already have doors and the doors are load-bearing: `cleanName`
 * bounds the one client string other people's screens render, `weaponSetup`
 * and the `MAPS` lookup resolve an id against a real table, and `crouching` /
 * `sprinting` are only ever read as the condition of a ternary, so no value a
 * socket can put in either reaches arithmetic. Duplicating those here would put
 * a second opinion beside a rule that already has one owner.
 *
 * A message that fails is dropped rather than logged, and the peer is not
 * punished for it. `Match`'s token bucket has already charged for the frame, so
 * a flood of malformed messages costs exactly what a flood of well-formed ones
 * does and is closed out by the same rule — while a log line per bad message
 * would hand any socket an unbounded write to the server's stdout.
 */
import { decode, type ClientMessage } from "../src/net/protocol";

/**
 * `Number.isFinite` rather than the global `isFinite`, and the difference is
 * the whole point: the global COERCES, so `isFinite("3")` is true and a string
 * would sail through the very gate it is here to stop. This one is false for a
 * string, for `undefined`, for `null`, for `NaN` and for either infinity.
 */
function isNum(v: unknown): boolean {
  return Number.isFinite(v);
}

/** A position or a direction: three real numbers, no more and no fewer. */
function isVec3(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    isNum(v[0]) &&
    isNum(v[1]) &&
    isNum(v[2])
  );
}

/** Absent is fine; present and not a string is not. */
function optionalString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

/**
 * Decodes one frame and returns it only if every field a handler will read off
 * it is there and is of the right kind. `null` for anything else, which both
 * callers already handle: the handshake refuses the socket and `Match` drops
 * the message.
 *
 * The `default` arm returns null, so an unknown `t` is refused rather than
 * ignored, and neither way a newer client can reach it is a hazard. A type that
 * came with a `PROTOCOL_VERSION` bump cannot arrive at all — the handshake
 * refuses that client first. An ADDITIVE one (`reload` is the first) is
 * dropped, which is precisely what "this server does not have that feature"
 * should look like from the far side.
 */
export function readClientMessage(raw: string): ClientMessage | null {
  const msg = decode(raw) as ClientMessage | null;
  if (!msg) return null;
  // The cast is what this function exists to earn back. Everything below reads
  // through it rather than through the union, because the union's own field
  // types are the claim being tested.
  const m = msg as unknown as Record<string, unknown>;

  switch (msg.t) {
    case "join":
      // `version` is compared with `!==` downstream, so a non-number is already
      // refused there; it is checked anyway so that the refusal names the
      // protocol mismatch it looks like rather than depending on a coincidence.
      // The four ids are optional by design — a client that sends none of them
      // is `?mp` and every build that predates the lobby.
      return isNum(m.version) &&
        optionalString(m.matchId) &&
        optionalString(m.map) &&
        optionalString(m.weapon) &&
        optionalString(m.equipment)
        ? msg
        : null;

    case "move":
      return isNum(m.seq) &&
        isNum(m.time) &&
        isVec3(m.pos) &&
        isNum(m.yaw) &&
        isNum(m.pitch)
        ? msg
        : null;

    // One arm, because they carry the same four fields for the same reasons:
    // a sequence, the client render time the rewind is taken at, and the two
    // vectors the cone and origin gates are measured against.
    case "shot":
    case "grenade":
      return isNum(m.seq) && isNum(m.time) && isVec3(m.origin) && isVec3(m.dir)
        ? msg
        : null;

    // One arm for the same four fields again — a shell and an AT item are
    // both a claim about a thing leaving a barrel at an instant, checked the
    // same way and re-resolved by the authority the same way.
    case "shell":
    case "mg":
    case "ordnance":
      return isNum(m.seq) && isNum(m.time) && isVec3(m.origin) && isVec3(m.dir)
        ? msg
        : null;

    // A driver's hull, which carries a position and five angles. The
    // hardstanding index is an INDEX, so it is checked as an integer for
    // `deploy`'s reason — everything downstream uses it to subscript the
    // fleet, and `seat` asks again about what it MEANS.
    case "drive":
      return isNum(m.seq) &&
        isNum(m.time) &&
        Number.isInteger(m.tank) &&
        isVec3(m.pos) &&
        isNum(m.yaw) &&
        isNum(m.tyaw) &&
        isNum(m.gun) &&
        isNum(m.aimYaw) &&
        isNum(m.aimPitch)
        ? msg
        : null;

    // A gunner's own report: an index and two angles, and no position at all —
    // a man on the cupola moves nothing, so there is nothing here for
    // `validate.ts` to have an opinion about. See `GunnerMessage`.
    case "gunner":
      return isNum(m.seq) &&
        isNum(m.time) &&
        Number.isInteger(m.tank) &&
        isNum(m.myaw) &&
        isNum(m.mpitch)
        ? msg
        : null;

    // `seat` is OPTIONAL — absent is "whichever chair is free", which is what
    // every client before the second seat meant and what a player walking up
    // to a tank still means. Present it must be an integer for `tank`'s
    // reason: `onMount` uses it to index a pair, and it asks again about what
    // it MEANS.
    case "mount":
      return Number.isInteger(m.tank) &&
        (m.seat === undefined || Number.isInteger(m.seat))
        ? msg
        : null;

    // Nothing on them to check, and they still owe this arm: the `default`
    // below refuses what it does not recognise, so a message type with no
    // fields is the one shape that would be dropped for having nothing wrong
    // with it.
    case "reload":
    case "dismount":
      return msg;

    case "deploy":
      // An INDEX, so integer rather than merely finite. `onDeploy` asks the
      // same question again and is right to: this is the shape gate for the
      // wire, and that one is the guard on the field it is about to write.
      return Number.isInteger(m.spawn) ? msg : null;

    default:
      return null;
  }
}
