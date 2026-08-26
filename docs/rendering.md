# Rendering: lights, fog, ink and the sky

The four light terms and the sixteen slots, the three passes that owe their own
fog, the constraints that look like bugs if you undo them, and the painted sky.
Split out of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is
the contract for `LightingSystem`, `ShadowSystem`, `CelMaterialFactory`, the
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
is `gl_FragColor = color`), the `GlowLayer` builds its bloom from a material's
emissive colour, which says nothing about where the mesh stands, and
`getEmissive()`'s unlit `StandardMaterial` — every lit window, flame, ember,
tracer, spark and team-colour bar — draws a flat colour with lighting disabled.
All three take their fog from the one published by
`CelMaterialFactory.setEnvironment`, so nothing can describe different weather
from the wall it hangs in front of — but they take it at **different
granularities, and the difference is forced**:

- **The outline fades per PIXEL**, baked into its shader by `src/shaders/OutlineFog.ts`.
  It has to. `BlockMerge` gives one mesh per 48 m block, so a per-mesh ink fade
  leaves the far half of a block in clear ink over a wall that has already gone
  to fog — measured on Greyfen, **50 of 687 outlined meshes span the entire fog
  band** (fog 0.0 at the near edge, 1.0 at the far), and those 50 are the
  village. Thinning is not a substitute: `outlines.minScale` still leaves a line,
  and a line of un-fogged ink is as visible thin as thick.
- **The bloom fades per MESH**, through `fogAmountAt` in
  `glow.customEmissiveColorSelector`. The glow map is generated from a material's
  emissive colour with no per-pixel hook at all, and it is affordable here where
  it was not for the ink: a bloom is a soft blob with no edge to misplace, and
  only 4 of 290 emissive meshes span more than half the fog band.
- **The emissive material fades per PIXEL**, through a `MaterialPluginBase` in
  `src/shaders/EmissiveFog.ts` that injects the same curve at
  `CUSTOM_FRAGMENT_MAIN_END`. A plugin *can* declare real uniforms, so unlike the
  ink this one is a buffer write rather than a re-bake — `setEmissiveFog` needs no
  cache invalidation at all. Distance is `vPositionW` against `vEyePosition`, both
  unconditional in `default.fragment`.

That this was invisible for a whole map is the point: on Hollowmere unfogged ink
is near-black against near-black fog and an unfogged glow reads as a lamp doing
its job. **A bright fog is what makes an un-attenuated pass obvious**, and
Greyfen showed all three — a stand of dead trees whose trunks fogged to pale grey
while every branch stayed a black scratch (a branch is 0.04 m of geometry inside
a 0.05 m ink shell, so it is almost entirely outline), six chapel windows that
were three saturated cyan bars on a wall faded almost to white, and a cottage
window measured at 77.6 m — inside a `fogEnd` of 78 — coming back rgb(249,177,92)
against its own `#ffb257` over a fog of rgb(194,204,212). **Fading the bloom is
not fading the thing**: the selector dimmed the halo around that bar and left the
bar. With the plugin the same pixel reads rgb(196,204,210).

**The three obvious cheaper fixes for the emissive pass are all wrong, and the
first one is the trap.** `scene.fogMode` would have been one line —
`StandardMaterial` has fog built in — but Babylon's is linear/exp over VIEW-SPACE
z where the cel shader's is `t*t` over the RADIAL distance, so a window over-fogs
against its own wall through the whole middle of the band and disagrees by up to
1.4x at the corners; it is also scene-wide, so the sky dome would need opting out
by hand. A `ShaderMaterial` of our own loses `material.emissiveColor`, which is
what the GlowLayer's selector reads — every lantern, tracer, visor and reticle in
the game stops glowing. And baking literals the way `OutlineFog` must is pure
cost here, where uniforms are available.

**`OutlineFog` is the only place this tree touches Babylon's compiled-effect
cache, and its header is the argument for why.** `OutlineRenderer` hardcodes its
`uniformsNames`, so the fade cannot be given a uniform at all: the distance is
recovered from `viewProjection` in the vertex shader (rows 0/1/3 are `P00*right`,
`P11*up` and `forward`, and the eye is the point whose clip x, y and w all
vanish — verified exact to 1e-6, and it must be that radial distance rather than
the free `gl_Position.w`, which disagrees by up to 1.4x at the corners), and the
fog colour and range are baked in as literals. Re-baking therefore has to make
Babylon forget the compiled programs, since it rebuilds a submesh's effect only
when its *defines* change, which a re-bake does not.

Three rules about that invalidation, all learned the hard way:

- **Clear the draw wrappers FIRST and IMMEDIATELY, then forget the cache entry.**
  `mesh.resetDrawCache()` defaults to `immediate = false`, which does not merely
  drop each wrapper — it queues that wrapper's `Effect.dispose()` on the engine's
  `endFrame`, and a dispose is a REF RELEASE: Babylon ref-counts an effect by how
  many wrappers asked `createEffect` for it, and the release that reaches zero
  deletes the GL program and drops the cache entry itself. Deleting the entry by
  hand *first* desynchronises that count. The bake runs inside `startRound`, so
  the order was: forget the entry, clear ~500 wrappers with their releases still
  pending, build and render the new map (which compiles a fresh effect, the entry
  being gone, and hands it to every wrapper the frame rebuilds), and only then, at
  `endFrame`, do the queued releases land and take a LIVE generation to zero — its
  program deleted under the wrappers still pointing at it. **The map is rebuilt
  after the bake, so its meshes are innocent and the damage lands only on what
  SURVIVES a map change: the pooled bot rigs and the viewmodel.** Their outline
  shells then draw from a deleted program as garbage that swallows the body it
  belongs to — on Greyfen's pale fog a squad reads as flat yellow cut-outs of
  itself, measured at 534 of 642 outline wrappers holding a freed effect one
  switch in and compounding with every further switch, while on Hollowmere the
  same garbage is near-black against near-black and invisible. Resetting
  immediately puts the releases back inside the bake, where the last one frees the
  effect with nothing holding it; the delete that follows is a backstop that can
  now strand nobody. `_releaseEffect` is still not the way to do it — it deletes
  the program on the spot, wrappers or no wrappers.
- **Scope that reset to the outline PASSES, not the whole mesh.** An unscoped
  `resetDrawCache` disposes every material's wrapper too, and disposing is a
  release: with nothing else holding them the cel materials, the sky and the
  post-process chain lose their programs and recompile. Measured on a map change:
  15 recompiles unscoped against the 1 the outline itself owes.
  `OutlineRenderer` keeps its four render-pass ids in `_passIdForDrawWrapper`.
- **Reset the draw cache of EVERY mesh in the scene, and never filter that walk.**
  The reset is the whole mechanism, not a belt-and-braces beside the cache delete:
  `OutlineRenderer.isReady` asks the engine for an effect only when its *defines*
  string changes, and the outline pass's defines never change, so a draw wrapper
  that already holds an effect never consults the cache again however many entries
  are forgotten. Two narrower sets have both been tried and both were wrong. The
  outline REGISTRY misses `ViewModel`'s ~40 meshes, which set `renderOutline` by
  hand and never call `addOutline`. `scene.meshes` filtered on `renderOutline`
  looks exactly right and is the same mistake one layer along: the flag is a
  runtime toggle — `Bot.setOutlines` clears it past `lodOutlineDistance` (20 m),
  so most bot rigs have it off at any instant — and rigs are POOLED, alive across
  every map change, so one LOD'd out during a re-bake keeps last map's fog for the
  rest of the session. Greyfen → Hollowmere left 148 wrappers mixing ink to
  `#c2ccd4`, which at the fog wall IS the ink: each rig's nine merged meshes read
  as white slivers scattered over the village, and it survived a whole session
  because a fresh boot has only one bake and nothing stale to keep. Unfiltered
  costs 4.9 ms for 1,910 meshes across the four passes, once per fog change,
  beside a ~570 ms map build.
  `setOutlineFog` owns its own invalidation for exactly this reason — the first
  cut split it across the caller and got that list wrong.

**The ink's TINT is the MAP's, and it is derived rather than authored, because an
unlit line over a lit surface is only a line while it is the darker of the two.**
`inkColorFor` returns `albedo * tint` and the ink carries no lighting at all —
that is the whole of the `CEL_INK` branch, and Babylon's `gl_FragColor = color`
from the other side — while the surface under it is `albedo * light`. So a
constant tint inverts into a bright HALO the moment the light term falls under
it, and it flips with the SHADOW rather than with distance: on Greyfen a trunk in
the sun was outlined in ink and the same trunk two steps into the canopy's shade
was outlined in something twice as bright as itself. Greyfen's own environment
file records the re-lighting that caused it (ambient 0.7 → 0.24, key 1.12 →
1.55) with no mention of this end of it, which is exactly why the number is no
longer one somebody has to keep in step by hand.

**The first derivation was still too bright on every map, and by 2.2x to 2.9x.**
It took `outlines.shadeHeadroom` (0.6) of the LUMA of `ambient + skyFill * 0.5`,
which describes a vertical face in shadow that is fully unoccluded — and three
separate things in the frame are darker than that:

- **Occlusion.** `vBaked.w` multiplies both ambient terms and the bake runs the
  full `[0.45, 1]` its strength allows, so the darkest a shaded face gets is
  `1 - CONFIG.ao.strength` of what that reference assumed. The places it reaches
  are creases, eaves and doorways — exactly where outlines are densest.
- **The sky fill is not there at all on an underside.**
  `band(0.5 + 0.5 * n.y, 3.0)` is 0 for `n.y <= -1/3`, so every soffit, sill and
  branch-bottom receives the flat ambient and nothing else; the old reference
  credited it with half the fill.
- **A scalar tint against a coloured light.** The ink is `albedo * tint` per
  CHANNEL and the surface is `albedo * light` per channel, so one number
  compared against a luma inverts in whichever channel the ambient is weakest
  in. On Greyfen — a green ambient — that is the blue: the old tint 0.099 sat
  above a blue ambient of 0.087 before occlusion was applied at all.

So the ink is the albedo under the DARKEST LIGHT the shader can actually put on
it: `ambient * (1 - CONFIG.ao.strength)`, per channel, times
`outlines.shadeHeadroom`, clamped per channel to `outlines.tintFactor`. Every
other term of `light` is either absent by construction in that case (the key is
shadow-gated, the sky fill is `n.y`-gated to zero) or purely additive (the point
lights, the rim, the specular), so `light >= ambient * ao >= ambient * (1 -
strength)` holds for every pixel of every cel-shaded mesh — and the ink is under
it as ARITHMETIC rather than as a headroom number chosen generously. Six things
follow:

- **The atmosphere cannot undo it, which is why the guarantee is worth having.**
  Both the fog and the ground mist are convex combinations toward a colour far
  above the ink, applied to the surface and the line on the same curve at the
  same distance — `OutlineFog` bakes the identical `t * t` — so `ink < surface`
  survives them. What the mist does to the hull is nothing at all, which is the
  safe direction: it lightens the surface and leaves the line alone.
- **What `shadeHeadroom` is left covering is the WEATHERING**, the one thing that
  darkens a surface after the light has been applied. `albedoVariation.amount`
  (0.14) is peak-to-peak, so a wall can arrive at 0.93 of its palette colour
  while the ink beside it is minted from that colour. 0.9 clears it, and doubles
  as the margin that keeps the line visible rather than exactly equal to the
  surface at the floor. Raise the variation and this comes down with it.
- **The FALLBACK is bounded the same way and is the weaker bound.** Hollowmere's
  road network is `cel-ground-*`, so it wears `outlines.fallbackColor` —
  rgb(0.070, 0.078, 0.102) against a cobble measuring (0.038, 0.054, 0.075)
  under the night ambient, a light line down every street. It is now clamped to
  the same floor, but a fallback has no albedo to scale, so it is bounded as if
  the surface were WHITE and a dark enough texture can still out-dark it. That is
  the honest limit of an ink for a material whose colour cannot be recovered, and
  it is why the authored value stays a CEILING rather than being replaced.
- **All four maps move, and none of them is the one that showed the bug.** Per
  channel, the tint goes Greyfen 0.099 → (0.038, 0.046, 0.035), Hollowmere
  0.103 → (0.041, 0.056, 0.078), Coldharbour 0.212 → (0.085, 0.092, 0.104),
  Harrowmead 0.190 → (0.060, 0.066, 0.073). What it costs is brightness, in the
  amount by which each was wrong; what it keeps is more colour than a scalar
  carried, because the ink now takes the map's ambient hue as well as the mesh's
  — Hollowmere's lines are blue where Greyfen's are green.
- **MEASURED, and the measurement is most of the work.** Each map rendered twice
  from the same eye — once as shipped, once with every outline and ink twin off —
  and the pixels the ink pass touched compared against what they covered. Mean
  ink luma falls Hollowmere 0.036 → 0.025, Greyfen 0.059 → 0.045, Coldharbour
  0.142 → 0.125, Harrowmead 0.071 → 0.039, and no outlined mesh on any map now
  carries an ink over luma 0.054 (that one is the road, at the clamped fallback).
  **Take the whole post chain off before believing any of it**: bloom spreads a
  lit window over a wide radius, FXAA smears every edge, the god rays build their
  shafts from an occlusion mask of the scene and the film grain is fresh noise
  over the frame — so toggling ANY mesh moves pixels nowhere near it, and the
  first cut of this measurement reported a cottage window as ink and put 96% of
  the frame in the diff.
- **Both ink paths owe a re-resolve on an environment change, and they get it
  from different places.** The cel materials take it from the `applyEnvironment`
  walk `setEnvironment` already runs, which recovers the palette colour out of
  the material name `getInk` mints (`cel-ink-<source>`). Babylon's hull holds
  `outlineColor` per MESH and is in no walk at all, so `reinkOutlines` goes over
  the outline registry instead — and that registry is the right set here where it
  is the wrong one for the fog above. `ViewModel` is missing from it and does not
  need to be in it, because it inks itself BLACK rather than from `inkColorFor`.
  What it does carry is the pooled bot rigs, which outlive every map change.

**What is left LIGHT after all of that is the fog, and it is meant to be.**
Past the fog wall the ink IS `fogColor` — pale green on Greyfen, cream on
Harrowmead — and the surface it outlines is that same colour, because they
dissolve on one curve. A silhouette against the SKY is where that reads as a
bright line, the sky being the one thing in the frame the world's fog never
touches; the object behind the line is equally pale, so the line is not brighter
than what it belongs to. Undoing it is the regression `OutlineFog` exists to fix
— black scratches over a wall that has already gone to fog.


**A fifth term modifies two of the four, and it arrives as a VERTEX ATTRIBUTE
rather than a uniform.** `world/vertexShading.ts` bakes per-vertex ambient
occlusion once per map build, out of the collider boxes `MapBuilder.collider()
already records plus the terrain under them, and the cel shader multiplies it
into the flat ambient and the sky fill — **not** the key light, which the shadow
map already owns, and **not** the point lights, for the same reason those ignore
the shadow map: a lantern in a doorway has to light the doorway.

Three rules about it, and the first is the one everything else rests on:

- **Occlusion lives in the colour buffer's ALPHA, and 1 means unoccluded.** A
  mesh with no colour buffer leaves that attrib array disabled, and a disabled
  generic attrib reads `(0, 0, 0, 1)` — verified in
  `ThinEngine._bindVertexBuffersAttributes`, which `continue`s past a missing
  buffer after `unbindAllAttributes()`. Alpha therefore defaults to exactly the
  neutral value, so the pooled bot rigs, the viewmodel's meshes, the grenades and
  the death cam's stand-in body are all correct **without carrying a buffer at
  all** — no define, no branch, and above all no fourth `cel-<variant>-#rrggbb`
  cache entry for `outlineInkFor`'s regex to learn. RGB defaults to 0, which is
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
  `GlowLayer` builds its halo from `material.emissiveColor` and never saw the
  vertex buffer. `walk` skips anything whose material is not a `ShaderMaterial`.

The same buffer's green channel gates the cel shader's **albedo weathering**, a
slow value-noise drift over world position that stops a 48 m merged block
arriving as one flat tone. It is keyed on position rather than on anything
per-object because that survives the merge for free — and it is gated because a
world-keyed term on a *moving* mesh makes it shimmer as it walks.

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

Two consequences are worth stating plainly, because both look like bugs:

- **A swaying merge group leaves BABYLON's outline pass and draws its own ink
  instead**, and the first half of that is mechanical rather than a preference.
  `OutlineRenderer.isReady` builds the hull's effect with a hardcoded attribute
  list of position and normal — `const color = false`, literally — and a
  hardcoded `uniformsNames` with no clock in it. Patching the shader source, as
  `OutlineFog` does, cannot reach either list. So that hull can see neither the
  wind nor the per-vertex weight: an outlined leaf leans out from under a shell
  left standing at the rest pose, and a third of a metre against a five
  centimetre line is a dark ghost of the still canopy hanging behind the moving
  one. `mergeByMaterial` sets `noOutline` with the mark so the two can never be
  separated.

  What draws the line instead is `MapBuilder.inkTwin`: one inverted hull per
  swaying mesh, through this shader's `CEL_INK` variant, which has the wind, the
  weight, the eye and the fog already. Three things fall out of that which are
  better than what Babylon was doing, not merely equal:

  - **The twin SHARES its source's `Geometry`** — `Mesh.clone` hands the same
    instance to both — so eighty-odd of them cost no vertex memory, no upload
    and no second bake, and the ink cannot drift from the leaf because there is
    only one buffer to drift from.
  - **The width thins per VERTEX** against the same eye the fog uses, rather
    than per mesh in `updateOutlineScales`. That is a correction, not a
    convenience: `BlockMerge` hands out meshes spanning the whole fog band
    (measured: 50 of 687), which is exactly why the ink's *colour* fade was
    moved per pixel. This is the width catching up.
  - **It is one draw rather than two.** Babylon renders an opaque mesh's
    outline twice — once before it with depth-write off, once after with
    colour-write off to repair the depth buffer. An inverted hull with
    `cullBackFaces = false` and ordinary depth state needs neither pass, and
    needs no ordering against the surface it wraps: inside the silhouette its
    back faces lose the depth test, outside it they are the nearest thing there
    is, and that ring is the line.

  The fade is the surface's own, out of the same `fogParams` and `mistParams` in
  the same block, so a line over a wall dissolves on the curve the wall
  dissolves on — and picks up the ground mist, which `OutlineFog`'s baked
  literals cannot do at all. Verified on Greyfen: 81 swaying meshes, 81 twins,
  every one of them carrying a non-zero weight, and none of them in Babylon's
  pass or in the shadow map.
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

**Two more terms are per-material opt-ins, and they are three cache variants rather
than a matrix.** `getGlossy` adds the toon specular (`specColor`/`specShininess`)
and `getTranslucent` the translucency band (`transColor`) — the key light coming
*through* a thin surface, for stall awnings and for every crown in the game —
a pine's needle tiers, a jungle canopy's plates, a hedgerow ash's leaf. Both default to a
**black colour**, which is what makes them free on materials that skip them: every
cel material carries both uniforms and zero multiplies the term out. A material is
matte, glossy *or* translucent — never two — because the cache is per colour and an
axis that multiplies is an axis that costs. Another such variant means a spec type,
an `apply*`, a `get*` under its own key, one entry in `UNIFORMS`, **and** teaching
`outlineInkFor`'s regex the new `cel-<variant>-#rrggbb` name, or the ink falls back
to the palette-neutral colour. The translucency term is directional both ways — it
needs the eye looking into the key light *and* the facet turned away from it — so it
can only be judged from under the thing, moonward.

## The glazing: the one thing here that is not opaque

`getGlass` is the fourth variant and the odd one out three times over, and each
difference is forced by what a window is. (`getInk` is a fifth, added for the
wind — see the outline note above. It is cheap to add to this roster because it
takes the albedo path away rather than adding one: it writes a flat colour and
falls straight through to the atmosphere block, so it needs no spec, no
translucency and no `outlineInkFor` name of its own — nothing outlines an
outline.)

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

**Both kinds carry a depth BIAS, and it is the only one in the renderer.** A pane hangs a few centimetres off the wall
behind it — `kit/city.ts`'s `glaze` stands 0.04 m of glass over the shaft, with
the collars proud of that again — and the depth buffer loses that gap with
distance. The near plane is 5 cm because the viewmodel's optics sit inside 5 cm
of the eye, and against a 24-bit buffer that leaves a step of 1 cm at 90 m, 3 cm
at 160 m and 27 cm at Coldharbour's fog wall. Measured square-on with the pane
held at a constant size on screen: full contribution at 40 and 90 m, **nothing
at all from 130 m out** — every distant tower back to blank concrete, with a
correct shader and correct geometry. `CelMaterialFactory.GLASS_DEPTH_UNITS`
(-16) is a polygon offset in the buffer's own units, so the correction is
millimetres up close and metres at the far end, exactly where the error is; the
near plane is spoken for and `maxZ` is worth nothing here (measured). What it
costs is the fins and collars standing 0.1–0.2 m proud of the glass, which the
bias overdraws past ~100 m where they are a pixel or two of trim.

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
here, and `CelShader`’s `PROBE_GLSL` for the uniforms and the Y flip the two
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
costing ~570 ms there. See `FINDINGS.md` §10 for the distance cull that halves
the render list, why it was not taken, and what would settle it.

**The probe stands at the centre of the glass it serves.** That puts it inside
the shaft of a tower's wrap-around curtain wall and exactly ON the plane of a
flat shopfront, and both are right for the same reason: a pane only ever
reflects the hemisphere in FRONT of it, so all that matters is that the probe
sees out in every direction its own panes face. For the shopfront that is free
— the office behind it is behind the probe too. For the tower it is what the
enclosure rule below is for.

Seven things about it are load-bearing:

- **A probe's bake leaves out whatever ENCLOSES it, and the floor is not an
  enclosure.** A mesh is dropped from a probe's render list if the probe is
  inside its world bounding box *and* it is not a flat receiver
  (`noShadowCaster`). The first half is coarse on purpose — the opaque world is
  merged per block per colour, so the mesh a tower's probe is inside is that
  block's own merged mesh and taking it out takes the tower with it. Measured
  across the 37 probes: 2.1 meshes dropped each, and cube coverage falls from
  0.84 to 0.57 for a tower and from **0.99 to 0.68 for a parked car**, whose
  probe sits inside its own bodywork. The second half is what saves the two
  corner towers that stand inside `ridge-rock`'s bounding box 44 m from any
  rock, and would otherwise be the only buildings on the map whose glass has no
  hills in it.

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
this engine is built with no stencil buffer at all (see `Game`'s constructor), so
the shell is not a ring around a pane but a dark plate behind the whole of it.
A window's frame is drawn by the mullion, the collar and the reveal, all of which
are geometry with ink of their own. Because nothing ever outlines a pane, glass
is also the one variant that owes `outlineInkFor`'s regex nothing.

**The shadow lookup is FOUR taps, and four is a ceiling rather than a budget.**
One tap put the depth map's own grid on screen — at 110 m over 2048 texels an
edge climbs in 5.4 cm steps — so the kernel spans exactly one texel, which is
the period of that staircase. Anything wider starts producing a real penumbra,
and a penumbra is the one thing the flat bands cannot have. The 2x2 is rotated
per pixel: four taps averaged give five values, five values along an edge are
five contours, and the rotation turns that residue into noise instead. Measured
as a containment check by collapsing the radius to zero (which makes all four
taps the same fetch, i.e. the old lookup): **0.33% of the frame differs, peaking
at 55/255** — a large change on very few pixels, which is the shape of something
confined to boundaries rather than spread over a penumbra.

**Grass and water sample that same depth map, and they are not cel materials.**
They reproduce the cel lighting model in their own shaders and went without a
shadow term entirely, which showed as a cottage's shadow stopping dead at the
edge of a grass rect and at the waterline. The lookup and the band function are
shared so all three sample one depth map with one kernel — as the WGSL includes
`celShadow` and `celBand` for a shader that has been ported, and as the GLSL
strings `SHADOW_GLSL` / `BAND_GLSL` that `CelShader` still exports for the two
that have not. `CelMaterialFactory.registerShadowConsumer` /
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
one LSB of triangular noise immediately before `gl_FragColor` in the cel, grass
and water shaders, which takes those contours to ~2 px. It is deliberately *not*
in `HorrorPost`: that pass is detachable by a player setting, and its grain is
already a ~10 LSB dither whenever it is attached — so the banding is a
**grade-off** artefact, and the grade-off frame is the one a pass inside the
grade cannot reach. The sky dome was the expected customer and measured as not
needing it (233 runs against 229): stars, the galactic band and the halo are
painted over the whole ramp, and the cloud decks sit in front.

The one exception is `ShadowSystem`'s `DirectionalLight`, which no material reads:
it exists only to define the shadow camera for its `ShadowGenerator`. The cel
fragment shader samples that depth map as a hard two-level term gating the key
light. The shadow window follows the player (texel-snapped, re-rendered only when
the snapped focus moves), casters are the map's merged static meshes re-registered
every round via `shadows.setCasters(map.visuals)` (skipping anything flat with
`metadata.noShadowCaster`), and characters get blob-shadow discs instead of casting.

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
is the override (Coldharbour: 200). It had to become one when a map lowered its
sun: shadow length is `h / tan(elevation)`, and the same 40 m tower throws 25 m
at 58 degrees and 90 m at 24. **What happens outside the window is not a fade —
`shadowVisibility` returns 1.0, fully lit, for any fragment outside the depth
map's UV or its depth volume**, so an undersized window draws a straight line
across open ground where the shadows stop and slides it along with the player.

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
`Player.floorY`.** `Player.probeGround` is a whole-scene ray pick (1,775 meshes
walked, 758 solid colliders tested, ~2.5 ms) and `ShadowSystem` used to cast the
identical ray for the identical body on the same frame. Anything else wanting the
floor under the player reads that field rather than probing again.

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

### Two traps that cost time

**A trailing `//` comment in a GLSL string may not contain a semicolon.**
Babylon's shader processor splits statements at every `;` and moves the
remainder to its own line, so the tail of the comment lands as code. The error
names a word from the middle of your prose and a line number that does not
match the file, which is as unhelpful as it sounds.

**It does NOT bite on the WGSL path, and that was checked rather than
assumed.** The WGSL processor's `preProcessShaderCode` runs `RemoveComments`
over the whole source before the cursor ever sees a line, so a comment is gone
by the time anything splits on a `;`. Comment WGSL freely; the rule above
stays because it is still true of every GLSL string in the tree, and there are
five of them left.

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
a store nothing wrote. **The one thing in the engine that does the opposite is
`OutlineRenderer`**, which picks WGSL for itself under WebGPU with no flag to
say otherwise; that is what `src/shaders/glslScaffold.ts` puts back, and it
comes out when `OutlineFog` is ported.

**What several shaders share is a registered INCLUDE and not an interpolated
string**, and the reason is specific to WGSL rather than tidiness.
`src/shaders/wgsl/includes.ts` writes `celBand`, `celShadow`, `celProbe`,
`celProbeBox` and `celDither` into `ShaderStore.IncludesShadersStoreWGSL`, and a
consumer reaches them with `#include<celShadow>`. The GLSL they replace were
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

**Sample with `textureSampleLevel` and never `textureSample`.** WGSL's
uniformity analysis rejects an implicit-LOD sample reached through non-uniform
control flow, which is what every early-out in a post pass and every `#ifdef`'d
fetch in the cel shader produces — the error reads as a real bug and names a
shader that has been correct for years. An explicit LOD carries no such
requirement, none of these textures has a mip chain, and Babylon's own WGSL
post shaders do exactly this. The alternative is `#define
DISABLE_UNIFORMITY_ANALYSIS`, which turns the diagnostic off wholesale; prefer
the explicit LOD where a LOD is what you meant, and keep the define for the
derivative work (`fwidth`, `facetNormal`) where there is nothing else to say.

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

**WGSL has `transpose()` and has no `inverse()`.** The eye position that
`OutlineFog` recovers from the rows of `viewProjection` is therefore still
recovered that way when that file is ported — for a new reason, because the old
one was that GLSL ES 1.00 had neither.

## Rendering constraints that look like bugs if you undo them

- `pipeline.imageProcessingEnabled` must stay `false`: the cel shader outputs
  display-ready colors and Babylon's image-processing pass re-gammas them and washes
  the palette out. That is also why the vignette/grain/aberration/damage flash grade is
  hand-written (`src/shaders/HorrorPost.ts`).
- Glow is a `GlowLayer` keyed off emissive color, deliberately not threshold bloom —
  bright-but-not-emissive surfaces must stay crisp.
- Flat shading is recovered in the fragment shader from screen-space derivatives of
  the world position. Do not call `convertToFlatShadedMesh()`; it would unweld vertices
  on every prop and clone for no visual gain.
- **A sampler a material DECLARES has to be bound, whether or not the variant
  it compiles sampling it.** The cel shader has one `samplers` list for all
  eight variants, so `shadowMap` reaches the bind group layout of every one of
  them — and a layout entry with nothing behind it is not the harmless no-op it
  was on WebGL2, where an unbound sampler read as black and the frame carried
  on. The bind group fails to build and every draw using it is lost.
  `CelMaterialFactory.getInk` is the case that found it: `CEL_INK` is unlit,
  binds no lights and used to bind no shadow either, so Hollowmere's two
  swaying merge groups took their ink twins, `Failed to read the 'resource'
  property from 'GPUBindGroupEntry'` and a black frame with them.
  **UNIFORMS are the opposite and need no equivalent care**: an unwritten
  uniform in the leftover UBO reads as zeros, which is why the ink still binds
  no point lights.
- `renderOutline` draws a back-face shell expanded by `outlineWidth` in every
  direction, so an emissive detail must protrude past its neighbours' shells or the
  glow is swallowed (why the player's visor slit and the lamp lens stick out).
- **A flat surface you WALK on must be a thick box, not a thin slab**, and the
  reason is that same shell. `OutlineRenderer` draws it with a negative,
  slope-scaled polygon offset (`setZOffset(-1)`, `setZOffsetUnits(-4)`) that pulls
  it toward the camera, and the slope term is enormous at the grazing angle a
  floor is seen from — so the shell's underside, only `height + outlineWidth`
  behind the real top face, WINS the depth test and paints the surface flat in its
  own ink. The manor's board deck was 0.14 m thick and its whole 22 x 15 m hall
  floor came back as `outlineInkFor` of the boards, which on a dark timber reads as
  a black void and on a pale one as a grey wash. Nothing in the console, and the
  usual suspects all test clean: clearing the shadow casters changes nothing,
  because it is not a lighting bug at all. The same floor as a 0.54 m box renders
  correctly, which is why the podium under it never showed the fault. Depth is what
  buys the margin, so a walked surface gets a box as deep as whatever it stands on
  and is placed by its TOP face.
- **Nothing may be laid ON an inked surface, and no clearance buys its way
  out.** The third face of that same shell, and the one that costs a mesh of its
  own: `OutlineRenderer` draws the hull twice, and the second pass
  (`_afterRenderingMesh`) writes **depth with colour write off** — so once an
  inked mesh has been drawn, the depth buffer holds a surface `outlineWidth`
  in front of it across the whole of it, not merely around its silhouette.
  Anything drawn into that gap afterwards fails the depth test against
  something invisible. Coldharbour's lane markings are the worked case: 4 cm of
  paint under a 5 cm shell, present in every list, active, lit, and not on
  screen at all. Thinning the road's ink does not fix it, because the offset
  that pulls the shell toward the eye is slope-scaled and a road is seen at a
  grazing angle — measured down an avenue at eye height, ink at 3 cm left one
  dash standing and ink at 1 cm still swallowed everything past ~35 m. So the
  surface underneath gives up its ink (`buildRoad` sets `noOutline` on a slab
  that carries paint), which a flat ground sheet can afford: it has no
  silhouette, which is the same thing its `noShadowCaster` says.
  **This is also why a fault of this shape does not reproduce in the editor** —
  roads are left uninked there for an unrelated reason, so the markings were
  visible for the whole of the time they were being authored.
  There are two markings in the tree and both pay this: the second is the
  parkade's painted deck edge (`buildParkade`), where the exemption is worth
  stating because the deck is NOT a ground sheet — it gives up the ink along
  its own edge over the void, which is the very edge the paint is there to
  call out, and gets it back in pale instead of dark. The merge key is what
  keeps the price that small: only the slabs that carry a line leave the
  block's concrete group, and the rest of it is inked exactly as before.
  **The paint needs `noOutline` of its own as well** — a 5 cm shell around a
  4–6 cm box is most of the box, so a mark that survives the depth test still
  arrives dark unless it is exempt too.
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
- Rendering group **1 is the viewmodel's**, for the depth clear Babylon does between
  groups. Putting world geometry in group 1 makes it draw through everything. The
  **sky is in it too** (`Sky`'s constructor turns the depth clear back off so the
  moon still respects a wall), which is why anything reasoning about "what is on
  the camera" has to separate the two — `infiniteDistance` is the test, and both
  the glow's fog exemption and the kit screen's use it.
- **The kit screen's backdrop is the one blended mesh in the game whose DRAW
  ORDER is load-bearing** (`buildKitBackdrop` in `ViewModel.ts`). It has to cover
  the world and be covered by the weapon, and the only slot that does both is a
  blended mesh in group **0** with `alphaIndex` at `Infinity` — Babylon draws a
  group's blended meshes last, and its default `alphaIndex` is already
  `Number.MAX_VALUE`, so any ordinary large number sorts the card in front of the
  capture skirt instead of behind it. `depthFunction: ALWAYS` keeps a near wall
  from cutting it, `forceDepthWrite` is what stops the sky in group 1 drawing
  over it, and a **glow layer is composited over the finished frame and so cannot
  be covered at all** — `Game`'s emissive selector zeroes everything off the stage
  while the kit is up.
- **The post-process chain has an order, and a display setting that switches an
  effect off REMOVES its pass** rather than zeroing its uniforms — an attached but idle
  pass still reads and writes the whole frame. The order is FXAA, shafts, motion blur,
  horror grade, enforced by where each one re-attaches: `attachPostProcess` appends, so
  the blur's toggle takes the grade off and puts it back behind it
  (`Game.setMotionBlurEnabled`), and the grade's own toggle always appends because the
  tail is where it belongs. `HorrorPost` owns whether it is attached, so the blur's
  dance can never resurrect a grade the player turned off — the guard is in `attach`,
  not at the call sites. Nothing throws if this is wrong; the symptom is grain over a
  smear, which reads as a dirty lens. The red damage flash is painted by the grade's
  shader and goes off with it, leaving the HUD's damage arcs to tell the player where a
  hit came from.
- The cobblestone texture is 512² over a 1.5 m tile (`textures.ts`), sized for a
  camera **1.55 m above the street**. 512 is also written into the shader —
  `perturbNormal` takes its taps at a hard-coded `1.0 / 512.0` — so the two move
  together or every surface's relief is silently rescaled.
- **A world-mapped ground albedo gets the weathering drift too, and there it is
  load-bearing rather than a nicety.** The flat-colour path multiplies `base` by
  a slow world-space value noise so a 48 m merged block stops arriving in one
  tone; the ground path does the same with its own pair of numbers
  (`graphics.groundVariation`, a cell three tiles wide and a wider swing) for a
  different reason — a ground texture REPEATS, every 4 m on the valley floor and
  every 1.5 m on the street, and the eye finds a period in a ground plane faster
  than anywhere else in the frame. A drift keyed on world position has none to
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
- **The `noGlow` flag only works because `Game` builds `CombatSystem` before
  its construction-time GlowLayer scan.** Move the construction later and every
  dust disc blooms like a lamp. The scan is a one-shot loop over
  `scene.meshes`; anything built after it is eligible forever.
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

Everything overhead is painted at runtime by `src/systems/Sky.ts` from the map's
`SkySpec`: an equirectangular dome texture (gradient, galactic band, stars, the
moon's scattering halo), a textured moon disc that feeds the GlowLayer, and two
drifting cloud decks.

**The dome is painted assuming something occludes the bottom of it**, and that
something is the valley rim — so the two are a contract, not neighbours. Stars and
the galactic band are culled below canvas row 0.46 (`if (y > h * 0.46) continue`,
written twice), `cloudBandBottom` stops cloud at 0.47, and the gradient runs to flat
`fogColor` from row 0.58 down. In elevation that is **7.2° for stars and 5.4° for
cloud**, below which nothing is painted at all. `Ridge.ts`'s `MIN_SLOPE` is the other
half of the contract; lowering the rim without moving these cutoffs uncovers a band
of empty dome.

- **Sky textures are uploaded with `update(false)`.** `DynamicTexture.update()`
  flips Y by default, which maps canvas row 0 to `v = 1` — the *nadir* on Babylon's
  sphere, whose UVs run `v = acos(y)/PI` down from the zenith. A sky painted top-down
  and then flipped puts its stars, band and halo under the map and leaves the visible
  half showing the fog colour the gradient ends on. It does not look upside down; it
  looks like there is no sky at all, with a moon still correctly placed because the
  disc is geometry, not paint.
- **Cloud masks are 3D noise sampled along each texel's own direction.** An equirect
  image stretches by `1/sin(latitude)`, so a 2D field smears into bands as it climbs
  and pinches at the pole; a tileable 3D lattice has no seam and no pole. The field is
  also **normalised to its own range before it is thresholded** — summed value noise
  clusters around 0.5, so a raw fBm against a 0.5 threshold produces haze, not cloud.
- **The moonlit silver is a second, additive shell with a static per-vertex alpha
  mask**, not a bright patch in the mask texture. The texture scrolls and the moon does
  not; baking the lit side in would drag the highlight across the sky.
- **Stars live or die on dome resolution.** 360 degrees of texture against ~50 of
  screen is a hard magnification, so a dot much over a pixel arrives as a bokeh ball —
  hence a 4096x2048 dome and `starMaxSize` ~1.6. The same magnification is why
  `cloudSoftness` is wide: bilinear magnification of a *hard* alpha contour comes out as
  straight-edged wedges, torn paper rather than cloud.
- **The dome wraps, so anything painted near its edge must be painted twice**
  (`acrossSeam`). The left and right edges are the same piece of sky, a canvas clips
  instead of wrapping, and the widest mark on the dome is the moon's halo — wider, at
  these settings, than the moon's own distance from the wrap column. Miss this and you
  get a bright gradient ending in a straight vertical line down the sky. `wrapU =
  WRAP_ADDRESSMODE` is also required (Babylon's `DynamicTexture` defaults BOTH axes to
  CLAMP) but only fixes the filtering: the seam that shows is in the paint. `v` stays
  clamped — it runs pole to pole and has nothing to meet.

`Game.applySky()` no-ops when the environment object is unchanged. The map is
rebuilt every round; the sky is not, and repainting 8 megapixels of dome plus two
noise masks for an unchanged sky is pure cost.

`GodRays` (`src/shaders/GodRays.ts`) adds the shafts in screen space: march each
pixel back toward the moon's projected position and accumulate what is bright along
the way, so anything dark between the camera and the moon leaves a beam-shaped hole.
There is no occlusion render pass — the substitute-material trick Babylon's
`VolumetricLightScatteringPostProcess` uses does not fit the cel materials — so **the
luminance threshold IS the occlusion test**, and it has to sit above the brightest
non-sky thing in the frame. That is the wet cobbled street (~0.67 looking along the
moon); below it the road smears upward and the frame fills with ground haze.

**Because that number is a statement about how bright a particular world is, it
is the MAP's** — `SkySpec.rays` (`{ threshold, intensity }`), each falling back
to `CONFIG.godRays`, which is the night village's. `samples` deliberately is not
overridable: it is interpolated into the shader source as a `#define` at module
evaluation.

**On a lit map the threshold is BRACKETED rather than chosen, and both ends are
measurable.** The floor is what every distant surface asymptotes to — the fog
colour, and the ground mist with it — which is why Coldharbour holds `fogColor`
and `mistColor` at the same luma (0.753) and treats moving either as a hue
change only. The ceiling is the dimmest sky the shafts can reach: that map's
`moonGlowColor` is 0.867 and its `cloudLitColor` 0.891, so 0.82 sits in the gap.
**The two things that can still defeat the bracket are the ones added PAST the
soft shoulder** — the ground spec and the translucency band — since everything
diffuse is compressed under ~0.75 and those two are explicitly allowed over it.

`intensity` moves WITH the threshold rather than independently: at night the sky
is a thin band over a near-black village and on a lit map it is half the frame
at 0.9+, so the same accumulation is a different size and the night value (1.3)
returns a white wash instead of beams — Coldharbour runs 0.5.

**The pass is DETACHED whenever the moon is behind the camera or off the side of the
screen**, which is most of a round (22 of 24 bearings on a level sweep). Its shader
early-outs too, but an early-out only skips the sample loop: an attached pass still
reads and writes the whole frame. `Game` owns the attachment (`syncGodRays`) and the
pass's FIRST attach as well, because Babylon's `detachPostProcess` nulls the slot
rather than removing it while `attachPostProcess` appends — so a pass that attached
itself would have no way to name the hole it came out of, and every cycle would leave
another one in a list walked every frame.

## The capture zone: annotation drawn in the world

`CaptureZoneSystem` is the flag's ring, its skirt and its beacon. The rules are
about DRAWING; the meter they annotate is `ConquestSystem`'s and is in
[`CLAUDE.md`](../CLAUDE.md).

- **The ring is the boundary.** It is built at `ControlPointDef.radius`, which is
  what `pointAt` tests, so the line on the floor is not an approximation of the zone —
  it is the zone. Drawing it anywhere else is worse than drawing nothing.
- **It follows the surface you STAND on, not the terrain.** A 28 m ring placed by one
  height sample at the flag is buried at one end (the problem `terrainSlab` solves for
  roads), but sampling `TerrainField` alone is still wrong, because four of the five
  flags sit on a paved square or a deck above the ground under it. The ring takes the
  higher of `terrain.surfaceAt(x, z, true)` and the nav graph's walkable height nearest
  the flag's own `y`.
- **The skirt is revealed by proximity.** It is a cylinder around the zone, so from
  inside you are always looking through its far side; at any alpha that reads as a
  wall, that is a white wash over the entire screen. Per-frame vertex alpha keyed to
  the viewer's distance shows only the stretch you are about to cross.
- **Markers are annotation.** No `solid`, no collider, no `WorldBox`, excluded from
  the GlowLayer by hand (`Game`'s scan is construction-time). They are the one
  persistent unlit `StandardMaterial` geometry in the world, so they get no shader fog
  and have to fade themselves out at the fog wall — the beacon keeps a floor so a
  distant flag still reads as a faint column in the mist.

The through-line is that every one of these is a case where the honest thing to
draw is not the cheap thing to draw, and the cheap version fails in a way that
reads as a *rules* bug rather than a drawing one: a ring that is not the zone
makes a capture look broken, a ring buried in a slope makes it look absent, a
skirt at a readable alpha makes the screen white, and a marker that does not fade
makes a flag at 200 m look like a flag at 20.
