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
is `fragmentOutputs.color = uniforms.color`), the `GlowLayer` builds its bloom from a material's
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
what the GlowLayer's selector reads — every lantern, tracer, visor and reticle in
the game stops glowing.

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

Three rules about it, and the first is the one everything else rests on:

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

## The ink: one pass, over depth the frame already wrote

`shaders/CelInk.ts` owns the argument, the mechanism and the measurements; this
is the part a reader of this file must not violate.

**It only ever DARKENS.** `mix(scene, scene * tint, edge)` with `tint < 1`, so
no pixel leaves the pass brighter than it arrived. That is what makes it safe to
lay over a finished frame with the glow already composited into it, and it is
worth keeping true: it was checked rather than assumed, at seven frozen vantages
across two maps, and came back **0 brighter channels of 6.2 M per frame**. If a
halo ever appears to come through a wall, this pass is not where it came from —
the god rays are screen-space and depth-unaware BY DESIGN (`GodRays.ts` says so
on the line), and a bloom spreads by blurring after its depth test.

**It runs FIRST in the post chain and that ordering is load-bearing.** It is
part of the picture, not a grade over one: FXAA behind it antialiases the lines
(they come off a depth buffer, which has no antialiasing of its own), and the
shafts, the smear and the grain all land on top of inked geometry rather than
under it. A `PostProcess` given a camera attaches itself and `attachPostProcess`
APPENDS, so what is constructed first runs first — which is why `Game` builds it
above the `DefaultRenderingPipeline` rather than beside the other three passes.

**It needs no normal buffer, and the reason is worth knowing before anyone adds
one.** A `GeometryBufferRenderer` re-renders the map — the wall `GodRays` and
`MotionBlur` both hit and both wrote down. It is not needed because under a
perspective projection `1/z` is LINEAR in screen space across any plane, so the
centre texel against what its two neighbours predict for it is exactly zero on a
flat surface at any angle, a floor seen edge-on included, and large at a corner.
That is the crease term; the silhouette term is a plain relative depth step.
Both are dimensionless, so one threshold holds at every range and no map states
its own.

**It owes the fog and gets it exactly**, over the MAP's band — so `Game` pushes
`applyEnvironment` at it on every environment change, including the editor's.

**Three things it does not do, each deliberate rather than missed.** It has no
`noOutline`, so every emissive part is inked where the hull excluded them — the
cheap way back is `glow.mainTexture`, which `GlowDepth` made full-resolution and
emissive-only. It inks the viewmodel at full weight where the hull gave the gun
0.004 m of deliberately fine line. And it inks the terrain and the grass, which
the hull never touched: every blade of grass writes depth, so every blade is a
silhouette, and what that reads as is denser, darker grass. That one is a
judgement and not an accident.

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
  switch, plus a build phase, plus `noReflect` (an inside-out hull is a sealed
  room to a probe parked inside it) and a `block` key it had to carry so
  `WorldCulling` could not strand one.

  `CelInk` reads the depth buffer, and the depth buffer already has the leaf
  where the wind put it. Sway is not a case it handles — it is not a case at
  all. `mergeByMaterial` still sets `noOutline` alongside the sway mark, which
  now only keys the merge.
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
shader has six defines and compiles six leftover UBOs, each laid out from the
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
`Game.installBodyPools` files both pools and `WorldCulling.update` polls each
rig ROOT once a frame, marking the list dirty only on a transition — 48 property
reads against the 1,008 nodes a rebuild answers for.

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
decided that a soldier two pixels tall is worth less than nineteen merged meshes
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
reaches the picture: `_activeMeshes` is what the `GlowLayer` accumulates over
and what the transparent queue's distance sort breaks ties by, and neither is
exact in eight bits. Two of Hollowmere's four banked vantages moved by 0.0004
and 0.0012 mean/255 that way. In scene order fourteen of the fifteen banked
vantages come back to four decimal places.

## Rendering constraints that look like bugs if you undo them

- `pipeline.imageProcessingEnabled` must stay `false`: the cel shader outputs
  display-ready colors and Babylon's image-processing pass re-gammas them and washes
  the palette out. That is also why the vignette/grain/aberration/damage flash grade is
  hand-written (`src/shaders/HorrorPost.ts`).
- Glow is a `GlowLayer` keyed off emissive color, deliberately not threshold bloom —
  bright-but-not-emissive surfaces must stay crisp.
- **Its occlusion is the MAIN pass's depth buffer, not a second drawing of the
  world** (`src/core/GlowDepth.ts`). The layer used to redraw every visible mesh
  into its own texture as opaque black solely so the buffer would depth-occlude;
  it now shares the depth the frame has already written and its render list is
  the emissive meshes alone — ~20% of the frame on the three big maps, and the
  occlusion is exact rather than approximate. **Four things make it work and
  each fails silently on its own**: the main texture renders LATE (from the end
  of the draw phase, or it can only share the previous frame's depth), its clear
  is REPLACED rather than added to (the layer installs one that wipes depth, and
  an `Observable` runs every observer), the framebuffer is re-bound after the
  render (an RTT render restores the default one, so the compose would land on
  the canvas), and the texture is FULL resolution with a doubled kernel (depth
  sharing demands matching dimensions; the kernel is in texels of that texture).
  `FINDINGS.md` 3 has the three attempts that instead tried to work out which
  geometry could matter to a bloom, and why none of them could.
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
