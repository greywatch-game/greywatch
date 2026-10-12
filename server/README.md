# server/

The authoritative multiplayer server. Hosts the same simulation core the
offline page hosts — `SimCore`, with `BattleSystem`, `ConquestSystem`,
`CombatSystem` and the rest wired inside it — with no window,
no GPU, no rendering and **no Babylon**: nothing reachable from this directory
imports `@babylonjs/core`, and `scripts/check-babylon-free.mjs` fails
`npm run build` if anything ever does (`BABYLON_EXIT.md` X2.3; it ran under
Babylon's `NullEngine` until then).

Read [`docs/multiplayer.md`](../docs/multiplayer.md) before changing anything in
here. What follows is only the shape of the directory.

## The simulation is not in this directory

`SimCore` (the round: every simulation system and the wiring between them),
`SimPlayer` (a connected human as the simulation sees one), `LagComp` (the
rewind around a shot) and `buildSimWorld` (the solid world rebuilt from the
bake as data) live in [`src/sim/`](../src/sim/), moved out of here at
`BABYLON_EXIT.md` X2.5a because the offline page hosts the same core.
What stays here is the HOST: `Match` and `simulate` LOAD the world
(`world.ts`'s `loadSimWorld`), DRAW the round's seed (`freshSeed()`, or the
one `simulate` was given, or an owned match's owner chose) and ANCHOR the clock (`SimCore.anchor(Date.now())`
once `startRound` returns) — the three things the core does not do for itself,
because it reads no clock and no entropy. **`Match` VALIDATES and the core
DECIDES**: each accepted message is handed over as one `SimCommand`
(`SimCore.submit`), the core's event ring is drained after every call, and
`Match.relay` puts what it says on the wire — no rule (a pouch, the seat
policy, a spawn) lives in `Match`, and no claim gate in the core. Nothing in
`src/sim/` may import from this directory, and `scripts/check-babylon-free.mjs`
holds every file in it as it holds every file here.

## The one test

`npm run corecheck` (`corecheck.ts`, a fourth entry in
`vite.server.config.ts`) is the scoring and person rules asserted off the
core's drained events with no `Game` and no socket, then the same script
through a real `Match` behind a fake transport — the validated door — which must
leave the identical award and death list — and a match its OWNER drives
(`Match`'s `owned`, X2.5c C2) playing the benchmark's round as the offline page
plays it. It exits non-zero on any failed assertion and prints a pass list. `simulate` cannot do this: it seats nobody,
so a person's death, award or seat never happens in it.

## Why the two tsconfigs

`tsconfig.json` at the root pins `"types": []`, so the browser compile sees no
Node globals even though `@types/node` is now installed for this directory. That
is deliberate: without it, `setTimeout` in client code silently resolves to
Node's overload returning a `Timeout` object rather than a number, and
`process.env` typechecks in a file that will be served to a browser. `vite.config.ts`
used to get this guarantee from the absence of the package; now it gets it from
the empty `types` array, and the guarantee is the same one.

`server/tsconfig.json` opts back into `["node"]` and keeps `DOM` in `lib` — it
typechecks the whole of `../src` beside this directory, client and Babylon
types included (a simulation may still NAME a Babylon type with `import type`),
and Babylon's own types reference `HTMLCanvasElement` and
`WebGL2RenderingContext` throughout, so it cannot compile without them. That
the DOM types are *available* here does not mean a DOM exists at runtime; it
does not, and code in this directory must not reach for one.

Both are run by `npm run typecheck`. The project has no test suite and no linter,
so that command is the only automated gate there is — a server left out of it is
a server with no gate at all.

## Why the server is built through Vite

`npm run build:server` runs Vite's SSR build rather than `tsc` emitting to disk,
for two reasons that bite otherwise:

1. `TerrainField.ts` reads `import.meta.env.DEV`, which is a Vite substitution
   and `undefined` under bare Node.
2. `src/` imports without extensions, and a map's collision bake and floor are
   lazy `import()`s that become chunks of their own.

There used to be two more. `CelShader.ts` imported
`@babylonjs/core/Shaders/ShadersInclude/bonesDeclaration` with no file
extension, which bare Node could not resolve — the WGSL port deleted the last
of those and `scripts/check-deep-imports.mjs` fails the build on a new one. And
Babylon was 7 MB of which the server reached a fraction; the server reaches
none of it now.

`ws` and Node builtins stay external — they are runtime dependencies, not
things to inline.

## What must never happen here

- **No Babylon.** No engine, no scene, no mesh, no material — not even a
  `NullEngine`. A value import of `@babylonjs/core` anywhere on a path from
  this directory or `src/sim/` fails `npm run build` (`scripts/check-babylon-free.mjs`, which
  prints the chain). What draws belongs in a client VIEW beside its
  simulation (`CLAUDE.md`, "Ownership and wiring"), and a vector is
  `src/math`'s.
- **No canvas.** There is no DOM at runtime, so anything that reaches
  `src/world/textures.ts` (a `DynamicTexture`) would fail at construction —
  and would have to cross the gate above to get here.
- **No `MapBuilder`.** It builds meshes and reaches a texture through
  `floorMaterial`. The solid world is rebuilt as data from the baked boxes in
  `src/world/<map>/collision.ts` instead (`src/sim/simWorld.ts`) — see
  `scripts/bake-collision.mjs` for why that is sound.
- **No trusting a client.** A client reports where it is and what it shot; the
  server decides whether either is true.
- **No unbounded input.** Every socket costs a bounded amount of this process
  whether or not it ever becomes a player: a frame size, a handshake window, a
  per-address socket count and a per-peer message allowance. There is one core
  here and every match on the box shares it, so a new inbound path that can be
  driven at whatever rate a client likes is a new way to stall all of them.
  See `docs/multiplayer.md`.
