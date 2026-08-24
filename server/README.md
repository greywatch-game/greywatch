# server/

The authoritative multiplayer server. Runs the same simulation the game does —
`BattleSystem`, `ConquestSystem`, `CombatSystem` — under Babylon's `NullEngine`,
with no window, no GL and no rendering.

Read [`docs/multiplayer.md`](../docs/multiplayer.md) before changing anything in
here. What follows is only the shape of the directory.

## Why the two tsconfigs

`tsconfig.json` at the root pins `"types": []`, so the browser compile sees no
Node globals even though `@types/node` is now installed for this directory. That
is deliberate: without it, `setTimeout` in client code silently resolves to
Node's overload returning a `Timeout` object rather than a number, and
`process.env` typechecks in a file that will be served to a browser. `vite.config.ts`
used to get this guarantee from the absence of the package; now it gets it from
the empty `types` array, and the guarantee is the same one.

`server/tsconfig.json` opts back into `["node"]` and keeps `DOM` in `lib` —
Babylon's own types reference `HTMLCanvasElement` and `WebGL2RenderingContext`
throughout, so the server cannot compile without them. That the DOM types are
*available* here does not mean a DOM exists at runtime; it does not, and code in
this directory must not reach for one.

Both are run by `npm run typecheck`. The project has no test suite and no linter,
so that command is the only automated gate there is — a server left out of it is
a server with no gate at all.

## Why the server is built through Vite

`npm run build:server` runs Vite's SSR build rather than `tsc` emitting to disk,
for three reasons that all bite otherwise:

1. `CelShader.ts` imports `@babylonjs/core/Shaders/ShadersInclude/bonesDeclaration`
   with no file extension. `@babylonjs/core` declares no `exports` map, so Node
   resolves that as a literal path and fails. Vite resolves it.
2. `TerrainField.ts` reads `import.meta.env.DEV`, which is a Vite substitution
   and `undefined` under bare Node.
3. Babylon is 7 MB and the server uses a fraction of it; the SSR build
   tree-shakes what is actually reachable.

`ws` and Node builtins stay external — they are runtime dependencies, not
things to inline.

## What must never happen here

- **No canvas.** `DynamicTexture.getContext()` throws `OffscreenCanvas is not
  defined` under `NullEngine`, and `GPUParticleSystem.IsSupported` is false. Any
  import path that reaches `src/world/textures.ts` or `BlastDust` will fail at
  construction, not at first use.
- **No `MapBuilder`.** It reaches a texture through `floorMaterial`. The solid
  world is rebuilt from the baked boxes in `src/world/<map>/collision.ts`
  instead — see `scripts/bake-collision.mjs` for why that is sound.
- **No trusting a client.** A client reports where it is and what it shot; the
  server decides whether either is true.
- **No unbounded input.** Every socket costs a bounded amount of this process
  whether or not it ever becomes a player: a frame size, a handshake window, a
  per-address socket count and a per-peer message allowance. There is one core
  here and every match on the box shares it, so a new inbound path that can be
  driven at whatever rate a client likes is a new way to stall all of them.
  See `docs/multiplayer.md`.
