# Clustered lighting — take the light count out of the shader

> **NOT STARTED — proposed 2026-08-30. This is a plan, not a record.**
>
> Nothing in it has landed. The prerequisite in *The measurement protocol* is
> not met: `FINDINGS.md` 20 has the reference bank RED on an unmodified tree,
> and this is a change to the one shader every mesh in the game draws with.
>
> **It has a gate in the middle on purpose.** C1 and C2 are worth doing on
> their own evidence; C3 only happens if C2's measurement asks for it. Do not
> read the four steps as a commitment to all four.

## Context

`MAX_POINT_LIGHTS` is 16 (`src/shaders/CelShader.ts:129`) and every constraint
in `src/config/lighting.ts` is an apology for it. `muzzleBudgetPerFrame` is 4
and `muzzleMaxDistance` is 30 because, in that file's own words, "16 bots
firing at once would saturate all 16 and black out the village's own
lanterns." `LightingSystem`'s header states the same thing as an invariant a
level designer has to obey: fixtures "must be hand-placed SPATIALLY SPREAD",
because a cluster of small glows starves the lanterns that shape a room.

**That cap is not in the shader's arithmetic. It is in its BINDING.** The
lights arrive as uniform arrays in each material's LeftOver UBO
(`CelShader.ts:397-400`), and the comment under them explains why the bound has
to be a literal: Babylon resolves an array's size out of the preprocessor table
when it lays the UBO out, and a WGSL `const` is not in that table. So the
number is baked into **six UBO layouts** — the six defines are six layouts,
which `CelShader.ts`'s header already flags as the thing that makes a uniform
moved into or out of an `#ifdef` a per-variant change.

**And it is baked in three times, not once.** `CelShader`, `GrassShader`
(`:171-176`) and `WaterShader` (`:233-245`) each declare their own copy of the
same four uniforms and each loop them the same way, and three systems each keep
their own packed `Float32Array` triple to feed them — `CelShader.ts:1160`,
`GrassSystem.ts:118`, `WaterSystem.ts:89`. `GrassSystem`'s header says it
"shares the same 16 light slots" as a frame-order rule. Raising the cap today
means touching all three, in six UBO layouts, with the reference bank as the
only judge of whether the picture survived.

**The fix is already named in the tree.** `setPointLights`'s docstring
(`CelShader.ts:1865`) ends:

> What this does NOT save is the GL upload. `setArray3` bypasses Babylon's own
> value cache and re-pushes on every material bind regardless, which is a thing
> only a uniform buffer can fix.

That sentence is about a different problem — the per-bind upload — and the
restructuring it asks for is the same one that makes clustered lighting a
bolt-on. This plan is that restructuring, plus the cull it opens the door to.

## The justification, and what it is NOT

**This is a design-constraint removal, not a frame-rate fix, and the schedule
must not be defended by a frame-rate hope.** `FINDINGS.md` 17 measured this
frame as DRAW-CALL bound on WebGPU. Clustered lighting's usual prize is
per-pixel work on a fill-bound frame; that is not the frame we have. What C1
genuinely removes is CPU-side and modest:

| | today | after C1 |
| --- | --- | --- |
| setter calls a frame | **172** — 43 materials x 4 | 0 in the steady state |
| floats re-pushed per material bind | **113** | 0 |
| UBO layouts carrying the arrays | 6 | 0 |
| packed copies on the CPU | 3 | 1 |
| the cap | a literal in the preprocessor table | a texture height |

(The 172 is `setPointLights`'s own figure — "~112 numbers against 172 setter
calls" — and 43 x 4 is exactly it. The 113 is 112 floats plus `pointCount`.)

**What the game gets is the thing worth having**: every muzzle flash lights,
tracers could carry one, windows could, and a level designer stops laying
fixtures around a shader limit. `muzzleBudgetPerFrame`, `muzzleMaxDistance` and
the nearest-N sort in `LightingSystem.update` all become deletions.

## Three decisions taken up front

### The cel shader is NOT replaced by a Babylon material

The obvious way to get clustered lighting is to stop hand-writing WGSL and let
Babylon's material pipeline do the lighting. **It is a bad trade and it is not
close.** It costs the banding, the facet normal recovered from derivatives, the
fog and mist published through `setEnvironment`, and — the expensive one —
`CEL_PALETTE`, which is what lets `BlockMerge` collapse a 48 m block to one
mesh instead of ten. `FINDINGS.md` 18 is that entire argument. The look is the
game; the lighting plumbing under it is not.

### We write the compute pass; we do NOT use `ClusteredLightContainer`

Babylon 9's `ClusteredLightContainer` (`Lights/Clustered/`) is a `Light`
subclass that feeds Babylon materials through `transferToEffect`,
`transferTexturesToEffect` and `prepareLightSpecificDefines` — none of which a
`ShaderMaterial` of ours goes through. Its `_lightDataTexture`,
`_tileMaskTexture`, `_tileMaskBuffer` and `_updateBatches` are private or
`@internal`, so using it means reaching into internals that carry no
compatibility promise and re-breaking on every Babylon bump. We have WebGPU as
a hard requirement and `Atmosphere.ts` as the precedent for a compute shader;
sphere-versus-tile for a few hundred lights is a small kernel.

### …but we copy its LAYOUT exactly

Byte-compatible with `ClusteredLightContainer`, so that if Babylon ever makes
those fields public, our half drops out and nothing in the shader moves. The
layout is public shader text even though the container is not — read it in
`ShadersWGSL/ShadersInclude/lightUboDeclaration.js:36`,
`clusteredLightingFunctions.js` and `clusteredLightingCompute.js`:

```wgsl
var lightDataTexture: texture_2d<f32>;            // no sampler — textureLoad only
var<storage, read> tileMaskBuffer: array<u32>;    // C3 only
```

The light data is a **5-wide x N-tall RGBA32F texture**, five `vec4f` per light
(`vLightData`, `vLightDiffuse`, `vLightSpecular`, `vLightDirection`,
`vLightFalloff`), fetched with `textureLoad`. Our data — position, colour
premultiplied by intensity, range — fills two of the five columns. **Keep the
other three empty rather than packing tighter**: they are what makes the
compatibility claim above true, and three unwritten texels per light is
nothing.

**Two details that matter for THIS tree.**

- **It is sampler-less, and that is a feature here.** `textureProcessor` in
  `webgpuShaderProcessorsWGSL` handles a texture binding independently of
  `samplerProcessor`, and Babylon's own PBR path declares it exactly this way.
  So it sidesteps `CelShader.ts`'s "a sampler a variant DECLARES has to be
  BOUND, used or not" trap outright — no `celShadow`-style arrangement where
  `CEL_INK` binds a shadow map it never reads.
- **The include is named `celClusteredLights`, not
  `clusteredLightingFunctions`.** `Lights/Clustered/index.js` registers that
  bare name and we import the barrel, so `wgsl/includes.ts`'s `register()`
  would throw on it — which is the `cel` prefix rule doing precisely what its
  header says it is for. It also means the fifteen lines are written out by
  hand rather than imported, which keeps `check-deep-imports.mjs` satisfied
  for free.

## The steps

### C1 — the lights become a texture, and the cap does not move

Replace the four uniforms in all three shader families with one sampler-less
`lightDataTexture` and the `celClusteredLights` include. `LightingSystem` owns
one `RawTexture`, writes it once a frame, and the three systems stop keeping
packed arrays of their own. `setTexture` happens **when a material is created**,
not per frame — which is the existing rule that a new material is seeded with
every piece of shared state on the spot.

**The loop stays at 16 and the selection stays nearest-N.** C1 changes where
the numbers come from and nothing about which numbers they are, so the picture
is provably unchanged and the reference bank is a real gate on it. That is the
whole reason this is a step of its own.

Landing C1 alone collects the table above, deletes 113 floats x 6 layouts from
the UBOs, and leaves `MAX_POINT_LIGHTS` as an ordinary TypeScript number with
no preprocessor coupling left.

### C2 — raise the cap and measure. **This is the gate.**

With the binding gone, 64 or 128 lights is a texture height and a loop bound.
Do that, put lights on things that cannot have one today (every muzzle flash,
unbudgeted; the tracers; the lit windows), and measure on the Windows box on
Coldharbour and Sarab.

**A brute-force loop over 64 lights may simply not show up on a draw-call-bound
frame.** If it does not, C3 is work we do not need and this plan ends here with
the constraint removed. If it does, C2's numbers are what C3 is budgeted
against — and they are numbers we do not have today, because nothing has ever
been able to ask the question.

### C3 — the tile cull, if C2 asks for it

Copy the mechanism from `clusteredLightingCompute`, which is smarter than a
plain tile grid and worth understanding before reimplementing:

- lights are **sorted by view depth**, and each depth slice carries a
  contiguous `sliceRange: vec2u` into that sorted list — which is why the mask
  stays small, since a tile only needs bits for the lights in its slice's
  range;
- the tile mask is a **bitmask, 32 lights per `u32`**, indexed
  `(tile.x * maskRes.x + tile.y) * maskRes.y + batch`;
- the fragment walks set bits with `extractBits` and `firstTrailingBit`, so a
  pixel iterates only the lights that actually reach it.

Our compute pass produces the same two resources. `getClusteredSliceIndex` is
four lines and comes across with the rest.

### C4 — spend it

`muzzleBudgetPerFrame`, `muzzleMaxDistance` and `Game.spendMuzzleLightBudget`
are deleted, along with the nearest-N sort in `LightingSystem.update` and the
"hand-placed SPATIALLY SPREAD" invariant in its header. `docs/rendering.md`'s
four light terms and `CLAUDE.md`'s "packed array of up to `MAX_POINT_LIGHTS`
(16) point lights" both need rewriting; the sentence that must survive is the
one that says adding a Babylon `PointLight` still does nothing to a cel-shaded
mesh, because that stays true.

## What this plan does not fix

- **The frame rate.** See *The justification*. If C2 comes back showing a real
  per-pixel cost that C3 removes, that is a saving against a cost this plan
  introduced, not against today's frame.
- **The draw-call wall.** `FINDINGS.md` 17's three levers are untouched. This
  changes what a pixel does, not how many times the CPU asks for a draw.
- **The glow layer.** `FINDINGS.md` 3 is a separate mechanism and shares
  nothing with this.
- **The BAND, which is the open art question.** The point term is quantised —
  `band(ndl, 3.0)` with a lifted floor at `CelShader.ts:611-622` — and a hard
  three-band falloff is a LOOK at three overlapping lights and a wash at
  thirty. **The light-count ceiling may be partly an art constraint wearing a
  shader constraint's clothes.** C2 is where that gets found out, and the
  honest possible outcome is that the game wants forty lights and a better
  selection rather than four hundred. Nothing in C1 is wasted if so.

## The measurement protocol

**Settle `FINDINGS.md` 20 first.** `bank.mjs --check` currently fails on all
fifteen vantages of all four maps on the tree that took the bank, cause
unlocated. The only usable form is differential — run `--check` either side of a
change and require the same means — and that is nearly worthless for C2 and C3,
which move the picture on purpose. C1 is the one step a differential check
genuinely grades, because C1 is defined as not moving the picture.

Settling it is cheap and is written down in that finding: record the Chromium
build and driver version in `mode.json` (neither is there today), re-take on
the current machine state, and diff bank against bank tile by tile. A uniform
sub-LSB shift is the backend; concentration on the water and the glazing is a
third unpinned clock and belongs in `freeze`.

Per step:

- **C1** — `bank.mjs --check` must come back with the same means as the tree
  before it, on all fifteen vantages. A cel change that alters no arithmetic is
  the one case the bank grades cleanly even in its current state. Plus
  `npm run typecheck` and `npm run build`.
- **C2** — frame time on the Windows box, Coldharbour and Sarab, at 16 / 64 /
  128 lights with the same camera path, **read after the first three seconds**
  (`FINDINGS.md` 16: anything earlier is the pipeline compiler). A vantage bank
  is not the instrument here; the frame clock is.
- **C3** — C2's numbers, re-taken. Plus a vantage sweep WALKING rather than a
  bank of stills, for the reason `FINDINGS.md` 3's reverted attempt gives: a
  pose bank chosen to catch a shader going wrong cannot show a per-tile
  selection going wrong.
- **No parity or collision run is owed by any step.** Nothing here is in the
  world layer, and the authority has no lights.

## Key decisions worth keeping even if this is never built

1. **The cap was a BINDING, not arithmetic.** Everything that reads like a
   lighting-design decision in `config/lighting.ts` traces back to Babylon's
   UBO layout needing a literal array bound.
2. **A sampler-less `texture_2d<f32>` read with `textureLoad` is the cheapest
   way to get a variable-length array into one of our materials**, and it is
   how Babylon does it too. Whatever else ever needs an unbounded per-frame
   table — decals, wind sources, pushers — this is the shape.
3. **Copying a layout is not the same as depending on an API.** The container
   is private; its shader text is not. Matching the private thing's format
   costs nothing and buys a future exit.
