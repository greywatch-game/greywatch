/**
 * hullSeats.ts — The two chairs in a hull and the one rule for filling them:
 * `CrewSeat` with `DRIVER` and `GUNNER`, `SEATS` (the fill order),
 * `SeatHolder` and `chooseSeat`.
 * Owns: those names and nothing else — no state, no tunable, no vehicle.
 * Invariants: a seat is one of exactly two numbers, everywhere it is named —
 * on the wire, in the roster, in the HUD — and `chooseSeat` is the boarding
 * rule for both processes, so the chair a client's prompt names is the chair
 * the authority grants.
 * Never: import anything. **A module of its own because the authority's
 * roster, its players and the hull rules all name a seat without wanting a
 * vehicle**: these sat in `Vehicle.ts`, and a value import of `DRIVER` from
 * there pulled the hull's model, its rig and Babylon behind it into
 * `server/Match.ts` and `src/sim/SimPlayer.ts`, which only ever wanted the
 * number (`BABYLON_EXIT.md` X2.2).
 */

/**
 * The two jobs inside a hull, as an index into `Vehicle.seats`.
 *
 * **They are a PAIR and not a list**, which is why this is two constants and a
 * union rather than an enum that could grow: the driver's seat carries the
 * sticks and the main gun and the gunner's carries the cupola gun, and a third
 * would be a body with nothing to do. Everything that crosses the wire, the
 * roster or the HUD names a seat with one of these two numbers.
 */
export type CrewSeat = 0 | 1;
/** The sticks, the main gun, and the only seat that can move the hull. */
export const DRIVER: CrewSeat = 0;
/** The cupola gun, and nothing else at all. */
export const GUNNER: CrewSeat = 1;

/**
 * The two jobs, in the order they are filled: a hull gets a driver before it
 * gets a gunner.
 *
 * **That order is the rule, not a convenience.** A tank with a man on the
 * cupola gun and nobody at the sticks is a pillbox; a tank with a driver and
 * an empty cupola is a tank. So every sweep that fills a seat walks this list
 * and takes the first free one, which is also exactly what a player boarding
 * gets — see `chooseSeat` below, where the same rule is stated once for both
 * processes.
 *
 * **Beside the seats rather than in `VehicleCrew`, where it was, because it
 * is what a VEHICLE has and not what the AI does with one**: `Game.crewLine` walks it to
 * draw one entry per chair, which is how a hull with a seat count other than
 * two would draw the seats it actually has rather than the two a tank has.
 */
export const SEATS: readonly CrewSeat[] = [DRIVER, GUNNER];

/**
 * Who is in one chair, as far as a PERSON asking for it is concerned: nobody,
 * a bot (who may be turned out of it), or a person (who never is).
 */
export type SeatHolder = "open" | "bot" | "player";

/**
 * Which chair a person asking for `want` gets, or -1 for none — **the one
 * statement of the boarding rule, asked by the client to word its prompt and
 * by the authority to grant it**, so the chair a prompt names is the chair the
 * server seats you in. Two algorithms used to stand here, one per process, and
 * the client's read the crew off its own `VehicleCrew`, which in a match has
 * no crews in it: a full hull with a bot driving was offered as TAKE OVER GUN.
 *
 * In order: the chair asked for if it is free; the OTHER one if that is free;
 * the chair asked for if a bot holds it; the other if a bot holds that. The
 * last two are evictions — **a bot crew never denies the player their own
 * armour** — and the caller does the evicting, since what holds a bot is each
 * process's own business. A PERSON is never moved. A boarder from the ground
 * asks for `DRIVER`, which is what makes the first man aboard drive.
 *
 * `only` is a CROSSING: a player already in the hull naming the other chair
 * gets that chair or nothing, because the fall-back would be the chair they
 * just left and a swap against a bot gunner would put them back where they
 * started.
 *
 * Takes the two holders as values rather than a lookup so a caller asking
 * every frame allocates nothing.
 */
export function chooseSeat(
  driver: SeatHolder,
  gunner: SeatHolder,
  want: CrewSeat,
  only = false,
): CrewSeat | -1 {
  const other: CrewSeat = want === DRIVER ? GUNNER : DRIVER;
  const wanted = want === DRIVER ? driver : gunner;
  const otherHeld = want === DRIVER ? gunner : driver;
  if (wanted === "open") return want;
  if (!only && otherHeld === "open") return other;
  if (wanted === "bot") return want;
  if (!only && otherHeld === "bot") return other;
  return -1;
}
