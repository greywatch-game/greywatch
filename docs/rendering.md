# Rendering: lights, fog, ink and the sky

The four light terms and the sixteen slots, the three passes that owe their own
fog, the constraints that look like bugs if you undo them, how much of the map the
frame is allowed to walk, and the painted sky. Split out of
[`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the contract
for `LightingSystem`, `ShadowSystem`, `CelMaterialFactory`, `WorldCulling`, the
shaders and `Sky`.

## The scene has (almost) no Babylon lights

Cel materials carry their own `lightDir`/`lightColor`/`ambientColor`/
`skyLightColor` and a packed array of up to `MAX_POINT_LIGHTS` (16) point lights as
uniforms; `LightingSystem` is the sole owner of dynamic light and uploads the
winning slots via `CelMaterialFactory.setPointLights()` once per frame. Adding a
`PointLight`/`HemisphericLight` to the scene will not affect any cel-shaded mesh.
Effect meshes (tracers, sparks, neon, reticles) use unlit emissive
`StandardMaterial`s from `mats.getEmissive()` and are unaffected by lighting.

**A fixture's flicker PHASE is SEEDED, and the reason is a picture rather than
a simulation.** `LightingSystem` draws each phase from `FLICKER_SEED`'s stream
— re-seeded in `clear`, so a phase is a function of the map and the fixture's
place in the layout rather than of how many rooms the process has already
built. Nobody can tell one lantern's flame from the same lantern's flame a boot
earlier, so this buys nothing in play; what it buys is that a FROZEN frame can
be reproduced. The phase is the one term in a lit frame that pinning the clock
cannot reach, and while it was `Math.random()` two boots of the same village
lit the same lamp to two different intensities — measured across two processes
with every clock, uniform and camera provably identical, up to 1.0/255 mean
channel error over a lamp-lit street, which is over any tolerance a reference
set is worth checking against. It is the same rule `world/rng.ts` already
states for scatter, kept for a different reason.

**Nothing drawn outside the cel shader gets fog for free, and everything that
draws outside it owes the same fade.** The fog is a uniform on the cel materials
and a per-pixel `mix` in their fragment shader; **three** passes never run it.
Babylon's outline renderer writes `outlineColor` flat (its whole fragment shader
is `fragmentOutputs.color = uniforms.color`), the glow builds its bloom from a material's
emissive colour, which says nothing about where the mesh stands, and
`getEmissive()`'s unlit `StandardMaterial` — every lit window, flame, ember,
tracer, spark and team-colour bar — draws a flat colour with lighting disabled.
All three take their fog from the one published by
`CelMaterialFactory.setEnvironment`, so nothing can describe different weather
from the wall it hangs in front of — but they take it at **different
granularities, and the difference is forced**:

- **The INK fades per PIXEL, and it gets that for free.** `shaders/CelInk.ts`
  is a full-screen pass over the depth buffer, so it has the distance to every
  pixel in hand and evaluates the cel shader's own `t * t` curve exactly, over
  the MAP's fog band. **Roughly 230 lines stood here and every one of them was
  about the hull this replaced**, which could do neither: `OutlineRenderer`
  hardcodes its `uniformsNames`, so the fade could not be a uniform at all and
  `OutlineFog` had to recover the distance from the rows of `viewProjection` and
  BAKE the fog colour and range in as literals — which meant re-baking on every
  environment change, which meant making Babylon forget compiled programs, which
  was the only place in this tree that touched the compiled-effect cache and
  carried three separate hard-won rules about ref-counting draw wrappers. It is
  all deleted. The per-mesh half went with it: `BlockMerge` gives one mesh per
  48 m block and 50 of Greyfen's 687 outlined meshes spanned the ENTIRE fog band,
  so a per-mesh ink fade left the far half of a block in clear ink over a wall
  that had already gone; `updateOutlineScales` thinned the WIDTH to paper over
  that, and a line of un-fogged ink is as visible thin as thick.
- **The bloom fades per MESH**, through `fogAmountAt` in
  `glow.customEmissiveColorSelector`. The glow map is generated from a material's
  emissive colour with no per-pixel hook at all, and it is affordable here where
  it was not for the ink: a bloom is a soft blob with no edge to misplace, and
  only 4 of 290 emissive meshes span more than half the fog band.
- **The emissive material fades per PIXEL**, through a `MaterialPluginBase` in
  `src/shaders/EmissiveFog.ts` that injects the same curve at
  `CUSTOM_FRAGMENT_MAIN_END`. A plugin *can* declare real uniforms, so
  `setEmissiveFog` is a buffer write and needs no cache invalidation.
  Distance is `vPositionW` against `vEyePosition`, both unconditional in
  `default.fragment`.

That this was invisible for a whole map is the point: on Hollowmere unfogged ink
is near-black against near-black fog and an unfogged glow reads as a lamp doing
its job. **A bright fog is what makes an un-attenuated pass obvious**, and
Greyfen showed it — six chapel windows that were three saturated cyan bars on a
wall faded almost to white, and a cottage window measured at 77.6 m, inside a
`fogEnd` of 78, coming back rgb(249,177,92) against its own `#ffb257` over a fog
of rgb(194,204,212). **Fading the bloom is not fading the thing**: the selector
dimmed the halo around that bar and left the bar. With the plugin the same pixel
reads rgb(196,204,210).

**The three obvious cheaper fixes for the emissive pass are all wrong, and the
first one is the trap.** `scene.fogMode` would have been one line —
`StandardMaterial` has fog built in — but Babylon's is linear/exp over VIEW-SPACE
z where the cel shader's is `t*t` over the RADIAL distance, so a window over-fogs
against its own wall through the whole middle of the band and disagrees by up to
1.4x at the corners; it is also scene-wide, so the sky dome would need opting out
by hand. A `ShaderMaterial` of our own loses `material.emissiveColor`, which is
what the glow's mask reads to decide what blooms — every lantern, tracer, visor
and reticle in the game stops glowing.

**THE INK'S TINT NEEDS NO DERIVATION NOW, AND THAT IS THE OTHER HALF OF WHAT
WENT.** The hull's ink was UNLIT — `albedo * tint` with no light term at all —
laid over a surface that was `albedo * light`, so a constant tint inverted into a
bright HALO the moment the light fell under it, and it flipped with the SHADOW
rather than with distance: on Greyfen a trunk in the sun was outlined in ink and
the same trunk two steps into the canopy's shade was outlined in something twice
as bright as itself. What that cost was a per-map, per-CHANNEL derivation from
`ambient * (1 - CONFIG.ao.strength)` — the darkest light the shader can put on
any pixel — with a headroom factor for the albedo weathering on top, plus a
`fallbackColor` bound for the textured materials that have no albedo to recover,
plus a re-ink of every registered mesh whenever a map changed. `CelInk`
multiplies the pixel that is ALREADY THERE, lit, shadowed, fogged and weathered,
so it is under the light term as arithmetic and cannot invert whatever a map
does. `CONFIG.graphics.ink.tint` is a constant again.

**What is left LIGHT after all of that is the fog, and it is meant to be.**
Past the fog wall the ink IS `fogColor` — pale green on Greyfen, cream on
Harrowmead — and the surface it outlines is that same colour, because they
dissolve on one curve. A silhouette against the SKY is where that reads as a
bright line, the sky being the one thing in the frame the world's fog never
touches; the object behind the line is equally pale, so the line is not brighter
than what it belongs to.

**A fifth term modifies two of the four, and it arrives as a VERTEX ATTRIBUTE
rather than a uniform.** `world/vertexShading.ts` bakes per-vertex ambient
occlusion once per map build, out of the collider boxes `MapBuilder.collider()
already records plus the terrain under them, and the cel shader multiplies it
into the flat ambient and the sky fill — **not** the key light, which the shadow
map already owns, and **not** the point lights, for the same reason those ignore
the shadow map: a lantern in a doorway has to light the doorway.

Six rules about it, and the first is the one everything else rests on:

- **Occlusion lives in the colour buffer's ALPHA, and 1 means unoccluded.** A
  mesh with no colour buffer leaves that attrib array disabled, and a disabled
  generic attrib reads `(0, 0, 0, 1)` — verified in
  `ThinEngine._bindVertexBuffersAttributes`, which `continue`s past a missing
  buffer after `unbindAllAttributes()`. Alpha therefore defaults to exactly the
  neutral value, so the pooled bot rigs, the viewmodel's meshes, the grenades and
  the death cam's stand-in body are all correct **without carrying a buffer at
  all** — no define and no branch. RGB defaults to 0, which is
  not neutral for a multiplier, which is why the green channel is used as a
  *mask* (1 on baked world geometry) rather than as a second multiplier.
- **The bake runs AFTER every merge, and cannot be moved earlier.**
  `VertexData.merge` throws `"Cannot merge vertex data that do not have the same
  set of attributes"` the moment one mesh in a group carries `colors` and another
  does not, and `mergeByMaterial`'s `disposeSource = true` is what turns
  Babylon's attribute-aligning path off. Baking last also makes a positional
  estimate legitimate: two meshes meeting at a corner are in different merge
  groups (the merge is per colour), and shading a vertex from where it *is*
  rather than from what it belongs to is what makes the two sides agree.
- **The BLUE channel is the one that is SIGNED, and nothing may clamp it in the
  walk.** It carries the WEAR ramp as a straight line through 1 at a footing and
  0 at `CONFIG.wear.height`, and it goes negative above that on purpose. A box
  part has eight corners and no vertical subdivision, so a wall's only samples
  are its footing and its eaves and the rasteriser joins them with a straight
  line whatever is written there — which means a curve baked in the walk is not
  the curve it was written as (on a 3 m wall, head height still carried 0.47 of
  full grime, and the term read as a building that is a bit darker rather than
  one with dirt on it), and a bottom clamp at the eaves drags the stain's top
  edge up to the eaves with it. Height above ground is itself linear up a
  vertical face, so the LINE interpolates exactly. `CONFIG.wear.falloff` is a
  uniform, spent per fragment, and so is the grain that breaks the line's edge.
  The neutral default survives it: 0 is the TOP of the ramp, which is clean.
- **The same channel says INSIDE from OUTSIDE, and the probe that decides it is
  sized against the worst EAVES in the kit.** Splash-back and rising damp are
  weather, and a height ramp has no opinion about which side of a wall it is
  looking at — a wall box's two faces are the same four corners with opposite
  normals, so the term climbed the inside of every enterable building exactly as
  it climbed the street front. So a vertex whose ramp is still live steps
  `CONFIG.wear.shelterProbe` out along its own **normal** and asks whether any
  collider box stands over that spot with its underside clear of
  `CONFIG.wear.shelterCover` above the ground; a sheltered one is written 0.
  The step is what makes it work and it is the part that is easy to get wrong:
  a vertex asking about its own xz is under its own building's roof collider
  from either side of the wall. **0.6 m is not enough.** It clears a cottage's
  `gableRoof` (0.35 of overhang, 0.18 past the face once the wall's half
  thickness comes off) and falls 25 mm short of a JETTIED townhouse, whose roof
  rides the oversailing upper storey and reaches 0.63 m out over the ground
  floor — measured on Hollowmere, that took the grime off the whole ground
  floor of every townhouse in the village, one clean facade on the square
  between two dirty neighbours, and it cost 3.2% of the lanterns vantage's
  pixels against 0.53% at the shipped 1.2 m. What bounds the probe above is the
  shallowest room in the kit (6 m deep, so 2.8 m of cover in front of a wall's
  inner face) and `CONFIG.ao.radius`, whose `pad` the index was built with.
  **Two things keep the channel safe to interpolate**: cover must clear the
  VERTEX as well as the ground, so shelter is monotone in height and a face can
  go from a dirty footing to a clean top but never the other way; and the probe
  is skipped wherever the line has already gone negative, which is both the
  conservative direction (writing 0 over a negative would RAISE it, and 1 at a
  footing against 0 at the eaves is grime up the whole wall) and where the cost
  goes — every vertex above `wear.height` pays nothing, and the probe does not
  show up over the bake's own run-to-run noise on either the smallest map or
  the biggest.
- **`hasVertexAlpha` must stay false.** `setVerticesData` does not set it, and
  the world is opaque — the alpha here is a lighting term, not a transparency.
- **Only a CEL-SHADED mesh may be given the buffer**, and `visuals` is not all
  cel materials. The cel shader reads a colour buffer as a lighting term;
  `StandardMaterial` reads it as a *colour* and multiplies its output by it,
  with `Mesh.useVertexColors` defaulting to true and nothing but the buffer's
  absence to turn the `VERTEXCOLOR` define off. `mergeByMaterial` emits one mesh
  per material, so every lit window, brazier flame, ember and sign arrives in
  `visuals` as a `block<x>,<y>-emissive-#rrggbb` drawn with an unlit emissive
  `StandardMaterial` — 42 of them on Hollowmere. Baking `rgb = (0, 1, 0)` onto
  those multiplied each one by pure green, so the village's lanterns and fires
  rendered as green blobs *inside their own correctly-coloured bloom*, since the
  glow builds its halo from `material.emissiveColor` and never saw the
  vertex buffer. `walk` skips anything whose material is not a `ShaderMaterial`.

The same buffer's green channel gates the cel shader's **albedo weathering**, a
slow value-noise drift over world position that stops a 48 m merged block
arriving as one flat tone. It is keyed on position rather than on anything
per-object because that survives the merge for free — and it is gated because a
world-keyed term on a *moving* mesh makes it shimmer as it walks.

### Frozen materials: the define set is the material's, not the mesh's

**Every material `CelMaterialFactory` hands out is frozen, and `remember` is
the one door into the cache** — the six creation paths all file through it, so
no future seventh can leave one unfrozen by omission. `createGrassMaterial` and
the water's factory freeze on the same argument at their single return.

**What freezing skips is the ASKING, not the answer.**
`ShaderMaterial.isReady` is called for every submesh of every draw — in the
main pass, and again in the shadow pass — and before it can answer it rebuilds
the material's whole define set from scratch: a `defines` array, an `attribs`
array, a `#define ...` string per entry (several of them built with template
literals) and a `join` over the lot. It then compares that string to the one
already sitting on the draw wrapper, finds them equal, and discards all of it.
For a material whose defines are fixed at construction — which is every
material in this tree — the answer is the same string every frame for the life
of the material. Measured with Chrome's sampling heap profiler, that walk is
**a fifth of everything this game allocates**: the `join` alone is 9.0% at 19 kB
a frame, with `isReady`'s own body another 7.5% on top.

`Material.isFrozen` is read at the top of `isReady` and returns the cached
verdict when the draw wrapper already holds a ready effect. That is the whole
mechanism.

**It does not stop uniforms, and that is the thing to check rather than
assume.** What gates the uniform push in `ShaderMaterial.bind` is
`_mustRebind`, which is `subMesh._drawWrapper._forceRebindOnNextCall ||
scene.isCachedMaterialInvalid(...)` and does not consult `isFrozen` anywhere.
So the light array, the fog, the eye, the palette and the wind keep flowing
exactly as before — `updateWind` and `updateCamera` walk this same cache every
frame and were unaffected. The only other `isFrozen` read on the bind path
guards morph-target influences and baked vertex animation, and this game has
neither: the soldier rig is `TransformNode` joints driving separate meshes, not
GPU skinning.

**Why it cannot pin the wrong effect, and what would break that.** The defines
`isReady` rebuilds are not constant across meshes — they vary on exactly four
counts, all of them read off the mesh rather than the material:

| what varies | the define it adds |
| --- | --- |
| a vertex `color` buffer on the mesh | `VERTEXCOLOR` |
| instancing / thin instances | `INSTANCES`, `THIN_INSTANCES`, `INSTANCESCOLOR` |
| bones (`useBones && computeBonesUsingShaders && skeleton`) | `NUM_BONE_INFLUENCERS`, `BONETEXTURE` / `BonesPerMesh` |
| morph targets | the influencer count |

These materials do **not** store their effect per submesh, so one draw wrapper
serves every mesh wearing the material. A material worn by two meshes that
disagreed about any row above would, frozen, hand the second mesh the effect
the first compiled — a silently wrong draw rather than a crash. It is safe here
because the cache key is already fine enough that this never happens: measured
over every `ShaderMaterial` in the scene on the four big maps, **0 of 35 / 113
/ 95 / 83 were worn across a disagreement**. That is a property of the KEYING
and nothing enforces it, so **widening a cache key owes that measurement
again.** The vertex-colour row is the live one — the world carries a colour
buffer and the rigs, the viewmodel and the effect meshes carry none, so a key
that let a world material reach a rig would break it.

**Freezing at creation is deliberate.** The fast path also requires the wrapper
to have been ready at least once, so a material frozen before its first compile
simply falls through to the full path until it has an effect — which means
there is no "freeze once warm" moment to find, and no state to get wrong. It
also means a pass this material has never been drawn in (a probe's first bake,
the shadow map's first frame) compiles normally.

**What it bought is ALLOCATION and not frame rate**, and the distinction is
worth keeping straight: A/B'd in one session with the freeze toggled every six
seconds, allocation fell 18–25% on every map, while frame rate over the same
paired windows stayed inside the noise (Sarab, re-measured at the real viewport
with a real roster: −0.8% over five paired reps). **Do not quote a frame-rate
number for this from `gate.mjs`** — cross-session runs on this box differ by up
to 45% for no reason, and an earlier version of this paragraph did exactly that
and was wrong (`FINDINGS.md` 36 carries the warning and `installMs` is the
control that catches it). **The picture is byte-identical** — `bank.mjs
--check` over 21 vantages on all six maps, 0% of pixels differing, against a
reproducibility floor of 0.000%.

`FINDINGS.md` 36 carries the numbers and 1 carries what the allocation was
costing in the first place.

## The irradiance volume: bounce light, sky occlusion, lamps that stop at walls

`systems/GiVolume.ts` owns it and `shaders/wgsl/giTrace.ts` holds the three
compute passes; the cel fragment reads it through the `celGi` include. It is the
answer to "what would Lumen do here", and the answer is **not a port of
Lumen**, for three reasons that decided the whole shape of it:

- **There is no ray-tracing hardware in a browser**, and the phones this game
  installs onto run desktop GPU work at ~2.4x the cost (`FINDINGS.md` 43).
- **Lumen's artefacts are the ones this look forbids.** Per-frame random rays
  accumulated over time are light that CRAWLS while it converges — a clock you
  can see — and a continuous per-pixel indirect term reads as another game's
  renderer.
- **What makes Lumen affordable is a scene the GPU can trace that is far cheaper
  than the one it draws — and this game already has one.** Every surface a
  round can stop on is a box in `colliderBoxes` or the heightfield, which is
  what `RayWorld` answers every ray on the CPU off. The trace is that query
  ported to WGSL: the same 8 m uniform grid, the same oriented-box slab test
  (`RayWorld.boxCast` to the letter, far face and all), the same floor. Nothing
  mesh-shaped is ever traced, and the volume's idea of where the walls are is
  the game's.

### What it is

A grid of probes `columns` x `columns` across (a camera-centred WINDOW that
scrolls with the eye, 192 m on `high` and on every map whatever its size) and
`layers` up from the GROUND — a probe stands `(k + 0.5) * layerHeight` above
its own column's floor, so a hillside and a harbour spend the same probes on the
air people stand in. Each probe holds the light arriving there as **order-1
spherical harmonics with the colour in the constant band and the DIRECTION in
the linear band of luminance alone**: all a banded surface can show, and half
the storage of three linear bands. Seven 3D textures carry it to the fragment:
irradiance (with the column's floor in alpha), direction (with the probe's
validity in w), an aux of sun and sky visibility, and four of point-light
visibility.

**The window is addressed TOROIDALLY** — world column `c` lives in texel
`c mod columns` — and the sampler REPEATS on both horizontal axes, so the
hardware's own trilinear filter is correct across the seam and scrolling costs
nothing but a uniform. The pair of columns either side of the window's own edge
are the newest and the oldest and are never read: the outer `edgeFade` of the
window ramps back to the flat path first.

**What is stored is premultiplied by each probe's validity** — 0 for a probe
buried in a wall that the trace could not move out of, or one not yet traced
for the column it now stands for — so dividing by the filtered weight averages
only the valid probes among the eight. That is what keeps a buried probe from
printing a dark halo on the face of the wall it is buried in, with no second
fetch and no mask.

### The three passes

- **trace** — one WORKGROUP per probe, one thread per ray, re-tracing a rolling
  slice of the window every frame (`probesPerFrame`). A ray finds what it hits;
  the hit is lit by the sun (a shadow ray), by ONE of the steady fixtures that
  reach it (see below), and by the volume itself at that point — last frame's
  answer, which is what makes the bounce multi-bounce. A ray that escapes takes
  the sky: the map's flat ambient as a uniform dome plus its sky fill as a lobe
  from overhead, normalised so a surface facing straight up under an open sky
  receives exactly what the flat path gives it. The workgroup reduces its rays
  to the probe's harmonics.
- **compose** — one thread per probe, every frame: the probe's history plus
  the FAST layer, out to the textures.
- **vis** — one thread per probe, every frame: which lights holding a slot
  each probe can see.

Three rather than one because a WebGPU stage may write at most four storage
textures (compose writes three, vis four) and because trace's shape — a probe
per workgroup — is the wrong one for the other two.

### Why it holds still, and why the blend is 1

**Every probe is traced with the SAME ray set every time** — a fixed spherical
Fibonacci set, where DDGI rotates its rays randomly per frame. So a re-trace of
an unchanged scene returns the same answer, and there is no noise for a history
to average. `CONFIG.gi.blend` is therefore **1**, and the history exists only as
the state buffer the compose reads. It was 0.25 first, DDGI-style, and what that
bought was slowness rather than smoothness: a probe is re-traced once per
sweep, so three sweeps in it was still 42% short, measured as **5-13% of a
FROZEN frame's pixels still moving, by up to 52/255**, several seconds after a
map had "converged". At 1 the only thing left moving is the multi-bounce
iteration, which shrinks by the albedo every sweep. Measured on a frozen frame
with the GI-off control byte-identical: Hollowmere 0.005% of pixels at 1/255;
Sarab 0.08% at up to 13/255 four seconds in, and **0.0075% at 1/255** ten
seconds later. That residue is a half-float settling, not a cycle.

**The rolling cursor walks a PERMUTATION of the window** (`* 7919 mod total`,
coprime to every tier's probe count), because in order a change in the light —
a pane broken, a lamp lit — reaches the picture as a line sweeping across the
map. Scattered, it arrives as a dissolve of 2 m probes over a sweep.

### Two layers, split by how FAST a light changes

A light that changes faster than a sweep would be averaged into nothing by the
rolling trace — which at blend 1 means it would reach the picture as whatever
it was doing when each probe happened to be traced: a muzzle flash frozen into
a scatter of probes for a second. So lights are split by RATE, never by kind:

- **Slow** — the sun, the sky, and every steady fixture (`RoomLight.fast`
  false) at its BASE intensity. Traced on the rolling budget.
- **Fast** — every transient pulse (muzzle flashes, blasts), every carried
  light (the player's lamp, the kit bench), anything registered with
  `LightingSystem.add(..., fast = true)`, and the FLICKER of the steady fires
  within `flickerReach` of the eye, as the difference from their base (which
  the slow layer already carries). Re-bounced from scratch every frame in
  compose and never remembered, so the bounce rises and dies exactly with the
  light's own envelope. Clustered (`fastCluster`), so a spreading fire costs
  one fast light however many emitters it has, and capped (`fastLights`).

**A thrown fire needs nothing new here**: register its emitters `fast` and
they bounce. A flash is the world answering a shot, not motion that drives
itself, so it passes the look's rule where a crawl does not.

### Point lights that stop at walls, and why a channel follows a LIGHT

The cel shader's point lights ignored everything between them and a surface;
`giPointVis` multiplies each by the volume's answer to "can this light see
here". **The answer is kept per CHANNEL, and a channel belongs to a light for
as long as it holds a slot** (`GiVolume.assignChannels`; the shader reads
`giSlotChannel` to find it). Per SLOT it was 0.85 ms of GPU on Coldharbour,
because `LightingSystem` orders its slots transients first — one muzzle flash
shifts every lantern down a slot, and every slot's answer had to be re-traced
every frame. Per channel, a lantern is traced once, on the frame it wins a
slot; a light is re-traced only when it is new or has MOVED (the carried lamp,
every frame it walks), and a probe re-traces every channel only when its own
position is new. Each probe keeps its mask in a buffer between frames for that.

A visibility ray stops `lightClearance` short of the light, because fixtures
stand IN their own props — a fire drum's flame is inside the drum's collider,
and a ray that found the prop would black out the light it belongs to.

**It is RIGHT that a light inside a solid lights nothing.** The first staged
test of this put a blast at a point that turned out to be inside a collider:
GI-off lit the chapel and every headstone through it, GI-high lit nothing, and
it read as a bug for exactly as long as it took to test the point. Re-staged in
open air, verified outside every box and in view of the camera, the two agree
everywhere but where something genuinely stands between.

### The steady fixtures: one per hit, not all of them

A bounce ray landing near several lanterns lights its hit with ONE of the ones
that reach it, chosen by the ray's own index and weighted by how many there
were — one visibility ray per hit however dense the village. It is a function
of the ray and nothing else, so the average over a probe's rays is the same
every update and the fixed point survives.

### How it reaches the frame

Where the volume has an answer it REPLACES the flat ambient and the sky fill
rather than adding to them — those were always a stand-in for exactly this
light. **Its LUMINANCE is banded and its HUE is not** (`giBandOpen`, steps of the
unoccluded sky's own brightness, allowed past it up to `bandSpan` so a sunlit
wall's bounce steps up rather than clipping), which is what lets colour bleed
exist in a cel frame without a smooth wash. The map's flat ambient survives
underneath as a FLOOR (`floor`, the painter's "how black does the unlit side
go"), and the baked vertex AO is kept at a share (`aoKeep`) for occlusion finer
than the volume's spacing. Every pixel reads the volume stepped half a spacing
along its TRUE facet normal, for the shadow offset's reason.

**Past the shadow map's own window, the probes' sun test takes over**
(`giFarShadow`) rather than the ground going fully lit — coarse, one answer per
probe, but cut hard with a narrow step so what reads at that range is a
shadow's shape rather than a lattice, and blended over the map's own edge ramp.
It only reaches where the volume is wider than the shadow window, which is the
small maps (110-140 m windows against 192 m); on the big ones the window is the
wider of the two and it does nothing.

### What it costs

**No draw call.** Everything is compute plus three fetches (four more with
occlusion) in a fragment that already runs; `drawCalls` is unchanged. Measured
uncapped on the RTX box at the menu vantages, GPU time is:

| map | high | low |
| --- | --- | --- |
| Coldharbour | ~0.05-0.55 ms | |
| Hollowmere (21 lanterns) | ~0.4-0.7 ms | ~0.34 ms |
| Cinderhaven | ~0.1 ms | |
| Hollowmere under fire (4 guns, a blast a second, a fire) | +0.3 ms | |

The ranges are the box's own run-to-run floor, which moves by tenths of a
millisecond at these frame rates. The first version cost 4-5 ms, and the three
levers that took it down are the three sections above: the channels, one
fixture per hit, and the terrain march's two exits (a flat map is one plane in
closed form; a ray climbing above the map's highest ground stops). The CPU side
is the `gi` profiler phase, 0.08-0.14 ms. **Nothing here is measured on a
phone**, which is why a coarse pointer defaults to `low` — `FINDINGS.md` 44.

### Contracts that reach outside it

- **Seven textures and six uniforms on every cel material, bound always**
  (`GI_SAMPLER_NAMES`, `GI_UNIFORM_NAMES`), through `applyShadow`'s cel branch,
  the one door all six creation paths share. `GiVolume` publishes a real set in
  its constructor and keeps one published whatever the setting. Grass and water
  do not declare them and keep the flat path.
- **`GameMap.colliderAlbedo` stays parallel to `colliderBoxes`** — `recordBox`
  is the one place either grows. It is client-only: the collision bake, the
  server and `npm run parity` have never heard of it.
- **`update` runs from `tick`, in every state, after `lighting.update`** — so
  the volume converges behind the loading card rather than fading in across a
  spawn, and its channels are that frame's slots.
- **The trace sees what a ROUND sees minus what light passes**: a porous box
  (a fence's run, glass) is left out; a hull is in, rewritten every frame.

## The ink: one pass, over depth the frame already wrote

`shaders/CelInk.ts` owns the argument, the mechanism and the measurements; this
is the part a reader of this file must not violate.

**It only ever DARKENS.** `mix(scene, scene * tint, edge)` with `tint < 1`, so
no pixel leaves the pass brighter than it arrived. That is what makes it safe to
lay over a finished frame with the glow already composited into it, and it is
worth keeping true: it was checked rather than assumed, at seven frozen vantages
across two maps, and came back **0 brighter channels of 6.2 M per frame**. If a
halo ever appears to come through a wall, this pass is not where it came from —
a bloom spreads by blurring after its depth test, and the light shafts add
light along a ray they have already bounded at the frame's own depth.

**It runs FIRST in the post chain and that ordering is load-bearing.** It is
part of the picture, not a grade over one: FXAA behind it antialiases the lines
(they come off a depth buffer, which has no antialiasing of its own), and the
shafts, the smear and the grain all land on top of inked geometry rather than
under it. A `PostProcess` given a camera attaches itself and `attachPostProcess`
APPENDS, so what is constructed first runs first — which is why `Game` builds it
above the `DefaultRenderingPipeline` rather than beside the other three passes.

**It needs no normal buffer, and the reason is worth knowing before anyone adds
one.** A `GeometryBufferRenderer` re-renders the map — the wall the light
shafts and `MotionBlur` both hit and both wrote down. It is not needed because under a
perspective projection `1/z` is LINEAR in screen space across any plane, so the
centre texel against what its two neighbours predict for it is exactly zero on a
flat surface at any angle, a floor seen edge-on included, and large at a corner.
That is the crease term; the silhouette term is a plain relative depth step.
Both are dimensionless, so one threshold holds at every range and no map states
its own.

**THE NIB IS A FUNCTION OF DISTANCE, AND THAT IS THE OTHER READING THE FOG FADE
COULD NOT GIVE.** A line one texel wide everywhere is the one thing a pen never
draws: it gives the palm grove at 300 m exactly the weight of the crate at 5, so
a dense frame arrives with no hierarchy in it. Darkness and weight are not one
reading — a thin black line comes FORWARD and a thick pale one does not — which
is why `ink.width` sits beside `fadeBand` rather than instead of it: the fade
takes a distant line's darkness, the nib takes its weight, and aerial
perspective in ink is the two together.

The curve has **two sides**, because the near end is the viewmodel's: fine at
the lens, bold at `width.from`, tapering to fine again by `width.to`. The inward
half is the same argument `ink.near` already makes about DARKNESS spent on
WIDTH — at arm's length the parts are smaller than the pen, and a full nib on a
trigger guard is a smudge — and the weapon wants both halves. The outward taper
is on `sqrt` so most of the thinning happens in the first few metres, where
perspective does most of its own, but nowhere near the `1/z` that a constant
WORLD thickness would give: that is the inverted hull this pass replaced, and it
vanished at range. `width.to` is an absolute distance and deliberately not a
share of the map's fog band, because what it describes is the near FIELD — tying
it to the band would leave Sarab's foreground bold for two hundred metres and
Hollowmere's fine at forty. Widths are stated at `width.rows` rows and scale
with the frame's own, because a stroke is a fraction of the PICTURE and not a
count of pixels.

**Width is bought with a SECOND RING, and both rings are divided by their own
radius.** The pass takes the depth cross at one texel and at two; the inner one
carries a stroke up to a texel wide and LIGHTENS below that rather than
vanishing, which is the honest reading of a sub-texel line and is what stops
distant clutter matting into a tangle of full-strength hairlines, and the outer
one is the flank and arrives only once the core is full — so a stroke has a dark
centre and a softer edge, which one ring could never give. The nib is therefore
clamped at 3 texels, which is the reach of two rings. **The division by radius is
what lets ONE pair of thresholds serve both**: over a sloped surface a depth
difference grows in proportion to the step taken across it, and a slope break's
second difference does the same, so without it the outer ring reads a grazing
floor as a silhouette and every dune is a contour. What the division costs is
sensitivity at a WEAK edge on the outer ring, and that cost is the feature — a
weak edge keeps the inner ring alone and stays a hairline while a strong one
carries the whole nib, so a stroke varies in width along its length with what it
is describing. That is pressure, arrived at rather than painted on.

**A CONTOUR and a CREASE are no longer spent identically.** The pass has always
measured them separately — a depth STEP against a depth BEND — and drew both at
one weight, which is what a machine does: a draughtsman lays the outer contour
down first and heaviest and draws the interior detail finer and lighter under
it. `ink.creaseStroke` is that split, in darkness and in width, and it costs
nothing because both numbers were already in hand. Two smaller terms finish the
hand: `ink.pressure` is what the faintest line keeps of a strong one's darkness,
ramped over the threshold to five times it so the variation runs ALONG a stroke
rather than sitting at its ends; and `ink.wobble` nudges the whole sample cross
by a two-octave field under a texel wide, so a long straight edge is no longer
exactly straight. **The wobble is anchored in SCREEN space and that is a
compromise stated rather than hidden** — a surface-anchored field wants the world
position reconstructed per pixel, and would swim over every bot that walks
anyway. At this amplitude it reads as a line that wavers; turning either number
up finds the shower door quickly.

**It owes the fog and gets it exactly**, over the MAP's band — so `Game` pushes
`applyEnvironment` at it on every environment change, including the editor's.

**…AND A DEPTH BUFFER DOES NOT HOLD A DISTANCE, WHICH IS WHAT "EXACTLY" COSTS.**
A linearised depth texel is z along the camera's FORWARD AXIS; the cel shader
fogs against `length(vPosW - camPos)`, the radial distance to the eye. The two
agree down the middle of the frame and diverge as `1/cos(theta)` toward its
edges, so the three terms in this pass that ask how far away a thing IS — the
fade, the nib and `ink.near` — scale view-z by the frustum ray through the pixel
(`tanHalfFov`, read off the live camera every frame because `fov` moves with the
ADS zoom and the sight). **The ring tests keep view-z and must**: the crease term
rests on `1/z` being linear in screen space, which is a fact about the projection
and not about distance.

**This is a bug that hides from whoever goes looking for it**, and it is worth
knowing the shape rather than the arithmetic. It appears only on the FLANKS of a
wide frame — at the hip fov on a 21:9 panel the horizontal edge is 50.9° off-axis
(the ray is 1.58 long, against 1.17 a quarter of the way in), so a tree the fog
has fully dissolved at 78 m reported 49 m to this pass and kept **0.78 of its
ink** and a near-bold nib: line work standing in front of fog
that had already taken away what it outlined. Turning to face it walks theta back
to zero and takes the symptom with it. **Anything else that reads `FrameDepth`
and wants a DISTANCE owes the same conversion** — `MotionBlur` already builds the
same ray for its reprojection.

**Two things stand in for the hull's per-mesh control, and NEITHER is a flag.**
An emissive part was excluded from the hull by `noOutline`, and an inked
emissive is swallowed glow; the ink masks it out with the glow's MASK
(`GlowPass.mask`) instead, which is full-resolution and emissive-only —
sharp, because the blur reads a downsample of it and never writes back, and
already depth-tested against this frame, so a lamp behind a wall
does not protect the wall. The weapon wore a hand-set 0.004 m hull because a
full-weight line on parts that small swallows it in black; what replaces that is
`ink.near`, a DEPTH band — the gun is 0.3-0.5 m out and a body cannot get within
about 0.4 m of world geometry, so distance names the viewmodel with no per-mesh
data at all. That is the one place `FINDINGS.md` 18 said an ink-id attachment
would be needed, and it is not.

**The frame's ALPHA CHANNEL is translucent coverage, and that is a rule the
whole renderer keeps rather than one this pass owns.** A depth buffer cannot say
that smoke got between the pass and the geometry it is drawing an edge off:
nothing alpha-blended writes depth, and the capture markers must not
(`disableDepthWrite` — a marker may never hide what it marks), so an edge
derived from the bodies behind a plume was painted over the plume at full
strength and read as ink floating in FRONT of the effect. The channel nothing
was using carries the answer. Everything opaque writes **0** into it —
`CelShader`'s `opaqueAlpha` uniform, and a literal 0 in `GrassShader` and
`WaterShader` — `applyEnvironment` clears to 0, and every alpha-blended draw
accumulates into it with no help at all, because Babylon's `ALPHA_COMBINE`
blends the alpha channel as (ONE, ONE). The pass then does `edge *= 1 -
saturate(a)` and writes 1 back out. **So it costs no pass, no target and not
even a texture read**: it is the fourth channel of the sample the shader already
took, and nothing downstream ever sees it.

Four things share that channel and each was checked in the tree rather than
assumed. The glow composes AFTER the ink and passes the alpha it is handed
straight through, so a bloom cannot claim coverage it does not have. An ADDITIVE
effect leaves the channel alone and should — a flare adds light rather than
hiding what is behind it. The GLAZING writes its Fresnel alpha, so ink behind a
window is attenuated by how opaque the window is, which is what you want and is
visible on Coldharbour's parked cars. And a REFLECTION PROBE wants the OPPOSITE
value out of the same line, because in a cube that channel is the bake's own
coverage mask — the thing `city.a` and `cube.a` read to tell the city from the
sky above it. That is the whole reason `opaqueAlpha` is a uniform rather than a
constant: `ReflectionSystem` flips it to 1 for the length of a bake, on the same
two hooks that already lend the bake the probe's eye, and a walk of the material
cache therefore happens only on the frames a probe renders. Get that flip wrong
and the cube comes back alpha 0 everywhere and every pane reflects nothing but
sky.

**The CLOUDS write coverage 0 like every opaque surface, and need nothing from the
ink** — they write the depth of a point 7 km out (see the sky section), past every map's fog
band, so the ink's own fade has taken their line work off before it is drawn. A
first version wrote their REAL depth at a few hundred metres and had to write
coverage 1 to keep Cinderhaven's clouds from being outlined; the far depth retired
that exception.

**It inks the terrain, the grass, the water and the debris, none of which the
hull touched, and that is kept.** Every blade of grass writes depth, so every
blade is a silhouette; what it reads as is denser, darker grass. A judgement,
not an accident — and `noInk` is deliberately absent from those meshes so the
flag does not claim otherwise.

## The smear, and the one thing in the frame that must not take it

`shaders/MotionBlur.ts` owns the argument; this is what a reader of this file
must not violate.

**The pass is a ROTATION reprojection and that is exact at every depth**, which
is what buys a camera blur with no velocity buffer and no second pass over the
map: a look that turns moves a pixel's ray the same way whatever it hit, so
where a pixel was last frame is a function of its screen position alone.
Translation is depth-dependent and is therefore simply absent — strafing past a
wall does not smear it.

**THE WEAPON IS THE ONE PLACE THAT BREAKS DOWN, AND IT IS NOT A CORNER CASE —
IT IS A THIRD OF THE FRAME.** The viewmodel is parented to the camera, so a
rotation moves every world pixel and moves the gun by exactly nothing; the
shift the pass computes is right for everything except the object filling the
bottom of the screen, and a smeared gun reads as a dirty lens rather than as
motion.

**It is named by DEPTH, which is `ink.near`'s argument spent a second time.**
The viewmodel is drawn between 0.05 m and 1.39 m of the lens — measured, hip
pose, every gun in the kit, the sniper's muzzle the deepest — and a body cannot
get its eye much inside half a metre of world geometry, so a band in metres
(`motionBlur.nearSharp`/`nearFull`) separates them with no per-mesh data at
all. What that band costs is stated rather than hidden: world geometry inside
`nearFull` is held sharp too, which at an ordinary horizon view is a strip at
the very bottom of the frame that the weapon is standing in anyway, and at a
steep look down reads as focus rather than as a fault.

**It is TWO uses of that band and the second is what finishes the job.** Masking
the shift keeps the weapon's own pixels sharp and says nothing about the world
pixels BESIDE it, which gather backwards along the smear, land on the gun, and
drag its colour out across the scene — the same complaint one pixel over. So
every tap carries the same weight and the accumulation is normalised by what it
kept. The centre tap is unconditional, so a run of rejected taps degrades to
the sharp pixel rather than to a hole.

**The RADIAL mask that used to do this job was backwards for it**, and that is
worth knowing before anyone widens it again: the weapon sits low and to the
RIGHT, which is where a radial falloff blurs hardest, so the most smeared thing
in the frame was the one thing in it that never moves — while the sharp core it
bought was spent on the middle distance, which is where the smear is the whole
effect. It is still there and still about the EYE, which tracks where the eye
is pointed;
it is simply narrower now (0.2/0.75, from 0.35/0.85).

**Measured**: at 1280x720 the whole pass does not separate from a straight copy
on a 4070 Ti SUPER, so the arms were run at a hardware scaling of 0.3 —
4266x2400, nine times the pixels — with a `readPixels` sync closing each block
and the arms interleaved A B A B. Settled blocks: **masked 3.96 / 3.80 / 3.80
ms, radial 3.81 / 3.72 / 3.73 ms, no blur at all 3.76 ms** — about 0.07 ms of
difference over ten megapixels, which is ~0.007 ms at 720p, against a first
block that came in 1.3 ms high. The structural reason it is that small is that
the band pays for itself: it adds one depth load per pixel and one per tap, and
it takes the sample loop away entirely from the weapon and from the sharp core,
whose shift it has already driven under half a texel.

**The depth image is SHARED and its owner is `shaders/FrameDepth.ts`** — one
capture, one wrapper, read by the ink and by this pass. It is the attachment
belonging to the FIRST pass in the camera's chain, so **anything inserted ahead
of the ink takes the depth with it**, and a pass that samples it must stay
downstream of whatever the scene draws into.

## The wind, and the one thing in the world that moves

The world is merged and frozen because it is static, and that is exactly what
made a valley of fourteen hundred trees read as a photograph of a jungle. The
**red channel** is what moves it: how much of `CONFIG.wind.foliage.travel` a
vertex is entitled to, spent in the cel shader's vertex stage as a lateral
displacement along a travelling gust. `world/sway.ts` owns what the number
means, `world/vertexShading.ts` writes it, and the neutral value is the disabled
attrib's 0 — so every rig, the viewmodel, every grenade and every effect mesh
stands perfectly still in a gale without carrying a byte. That is the alpha
channel's trick a third time, and it is why the shader needs no define, no
branch it would not have taken anyway and no fifth cache variant.

**One wind, two layers, and the direction is what makes them one.**
`CONFIG.wind` used to be three fields inside `CONFIG.grass` with a single
reader, which was fine while grass was the only thing in the valley that moved
— and is the whole problem the moment anything else does, because a field
leaning one way under a canopy leaning another is two animations rather than a
breeze. So the bearing is shared and the amplitudes and speeds are not: mass
sets frequency, and a fern answers a gust in a second where a crown of leaf
takes three.

**The weight is a ramp in height above the GROUND, and it is that rather than a
per-part anchor because nothing downstream of the merge knows where the bough
was.** By the time a vertex attribute can be written, `mergeByMaterial` and
`BlockMerge` have collapsed a tree into a colour and forty-eight metres of
forest into one mesh — there is no prop, no part and no local frame left, only a
world position and the terrain under it. A positional ramp is the one function
of that which is *continuous* across everything marked, so a frond and the leaf
plate beside it — in different merge groups, weighted from where they are rather
than from what they belong to — agree at the join and there is no seam. It is
the same argument the occlusion estimate makes, on the same buffer.

**Where marked meets unmarked there IS a step, and that is what makes the choice
of what to mark a geometric argument rather than a taste one.** A marked mesh
moves and its unmarked neighbour does not, so a mark is only safe where the join
is buried or the ramp is near its foot: a canopy plate is centred on the trunk
axis and metres across, so 0.29 m of drift is spent inside its own overlap of
the bole, and a fern blade leaves its crown at 0.42 m where the ramp has given
it four centimetres, against a crown 0.3 m across. Marking something whose join
is neither is what tears.

**What sways is leaf, and what does not is the column holding it up.** A canopy
tree's plates, fronds and drooping tips lean; its trunk and buttresses do not,
and the crown does not come off the bole because a plate is centred ON the axis
and metres across, so a third of a metre of drift is spent inside its own
overlap. The trunk is left out because a long thing lying ALONG the ramp would
*bend*, and a bending column is the one shape a vertex ramp cannot draw
honestly. Fern blades and their tips are the understory layer, at half the
travel — that is the layer the player walks through, and the one place a sway
big enough to notice is also big enough to read as the world sliding; its two
numbers are set against the grass beside it rather than in the abstract, so a
fern tip moves about 0.09 m where a blade of grass moves 0.16.

**The liana veil is the case that makes the ramp look designed rather than
lucky**, and it is on the canopy layer despite hanging at eye level. A strand
does not touch the collar on the trunk — it hangs in the air out under the
frond whose azimuth `buildJungleTree` measured it against — so the top of a
strand and the blade above it are at nearly the same height, get nearly the same
weight, and travel together with no join to shear. Further down the ramp gives
less, so the hem TRAILS the branch instead of swinging rigidly with it, which is
the one thing a hand-authored version would have had to fake. The collar itself
is left out, because it is a thickening on the bole and the bole does not move.

**Cloth is the ramp's inverse case, and the ramp LOSES it.** Everything above is
planted at the bottom and free at the top, which is the shape the ramp draws:
weight rises with height, so a root is still and a tip travels. A drape over a
parapet and a rag on a compound wall are fixed at the TOP and free everywhere
else, so the same ramp hands a hung sheet its largest travel at the one edge
that is nailed down and its smallest at the hem that should be swinging. There
is no setting that fixes this. The weight is written by a bake that runs after
`BlockMerge` — by which point a whole block's washing is one mesh with no drape
tops in it any more — off the one quantity that bake has, which is height above
the terrain. `FINDINGS.md` 33 carries what a hanging ramp would take.

**So the layer is tuned so the inversion cannot be SEEN, and the geometry
carries the effect instead.** `reach` at 5 m spans the heights cloth is hung at,
so a drape gets a real gradient down its own length (a one-storey parapet's head
travels 1.5x its hem, which reads as shear rather than as sliding), and `amount`
at 0.28 caps the largest travel anywhere in the layer at 0.095 m — pinned to the
0.08 the coping above every drape oversails its wall by, so a head that never
travels further than the oversail can never emerge from under it whatever the
wind's bearing does relative to that wall. Cloth that breathes rather than
swings, which is the honest reading of a sheet in a steady wind and the one an
amplitude this small can be held to.

**What makes it read as cloth is the four boxes, and the argument is the one mud
brick already makes.** These surfaces carry no texture, so silhouette is the
whole of what a material is — and a sheet drawn as a single box is a slab with a
level hem, one flat face and a constant thickness, which on this layer also
translates rigidly because every vertex on one box gets very nearly one weight.
`kit/desert.ts`'s `drape` is a rolled head and three strips under it differing
in width, drop, proudness and hang, so the hem is ragged, the folds band the
light differently and the assembly has depth. All four are marked, which is what
leaves it no internal join to shear: the only step anywhere is where the roll
meets the wall, and that is what the coping is hiding.

The other half of the rule is unchanged and load-bearing: a drape emits no
collider and nothing was ever measured against it, so `sway.ts`'s prohibition on
marking anything a collider stands in for is satisfied by construction rather
than by care.

Two consequences are worth stating plainly, because both look like bugs:

- **A swaying group needed its own ink and no longer does, which is the
  cleanest thing the screen-space pass bought.** Babylon's hull could not follow
  the wind and the reason was mechanical rather than a preference:
  `OutlineRenderer.isReady` builds the hull's effect with a hardcoded attribute
  list of position and normal — `const color = false`, literally — and a
  hardcoded `uniformsNames` with no clock in it, and patching the shader source
  reaches neither list. So the hull saw neither the wind nor the per-vertex
  weight: a leaf leaned out from under a shell left standing at the rest pose,
  and a third of a metre against a five centimetre line is a dark ghost of the
  still canopy hanging behind the moving one. What covered that was
  `MapBuilder.inkTwin` — one INVERTED HULL MESH per swaying group, cloned so it
  shared its source's `Geometry`, wearing a `CEL_INK` material that had the
  wind, the weight, the eye and the fog. It worked, and it cost a mesh: 53 of
  them on Coldharbour and **144 on Harrowmead**, each a draw with a material
  switch, plus a build phase, plus a `noReflect` flag (an inside-out hull is a
  sealed room to a probe parked inside it) and a `block` key it had to carry so
  `WorldCulling` could not strand one. Both of those flags are gone with it —
  `noReflect` has no writer and its filter came out of
  `ReflectionSystem.opaqueWorld`, which is a rule and not a tidy-up: anything
  inside-out added back owes it again.

  `CelInk` reads the depth buffer, and the depth buffer already has the leaf
  where the wind put it. Sway is not a case it handles — it is not a case at
  all. `mergeByMaterial` no longer takes the ink off a swaying group at
  all — there is nothing to take off.
- **The shadow it casts is the REST pose's, always.** The depth map is rendered
  from Babylon's own shadow shader, which never sees the displacement, so the
  dapple does not move — and, more importantly, does not *stutter*: the map
  re-renders whenever the snapped focus moves, and a shadow that followed the
  wind would jump to a new phase every time the player walked a texel. Static is
  the better of the two answers here, and at Greyfen's 28-degree sun a frond
  throws its shadow nineteen metres, where nobody is correlating one leaf with
  one patch of light.

The clock is `CelMaterialFactory.updateWind`, advanced from
`updateCameraAndLighting` beside the grass field's rather than from `Game.tick`
beside the shader's eye. The eye is owed by the states that simulate nothing; a
clock is owed by none of them, and a canopy still leaning over a frozen field
under the pause card would be the one thing in the valley the pause did not
reach.

**Four light terms, not three.** Beside the key light, the flat ambient and the
point lights there is a *hemispheric* term, `skyLightColor`, applied by `n.y` and
never gated by the shadow map: full strength on up-facing surfaces, nothing
underneath. It is what makes streets, roofs and open ground read as moonlit while
walls and undersides stay black — flat ambient alone lifts every face equally, which
reads as a grey wash. Because it is ungated, a roof in the moon's shadow still
catches it. It lifts *albedo*, so a bright material (the cobble street) gains far
more from it than a dark one.

**The key may WRAP, and that is how a low sun is lit in a cel frame**
(`EnvironmentSpec.lighting.keyWrap`, 0 by default, so a map that says nothing is
Lambert exactly). Under Lambert a 14-degree sun hands a flat floor a quarter of
the key, the sky fill becomes the brightest thing on the ground, and a golden hour
photographs as dusk — and raising `intensity` to fix the floor clips every
sun-square wall against the soft shoulder, which comes back khaki. The wrap lifts
a facet's cosine by `wrap * (1 - cosine)`: a wall square to the light is untouched
and the floor climbs bands, so whatever faces the light is LIT and the terminator
is where the two-tone break falls. Three things about it are load-bearing:

- **The lift is keyed on the GEOMETRIC facet and ADDED to the bumped cosine**, so
  the ground's relief keeps its whole amplitude rather than being squeezed by
  `(1 - wrap)` — a raking sun over cobbles is exactly where the relief is the
  picture.
- **It fades in over the first few degrees of the terminator** (`smoothstep(0,
  0.08)` on the geometric cosine), so a facet grazing the light, where the shadow
  map is least sure of itself, is not handed a full band of key to show its acne
  in.
- **A map's wrap is DERIVED, never picked.** A lifted cosine moves where the band
  edges fall, and `band()`'s edges are at `n + 0.5` of `ndl * 4`: a wrap that puts
  a flat floor on an edge makes every gentle slope flicker between two bands. The
  value to state is the one that lifts `sin(elevation)` to exactly 0.75, the
  centre of a band — `(0.75 - s) / (1 - s)` — which is 0.667 on Harrowmead, 0.578
  on Coldharbour and 0.529 on Greyfen, and each keeps a facet tilted seven degrees
  either way inside the band. The first values tried (0.55, 0.4, 0.3) each put
  that map's flat floor within a smoothstep of an edge, and the first of them
  looked right on a level street, which is exactly why it has to be computed.

It reaches the cel materials and the grass, the two surfaces that take the key as
a cosine. Not the water, which takes the sun as a reflection.

**Two more terms are per-material opt-ins, and they are three cache variants rather
than a matrix.** `getGlossy` adds the toon specular (`specColor`/`specShininess`)
and `getTranslucent` the translucency band (`transColor`) — the key light coming
*through* a thin surface, for stall awnings and for every crown in the game —
a pine's needle tiers, a jungle canopy's plates, a hedgerow ash's leaf. Both default to a
**black colour**, which is what makes them free on materials that skip them: every
cel material carries both uniforms and zero multiplies the term out. A material is
matte, glossy *or* translucent — never two — because the cache is per colour and an
axis that multiplies is an axis that costs. Another such variant means a spec type,
an `apply*`, a `get*` under its own key and one entry in `UNIFORMS`. (It used to
cost a fifth thing — teaching `outlineInkFor`'s regex the new
`cel-<variant>-#rrggbb` name, or the ink fell back to a neutral colour. The ink
is a screen-space pass now and has never heard of a material name.) The
translucency term is directional both ways — it
needs the eye looking into the key light *and* the facet turned away from it — so it
can only be judged from under the thing, moonward.

**The specular's top rung is a MIRROR, and it is a third thing rather than a
brighter highlight.** `SpecSpec.mirror` is what turns it on, `CONFIG.graphics.
spec.rifleChrome` is the only entry that states one, and the weapon finishes are
the only surfaces that wear it — the world never enters the block. What it adds
is the ROOM down the mirrored eye ray: a hard horizon between what the light is
worth looking up and what it is worth looking down, the key light as a wide
banded lobe on that ray, and every point light in range the same way, all tinted
by the surface's own albedo and weighted by Schlick. **It is the one surface in
the game that answers a point light with anything but diffuse**, which is what
lets a chrome weapon see the lantern it walks past.

Three things about it are worth knowing before touching it, and each is written
out at length in the shader because each was photographed the other way round
first: it is the *light* in a direction rather than the *picture* in it, because
the picture on a night map is 0.03 and a mirror built from it is a grey object;
it is **added** and never mixed toward, because a mix makes chrome darker than
the paint it is supposed to outshine; and the horizon is **hard**, because a
weapon is a box whose plates all reflect within a few degrees of the horizontal
and any smooth gradient hands every one of them the same value.

Unlike the glazing below it is a **uniform branch** and not a define — the same
call the albedo weathering's mask makes. `specMirror` is constant across a draw,
so the block (its light loop included) is coherent and skipped whole on every
matte, satin and metal material; what forces the glazing into a define instead
is its cube SAMPLER, which a bind group cannot make conditional.

## Fire: the one surface that animates its own shape

Every open fire — the fire drums, the watchtower's signal brazier, a lit
fireplace — wears ONE material, `FlameMaterial` (`shaders/FlameShader.ts`), over
geometry from `world/flame.ts`, and a building says `b.flame(...)` beside its
`b.light` and `b.sound`. It replaced a static emissive cone. The rules that
reach outside it:

- **It is merged like any other part, so everything it needs per vertex is in
  its UVs** — layer in `uv.x`'s whole part (outer tongue, core, ember, bounds
  marker), a seed in its fraction, height up the tongue in `uv.y`. The phase of
  the motion is taken off WORLD position, which is the one thing a merge keeps,
  so no two fires in a street move together and no rng is spent building one.
- **It is never a shadow caster** (`noShadowCaster`), for the world shadow
  map's rule: an animated caster is a per-frame redraw of the map.
- **It takes no vertex colour buffer** — `vertexShading` skips it by
  `isFlame`, because it is a `ShaderMaterial` and the bake would otherwise
  hand it an attribute it does not declare.
- **Its yellow is drawn over its orange by WINDING, not by depth.** The outer
  tongues are built inside out, so only their far wall draws; the silhouette is
  the whole tongue's and the core inside is always nearer. Nothing is biased in
  depth, so a core can never draw through a grate or a jamb.
- **The shape boils on TWOS** (`CONFIG.graphics.flame.fps`, 12) — it changes
  drawing a dozen times a second, which is what reads as a drawn fire — and the
  embers ride the smooth clock. Both clocks are the WORLD's
  (`CelMaterialFactory.updateWind`), so a pause holds the fire with the canopy.
- **It owes the frame what every opaque surface owes it**: the cel shader's
  fog (same curve, same radial distance) and `opaqueAlpha` for the coverage
  channel, both pushed by `CelMaterialFactory` beside its own walks.
- **Its bloom is per band**, through the mask twin above, so the white heart
  blooms and a red lick barely does — at full bloom the bands wash to one yellow.
  With the mask that dim at the rim, the ink draws a thin contour round the
  licks in daylight, which is the look and not a leak.

## The glazing: the one thing here that is not opaque

`getGlass` is the fourth variant and the odd one out three times over, and each
difference is forced by what a window is. (`getInk` is a fifth, added for the
wind — see the outline note above. It is cheap to add to this roster because it
takes the albedo path away rather than adding one: it writes a flat colour and
falls straight through to the atmosphere block, so it needs no spec and no
translucency.)

**It is a DEFINE (`CEL_GLASS`) rather than a uniform**, unlike the two above. The
trick that makes those free is that a black colour multiplies the term out — but
this one is a `reflect()`, a `pow()` and a sky gradient, and there is no value of
any uniform that makes a GPU skip them. Every wall, roof, road and rig in the
frame would evaluate a reflection to keep the roster uniform.

**It writes a per-pixel ALPHA, and it is the only material in the world layer
that does.** A pane is two layers over one another: what it reflects, and the
tint of what you see through it. `CONFIG.graphics.glass` carries the four numbers
— `reflectance` face-on, the Fresnel `falloff`, the sun `halo`'s width and how
dark the `tint` is — and the shader composites the pair into one colour and one
alpha, dividing by that alpha because the rasterizer is about to multiply by it.
The material's own `alpha` stays 1; what puts these subMeshes in the transparent
pass is `needAlphaBlending` in the `ShaderMaterial` options. Depth writes turn
themselves off — Babylon's `setAlphaMode` clears the depth mask for any blended
draw — so panes are sorted rather than z-buffered, which is why the glazing
merges per map block (`MapBuilder.paneGroup`) and why a transparent mesh costs
more than its triangle count says.

### The second half of it does not write an alpha, and that is where the frame went

**`CEL_GLASS_BACKED` is the same shader over a KNOWN backdrop.** Most glazing on
a city map is not seen through at all: a tower's curtain wall hangs 0.04 m off a
solid shaft, a shophouse's sash is drawn on its own wall, a clerestory sits on
brick. For those the layer behind the pane is not the framebuffer — it is that
mass, on a parallel face a hand away, under the light term the pane has already
computed. `Build.pane({ backed })` names its palette colour, and the composite
folds:

```
  C*alpha + B*(1-alpha),  C = (sky*fres + col*tint*(1-fres))/alpha
                          alpha = fres + tint*(1-fres)
    ==  mix(mix(B, col, tint), sky, fres)          since 1-alpha = (1-fres)(1-tint)
```

**That is exact, not an approximation** — the only thing assumed is `B`, and the
builder is the one thing that knows it. What it buys is not the divide it saves
but the ALPHA it no longer needs: the sheet writes depth like any other opaque
surface, so the mass behind it is rejected before it is shaded. Measured on
Coldharbour, where glazing covers **16–45% of the screen** depending on where
you stand: that third of the frame was being shaded twice, once for the shaft
and once for the pane, with the more expensive of the two shaders on top. 98% of
the map's glazing triangles are `backed`.

**It pays only if the pane is drawn FIRST**, and Babylon will not do that on its
own: its default opaque sort is `PainterSortCompare`, which groups by material
id and leaves depth to chance. `Game`'s constructor installs a front-to-back
comparator with `scene.setRenderingOrder(0, …)` — its own rather than
`RenderingGroup.frontToBackSortCompare`, which reads a `_distanceToCamera` that
Babylon fills in only on the transparent path. The sort is a visual no-op by
construction (opaque draws are order-independent through the depth buffer) and
worth having on its own: a street of towers occludes most of itself.

**What stays blended is what something is meant to be legible behind**: the
breakable shopfronts, where `tint: 0.4` exists precisely so a lit interior reads
from the pavement, and a car's greenhouse, which `buildCar` models a dash and
seat backs into for the same reason. **`backed` is a claim about the WORLD and
nothing throws when it is false** — the geometry is legal either way and the
result is a flat sheet where a room should be. The test is what a ROUND does: if
one stops on something solid within centimetres, the eye stops there too.

The two are separate MATERIALS, and that is what makes the split cost nothing
anywhere else: both of `MapBuilder`'s merges already group by material, so a
building that glazes in both kinds falls into two merged meshes without either
merge being told glazing now comes in two. The one thing that had to learn is
the probe count — see below.

**Both kinds carry a depth BIAS, and it is the only one in the renderer.** A
pane hangs a few centimetres off the wall behind it — `kit/city.ts`'s `glaze`
stands 0.04 m of glass over the shaft, with the collars proud of that again —
and the depth buffer loses that gap with distance. The near plane is 5 cm
because the viewmodel's optics sit inside 5 cm of the eye, and against a buffer
resolving 2^-24 of the range that leaves a step of 1 cm at 90 m, 3 cm at 160 m
and 27 cm at Coldharbour's fog wall. Measured square-on with the pane held at a
constant size on screen, with no bias at all: full contribution at 40 and 90 m,
**nothing at all from 180 m out** — every distant tower back to blank concrete,
with a correct shader and correct geometry.
`CelMaterialFactory.GLASS_DEPTH_UNITS` (-16) is a polygon offset in the buffer's
own units, so the correction is millimetres up close and metres at the far end,
exactly where the error is; the near plane is spoken for and `maxZ` is worth
nothing here (measured). What it costs is the fins and collars standing
0.1–0.2 m proud of the glass, which the bias overdraws past ~100 m where they
are a pixel or two of trim.

**The buffer is `depth32float` and the unit is DEFINED differently for a float
format, so sixteen is a re-measurement rather than a number carried across.**
`stencil: false` picks the format (see the no-stencil note below), and WebGPU's
constant term for a float one is `depthBias * 2^(exponent(the primitive's own
depth) - 23)` rather than `depthBias * r` for a constant `r`. That lands on the
same `2^-24` everywhere a shipped map is drawn — a depth in [0.5, 1) is every
fragment past a few metres — which is why the answer did not move much, and it
is not something to assume the next time the flag does. Re-run on the north
tower's 542-sheet curtain wall with the rest of the map hidden and the glass
tinted so a surviving sheet is countable (`plans/webgpu-ref/depth.mjs glass`),
the pane's own share of the frame is:

| units | 40 m | 90 m | 130 m | 180 m | 220 m | 260 m | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 84.0 | 68.1 | 67.1 | **0.7** | **0.6** | **0.6** | goes between 130 and 180 m |
| -4 | 84.0 | 68.1 | 67.1 | 65.2 | 57.3 | **8.4** | thins, then goes |
| -8 | 84.0 | 68.2 | 67.2 | 65.3 | 64.9 | 64.0 | |
| -12 | 84.0 | 68.2 | 67.2 | 72.2 | 72.5 | 72.0 | the far end complete |
| **-16** | 84.0 | 68.3 | 67.8 | 72.5 | 72.8 | 72.3 | **shipped** |
| -24 | 84.0 | 68.6 | **75.0** | 72.6 | 73.2 | 72.4 | the transoms eaten |
| -64 | 84.0 | **77.6** | 75.7 | 72.8 | 73.0 | 72.4 | |

**It is bracketed on both sides now, which it never was.** -12 is the floor:
under it the far end thins and then goes, and -4 collapses outright by 260 m.
-24 is the CEILING, and what it costs is legible rather than statistical — at
130 m the horizontal transoms across the curtain wall stop being drawn, which is
the +7 points of "extra" glass in that row and reads as a wall that has lost its
banding. Sixteen sits between the two with room on each side. The blended kind
is the same shape and far less of it: the map's biggest unbacked group is eight
sheets of shopfront, the bias roughly triples what survives past 90 m, and at 2%
of the glazing all of it at street range, the backed reading is the one that
decides the number.

On a `backed` sheet the same bias earns a second job it was not written for:
now that the pane writes depth, it has to WIN against the mass it hangs on
rather than merely be seen over it, and biased toward the eye it does — at
every distance, for the same reason it was needed at all.

**The reflection is built in two goes: an analytic sky, and the city over the
top of it out of a cube.** The sky half is the older one and is unchanged — it
mixes `fogColor` at the horizon toward `skyZenithColor` overhead, down the
mirrored eye ray, plus the key light as a broad halo where that ray points at
the sun. `skyZenithColor` is the one uniform taken from the map's DOME rather
than from its lighting block (`SkySpec.zenithColor`, falling back to the flat
`skyColor`) — a reflection is a picture of the sky, not the light the sky
throws, which is what `skyLightColor` beside it already is. The horizon end is
`fogColor` because `SkySpec.horizonColor` is required to sit close to it, which
is the one place that requirement is load-bearing rather than cosmetic.

**The city half is `systems/ReflectionSystem.ts`, and it is the only render
target in the game besides the shadow map.** It is affordable for one reason
and it is the same reason the whole world layer is merged and frozen: the world
is static, so this is not a pass, it is a build step that happens to run on the
GPU.

**The glazing is no longer the only thing that samples a probe.** The water
takes one per body from a pool of its own, without the parallax correction and
at an explicit LOD — see the water section below for why both of those invert
here, and the `celProbe` include for the uniforms and the Y flip the two
share.

**There is one probe per GLAZED BLOCK, and that count is the whole design.**
One cube for the map cannot show the building opposite — which is the only
thing a reflection in a city is really made of. A pane returns what lies in the
mirrored direction, and a bake taken 150 m away has the right city in it seen
from the wrong place: the tower across the street lands in the pane at the
angle it subtends from the middle of the map. A cube per PANE is the other end
and is not on offer, because Coldharbour draws 6,139 sheets. What makes a
middle affordable is that the glazing is **already merged per map block**
(`MapBuilder.paneGroup`) — 37 blocks of it — so one probe per block costs 40
cubes and **not one extra draw call**. Each block's mesh gets a material of its
own, which is the one place `CelMaterialFactory`'s per-colour cache is
deliberately widened: a cube is not shared state, it is one probe's picture of
one place. The probe stands within ~25 m of every pane it serves rather than
~150.

**Per BLOCK, not per merged mesh, and the distinction started mattering when
`backed` glazing arrived.** A block glazed in more than one material is more
than one mesh — a shophouse terrace is its shopfronts blended and its sashes
opaque — and all of them want the same picture of the same street. So
`ReflectionSystem` keys its slots on `PaneGroup.block`, the merge's own key,
and the second group on a block reuses the first's probe. Coldharbour is 71
glazing groups over **40 probes**, which is exactly what it was before the
split: the bake stays a function of how many blocks are glazed rather than of
how many kinds of glazing a builder happened to reach for. The key is asked for
rather than inferred because "the same building" is a thing `PaneBlocks`
already decided — a distance test between two centres has to guess, and the two
centres are not comparable anyway (a tower's is the middle of its shaft, a
shopfront's is out on the pavement).

Faces are 128 rather than 256, because the resolution is now a per-probe cost
(~520 KB each, ~19 MB for Coldharbour) and it buys detail a Fresnel-weighted,
tinted, hazed reflection cannot show — while WHERE a bake is taken from decides
whether the building opposite is in it at all. Measured headless: all 37 probes
(222 faces) come to **2.3 s under SwiftShader**, against a map build already
costing ~570 ms there; on the Windows box the shipped forty cost ~1.4–2.1 s in
one frame. `FINDINGS.md` §10 is the entry, and the distance cull it refused at
140 m is now taken at 800 — see the three ceilings below for why the answer
moved and what the radius costs.

**The bake is priced `probes x 6 faces x render list`, and all three terms have
a ceiling now.** None was needed while the biggest map in the tree was 320 m:
Coldharbour's forty probes over 175 meshes each are 41,934 draws, they all land
on the frame after the install, and that frame — ~2.3 s — is paid once. At
1500 m the same rule asks for 770 probes over 2,434 meshes — **11.2 million
draws in one frame**, and the 900 m proving ground for 1,373,340 — and what
happens then is not a long frame. The D3D12 device is LOST inside it, on
`ID3D12Device::CreateDescriptorHeap`, and Babylon's attempt to recreate it
fails too; at the larger of the two extents `FINDINGS.md` §19 measured, the
renderer process is replaced outright. **That is a resource ceiling reached
inside one command submission and not a timeout**, so a slower bake fails
identically and only a smaller one does not.

**One term of that product is not paid at all any more, and it is the SIX.** A
cube target has no frustum culling of its own — `ObjectRenderer` walks a render
list and dispatches every mesh in it, because a render list is normally
something the caller has already chosen — so a probe drew its whole
neighbourhood once per face whatever each face could see.
`ReflectionSystem.faceOf`, on Babylon's `getCustomRenderList` hook, hands each
face the subset inside the frustum that face is about to rasterise with. It is
`AbstractMesh.isInFrustum` against `scene.frustumPlanes`, which is exactly the
test `_evaluateActiveMeshes` applies to the main pass and is refreshed per face
by `ReflectionProbe`'s own `setTransformMatrix` — so **it cannot move a pixel**,
which is what makes it preferable to every other way of shortening the list:
the radius drops geometry the face would have drawn, `perCell` drops a building
out of the middle of a cube, and this drops only what the rasteriser was going
to clip. Measured over a whole install: **1,469,484 mesh-draws offered and
284,097 issued at 900/300, and 2,120,976 against 394,604 at 1500/0** — 5.2x and
5.4x — with all sixteen banked vantages of the four shipped maps identical to
four decimal places either side. **The queue's budget is deliberately NOT told
about it**: a probe is still priced at `list.length * 6`, so a bake takes the
same number of frames it always did and each of them merely issues far fewer
draws. That is the conservative direction on the one number standing between
this bake and a lost device.

Three numbers in `CONFIG.graphics.reflection` make the rest smaller, each on a
different term, and **all three are no-ops on every map that ships**:

- **`drawsPerFrame` (50,000) spends the bake over frames instead of issuing it
  in one.** A probe is refresh-once, so releasing one is
  `resetRefreshCounter()` and nothing else; `ReflectionSystem.queue` holds the
  ones that have a render list and no frame yet, and `releaseBatch` lets a
  frame's worth go. It rides `onBeforeRenderTargetsRenderObservable` — the hook
  the eye is already borrowed on — because Babylon asks each custom target
  whether it `_shouldRender()` immediately after that observable fires, so a
  probe released there bakes on that frame and one released from `Game.tick`
  would wait for the next. The budget is just over Coldharbour's whole bake and
  that is the whole derivation: the largest thing that ships still completes on
  the frame it always did, so no shipped map's glass moves and the banked
  reference frames cannot either. The 900 m proving ground spends its 1,373,340
  draws over **ten frames of ~2.8 s**, settling eight frames after the install.
  One probe always goes through even when it is over budget on its own, or a
  queue with a fat probe at its head would never drain — and a frame already
  committed to re-baking a probe whose meshes were not ready spends that
  against the budget FIRST. Without that last part a map still compiling its
  pipelines releases batch after batch on top of the ones already thrashing and
  arrives at the same enormous frame by the long way round, which is measured:
  the proving ground re-baked 29 of its first 60 probes and had 116 targets
  live two frames later, against 88 with the accounting in. **A pane whose probe has not baked yet is not a bug and needs no
  wait**: an unbaked cube is alpha 0 everywhere, which is the analytic sky a
  pane shows before any probe has claimed it — the state an editor build leaves
  every pane in permanently.
  **Those frames are the LOADING card's, and that is a state-machine fact
  rather than a rendering one.** `installMap` is one synchronous turn, so no
  frame can render inside it and the whole queue is outstanding when it
  returns; before this the frames spending it were the first frames of `deploy`
  and then of the round — one on every shipped map, and 47 of them over 44.8 s
  at 1500 m, with the player watching. `Game.bakeWait` holds `loading` — a step
  where nothing simulates and the scene still renders — until
  `ReflectionSystem.bakePending` reaches 0, and hands the building card the
  progress figure it never had. It moves the cost rather than removing it;
  `faceOf` above is the half that removes it. **A queue that cannot drain must
  not hang the card**, so the wait gives up on a stalled probe count or a
  backstop clock and lets the remainder land in the round exactly as it used
  to. See [`docs/states.md`](states.md).
- **`radius` (800 m) is the only term in the bake priced on the map's SIZE.** A
  probe's render list is the opaque world within 800 m of it, measured to the
  NEAR SIDE of each mesh's bounding sphere: `distance - radiusWorld`, which is
  what keeps a landform in, because the rim, the ridge rock and the terrain
  patches are single meshes with enormous radii whose centres are nowhere near
  anything. 800 m is past the diagonal of every map in the tree and past the
  longest `fogEnd` any of them declares (Harrowmead's 520), so nothing that
  ships is culled by it, and on a fogged map of any size everything it drops
  was already drawing as flat fog colour against a sky whose horizon is
  `fogColor`. It is the smallest of the three levers wherever it has been
  measured: on the 900 m proving ground it takes a probe's list from 928 meshes
  to 864, which is 7%. What it is really for is a map whose PLAY square is
  1500 m, where the probes are spread over the whole of it rather than over the
  middle 900. What it costs is §10's objection, which has not gone away: a
  culled mesh does not fade, it vanishes, the cube's alpha goes to 0 and the
  shader fills that with sky. On an unfogged map bigger than 800 m that is a
  hole at the horizon of a picture of a street, and it is the price of the map
  being larger than the bake can hold.
- **`poolBudgetMiB` (160) caps the probe COUNT, and it is stated in memory
  because memory is what it protects.** The count is the map's glazing rather
  than its size, so it has no natural bound: past the budget, glazed blocks are
  grouped in twos, then fours, until the pool fits. A probe is 512 KiB at the
  shipped face size and the pool is never disposed, so 160 MiB is 320 probes —
  Coldharbour asks for 40 and the 900 m proving ground for 265 (133 MiB), so
  **nothing in the tree groups anything today** and this is a bounded worst
  case rather than a live lever. **It stops being one somewhere between 900 m
  and 1500 m**: regenerated at 1500/0 the same ground asks for ~500 glazed
  blocks and comes back at `perCell` **2**, 250 probes, which is the first
  grouping anything has ever measured (`FINDINGS.md` 25). What that costs the
  picture has not been looked at, for the reason the enclosure note below gives. What to know before raising it is the enclosure rule below: a
  probe drops every block it SERVES out of its own bake, so a cell of four
  blocks is a probe with 96 m of city missing from the middle of its cube.

**A probe COSTS something to build as well as to bake, and it is not the cube —
it is the whole scene, six times over.** A cube target is six render passes, so
its `ObjectRenderer` mints six render pass ids, and Babylon's
`_createRenderPassId` opens by RELEASING the ids it is about to create over an
array that is still empty. Each of those six `releaseRenderPassId(undefined)`
calls walks every mesh and every submesh of every scene on the engine, to clear
a draw wrapper filed under `undefined` that nothing can ever have written —
`SubMesh._getDrawWrapper` resolves an undefined pass id to the engine's current
one before it indexes. It is provably a no-op and it is priced on the MAP, paid
at the worst moment there is: right after `MapBuilder.build` has put the whole
world in the scene. Measured, it was **1,298 ms on the 900 m proving ground and
6,551 at 1500 m**, against 38 and 72 with the fix in.

**The fix is a scoped swap and it lives in `ReflectionSystem.newProbe`**, which
is the one place either pool mints a probe: `scene.meshes` is handed an empty
array for the length of the `new ReflectionProbe(...)` call and put back in a
`finally`. Two facts make that safe and both are written out at the site — no
frame renders inside `installMap`, and probe construction creates no mesh — and
the second is enforced rather than trusted, because `Scene.addMesh` pushes into
whatever `scene.meshes` is at the time and a mesh lost there is one nothing
ever draws. `ENGINE_UPGRADE.md` S5c and `FINDINGS.md` 25 have the measurements.
**Do not move that swap out to wrap the construction LOOP instead**: the water
pool is minted from a different moment of the same install
(`WaterSystem.build` → `bakeWater`), and minting through one method is what
covers both without either being remembered.

**The probe stands at the centre of the glass it serves.** That puts it inside
the shaft of a tower's wrap-around curtain wall and exactly ON the plane of a
flat shopfront, and both are right for the same reason: a pane only ever
reflects the hemisphere in FRONT of it, so all that matters is that the probe
sees out in every direction its own panes face. For the shopfront that is free
— the office behind it is behind the probe too. For the tower it is what the
enclosure rule below is for.

Seven things about it are load-bearing:

- **A probe's bake leaves out whatever ENCLOSES it, and it asks the BLOCK KEY
  rather than measuring anything.** A mesh is dropped from a probe's render
  list when its `metadata.block` is one of the blocks that probe serves —
  `BlockMerge` and `PaneBlocks` file under the same key, so a glazing group and
  the world it is glazed onto agree on which building they are for free.
  Measured across the 37 probes: 2.1 meshes dropped each, and cube coverage
  falls from 0.84 to 0.57 for a tower and from **0.99 to 0.68 for a parked
  car**, whose probe sits inside its own bodywork. It used to be a bounding-box
  containment test with a flat-receiver exemption bolted on, and both halves
  went at once when the albedo palette took the colour out of the merge key:
  the smallest thing a box test could then remove was a whole 48 m block, and a
  box test cannot tell a tower's probe standing in its own shaft from a water
  probe floating in open marsh inside the same block's extent — which is
  exactly what put sky in Greyfen's flood where the near treeline should be.
  The exemption is now kept by construction and needs no test: the terrain
  patches, the roads and the valley rim are not block-merged, so they carry no
  key and can never match one. **It takes a SET of keys**, because a probe past
  the pool budget serves more than one block; on every map in the tree the set
  holds one.

- **The bake draws no sky and no glazing, and the cube's ALPHA is what says
  so.** It clears to a transparent black and every cel variant but the glazing
  writes alpha 1, so a texel is 1 where the bake drew world and 0 where it saw
  nothing — which is exactly where the sky gradient above is what a pane should
  show. The shader composites on that alpha and un-premultiplies by hand, the
  same arithmetic and for the same reason as the Fresnel composite. The dome is
  left out because it rides at `infiniteDistance` and the box projection below
  would drag it around with the viewer; the panes are left out because a
  blended draw over a transparent clear comes back already multiplied.
- **The mirrored ray is parallax-corrected against the map's own extent**
  before it samples. A cube sampled with the raw ray behaves as if everything
  in it were infinitely far away, so the city in a pane would sit still while
  the player walks past it — a decal rather than a reflection. The box is not
  an approximation of anything: it is the boundary the four rim colliders
  already are, floor to tallest roofline.
- **The sample direction is flipped in Y**, and it is not a correction to any
  of the above. A cube face is stored top-down while a framebuffer is bottom-up,
  so a cube rendered into comes out mirrored about the horizon; Babylon says as
  much by giving a cube render target `INVCUBIC_MODE`, and its own reflection
  path spends `INVERTCUBICMAP` on the same line. Getting it wrong puts the
  pavement where the sky belongs, which reads as glass that is merely too dark.
- **The bake borrows the shader's eye and gives it back once, around the whole
  render-target block.** Every cel material fogs and rims against `camPos`, so
  each probe renders with it moved to that probe — and the restore hangs off
  `scene.onAfterRenderTargetsRenderObservable` rather than off each probe,
  because 37 bakes would otherwise be 37 chances to put it back wrong. The
  first version of this hooked each face and re-read the eye on every one of
  them: by face 1 the eye already IS the probe, so the whole cache came out of
  the bake holding it and the main pass of the install frame fogged the map
  against a point in the middle of it. Both hooks are guarded walks, so on the
  thousands of frames that bake nothing they are a vector copy and a compare.
- **Probes are pooled and never disposed**, like the bot rigs: one is six scene
  uniform buffers and a cube. A map with fewer glazed blocks than the last
  leaves the spare probes parked with an empty render list.
- **An EDITOR build parks every probe and bakes nothing**, which is not a
  saving so much as the feature's own premise being withdrawn. A bake is
  affordable because it is a BUILD STEP over a static world, and the editor is
  the one place in the game where a build is not rare — every tier-3 rebuild
  would buy another. It is also worse there from both ends: `PaneBlocks` keys
  per PLACEMENT on an editor build, so Coldharbour's 40 glazed blocks become
  82, and the render list is the unmerged visuals. Measured: 40 probes over 405
  meshes in a round against 82 over 610 in the editor, which came to one frame
  of ~300,000 draw calls after every param edit, add, delete or brush stroke,
  against ~500 with the skip and a steady editor frame of ~420 either way — a
  parked probe renders nothing, so the steady frame never had a reflection in
  it to lose. What the editor gives up is the city in its glass: a pane keeps
  the material `MapBuilder` gave it, which holds the default cube at strength
  ZERO, so it shows the analytic sky half and no more. That is the state a pane
  is in before any probe claims it rather than a new one, and it is the right
  trade in a view that already strips the map's night back to a work light.

The remaining approximation is that a probe serves a whole block: a pane
returns the right city seen from the middle of its own block rather than from
the pane itself. `graphics.reflection.strength` (0.9) is deliberately short of
1 for that reason — the last tenth is what lets a player catch it out by
walking along a frontage. The alternatives were a probe per pane (6,139 of
them) and a screen-space pass, which cannot answer the question the feature
exists for at all: a pane you are looking at reflects what is behind YOU. A map
with no glazing bakes nothing; the default cube stays bound to the glazing
material regardless, because a `samplerCube` with nothing on its unit is
undefined behaviour rather than a black fetch.

**The Fresnel is deliberately NOT banded**, alone among the terms in this shader.
A band edge on a flat sheet is a contour drawn where the view angle crosses a
step and nowhere else, so it would slide across the glazing as the player walks —
exactly the artefact the rim light is gated off level surfaces to avoid, and for
exactly the same geometric reason. The water's fresnel is smooth and is the
precedent; the dither is what keeps the ramp from banding on its own.

**Glass is not outlined and casts no shadow**, and `MapBuilder` marks both on the
merged pane meshes. The shadow half is obvious once the pane is see-through. The
ink half is mechanical: Babylon draws an outline as an inverted hull BEFORE the
mesh and keeps it out of a transparent mesh's own area with a stencil pass, and
this engine is built with no stencil buffer at all (`main.ts`, beside the
`initAsync` call), so the shell is not a ring around a pane but a dark plate
behind the whole of it. **That flag does one thing more under WebGPU than it
used to and it is not about stencilling at all: it picks the DEPTH FORMAT.**
False gives `depth32float`, true would give `depth24plus-stencil8`, and
`depthBias` is defined in a different unit for a float format — so turning
stencil on to get a ring around a pane would silently re-tune
`GLASS_DEPTH_UNITS` and both of the outline geometry rules below with it. It is
one flag and three measurements; `plans/webgpu-ref/depth.mjs` re-takes two of
them.
A window's frame is drawn by the mullion, the collar and the reveal, all of which
are geometry the ink finds on its own. See-through glazing writes no depth, so
`CelInk` never finds a pane at all — which arrives at the old rule that nothing
outlines a pane, by construction rather than by exemption.

**The receiver's depth is the raw clip z, and getting that wrong is invisible
as a shadow bug.** Under WebGPU `engine.isNDCHalfZRange` is true, so a
clip-space z is already in [0, 1]; `DirectionalLight.getDepthMinZ/MaxZ` return
0 and 1 there, which makes Babylon's `depthValuesSM` (0, 1) and the caster
metric its shadow-map shader writes `(position.z + 0) / 1` — the raw clip z.
`shadowVisibility` compares against exactly that and its range gate is [0, 1].
The GLSL form, `(clip.z + 1) * 0.5`, is correct under WebGL's [-1, 1] depth and
was carried through the WebGPU migration verbatim, where it is an error of
`(1 - z) / 2` — half the depth range at the near plane, zero only at the far
one. What it did was decide EVERY texel inside the window against the receiver:
a fragment on the focus plane sits at z ~ 0.51 and was tested as 0.76 against a
caster depth of 0.51. So the depth map settled nothing, no bias could reach it,
and what a player saw was not a missing shadow but a POOL OF SHADE that
travelled with them — the window's edge drawn as a hard line between everything
shadowed and everything lit, because the function returns 1.0 outside it. It
read as an art direction on the night maps and was unmissable on Sarab, where
the ground is bright sand and the window is 150 m of it.

**The third row of the table below was measured under that bug**, so it says how
much of each frame was inside the window rather than how much of it was in
shadow; the first two rows are a kernel-vs-no-kernel difference and are
unaffected. Re-take the row before quoting it.

**The shadow lookup is FOUR taps, and four is a ceiling rather than a budget.**
One tap put the depth map's own grid on screen — at 110 m over 2048 texels an
edge climbs in 5.4 cm steps — so the kernel spans exactly one texel, which is
the period of that staircase. Anything wider starts producing a real penumbra,
and a penumbra is the one thing the flat bands cannot have. The 2x2 is rotated
per pixel: four taps averaged give five values, five values along an edge are
five contours, and the rotation turns that residue into noise instead. Measured
as a containment check by collapsing the radius to zero (which makes all four
taps the same fetch, i.e. the old lookup), at each map's committed vantage with
the whole post chain off:

| | Hollowmere | Greyfen | Coldharbour | Harrowmead |
| --- | --- | --- | --- | --- |
| the kernel moves | 0.12% | 0.60% | 0.39% | 0.42% |
| peaking at | 31/255 | 105/255 | 119/255 | 69/255 |
| of a frame in shadow at all | 32.7% | 40.0% | 7.2% | 26.8% |
| so, of the shadowed area | 0.4% | 1.5% | 5.4% | 1.6% |

A large change on very few pixels, which is the shape of something confined to
boundaries rather than spread over a penumbra — the third row is what makes that
readable, because Coldharbour's frame is a tenth in shadow and the other three
are a third. (The earlier single figure was 0.33% peaking at 55/255, taken on
WebGL2 at one unrecorded vantage.)

**A frozen vantage holds NO shadowed pixel until the window is pushed to it, and
the reading that comes back is 0.000% on every map.** The shadow window follows
the player, `updateWorld` does not run under the deploy lid the reference poses
are taken from, and outside the window `shadowVisibility` returns FULLY LIT — so
a camera teleported to a vantage is looking at a lit world and every shadow
measurement reads as a kernel that does nothing. `g.shadows.invalidate()` then
`g.shadows.update(cam.position, g.mats)` before the grab is the fix, and the
control that proves it landed is setting the darkness term to zero: that is the
third row above, and if it comes back 0% too then nothing is being measured.

**Grass and water sample that same depth map, and they are not cel materials.**
They reproduce the cel lighting model in their own shaders and went without a
shadow term entirely, which showed as a cottage's shadow stopping dead at the
edge of a grass rect and at the waterline. The lookup and the band function are
shared so all three sample one depth map with one kernel — the WGSL includes
`celShadow` and `celBand`, taken by all three.
`CelMaterialFactory.registerShadowConsumer` /
`unregisterShadowConsumer` is how a non-cel material joins the three per-frame
uploads. **Registering is half the contract and unregistering is the other
half**: grass and water are rebuilt every round, and a material left registered
after its `dispose` takes uniform writes for the rest of the session. Water
offsets its shadow sample along the FLAT up-vector rather than the wave normal,
for the same reason the cel shader offsets along the facet rather than the
bumped normal — the relief is a fiction, and the shadow must not move with it.

**Every surface shader dithers its own output, and the grade is the wrong place
for it.** The chain is `hdr = false`, so the scene is quantised the instant it
lands in FXAA's input target, and the fog and mist ramps are shallow enough to
cross a quantisation step every few degrees of screen — measured at contours
nearly **seven pixels wide** on a plain village wall. `shaders/Dither.ts` adds
one LSB of triangular noise immediately before `fragmentOutputs.color` in the
cel, grass and water shaders — registered as the `celDither` include — which
takes those contours to ~2 px. It is deliberately *not*
in `PaperGrain`: that pass is detachable by a player setting, so the banding is a
**grade-off** artefact, and the grade-off frame is the one a pass inside the
grade cannot reach. **The old screen grain happened to be a ~10 LSB dither
wherever it was attached, and the paper is NOT** — measured on Hollowmere, the
paper moves 0.7/255 RMS in the darkest band and 5.5 in the brightest, and the
lit sheet below is what put the dark end there deliberately. That changes
nothing: the dither was never in the grade, and the fix is at the source. The sky dome was the expected customer and measured as not
needing it (233 runs against 229): stars, the galactic band and the halo are
painted over the whole ramp, and the clouds stand in front of it.

The exceptions are the THREE `DirectionalLight`s, which no material reads: each
exists only to define a shadow camera for its `ShadowGenerator`.
`ShadowSystem`'s is the world's and it owns a second, the foliage's (see below);
`BodyShadows`'s is the bodies'. The last two are pinned to layers no world mesh
carries (`includeOnlyWithLayerMask`), so neither can reach a `StandardMaterial`. The cel fragment shader samples
both depth maps as one hard two-level term gating the key light. The world's
window follows the player (texel-snapped, re-rendered only when the snapped
focus moves), casters are the map's merged static meshes re-registered every
round via `shadows.setCasters(map.visuals)` (skipping anything flat with
`metadata.noShadowCaster`).

### The world's map records BACK faces, and the foliage has a map of its own

**The world's depth map stores the FAR side of every caster**
(`forceBackFacesOnly`), and its bias is **5 cm, stated in metres**
(`CONFIG.graphics.shadows.bias`, converted to normalised depth by
`core/shadowWindow.ts`'s `depthBias`). It used to store front faces with a bias
of 0.0035 of normalised depth — **63 cm** over the 179 m volume, a number nobody
would have chosen in metres — and every metre of a bias is a LEAK: a receiver
within that distance of its occluder, along the light, tests lit. At Greyfen's
28-degree sun that was a lit band ~30 cm deep under every eave, with a
saw-toothed shadow edge below it that was the bias contour drawn across a depth
map stepped per texel, not the roof's outline. It was that big to hide ACNE on
roofs, which is a front-face map comparing a lit surface against its own depth.
A back-face map compares it against the far side of its own wall or roof
instead, a thickness behind it, so there is nothing to hide. Measured over every
committed vantage and three roof views on five maps: the change is darker
pixels (leaks closing) and **no roof went lighter by more than 0.1% of a frame**.

**What it asks of the casters is that they are CLOSED.** Every piece the kit
builds is — boxes, capped cylinders, the gable prism. An open sheet in the
caster list would record only the side facing away and cast from there.

**The sample is offset TOWARD the light, whichever way the facet faces**
(`shadowVisibility`). On a face turned away from the key, the facet normal
points away from it, and a back-face map records that very face — so offsetting
along the normal steps the sample behind the surface it came from. The light's
travel direction is row 2 of `lightMatrix`, so the flip needs no new uniform in
any of the three consumers.

**THE TRANSLUCENCY TERM IS THE ONE THING THIS BROKE, AND WHY IS WORTH KNOWING
BEFORE TOUCHING EITHER.** A pine's lit rim and a broadleaf's backlit glow were
never a rule: they were the 63 cm leak letting the back of a crown test lit near
its lit face. A back-face map cannot say how much crown the light crossed —
a face turned away from the key IS its recorded surface — so with back faces
alone every shaded face tested lit and the crowns went blotchy (the blotches
being the back surface's own acne, invisible under the key's zero and visible
to this term alone). An edge rule on the facet cosine was tried first and
failed on the broadleafs, which are BOXES: a box face has one cosine, so at a
14.5-degree sun almost every shaded face read as the deep middle of the crown.

**So the foliage has a third map** — `ShadowSystem`'s own second light and
generator, over the same window and focus, recording the FRONT faces of the
translucent SOLIDS and nothing else (`CelMaterialFactory.isSolid`: a
`TranslucencySpec` that states a `depth`). A solid's translucency is lit where
the face lies within `depth` metres behind the first lit foliage along the
light, AND the world's map says nothing else is nearer than that same allowance
— the loose gate, so the back surface's self-comparison always passes and a
wall between the tree and the moon, metres nearer, still does not. A sheet (an
awning) states no depth and keeps the surfaces' own shadow term.

**`depth` is 1.5 m and not 0.63, and the difference is the map, not the trees.**
At 1024 texels over a 200 m window a pixel is ~20 cm, and a cone's steep side
changes depth by half a metre or more across one; the four taps read the
nearest of those. 0.63 at 1024 left the crowns darker than they shipped; 2048
matched at ~1.0 m; 1024 matched at 1.5 m for a quarter of the memory. **Raise
the map and the allowance comes DOWN with it** — they are one setting read
against the reference, not two.

**What it costs**, measured on the Windows box with both maps forced to
re-render every frame, frame limiter off: **~0.04 ms a frame on Coldharbour**
(10 foliage casters in the window) and **~0.13 ms on Harrowmead** (58). Those
are 2% and 7% of a bare scene-render frame of under 2 ms, and a real round's
frame is several times that. The map is 1024² half-float RGBA, 8 MB.

### The bodies' map: why soldiers and hulls have one of their own

**A rig is not a caster in the world's map and never will be.** That pass
re-renders only when its texel-snapped focus MOVES, which is the whole reason
~150 static casters are affordable; one animated caster in its list turns it
into a per-frame redraw of the village. So the bodies got a second map
(`systems/BodyShadows.ts`), re-rendered every frame, carrying soldiers and hulls
and nothing static.

**It buys two things beside the shadows.** Its window is sized to the BODIES
rather than to the map — 48 m over 1024 texels is **4.7 cm** against the world
map's 5.4 at a quarter of the area, so a body's shadow is drawn finer than the
wall it falls on. And it can cull front faces without the world having to.

**ONE DRAW CALL carries every body in the game**, because every proxy is a thin
instance of one unit box: a soldier is ten instances and a hull is one. So the
pass costs the same at 8v8 and at 24v24, and what scales is the matrices.

**A soldier's ten boxes are `RAGDOLL_BONES`, and that is load-bearing rather
than convenient.** They are already measured against the drawn geometry ("the
glove trimmed off the end") and already hang off the joints the pose drives, so
the shadow follows a crouch, a stance, a turn and a RAGDOLL for free —
`RagdollSystem` reparents those joints onto Havok proxies and the shadow goes
with the corpse without `BodyShadows` knowing physics exists. A hand-authored
capsule would have been a pill sliding along the ground under a walking body,
which is the artefact the blob disc already is.

**BACK FACES ONLY (`forceBackFacesOnly`), and without it every soldier and every
hull is a black cut-out.** A proxy box ENCLOSES what it stands for, so a body's
own visible surfaces are inside their own caster: recording front faces puts
every one of them behind the depth it is compared against. Recording the far
side instead makes a surface inside the box test LIT and the ground behind the
body test shadowed, and the boxes are closed and convex so there is no case
where that is approximate. Limb-on-limb self-shadowing survives it and is
wanted — an arm's box is in front of the torso, so its back face still is.

**The blob discs STAY, and they are the contact term now rather than the whole
shadow.** What back faces give up is the few centimetres between a boot's near
and far faces — exactly where the eye looks for the body to be touching the
floor — so the pair is what a renderer normally spends an ambient-occlusion term
and a shadow map on. Suppressing the disc where the cast shadow covers the same
body would put that gap back.

**None of its numbers transfer from the world's map**, which is the mistake to
avoid when editing either: the tap radius is in UV and a UV texel is
`1 / mapSize` (1/1024 against 1/2048), and the bias is 13 cm against the
world's 5 — both in metres now (`depthBias`), so a number copied across at
least means the same distance, but the two maps have different reasons for
theirs. Copying the tap radius across is still a 2x-wide kernel — a soft shadow
floating off its own body. `bodyShadowParams`
carries its own pair; the DARKNESS and the facet offset are not restated,
because a shadow is a shadow whichever map resolved it and the offset is a
property of the receiver.

**The two terms combine with `min`, in LIT space, before the darkness mix.**
Either occluder is enough; each map answers lit outside its own volume and ramps
back over its own `edgeFade`, so neither boundary can darken past the other.
Multiplying two 0.15 terms would give 0.0225, which is a black hole where a
soldier stands in a doorway's shadow. Moving the darkness mix out of the tap to
allow that is exactly equivalent rather than nearly — `mix(dark, 1, x)` is affine
in `x` and fixes `x = 1` — so a frame with nobody in it is unchanged.

**The consequence is that on a map already in shadow the body term measures
ZERO, and that is the right answer rather than a broken one.** A/B'd on Greyfen
— a jungle valley whose canopy puts nearly the whole frame in shade, measured as
98.8% of pixels moving when the world's casters are removed — switching the body
casters off changed **nothing at all**. Empty the WORLD's map first and the same
A/B reads 0.38% of pixels at a localised mean of 14.5/255 where a body stands.
Anyone measuring this on a shaded map needs that discriminator or they will
conclude the feature is inert.

**What does not cast.** The LOCAL PLAYER, who has no rig to read in first person;
they keep their contact disc. And a FLYING hull far enough up that its shadow
lands outside a 48 m window — a gunship 40 m up throws 150 m along a
14.5-degree sun, which no window a client can afford contains. It casts when it
is low, which is when a player is under it.

**Measured cost, Sarab at 1920x1080 with 47 bodies staged inside the window (246
instances — the `maxBodies` cap of 24 bodies plus six hulls), three interleaved
passes of 6 s**: mean frame 7.824 ms as shipped, 7.763 with the pack stubbed,
7.771 with the pass unscheduled. So the CPU half reads 0.061 ms and the whole
pass 0.053 — **under a tenth of a millisecond at the worst roster in the tree,
and at the edge of what that instrument resolves** (the per-pass spread is
comparable). Read it as free and re-measure before believing any figure smaller
than the spread.

**The depth pass draws only the casters standing in the window, and has to do that
culling itself.** Babylon culls nothing off an explicit `renderList`:
`ObjectRenderer._prepareRenderingManager` dispatches every enabled, visible mesh in
it, so the pass was submitting the whole village on every re-render — 314 casters and
79k triangles against the ~150 that can reach a 110 m window.
`ShadowSystem.cullToWindow`, hung off the shadow map's `getCustomRenderList`, is the
fix, and it is **lossless rather than a quality trade**: the light is orthographic,
so a caster's shadow lands at its own position in the light's plane and a box test
there cannot drop anything that could have darkened a texel.

**The window's size is the MAP's, not the config's** — `CONFIG.graphics.shadows.
frustumSize` (110) is only the default, and `EnvironmentSpec.lighting.shadowWindow`
is the override (Coldharbour: 200, Sarab: 240). It had to become one when a map
lowered its sun: shadow length is `h / tan(elevation)`, and the same 40 m tower
throws 25 m at 58 degrees and 90 m at 24. **Outside the window
`shadowVisibility` is fully lit, and the last `CONFIG.graphics.shadows.edgeFade`
of the volume is what stops that being a LINE** — the whole term ramps back to
1.0 over the outermost tenth of the box, on all three axes at once, so the
boundary is a gradient the eye takes for distance haze. Measured on Sarab
standing on open sand: before the ramp, full shadow to 74.8 m across-sun and
nothing at 74.8 m — the same number three times, which is what a step reads as;
after, full to 97.3 m, half at 108 and gone by 120. **What the ramp does not do
is decide where the boundary IS**: that is still the window, and a map whose
window ends inside ground the player can see just gets a smoother transition in
the wrong place. Both halves are needed, which is why Sarab's window moved with
the ramp landing.

Two consequences of the geometry, both easy to get backwards. The window is a
square perpendicular to the LIGHT, so its ground footprint stretches by
`1/sin(elevation)` along the sun's azimuth — which means a low sun improves the
along-sun reach for free, and along that axis it is `depthRange` rather than
`frustumSize` that binds. And the price is texel density, `frustumSize /
mapSize`: 5.4 cm at 110, 9.8 cm at 200. The four-tap kernel is sized in TEXELS
so it still cancels the staircase, but the range over which an edge is sub-pixel
scales with it. `mapSize` stays global — it is fixed at `ShadowGenerator`
construction, and raising it is four times the fill on a pass that re-renders
whenever the snapped focus moves.

The count above is Hollowmere's; note both numbers move with the window, since a
200 m square straddles roughly twice the 48 m blocks a 110 m one does.

**The blob shadows do not probe for the player's ground; they are handed
`Player.floorY`.** `Player.probeGround` was a whole-scene ray pick — 1,775 meshes
walked and 758 solid colliders tested for one number — and `ShadowSystem` used to
cast the identical ray for the identical body on the same frame. The probe is
analytic now and the field survives it: two callers re-deriving the floor are two
opinions about where it is, however cheap each one is. Anything wanting the floor
under the player reads that field rather than probing again.

### The shadow rungs: one setting, four maps

**`Shadows` is one setting over all four shadow maps** — the moon's world,
foliage and bodies maps and the lamps' atlas below — and `?shadows=` overrides
it for a session on `?gi=`'s terms. The rungs are two tables,
`CONFIG.graphics.shadowTiers` (the moon's three) and
`CONFIG.graphics.localShadows.tiers` (the lamps'), and they must name the same
rungs because `ShadowQuality` is derived from the first and indexes the second.
A fresh install on a coarse pointer gets `low`, on `defaultGiQuality`'s test.

**A map that is OFF is a bound 1x1 LIT texture, never an absent one**
(`core/shadowWindow.ts`'s `litShadowTexture`): every `celShadow` consumer
declares every shadow sampler, and a declared sampler with nothing behind it is
a bind group that fails to build. It is 8-bit RGBA on purpose — 255 reads back
as depth 1.0, past every receiver, and a 32-bit float is not filterable under
WebGPU. A rung change REBUILDS a generator at its new size (a
`ShadowGenerator`'s size is fixed at construction) and re-adds the casters
`setCasters` last handed over; a map whose size did not move is left alone.
**The sizes start at -1, not 0**, because 0 is off's own size and a first
`setQuality("off")` that compared equal to it bound nothing at all — measured,
every cel material's bind group failed and the round never left `loading`.

What each rung spends, and why the phone's is shaped the way it is, is argued
on `shadowTiers` in `config/graphics.ts`.

### The lamps' shadows: one atlas, split by refresh rate

`systems/LocalShadows.ts`. Before it the sixteen point lights had no shadow map
at all — their only occlusion was the volume's per-probe visibility bit
(`giPointVis`), 2–3 m coarse, blind to bodies, and gone with bounce light off.
It still answers for every slot the atlas does not hold.

**One atlas, because there is no binding left for a map per light.** The cel
shader's heaviest variant (a ground texture with its bump) bound twelve
textures against WebGPU's default sixteen before it — the atlas is the
thirteenth and the lightning's map the fourteenth; the glazing variant, which
swaps those two for its reflection cube, is at thirteen. So every shadowed lamp is reached through ONE texture: a
point light is six square cube-face tiles, a spot is one, and `celShadow`'s
`localLayer` picks the tile off the slot's base and the face the receiver is
on. **The face order (+X −X +Y −Y +Z −Z) and each face's frame (`faceFrame` /
`localUp`) are written twice, in `LocalShadows` and in the include, and must
agree** — a mismatch is a shadow drawn on the wrong side of the lamp.

**The lamps are split by REFRESH RATE, which is the moon's rule.** A FIXTURE
(`lighting.add`, `shadow: "fixture"` by default) has a STATIC layer — the map's
real visual meshes, culled per face to the light's sphere — baked once and kept
while the light holds its tiles, and a DYNAMIC layer of bodies and hulls,
redrawn every frame, only while one is within reach. The shader takes the `min`
of the two, exactly as the moon's world and body maps. A light that MOVES
(`moving`, and `blast` on the rungs with `transients`) has nothing static to
keep, so all of it is dynamic — and it is affordable because a moving light's
casters are PROXIES: collider boxes, `rayGroups` struts, `RAGDOLL_BONES` and
hull boxes (`core/proxyBoxes.ts`), all thin instances of one unit box. **Every
dynamic tile in the frame is ONE draw**, whatever it holds. The phone rung
bakes its fixtures from proxies too (`meshes: false`) and holds its dynamic
tiles for two frames (`every`).

**One pass fills many tiles because the projection is not Babylon's.** The
depth vertex stage builds the face's own perspective and then SCALES AND
OFFSETS clip space into that face's tile of the atlas — affine in `w`, so it
commutes with the divide — and the fragment stage discards whatever fell
outside the face's frustum, the per-tile clip the hardware can no longer do. A
proxy's instance names its tile (`tileId`); a mesh cannot, so a static bake is
one pass per face with the tile as a uniform, **one material per face in
flight** (`staticFacesPerFrame`) so no uniform buffer is rewritten between two
passes of one frame.

**Nothing clears the atlas but the clear sheet.** A static tile survives every
pass that does not redraw it, so the render target's own clear is replaced by
an observer that clears only a NEW target; each pass's tiles are reset first
by a sheet of one quad per tile, collapsed to nothing where its flag is 0,
drawn at depth ALWAYS in a pass of its own. The work `update` lays out is
CONSUMED by `render` — a state that runs no `update` must not re-bake last
frame's queue every frame.

**A tile stores RADIAL distance over the light's range, from BACK faces**, and
the receiver is offset along its true facet toward the light — the moon map's
two rules, for its reasons. `nearClear` (0.35 m) is every face's near plane
and the proxy gather skips any box the light stands inside: a lantern is in its
own housing, and recording that as an occluder puts the whole light out.

**A slot is published only once its layer is DRAWN** — a static layer when its
last face is queued (the queue is drawn in the same frame, before the main
pass), a dynamic one after its first pass. Until then the slot keeps the
volume's visibility, so a lamp walking into the shadowed set does not blink.

**The lookup is only asked INSIDE a light's range.** It was first asked for
every shadowed slot on every pixel, and on Hollowmere that alone was the whole
cost of the high rung.

**Ranking.** Of the slots `LightingSystem` filled, moving lights outrank
fixtures (a moving shadow is the one being watched, and a fixture's is the one
cheaper to lose), then distance past each light's own reach; a light already
holding tiles keeps `keepMargin` metres of preference so two fixtures either
side of the eye do not trade a static cache every frame. A light the atlas
cannot fit is not shadowed that frame — never a partial one.

**Cones.** `PointLightData.spot` makes a light a spot, and the cone is owed
WHATEVER the rung — `publish` writes every slot's cone before it asks whether
the slot casts. Grass and water read the same per-slot arrays, which the
factory hands out by reference and `LocalShadows` rewrites in place.

**What it costs.** Measured on the RTX box, uncapped, a lamp-lit street with
eight soldiers round the lamp and a moving spot walking beside it:

| map | rung | GPU frame | frame | draws |
| --- | --- | --- | --- | --- |
| Hollowmere | off | 2.55–2.70 ms | 2.93 ms | 187 |
| Hollowmere | high | 2.71–2.76 ms | 3.13–3.18 ms | 190 |
| Cinderhaven | off | 2.68 ms | 2.88 ms | 181 |
| Cinderhaven | low | 2.77 ms | 3.08 ms | 183 |
| Cinderhaven | high | 2.79 ms | 3.16 ms | 184 |

`LocalShadows.update` is 0.06–0.07 ms of CPU. "off" there has the moon's maps
off too, so the gap is the whole shadow budget, not only the lamps'. Nothing is
measured on a phone — `FINDINGS.md` 45.

### Lightning

`systems/LightningStrikes.ts`, a map's `EnvironmentSpec.lightning` (absent is
none; Cinderhaven's volcano is the one that has it). **A strike is a SCHEDULE
read off a clock, never a timer**: seeded off the map's id, and the clock is
the authority's in a match (`Connection.now`), so every client flashes
together and nothing crosses the wire. It is pushed from `tick` in every
state — weather does not stop for a menu.

**A flash is a SECOND KEY with a depth map of its own, and the moon never
moves for it** (`CelMaterialFactory.setFlash`, `ShadowSystem.flash`,
`celShadow`'s `flashLight`). The map is the world's casters drawn ONCE along
the strike on the frame it starts — render-once, back faces, its own window
round the moon's focus, at most 1024 texels — and the term is banded like the
key and black between strikes, which is its early-out. It costs one texture
binding, which is why it was not the first design: the flash used to TAKE the
key's direction for its length and re-aim the moon's maps along it and back.
That was two re-renders a strike, a moon lit from the wrong side for the whole
of the envelope's 0.4 s tail, and moon shadows visibly snapping back after the
flash had gone — which is what a player saw. The flash's own colour and
direction are held BY REFERENCE (like the key's, which `setEnvironment` now
copies into rather than replaces), so nothing is walked per frame. Bodies are
not in the flash's map: a strike is half a second, and the moon's body map
still shades them. On the `off` rung the map is the lit 1x1 and a flash lights
without shadows.

The rest of the flash: the volume's reserved `giExtra.y` is now the SKY FILL —
`giSkySeen` reads the probes' own sky visibility, so a street goes white and
the parlour off it does not (with no volume, everything counts as seeing the
sky); the dome takes the flash as an emissive colour laid over its texture and
the clouds on both lit tones. Thunder is `Sfx.thunder`, synthesized, delayed
by the distance at the speed of sound (queued, not scheduled — `docs/audio.md`).

**The schedule is cut into EPOCHS and a clock SEEKS into one, never replays to
it.** Online the clock is the authority's epoch time in seconds (~1.8e9), and
the first version replayed the sequence from zero on the first frame of a
match: fifty million strikes, ~6 s of frozen client on the desktop. Each epoch
(`EPOCH`, 600 s, or eight of the map's longest intervals) is seeded from the
map's seed and its own index, so every client lands on the same strike from
the clock alone, and a clock that steps either way costs one epoch's strikes.
A strike's identity is its `at`, so a seek that lands mid-flash raises its
thunder once and not again.

### The light slots

Lights come in three flavors: static fixtures (`lighting.add()`, registered by
`MapBuilder` from a builder's `LocalLight` list or a scatter prop's entry in
`SCATTER_LIGHTS`), transient pulses (`lighting.pulse()` — muzzle flash), and carried
lights (`setCarried()`/`removeCarried()`). Transient and carried lights always get a
slot; static fixtures compete nearest-first. **That is why bot muzzle flashes are
budgeted**: 16 bots firing would take all 16 slots with transients and black out the
village's lanterns, so `BattleSystem` only records flash positions and
`Game.spendMuzzleLightBudget` spends `CONFIG.lighting.muzzleBudgetPerFrame` on the
nearest few. Any new per-bot transient light needs the same treatment. Fixture
lights are hand-placed and must stay **spatially spread** — clustering lanterns
wastes slots and flattens the darkness.

## The water: a mirror with a body under it

**Everything about how water is drawn follows from one sentence — it is a
mirror with a dark body under it, and which of the two you see is the angle you
are standing at.** Getting that wrong is what made every earlier version of
`WaterShader.ts` read as painted plastic, and the failure is instructive
because the code looked reasonable: the body colour was a Fresnel between a
"deep" and a "shallow" palette entry, with the shallow one described as the sky
sheen. A Fresnel saturates within a few degrees of the horizontal and a pond
seen from its own bank is never anything else, so the whole surface returned one
flat colour from every vantage a player has. The fix was not a better tint. The
grazing end of the Fresnel has to return a PICTURE.

The composite, in order: the **body** (deep graded toward shallow over a shoal
and then toward the map's own `floorColor` in the last few centimetres, off the
baked bed-depth map, lit by the same banded key, ambient and sky fill as the
ground it sits in); the **mirror** (the map's own dome gradient with the light's
glare in it, and a picture of the world composited over that out of a cube
probe); **Schlick** between them; the **glint**; the **foam**; the
**atmosphere**, copied term for term from the cel shader.

### The wave field is analytic, and that is a rule

**There is no normal map and there must not be one again.** The surface was
three scrolled, rotated, mutually-warped layers of a tiling fBm normal map, and
every one of those adjectives was a defence against the same thing: a lattice
sampled on a plane the size of a valley is a lattice you can see. Three rules,
a tuning floor on the wave scales that existed purely as a sampling limit, and a
committed 512px PNG, all so that a repeating image would not look like one. It
looked like lichen anyway — cloudy directionless mottling, which is what fBm is
and is not what water is.

A sum of directional wave TRAINS has no lattice, so none of those rules exist.
What replaces them is `waveDetail`, which is not a tuning at all but a sampling
criterion: `fwidth(vPosW.xz)` is how many metres of world a pixel covers, so a
train under a few pixels per wavelength is faded out because it cannot be drawn
— at any resolution and any field of view, with no second number to keep in
step. Three details in `waveField` are load-bearing and each is argued in the
file: `exp(sin(x) - 1)` rather than `sin(x)` (crests are narrow and troughs are
flat, and its derivative is itself times `cos`); each train dragged by the phase
of the one above it (six sinusoids at fixed bearings still beat on a period you
can see); and deep-water dispersion, `speed *= sqrt(lacunarity)`, so the ripples
crawl while the swell rolls — give every train one speed and the field slides
across the pond as a sheet, which is the most obvious scrolling-texture tell
there is. Bearings are spread by the golden angle and not evenly, because six
even bearings are a hexagonal lattice by another name.

**The far field is allowed to flatten, and it was not before.** The old shader
faded its fine layers but never its swell, because a flat surface has one
specular answer over its whole area and that arrives as a hard white sheet. That
is true of a shader with no reflection in it. With one, distant water that
flattens toward a mirror returns the sky and the far bank — which is what a lake
does — so the trains fade against the FULL amplitude rather than being
renormalised over the survivors.

### The mirror, and the three ways it can be got wrong

**A cube probe per water body, no parallax, explicit LOD.** All three halves of
that were measured into place on Harrowmead, and each of the other choices
produces a flat wash that looks exactly like a broken sampler:

- **The LOD has to be explicit.** A cube direction's screen-space derivative
  across a grazing water pixel is enormous, so the hardware's automatic choice
  is the bottom of the mip chain and every sample comes back as the cube's
  average colour — one flat colour, on every map, at every angle. It is driven
  from the wave field's own `resolved` fraction instead, which says the physical
  thing: ripples too fine to draw are roughness, and roughness blurs a
  reflection.
- **There is no parallax correction, and that is the opposite of the glazing.**
  A pane is vertical and a player walks ALONG it, so the correction is the whole
  feature there. Water is horizontal and its probe stands ON it, so the
  reflected ray leaves at a few degrees and what it can reach is the far
  surround — the ridge, the wood, the roofline — which is far enough that an
  infinite-distance cube is very nearly right. Correcting THAT against a box the
  size of the map is actively wrong: a ray at eight degrees crosses two hundred
  metres before it clears the roofline, so every pixel is re-aimed at the same
  far exit point and the reflection collapses to one colour.
- **The sky half cannot be a two-colour lerp.** The glazing gets away with
  `mix(fogColor, zenith, ...)` because a pane is a few square metres and its
  Fresnel is weak. A pond is a third of the screen and its Fresnel is 1 at every
  angle a player looks at it from, so whatever that function returns IS the
  water — and a sunset sky is not a gradient between two colours, it is a warm
  band about twelve degrees up with a cooler zenith over it. `domeAt` is the
  same four stops `Sky.paintDomeTexture` paints, which is why `WaterEnvSpec`
  needs no sky colours of its own.

`ReflectionSystem.bakeWater` holds a **separate probe pool** from the glazing's,
because the two are baked at different moments of one `installMap` and `build`
parks everything it owns on the way in. The site is not the rect's centre — a
rect is its extent and not its shore, and Greyfen's flood is one 250 m rect of
which 11% is wet — so `WaterSystem.bakeDepth` hands over the depth-weighted
centroid of the WET cells it found on its way past. Editor builds park the
probes and return strength 0, exactly as the glazing does, which leaves the
water showing the analytic dome and no more.

### The body, the bed and the foam

**The depth fade is Beer-Lambert and not a ramp**, and the difference is not
subtle on a lumpy bed: a linear fade that clamps draws the depth map's own
contour line across the water wherever the bed crosses it, and a flood meadow is
nothing but scattered pockets a few centimetres either side of one. An
exponential is what absorption is, has no knee anywhere, and never quite reaches
the deep colour — which is also true of water.

**The bed shows THROUGH without the water ceasing to be opaque.** There is
exactly one see-through material in this renderer and it is glazing; what the
last few centimetres do instead is grade the body toward the map's own
`floorColor`, which costs no blend, no sort and no second draw, and at five
centimetres of water over a bank is indistinguishable from the thing it stands
in for.

**Foam is a lip and not a covering, and `foamDepth` is the number that decides
which.** These are flood meadows and mill leats, not beaches: a rect can be
ankle-deep for twenty metres, and the shoreline distance is derived from the
depth, so a generous `foamDepth` does not widen a line along the bank — it
paints the whole flat white. The same mistake in a second place is
`fleckStrength`, the one foam term with no shoreline in it: it was a literal
0.14 in the shader and a thresholded copy of the foam mask over every water
pixel is, once again, a texture on the water.

### The one thing that disturbs it: a rotor

**A downwash is a HOLE and not a wave, and that is the whole shape of the
term.** Concentric rings spreading from a point is what a RAINDROP does; what a
rotor puts on water is a dark matted disc with a white rim, and the rings are
only the wake running out from under it. So the disc is drawn first, the rings
start at its RIM — there is nothing left under the disc for a ring to be a ring
on — and the disc reuses three things the surface already has rather than adding
a fourth kind of shading. The ordered swell is pressed out of it
(`washFlatten`), because trains rolling on through a patch that is visibly being
shredded is what tells a viewer the two effects are drawn by different things.
The mirror is roughened (`washBlur`), which is the term that actually reads as a
hole: a water surface is mostly its reflection, so the fastest way to say "this
is not a mirror any more" is to blur what it returns — and it goes into the wave
field's own `1 - resolved` rather than into a blur of its own, because the two
are the same claim, that **relief this pass cannot draw is roughness**, whether
it went missing to a pixel or to a rotor. And it foams (`washFoam`), into the
shoreline foam's own mix so the drifting mask breaks it up: laid on flat it is a
white circle painted on the bay, and the froth is an ANNULUS anyway, since a
downwash pushes the surface OUT and the middle stays the dark flattened hole.

**The sites are a uniform ARRAY and every body's material is handed the same
one**, which is what makes a wash sitting on the seam between two rects draw as
one hole in one sea rather than stopping dead at the partition — the pinwheel
partition rule above, paid back. `RotorWash` fills it (x, z, the ring's radius —
the DISC's, so the rim of the hole and the ring of spray particles are one
circle — and 0..1), `Game` pushes it through `WaterSystem.setWash`, and on every
map and every frame with no machine low over the water the count is zero and the
loop does not run.

**The rings take the wave trains' own sampling test and the disc does not.**
`washLength` is metres and a machine can be watched across a bay, so at range
the rings are finer than the pixel they are drawn in and are not detail but
aliasing; the disc is smooth and a smooth thing has nothing to alias.

**What decides whether the rings READ is the slope — amplitude over wavelength,
not either one — and it must be judged on a BRIGHT map.** Fitted first on the
night map at 0.09 m over 2.2 m, four times the steepest thing the wind's own
field produces, and on Sarab in daylight that rendered as a set of hard white
arcs: the crests were tipped far enough to catch `specStrength` through its own
`smoothstep`, so what a viewer read was a stencil of rings rather than water
moving. A night harbour cannot fail that test, because a dark mirror returns
almost nothing at any slope. At 0.085 over 3.4 m the rings are legible on
Sarab's birkat and faint on Cinderhaven's bay, which is what a dark mirror
honestly does.

### Two traps that cost time

**A trailing `//` comment in a GLSL string may not contain a semicolon.**
Babylon's shader processor splits statements at every `;` and moves the
remainder to its own line, so the tail of the comment lands as code. The error
names a word from the middle of your prose and a line number that does not
match the file, which is as unhelpful as it sounds.

**It does NOT bite on the WGSL path, and that was checked rather than
assumed.** The WGSL processor's `preProcessShaderCode` runs `RemoveComments`
over the whole source before the cursor ever sees a line, so a comment is gone
by the time anything splits on a `;`. Comment WGSL freely. **There is no GLSL
string left in the tree for the rule above to be true of** — the trap is kept
because it is a fact about Babylon's GLSL processor that would come back with
any GLSL that came back, and because the WGSL section below states the one that
DOES bite a comment here, which is JavaScript's rather than the processor's.

**Water needs the sky fill the ground already gets.** `skyLightColor` by `n.y`
is what makes the cel shader's floors and roofs read as lit; water is the most
up-facing surface on any map, and leaving it out is what made a pond read as a
hole in a lit field.

## Hand-written WGSL: what the dialect and the processor decide

**Babylon's WGSL is preprocessed and is not raw WGSL**, which is what makes a
shader in this tree readable at all: declarations are `varying vUV: vec2f;`,
`attribute position: vec3f;` and `uniform time: f32;`, and the bodies reach
them as `fragmentInputs.vUV`, `vertexInputs.position` and `uniforms.time`.
A fragment is `@fragment fn main(input: FragmentInputs) -> FragmentOutputs`
and writes `fragmentOutputs.color`. `#include<>`, `#ifdef` and `#define` all
survive the trip.

**Nothing is handed WGSL unless it is ASKED for**, and the two halves of asking
are in different places. A shader is registered into
`ShaderStore.ShadersStoreWGSL` rather than `Effect.ShadersStore`, and its
consumer states `shaderLanguage: ShaderLanguage.WGSL` — a `PostProcess` and a
`ShaderMaterial` both default to GLSL and will otherwise look the shader up in
a store nothing wrote. There used to be one thing in the engine that did the
opposite — `OutlineRenderer` picks WGSL for itself under WebGPU with no flag to
say otherwise, its constructor setting GLSL and then overwriting it, with no
`ForceGLSL` between as `StandardMaterial` has — and the patch that had to know
that (`OutlineFog`) is gone with the outline pass. Nothing in the tree drives
`OutlineRenderer` any more. The rule the trap taught still stands for every pass
here: name the store explicitly, because writing the wrong one is not a compile
error but a patch that silently does nothing.

**What several shaders share is a registered INCLUDE and not an interpolated
string**, and the reason is specific to WGSL rather than tidiness.
`src/shaders/wgsl/includes.ts` writes `celBand`, `celShadow`, `celProbe`,
`celProbeBox` and `celDither` into `ShaderStore.IncludesShadersStoreWGSL`, and a
consumer reaches them with `#include<celShadow>`. Four of the five state their
own source; `celDither` reaches for `Dither.ts`'s, because there the argument is
sixty lines against a six-line function and a reader arriving at either wants
the other. The GLSL they replace were
template literals pasted into three shaders, which was survivable because a copy
that had drifted was a COMPILE ERROR in one of them: the uniform declarations
and the code reading them travelled together and a mismatch did not link. Two of
these includes declare uniforms and samplers, and under WebGPU those feed the
auto-generated `LeftOver` UBO struct — so three copies that disagree are no
longer a diagnostic anywhere. They are a **different UBO layout per shader**,
which fails as plausible values read from the wrong offsets, on one surface,
with nothing in the console.

**Every entry is prefixed `cel`, and the prefix is a collision guard rather than
a style.** Babylon registers an include first-writer-wins and its own library
ships some two hundred of them under bare names, `instancesDeclaration` and
`dither` among them — so an unprefixed entry would either silently shadow one of
those or be silently shadowed BY one, depending on which module the bundler
evaluated first, and the failure is a shader that compiles and draws the wrong
thing.

**Registering the source is still only half the contract.** A `ShaderMaterial`
builds its bind group from the lists it is CONSTRUCTED with, so an include that
declares a sampler nobody listed is a binding with nothing behind it — see the
sampler rule in the constraints below. `SHADOW_UNIFORM_NAMES`,
`SHADOW_SAMPLER_NAMES`, `PROBE_UNIFORM_NAMES` and `PROBE_SAMPLER_NAMES` stay in
TypeScript in `CelShader.ts` for exactly that reason, and the two halves have to
be edited together.

**Sample with `textureSampleLevel` wherever the texture has no MIP CHAIN, and
that is most of them.** WGSL's uniformity analysis rejects an implicit-LOD
sample reached through non-uniform control flow, which is what every early-out
in a post pass and every `#ifdef`'d fetch in the cel shader produces — the error
reads as a real bug and names a shader that has been correct for years. An
explicit LOD carries no such requirement, and Babylon's own WGSL post shaders do
exactly this. The shadow map, the post chain's inputs and the depth field all
carry a single level, so level 0 is not a compromise there: it is what the GLSL
meant.

**Five fetches in the game are the exception, and for them the implicit LOD IS
the filtering.** The ground albedo and its height map are `DynamicTexture`s
built with mips and `anisotropicFilteringLevel = 8`, and a `ReflectionProbe`'s
cube generates a chain unless it is asked not to. `textureSampleLevel(…, 0.0)`
on any of the three would delete that chain — and on the height map it would
delete an argument as well, because `perturbNormal` relies on two taps a texel
apart converging with distance and states that as the whole reason it needs no
explicit fade. The other two are the water's: the foam mask is a plain `Texture`
and carries a chain like any other, and the BED DEPTH map is the one that turns
the rule into a trap.

**An explicit LOD also turns ANISOTROPY off, and "no mip chain" is therefore
not enough to make level 0 equivalent.** The water's bed-depth map is a
`RawTexture` built with `generateMipMaps: false` — one level, so the LOD cannot
matter — and Babylon's WebGPU sampler cache still enables anisotropy for it,
because `BILINEAR_SAMPLINGMODE` qualifies whether or not the texture carries
mips (`useMipMaps || samplingMode === 2`) and the texture's default
`anisotropicFilteringLevel` is 4. So `textureSampleLevel(…, 0.0)` there is a
single bilinear tap where the GLSL got an anisotropic one, and `depth` changes
in the last bits. That is invisible everywhere except at the SHORELINE, where
`foamBand` is a 1.2 m smoothstep seen edge-on and about one pixel wide, so a
last-bit difference flips whole pixels between foamed and not. Measured against
the shader's own GLSL original on Harrowmead's millpond: **911 pixels along the
far shore, by up to 28/255** — small enough to pass the bank's tolerance and
loud enough to be a real difference, and flattening that one threshold took it
to zero. **The rule is about what you MEANT**: reach for the explicit LOD when a
LOD is what you meant, keep the define for the places where a derivative is, and
check the SAMPLER before assuming a mip-less texture cannot tell the
difference.

**Every `#ifdef` over a uniform declaration is another UBO LAYOUT.** The cel
shader has five defines and compiles five leftover UBOs, each laid out from the
declarations that survived the preprocessor for that variant — so moving a
uniform into or out of an `#ifdef` moves the offsets for that variant alone, and
a mistake shows up on one material on one map. It is also what makes the sampler
rule tractable there: a variant's sampler declarations sit under exactly the
defines its `samplers` list is built from, so the two halves are edited
together or not at all.

**An early `return` must return the struct**, `return fragmentOutputs;` and
never a bare `return;` — the processor appends its own
`return fragmentOutputs;` to a function it has typed `-> FragmentOutputs`, and
a bare one is a compile error. **The trailing unreachable one is fine**:
Babylon prefixes `diagnostic(off, chromium.unreachable_code)` for exactly this.
So an early-out stays an early-out, and does not have to be rewritten into a
single exit — which matters, because two of the three post passes document
theirs as load-bearing.

**A SWIZZLE cannot be assigned to, and a single component can.** GLSL's
`worldPos.xz += shift;` has no WGSL spelling — the two component writes it
becomes are the same arithmetic and the same result, and there is no way to keep
the one-liner. Reading a swizzle is unrestricted, so only the left-hand side
moves.

**There is no `mat3(m4)` conversion.** The upper-left block of a world matrix —
what a vertex stage multiplies a normal by — is
`mat3x3f(m[0].xyz, m[1].xyz, m[2].xyz)`, spelled out. WGSL indexes a matrix by
column, which is what makes that read correctly.

**A uniform ARRAY's size must be a literal or a `#define`, and a `const` will
not do**: Babylon resolves the bound out of the preprocessor table when it lays
out the leftover UBO, and a WGSL `const` is not in that table. Where the count is
already a TypeScript constant, interpolate the NUMBER into the declaration and
keep a real `const` for the loop bound — that is what `GrassShader` does with
`MAX_PUSHERS` and `MAX_POINT_LIGHTS`, and it avoids the define trap below
entirely.

**Prefer a WGSL `const` to a `#define` for a compile-time number.** The
processor implements a define by searching the whole shader for its NAME with
an un-anchored regex and pasting the value over every hit, so a name that is a
substring of any other identifier corrupts it silently. `const SAMPLES: i32 =
32;` is a real declaration, is legal as a loop bound, and costs nothing.

**A scalar uniform ARRAY is not laid out the way it is written.** The processor
rewrites `array<f32, N>` into an array of a `@size(16)` struct and patches
accesses with the non-greedy regex `names*[(.*?)]` → `name[$1].el`, so
`pointRange[i]` is safe and `pointRange[idx[j]]` is silently corrupt. Index a
strided array with a plain name or a literal, never with an expression
containing a `]`. A `vec3f` array needs no such care — its natural uniform
stride is already 16 — which is why `setArray3` is correct as it stands.

**A `mat3x3f` is three vec4-ALIGNED columns**, so `setMatrix3x3`'s nine floats
are repacked into 48 bytes on the way into the leftover UBO rather than copied.
Babylon does that correctly — measured, by painting the three columns out of a
debug pass — and the reason it is written down is that nothing about the
failure would be visible: a mis-packed matrix is a scrambled matrix with no
diagnostic anywhere.

**A uniform that is never written reads as ZEROS, and a sampler that is never
bound takes the draw down with it.** That asymmetry is stated in full in the
constraints below; it is repeated here because it is the rule most likely to be
tripped by a hand-written shader that declares more than the variant it is
compiling actually uses.

**WGSL has `transpose()` and has no `inverse()`.** An eye position recovered
from the rows of `viewProjection` is therefore still
recovered that way — for a NEW reason, and the difference matters to whoever
next reads it as a workaround. It used to be that a WebGL2 context runs these
shaders in GLSL ES 1.00 mode, where `inverse` does not exist; it is now that
WGSL has no `inverse()` in any version, so there is no newer dialect to
simplify it against.

**A backtick inside a shader source is a backtick inside a TEMPLATE LITERAL.**
Every shader in this tree is a JS template literal, so prose in a shader comment
that quotes an identifier the way this documentation does ends the string —
silently, as a dev-server 500 on the module, which reads as anything but a
comment. Escape the backtick or write the name bare. It is the same class of trap
as the `//`-with-a-`;` one below and it bites in the opposite direction: that one
is the preprocessor eating code, this one is JavaScript eating the shader.

## Block visibility: how much of the map the frame walks

`ENGINE_UPGRADE.md` wall 1, and `src/systems/WorldCulling.ts` is all of it.

**The frame walks the SCENE and not the screen.** Babylon's
`_evaluateActiveMeshes` iterates every mesh it is offered, every frame, and does
a Map get, an `isBlocked`, a `getTotalVertices`, an `isReady` and an `isEnabled`
on each before it has decided anything — so the cost is `O(meshes)` whatever the
camera can see, and on this game's maps the mesh count is proportional to map
AREA. Measured (`FINDINGS.md` 19): **1.10 us per mesh per frame**, which is 23.0
of a 30.3 ms frame at 1500 m and 7.6 of 10.1 ms at 900/300. Frustum culling does
not help; it is the decision this walk REACHES.

**The lever is `Scene.getActiveMeshCandidates` and it must stay that lever.**
This is the supported extension point — it is what `createOrUpdateSelectionOctree`
replaces — it is read in exactly one place, and a mesh left out of it is skipped
ENTIRELY rather than skipped cheaply.

**`WorldCulling` writes nothing onto any mesh, and that is the whole safety
argument rather than a stylistic preference.** No `setEnabled`, no `isVisible`,
no `isPickable`. Four things therefore cannot see it and none of them needed a
line of code:

- **Every ray.** `InternalPick` walks `scene.meshes` with the caller's
  predicate and has never heard of the candidate list. Verified adversarially:
  a thousand rays across the proving ground, fired with the reach at the map's
  fog wall and again with it wound to zero — every structure out of the frame —
  agreed on the mesh and the distance **1000 times out of 1000**.
- **The shadow map**, whose casters are an explicit `renderList`.
- **Every cube probe**, whose render list is explicit too — which matters
  because the bake now spends itself over frames and would otherwise bake holes.
- **`moveWithCollisions`**, which walks the collidable meshes.

Contrast `setEnabled(false)`, which costs all four of those AND buys less: a
disabled mesh is still in the walk, and merely shortens what the walk does with
it. That is what made finding 18's 0.67 us and finding 19's 1.10 us disagree
about the same number.

**Four classes of mesh, and which class a mesh is in is the design.**

| class | what | offered |
| --- | --- | --- |
| hidden | `map.colliders` — invisible by construction | **never**, at any distance |
| blocked | drawn map geometry carrying `metadata.block` | while the camera is within the map's `fogEnd` |
| pooled | a body's rig, filed under the root the roster switches | while that root is enabled |
| loose | everything else in the scene | **always** |

**Most of the win is the hidden class and it is exact rather than a trade.** A
collider proxy cannot draw — `MapBuilder.boxMesh` sets `isVisible = false` and
nothing turns one back on — so leaving it out cannot move a pixel, and on the
900/300 proving ground **6,349 of 9,019 scene meshes are collider boxes** the
walk was paying full price for and rejecting on `isVisible` after it had already
done everything expensive.

**The landform is deliberately loose.** A structure past the fog wall draws
exactly `fogColor` and stands in front of ground that draws exactly `fogColor`,
so dropping it is invisible. The terrain, the roads and the rim are what the SKY
is behind, and `SkySpec.horizonColor` is only required to sit CLOSE to the fog —
a hole cut in the rim is a hole onto a gradient, and the further up the dome the
less it is fogColor. They carry no `metadata.block`, which is what makes that
mechanical rather than a rule anyone has to remember.

**The pooled class is the ONE whose switch is not a distance, and it exists
because a ROSTER is the one thing on a map a layout may triple.**
`MapLayout.perTeam` is 8 on four maps and 24 on Sarab, so a rig pool is 336
nodes — twenty meshes and a root apiece — or **1,008**, and every one of them
was offered to the walk whether the
body was in the round or not — a bot past `bodyDrawDistance`, a bot benched for
a human, a bot crewing a tank, and on a netplay round the whole of
`BattleSystem`'s sixteen, which are built and never enabled at all.
`Game.installBodyPools` files them and `WorldCulling.update` polls each
rig ROOT once a frame, marking the list dirty only on a transition — 48 property
reads against the 1,008 nodes a rebuild answers for.

**THREE rigs are filed and not two, and the third is the one the player looks
at.** `buildSoldier` has exactly three callers — `Bot`, `NetSoldier` and
`DeathCam`, which builds the stand-in body the player watches their own death
over — and for a long time only the two ROSTERS were handed over. The third was
loose, four metres from the camera, and what that cost is under the size gate
below. It is filed on the same terms the other two are: `SoldierRig` already IS
`PooledBody`, and `DeathCam` switches it by the same `root.setEnabled` a roster
writes. **`installBodyPools` therefore runs AFTER `applyPlayerTeam` in
`buildRound`** — that is the one call that can DISPOSE a rig and build another,
on a change of side, and filing before it would leave the pool pointing at freed
meshes for the rest of the round.

**It is filed MESH BY MESH and never by ancestry, and that is load-bearing
rather than incidental.** `RagdollSystem` reparents a corpse's joints onto Havok
proxy nodes, so a ragdolling body's meshes are not descendants of `rig.root` at
all; a class that asked "is this mesh under an enabled root" would drop every
corpse in the game the moment it started falling. Measured on Sarab over 120
frames of a real death, with the joints off the root on every one of them: 20 of
20 rig meshes active and 20 of 20 offered, identical with the pools filed and
with them empty.

Measured on Sarab, 24 a side, the fight held so both arms saw one scene, three
interleaved blocks each against an A-vs-A control spanning 13.48-13.75 ms:
**candidates 2,299 → 1,690 (−26.5%), the mesh walk 2.75 → 2.42 ms (−11.9%), the
frame 14.24 → 13.62 ms (−4.4%), 70.2 → 73.4 fps.** Hollowmere at 8 a side is
vsync-capped so its frame cannot show it, and its walk still goes 1.05 → 0.92 ms
with candidates 1,178 → 905. **Draw calls and active meshes are identical in
every block of both**, which is the shape of this lever: it takes the WALK and
never the draw, because a disabled mesh was going to be rejected anyway — and a
staged A/B/A with half the roster in frame came back inside its own control
(27-34/255 worst against a 33/255 control, mean 0.001-0.003).

**Everything else pooled is still loose** — tracers, shards, ragdoll debris,
grenades, rubble, the viewmodel, the hulls — and finding 21's ~750 idle effect
meshes are the next thing that could take this same door.

**Nothing pooled may ever be block-keyed.** They are loose or pooled because
they MOVE, and this is precisely why `scene.freezeActiveMeshes()` is a bug in
this game and this is not.

**The three numbers in `CONFIG.graphics.culling` are all margins and none of
them is the reach.** The reach is the map's own `fogEnd`; `pad`, `step` and
`hysteresis` decide how much slack rides around it so the answer is never late
and never thrashes. A map whose `fogEnd` is past its own diagonal — Coldharbour,
Harrowmead, and the proving ground on purpose — culls nothing by distance and
gets the hidden half alone.

**And it is `fogEnd` and never `EnvironmentSpec.bodyDrawDistance`, which is the
one other distance a map may state about drawing.** They are not two spellings
of one idea. The block cull is EXACT because a structure past the fog draws
`fogColor` in front of ground that draws `fogColor`, so dropping it cannot move
a pixel — a claim that is true of the fog and of nothing shorter. A body dropped
inside the fog genuinely disappears, and a map states `bodyDrawDistance` having
decided that a soldier two pixels tall is worth less than fourteen merged meshes
of draw. Measured on the proving ground with the roster in view, **65% of the
frame's active meshes were rigs** (`FINDINGS.md` 30) — so what that field
removes is large, and it is removed from the same walk this table governs while
leaving the table alone.

**A cell's bounds are its MESHES' and not the block's nominal square.** The key
is a name, not an alignment claim: terrain patches are cut on the heightfield's
grid lines rather than on `BLOCK_SIZE` seams, and a merged block's geometry can
hang over its own seam. Measuring what is there cannot be wrong in the direction
that matters.

**The candidate list is `scene.meshes` MINUS things, in scene ORDER, and the
order was measured rather than assumed.** A list assembled as loose-then-cells
holds exactly the same meshes and hands them over differently, and the order
reaches the picture: `_activeMeshes` is what the glow's mask is built from
and what the transparent queue's distance sort breaks ties by, and neither is
exact in eight bits. Two of Hollowmere's four banked vantages moved by 0.0004
and 0.0012 mean/255 that way. In scene order fourteen of the fifteen banked
vantages come back to four decimal places.

### The size gate: what is too small to be worth drawing

`WorldCulling.offer` runs once a frame and drops two kinds of candidate. The
first is anything switched off — `!isVisible` or `!isEnabled()`, the two
rejections `_evaluateActiveMeshes` makes anyway, made before the expensive part
rather than after. The second is anything too SMALL to see.

**The threshold is a size on the SCREEN, not a distance in the world.**
`CONFIG.graphics.culling.minPixels` is the projected DIAMETER of a mesh's
bounding sphere, in pixels: `2r / dist * (renderHeight * scalingLevel / fov)`.
One number is therefore right at every resolution and every field of view, and
it tightens by itself when a sight goes up, because narrowing the FOV is exactly
what makes a far thing bigger. It is compared SQUARED — a `sqrt` per candidate
measured as a net LOSS at the thresholds that drop little.

**The scaling level in that formula is what makes the pixel a fixed unit, and
without it the gate was a different gate on every rung of the render-scale
setting.** `getRenderHeight` is the BACKING STORE, and the backing store is
precisely what `Game.applyRenderScale` moves — so a threshold stated in its
pixels says one thing at `renderScale` 1 and another at 0.5, where a 3 px gate
drops everything under **6 CSS px** — twice the threshold it was tuned at, on
the rung a weak machine is most likely to be sitting at, and visible as a hull
holding off until half the range the measurement below chose. It fails the other way just as
quietly — anything that oversamples the CSS grid (a display past 2x, where the
ladder has no rung near `1 / dpr` and the default lands at 1.5x; supersampling,
if the ladder ever grows a rung above 1) shrinks the gate instead and hands back
the saving the table below is the whole argument for: 3 px is -0.51 ms and 2 px
is only -0.11.

Multiplying by the level converts back to CSS pixels, and it is the whole of the
correction because `devicePixelRatio` is already inside the level —
`applyRenderScale` builds it as `1 / (dpr * renderScale)`, so reading the ratio
again here would square it. The level is **1 at every default install**
(`defaultRenderScale` picks the rung nearest `1 / dpr` for exactly that reason),
so this is arithmetically the shipped gate on the machine FINDINGS 39 measured
and on a fresh install of any density; it moves only once a player has moved the
slider. The glow's blur kernel is the other number stated in backing-store
pixels and takes the same factor — see `GlowPass.kernelTexels`.

**What it is FOR is geometry with no level of detail of its own.** Three of the
four big populations on a 1500 m map are already governed: a body by
`bodyDrawDistance`, a merged block by the cull cells, the terrain by the
frustum. A VEHICLE is governed by nothing — every hull draws every part at any
range, and on Cinderhaven that means a 16 cm helicopter antenna and a 14 cm gun
ring at 1.4 km. Shipped at 3 px it is worth **-0.51 ms a frame** there, and
close to nothing on the small maps, which is the honest shape of it.

**A BODY is measured once and drops WHOLE; two classes are exempt outright,
and each of the three is what it is because a picture said so rather than
because it seemed wise.**

- **A pooled body — measured off its ROOT, not its meshes.** A per-mesh size
  test is not a level of detail, it is a dismemberment: the first run dropped
  `bot-head-m` x16 and `bot-legL` x16 while keeping the torsos. So a pool was
  EXEMPT outright for a milestone, on the grounds that a body is already taken
  off whole by `bodyDrawDistanceOf`. It is now gated instead, once per body,
  off the rig root `poolOf` already files — one question, one answer, read by
  all fourteen meshes, so the dismemberment cannot occur and the body can
  still be dropped. This file still does not have to learn what a soldier is.

  **That makes it a second `bodyDrawDistance` stated in SCREEN space**, which
  is why it needs no per-map number and loosens by itself when a sight goes
  up. A rig root is ~2 m across, so measured on Coldharbour at the shipped
  3 px a body drops at **810 m on a 1080-tall viewport and 290 m on a
  384-tall one**. That map's own body distance is 480 m, so this changes
  **nothing at all on a desktop** — the candidate list hashes identical before
  and after — and takes half the roster out of the list on a phone. 5 px is
  490/180 m and 6 px is 410/150.

  **A body's own EMISSIVE goes with the body**, which is the one place this
  class and the next one meet. A visor is the only emissive on a rig, and an
  exemption would leave a pair of eyes hanging in the air where the soldier
  was; `gateOf` files the pool first for exactly that reason.

  **The root's world matrix is FORCED before it is measured, and without that
  the drop LATCHES** — this is the paragraph below, met head on rather than
  survived. A rig root is invisible, so `offer` has always dropped it on the
  `isVisible` line and the walk has never computed it; it was refreshed only
  incidentally, as the PARENT of a child that was itself a candidate, and
  gating the children cuts that thread. Measured with the force removed: a
  body walked out to 600 m and back came home **0 of 15 meshes offered at
  40 m** and stayed that way for the life of the round. With it, 15 of 15.
  One forced compose per body per frame — 48 on the densest map in the tree —
  and it makes the reading this frame's rather than last frame's as well.

  **This class is only worth what the LIST of pooled bodies is worth, and the
  death cam's rig was missing from it.** A rig `setPools` has never been handed
  is gated MESH BY MESH, which is not a body dropped early but the
  dismemberment itself — so the filing is what makes every paragraph above
  true, and it is the first thing to check when a body comes apart. The symptom
  was the player's own corpse ragdolling with its head gone, most of the time,
  on every map — and it was NOT the distance the gate is about. Nothing had
  ever drawn that rig, so its meshes' world bounding spheres were still sitting
  at the world ORIGIN, and the gate measured every part of the corpse from the
  middle of the map instead of from four metres away.

  **The figures are the PRE-PALETTE rig's**, taken while a segment still split
  once per colour and a rig was twenty-one meshes — they are what the failure
  looked like rather than what it would look like today. Measured on Hollowmere
  with a death at 146 m from the origin, twelve of the twenty rig meshes were
  dropped on the first frame and **six never came back**: two of the head's
  four merged parts, one arm each side and one part of each leg. On Harrowmead
  at 219 m it was **twelve**, including all four head parts and all six leg
  parts. It is the small parts that go, and a head was four of them because the
  merge was per COLOUR; what survived was whatever is big enough to pass at
  that range — the torso, the rifle, and the visor, which was emissive and so
  exempt in its own right at the time, where `gateOf` now files it with the
  body. Filing the rig fixes it at the root: 0 of 20 dropped on both maps.
- **Anything emissive.** The glow carries a sub-pixel emitter far past its own
  geometry, and this game's biggest map is a harbour town at night. The test is
  exact rather than a guess at a name: only a light source carries an
  `emissiveColor` — `CelMaterialFactory.getEmissive`'s unlit `StandardMaterial`,
  or the fire's `FlameMaterial`, which declares one for exactly this test and the
  glow's — and every lit surface wears a plain `ShaderMaterial`, which has no
  such property to read at all.
- **Anything outside rendering group 0**, plus `infiniteDistance`. This is the
  one that was found the expensive way. `offer` runs inside `Game.tick`, BEFORE
  `scene.render()` bakes world matrices, and the viewmodel hangs off the camera
  — so the rifle's world bounding sphere is still sitting at the ORIGIN when
  this reads it. Asked how big it was, the gun answered **1.8 px at 726 m**,
  which is the distance from the world origin to the player, and the gate
  deleted the weapon out of his hands. Group 0 is where the world is; everything
  above it is drawn against the eye and has no business being distance-gated.

**A WRONG DROP LATCHES, which is why both of the failures above were total
rather than intermittent.** Babylon computes a mesh's world matrix inside
`_evaluateActiveMeshes` and only for CANDIDATES, and `_afterComputeWorldMatrix`
is what refreshes the world bounding sphere this gate reads. So a mesh dropped
on stale bounds is never given the matrix that would correct them, and it goes
on being dropped for as long as it lives. Nothing else writes them: a rig's
drawn meshes are not touched by `resetSoldierPose`, by `animateSoldier`, or by
`RagdollSystem`, which computes JOINTS. **Read a mesh's world bounds here as
LAST FRAME's at best and as never-computed at worst**, and exempt anything whose
bounds this pass could be the first to need.

**`bank.mjs` cannot see any of this.** `placeVantage` disables the bots and
disposes the zones, so the banked vantages hold none of what a culling change
touches — the broken version above came back byte-identical on all 21. The test
that works is a screenshot pair in a live round at one frozen camera, with a
CONTROL pair under the same condition so the noise floor is measured: fixed, the
lever reads mean **0.066/255** against a control of 0.037. See `VERIFYING.md`
and `FINDINGS.md` 39, which also carries the two larger levers this deliberately
does not take, both being look decisions rather than bugs.

## Rendering constraints that look like bugs if you undo them

- `pipeline.imageProcessingEnabled` must stay `false`: the cel shader outputs
  display-ready colors and Babylon's image-processing pass re-gammas them and washes
  the palette out. That is also why the vignette/grain/aberration/damage flash grade is
  hand-written (`src/shaders/PaperGrain.ts`).
- Glow is an emissive MASK blurred and added to the frame (`src/shaders/GlowPass.ts`),
  keyed off emissive colour and deliberately not threshold bloom —
  bright-but-not-emissive surfaces must stay crisp.
- **The pass OWNS its target, its clear, its depth and its place in the frame**,
  and every Babylon call in it is public API. It replaced a `GlowLayer` with
  `GlowDepth` bolted on from outside, which overrode all four of those through
  three Babylon internals and re-applied the overrides every frame because the
  layer kept putting its own back.
- **Its occlusion is the MAIN pass's depth buffer, not a second drawing of the
  world.** The mask is drawn from the end of the draw phase, where the depth is
  final, into a colour-only target sharing the frame's depth, and its render list
  is the emissive meshes alone. The stock layer redrew every visible mesh in opaque
  black solely so its own buffer would depth-occlude; not doing that is worth ~20%
  of the frame on the three big maps (`FINDINGS.md` 3), and the occlusion is exact
  rather than approximate. **The mask writes NO depth**: every mesh it draws wrote
  its own in the main pass, so an LEQUAL test is the whole of the occlusion, and
  a blended mesh that wrote none there must not start writing one into the buffer
  the ink and the blur read.
- **The mask is SIZED, SHARED AND DRAWN IN ONE FUNCTION**, which is the whole of
  the resize rule. It reads the size of the depth it is about to borrow, resizes to
  it, re-shares when either end of the share has moved (a share is a relation
  between two targets), and draws. The layer's texture and that depth resized on
  different schedules, and one frame per `engine.resize()` was encoded with a
  colour attachment at one size and a depth at another and rejected whole — a
  dragged window lost one frame in two (`FINDINGS.md` 3, last section).
  **Two failures to remember** because both are silent: the target's clear must be
  COLOUR ONLY, or the borrowed depth is wiped and every lamp blooms through its
  wall; and its `renderList` must be `null` rather than the empty array a target is
  born with, or `getCustomRenderList` is handed nothing and the mask is black with
  no error anywhere.
- **The mask is drawn with an OVERRIDE material, not the mesh's own.** Every
  glowing mesh wears an unlit `StandardMaterial` faded by `EmissiveFog`, but that
  fade goes toward the FOG colour, and a bloom of the fog colour is a pale haze
  round every far lamp on a bright map. So a small WGSL material (variants for an
  emissive texture, an opacity texture and blending) takes each mesh's colour from
  `Game`'s `GlowRules.colour`, which fades toward black by the mesh's
  bounding-sphere centre. It has no instance attributes; nothing glowing is
  instanced, and a DEV build warns the first time something is. **Which meshes
  bloom is one rule read every frame**: an emissive colour, no `metadata.noGlow`,
  and `GlowRules.admits` (the kit screen's stage-only test) — so a mesh built at
  any time is in or out by its own metadata, and nothing excludes a mesh by hand.
- **A material whose vertices MOVE brings its own mask** (`SelfMasking`). The
  stock variants transform by `world` and `viewProjection` alone, so a displaced
  surface would draw its REST pose into the mask and lose the LEQUAL tie wherever
  it had moved. The fire is the one such material: `FlameMaterial.glowMask`
  hands back a twin compiled from the same WGSL under `GLOW_MASK`, fed the same
  clock, and painted through the same `GlowRules.colour`.
- **The blur is off the backing store.** The mask stays full resolution because
  depth sharing needs it and the ink reads it as its emissive mask, but the blur
  starts from a half-resolution downsample: Babylon's own `kernelBlur`, across and
  down at half resolution and again at quarter, the two summed, scaled by
  `glowIntensity`, clamped to 1 and added to the frame — the layer's look at the
  size its kernel was tuned at. The kernel is `glowKernel / (2 * level)` texels of
  the half target, read before every blur from the scaling level (the setter
  returns on an unchanged value), so the render-scale setting cannot change the
  bloom's size on screen: `devicePixelRatio` is already inside the level, and the
  level is 1 at every default install.
- **The compose is a post-process straight behind the ink**, and that is a LOOK
  decision: a bloom lies over the ink lines round its lamp rather than under them,
  and FXAA, the shafts and the grade treat it as part of the picture. Against the
  old order the banked frames move only on edges under a bloom (a halo is no
  longer darkened by the line through it) — up to 0.26 mean/255 on the vantages
  with the sun or lamps in frame, and ~0.01 on the moon and the kit screen.
- Flat shading is recovered in the fragment shader from screen-space derivatives of
  the world position. Do not call `convertToFlatShadedMesh()`; it would unweld vertices
  on every prop and clone for no visual gain.
- **A sampler a material DECLARES has to be bound, whether or not the variant
  it compiles sampling it.** The cel shader has one `samplers` list for all
  eight variants, so `shadowMap` reaches the bind group layout of every one of
  them — and a layout entry with nothing behind it is not the harmless no-op it
  was on WebGL2, where an unbound sampler read as black and the frame carried
  on. The bind group fails to build and every draw using it is lost.
  The case that found it was the retired `CEL_INK` variant: unlit, binding no
  lights and at first no shadow either, so Hollowmere's two swaying merge groups
  took their ink twins, `Failed to read the 'resource' property from
  'GPUBindGroupEntry'` and a black frame with them. **`CelInk` is now the pass
  most exposed to this rule** — it declares a `texture_depth_2d` and binds it
  from `onApply`, and a frame where that bind is missed is a lost draw and no
  error.
  **UNIFORMS are the opposite and need no equivalent care**: an unwritten
  uniform in the leftover UBO reads as zeros, which is why the ink still binds
  no point lights.
- **THE INK IS A SCREEN-SPACE PASS AND NOT GEOMETRY, and this bullet used to be
  five.** `shaders/CelInk.ts` runs one full-screen edge over the depth buffer
  the frame has already written; it owns the argument, the mechanism and the
  measurements. What stood here before was the family of rules that existed
  BECAUSE the ink was an inverted hull — a thick box under any walked surface,
  "nothing may be laid ON an inked surface", an emissive detail having to
  protrude past its neighbours' shells, and the reason no road may be inked.
  **Every one of them was a consequence of the hull writing DEPTH**:
  `OutlineRenderer` drew each shell twice, the second pass writing depth with
  colour write off and a negative slope-scaled offset, so once an inked mesh had
  been drawn the buffer held an invisible surface `outlineWidth` in front of it
  across the whole of it, and anything drawn into that gap afterwards failed the
  depth test against nothing. Coldharbour's lane markings were the worked case:
  4 cm of paint under a 5 cm shell, in every list, lit, and not on screen at all.
  **None of it can happen now.** The ink writes no depth, occupies no space and
  wraps nothing; it reads the depth buffer and darkens the colour buffer. The
  geometry those rules produced is still there and still fine — a walked surface
  is a thick box because that is also what a walked surface wants — but nothing
  is being defended against any more, and a new thin deck or a decal laid on a
  wall no longer owes anyone a clearance.
- **What the ink DOES still owe is the fog.** Anything drawn unshaded owes the
  cel shader's `t * t` curve or it hangs in front of the fog wall at full
  strength while the world behind it dissolves. The hull needed a shader-store
  patch (`OutlineFog`, now deleted) to get that per pixel and a per-mesh width
  ramp (`updateOutlineScales`, also gone) to approximate it; `CelInk` has the
  distance in hand and evaluates the curve exactly, over the MAP's own fog band,
  which is why `Game` re-pushes that band on every environment change.
- **The rim highlight is gated off near-level surfaces, and the gate is not
  optional.** On a plane the grazing angle it keys on is nothing but distance from the
  eye — for a floor, `1 - dot(viewDir, n)` is `1 - eyeHeight/dist` — so an ungated rim
  fires on every ground pixel past `eyeHeight / 0.28` (5.5 m standing, 3.75 m crouched)
  and none inside it: a hard-edged disc of un-rimmed floor locked to the camera,
  sliding across the map with the player (measured luminance 0.205 at 5.0 m against
  0.263 at 5.6 m, a 28% step across one circle). The gate is on **tilt**, because
  distance is only the symptom, and it reads the **facet** normal rather than the
  bumped one — off the bumped normal, individual setts flick it on and off. It costs
  the rim on the near-horizontal top faces of a rig, which were never silhouettes.
- **The tilt gate is half the rule, and the other half is the WORLD MARKER.** The
  sentence above is true of every plane, not only the floor: for a wall at
  perpendicular distance `p` from the eye, `dot(viewDir, n)` is `p/dist`, the 0.72
  step is crossed at `dist = 3.57p`, and the locus of that on the wall is a CIRCLE
  of radius `3.43p` about the point nearest the eye. So the same camera-locked disc
  went on being drawn on every large flat WALL: standing 3 m off one put a 10 m
  circle on it, and looking along a building's flank from a hull put the arc halfway
  down the face, sliding with the player and reading as a shadow with nothing casting
  it. **There is no fragment-local test that separates a limb's grazing facet from a
  wall's far corner** — they produce the same `dot()` at the same distance, curvature
  would separate them, and there is none to read because the shading is faceted and a
  normal is constant across a facet by construction. So the second gate is an
  exclusion: `vBaked.y`, the same world marker the variation noise keys on, which is
  1 on baked map geometry and 0 on the rigs, the vehicles, the viewmodel and every
  effect mesh. A rim separates a shape from its background and a merged map block IS
  the background; the world's edges are the **outline ink's** job, which is per-mesh,
  distance-thinned and fog-faded and never needed this. What is left is what the
  bright maps raised `rimIntensity` for: a body, a vehicle or the weapon in your hands
  against haze very nearly its own colour. The tilt gate stays and is not redundant —
  it is what keeps a rig's top faces and a hull's deck out, and it is what has to hold
  if the world is ever given its rim back.
- Rendering group **1 is the viewmodel's, and nothing else is in it.** Its depth
  clear is OFF (`Game`'s constructor), so the frame keeps one depth image holding
  the world and the gun that `FrameDepth` and `GlowPass` both read. **The moon
  disc used to share the group and does not any more**: it drew after every
  blended mesh in group 0, none of which write depth, so it painted over a
  capture beacon or a tracer standing in front of it. It is a blended mesh in
  group 0 now, drawn after the opaque dome and the clouds and, at 9 km, first of
  the blended queue. **Particles are still under it** — Babylon draws a group's
  particle systems before its blended meshes, so a plume in front of the disc is
  the one case the move does not fix. **Nor does it fix the disc's BLOOM**: the
  glow occludes on depth alone, so the halo is composited over a beacon in
  front of the disc and saturates it back to white — on Cinderhaven the frame is
  byte-identical in either group with the glow on, and differs over the disc with
  it off. `infiniteDistance` stays the glow's fog
  exemption; the kit screen's test is the group alone.
- **The kit screen's backdrop is the one blended mesh in the game whose DRAW
  ORDER is load-bearing** (`buildKitBackdrop` in `ViewModel.ts`). It has to cover
  the world and be covered by the weapon, and the only slot that does both is a
  blended mesh in group **0** with `alphaIndex` at `Infinity` — Babylon draws a
  group's blended meshes last, and its default `alphaIndex` is already
  `Number.MAX_VALUE`, so any ordinary large number sorts the card in front of the
  capture skirt instead of behind it. `depthFunction: ALWAYS` keeps a near wall
  from cutting it, `forceDepthWrite` makes the card the surface every depth reader
  sees (it also once kept the moon, then in group 1, from drawing over it), and the **bloom is composited over the finished frame and so cannot
  be covered at all** — `Game`'s `GlowRules.admits` drops everything off the stage
  while the kit is up.
- **…and it is therefore the one blended mesh that must write NO COVERAGE, which
  is the alpha-channel rule read the other way round.** Every alpha-blended draw
  accumulates into the frame's alpha for free and every one of them wants to —
  except this card, which WRITES DEPTH. It is not in front of the surface a pixel
  records, it IS that surface, and it covers the whole frustum: on `ALPHA_COMBINE`
  at 0.985 it stamped 0.985 of coverage over the entire kit screen, and since
  `CelInk` scales its stroke by `1 - a` the screen came up with **no line work on
  it at all** — the world's, which is under the card and no loss, and the
  **weapon's outline with it**, which is the one thing the screen exists to show.
  The weapon's own pixels write `opaqueAlpha` and were never the problem; a
  contour straddles the silhouette it draws, so the half of every stroke lying on
  the card was erased and what was left read as an unshaded low-poly gun.
  `ALPHA_REPLACE_COLOR` with a fragment alpha of **0** is the pair that says both
  things at once, and it is the only mode in Babylon's table that can: colour is
  `SRC` against a destination factor of ZERO (a straight replace — which is what
  0.985 was approximating), alpha is `srcA + (1 - srcA) * dstA`, which at
  `srcA = 0` is the destination untouched. The 0 is also `needAlphaBlending()`'s
  `alpha < 1` and therefore what keeps the card in the blended queue the slot
  above depends on, so neither job wants any other value and there is no
  `backdrop.alpha` in `CONFIG` any more. **A second full-frustum flat would owe
  the same pair.**
- **The post-process chain has an order, and a display setting that switches an
  effect off REMOVES its pass** rather than zeroing its uniforms — an attached but idle
  pass still reads and writes the whole frame. The order is FXAA, shafts (`Volumetrics`),
  motion blur, paper grain, enforced by where each one re-attaches: `attachPostProcess` appends, so
  the blur's toggle takes the grade off and puts it back behind it
  (`Game.setMotionBlurEnabled`), and the grade's own toggle always appends because the
  tail is where it belongs. `PaperGrain` owns whether it is attached, so the blur's
  dance can never resurrect a grade the player turned off — the guard is in `attach`,
  not at the call sites. Nothing throws if this is wrong; the symptom is grain over a
  smear, which reads as a dirty lens. The red damage flash is painted by the grade's
  shader and goes off with it, leaving the HUD's damage arcs to tell the player where a
  hit came from.
- **The grain is PAPER PINNED TO THE WORLD, and a grain keyed on the pixel is the thing
  it replaced — which is why the setting no longer says "film".** Walking past a wall
  under a screen grain slides the wall under a
  texture that stays put — a film over the scene rather than a world drawn on paper. So
  `PaperGrain` turns the frame's depth (`FrameDepth`) back into a position and evaluates
  a 3D noise there. A texture fixed in the world has no single size, so it is a stack of
  power-of-two OCTAVES, each fixed in the world, weighted by how many metres a pixel
  covers at that distance (Bénard et al.'s dynamic solid textures): walking toward a wall
  fades finer octaves in and coarser ones out, and nothing slides. Five rules hold it up.
  **The shader divides only CAMERA-RELATIVE distances**, and where the eye sits in each
  octave's wrapped lattice is computed in float64 on the CPU and uploaded per level —
  a 2 km coordinate over a millimetre cell is a quarter-cell crawl in float32. **The
  footprint is never finer than the depth buffer's own step**, or distant ground shows
  the non-reversed depth32float's quantisation as contours in the grain. **The weapon is
  pinned to the CAMERA and the sky to the view DIRECTION** (`CONFIG.graphics.paper`'s
  `heldWithin` and `skyFrom`), because world paper slides across both; the cost is the
  blur's own, a wall hugged inside the weapon's band carrying camera paper. And **it has
  no clock** — the old grain's `time` is gone, because paper does not boil. Measured: a
  40 px yaw moves the grain 40–41 px with the scene (correlation 0.50–0.56 there, ~0 at
  0 px), and the pass is ~0.25 ms of GPU at 1920x1080 on the Windows box, eight extra
  copies attached against none.
- **THE SHEET IS LIT AND NOT LUMINOUS, and that is what makes the paper a rule a DARK
  map can take rather than a number each one has to dodge.** The paper is laid on
  twice — MULTIPLIED into the paint, which scales itself, and ADDED under it so a black
  shadow stays a sheet and not a hole — and the added half is the one that needs
  telling, being the only one left standing as the paint goes to zero. Worse, its own
  weight RISES as the picture darkens (`0.9 - lum * 0.5`, the pale flecks of sheet
  showing through heavy ink), so the two compound. Measured on Hollowmere before the
  fix: the grain held a near-flat **3.5–5.5 of 255 from the darkest band of the frame
  to the brightest**, which is **35% of the plate in the shadows against 5% on a lit
  wall** — and the eye reads the RATIO, so a night map was a spray of grey over black
  at the amplitude a noon map spends on a white wall. A sheet reflects what falls on
  it, so the added half now takes the light at the pixel: `mix(paper.litFloor, 1,
  smoothstep(0, paper.litKnee, lum))`. **Above the knee nothing changes at all**, which
  is why a bright map is untouched — 74% of a Coldharbour frame came back
  byte-identical — and **the floor is not zero**, or the shadow is exactly the hole the
  added half exists to prevent. After it, with `graphics.grain` down from the old
  screen grain's 0.055 to 0.03, Hollowmere moves **0.7–3.0 of 255 at 2.6–7% of the
  plate**, against Coldharbour's 1.1–2.3 at 1.1–5%.
- The cobblestone texture is 512² over a 1.5 m tile (`textures.ts`), sized for a
  camera **1.55 m above the street**. 512 is also written into the shader —
  `perturbNormal` takes its taps at a hard-coded `1.0 / 512.0` — so the two move
  together or every surface's relief is silently rescaled.
- **A world-mapped ground albedo gets the weathering drift too, and there it is
  load-bearing rather than a nicety.** The flat-colour path multiplies `base` by
  a slow world-space value noise so a 48 m merged block stops arriving in one
  tone; the ground path does the same with its own pair of numbers
  (`graphics.groundVariation`, a cell three tiles wide and a wider swing) for a
  different reason — a ground texture REPEATS, every 4 m on the valley floor,
  every 1.5 m on the street and every 3 to 3.5 m on the other two carriageways,
  and the eye finds a period in a ground plane faster than anywhere else in the
  frame. A drift keyed on world position has none to
  find. It is also why the tiles are painted with no feature larger than a
  quarter of their width: the big variation is this, and a tile carrying its own
  would only be advertising where it ends. The ground path skips the `vBaked.y`
  mask the flat path needs, because nothing that moves is ever ground.
- **A world-mapped height map's slope is measured in WORLD space, never in
  screen space**, and a band edge's smoothstep is **at least one pixel wide**.
  The two are the same artefact seen from both ends and both were exposed by
  the same change — a map stating a `floorSurface`, which turns 240 m of valley
  floor into bumped ground where before only a few square metres of cobbled
  street were. `dFdx(h)` measures the height's change across one PIXEL, so the
  slope a patch of ground reports depends on how big a pixel is there — a fact
  about the camera, not the ground — and at a grazing angle it differences
  unrelated grains and re-noises them every time the player takes a step; the
  relief boils. Central differences a texel apart are camera-independent, each
  tap is a filtered fetch the anisotropic sampler can do its job on, and the
  relief fades out on its own at range because the two taps converge as the mip
  chain smooths them, so no distance fade is needed. Meanwhile the terminators
  that relief puts around every grain are hard edges with no geometry behind
  them, and nothing in the pipe antialiases those — FXAA keys on luminance
  contrast and there is no MSAA — so `band` widens its smoothstep to `fwidth`
  wherever the band index moves faster than the authored 0.15 per pixel.
  Measured against a 4x supersampled reference of the same frame, ground at
  3–9 m: **1.8% of pixels off-reference before the floor had relief, 10.3%
  with it, 1.7% with both fixes** — the relief kept, and the whole frame now
  5.2% against the 5.8% it was before any of this.
  **Re-taken on WebGPU, and the map it has to be taken on has changed.** Greyfen
  was re-cut as a closed canopy, so its valley floor now sits in deep shade
  where the whole effect is under 0.2% of pixels and says nothing; Coldharbour's
  lit streets are the case that reads. There, standing on a spawn and looking
  down at the ground, off-reference at more than 8/255 in any channel: **0.00%
  with the relief off, 2.91% with the relief and the widening back at the fixed
  0.15, 0.85% as shipped** — so the widening takes about seventy per cent of the
  relief's aliasing back, against the eighty-six the original run recorded. The
  ordering is what matters and it is unchanged; the absolute numbers are not
  comparable, because the frame they were taken in no longer exists. Both
  counterfactuals are reached by editing the registered `celBand` include (or
  dropping `CEL_BUMP`) and then pushing a dummy define onto every cached cel
  material — see `VERIFYING.md`, because a re-registered include alone hands
  back the effect that is already cached.
- **A slope is not a depth, and the ground has both now.** A bump turns a normal
  and nothing else, so a bumped street was still stones PAINTED on one sheet:
  nothing on it hid anything and nothing cast a shadow, and a raking sun — the
  one light that should carve a street — lit it as a mosaic with shading on it
  (`reference-media/visuals.jpg` is what it was measured against). Two marches
  over the same height map at the same `bumpScale` put the third dimension back
  (`CelShader`'s `reliefParallax` and `reliefLit`, `CONFIG.graphics.relief`):
  - **the sheet is the TOP of the relief** — height 1 — and everything is carved
    down into it, so no stone stands proud of the mesh the depth buffer and the
    ink know about. A recipe should put its highest features near 1: a whole
    field authored low is a surface sunk under its own mesh, which the parallax
    draws as a texture sliding as the eye moves;
  - **both marches treat height as a displacement straight DOWN in WORLD space**,
    which is exact here rather than a tangent-frame approximation, because the
    albedo is already projected down world Y — on a slope as on a level street;
  - **the relief's self-shadow is HARD and joins the map's** (`shadow *=`), so
    the key, the specular and the translucency all lose the light behind a stone
    together, and a groove loses a share of the AMBIENT (`relief.cavity`), which
    is what keeps a crack dark inside a tree's shadow where the key has gone;
  - **every relief fetch is `textureSampleGrad` against the UNDISPLACED
    footprint** (`groundGX`/`groundGY`, taken once in `main`). The mip chain is
    still the fade, exactly as the slope's taps had it; what the explicit
    gradient buys is that neighbouring pixels may be displaced by different
    amounts without that jump reading as a footprint — an implicit LOD off a
    displaced uv picks a tiny mip along every silhouette the relief draws;
  - **both fade with distance and the parallax has to**: its shift is depth
    over the view ray's rise, unbounded at a graze, so it goes to nothing over
    8–22 m and the rise is floored at 0.2. The shadow is not keyed on the view
    and carries to 30–60 m. The layer count is adaptive (40% of the cap looking
    straight down) and a crossing is refined with three secant steps, without
    which the side of a sett reads as a stack of plates.

  **What the height maps had to become for it**, because a field tuned as a
  slope is wrong as a depth: a sett was a flat crown reached a quarter of the way
  in, which carved as a TILE on vertical sides, so it is a pillow now; a sunk
  sett reached the mortar, which carved as a hole its own shadow filled black; a
  pebble or an asphalt chip standing proud drops a shadow SPECK, and a field of
  them reads as pepper, so they stand barely proud; and dried ground is PLATES
  with a rounded lip and a tilt of their own rather than crumb with a groove
  scored through it — the tilt being what a low sun reads, one plate facing it
  and the next turned away. Cost, measured at eye height down a street in a
  1920x1080 headless frame on the Windows box: `gpu.frame` 1.61 → 1.93 ms on
  Cinderhaven's cobbles, no measurable change on Harrowmead's (1.54 → 1.50), and
  frame rate within 3% on both (one run each), the frame being draw-call bound. **The
  supersampled aliasing figure above has NOT been re-taken with the depth on**
  (`FINDINGS.md`).
- **Two up-facing surfaces must never share a plane.** The merge is per colour, so a
  floor slab and the plinth under it land in *different* meshes and their draw order is
  arbitrary — a shared top face is a depth-test tie broken per pixel, which strobes as
  the camera moves. It does not read as z-fighting stipple either, because the two
  surfaces are different colours: the tavern's taproom flickered between blue-grey
  stone and brown boards across all 130 m² of it. Boards stand proud of their plinth
  (`buildTavern`, `buildTownhouse`). Coplanar faces within **one** colour group are
  fine — they merge into a single mesh, which is why gable roofs meeting at a ridge are
  not a bug.
- **An impact disc is lifted off its surface (`effects.discLift`, 0.02 m) and
  that is not cosmetic.** A quad coplanar with the wall it was thrown from
  z-fights, and a flickering impact reads as a broken decal rather than as
  dust. It is the same tie the entry above describes, arriving from the other
  direction: there the fix was standing one surface proud at build time, here
  it is offsetting along the pick's own normal at spawn.

## Impacts: the one pooled effect that reads the world

`CombatSystem` throws three pools — tracers, sparks, and the **impact disc**,
which is the half a sphere could never do. A spark has no orientation; a disc
lies on the face the round was thrown from, using the surface normal the wall
pick already computed and used to discard.

What each kind looks like is a table in that file (`IMPACTS`), because art
constants live with the code that draws them — the two hex colours it replaced
were literals on the same line. Stone gets the old grey spark plus a small pale
bloom; earth gets **no spark at all** (dirt does not spark) and a bigger, duller
disc; flesh gets the spark and **no disc**, because a hit on a body must not put
dust on the world, and there is no blood anywhere in this game — this is not the
pass that would introduce it.

Three constraints hold it together, and undoing any of them is silent:

- **`DOUBLESIDE` is geometry, never `backFaceCulling`.** `getEmissive` caches
  one material per colour and this pool shares those materials with the tracers
  and the sparks, so a flag flipped here flips for every effect in the game.
- **The pool is `noGlow`**, which the glow reads per mesh every frame — without
  it every dust disc blooms like a lamp. It once held only because `CombatSystem`
  was built before a one-shot exclusion scan; there is no scan any more.
- **The disc gets its fog fade for free from `mats.getEmissive()`**
  (`EmissiveFog`), which is the whole reason it is an emissive mesh rather than
  a hand-rolled material. A dedicated unlit dust shader would owe the fade
  itself, and the obvious alternative — a particle system — is forbidden
  outright: `docs/grenades.md` names per-shot effects as exactly what that rule
  exists for. The ground puff is therefore tuned dim rather than glowing.

**The impact rides the tracer, and so does its sound.** Both are spawned when
the streak's head arrives rather than when the damage resolved, which is the
ordering `CombatSystem`'s header calls load-bearing: an impact seen or heard
before its round gets there is what makes a slowed tracer read as fake. One
`spawnImpact` raises all three so the picture and the noise cannot drift apart.

## The sky

Everything overhead is built at runtime by `src/systems/Sky.ts` from the map's
`SkySpec`: an equirectangular dome texture (gradient, galactic band, stars, the
moon's scattering halo), a textured moon disc that feeds the bloom, and a ring
of faceted cloud masses turning slowly about the eye.

**The dome is painted assuming something occludes the bottom of it**, and that
something is the valley rim — so the two are a contract, not neighbours. Stars and
the galactic band are culled below canvas row 0.46 (`if (y > h * 0.46) continue`,
written twice), no cloud's base stands below `CONFIG.sky.clouds.minElevation`, and
the gradient runs to flat `fogColor` from row 0.58 down. In elevation that is
**7.2° for stars and 6° for a cloud's base**, below which nothing is painted at
all. `Ridge.ts`'s `MIN_SLOPE` is the other
half of the contract; lowering the rim without moving these cutoffs uncovers a band
of empty dome.

- **A `DynamicTexture` must be uploaded WHERE IT IS BUILT, and the cost of not
  doing it is invisible in the picture.** `update()` is what makes one READY,
  and an un-uploaded texture on a material makes
  `StandardMaterial.isReadyForSubMesh` return false before it builds an effect
  — so `scene.isReady()`, which walks every mesh in the scene whether it draws
  or not, answers FALSE for the life of the process. Nothing in `src/` asks
  that question, which is exactly why it goes unnoticed: what it breaks is the
  TOOLING that does. The kit backdrop's paint spent a day inside the
  bay-follows-the-DOM repaint and took `npm run shots` down on every map with
  it (`VERIFYING.md` has the hunt). Every `DynamicTexture` in the tree is
  uploaded in its own constructor now; a repaint later is a repaint, never the
  first one.
- **Sky textures are uploaded with `update(false)`.** `DynamicTexture.update()`
  flips Y by default, which maps canvas row 0 to `v = 1` — the *nadir* on Babylon's
  sphere, whose UVs run `v = acos(y)/PI` down from the zenith. A sky painted top-down
  and then flipped puts its stars, band and halo under the map and leaves the visible
  half showing the fog colour the gradient ends on. It does not look upside down; it
  looks like there is no sky at all, with a moon still correctly placed because the
  disc is geometry, not paint.
- **Stars live or die on dome resolution.** 360 degrees of texture against ~50 of
  screen is a hard magnification, so a dot much over a pixel arrives as a bokeh ball —
  hence a 4096x2048 dome and `starMaxSize` ~1.6.
- **The dome wraps, so anything painted near its edge must be painted twice**
  (`acrossSeam`). The left and right edges are the same piece of sky, a canvas clips
  instead of wrapping, and the widest mark on the dome is the moon's halo — wider, at
  these settings, than the moon's own distance from the wrap column. Miss this and you
  get a bright gradient ending in a straight vertical line down the sky. `wrapU =
  WRAP_ADDRESSMODE` is also required (Babylon's `DynamicTexture` defaults BOTH axes to
  CLAMP) but only fixes the filtering: the seam that shows is in the paint. `v` stays
  clamped — it runs pole to pole and has nothing to meet.

`Game.applySky()` no-ops when the environment object is unchanged. The map is
rebuilt every round; the sky is not, and repainting 8 megapixels of dome for an
unchanged sky is pure cost.

### The clouds are geometry

**They replaced two sphere shells of thresholded fBm, and what retired those was
the look rather than a cost.** A noise deck is a soft, continuous-tone smear — the
one register this frame does not draw in — and it had to be widened on purpose,
because a magnified *hard* alpha contour comes out as torn paper. Its lit side was a
second additive shell with a per-vertex mask, because a texture has no facets to
turn toward a light. A pile of lumps has facets, so the key is asked of each one and
banded like every wall in the village, and the silhouette is an edge the geometry
draws. `systems/cloudMasses.ts` is the shape (pure arithmetic, `glassFracture`'s
shape) and `shaders/CloudShader.ts` is the light.

- **One mesh, one material, one draw.** The whole ring is a flat-shaded triangle
  soup — every triangle owns its three corners, which is what gives each facet its
  own normal — merged once when the sky is applied. Measured: 12,640 triangles
  on Harrowmead (`cloudCover` 0.55) and 14,080 on Coldharbour (0.62), measured
  when Hollowmere still carried 16,640 at 0.72. Hollowmere is 0 now, and a cover
  of 0 builds no ring, no material and no draw at all.
- **A cloud is a long BANK of flattened icosphere lumps with a flat BELLY.** One
  subdivision, because the facet is the look; four to eight lumps a row, swelling
  toward the middle and thinning to the ends, a thinner tier SLID one way along the
  top rather than a crown sat square on it, and on most clouds a short tail off the
  end the tier shears toward. Five things were each photographed the wrong way first
  and are now rules in the file: a lump may never rise more than `MAX_LUMP_RISE`
  (0.38) of its own half-width — at three quarters every lump was a faceted BALL,
  and six to thirteen of them a cloud read as popcorn, or as pale boulders hung in
  the sky, which is what the player called "too 3D and solid"; the belly is PRESSED
  toward the base plane (`BELLY_SQUASH`) rather than clamped onto it (a clamp gave
  every cloud one smooth slab of floor that the haze shaded like sheet metal); the
  whole pile stays LOW against its width, because a tall faceted mass is a rock
  before it is a cloud; a tail many times longer than it is tall ends in a POINT and
  read as a blade; and every corner carries the lump's SMOOTH normal (the unjittered
  ellipsoid's gradient, the squash dividing its y) beside the facet's, for the
  shading below.
- **The clouds stand IN THE WORLD, over the map — and that is the rule the first
  version broke.** It rode at `infiniteDistance` like the dome, and a player
  walking across Harrowmead watched every cloud walk with them. The ring is now
  laid out in real metres about the map's centre, `max(minRadius, perMapSize ×
  size)` out (1200 m on the three small maps, 3000 m on Cinderhaven), so its bases
  are a few hundred metres up and a cloud slides across the sky as the eye moves
  under it. **It scales with the map because a ring is only a sky from inside
  it**: one distance that moved visibly on a 400 m map left Cinderhaven's players
  walking out from under theirs. 2 km on every map was tried first and slid a cloud
  four degrees over 150 m of walking, which a player who had just said the clouds
  followed them would have said again.
- **Real positions, ONE DEPTH.** A kilometre-wide cloud a kilometre out is not
  reliably farther than every ridge and crater the camera can see, so a depth test
  on its real distance draws it over a mountain. The vertex stage projects x and y
  for real and pins clip z just inside the far plane (so no cloud is ever clipped
  by it), and the FRAGMENT writes the depth of a point `clouds.depthMetres` (7 km)
  out ALONG ITS OWN PIXEL'S RAY. Every world surface is nearer, so every one hides a
  cloud; the disc is stood at `moonDepthDistance` (9 km, scaled so it keeps its
  angle), so a cloud hides the disc.
- **Along the ray, never down the view axis — the axis version shipped and flipped
  the order at the side of the screen.** The buffer stores view-axis z, and the disc
  9 km out has a z of 9 km × cos(its angle off centre). A constant written as the
  depth of 7 km DOWN THE AXIS fell behind the disc's past about 39° off centre, so on
  Cinderhaven the moon sat behind a cloud until the player turned to put it toward
  the edge of the screen, and then drew in front. A point at radial D on a view ray
  (x, y, 1) has z = D / |ray|, so the fragment writes `a − (a·n/D)·|ray|` (`a = f /
  (f − n)`), taking the ray from `fragmentInputs.position` — which makes the clouds'
  distance and the disc's the same kind of distance at every pixel, and 7 against
  9 holds everywhere. The ray comes from the pixel position rather than the
  interpolated view direction so every fragment on one pixel writes bit-identical
  depth, which the tie below needs.
- **It cannot simply write NO depth, and that was tried.** The disc's colour was
  covered, but the glow is occluded by the frame's depth buffer
  (`GlowPass`), so the disc went on BLOOMING through every cloud in front of it.
- **One shared depth is why the lumps are drawn back to front.** The buffer cannot
  say which lump is in front, so `Sky.sortClouds` rewrites the index buffer
  farthest lump first whenever the eye has walked `resortMetres` or the ring has
  turned `resortTurn`, and the test is LEQUAL so a later tie wins. Back-face
  culling makes each closed lump right on its own. The depth is written per PIXEL
  rather than interpolated because a per-vertex z/w in float32 near 1
  wobbles by about one 24-bit LSB, which would speckle every overlap.
- **The clouds draw in group 0, on its ALPHA-TEST list** (`needAlphaTesting` on
  the material, which tests nothing) — after every opaque surface and before the
  group's particles and blended meshes. Both halves are load-bearing. After the
  opaque list, because the dome is depth-TESTED at `domeRadius` (600 m) and paints
  over any cloud drawn before it. Before the blended draws, because those write
  no depth, so a cloud drawn after them passes its test wherever they stand
  against the sky: the clouds had rendering group 2 to themselves once, and every
  capture ring, beacon, tracer and plume against the sky was drawn over. The disc
  (group 0's blended pass, after them) needs no order from them — it stands behind
  the depth a cloud writes and is rejected by it.
- **The drift is a TURN of the mesh about the map's centre and never of what lights
  it.** The key is asked of the world normal in the shader, so a cloud coming round
  into the sun lights on its sun side. A baked colour would carry its lit face away
  with it, which is the trap the old second shell existed to dodge.
- **The light is asked MOSTLY OF THE LUMP and only partly of the facet**
  (`CONFIG.sky.clouds.facetShare`, 0.45). Lit per facet alone, every triangle took
  a tone of its own and a cloud was a crystal of forty greys; lit off the smooth
  normal alone, the terminator is an airbrushed curve. Between, it is one cut line
  across the lump that breaks along the facets — the frame's own hand-cut edge.
- **The shading is cel TONES, every edge a one-pixel `fwidth` cut:** the key cut
  once just past the equator (`wrap`, -0.1) and again at `highlight` (0.45), so the
  lit side is two tones (`litStep`) and a flat bank's top has a broken bright ridge
  rather than one cream shape; a belly a tone darker where the SMOOTH normal faces
  down, so it is one band along the base; a SILVER LINING on the RIM, looking
  toward the light; and the dome's colour over everything (`air`) and much more over
  the low ones on the dome's own schedule (`hazeAtHorizon`).
- **The shadow side is pulled toward the DOME'S GRADIENT behind the pixel**
  (`shadeSky`), which the fragment rebuilds stop for stop from `zenithColor` and
  `horizonColor` — a cloud's shade is lit by the sky all round it, so it is a darker
  patch OF the sky rather than a solid in front of it. **The gradient and never the
  baked halo**: taken with the halo, a cloud crossing the sun went the halo's own
  colour and vanished into it.
- **The wrap was POSITIVE once, and on a low sun that lit the whole cloud.** The
  lumps are flat, so their tops and bellies have normals nearly square to a light a
  few degrees up, and a terminator below the equator put all of it on the lit side —
  peach against a peach sky. The same flatness is why **the lining asks for a LEVEL
  normal as well as a grazing one**: seen almost edge-on, a flat lump's whole top
  and belly graze the view, and a graze-only lining went over all of them.
- **What still washes a cloud out next to the sun on Harrowmead is the SHAFTS, not
  this shader** — measured by switching `Volumetrics` off at the same frozen
  vantage, where the same clouds stand clear. That is the map's `air` tuning.
- The palette is the map's `SkySpec`: `cloudColor` the shadow side before the dome
  takes its share, `cloudLitColor` the lit one, `cloudLitStrength` how far a lit
  facet goes toward it, `cloudCover` the share of the ring's count.
- **Unfogged by the cel fog.** A cloud is SKY; the air it takes is the dome's
  gradient, not the village's fog wall. On Hollowmere and Greyfen a 78 m fog would
  otherwise erase the sky entirely.

`Volumetrics` (`src/shaders/Volumetrics.ts`) is the game's ONLY light-shaft
effect. It raymarches the air: step along each pixel's view ray in world space,
ask the moon's shadow map whether each step is lit, weight it by a height-falloff
haze density, and add the sum back into the frame through a Henyey-Greenstein
phase function. It is bounded at the near end by the camera and at the far end by
whichever comes first — the geometry the frame already drew (`FrameDepth`) or the
edge of what the shadow map knows.

**IT REPLACED A SCREEN-SPACE PASS AND THAT PASS IS GONE.** `GodRays` accumulated
bright pixels along a line toward the moon's projected position, so its luminance
threshold WAS its occlusion test, it could only draw a beam whose source was on
screen, and it was detached outright for 22 of 24 bearings on a level sweep. The
march needs none of that: the light does not have to be in frame and neither does
the occluder, which is what buys a shaft through a doorway seen side-on or a bar
of light down a street with the moon behind you.

**One mechanism and not two.** The old pass was not kept as a cheap rung, because
two shaft mechanisms means two sets of per-map numbers, two calibrations and a
frame whose look changes with a quality setting rather than only its fidelity.
The player's ladder is `off / low / medium / high` and it is the same effect all
the way down — see `Settings.volumetrics`.

### What it costs, and the caveat on that number

Measured with `?gpu` at 1920x1080, headless uncapped, three interleaved passes of
8 s, camera on the moon so both arms are at their most expensive. GPU `frame`,
against the shafts' own 32 taps:

| rung | taps | Hollowmere | Cinderhaven |
| --- | --- | --- | --- |
| low | 8 | -0.036 ms | -0.033 ms |
| medium | 16 | -0.010 ms | -0.019 ms |
| high | 32 | +0.233 ms | +0.070 ms |

CPU `tick` did not move on either map in either direction, which is the whole
design: the march builds nothing, walks nothing, adds no draw to the scene, and
every input it reads was already computed for something else — the depth image is
`FrameDepth`'s (shared with the ink and the blur), and the shadow map and its
matrix are `ShadowSystem`'s, published to the cel materials whether this exists or
not. That matters on a frame that is draw-call bound with the GPU at 25-30%
(`FINDINGS.md` 17).

**The table is worst-case to worst-case and does NOT say this is free over a
round.** The old pass cost nothing whenever the moon was off screen; this one is
attached always, because that is the point of it. Read the average as roughly the
whole pass — about 0.75 ms of GPU.

### The three things a reader must not get wrong

**The rung is a SAMPLE COUNT and not a resolution.** A `PostProcess` with `size`
under 1 renders the chain's whole image into a smaller target and every pass after
it reads that target — so a half-res march is a half-res FRAME. Scaling the march
itself needs a render target of its own plus a depth-aware upsample; the
measurement above says the taps are not what this costs, so that structure has not
been built. The count is a WGSL `const` interpolated per rung, so **each rung is
its own compiled shader** and a rung change is a REBUILD (`Game.setVolumetrics`),
not a uniform write.

**The reach is the shadow window's HALF side.** `EnvironmentSpec.lighting
.shadowWindow` is a square centred on the player, so from the eye there is only
`frustumSize / 2` of shadow information in any direction — 55 m on the default
110 m window. Past that `shadowAt` answers "lit", exactly as `celShadow` does for
a surface, and the same `edgeFade` ramp is used so the air and the floor under it
stop knowing together. A map that raises its shadow window gets a longer march for
free and pays in texel density exactly as its shadows already do.

**CHARACTERS OCCLUDE, THROUGH A MAP OF THEIR OWN.** They did not when this
landed, and the reason was never that rigs are expensive to draw: the world's
depth pass re-renders only when its texel-snapped focus MOVES, and one animated
caster in its list turns it into a per-frame redraw of the village. So the
answer was a second map rather than more casters in the first —
`systems/BodyShadows.ts`, one draw call whatever the roster — and `shadowAt`
asks both volumes and takes the `min`.

**The two windows are deliberately different sizes**, and that asymmetry is the
point rather than a compromise. The world's is the map's `shadowWindow` (110 m
by default) and the bodies' is 48, so a beam is cut by walls for the whole march
and by bodies only within 24 m of the eye. That is where a body cutting a shaft
is worth anything: at 40 m a soldier is a smudge in haze and the cut is a few
pixels of noise.

**What is left unoccluded is the LOCAL PLAYER**, who has no rig in first person,
and a flying hull high enough to throw its shadow outside that window. Neither
is a regression against the screen-space pass, which could not see an off-screen
occluder at all.

### The map's own air

`SkySpec.air` (`{ density?, intensity? }`) are MULTIPLIERS on
`CONFIG.graphics.volumetrics`, both 1 by default, so a map that says nothing gets
the config's night village. Multipliers rather than absolutes is what lets the
base be retuned without walking six files.

**The six shipped values were carried over BY RATIO from the screen-space pass and
are not tuned against the march.** Each map's old `rays.intensity` as a fraction of
that pass's own default — how much shaft this map wanted relative to the night
village — is the half of the old pair that still means something. The other half
was a luminance threshold, which a march has no use for: it is gone, not
converted, and with it every bracket argument that used to sit in the map files
(Coldharbour's `fogColor`/`mistColor` luma pairing, Greyfen's measured margins,
Sarab's `glint` ceiling). Those numbers were kept where they are also the right
look, and their comments now say which. **Greyfen's 1.54 deserves the least trust
of the six** — its original argument was three failure modes of the old
accumulation (a small source, a canopy eating the walk, `decay` running on blocked
taps) and not one of them exists in a march.

**The phase function reads the KEY LIGHT and not the sky's disc.**
`Volumetrics.setLightDir` takes the negated `EnvironmentSpec.lighting.direction`,
which is the light whose shadow map it marches. `Sky` derives its disc from that
same field and then withholds it when a map sets `discRadius: 0` — which the old
pass read as "switch off" and a march cannot, since a zero vector into the phase
cosine scatters sideways everywhere. So a sky with no source DRAWN is still air
lit from where the shadows fall, and `Sky.moonDirection` is gone.

**THE SHAFTS ARE SCREENED ONTO THE FRAME AND CAPPED AT THEIR OWN COLOUR, and that
is what made thick air affordable.** They used to be ADDED: `scene + tint * s`. On
Harrowmead, tuned thick enough for a beam to show through the ash rows at eye
height, the whole sun quarter of the frame clipped to white, and white is the
wrong failure for a golden hour — each channel clips on its own, and the gold is
exactly the ratio between channels that clipping throws away. So the march's result
is now capped on its brightest channel (`raw / max(1, max(raw))`, which keeps the
hue) and screened: `scene + lit * (1 - scene)`. Against a dark trunk or a shadowed
wall that is the whole of the light, which is where a beam is SEEN; against the sky
beside the sun, already near the top, it is almost nothing. **A saturating curve
(`1 - exp(-s)`) was tried first and was worse the other way**: it squeezes every lit
tap toward one value, so the gap between a beam and the shadowed air beside it —
the only thing that makes a beam a beam — closed into haze. For thin air all three
forms are the same number, so a map whose shafts were already faint is unmoved.

**`anisotropy` is held below what real haze measures, and the constraint is the
8-bit chain.** `DefaultRenderingPipeline` is built with `hdr = false`, so whatever
the forward lobe returns has to fit in the same 0..1 the village is drawn in —
there is no tonemapper downstream to pull a highlight back. Off the phase
function: g 0.68 is **54x** brighter looking into the light than across it, which
is either a white screen forward or nothing at all sideways, and no exposure is
both. 0.55 is 16x, which an LDR frame can hold at both ends. Raising it is what an
HDR chain would buy.

## The capture zone: laid out in the world, not drawn over it

`CaptureZoneSystem` is the point's boundary and its flag. The rules are about
DRAWING; the meter they annotate is `ConquestSystem`'s and is in
[`CLAUDE.md`](../CLAUDE.md).

- **The ring is the boundary.** It is built at `ControlPointDef.radius`, which is
  what `pointAt` tests, so the line on the floor is not an approximation of the zone —
  it is the zone. Drawing it anywhere else is worse than drawing nothing.
- **It is a thing somebody LAID, not a light nobody could have.** It replaced an
  emissive band with a translucent skirt over it, both in the owner's colour and
  pulsing while contested — a game element painted over the world. Now it is
  whitewashed stones on open ground and a painted line on MADE ground (a
  carriageway, a deck, a plinth, a slab), both in the cel material, so they are lit,
  shadowed, fogged and inked like the wall beside them and owe no fade of their own.
  The stones are seeded per zone and merged one mesh per tone, so a ring is at most
  three draws. **Nothing on the ground says who holds the point**: the flag and the
  HUD strip already say it, and colour on the floor was the part that read as UI.
- **It follows the surface you STAND on, not the terrain.** A 28 m ring placed by one
  height sample at the flag is buried at one end (the problem `terrainSlab` solves for
  roads), and sampling `TerrainField` alone is still wrong, because most flags sit on
  something built. The ring takes the highest obstacle-box top up to a step over the
  flag's own `y` (or the floor, where a hillside rises past it) — **but only when it
  is BROAD**, the same top carrying on 0.6 m every way, so a crate or a wall top is
  never mistaken for the floor — else the drawn terrain plus any road sheet on it.
  **Not the nav graph**: it resolved Hollowmere's churchyard ring, flag and all, to
  the ground under the 2 m plinth, which is where the old ring had been drawn.
- **It breaks where it meets a wall.** A stone or a stretch of paint that would
  stand inside a box (`ObstacleField.wallAt` over the band a stone occupies) is not
  laid, so a boundary crossing a building stops at its walls as a real one would.
- **Markers are dressing.** No `solid`, no collider, no `WorldBox`, `noGlow`,
  `noShadowCaster` (the world's caster list is fixed before a round's markers exist,
  and a stone's shadow is centimetres); a body walks over a boundary stone. The paint
  takes `ROAD_DEPTH_UNITS` for a road's reason and is `noInk` by intent only.
- **The flag IS the meter, and it is cloth rather than a picture of cloth.**
  `FlagCloth` replaced a translucent 20 m beacon: a pole with a flag flown at
  `|meter|` of its height in the colours of the side the meter leans to (`teamLook`'s
  worn colour, a darker hoist band), so a neutralisation is the flag coming down in
  the owner's colours and going back up in the attacker's, and a point nobody has
  touched flies plain canvas at the foot. The sheet is a Verlet grid (16 x 10) with
  stretch, shear and soft bend constraints, its hoist pinned to the pole, pushed
  **per triangle** by the part of the air it faces — `CONFIG.wind.flag`, in SI units,
  on `CONFIG.wind.dir`'s bearing with a gust on the foliage's own wavelength and a
  cross-flow that travels from hoist to fly. A vertex wave is what it must not become:
  every ripple the same height and nothing that droops or snaps is card, not cloth.
  It steps at a fixed 120 Hz, only past neither the fog wall nor the edge of the view,
  and casts no shadow because it moves every frame. **Its cost is the constraint
  loop**: at 16 x 10 and seven passes, five flags in view from Harrowmead's corner
  spawn were 0.36 ms of the frame — more than the rest of `gameplay` — so it runs four
  passes, and a flag past 44 m (back under 40) is simulated on an 11 x 7 sheet that
  the running one is RESAMPLED into, velocity and all, so the handover does not
  re-settle. The profiler files all of it under `zones`.
- **Cloth is the one thing shaded SMOOTH** (`getCloth`, `CEL_SMOOTH`): the cel
  shader's facet normal on a grid that fine is a lattice of flickering diamonds, so a
  bending sheet takes the interpolated normal and the bands still cut hard along its
  folds. Nothing else may use it — a coarse primitive's facets are the look.
- **A pole never goes through a ceiling.** Many points are INDOORS (Hollowmere's
  chapel, barn and dock shed, a Greyfen house, three of Coldharbour's office floors),
  so `mount` casts up from the ring's own surface once at build and, if the 10 m pole
  is not clear, flies the flag from the ROOF over the point on a 6 m pole instead —
  found by one `castBody` down from above. A layout that moves a point under a roof
  owes nothing; one that stands it beside a tall wall should expect the fly to cross
  it, because the cloth collides with nothing.

The through-line is that every one of these is a case where the honest thing to
draw is not the cheap thing to draw, and the cheap version fails in a way that
reads as a *rules* bug rather than a drawing one: a ring that is not the zone
makes a capture look broken, a ring buried in a slope makes it look absent, a
skirt at a readable alpha makes the screen white, a marker that does not fade
makes a flag at 200 m look like a flag at 20, and a pole through a chapel roof
makes the whole village look like a set.
