/**
 * server/simulate.ts — Runs a whole Conquest round headlessly and prints what
 * happened. `npm run simulate [map] [difficulty] [rounds]`.
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
import { PerformanceObserver } from "node:perf_hooks";
import { TICK_HZ } from "../src/net/protocol";
import { CONFIG } from "../src/config";
import { perTeamOf } from "../src/world/layout";
import { MAPS } from "../src/world/maps";
import { HeadlessGame } from "./HeadlessGame";

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
 * looking at anybody: `FINDINGS.md` 22 had to FORCE a skirmish before the
 * client fired a single ray at 1500 m, and 30 found the same shape again in
 * the frame. The mean tick of such a round is a measurement of walking. So
 * every tick is filed by how many bots held a target during it, and the
 * expensive bucket is quoted beside the cheap one: what settles whether the
 * step holds is what the CONTESTED ticks cost, not what the round averaged.
 *
 * Bounds rather than a count per bot, because the shape is a step: nobody in
 * contact, a firefight somewhere, half the roster in it, and everybody.
 */
const CONTACT_BUCKETS = [0, 1, 4, 8] as const;

async function runRound(mapId: string, difficulty: number) {
  const def = MAPS.find((m) => m.id === mapId);
  if (!def) throw new Error(`no map "${mapId}" (have ${MAPS.map((m) => m.id).join(", ")})`);

  const game = new HeadlessGame();
  const captures: string[] = [];
  let blasts = 0;
  game.onExplosion = () => blasts++;
  // `onCapturedEvent` and NOT `conquest.onCaptured`, which is the simulation's
  // own and pays everybody standing on the flag: a callback has one owner, and
  // taking that one here would have quietly turned the capture awards off in
  // the one tool that exists to check them.
  game.onCapturedEvent = (point, by) => captures.push(`${point.def.id}->${by}`);
  // Every award paid, by kind. The cheapest check there is that the scoring
  // rules actually fire in a whole round: no `capture` line means the flags
  // paid nobody, and no `defend` line means the attack/defend split is not
  // being reached at all.
  const awards: Record<string, number> = {};
  game.scores.onAward = (_slot, kind) => {
    awards[kind] = (awards[kind] ?? 0) + 1;
  };

  // **The map's own roster, and this is the OFFLINE one on purpose.**
  // `HeadlessGame` is the authority, and the authority is sixteen fixed slots
  // on every map it rotates onto (`server/Roster.ts`) — but this tool is not a
  // match. It exists to measure a ROUND, and the round a player gets on Sarab
  // is `MapLayout.perTeam`'s twenty-four a side; a harness that measured
  // sixteen there would be reporting a fight nobody plays, which is exactly the
  // trap `ENGINE_UPGRADE.md` S10 was measuring its way out of.
  //
  // Before `startRound` and not inside it, because that is the one moment
  // nothing is holding a body: no crew, no bench, no map, no round. It is also
  // why this is here rather than a parameter on `HeadlessGame` — the authority
  // has no business being told a roster it is contractually not allowed to use.
  game.battle.setRoster(perTeamOf(def.layout));

  const built = Date.now();
  await game.startRound(def, difficulty);
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
    buildMs,
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
    roster: game.battle.bots.length,
    winner: game.conquest.winner,
    tickets: [...game.conquest.tickets] as [number, number],
    // Summed out of the per-slot board rather than kept alongside it — see
    // `HeadlessGame.teamScore`.
    kills: [game.teamScore(0).kills, game.teamScore(1).kills] as [number, number],
    losses: [game.teamScore(0).deaths, game.teamScore(1).deaths] as [number, number],
    // The board's third column, which a whole headless round is the cheapest
    // way to sanity-check: it should sit well above `kills * CONFIG.score.kill`
    // once the flags have been changing hands, and equal to it if the capture
    // awards have somehow stopped being paid.
    points: [game.teamScore(0).points, game.teamScore(1).points] as [number, number],
    /** Every award paid this round, by kind — what the points above are made of. */
    awards,
    captures: captures.length,
    blasts,
    flagsHeld: [game.conquest.flagsHeld(0), game.conquest.flagsHeld(1)] as [number, number],
  };
  game.dispose();
  return result;
}

const [mapId = "hollowmere", difficulty = "1", rounds = "1"] = process.argv.slice(2);

for (let i = 0; i < Number(rounds); i++) {
  const r = await runRound(mapId, Number(difficulty));
  const mins = (r.simSeconds / 60).toFixed(1);
  console.log(
    [
      `${r.map} (difficulty ${r.difficulty})`,
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
      `  flags held at the end: ${r.flagsHeld[0]} / ${r.flagsHeld[1]}`,
      `  flag captures during the round: ${r.captures}`,
      `  grenades detonated: ${r.blasts}`,
    ].join("\n"),
  );
}
