/**
 * server/simulate.ts — Runs a whole Conquest round headlessly and prints what
 * happened. `npm run simulate [map] [difficulty] [rounds] [seed] [--events]
 * [--phases]`.
 *
 * **A round is a function of its map, its difficulty and its SEED**
 * (`src/systems/RoundRandom.ts`), and every round printed says which seed it
 * was. Pass one and every round of the run plays from it — the same fight,
 * the same kills, the same score, in this process or any other — which is how
 * a round is played again and how a change is shown to have moved nothing
 * about the fight. Leave it out and each round draws a fresh one, as a match
 * does. **`fight` is what to compare**: a hash over every death and every
 * award in the order they happened, each with its tick, its slot and its
 * kind — the whole kill list, where the board beside it is only its totals.
 *
 * **Everything here is read off the core's event ring** (`src/sim/events.ts`),
 * drained after every step exactly as `Match` drains it, and folded in the
 * order the core wrote it: the hash folds each `award` and `death` with the
 * tick it was STAMPED with, which is the tick the step that raised it ran.
 * Nothing is wired onto the core; this host is a reader of what it says.
 *
 * **`--events` prints the list itself**, one line per event in the order the
 * simulation raised it, before the summary: every death and award the hash
 * folds, and every piece of news `Match` puts on the wire — a bot's kill,
 * shot and reload, a capture, a neutralisation, a blast, a fire, a tank gun, a
 * cupola gun, a pane, a seat, a spawn, a person's damage and near miss. Each
 * line is `<tick> <kind> <fields>`, numbers printed in full, so two runs of
 * one seed diff line by line and a divergence is named by the first line that
 * differs rather than by a hash that moved. The kinds and the line format are
 * the C0 set (`BABYLON_EXIT.md` X2.5a) and are kept byte for byte: the ring's
 * presentation-only kinds — a footstep, a tracer, a hit, a hull's kick, a
 * rocket, a fire going out — are left out, being most of the file and
 * nothing `Match` sends. The lines are written between steps, outside the
 * timed region.
 *
 * **`--phases` hands the core a clock and turns its step timing on**
 * (`SimCoreOptions.timing`, `SimCore.timeSteps`, `BABYLON_EXIT.md` X2.5a C6)
 * — the timing the page's profiler files as `sim` and its five children — and
 * prints each phase's mean beside the tick. The core reads that clock inside
 * the timed region, twelve times a step, so the tick printed is the tick with
 * the instrument in it; the plain run is still the one that measures a match,
 * which passes no clock. The fight is the same fight either way: the clock is
 * read into `SimCore.timing` (`src/sim/stepTiming.ts`) and nothing else.
 *
 * This is the server's equivalent of playing a round, and it is the only way to
 * see the simulation on its own — no clients, no rendering, no wall clock. A
 * round that takes twelve minutes to play takes a few seconds here, which makes
 * it the practical tool for the questions that need a whole round to answer:
 * does the bake navigate, do bots find each other, does the bleed end a match.
 *
 * It is NOT a balance oracle. `CONFIG.conquest.tickets` is sized against real
 * play, and this runs with nobody in the fight — sixteen bots is not eight bots
 * and eight people. Read it for "did the round work", not for "is the round
 * fair".
 *
 * **It is also the instrument for the TICK, which is `ENGINE_UPGRADE.md` S9's
 * whole question**: a match server holds a fixed 60 Hz step for sixteen slots,
 * and whether it still holds one across a 900 m map is a question no client
 * frame can answer. So every `step` is timed and the distribution is printed
 * beside the round.
 *
 * **The mean is the least useful number in that block and is printed last for
 * that reason.** A tick that runs 50x under budget on average and once a
 * second lands 20x over it is a server that stutters for everybody on it, and
 * a mean cannot see that at all — the round-robin think stagger
 * (`CONFIG.bots.thinkRate`) is a mechanism for producing exactly that shape.
 * What settles it is the tail and the count over budget, so those are what the
 * block leads with.
 *
 * **The wall clock here is not a frame budget.** Nothing throttles this loop
 * to 60 Hz — a round runs as fast as one core can step it — so `wallMs` is
 * how long the SIMULATION took to compute and never how long it would take to
 * play. The realtime multiple is the honest way to read it.
 */
import { createHash } from "node:crypto";
import { PerformanceObserver } from "node:perf_hooks";
import { TICK_HZ } from "../src/net/protocol";
import { CONFIG } from "../src/config";
import { MAPS } from "../src/world/maps";
import { perTeamOf } from "../src/world/layout";
import { freshSeed, parseSeed } from "../src/systems/RoundRandom";
import type { DeathCause } from "../src/systems/killRules";
import { SimCore } from "../src/sim/SimCore";
import { SIM_PHASES } from "../src/sim/stepTiming";
import { EV, EventCursor, decode, type EventKind, type Vec3 } from "../src/sim/events";
import { loadSimWorld } from "./world";

/** Give up rather than spin forever if a round somehow cannot end. */
const MAX_SIM_MINUTES = 45;

/**
 * What one tick is allowed to cost, in milliseconds.
 *
 * Derived from `TICK_HZ` rather than written down, because the number that
 * matters is the one `Match` actually steps at: a server that misses this is
 * a server whose clock has slipped for every client on it, and the two must
 * not be able to disagree.
 */
const TICK_BUDGET_MS = 1000 / TICK_HZ;

/**
 * The tick a spike is worth explaining above, in milliseconds.
 *
 * Two orders of magnitude over a fighting tick and two under the budget, so
 * the ticks it selects are the ones that are neither the simulation working
 * nor a problem — which is exactly the set worth attributing to the garbage
 * collector rather than leaving as an unexplained worst case in a table.
 */
const SPIKE_MS = 1;

/**
 * Ticks between turns of the event loop.
 *
 * **The loop yields for two reasons and neither is politeness.** A real
 * authority steps once per timer callback and never 90,000 times inside one
 * turn, so a run that never yields is not the process being modelled: nothing
 * the runtime wanted to do between ticks — a `PerformanceObserver` delivery,
 * an incremental marking task — could happen at all, and the GC block below
 * measured a flat zero on a round that plainly collected. It is rare enough
 * (about one turn per 17 seconds of game time) to cost nothing, and it is
 * outside the timed region, so no tick is charged for it.
 */
const YIELD_EVERY = 1024;

/**
 * Nearest-rank percentile over a sorted sample. `p` is a fraction.
 *
 * Nearest-rank and not interpolated: these are timings, and the honest answer
 * to "what did the 99th-percentile tick cost" is a tick that actually
 * happened rather than a weighted average of two that did.
 */
function pct(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

/**
 * How many bots are in contact, bucketed — and this is the half of the tick
 * block that stops a quiet round being read as an answer.
 *
 * A round left to itself on a big map spends most of its ticks with nobody
 * looking at anybody: `ENGINE_UPGRADE.md` S2 had to FORCE a skirmish before the
 * client fired a single ray at 1500 m, and S8 found the same shape again in
 * the frame. The mean tick of such a round is a measurement of walking. So
 * every tick is filed by how many bots held a target during it, and the
 * expensive bucket is quoted beside the cheap one: what settles whether the
 * step holds is what the CONTESTED ticks cost, not what the round averaged.
 *
 * Bounds rather than a count per bot, because the shape is a step: nobody in
 * contact, a firefight somewhere, half the roster in it, and everybody.
 */
const CONTACT_BUCKETS = [0, 1, 4, 8] as const;

async function runRound(mapId: string, difficulty: number, seed: number) {
  const def = MAPS.find((m) => m.id === mapId);
  if (!def) throw new Error(`no map "${mapId}" (have ${MAPS.map((m) => m.id).join(", ")})`);

  // The AUTHORITY's options, because this is the authority's fight: the
  // history is recorded every tick as `Match` records it, so the tick cost
  // printed below is the one a match pays.
  const game = new SimCore({
    rewind: true,
    timing: timePhases ? () => performance.now() : undefined,
  });
  game.timeSteps(timePhases);
  // `--phases`: the core's own timing of each step, summed per phase and
  // read after the step's clock — see the header.
  const phaseMs = new Float64Array(SIM_PHASES.length);
  let phaseTotal = 0;
  // `--events`: one line per event, stamped with the tick it was raised on —
  // see the header. Null when not asked for, so a plain run builds no string.
  const log = printEvents
    ? (tick: number, line: string) => process.stdout.write(`${tick} ${line}
`)
    : null;
  const captures: string[] = [];
  let blasts = 0;
  let blazes = 0;
  // Every award paid, by kind. The cheapest check there is that the scoring
  // rules actually fire in a whole round: no `capture` line means the flags
  // paid nobody, and no `defend` line means the attack/defend split is not
  // being reached at all.
  const awards: Record<string, number> = {};
  // The fight as a list, hashed as it happens — see the header. Fed from the
  // `award` and `death` events, which between them are every death and every
  // payout.
  const fight = createHash("sha256");
  let events = 0;
  // Every death, filed by the door it came through and by whether anybody was
  // paid for it. The two checks under `reconcile` are what this is for; the
  // per-cause breakdown is what makes a failure readable rather than merely
  // detected.
  const deaths: Partial<Record<DeathCause, number>> = {};
  const uncredited: Partial<Record<DeathCause, number>> = {};
  let bodies = 0;
  let creditedBodies = 0;

  /**
   * Drains what the core said on its last call and folds it — the hash, the
   * tallies, and the `--events` line. Called after every call made on the
   * core, which is the host's half of the ring's contract.
   */
  const drained = new EventCursor();
  const read = (): void => {
    game.drain(drained);
    for (let i = 0; i < drained.count; i++) {
      if (!READ.has(drained.kind(i))) continue;
      const ev = decode(drained, i);
      const t = ev.tick;
      switch (ev.type) {
        case "blast":
          blasts++;
          if (log) log(t, `explode ${v3(ev.at)} ${ev.power}`);
          break;
        case "ignited":
          blazes++;
          if (log) log(t, `blaze ${v3(ev.at)}`);
          break;
        case "captured": {
          const id = game.conquest.points[ev.point].def.id;
          captures.push(`${id}->${ev.by}`);
          if (log) log(t, `captured ${id} ${ev.by}`);
          break;
        }
        case "award":
          awards[ev.kind] = (awards[ev.kind] ?? 0) + 1;
          fight.update(`${t} a ${ev.slot} ${ev.kind} ${ev.points}\n`);
          events++;
          if (log) log(t, `award ${ev.slot} ${ev.kind} ${ev.points}`);
          break;
        case "death":
          fight.update(`${t} d ${ev.slot} ${ev.cause} ${ev.credited ? 1 : 0}\n`);
          events++;
          if (log) log(t, `death ${ev.slot} ${ev.cause} ${ev.credited ? 1 : 0}`);
          bodies++;
          deaths[ev.cause] = (deaths[ev.cause] ?? 0) + 1;
          if (ev.credited) creditedBodies++;
          else uncredited[ev.cause] = (uncredited[ev.cause] ?? 0) + 1;
          break;
        // The rest of what `Match` relays, taken only for the list. Nobody is
        // seated in a simulated round, so `nearmiss`, `spawn`, `seat` and
        // `damage` never appear today; they are printed so a tool that grows
        // synthetic players lists them.
        default:
          if (log) log(t, describe(ev, game));
          break;
      }
    }
  };

  // **The roster is `Match`'s pair, stated as `Match` states it** — the
  // ceiling as the pool and the map's own `perTeamOf` fielded out of it
  // (`RoundSpec`). This tool exists to measure the ROUND a player actually
  // gets, which on Sarab is `MapLayout.perTeam`'s twenty-four a side, and the
  // slot layout is what every outcome stream is keyed by — so a pool sized
  // any other way would be a different fight from the authority's. See
  // `server/Roster.ts`.

  const built = Date.now();
  // The host's three jobs (`SimCore`'s header): load the world, hand over the
  // seed, anchor the clock. The anchor decides nothing here — nobody is seated,
  // so nothing is ever rewound against it — and is taken as `Match` takes it.
  const { collision, floor } = await loadSimWorld(def);
  game.startRound({
    def,
    collision,
    floor,
    difficulty,
    pool: CONFIG.bots.maxPerTeam,
    fielded: perTeamOf(def.layout),
    seed,
  });
  game.anchor(Date.now());
  read();
  const buildMs = Date.now() - built;

  const dt = 1 / TICK_HZ;
  const maxTicks = MAX_SIM_MINUTES * 60 * TICK_HZ;
  // One sample per tick, allocated whole rather than pushed to: a round is up
  // to 162,000 ticks and an array that grows under the thing it is timing is
  // an instrument measuring its own reallocation.
  const samples = new Float64Array(maxTicks + 1);
  // And when each one started, on the same clock, so a spike can be laid
  // against what the runtime was doing at the time.
  const startedAt = new Float64Array(maxTicks + 1);
  // **The garbage collector, because otherwise the worst tick in the table is
  // unattributed and a reader has to assume it was the simulation.** It is
  // not: a step that costs 8 microseconds cannot produce a 10 ms outlier, and
  // a young-generation scavenge in a process allocating vectors per frame
  // can. Observed rather than inferred — the entries carry a start and a
  // duration, so the spikes can be matched to them after the round instead of
  // a claim being made about them.
  const pauses: { start: number; ms: number }[] = [];
  const gcWatch = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) pauses.push({ start: e.startTime, ms: e.duration });
  });
  gcWatch.observe({ entryTypes: ["gc"] });
  const started = Date.now();
  let ticks = 0;
  // Per contact bucket: ticks, summed milliseconds, worst tick.
  const inBucket = CONTACT_BUCKETS.map(() => ({ ticks: 0, ms: 0, max: 0 }));
  let peakContact = 0;
  // `performance.now()` and not `Date.now()`, which is the whole reason this
  // loop looks different from the wall clock either side of it: a tick on a
  // 240 m map costs tens of MICROSECONDS, and a millisecond clock reports a
  // run of them as a column of zeroes with an occasional 1.
  for (;;) {
    const t0 = performance.now();
    const alive = game.step(dt);
    const ms = performance.now() - t0;
    samples[ticks] = ms;
    startedAt[ticks] = t0;
    // What the step said, folded outside the clock above.
    read();
    if (timePhases) {
      const t = game.timing;
      phaseTotal += t.total;
      for (let i = 0; i < SIM_PHASES.length; i++) phaseMs[i] += t.ms[i];
    }
    // Counted AFTER the clock is read, so the instrument is never inside its
    // own measurement. A target is the honest test of contact: it is what
    // gates the line-of-sight ray, the shot and the aim, which is where a
    // fighting tick spends everything a walking one does not.
    let engaged = 0;
    for (const bot of game.battle.bots) if (bot.alive && bot.target) engaged++;
    if (engaged > peakContact) peakContact = engaged;
    let b = 0;
    while (b + 1 < CONTACT_BUCKETS.length && engaged >= CONTACT_BUCKETS[b + 1]) b++;
    inBucket[b].ticks++;
    inBucket[b].ms += ms;
    if (ms > inBucket[b].max) inBucket[b].max = ms;
    // Counted whether or not the round survived it, because the tick that ENDS
    // a round is a tick the server paid for.
    if (++ticks > maxTicks || !alive) break;
    // Outside the clock above, deliberately — see `YIELD_EVERY`.
    if (ticks % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  const wallMs = Date.now() - started;
  // **One turn of the event loop before the observer is taken away, and
  // without it this reports zero pauses on a round that had dozens.** The
  // loop above is synchronous from the first tick to the last, so nothing the
  // runtime wanted to hand back — a `PerformanceObserver` callback included —
  // could run while it held the thread. Disconnecting on the next line threw
  // the queue away and the block said "0 GC pauses", which reads as a
  // measurement and was an instrument that had never been given a turn.
  await new Promise((resolve) => setImmediate(resolve));
  gcWatch.disconnect();
  const sorted = samples.slice(0, ticks).sort();
  // A spike is "the collector" when a GC pause OVERLAPS the tick, which is the
  // only claim the two clocks can support: both are `performance.now()`, so
  // the intervals are comparable, and an overlap is evidence rather than the
  // coincidence that a nearby timestamp would be.
  let spikes = 0;
  let collected = 0;
  // WHERE they fell, not just how many: a spike on tick 3 is the JIT and a
  // spike on tick 40,000 is not, and a count cannot tell the two apart.
  const spikeAt: number[] = [];
  for (let i = 0; i < ticks; i++) {
    if (samples[i] <= SPIKE_MS) continue;
    spikes++;
    if (spikeAt.length < 8) spikeAt.push(i);
    const from = startedAt[i];
    const to = from + samples[i];
    if (pauses.some((g) => g.start < to && g.start + g.ms > from)) collected++;
  }
  const gcMs = pauses.reduce((n, g) => n + g.ms, 0);
  // Over BUDGET, not over the mean: a tick either fits in the step `Match`
  // runs at or it does not, and everything else in this block is context for
  // that count.
  let over = 0;
  for (let i = 0; i < ticks; i++) if (samples[i] > TICK_BUDGET_MS) over++;
  let total = 0;
  for (let i = 0; i < ticks; i++) total += samples[i];

  const result = {
    map: def.name,
    difficulty,
    seed,
    buildMs,
    /**
     * `--phases`: the mean ms per step of the core's own timing — the whole
     * step and each `SIM_PHASES` entry — or null when not asked for.
     */
    phases: timePhases
      ? {
          step: phaseTotal / Math.max(1, ticks),
          each: SIM_PHASES.map((name, i) => ({ name, ms: phaseMs[i] / Math.max(1, ticks) })),
        }
      : null,
    wallMs,
    ticks,
    simSeconds: ticks / TICK_HZ,
    /** The tick, which is what S9 asks about. Milliseconds, per `step`. */
    tick: {
      mean: total / Math.max(1, ticks),
      p50: pct(sorted, 0.5),
      p95: pct(sorted, 0.95),
      p99: pct(sorted, 0.99),
      max: pct(sorted, 1),
      over,
    },
    /** Spikes, and how many of them the collector owns. */
    spikes: { over: spikes, collected, pauses: pauses.length, gcMs, at: spikeAt },
    /** The same ticks, filed by how many bots were in contact during them. */
    contact: CONTACT_BUCKETS.map((low, i) => ({
      low,
      high: i + 1 < CONTACT_BUCKETS.length ? CONTACT_BUCKETS[i + 1] - 1 : Infinity,
      ...inBucket[i],
    })),
    peakContact,
    /** Bodies in the round, which is this map's `perTeam` twice over. */
    // The ROUND's roster and not the pool's: the authority builds every bot
    // any map could field and puts the surplus aside (`BattleSystem.setFielded`),
    // so `bots.length` is the ceiling on every map and this is the fight.
    roster: game.perTeam * 2,
    winner: game.conquest.winner,
    tickets: [...game.conquest.tickets] as [number, number],
    // Summed out of the per-slot board rather than kept alongside it — see
    // `SimCore.teamScore`.
    kills: [game.teamScore(0).kills, game.teamScore(1).kills] as [number, number],
    losses: [game.teamScore(0).deaths, game.teamScore(1).deaths] as [number, number],
    // The board's third column, which a whole headless round is the cheapest
    // way to sanity-check: it should sit well above `kills * CONFIG.score.kill`
    // once the flags have been changing hands, and equal to it if the capture
    // awards have somehow stopped being paid.
    points: [game.teamScore(0).points, game.teamScore(1).points] as [number, number],
    /** Every award paid this round, by kind — what the points above are made of. */
    awards,
    /**
     * The board checked against itself: does every kill award land on a row a
     * team can see, does every death, and is every body either paid for or
     * explained.
     *
     * **The third is the one with teeth and the first two are couplings**, and
     * saying which is which is the difference between a check and a comfort.
     *
     * The third is two INDEPENDENT streams meeting: the credit door says how
     * many blows found somebody to pay, and the ledger says how many kills
     * were written down. They can only agree if every creditable blow reached
     * a real row, so it catches both halves of the thing that goes wrong here
     * — a door that claims a credit it never got, and a credit that was made
     * and then dropped on the floor. Both were injected and both were caught.
     * It holds exactly while nobody is in the fight: a person's kill is
     * awarded at the killer's door while their death is counted at their own,
     * so the two streams stop being one number the moment a match has people
     * in it, which is why this lives here and not in `Match`.
     *
     * The first two cannot fire as the authority is wired today, and they are
     * here anyway because what they check is a COUPLING that is currently
     * true rather than a law. `startRound` sizes the board with
     * `scores.reset(battle.bots.length)` and `teamScore` walks that same pool,
     * so every in-range slot is owned by a side by construction — and
     * `ScoreBook.award` drops an out-of-range one BEFORE raising `onAward`, so
     * a bad slot takes both sides of the comparison to zero together rather
     * than splitting them. What breaks that is a pool resized under a live
     * board, which is not hypothetical: `BattleSystem.setRoster` does exactly
     * that on a client, and `setFielded` already gives the authority two
     * different numbers for "how many bots". The day either reaches this
     * board, these two lines are what says so.
     */
    reconcile: {
      killAwards: awards.kill ?? 0,
      ledgerKills: game.teamScore(0).kills + game.teamScore(1).kills,
      ledgerDeaths: game.teamScore(0).deaths + game.teamScore(1).deaths,
      bodies,
      creditedBodies,
      /** Every death by the door it came through. */
      deaths,
      /** …and the subset nobody was paid for, which is what wants explaining. */
      uncredited,
    },
    captures: captures.length,
    blasts,
    blazes,
    flagsHeld: [game.conquest.flagsHeld(0), game.conquest.flagsHeld(1)] as [number, number],
    /** The kill list's fingerprint — see the header — and how long the list was. */
    fight: { hash: fight.digest("hex").slice(0, 16), events },
  };
  game.dispose();
  return result;
}

/**
 * The board's three identities, checked rather than printed and hoped over.
 *
 * Returns the failures in words, empty when the round balances. Words rather
 * than a boolean because the whole value of a check like this is in what it
 * says when it breaks: "345 kill awards against 344 on the board" names the
 * shape of the bug — one award paid to a row no team owns — where a bare
 * `false` sends the reader back to the code to work out which of the three
 * identities even failed.
 *
 * Read the arithmetic as: every kill award landed somewhere countable, every
 * death did, and the number of blows that found somebody to pay is the number
 * of kills written down. See `result.reconcile` for why none of the three is
 * the tautology it resembles.
 */
function reconcileProblems(r: Awaited<ReturnType<typeof runRound>>): string[] {
  const c = r.reconcile;
  const out: string[] = [];
  if (c.killAwards !== c.ledgerKills) {
    out.push(
      `${c.killAwards} kill awards paid but ${c.ledgerKills} on the board — ` +
        `an award landed on a row no team owns (ScoreBook.award drops a slot outside the roster)`,
    );
  }
  if (c.bodies !== c.ledgerDeaths) {
    out.push(
      `${c.bodies} bodies went down but ${c.ledgerDeaths} deaths on the board — ` +
        `a death was registered to a row no team owns`,
    );
  }
  if (c.creditedBodies !== c.killAwards) {
    out.push(
      `${c.creditedBodies} blows found somebody to pay but ${c.killAwards} kills were written down — ` +
        `a creditable kill did not reach a row`,
    );
  }
  return out;
}

/** A vector as three full-precision numbers, for `--events`. */
function v3(v: Vec3): string {
  return `${v[0]},${v[1]},${v[2]}`;
}

/**
 * The event kinds this tool reads: the two the hash folds, the two counted,
 * and the rest of what `Match` relays — the C0 list, which `--events` prints
 * byte for byte. Everything else is drained and left undecoded.
 */
const READ: ReadonlySet<EventKind> = new Set<EventKind>([
  EV.blast,
  EV.ignited,
  EV.captured,
  EV.neutralised,
  EV.award,
  EV.death,
  EV.botDown,
  EV.botFired,
  EV.botReload,
  EV.cannon,
  EV.mg,
  EV.glass,
  EV.nearMiss,
  EV.spawned,
  EV.seat,
  EV.damaged,
]);

/** One `--events` line for a kind the round does not otherwise fold. */
function describe(ev: ReturnType<typeof decode>, game: SimCore): string {
  switch (ev.type) {
    case "neutralised":
      return `neutralised ${game.conquest.points[ev.point].def.id}`;
    case "botDown":
      return (
        `kill ${ev.killer} ${ev.slot} ${ev.head ? 1 : 0} ` +
        `${v3(ev.from)} ${ev.damage} ${ev.kind}`
      );
    case "botFired":
      return `fire ${ev.slot} ${v3(ev.muzzle)}`;
    case "botReload":
      return `reload ${ev.slot}`;
    case "cannon":
      return `cannon ${ev.tank}`;
    case "mg":
      return `mg ${ev.tank}`;
    case "glass":
      return `glass ${ev.panes.join(",")} ${v3(ev.at)} ${v3(ev.dir)}`;
    case "nearMiss":
      return `nearmiss ${ev.slot} ${v3(ev.at)}`;
    case "spawned":
      return `spawn ${ev.slot} ${v3(ev.pos)} ${ev.yaw}`;
    case "seat":
      return `seat ${ev.slot} ${ev.tank} ${ev.seat} ${v3(ev.at)} ${ev.yaw}`;
    case "damaged":
      return (
        `damage ${ev.slot} ${ev.amount} ${ev.from ? v3(ev.from) : "-"} ${ev.killed ? 1 : 0} ` +
        `${ev.kind} ${ev.health} ${ev.respawnIn}`
      );
    default:
      return ev.type;
  }
}

const argv = process.argv.slice(2);
/** `--events`: print the ordered event list — see the header. */
const printEvents = argv.includes("--events");
/** `--phases`: the core times its own step — see the header. */
const timePhases = argv.includes("--phases");
const [mapId = "hollowmere", difficulty = "1", rounds = "1", seedArg] = argv.filter(
  (a) => a !== "--events" && a !== "--phases",
);
// Refused rather than ignored: a typo that quietly drew a fresh seed would
// print a different fight and call it the one that was asked for.
const fixedSeed = seedArg === undefined ? null : parseSeed(seedArg);
if (seedArg !== undefined && fixedSeed === null) {
  throw new Error(`"${seedArg}" is not a seed (a whole number below 2^32)`);
}

for (let i = 0; i < Number(rounds); i++) {
  const r = await runRound(mapId, Number(difficulty), fixedSeed ?? freshSeed());
  const mins = (r.simSeconds / 60).toFixed(1);
  const problems = reconcileProblems(r);
  // Sorted heaviest first: on a vehicle map the crews are most of it, and a
  // cause that has appeared for the first time is what a reader is looking for.
  const unpaid = Object.entries(r.reconcile.uncredited).sort((a, b) => b[1] - a[1]);
  console.log(
    [
      `${r.map} (difficulty ${r.difficulty}, seed ${r.seed})`,
      `  world built in ${r.buildMs} ms`,
      `  round ran ${r.ticks} ticks = ${mins} min of game time in ${r.wallMs} ms of wall clock`,
      `           = ${(r.simSeconds / (r.wallMs / 1000)).toFixed(1)}x real time on one core`,
      `  tick:    ${r.tick.over} of ${r.ticks} over the ${TICK_BUDGET_MS.toFixed(2)} ms budget ` +
        `(${((100 * r.tick.over) / Math.max(1, r.ticks)).toFixed(3)}%)`,
      `           worst ${r.tick.max.toFixed(3)} ms = ${((100 * r.tick.max) / TICK_BUDGET_MS).toFixed(1)}% of the budget`,
      `           p50 ${r.tick.p50.toFixed(3)} / p95 ${r.tick.p95.toFixed(3)} / ` +
        `p99 ${r.tick.p99.toFixed(3)} ms, mean ${r.tick.mean.toFixed(3)}`,
      `           ${r.spikes.over} ticks over ${SPIKE_MS} ms, ${r.spikes.collected} of them ` +
        `during one of the round’s ${r.spikes.pauses} GC pauses (${r.spikes.gcMs.toFixed(0)} ms total)`,
      `           first spikes on ticks ${r.spikes.at.join(", ") || "(none)"}`,
      ...(r.phases
        ? [
            `  phases:  step ${r.phases.step.toFixed(4)} ms mean, of which ` +
              r.phases.each.map((p) => `${p.name} ${p.ms.toFixed(4)}`).join(", ") +
              ` (the core's own clock, --phases)`,
          ]
        : []),
      `  contact: peak ${r.peakContact} of ${r.roster} bots on a target at once`,
      ...r.contact
        .filter((b) => b.ticks > 0)
        .map(
          (b) =>
            `           ${b.high === Infinity ? `${b.low}+` : b.low === b.high ? `${b.low}` : `${b.low}-${b.high}`}` +
            ` engaged: ${b.ticks} ticks, mean ${(b.ms / b.ticks).toFixed(3)} ms, worst ${b.max.toFixed(3)}`,
        ),
      `  winner: ${r.winner === null ? "NONE (hit the cap)" : CONFIG.teams[r.winner].name}`,
      `  tickets: ${r.tickets[0]} / ${r.tickets[1]}`,
      `  kills:   ${r.kills[0]} / ${r.kills[1]}`,
      `  losses:  ${r.losses[0]} / ${r.losses[1]}`,
      `  score:   ${r.points[0]} / ${r.points[1]}`,
      `  awards:  ${Object.entries(r.awards)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(", ")}`,
      `  deaths:  ${r.reconcile.bodies} bodies, ${r.reconcile.creditedBodies} paid for — ` +
        `${Object.entries(r.reconcile.deaths)
          .map(([cause, n]) => `${cause} ${n}`)
          .join(", ")}`,
      // The line the whole block exists for. "(none)" is the healthy answer on
      // a map with no armour on it; on one with armour it is the tank crews,
      // and a cause appearing here that is not `crew` is a kill leaking.
      `           uncredited: ${unpaid.map(([cause, n]) => `${cause} ${n}`).join(", ") || "(none)"}`,
      problems.length === 0
        ? "           board balances: kill awards, deaths and credits all agree"
        : problems.map((p) => `           *** ${p}`).join("\n"),
      `  flags held at the end: ${r.flagsHeld[0]} / ${r.flagsHeld[1]}`,
      `  flag captures during the round: ${r.captures}`,
      `  grenades detonated: ${r.blasts}`,
      `  molotovs lit: ${r.blazes}`,
      `  fight:   ${r.fight.hash} over ${r.fight.events} deaths and awards ` +
        `(the same seed must print the same hash)`,
    ].join("\n"),
  );
  // **A failed reconciliation is an EXIT CODE and not just a line**, so this
  // can be run as a gate rather than only read. Set rather than thrown: the
  // remaining rounds still run and still print, because a scoring bug that
  // shows up on one round in five is worth seeing all five of.
  if (problems.length > 0) process.exitCode = 1;
}
