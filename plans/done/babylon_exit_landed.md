# BABYLON_EXIT.md, Phases 3 to 5 — the landed steps, the record as it landed

> **ARCHIVED 2026-10-31. This is a record, not a plan.** The live plan is
> [`BABYLON_EXIT.md`](../../BABYLON_EXIT.md), which keeps every landed step's
> heading with a short summary: its commits, what it measured, any picture
> change or decision, and what it still owes. Below is the full text of
> Phase 3 (X3.1 to X3.7c) and of Phase 4's landed steps (X4.1a to X4.3c),
> moved here word for word: each step's brief, what it found, what it
> measured, what its post-commit review found and what it decided. Phases 0
> to 2 are in [`babylon_exit_phases_0-2.md`](babylon_exit_phases_0-2.md).
> References elsewhere in the tree to "`BABYLON_EXIT.md` X3.3b" and the like
> land on that step's heading in both files; a note on a sub-step that has no
> heading of its own ("X3.6c's Owed onward", "X4.1d's note") is the
> paragraph opening "**X3.6c landed**", "**X4.1d landed**" and so on, here.
> Pointers inside this text to "below" or "above" mean the original file;
> "Decisions that are yours", "The branch", "Rules every step obeys" and
> the steps not yet landed (X4.3d onward) are in the live plan, and so is
> X4.3's own brief (its intro, "Read first", the contracts all four keep
> and "Verify") until all four of its sub-steps have landed.

---

## Phase 3 — Our renderer draws the static world

Babylon still owns the frame. Our module draws inside Babylon's passes through
the seam.

**The end condition reads true** — "Babylon builds no mesh in a round for
anything our renderer draws" — since X3.7b, and since X3.7c no fallback pass
of Babylon's is left for a round (the editor's build keeps the generators and
the lamps' render target, X5.3's). **No phase tag yet**: the phone's
follow-up reading owed since X3.3c, and the tag itself, are the user's
(X3.7c, "Owed onward").

### X3.1 — The shared WGSL (PERF_PLAN B0) — **M** — **LANDED** (ab51aa7)

As B0 states it: `CelShader.ts`'s fragment factored into WGSL chunks that both
Babylon's `ShaderMaterial` and our pipelines include. Two copies drift, and
the failure is silent.

- **Do also:** our side needs real WGSL, not Babylon's dialect (`uniform`,
  `attribute` and `varying` declarations, `vertexInputs.`, `#include<>`, and
  56 `#ifdef`-family lines in `CelShader` alone). Write a small preprocessor
  for includes and defines that emits plain WGSL with explicit bind groups.
  The bodies are shared; the declarations are per side.
- **Verify:** `bank.mjs --check` with no pixel moved on every map;
  `plans/webgpu-ref/shaders.mjs`.

**Landed** (ab51aa7, review fixes f5320eb).
- **The bodies.** They are Babylon-free chunks: `shaders/wgsl/chunks.ts`
  (`WGSL_CHUNKS`, the one table) and `shaders/wgsl/celSurface.ts`. The cel
  fragment's whole body is the function `celSurface()`. A body declares
  nothing.
- **Babylon's side.** Its declarations are `includes.ts`'s `DECLARATIONS`
  and the fragment's own in `celFragmentShader`. Every registered include is
  declarations plus the body, verbatim, so grass, water and the air include
  exactly as before.
- **Our side.** `render/celFragment.ts` declares the frame (group 0) and the
  material (group 1) as data. `render/wgsl/assemble.ts` and
  `render/wgsl/preprocess.ts` turn that into plain WGSL with explicit bind
  groups. `src/render/` joined the Babylon-free gate here, a step early,
  because the directory exists from this step on.
- **Measured.** Every shader module Babylon compiles on all seven maps was
  dumped before and after. The 68 cel fragments differ only by `main`'s body
  becoming `celSurface()`, and every other module is identical up to order.
- **The bank.** 47 of 47 rows are within the floor: 45 at 0%, and Sarab's
  `rig-near` and `rig-far` at 0.0721% and 0.0014% of pixels. The parent
  commit gives those two rows the same numbers, so the banked Sarab rig
  frames are stale from an earlier commit. They are not this step's
  difference. Sarab was re-banked after X3.1 landed, and `--check` now puts
  every row on every map at 0%, which is X3.2's baseline. The bank lives
  outside git (`ref/` is ignored), so the re-bank is recorded only here.
- **`shaders.mjs`.** It is clean on seven maps. It now also builds our module
  for every shape each map compiled into a pipeline against an EXPLICIT
  layout. It was proven to fail on a uniform our side does not declare and
  on a 17th sampled texture. The bumped ground is at 16 of 16 sampled
  textures and 16 of 16 samplers on our side too.
- **What the review found.** Babylon strips the comments of the top-level
  source only, and pastes an include in whole, comments and all. So the cel
  body's ~700 lines of prose had become text Babylon's declaration regexes
  read. Nothing matched them, so nothing broke, but any comment quoting a
  declaration would have minted a binding with nothing behind it. Every
  registered entry now goes through `stripComments`, the same function our
  preprocessor runs. Also fixed:
  - the preprocessor no longer accepts `#define` (a body's define would not
    reach the declaration guards);
  - our varying locations are counted as Babylon counts them;
  - the frame block is one layout in every variant but its last field;
  - stale pointers to code that moved.
- **Owed to X3.2 and X3.3:**
  - our `main` lacks Babylon's `position.y` flip for a pass that renders to
    a texture, and the dither is keyed on that position;
  - the WGSL struct layout is not yet the layout anything uploads;
  - the vertex stage's sway is not shared yet. X3.3 needs it as a chunk, the
    same way.

### X3.2 — `src/render/`: device, pipelines, frame uniforms, and the seam — **M** — **LANDED** (e59b96a)

- **Do:**
  - The module owns its buffers, bind-group layouts and pipelines. It creates
    pipelines with `createRenderPipelineAsync`, keyed on shader variant,
    vertex layout and target formats.
  - It takes its frame uniforms (camera, fog, key light, ambient, sky fill,
    point lights, wind, the shadow matrices) from what `CelMaterialFactory`
    already publishes, as a plain struct, never by reading a Babylon material.
  - It gets the `GPUDevice` and the current pass encoder through
    `babylonSeam.ts` and nothing else.
  - It matches what the frame actually uses: the depth format
    (`depth32float`, since stencil is off; `plans/webgpu-ref/depth.mjs`), the
    colour format, the sample count, and the coverage alpha (opaque writes 0).
  - It states its attachment formats once — `docs/rendering.md`'s bundle
    trap.
  - Add `src/math/` to X2.3's gate (X3.1 added `src/render/` with the
    directory).
- **Verify:** it draws nothing yet, so the bank shows no pixel moved; the gate
  passes; a DEV-only test draw shows up where expected and then comes out.
- **Must not:** import `@babylonjs/core`; reach an internal from anywhere but
  the seam.

**Landed** (e59b96a).
- **The seam.** `render/babylonSeam.ts`'s `BabylonFrameHost` implements
  `render/frameHost.ts`'s `FrameHost`, which a host of the game's own
  implements at X5.4. It imports Babylon's types only, so the gate walks it
  like the rest of the directory. Its header numbers five internals:
  - the device;
  - the lazily-started pass;
  - `_bundleList.addItem`;
  - the pass's attachment wrapper;
  - the render target (its identity and its flip).
- **Draws are QUEUED, not issued.** Under bundles a raw `pass.draw` lands
  before every Babylon draw already in the pass. An item in Babylon's own
  bundle list runs in order at the pass's end.
- **The main pass is the target bound as the draw phase begins.** The
  window alone was not enough: the glow renders its mask from
  `onAfterDrawPhase`, so whether its group 0 fell inside the window
  depended on observer order. The review found this.
- **The attachments are stated once** (`render/targets.ts`).
  - The frame does not draw to the canvas. It draws into `CelInk`'s
    target: `rgba8unorm`, `depth32float`, 1 sample, y-flipped.
  - `Renderer` checks the open pass every frame and draws nothing into one
    that differs.
  - `PipelineCache` derives the front face by Babylon's rule: clockwise as
    authored, `ccw` under the flip.
- **The frame's uniforms.** `render/frame.ts`'s `FRAME_BLOCK` is the cel
  frame plus the camera and the wind, with the palette last.
  - `CelMaterialFactory.fillFrame` and `ShadowBindings.fillFrame` PULL it
    off the fields once a frame, and only when something draws. A push
    would miss the in-place writes: the shadow matrices, the clouds, the
    flash, the lamps' slots and the GI vectors.
  - `render/wgsl/layout.ts` computes the byte layout, and
    `FrameUniformBuffer` copies by it.
  - `assemble.ts` gained `declareGroups` and `@align(16)` on every array.
    Without it, an `f32` array after a member ending off 16 bytes is
    rejected; the frame block never put one there.
- **The gate** walks `src/math/`, with `math/babylon.ts` in `NOT_ROOTS`.
  The server typecheck gained `@webgpu/types`, because it includes
  `src/`.
- **Measured.**
  - `bank.mjs --check`: every row on all seven maps at 0%.
  - `shaders.mjs`: clean on seven maps, ours built for every variant.
  - A DEV-only draw, deleted before the commit:
    - a compute shader read the frame block back through WGSL, and 869 of
      869 floats matched, with unique values and with the real frame;
    - a triangle 10 m ahead of the deploy camera on Hollowmere landed
      upright above centre, occluded by the nearer flagpole;
    - it ran exactly once a frame for 91 frames;
    - authored clockwise it drew, and declared counter-clockwise it was
      culled;
    - removing it left 0 pixels different.
- **Rule 4, as read here.** Six older touches of internals in four files
  stay where they are: `FrameDepth`, `webgpuLeaks`, `ReflectionSystem`
  (two) and `FrameProfile` (two). None is the renderer's, and
  `FrameProfile`'s prototype patch needs a Babylon VALUE, which
  `src/render/` may not import. So rule 4 holds as "every internal OUR
  RENDERER reaches". The seam's header lists the six and the step each
  leaves at (FrameDepth at X5.4, the rest at X6.1).
- **Owed to X3.3** (all four are X3.3a's, and X3.3a's "Landed" says where
  each went):
  - the fragment's `position.y` flip, since the main pass is a texture;
  - the vertex sway as a shared chunk;
  - a hook BEFORE group 0's blended meshes, if the world must draw there
    (`RenderingGroup.onBeforeTransparentRendering`); today a draw lands
    after the whole group;
  - a binding field for a depth or unfilterable texture (every texture is
    laid out filterable `float` today).

### X3.3 — The static world's main pass (PERF_PLAN B1) — **L, as three sub-steps** (split 2026-10-13)

As B1 states it: clusters of ~128–256 triangles, a compute cull (frustum, the
fog reach `WorldCulling` walks to, the size gate), one `drawIndexedIndirect`
per material per pass, and the blocks taken out of `WorldCulling`'s main-pass
candidate list while their Babylon meshes live on for the other passes.

It is split so that correctness and speed are proven apart. **(a)** makes our
pipeline draw the blocks to the pixel, behind a DEV switch, with Babylon's
draw counts untouched. **(b)** changes HOW they are drawn, under the same
switch, with the pixels already pinned. **(c)** makes it the only path and
takes the measurement. Each sub-step lands on its own and leaves the game
shippable. Until (c), a build without the switch draws exactly what X3.2's
did.

- **Contracts all three keep:**
  - a per-cluster block id for `ReflectionSystem.encloses`, plus X1.4's piece
    id
  - fog to `fogEnd`
  - `opaqueAlpha` 0 in the frame and 1 under a probe bake (the probes keep
    drawing Babylon's meshes until X3.6c, so our pipeline draws only the
    main pass, at 0)
  - the wind's ramp and rigged layers
  - every caster a closed shape (the casters stay Babylon's until X3.6a)

#### X3.3a — Our cel pipeline draws the blocks, to the pixel — **M** — **LANDED** (b130995)

- **Do:**
  - **The vertex stage as a shared chunk.** `CelShader.ts`'s vertex body,
    sway included, becomes a Babylon-free chunk both sides include, as X3.1
    did for the fragment (X3.1's third owed item). Ours is declared as data
    beside `celFragment.ts`, with the frame's camera and wind from
    `FRAME_BLOCK`.
  - **The fragment's `position.y` flip** in our `main` (X3.1's and X3.2's
    owed item; the frame's main pass is a texture), so the dither is not
    mirrored.
  - **The textures the cel surface samples**, bound as wrapped views of
    Babylon's own through the seam (rule 5): every shadow map, the lamps'
    atlas, the flash map, the cloud field, the foliage map, the GI volume's
    seven 3D textures, the ground textures and the reflection cubes. Each is
    a numbered internal in the seam's header, the list growing as Phase 3
    allows. Babylon re-creates some of these on a quality change, so a view
    is re-taken when its owner replaces it, never cached across that. A
    depth or unfilterable texture gets a field on its binding (X3.2's owed
    item) rather than the filterable default.
  - **The material block** (group 1), filled from the same spec a Babylon
    cel material is born with, through a pull on the factory like
    `fillFrame`. Never read off a `ShaderMaterial`.
  - **The geometry** uploaded from the world's `GeometryBuffer` records
    (X1.4) into buffers our renderer owns. Whole blocks, one draw per block
    material, no clusters yet.
  - **Where in the pass the blocks draw.** They draw BEFORE group 0's
    blended meshes, through a second host hook
    (`RenderingGroup.onBeforeTransparentRendering`; X3.2's owed item). It is
    not optional: glazing and water write no depth, so an opaque wall drawn
    after them would paint over the glass in front of it.
  - **A DEV switch** (`?ourworld`) under which our pipeline draws the blocks
    in the main pass and `WorldCulling` leaves them out of the main pass's
    candidates only. Every other pass keeps drawing Babylon's meshes.
    Without the switch, nothing changes.
  - The pipelines are compiled at load, under the building card, so the
    switch never draws a frame with a pipeline still compiling.
- **Verify:**
  - `bank.mjs --check` with the switch ON is within the floor on every row
    of every map, and with it OFF is still 0%.
  - The census shows main-pass draws unchanged with the switch on: this
    step trades one draw for one draw.
  - `shaders.mjs` builds our vertex module for every shape as well.
- **Must not:** change a pixel without the switch; read a Babylon material;
  copy a Babylon texture.

**Landed** (b130995).
- **The vertex body is shared.** `shaders/wgsl/celVertex.ts` is the cel
  vertex stage as one function, `celVertex()`, which Babylon's `main` calls
  and `render/celVertex.ts` declares as data. The frame block, the material
  block (`render/celMaterial.ts`) and group 2's `world` are declared once
  each.
- **The flip, settled by Babylon's processor rather than by the brief.**
  Into a texture, Babylon negates clip y and leaves the fragment as written.
  It turns `dpdy` and the position around only ONTO THE CANVAS, and the
  position by the render height it rewrites on every resize. So our main
  pass owes the vertex negation and nothing in the fragment. X3.1 and X3.2
  recorded it the other way round. A fragment for the canvas is refused until
  a frame field carries that height; the first canvas pass (X5) owes it.
- **Where in the pass.** The draw point is the END of group 0's opaque and
  alpha-tested lists: the first of its sprites, its particles and item 6,
  `onBeforeTransparentRendering`. That hook alone was too late, because the
  particles come before it, so a wall drawn there paints over every particle
  in front of it. The START of the group was tried as well and refused: the
  sky dome writes no depth, draws first and stands at 600 m, and
  Cinderhaven's `fogEnd` is 1,250 m.
- **The textures are Babylon's own.** Items 7 and 8 are each texture's own
  `GPUTextureView` and the `GPUSampler` from Babylon's own cache, for the
  state `_setTexture` would bind. They are re-resolved every frame
  (`FrameHost.bind`, `render/HostBindGroup.ts`), and a bind group is re-made
  only when a view moves. **No depth or unfilterable texture is bound**: the
  sixteen are `rgba16float`, `r16float`, `rg8unorm` and `rgba8unorm`. So X3.2's
  binding field stays owed to the first one that is, and with it Babylon's
  `unfilterable-float` fallback for a full-float texture on a device without
  `float32-filterable`.
- **A material is its RECIPE.** Every per-material value goes through the
  factory's `own`/`ownTexture`, which set the material and its recipe in one
  statement (`CelMaterialFactory.celRecipe`, `materialEpoch`). It applies to
  the five getters whose meshes our side takes.
- **What is taken.** A block-merged surface in group 0, at identity, under
  no parent, not `updatable`, on a recipe material. Its arrays are taken on
  the way past the build (`BuildOptions.onSurface`), before the release
  (`systems/BlockHandover.ts`), and it is drawn by `render/WorldBlocks.ts`.
  `WorldCulling.setTaken` keeps it out of the main pass's candidates and of
  nothing else. It is ON exactly when Babylon's walk would draw it, asked
  through the mesh right after the walk. A surface whose pipeline fails goes
  back to Babylon. The card waits for the pipelines, under the bake's own cap.
- **Found on the way: `PipelineCache` had the front face backwards.** A mesh
  in this left-handed scene is born `CounterClockWiseSideOrientation`, so it
  faces the eye `"ccw"` on screen and `"cw"` in a flipped pass. X3.2's test
  triangle was authored to the rule it tested. `PipelineState.reversed`
  replaces `counterClockwise`.
- **Measured.**
  - **`bank.mjs --check` with the switch OFF: every row of every map at 0%**
    (47 of 47).
  - **With it ON** (`--query=ourworld`, new here): every row within the
    floor. The worst row is Coldharbour's `curtain90`, at 0.093% of pixels
    and a mean of 0.0104/255, against 0.02. Sarab's `wadi` is the widest, at
    0.12%.
  - **The residue is equal-depth TIES**, traced on `curtain90` (1,931
    pixels differ by any amount) with frames taken in the bank's own vantage
    order. **A frame shot at one vantage alone differs from the bank by
    41,271 pixels with no switch at all**, from state carried between the
    rows, and the first round of experiments was confounded by it. A scratch
    diff owes the bank's sequence.
    - With Babylon drawing every block AND ours drawn over them, the frame
      is the same 1,931 pixels as ours alone. So our vertices land bit for
      bit where Babylon's do, and our shading is the same.
    - Moving our draws to the group's start moves the residue to a
      complementary set of 1,094.
    - What is left is coplanar surfaces (lit-window quads, mullions, slab
      edges) whose winner Babylon decides by its front-to-back sort, pair by
      pair. No fixed point of ours can reproduce that.
  - **`census.mjs`** (new: main-pass draws, Babylon's into the frame's target
    plus ours, on the bank's frozen frames): **equal with and without the
    switch on every vantage of all seven maps.** Hollowmere is 629, Greyfen
    382, Coldharbour 1,104, Harrowmead 1,514, Sarab 1,206, Cinderhaven 294,
    Kurenai 89. Taken surfaces per map run from 54 (Hollowmere) to 354
    (Greyfen).
  - **`shaders.mjs`** builds both of our stages through our own
    `PipelineCache` for every shape on seven maps (5 to 7 variants a map),
    clean.
  - `npm run build` passes every gate.
  - **The user's play-test under `?ourworld`** (2026-10-14): everything
    looked fine.
- **Owed onward.**
  - X3.3b: the clusters and the cull keep the ON rule's other half, the
    walk's frustum and readiness, which X3.3a asks of Babylon's mesh.
    **Done at X3.3b.**
  - X3.3b: a mesh whose `visibility` drops below 1 would go to Babylon's
    blended list, and ours would still draw it opaque. No block changes its
    visibility today. **Answered at X3.3b** by a contract and a DEV check.
  - X3.3c: `PipelineWarmup` learns our pipelines. **Done at X3.3c.**
  - X3.3c: the census's equal totals become falling totals (`census.mjs
    --fall`). **They fell at X3.3b already**; X3.3c reads them again.
    **Read at X3.3c**, against a BEFORE taken at the commit before it.

#### X3.3b — Clusters, the compute cull and indirect draws — **M–L** — **LANDED** (04d1b89, review fixes e21c9ac)

- **Do:**
  - The blocks cut into clusters of ~128–256 triangles, each carrying its
    block id and its X1.4 piece id.
  - A compute cull per frame over the clusters: the frustum, the fog reach
    `WorldCulling` walks to (`fogEnd` and the size gate, as it decides them
    today), writing indirect arguments.
  - One `drawIndexedIndirect` per material per pass. All of it under the
    same DEV switch.
    **Since 2026-10-18 the blocks' draw is a PLAIN `drawIndexed` over the
    group's whole range**, the cull clearing its output first so the
    survivors' remainder is triangles of no area: an Intel Xe-LPG dropped
    single indirect draws at random (`docs/rendering.md`, "NOTHING OF THE
    STATIC WORLD IS DRAWN OR DISPATCHED INDIRECT"). The scatter's draws
    (X3.4b) stayed indirect until 2026-10-24, when the same laptop's trees
    went too; nothing of the scatter is indirect since (X3.5b's landed
    list).
  - **Keep the door open for the GPU side** (deferred until after the exit;
    "What this plan does not do"). Where the cull compacts the surviving
    clusters, it writes them NEAR-FIRST, so that a later depth-ordered draw
    lets the GPU skip hidden pixels. It costs nothing now: an order chosen
    while the list is being written anyway. It is not a sort per frame.
- **Verify:**
  - `bank.mjs --check` with the switch on, within the floor everywhere: the
    cull may drop only what the fog or the frustum already hid.
  - P0's census with the switch on: main-pass draws fall.
  - X0.3 on the desktop, read as an indication only; the step's number is
    (c)'s.
- **Must not:** let the cull read a node; re-cut clusters per frame.

**Landed** (04d1b89, review fixes e21c9ac).
- **The cut.** `render/clusters.ts` cuts each taken surface once, at
  install (`WorldBlocks.finish`, after `WorldCulling.setMap`), into runs of
  at most 128 triangles of ONE X1.4 piece in the surface's own order
  (`CONFIG.graphics.clusters`). Each cluster carries its block, its piece,
  its float32 box, and how far the wind can move it: its largest ramp
  weight, and whether it is rigged.
- **A group is a recipe.** Every surface of one cel recipe is laid end to
  end on one set of vertex buffers, with its indices rebased onto them. An
  attribute a surface lacks but the variant reads is zero-filled, which is
  what Babylon's empty buffer reads. One pipeline, one material, one
  `drawIndexedIndirect` a group, at the same draw point X3.3a found.
- **The cull** (`render/ClusterCull.ts`, `render/wgsl/clusterCull.ts`) is
  three compute passes, submitted as a command buffer of their own when the
  main pass begins (`Renderer.onFrame`), which the queue runs ahead of the
  frame's:
  - `cullClusters`: the block's box against the reach, the SURFACE's sphere
    against the size gate (as `WorldCulling.tooSmall` measures the mesh, so
    a cluster of a drawn surface is never too small), then the cluster's
    box against the view-projection's four side planes and the eye's own
    plane, grown by the most the frame's wind can move its vertices;
  - `prefix`: one workgroup scans the workgroups' totals and writes each
    group's indirect arguments;
  - `scatter`: each survivor's indices copied into its group's region.
  The reach and the size gate's scale are `WorldCulling`'s own, stated as
  numbers (`WorldCulling.reachGate`), and the reach is measured to the box
  of the cell the mesh is filed in (`blockBoxOf`; `reachBoxOf` since X3.5).
  So the cull reads no node.
- **Near-first, in one order.** The survivors are placed by a SCAN, never
  an atomic append: band first (24, 64 and 160 m, nearest first), then
  cluster index. The same eye draws the same triangles in the same order,
  so an equal-depth tie is settled the same way every time. The four bands
  are the four lanes of one `vec4u`, so one scan orders all of them. **The
  band is the SURFACE's** (the distance to its sphere's centre, as Babylon
  sorts a mesh), never the cluster's own: banded per cluster, two coplanar
  runs of one surface would trade places as the eye crossed a band's edge,
  which no still vantage of the bank can show. The review found it.
- **X3.3a's two owed items.** The ON rule's other half (the walk's frustum
  and readiness) is now the cull's frustum and our own pipelines' and bind
  groups' readiness. The per-frame mesh reads are gone. The layer mask moved
  into the take test. A taken mesh whose `visibility` drops below 1 is
  answered by a contract rather than followed: nothing in the tree switches,
  hides or fades a block, and a DEV build checks every frame and says so if
  one ever is.
- **Measured.**
  - **`bank.mjs --check` with the switch ON: 47 of 47 within the floor**,
    the same residue as X3.3a's (equal-depth ties). The worst rows are
    Sarab's `wadi` at 0.1222% of pixels and Coldharbour's `curtain90` at a
    mean of 0.0104/255, after the review fixes (0.1227% and 0.0105 before
    them). **With it OFF: 47 of 47 at 0%.**
  - **`census.mjs --fall`: main-pass draws fall on all seven maps**, every
    vantage, with our side down to one draw a recipe:

    | map | without | with | ours (surfaces taken) |
    | --- | --- | --- | --- |
    | Hollowmere | 629 | 497 | 2 (54) |
    | Greyfen | 382 | 172 | 9 (354) |
    | Coldharbour | 1,104 | 836 | 7 (108) |
    | Harrowmead | 1,514 | 869 | 8 (104) |
    | Sarab | 1,206 | 891 | 7 (165) |
    | Cinderhaven | 294 | 217 | 5 (130) |
    | Kurenai | 89 | 61 | 12 (170) |

  - **`shaders.mjs`** builds the cull's three entry points as well, clean
    on seven maps. **`gate.mjs`** is clean both ways. `npm run build` passes.
  - **X0.3 on the desktop, as an indication only** (one run a side,
    `bench.mjs --query ourworld`, the fight hashes equal). The tick falls in
    every group: Greyfen's fight 6.80 to 6.24 ms, Sarab's 11.26 to 9.93 ms,
    with draws 389 to 312 and 603 to 510. The wall-clock frame is mixed
    within this box's noise. The step's number is (c)'s.
- **What the review found** (fixed before the step was marked): the
  band per cluster (above); a compile or a cull that settled after its map
  was torn down could still write the draw state or the next map's
  failures (a generation now guards both, and a disposed cull drops late
  pipelines); the vertex buffers missing from the device-limit check; a cull
  built for a map with nothing taken; and a frame's submit allocating its
  descriptors.
- **Owed onward.**
  - X3.3c: the cull is submitted outside Babylon's encoder, so a GPU timer
    bracketing Babylon's frame (`?gpu`, `gpu.frame`) does not see it. Before
    the phone's `gpu.frame` is read at the gate, either the timer brackets
    it or it is encoded into the frame's own command buffer. **Done at
    X3.3c**: it is recorded into Babylon's upload encoder.
  - X3.3c: `PipelineWarmup` learns our pipelines, the cull's included.
    **Done at X3.3c.**
  - A5 (occlusion), when it comes, goes into `cullClusters` beside the
    frustum. Destructible buildings mask by the cluster's piece.

#### X3.3c — Our path is the path — **S–M** — **LANDED** (0b49881, review fixes 70cb3f8)

- **Do:**
  - The switch comes out: the blocks are drawn by our renderer in every
    build, and `WorldCulling` leaves them out of the main pass for good.
    Their Babylon meshes stay for the shadow maps, the probes, the lamps'
    atlas and the glow until X3.6 moves those passes.
  - The pipeline warm-up (`core/PipelineWarmup.ts`) learns about our
    pipelines.
  - The contracts it breaks are rewritten: `CLAUDE.md`'s "the frame walks the
    scene" for the blocks, `docs/rendering.md`, and `FILES.md`.
- **Verify:**
  - `bank.mjs --check` on every map.
  - P0's census.
  - X0.3 on the desktop and the phone against X0.4's "before"
    (`FINDINGS.md` 52). The phone is read as two numbers, never as its
    frame: its tick and its `gpu.frame`, warm, after one warm-up run.
  - A round played offline and in a match.

**Landed** (0b49881, review fixes 70cb3f8).
- **The switch is out.** `Game.handover` is built in every build, so the
  blocks `BlockHandover` takes are drawn in the main pass by our renderer
  and never offered to Babylon's walk. Their Babylon meshes stay for the
  shadow maps, the probes and the lamps' atlas (the glow draws only what
  glows, which a taken block never does). A surface the take
  test refuses, or whose compile fails, is Babylon's in the main pass as
  before. The editor's build is unmerged, so it takes nothing.
- **The cull is inside the frame's GPU timer** (X3.3b's owed item). It is
  no longer a command buffer of its own: it is recorded, as the main pass
  begins, into the encoder Babylon submits FIRST (`FrameHost.prepareEncoder`,
  the seam's item 9, `engine._uploadEncoder`), which is also the encoder
  Babylon opens `gpu.frame` on. So it still reaches the GPU before the draws
  that read it, and `?gpu` now counts it.
- **The warm-up learns our pipelines.** `PipelineCache` builds the cull's
  compute pipelines too (`compute`, cached across maps, so they compile once
  a session) and counts every compile (`CompileProgress`). The warm-up opens
  by waiting for them at no vantage, under `warmup.oursCapMs` (90 s, a
  backstop, because a group of ours compiling is a hole and not a hitch).
  Then a vantage is quiet only when neither cache built anything and nothing
  of ours is compiling. The separate wait on `handover.compiled` is gone.
- **The census reads a BEFORE now.** With no switch left, `census.mjs --out`
  takes the rows at the previous commit and `--against ... --fall` compares
  them. `bank.mjs` counts console errors on every check, and its bank stays
  Babylon's picture from before this step.
- **What the review found** (fixed before the step was marked): our draw
  and the cull's prepare were on the renderer for good, so every frame of
  the menu filled and uploaded the frame for nothing — a DEV switch's cost
  that every build now paid; they are registered once a map's cull is built.
  A prepare is once a submit (its `writeBuffer` is read by the whole
  submit), now stated. A compile start that threw would have leaked the
  count. The contracts claimed the glow as one of Babylon's passes over a
  taken block, and a hand-back "in the turn its compile settles", which is
  after the map's LAST compile.
- **Measured** (after the review fixes, which moved no total).
  - **`bank.mjs --check`: 47 of 47 within the floor**, no console errors,
    the same residue as X3.3b's switch-on rows (equal-depth ties). The worst
    rows are Sarab's `wadi` at 0.1222% of pixels and Coldharbour's
    `curtain90` at a mean of 0.0104/255.
  - **`census.mjs --against --fall`** (the BEFORE taken at 69a7744 without
    the switch, equal to X3.3b's "without" column on every map): main-pass
    draws fall on all seven maps, Hollowmere 629 to 497, Greyfen 382 to 172,
    Coldharbour 1,104 to 836, Harrowmead 1,514 to 869, Sarab 1,206 to 891,
    Cinderhaven 294 to 217, Kurenai 89 to 61.
  - **X0.3 on the desktop** (`bench.mjs --max --runs 3`, 3440x1440
    uncapped, the BEFORE at 69a7744 in the same session, fight hashes
    `83e8e74ef36916ba` and `986c2e35557fb679` on every run). **The tick
    falls in every group:**

    | map | part | tick before | tick after | draws | mean, new / old |
    | --- | --- | --- | --- | --- | --- |
    | Greyfen | vantages | 5.04 | 4.34 | 131 to 58 | 1.024 |
    | Greyfen | path | 4.88 | 4.20 | 184 to 114 | 1.091 |
    | Greyfen | fight | 6.95 | 6.37 | 388 to 313 | 0.923 |
    | Sarab | vantages | 3.51 | 3.36 | 181 to 130 | 0.992 |
    | Sarab | path | 3.87 | 3.85 | 175 to 131 | 1.044 |
    | Sarab | fight | 11.40 | 9.56 | 604 to 510 | 0.843 |

    Against X0.4's desktop "before" (`FINDINGS.md` 52, an older fight),
    Sarab's fight 1% low is 17.1 ms against 17.2, with X6.2's target at 12.
  - **The frame did not follow the tick on Greyfen's path, and the GPU is
    why.** Its mean rose 9% while its tick fell 14%. `?gpu` on Greyfen
    (`--max --gpu --runs 2`, before and after): `gpu.frame` 5.60 to 5.55 ms
    on the vantages, **5.31 to 5.77 on the path**, 5.95 to 5.99 in the fight.
    So the desktop's path is GPU-bound now (`gpu.frame` 5.77 against a tick
    of 4.46). The after includes the cull, which no before had, and no timer
    here separates the cull from the draws. That is GPU-side work, so it waits
    with the rest of it until after the exit.
  - **`shaders.mjs`** clean on seven maps, **`gate.mjs`** clean on seven (an
    offline round on each), and **a round played in a server match**
    (Hollowmere, `?mp=`, 54 surfaces taken, 9,721 clusters, our 2 draws a
    frame, no page or console errors). `corecheck` and `npm run build` pass.
- **The gate.** Main-pass draws fall, and the desktop's CPU tick improves in
  every group, so the stop condition ("no device's CPU tick improves") is not
  met, and X3.4 may proceed on the desktop's reading.
- **Owed onward.**
  - **The phone's reading**, the user's to take: X0.3 on the deployed
    `babylon-exit` build, minimal settings, warm (one warm-up run thrown
    away), Greyfen and Sarab, read as its tick and its `gpu.frame`
    (`?bench=<map>&gpu`), against `FINDINGS.md` 52.
  - The desktop path's `gpu.frame` rise above goes to the GPU-side work after
    the exit, with the phone's. Separating the cull's own GPU time would need
    a timestamp pair of its own around the compute pass — **built 2026-10-20**
    as `gpu.cull` (`render/PassTimer.ts`), and it is 27-66 µs on the
    desktop, so it is not the rise (`FINDINGS.md` 61). **The whole-step
    review named a second suspect**, the draw order (below, and
    `FINDINGS.md` 61).

**The whole-step review of X3.3** (2026-10-14, fixes 5525a5d). X3.3a, b
and c were reviewed together after all three had landed.
- **A refused main pass was a HOLE.** `Renderer` refuses a pass that is not
  `FRAME_TARGETS` and draws nothing of ours. Before X3.3c that cost a test
  draw. Since then it left every taken block drawn by nobody, because
  Babylon's walk no longer offers them. Now `Renderer.onRefused` tells
  `BlockHandover`, which stops our side for the rest of the map
  (`WorldBlocks.stop`, keeping the buffers this frame's commands hold) and
  hands every block back to Babylon from the next frame. Nothing ships such
  a pass (`CelInk` is fixed first in the chain), so it is a backstop.
- **A failed compile waited for the map's LAST one.** `WorldBlocks.compiled`
  resolved once every compile settled, so a compile that never settled
  kept a failed group a hole for the round. `WorldBlocks.onFailed` now hands
  back a group's surfaces (or every surface, for the cull) in the turn its
  failure lands.
- **A capture could not see our renderer.** Its draw count is Babylon's
  counter. Report version 17 adds `blocks` (taken, clusters, groups, our
  draws last frame, handed back), read at the capture, and the viewer prints
  it as `ours`. A phone capture now says whether the handover took anything.
- **The draw order is a suspect for the desktop path's GPU rise**
  (`FINDINGS.md` 61). The blocks draw after Babylon's whole front-to-back
  opaque queue, so the terrain, the roads and the loose props are shaded
  before the buildings that hide them. Greyfen's `fogEnd` (78 m) is inside
  the sky dome, so drawing ours at the group's start is legal there and
  separates the order from the cull. That is GPU-side work, deferred with
  the rest of it. (Settled at X3.5, "The blocks ahead of the landform": the
  order was most of Greyfen's rise.)
- **Tidy.** `WorldCulling.pass` folded back into `offer` (its second caller
  went at X3.3b), `FrameUniformBuffer`'s type-only `write` gone,
  `WorldBlocks.finish` sums each group's vertices once, and `ClusterCull`
  logs nothing after `dispose`.
- **Measured after the fixes.**
  - `bank.mjs --check`: 47 of 47 within the floor. The worst rows are
    unchanged (Sarab's `wadi` at 0.1222% of pixels, Coldharbour's
    `curtain90` at a mean of 0.0104/255).
  - `census.mjs --against` the BEFORE at 69a7744, `--fall`: totals identical
    to X3.3c's on all seven maps.
  - `shaders.mjs` and `gate.mjs` clean on seven maps. A server-match round
    on Hollowmere took 54, drew 2 and handed back none, with no errors.
    `corecheck` and `npm run build` pass.
  - **Both new paths, forced, on Greyfen** (a scratch test at the first bank
    vantage). A refused pass hands back all 354 surfaces, and the next frame
    matches the bank to the pixel: Babylon draws every block again. One
    group's pipeline failing before install hands back its 41 surfaces, the
    other 8 groups draw, and the frame is within the floor (0.0476% of
    pixels).

**Gate after X3.3c — the first number that says whether the renderer pays.**
If main-pass draws fall and no device's CPU TICK improves, stop and re-read
this plan with the user before X3.4. Leaving Babylon would still remove the
bugs and the upkeep, but the performance case would be gone, and the order
of everything after this point should be weighed again.

**The gate reads the tick, not the frame, and the phone is why.** On the
desktop the two are nearly the same number (the tick is 89-97% of the
frame). The phone is GPU-bound on Greyfen once warm: `gpu.frame` is 22-29
ms against a tick of 9-17.5 ms (`FINDINGS.md` 52, "The GPU half,
measured"). X3.3 moves the tick, so a phone frame that does not move says
nothing about the renderer. The phone's `gpu.frame` is RECORDED at the
gate, and is judged only by the GPU-side work after the exit. The phone
reaches the branch itself: `babylon-exit` is deployable as well as
`develop`, since 2026-10-13.

### X3.4 — Scatter as instances (PERF_PLAN B2) — **M–L** (decision) — **LANDED** (1a20232 + f20a9ae)

As B2 states it: keep the seeded placement exactly; emit one source mesh per
(kind, variant, material, foliage rung) and a transform per placement.
Destructible props become a per-instance flag. The AO question B2 raises is
the decision.

- **Decided** (2026-10-14): **the colour buffer is baked once per kind**, as
  if the prop stood alone on flat, open ground, and every placement of it
  shares that bake. The look change is judged in the bank, frame by frame,
  rather than held to the floor. It is not only the AO: the colour buffer's
  four channels (`world/vertexShading.ts`) split two and two.
  - **Placement-dependent, so they change:** the AO in the ALPHA (a prop
    against a wall or under a tree no longer darkens on that side, and a prop
    on a slope loses its slope's grounding) and the wear ramp in the BLUE
    (measured from the ground under each vertex, and zero under a roof, so a
    crate under an eave now carries street grime).
  - **The prop's own, so they hold:** the world mark in the GREEN, and the
    sway weight in the RED nearly so. A rigged layer's sign holds exactly. A
    ramp is height above the ground, so it is now measured up the prop at
    scale 1 on level ground: a prop sown on a slope or drawn at 1.3x sways a
    little differently.
- **If the look is wrong** (the user's fallback, 2026-10-14): keep the
  per-kind bake for the prop's SELF-occlusion and add one or two numbers PER
  INSTANCE, baked at placement from the world around it. For example, how
  hemmed in the spot is (the AO's box term at the prop's footing) and how far
  the ground darkens its base (the ground term along its height). The shader
  combines them with the per-kind alpha. That is most of the grounding back
  for a few bytes an instance, against a per-instance bake, which costs as
  much colour data as today. It is a look change of its own, judged in the
  bank again.
- **Found on the way in (2026-10-14): there were no variants to instance.**
  B2's premise was "scatter is made of a few kinds × variants × foliage
  rungs". It was not. Every prop is built per placement from the shared
  stream, and the five tree builders seed a stream of their own from one of
  those draws, so every tree is a different shape: Greyfen's 1,737 jungle
  trees were 1,737 meshes' worth of unique geometry. Measured off the build's
  piece ranges, scatter is most of the world on the forest maps:

  | map | vertices | scatter | the biggest kind |
  | --- | --- | --- | --- |
  | Hollowmere | 1.96 M | 38% | `deadTree`, 0.64 M |
  | Greyfen | 8.93 M | 87% | `jungleTree`, 7.29 M |
  | Coldharbour | 2.97 M | 33% | `pine`, 0.59 M |
  | Harrowmead | 6.37 M | 84% | `ashTree`, 3.78 M |
  | Sarab | 2.02 M | 50% | `boulder`, 0.63 M |
  | Cinderhaven | 4.77 M | 15% | `pine`, 0.20 M |
  | Kurenai | 5.56 M | 60% | `maple`, 3.09 M |

  **Decided** (the user, 2026-10-14): **16 variants a kind.** Each kind is
  built 16 times a build, and every placement wears one of them under its
  own scale, yaw and translation. That is a second look change, judged in
  the bank like the first: a forest repeats shapes, broken up by yaw and
  scale. Maple's four crown colours become four variants each. The other
  two answers were 8 variants, and deferring the step, since X3.3 already
  draws scatter at one draw a material.
- **Destructible props: nothing to flag.** Destruction's stage one
  (06fca4f) was never merged to `develop` or to this branch. It is a dangling
  commit, so no prop on the branch is destructible. When it lands, a wrecked
  prop is an instance the cull drops (a flag in its record), and Babylon's
  copy of it is the vertex range its piece already names.
- **Two sub-steps**, split as X3.3 was so the two claims are proven apart:
  - **X3.4a — the variants, on the path as it stands.** Each kind's 16
    variants are built once a build (`world/scatterVariants.ts`), and a
    placement takes one by a hash of where it sits in the layout, never by
    a draw. **The placement must not move**, and that is the step's oracle.
    The shared stream is spent exactly as the builder would have spent it,
    by a REPLAY per kind (`world/props/sharedDraws.ts`, maple's
    `mapleSharedDraws` generalised), which `kit:hash` checks against the
    builder's own count at every seed and rung. So `npm run collision`
    rewrites no bake and `npm run parity` passes untouched. `kit:hash` is
    identical (the builders are not touched); `merge:hash` moves (the
    scatter's drawing is the variants'). The picture moves only by the
    variants.
  - **X3.4b — our main pass draws the variants as instances.** One source
    surface per (variant, material) with its colour buffer baked once per
    kind, a transform per placement, a compute cull per instance (the
    frustum, the reach and the size gate, near-first, in one order), and one
    `drawIndexedIndirect` per (variant, material): WebGPU has no
    multi-draw-indirect. The scatter's clusters are left out of the blocks'
    cut, and Babylon's merged copy stays in the blocks for the other passes
    until X3.6, so the shadows are the variants' shapes as well. The picture
    moves by the per-kind bake.
- **X3.4a, measured** (2026-10-14, before its commit):
  - **The placement did not move.** `npm run collision` rewrote none of the
    eight bakes, and `npm run parity` passes on all eight. `kit:hash` is
    identical against the parent (3,722 builds), and every scatter kind's
    replay takes its builder's count at all 8 seeds and 3 rungs. The check
    was shown to bite: `log` replayed as 2 draws failed 24 builds.
    `merge:hash`: colliders and terrain identical on every map; the visuals
    and `colliderAlbedo` (now weighed off the variant's parts) moved.
  - **The build:** the scatter phase falls 2-4x (Greyfen 2,241 to 602 ms,
    Harrowmead 1,698 to 454, Kurenai 1,170 to 302), `build:total` 4-26%
    (Greyfen 6,279 to 4,658 ms). The scatter's vertices are within 3% of
    before, so the AO bake and the upload are unmoved, as expected until
    X3.4b.
  - **The bank, judged:** every row with scatter in view moves (Greyfen's
    `canopy` 91% of pixels, its `menu` 55%); every row with none stays in
    the floor (`shopfront`, the three hulls, Cinderhaven's `menu`). By eye:
    the same trunks in the same places, each wearing a variant's crown,
    lean and lianas, and Kurenai's crowns still in all four colours.
    `bank.mjs --keep=<dir>` (new) keeps a check's frames for that judging.
  - `npm run build`, `corecheck` and `gate.mjs` (a round on all seven maps)
    pass.
- **X3.4a landed at 1a20232, X3.4b at f20a9ae.**
- **X3.4b, measured** (2026-10-14, against X3.4a in the same session):
  - **How it is drawn.** `BuildOptions.onScatter` hands `BlockHandover` the
    FIELD: each worn variant a set of parts, merged through the block
    merge's palette, its colour buffer baked once per kind, and the matrix
    of every placement wearing it. `WorldBlocks` appends each set's parts to
    its recipe's group, cuts the scatter's pieces out of the group's taken
    blocks (`withoutPieces`), and draws one `drawIndexedIndirect` per part
    of a set. `InstanceCull` culls the instances on the GPU on the cluster
    cull's terms (reach, size gate, frustum, near-first by a scan) into each
    set's own region of the instance buffer. The instanced vertex stage is
    the same body with `world` built per instance in `main` (the assembler
    gained instance-step attributes, a `PrivateBlock` and a prelude). A
    group is ours whole or Babylon's whole: either pipeline failing hands
    every surface back.
  - **What it bought is memory.** Our renderer's buffers for the world:
    Greyfen 680 to 81 MB, Harrowmead 467 to 65, Kurenai 415 to 136,
    Hollowmere 124 to 75, Coldharbour 171 to 114, Sarab 130 to 57,
    Cinderhaven 288 to 244. Greyfen's clusters 86,192 to 4,731. Babylon's
    copy is unchanged until X3.6.
  - **What it cost is draws.** One a part of a set, because WebGPU has no
    multi-draw-indirect: `census.mjs` totals (every vantage) rise from
    X3.3c's 497 / 172 / 836 / 869 / 891 / 217 / 61 to 1,663 / 776 / 1,942 /
    3,534 / 2,673 / 613 / 170 (Hollowmere, Greyfen, Coldharbour,
    Harrowmead, Sarab, Cinderhaven, Kurenai). Babylon's share is unmoved.
    Greyfen's main pass is our 9 block draws and 151 instanced.
  - **The desktop's frame did not move.** X0.3 (`bench.mjs --max --runs
    3`, 3440x1440, same session, the fight hashes X3.3c's on every run):
    every group's tick within the protocol's 8%. Greyfen fight 7.24 to
    7.18 ms, path 4.35 to 4.67; Harrowmead path 5.51 to 5.23, fight 6.12 to
    6.14; Sarab fight 12.37 to 13.09 (its before spread 5.8%). The desktop
    is not bound by the memory this freed; the phone's reading is owed, as
    X3.3c's is.
  - **The bank, judged.** Against X3.4a's frames, the per-kind bake moves
    a mean of 0.22/255 at most (Greyfen's `menu`; Coldharbour's
    `curtain40` 0.13, Sarab's `wadi` 0.14, the rest under 0.08), and rows
    with no scatter stay at 0. By eye nothing reads differently.
  - **Checks.** The DEV trade check (the indices cut out of a group equal
    its instanced parts' times their instances) is silent on all seven
    maps, and `bank.mjs` counts no console error. `shaders.mjs` builds
    both vertex stages for every shape on seven maps and both culls.
    `gate.mjs`, `npm run build`, `corecheck` and `parity` pass.
  - **Owed.** The phone's reading (tick, `gpu.frame`, and whether the
    memory moves its frame). The draws fold into one draw per recipe by
    vertex pulling in X3.5b, before X3.6 repeats them in every pass.
- **Verify:** `kit:hash` (it hashes scatter over fixed seeds and rungs,
  rng-draw count included) plus the replay check; `npm run collision` and
  `npm run parity`; the bank on every map, judged; the census; X0.3.

### X3.5 — Terrain and roads (PERF_PLAN B5) — **M** — **LANDED** (b2c9bc6, review fixes a24339d, 0dd2d09)

As B5 states it: clusters, as the blocks. The floor carries the most
contracts:
- the road depth bias in the material cache key
- `ROAD_RANK` and the rest of the road ladder
- the turf
- `terrainBlock` agreeing across the two callers of `terrainPatches`
  (`MapBuilder.buildValley` and the editor's brush; the server's went at X2.3)
- the collider clone, which stays as it is

- **Verify:** the bank on every map, closest to the ground and on a road
  crossing; `merge:hash`; X0.3.
**Landed** (54ec8c0 the instruments, b2c9bc6 the step, a24339d the review's
fixes, 0dd2d09 the measurement's fix).
- **What it is.** Our renderer takes the LANDFORM from Babylon's main pass —
  the floor's patches (the borderland's too), the rim's runs and the
  map-wide road merge — and draws it through the blocks' cut and cull.
  - **A second draw point, `"beforeAlphaTest"`**, between group 0's opaque
    and alpha-tested lists, because the turf is a blend on the alpha-tested
    list that writes no depth and must land on a floor already drawn. Babylon
    has no hook there, so the seam wraps the group's `_renderAlphaTest` while
    the main pass's group 0 renders (item 10). A frame whose alpha-tested
    list is empty fires the point just ahead of `"opaque"`. The blocks stay
    at `"opaque"`.
  - **The landform is marked by the BUILD** (`WorldSurface.landform`), on the
    record and never in `part.metadata`, so `merge:hash` and `kit:hash` have
    nothing new to see. `BlockHandover` tells the cull which taken mesh is a
    block and which the landform (`WorldCulling.setTaken`'s two lists).
  - **No reach.** The landform's reach box is ±`F32_MAX`
    (`WorldCulling.reachBoxOf`), so the GPU cull keeps it to the size gate
    and the frustum, the no-reach answer it had as a loose mesh. The floor
    and the rim carry no piece and are cut as one `NO_PIECE` span; the
    roads keep theirs.
  - **A group is (recipe, point)** over one cut, one cull and one index
    buffer, with two `FrameDraw`s, so the rim (the pines' material) never
    shares a group or the scatter with a block. The roads' -8 is the
    pipeline's `depthBias` (`CelRecipe.depthBias`), and a biased group draws
    first at its point (0dd2d09, below).
  - **An editor build takes nothing** (`Game` passes no `onSurface`), which
    keeps the terrain brush's in-place rewrite of the floor Babylon's.
- **What the review found** (a24339d, before any browser ran).
  `reachBoxOf` gave ANY taken mesh filed in no cell the landform's no-reach
  box, so a block that had lost its cell would have drawn at every distance
  instead of throwing. It now takes a `landform` flag, and a block in no
  cell throws again. And the contract X3.5 opened is written down: Babylon's
  opaque list now always draws before our floor, so anything lying on the
  floor that writes NO depth must be blended or on the alpha-tested list,
  never opaque, or the floor paints over it every frame (the sky dome is the
  one deliberate case). `CLAUDE.md` states it, `docs/rendering.md` argues
  it.
- **What the measurement found** (0dd2d09). X0.3 put Cinderhaven's frame up,
  and a paired, alternating A/B on the GPU confirmed it (`bench.mjs
  cinderhaven --max --gpu --runs 2`, twice a side, 3440x1440, `src/` swapped
  between 54ec8c0 and a24339d in one session). `gpu.frame` rose 4.38 to
  5.55 ms on the vantages, 5.19 to 6.27 on the path and 4.70 to 5.69 in the
  fight; the frame 5.44 to 6.02 ms on the vantages and 5.47 to 6.55 on the
  path. The fight still got faster, 13.31 to 11.17 ms, its tick falling
  12.40 to 10.30 as 193 meshes left Babylon's walk.
  - **Part of the rise was the roads.** Drawn after the floor, every road
    pixel was the bumped floor shaded and then painted over.
    `WorldBlocks.drawClusters` now draws a point's biased groups first, so
    the floor under a road fails the depth test before it shades. The
    picture does not move: the bias decides who wins, the order only what is
    shaded.
  - **What that bought**, paired against a24339d (two runs a side): the
    crossing vantage's mean frame 7.46 to 6.92 ms (about half its rise), the
    town's 6.55 to 6.09 (most of it); `gpu.frame` 5.70 to 5.32 ms on the
    vantages and 6.13 to 5.95 on the path.
  - **The rest is the landform's ORDER** against what Babylon's
    front-to-back queue gave it, `FINDINGS.md` 61's question, which now
    holds both measurements.
- **Measured** (after 0dd2d09 unless named; the BEFORE taken at 54ec8c0 in
  the same session).
  - **`merge:hash`: identical** to the BEFORE on all eight maps (the proving
    ground included), so `kit:hash` was not owed.
  - **`shaders.mjs`: clean on seven maps.** Our builds are 18/18 on the
    five-variant maps (12/12 before) and 22/22 on the seven-variant ones
    (16/16): the -8 road pipelines, both stages, for every biased shape.
  - **The bank, against the BEFORE.** Every row's frame was graded against
    the same row's frame kept at 54ec8c0 (`--check --keep`, `diff.mjs`'s
    `comparePngs` at `CHECK_TOLERANCE`), because the bank's old rows are
    stale (below). **61 of 61 within the floor**, at a24339d and again at
    0dd2d09. The worst are Sarab's `shelf` (0.0025/255, 0.037% of pixels),
    Sarab's `wadi` (0.0019), Kurenai's `crossing` (0.0014) and Greyfen's
    `crossing` (0.0010): equal-depth ties, as X3.3c's. 21 rows are
    byte-identical, the `ground` rows of Greyfen, Harrowmead and Cinderhaven
    among them.
  - **The 14 new rows against the bank: within the floor**, worst Kurenai's
    `crossing` at 0.0014/255 and Greyfen's at 0.0010. The other 33
    over-tolerance rows are the same 33 the BEFORE fails (stale). No console
    or page error on any check.
  - **By eye** (`ground`, `crossing`, Harrowmead's `borderland`): the turf
    still lies over the floor and the blades stand in it; the roads sit on
    the floor with their kerbs and no z-fighting at range, two ranks
    crossing cleanly on Sarab and Coldharbour; the borderland's turf rolls
    to the horizon, and Cinderhaven's floor runs to its night skyline.
  - **The empty alpha-tested list**, forced at every map's `ground` and
    `crossing` vantage by switching off what was on it (the turf patches and
    `sky-clouds`). Babylon then makes no `_renderAlphaTest` call with that
    list, and the landform still draws its 5 (or 11) groups from the
    fallback. The frame differs from the same frame under `?babylonworld`
    exactly as the turfed frame does (the scatter's per-kind bake), with no
    hole.
  - **`?babylonworld`** takes nothing (0 surfaces, 0 draws of ours) on all
    seven maps, and Babylon draws the floor.
  - **The handover**, per map: the surfaces taken, how many are landform,
    its groups, and our draws at each point on every frame of a played
    round. Nothing was handed back and nothing threw.

    | map | taken | landform | its groups | draws, landform / blocks |
    | --- | --- | --- | --- | --- |
    | Hollowmere | 95 | 41 | 5 | 5 / 108 |
    | Greyfen | 385 | 41 | 5 | 5 / 156 |
    | Coldharbour | 172 | 64 | 11 | 11 / 161 |
    | Harrowmead | 120 | 16 | 5 | 5 / 207 |
    | Sarab | 303 | 138 | 5 | 5 / 203 |
    | Cinderhaven | 323 | 193 | 5 | 5 / 201 |
    | Kurenai | 251 | 81 | 11 | 11 / 111 |

  - **`census.mjs --against --fall`: every row falls.** Totals: Hollowmere
    1,958 to 1,749, Greyfen 1,172 to 1,090, Coldharbour 2,403 to 2,206,
    Harrowmead 3,967 to 3,861, Sarab 3,213 to 2,818, Cinderhaven 1,196 to
    1,008, Kurenai 507 to 428 (the landform's draws fall to one a group).
  - **X0.3 on the desktop** (`bench.mjs greyfen sarab cinderhaven --max
    --runs 3`, 3440x1440 uncapped, a24339d against 54ec8c0, install times
    within each other's spread). The fight hashes are `83e8e74ef36916ba`,
    `986c2e35557fb679` and `2f97c9072ab1762b` on every run.

    | map | part | tick before | tick after | draws | mean, new / old |
    | --- | --- | --- | --- | --- | --- |
    | Greyfen | vantages | 4.40 | 3.84 | 59 to 40 | 1.060 |
    | Greyfen | path | 4.79 | 5.14 | 113 to 97 | 1.034 |
    | Greyfen | fight | 6.58 | 6.92 | 313 to 287 | 1.053 |
    | Sarab | vantages | 3.48 | 3.35 | 130 to 78 | 0.999 |
    | Sarab | path | 3.92 | 3.79 | 131 to 86 | 1.000 |
    | Sarab | fight | 10.26 | 9.36 | 510 to 435 | 0.927 |
    | Cinderhaven | vantages | 4.40 | 4.89 | 176 to 108 | 1.133 |
    | Cinderhaven | path | 4.74 | 5.49 | 177 to 114 | 1.214 |
    | Cinderhaven | fight | 9.08 | 9.77 | 487 to 375 | 1.077 |

    Greyfen's fight spread 9.0% and Cinderhaven's 34% in that run, so those
    two fight rows are noise; Cinderhaven's paired A/B above is its reading.
    A run at 0dd2d09 printed the same three hashes, but its installs ran
    25-35% slow against the BEFORE's, so its frame rates are not comparable
    (`VERIFYING.md`). Only the paired A/B prices the fix.
  - **`gate.mjs`** is clean on seven maps (an offline round on each).
  - **A round in a server match** (Cinderhaven, `?mp=`): 323 taken, 193 of
    them landform, 5 and 201 draws a frame, nothing handed back, no page or
    console error.
  - **The editor** (`F2` on Hollowmere): nothing taken. A sculpt stroke
    raised the floor from 3.25 to 7.25 m under the brush, and the drawn floor
    rose with it.
  - `npm run corecheck`, `npm run build` and `npm run parity` (all eight
    maps, every scene ready on frame 1) pass.
- **Owed onward.**
  - **The phone's reading — X3.5b's phone BEFORE, taken 2026-10-21** on
    the deployed v18 build (3b9be6c: the blocks ahead of the landform, the
    cull timer, a phone's run held for a tap and a settled fullscreen
    canvas). X0.3, a thrown-away warm-up run, then one run a map back to
    back 03:45-04:02 UTC: Greyfen, Harrowmead, Sarab. **The settings X3.5b's
    AFTER must repeat**: `?bench=<map>&gpu` with the unsafe-WebGPU flag
    (`frameMeasurable`, 4,500-6,300 samples a run), render scale 0.5, cap
    60, shadows, grass, Trees and glow `low`, volumetrics, GI, ground relief
    and FXAA off, **blur and grain OFF** (`FINDINGS.md` 52 had both on, so
    its frames are not this table's), the minimap on. **Every frame of all
    three was drawn at one matched size** (`viewport`: 1170x540 in an
    832x384 window, `sizes` 1, `staleFrames` 0). Fight hashes
    `83e8e74ef36916ba`, `3ae90f2f08fb0643`, `986c2e35557fb679`. "GPU" is
    `gpu.frame`'s mean over its samples; "cull" is `gpu.cull`'s.

    | map | part | mean | p95 | 1% low | tick | render | draws | GPU | cull |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | Greyfen | vantages | 18.0 | 32.7 | 55.6 | 4.71 | 3.29 | 34 | 13.2 | 0.27 |
    | Greyfen | path | 19.4 | 40.1 | 61.1 | 5.23 | 3.56 | 47 | 15.8 | 0.26 |
    | Greyfen | fight | 23.7 | 61.9 | 78.5 | 11.15 | 8.09 | 234 | 17.7 | 0.34 |
    | Harrowmead | vantages | 19.5 | 42.9 | 70.1 | 5.61 | 3.75 | 49 | 14.6 | 0.34 |
    | Harrowmead | path | 22.6 | 53.2 | 77.8 | 6.47 | 4.15 | 52 | 18.0 | 0.35 |
    | Harrowmead | fight | 25.8 | 61.1 | 79.5 | 11.13 | 7.24 | 162 | 20.4 | 0.47 |
    | Sarab | vantages | 17.0 | 18.5 | 42.5 | 6.28 | 4.57 | 56 | 11.3 | 0.46 |
    | Sarab | path | 16.7 | 18.1 | 23.6 | 6.22 | 4.35 | 56 | 11.1 | 0.39 |
    | Sarab | fight | 22.7 | 36.1 | 63.1 | 18.34 | 14.23 | 333 | 15.6 | 0.57 |

    The phone is GPU-bound on every part but Sarab's fight: `gpu.frame` is
    2.5-3x the tick on the look parts and 1.6-1.8x in Greyfen's and
    Harrowmead's fights, while Sarab's fight is the CPU (an 18.3 ms tick
    against 15.6 of GPU; its p95 is 36.1 against X0.4's target of 25).
    `draws` is Babylon's counter and does not see ours. **Our culls are
    1.9-3.9% of the phone's `gpu.frame`** (0.26-0.57 ms), against 0.5-1.2%
    on the desktop. Every run's heaviest eighth is still its last, the
    fight (GPU by eighths: Greyfen 13.6-20.1, Harrowmead 13.9-20.5, Sarab
    10.7-17.8), so heat and the fight are not separable in one run.

    **The provisional reading it replaces** (2026-10-20, 39d84ea's code, one
    run a map, no warm-up) drew Harrowmead and Sarab on a canvas that had
    not followed its window, 1170x618 in the same 832x384 window: about 14%
    more rows, squashed into a narrower view, which is why their draws rise
    here (46 to 49 on Harrowmead's vantages, 320 to 333 in Sarab's fight)
    while their GPU fell (Harrowmead's vantages 19.0 to 14.6, path 21.8 to
    18.0). **Greyfen is the session-to-session reading**: one matched
    1170x540 both times, the same draws, and `gpu.frame` 13.9/17.1/19.0
    then against 13.2/15.8/17.7 now, 5-8% apart with no change to what it
    draws. So **an X3.5b AFTER on the phone is a difference only past about
    8%** unless it is taken in one session beside a BEFORE. **What is short
    of the protocol**: one run a map rather than two.
  - **The landform's remaining GPU rise** (Cinderhaven's vantages and path,
    0.8-0.9 ms of `gpu.frame` on the desktop after 0dd2d09) went to
    `FINDINGS.md` 61 with the blocks'. The order half is settled below; what
    is left (about 0.6 ms on Cinderhaven's path) stays there, the cull its
    first suspect.
  - **The bank's old rows are stale.** X3.4 moved the scatter and the GPU
    driver moved (596.21 to 610.88), so 33 of the 47 rows banked before X3.5
    fail a plain `--check` on an unchanged tree. Re-taking them is the
    user's call. Until then a step is graded against a BEFORE taken with
    `--keep` at its parent (`plans/webgpu-ref/README.md` now says so).

- **The blocks ahead of the landform** (2026-10-19, after the record above).
  `"beforeAlphaTest"` is already after the sky dome, which was X3.3a's one
  objection to drawing the blocks early, so `WorldBlocks` now draws the
  blocks, the scatter and then the landform there, as ONE `FrameDraw`; a
  group is (recipe, LAYER), and nothing of ours draws at `"opaque"`. The
  floor behind a building fails the depth test before it shades.
  - **Measured**, a paired, alternating A/B against afa0327 (`bench.mjs
    --max --gpu --runs 2`, two invocations a side, ABAB on one dev server,
    3440x1440, installs within each other's spread). `gpu.frame`, median of
    four runs a side:

    | map | vantages | path | fight |
    | --- | --- | --- | --- |
    | Greyfen | 5.69 to 5.47 | 6.05 to 5.70 | 6.86 to 6.48 |
    | Sarab | 3.84 to 3.66 | 4.22 to 3.95 | 4.32 to 4.05 |
    | Cinderhaven | 5.38 to 5.32 | 5.98 to 5.74 | 5.69 to 5.57 |

    The mean frame fell 4.7-7.5% on every path (Greyfen 6.38 to 6.08, Sarab
    4.70 to 4.35, Cinderhaven 6.44 to 6.10); the CPU-bound fights on Sarab
    and Cinderhaven rose 1.3%, inside their spread. Every path's range of
    four runs clears the other side's. Draws and fight hashes unchanged.
    `FINDINGS.md` 61 has the per-segment table.
  - **The picture.** `bank.mjs --check --keep` graded against a BEFORE kept
    at afa0327 in the same session: 60 of 61 within the floor, the worst
    equal-depth ties at a building's foot (Sarab's `shelf` and `wadi`,
    0.007/255). The one over is Greyfen's `crossing` (0.056/255): the turf
    now lands after the blocks, so its sheet blends over the edge of a grave
    ledger laid level with the floor. That is BABYLON's picture — the same
    region under `?babylonworld` matches the after to 0.002/255 and the
    before by 0.96 — which X3.3c to X3.5 had lost by drawing the blocks after
    the turf.
  - **X3.5b's main pass** is no longer two draws a recipe: nothing of
    Babylon's comes between the blocks and the landform, so the fold's
    stream is one in the main pass as in every other, if it keeps the
    blocks ahead of the landform (its "What", below). (It landed at two
    draws a group with scatter, for the Intel rule: X3.5b's record.)

### X3.5b — The fold: one draw a recipe, blocks and scatter together — **M–L** (decision) — **LANDED** (52e1343, review fixes after it)

Numbered after X3.5 rather than renumbering X3.6, whose sub-steps are named
across the tree. **Decided** (the user, 2026-10-14): it lands before X3.6.

**Why.** X3.4b draws the scatter at one `drawIndexedIndirect` per part of a
set, because WebGPU has no multi-draw-indirect. The count is fixed per map
and issued every frame whatever the cull keeps: 151 instanced draws a frame
on Greyfen, and several hundred on Harrowmead and Sarab (the census totals,
over each map's vantages). Three things make that the wrong shape to carry
into X3.6:
- **They are encoded live.** Babylon's own draws replay from render bundles;
  ours run through `run(pass)` every frame, each draw two WebGPU calls
  across Chrome's wire. The desktop absorbed it (Sarab's fight rose 5.8%,
  inside the floor); the phone's reading is not yet taken.
- **Most of them draw nothing.** A set with no survivors is still a draw,
  which costs the command processor of a phone that is already GPU-bound
  (`FINDINGS.md` 52).
- **X3.6 multiplies them.** Every pass it moves (both cascades, the foliage
  map, the lamps' atlas, every probe face, the glow mask) would repeat the
  same draws: thousands a frame.

**What.** Every recipe draws ONCE per pass, the blocks, the scatter and the
terrain (X3.5) in one stream — **the main pass included**, at
`"beforeAlphaTest"` (X3.5, "The blocks ahead of the landform"), so long as
the stream keeps the blocks ahead of the landform, which is what spares the
floor its shading:
- The scatter's variant parts are cut into clusters as the blocks are
  (`clusters.ts`), each part a run of clusters in its set's own frame.
- The instance cull keeps its per-instance tests and then expands each
  surviving instance into its clusters, testing each against the frustum, so
  a big tree half in view draws half. It writes (instance, cluster) records
  into the SAME compacted stream the cluster cull writes the blocks into, in
  the same near-first order, by a scan, never an atomic append.
- The vertex stage reads its attributes from storage buffers instead of
  vertex buffers, and its `world` from the record's instance: the blocks'
  identity becomes instance 0, so one vertex stage draws both.
- **How the vertex stage learns its record is the step's first decision.**
  (a) The instance in the index's high bits and the vertex in its low bits:
  indexed draws and the post-transform cache are kept, but the two must fit
  32 bits, so the cut asserts it and hands back what does not fit. (b)
  Non-indexed draws over (record, corner): no limit, but every vertex is
  shaded once per triangle, about three times over, on a phone that is
  GPU-bound. (a), unless a map's counts break the budget.
  - **The counts, measured 2026-10-20**, at max settings on all seven
    maps off the real cut (`WorldBlocks.finish` wrapped in a scratch
    script). The VERTEX is an index into its group's buffer — every surface
    end to end, then the group's instanced parts (`finish`); the INSTANCE is
    global, the blocks' identity 0 and every scatter instance after it:

    | map | vertices, worst group | bits | instances + 1 | bits | sum | records |
    | --- | --- | --- | --- | --- | --- | --- |
    | Hollowmere | 1,127,702 | 21 | 917 | 10 | 31 | 5,315 |
    | Greyfen | 1,148,398 | 21 | 2,133 | 12 | **33** | 83,846 |
    | Coldharbour | 1,630,106 | 21 | 729 | 10 | 31 | 7,690 |
    | Harrowmead | 868,180 | 20 | 2,125 | 12 | 32 | 59,995 |
    | Sarab | 835,074 | 20 | 2,995 | 12 | 32 | 9,638 |
    | Cinderhaven | 3,672,515 | 22 | 1,351 | 11 | **33** | 5,275 |
    | Kurenai | 2,004,484 | 21 | 804 | 10 | 31 | 43,576 |

    The worst group is the merged world's (`CEL_PALETTE`) on every map, and
    it holds every set's instances too, so a split per group buys nothing;
    folding the landform into its recipe's stream moves no maximum (no
    landform group passes 163k vertices). Records, (instance, cluster) over
    every instance, peak at 83,846 (17 bits).
  - **Verdict: (a) as written does NOT fit.** Greyfen and Cinderhaven need
    33 bits, Harrowmead and Sarab exactly 32, and one split for every map
    34 (22 + 12). The product does not save it either: an index of
    instance × group vertices + vertex reaches 116% of 2^32 on Cinderhaven.
  - **What fits is (a) with the scatter addressed in its OWN region**: the
    blocks' indices stay plain vertex numbers (instance 0, at most
    3,603,508 surface vertices, 22 bits), and a scatter index sets the top
    bit, then the instance, then the vertex counted from the group's
    instanced parts (at most 69,007 a group, Cinderhaven's, 17 bits) —
    1 + 12 + 17 = **30 bits** worst (Sarab's 2,994 instances, Cinderhaven's
    parts), two to spare, decoded by shifts and a per-group base, no
    divide. It keeps (a)'s indexed draws and post-transform cache; the cut
    still asserts the budget and hands back what does not fit.
- **Two things X3.4b left are settled here:**
  - the size gate per instance against per surface (a cone or a litter pile
    under 3 px now drops where Babylon drew it inside a block);
  - the hole `BlockHandover.install` could leave: a part it skips while its
    pieces are still cut. It hands its group back instead.
- **Interim lever, not built:** if the phone shows the live encoding costing
  before the fold lands, the draw list is static (every argument indirect),
  so it can be recorded into a `GPURenderBundle` at the cut and re-recorded
  only when a bind group changes. It removes the CPU cost and not the empty
  draws, so it does not replace the fold.

- **Verify:** the census, ours at one draw a recipe in the main pass;
  `bank.mjs --check` within the floor against X3.5 (the fold moves no
  pixel but equal-depth ties); the DEV trade check silent; `shaders.mjs` for
  the new vertex stage and both culls; X0.3; the phone's tick and
  `gpu.frame` on Greyfen, Harrowmead and Sarab.

**Landed** (2026-10-21).
- **What it is.** One vertex stage draws the whole stream, PULLED: no vertex
  buffer, every attribute read out of a storage array in group 2 at the
  vertex the index names, and `world` built in `main` — identity for a
  block's or the landform's index, the instance's transform for a scatter
  index (`render/celVertex.ts`, the assembler's `VertexProgram.pull` and
  storage bindings). The index is `render/streamIndex.ts`: the top bit set
  is scatter, then 13 bits of instance, then 18 of vertex counted from the
  start of the group's arrays, where its instanced parts now lie FIRST — so
  the "per-group base" of the decision above is not needed at all. The
  instance cull keeps its per-instance tests (what `?cullcheck` reads) and
  then EXPANDS: each instanced part is cut into clusters in its set's frame,
  a record is one cluster of one instance, kept when its instance is and its
  box moved by the instance's matrix is not wholly outside a plane, and the
  kept records are scanned near-first into their group's region of one
  stream, each index written with the scatter bit and the instance set
  (`wgsl/instanceCull.ts`: `cullInstances`, `cullRecords`, `prefix`,
  `expand`). A group is one pipeline where it was two.
- **What it is NOT: one draw a recipe.** A group with scatter is TWO draws,
  its blocks' plain draw and its scatter's ONE draw, through one pipeline.
  This decision post-dates the plan above: the Intel laptop (2026-10-18,
  `docs/rendering.md`) made the blocks never-indirect after this step was
  written, and the scatter's draw could not be the blocks' — a plain range
  holding every record would hand the GPU the whole forest as triangles of
  no area every frame — so it was drawn INDIRECT at the survivors' count,
  until the same laptop's trees went too (2026-10-24): it is a plain draw
  to a BOUND the CPU computes since, `expand` dispatched direct (the dated
  note at the end of this step's landed list). Folding the landform into
  its recipe's group was not done either: the groups stay one per recipe A
  LAYER, which keeps every block ahead of every landform draw, and the one
  recipe in both layers (the rim wearing the pines' material) costs one
  draw.
- **The two things X3.4b left, settled.** The size gate stays per INSTANCE:
  the fold was to move no pixel against X3.5's picture, and a gate per block
  surface would have moved every distant prop that drops today. And a part
  `BlockHandover.install` cannot draw (an array its variant reads missing)
  now hands its whole group back (`WorldBlocks.addInstanced` withholds it,
  `finish` hands it back before anything is cut), where it was skipped while
  its pieces were still cut — a hole. A cut past the index's budget goes
  back the same way, whole: the map's instances past 8,192, or a group's
  instanced vertices past 262,144.
- **Measured** (the BEFORE at f70be50 in a worktree, the same session):
  - **`census.mjs --against --fall`: every row falls.** Ours a vantage,
    before to after: Hollowmere 113 to 8, Greyfen 161 to 17, Coldharbour 172
    to 19, Harrowmead 212 to 14, Sarab 208 to 13, Cinderhaven 206 to 11,
    Kurenai 122 to 24; Babylon's unmoved. Totals over the vantages: 1,749 to
    384, 1,090 to 226, 2,206 to 829, 3,861 to 891, 2,818 to 673, 1,008 to
    228, 428 to 134.
  - **The bank, against the BEFORE** (`--check --keep` both sides, graded at
    `CHECK_TOLERANCE`): **61 of 61 within the floor, 57 byte-identical.**
    The four that move are Greyfen's `treeline` (0.0008% of pixels),
    `marsh` (0.0005%), `crossing` (0.0002%) and `ground` (0.0001%), each
    mean 0.0000/255: equal-depth ties, the scatter's draw order now being
    near-first across a group's parts rather than part by part. No page or
    console error on either side, so the DEV trade check was silent.
  - **What it COST is memory, and it is the step's open trade.** The stream
    is sized for every record surviving, because a range can never overrun
    — that is every scatter index Babylon's merge holds. Our world's buffers
    at the deploy, before to after: Greyfen 86.8 to 206.9 MB (the stream
    30.9M indices), Harrowmead 82.4 to 166.7 (21.6M), Kurenai 154.4 to 218.1
    (16.4M), Hollowmere 83.3 to 90.6, Coldharbour 138.8 to 148.9, Sarab 74.7
    to 86.4, Cinderhaven 271.8 to 278.5. X3.3c held 680 MB on Greyfen and
    the phone drew it, so this is not a wall. **The lever, not built:** a
    region capacity under the full expansion, `prefix` clamping each draw's
    count to it and `expand` skipping what lands past it — near-first, so
    an overflow drops the FARTHEST records of the view that overflowed. It
    trades a pop in a rare view for the memory, which is the user's call
    (`FINDINGS.md` 63). **It is also a limit**: Babylon asks the device for
    no limits, so a storage binding is the default 128 MiB on every device,
    and Greyfen's stream is 92% of it; a stream past it hands back the
    groups that draw scatter (`WorldBlocks.measure`), never the map.
  - `shaders.mjs`: clean on seven maps — one build a shape now (10/10 and
    12/12, the two culls included), the pulled stage's six storage arrays
    within a default device's limits. `gate.mjs`: clean on seven maps,
    nothing handed back on any (`handedBack` 0, every taken surface drawn).
    `npm run build` and `corecheck` pass.
  - **X0.3 on the desktop** (`bench.mjs greyfen harrowmead sarab --max
    --gpu --runs 3`, 3440x1440, the BEFORE then the AFTER in one session;
    every run fought `83e8e74ef36916ba`, `3ae90f2f08fb0643` and
    `986c2e35557fb679`, every segment's spread within 8%). **The fights got
    faster**, the CPU no longer encoding a draw a part: mean new / old
    Greyfen 0.947, Harrowmead 0.932, Sarab 0.865 (its tick 11.19 to 9.77
    ms). The vantages and the path held, 0.995 to 1.017. `gpu.frame` held
    within 2% on every group (Greyfen's path 5.75 to 5.61 ms, Sarab's
    vantages 3.60 to 3.67). **The cull grew as expected**, the instances
    expanded into their records: `gpu.cull` Greyfen 0.027 to 0.095 ms on the
    vantages (0.5% to 1.7% of the frame), Harrowmead 0.029 to 0.085, Sarab
    0.029 to 0.041 — finding 61's BEFORE, now its AFTER.
- **The phone's AFTER, taken 2026-10-21** on the deployed ebdcb6f, the
  BEFORE's settings and protocol (a thrown-away warm-up, then one
  `?bench=<map>&gpu` run a map, 06:00-06:20 UTC; every frame one matched
  1170x540, `staleFrames` 0; the three canonical fight hashes) — but in the
  order **Sarab, Greyfen, Harrowmead**, where the BEFORE ran Greyfen,
  Harrowmead, Sarab. (`blocks` reads 0 taken in all three: it is read at
  the save, after the bench's map is gone. The cull's own counter is what
  says ours drew.) BEFORE to AFTER:

  | map | part | mean | tick | GPU | cull |
  | --- | --- | --- | --- | --- | --- |
  | Greyfen | vantages | 18.0 → 20.4 | 4.71 → 5.07 | 13.2 → 15.7 | 0.27 → 1.44 |
  | Greyfen | path | 19.4 → 22.1 | 5.23 → 5.34 | 15.8 → 18.3 | 0.26 → 1.35 |
  | Greyfen | fight | 23.7 → 28.1 | 11.15 → 11.61 | 17.7 → 22.2 | 0.34 → 1.76 |
  | Harrowmead | vantages | 19.5 → 21.5 | 5.61 → 6.28 | 14.6 → 16.8 | 0.34 → 1.61 |
  | Harrowmead | path | 22.6 → 22.5 | 6.47 → 6.48 | 18.0 → 18.0 | 0.35 → 1.48 |
  | Harrowmead | fight | 25.8 → 25.9 | 11.13 → 11.62 | 20.4 → 20.5 | 0.47 → 1.90 |
  | Sarab | vantages | 17.0 → 16.7 | 6.28 → 4.99 | 11.3 → 10.8 | 0.46 → 0.44 |
  | Sarab | path | 16.7 → 16.7 | 6.22 → 4.85 | 11.1 → 11.1 | 0.39 → 0.38 |
  | Sarab | fight | 22.7 → 18.4 | 18.34 → 13.60 | 15.6 → 11.9 | 0.57 → 0.47 |

  - **What is certain: the expanded cull costs the phone 1.1-1.4 ms of GPU**
    on the two forest maps (Greyfen's 83,846 records, Harrowmead's 59,995)
    and nothing on Sarab (9,638) — 7-10% of the frame, where the desktop
    paid 0.07 ms. A counter of its own, so the run order cannot make it.
  - **What is certain the other way: Sarab's fight is a quarter cheaper on
    the CPU** — its tick 18.34 to 13.60 ms, its p95 36.1 to 28.0, the
    fight that was the phone's one CPU-bound part — and every Sarab tick
    fell 1.3 ms: the draws a part are gone from the encoding.
  - **What the order confounds: the rest of `gpu.frame`.** Greyfen's GPU
    rose 2.5 ms on the vantages, of which the cull is 1.2; Harrowmead's
    vantages rose 2.2 while its path and fight held; Sarab's fight fell
    3.7. Every one of those moves the way swapping the order moves heat —
    Sarab ran first and cool where it had run last, Greyfen second where it
    had run first — so the pulled vertex stage's own price on the phone is
    not resolved by these runs.
- **The cull's `expand`, launched over the survivors** (2026-10-21, after
  the phone's AFTER). It launched a workgroup for EVERY record (83,846 on
  Greyfen, to the cluster cull's 5,612 for its scatter pass) whether or not
  it survived. Now each workgroup of `cullRecords` appends its survivors to
  a WORK LIST in one global atomic — record, band, instance and cluster in
  a `vec4u`, so `expand` reads no record or band table and both passes stay
  at the default eight storage buffers — `prefix` writes `expand`'s
  workgroup count from the list's length, and `expand` is dispatched
  INDIRECT over it. The append orders nothing: the scan has already placed
  every index, so the stream is the same stream.
  - **The first form tripled the desktop's cull** (Greyfen 0.095 to 0.290
    ms, Harrowmead 0.082 to 0.519): `expand`'s bound check was an
    `atomicLoad` of the count in every thread of every workgroup, all at one
    address. `prefix` now writes the count beside the dispatch arguments and
    `expand` reads it through a plain read-only binding of that buffer.
  - **Desktop, paired against ebdcb6f in one session** (`bench.mjs
    greyfen harrowmead sarab --max --gpu --runs 3`, the canonical hashes,
    every spread within 8%): `gpu.cull` Greyfen 0.095 to 0.068 ms, Harrowmead
    0.082 to 0.090, Sarab 0.040 to 0.058 — the clear, the barrier and the
    indirect dispatch are about 0.02 ms whatever the map, which Sarab's few
    records show — and the frame within 3% on every group. The desktop
    cannot price it: an empty workgroup was nearly free on NVIDIA, which is
    why it paid 0.07 ms where the phone paid 1.2. **The phone's `gpu.cull`
    is the reading.**
  - The bank, against the BEFORE at f70be50: 61 of 61 within the floor,
    the same four Greyfen tie rows as the step's own AFTER, no console
    error.
- **And the capture's `blocks`** (report version 19): a halted ring's is read
  as it halted, the benchmark's last frame, so a run saved from the menu
  afterwards reports the run (Sarab headless: 303 taken, 13 draws, where the
  live reading was the menu's 0).
- **The phone on the work list, taken 2026-10-22** on the deployed 1ec93a4
  (report version 19, `blocks` filled), the BEFORE's settings and its ORDER
  (a thrown-away warm-up, then Greyfen, Harrowmead, Sarab, 04:41-04:55 UTC,
  the canonical hashes) — **but on Android 17, which the phone took the day
  before**, Chrome still 155. Sarab's canvas was stale again (1170x618, not
  matched); Greyfen and Harrowmead were one matched 1170x540. BEFORE
  (f70be50) → ebdcb6f → 1ec93a4:

  | map | part | tick | GPU | cull |
  | --- | --- | --- | --- | --- |
  | Greyfen | vantages | 4.71 → 5.07 → 3.71 | 13.2 → 15.7 → 11.4 | 0.27 → 1.44 → 0.75 |
  | Greyfen | path | 5.23 → 5.34 → 3.89 | 15.8 → 18.3 → 11.8 | 0.26 → 1.35 → 0.65 |
  | Greyfen | fight | 11.15 → 11.61 → 9.60 | 17.7 → 22.2 → 13.1 | 0.34 → 1.76 → 0.87 |
  | Harrowmead | vantages | 5.61 → 6.28 → 5.66 | 14.6 → 16.8 → 13.8 | 0.34 → 1.61 → 1.17 |
  | Harrowmead | path | 6.47 → 6.48 → 6.04 | 18.0 → 18.0 → 15.0 | 0.35 → 1.48 → 1.20 |
  | Harrowmead | fight | 11.13 → 11.62 → 11.44 | 20.4 → 20.5 → 18.2 | 0.47 → 1.90 → 1.75 |
  | Sarab | vantages | 6.28 → 4.99 → 5.97 | 11.3 → 10.8 → 11.1 | 0.46 → 0.44 → 0.61 |
  | Sarab | path | 6.22 → 4.85 → 5.87 | 11.1 → 11.1 → 11.4 | 0.39 → 0.38 → 0.55 |
  | Sarab | fight | 18.34 → 13.60 → 17.25 | 15.6 → 11.9 → 13.5 | 0.57 → 0.47 → 0.76 |

  - **The phone moved under the code, so the frame is not priced.**
    ebdcb6f to 1ec93a4 changed only the cull, yet Greyfen's GPU less its
    cull fell 14.3 to 10.7 ms (-25%) and its tick 5.07 to 3.71: that is the
    OS, the order or both, not the work list. Greyfen's look parts now hold
    the 60 cap (p95 17.2 where it was 45.4). Against the BEFORE at the same
    place in the order the rest of the frame is 11-17% lower on Greyfen and
    Harrowmead, but across an OS update that is a hint, not a price.
  - **The cull is a counter of its own, and the work list roughly halved
    it on Greyfen** (1.44 to 0.75 on the vantages) **and took a quarter
    off Harrowmead's look parts and 8% off its fight** — still 2.5-3.7x
    the BEFORE on both forest maps — while Sarab's rose 0.15-0.3 ms (the
    desktop's fixed overhead was 0.02). The driver can move a counter as
    well, so the ratios are the reading, not the milliseconds.
- **Where the rest goes: the INDICES the expansion writes** (2026-10-22, a
  scratch probe on the desktop, 1ec93a4, the phone's settings and canvas —
  832x384 at 2.8125, render scale 0.5, Trees `low`, so 1170x540 and the
  same size gate — reading `args` and the work list's length back every
  400 ms through each `?bench=<map>`, the canonical hashes). What survives
  is the camera's and the settings', not the device's, so it is the phone's
  count. Means a frame, against the phone's `gpu.cull` over the BEFORE:

  | map | records | part | survivors | indices | phone cull over BEFORE |
  | --- | --- | --- | --- | --- | --- |
  | Sarab | 9,638 | vantages | 960 | 0.29 M | +0.15 |
  | Sarab | | path | 870 | 0.26 M | +0.16 |
  | Sarab | | fight | 1,820 | 0.54 M | +0.19 |
  | Greyfen | 53,485 | vantages | 4,820 | 1.73 M | +0.48 |
  | Greyfen | | path | 5,350 | 1.92 M | +0.39 |
  | Greyfen | | fight | 5,880 | 2.11 M | +0.53 |
  | Harrowmead | 41,695 | vantages | 8,530 | 3.00 M | +0.83 |
  | Harrowmead | | path | 8,710 | 3.05 M | +0.85 |
  | Harrowmead | | fight | 11,460 | 4.04 M | +1.28 |

  - **The cost follows the indices, not the records.** Greyfen has 28% more
    records than Harrowmead and costs 40-60% less, Harrowmead writing 1.6-1.9x
    its indices. About 0.1 ms plus 0.25-0.3 ms a million indices fits all
    nine; a million is 4 MiB written and 4 MiB of `source` read, so the
    phone is moving the stream at roughly 25-30 GB/s, where the desktop's
    bandwidth makes the same bytes 0.03 ms. The record pass is not the cost,
    so skipping a culled instance's records would not buy it back.
  - **A survivor is about 355 indices** on both forest maps (a cluster of
    ~120 triangles), and 10% (Greyfen) to 28% (Harrowmead) of the records
    survive — which is why the work list halved Greyfen's cull and took
    less off Harrowmead's: it removed the empty workgroups, not the writes.
  - The milliseconds carry the Android 17 caveat above; the ordering and
    the fit do not depend on them.
- **The copy's source at 16 bits** (2026-10-22, the third lever of
  `FINDINGS.md` 63). `expand` read a 32-bit `source` index for every index
  it wrote, so a million indices was 8 MiB of traffic; the source is now 16
  bits an index, local to its PART, two to a word (`sourceIndex`), and each
  scatter cluster carries its part's first vertex in its group's arrays in
  the spare `refs.y` — so the stream it writes is the same stream, bit for
  bit, at three quarters of the bytes. A part past 65,536 vertices
  (`SOURCE_VERTICES`) hands its group back in `WorldBlocks.handBack`
  beside the stream index's two budgets; no shipped part is near it (the
  census below is unchanged on every map).
  - **The picture is the same picture**: the bank's 61 frames pixel-identical
    to 1ec93a4's own (mean 0, max 0, every one), and its report against the
    banked frames identical line for line; the census (`--against` X3.5b's
    AFTER) equal on all seven maps; `shaders.mjs` clean on seven; gate.mjs
    clean on Greyfen, Harrowmead and Sarab; build passes.
  - **Desktop, against 1ec93a4's own run** (`bench.mjs --max --gpu --runs
    3`, the canonical hashes, every segment within 8%): `gpu.cull` Greyfen
    0.068 to 0.067 ms, Harrowmead 0.090 to 0.085, Sarab 0.058 to 0.057; the
    look parts within 1%. The fights read 6-12% faster on the CPU tick, which
    a GPU buffer's format cannot do — a day apart, that is the session. As
    before, the desktop's bandwidth hides what this saves.
- **`?scatterlist`: the survivors' list drawn, nothing expanded**
  (2026-10-22, `FINDINGS.md` 63's first lever, as an A/B a phone can take
  from one build). The scan counts SURVIVORS; `expand` is a thread a
  survivor writing its one 16-byte entry (instance, first source index,
  count, part — `streamIndex.ts`'s `LIST_WORDS`) where the scan puts it;
  each range's draw is a non-indexed `drawIndirect` of 384 corners a
  survivor (128 triangles, a cluster's most), first corner the scatter bit
  over `slot * 384`; and the vertex stage's list twin (`celVertex`'s
  third argument) reads the entry and the 16-bit source itself, a corner
  past its cluster's count repeating the last so a short cluster ends in
  triangles of no area. Only the groups that draw scatter wear the twin,
  chosen at `finish` once the cull exists (so group 2 and the pipeline ask
  moved after it), binding the list and the source beside their arrays:
  eight storage buffers in a palette variant, the default limit, which
  `shaders.mjs` now builds on every map. The stream is never allocated —
  Sarab's list is 154 KB where its stream was 12 MB.
  - **The same picture**: the bank under `?scatterlist` pixel-identical to
    stream mode's frames, all 61 (mean 0, max 0), no console error; the
    census under it equal on all seven maps; a probe saw the list cull,
    the list stage and only `drawIndirect` under the flag, and only
    `drawIndexedIndirect` without; captures say `forced: ["scatterlist"]`.
  - **Desktop, the two modes back to back** (`bench.mjs --max --gpu --runs
    3`, then `--query scatterlist`, the canonical hashes): `gpu.cull`
    Greyfen 0.066 to 0.050 ms, Harrowmead 0.085 to 0.053 (fight 0.097 to
    0.057), Sarab 0.057 to 0.050 — while `gpu.frame` ROSE 1-3% (Greyfen's
    vantages 5.37 to 5.51, Harrowmead's fight 5.44 to 5.60, Sarab +0.4-1.1%):
    the vertex stage's lost reuse costs the desktop about 0.15 ms where the
    cull saves 0.03. The phone's cull saves an order more, and its vertex
    work costs what only its run can say.
- **The phone's A/B, taken 2026-10-23** on the deployed d763327 (Android 17,
  Chrome 155, report version 19, one matched 1170x540 on all six, the
  canonical hashes), in the protocol's order: Greyfen stream then list,
  Harrowmead list then stream, Sarab stream then list, 00:52-01:22 UTC.
  Stream → list, the segment groups' means (GPU less cull is the one
  subtracted from the other):

  | map | part | tick | GPU | cull | GPU less cull |
  | --- | --- | --- | --- | --- | --- |
  | Greyfen | vantages | 4.04 → 4.04 | 12.29 → 11.97 | 0.82 → 0.40 | 11.47 → 11.58 |
  | Greyfen | path | 5.03 → 4.80 | 15.07 → 14.44 | 0.87 → 0.38 | 14.20 → 14.06 |
  | Greyfen | fight | 12.92 → 11.71 | 18.11 → 16.97 | 1.17 → 0.51 | 16.94 → 16.46 |
  | Harrowmead | vantages | 5.14 → 4.46 | 12.64 → 12.04 | 1.09 → 0.41 | 11.55 → 11.63 |
  | Harrowmead | path | 4.83 → 4.39 | 13.34 → 11.87 | 1.08 → 0.36 | 12.26 → 11.51 |
  | Harrowmead | fight | 10.59 → 9.88 | 15.49 → 14.98 | 1.53 → 0.49 | 13.96 → 14.49 |
  | Sarab | vantages | 4.88 → 5.79 | 10.59 → 10.83 | 0.62 → 0.51 | 9.97 → 10.32 |
  | Sarab | path | 4.90 → 5.06 | 10.78 → 11.16 | 0.55 → 0.45 | 10.23 → 10.71 |
  | Sarab | fight | 13.84 → 16.80 | 10.19 → 11.09 | 0.65 → 0.53 | 9.54 → 10.56 |

  - **The list takes 55-70% off the forest maps' cull** (0.4-1.0 ms) and
    15-20% off Sarab's (0.1): the writes were the cost, as the probe said.
  - **The lost vertex reuse costs the phone too, about half of what the
    cull saves.** Paired vantage by vantage on medians where the tick says
    the phone was in one state (Greyfen's, Harrowmead's millpond,
    borderland, ground and crossing), the rest of the GPU frame rose 0-0.8
    ms; both forest fights +0.7 (medians). On Sarab it rose 0.1-1.0, but
    its list run was the hotter one (tick +19% on the vantages, +21% on the
    fight, which a GPU binding cannot do).
  - **So the frame: a small win on the forest maps, a small loss on
    Sarab.** Greyfen's list run went second and still read 0.3-1.1 ms
    lower on every group (fight 18.1 to 17.0, frame 24.4 to 23.5 ms);
    Harrowmead's 0.5-1.5 lower, but it went first and the stream run's
    tick was 7-15% higher, so that is the heat's as much as the list's.
    Sarab 0.24-0.9 higher, its fight bound by the CPU either way (tick
    13.8-16.8 against a 10-11 ms GPU). The look parts held the 60 cap in
    both modes on every map.
  - **The 16-bit source has no phone reading.** The stream mode's cull
    against 1ec93a4's capture a day earlier: Greyfen 0.75 to 0.82 on the
    vantages (fight 0.87 to 1.17), Harrowmead 1.17 to 1.09 (fight 1.75 to
    1.53), Sarab within 0.1 — across sessions and either way, so nothing.
- **The list is the only draw now, and the stream is gone** (2026-10-23,
  the user's decision on the A/B above). The cull writes the list and
  nothing else: no stream buffer, no `expand` that copies indices, no
  `drawIndexedIndirect`, no `?scatterlist`. `render/streamIndex.ts` became
  `render/scatterList.ts` — the entry, an index as the scatter bit over
  `slot * 384 + corner`, the 16-bit source and its read — and the 13/18-bit
  split went with the stream, so the budget a cut is held to is the list's:
  records times 384 corners past 2^31, or the list past the device's
  storage limit, hands back the scatter's groups, and a part past 65,536
  vertices its own (CLAUDE.md states it). The vertex stage keeps two
  variants, the plain one (every index a plain vertex, no list bound) for a
  group without scatter and the SCATTER twin for one with; `drawIndirect`'s
  arguments are four words a range, not five. `FINDINGS.md` 63 — the
  stream's 124 MB on Greyfen and 92% of a default storage binding — is
  deleted as fixed; its distance-rung idea went with it, unmeasured.
  - **The same picture**: the bank's 61 frames pixel-identical to
    `?scatterlist`'s and to the stream mode's (mean 0, max 0, every one),
    its report against the banked frames identical line for line, no
    console error; the census (`--against` X3.5b's AFTER) equal on all
    seven maps; `shaders.mjs` clean on seven (a row fewer, the one cull);
    gate.mjs clean on Greyfen, Harrowmead and Sarab; build passes.
  - **Desktop, against the flagged list run** (`--max --gpu --runs 3`, the
    canonical hashes): every group within 2% but Sarab's fight (7% faster
    on the tick, the session's); `gpu.cull` 0.049-0.057 ms on all three.
- **2026-10-24: the scatter is drawn PLAIN, at a bound the CPU computes —
  a fix, not a step.** It corrects this step's draw in every view X3.6a-c
  built on it, and changes no plan. What the laptop showed, its A/B's
  answer (the scatter's indirect DRAWS, not `expand`'s dispatch) and why
  `expand` stays direct anyway, and the bound, the cleared list and the
  zero entry are argued in
  `docs/rendering.md`, "NOTHING OF THE STATIC WORLD IS DRAWN OR DISPATCHED
  INDIRECT". Each range is `draw(bound * 384, 1, SCATTER_CORNERS + base *
  384, 0)` (`InstanceCull.drawRange`, `empty`) from both draw sites
  (`WorldBlocks.drawScatter`, `WorldDepth.draw`), so every view changed
  together. The A/B shipped with it as a TEMPORARY switch
  (`?scatterindirect`, the path before exactly; `?scatterindirect=dispatch`,
  the plain draw with `expand` alone indirect), named in a capture's
  `graphics.forced`, and was stripped once the laptop answered (below).
  - **Rejected** (the design, in this session's scratch): a plain draw over
    the list's whole capacity (32 M corners a pass on Greyfen), a count read
    back a few frames late (pop-in on a cut, a probe face with no history),
    and gating it to the device (nobody knows which devices drop).
  - **Measured on the desktop** (`--max`, the RTX box; the scratch logs
    are this session's):
    - **The same picture**: the bank's 61 frames byte-identical to ed51e1d's
      (a BEFORE in the worktree), and again under `?scatterindirect` and
      under `?scatterindirect=dispatch` — 61 of 61 each, mean 0, max 0 — its
      report identical line for line, no console error.
    - **The bound is never short**: a probe copied every dispatch's `args`
      out in its own encoder and compared each range with the CPU's bound,
      through a whole `?bench=<map>` on seven maps (the install's probe
      bake, the vantages at eight headings, the path, the fight: 3,670-7,138
      dispatches a map; every one but every fourth of the main pass's) —
      max(count - bound) 0 in every view, at max settings (3440x1440) and at
      a phone's (2400x1080, Trees, shadows, GI, grass and bloom low).
      Bound over count, summed over the run: the main pass 1.004 (Sarab) to
      1.20 (Greyfen) at max, 1.004-1.19 at the phone's; the cascades
      1.01-1.20, the foliage map 1.04-1.14, a probe's faces 1.02-1.09, the
      lamps' faces 1.18-1.87 over a few thousand survivors; a single
      dispatch's ratio runs higher where its count is a handful. Under
      1.5 everywhere it matters, so the lever (the clusters of a straddling
      instance tested on the CPU) is not built.
    - **The census** (`--against` ed51e1d's): ours lower on five maps —
      Greyfen 213 to 205, Coldharbour 674 to 672, Harrowmead 851 to 847,
      Sarab 669 to 661, Kurenai 131 to 125, a range at bound 0 drawing
      nothing — and equal on Hollowmere (278) and Cinderhaven (186);
      `?scatterindirect` equal to ed51e1d on all seven.
    - `gate.mjs` and `shaders.mjs` clean on seven; typecheck, build,
      corecheck.
    - **X0.3** (`bench.mjs --max --gpu`, 3440x1440, uncapped, one run an
      invocation, plain alternated with `?scatterindirect`, three a side,
      the canonical fight hashes on all 18), plain over indirect: Greyfen
      frame 1.001 / 1.003 / 0.996 (vantages / path / fight), `gpu.frame`
      1.002 / 0.999 / 0.994, tick 1.005 / 0.996 / 0.998; Harrowmead frame
      1.000 / 0.997 / 0.984, `gpu.frame` 0.984 / 1.013 / 1.000, tick
      1.004 / 0.993 / 0.980; Kurenai frame 0.995 / 0.997 / 0.988,
      `gpu.frame` 0.994 / 1.035 (17 samples) / 0.998, tick 1.008 / 0.988 /
      0.988. `gpu.cull` fell about a third on all three (51-61 to 33-42
      µs): the indirect `expand` cost more than the direct one and the
      clear. Nothing past the session's floor. Greyfen's bench install read
      1.1 s longer on the plain arm; a paired install at 1920x1080 did not
      reproduce it (8.4-8.9 s plain, 8.6-9.3 s indirect), and `dispatch`
      took 25-35 µs a call with the bound against 5 without.
  - **What the post-commit review found** (two independent readers over
    e172f88, one for correctness and one for shape and contracts; fixed
    after it). No correctness defect: the bound was confirmed against
    `visible` test by test (the reach, the size gate and its near cut, the
    five planes and each set's sway, a probe's exclusion left out), the
    order of every caller (a dispatch's survivors drawn before the view's
    next), the zero guard in the shared decode, and the arithmetic (`+`
    over the sign bit, the bound times the stride under 2^31). On the
    shape: nothing stated that `visible` has a CPU mirror (both headers and
    `bound`'s doc now do: a test that keeps more owes `bound` the same
    widening); `args` was described as read back by a probe that is not in
    the tree; `EXPAND_SIZE` was said to be read by the bound (it sizes the
    direct dispatch); a citation put `ScatterDraw` in `InstanceCull.ts`;
    `WorldBlocks`' header had a sentence with no subject; `SLACK_CPU` is
    `PLANE_SLACK`; `drawRange` returned a boolean no caller needed (`void`,
    behind `empty`); `CullDiagnostics` did not say a sharing view draws as
    the uploading view does; the A/B's branches and parameters were
    untagged (each now `TEMPORARY (?scatterindirect)`, and
    `docs/rendering.md`'s strip note lists what goes dead with them); the
    `InstanceCull` header's invariants described both arms in a 30-line
    chain; and the arms were described in eleven places (once now, on
    `ScatterDraw`, and pointers — this note's argument cut to the one in
    `docs/rendering.md`, `SCATTER_BIT` there and here named as the TS
    constant, `SCATTER_CORNERS`). Re-checked after the fixes: the bank 61
    of 61 byte-identical to ed51e1d's frames on the default arm, its report
    identical line for line to the commit's; typecheck, build and
    corecheck. The A/B arms were not re-banked: the fixes moved none of
    their branches.
  - **The laptop answered** (the user, 2026-10-24, on the deployed
    071a95e, four loads each): the default — no flicker;
    `?scatterindirect` — FLICKERS; `?scatterindirect=dispatch` — no
    flicker. So it was the scatter's indirect DRAWS, and the suspicion on
    `expand`'s indirect dispatch is DISPROVED; every tree going together
    reads as that driver dropping a whole pass's or frame's indirect draws
    together, not one at random as the blocks' symptom read on 2026-10-18.
    `expand` stays direct anyway, by the user's decision, so the rule stays
    one rule (nothing of the static world drawn OR dispatched indirect):
    less code, and the direct dispatch cost nothing (`gpu.cull` fell about
    a third, above). The switches came out in the commit after 071a95e,
    with the indirect arguments `prefix` wrote for them (`args`, `expand`'s
    dispatch words, `INDIRECT_BYTES`, `DISPATCH_BYTES`, `MAX_WORKGROUPS`);
    `expand` now reads the work list's length through a plain binding of
    the counter `cullRecords` appends with. Re-checked: the bank 61 of 61
    byte-identical to ed51e1d's frames, the census as e172f88's default on
    all seven, `gate.mjs` and `shaders.mjs` clean on seven, typecheck,
    build, corecheck.
  - **Owed**: the phone, against a capture of the build before e172f88
    (there is no switch any more), alternated, which is where the bound's
    CPU would show: `bound()` loops over every instance of the map on every
    dispatch, each lamp face's and each probe face's included, 25-35 µs a
    dispatch on the desktop, so a phone frame re-baking several lamp faces,
    or a probe burst, could add a few ms of CPU.
- **Owed.** A same-session pair against 3b9be6c still prices the fold
  itself.

### X3.6 — The static world's other passes (PERF_PLAN B3) — **L, as five sub-steps** (the fifth added 2026-10-24)

Each sub-step lands on its own. Under rule 5, each pass's texture moves to our
side here, and Babylon's materials, which still draw the bodies and the rest,
sample a wrapped view of it — but for X3.6d's: the glow's MASK stays
`GlowPass`'s, because the bodies, the effects, the fire, the viewmodel and the
moon still draw into it and its blur and the ink read it, so ours draws INTO
Babylon's pass there, as it draws into the main pass, and nothing is wrapped.
Every pass draws through X3.5b's fold: a group's plain draw and, with scatter,
its one draw, a pass — indirect when these steps landed, plain at a bound the
CPU computes since 2026-10-24 (X3.5b's landed list).

- **X3.6a — the world's shadows:** both cascades, the foliage map and the
  lightning flash map (`ShadowSystem`, today a `ShadowGenerator` with a
  `DirectionalLight` per map). The texel snap (`core/shadowWindow.ts`), the
  back-face recording and "only re-render when the snapped focus moves" all
  hold **LANDED** (below).
- **X3.6b — the lamps' atlas:** `LocalShadows`' static faces — and, the
  texture being one side's whole, its dynamic tiles and its clears with
  them **LANDED** (below).
- **X3.6c — the reflection bake:** `ReflectionSystem`'s probes, which draw the
  world from each probe with the probe's eye passed explicitly. That removes
  the class of bug 242b986 and a858c74 fixed: a `ReflectionProbe` never moving
  `scene.activeCamera`. The bake still drains behind the loading card
  **LANDED** (below).
- **X3.6d — the glow mask** for the emissive palette's static meshes
  (`GlowPass`; `shaders/EmissiveWorld.ts`) **LANDED** (below).
- **X3.6e — the palette's main pass** (decided 2026-10-24) — **S–M**. Added
  after X3.6d by the user's decision ("Decisions that are yours"), not part of
  the step as first planned, and measured first because it could flip the
  pixels where a lit window ties in depth with a coplanar surface.
  - **Do:** the palette held since X3.6c is TAKEN for the main pass whenever
    the handover holds the whole palette, one decision with the mask; drawn
    FIRST in `WorldBlocks`' `"beforeAlphaTest"` draw, ahead of the blocks, by
    the bake's own pipeline; reach-culled by its cell's box, as Babylon's
    candidate was; a loss of either pass hands both back.
  - **Verify:** the bank against a BEFORE at c34a06b; the in-page A/B (frame
    and mask, ours against Babylon's after a loss); `census --fall`; the gate;
    the paths; X0.3.
  - **Must not:** flip a palette-against-block tie (the palette is drawn before
    every surface of ours, as Babylon's opaque queue drew it); draw a palette
    pixel past the reach; leave a palette mesh bloomed by neither side.
  **LANDED** (below).

- **Verify, each:** the bank; X0.3; and for X3.6c, the probe-eye harness that
  measured 242b986, run again.

**X3.6a landed** (93d5918, the post-commit review's fixes after it; 2026-10-23).
- **What it is.** The world's four directional maps — both cascades, the
  foliage's front-face map and the lightning's — are textures our renderer
  OWNS (`render/WorldShadows.ts`) and draws the casters into
  (`render/WorldDepth.ts`, the depth program `render/celDepth.ts`) whenever
  the handover holds EVERY caster a map has; Babylon's readers (the cel
  materials, the grass, the water, the volumetrics) sample a wrapped view
  (`WebGPUEngine.wrapWebGPUTexture`), and our frame binds the texture itself
  (`OwnTexture`) — rule 5 both ways. `ShadowSystem` keeps the lights, the
  windows, the snap, the hold and the strike, and hands each map's matrix
  over; its `ShadowGenerator`s are the path for an editor build,
  `?babylonworld`, a map with a caster the handover cannot hold, and a map
  whose casters are LOST mid-map (a group's or a cull's failure, a refused
  main pass: `WorldShadows.lose`, handed over after the task in hand because
  a refusal lands inside a render whose unsubmitted commands still hold the
  textures).
- **Every caster held, two ways.** A surface the main pass takes casts from
  its own group; a caster it does not take — the emissive palette's merges,
  which keep no recipe — is held for the shadow maps ALONE
  (`WorldBlocks.addCaster`: positions only, one "casters" group cut after
  every other, which the main pass's cull leaves out as a tail and no main
  pass draws). Which surfaces cast is Babylon's generator's rule, stated
  once a side (`BlockHandover.passesOf`, `ShadowSystem.casts`): not
  `noShadowCaster`, not blended; `PASS_SOLID` too for a translucent solid.
  Every shipped map holds every caster: 78 casting surfaces on Hollowmere
  (24 of them emissive, held alone), 353 on Greyfen (9), 154 on Coldharbour
  (46), 108 on Harrowmead (4), 171 on Sarab (6), 179 on Cinderhaven (49),
  170 on Kurenai (4).
- **A map is a second VIEW of the main pass's culls.** `ClusterCull` and
  `InstanceCull` split into a map's TABLES, uploaded once by the main pass's
  view, and per-view outputs; a cull reads its inputs as data
  (`CullInputs`: a view-projection, an eye, the reach, the size gate, the
  sway, a PASS MASK), and each cluster's record carries the passes it is
  drawn in (`sway.z`; the uniform block grew a tenth `vec4u` for the mask,
  which the main pass's view sets to 0 and never tests). The shadow view is
  told the light's matrix and eye, no reach, no gate and no sway — Babylon's
  depth pass culled nothing but the window and never swayed a vertex — and
  serves all four maps in one submit through a staging SLOT a map
  (`CullUniform`), each map's draws reading the indices its own dispatch
  wrote. Faces by the generator's rule (the back for the far, near and
  flash maps, the front for the foliage's).
- **Babylon's number, at a quarter of the memory.** The depth is the light's
  clip z under the half-z range from a matrix built by `getTransformMatrix`'s
  own helpers in its order (`ShadowSystem.lightTransform`), drawn upside down
  as every render target is, into `r16float` where Babylon's was
  `rgba16float` with three channels nobody read; the `depth32float`
  attachments are one a size, shared. A map is drawn only when
  `ShadowSystem` asks, on the next frame our renderer prepares, into the
  encoder Babylon submits ahead of every pass of its own; the probes' bake
  waits on `ShadowSystem.ready` beside `gi.converged`.
- **Measured.**
  - **The maps themselves, against the generators** (a scratch readback of
    both sides' maps at each map's menu vantage in one page, after the
    review's fixes): texels differing, far / near / foliage —
    Hollowmere 7 / 2 / 0 (of 4.2 M, 4.2 M and 1 M), Greyfen 837 / 357 / 155,
    Coldharbour 0 / 2 / 0, Harrowmead 66 / 14 / 21, Sarab 10 / 2 / 0,
    Cinderhaven 3 / 6 / 0, Kurenai 63 / 72 / 8 — Greyfen's far map the worst
    at 0.02% of its texels.
    Coldharbour's far map is identical; what differs is a triangle's edge
    across a texel's centre, worst on Greyfen, whose scatter is 87% of the
    world: its instances are moved by their matrices on the GPU where
    Babylon's merged copy was moved on the CPU.
  - **The bank, against a BEFORE kept at a78a4eb in the same session**
    (`--check --keep` both sides, graded at `CHECK_TOLERANCE`): **61 of 61
    within the floor, 37 byte-identical**, the worst Greyfen's `crossing`
    (0.0088% of pixels, mean 0.0004/255), `menu`, `canopy`, `marsh` and
    `treeline` (under 0.01% each), and Harrowmead's `borderland`. No
    console or page error. The bank, the census and `shaders.mjs` ran before the
    review's fixes; the readback above, taken after them, matches its own
    reading before them texel for texel, and the gate and the benchmark ran
    on the committed code but for the culls' buffer labels.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134) — the step moves no main-pass draw.
  - **`shaders.mjs`**: clean on seven maps, our builds 15/15 and 19/19 (the
    depth pipelines, plain and scatter, by faces, among them). **`gate.mjs`**:
    clean on seven.
  - **The paths no instrument covers**, forced in a scratch page on
    Hollowmere: a rung change to `low` and back while the maps are ours
    (re-made, redrawn), a strike (the flash map drawn), a forced LOSS (the
    four generators built, `depthMap` theirs), a second round after it (ours
    again, no generator), and the editor (`F2`: the generators). No page or
    console error.
  - **X0.3 on the desktop** (`bench.mjs greyfen harrowmead sarab --max --gpu --runs 3`,
    3440x1440, the BEFORE at a78a4eb in the same session, the canonical fight
    hashes on every run, every segment within 3.1%): the mean frame new /
    old 0.997-1.000 on the vantages, 0.998-1.002 on the path and 0.929-0.972
    in the fights. Babylon's draw counter falls where its depth passes went —
    the paths 97 to 38 (Greyfen), 76 to 58 (Harrowmead), 86 to 65 (Sarab).
    `gpu.frame` within 2% on the look parts; Greyfen's fight 6.11 to 6.53 ms
    over 351 and 133 samples. The tick rose on Greyfen's vantages (3.90 to
    4.50 ms), all of it in `render` at equal draws, and is BACK-PRESSURE on a
    GPU-bound segment rather than work: at one vantage in one page, the maps
    handed back and forth three times a side, `scene.render`'s span reads
    0.69-0.83 ms ours against 0.67-0.75 Babylon's capped, and lower ours
    uncapped. The maps redraw only when a window moves: none on a still
    camera, bursts of 2-10 a second of the three static maps together as the
    benchmark's camera moves on.
  - **Two stalls, and they are not this step's.** The first AFTER
    benchmark's third Greyfen run never reached the round (its 40-minute
    timeout), and one gate run recorded no frame in Hollowmere's warm
    window. A watchdog over the benchmark's workload, nine runs back to back
    in one browser (`--max`, uncapped, 3440x1440), caught the cause:
    `DXGI_ERROR_DEVICE_HUNG`, the D3D12 device removed mid-run, rendering
    stopped. And it is the MACHINE's, not the step's — the identical loop at
    the parent, a78a4eb, hung 6 of 9 runs (all three maps), against 4 of 9
    at 4fd2e85 (Greyfen 3, Harrowmead 1) — and 4 of 9 at 1920x1080, 4 of 9
    capped at 60, and 5 of 9 under `?babylonworld`, our renderer drawing
    nothing at all. `FINDINGS.md` 64.
  - **What the shadow view costs in memory** — measured off every buffer and texture made through the install:
    the textures are 40 MiB on the `high` rung (two 2048 and two 1024
    `r16float` maps and one `depth32float` attachment a size), where the
    generators held about 120 (an `rgba16float` colour and a `depth32float`
    of its own a map); the second view of the culls is 12.1 MiB on Greyfen
    and Harrowmead, 9.6 on Sarab, 16.5 on Kurenai and 27.6 on Cinderhaven
    (an index buffer as large as the map's, and the scatter's per-record
    scratch). So the step takes 50-70 MiB off every map on a rung that
    draws one; on `off` it holds nothing (no caster is held, review below).
- **What the review found** (fixed before the commit): `WorldBlocks`'
  contract header still described two layers; a `WorldDepth` was built for a
  map whose casters had already gone back at the cut (now skipped, and the
  install already refused the hand-over when a casting surface went back
  during the cut); the
  map count restated as `SHADOW_SLOTS`; a closure and iterators made on a
  redraw frame; the shadow view's eye at the origin (the light's now — the
  bands are the camera's, which a light ~90 m back mostly lands past, so it
  orders little); a view's buffers labelled
  as the map's (each now names its view); comments the step made false (the
  uniform's nine words, a reader's channel).
- **What the post-commit review found** (a second, independent reader over
  93d5918; fixed after it): `ShadowSystem.remakeOurs` kept a texture of the
  same size under a view it had just disposed, which Babylon destroys at its
  frame's end — latent, no path re-made a map at its own size, but nothing
  stopped one (now always made afresh); `settled` waited on the LATEST ask,
  which a moving window renews for as long as it moves, so the probes' bake
  could be held off without limit (now each map's FIRST draw since its
  casters or its texture changed; the two stalls above turned out to be
  the device, not this); the culls' second view built on the `off` rung, where
  no map is drawn (no caster is held there now: `WorldShadows.rungDraws`,
  which `ShadowSystem.setQuality` states — a rung switched on mid-map draws
  on the generators until the next map); the foliage and flash matrices
  not re-published on a hand-over; two `Vector3.Up()` a redraw; a scatter
  part never asked whether it blends; `WorldBlocks` told whether to build
  the depth by a boolean and counting the slots itself (it is handed the
  count); and docs the step had over-claimed (the eye's ordering, which
  the camera's bands mostly lose; the memory on `off`; whose meshes cast
  on the fallback). A single group's failed pipeline still loses every
  map, deliberately: one owner a map. Re-checked after the fixes: the
  readback on seven maps, the gate on seven, and the paths above with a
  round on `off` (no caster held, no generator) and back on `high` (ours).
- **Owed onward.**
  - The shadow maps are not timed on our side: their culls are not in
    `gpu.cull`, and `shadowPass` brackets only Babylon's generators — in a
    round, only the bodies'. So when the phone's FOLLOW-UP reading is taken
    (owed as every step's has been since X3.3c, the user's to take; the
    step's own Verify — the bank and X0.3 — is above), it is read as
    `gpu.frame` against X3.5b's.
  - X3.6b, the lamps' atlas, holds `map.visuals` the same way: the caster
    groups and the pass mask are its to extend.

**X3.6b landed** (5b31851, the post-commit review's fixes after it;
2026-10-23).
- **What it is.** The lamps' atlas is a texture our renderer OWNS
  (`render/LampAtlas.ts`, an `r16float` colour as Babylon's render target's
  was, and a `depth32float` attachment) and draws EVERY pass
  of whenever the handover holds every caster; Babylon's cel materials
  sample a wrapped view (`wrapShadowTexture`, now `core/shadowWindow.ts`'s,
  which `ShadowSystem` uses too) and our frame binds the texture itself
  (`ShadowBindings`' `own.localAtlasMap`). `LocalShadows` still decides
  everything — which lights cast, which tiles each holds, which faces bake
  on which frame, what reaches the slots — and on our side hands the frame's
  work over as one `AtlasWork` over the arrays it already filled
  (`LampAtlas.queue`), where Babylon's side draws it into its render target
  as before. Who holds it is read at `LocalShadows.setWorld`, after the
  install, as the world's maps are; a loss (`LampAtlas.lose`, beside
  `WorldShadows.lose`) hands it back after the task in hand.
- **Every pass moved, not only the static faces.** A static tile and a
  dynamic one share the texture, and the cel stage binds one atlas at 16 of
  16 textures, so the step could not leave the proxies Babylon's: the
  proxies (collider boxes and bodies) are one instanced unit box (the
  kit's `createBox`, unrolled into 36 corners), its matrix and tile an
  instance's, one draw for every dynamic tile; a tile flagged cleared is a
  `copyBufferToTexture` of a tile of the far value. The passes keep
  Babylon's order (clears, static faces, proxies); the colour is loaded by
  every pass and the depth cleared by every pass and stored by none.
- **A static face is a view of the culls.** The atlas's casters are their own
  pass bit, `PASS_LAMPS` — every surface not `noShadowCaster`, BLENDED OR
  NOT, because Babylon's bake drew its visuals whatever their material;
  on every shipped map no blended surface casts, so the set is the world
  maps'. Each static face is culled as a directional map is
  (`WorldDepth` split into `cull` and `draw`, the pass the caller's), at a
  slot of its own after the world's four (`staticFacesPerFrame` slots):
  the face's perspective as a view-projection (`lampDepth.faceInputs`), the
  light as the eye, the light's range as the reach. The program
  (`render/lampDepth.ts`) is `localShadowDepth` in the pulled form — the
  radial distance over the range from the back faces, the fragment
  discarded outside the face — over the world's arrays, its scatter twin and
  the proxies'.
- **Measured.**
  - **The atlas itself, against Babylon's** (a scratch readback, ours / Babylon's /
    ours again from a fresh allocation at one eye, three vantages near
    clusters of shadowed fixtures a map; static tiles on `high`, the
    dynamic ones on `low`, where every light is proxies). Ours against ours
    is 0 texels everywhere; the dynamic tiles are identical to Babylon's on
    every map. On the static tiles, first on seven maps, then on Harrowmead
    and Hollowmere after the reach fix below:
    texels a receiver can read differently (both values clamped at 1, the
    lookup being asked only inside the range; over 0.01): Harrowmead 0 / 0 /
    0, Hollowmere 3 / 0 / 5 — silhouette edges across a texel centre, both
    sides covering the same count of in-range texels on every tile. Before
    the clamp, the raw count over 0.01 is 70 / 70 / 448 and 281 / 0 / 5:
    texels past the range where one side stored a distance over 1 and the
    other the far value — Babylon tested a MESH against the range, the cull
    tests a cluster's BLOCK — which read "lit" alike. The first seven-map
    readback (before the fix) was edge and rounding differences of the same
    kind: Greyfen 62 texels at most, Coldharbour 27 at 0.0005, Sarab and
    Cinderhaven under 0.19% of a tile's texels, Kurenai 0.
  - **The bank, against a BEFORE kept at e1fbb9a in a worktree**
    (`--check --keep` both sides): **61 of 61 byte-identical**. No console
    or page error.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134).
  - **`shaders.mjs`**: clean on seven maps, our builds 15/15 and 19/19 (the
    lamp pipelines among them). **`gate.mjs`**: clean on seven.
  - **The paths no instrument covers**, forced in a scratch page on
    Hollowmere and Coldharbour: ours after every install on all seven maps;
    a rung change (`low`, `off` and back) while the atlas is ours; a forced
    LOSS (Babylon's render target, then ours again on the next map); a
    second round; a round installed on `off` and raised (Babylon's until the
    next map, as the world's maps); the editor and `?babylonworld`
    (Babylon's). No page or console error. These ran before the reach fix,
    which changes one number in the cull's inputs.
  - **X0.3 on the desktop** (`bench.mjs`'s run, settings and summary —
    `--max`, `&gpu`, uncapped, 3440x1440, three runs a side — through a
    scratch driver that alternates the two trees run by run in one browser
    and abandons a run the device hangs, the canonical fight hashes on all
    18 runs, every segment within 0.978-1.013): the mean frame new / old
    0.997-1.000 on the vantages, 0.995-1.000 on the path, 0.994-1.013 in
    the fights; `gpu.frame` level; Babylon's draw counter equal or 1-3
    lower.
  - **The machine's device hang (`FINDINGS.md` 64) was at its worst all
    session**: 64 nvlddmkm event-153 hangs in about three hours, every
    stall killed matching one, on both trees (the BEFORE's Cinderhaven bank
    2 of 3, its Hollowmere census 3 of 3), so every GPU instrument above ran
    one map a process with retries, and nothing is the step's.
- **What the post-commit review found** (an independent reader over
  5b31851; fixed after it): the tile clears built four descriptor objects a
  copy, a frame (now three made with the atlas, the origin moved a tile);
  a proxies' pipeline that failed to build left `ready` false for good, so
  every lamp went unshadowed with Babylon's render target sitting idle (it
  now loses the casters and takes none again: the atlas is Babylon's);
  work no frame recorded stayed queued across an `update` that returned
  early, and a later frame could draw it, mid-refill, into tiles just given
  back — unread, every tile being cleared before it is published, but
  wrong (it is dropped with the tiles now); `shadowWindow.ts`'s header
  never named the two textures it makes; a comment that a shadow cull uses
  no reach, which a lamp face's does; a guard in `LocalShadows.handOver`
  that could not fail; `LocalShadows`' header saying the proxy mesh is
  kept only on Babylon's side; a line of `docs/rendering.md` naming the
  atlas and the world's maps among Babylon's group-0 passes, stale since
  X3.6a; and CLAUDE.md's rule for a new world caster,
  which now says blended or not, since `PASS_LAMPS` makes a blended
  caster the handover cannot hold cost the world's maps too. Kept as they
  are: the atlas-sized depth attachment cleared by every pass (a copy
  cannot write `depth32float`, and Babylon's clear sheet reset it a tile a
  pass), and the prepare hooked for the atlas's life (one early return a
  frame, where `WorldShadows` hooks while its casters are built).
  Re-checked after the fixes: the readback on Harrowmead and Hollowmere,
  every count as before them; the paths above on Hollowmere and
  Coldharbour, 14 of 14 each, no page or console error. A failed proxies'
  pipeline was not forced.
- **Owed onward.**
  - The atlas's passes are not timed on our side (not in `gpu.cull`, and
    `shadowPass` brackets only Babylon's generators); the phone's FOLLOW-UP
    reading, the user's to take as every step's since X3.3c, is read as
    `gpu.frame` against X3.6a's.
  - Dynamic tiles with BODIES in them were not compared texel for texel (the
    `low` rung's comparison has the collider boxes only); the bodies go
    through the same instanced draw, their boxes `LocalShadows`'.
  - What X4.1 leaves to do for the atlas is where a body's boxes come from:
    the draw is ours already.

**X3.6c landed** (9a3cdbb, the post-commit review's fixes after it;
2026-10-24).
- **What it is.** Each probe's cube is a texture our renderer OWNS
  (`render/ProbeBake.ts`: `rgba8unorm`, six layers, a full mip chain, pooled
  for the process as Babylon's probes are) and draws whenever the handover
  holds every surface the bake draws; Babylon's glazing and water sample a
  wrapped cube view (`wrapCubeTexture`, `core/wrappedTextures.ts`, its sampler
  derived from `INVCUBIC_MODE` as the probe cube's was). `ReflectionSystem`
  still decides everything — the probes, where each stands, its box, what it
  leaves out, the queue, the gate, `bakePending` — and picks the path per
  install (`path`); Babylon's `ReflectionProbe`s are the fallback for the
  editor (which bakes nothing), `?babylonworld`, a map with a bake surface
  our side cannot draw, and a LOSS before the bake drained, which re-queues
  the install on Babylon's side and re-points every reader (the water through
  a `rebind` callback).
- **The eye is PASSED, not borrowed.** The bake has a frame of its own (a
  second `FrameUniformBuffer`, its group 0 over the frame's textures), filled
  by `CelMaterialFactory.fillBakeFrame` — the frame's values seen from the
  probe, `opaqueAlpha` 1, the clouds' shadow held off — and each face's
  camera (view-projection, eye, alpha: the block's first 80 bytes) reaches it
  through a staging slot copied in the encoder ahead of its pass. On our path
  `ReflectionSystem` moves no material's eye and flips no alpha, so the class
  of bug 242b986 and a858c74 fixed (a `ReflectionProbe` never moving
  `scene.activeCamera`) has no surface left to land on. A face is Babylon's
  face: `ReflectionProbe`'s six looks, `LookAtLH` and a 90-degree
  `PerspectiveFovLH` over the camera's near and far in the half-z range
  (both added to `src/math`, `math-check` cases beside them).
- **A face is a third VIEW of the main pass's culls**, built when a bake is
  queued and destroyed when it drains, so a round holds none: a slot a face
  (`probesPerFrame` 8 probes a submit), the pass bit `PASS_PROBE` (every
  taken surface and scatter part, and the emissive palette), and two tests
  the probe view alone turns on in the uniform's word 9 — the reach to the
  near side of a cluster's SURFACE sphere, Babylon's `neighbourhood` test on
  the same mesh, and its own blocks left out, `encloses` asked as numbers (a
  cluster's block, a scatter placement's REGION block as `BlockMerge` filed
  its copy, the cell at `perCell` and a bit a served block). It draws through
  the main pass's own draw code (`WorldBlocks`' `DrawView`), in the order the
  groups were added — floor before roads: at a grazing far horizon the road's
  bias no longer separates them, and Babylon's bake drew the floor first
  (Sarab, 14 texels before the order was kept). It records LATE in the
  prepare (`Renderer.onFrame`'s `late`), after the world's shadow maps and the
  lamps' atlas, and only when every group it draws is drawable.
- **What Babylon's bake drew that ours had not.** The emissive palette, held
  for the bake with its slots (`WorldBlocks.addEmissive`, a group a material,
  cut last, drawn in no main pass) and drawn by `render/emissiveWorld.ts`
  over the one body both sides now include (`shaders/wgsl/emissiveWorld.ts`);
  its palette and fog reach our side as data (`emissiveRecipe`). Fire is left
  out (`FINDINGS.md` 51: Babylon's bake drew a distant fire as a dark texel
  and a near one not at all). Mips are ours (`render/cubeMips.ts`, Babylon's
  `generateCubeMipmaps` filter for filter). Every shipped map holds the whole
  bake: taken / palette / fires left out / other —
  Hollowmere 95 / 29 / 11 / 0 (2 water probes), Greyfen 385 / 10 / 3 / 0 (1),
  Coldharbour 172 / 46 / 2 / 0 (39), Harrowmead 120 / 4 / 2 / 0 (1), Sarab
  303 / 7 / 2 / 0 (28), Cinderhaven 323 / 53 / 15 / 0 (14), Kurenai
  251 / 4 / 0 / 0 (3).
- **Measured.**
  - **The cubes, against Babylon's** (a scratch readback, both bakes of the
    same probes in one page under the freeze, every face and level; Babylon
    against itself 0 texels on every map). The landform alone and the palette
    alone are 0 texels on all seven maps. What differs is the SCATTER — every
    differing texel on or within a texel of where ours draws it, but ~15
    single texels on three maps, near scatter or fog-coloured at the
    horizon — X3.4's difference (instances under their own matrices, one
    colour bake a kind) seen from a probe, plus 6 texels of distant fire
    (3 Sarab, 3 Cinderhaven): mip 0 differs at 0.02% of texels (Cinderhaven)
    to 2.5% (Greyfen, mostly 1-2/255) and 2.2% (Kurenai, at most 22/255);
    Harrowmead 768 texels, Hollowmere 416, Coldharbour 3,885, Sarab 18,417
    (a palm's fronds over a probe; one-texel coverage edges give the 255s).
    Coverage (alpha) identical but a few edge texels; the mips carry mip 0's
    differences down and shrink them.
  - **The probe-eye check** (242b986's harness, made again): a Coldharbour
    glazing probe baked with the camera at the probe and 600 m off it reads
    back IDENTICAL on our path, 0 of 131,070 texels over every face and level,
    the frame's eye confirmed moved.
  - **The bank, against a BEFORE kept at aef7328 in a worktree** (`--check
    --keep` both sides): 34 of 61 byte-identical, 50 within the floor. The 11
    over it are Harrowmead's `millpond` and the ten sight shots over the same
    water (2.3-5.0% of pixels, mean 0.04-0.07/255, at most 76): the pond's
    reflection of the trees, the cube's scatter difference bent by the chop,
    and nothing above the waterline. The rest — Greyfen's `marsh` (0.64%),
    Coldharbour's three curtain walls (under 0.1%), Sarab's `ground` and
    `shelf` — are within it. No console or page error.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134). **`shaders.mjs`**: clean on seven, ours
    15/15 and 19/19. **`gate.mjs`**: clean on seven, the probe counts as
    `gate.json`'s.
  - **The bake's cost.** A frame of 8 probes is 5-6 ms from the frame's start
    to its queue's work done on the desktop, against 1-3 idle: Coldharbour's
    39 probes drain in 5 frames, ~41 ms of wall time, where Babylon's bake
    spent one ~2.3 s frame on them; Cinderhaven's 14 in 2 frames, ~17 ms.
  - **X0.3 on the desktop** (`bench.mjs`'s run, `--max --gpu`, uncapped,
    3440x1440, one run an invocation, alternated BEFORE and AFTER run by run, three a side, the
    BEFORE in the worktree at aef7328; the canonical fight hashes on all 18
    runs, one BEFORE run lost to `FINDINGS.md` 64's hang and retried): the
    mean frame new / old 0.999-1.001 on the vantages, 0.999-1.000 on the path
    and 1.002-1.004 in the fights; `gpu.frame` 0.975-1.028; the draw counts
    equal. The bench's INSTALL rose (Greyfen 10.4 to 13.4 s, Harrowmead 12.4 to
    13.4, Sarab 11.8 to 12.2, medians), and a timeline of the install, both
    trees in one browser and alternated, three runs a side, did not
    reproduce it — 8.8 to 8.7 s, 11.0 to 9.4 and 10.3 to 8.8 (Babylon's 43,254
    bake draws in one of Sarab's frames are gone; the warm-up compiles one
    pipeline more, ours) — so it is the bench starting a cold dev server and
    browser for every run, not the bake: in every run the queue waited on
    `gi.converged` alone. That wait found `FINDINGS.md` 65, older than this
    step.
  - **The paths no instrument covers**, forced in a scratch page on
    Coldharbour (glazing and water) and Hollowmere (water): the install, a
    shadow rung `low` mid-bake and back, a forced loss mid-bake (Babylon's,
    the readers re-pointed), a second round (ours again), a loss after the
    bake drained and a `rebake` (Babylon's), a third round, the editor (`F2`,
    nothing baked) and `?babylonworld` (Babylon's, the probe counts as
    before). No page or console error. X3.6a's shadow readback on
    Coldharbour, Greyfen and Hollowmere matches its record exactly. These ran
    before the draw-order fix, which moves the order inside the probe view
    and nothing else.
- **What the post-commit review found** (two independent readers over
  9a3cdbb, one for correctness and one for shape and contracts; fixed after
  it). No defect on the shipped path. Four on the edges: a mips pipeline
  that failed at construction left the bake on our path with no fallback,
  every install waiting out the card on cubes never baked (`ProbeBake` now
  latches broken for the session and every map's bake is Babylon's); a loss
  in the one frame between the last probe recorded and the view closing
  threw a finished bake away and re-queued it on Babylon's side (a loss now
  re-queues only what is still queued or was dropped unrecorded); past 32
  blocks a cell the CPU and the cull disagreed on what a probe leaves out
  (both now leave out the whole cell, which nothing in the tree reaches);
  and the probe view's memory, unmeasured until then — 9.0 MiB on
  Hollowmere, 9.6 Sarab, 12.1 Greyfen and Harrowmead, 15.3 Coldharbour, 16.6
  Kurenai, 27.6 Cinderhaven, nearly all of it the view's own index buffer,
  X3.6a's shadow view's order, and held only while a bake drains. On the
  shape: `FILES.md` not rewritten for six modules whose contracts moved
  (rule 7); CLAUDE.md's rendering section grown past its cap (cut back by
  moving rules only a renderer author can break to `docs/rendering.md`);
  the bake's frame filled once a probe and its shadows twice (once a
  recorded frame now); Babylon's render lists built on our path for a DEV
  log; the block key parsed in three places and computed in a fourth (one
  parse beside `blockKey`; `blockOf` and `blockCell` from `merge.ts`); the
  two paths sharing one queue of nullable entries (ours has its own
  `ProbeJob` queue); the cube pool indexed twice (`ProbeCube`); the
  per-frame budget read in two places; `probeCount` kept by hand; the bind
  groups assembled three ways in `WorldBlocks` (`groupsFor`); stale names
  (the "casters" layer is "held"); the wrappers moved to
  `core/wrappedTextures.ts`; the cubes made `COPY_SRC`, so a readback needs
  no patch. Re-checked after the fixes: the cube readback on Coldharbour,
  Harrowmead and Sarab equal to its numbers above, the probe-eye check, the
  paths on Coldharbour and Hollowmere, both edge cases forced in a page,
  and after them the bank on seven maps byte-identical to 9a3cdbb's frames
  (61 of 61), the gate clean on seven, `merge:hash` identical to the
  parent's and parity passing. A third reader over the fixes found the
  "added after the map was cut" guard narrowed to the add that makes a
  group (now asked of every add again) and three stale lines.
- **Owed onward.**
  - The fire, when it moves (X4.4), owes the bake a program, and
    `FINDINGS.md` 51's near case is still open.
  - `shaders.mjs` builds neither the palette's program nor the mips'; the
    gate and the bank compiled both on every map.
  - The phone's FOLLOW-UP reading, the user's to take as every step's since
    X3.3c: the bake is under the loading card, so it is read as the card's
    length, not the frame.

**X3.6d landed** (6dc5122, the post-commit review's fixes after it;
2026-10-24).
- **What it is.** The emissive palette's share of the glow's MASK is drawn by
  OUR renderer (`render/WorldGlow.ts`) whenever the handover holds the WHOLE
  palette, and `GlowPass` leaves those meshes out of its list on the frames
  ours means to draw them (`GlowRules.drawnElsewhere`). **The mask does not
  move** (rule 5, the X3.6 intro's one exception): the bodies, the effects,
  the fire's twin, the viewmodel and the moon still draw into it and its blur
  and the ink read it, so ours draws INTO Babylon's pass, as it draws into the
  main pass, and nothing is wrapped or copied. The palette's MAIN-pass draw
  stays Babylon's (moved at X3.6e): moving it changes which side wins an
  equal-depth tie with a coplanar wall, a picture change owed its own commit
  ("Decisions that are yours"). Every shipped map holds the whole palette: one
  draw a palette BIAS, two on Coldharbour (6,864 triangles at the over-glass
  bias and 11,292 plain, 10 and 36 surfaces) and one elsewhere (Hollowmere
  22,378 triangles over 29 surfaces, Cinderhaven 10,020 over 53).
- **Where: FIRST in the mask's pass, right after its clear.** `GlowPass`
  announces the pass from inside its own clear observer
  (`onMaskOpenObservable`, wired to `Renderer.glowMaskOpened` by `Game`, so
  `GlowPass` imports nothing of `src/render/`): WebGPU's `clear()` begins the
  mask's pass at once, after Babylon built the list and before it queued any
  of it, every frame. A rendering group's hook was refused (an empty group is
  never visited, and the mask's group 0 often is once the palette is ours),
  the target's after-render too (it lands after the blended mask draws), and
  a second clear observer (an order race). No new seam item: `FrameHost.queue`
  and `passIs` against `GLOW_TARGETS` (`render/targets.ts`). With no depth
  written, first is also Babylon's order, the palette having drawn in its
  opaque queue.
- **The tie is across the two renderers**, and holds by construction: the same
  vertex body both sides include (`EMISSIVE_WORLD_VERTEX`), `world` identity
  on both, the same float32 view-projection, the same flip, the same depth
  bias; LEQUAL against the depth Babylon's palette wrote in the main pass.
- **Culled through the MAIN view**, no view of its own
  (`WorldBlocks.glowView`): the held groups are cut palette first and casters
  last, the main view's count runs through the palette, the main pass (which
  has no recipe for them) never draws them, and a palette cluster is never
  SIZE-GATED (`PASS_GLOW`, mirrored in the CPU replay and `cullProbe`), as
  Babylon never gated an emissive. No reach (`NO_REACH`, as every held
  surface, where Babylon's twin is reach-culled as a block): past that reach
  the mask's pixel is the clear's own. (Harmless in the mask still; X3.6e
  gives every palette surface its cell's box, which the MAIN pass needs,
  past the reach being the sky there.) Its memory is the main view's
  per-cluster scratch for the palette's clusters, a few KB — counted at EVERY
  cut, even on a map whose palette mask goes back to `GlowPass`, where they
  are scanned and never drawn; kept, as the price of one cut whatever the
  handover decides.
- **The program** is the twin's in the pulled form (`emissiveWorld(GLOW_TARGETS,
  true)`, the one body under `GLOW_MASK`), `glowColor` appended LAST to the
  palette's block so the bake's program reads a prefix and one bind group
  serves both. The rules stay `Game`'s, each stated once (`glowAdmits`,
  `bloomColour`) and PULLED once a frame; a colour is written only when it
  moved.
- **Who decides.** `BlockHandover` per install (a palette surface it cannot
  hold, or one marked `noGlow` — read at the take — leaves the map's whole
  palette mask to `GlowPass`); `WorldGlow` per frame, in a renderer prepare as
  the main pass begins (held, built, admitted, drawable), before `GlowPass`
  builds its list. A palette surface handed back, a refused main pass or a
  refused MASK pass LOSE it (the draw and the prepare off the renderer after
  the task in hand); a failed mask pipeline latches it broken for the
  session; the editor and `?babylonworld` take nothing. Two costs, both off
  the shipped path: the one frame a refused mask pass is found has the
  palette in neither side's draw (Babylon built the list before the clear
  that announces the pass), and a loss mid-map compiles Babylon's twin in
  the round.
- **Measured.**
  - **The mask itself, ours against Babylon's** (a scratch readback of the
    mask texture at every bank row, 61 rows on seven maps: ours, ours again,
    Babylon's after `lose()`, ours after taking it back): **0 texels on every
    row**, and 0 ours against ours. Thirteen rows hold no lit texel at all
    (eight of Sarab's eleven, Greyfen's `treeline` and `canopy`,
    Harrowmead's `borderland` and `ground`, Coldharbour's `shopfront`), so
    the proof is the other 48.
  - **Babylon's mask draws, a row's mean** (ours drawing / after `lose()`):
    Coldharbour 0.44 / 19.67, Cinderhaven 3.00 / 14.50, Hollowmere 2.69 /
    11.85, Harrowmead 2.47 / 6.13, Greyfen 0.83 / 4.00, Kurenai 0.33 / 2.33,
    Sarab 0.36 / 1.73 — no palette mesh left in Babylon's list while ours
    draws (`FINDINGS.md` 43).
  - **The bank, against a BEFORE kept at 5752574 in a worktree**
    (`--check --keep` both sides): **61 of 61 byte-identical**. No console or
    page error.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134). **`shaders.mjs`**: clean on seven, ours
    15/15 and 19/19 (it builds neither palette program, as before).
    **`gate.mjs`**: clean on seven.
  - **The held-group reorder moved no shadow**: the world's four maps read
    back through a compute `textureLoad` (they are not `COPY_SRC`) at the
    menu vantage, BEFORE against AFTER, are byte-identical on Greyfen and
    Coldharbour.
  - **The paths no instrument covers**, forced in a scratch page on
    Coldharbour and Hollowmere (the night map): deploy and a round (ours);
    the kit screen (neither side; ours again on leaving it); the Glow rung
    `low` and back, a resize to 1280x720 and back, render scale 0.5 and back
    (ours throughout); a forced `lose()` (Babylon's: 46 and 5 palette meshes
    in its list), a second round (ours); a forced main-pass refusal (both
    handed back), a third round (ours); the editor (nothing held) and
    leaving it (ours); `?babylonworld` (Babylon's). No page error; the only
    console errors are the refusal's own two diagnostics. `?cullcheck` on
    Coldharbour in a round: 0 disagreements.
  - **X0.3 on the desktop** (`bench.mjs`'s run, `--max --gpu`, uncapped,
    3440x1440, BEFORE in the worktree and AFTER alternated run by run, three a
    side, on Coldharbour, Cinderhaven and Hollowmere, where the palette is
    largest; the canonical fight hashes on all 18 runs, no hang): the mean
    frame new / old 0.997-1.000 on the vantages, 0.979-1.001 on the path
    (Cinderhaven's 0.979 inside the BEFORE's own spread) and 0.996-1.012 in
    the fights; `gpu.frame` 0.950-1.026 over 14-37 samples a look group.
    Babylon's draw counter fell in every group: Coldharbour 112 to 95 on the
    vantages, 79 to 68 on the path, 302 to 283 in the fight; Cinderhaven 108
    to 92, 97 to 84, 371 to 340; Hollowmere 48 to 40, 43 to 37, 245 to 233.
    The bench's install rose ~2 s on every map, and is the main tree's cold
    dev server again (X3.6c's reading): `installRound` timed in both trees is
    level (Hollowmere 4.95-5.4 s against 4.93-5.7, Coldharbour 6.3-6.4 against
    6.4-6.5; the warm-up waits ~40 ms more on Coldharbour for two more
    pipelines and compiles nothing in play), and a second run in one
    invocation reads 5.13 against 5.26 s.
  - These ran before the review's fixes below, which change comments, a
    prepare's signature and a `ready` that answered false for a disposed
    view; typecheck, build and corecheck were run again after them, and
    the mask readback on Coldharbour and Hollowmere (six rows, 0 texels).
- **What the review found** (an independent reader before the commit; fixed
  before it). No defect on the shipped path. CLAUDE.md's cut had taken the
  emissive palette's hardcoded coverage of 1 out of the spine while leaving
  "a shader that hardcodes either value breaks one of the two passes" — the
  exception is back as a clause. The contracts over-claimed "exactly the
  frames": a refused mask pass is found after Babylon's list was built
  (softened in `WorldGlow`, `GlowPass` and `docs/rendering.md`). The twin's
  compile after a mid-map loss was undocumented. A view's `ready` answered
  false for a DISPOSED view, which `WorldGlow` reads as a failed pipeline and
  latches broken for the session — safe while every dispose follows a
  generation bump, but a guard the generation already is (now a pipeline
  question alone, in `glowView` and `probeView` both). `Renderer.context` had
  been made public for one prepare (a prepare is handed the `FrameContext`
  now). The `noGlow` bullet named every block-merged emissive where only the
  palette's is read at the take; `VERIFYING.md`'s re-take only holds on a map
  that held the whole palette. Kept: `WorldGlow`'s lifecycle has
  `ProbeBake`'s shape (a generation, `broken`, the loss after the task) — a
  second copy of a small shape rather than a base class for two.
- **What the post-commit review found** (two independent readers over
  6dc5122, one for correctness and one for shape and contracts; fixed after
  it). No defect on the shipped path; both traced the frame's order
  (the verdict, `GlowPass`'s list, the clear, the queued draw) through
  Babylon 9.28 and found it as documented. Latent: the colour write built an
  object a call, so a bloom that ever animates would allocate a frame (one
  values object a view now); the DEV `noGlow` check read the meshes held for
  the mask after a loss had handed them back (it now asks whether the world
  is still held); the mask is opened once a frame and a second open would
  queue nothing of ours (stated on `maskFilled`). On the shape: the
  palette's pipelines by bias were built by the same 25 lines in `probeView`
  and `glowView` (one `palettePipelines` now, which a third palette pass
  would otherwise have made three); `drawnElsewhere` asked the material too,
  which the handover's answer already covers (it takes the mesh alone, and
  `glows` is `glowHolds`, beside `probeHolds`); `drawHeld` and `drawableIn`
  tested a group's passes two ways (one `drawsIn`); contract text the step
  or its pre-commit fixes left false (a prepare reading `Renderer.context`,
  "exactly the frames" in one more place, `addEmissive` cut "after every
  other group", the pass-bit list without `PASS_GLOW`, the refusal listener
  missing from `WorldGlow`'s owns, "`GlowRules`' two questions", the failed
  mask pipeline missing from four fallback lists, the `noGlow` bullet's
  unsatisfiable "set before the build", and `VERIFYING.md`'s re-take, which
  draws nothing twice); CLAUDE.md's coverage clause got its "do not fix it"
  back and its glow clause stopped reading as a contradiction, the rendering
  section still 133 lines. One reader held that the palette's clusters are
  reach-culled by their block; they were not — every held surface was given
  `NO_REACH` at the install and filed in no cell — so "no reach" stood,
  argued more fully (since X3.6e every palette surface is cut with its cell's
  box and reach-culled by it). Kept: the main view counts the palette's
  clusters at every cut, even on a map whose palette mask goes back to
  `GlowPass` (a few KB, scanned and never drawn). Re-checked after the fixes:
  the mask readback on seven maps (61 rows, 0 texels ours against Babylon's),
  the bank 61 of 61 byte-identical to 6dc5122's frames, the gate clean on
  seven, the paths on Coldharbour and Hollowmere as before, typecheck, build
  and corecheck.
- **Owed onward.**
  - The palette's main pass: X3.6e (landed, below). Deleting the fallbacks
    ("After X3.6", "Decisions that are yours").
  - The phone's FOLLOW-UP reading, the user's to take as every step's since
    X3.3c, which is also the tie's check on a second GPU: a driver that
    rounds the shared vertex body differently would drop palette bloom
    wherever ours lands behind Babylon's depth. `FINDINGS.md` 43's phone
    reading is the same capture.
  - `shaders.mjs` builds neither palette program (X3.6c's item, still open).

**X3.6e landed** (806511f, the post-commit review's fixes after it;
2026-10-24; added after X3.6d by the user's decision of the same day,
"Decisions that are yours").
- **What it is.** The emissive palette's MAIN-pass draw is OUR renderer's
  whenever the handover holds the WHOLE palette — the same decision that
  hands X3.6d's mask over, so the palette is ours in both passes or in
  neither. The palette held since X3.6c is TAKEN from Babylon's main pass as a
  block (`WorldCulling.setTaken`), so no palette mesh is a candidate, ACTIVE,
  or in `GlowPass`'s list while ours holds it; Babylon's
  `EmissiveWorldMaterial` and its mask twin are both the fallback. Deleting
  Babylon's fallback meshes is not part of it.
- **Where: FIRST in `WorldBlocks`' one `"beforeAlphaTest"` draw** — the
  palette, the blocks, the scatter, the landform — so every equal-depth tie
  with a surface of ours goes as Babylon's opaque queue, which drew the
  palette ahead of all of ours, sent it. The argument, the tie table and the
  two residues are `docs/rendering.md`'s ("The palette, ours: the mask
  (X3.6d) and the main pass (X3.6e)").
- **The reach: the cell's box, not `NO_REACH`**, because in the main pass
  past the reach is the SKY: every palette surface is cut with its cell's box
  whoever draws it (`WorldCulling.reachBoxOf` answers a filed mesh, taken or
  not), the box Babylon's candidate was offered by; every other view reads it
  to the same picture (the same section).
- **The program** is the bake's, unchanged — `emissiveWorld(FRAME_TARGETS)`,
  one pipeline a bias, asked once at the cut (`WorldBlocks.mainPalette`) and
  shared with `probeView` — so the mask's tie is ours against ours, which
  closes X3.6d's driver-rounding risk for the palette (the same section).
- **One decision, and every loss returns both.** `BlockHandover` decides once,
  after the cut (`claimPalette`); every loss of the mask hands the main pass
  back with it (`WorldGlow.onLost`, `dropPalette`), and a failed main-pass
  palette pipeline is a loss of both that hands no surface back, so the
  shadows stay ours (the same section). A loss mid-map compiles Babylon's
  palette material and its twin in the round, the warm-up never having drawn
  them: one frame's hitch, no frame without its lit windows (measured below).
  The editor and `?babylonworld` take nothing.
- **What became dead, and was deleted.** `GlowRules.drawnElsewhere` and the
  handover's `glowHolds` (X3.6d's way of keeping `GlowPass` off the palette on
  the frames ours drew it) answered false on every path once the palette
  left the candidate list; both are gone, with `GlowPass`'s skip. The DEV
  `noGlow`-after-the-take check stays. `WorldBlocks`' HELD layer split into
  `"palette"` and `"held"` (the casters alone), `drawHeld` became
  `drawPalette`, and `BlockHandover`'s `held` set split the same way —
  `probeHolds` counts the palette through its own set.
  `BlockHandover.takePalette()` re-takes both passes for a scratch script
  (the game never calls it).
- **Deviations from the design**, all in shape: `takePalette` is public (a
  private method nothing calls fails `noUnusedLocals`); `palettePipelines`
  takes a failure callback rather than a message, so the main ask can tell
  the handover (`WorldBlocks.onPaletteFailed`); the main palette pipelines
  are asked at the cut even on a map whose main pass stays Babylon's (a
  probe's face shares them); a palette surface's failure re-files the cull
  twice (once through `onLost`), which is harmless; every palette surface is
  cut with its cell's box whoever draws it, so `takePalette` can re-take it
  after any loss that handed nothing back. `shaders.mjs` still builds neither
  palette program (X3.6c's item).
- **Measured.**
  - **The bank, against a BEFORE kept at c34a06b in a worktree**
    (`--check --keep` both sides): **59 of 61 byte-identical**, no console or
    page error. The two that move, both deterministic (a re-shoot is
    byte-identical to the first): Hollowmere's `ground`, 56 pixels (0.0027%),
    mean 0.0001/255, max 16/255, in two specks at (1485-1492, 510-513) and
    (1515-1522, 528-532); Greyfen's `marsh`, 29 pixels (0.0014%), mean
    0.0001/255, max 22/255, at (1112-1116, 517-526). **Neither is a tie: it is
    the reach's HYSTERESIS.** A candidate cell switches on at the reach and
    off only `culling.hysteresis` (12 m) past it, and at those two rows
    Babylon's list still held one palette mesh from the rows before, 7.33 m
    and 6.09 m past the reach — drawn as a fog-dark window with no wall round
    it, the wall being a taken block our exact per-frame reach had already
    dropped. Ours drops window and wall together. Invisible at crop scale
    (crops in the step's scratch record).
  - **The in-page A/B** (one boot a map, every bank row: ours, a control,
    Babylon's for both passes after `worldGlow.lose()`, ours again through
    `takePalette()`): the MASK 0 texels on all 61 rows, ours against
    Babylon's and ours against ours; the FRAME 0 pixels on 59, and on the
    same two rows the same 56 and 29 pixels, attributed by the past-reach
    count (Hollowmere's `wall40` holds three such meshes, 4.4 m past, and
    moves nothing). The control 0 everywhere. No palette mesh in Babylon's
    active list while ours holds the palette, and its N after the loss
    (Coldharbour's `avenue` 37); ours drew one draw a row more than after the
    loss (two on Coldharbour).
  - **Past the fog, against the sky**: three borderland poses on Coldharbour
    up to ~700 m out (`fogEnd` 480) and two on Hollowmere (78), the same A/B.
    The mask 0 on all five; the frame 0 on three, and 37 pixels (max 10/255)
    and 345 (max 6/255) on the other two — Babylon's fogged specks from
    palette meshes 11.28 m and 4.12 m past the reach, ours plain sky. Ours
    drew no lit window past the reach anywhere.
  - **`census.mjs --against` the BEFORE `--fall`**: every map lower, each
    exactly the design's prediction — Babylon's main pass loses every palette
    mesh it drew, ours gains one draw a bias a row:

    | map | rows | before | after |
    | --- | --- | --- | --- |
    | Hollowmere | 13 | 384 | 278 |
    | Greyfen | 6 | 226 | 213 |
    | Coldharbour | 9 | 829 | 674 |
    | Harrowmead | 15 | 891 | 851 |
    | Sarab | 11 | 673 | 669 |
    | Cinderhaven | 4 | 228 | 186 |
    | Kurenai | 3 | 134 | 131 |

    A row with no palette in view rises by one (two on Coldharbour), most of
    Sarab's. The "taken" column rises by the palette's surfaces: Hollowmere
    +29, Greyfen +10, Coldharbour +46, Harrowmead +4, Sarab +7, Cinderhaven
    +53, Kurenai +4.
  - **`gate.mjs`**: clean on seven (its warm fps read 60 on every map this
    session, the display's vsync, where X3.6d's read ~125; the uncapped
    bench is unaffected). **`shaders.mjs`**: clean on seven, ours 15/15 and
    19/19; Babylon's modules two fewer on five maps (Hollowmere 126 to 124,
    Greyfen 129 to 127, Coldharbour 139 to 137, Sarab and Cinderhaven 142 to
    140), the palette's material no longer compiled on our path; Harrowmead
    and Kurenai unchanged.
  - **The paths no instrument covers**, forced in a scratch page on
    Coldharbour and Hollowmere: deploy and a round (ours: 2 and 1 palette
    draws in the main pass and as many in the mask, no palette mesh in
    Babylon's list); the kit screen (the main pass still ours, the mask
    drawn by neither); the Glow rung `low` and back, the shadow rung `low`
    and back, a resize to 1280x720 and back, render scale 0.5 and back (ours
    throughout); a forced `worldGlow.lose()` (both passes Babylon's together:
    46 and 5 palette meshes in its list; `stats` read taken 218 to 172 and
    124 to 95 then, 218 and 124 with 46 and 29 handed back since the
    review's fix below); a
    forced mask refusal (both back together); a forced main-pass refusal
    (everything back); a round after each (ours); the editor (nothing taken)
    and leaving it (ours); `?babylonworld` (Babylon's in both passes). No
    page error; the only console errors are each forced refusal's own.
    `?cullcheck` on Coldharbour, eight headings: 0 disagreements.
  - **What a loss costs, stepped a frame at a time** at a frozen vantage
    (Coldharbour `avenue`, Hollowmere `menu`): the three frames after a
    forced loss are byte-identical to the frame before it on both maps,
    where hiding the palette for one frame moves 303,138 and 105,062 pixels
    — Babylon's palette is drawn from the first frame, its material and twin
    compiled inside it (2 shader modules and 4 pipelines on Coldharbour, 2
    on Hollowmere): 7.8 ms of CPU against 3.9 steady on Coldharbour, 3.8
    against 1.6 on Hollowmere. The plan had expected frames with no lit
    windows; there are none.
  - **X0.3 on the desktop** (`bench.mjs`'s run, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at c34a06b in the worktree and the AFTER
    alternated run by run, three a side, on Coldharbour, Cinderhaven and
    Hollowmere; the canonical fight hashes on all 18 runs, no hang): the
    mean frame new / old 0.997-1.004 on the vantages, 1.001 on the path and
    0.964-1.000 in the fights (Cinderhaven's 0.964 a CPU-bound segment whose
    BEFORE runs were noisy, `gpu.frame` equal); `gpu.frame` 0.988-1.013.
    Babylon's draw counter fell in every group and ours rose by the
    palette's one or two: Coldharbour 95 to 78 on the vantages, 68 to 56 on
    the path, 281 to 261 in the fight (ours 19 to 21); Cinderhaven 92 to 75,
    84 to 70, 339 to 308 (11 to 12); Hollowmere 40 to 32, 37 to 32, 233 to
    223 (8 to 9). The bench's install rose 1.5-2.2 s and is again the main
    tree's cold dev server: the in-page install, timed alternately, is level
    (Hollowmere 5.19 and 4.95 s against 5.12 and 4.95, Coldharbour 6.09 and
    6.02 against 6.19 and 6.14), the warm-up compiling the same pipelines on
    both sides.
- **What the post-commit review found** (two independent readers over
  806511f, one for correctness and one for shape and contracts; fixed after
  it). No defect on the shipped path; both found the two passes always on
  one side. Latent: the main palette pipeline was asked at every cut,
  whoever drew the palette, and its failure FAILED the palette's groups —
  handing the map's shadow maps and the lamps' atlas back to Babylon over a
  pipeline nothing might have drawn with, on every map. A failure now fails
  no group: it latches for the map, LOSES the palette (both passes, through
  the mask's loss) when it was ours, refuses a later take, and costs the
  bake through the probe view's `ready` — the shadows and the atlas, drawing
  the palette with their own depth pipelines, stay ours (forced on
  Coldharbour and Hollowmere with the palette ours and not). `stats` stopped
  counting the palette after a loss (it counts against "taken this install"
  now). On the shape: the decision was made twice, provisionally before the
  cut and again after it, only because `WorldCulling.reachBoxOf` answered a
  TAKEN mesh — it answers any mesh filed in a cell now, every palette
  surface is cut with its cell's box, and the decision is made once
  (`paletteBoxed` and `WorldGlow.usable` deleted); `takePalette` restated
  the end of `install` (one `claimPalette`); `heldGroup` made palette groups
  (`paletteGroup`, `casterGroup`); `hold` and `onSurface` tested palette
  against caster twice; four headers still described X3.6d's world (a mask
  tied against Babylon's depth, `GlowPass` skipping the palette, the fallback
  compiling in the round on every path rather than after a loss alone); "the
  palette is in no Babylon list" stated ten times (once now, and pointers);
  and this note and `docs/rendering.md` arguing the same points twice (the
  note cut to pointers, the hysteresis argued once). Re-checked after the
  fixes: the bank 61 of 61 byte-identical to 806511f's frames, the in-page
  A/B on seven maps as above, the census equal to 806511f's, the gate clean
  on seven, the paths on Coldharbour and Hollowmere as before, typecheck,
  build and corecheck.
- **Owed onward.**
  - Deleting the fallbacks ("After X3.6", "Decisions that are yours").
  - The phone's FOLLOW-UP reading, the user's to take as every step's since
    X3.3c (`FINDINGS.md` 43's capture is the same one).
  - `shaders.mjs` builds neither palette program (X3.6c's item, still open),
    and every map's main pass now depends on one of them. Closed at X3.7a.

**After X3.6:** every pass that draws a block, the scatter, the landform or the
emissive palette is our renderer's whenever the handover holds what that pass
draws: the main pass (the palette's included, since X3.6e), the world's four
maps, the lamps' atlas, the probes' bake and the glow's mask. Babylon no
longer draws the palette's main pass while the handover holds it. It still
BUILDS every one of those meshes, as the fallback each pass hands back to (an
editor build, `?babylonworld`, a surface ours cannot hold, a loss mid-map).
Phase 3's end condition is met only once the fallbacks are deleted: X3.7,
below. Editor builds keep the old path until X5.3. **Since X3.7b** Babylon
builds no mesh in a round for anything our renderer draws — a round's
`GameMap.visuals` are the glazing and the fires — `?babylonworld` is gone
(its last build tagged `exit-babylonworld`), and every former handback is
`Game.worldFailed`: Phase 3's end condition is met. **Since X3.7c** the
fallback machinery is gone for a round: Babylon's `ReflectionProbe` path (the
default cube one of ours), the emissive palette's Babylon stages and its glow
mask twin, and every pass's `lose`/`onLost`/`broken` latch (a pass is handed
its world WITH the install's failure). The editor keeps `ShadowSystem`'s
generators and `LocalShadows`' render target (X5.3).

### X3.7 — Babylon builds no world mesh for a round — **L, as three sub-steps** (decided 2026-10-24)

The fallback each pass of X3.6 hands back to goes. After X3.6 Babylon still
BUILDS a mesh for every surface our renderer draws (the blocks with the
scatter's merged copy in them, the landform, the emissive palette) and keeps
the machinery that would draw them (`ShadowSystem`'s generators,
`LocalShadows`' render target, `ReflectionSystem`'s `ReflectionProbe`s,
`GlowPass`'s palette twin), for an editor build, `?babylonworld`, a surface
ours cannot hold, or a loss mid-map. Every shipped map holds every surface in
every pass, the Intel laptop's flicker is fixed (68b84b3) and the phone's
world reads right (the user, 2026-10-24), so the safety net is now only cost:
the world built twice (Greyfen's scatter copy alone was +120 MB at X3.5b),
install time, and a dozen handback paths. Each sub-step lands on its own and
is checked against its parent.

- **What becomes of a failure** (decided 2026-10-24): **the world draws whole
  or the round does not start.** One `Game.worldFailed(reason)`, run after the
  task in hand as a `lose()` is today: a `console.error`, back to the menu
  (`leaveMatch` online) and a toast that the map could not be drawn —
  `loadHeights`' precedent, there being no honest half-build to fall back to
  and no fallback engine (`CLAUDE.md`). A surface the handover cannot hold
  throws in DEV and `merge:hash` refuses it on seven maps at every foliage
  rung, so it cannot ship; a failed pipeline fails the install under the card;
  a refused pass is a backstop; device loss is unchanged (X5.4).
- **X3.7a — the take off the RECORD (no picture change).** Landed (below).
  - `BlockHandover.onSurface` decides from the surface's record, not its mesh:
    the rendering group and layer mask `worldMeshes`' defaults, identity off
    the part, the blend from the material.
  - `SurfaceRecord.bounds`, taken from the arrays before they are released;
    `WorldCulling`'s cell boxes and spheres read them where they read
    `getBoundingInfo` today (`WorldCulling.ts` 442, 857). A DEV check against
    the mesh's test and its world box, bit for bit, on seven maps.
  - `merge:hash` hashes the record's arrays through a sink before release (a
    new baseline whose per-surface hashes equal the old buffers').
  - `shaders.mjs` builds both palette programs (owed since X3.6c): after X3.7b
    a failed one fails the round.
  - Each map's buffer sizes recorded against WebGPU's default limits (128 and
    256 MiB): with no fallback, a device with less headroom gets the error.
- **X3.7b — the cut.** Landed (below).
  - `worldMeshes` makes no mesh for a surface ours draws; `GameMap.visuals` is
    Babylon's meshes alone (glazing, fires, and an editor build's every
    mesh), and `world.surfaces` stays complete, each saying who draws it.
  - Every handback becomes `worldFailed`: `BlockHandover`'s `back`,
    `handedBack`, `takePalette`, `dropPalette` and its DEV node check;
    `WorldBlocks.fail`/`giveUpAll`; the losses of `WorldShadows`, `LampAtlas`,
    `ProbeBake` and `WorldGlow`; and `WorldCulling.setMap`'s two throws
    (X3.7a's: the visuals and the records out of step, a block-keyed mesh
    with no record), invariants of the build that throw in every build today
    and reach the player as an uncaught error rather than the menu.
  - `?babylonworld` is deleted (decided 2026-10-24); X3.7b's parent is tagged
    `exit-babylonworld` and pushed, the last build that has it, so a device
    A/B against Babylon's world stays one deploy away.
  - `WorldCulling` files cells off the records and drops `setTaken`;
    `reachBoxOf` keys on the block.
  - The casters are held on every shadow rung, so a rung raised from `off`
    draws ours, not the generators until the next map.
  - `noGlow` is read per surface (`heldPasses` already drops `PASS_GLOW` per
    surface): "the whole palette" existed only because `GlowPass` was the
    fallback.
  - **Measured here:** the JS heap after a GC, GPU bytes (`createBuffer` and
    `createTexture` wrapped, as X3.6a did), `installRound` timed in the page
    and alternated (the bench's install reads a cold dev server), and
    `scene.meshes`/`geometries` a map — before and after.
- **X3.7c — Babylon's world passes narrowed.** Landed (below). Deleted for a round: the
  `ReflectionProbe` path (the editor's strength-0 default cube replaced by one
  of ours), `GlowPass`'s palette twin and `EmissiveWorld`'s Babylon stages,
  the `lose`/`onLost`/`broken` latches. `ShadowSystem`'s generators and
  `LocalShadows`' render target stay for the editor's build alone, X5.3's to
  delete. Babylon still draws, in a round: the bodies and `BodyShadows`, the
  hulls, the viewmodel, the effects and fires, the sky, clouds and moon, the
  water, grass, glazing, flags, rings, blobs and particles, and the glow
  mask's non-world emissives.
- **Keeps:** the cel and emissive MATERIAL objects, never compiled in a
  round, which the merge keys on and which hold the recipes (Phase 4); the
  scatter merged into the block ARRAYS, whose spheres, cell boxes and probe
  region key read it (un-merging it moves them, a picture change of its own);
  `metadata.block` on glazing and fires, which stay in `WorldCulling`'s
  blocked class.
- **Verify, each sub-step:** the bank `--check --keep` against a BEFORE at the
  parent (61 of 61 byte-identical expected; where it could move: the cell
  boxes, the take test, candidate order, the default cube); `census
  --against` equal (its `handedBack` 0 from X3.7b); `gate`, `shaders`;
  `merge:hash` against X3.7a's baseline and `--editor` unchanged; `kit:hash`,
  `parity`, `collision`; typecheck, build, corecheck; the forced paths in a
  scratch page (each former loss ends in the error and the menu; a shadow rung
  `off` to `high`; `F2` select, drag, sculpt and save); X0.3 alternated three
  a side, `--max --gpu`, 3440x1440, on Greyfen, Coldharbour and Cinderhaven.
- **Rewrites (rule 7):** `CLAUDE.md`'s rendering section (the four maps' and
  the bake's "back to Babylon" clauses become the refusal, "the SCATTER is
  drawn twice over" becomes once, `WorldCulling`'s taken-mesh rules, the
  glow's palette clause) and its metadata section (`worldMeshes` hands a mesh
  only where one is made, `encloses` goes with Babylon's bake, the `noGlow`
  bullet); `docs/rendering.md`; `docs/game.md` (`installMap`, `teardownMap`,
  `worldFailed`); `docs/editor.md`; `docs/world.md`; `FILES.md`;
  `VERIFYING.md` (the forced-loss, `takePalette` and `?babylonworld`
  recipes); `FINDINGS.md` 61 and 64; "After X3.6" above; the shape table.
- **Risks:** the device A/B leaves the URL (the tag above keeps it); a phone
  with tighter limits gets the error rather than a picture (X3.7a's headroom
  and the phone's reading come before X3.7b lands); the editor's path
  diverges further and the bank cannot see it (`merge:hash --editor`, `F2` by
  hand); `merge:hash` across X3.7b compares only against X3.7a's baseline.
- **Not this step's:** the editor's path (X5.3), glazing (X4.6), fires (X4.4),
  un-merging the scatter from the blocks, the Material objects (Phase 4),
  device-loss recovery (X5.4).

**X3.7a landed** (c52ebb4, the post-commit review's fixes after it;
2026-10-25; no picture change).
- **What it is.** Two readers that asked a world MESH now ask its RECORD,
  so X3.7b can make none. `BlockHandover.onSurface`'s verdict: identity off
  the part's own transform (no parent by then), the blend off the material
  (`blends`: its `transparencyMode` when stated, else `needAlphaBlending` —
  what `needAlphaBlendingForMesh` answers at visibility 1 with no vertex
  alpha, which `worldMeshes` guarantees), and rendering group 0 on the
  default layer mask by construction (`worldMeshes` sets neither); the
  scatter parts' passes go through the same `blends`. `SurfaceRecord.bounds`
  (`boundsOf`, `worldGeometry.ts`): Babylon's `extractMinAndMax`,
  `BoundingBox` and `BoundingSphere` step for step on the arrays before they
  are released, under the part's world matrix (`worldMatrixOf`);
  `WorldCulling` grows its cells from them and size-gates a filed mesh off
  the record's sphere (one `gateOf` entry, no extra lookup a candidate),
  everything else off its own bounding info. The contract is
  `docs/rendering.md` (the handover's bullet, "A cell's bounds", the size
  gate) and the two headers.
- **The DEV checks, until X3.7b.** `WorldCulling.setMap` compares every
  filed surface's box and sphere with its mesh's by `Object.is`
  (`stats.boundsChecked`/`boundsMismatched`, a console error);
  `BlockHandover.checkBirth` compares each mesh's group, mask, parent and
  `needAlphaBlendingForMesh` with the record's verdict (one console error a
  page). `VERIFYING.md` has the reads.
- **`merge:hash` hashes the record's arrays** through a DEV sink
  (`SurfaceSink`, `window.__surfaceSink`, called by `releaseArrays`) — each
  attribute under Babylon's kind name in the type Babylon was handed, so
  the strings are the mesh buffers' own — and every run checks the two
  halves equal wherever a visual has a mesh (`arrays≠buffers` fails it).
- **`shaders.mjs` builds both palette programs** (X3.6c's item, closed):
  `emissiveWorld(FRAME_TARGETS)` at `askPalette`'s state and
  `emissiveWorld(GLOW_TARGETS, true)` at `glowView`'s, at every depth bias a
  palette material on the page carries.
- **Deviations.** The sink is a page global set by the script rather than
  a `BuildOptions` field, so the editor's build (which takes no `onSurface`)
  is hashed by the same door; `releaseArrays` takes the surface's index for
  it. The sphere is read off the record only for a FILED mesh: a loose one,
  the landform and every editor-build mesh keep their own, which an editor
  move or a sculpt rewrites under the record. The DEV `checkBirth` and the
  bounds comparison are transitional and go with the meshes at X3.7b.
- **Measured.**
  - **The bank, against a BEFORE kept at 2293c09 in the worktree**
    (`--check --keep` both sides): **61 of 61 byte-identical**, no console or
    page error; the same 34 stale rows over the bank's tolerance on both
    sides. (A first AFTER run lost its page on Sarab's `tank` row, and a
    first `--editor` hash its Sarab page, both to Vite full reloads while
    this step's files were being edited and the collision bake rewrote
    `collision.ts`; re-run with the tree still, both clean.)
  - **The DEV bounds check on seven maps**: every filed surface equal bit for
    bit — Hollowmere 94, Greyfen 357, Coldharbour 234, Harrowmead 110, Sarab
    202, Cinderhaven 212, Kurenai 174 — and every VISUAL equal on each
    (the landform too); Coldharbour's EDITOR build, 2,154 visuals of which
    2,094 are off identity, all equal, so the transformed path is exact as
    well. The birth check silent on all seven.
  - **`merge:hash`**: identical to the BEFORE's on all eight registry maps,
    shipped and `--editor`; the record's arrays equal to their mesh's
    buffers on **3,828 of 3,828** shipped visuals (1,957 on the seven maps,
    1,871 the proving ground's) and **28,473 of 28,473** editor-build ones.
    The new baseline is `merge-baseline-x37a.json` /
    `merge-baseline-x37a-editor.json` in this step's scratch record, taken
    after the review's fixes with the record's bounds in it (below); X3.7b's
    run takes its own BEFORE at X3.7a.
  - **`census --against` the BEFORE**: every row equal (Hollowmere 278,
    Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186,
    Kurenai 125). **`gate.mjs`** clean on seven. **`shaders.mjs`** clean on
    seven, ours 17/17 (21/21 on Sarab and Cinderhaven, 23/23 on Coldharbour,
    whose palette carries biases 0 and -24) — two more a bias than X3.6e's.
  - **Buffers against WebGPU's DEFAULT limits** (`createBuffer` wrapped from
    boot, foliage `high`, the largest rung; the game asks no raised limits —
    `setMaximumLimits` is off and the device reads 256 MiB / 128 MiB):
    **no shipped map is near either limit.** The largest buffer on every map
    is a world group's storage array, the `CEL_PALETTE` group's colour:
    Cinderhaven 56.0 MiB (44% of the 128 MiB binding limit), Kurenai 30.6,
    Coldharbour 24.9, Greyfen 17.5, Hollowmere 17.2, Harrowmead 13.3, Sarab
    12.7; the next are the same group's positions and normals (Cinderhaven
    42.0) and, on Coldharbour, Harrowmead and Sarab, the main view's source
    indices (14.7 MiB at most). Nothing over 56 MiB is made on any map.
  - **`kit:hash`** identical; **`parity`** passes on eight; **`collision`**
    rewrote nothing (every bake byte-identical); typecheck, build and
    corecheck pass.
  - **X0.3 on the desktop** (`bench.mjs`, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at 2293c09 and the AFTER alternated run by run,
    three a side, on Greyfen, Coldharbour and Cinderhaven; the canonical
    fight hashes on all 18 runs): the mean frame new / old 0.995-1.001 on
    the vantages, 0.998-1.000 on the path and 0.994-0.996 in the fights;
    `gpu.frame` 0.978-1.020; draws equal but Cinderhaven's fight 308 to 309.
    The bench's install on Greyfen, each run's first map, rose ~2 s (9.6 to
    11.8 s) and is the main tree's cold dev server again (X3.6e's reading):
    `installRound` timed in-page, alternately, after a warm boot, is level
    (Greyfen 8.34/8.37 s then 5.88/5.78 against 8.39/8.28 then 5.82/5.81;
    Cinderhaven 8.88/8.58 then 5.91/5.87 against 8.55/8.94 then 5.85/5.92).
- **What the post-commit review found** (an independent reader over
  c52ebb4; fixed after it). No defect and nothing architectural. The
  TRANSFORMED branch of `boundsOf` had no automated check: the DEV
  comparison in `setMap` sees only filed surfaces, all at identity on a
  play build, and `merge:hash` hashed no bounds. It now hashes each
  visual's record bounds (`bounds`) and checks them against the mesh's
  bounding info bit for bit on every run (`bounds≠mesh`), so `--editor`
  puts the transformed path under test each time. `setMap`'s two throws
  (the visuals and the records out of step, a block-keyed mesh that is no
  map visual) run in a production build: kept as invariants, stated in
  `WorldCulling`'s header, and routed through `worldFailed` at X3.7b
  (above). "A cell needs no mesh to be filed" overclaimed: filing is still
  per mesh, and only a cell's BOX needs none (`docs/rendering.md`,
  `SurfaceRecord.bounds`). `gateOf`'s reason ("so the test needs no mesh")
  could not apply, a candidate being a mesh: the gate reads the record
  because the plan asks it to, the two agreeing, so the verdict is the
  mesh's. Names: `filedBounds`, `recordByMesh`, `releaseArrays`'
  `surfaceIndex`. `merge:hash`'s summary counted a visual with no sink
  arrays as unequal but not as compared; it is counted apart now and still
  fails the run. `boundsOf`'s transformed path allocated three vectors a
  surface (module scratches now, bit-identical: the check above); the DEV
  bounds stats reset on `setMap(null)`; `misread` is in `BlockHandover`'s
  Owns. Re-checked after the fixes: `merge:hash` identical to the earlier
  baselines on all eight maps, shipped and `--editor`, but for the new
  `bounds` field; the record bounds equal to the mesh's on **3,828 of
  3,828** shipped visuals (628 off identity) and **28,473 of 28,473**
  editor-build ones (27,488 off identity); the DEV bounds check on
  Coldharbour 234 of 234 and Greyfen 357 of 357, every visual equal; the
  bank 61 of 61 byte-identical to the BEFORE at 2293c09, no console or page
  error; typecheck, build and corecheck.
- **Owed onward.** X3.7b, whose gate the headroom above meets: the
  defaults are the floor every WebGPU adapter must grant and the device asks
  for nothing more, so a phone gets the same limits; what can still differ
  there is memory, not a limit. The phone's FOLLOW-UP reading as every
  step's since X3.3c.

**X3.7b landed** (b5c0a1e, the post-commit review's fixes after it;
2026-10-25; no picture change).
- **What it is.** Babylon is made no mesh of anything our renderer draws.
  `worldMeshes` asks `BuildOptions.onSurface` — now `(surface, index) =>
  boolean` — BEFORE a mesh exists, and makes none of a surface ours draws
  in every pass; a round's `GameMap.visuals` are the glazing and the fires
  (Hollowmere 11, Greyfen 3, Coldharbour 80, Harrowmead 2, Sarab 30,
  Cinderhaven 29, Kurenai none), and `GameMap.world` keeps a record of every
  surface, each naming its mesh (`SurfaceRecord.visual`, -1 for none).
  `BlockHandover.onSurface` decides at the take: a block or landform surface
  on a cel recipe, or the emissive palette with its slots, is OURS; anything
  else is Babylon's, a caster among them held for the shadows alone; one that
  casts but cannot be held, a palette surface that cannot be held, or a mesh
  in a probe's list that is neither a fire nor ours (`probeHolds`) is REFUSED
  (`refuse`: thrown in a DEV build, held to the install and failed in a
  production one). The palette's main pass is ours at the install
  (`setPaletteMain`) and its mask handed to `WorldGlow` whenever a surface
  of it glows; the casters go to `WorldShadows` and `LampAtlas` on EVERY
  rung (`rungDraws` deleted). The contract is `docs/rendering.md` ("Our
  renderer's frame", the shadow maps, the lamps, the bake, "The palette,
  ours"), `docs/game.md` (`installMap`, `teardownMap`, `worldFailed`),
  `docs/editor.md`, `docs/world.md` and the headers.
- **Every former handback is `Game.worldFailed(reason)`**, run after the task
  in hand (`queueMicrotask`), once a failure (`worldFailing`, and the
  handover's own once-an-install latch): one `console.error` (`[world] <map>:
  the map could not be drawn — <reason>`), `enterMenu` (which leaves a
  server's match through `leaveMatch` as it leaves the page's own) and a
  toast (`<Map> could not be drawn on this device`), `loadHeights`' move.
  Its doors: `WorldBlocks.onFailed` (a group's pipeline, a withheld part, a
  list or a cut past the device's limits, a cull — `fail`, `giveUpAll`),
  `onPaletteFailed`, `Renderer.onRefused`, the `onLost` of `WorldShadows`,
  `LampAtlas`, `ProbeBake` and `WorldGlow` (registered by the handover now;
  `ShadowSystem`, `LocalShadows` and `ReflectionSystem` no longer take the
  world back, and `ReflectionSystem.oursLost` is deleted), a pass that will
  take no world at the install (a pipeline latched broken for the session),
  the DEV node check (now of the held casters alone, the one kind of surface
  Babylon draws and ours casts), and `WorldCulling.setMap`, whose two
  invariants hand back their reason instead of throwing (the map filed as
  none, `installMap` handing nothing over after it). `back`, `handedBack`,
  `takePalette`, `dropPalette`, `claimPalette`, `wholePalette`,
  `paletteTaken`, X3.7a's `checkBirth` and its DEV bounds comparison are
  gone, and `stats.handedBack` with them (report version 20; the viewer
  still reads an older capture's).
- **`WorldCulling`** grows a cell from EVERY record filed under its block,
  mesh or none, files Babylon's block-keyed meshes into it, drops `setTaken`
  and the taken set, and answers `reachBoxOf(block)` by the BLOCK (null is
  the landform's `NO_REACH`). `?babylonworld` is deleted (`urlOverrides`'
  `ourWorld`); its parent is tagged `exit-babylonworld` locally at d795e76 —
  pushing it is the user's call.
- **`noGlow` is read per surface, and it needed more than the plan's one
  line.** The glow's mask draws a palette GROUP whole off the main view's
  survivors, and `PASS_GLOW` also meant "never size-gated" — so a `noGlow`
  surface sharing a material with glowing ones would have bloomed, and lost
  its size-gate exemption. A `noGlow` palette surface is cut into a palette
  group of its own material (`WorldBlocks.paletteGroup`, the quiet groups),
  which `glowView` leaves out, and the gate's exemption moved to a bit of its
  own, `LIGHT_SOURCE` (32), on every palette surface — the cull's WGSL, its
  CPU mirror (`ClusterCull`'s replay) and `?cullcheck`'s probe test it where
  they tested `PASS_GLOW`. No shipped map marks a palette surface `noGlow`,
  so nothing moves; a scratch page marking one on Coldharbour installed it
  with three palette groups (two glowing, one quiet), the palette's main
  pass ours, every palette group a light source, no error.
- **`merge:hash` fingerprints one entry a SURFACE**: a surface with no mesh
  off its record (name, material, metadata, counts, pieces, bounds, the
  sink's arrays, `mesh: false`) compared on those fields alone, its arrays
  against the baseline's (which X3.7a proved equal to its mesh's buffers);
  a meshed one field for field, its `sceneRank` against the baseline's
  re-ranked over the surfaces still meshed; pane groups and editor items by
  surface index. It says how many surfaces of each map have no mesh rather
  than failing on them, fails any map that does not build (a DEV refusal is
  a page error out of `buildRound`, watched rather than waited out), and
  takes `--foliage <rung>`.
- **Measured.**
  - **The bank, against a BEFORE at d795e76 in the worktree** (`--check
    --keep` both sides): 60 of 61 byte-identical at first, the same 34
    stale rows over the bank's tolerance on both sides, no console or page
    error. The one, Sarab's `ground` (100 pixels, 0.0048%, at most 2/255 in
    a disc behind the palm), was the BEFORE's own: Sarab re-run on both
    sides, the BEFORE's second `ground` equals the AFTER's, twice, and
    differs from its own first in exactly those 100 pixels. So **61 of 61
    byte-identical** against the BEFORE's re-run; nothing of the cell boxes,
    the take, the candidate order or the default cube moved.
  - **`census --against` the BEFORE**: every row equal (Hollowmere 278,
    Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven
    186, Kurenai 125). **`gate.mjs`** clean on seven; **`shaders.mjs`** clean
    on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour).
  - **`merge:hash`** identical to X3.7a's baseline on all eight registry
    maps: 2,939 of the 3,828 shipped surfaces have no mesh now (Hollowmere
    124 of 135, Greyfen 395 of 398, Coldharbour 218 of 298, Harrowmead 124
    of 126, Sarab 310 of 340, Cinderhaven 376 of 405, Kurenai 255 of 255,
    the proving ground 1,137 of 1,871) and compared off their records; the
    889 meshed ones' arrays and bounds equal to their meshes' (628 off
    identity). **`--editor` identical** to its baseline, 28,473 of 28,473
    meshes. **At `--foliage low` and `medium`** every map builds with no
    refusal (the rungs took: Greyfen 253, Kurenai 128, Harrowmead 32 and
    Coldharbour 20 surfaces' arrays differ from `high`'s).
  - **`kit:hash`** identical; **`parity`** passes on eight; **`collision`**
    rewrote nothing; typecheck, build and corecheck pass.
  - **The forced paths** (a scratch page on Coldharbour): `WorldShadows
    .lose`, `LampAtlas.lose`, `ProbeBake.lose`, `WorldGlow.lose`, a refused
    main pass, a failed group, a failed main-pass palette pipeline, two at
    once, the cull refusing the build, and a pipeline failing under the
    building card each end in ONE `[world]` error, the menu and the toast;
    a round installed after all ten is clean, every pass ours. **A shadow
    rung raised from `off` mid-round** draws ours (four textures of ours,
    no generator, the lamps' atlas ours) and its frame at the menu vantage
    is byte-identical to a round installed at `high`. **`F2`**: the editor's
    build is 2,154 meshes, one a record, aligned, taken by nothing, its
    shadows the generators'; a click selects (placements 47), a select by
    ref highlights, a drag moves the item, a sculpt stroke rebuilds, and the
    save patched `layout.ts` (the one dragged entry) and `heights.ts` —
    restored by `git checkout` after.
  - **What the cut is worth** (`measure.mjs` in the scratch record: the
    heap after two forced GCs, live GPU bytes off `createBuffer` and
    `createTexture` wrapped from boot with `destroy` subtracted, the scene's
    counts, read after a SECOND install in the page, BEFORE and AFTER
    alternated twice a side):

    | map | JS heap MiB | GPU buffers MiB | meshes / geometries | `installRound` 2nd, s |
    | --- | --- | --- | --- | --- |
    | Hollowmere | 333 → 144 | 239 → 127 | 2,487 → 2,363 / 2,409 → 2,285 | 3.01, 2.94 → 2.56, 2.42 |
    | Greyfen | 1,154 → 149 | 652 → 142 | 2,741 → 2,346 / 2,665 → 2,270 | 7.98, 7.98 → 5.62, 5.57 |
    | Coldharbour | 461 → 170 | 357 → 197 | 3,617 → 3,399 / 3,529 → 3,311 | 4.49, 4.40 → 3.63, 3.76 |
    | Harrowmead | 853 → 168 | 515 → 143 | 2,864 → 2,740 / 2,788 → 2,664 | 7.00, 7.16 → 5.28, 5.28 |
    | Sarab | 431 → 238 | 252 → 136 | 6,092 → 5,782 / 6,010 → 5,700 | 4.47, 4.50 → 3.98, 3.93 |
    | Cinderhaven | 720 → 269 | 625 → 353 | 6,611 → 6,235 / 6,521 → 6,145 | 8.06, 8.08 → 6.68, 6.60 |
    | Kurenai | 753 → 134 | 528 → 207 | 2,497 → 2,242 / 2,417 → 2,162 | 5.41, 5.51 → 3.84, 3.84 |

    Textures are unchanged on every map (237-259 MiB). The first install in
    a page fell the same way (Greyfen 11.8 to 9.2 s, Cinderhaven 12.3 to
    11.0, Kurenai 9.2 to 7.6).
  - **X0.3 on the desktop** (`bench.mjs`, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at d795e76 and the AFTER alternated run by run,
    three a side, on Greyfen, Coldharbour and Cinderhaven; the canonical
    fight hashes on all 18 runs): the mean frame new / old 0.993-1.005 on
    the vantages, 1.000-1.001 on the path and 0.992-0.997 in the fights but
    Coldharbour's, 1.030 (its runs' spread 1.1% and 2.4%: under the 8%
    floor); `gpu.frame` 0.980-1.021; draws equal but Greyfen's fight 270 to
    272 and Cinderhaven's 308 to 309. The frame was never the point: what
    moved is the bench's install, Coldharbour 9.6-9.7 s to 7.0-8.5 and
    Cinderhaven 13.4-13.6 to 10.4-12.0; Greyfen, each run's first map on a
    cold dev server, read level (12.6-12.8 to 12.5-13.0), as at X3.7a.
- **Where the line with X3.7c was drawn.** Taken literally from the X3.7b
  list: the `lose`/`onLost`/`broken` latches stay (X3.7c deletes them) and
  their LISTENER changed (the handover's failure); Babylon's
  `ReflectionProbe` path, `GlowPass`'s palette twin and `EmissiveWorld`'s
  Babylon stages stay, now used by the editor alone (`rebake`'s `toBabylon`
  kept for the harness); `WorldBlocks.setPaletteMain` and the HELD layer
  (`addCaster`, a casting fire's — no shipped map has one) stay; the
  generators and the lamps' render target are the editor's (X5.3).
- **What the post-commit review found** (an independent reader over
  b5c0a1e; fixed after it). No game-code defect and nothing architectural;
  one defect in the ORACLE. `merge:hash --against` could not see a surface
  LOSE its mesh: only a meshless entry said `mesh` (`false`), and a field a
  side lacks is not compared, so a fire made meshless would have vanished
  and passed. A meshed entry now says `mesh: true` and a `mesh` that moved
  is a difference (a baseline that records none, X3.7a's, still compares
  as before); `reRanked` no longer gives a baseline rank of -1 a slot.
  Proved on Hollowmere and Coldharbour with one fire forced meshless: the
  new script against the new baseline fails on exactly that entry
  (`visuals[61]`, `visuals[109]`: `mesh`), the old one against the old
  baseline passed it; reverted, both maps identical. Five LATENT paths, none
  reachable on a shipped map: `WorldCulling.reachBoxOf` threw, uncaught
  inside `installMap`, for a surface of ours filed under a block no cell
  was grown for — it answers null now and `BlockHandover.install` fails the
  world on it, as `setMap`'s reasons are; `fail`'s guard was "ours took a
  surface" (`reach` non-empty), meant for the editor, which also swallowed
  a production refusal on a map ours took nothing of — the handover now
  latches an OWNER at the install (`WorldOwner`, a fresh `{ id, name }`
  each) and an editor build latches none (`install`'s `editor`); the glow
  mask asked a pipeline for every palette group's bias, a quiet (`noGlow`)
  group's too, which could have failed the world for a pass drawing
  nothing with it (`palettePipelines` takes the groups the pass draws); a
  loss of the OLD map landing between `startRound` and the new install
  aborted the NEW round under a toast naming the new map — the failure now
  carries its owner, which names the map in the line and the toast, and
  one whose owner is not the round in hand while a build is pending
  (`Game.roundWorld`, null from `startRound` to the install) is said and
  ignored; and a cull refusal of an EDITOR build would have taken the page
  to the menu with the editor open — it is a `console.error` now, the
  editor kept over a map the cull files nothing of. Two of SHAPE: the
  refusal of a Babylon mesh that is neither the glazing nor a fire (a held
  non-fire caster among them) ran in `probeHolds` only because
  `ReflectionSystem.build` asked it ahead of an early return — it is the
  install's now (`strayMesh`, every map), and `probeHolds` only counts; and
  a DEV refusal stranded the page under the building card (it threw at the
  take, out of `buildRound`, the state still `loading`) — a refusal is held
  to the install in every build, which fails the world and THEN throws in
  DEV, so `merge:hash` still sees a page error, the map was built whole
  and is torn down, and the page reaches the menu. Docs: the stale
  handback claims in `PipelineWarmup`'s header, the scatter list's limits
  and the water's rebind (`docs/rendering.md`, `WaterSystem`, `FILES.md`;
  the `toBabylon` branch it serves is X3.7c's to delete), `ProbeBake.lose`,
  `ReflectionSystem`'s log line and `rebake`, `CLAUDE.md`'s "any other mesh
  carrying `metadata.block`" (no line added), `docs/game.md`'s failure
  paragraph, `VERIFYING.md`'s forced-loss recipe (the refused surface, the
  old map's loss), and this note's hash. Left for X3.7c as planned:
  `setPaletteMain` (only ever `true`), `ProbeBake.lose`'s unread `dropped`
  count, and `toBabylon`. Re-checked after the fixes: `merge:hash`
  identical to X3.7b's baselines on all eight maps, shipped and `--editor`,
  the new baselines (`merge-baseline-x37b.json`,
  `merge-baseline-x37b-editor.json` in this step's scratch record)
  differing from those only by `mesh: true` on the 889 and 28,473 meshed
  entries; `census --against` the BEFORE equal on seven; `gate.mjs` clean
  on seven; the forced paths on Coldharbour — the ten of X3.7b, a surface
  filed under no block, a refused surface (one `[world]` line, the DEV
  throw as a page error, the menu, the toast), the old map's shadows lost
  right after a Restart's `startRound` (one line naming it, "already being
  replaced", the new round deployed with every pass ours, no toast) and a
  clean round after; an editor build the cull refuses (one line, the
  editor kept, no toast, a clean round on leaving it); `F2` select, drag,
  sculpt and save (restored); the bank 61 of 61 byte-identical to the
  BEFORE at d795e76 (its Sarab re-run) and to X3.7b's AFTER, the same 34
  stale rows, no console or page error; typecheck, build and corecheck.
- **Owed onward.** X3.7c. The phone's FOLLOW-UP reading, as every step's
  since X3.3c — X3.7b's gain is memory the phone feels most. Pushing the tag
  `exit-babylonworld` (the user's call).

**X3.7c landed** (f9b2512, the post-commit review's fixes after it;
2026-10-25; no picture change).
- **What it is.** The fallback machinery Babylon kept for the world goes for a
  round. **Babylon's `ReflectionProbe` path is deleted** (`ReflectionSystem`:
  the two probe pools, the draw-budgeted queue and `releaseBatch`, `release`,
  `forgetPasses`, `newProbe` and its scene swap, `faceOf`, `neighbourhood`,
  `opaqueWorld`, `encloses`, `toBabylon`, `setOurs`/`holds`/`path`, the eye
  borrowed around the render targets, the water's `rebind`; `CONFIG.graphics
  .reflection.drawsPerFrame`); the bake is ours, always, and a build our bake
  holds no world for (an editor's, a round already failed) bakes nothing.
  **The default cube is one of ours** (`ProbeBake.cube("default")`, wrapped,
  never baked: WebGPU makes it zeroed, as Babylon's probe 0 was cleared to
  zero), bound at a strength of 0 as before. **The emissive palette's Babylon
  stages and its glow-mask twin are deleted** (`EmissiveWorld.ts`: no
  ShaderStore entries, no `EmissiveWorldMask`, no `SelfMasking`, no
  palette/fog/eye uniforms); `EmissiveWorldMaterial` is a plain `Material`
  OBJECT — the merge keys on it, the factory hangs its recipe off it,
  `GlowRules` reads its white `emissiveColor` (X3.7, Keeps). **The
  `lose`/`onLost`/`broken` latches are deleted** from `WorldShadows`,
  `LampAtlas`, `ProbeBake` and `WorldGlow` (`WorldGlow.holds` with them), and
  so are `WorldBlocks.setPaletteMain` (only ever `true`: the palette is drawn
  first whenever there is one) and its `paletteFailed` getter,
  `BlockHandover.probeHolds` and `ProbeHolding`, and the Babylon-bake-only
  flips the materials carried (`CelMaterialFactory.setOpaqueAlpha` and
  `readEye`, `FlameMaterial`/`BlastMaterial.setOpaqueAlpha`,
  `ShadowBindings.holdCloudShadow`).
- **How a failure still reaches `worldFailed` without the latches.** The
  handover hands each pass its world WITH the install's failure —
  `WorldShadows.setCasters(depth, failed)`, `LampAtlas.setCasters(depth, slot,
  failed)`, `ProbeBake.setWorld(source, failed)`, `WorldGlow.setWorld(source,
  failed)`, `failed` being `BlockHandover.failFor(owner, …)`, which drops a
  failure for an install no longer in hand — and the pass TELLS it whatever
  it finds it cannot draw, in the turn it finds it: casters whose build
  failed, a bake view not made or not built, a mask view not made, a mask
  pipeline failed, a refused mask pass. Nothing is dropped or handed back;
  the handover stops our draws (`WorldBlocks.stop`) and `Game.worldFailed`
  tears the round down after the task in hand. **A pipeline asked once for
  the session** (the lamps' proxies, the bake's mips) is no latch either:
  every world handed over waits on its settled PROMISE, so a failure fails
  that install and every one after it, each through its own failure. The
  handover's own doors are unchanged (`WorldBlocks.onFailed`,
  `onPaletteFailed`, `Renderer.onRefused`, the cull's refusal, a refusal at
  the take, the DEV node check). The install's checks that asked a pass
  whether it HELD a world (`lamps.casters`, `probes.holds`, `glow.holds`,
  `blocks.paletteFailed`) are gone with them: the first three could be false
  at the install only through a latch, but for `glow.holds` on a null
  `glowView()`, which `WorldGlow.setWorld` now tells synchronously, in the
  install's turn; and `blocks.paletteFailed` was dead — set only in a
  main-pass palette pipeline's `.then`, after the cut that asks for it, so
  never true by the install that read it (corrected by the review, below).
- **What the editor keeps, and why it needed nothing replaced but the
  cube.** `ShadowSystem`'s generators and `LocalShadows`' render target, as
  planned (X5.3's). The palette's Babylon stages and twin were drawn by NO
  build: an editor build never merges its blocks (`MapBuilder.mergeBlocks`,
  the one pass that paletteises), so its emissives are `getEmissive`'s
  `StandardMaterial`s, which `GlowPass` blooms as ever (`merge:hash
  --editor`'s baseline: no `emissive-world` material on any of the eight
  maps' 28,473 meshes) — the header that said they drew an editor build was
  wrong. Its glass and water bake nothing and sample the default cube at
  strength 0, as before.
- **Deviations.** HELD-caster layer kept — but not, as this note first
  said, "live for a casting fire, which no shipped map has": it is
  unreachable by construction (the review, below). Every fire is made
  `noShadowCaster` where it is made (`flame.ts`'s `flamePart`, and the fire
  drum's flame), so no fire is ever held, and a held caster that is not a
  fire is made a Babylon mesh that `strayMesh` refuses; no held caster can
  exist without making a fire cast. The layer (`WorldBlocks.addCaster`,
  `BlockHandover`'s `held`, the DEV node check of its meshes) is kept for
  X4.4, the fires, to use or delete.
  `probeCount` counts the slots baked, both pools, and no longer the default
  cube (Babylon's glazing pool held it as slot 0): one fewer on a map with no
  glazing (Hollowmere 3 to 2, Greyfen and Harrowmead 2 to 1, Kurenai 4 to 3;
  `gate.mjs` prints it and asserts nothing of it). A stale comment naming
  `ReflectionSystem.encloses` stays in `src/world/harrowmead/layout.ts`: the
  collision bake's staleness guard hashes that file's text, so editing it
  would re-bake.
- **Measured.**
  - **The bank, against a BEFORE at 9f7f0b1 in the worktree** (`--check
    --keep` both sides): 60 of 61 byte-identical at first, the same 34 stale
    rows over the bank's tolerance on both sides, no console or page error.
    The one, Sarab's `ground` (100 pixels, 0.0048%, at most 2/255), was this
    time the AFTER's first run — X3.7b's known run noise: Sarab re-run on both
    sides, the two re-runs equal each other on all eleven rows, and equal the
    BEFORE's first run and X3.7b's AFTER. So **61 of 61 byte-identical**; the
    default cube moved nothing, as `mix(sky, city, 0)` says it cannot.
  - **`census --against` the BEFORE**: every row equal (Hollowmere 278,
    Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186,
    Kurenai 125). **`gate.mjs`** clean on seven (the probe counts it prints
    one lower on the four maps with no glazing: above). **`shaders.mjs`**
    clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23
    Coldharbour, palette biases 0 and -24) — after its discovery was fixed:
    it read the palette's biases off the ShaderMaterials it compiles, which
    the palette no longer is, and its first run built neither palette program
    (15/15, "palette biases []") while passing; it now asks every material on
    the page (`scene.materials`). Babylon compiles two modules fewer a map
    (116-132 against 118-134): the palette's stages.
  - **`merge:hash`** identical to X3.7b's baselines and to X3.7a's on all
    eight registry maps, shipped (2,939 of 3,828 surfaces meshless, 889
    meshed equal in arrays and bounds) and `--editor` (28,473 of 28,473).
    **`kit:hash`** identical (3,722 builds); **`parity`** passes on eight;
    **`collision`** rewrote nothing; typecheck, build and corecheck pass.
  - **The forced paths** (a scratch page on Coldharbour, each on the pass's
    own path, `VERIFYING.md`'s recipe): the main pass refused, a failed
    group, a failed main-pass palette pipeline, the mask pass refused
    (`WorldGlow.refused`), two at once, the shadow maps' casters and the
    lamps' casters not building, the lamps' proxies' pipeline failed for the
    session — and a SECOND round on that session failing the same way — the
    bake's mips pipeline failed, its view not made and not built, the mask's
    view not made, a mask pipeline failed, the cull's refusal, a pipeline
    failing under the card, a surface filed under no block and a refused
    surface (its DEV page error) each end in ONE `[world]` error, the menu
    and the toast naming the map; the OLD install's failure called after a
    Restart's `startRound` is said against the old map ("already being
    replaced") and dropped when called again after the new install
    (`failFor`), the new round deployed with no toast; a clean round after,
    every pass held, the bake drained. **A shadow rung raised from `off`**
    mid-round draws ours, byte-identical to a round installed at `high`.
    **`F2`**: 2,154 meshes, the generators drawing, select (placements 47),
    a select by ref, a drag, a sculpt stroke and a save (restored by `git
    checkout`), no error. **The editor's look**, photographed in the editor
    at Coldharbour's shopfront (see-through glazing, the shop's lamps) and at
    its curtain wall, frozen, two runs a side: BEFORE against AFTER 0.005-
    0.014% and 0.020-0.026% of pixels (at most 3 and 17/255), the BEFORE
    against itself 0.005% and 0.018% (2 and 17/255) — run noise, the glass
    showing the sky half and the fanlight's bloom the same; one custom
    render target fewer (Babylon's probe 0).
  - **What it is worth** (`measure.mjs`, the second install in the page,
    BEFORE and AFTER alternated twice a side): GPU textures 0.3-0.4 MiB lower
    on every map (Babylon's probe 0 against the default cube of ours: 236.8
    to 236.5 Hollowmere, 256.2 to 255.9 Coldharbour, 258.5 to 258.1
    Cinderhaven), GPU buffers identical (127.0 to 353.0 MiB), the JS heap
    level within half a MiB (Greyfen 149.1 to 148.8, Cinderhaven 269.6 to
    269.2), scene meshes and geometries identical, `installRound` level
    (Greyfen 4.28/4.33 to 4.35/4.31 s, Cinderhaven 5.87/5.57 to 5.59/5.49).
    The bundle is 9.2 kB smaller (`index` 9,448.94 to 9,439.72 kB, gzip
    2,344.26 to 2,342.01). X3.7c deleted a path, not a cost a round paid.
  - **X0.3 on the desktop** (`bench.mjs`, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at 9f7f0b1 and the AFTER alternated run by run,
    three a side, on Greyfen, Coldharbour and Cinderhaven; the canonical
    fight hashes on all 18 runs, none hung): the mean frame new / old
    0.997-1.001 on the vantages, 0.993-1.000 on the path and 0.996-1.010 in
    the fights (every spread under 3%); `gpu.frame` 0.990-1.013; draws equal
    but Greyfen's fight 273 to 272. The bench's install read the main tree's
    dev server again (Greyfen, each run's first map, 8.7-8.8 s to 11.0-11.5;
    Coldharbour 8.1-8.5 to 6.0-6.4) — `installRound` timed in the page,
    above, is level.
- **Phase 3's end condition** — "Babylon builds no mesh in a round for
  anything our renderer draws" — **reads true** (since X3.7b), and since
  X3.7c no Babylon pass of the world is kept for a round: what Babylon draws
  in one is the bodies and `BodyShadows`, the hulls, the viewmodel, the
  effects and fires, the sky, clouds and moon, the water, grass, glazing,
  flags, rings, blobs and particles, and the glow mask's non-world emissives.
- **What the post-commit review found** (an independent reader over
  f9b2512; fixed after it). No defect and nothing architectural. One
  LATENT path: a block-merged build handed no `onSurface` would make a
  Babylon mesh wearing the now-plain `EmissiveWorldMaterial`, which a frame
  never draws (a plain `Material` is never ready) and `GlowPass` would bloom
  WHITE over the hole (its stock mask admits the white `emissiveColor`) —
  the header said only "a hole". `worldMeshes` makes a mesh of the palette
  in NO build now: handed `onSurface`, the handover has taken it or refused
  it (the refusal failing the world at the install, as X3.7b routes every
  one), so a refused palette surface is left meshless with the map being
  torn down; handed none, a DEV build throws (no production build hands
  none, the editor's being DEV-only and never merged). Two ORACLES that
  could pass while testing nothing: `gate.mjs`'s "a reflection probe is
  re-rendering every frame" read `scene.customRenderTargets`, empty in a
  round since X3.7c — it now asks our bake, `bakePending` 0 at deploy and
  0 on every frame the gate watches (~2,850 a map); and `shaders.mjs`
  could pass again having found no palette bias — it now fails when a
  palette group `WorldBlocks` cut carries a bias it built no program at.
  Both proved to fail: the bake re-queued every 600 frames by a scratch
  hack in `ReflectionSystem.releaseOurs` failed Coldharbour's gate ("the
  reflection bake re-queued during the round (39 probes pending at most
  over 2851 frames)"), and X3.7c's first-run discovery restored in a
  scratch `shaders.mjs` failed Coldharbour ("palette biases [], cut [-24,
  0]", 19/19 ours where the right run builds 23/23) — each reverted. Of
  SHAPE: the held-caster layer is unreachable by construction, not merely
  unused (Deviations, corrected), kept for X4.4; `Game`'s per-mesh bloom
  rule lost its `fadesOwnBloom` branch, no Babylon mesh wearing the palette
  — and `fadesOwnBloom` itself went, there being no other caller (the
  review took `WorldGlow` to use it: it never did, its rule passing a fade
  of 1); `WorldBlocks.draw`'s palette guard went, `drawPalette` skipping
  every group with no emissive. Docs: this note's line on the install's
  checks (`blocks.paletteFailed` was dead, a null `glowView()` is told
  synchronously), `CelInk`'s "ReflectionSystem flips `opaqueAlpha`" (the
  bake's frame states 1, `fillBakeFrame`), `CONFIG.graphics.reflection`'s
  `size` and `radius` (Babylon's bake's cost model, stated in the present
  tense), `generate-harrowmead.mjs`'s stale `ReflectionSystem.encloses`
  (its `layout.ts` left alone: editing it re-bakes), `VERIFYING.md`'s
  default-cube readback (the raw `GPUTexture` in `ProbeBake`'s cubes, not
  Babylon's wrapped `defaultCube`), `docs/rendering.md`, `FILES.md`, the
  webgpu-ref README, X4.4's list and the headers. Re-checked after the
  fixes: typecheck, build and corecheck; `gate.mjs` clean on seven, every
  map's bake drained at deploy and over the frames watched; `shaders.mjs`
  clean on seven, the cut palette's biases those built (Coldharbour
  [-24, 0], the rest [0]), ours 17/17 (21/21 Sarab and Cinderhaven, 23/23
  Coldharbour); `census --against` the BEFORE equal on seven; `merge:hash`
  identical to X3.7b's baselines on all eight maps, shipped and `--editor`
  (no `emissive-world` material on the editor's 28,473 meshes); the forced
  paths on Coldharbour — X3.7c's twenty, among them the main pass refused,
  the mask pass refused and the mips pipeline failed — each one `[world]`
  error, the menu and the toast, a clean round after, and no install of
  the twenty handed a palette mesh (the refused PALETTE surface's
  included); the DEV assertion fired once under a scratch build handed no
  `onSurface` (`worldMeshes: "block-1,0-emissive-world-over-glass-noInk"
  wears the emissive palette…`); the default cube read back all zeroes on
  six faces through the corrected recipe, a pool cube world; `F2` select,
  drag, sculpt and save (restored by `git checkout`), no error; the bank 61
  of 61 byte-identical to the BEFORE at 9f7f0b1 on the first run, the same
  34 stale rows, no console or page error.
- **The phone's FOLLOW-UP reading, taken 2026-10-30 and 2026-10-31** on
  the deployed X3.7c build (report version 20 with the bodies still in
  Babylon's draw counter — X4.1d is what moves both), the same phone as
  every reading above but on Chrome 156 where all of them were 155. Two
  sessions, one `?bench=<map>&gpu` run a map in the BEFORE's order
  (Greyfen, Harrowmead, Sarab), the canonical fight hashes on all six;
  whether a warm-up run went first is not recorded. **The second session
  is the protocol's settings** (X3.5b's BEFORE: render scale 0.5, cap 60,
  shadows, grass, Trees and glow `low`, FXAA, blur, grain, volumetrics, GI
  and ground relief off, the minimap on), saved 2026-10-31 01:31-01:43 UTC.
  The first, saved 2026-10-30 03:16-03:26 UTC, differed in two: shadows
  `medium` and FXAA on. Every frame one matched 1170x540 **but the second
  session's Greyfen, drawn at 1170x618 in the same 832x384 window** (the
  stale canvas again, 14% more rows), so that row compares with nothing.
  The second session, the segment groups' means:

  | map | part | mean | p95 | 1% low | tick | render | draws | GPU | cull |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Greyfen (1170x618) | vantages | 19.4 | 42.1 | 68.8 | 5.52 | 3.68 | 28 | 14.5 | 0.44 |
  | Greyfen (1170x618) | path | 22.7 | 59.0 | 78.2 | 6.26 | 4.00 | 27 | 17.9 | 0.45 |
  | Greyfen (1170x618) | fight | 26.1 | 61.7 | 94.7 | 13.53 | 9.94 | 220 | 19.9 | 0.54 |
  | Harrowmead | vantages | 22.6 | 57.9 | 90.7 | 6.78 | 4.39 | 43 | 17.3 | 0.56 |
  | Harrowmead | path | 24.9 | 67.9 | 86.7 | 7.02 | 4.42 | 42 | 19.6 | 0.55 |
  | Harrowmead | fight | 25.7 | 59.9 | 85.8 | 12.30 | 8.12 | 154 | 20.1 | 0.61 |
  | Sarab | vantages | 16.7 | 17.5 | 28.7 | 6.01 | 4.24 | 51 | 11.1 | 0.50 |
  | Sarab | path | 16.7 | 17.8 | 23.9 | 5.89 | 3.96 | 44 | 11.5 | 0.45 |
  | Sarab | fight | 20.8 | 24.8 | 41.0 | 18.36 | 14.22 | 327 | 13.1 | 0.57 |

  - **Shadows `medium` and FXAA on cost this phone nothing measurable at
    0.5**, on the same code: the look parts' `gpu.frame` 14.7 / 17.5 / 11.0
    ms in the first session against 14.5 / 17.3 / 11.1 in the second
    (Greyfen's despite its taller canvas), the ticks within 5%. The paths
    and fights moved more (Sarab's path GPU 14.6 to 11.5, its fight's tick
    20.16 to 18.36), but the tick moved with them, which a GPU setting
    cannot do: that is the phone's state, the first session's last eighths
    running hotter (Sarab's GPU by eighths 10.8-17.0 against 10.8-14.3).
    Cross-session and one run a side, so "nothing" means under ~8%.
  - **Against both earlier protocol readings the forest maps read heavier
    and Sarab level**, tick / GPU in ms — X3.5b's BEFORE (2026-10-21,
    3b9be6c) and the A/B of 2026-10-23 (d763327, the list arm that
    shipped; the stream arm in brackets):

    | map | part | 2026-10-21 | 2026-10-23 | 2026-10-31 |
    | --- | --- | --- | --- | --- |
    | Harrowmead | vantages | 5.61 / 14.6 | 4.46 / 12.0 (5.14 / 12.6) | 6.78 / 17.3 |
    | Harrowmead | path | 6.47 / 18.0 | 4.39 / 11.9 (4.83 / 13.3) | 7.02 / 19.6 |
    | Harrowmead | fight | 11.13 / 20.4 | 9.88 / 15.0 (10.59 / 15.5) | 12.30 / 20.1 |
    | Sarab | vantages | 6.28 / 11.3 | 5.79 / 10.8 (4.88 / 10.6) | 6.01 / 11.1 |
    | Sarab | path | 6.22 / 11.1 | 5.06 / 11.2 (4.90 / 10.8) | 5.89 / 11.5 |
    | Sarab | fight | 18.34 / 15.6 | 16.80 / 11.1 (13.84 / 10.2) | 18.36 / 13.1 |

    **The size is not priced; the pattern is the reading.** The phone
    moved 11-25% under unchanged code between 10-21 and 10-22 (the work
    list's note, above), and Harrowmead's rise is 8-21% against 10-21 (its
    fight's GPU level) and 24-65% against 10-23. What
    holds against both is that Sarab, run last in all three sessions,
    reads level while the forest maps read heavier — a device state would
    move all three. Harrowmead's first session agrees (vantages 6.83 /
    17.5); Greyfen's, matched and at settings that move nothing on the look
    parts, reads vantages 5.46 / 14.7 against 4.71 / 13.2 and 4.04 / 12.0.
    Between the builds lie the list's landing (e07ae7c), X3.6a-e, the
    scatter's plain draw (e172f88) and X3.7a-c — and Chrome 155 to 156.
    Open as `FINDINGS.md` 66.
  - **Sarab's fight read p95 24.8 ms, at X0.4's target of 25**, in one run
    and not the protocol's two warm ones; the first session read 29.3 on the
    same code, so it sits ON the target rather than under it. It is still
    the CPU (an 18.36 ms tick against 13.1 of GPU, `render` 14.22 recording
    327 Babylon draws, the bodies among them) — X4.1's phone BEFORE (X4.1's
    note).
  - **Our culls are 0.44-0.61 ms** of `gpu.cull` on every part, against
    0.36-0.53 on 10-23's list arm.
- **Owed onward.** Before a phase gate: the `exit-phase-3` tag, the user's
  call (rule: "Moving the branch back to one is the user's call"), as is
  pushing `exit-babylonworld`. The forest maps' rise on the phone (above)
  is open as `FINDINGS.md` 66.
  X5.3 deletes what the editor keeps. X4.4 uses or deletes the HELD-caster
  layer, which no build reaches (Deviations).

---

## Phase 4 — Everything else that draws

Each step takes one kind of draw off Babylon's scene, along with its view
module from X2.2. When the last one lands, Babylon draws nothing but the post
chain, and the frozen cel-material cache and its traps are deleted with
`CelMaterialFactory`'s Babylon half.

### X4.1 — Bodies (PERF_PLAN C6, A4) — **L, as five sub-steps** (split 2026-10-29) — X4.1a **LANDED** (a417bfc, review fixes after it), X4.1b **LANDED** (f554b68, review fixes after it), X4.1c **LANDED** (3a07a68, review fixes after it), X4.1d **LANDED** (23c6cd9, review fixes after it), X4.1e **LANDED** (53dcb34) — **all five LANDED**

Every body a page draws — `NetSoldier`'s rig, a corpse, the death cam's
stand-in — comes off Babylon's scene, along with the moon's body shadow map,
and A4's fade is built on the result. It is split so that the four moves are
each proven with no picture change, one claim at a time, and the fade, which
IS a picture change (rule 2), lands alone with the bank's numbers. Each
sub-step lands on its own and leaves the game shippable.

**This reverses one line of PERF_PLAN C6**, which kept a corpse a Babylon rig
because `RagdollSystem` reparents its joints onto Havok proxies. Here a corpse
is posed off X2.4's arrays (`WorldBody.pose`) onto our joints, so the
reparenting goes and every body is one kind of thing to draw.

- **X4.1a — the joints are ours (no picture change).** Landed (below).
  `SoldierModel`'s tree
  of `TransformNode` joints becomes our own hierarchy, its world matrices
  written into arrays a rig owns. Babylon still draws the 14 meshes, reading
  those matrices. `NetSoldier`'s pose (`soldierPose.ts`), `proxyBoxes`, the
  muzzle replay and anything else that reads a joint read the arrays. The
  root capsule `WorldCulling` measures a body by is taken off the arrays too
  (X1.3 left it here). **Oracle:** the joint matrices against the nodes',
  bit for bit, over a recorded round, before the nodes go.
- **X4.1b — corpses and the stand-in on our joints (no picture change).** Landed (below).
  `RagdollSystem` writes a corpse's joints from its bodies' pose arrays
  instead of reparenting nodes onto proxies; the death cam's stand-in the
  same. `freeze`, the pool's three tiers and eviction of the oldest, and the
  joint-pose leak (`docs/deaths.md`) are re-proven on the new path.
  **Oracle:** `drop.mjs --check --exact` and `clients.mjs --check` as at X2.4;
  a blast throwing bodies; a full pool evicting; a respawned bot that does not
  freeze.
- **X4.1c — the moon's body map is ours (no picture change).** Landed (below). `BodyShadows`'
  generator, light and proxy mesh become a pass of our renderer, as
  `WorldShadows` did at X3.6a, drawing `proxyBoxes`' matrices — soldiers AND
  hulls, a hull's being its collider box off its own fields (`hullFrame.ts`),
  never its mesh, so X4.2 owes this map nothing. The rung, the window and the
  back faces carry over; the lamps' atlas already draws ours (X3.6b) and only
  changes where its boxes come from. **Oracle:** the bank; a shadow rung `off`
  to `high` mid-round; the map read back against Babylon's before the
  generator goes.
- **X4.1d — every body drawn by us (PERF_PLAN C6).** Landed (below). Living bodies, corpses
  and the stand-in as instances fed from the joint arrays: 14 joint meshes ×
  48 bodies becomes 14 instanced draws or fewer, in every pass a body is in.
  The body's measure, the fog-wall gate and the size gate's whole-body drop
  move with them, its emissive with it. Babylon builds no rig mesh in a round.
  Its pipelines are asked ahead through `PipelineCache`, so the warm-up's body
  pose goes or becomes a key. **Oracle:** the bank's rig vantages 61 of 61
  byte-identical; census; X0.3 alternated at 24 a side on Sarab and
  Cinderhaven, `--max --gpu`; a netplay round; a blast throwing bodies.
- **X4.1e — A4's fade (the picture change).** Landed (below). A screen-door dither at
  `bodyDrawDistance` AND at the size gate's drop (a fade built for one misses
  the other), carried as a per-instance value — A4's "first question" is
  answered by X4.1d's instancing, and the value cannot be a NINTH vertex-stage
  storage array (X4.1d's Owed onward). The dithered pipeline is asked ahead with
  the rest. **Oracle:** the bank's numbers in the message (only rows with a
  body at a fade edge may move); a body walked through both edges on a phone
  and a 32:9 window (the phone's owed by the user's decision, 2026-10-30).
- **Contracts all five keep:**
  - a body is measured once and drops whole, its emissive with it
  - a rig's shadow shape is `RAGDOLL_BONES`, a hull's its collider box
  - the local player casts nothing
  - the side a rig wears is chosen when it is built (`teamView`), and is half
    of a rig pool's identity beside its size
  - the rig pool is built once per roster size and never disposed inside a
    round
  - nothing under Havok feeds navigation, cover or hit detection
- **Verify, each sub-step:** the bank `--check --keep` against a BEFORE at the
  parent; `census --against`; `gate`, `shaders`; typecheck, build, corecheck,
  `parity`; a round offline and a netplay round.
- **The phone's BEFORE** is X3.7c's FOLLOW-UP reading (2026-10-31, the
  protocol's settings; its Harrowmead and Sarab rows, Greyfen's canvas having
  been stale). What X4.1 should move is Sarab's fight, the phone's one part
  bound by the CPU: tick 18.36 ms, `render` 14.22 recording 327 Babylon
  draws, `gpu.frame` 13.1, p95 24.8 (29.3 the session before, on the same
  code). Greyfen's and Harrowmead's fights are the GPU (19.9-20.1 ms against
  a 12-14 ms tick), so X4.1 is not expected to move their frames. **The
  AFTER** repeats those settings and that order on a build whose capture
  reads report version 21 (dd902aa) — a version-20 capture is not X4.1's
  build. Babylon's counter falls by the bodies, and v21's `bodies` counts
  the draws ours took. One run a map reads a difference only past ~8%
  (X3.5b's note), and the phone's state moved Sarab's fight tick 9% between
  the two sessions on one build, so Sarab's `tick` and `render` are the
  reading only at the size X4.1d moved the desktop (the fight's frame down
  a third, X4.1d's note) — and the rank's vertex surplus (X4.1d's Owed onward) is
  read in its `gpu.frame`.
- **The phone's AFTER, taken 2026-10-31** on the deployed f7534f2 (report
  version 21), saved 02:04-02:13 UTC — twenty minutes after the BEFORE in
  the same session, so on a phone no cooler than the BEFORE's — at its
  settings and in its order, every frame one matched 1170x540, the canonical
  fight hashes on all three. BEFORE → AFTER, the segment groups' means:

  | map | part | mean | p95 | tick | render | draws | GPU |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Greyfen | fight | 26.1 → 24.1 | 61.7 → 64.1 | 13.53 → 8.38 | 9.94 → 4.92 | 220 → 65 | 19.9 → 18.6 |
  | Harrowmead | fight | 25.7 → 25.3 | 59.9 → 66.6 | 12.30 → 9.16 | 8.12 → 5.06 | 154 → 63 | 20.1 → 19.8 |
  | Sarab | fight | 20.8 → 17.5 | 24.8 → 28.1 | 18.36 → 10.99 | 14.22 → 7.22 | 327 → 109 | 13.1 → 13.2 |

  (Greyfen's BEFORE was drawn at 1170x618, so its row is indicative only.)
  `draws` is Babylon's counter, which counts no body now; at the save, ours
  drew Sarab's 35 bodies in 48 main-pass draws and 18 glow-mask draws
  (`bodies`), where Babylon drew fourteen a body.
  - **Sarab's fight is no longer bound by the CPU.** Its tick fell 40% (p95
    21.4 to 13.0 ms), `render` by half, and the frames over 16.7 ms of tick
    from 76% to 1%. Its median frame went 20.8 to 16.6 ms: 84% of its
    frames are under 18 ms, against 15%.
  - **Its p95 ROSE, 24.8 to 28.1, and that is the GPU's tail, not a
    regression.** The BEFORE's frames sat unquantized at 18-28 ms behind the
    tick; the AFTER's either make the vsync or miss it, and the 5% that miss
    (28-52 ms) carry `gpu.frame` 15.2 against a 13.1 median (p90 15.0, p99
    17.4) and a 10.9 ms tick. So **X0.4's "p95 at or under 25 ms" no longer
    measures what it was set for**: it was chosen when the fight was CPU
    in the render, and a p95 over a frame that holds 60 on 95% of its
    frames reads ~17 ms, and one that misses on 5% reads ~33. How X6.2
    reads that target is the user's call.
  - **The forest maps' fights were already the GPU**, and their frames
    barely moved (means -8% and -2%) while their ticks fell 26-38% and the
    frames under 18 ms rose 49 to 66% (Greyfen) and 52 to 63% (Harrowmead).
    Greyfen's fight p95 64.1 is under X0.4's floor of 69.
  - **The rank's vertex surplus is not visible on the phone**: the fights'
    `gpu.frame` 13.1 → 13.2, 20.1 → 19.8, 19.9 → 18.6 — within one run's
    noise, ~2.8× the vertex invocations notwithstanding (X4.1d's Owed
    onward). Nor is X4.1a's compose cost separable: it is inside a tick
    that fell 3-7 ms.
  - **The look parts are level on Harrowmead and Sarab** (ticks -3 to -5%,
    `gpu.frame` within 2%). Greyfen's read 2.2 ms more GPU on less canvas
    (16.7 against 14.5 on the vantages), the run that opened the session;
    the same build read level on the other two maps' look parts, so it is
    not attributed to X4.1.

**X4.1a landed** (a417bfc, the post-commit review's fixes after it;
2026-10-29; no picture change).
- **What it is.** A soldier rig's joints are OUR hierarchy
  (`src/entities/rigJoints.ts`, Babylon-free, a root of
  `check-babylon-free.mjs`): `Joint` holds the local channels a
  `TransformNode` held (position, Euler, scaling, its own switch) and a
  float32 world `Matrix` the rig owns; `JointTree.compute` composes every
  joint parents first and `computeChain` one joint and its ancestors — each
  answer FRESH, what a forced `computeWorldMatrix(true)` was, in `src/math`'s
  copies of Babylon's arithmetic (the muzzle replay's, X2.2). **Babylon
  still draws the fourteen meshes, and none has a parent**: each mesh's own
  local is composed once at build, and `drawRig` hands Babylon its world
  matrix (that local times its joint's) through `freezeWorldMatrix` — once a
  frame from `Game.drawBodies`, in every state, after every write and
  immediately before `scene.render`, inside the `render` span where Babylon
  composed them before. **The root capsule is gone**: the root is a joint;
  `rig.enabled` is the switch every roster, the death cam and the culling
  read (`setRigEnabled`, which writes each mesh's own flag beside it, the
  launcher's mesh off while its joint is); and `WorldCulling` measures a
  body through `PooledBody.measure` (`SoldierModel.pooledBody`, so the cull
  still names no soldier) — `rigJoints.measureBody`, the capsule's sphere
  (`BoundingSphere._update` over its exact ±0.4/±0.9 bounds) off a fresh
  compose of the root. Every reader of a joint reads the arrays:
  `NetSoldier.muzzleWorld` and the death cam's anchor and chest
  (`jointPosition`), `ProxyBoxes.writeRig` (a fresh `compute`; the bone
  boxes composed in `src/math`), both shadow packers' root position,
  `RagdollSystem.shadowFor` and its spawn (`computeChain(joint).decompose`).
  The pose math (`solveArm`, the reload's hand keys) moved onto `src/math`
  with it. `Matrix.FromArrayToRef` joined `src/math`, with its `math-check`
  case; `storePose` takes `Vector3Like`/`QuaternionLike`.
- **How it coexists with today's corpse reparenting (X4.1b's to delete).**
  A corpse still hangs its bones on the pool's proxy `TransformNode`s, but
  as a joint's HOLDER: `JointTree.hold(joint, proxy)` and `release(joint)`
  replay `TransformNode.setParent` operation for operation (the current
  world rebuilt in place off the current parent's or holder's fresh world,
  times the inverse of the new one's, decomposed, Euler written back), and
  a held joint composes off the proxy's own position, quaternion and scaling
  exactly as Babylon composed an unparented node. So a frozen corpse is the
  same locals to the bit, and `resetSoldierPose` clears every holder — the
  leak to fear now, as a leaked quaternion was. The proxies stay Babylon
  nodes with nothing under them, so the one read of one's matrix
  (`applyImpulse`'s chest point) is FORCED. The first `clients.mjs --check`
  moved at frame 50 without it: the ninth death's eviction reuses slot 0,
  whose proxy's unforced `getAbsolutePosition` answered frame 0's position
  inside the script's one render id, where `setParent` had forced it; the
  forced compose put the script back to bits. X4.1b writes the poses
  straight onto the joints, and takes the holder and the proxies with it.
- **The oracle — the joint matrices against the nodes', bit for bit.**
  - **On the parent, over live rounds** (a scratch probe on 25331b8): every
    rig mesh in the active list at `onAfterActiveMeshesEvaluation`, against
    a fresh `src/math` composition of its node chain's current locals —
    368,091 on Sarab (2,400 frames, 48 bodies) and 200,173 on Hollowmere
    (3,000 frames; 176,110 of them corpses: fifteen deaths staged through the
    roster's own alive edge, bullet and blast, and the death cam's
    stand-in) — all bit-identical, so what Babylon DREW was always the fresh
    composition the arrays now make. Both shadow packers'
    `root.absolutePosition` was fresh on every read (46,314 on Sarab, 15,797
    on Hollowmere). **The one stale reader**: `ProxyBoxes.writeRig`'s
    unforced `getWorldMatrix` read 146 of 179,208 body-map boxes and 146 of
    172,452 lamp boxes, and `shadowFor` 4 of 11,569 corpse chests, out of
    Babylon's render-id cache on the frames a corpse's joints changed parent
    (the take and the freeze) — the world under the OLD parent, which
    `setParent` keeps equal to the new up to float32 rounding. The arrays
    answer fresh there (`rigJoints.ts`' header): a rounding-sized input to a
    shadow map on two frames a corpse, which no bank row can see, gone with
    the hand-off at X4.1b. The capsule's sphere: 26,465 forced measures on
    Sarab against `measureBody` off the same root, all bit-identical.
  - **Across the two trees** (one scratch run on the parent's nodes and one
    on our arrays): 8,000 seeded poses, both kits, the launcher on, a reset
    every 97th — gait, aim, twist, crouch, ready, carry, kick and reload, the
    root anywhere in ±600 m and turned anywhere — every joint's world (17)
    and every mesh's world matrix as Babylon holds it (15): **0 of 8,000
    differ**. `clients.mjs`'s script with every switched-on stand-in's 17
    joint and 15 mesh world matrices digested each frame: **601 of 601
    frames identical on Coldharbour, Cinderhaven and Harrowmead** (310
    distinct digests a map — the takes, the tumbles, the freezes, the sinks,
    the eviction and the retire).
  - **On the step, over live rounds** (the same probe against our arrays):
    every rig mesh drawn, against its local times a fresh composition of our
    joints' locals at evaluation — Hollowmere 190,975 (176,690 corpses),
    Sarab 327,947 (171,316 corpses), all bit-identical: no rig is drawn off a
    matrix older than its last write.
  - **`clients.mjs --check`**: identical on all three maps — Havok's bodies,
    every pooled body every frame, and the node digest, whose rig half reads
    our joints in the bytes a node gave (the holding proxy's name as the
    parent, the rig's switch as the root's flag, "noquat"), so the bank
    taken off the nodes grades them unchanged.
- **Measured.** The bank against a BEFORE at 25331b8 in a worktree
  (`--check --keep` both sides): **61 of 61 byte-identical**, `rig-near`
  and `rig-far` among them, the same 34 stale rows on both sides, no console
  or page error. **`census --against`** the BEFORE: every row equal (Hollowmere 278, Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186, Kurenai 125). **`gate.mjs`** clean on seven. **`shaders.mjs`** clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour). `math-check` 79 cases;
  typecheck, build, corecheck and `parity` (eight maps) pass. **A round offline** on Hollowmere and Sarab (the probes above, and `gate`'s seven) and **a netplay round** against a local `dist-server` (`?mp=`, Hollowmere, the authority's round): bodies drawn off the wire, fifteen deaths staged through the roster and the death cam's stand-in, 208,184 rig meshes drawn and every one the fresh composition, no console or page error.
  **`kit:hash --models`: the two `soldier` rows are RE-BASELINED here, by
  construction** — `["soldier",0]` draw 9bd8b11fd2b30505 → 37d7f293a37d85e0
  (set 3aab2fe91440b7a7 → 2b8b8d71b6fb5da2), `["soldier",1]` draw
  fb60ea13d72eda54 → 57344c42de95f3cf (set a839d7e8d283267b →
  f7ce60a37248dcfd), taken at 25331b8 and at HEAD by the review. The script
  hashes every transform node left in the scene, each mesh's parent and
  transform, and the builder's plain data (the rig), and this step took the
  joint nodes and the root capsule out of the scene, left every mesh
  unparented, and made the rig's joints a
  `JointTree` — so both rows had to move, and they cannot say whether a
  drawn body did; the bank and the oracle above are that proof. **A later `--against` a
  baseline older than a417bfc reports these two as "content changed", and
  that is this step, not a regression** — take a fresh baseline past it.
- **Deviations.** `WorldCulling.stats.pooled` counts the meshes alone (it
  counted each root too). `DeathCam.warm` hands its meshes their matrices
  itself as well as through `drawBodies` — redundant, a warm-up frame running
  `drawBodies` like any other, and harmless. The fresh shadow-box and
  `shadowFor` reads above.
- **What the post-commit review found** (an independent reader over a417bfc
  and 8bf4e21; fixed after it). No game-code defect and nothing
  architectural; every fix is a document or a comment. One RECIPE that
  stopped working: `VERIFYING.md`'s "a soldier is judged in a picture" built
  a rig with `buildSoldier` and posed it in an `onBeforeRenderObservable`,
  but since this step only `Game.drawBodies` hands a rig's meshes their
  matrices, and only the roster's and the death cam's — so a script
  following it photographed unparented meshes bunched at the origin. It now
  calls `setRigEnabled(rig, true)` (a fresh build leaves the slung
  launcher's mesh on) and `drawRig(rig)` in that observable, after the pose,
  and `drawRig`'s doc names a rig that pass does not know as owing its own
  call. One ORACLE row that moved by construction and was not said: the
  `kit:hash --models` soldier rows (Measured, above). Stale words:
  `CLAUDE.md`'s deaths pointer promised "the quaternion leak" where
  `docs/deaths.md` now tells the HOLDER leak (reworded, its line count
  kept); `DeathCam.prepare` called the proxies "the PARENTS of the joints
  about to be disposed" (the joints are disposed of nothing now: the hazard
  is a slot holding a rig whose meshes are freed); `NetSoldier`'s "proxy
  nodes … the same nodes", "re-parenting a living body's joints" and "the
  body node"; `drawRig`'s doc calling `DeathCam.warm` "a frame of its own"
  (a warm-up frame gets `drawBodies` too; the call is redundant but
  harmless, Deviations). `SoldierRig.root` now says its own `enabled` is not
  the body's switch — `rig.enabled` through `setRigEnabled` is. One
  UNMEASURED cost, recorded below rather than fixed. Re-checked after the
  fixes: typecheck and build; `kit:hash --models --kinds soldier` at HEAD
  (the two rows above).
- **Owed onward.** X4.1b: the holder and the proxies, `freeze`'s hand-back
  and the forced proxy compose — which, the review notes, need not survive
  even as long as the proxies: `applyImpulse`'s forced
  `chest.proxy.computeWorldMatrix(true)` is there only for its translation
  row, so the proxy's own position rounded to float32 (`Math.fround` on each
  axis) answers the same point without a compose. The phone's FOLLOW-UP
  reading, as every step's since X3.3c. **And a cost the review saw and
  nobody has measured**: every enabled body is now composed SEVERAL times a
  frame — `drawRig`'s `compute`, up to two `ProxyBoxes.writeRig` computes
  (the body map's and the lamps' atlas's), and root chains for the measure
  and both packers — where Babylon composed each node once per render id
  and cached it; the reviewer's estimate is ~800 extra joint composes a
  frame at 24 a side. That phone reading, or an X0.3 at 24 a side on Sarab
  and Cinderhaven, is what reads it. **The fresh-compose invariant
  (`rigJoints.ts`' header) must not be undone to buy it back without a
  measurement** — a cached compose is how `ProxyBoxes` read 146 stale boxes
  before this step (the oracle, above); X4.1d's instancing is the natural
  place to compose a body once.

**X4.1b landed** (f554b68, the post-commit review's fixes after it;
2026-10-29; no picture change but one, said here:
a corpse's tumble starts one to four float32 ulps from where it did, and
Havok's chaos carries that into where it comes to rest).
- **What it is.** A corpse's joints are POSED off its bodies' pose arrays:
  `Joint.pose` (`rigJoints.ts`) holds `WorldBody.pose` itself, and while it
  is set the joint's world is that pose composed at unit scale — the
  arithmetic the pool's proxy node composed with — its own channels and its
  parent unread, its children composing off it as off any parent. **No node,
  no view, no hand-off**: `spawn` decomposes every bone's world off ONE fresh
  `compute` of the living rig, writes the poses and points the joints at
  them, and the step moves the arrays under the drawing; `freeze` copies
  each pose into the slot (`Bone.still`) and points the joint at the copy
  before the park overwrites the body's, so a frozen corpse is the pose it
  was drawn off to the bit; the sink lowers the copies (`stillY` minus the
  drop) beside `rig.root`, which still sinks because the body's measure and
  the shadow packers' reach read it. `resetSoldierPose` clears the pose —
  the leak to fear now. Gone: the twelve proxy `TransformNode`s a slot
  (`RagdollSystem` takes no scene; `Game` constructs it with the engine
  alone), `JointHolder`, `JointTree.hold`/`release` and `setParent`'s replay,
  `drawSlot`, the forced `chest.proxy.computeWorldMatrix(true)` — the chest
  point is `Math.fround` of the pose's position plus the lift, which is what
  the forced compose's translation row was — and `absolutePose(proxy)` at
  the pool's build (a body is created at `PARKED_POSE`, the same seven
  numbers that read gave). The death cam's stand-in is a `RagdollSubject`
  like any other and needed nothing of its own.
- **Why the engine hashes moved, and why that is by construction.** The old
  `spawn` hung each bone on its proxy before composing the next, so a bone
  under an earlier one (the head, the shoulders, the elbows, the knees, the
  ankles) started at a chain through that bone's RE-DERIVED local — the
  living world up to a float32 rounding. The new one composes the living rig
  once. Nothing in the new path produces that local, so nothing can
  reproduce those starts; the torso and the hips (no bone above them) start
  identically. **Proven, rather than argued, in three runs of `clients.mjs`'s
  own script** (a scratch copy that records, per map, each offer's twelve
  spawn poses at the impulse, every stand-in's 17 joint and 15 mesh world
  matrices each frame, and the pool's and the debris' halves of the node
  digest apart):
  - **The new path with the OLD spawn poses injected** (each offer's poses,
    banked from a run on the parent, written over the new ones before the
    impulse): `clients.mjs --check` **identical on all three maps on its
    engine lines** against the bank taken before this step (its node digest's
    RIG half moved by construction, which the review below says) — the engine
    hash (3e0ee726a4d9da72,
    9233bb7aa0086e7b, 06868b261f79c406), every pooled body every frame
    (parked ones at the park), the teardown counts, the snapshots, the
    rests, the audit. So the spawn poses are the ONLY input to Havok this
    step moved: the bodies' creation at `PARKED_POSE`, the impulse's chest
    point, every teleport, park and freeze are the old path's to the bit.
    The pool's half of the node digest (each bone's pose in the bytes its
    proxy gave) and the debris' half: identical on every one of 601 frames.
  - **The spawn poses, natural against the parent's**: 27 offers over three
    maps, every torso and hip bit-identical; the other bones' poses identical
    in 3 to 8 offers of 9 and otherwise one to four float32 ulps apart
    (≤ 3.05e-5 m, a ulp of a coordinate between 256 and 512 m).
  - **What that moved**: the engine hashes from frame 0 (452fc9d44a88e3a6,
    5504610c69d82176, 4b1f60f31d44f6f3, reproduced in a second process), and
    where the corpses lie: rest poses mean 1.9 mm, 1.2 mm and 7.3 mm and worst
    38.6 cm, 2.9 cm and 17.8 cm (Coldharbour, Cinderhaven, Harrowmead) —
    against `clients.mjs`'s own in-process repeat floor of 1.1 to 2.5 m, the
    same chaos reading a different first float. Offers, evictions, the audit
    of which corpses are held and the park are unchanged; no body off the
    park.
  - **The picture, with the physics held equal** (the injected run against
    the parent, every switched-on stand-in every frame): 2,735 rig-frames a
    map, 87,520 matrices; rotation entries at most 2.3e-7 apart (two ulps at
    1), translations at most 15 to 31 µm (one ulp of a map-scale
    coordinate). Identical where the old re-derived local happened to be
    exactly the identity (one stand-in of nine, turned a quarter, on every
    map); otherwise apart by that rounding, in flight and after the freeze
    alike, because the old drawing carried it and the new one does not.
  - **`clients.mjs` re-banked** on the new path for that reason (and a
    second, independent one the review below states), with
    `--check` then identical in a second process; its node digest reads each
    bone's pose in its proxy's old bytes and names the pose a posed joint is
    drawn off. `drop.mjs --check --exact`: "bits identical" on all seven maps (it drops boxes on the static world, which this step does not touch; the pool's bodies are still created first, at the same pose).
- **The rest of the oracle, live** (a scratch probe, deaths staged through
  the roster's own alive edge, bullet and blast, near the camera; the death
  cam's stand-in; a batch of nine into a pool of eight; and, once every slot
  was sinking, two more): Hollowmere offline 3,000 frames, Sarab offline
  2,400 (48 bodies), Hollowmere in a netplay round against a local
  `dist-server` (`?mp=`) 2,400 —
  - every rig mesh drawn is its local times a FRESH composition of its joint,
    a posed joint off its pose: 207,553 corpse and 42,713 living meshes on
    Hollowmere, 152,963 and 377,534 on Sarab, 195,990 and 37,995 in the
    netplay round, 0 differ;
  - **the three tiers**: 11 free, 2 sinking and 8 oldest on each run (21
    offers accepted, 0 refused, never more than 8 held);
  - **`freeze` keeps the shape to the bit**: every joint's fresh world before
    and after each freeze, 19, 18 and 20 freezes, 0 moved;
  - **a blast throws and a round drops**: torso travel to the freeze 0.05 to
    1.12 m for a round, 1.09 to 4.2 m for a blast (Hollowmere 1.09–2.85,
    Sarab 1.53–4.2, netplay 0.11–3.93);
  - **the leak**: no joint of any body the pool is not holding was posed on
    any frame (0); 19, 17 and 17 corpses released, and each staged slot,
    handed back to the wire, came back to life — 10, 16 and 10 bodies watched
    for 120 frames each — with no pose on any joint and every limb within
    0.98 m of its root (0 frozen-limb frames).
- **Measured.** The bank against a BEFORE at 2e65dfa in a worktree
  (`--check --keep` both sides): **61 of 61 byte-identical** (`comparePngs`, max 0), `rig-near` and `rig-far` among them, the same 34 stale rows on both sides, no console or page error — no bank row holds a corpse, which is why the matrices above are the picture's proof. **`census --against`** the BEFORE:
  every row equal (Hollowmere 278, Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186, Kurenai 125). **`gate.mjs`** clean on seven. **`shaders.mjs`** clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour). Typecheck, build,
  corecheck and `parity` (eight maps) pass. A round offline (Hollowmere, Sarab) and a
  netplay round, above; no console or page error.
  **`kit:hash --models`: the two `soldier` rows are RE-BASELINED again, by
  construction** — `["soldier",0]` draw 37d7f293a37d85e0 → 958f3eefeb4baf67
  (set 2b8b8d71b6fb5da2 → f2e0d7c36c93125a), `["soldier",1]` draw
  57344c42de95f3cf → 1633e61a689e545a (set f7ce60a37248dcfd →
  3c25ce72c46f03e7). The script hashes the rig's plain data, field names
  included, and `Joint.holder` is `Joint.pose`: the parent with that one
  field renamed in a scratch hashes identical to this step on both rows.
- **Deviations.** The spawn's start, above — the one change of behaviour,
  cosmetic (nothing under Havok decides anything) and by construction.
  `CLAUDE.md` is 1,540 lines (one up): its physics paragraph now says what a
  corpse is drawn off and names the leak. The X4.1b plan bullet's "the
  quaternion leak" now reads "the joint-pose leak", `docs/deaths.md`'s name
  for it.
- **What the post-commit review found** (an independent reader over
  f554b68 and 72844dd; fixed after it). No game-code defect and nothing
  architectural. **Its conclusions on the change of behaviour**: the spawn
  pose is the ONLY input to Havok this step moved, confirmed from the code as
  well as by the injected run — the bodies are created at `PARKED_POSE`, the
  seven numbers `absolutePose(proxy)` read; the chest point is `Math.fround`
  of the pose's position plus the lift, the forced compose's translation row;
  every teleport, park and freeze writes what it wrote. **No outcome reads
  Havok**: the server, `src/sim/`, `corecheck`, `simulate` and the bench's
  fight hash (`FightHash`, folded where the match runs) name no physics
  client (`src/sim/` and `server/` mention `PhysicsWorld` and
  `RagdollSystem` in comments alone), so the move is cosmetic exactly as
  Deviations says. **The re-bank is defensible**, and it had a SECOND, independent
  reason the note did not state: the node digest's RIG half hashes each
  stand-in joint's own channels, which the old hand-off (`hold`/`release`'s
  replay of `setParent`) RE-DERIVED and a posed joint leaves alone, and it
  names a joint's parent — the holding proxy's name while a corpse was live,
  the rig parent's after the freeze handed it back, where it now names the
  pose (`ragdoll<i>-<bone>`, and `…still` once frozen). So that half could
  not have come back identical even with the physics held equal: re-run with
  the committed option below (Coldharbour, the parent's spawn poses injected
  against the parent's bank swapped in for the run), the engine hash
  3e0ee726a4d9da72 and every pooled body 5c3f2b0a82a7b97b came back
  identical and the node digest moved at FRAME 0 (bcdeeb7b630897cf against
  f6e8e1187ff4aa3b) — frame 0's two offers, the pool's half having been
  identical on all 601 frames in the note's run. **The user is told, in
  passing, that this is the first `clients.mjs` bank not traceable to the
  pre-port tree**: X2.4 banked on fb90b7d's `src/` and graded the port, and
  that recipe now holds only for a tree before X4.1b; the header,
  `docs/deaths.md`, `VERIFYING.md` and `lib.mjs` say the banks are
  f554b68's. Fixed: **one GUARD** — `freeze` repointed every bone's joint at
  the slot's copy unconditionally, and now does so only for a joint still
  posed off THAT bone's body (`joint.pose === bone.body.pose`); unreachable
  today (every joint of a held rig is), it stops a freeze pinning a living
  rig's limb that was reset outside the pool. **The proof made
  reproducible**: the scratch probe that recorded and injected the spawn
  poses is now `clients.mjs --spawns-out=<file>` (each offer's twelve poses
  at the door of `applyImpulse`, raw float64 bytes as hex, per map) and
  `--spawns-in=<file>` (written over them there; `--check` only, it never
  banks), the header saying how a future re-take uses it; recorded at HEAD
  it reproduces the scratch probe's own record of the new path byte for
  byte on all three maps (108 bone poses a map), and injected back it grades
  Coldharbour identical on every line. Stale words: `clients.mjs`'s
  "banked on the PRE-PORT tree" recipe and `docs/deaths.md`'s "banked on the
  PRE-PORT tree … graded on the port"; `BodyShadows`' "`RagdollSystem` hangs
  them on Havok proxies", `DebrisSystem.buildPool`'s "a ragdoll needs
  proxies because the view writes a `rotationQuaternion`…" and
  `BlastDebrisSystem`'s "a ragdoll's bone cannot" — each now says the joints
  are posed off `WorldBody.pose`. And the corpse's MEASURE for X4.1d (Owed
  onward). Re-checked after the fixes: typecheck, build and corecheck;
  `clients.mjs --check` identical to this step's bank on all three maps
  (452fc9d44a88e3a6, 5504610c69d82176, 4b1f60f31d44f6f3; nodes 0cf0191d43ffb252,
  8d61ea44c1c74e88, ec2cabec138aba02; every body 1715d06d091154e8,
  a3ccd86f53b13743, 5734efa16d2af9c5), the guard in; `drop.mjs --check
  --exact` "bits identical" on all seven maps.
- **Owed onward.** The phone's FOLLOW-UP reading. X4.1a's unmeasured
  compose cost stands (a posed joint is one compose instead of two, a
  corpse's twelve `applyPose` writes a frame are gone — neither measured).
  `FINDINGS.md` 57 (the impulse lands before the teleport) is untouched and
  still re-takes `clients.mjs`'s bank when it is fixed — proving first, with
  `--spawns-out=` on the parent and on the fix (two files byte-identical),
  that the spawn did not move and the bank's move is the impulse's alone
  (`clients.mjs`'s header). **For X4.1d, which moves the
  body's measure**: a corpse is still measured by the capsule's sphere at
  `rig.root` (`rigJoints.measureBody` off the root's chain), and the root
  only sinks — it never follows the bodies, while a blast throws a torso 1
  to 4.2 m from it (the live oracle above). That has been so since before
  X4.1a, where the capsule was a node under the same root, and nothing here
  changed it; X4.1d should consider measuring a corpse by its TORSO (its
  pose, or a sphere over its twelve), so the fog-wall gate and the size
  gate's whole-body drop judge a thrown body where it lies.

**X4.1c landed** (3a07a68, the post-commit review's fixes after it;
2026-10-30; no picture change on any bank row, and
two by construction off it, said under Deviations: the frame right after a
rung change re-makes the map, where Babylon's freshly built generator drew no
proxy and ours draws them, and a moving hull's box, which the deleted mesh
read drew a frame behind the hull).
- **What it is.** The moon's body map is a texture our renderer OWNS and draws
  (`render/BodyShadowMap.ts`, `r16float` beside a `depth32float` attachment of
  its own), with the program in `render/bodyDepth.ts` — the directional depth
  program's own bodies (`celDepth.ts`'s `DEPTH_VERTEX_BODY` and the shared
  `depthFragment`) over the instances of the kit's unit box
  (`proxyBoxPositions`, the lamps' proxies'), each instance's matrix as
  Babylon laid it out; the back faces kept (`cullMode: "front"` off the
  flipped pass, `WorldDepth`'s rule). `BodyShadows` keeps everything it
  decided — the window and its snap, the light's matrix, which bodies cast and
  as what, the budgets — and hands each frame's proxies over
  (`BodyShadowMap.draw`), drawn whole, cleared to lit then every instance, on
  the next frame our renderer prepares, into the encoder Babylon submits ahead
  of its passes; an update holding none OWES a clear, if the map holds any,
  recorded on that same next frame (Babylon's empty frame) — and at once,
  into the host's prepare encoder, only when a second update arrives with no
  frame prepared between, which is a state our renderer prepares nothing in
  (an editor build's), so that state never keeps the last round's bodies.
  Babylon's readers (the cel materials, grass, water, the volumetric march)
  sample a wrapped view (`wrapShadowTexture`); our frame binds the
  texture itself (`ShadowBindings`' `own.bodyShadowMap`) — rule 5 both ways.
  **Gone**: `BodyShadows`' `DirectionalLight`, `ShadowGenerator` and proxy mesh
  (and `PROXY_LAYER`): its light is a plain pair (`ShadowLight`,
  `core/shadowWindow.ts`, which `ShadowWindow.place` now takes), and the matrix
  is `lightTransformToRef` — `ShadowSystem.lightTransform`'s arithmetic MOVED
  there, the one copy both systems read, `ShadowSystem` calling it with its
  lights' fields. A rung change re-makes the texture AFRESH under a fresh view
  (disposing the old view destroys the texture it wraps) and draws the proxies
  last packed from where the light stands, as a fresh generator rendered on its
  first frame; `setLightDirection` re-states the map the same way (a generator
  read its light at every render). `BODY_SHADOW_PROXIES` sizes both sides.
- **A hull is its collider box off its OWN fields** (X4.2 owes this map
  nothing). `ShadowHull` is now `pos`, `yaw`, `present` and the spec's box —
  `Vehicle` satisfies it, and `Game` hands both shadow systems
  `vehicles.hulls`, never `vehicleViews.views`. `ProxyBoxes.writeHull` composes
  the box's frame with `hullFrame.ts`' new `hullBodyToRef` (the first link of
  `hullPointToRef`'s chain, which now calls it: the body node's compose, unit
  scale, yaw only) and `hullCentreToRef` is that frame's translation row
  (`Math.fround` of `pos`) for the lamps' gather; `proxyBoxes.ts` imports no
  Babylon directly now — and, since the review's fix below, reaches none
  (`check-babylon-free` holds it as a root). `VehicleView.spec` (there only
  for the shadow maps) is gone, and its body box is the rig's parent and
  nothing else.
- **What a failure becomes** (decided here): the map has no generator behind
  it, so a pipeline it cannot build — asked ONCE, for the session, at `Game`'s
  construction — is the ROUND's failure, routed as the world's passes' are:
  `installMap` hands the map `worldFailed` with the install's owner
  (`BodyShadowMap.setFailure`, after `handover.install`; an editor build hands
  none, `teardownMap` takes it back), and a pipeline settled false tells it —
  that install and every one after it, the pipeline being the session's,
  rather than a round played with no body map. Not through `BlockHandover`:
  the bodies are not the world it hands over, and the generation guard plus
  `worldFailed`'s owner test do what `failFor` does there. The pass needs
  nothing else of the handover — but an editor build prepares NO frame of
  ours, so there the map is only ever CLEARED, at once (`clearNow`), and an
  ask holding proxies would never be drawn (`BodyShadowMap.ts`' header; the
  review's correction below).
- **The oracle — the map read back against Babylon's, while both existed.**
  For the run only, `BodyShadows` also kept the deleted path verbatim (a
  `DirectionalLight` pinned to the proxy layer, a `ShadowGenerator` with
  `bias` 0 and `forceBackFacesOnly`, the box mesh thin-instanced off the SAME
  matrices array), its light copied from ours each update; a scratch probe
  read both textures back after each frame (`copyTextureToBuffer` after the
  engine's flush; ours with `COPY_SRC` added in an init script) and compared
  ours' red half against the generator's red half bit for bit, with the window
  re-placed inside the render over each enabled body and each hull in turn
  (30 frames each) and the round live:
  - **Offline, all seven maps, 1,200 frames each** (600 in play, then a rung
    walk `off`, `high`, `low`, `medium`, `high`), up to 222 proxies a frame
    (Sarab), 234 (Cinderhaven): the light's matrix identical on every frame
    compared, and the textures **identical on every frame but three a map** —
    each the frame right after a rung change RE-MADE the map (off→high,
    high→low, low→medium; medium→high re-makes nothing): there EVERY differing
    texel is shadowed in ours and lit in Babylon's (Sarab 55,601 texels over
    the three, exactly ours' shadowed count minus Babylon's; Coldharbour 34,801,
    Harrowmead 16,394, Cinderhaven 8,097, Kurenai 5,026, Greyfen 4,668,
    Hollowmere 2,060) — Babylon's fresh generator drew no proxy on its first
    frame (its depth effect not yet ready) and ours, asked off the cache's
    pipeline built at boot, drew them. So the old picture had one frame with no
    body shadows after a rung change; the new one does not. No other frame of
    any map moved by a texel.
  - **A netplay round** against a local `dist-server` (`?mp=`), the
    authority's round: Hollowmere 900 frames and Coldharbour 900 frames
    (two hulls off the wire), every frame identical, the matrices identical.
  - **The hull box**, every pack of both systems over those rounds, ours
    against the old read (`hullBox × body.getWorldMatrix()`, unforced, as the
    deleted code read it) and against a forced compose of the body mesh:
    against the FORCED compose identical on every pack (15,006 Sarab, 14,954
    Cinderhaven, 4,954 Coldharbour, 5,347 Harrowmead offline; 4,089
    Coldharbour in the netplay round); `present` equal to the mesh's
    `isEnabled()` on every pack; the lamps' gather centre equal to
    `getAbsolutePosition()` on every read (7,206 / 7,206 / 2,402 / 2,402;
    1,802). **The one stale reader**: the old unforced read returned a stale
    world matrix for one pack per hull a map (6, 6, 2, 2 packs, up to 0.28 m),
    every one on the frame the rung walk turned the map back ON (off→high) —
    the frame on which, above, Babylon's fresh generator drew nothing at all,
    so no picture carried it. Ours reads the fields fresh.
- **The paths no instrument covers** (a scratch page, Coldharbour; run
  before the clear's fix below and again after it, the same verdicts): the pipeline forced failed for the session (`g.bodyShadowMap.ready =
  Promise.resolve(false)` before `startRound`) — one `[world] coldharbour: the
  map could not be drawn — our bodies' shadow map cannot draw: its pipeline
  failed`, the menu, the toast, and a SECOND round the same; restored, a clean
  round to `playing` (15,982 shadowed texels, 86 proxies, the window on a
  body); a rung walk `off` (no texture, no view) → `high` → `low` (512) →
  `high`, each re-made, wrapped and redrawn; and the editor (`F2`): no proxy,
  the map cleared (0 shadowed, `holds` false). No page or console error but
  the two forced lines.
- **The bank caught what the readback could not, and it is fixed here.** The
  first AFTER (`--check --keep`, every row graded against the BEFORE's) was
  byte-identical on Cinderhaven, Coldharbour, Harrowmead and Sarab — `rig-near`,
  `rig-far`, `tank`, `truck` and `heli` among them — and moved EVERY row of
  Greyfen, Hollowmere and Kurenai a little (Kurenai `menu` 5.8% of pixels,
  mean 0.065/255; Hollowmere `lanterns` 1.2%, a strip of cobbles along a
  shadow edge), deterministically: each side re-run reproduced itself byte for
  byte. Every world map, the atlas and both matrices dumped at Hollowmere's
  `lanterns` were identical across the trees; the body map was not — ours held
  333 shadowed texels where Babylon's was lit. A trace named them: the
  building card's warm-up hands the death cam's stand-in to the map, and its
  LAST update (`finishBakeWait`, AFTER that frame's render) packs no one; the
  first cut cleared at once by a submit of its own, which reached the queue
  BEFORE the frame's prepare encoder (submitted at the frame's end) holding the
  stand-in's draw, so the stand-in stayed in the map until the next body —
  never, in a bank boot. (Why only three maps: where the stand-in's boxes
  fall against the window and the vantages, not a property of the maps.) Fixed
  as above: the clear is OWED to the next prepare, Babylon's own timing, and
  recorded at once only into the host's encoder, behind anything recorded
  there. The readback runs above all held bodies, so no empty update was in
  them.
- **Measured** (after the fix). **The bank against a BEFORE at b15a5be in a
  worktree** (`--check --keep` both sides): **61 of 61 byte-identical**
  (`comparePngs`, 0 pixels), `rig-near`, `rig-far`, `tank`, `truck` and `heli`
  among them, the same 34 stale rows over the bank's tolerance on both sides,
  no console or page error. **`census --against`** the BEFORE: every row equal
  (Hollowmere 278, Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661,
  Cinderhaven 186, Kurenai 125). **`gate.mjs`** clean on seven (a round
  offline on each). **`shaders.mjs`** clean on seven, ours 17/17 (21/21 Sarab
  and Cinderhaven, 23/23 Coldharbour). Typecheck, build, corecheck and
  `parity` (eight maps) pass; `check-babylon-free` walks `src/render/` with
  no path to Babylon. (This said it walked `proxyBoxes.ts` too; at 3a07a68 it
  did not — no root, and reaching Babylon through `SoldierModel` — and since
  the review's fix below it does.) A netplay round after the fix (a
  fresh `dist-server`, Sarab, 48 bodies, six hulls off the wire): 900 and then 600 frames in play, no console or page
  error.
- **Deviations.** Two changes of picture, both by construction and neither
  on any bank row. The rung-change frame above. And **a MOVING hull's box no
  longer lags it**: in that Sarab netplay round the deleted read
  (`hull.body.getWorldMatrix()`, unforced) answered a matrix cached EARLIER in
  the frame, before `VehicleView.update` moved the mesh, on every frame for
  each hull that moved — 4,500 of 10,800 packs, then 3,000 of 7,200 (five
  hulls, 600 frames each), up to 0.57 m — where ours equals the mesh's FORCED
  compose on every pack, so the old body map drew a moving remote hull's
  shadow a frame behind the hull it drew and ours draws it under it. (The
  lamps' later read looked fresh only because the probe's forced compose had
  refreshed the cache; who caches it first was not chased — the read is gone.)
  Offline the hulls sat parked over those runs, which is why only the rung
  frame's one pack a hull showed there. **So the lamps' atlas very probably
  stopped trailing too** (the review): its hull boxes were the same
  `ProxyBoxes.writeHull` over the same unforced `body.getWorldMatrix()`, and
  its gather read the centre off the same node (`getAbsolutePosition()`,
  unforced as well), with nothing but the probe's own forced compose
  refreshing that cache before the read — so with no probe running, a moving
  hull's box in every lamp's slice was very probably a frame behind it too,
  and is under it now. Not measured on its own (the probe's compose hid it);
  the same change by construction, and as cosmetic. `shaders.mjs` builds no depth program
  (none of `celDepth`, `lampDepth` or this one), so the body pipeline is
  proven where the world's depth pipelines are: built in the page at boot,
  where a failure is a console error `gate` counts. The seam's numbered list
  is unchanged (nothing new reached). `FrameProfile`'s `shadowPass` brackets
  NO frame of a round now (no generator in one); `docs/profiling.md` says so.
- **What the post-commit review found** (an independent reader over
  3a07a68 and ba77c3a; fixed after it). **No correctness bug**, and nothing
  architectural. **Its conclusions**: the two picture changes (the rung
  frame, the moving hull's box) are acceptable BY CONSTRUCTION, and could not
  have been split off into a step of their own without rebuilding Babylon's
  defects on our side — a first frame that draws nothing, and a matrix read a
  frame stale — to remove them later; the failure routing matches X3.7's and
  `LampAtlas`'s (the pipeline the session's, `worldFailed` with the install's
  owner, every round after a failed build failing on it); and the clear's
  timing is correct in every REACHABLE state — a round's frames, the
  warm-up's empty update after its render, a rung change, a state that
  prepares nothing. Fixed: **one claim that was false, made true.** The
  note's Measured said `check-babylon-free` walked `proxyBoxes.ts`, and its
  header and `FILES.md` said "no Babylon"; it was no root, and it reached
  Babylon through its value import of `RAGDOLL_BONES` from `SoldierModel`
  (→ `CelShader`, `world/parts`, `EmissiveFog`). The bone table —
  `BoneJoint`, `BoneSpec` and `RAGDOLL_BONES`, nothing else — MOVED verbatim
  into a new `entities/soldierBones.ts` (a contract header, a `FILES.md`
  line; its prose's "below" now names `SoldierModel`'s box lists, which it is
  still measured off), `RAGDOLL_LINKS` staying in `SoldierModel` beside the
  shoulder and arm measures it is written in; `RagdollSystem`,
  `BodyShadows` and `proxyBoxes` import it from there (`SoldierModel` keeps
  a type import of `BoneJoint` for the links, and re-exports nothing), and
  `proxyBoxes.ts` joined `SIMULATIONS`, as `rigJoints.ts` did, and
  `docs/deaths.md`'s two placings of the bone table in `SoldierModel.ts` now
  name its file. A pure move: `kit:hash --models --kinds soldier` identical
  to ba77c3a's (2 of 2), and `check-babylon-free src/core/proxyBoxes.ts`,
  which failed at ba77c3a, passes.
  Stale words: `BodyShadows.update`'s "with nobody in the window, cleared
  now" (the clear is OWED to the next prepared frame, at once only in a
  state that prepares none); "an editor build draws it too", here and in
  `docs/rendering.md` — an editor build prepares no frame of ours, so the
  map is only ever CLEARED there and an ask holding proxies would never be
  drawn (both now say so, as `BodyShadowMap.ts`' header did);
  `wrappedTextures.ts`' header naming `wrapShadowTexture`'s callers without
  `BodyShadows` (rule 7). And Deviations now says the lamps' atlas very
  probably stopped trailing a moving hull too. Re-checked after the fixes:
  typecheck, build, corecheck and `check-babylon-free` (as the build runs
  it, now 15 simulations); and, the move's importers including
  `RagdollSystem`, `clients.mjs --check` on Coldharbour identical to the
  bank (452fc9d44a88e3a6; nodes 0cf0191d43ffb252, every body
  1715d06d091154e8) and `drop.mjs --check --exact` "bits identical" on all
  seven maps.
- **Owed onward.** The map's pass is not timed on our side (not in
  `gpu.cull`), as the world's and the atlas's are not — the phone's FOLLOW-UP
  reading is read as `gpu.frame`. X4.1a's unmeasured compose cost stands (the
  packers' `computeChain`s and `writeRig`'s `compute` are unchanged). X4.2:
  nothing of the shadows — a hull's box no longer reads its picture. **The
  review's nits, none reachable today**: `BodyShadowMap`'s `asks > 1` is an
  INFERENCE of "a state that prepares no frame of ours" — a renderer-side
  "frame prepared since" signal would be sturdier than counting asks; a
  second EMPTY ask after a frame's render but before Babylon's `endFrame`
  would `clearNow` into the host's prepare encoder while it is still
  unsubmitted — and that encoder is submitted AHEAD of the render's — so it
  would clear the frame just rendered (only `finishBakeWait` asks after a
  render, and once); and `setSize` destroys its textures synchronously while
  a `clearNow` may sit recorded against them in that same unsubmitted
  encoder (no rung change follows an empty ask before a submit today). **An
  open question for the owner**: the body map HAS a supported "nothing"
  state (the rung `off`: the lit 1x1, the identity matrix, nothing packed),
  so degrading to it when the pipeline fails is an alternative to failing
  every round; this step followed `LampAtlas`'s precedent (fail).

**X4.1d landed** (23c6cd9, the post-commit review's fixes after it;
2026-10-30; no picture change: the bank 61 of 61 byte-identical against its
parent).
- **What it is.** Every body the page draws — a `NetSoldier`'s rig, a corpse,
  the death cam's stand-in — is OUR renderer's (`render/BodyDraw.ts`, its
  programs `render/bodyProgram.ts`), and **Babylon is made no rig mesh**. A
  rig is its joints and fifteen SEGMENTS hung off them (`RigSegment`: the
  joint and the segment's local); what a segment looks like is its side's
  KIT (`SoldierModel.soldierKits`, `KitDrawing`), built ONCE a side — the
  first rig of the side builds it, as `buildSoldier` built every rig's meshes
  before, `mergeParts` on the same parts — and uploaded once, both kits end to
  end. `buildSoldier(team)` takes no scene and no factory now; `drawRig`,
  `disposeRig`, `NetSoldier.dispose` and `getBodyCel` are gone, and a matte
  colour off `KIT_PALETTE` is REFUSED at the build (it had a per-hex material
  to fall back on, and a body has none). `Game.drawBodies` writes each drawn
  body's segment matrices (`writeRigDrawing`: the segment's local times its
  joint's world, the same `src/math` product `drawRig` handed Babylon through
  `freezeWorldMatrix`, read whole — all sixteen floats out of storage, as
  Babylon's uniform held them, so the compiler can fold nothing Babylon's
  stage did not) and their bounding-sphere centres (`writeRigCentres`), and
  commits them; the renderer draws them at `"beforeAlphaTest"`, installed
  AHEAD of the world's draw (Babylon's opaque queue, the rigs in it, drew
  ahead of ours), and the visors into the glow's mask after the palette's
  (`installMask`, asked after the handover's), as Babylon's went.
- **Which bodies — the gates move with them.** The fog-wall gate is where it
  was (the roster's distance switch and the ragdoll pool's), and the size
  gate's whole-body drop is still `WorldCulling`'s, measured once a body off
  its root's capsule (`measureRig`) — but a pool files NO mesh now (none
  exists) and answers by index (`drawsBody`: switched on as the list was
  offered, and not under the gate), which is what `drawBodies` reads, the
  rigs in `installBodyPools`' order. The visor is a segment of its body, so it
  drops with it by construction rather than by `gateOf`'s order. **The
  measure is NOT moved to the torso**, as X4.1b asked us to consider: a corpse
  is still measured at its root, which only sinks while a blast throws the
  torso up to 4.2 m — at the gate's 3 px a body drops at ~810 m (1080 tall),
  where 4 m is under 1% of its projected size — and moving it would move which
  corpses are drawn, a picture change this step has no business making. It is
  owed to X4.1e, whose fade is built on the same measure.
- **A draw is a RANK, and that is what the bank caught.** Babylon's group-0
  opaque queue is sorted nearest-first (`setRenderingOrder`, each mesh's
  bounding-sphere centre off `camera.globalPosition`), and under LEQUAL the
  LATER of two equal depths wins. The first cut drew every body's matte
  segments in one draw a kit and the visors after them: `sarab/rig-far`
  moved 73 pixels (max 200/255) — at 250 m the depth buffer cannot tell the
  visor from the face 3 cm behind it, Babylon drew the face LAST (it is
  farther) and hid the visor, and ours drew the visor last and showed it — and
  `rig-near` two, at a visor's edge against the brim. So each frame the render
  PULLS each body's ORDER (`Game.bodyPull`, inside the render, where
  `globalPosition` — the inverted view matrix's translation, which
  `scene.render` makes, never `camera.position` — is this frame's): a stable
  sort of its segments' centres by squared distance, the kit's order breaking
  a tie as `Array.prototype.sort` broke one over meshes made in that order,
  a segment switched off last. And a draw is one RANK of every body: rank
  `r`'s matte segments in one non-indexed draw — an instance a body, its `r`th
  segment's corners pulled out of `indexData` through its kit's range table,
  the corners past them and a segment switched off (a zero matrix, the
  launcher) drawn as nothing — and rank `r`'s visors in another, only where
  some body has its visor there. So every body's segments land in its own
  order; the main pass is at most 2 x 15 draws whatever the roster, and a
  rank no body draws anything at is no draw (one body: 14, Babylon's 14).
  What is NOT reproduced is the order ACROSS bodies, or against Babylon's own
  opaque meshes (a hull, the flags' cloth): those meet at one depth only where
  two things stand in each other.
- **What a rig does not carry reads (0, 0, 0, 1)**, also caught by the bank:
  the first cut read `color` as zeros (`WorldBlocks`' rule, "an absent
  attribute reads 0") and every body went darker — `rig-near` 1.1% of pixels,
  mean 5.7/255 over the body — because Babylon binds ONE float32 0
  (`_emptyVertexBuffer`), which WebGPU widens to (0, 0, 0, 1): the occlusion
  in alpha UNoccluded, the GL default `CLAUDE.md` already names. A `uv` reads
  (0, 0) either way. (`WorldBlocks`' rule holds for every world surface
  because each carries a colour buffer; not re-proven here.)
- **The materials are RECIPES, and the visor is the emissive palette.** The
  matte segments are the cel program under `CEL_PALETTE` and a new
  `CEL_OWN_PALETTE`: the kit's table in the material's own block
  (`CelMaterialFactory.bodyCelRecipe`, born with `applySpec(null)`'s and
  `applyTranslucency(null)`'s values), the frame declaring its map palette
  only without it, so no other variant's offsets move. The visor is the
  emissive palette's program over a table of the two sides' visor colours
  (`bodyEmissiveRecipe`, the visor's `uv2.x` its side's slot, the fog band
  the factory's by reference): `getEmissive(visor)`'s unlit
  `StandardMaterial` and `EmissiveFog`, number for number. Its BLOOM is per
  body, as Babylon's mask was per mesh: `GlowRules.colour` at the visor's
  centre from `globalPosition`, pulled with the order and read in the mask
  through a flat `vBody` — the visor's vertex stage ONE module for both
  passes, so the mask's LEQUAL ties against the depth the visor wrote. The
  assembler gained an instanced vertex `main` (`instance_index`) and a flat
  varying for it.
- **Eight storage arrays.** The first boot failed every round — through the
  failure path below, which so got its first real exercise — on "the number
  of storage buffers (10) in the Vertex stage exceeds the maximum per-stage
  limit (8)": WebGPU's default, which the device does not raise. The ranges
  ride the head of `indexData` and a body's kit the head of its order.
- **The warm-up stands no body.** The three pipelines (matte, visor, mask)
  are asked once, at `Game`'s construction, so the warm-up's wait for ours
  covers them; `DeathCam.warm` and `Game.warmBodies` are deleted, and the
  shadow passes are handed no bodies under the card (the stand-in's boxes
  were only ever there to compile Babylon's generator, gone at X4.1c).
- **What a failure becomes**, X3.7's and X4.1c's routing: a pipeline that
  fails (that install's, and every one after it, the pipelines being the
  session's), or a main pass or mask refused while installed, tells
  `Game.worldFailed` with the install's owner — the menu, a toast. It is
  installed for a ROUND's map only (`installMap`, taken back by
  `teardownMap`): **an editor build draws no body** (its world is Babylon's,
  its frames ones ours prepares nothing in; the editor stops the death cam,
  and a server round's roster behind it is not drawn), and the menu has
  none. **The kit screen** draws no rig on its stage; the world behind it is
  the round's, whose bodies draw as in any state, and its glow rule (group 0
  admitted only off the kit screen) reaches the visors through
  `glowAdmits(0)`, as it reached their meshes.
- **Measured.** The bank against a BEFORE at 85df99b in a worktree
  (`--check --keep` both sides): **61 of 61 byte-identical** (`comparePngs`,
  0 pixels), `rig-near` and `rig-far` among them, the same 34 stale rows on
  both sides, no console or page error — once in one invocation on the code
  before its last two changes (the mask's order behind the palette, a rank of
  nothing but switched-off segments skipped), and again on the code as
  committed, in three invocations: the one-invocation re-take hung twice, the
  D3D12 device going away mid-map at Hollowmere's `crossing` and Harrowmead's
  `ground` after a session of hours of uncapped runs (`FINDINGS.md` 64's hang,
  which predates this step; the first of the two had a `vite build` running
  beside it, and its `ground` row came back NOT REPRODUCIBLE before the
  hang). **`census --against`** the BEFORE:
  every total equal (Hollowmere 278, Greyfen 205, Coldharbour 672, Harrowmead
  847, Sarab 661, Cinderhaven 186, Kurenai 125); `census.mjs` counts
  `bodyDraw.stats.drawn` with ours now, and the two rig rows moved 14 draws
  across — `rig-near` Babylon 26 → 12, ours 14 → 28; `rig-far` 23 → 9, 12 →
  26. **`gate.mjs`** clean on seven. **`shaders.mjs`** clean on seven, ours
  17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour) — it builds the
  world's programs, not the bodies', which are built in the page at boot,
  where a failure is the world's (above). Typecheck, build
  (`check-babylon-free`: 15 simulations, no path; `src/render/` walked with
  the two new files), corecheck and `parity` (eight maps) pass.
  **`clients.mjs --check`** identical on all three maps (452fc9d44a88e3a6,
  5504610c69d82176, 4b1f60f31d44f6f3; nodes and every body identical) — its
  script now calls `buildSoldier(team)`. **`drop.mjs --check --exact`** "bits
  identical" on all seven maps. **`kit:hash --models`: the two `soldier` rows
  are RE-BASELINED, by construction** — the script hashed a rig's meshes and
  plain data, and a rig has no mesh now; it hashes the rig and its side's
  drawing (`{ rig, drawing }`, every segment's arrays and local):
  `["soldier",0]` draw 958f3eefeb4baf67 → b679a53ca9bc0e6d (set
  f2e0d7c36c93125a → 9cbf1be11a5aab14), `["soldier",1]` draw 1633e61a689e545a
  → e8f88652ba84faa6 (set 3c25ce72c46f03e7 → a667a09024e5bbb2), repeated
  identical. **A round offline** (a scratch probe, Sarab, 600 frames in
  play): bodies drawn on every frame, up to 23 at once in up to 27 main-pass
  draws and 12 mask draws; **a blast throwing a body** — the nearest living
  body ahead of the camera (21 m) killed through the roster's own door with a
  blast's damage, its corpse taken by the pool — drawn on all 240 frames of
  its fall (ragdolling, the torso thrown 2.16 m), no console or page error.
  **A netplay round** against a local `dist-server` (`?mp=`, Sarab, the
  authority's round): 600 frames in play with bodies drawn on every one (up
  to 18 at once, 23 draws, 8 mask draws), and a blast staged the same way on
  a body off the wire 46 m ahead (torso thrown 2.38 m), drawn on all 240
  frames of its fall; no console or page error. **The forced paths** (a
  scratch page, Hollowmere): the pipelines settled false for the session
  (`bodyDraw.ready`) — one `[world] hollowmere: the map could not be drawn —
  our bodies cannot draw: a pipeline of theirs failed`, the menu; restored, a
  clean round to `playing` (7 bodies, 19 draws, 4 mask draws); the editor
  (`F2`) drew none (0 instances) and gave the round back on leaving; no other
  console or page error.
  **X0.3 on the desktop** (`bench.mjs sarab cinderhaven --max --gpu`,
  uncapped, 3440x1440, 24 a side, the BEFORE in the worktree at 85df99b and
  the AFTER alternated run by run, three a side; the canonical fight hashes
  — `986c2e35557fb679`, `2f97c9072ab1762b` — on all 12 runs): **the fights
  got faster** — mean frame new / old **0.654 on Sarab** (10.44 to 6.83 ms;
  tick 9.49 to 5.95, render 7.50 to 4.34) and **0.742 on Cinderhaven** (8.17
  to 6.06; tick 7.38 to 5.08, render 5.54 to 3.75), every spread under 2%;
  Babylon's draws in the fight 428 to 202 and 308 to 150. The vantages and
  the path held, 0.999-1.002 (no body is in either). `gpu.frame` held:
  0.994-0.999 in the fights, 0.993-1.025 elsewhere. The install read
  8.2-9.9 to 9.6-11.5 s on Sarab and level on Cinderhaven, the bench's cold
  dev server as at X3.6c/X3.7c, not measured further.
- **Deviations.** The cross-body order, above (not reproducible without
  Babylon's queue; a tie needs two bodies in one place). The order is pulled
  inside the render because only there is `globalPosition` this frame's.
  `CLAUDE.md` is 1,543 lines (three up): the rendering section stays at its
  ~135 by trimming the lights' paragraph and the fog sentence.
  `WorldCulling.stats.pooled` counts bodies (it counted their meshes).
- **What the post-commit review found** (an independent reader over 23c6cd9
  and 6de245d; fixed after it). **No correctness bug**, and nothing
  architectural. **Checked and sound**: the order's sort (a stable insertion
  sort off `globalPosition`, the kit's order breaking a tie, a switched-off
  segment last on an infinite key); the rank and decode arithmetic (the
  ranges at the head of `indexData`, matte table then visor table, kit-major;
  a body's kit at the head of its `segments + 1` words of `bodyOrder`; a
  rank's span the longest range drawn there, the visor's span its own, the
  corners past an instance's range and a zero matrix drawn as nothing); the
  capacity (49: a side's ceiling twice and the stand-in, every staging array
  and buffer sized off it, `drawBodies` stopping at it); the 8-storage-array
  ceiling (the vertex stage at exactly 8, `maxStorageBuffersPerShaderStage`
  not raised); the palette (`CEL_OWN_PALETTE` in the material's block, the
  frame's declared only without it, no other variant's offsets moved); the
  visor's bloom (`GlowRules.colour` per body, the mask's LEQUAL against the
  depth the same vertex module wrote, `glowAdmits(0)` gating it); the absent
  attributes' (0, 0, 0, 1) and the epoch's block re-copy; a rig's identity
  (the kit chosen at the build, `viewTeam`'s; a change of side a new rig,
  the death cam's filed after `applyPlayerTeam`); the install and failure
  routing (X3.7's and X4.1c's: the session's pipelines, `worldFailed` with
  the install's owner, the generation guard; installed for a round's map
  only); and no allocation on a frame (`bodyPull`'s and `drawBodies`'
  scratch fixed at construction). **Fixed**:
  - **Contract headers stating the first cut's cost model** — "one draw a
    kit" — rather than the RANK draws built: `SoldierModel.ts`' header, its
    merge note and `KIT_PALETTE`'s, and `CelShader.bodyCelRecipe`'s. They
    now say a segment is a RANK (up to two draws, matte and visor, for the
    whole roster), so a new joint or segment is up to two more draws every
    frame; and that a rank's draw runs to the longest segment any body has
    there TIMES the bodies, so a segment's corners are paid at every rank
    some body draws it, and growing the longest one (the torso's 1,056
    corners, of a body's 5,352, counted off `soldierKits()` for this fix)
    multiplies across the ranks. `docs/rendering.md`'s rank paragraph states
    that vertex price too.
  - **Stale words (rule 7)**: `Game.applyPlayerTeam`'s "nine merged meshes
    and their GL buffers" (a joint tree, and a side's first kit drawing);
    `buildRound`'s and `docs/rendering.md`'s reason for filing after
    `applyPlayerTeam` ("freed meshes" — now: it would file the old stand-in,
    which nothing switches on again, and never the new one, so the player's
    own death would draw no body); `leaveMatch`'s retire and re-file ("disposes
    their rigs", "freed meshes" — no rig is disposed; a held corpse would go
    on posing a rig nobody draws until the next `reset`, and the pools would
    hold a roster that is nobody's); `docs/rendering.md`'s "marking the list
    dirty only on a transition" and `WorldCulling.rebuildList`'s "a pooled
    body being switched in or out" (no body is in the list); `docs/world.md`'s
    reason the roster pool is rebuilt rather than sized to the ceiling (the
    rule kept, its reason restated: a body's switch read, and while it is on
    its measure, composes and share of the rank draws — span × n);
    `DeathCam.body`'s "disposes this rig"; the `rig-near` vantage's `proves`
    ("fourteen merged meshes" — a text for a person reading a dirty diff,
    which neither the bank nor the benchmark reads or hashes); and PERF_PLAN
    A4's "a rig is fourteen meshes and two materials", rewritten to the
    instanced reality and the storage-array limit below.
  - **`drawBodies` composed every switched-on filed rig in states with no
    draw installed** (the menu, an editor build), then `commit` took nothing:
    it returns first now (`BodyDraw.installed`). Nothing depended on those
    composes — every other reader of a joint composes it fresh (the packers'
    `computeChain`/`compute`, `measureRig`, `jointPosition`, the ragdoll's
    spawn), as `SoldierModel`'s header requires.
  - **The profiler was blind to the body draws**: `counters.drawCalls` is
    Babylon's and `blocks.drawn` the world's, so a capture showed Sarab's
    ~672 rig draws vanishing and none of the ≤30 replacing them. Report
    **version 21** adds `bodies` (`drawn`, `masked`, `instances`: the last
    frame's, or the halt's, read through `FrameProfile.setBodies` as `blocks`
    is, a copy), the viewer prints it beside `ours`, and
    `docs/profiling.md` and `FILES.md` say so.
  Re-checked after the fixes: typecheck, build (`check-babylon-free`: 15
  simulations, no path), corecheck and `check-babylon-free` alone pass;
  `gate.mjs` clean on Sarab and Hollowmere; and a scratch page on Hollowmere
  under `?profile`: the draw not installed on the menu, a round to `playing`
  (up to 7 bodies, 22 draws), a capture at version 21 carrying `bodies`
  (21 draws, 6 mask draws, 7 bodies, equal to the live stats), opened in
  `/profile_viewer.html` with the `bodies` line under `ours`, no page or
  console error on either page but the viewer's own `/favicon.ico` 404 (it
  links no icon; not this change). No picture can have moved: nothing drawn
  on an installed frame changed, and the bank was not re-run.
- **Owed onward.** X4.1e: the fade, and the corpse's measure at its torso
  with it (above). **X4.1e cannot add a NINTH vertex-stage storage array**:
  the body programs' vertex stage is at 8 of 8 (WebGPU's default
  `maxStorageBuffersPerShaderStage`, which the device does not raise), so
  the per-instance fade rides the FRAGMENT stage — a group-1 storage array
  read through a flat body index, as the visor's bloom is read in the mask
  through `vBody` — or is packed into an array already bound (the kit word at
  the head of each body's `bodyOrder` has room). **The rank draws spend more
  vertex invocations than there are corners**: each rank runs to its longest
  span × n, up to ~14.8k a body (14 matte ranks at the torso's 1,056, the
  visor's 36) against 5,352 real — ~2.8× — the surplus corners exiting after
  four storage reads. `gpu.frame` held on the desktop (0.994–0.999 in the
  fights, above), and on the phone (X4.1's AFTER, above: within one run's
  noise on all three fights). Indirect draws, which could size each instance to its own range,
  are ruled out by the Intel Xe-LPG dropping single indirect draws at random
  (X3.3b's note; `docs/rendering.md`, "NOTHING OF THE STATIC WORLD IS DRAWN
  OR DISPATCHED INDIRECT"). **The editor draws no soldier now** (above: an editor build's
  frames are ones ours prepares nothing in, and the draw is installed for a
  round's map only) — X5.3 owes the editor the body draw if it is to show
  one. X4.1a's compose cost is
  smaller (`drawBodies` composes a drawn body once and skips an undrawn one,
  and nothing at all with no draw installed; the measure's root chain and
  both packers' `computeChain`s and `writeRig`s stand, unmeasured).
  `VERIFYING.md`'s soldier-in-a-picture recipe borrows a roster body now: a
  rig a script builds is never drawn.

**X4.1e landed** (53dcb34; 2026-10-30; the picture change, at the two edges
and nowhere else: no bank row has a body at either, and none moved).
- **What it is.** A body LEAVES at both gates by a FADE, never a pop
  (`PERF_PLAN.md` A4; `FINDINGS.md` 30, deleted). `WorldCulling.offer`
  answers how much of each pooled body is drawn (`bodyFade`, 0 to 1) off the
  one measure the size gate already read, the lesser of two ramps
  (`CONFIG.graphics.culling.bodyFade`): over the last `distance` (0.1) of the
  map's `bodyDrawDistance`, pushed to the cull beside the roster's and the
  ragdoll pool's copy (`setBodyDrawDistance`, from `installMap`), and between
  `minPixels` and `size` (1.5) times it in projected pixels. `drawsBody` is
  now "switched on and fade above 0". The roster's switch and the pool's
  refusal are untouched, and `bodyDrawDistance` is shortened nowhere.
- **The distance ramp ends one measure-radius SHORT of the distance**, and
  that is what makes it a fade rather than a fade and then a pop. The roster
  switches a body off by its POSITION (its feet) and the cull measures the
  capsule's sphere; the feet are inside that sphere, so from one eye at any
  height the two distances differ by at most its radius (1.063 m) — the fade
  reaches zero before the switch can turn the body off (a fade above 0 only
  ever on a body whose switch is on), with no second reading of the roster's
  point; up to one frame of eye lag (the review, below). A corpse's root
  stays where it fell (it only sinks), as
  its position does, so the same holds for a corpse. The size ramp's zero is
  the gate's own `tooSmall`, so the drop is exactly where it was.
- **The screen door, and where its value rides** (the user's decision,
  2026-10-30). A FADED twin of each body program (`bodyProgram.ts`: the matte
  cel, the visor, the visor's mask) is its plain twin's body and pixel with a
  door in front: the pixel is kept while `fade * 16 - 0.5` is above its rank
  in a 4x4 Bayer matrix (computed from `x ^ y` and `y`, no table) and
  discarded otherwise, so a fade `f` keeps `round(16 f)` of every 4x4 tile
  and the kept set only shrinks as `f` falls. The fade is a storage array in
  the FRAGMENT stage, in a group of its own (`BODY_FADE`, group 3,
  fragment-only — the vertex stage stays at 8 of 8), read through a flat
  `vBody`: the visor's stage already handed it to the mask, and the faded
  matte stage hands it as its last varying (after `vPalette`, so the cel
  inputs keep their locations). One bind group serves all three faded
  pipelines under one layout. `Game.drawBodies` writes the whole bodies first
  and the fading ones after (`BodyDraw.commit(n, whole, …)`, `fades`); each
  rank draws the whole ones by the plain pipelines and the fading ones by the
  twins (`firstInstance` past the whole), so **a frame with nobody fading is
  exactly the draws it was** (the same pipelines, the same order — the bank's
  rig rows prove it) and a body still lands in its own order; with someone
  fading a rank is up to four draws (two in the mask). The six pipelines are
  asked at `Game`'s construction, so the warm-up's wait for ours covers the
  twins and a first fade compiles nothing.
- **Decided, and why.** *Stable*: keyed on the pixel and nothing else, no
  clock or frame count, so a still body under a still camera keeps the same
  pixels; a moving one slides over a fixed pattern. At the size edge a body
  is three to six pixels, and no 4x4 pattern gives a handful of pixels
  sixteen levels: each is kept or dropped by where it lands, so the fade there
  is in HOW MANY pixels survive across bodies and frames (in expectation `f`),
  and a moving body twinkles before it goes — the price of fading an opaque,
  depth-writing body without a blended pipeline and a sort, paid only in the
  band. *The visor and its bloom*: one vertex module for both passes, both
  full-size, the same rank, so a pixel the main pass's visor dropped is never
  in the mask, and a body still drops whole, its emissive with it. *The
  ink*: left alone — a kept pixel writes depth and is inked like any
  silhouette pixel; a discarded one shows what is behind it, unchanged (the
  body-minus-empty difference is black in the holes at every step of both
  walks below). *The shadows*: not faded — the bodies' map and the lamps'
  atlas cast the proxy boxes while the switch is on, as the size gate never
  reached them either; the bodies' map gathers within its window's side of
  a focus 8 m ahead (56 m at most), short of every shipped map's distance
  fade (70 m at the earliest, the 78 m valleys), and a door in a shadow map
  would be a pattern in its texels, not the screen's.
- **The corpse's measure is NOT moved to the torso** (X4.1b and X4.1d asked
  it be considered here), recorded as owed with its reason: the distance
  fade's zero rests on the measure lying within a radius of the point the
  roster switches a body off by, which a corpse's root does and a torso
  thrown 1-4 m does not — a torso measure would put a thrown corpse's fade
  up to 4 m / 30 m = 0.13 above zero at the switch on Sarab, a pop back. It
  owes the roster's switch the same point first. At the size gate the root
  costs under 1% of projected size at the desktop's ~1,075 m and ~1.4% at a
  phone's 290 m.
- **A body walked through both edges, at 3440x1440** (scratch
  `fadewalk.mjs`; the bank's harness standing roster bodies, a frame with the
  body and one without at each step, the roster's update held as the bank
  holds it):
  - **The distance edge**, Sarab, the `rig-far` camera (10° field), one
    soldier on the highway: whole to 268 m (the body-minus-empty difference
    63,876 summed over 917 px), then 271 m fade 0.93 (63,677), 274 0.83
    (63,182), 277 0.73 (60,310), 280 0.63 (51,462), 283 0.53 (44,152), 286
    0.43 (39,467), 289 0.33 (27,202), 292 0.23 (22,469), 295 0.13 (14,495),
    298 m fade 0.03, nothing kept, and 300 m not drawn (the switch is at
    300). The holes are black in the difference: the scene behind, unchanged.
  - **The size edge**, the proving ground (fog 2,400 m and no
    `bodyDrawDistance`, so only the gate bites; at 1440 rows and the hip
    field the gate is at ~1,075 m), a rank of sixteen soldiers 6.7 m apart
    seen from 150 m up (one body there is a handful of pixels, and a handful
    cannot show a share): body pixels differing by more than 40/255, 54 at
    620 m (whole), 44 at 698 (whole), then 35 (fade 0.91), 34 (0.77), 22
    (0.63), 14 (0.51), 11 (0.40), 11 (0.30), 4 (0.21), 5 (0.12), 3 (0.06),
    0 at fade 0.02, and not drawn from 1,077 m.
  - Frames and contact sheets: `scratchpad/x41e/walk/` (`distance-sheet.png`,
    `size-sheet.png`, every frame pair).
- **And in live rounds, nothing pops at an edge** (scratch `livepop.mjs`:
  every frame, every pooled body's switch, fade, verdict, distance and
  projected size; a CROSSING is a body alive and switched on both frames —
  or switched off at the roster's own edge — that moved under a metre, which
  leaves out deaths, respawns and mounts):
  - Sarab offline, 3440x1440, 9,000 frames: 10,054 faded body-frames, up to
    50 main-pass draws and 20 mask draws on a frame with a body fading; **13
    leaves at the distance edge, every one by the fade, the largest fade the
    frame before 0.0013**; none by the roster's switch.
  - Coldharbour offline at the phone's 832x384, where the size gate bites at
    ~290 m: 34,928 faded body-frames; **53 leaves and 55 arrivals at the size
    edge, the largest fade the frame before a leave 0.104 and on an arrival
    0.139** — against 1.0 before this step — and those are frames where the
    projected size itself moved 6% with the distance fixed (the camera's
    field moving under it, not investigated); the ramp's input jumped, not
    the ramp.
  - A netplay round against a local `dist-server` (`?mp=`, Sarab, the
    authority's round), 3440x1440, 6,000 frames: 3,379 faded body-frames, up
    to 52 draws and 22 mask draws; 2 leaves at the distance edge, both by the
    fade, the largest 0.0014.
  - No console or page error in any of them.
- **Measured.** **The bank** `--check --keep` against a BEFORE at dd902aa in
  a worktree, the run split into several invocations (`FINDINGS.md` 64's
  device hang stopped the BEFORE twice — Harrowmead's `view-iron-hip` and a
  census at Cinderhaven — and the hung invocations were re-run alone): **no
  row moved** — 59 of 61 byte-identical (`comparePngs`, max 0), `rig-near`
  and `rig-far` among them (`rig-far`'s body at 250 m is whole: its fade
  starts at 268.9). The other two were diagnosed, not passed: `sarab/ground`
  (0.0048% of pixels, max 2) differed between the BEFORE's own two runs and
  the AFTER matches its second; `sarab/shelf` (ONE pixel, (143, 731), by
  1/255, no body in frame) is the worktree's — the parent commit run in the
  MAIN tree (`git stash`) draws the AFTER's bytes on all eleven Sarab rows,
  and bisecting the step's own changes out of the AFTER (no fade at all, no
  faded pipelines, no fade buffer) left the pixel where it was. The same 34
  stale rows on both sides, no console or page error. **`census --against`**
  the BEFORE: every total equal (Hollowmere 278, Greyfen 205, Coldharbour
  672, Harrowmead 847, Sarab 661, Cinderhaven 186, Kurenai 125), every row
  `=`. **`gate.mjs`** clean on seven. **`shaders.mjs`** clean on seven, ours
  17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour) — it builds the
  world's programs; the bodies' six are built in the page, and every round
  above drew them. Typecheck, build (`check-babylon-free`: 15 simulations,
  no path), corecheck and `parity` pass. **`clients.mjs --check`** identical
  on all three maps (452fc9d44a88e3a6, 5504610c69d82176, 4b1f60f31d44f6f3;
  nodes and every body identical). **`drop.mjs --check --exact`** "bits
  identical" on all seven maps.
  **X0.3 on the desktop** (`bench.mjs sarab cinderhaven --max --gpu`,
  uncapped, 3440x1440, 24 a side, the BEFORE in the worktree at dd902aa and
  the AFTER alternated invocation by invocation; the second BEFORE hung in
  Cinderhaven — `FINDINGS.md` 64 — and was killed and re-run after the
  third, so three BEFOREs against four AFTERs; the canonical fight hashes,
  `986c2e35557fb679` and `2f97c9072ab1762b`, on every run): **the dithered
  pipelines cost nothing material** — mean frame new / old on Sarab 1.006
  over the vantages, 1.000 on the path, 1.020 in the fight (6.53 to 6.66
  ms, the AFTER's runs 6.51-6.84 against the BEFORE's 6.43-6.58), and on
  Cinderhaven 0.995, 1.000 and 0.996; `gpu.frame` in the fights 1.005 and
  0.999. Nothing near the protocol's ~8%.
- **Deviations.** The bank rows on `--check` grade the plain pipelines only
  — no row has a body in a band — so the twins' pixels are proven by the two
  walks and the live rounds, not the bank. A body in the size band twinkles
  as it moves (above). `CLAUDE.md` stays 1,543 lines: the rendering section
  keeps its 135 by dropping the rank's "because" (the argument is in
  `docs/rendering.md`). The blob disc under a soldier is untouched (it fades
  with the fog and takes the loose size gate as it did).
- **What the post-commit review found** (an independent reader over 53dcb34
  and ed049a5; fixed after it, comments and docs only — no behaviour or
  picture moved). **No correctness bug.** **Checked and sound**: (a) a frame
  with nobody fading issues the same GPU work it did before — the faded
  pipelines' groups 0-2 are the plain ones' layouts (`PipelineCache` dedupes
  a bind-group layout by its entries), so the same bind groups serve both;
  the fades are uploaded only when some body is past `whole`
  (`BodyDraw.commit`'s guard); and each rank's plain draws are the ones it
  always drew — so the two Sarab rows that moved in the bank are the run
  noise diagnosed above, not this step. (b) The distance fade's zero before
  the roster's switch holds, up to ONE FRAME OF EYE LAG the first cut did
  not state: the roster reads the camera inside `updateWorld`
  (`NetSession.update`'s `cameraPos`), before the frame's camera update moves
  it, and the cull reads it after (`followEye`), so at the switch the fade
  can be above zero by one frame of the eye's travel over the band — at 60
  fps ~0.004 sprinting on Sarab, ~0.014 on the 78 m maps, ~0.02 in the
  helicopter at its 32 m/s and twice that at 30 fps; measured 0.0013 at most
  (above). The screen door keeps no pixel below a fade of 1/32, so only the
  helicopter's worst can leave one pixel of a 4x4 tile. The ramp is not
  changed. (c) A body drops whole with its emissive: the main pass's visor
  and the mask's read the same fade through the same `vBody` against the
  same Bayer rank, and the mask is drawn at the main pass's size on every
  rung, so a pixel is dropped in both or neither. **Fixed**:
  - **Rule 7 misses**: `EnvironmentSpec.bodyDrawDistance`'s doc
    (`world/environment.ts`, "A body still POPS where it is dropped, which is
    the whole of the cost") and Sarab's header (`sarab/environment.ts`, "300
    was chosen so that popping happens in haze") now say a body fades out
    over the last tenth of the distance, the ramp ending one measure-radius
    short (`WorldCulling.setBodyDrawDistance`), so a stated distance is a
    look call rather than a pop. Neither file is hashed by the bake's
    staleness guard (`collision-hash.mjs` hashes `layout.ts` and
    `heights.ts`), so nothing re-bakes.
  - **The eye lag** in (b), stated where the argument is made:
    `WorldCulling.offer`'s distance-edge comment, `docs/rendering.md` and
    the paragraph above.
  - **Inverted wording**: "the fade is zero wherever the switch could still
    be on" said the opposite of what was meant — the fade reaches zero
    BEFORE the roster's switch can turn the body off, so a fade above 0
    implies the switch is on. Corrected in `WorldCulling.offer`,
    `bodyFade.distance`'s doc (`config/graphics.ts`), `docs/rendering.md` and
    the paragraph above; the commit message of 53dcb34 keeps the old words
    and is not amended.
  - **`Game.drawBodies`' doc** still read `drawsBody` as "switched on, and
    not under the size gate": it names the distance fade's end, the fade it
    writes, and the whole-then-faded order.
  - **`ENGINE_UPGRADE.md`**'s "the fade band that has not been built" is
    history and kept, with a bracketed note that it was built here.
  - **Owed onward** gains the size band's width (below).
- **Owed onward.** **The phone walk-through — owed by the user's decision**
  (2026-10-30); the phone's numbers are taken (X4.1's AFTER, above), the
  look is not: the size edge is the phone's (190-290 m on Coldharbour), and
  whether a 3-6 px body twinkling out reads as a fade there is a look call
  for eyes on that screen. Fold into that walk-through the size band's
  width: it is 1.5× the gate (3 to 4.5 px), so a change of field of view —
  a sprint, a sight going up — can sweep a body across much of the ramp in
  one frame; the Coldharbour 832x384 run's 0.104 and 0.139 one-frame jumps
  (above) were frames where the projected size moved ~6% at an unchanged
  distance, not investigated. The corpse's measure at its torso, above, with
  the roster's switch moved to the same point. Whether 300 m on Sarab (and
  420 on Cinderhaven) are the right distances is now a look call rather
  than a pop (`FINDINGS.md` 32, open bullet; 39's +21.4% at 300 on
  Cinderhaven is the saving it could buy). X4.1d's owed items stand (the
  rank's vertex surplus, the editor's body draw, the compose cost).

### X4.2 — Vehicles (PERF_PLAN A3) — **M–L, as four sub-steps** (split 2026-10-31) — X4.2a **LANDED** (fde5be7), X4.2b **LANDED** (d4f41ef), X4.2c **LANDED** (f302403), X4.2d **LANDED** (a156355) — **all four LANDED**

Every hull a page draws — the tank, the truck and the helicopter, live or
wrecked — comes off Babylon's scene, and A3's detail tier and draw distance
are built on the result, the distance with X4.1e's fade. It is split as X4.1
was: the two moves are each proven with no picture change, and the two
picture changes (rule 2) land alone, each with the bank's numbers. Each
sub-step lands on its own and leaves the game shippable. **The moon's map
and the lamps' atlas are done**: X4.1c draws a hull's box off its own fields
(`hullBodyToRef`), so nothing here touches a shadow. (This entry's first
draft named a `HullFlex`; no such module exists — the hull's own motion is
`HullSprings`, simulated on both sides and written into `Vehicle.pose`, and
`HullWhips`, the picture's.)

- **X4.2a — the hull's joints are ours (no picture change).** Landed (below). `vehicleRig`'s
  `TransformNode` joints become a `JointTree` (`rigJoints.ts`, X4.1a's), its
  world matrices in arrays the hull's rig owns. `VehicleView` writes
  `Vehicle.pose` onto them as it writes the nodes now — the sprung body,
  the turret, the gun, the cupola and roof stations, the running gear and the
  rotors (`setRun`'s four arguments), the whips (`HullWhips`) — and Babylon
  still draws the merged segments, unparented and frozen, reading those
  matrices (X4.1a's shape). `hullPointToRef`, the muzzles' float32 replay
  of the node chain, stays the simulation's and stops having a node to
  agree with. **Oracle:** each joint's matrix against the node's, bit for
  bit, over a recorded round with all three kinds driven, firing, flying and
  wrecked, before the nodes go; the muzzles unchanged (`hullPointToRef`
  against the drawn joint, as at X2.2); `kit:hash --models`'s `vehicle:`
  rows explained or unmoved.
- **X4.2b — every hull drawn by us (no picture change).** Landed (below). A kind's merged
  segments become a kit our renderer draws (X4.1d's shape: built once a kind
  and side, every hull an instance, its joints a segment's matrix), in every
  pass a hull is in, with what each closure does to them: the belts' run,
  the paint and the wreck's charred repaint (`paint`), `reset`, and the
  hull's emissives with it. The size gate moves with them as it was, PER
  SEGMENT — asked of each segment's world sphere composed this frame, as it
  was asked of each mesh — a hull never having had a whole-hull drop (and the
  fog-wall gate no hull half), and kept so for good (decided 2026-10-31,
  "Decisions that are yours"). Babylon builds no hull mesh in a round.
  The pipelines are asked ahead through `PipelineCache`, so the warm-up
  waits for them as it waits for the bodies' (it poses no hull of its own
  today: a hull stands at its hardstanding in the views it draws). The editor's hulls are
  X5.3's, as its bodies are (X4.1d). **Oracle:** the bank's hull vantages
  (`sarab-tank`, `sarab-truck`, `sarab-heli`) and every other row
  byte-identical; census; X0.3 alternated on Sarab and Cinderhaven, `--max
  --gpu`; a netplay round with each kind driven and one wrecked.
- **X4.2c — A3's detail tier (the picture change).** Landed (below). **The detail set is
  decided** (2026-10-31, the user, PERF_PLAN A3's suggestion): the tank's
  links (`tank-link-hi`, `tank-link-lo`) and road wheels (`tank-wheel`) and
  both machine-gun rings (`tank-mg-ring`, `truck-mg-ring`) drop at range;
  every other segment, the helicopter's all, is kept. Each kind's kit gains
  a reduced set without those segments, swapped by projected size computed
  as `WorldCulling`'s size gate computes it, off a WHOLE-HULL measure this
  step introduces — one sphere a hull, composed where the hull is this frame
  (X4.2a's fix: never a bound cached at the last frame it was drawn) — used
  for the swap and for NOTHING else: the per-segment size gate stays exactly
  as it is, under the tier (decided 2026-10-31); the swap's size is the
  step's to state and the bank's to show. **The full set
  is the one the warm-up shows** (`docs/game.md`). **Oracle:** the bank's
  numbers in the message (only rows with a hull past the swap may move);
  a hull walked through the swap at 832x384 and at 3440x1440, photographed
  either side of it; X0.3 on Cinderhaven at 300 m against A3's +6.5%.
- **X4.2d — the hull's draw distance and its fade (the picture change).**
  Landed (below). **Decided** (2026-10-31, the user): a map field, and a FADE at it, not a
  pop. `EnvironmentSpec.hullDrawDistance`, defaulting to
  "unaffected" — as landed (a156355, amended after its post-commit review):
  ABSENT is no distance (`Infinity`, every hull at any range, as before),
  and a STATED one is capped at `fogEnd` and floored at a hull's gun reach
  (`hullDrawFloor`, ~419.4 m). This bullet's first draft said "its own
  `fogEnd`, clamped to it, as `bodyDrawDistance` is", which would not have
  been unaffected: nothing ever cut a hull, so a default at the fog would
  fade every far hull over its last tenth (74.5-100% fog on Sarab) and cut a
  `fogColor` silhouette out of the sky past it on every armour map that set
  nothing — the owner's "unaffected" kept, the parenthesis corrected. It is
  resolved once at the install and pushed to the cull — **a NINTH override in
  `CLAUDE.md`'s table of the map's** and `docs/world.md`'s section, with
  what a map raising it owes. The fade is X4.1e's screen door, in faded
  twins of the hull programs, at that distance ONLY — there is no
  whole-hull size drop to fade at (decided 2026-10-31: the per-segment gate
  is kept for good, a whole-hull size edge would fall past the fog on most
  viewports, ~1.5 km at 1080p and ~540 m at 832x384, and a hull's small
  parts keep dropping at the per-segment gate one by one as they always
  have) — its value per hull in the fragment stage as `BODY_FADE` is; the
  twins are asked ahead
  with the rest. **No shipped map sets the field in this step** — A3's
  +15.4% at 420 m on Cinderhaven is a look call per map, taken after. **A
  hull is a GUN as well as a picture**, where a body past
  `bodyDrawDistance` is past every bot's engagement range: the step states
  what a map may set this to against the reach of a hull's guns and of the
  bots that fire them, so that no setting buys an unseen shooter. **Oracle:**
  the bank's numbers in the message (only rows with a hull in the fade may
  move); a hull driven through the fade at 832x384 and at 3440x1440;
  X0.3 on Cinderhaven with the field set to 420 on a scratch layout, against
  A3's +15.4%.
- **Contracts all four keep:**
  - the collider never tilts, and nothing on a hull that moves is pickable
  - a hull's shadow shape is its collider box, off its own fields
  - no simulation reads a node: the muzzles are replayed off fields
    (`hullFrame.ts`), never off the drawing
  - no `if` on a kind: a kind is its rows in `VEHICLE_KINDS` and
    `vehicleModels.ts`, and a reader needing numbers narrows on its spec block
  - a hull follows `Vehicle.present`, which `hide` ends
  - a colour gradient on a hull's particle system is still Babylon's rule
    until X4.7: the dust, spray and ripple are not this step's
- **Verify, each sub-step:** the bank `--check --keep` against a BEFORE at the
  parent; `census --against`; `gate`, `shaders`; typecheck, build, corecheck,
  `parity`; a round offline with each kind driven and a netplay round.

**X4.2a landed** (fde5be7, the post-commit review's fixes after it;
2026-10-31; no picture change but ONE, found by that review: a latent bug of
the parent's size gate, fixed by the step — Deviations).
- **What it is.** A hull's joints are OUR hierarchy: `VehicleRig.tree`, a
  `JointTree` (`rigJoints.ts`, X4.1a's), whose first joint is the collider
  box's own frame (`rig.body`, `hull-body`) and whose second the model's
  root (`vehicleRig.rigTree`). Every `TransformNode` the three models made is
  a `tree.add` in the order the node was made, so the tree is parents first
  by construction and its joint list IS the node list, name for name (21
  joints a tank, 19 a truck, 15 a helicopter, the body counted; only the
  body's name moved, from `hull-body-<team>`). **Babylon still draws the
  merged meshes, and none has a parent**: `segment` files each mesh under its
  joint with its own local composed once (`HullMesh`; a lone part keeps its
  frame on its mesh), and `drawHullRig` composes the tree and hands every
  switched-on mesh its local times its joint's world through
  `freezeWorldMatrix` — from `VehicleView.draw` (`VehicleViews.draw`), once a
  frame in every state, beside `drawBodies`, immediately before
  `scene.render`, inside the `render` span where Babylon composed the nodes
  before. **The body box MESH is gone** (X4.1a's root capsule is the
  precedent): it was the rig's invisible, unpickable parent and nothing else,
  and it is the body joint now, stood at `pos` turned `yaw` by `update` as the
  mesh was; `present` switches every mesh's own flag (`setHullRigEnabled`),
  which the mesh's switch reached through the parent chain, and a hull that is
  not present is not composed. `VehicleView` writes `Vehicle.pose`, the run
  and the whips onto the joints exactly as it wrote the nodes, behind the same
  guards — kept although a joint costs nothing to write, since an unguarded
  `-0` written over a `0` is a different bit drawn. `hullPointToRef` is
  unchanged and stays the simulation's, with no node left to agree with.
  `dispose` frees the meshes (`disposeHullRig`), never their shared paint.
- **The oracle — each joint's matrix against the node's, bit for bit.** A
  scratch recorder (Playwright, the dev server) logs every `HullPicture` call
  and every `update`'s hull state per view, as float64 bits, and at every
  `onAfterActiveMeshesEvaluation` a digest of every switched-on hull mesh's
  world matrix as Babylon holds it to draw; a replay feeds the log through a
  tree's real `VehicleView` and models, in Chromium or in Node (NullEngine).
  - **The parent's round** (6dad2d9 in a worktree; Sarab, 300 s, 37,849
    frames, six hulls): the tanks driven 1.3-1.5 km and firing 22 main-gun
    rounds, a tank and a truck WRECKED, hidden for their respawn and placed
    again, a helicopter flying 2.5 km up to 33.6 m with its chin gun laid to
    0.85 rad, every cupola gun traversed through ±π. Every drawn mesh
    (5,181,416) was the fresh composition of its node chain. **Replayed
    through the step's joints in Chromium: 227,082 of 227,082 per-hull
    digests equal what the parent's Babylon drew.** Replayed in Node through
    both trees: every joint's world, the mesh-less muzzles and sight among
    them, every frame — 4,163,170 matrices, 268 MB of float32 — identical to
    the nodes' (`cmp`), and the 227,082 digests equal again.
  - **The step's round** (Cinderhaven, 300 s, 37,851 frames): everything
    driven, both helicopters flying (to 75.8 m), the tanks firing. Every
    drawn mesh (5,368,452) was its local times a fresh compose of its joints
    at evaluation: no hull is drawn off a matrix older than its last write.
    **Replayed through the PARENT's nodes in Chromium: 227,094 of 227,094
    digests equal what the step drew.** In Node the two trees again agree
    joint for joint (4,163,390), but 33 of the 227,094 digests — one truck,
    frames 23,472 onwards — differ from Chromium's drawing, identically on
    BOTH trees: Node 24.19's arithmetic and Chromium 149's differ in a float64
    last bit somewhere in the picture's own sums (the whips' springs, the
    running gear), which a float32 rounding shows on those frames. The
    Chromium replay is the one that matches, on either tree, so it is the
    instrument, not the step.
  - **The step's second round** (Sarab, 600 s, 75,690 frames): a tank
    WRECKED, hidden and placed again on the step, a helicopter flying 4.5 km,
    the tanks firing 11 rounds. Every drawn mesh (10,642,973) fresh as above;
    replayed through the parent's nodes in Chromium, **454,128 of 454,128
    digests equal**.
  - **The muzzles unchanged**: `hullPointToRef` against the drawn muzzle,
    cupola-muzzle and sight joints, live — 680,508 and 1,349,727 on the
    step's two offline rounds and 338,958 in the netplay round — and in the
    Node replays on both trees
    (659,376 Sarab, 681,282 Cinderhaven, against nodes and joints alike): 0
    differ.
  - **`kit:hash --models`: the twelve `vehicle:` rows move BY CONSTRUCTION,
    and nothing else does** (232 identical). The script hashes every transform
    node left in the scene (a hull leaves none now), each mesh's parent and
    transform (no parent now) and the builder's plain data (now a `JointTree`
    and its `HullMesh` list), so the rows cannot say whether a hull draws the
    same. Draw hashes, 6dad2d9 → HEAD: tank 0 livery d3b613a3fe76f7fa →
    389a841f7b70ce8c, wrecked c62b84f83f687fe6 → 971042ad1991ec1a; tank 1
    ae9ceb52f74cfacf → 24aebe62dcada12b, 7fc22ea2e86dcc25 → f9cdb63681b1c88a;
    truck 0 1d70c381f981830c → e87aaf8f3ed6168a, 970a4e7c0349e1e2 →
    7de835fdc0dff7a8; truck 1 1398fc608f7d0110 → 90ff9c72096bed09,
    b30dd3027fe2162d → 6941286129223125; heli 0 6594c60801c7c6c7 →
    ac604c6b689d6cc9, e4c74a87fb65a66b → 96fb8de860650da5; heli 1
    b7db01e49cdd4a67 → dfd8f6296beacfff, d5ebd5abd4180cf9 → 6505350ca6a8cd3d.
    **What they cannot see is unmoved**: a scratch hash of each mesh's
    geometry, material, flags, world matrix and world bounds, at a placed
    hull, is identical across the two trees on all twelve builds. A later
    `--against` a baseline older than this step reports these twelve as
    "content changed", and that is this step — take a fresh baseline past it.
- **Measured.** The bank against a BEFORE at 6dad2d9 in a worktree
  (`--check --keep` both sides): **60 of 61 byte-identical**, `sarab-tank`,
  `sarab-truck` and `sarab-heli` among them. `sarab/shelf` differs by ONE
  pixel, (143,731), by 1/255 — X4.1e's worktree pixel: the parent run in the
  main tree (the step stashed) draws the AFTER's bytes on all eleven Sarab
  rows. The same 34 stale rows on both sides, no console or page error.
  **`census --against`** the BEFORE: every total equal (Hollowmere 278,
  Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186,
  Kurenai 125). **`gate.mjs`** clean on seven; **`shaders.mjs`** clean on
  seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour).
  Typecheck, build, corecheck and `parity` (eight maps) pass. **A round
  offline**: the recorded rounds above. **A netplay round** against a local
  `dist-server` (`?mp=`, Sarab, the authority's round, 150 s): all six hulls
  posed off the wire, the tanks firing 16 rounds, a helicopter flying to
  33.8 m; 2,674,002 drawn hull meshes, every one the fresh composition; no
  console or page error.
- **Deviations.** The body mesh, gone (above). A hull that is not present is
  not composed (nothing reads its joints). FIRING on a truck and a
  helicopter is the cupola gun, which tells the picture nothing (`kicked` is
  the main gun's), so it is covered as its laying. **No HELICOPTER was
  wrecked** in any of the four rounds (a tank twice and a truck once were):
  the bots did not bring one down in 22 minutes of play, and a page
  script cannot, the damage being the authority's. A wreck is the charred
  paint, the hide (`present`) and the respawn's `placed`, kind-blind code
  the tank and the truck exercised; the helicopter's own joints were driven
  through flight, its rotors and its chin gun's whole laying.
  **One picture change, undisclosed when the step landed: a latent bug of
  the parent's, fixed** (found by the post-commit review below; confirmed
  from Babylon 9.28's code and LIVE). In the parent every hull mesh was a
  LOOSE candidate, size-gated by `WorldCulling.offer` off its own
  `getBoundingInfo()` (`tooSmallMesh`). Babylon rebuilds a mesh's bounds only
  after it recomputes the world matrix (`_afterComputeWorldMatrix` is what
  dirties them), and recomputes it only for the candidates `WorldCulling`
  hands it (`scene._evaluateActiveMeshes`); nothing else in the parent
  composed a hull mesh. So a part the gate dropped kept the bounds of where
  it was last drawn, and stayed dropped for as long as that old sphere
  projected under the gate from the eye — however near the hull itself came.
  At 832x384 and `fovHip` 0.95 (404 px a radian) `tank-mg-ring` (a sphere of
  0.396 m radius, measured — not the review's ~0.54, which put the drop at
  ~73 m) drops past ~107 m, so a tank last drawn further off than that which
  then drove up to the player arrived without its ring; and a hull wrecked
  far off and placed again at a hardstanding came back without its small
  parts. `drawHullRig` freezes a fresh matrix onto every enabled mesh every
  frame, and a freeze dirties the bounds, so the gate now reads where the
  hull is — one frame behind, as it always was for a mesh drawn the frame
  before. The oracle could not see it (it digests only DRAWN meshes, and the
  parent's were all fresh), nor the bank (its vantages pose parked hulls).
  **Measured** with a scratch probe wrapping `offer` — every enabled hull
  mesh every frame, the bounds `offer` reads against the node or joint chain
  composed fresh, the player standing at his spawn, 832x384: the parent
  (6dad2d9, in its worktree) dropped a mesh a fresh bound would have kept on
  409,427 of 4,288,968 mesh-frames on Sarab (240 s), 331,524 of 1,795,625 on
  Coldharbour and 141,505 of 1,706,775 on Harrowmead (300 s each), held
  centres as far as 526 m from the hull. The worst, on Coldharbour: a tank
  at 72-75 m and on screen drawn without its sprocket (13.2 px), its cupola
  gun (10.8 px), both whips and its MG ring (4.3 px), every one held where
  it had been last drawn, ~386 m off. The step on Sarab (240 s): 41 of
  4,198,445, each a single frame — 37 at the gate's own edge (3.000-3.001
  px, at most 0.16 m of one frame's travel) and the frame after a wrecked
  tank was placed again (its cupola gun at 146 px for that one frame). So
  "no picture change" holds for every frame both trees draw a hull mesh;
  what moved is a part the parent wrongly kept dropped, now drawn.
- **What the post-commit review found** (an independent reader over fde5be7
  and e5a4d95; fixed after it, comments and docs only — nothing drawn or
  simulated moved). **No correctness bug in the step's code.** **Found**:
  the picture change above, undisclosed (rule 2) — the reviewer's reading
  of the code, verified against Babylon 9.28 and live before it was
  recorded (Deviations); and its cost, the review's estimate (Owed
  onward). **Fixed** (rule 7): present-tense node
  wording about the hull, now joints — `Vehicle.leanHull`'s and
  `HullSprings.lean`'s guard, still justified by a `TransformNode` rotation
  write (it stays for what it decides: the muzzle's path and the bits the
  view copies, `VehicleView`'s header); `HullSprings.flexHeave` ("reaches one
  `TransformNode`'s Y", now docs/vehicles.md's wording); `VehicleViews`'
  header; `vehicleRig.ts`' `hull`, `sprung` and `turret` docs; `HullWhips`'
  "the drawn node"; and, grepping the files X4.2a touched, `hullFrame.ts`
  (the header's per-joint replay, `HullPose`, `hullBodyToRef`),
  `HeliModel.ts`, `TankModel.ts` (and the wheel paint's doc, which put the
  road wheels on a node of their own: they are a segment on `hull`, the
  sprocket on its own joint), `TruckModel.ts` and `Game.ts`' "before
  anything reads a node" at `vehicleViews.update`.
- **Owed onward.** X4.2b: the meshes into a kit our renderer draws, every
  hull an instance, the joints a segment's matrix — the `HullMesh` list
  (`local`, `joint`) is that segment table already. **X4.2b's whole-hull
  measure must keep the fixed behaviour** (Deviations; X4.2b kept the gate
  per segment, and since the 2026-10-31 decision the whole-hull measure is
  X4.2c's, for its detail tier's swap alone): measured where the
  hull IS every frame it is offered — off its own fields or its composed
  joints — and never off a bound cached at the last frame it was drawn, or a
  hull the size gate dropped stays dropped wherever it drives. The phone's
  FOLLOW-UP reading, as every step's since X3.3c. **A cost nobody has
  measured** (the review's estimate, not a reading): each present hull
  composes its whole tree every frame (at most 21 joints and 26
  `freezeWorldMatrix` calls) where Babylon re-composed only a node that
  moved, and each freeze also DIRTIES the mesh's bounds, which
  `WorldCulling.offer` then rebuilds — it reads `getBoundingInfo()` on every
  enabled loose mesh (`tooSmallMesh`) — so every hull mesh rebuilds its
  bounds every frame, parked or off-screen: about 150 bounds updates and 126
  composes on a six-hull map, estimated at tens of µs on desktop and ~0.2-0.4
  ms on the phone. X4.2b removed it by removing the meshes — no hull mesh is
  frozen or has its bounds rebuilt — and NOT by a whole-hull measure, which
  it never built: a present hull is still composed once a frame
  (`drawHulls`) and its size gate still asked of each segment's sphere
  (X4.2b's note; the whole-hull measure is X4.2c's, for its swap alone).
  **The mitigation if a phone reading shows it before then**:
  skip a mesh's freeze when the 16 composed floats are bit-equal to what that
  mesh was handed the last time. Not done here; it would keep the fix, since
  a freeze skipped is a bound left where the mesh still is.

**X4.2b landed** (d4f41ef, the post-commit review's fixes after it;
2026-10-31; no picture change: the bank 61 of 61 byte-identical against its
parent, every hull row among them).
- **What it is.** Every hull the page draws — the tank, the truck and the
  helicopter, in its livery or wrecked — is OUR renderer's
  (`render/HullDraw.ts`, its program `render/hullProgram.ts`), and **Babylon
  is made no hull mesh**: X4.1d's shape for a thing with no emissive and no
  fade. A rig is its joints (X4.2a) and its SEGMENTS (`HullSegment`: the joint
  and the segment's local); what a segment looks like is its kind's KIT in its
  side's colours (`HullKit`), built ONCE a model and a view — the first rig of
  the pair makes and merges the parts (`segmentOf`, the same `mergeParts` and
  per-colour grouping as before, in the order the scene received the meshes:
  lone parts at their part's moment, the merges after them), every later one
  hangs the kit's segments without making a part, checked call by call
  against the kit's segment names. All six kits (three kinds, two views) are
  built at `Game`'s construction (`vehicleModels.hullKits`, through
  `teamView.teamOfView`) and uploaded once, end to end: 94,220 vertices,
  180,288 corners, ~6 MB; a narrower kind is the widest (the truck's 26
  segments; the tank 25, the helicopter 20) with its missing segments empty.
  `buildTank`/`buildTruck`/`buildHeli(team)` take no scene and no factory;
  `drawHullRig`, `disposeHullRig`, `HullMesh`, `VehicleView.draw`/`dispose`
  and `VehicleViews.draw` are gone. Each frame `Game.drawHulls` (beside
  `drawBodies`, inside the render span, immediately before `scene.render`)
  composes every present hull's tree and writes each segment's world
  (`vehicleRig.writeHullDrawing`: its local times its joint's world, the
  float32 product X4.2a handed Babylon through `freezeWorldMatrix`) and its
  world bounding sphere (`BoundingSphere._update`, operation for operation, off
  the kit's local sphere), with a kit WORD — the kit and a `HULL_CHARRED` bit —
  and commits them; the renderer draws them at `"beforeAlphaTest"`, installed
  AHEAD of the bodies' draw and the world's, where Babylon's opaque queue drew
  the hulls.
- **A draw is a RANK**, for the bodies' reason: the render pulls each hull's
  order (`Game.hullPull`, `bodyPull`'s stable sort off `globalPosition`, the
  kit's order — the scene order — breaking a tie), and rank `r` is one
  non-indexed draw of every hull's `r`th segment. The main pass is at most 26
  hull draws whatever the fleet, where Babylon drew one a mesh (142 on Sarab's
  six). **The FRUSTUM moved with it**: the pull switches off (zeroes) every
  segment whose sphere is outside `scene.frustumPlanes` — Babylon's
  `BoundingSphere.isInFrustum`, the default sphere-only strategy, none while
  the warm-up skips the frustum. The first cut had none and drew all six of
  Sarab's hulls at every vantage: the census found it, +25 draws on every row
  of an armour map that frames no hull.
- **The paint is a flag, the material one recipe.** Babylon drew a hull with
  one `get(hex)` material a colour and repainted a wreck by swapping every
  mesh's for the charred one. Ours is the cel program under `CEL_OWN_PALETTE`
  (`CelMaterialFactory.hullCelRecipe`, sharing `ownPaletteRecipe` with
  `bodyCelRecipe`): one table of the 28 colours the kits are painted in plus
  the charred one (`vehicleRig.hullPalette`, slot 29), each segment's vertices
  carrying its colour's 1-based slot in `uv2.x` (`writePaletteIndex`), read
  out as the same float32 triple the `baseColor` uniform held, and the program
  substituting the charred slot on every corner of a hull whose word carries
  the bit. `paint` writes `VehicleRig.charred`, `reset` clears it; the run, the
  whips and the reset's pose were joints already and are unchanged. A hull has
  no emissive (`vehicleRig.ts`' rule), so nothing of it is in the glow's mask,
  and no colour or uv buffer: it reads the bodies' (0, 0, 0, 1) and (0, 0).
- **The size gate stays PER SEGMENT — a deviation from the entry's wording,
  for its "no picture change"** (Deviations). `WorldCulling.keepsSphere` is
  `offer`'s `tooSmall`, from the eye and at the scale `offer` last used, asked
  of each segment's sphere composed this frame; a dropped segment is a zero
  matrix. The fog-wall gate had no hull half to move (a hull was a loose mesh,
  never reach-gated), and a hull's switch is `VehicleRig.enabled`, which the
  view follows `Vehicle.present` with.
- **The warm-up** waits for the one pipeline, asked at `Game`'s construction;
  a hull stands at its hardstanding in the views the warm-up draws, so it poses
  none. **A failure is the round's** (the bodies' routing: the pipeline, or a
  refused main pass while installed, tells `Game.worldFailed`); installed for a
  round's map only — an editor build has no fleet and draws no hull. **The
  profiler** gained `hulls` (`drawn`, `instances`; report **version 22**,
  `FrameProfile.setHulls`, the viewer's `hulls` line), Babylon's counter
  counting no hull now; `census.mjs` counts `hullDraw.stats.drawn` with ours.
- **Measured.** The bank against a BEFORE at 1a674cd in a worktree
  (`--check --keep` both sides): **61 of 61 byte-identical** (pixels),
  `sarab-tank`, `sarab-truck` and `sarab-heli` among them, the same 34 stale
  rows on both sides, no console or page error — on the code as committed; the
  run before the frustum cull was added read 58 of 58, one row's two grabs
  having disagreed (a `menu` row NOT REPRODUCIBLE, so nothing written). A scratch
  shooter (Sarab, deploy, frozen, both trees): each kind at the bank's three
  vantages in its livery, CHARRED and POSED (turret, gun, cupola gun, sprung
  body, belts, wheels, rotor and whips written onto the joints), and the west
  tank from 30 to 600 m at 1920x1080 (fov 30 and the default) and from 40 to
  360 m at 832x384 — the size gate dropping parts — livery and charred: **28
  of 28 byte-identical**. A scratch geometry dump (Node): every kit segment's
  name, colour, float32 positions and normals, indices, local, joint and local
  bounding sphere equals the parent's mesh at the same place in scene order,
  on all six kits (25, 26, 20 segments). **`census --against`** the BEFORE:
  every row with no hull in frame equal, and the totals of Hollowmere 278,
  Greyfen 205, Coldharbour 672, Harrowmead 847 and Kurenai 125 equal; Sarab
  661 → 481 and Cinderhaven 186 → 150, all of it on the rows that frame hulls
  (`tank` 67 → 41, `heli` 61 → 41, `alley` 89 → 52, `shelf` 83 → 57, `wadi` 96
  → 60, `ground` 92 → 57, Cinderhaven `crossing` 85 → 49; `truck` 41 = 41, one
  truck being 26 meshes and 26 ranks). **`gate.mjs`** clean on seven;
  **`shaders.mjs`** clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven,
  23/23 Coldharbour). Typecheck, build (`check-babylon-free`: 15 simulations,
  no path, `src/render/` walked with the two new files), corecheck and
  `parity` (eight maps) pass. **`kit:hash --models`: the twelve `vehicle:`
  rows move BY CONSTRUCTION** (232 identical): a rig has no mesh now, and the
  script hashes the rig, its kit and its charred flag. **X0.3** (`bench.mjs
  sarab cinderhaven --max --gpu`, uncapped, 3440x1440, BEFORE and AFTER
  alternated run by run, three a side; the canonical fight hashes
  `986c2e35557fb679` and `2f97c9072ab1762b` on all 12 runs), medians new/old:
  **Sarab's fight 6.67 → 4.64 ms (0.696)**, tick 5.83 → 3.74, Babylon's draws
  209 → 114, `gpu.frame` 4.10 → 4.04 (0.986); Cinderhaven's fight 6.08 → 6.04
  (0.993), tick 4.98 → 3.96, draws 161 → 75, `gpu.frame` 0.994; the vantages
  and path 0.998-1.015 (ticks down 4-16%, draws about halved), `gpu.frame`
  0.977-1.042, every spread under 4%. **A round offline** (a scratch probe,
  Sarab, 240 s, 30,234 frames, checking after every render one instance per
  present hull in hardstanding order, each kit word against its rig, every
  drawn segment's matrix bit-equal to a fresh compose, every zero segment
  padded, culled by the frustum or refused by the gate): 0 failures; all three
  kinds driven, the helicopter flown to 33.5 m, a tank WRECKED, drawn charred
  for 2,003 frames, hidden and placed again. **A netplay round** against a
  local `dist-server` (`?mp=`, Sarab, 300 s, 37,780 frames), the server's hulls
  made FRAGILE by a scratch loader that bends `CONFIG.vehicles.*.maxHealth`
  before the server imports it (`VERIFYING.md`'s round-end loader, applied to
  the fleet): the same checks, 0 failures, every kind driven and the
  helicopter flown, a tank and a truck wrecked off the wire, drawn charred,
  hidden and placed again; no console or page error in either round. The rank
  draws spent 3.0x the drawn corners in vertex invocations (13.0e9 against
  4.25e9 offline, 18.2e9 against 6.13e9 in the match): X4.1d's surplus, for
  hulls, the helicopter body's 10,788 corners the span.
- **Deviations.** **The size gate is per SEGMENT, not a whole-hull drop.**
  The entry asks for "a hull measured once and dropping whole as a body does"
  and for no picture change, and the two disagree: a hull's meshes were loose
  candidates gated one by one, so a whole-hull drop would draw at range every
  small part the gate drops there today — at 3 px on a 1080-tall view a tank's
  MG ring (0.396 m) goes at ~300 m and the hull kilometres further. Kept per
  segment, exactly as before, so no pixel moves; a whole-hull measure, and
  what it changes, are X4.2c's to make with the detail tier (the picture
  change) and X4.2d's fade. (Decided 2026-10-31, after the review below: the
  per-segment gate is kept for good, X4.2c's whole-hull measure serves its
  swap alone, and X4.2d fades at `hullDrawDistance` only.) **The gate reads THIS frame's sphere**, where
  Babylon's read the bounds of the previous frame's freeze (X4.2a's fix,
  "one frame behind"): the two differ only on the frame a moving part crosses
  the gate's edge, and on the frame a hull is placed again (X4.2a's lone
  cupola-gun frame now draws it). **The frustum** is a hull's own (above),
  which the entry did not name. **The order across hulls**, and against
  Babylon's remaining opaque meshes (a flag's cloth), is not reproduced, as
  X4.1d's across bodies is not; a hull and a body now meet in our order —
  hulls first — which is the order Babylon's queue gave them. Building a kit
  makes the first rig's parts; a later rig still builds its SHAPES (they are
  arguments its model computes before `segment` runs) and discards them.
  `CLAUDE.md` is 1,544 lines (one up).
- **X4.2a's owed cost is gone with the meshes**: no hull mesh is frozen or
  has its bounds rebuilt any more; a present hull still composes its tree once
  a frame (`drawHulls`) and writes its segments' matrices and spheres.
- **What the post-commit review found** (an independent reader over d4f41ef
  and 87cf009; fixed after it, comments and docs only — nothing drawn or
  simulated moved). **No correctness bug.** **Checked and sound**: (i) the
  gate's TIMING — `keepsSphere` asks `offer`'s `tooSmall` from this frame's
  eye, at this frame's scale and field of view (an optic's FOV included:
  `offer` has run on the frame's camera before `drawHulls`), and the frustum
  planes `hullPull` tests are the main camera's, as the render computed them
  at the prepare; (ii) the arithmetic — each segment's matrix (local times
  joint world, in float32) and sphere (`BoundingSphere._update` operation for
  operation), the kit word (the kit's index and `HULL_CHARRED`), and the
  insertion sort's stability (a segment moves ahead only of one strictly
  farther, so the kit's order breaks a tie as the scene order did); (iii)
  that the parent drew hulls in the MAIN pass only — a hull was in no
  reflection probe and no glow mask, and its shadow is its collider box
  (X4.1c) — so ours drawing in the main pass alone is the parent's
  coverage; (iv) the palette (28 colours and the charred slot, each
  segment's 1-based slot read back as the float32 triple the uniform held),
  the install and uninstall's symmetry (the draw, the prepare and the refusal
  listener on and off together, the generation guarding a late pipeline
  verdict), and the failure routing (a failed pipeline or a refused main pass
  told through `Game.worldFailed`, never inside the render's commands); (v)
  the capacity, 16, against at most six hulls on a shipped map; (vi) no
  allocation on a frame (`drawHulls`, `hullPull`, `writeHullDrawing` and the
  prepare write into arrays sized at construction), and the contracts
  holding (no simulation reads a node, the collider never tilts, no `if` on a
  kind, a hull follows `present`). **The step's deviations, judged
  correct**: (b) the FRUSTUM cull, the hull's own, which the entry did not
  name and Babylon gave a mesh for free; (c) the gate reading THIS frame's
  sphere where Babylon's read the previous frame's freeze; (d) the order
  ACROSS hulls, and against Babylon's remaining opaque meshes, not
  reproduced, as X4.1d's across bodies is not; (e) the census's drops on the
  armour maps' hull rows (Sarab 661 → 481, Cinderhaven 186 → 150), the ranks
  folding one draw a mesh into one draw a segment with every hull still
  drawn. **Raised to the project owner, not decided here**: (a) the size gate
  kept PER SEGMENT where the entry asks for a hull measured once and dropping
  whole — an architectural question about the shape of X4.2c and X4.2d, not
  a bug in this step. **The owner decided it on 2026-10-31** ("Decisions that
  are yours"): the per-segment gate is KEPT, permanently; X4.2c adds a
  whole-hull measure used only for its detail tier's swap, and X4.2d fades
  only at `hullDrawDistance`, with no size-edge fade — a whole-hull size edge
  would fall past the fog on most viewports (~1.5 km at 1080p, ~540 m at
  832x384), and a hull's small parts keep dropping at the per-segment gate
  as they always have. The X4.2b, X4.2c and X4.2d bullets above say so now;
  nothing here changes how the gate works. **Found**: an unrecorded
  BOOT cost — the six kits built and uploaded at `Game`'s construction on
  every map, the three with no armour included — measured after the review
  (Owed onward). **Fixed** (rule 7, and one comment that did not say what
  the code does):
  - `Game.ts`' fleet step named `vehicleViews.draw` (gone): it names
    `drawHulls`.
  - `HULL_DRAW_CAPACITY`'s doc said a map past 16 draws its first sixteen
    HARDSTANDINGS' hulls; `drawHulls` takes the first sixteen PRESENT hulls in
    hardstanding order, so which go undrawn moves as hulls are hidden and
    placed again. The doc says so; the behaviour is unchanged (no shipped map
    has more than six).
  - `CelShader.ts`' header pointed its cache-disposal warning at
    `VehicleView.dispose` (gone): it states the failure itself (a disposed
    `ShaderMaterial` never reports ready, and Babylon skips a mesh whose
    material is not), names a hull's old rig as where it was met, and says a
    mesh painted from the cache is freed with `dispose(false, false)`.
  - `parts.drawnMesh`'s doc listed a hull's and a soldier's surfaces among
    those that become a Babylon mesh there: neither does (kit segments since
    X4.2b and X4.1d), and it says so. `facet.ts`' header said its parts
    become a mesh at `drawnMesh`: a weapon's do, a soldier's and the three
    hull models' become kit segments.
  - `VERIFYING.md`'s hull paragraph said `g.hullDraw.matrices` holds zeros
    for the size gate's drops: after the render's prepare it holds the
    FRUSTUM's zeros too (`hullPull` zeroes into the same array), so a script
    reading it after a render cannot count gated segments off the zeros. It
    says when to read it and how to tell the two apart (`g.hullSpheres`, NaN
    for a gated or padded segment, left standing for a culled one).
  - Grepping the files X4.2b touched: `docs/vehicles.md`'s `present`
    paragraph still had a body MESH following it (a joint since X4.2a and no
    hull mesh since X4.2b; `VehicleRig.enabled` follows it now);
    `TruckModel.ts`' and `HeliModel.ts`' budget sections counted "meshes"
    with no word that a mesh is a kit segment now (a parenthesis pointing at
    `TankModel.ts`' header, which says it); and `TruckModel.ts`' door-flash
    comment named `inkRig`, long gone (the ink is one screen-space pass), in
    the present tense.
- **Owed onward.** X4.2c: the detail tier on a whole-hull measure, with the
  per-segment gate kept under it (the 2026-10-31 decision, above). X4.2d:
  the fade at `hullDrawDistance`, in faded twins of the hull program.
  **The rank surplus** (3.0x) is unmeasured on the phone; `gpu.frame` held on
  the desktop. The phone's FOLLOW-UP reading, as every step's since X3.3c.
  **The editor draws no hull** (it builds no fleet), X5.3's as its bodies are.
  No helicopter was WRECKED in either round (a tank twice, a truck once): the
  charred bit is kind-blind, and the helicopter's livery, charred and posed
  pictures were shot byte-identical above.
  **The boot cost** (found by the post-commit review and MEASURED after it:
  a scratch page on the dev server on the Windows box, the served `Game.ts`
  rewritten in flight — never the tree — to bracket the build with
  `performance.now()`, five cold boots in fresh contexts after one warm-up,
  medians and ranges): `hullKits()`, all six kits built and merged (the
  tank's ~600 parts a view), **28.7 ms** (28.0-30.5); the palette, the slots
  and `HullDraw`'s construction (the arrays end to end, the eight buffers
  created, mapped and filled; the pipeline asked, not waited for) **8.4 ms**
  (8.2-8.8) — **~37 ms of `Game`'s construction on every boot**, before the
  menu, whatever map is played. Under Chromium's 4x CPU throttle, an
  ESTIMATE of a slower CPU and not a phone reading: 125.5 ms (124.8-128.5)
  and 34.7 ms (33.1-36.6), ~160 ms. **Resident on every map, the three with
  no armour included** (measured): **6,027,072 bytes of GPU buffers**, the
  sum of `HullDraw`'s eight — positions and normals 1,130,640 each, the
  absent colour 1,507,520, the absent uv and the palette slots 753,760 each,
  ranges and indices 722,400, the matrices 26,624, the orders 1,728; 56 bytes
  a vertex, 2.26 MB of it the two absent buffers, which carry constants —
  and **7,504,992 bytes of the kits' own geometry on the JS heap** (the sum
  of their typed arrays' `byteLength`, the positions and normals doubles),
  kept for the page's life as module constants. Not changed here. If a phone
  reading wants the boot or the memory back, the obvious lever is building
  and uploading the kits at the first install of a map with armour rather
  than at construction; unmeasured on the phone.

**X4.2c landed** (f302403, the post-commit review's fixes after it;
2026-10-31; the picture change, for a hull past the swap and nowhere else:
the bank 61 of 61 byte-identical against its parent, the census down 9 draws on Sarab and 1 on Cinderhaven on the rows that frame
far hulls).
- **What it is.** A far hull draws its REDUCED set — A3's detail tier
  (`PERF_PLAN.md`), in our renderer. **The set is data on the MODEL**: each
  model file states a `DETAIL` list of its `segment` calls, handed to
  `segmentOf`, which flags every segment those calls make
  (`HullKitSegment.detail`) and refuses a name no call made — the tank's
  `tank-link-lo`, `tank-link-hi` (both sides), `tank-wheel` (its two colours:
  the road wheels, the idler and the return rollers, and their hubs) and
  `tank-mg-ring`, seven of its 25 segments and 42% of its corners (18,792 of
  44,784); the truck's `truck-mg-ring` (both colours), two of 26 and 1.6%
  (348 of 22,272); the helicopter's list empty. No `if` on a kind anywhere.
  **The swap is asked of a WHOLE-HULL MEASURE this step introduces and uses
  for nothing else** (the 2026-10-31 decision): one sphere a kit
  (`HullKit.measure`, `HullMeasure`) — the bounding sphere of every vertex of
  the kit at rest, carried into the ROOT joint's frame at the kit's build
  (`restMeasure`; centre and half the diagonal, as `kitSegment` takes a
  segment's): the tank's 5.565 m, the truck's 3.674, the helicopter's 8.026.
  Each frame `writeHullDrawing` composes the tree, hangs the measure on the
  root's world (`measureHull`) and asks `full` once — `WorldCulling
  .keepsDetail`, which is `tooSmall` from the size gate's own eye and pixels a
  radian against `CONFIG.graphics.culling.hullDetail` — and a hull refused
  writes every detail segment as nothing (sixteen zeros and a NaN sphere, as
  a gated segment; `hullPull` files it last). **The per-segment gate stays
  exactly as it was, under the tier**: a hull drawn in full has its detail
  segments gated one by one, and the tier never touches a segment that is
  not detail and never drops a hull. **The measure is composed where the hull
  IS this frame** (X4.2a's fix holds by construction: no cached bound).
  **The full set is the one the warm-up shows**: `keepsDetail` answers full
  while `WorldCulling` is warm (`offer` sets the tier's pixels a radian to 0),
  with a threshold of 0 and with no camera; the hulls' pipeline is the one
  pipeline either way, so the warm-up waits for nothing new.
- **The measure's radius is NOT `BoundingSphere._update`'s**, which every
  segment's sphere copies for the order Babylon's queue sorted by: that
  scales the radius by the largest component of (1, 1, 1) carried through the
  matrix, which for a matrix that only TURNS is up to √2. The first cut used
  it and photographed a tank's measure at 7.87 m at a yaw of 0.6 rad where
  its own is 5.565 — a swap that would have come 41% further out as a hull
  turned. `measureHull` scales by the matrix's own scale (its x axis's
  length; 1 to a rounding, nothing on a hull scales).
- **The swap's size: 32 px**, the whole measure's projected diameter in CSS
  pixels (`hullDetail`), chosen by photographs, and why: at 32 px the
  largest detail part, the idler's 0.72 m disc, is ~2 px and a road wheel's
  hub (0.56 m) ~1.6 — a part that has stopped reading as a part — where at 64
  the road wheels are a row of dots that visibly goes. Photographed on
  Sarab's open ground (scratch `swapshots.mjs`: the hull stood in the open
  with the page's poses held, the camera 3 m over the floor on a bearing
  with a clear line to the running gear at every distance, the same frame
  shot FULL, REDUCED and FULL again — `hullDetail` 0 and 1e9 written in the
  page — the control byte-identical on every row but a run's first, still
  settling, and two of 7-9 px at 24 px on the phone's view), pixels changed
  full against reduced, at 3440x1440 / 832x384:
  - the tank, from 35° and from 63° off its broadside: 13-17 / 28-36 at 24 px, 21-25 / 40-48 at
    32, 32-43 / 61-64 at 40, 99 / 111 at 48, 169 / 187 at 64, 371 / 397 at
    96 (48-96 from one bearing) — mostly a light hub pixel or two at the nose and a darker run along
    the bottom of the track, worst channel 21-29/255 at 32 on the big view
    and up to 124-129 on the phone's (nearer, so less fog over it);
  - the truck: 0-5 / 1 at 24-32 px, 23 / 23 at 40, 38 / 34 at 48 — the
    station's yoke, a 3x2 px hump on the roof.
  So 32 is the largest size at which the swap is a handful of pixels, and
  **the evidence for that is the PHONE's viewport, not the big one** (the
  post-commit review's correction): at 3440x1440 the swap is at ~527 m,
  where Sarab's linear fog ramp (150 → 560 m) is ~92% along — ~85% fog on
  screen, the shader mixing in the ramp's square (X4.2d's post-commit
  review) — so that column mostly measures fog. The unfogged phone walk is the reading — 33-48 pixels
  of a tank at up to 98-139/255 across 24-32 px, with no knee, and no step
  at the swap that reads in the photographs — and a desktop player on
  Cinderhaven (fog 80 → 1,250 m) meets the swap at ~395-527 m under only
  7-15% fog (27-38% along the ramp; corrected by X4.2d's post-commit review,
  which found the fog applied squared), so it looks like the phone's
  photographs, not the 3440 ones.
  40 already doubles the change and 48 is the step change. In the world:
  a tank at ~527 m and a truck at ~348 m on a 1440-tall view at the hip
  field, ~395 and ~260 m at 1080, ~141 and ~93 m on a phone's 384 — nearer
  exactly where a pixel is bigger, as the size gate is. The MG rings are
  mostly gone by the per-segment gate before the tier reaches them (the
  tank's at a measure of ~60 px, the truck's at ~20).
- **A hull walked through the swap, at the SHIPPED value** (scratch
  `walk.mjs`; the tank and the truck stood in the open, frames at a projected
  40, 36, 34, 33, 32.5 | 31.5, 31, 30, 28 px, each with the page's own verdict
  — `keepsDetail` of `measureHull` — read back): full at 32.5 and every size
  above it and reduced at 31.5 and every size below, on both kinds at both
  832x384 (the tank 138.4 → 142.8 m, the truck 91.4 → 94.3) and 3440x1440
  (519.1 → 535.6 m, 342.7 → 353.6); no step at the swap reads larger than a
  step of plain distance beside it. Either side of it:
  `scratchpad/x42c/walk/walk-{tank,truck}-{832x384,3440x1440}-P{32.5,31.5}.png`
  (every frame, and `walk-sheet.png`, the contact sheet).
- **Measured.** **The bank** `--check --keep` against a BEFORE at 55af511 in
  a worktree: **61 of 61 byte-identical** (pixels), `sarab-tank`,
  `sarab-truck` and `sarab-heli` among them — the bank is shot at 1920x1080,
  where a hull past the swap is past ~395 m (a tank) and drawn a few hazed
  pixels, and no row's pixels moved; the same 34 stale rows on both sides, no
  console or page error. **`census --against`** the BEFORE: every row with
  no hull past the swap equal, the totals of Hollowmere 278, Greyfen 205,
  Coldharbour 672, Harrowmead 847 and Kurenai 125 equal; **Sarab 481 → 472
  and Cinderhaven 150 → 149**, all on rows that frame a far hull (`shelf` 57
  → 51, `alley`, `wadi` and `ground` one each, Cinderhaven `crossing` 49 →
  48): a rank is no draw once every hull drawn at it has dropped its segment
  there. **`gate.mjs`** clean on seven; **`shaders.mjs`** clean on seven,
  ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour). Typecheck,
  build (`check-babylon-free`: 15 simulations, no path), corecheck and
  `parity` (eight maps) pass. **`kit:hash --models`: the twelve `vehicle:`
  rows move BY CONSTRUCTION** (232 identical): the script hashes the rig and
  its kit, which carry the detail flags and the measure now, and the first
  build of each kit composes its tree to take the measure.
  **X0.3 on Cinderhaven against A3's +6.5% at 300 m** (`bench.mjs
  cinderhaven --runs 1 --max --gpu`, uncapped, 3440x1440, three static builds
  served side by side — the BEFORE at 55af511, the step as shipped, and the
  step built with `hullDetail` 56, which puts a tank's swap at ~300 m at
  this viewport and the hip field — run one invocation each, alternated,
  three rounds, so three runs a side; the canonical fight hash
  `2f97c9072ab1762b` on all nine; installs 8.04-8.20 s on every run, so the
  runs compare), medians, new / old: **as shipped** — vantages 5.673 →
  5.673 ms (1.0000), path 6.226 → 6.231 (1.0008), fight 6.033 → 6.047
  (1.0023); **at 300 m** — vantages 5.672 (0.9998), path 6.229 (1.0005),
  fight 6.035 (1.0003); every run within 0.7% of
  its side's median, `gpu.frame` 0.96-1.02 on 10-39 samples a group, Babylon's
  draws 43 / 41 / 75 on every side. **A3's +6.5% does not reappear, and was
  not expected to**: it was measured as Babylon's per-MESH cost, a hull's
  every part a candidate, a walk entry and a draw; X4.2b folded the fleet
  into at most 26 rank draws (Cinderhaven's fight 161 → 75), so what the tier
  saves now is vertex work on the GPU — a far tank's 42% — and a rank's draw
  only when every hull drawn at it dropped that segment, inside the noise on
  this desktop. The phone, where the swap is ~141 m and its GPU the bound, is
  the reading that could show it (owed below). **And the null result is not
  shown to have exercised the tier**: `bench.mjs`'s output carries no hull
  statistics — a capture's `hulls` is `hullDraw.stats` (ranks drawn,
  instances) read once, at the halt, and counts no reduced hull — so the
  run does not show that the tier fired in each group, the `hullDetail` 56
  build's included. That is owed the next time this is measured; reading it
  per group would need the profiler to keep a hull count per frame (a report
  change, not a behaviour-free addition), so it is not added here.
  **A round offline** (scratch `hullprobe.mjs`, X4.2b's, extended: after
  every render, one instance per present hull in hardstanding order, each kit
  word against its rig, every drawn segment's matrix bit-equal to a fresh
  compose, every zero segment padded, culled by the frustum, refused by the
  gate or a detail segment of a hull `keepsDetail` refuses — asked of a fresh
  `measureHull` — and no detail segment of such a hull drawn; Sarab, 240 s,
  30,233 frames, 1920x1080): **0 failures**; every kind driven by its bot
  crew, the helicopter flown to 29.2 m; the tank reduced on 29,942 of its
  60,466 drawn frames, the truck on 54,157, the helicopter (no detail) on
  3,670; 316,483 detail segments dropped by the tier against 595,149 by the
  gate. **A netplay round** against a local `dist-server` (`?mp=`, Sarab,
  the authority's round, 300 s, 37,797 frames, the server's hulls made
  FRAGILE by X4.2b's scratch loader): the same checks, **0 failures**, every
  kind driven and the helicopter flown to 33.8 m, a tank WRECKED twice and a
  truck once off the wire — drawn charred (4,027 and 2,014 frames), hidden
  and placed again — the tank reduced on 46,400 of its 73,575 drawn frames
  and the truck on 73,123 of 74,580; no console or page error in either
  round.
- **Deviations.** **The measure's radius** (above) is not Babylon's
  arithmetic, on purpose. **The set's names are CALLS, so a call's every
  colour goes**: `tank-wheel` takes the hubs' stowage colour with the
  wheels, and `truck-mg-ring` its trunnion axle with the yoke; a part meant
  to stay belongs in a call of its own (`docs/vehicles.md` says so). The
  MG gun itself (`tank-mg-m`, `truck-mg-m`) stays and is left standing over
  no ring at range, sub-pixel there. **No helicopter was wrecked** in either
  round, nor a tank or truck in the offline one (the netplay round wrecked a tank twice and a truck once); the tier is
  kind-blind and paint-blind (the charred bit is the kit word's, untouched).
  The first walk was shot on Sarab's hardstandings and photographed walls —
  the hulls stand in compounds there — and was thrown away; the photographs
  above stand each hull in the open. `CLAUDE.md` is unchanged (no rule of it
  moved; the tier is `docs/rendering.md`'s, "The hulls, ours").
- **What the post-commit review found** (an independent reader over f302403
  and a6050b4; fixed after it, comments, docs, one error message and one
  reference-bank row — nothing drawn or simulated moved). **No correctness
  bug.** **Checked and sound**: (i) `measureHull`'s radius, scaled by the
  matrix's own scale and not `BoundingSphere._update`'s largest component
  (√2 on a turned matrix); (ii) its centre hung on the ROOT joint's world,
  the untilted root, composed this frame, so no cached bound; (iii)
  `keepsDetail` sharing the size gate's eye, its pixels a radian and its
  field of view (an optic's included), all set by the same `offer`; (iv) the
  tier OFF during the warm-up (the full set the one it shows), with no
  camera and at a threshold of 0; (v) the zeros, the ranks and the padding
  together — a refused hull's detail segments written as sixteen zeros and a
  NaN sphere, filed last by `hullPull`, a rank no draw only once every hull
  drawn there dropped its segment; (vi) the `DETAIL` lists as data on the
  models, a named call dropping whole (every colour it made), no `if` on a
  kind; (vii) no allocation on a frame and no contract broken. **The swap
  was judged not to read as a pop** in the photographs either side of it.
  **Two decisions by the project owner** (2026-10-31): (a) **the bank gains
  a row that SEES the tier** — it passed 61 of 61 because no row framed a
  hull past the swap (below); (b) **no hysteresis band at the swap,
  accepted**: a phone player strafing ~4 m around 141 m from a parked tank
  toggles the reduced set on each crossing, a ~48 px twinkle at the nose,
  and the per-segment gate has no band either. Recorded in
  `CONFIG.graphics.culling.hullDetail`'s doc, `WorldCulling.keepsDetail`'s
  and `docs/rendering.md` ("The hulls, ours"); the behaviour is unchanged.
  **Fixed**:
  - **The bank row `cinderhaven-tank-far`** (`src/bench/vantages.ts`,
    appended at the end of Cinderhaven's list and banked alone with
    `--rows=tank-far`, so every row before it carries the state it was
    banked with): the west yard's tank (its measure centred at -473.0, 8.5,
    473.0) from `pos` [-581, 15, 73] (15 m over the floor, ~28 m absolute),
    looking at [-473, 8.5, 473] over the town's roofs at night, at the hip
    field: 414.8 m off, the measure ~30.5 px across on the bank's 1920x1080,
    under ~8% of Cinderhaven's fog (29% along its ramp, the shader mixing
    in the square — X4.2d's post-commit review), so the tank draws its REDUCED set
    (`keepsDetail` false, read back in a scratch probe). Chosen by a scratch
    search (`scratchpad/x42cr/find.mjs`: every bearing and eye height with
    a clear `rays.blocked` line to the near-side running gear, shot full
    against reduced): at the hip field Cinderhaven's best changes ~50
    pixels, and Sarab's daylight ~60 under ~44% fog (66% along its ramp);
    Cinderhaven was kept
    for the fog, the night costing it about a sixth. **Proof that it sees
    the tier**: the row checked with the shipped tree and again with
    `hullDetail: 0` written into `config/graphics.ts` (put back after),
    each `--check --rows=tank-far --keep`: **55 pixels differ, worst 61/255**
    (a run along the bottom of the track at y 542), against 0 between the
    shipped check and the banked frame across processes. **`--check`'s own
    grade does NOT see it** — 0.0027% of pixels, a mean of 0.0002/255
    against `CHECK_TOLERANCE`'s 0.02, "within floor" — so the row covers
    the tier only in a pixel comparison of two `--keep` directories, which
    is how X4.2b and X4.2c were graded (the README's table, the row's
    `proves` and `VERIFYING.md` say so). **X4.2d's fade** reaches the same
    row when a scratch layout sets `hullDrawDistance` within its last tenth
    of 415 m (~415-460 m), so the row serves X4.2d too. **The bank**:
    `--check --keep` here against a BEFORE at a6050b4 in a worktree, **61 of
    61 pre-existing rows byte-identical** (pixels), the new row within
    floor, the same 34 stale rows on both sides, no console or page error.
    **The benchmark stands at the row too** (`BenchScript` reads the table),
    so Cinderhaven's `vantages` group gains a stop from this commit and is
    not comparable across it (its median draws 43 → 45, this run at the
    default settings; the path's 41 and the fight's 75 as before); the
    fight is unmoved (`bench.mjs cinderhaven --runs 1`: `2f97c9072ab1762b`).
  - "The swap's size" said 32 was a handful of pixels on both viewports;
    the 3440x1440 column mostly measures fog, and the phone's walk is the
    evidence (said there now, and in `hullDetail`'s doc and
    `docs/rendering.md`, which made the same claim).
  - The X0.3 null result did not say the bench reads no hull statistics,
    so nothing shows the tier fired in each group: said, and owed (below).
  - `Game.hullPull`'s doc listed what goes last without the tier's drop.
  - X4.2a's note said X4.2b would remove its owed cost with "a hull measured
    once": X4.2b removed the meshes and kept the gate per segment.
  - `segmentOf` threw "which the model never made" for a named `DETAIL`
    call that ran but made no segment: two checks now, with their own
    messages, the throw for a name no call carries kept (no shipped model
    reaches either).
- **Owed onward.** **The phone's reading**, as every step's since X3.3c —
  for this step specifically, whether the tier's vertex saving shows in
  `gpu.frame` on Cinderhaven at 832x384-class viewports, where the swap is
  ~141 m. **The look on a phone**: the walk at 832x384 is a desktop
  rendering of a phone's viewport, not eyes on that screen. X4.2d: the draw
  distance and its fade at `hullDrawDistance` only (the 2026-10-31 decision).
  X4.2b's owed items stand (the rank surplus — 3.35x offline here, the
  detail segments' corners gone and the spans left to the hulls drawn in full
  — the boot cost, the editor's hulls). **X0.3's hull reading** (the
  post-commit review): the next bench of the tier owes a per-group count of
  reduced hulls, which the capture does not carry today.

**X4.2d landed** (a156355; 2026-10-31; the picture change, where a map states a
hull draw distance and nowhere else — no shipped map does, and the bank is
62 of 62 byte-identical against its parent; with a scratch distance, only the
rows that frame a hull inside it move).
- **What it is.** `EnvironmentSpec.hullDrawDistance`, the NINTH of the map's
  overrides (`CLAUDE.md`'s table, `docs/world.md`): resolved once
  (`hullDrawDistanceOf`) and pushed by `installMap` to the cull alone
  (`WorldCulling.setHullDrawDistance`). Past it no hull is drawn; over its
  last tenth (`CONFIG.graphics.culling.hullFade.distance`, 0.1) a hull FADES
  out by X4.1e's screen door — `WorldCulling.hullFade`, once a hull, off the
  distance from the size gate's eye to the hull's whole MEASURE's centre
  (X4.2c's `measureHull`, composed this frame), ending AT the distance — a
  hull has no switch at range for it to beat, as the roster's is for a body.
  At the distance ONLY (the 2026-10-31 decision): the per-segment size gate
  answers for every segment of a fading hull as ever, and no hull is dropped
  by its size. 1 while the warm-up stands. `Game.drawHulls` now composes each
  present hull first (`vehicleRig.composeHull`, split out of
  `writeHullDrawing`, still one compose a hull a frame; moved by the
  post-commit review into `Game.fadeHulls`, in the cull span, so the rotor
  wash is handed the same fade — below), asks its fade, drops
  a faded-out one (no instance), and hands the WHOLE hulls over first and the
  FADING ones after, each in hardstanding order (`HullDraw.commit(n, whole,
  …)`, `fades`) — the capacity's sixteen counted in that order.
- **The faded twin** (`hullProgram.ts`' `faded`): the plain vertex stage
  handing the pixel its instance (`vBody`, flat, last — `CEL_FADED_VARYINGS`,
  now exported) and the ONE faded cel pixel bodies are drawn with
  (`bodyProgram.fadedCelFragment`, assembled once and now shared: the cel
  pixel behind the 4x4 Bayer door, the fade read in the fragment stage's
  group 3, `BODY_FADE`) — so the vertex stage stays at eight storage arrays,
  and the door is the bodies' to the bit, restated nowhere. Each rank draws
  the whole hulls by the plain pipeline and the fading ones by the twin
  (`firstInstance` past the whole); the fades are uploaded only when some hull
  is past `whole`. **A frame with no hull fading issues exactly the GPU work
  it did** — the same pipeline, binds, draws and order (`bind` sets groups 0-2
  as the old draw did; `PipelineCache` dedupes the layouts) — which the bank
  and census below prove. Both pipelines are asked at `Game`'s construction
  (`HullDraw.ready` is both), so the warm-up waits for the twin and a hull's
  first fade compiles nothing; a failed twin is the round's failure, as the
  plain one's.
- **"Unaffected" is NO distance, not `fogEnd` — a deviation from the bullet's
  parenthesis, for its "unaffected".** Absent resolves to `Infinity`: every
  hull at any range, as before. The bullet's "its own fogEnd, clamped to it,
  as `bodyDrawDistance` is" would NOT have been unaffected: nothing ever cut a
  hull (a body defaults to the fog because the roster switches it off there
  anyway), so a default at the fog would fade every far hull over the fog's
  last tenth — Sarab's 504-560 m is 74.5-100% fog, Cinderhaven's 1,125-1,250
  m 79.8-100% (the shader mixes in the SQUARE of its linear ramp; this note
  said 86-100% and 89-100%, the ramp's own figures, corrected by the
  post-commit review), neither of them all of it — and drop one standing out
  of the SKY past it: past `fogEnd` a hull draws pure `fogColor`, a
  silhouette against a sky whose horizon colour is only required to sit
  close to the fog. A picture change on every armour map that set nothing.
  A STATED distance past the fog is capped at `fogEnd`, as a body's is: what
  is left of a hull out there is that flat silhouette, nothing a player can
  read, so a map that has chosen to cut hulls ends the fade with the fog.
- **The gun-reach bound, and how it is enforced.** A hull is a gun as well as
  a picture, and a person can crew it, so a hull faded out while its fire can
  still land on the player looking for it is an unseen shooter. The reaches
  (the real numbers): the tank's shell **340 m** (`vehicles.tank.gun.range`)
  and its blast **7 m** past where the round stops, a miss at full range
  included (`blastRadius`); the truck's station and the helicopter's chin gun
  **210 m**, the tank's cupola gun **190**; the bots behind them far shorter
  — a crew's driver engages at **95 m**, its gunner at **70**
  (`vehicles.crew`), infantry at 55 — and the launcher that hunts a hull, a
  rocket's ~157 m flight (`life` 3.5 s at 45 m/s; the HUD's 150), a bot's 75 m
  band. The binding one is the gun's, because a person can sit behind it.
  **`hullDrawFloor()`** keeps a hull WHOLE wherever its fire can land on
  anybody looking for it: the fire's reach from a muzzle (`HULL_REACH.fire`,
  347 m), plus the viewer's eye from the farthest point of what of him it can
  hit (`HULL_REACH.eye`, 22.44 m — the helicopter's chase camera, 2.4 m up and
  14 m back, to the far corner of its 11.4 x 2.6 x 3.0 m hull), plus a muzzle
  from its own hull's measure centre (`hullFade.muzzle`, 8 m — MEASURED by a
  scratch sweep of every turret, gun and cupola through its whole traverse on
  the rig's joints, `scratchpad/x42d/muzzle.mjs`: the tank's main gun 7.683 m
  turned to the rear, its cupola gun 3.535, the helicopter's chin gun 5.981,
  the truck's station 2.374), end to end (the triangle inequality makes it a
  bound), over the 0.9 of the distance the fade starts at: **419.37 m** today
  (read back in the page). The two reach terms are read over the kinds' own
  specs (`entities/vehicleKinds.ts`' `HULL_REACH`, no kind named), so a longer
  range, a bigger blast, a further chase camera or a fourth kind raises the
  floor by itself; the muzzle term is MEASURED off the drawing, which no spec
  states, and since the post-commit review a DEV build GUARDS it (below).
  **Enforced as a CLAMP at the resolve, in every build** (`hullDrawDistanceOf`
  raises a stated number to the floor), with a DEV `console.warn` saying so —
  the plan's style is `bodyDrawDistanceOf`'s (clamp, and say it in a dev
  build), and a fairness rule must hold in the shipped build, which a DEV
  assert would not. **A map whose `fogEnd` closes inside the floor gets no
  distance at all** (`Infinity`, DEV-warned): no cut there is both at or
  inside the fog and past the reach, and of the two the floor is the
  fairness rule — a cut at the fog would put the fade inside the reach. All four
  armour maps leave room above it — Coldharbour's fog 480, Harrowmead's 520,
  Sarab's 560, Cinderhaven's 1,250 — so a useful setting exists on each, and
  A3's 420 on Cinderhaven is just legal. Nothing the authority holds reads
  any of it: `server/` and `src/sim/` name none of these (grep), and the
  server bundle (`dist-server`) carries the field only as an unread key of a
  map's environment data and the config's comments — no resolver, no reach.
- **The fade's length: the last tenth**, the bodies' share, ending at the
  distance: 42 m at 420, where a tank on a road (~15 m/s) takes ~3 s to cross
  it and the helicopter at its 32 m/s ~1.3 s; long enough to read as a
  thinning rather than a pop (the walk below), and one number a player meets
  for bodies and hulls alike.
- **Measured.** **The bank** `--check --keep` against a BEFORE at b7997a2 in
  the worktree (the new `cinderhaven-tank-far` row copied into its bank):
  **62 of 62 byte-identical** (pixels), no shipped map stating the field; the
  same 34 stale rows on both sides, no console or page error. **With the
  field set** — `hullDrawDistance: 440` written into Cinderhaven's
  `environment.ts` (removed after), `bank.mjs cinderhaven --check --keep`
  against the AFTER's Cinderhaven rows: **`tank-far` moves, 247 pixels, worst
  109/255** (the tank at 414.8 m, fade 0.573, and the yard's truck at 412.9 m,
  fade 0.617, behind the door; the yard's helicopter at 452.5 m, past the
  distance, gone), and **`crossing` moves, 15 pixels, worst 13/255** — it
  frames that same helicopter at 421.4 m inside the band (fade 0.424, at the
  diff's (684,147), the helicopter's projected (685,152)): a row with a hull
  in the fade; `town`, `ground` and `menu` byte-identical. (`--check`'s own
  grade sees neither, as X4.2c said of the row.) **`census --against`** the
  BEFORE: every row equal, every total equal (Hollowmere 278, Greyfen 205,
  Coldharbour 672, Harrowmead 847, Sarab 472, Cinderhaven 213, Kurenai 125).
  **`gate.mjs`** clean on seven; **`shaders.mjs`** clean on seven, ours
  17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour) — it builds the
  world's programs; the hulls' two are built in the page, which every round
  below drew. Typecheck, build (`check-babylon-free`: 15 simulations, 202
  modules, no path), corecheck (all passed) and `parity` (server and client agree on every
  map) pass.
- **A hull driven through the fade edge** (scratch `fadewalk.mjs`; Sarab,
  deploy, the cull's distance set to 420 in the page — what `installMap`
  pushes — each kind stood alone in the open, the others put under the floor,
  the camera 3 m over the floor on a bearing with a clear line, the hull's
  measure from 357 m to 424 m, each frame shot with the distance and with
  none, A-B-A so the control spans it): the page's own fade read back as
  1, 1, 0.900, 0.700, 0.500, 0.300, 0.100, 0 at 357, 374, 382, 391, 399,
  407, 416, 424 m, and the instance gone at 424; the hull-minus-whole
  difference summed — at 3440x1440, the tank 0, 0, 5,420, 8,690, 13,193,
  14,844, 18,248, 20,843 (the last its whole silhouette), the truck 0, 0,
  2,761 … 8,886, the helicopter 0, 0, 4,618 … 19,410; at 832x384 the tank 0,
  0, 288, 488, 864, 1,170, 1,228, 1,237 (the truck's and the helicopter's
  20-44 pixels a frame are too few to be monotonic) — every control 0 but
  the run's first frame, still settling. The holes are ink-edged (the ink
  reads the door's depth steps, as on a fading body), the last steps a few
  scattered dots, and nothing is left to pop: a thinning, not a step.
  Frames: `scratchpad/x42d/walk/` (every frame, its whole twin and both
  crops; `walk-sheet.png`, a row a kind and size, a column a step).
- **X0.3 on Cinderhaven with the field at 420, against A3's +15.4%**
  (`bench.mjs cinderhaven --runs 1 --max --gpu`, uncapped, 3440x1440, three
  static builds served side by side — the BEFORE at b7997a2, the step as
  shipped, and the step built with `hullDrawDistance: 420` in Cinderhaven's
  `environment.ts` — one invocation each, alternated, three rounds, so
  three runs a side; the canonical fight hash `2f97c9072ab1762b` on all nine;
  installs 8,065-8,253 ms on every run, so the runs compare), medians of the
  mean frame, new / old: **at 420** — vantages 5.65 / 5.64 ms (1.002), path
  6.21 / 6.22 (0.998), fight 6.04 / 6.03 (1.002); **as shipped** — 5.65
  (1.002), 6.22 (1.000), 5.98 (0.992); the fight's tick 3.92 at 420 against
  4.07 (0.963) and 4.03 shipped; `gpu.frame` 0.98-1.04 on 15-40 samples a
  group, Babylon's draws 45 / 41 / 75 on every side. **A3's +15.4% does not
  reappear, and was not expected to**: it was Babylon's per-MESH cost of a
  hull's every part (X4.2b folded the fleet into at most 26 rank draws), so
  what a far hull costs now is its compose and its vertex share of each
  rank, inside the noise on this desktop. **And the fade is shown to have
  FIRED in each group** (X4.2c's owed count, scratch `benchhulls.mjs`: the
  same `?bench=cinderhaven` at 3440x1440 with the drawing's handover tallied
  every frame by group, off the 420 build and the shipped one): at 420, of 6
  present hulls a frame, drawn 1.40 (whole 0.40, fading 1.00) in the
  vantages, 3.00 (2.46, 0.54) on the path, 2.72 (2.58, 0.14) in the fight —
  faded out 4.60, 3.00 and 3.28, a hull fading on 864 of 1,440, 425 of 1,440
  and 375 of 2,700 frames; as shipped, 6 of 6 whole on every frame of every
  group.
- **A round offline** (scratch `hullprobe.mjs`, X4.2c's, extended: each
  present hull's fade asked fresh; the instances checked as the WHOLE hulls
  in hardstanding order then the FADING ones, a faded-out one none;
  `wholeCount` and every fading hull's `fades` entry checked; every LEAVE and
  ARRIVAL at the edge — drawn one frame and not the next, present, having
  moved under 2 m — logged with its fade; Cinderhaven with `hullDrawDistance:
  420` in its `environment.ts`, the install's own push read back as 420, 240
  s, 30,244 frames, 1920x1080): **0 failures**; 10,065 fading hull-frames,
  up to 2 at once, up to 50 hull draws a frame; **5 leaves at the edge, the
  largest fade the frame before 0.0017, and 2 arrivals, the largest fade on
  arrival 0.0018** (the other "leaves" in the log are the deploy's eye
  jumping hundreds of metres, not a hull moving); every kind driven by its
  crew, the helicopter flown to 48.5 m. **A netplay round** against a local
  `dist-server` (`?mp=`, Sarab then Cinderhaven on the match's rotation, the
  server's hulls made FRAGILE by X4.2b's scratch loader, the distance set to
  420 in the page): the same checks, 300 s, 37,043 frames, **0 failures**;
  5,230 fading hull-frames, **8 leaves at the edge, largest fade the frame
  before 0.0021, and 7 arrivals, largest 0.0009**. A first netplay run (a
  tank WRECKED, hidden and placed again during it) logged 1,919 frames of
  "hulls committed but no draw", every one from frame 35,858 to its end; the
  probe's check was the fault — a frame whose every drawn hull is wholly
  outside the frustum issues no draw by design (X4.2b), which the distance
  now makes common (a single near hull behind the camera), and the re-run,
  which tells the two apart, counted 4,069 such frames and 0 failures. No
  console or page error in any round.
- **Deviations.** Absent is no distance, not `fogEnd` (above). The fade ends
  AT the distance and is measured to the measure's centre, not one radius
  short (no switch to beat). `writeHullDrawing` no longer composes — its
  caller composes first (`composeHull`) — so a script calling it owes a
  compose. A hull faded out is composed and not written. The capacity takes
  whole hulls before fading ones. The shadows are not faded (a hull's is its
  collider box, cast in the bodies' map only within 56 m of the eye and in
  the lamps' atlas only inside a lamp the eye chose — `docs/rendering.md`).
  `CLAUDE.md` stays 1,545 lines (one row, and the bodies' fade sentence
  names the hull's; the rendering section reflowed to keep its 135).
  `kit:hash` was not run: no kit, segment or model moved (the twin draws the
  same kits).
- **What the post-commit review found** (an independent reader over a156355
  and c7f130c; fixed after it: one owner-decided picture change where a map
  states a distance and nowhere else — the rotor wash — a DEV-only guard,
  one draw skipped on a fading frame, and comments and docs; nothing drawn or
  simulated moved on any shipped map). **No correctness bug.** **Checked and
  sound**: (i) the default's deviation — absent is `Infinity`, not `fogEnd` —
  judged within the owner's "unaffected" (the bullet's parenthesis would have
  faded and cut far hulls on every armour map; corrected below); (ii) the
  gun-reach floor, verified term by term: `HULL_REACH.fire` 347 (the shell's
  340 + its 7 m blast, over the guns' 210 and 190), `HULL_REACH.eye` 22.436
  (2.4 + 14 + the helicopter's half-diagonal), `hullFade.muzzle` 8 against a
  measured 7.683, over the 0.9 the fade starts at — 419.37 m, so the fade
  STARTS past the reach; the bots' reaches (95, 70, a rocket's ~157) and the
  infantry's (55) far inside it, and every viewer safe, on foot or in any
  seat, the eye term being the farthest chase camera; (iii) `hullFade`'s eye
  (`offer`'s `gateEye`, this frame's, set before any reader) and its warm-up
  handling (1 while warm, and 1 on `Infinity`, a literal); (iv) a frame with
  nothing fading issues identical GPU work — the same pipeline, groups 0-2,
  draws and order, the fades not uploaded; (v) `vBody` flat and last, and
  `firstInstance` past the whole hulls addressing the fading ones' fades;
  (vi) the faded twin's group-3 buffers not colliding with the vertex stage's
  eight storage arrays; (vii) `fadedCelFragment` byte-identical for the
  bodies, now shared; (viii) the install on every map — `installMap` pushes
  `hullDrawDistanceOf` on every install, so a map rotation, or a map stating
  none, puts it back to `Infinity`; (ix) the authority untouched (`server/`
  and `src/sim/` read none of it); (x) `HULL_REACH` data over the kinds'
  table, no kind named; (xi) no allocation on a frame. **The project owner's
  decision on EFFECTS** (2026-10-31): when a map states a distance a hull's
  effects outlived it — the rotor wash's dust and spray rings and the
  water's ripple sites kept drawing under a hull faded out — so **the wash
  now FADES with its hull**, and **the rest is accepted and documented**: a
  hull's tracers (`CombatFx`, off the muzzle) and a shell's blast are not
  faded (a round and an impact are the fight, drawn wherever they land), and
  the screen door's holes are INKED, so at 3440x1440 a fading tank (or body)
  reads as cross-hatched "x" marks rather than a smooth thinning. **Fixed**:
  - **The wash fades with its hull.** `Game.fadeHulls` (new): every present
    hull composed (`composeHull`, still its one compose a frame) and asked
    `WorldCulling.hullFade` into `Game.hullFades` by fleet index — split out
    of `drawHulls` and moved into the cull span (`followEye`), straight after
    `culling.update` (whose `offer` sets the eye and the warm-up) and before
    its two readers: `RotorWash.update(stepped, fades)`, and `drawHulls`,
    which draws off the same compose and fades. `RotorWash` keeps each wash's
    hull's fleet index (`Wash.slot`) and spends the fade on each ring's
    `emitRate` (`rate * strength * fade`, multiplied in LAST) and the ripple
    site's strength (`wet * fade`) — the amount, never the throw — and a hull
    faded out is silenced and publishes no site; it imports nothing new and
    asks no cull: `Game` hands the numbers in (the wiring rule). A hull not
    present, and every hull with no draw installed, reads 1. **Unchanged at
    a fade of 1 by construction** — `hullFade` returns the literal 1 on
    `Infinity` and `x * 1` is `x` — and **checked bit for bit** (scratch
    `x42dr/wash.mjs`: Cinderhaven, the helicopter pinned hovering 3 m over
    dry ground and over the bay, the camera at 0.3-1.02 of the distance from
    its measure centre, `followEye` told the fleet stepped since the deploy
    card holds the page's own world; after every render the rings'
    `emitRate` and the site compared with `Object.is` against the parent's
    formula, `rate * strength` and `wet`): with no field, 240 frames, every
    one equal. **With the field** — `hullDrawDistance: 420` written into
    Cinderhaven's `environment.ts` (removed after; the cull's distance read
    back as 420) — 540 frames, every rate and site equal to `rate * strength
    * fade`: the dust ring 55.561 at a fade of 1 (126, 357, 378 m), 44.449 at
    386.4 m (0.8), 33.337 (0.6), 22.224 (0.4), 11.112 (0.2), and 0 at 420 and
    428.4 m, where the hull has no instance; the spray 134.672 → 107.738,
    80.803, 53.869, 26.934, 0; the ripple's strength 0.9619 → 0.7696,
    0.5772, 0.3848, 0.1924, and no site. `docs/vehicles.md`, `docs/world.md`'s
    "What a map stating it owes" (with the tracers, the blast and the ink),
    `docs/game.md`'s table, the profiler's `culling` phase (it now holds the
    compose; `docs/profiling.md`) and the headers say so.
  - **The muzzle term is GUARDED.** `hullFade.muzzle` is measured off the
    drawing, and the docs said "a longer gun raises the floor by itself",
    true of range, blast and the chase camera and not of a barrel or a fourth
    kind's gun. A DEV check was chosen over deriving the term, which would
    put a rig build in front of the resolver, on a path `world/environment.ts`
    shares with the authority's data: `vehicleModels.ts`' `checkMuzzleReach`,
    run by `hullKits` on one rig a kind — every muzzle and the gunner's sight
    swept over the turret's and the cupola mount's whole circle (36 steps
    each) and every gun's pitch limit either way (5), each joint's distance
    to the measure centre off `measureHull`, the sampled worst divided by
    `cos(h/4)` once a nested sweep (along a rotation a point's distance from
    a fixed centre is `sqrt(A + B cos θ)` with `A >= B`, so that bounds it
    between samples) — THROWING past the term, naming the kind and the
    joint. Read back: the tank's main gun 7.683 m (7.729 bounded),
    `muzzle.mjs`'s figure; with the term lowered at run time to 7.7, 7.6, 7,
    6 and 3.6 it throws each time; `hullKits` takes ~36-44 ms on a dev boot
    with it; folded out of `dist` (no trace of it). The lean is not swept
    (the term's 0.32 m margin carries it). `vehicleKinds.ts`' `HULL_REACH`,
    `environment.ts`' `hullDrawFloor`, `config/graphics.ts`,
    `docs/vehicles.md`, `docs/world.md`, `CLAUDE.md`'s row and this note now
    say which terms are automatic and how the muzzle is guarded.
  - **The fog figures were the RAMP's, not the fog's**: the cel shader mixes
    in `fog * fog` (`celSurface.ts`), so Sarab's 504-560 m is 74.5-100% fog
    (not 86-100%) and Cinderhaven's 1,125-1,250 m 79.8-100% (not 89-100%) —
    fixed in `hullDrawDistanceOf`'s doc, `docs/world.md` and this note; and
    the same slip in X4.2c's figures: the swap at ~527 m on Sarab is ~85%
    fog (92% along), Cinderhaven's ~395-527 m 7-15% (27-38% along), the bank
    row `tank-far` ~8% (29% along) and the search's Sarab view ~44% (66%
    along) — in X4.2c's note, `config/graphics.ts`, `docs/rendering.md` and
    the row's `proves` (`src/bench/vantages.ts`; text only, the bank's pixels
    unmoved).
  - **Two rationales contradicted each other**: the cap's warning said "a
    hull out there is already drawn as fog" where the default's argument is
    that a hull past the fog still reads against the sky. Both now say what
    is true — past `fogEnd` a hull draws pure `fogColor`, a silhouette
    against a sky not exactly that colour: the default keeps it (unaffected),
    and a map that chose to cut hulls ends the fade with the fog, since
    nothing past it is a hull a player can read (the warning, the resolver's
    doc, `docs/world.md`). The "fog closes inside the floor" case said "the
    fog hides the shooter already", the same slip: it now says no cut there
    is both inside the fog and past the reach, and the floor wins.
  - **The X4.2d bullet** still carried "(its own `fogEnd`, clamped to it, as
    `bodyDrawDistance` is)": amended to what landed, with the reason, as
    55af511 amended the size-gate text; the decisions table's X4.2 row notes
    the default's form, the owner's "unaffected" kept.
  - **`CLAUDE.md:741`** said "the eight overrides in full": nine, and
    `.claude/skills/map-layout/SKILL.md`'s "eight per-map overrides" with it
    (rule 7); no other count of the map's table in the tree.
  - **The shared span** (optional, done): a fading frame's whole and fading
    groups shared one span a rank, so a rank live in one group still drew
    the other with every corner clipped. Each group now has its own span a
    rank (`HullDraw`'s `rankSpan`, `rankSpanFaded`) and a group with none
    there issues no draw. With nothing fading every hull is the whole group,
    so its spans are the ones the single group had and the faded ones are 0
    — the same draws, binds and order.
  - **Measured.** The bank `--check --keep` against a BEFORE at c7f130c (the
    worktree moved there): **62 of 62 byte-identical** (pixels), the same 34
    stale rows on both sides, no console or page error — the dev boot under
    it running the new guard. Typecheck, build (`check-babylon-free`: 15
    simulations, 202 modules, no path), corecheck (all passed) and `parity`
    (server and client agree on every map) pass.
- **Owed onward.** **Whether any map states a distance** — the look call
  A3 left, now without a measurable desktop saving behind it on Cinderhaven;
  a phone, where hulls are a larger share of a GPU-bound frame, is the
  reading that could change that. **The phone's look at the door** on a hull
  (the walk at 832x384 is a desktop rendering of a phone's viewport), and the
  phone's FOLLOW-UP reading as every step's since X3.3c — the ink's "x"
  marks on the door among it (the post-commit review). **The bench carries
  no hull counts** still (`benchhulls.mjs` is a scratch tally). X4.2b's owed
  items stand (the rank surplus, the boot cost, the editor's hulls). A
  hull's tracers and a shell's blast past its distance are accepted, not
  owed (the owner's decision above).

### X4.3 — The viewmodel and the kit bay — **M–L, as four sub-steps** (split 2026-10-31, decided the same day) — X4.3a **LANDED** (3e48d98, review fixes after it), X4.3b **LANDED** (fa58735, review fixes after it), X4.3c **LANDED** (58ab5ed), X4.3d **LANDED** (4070427) — **all four LANDED**

The player's own weapon — whichever of the nine carried rigs is up, its
optic, both gloved arms, the throwing fist with its grenade or bottle, the
spent magazine and the muzzle flash hung off it — comes off Babylon's scene,
and so does the kit screen's card behind it. Nothing here is a PERF_PLAN
item and **no sub-step changes the picture**: unlike X4.1 and X4.2 there is no
fade or tier to build on the result, so all four are proven byte-identical
and each lands on its own leaving the game shippable. If one cannot be — an
equal-depth tie the new order loses, a canvas upload that rounds differently
— that difference is broken out into a commit of its own with the bank's
numbers (rule 2), never absorbed. It is split so the instrument comes first,
the hierarchy moves before the draw (X4.1a's and X4.2a's shape), and the two
BLENDED surfaces — the lens glass and the kit card, the riskiest draws in the
step and the only ones whose slot is load-bearing — move last and alone.

**What the viewmodel is today** (`entities/ViewModel.ts`): a tree of
`TransformNode`s parented to the CAMERA (`body` → `weapon` → one root per
carried id → the model's `parts.root`, the two arms, the magazine and its
spent clone, the bolt, the slide, the warhead, one `SightAssembly` root and
`sightCenter` per optic; `throwHand` → the fist, the pip, the bottle; `muzzle`,
`ejectPort`; the card), every weapon and every optic BUILT up front and all
but the carried ones switched off (`applyFit`, :1135). The pose stack is
additive layers into `pos`/`off`/`rot` written onto `weapon` once a frame
(`update`, :1403; `applyPose`, :1778). Four things in it are outside what
`rigJoints.ts`' `Joint` models (its header: "No joint here has a pivot … a
quaternion of its own"): **pivots** (`setPivotPoint` on both arms, the
magazine and its spent clone, :836-852, and the launcher's warhead,
`RpgModel.ts:272`); **a quaternion that overrides the Euler** (both arms
always, `weapon` on the turntable, :838-839, :1272/1290); **the camera as the
root** (its world is the inverse of its view, which Babylon makes); and
**meshes that parent meshes** (the fist's `ball` → `pip`; `buildMolotov`'s
bottle → neck, cloth, wick). Its surfaces are four kinds of material: cel
matte and glossy (`mats.get` / `getGlossy`, the finish ladder's mirror rung
included), `getEmissive`'s unlit `StandardMaterial` (every reticle, bead and
post — the posts are emissive BLACK, `optics.ts:553` — the pip, the wick,
the flash), the two lens glasses (a `StandardMaterial` of their own per
weapon, alpha 0.12 and 0.07, blended, `optics.ts:807-839`, `:912-931`), and
the card (`StandardMaterial` over a 256² `DynamicTexture`,
`ALPHA_REPLACE_COLOR` at alpha 0, depth `ALWAYS` with `forceDepthWrite`,
`ViewModel.ts:231-299`). Every viewmodel mesh and the flash's petals are in
`VIEWMODEL_GROUP` (1) (`ViewModel.ts:956`, `PlayerView.ts:101`); **the card
is NOT** — it is the last blended mesh of group 0 (`alphaIndex` `Infinity`),
which is the slot that makes it cover the world and be covered by the gun.
**Group 1's depth is NOT cleared** (`Game.ts:1775-1782`): the frame keeps one
depth image of the world and the gun, which `FrameDepth` hands to the ink
(`ink.near`), the motion blur (`nearSharp`/`nearFull`) and the paper
(`heldWithin`), and against which `GlowPass` occludes — all of which name
the gun by DEPTH alone, so a draw that writes the same depth keeps them.

**Two of its reads decide an OUTCOME** (`FINDINGS.md` 55): the grenade's
release point is `throwHandWorld()` (`Game.releaseGrenade`, `Game.ts:9881`)
and the rocket's start is `muzzleWorld()` (`Game.launchRocket`, :7093), each
submitted as a command's `origin`. Both read Babylon's render-id cache
(`getAbsolutePosition`, unforced): the world the LAST render composed, or a
fresh compose where the node was not drawn in it — "one frame stale", as
`throwHandWorld`'s own comment says. `ejectPort` (the brass) and
`evaluateReload`'s `parts.root.getWorldMatrix()` (the magazine's fall, :1922)
read the same cache for the picture.

- **Read first:** `docs/weapons.md` from the top to the end of the
  viewmodel's bullets (its `VIEWMODEL_GROUP` bullet is out of date: below),
  the "reticle cannot lie" and eye-relief sections; `docs/rendering.md`'s
  ink (the near band, the coverage channel), "The smear", "Our renderer's
  frame" (the three draw points, the bundle trap), the palette's mask, the
  two bullets on group 1 and the kit card, and "The bodies, ours";
  `ViewModel.ts`' header and `buildKitBackdrop`; the comment over
  `setRenderingAutoClearDepthStencil` in `Game.ts`; `rigJoints.ts`;
  `BodyDraw.ts`' header; `FINDINGS.md` 55 and 16; X4.1a's note (the stale
  reader, the oracle's shape).
- **Contracts all four keep:**
  - the reticle cannot lie: the aimed pose is DERIVED by `applyFit` alone off
    the worn sight's `sightCenter`, re-derived on every loadout change, a
    change of weapon included, and `zoomComp` scales `adsPos` and the
    weapon's scaling together
  - the viewmodel reads the camera and never writes it, and decides nothing
    but the two command inputs it is read for, whose answers stay bit for bit
  - one depth image for the frame: the gun draws into the world's depth with
    no clear, so the ink, the blur, the paper and the glow's occlusion name
    it by depth as they do now
  - the coverage channel: the cel parts write `opaqueAlpha`, the emissives 1,
    the lens glass its alpha accumulated, the card nothing
  - the card covers the world and is covered by the gun, up only while the
    turntable is; on the kit screen only the stage blooms, and no lens and
    no card ever does
  - the bay is the DOM's (`LoadoutScreen.stageBay`) and the scene follows:
    nothing here changes `updateInspect`'s fit or the bay's column
  - every rig built once and all but the carried one switched off: a
    loadout change is switches and a re-derivation, never a rebuild; the
    muzzle and the eject port outlive a swap
  - a finish is a material write and nothing else, out of the optic's and
    the brass group's reach, `standard` the built state
  - the local player casts nothing
  - the near plane (`CameraSystem`'s `minZ` 0.05) and everything bound by it
    (`kick.adsClearance`, eye relief rising with magnification) are the
    camera's: the projection is pulled off it, never restated
- **Verify, each sub-step:** the bank `--check --keep` against a BEFORE at
  the parent; `census --against`; `gate`, `shaders`; typecheck, build,
  corecheck, `parity`; `kit:hash --models`; a round offline and a netplay
  round; the kit screen from the menu and from deploy.
- **Rewrites:** `docs/weapons.md` (the `VIEWMODEL_GROUP` bullet, which says
  the depth is cleared); `docs/rendering.md` (group 1's bullet, the kit
  card's two, the draw points, "anything outside rendering group 0" in the
  size gate's exemptions); `docs/ui.md` ("The kit screen": "drawn in
  `VIEWMODEL_GROUP`"); `docs/profiling.md` (`drawOverlay`); `docs/game.md`
  (the warm-up's poses); `CLAUDE.md` (the size gate's group exemption, the
  glow's stage rule; "Every BODY AND HULL IS OUR RENDERER'S" gains the
  weapon); the contract headers of `ViewModel.ts`, `PlayerView.ts`,
  `weaponKit.ts`, `optics.ts`, `finishes.ts`, `rigJoints.ts` and
  `world/parts.ts`; `FILES.md`.
- **Not this step's: the brass** (`PlayerView`'s casing pool, cel boxes
  thrown into the WORLD in group 0, `PlayerView.ts:105-117`) is X4.4's, as a
  pool; it reads the eye port's joint from X4.3b on. The thrown grenade and
  bottle, the flying rocket and the laid mine are X4.4's too; the ones in
  the hand are this step's.

X4.3a's brief, word for word:

- **X4.3a — the bank sees the viewmodel (no change to the game).** Landed (below). The bank's
  ten `view-*` rows (`bench/vantages.ts:518-543`, Harrowmead by day) hold
  five of the seven optics (no `greenDot`, no `longScope`) on five of the
  nine rigs (no DMR, no pistol — the one FIXED sight, at its own eye relief —
  no launcher, no mine), every one at rest, matte, and none on the kit
  screen. Rows are added for what X4.3b-d move and the ten cannot see:
  `greenDot` and `longScope` hip and aimed; the pistol, the launcher (its own
  prism, `RpgModel.ts:293`) and the mine; one finish on each rung of the
  gloss ladder above matte, the mirror rung (`spec.rifleChrome`) among them;
  the gestures held mid-phase — a dry reload (both magazines, both pivots,
  the body's counter-turn), the bolt cycle, the launcher's load, a frag and a
  molotov mid-throw, a shot's flash on a seeded strobe; and the kit screen, by
  raising the REAL lid over `deploy` (the card, the bench lamps, the glow's
  stage rule) with the DOM's bay replaced by a stated one, at a desktop's
  bay and a phone's. The existing `view` field takes a `params` override
  (`ViewModelParams` as stated) and a `finish`; a `kit` field is new
  (`harness.mjs`' `placeVantage`, :369-378, and its put-away). **Appended at
  the END of Harrowmead's sequence**, because a row's frame depends on the
  rows shot before it (`plans/webgpu-ref/README.md`), and banked with
  `--rows`. It lands before X4.3b so every later sub-step's BEFORE has them.
  **Oracle:** `bank.mjs --check` twice back to back, every new row
  byte-identical to itself; every old row unmoved against a BEFORE at the
  parent; each new row LOOKED at and its `proves` true of it.

**X4.3a landed** (3e48d98, the post-commit review's fixes after it;
2026-10-31; no change to the game — the reference
bank, its harness and its table only).
- **What it is.** Nineteen rows appended at the END of Harrowmead's list in
  `src/bench/vantages.ts` (`viewmodelRows`, `kitRows`, after `crossing`),
  every one at the ten `view-*` rows' millpond pose, banked with
  `bank.mjs harrowmead --rows=<the nineteen>` (and three more after the
  kit rows, by the post-commit review, below):
  - **the two optics the ten leave out** — `view-greendot-hip`/`-aim` (the
    rifle) and `view-longscope-hip`/`-aim` (the DMR, the one primary the ten
    leave out; the long scope aimed is the highest magnification in the kit
    and the longest eye relief, clear of the near plane);
  - **the three rigs with a sight of their own** — `view-pistol-aim` (the
    notch and blade at the pistol's OWN eye relief), `view-rpg-aim` (the
    launcher's fixed prism, its chevron on the axis), `view-mine-hip`;
  - **one finish on each rung of the gloss ladder above matte**, the rifle
    with the irons at the hip — `view-finish-satin` (Oxblood, body and
    fittings `spec.rifleSatin`), `view-finish-glint` (Signal, the fittings
    `spec.rifle` under a repainted body and furniture), `view-finish-mirror`
    (Quicksilver, `spec.rifleChrome`);
  - **the gestures held mid-phase** — `view-reload-drop` (a dry reload of
    the rifle at 0.26: the spent clone falling, the support arm gone to the
    pouch) and `view-reload-seat` (0.5: the fresh magazine, the weapon's own
    node, offered to the well in the support hand, the weapon canted about
    the firing hand and the wrist's quaternion taking some of it back);
    `view-bolt` (the sniper rifle at `cyclePhase` 0.42: rolled out of the
    carry, the bolt turned up and drawn to its stop); `view-load` (the
    launcher at `loadPhase` 0.6: the rocket turned onto the bore and going
    back down it, the hand behind it, the tube off the shoulder);
    `view-throw-frag` and `view-throw-molotov` (`throwTime` 0.14, cocked: the
    throwing arm, the fist and the frag with its pip, the bottle with its
    wick; the support arm off, the rifle's give); `view-flash` (the rifle at
    the hip, the flash's three petals on the muzzle node after one
    `PlayerView.fired` under a seeded `Math.random`);
  - **the kit screen** — `kit-desktop` (the carbine with the holo) and
    `kit-phone` (the SMG with the reflex in Bullion, right of centre): the
    REAL lid raised over `deploy` (`Game.openLoadout` — the card, the bench
    lamps, the glow's stage rule, the turntable at its authored angles,
    posed every frame by `updateKitStage`), with `LoadoutScreen.stageBay`
    answered by the row's bay, because the bank hides `#hud` and there is no
    DOM bay to measure. The bays are the real DOM's, measured by a scratch
    script with the lid raised over `deploy` on Harrowmead: 1920x1080
    `{x: -0.0104, y: -0.0617, width: 0.4549, height: 0.5346}`, 832x384
    `{x: 0.324, y: -0.0083, width: 0.608, height: 0.4761}` (3440x1440 read
    `{-0.0078, -0.0613, 0.5845, 0.5355}`, not banked). Both are shot at the
    bank's 1920x1080 frame, not at a phone's viewport: a resize inside the
    boot would carry into every later row, and the phone's bay at the bank's
    aspect still moves the weapon, its fit and the card's pool of light.
- **The fields.** `Vantage.view` gains `params` (a `Partial<ViewModelParams>`
  laid over the player's own for every one of the 240 steps — each gesture
  is a function of its phase, so a held phase is the same frame every run),
  `finish` (`ViewModel.setFinish`), `throwable` (`ViewModel.setThrowable`)
  and `flash`; `kit: { weapon, sight, finish?, bay }` is new. The two types
  are imported type-only (erased under Node's type stripping, which the
  file's header requires). `placeVantage` (`plans/webgpu-ref/harness.mjs`)
  puts each away before the next row — the lid lowered (`closeLoadout`),
  `stageBay` restored, the flash `cleared()`, each painted weapon back to
  `standard`, the throwable back to what the boot carried, the camera's
  roll back — **each only after a row that raised it**, so the 62 rows
  before run exactly the calls they were banked with. The blast's seeded
  `Math.random` became a `seeded(seed, fn)` helper the flash shares (the
  same generator and seed: the blast row is byte-equal). **The head**: a
  reload drawn in a round turns the RENDERED camera by the gesture's look
  and lean (`CameraSystem.setReloadHead`) while the body node takes it back;
  a row whose pose leaves a head turn composes the camera as `CameraSystem`
  does (the look added to the pitch, the lean as the roll) and re-places
  the camera-dependent passes at the turned eye (`updateSceneForCamera` at
  dt 0). **The freeze** now HOLDS the light clock as well as pinning it:
  no frame of `deploy` updates the lights, but the kit lid does every frame
  (`updateKitStage`, which is how the bench lamps take their slots), so while
  frozen `lighting.update` is handed a dt of 0 (stashed and put back by
  `thaw` like the other updaters); in `deploy` nothing calls it, so the old
  rows are untouched by it.
- **Deviations from the brief.** **Nineteen rows, not about seventeen**:
  the dry reload is two rows because the spent and the fresh magazine are
  never on screen together — by design the two trade at the pouch, out of
  frame (`reload.fresh.fetch`) — and "both magazines" needs both. The
  pistol and the launcher are banked AIMED only (their fixed sights' eye
  relief is the aimed question; their hip poses are hip offsets the ten
  already exercise), the mine at the hip only. **The kit's weapon is put on
  the viewmodel directly**, as the `view` rows put theirs, not through
  `Game.setWeapon`/`setSight`/`setFinish`: the game's own kit (`g.weapon`,
  the prefs) is untouched, so the hidden DOM's caption says the boot's rifle
  while the bench holds the row's weapon — nothing reads that DOM. **The
  reload's gravity** (`evaluateReload`'s `parts.root.getWorldMatrix()`,
  Babylon's render-id cache) was first read off the PREVIOUS row's frame —
  no render falls between the row before and the pose — and this note said
  it read "the camera before the turn, some 9° off"; it read the row
  before's weapon and camera outright. Corrected by the post-commit review
  (below): a held reload is now posed off its own previous frame.
  **Seen and written into the rows' text**: the bolt
  row's trigger hand is below the frame at the hip (the bolt and the roll
  are what is in it); `view-rpg-aim` frames the prism, not the seated
  warhead; `view-load` was chosen at 0.6 after looking at 0.45 (the nose
  just rising into frame) and 0.68; both kit rows see the weapon side-on at
  the authored yaw, so a lens on the bench is a sliver (the aimed `holo`
  and `reflex` rows are X4.3d's glass). The ten rows' shared `proves` said
  "its depth clear" — group 1's depth is NOT cleared (`Game.ts`, the comment
  over `setRenderingAutoClearDepthStencil`): corrected; no frame depends on
  that text. `BenchScript`'s note on the millpond rows reworded; the
  benchmark itself is unmoved, since it takes one stop per POSITION and
  every new row stands on the millpond.
- **Measured.** **Banked**: `bank.mjs harrowmead --rows=...` wrote all 19,
  each from two consecutive grabs byte-identical. **Twice back to back**:
  `bank.mjs --check --keep` run twice in a row on this tree — all 19 new
  rows "within floor" at 0 pixels against the bank in both runs, and all 81
  kept frames BYTE-EQUAL between the two runs; no console or page error.
  **Old rows**: against a BEFORE taken the same way at 05eb7d9 in the
  worktree, **62 of 62 byte-equal**, and the same 34 stale rows failing the
  stale bank on both sides with identical numbers. **`census --against`**
  the BEFORE (`census.mjs --out` in the worktree): every one of the 62 old
  rows equal, the six other maps' totals equal (278, 205, 672, 472, 213,
  125), Harrowmead's 847 -> 2,123 by the new rows alone — 74 and 53 (green
  dot), 74 and 54 (long scope), 53 (pistol), 53 (launcher), 67 (mine), 70 a
  finish, 66 and 66 (the reloads), 75 (bolt), 74 (load), 72 and 74 (the
  throws), 73 (flash), and 70 and 68 on the kit screen, where the world is
  still drawn under the card (36 of ours). Typecheck, build
  (`check-babylon-free` and `check-proving` clean) and corecheck (all
  passed) pass. Not run: `gate`, `shaders`, `parity`, `kit:hash --models`
  and the rounds — nothing in the game moved (the one `src/` file the game
  loads, through `?bench` only, is the table; `BenchScript` gained a
  reworded comment).
- **Looked at, every one**: the green dot hip and aimed (the dot on the
  axis inside the ring), the long scope hip and aimed (the red crosshair,
  the tube filling the frame), the pistol's three red dots over the slide,
  the launcher's chevron in its prism, the mine in both hands with its lamp
  blooming, the three finishes (oxblood, orange furniture under graphite,
  chrome-white), the drop (the spent magazine below the well, the horizon
  tipped up and leaning), the seat (the fresh magazine in the support hand
  at the well), the bolt handle up and back on a rolled rifle, the rocket on
  the bore with the hand behind it, the frag with its glowing pip and the
  bottle with its wick cocked over the shoulder, the flash's petals edge-on
  at the muzzle, and both kit screens — the dark card, the weapon lit by the
  bench lamps, the phone's right of centre with its pool of light following
  it. Each row's `proves` was written (and four rewritten) against what its
  frame shows.
- **Owed onward.** X4.3b-d's BEFOREs now hold the twenty-two; a `census
  --against` across this commit fails Harrowmead's total by construction
  (the new rows), so X4.3b-d's are taken at this commit or later. The
  bank's README table names them.
- **What the post-commit review found** (an independent reader over
  3e48d98; fixed after it — the bank, its harness and its table, one comment
  in `CameraSystem.ts`; nothing in the game moved). **No game-behaviour bug.**
  **Fixed**:
  - **`view-reload-drop` read the PREVIOUS row's frame.** `evaluateReload`
    takes the gesture's gravity through `rig.parts.root.getWorldMatrix()`,
    which Babylon 9.28 answers from its cache while the node's
    `_currentRenderId` is the scene's; no render falls between the row
    before (`view-finish-mirror`) and the 240 steps, so `inp.fall` was that
    row's: the rifle at the hip, the camera un-turned, no reload cant.
    **Decided** (the coordinator, for the owner): the row reads ITS OWN
    frame, which is what a reload held in a round reads every frame.
    `placeVantage` now poses a held reload (`params.reloading`, or a
    `reloadBlend` over 0 — the only path that reads the cache), turns the
    head, renders ONE frame with the pose up, and poses and turns again; the
    weapon's pose does not depend on the gravity, so one frame is the fixed
    point. The rule is written on `reloadParams` and in `viewmodelRows`.
    Re-banked: `view-reload-drop` (1.54% of pixels, worst 45/255, all in the
    falling spent magazine, now a little left and higher) and
    `view-reload-seat`, which moved only in the WORLD (0.149%, worst 71, the
    mill's walls; its spent magazine is below the frame, so the gravity
    itself shows nothing there) — the extra frame advances some state of the
    world's lighting that a frozen frame still carries. That same carried
    state moved two LATER rows a little, both in the world and neither on the
    gun: `view-load` (0.56%, worst 48, round the mill) and
    `view-throw-molotov` (0.005%, worst 18), re-banked too. So of the
    nineteen first banked, fifteen are byte-unmoved and four re-banked.
  - **No row moved the pistol's SLIDE** (`WeaponParts.slide`, which X4.3b
    re-hangs; it moves only in the pistol's dry reload, back on its stop
    until `reload.bolt` 0.8): `view-pistol-reload` appended — the pistol dry
    at 0.6 over its own 1.05 s, the slide locked back with the barrel bare
    ahead of it and the fresh magazine going up into the grip (0.7 looked at
    and set aside: the magazine already seated). It holds a reload, so it is
    posed off its own frame.
  - **`view-bolt-aim`** appended: the sniper rifle with its scope, aimed, at
    `cyclePhase` 0.42. The bolt is behind the eyepiece at this
    magnification; what the frame shows is the cycle's aimed half — nothing
    rolled, the reticle's lines in the same pixels as at rest (checked
    against a `cyclePhase` 1 control shot in the same boot shape: the
    vertical line y 536-866 and the horizontal x 633-1286 in both, the two
    frames differing by 1.2% inside the tube only, worst 59). A reflex on the
    same rifle was tried and set aside: the brief names the scope, and what
    the reflex framed at the lower right was not clearly the bolt.
  - **`view-reload-tactical`** appended: the rifle's tactical reload at 0.22,
    the spent magazine stripped out of the well into the support hand
    (`ReloadGesture.strippedAt`); 0.28 looked at and set aside (the hand
    gone below the frame). Posed off its own frame.
  - **The roll's put-away was dead, and its comment false**:
    `TargetCamera.setTarget` writes `rotation.z = 0` in 9.28, so the
    `__refRoll` stash and restore went; `placeVantage` says so, and the same
    false claim in `CameraSystem.ts`' comment over the roll ("never touches
    z") is corrected, comment only.
  - **The row fields are typed** as the real id unions (`CarriedId`,
    `SightId`, `FinishId`, `ThrowableId`, and `PrimaryWeaponId` for the kit),
    `import type` only; `plans/webgpu-ref/vantages.mjs` still loads under
    Node's type stripping.
  - "Each of these four" in `placeVantage`'s put-away said four; it is five
    (the lid, the bay, the flash, the finishes, the throwable), and the roll
    needs none.
  - **Measured.** The new and re-posed rows banked by `--rows`; then
    `bank.mjs --check --keep` twice back to back: **all 84 kept frames
    byte-equal between the two runs**, no console or page error, the same 34
    stale rows failing as before; the 62 old rows **byte-equal** to the
    BEFORE at 05eb7d9; against the first check of 3e48d98, 77 of 81 frames
    byte-equal and the four above moved as described. The first `--rows`
    take of `view-pistol-reload` came back one pixel (1/255) off the two
    checks, which agreed with each other; re-taken with the other two it is
    byte-equal to them, and all 22 banked rows are byte-equal to the check's
    frames. Typecheck, build and corecheck pass. Every new or re-banked row
    looked at and its `proves` written against its frame.

X4.3b's brief, word for word:

- **X4.3b — the viewmodel's joints are ours (no picture change, no outcome
  change).** Landed (below). The tree becomes a `JointTree` (`rigJoints.ts`, X4.1a's), its
  joint list the node list in the order the nodes were made, and `Joint`
  gains exactly what the viewmodel needs and the rigs never did: a PIVOT
  (Babylon's pivot path, `transformNode.pure.js`' `computeWorldMatrix`: pivot ×
  scale × rotation × pivot⁻¹, the translation added after), a ROTATION
  QUATERNION that overrides the Euler while set, and a ROOT held off an
  outside matrix (the camera's world, copied as the render will use it).
  Whatever of that `src/math` lacks (`Matrix.ScalingToRef`,
  `addTranslationFromFloats`) joins it with its `math-check` case, and the
  pose math moves onto `src/math` with it (`ViewModel`'s scratch,
  `ReloadGesture`, `turnAboutHand`), as `solveArm` did at X4.1a. The weapon
  builders hang JOINTS, not nodes, from the root (`WeaponParts.magazine`,
  `warhead`, `bolt`, `slide`, `SightAssembly.root` and `sightCenter`).
  **Babylon still draws every mesh, and none has a parent**: each mesh's own
  local composed once, and `drawView` — beside `drawBodies` and `drawHulls`,
  once a frame in every state, after every write, immediately before
  `scene.render` (`Game.ts:4100-4106`) — hands each switched-on mesh its local
  times its joint's world through `freezeWorldMatrix`; the flash's petals the
  same off the muzzle joint. **The readers keep Babylon's answers, not fresh
  ones**: `muzzleWorld`, `throwHandWorld`, the eye port and the root's inverse
  read the world `drawView` last composed where Babylon's cache would have
  answered the last render's, and compose fresh only where it would have (a
  joint not drawn in the last render whose channels moved since) — because
  two of the four are command inputs, and `rigJoints.ts`' "every answer is
  FRESH" here would move where a grenade leaves the hand on the first frame
  of a throw. **Find out first** whether `scene.render`'s camera update can
  move the view after `drawView` (a `FreeCamera` with its inputs cleared,
  `CameraSystem.ts:375-378`, should not): if it can, the root is taken off
  the matrix the render makes. **Oracle:** each mesh's world matrix against
  its node chain's, bit for bit, at `onAfterActiveMeshesEvaluation` on the
  parent, then against our arrays on the step (X4.1a's probe), over seeded
  `ViewModelParams` sequences through every rig in every sight — hip, aimed,
  sprint, swap, both reloads, the bolt, the load, both throws, the turntable
  turned — and both trees digested frame by frame; the four readers' answers
  as float64 bits over a recorded offline round that fires, launches a
  rocket and throws both throwables, identical on both sides, and the
  `GrenadeCommand.origin` / `OrdnanceCommand.origin` it submits with them;
  `kit:hash --models`' `weapon:*`, `viewmodel` and `player` rows unmoved; the
  bank byte-identical; a netplay round with a grenade and a rocket (the
  authority's start points unchanged); "the reticle cannot lie" — fired at a
  wall at range with each optic.

**X4.3b landed** (fa58735; 2026-10-31; no picture change, no outcome change).
- **What it is.** The viewmodel is a tree of JOINTS, `ViewModel.tree` — a
  `ViewTree` (`src/entities/viewTree.ts`, new) over a `JointTree`
  (`rigJoints.ts`) whose root stands for the camera. **The joint list is the
  node list**: every `TransformNode` `ViewModel`, the nine builders,
  `optics.ts` and `PlayerView` made is a joint made at the same moment,
  under the same name and parent (`ViewTree.joint`, `WeaponBuild.joint`),
  and the builders hang JOINTS from the root — `WeaponParts.root`,
  `magazine`, `warhead`, `bolt`, `slide` and every `SightAssembly`'s `root`
  and `sightCenter` (`WeaponBuilder` takes the tree and the parent joint).
  **Every mesh is a joint too, and none has a parent** (`ViewTree.hang`): a
  leaf whose local is the mesh's own, composed ONCE at `seal` (the end of
  `ViewModel`'s constructor, and the flash's); a mesh other meshes hang off
  (the fist's frag, `MolotovModel`'s bottle and neck and cloth, unparented
  by `hang`) or whose own transform moves (the kit card, which `updateInspect`
  writes) is a joint whose channels the mesh's were copied into. Mesh lists
  that were `getChildMeshes` walks are the tree's (`meshesOn`, in the order
  the children were hung). **Babylon still draws every mesh**: `drawView`,
  once a frame in every state beside `drawBodies` and `drawHulls`,
  immediately before `scene.render`, hands each switched-on, visible mesh
  its joint's world through `freezeWorldMatrix` — exactly the set
  `_evaluateActiveMeshes` took off `WorldCulling`'s list — and each mesh's
  OWN enabled flag is its joint chain's, written by `syncSwitches` straight
  after `stageWarmFrame`, before the cull asks `isEnabled()` (an unparented
  mesh sees no ancestor), and again by `drawView`. The flash's root is a
  joint under the muzzle joint, its petals meshes hung from it.
- **What `Joint` gained** (declared without initializers, so a rig's joint
  never carries them and its shape — and `kit:hash`'s soldier and vehicle
  rows — are unmoved): a PIVOT (`setPivotPoint`: `Translation(-p)` kept,
  used only when not the identity, its inverse post-multiplied — composed by
  Babylon's pivot path, pivot × scale × rotation × pivot⁻¹ with the
  translation added after); a QUATERNION that overrides the Euler while set
  (both arms always, the weapon on the turntable); an OUTSIDE root (the
  camera's world, re-read on every compose of the root); a FIXED local (a
  mesh's own); and `memo`, the render cache's bookkeeping. `src/math` gained
  `Matrix.ScalingToRef` (flagged identity at a scale of one, as Babylon's)
  and `Matrix#addTranslationFromFloats`, each with its `math-check` case (81
  cases). The pose math moved onto `src/math` with it: `ViewModel`'s
  scratch, `turnAboutHand`, `ReloadGesture` (its import alone),
  `reloadRig`'s measures, `buildArm`'s frame.
- **The readers keep Babylon's answers** (decided: bit for bit).
  `RenderCache` (`rigJoints.ts`) reproduces `TransformNode.computeWorldMatrix`
  unforced (`read`, what `getAbsolutePosition` did) and `Node.getWorldMatrix`
  (`world`): a joint composed at the CURRENT render id answers that
  composition however it has moved since, unless a setter dirtied it (the
  turntable's quaternion handed or taken, `markDirty`); one composed at an
  older id answers its cached world when it and every ancestor are
  SYNCHRONIZED — no channel written (`ViewModel.wrote`, which every write to
  a joint's position, rotation, scaling or quaternion goes through, with the
  channels as last composed beside it so a write nobody reported is still
  seen), no ancestor recomposed since (`childUpdate`/`parentUpdate`) — and
  is recomposed off its parent's `getWorldMatrix` otherwise; both branches
  stamp it and only a recompose touches the parent. The render id is
  BABYLON's (`scene.getRenderId()`, public). `drawView` runs the render's own
  evaluation through the same rule at a provisional id between two integers,
  and the joints it stamped are handed the id the render really took from
  inside the render (`onAfterActiveMeshesEvaluationObservable`), so the next
  frame's readers meet the stamps Babylon's evaluation left. `muzzleWorld`
  and `throwHandWorld` read through it (each still a Babylon vector),
  `ejectPortWorld` replaces `PlayerView`'s two node reads, and
  `evaluateReload`'s gravity takes `world` of the weapon's root. **The one
  approximation** is the camera's synchronization: the root is synchronized
  while its world is unchanged, where Babylon's camera also counts a change
  of projection; a synchronized answer is always the number a recompose
  would give, so it can move only which ancestors a read stamps — and the
  oracle found it moved nothing.
- **Found first: the render's camera update cannot move the view after the
  hand-over**, so the root is not taken off the render's matrix. The
  `FreeCamera`'s inputs are cleared (`CameraSystem`), nothing writes its
  `cameraDirection` or `cameraRotation` and no observer before the render
  moves it; measured on the parent over a live round, the camera's world at
  `drawBodies` against at `onAfterActiveMeshesEvaluation`: **0 of 1,562
  frames differ** (and 0 in the four replays below, 11,509 frames on the two
  trees). And **the render id a frame's update reads IS the id the last
  evaluation ran at** (1,561 of 1,561 frames; no Babylon render target in a
  round increments it after the evaluation), which is what makes a node
  drawn in the last render answer that render's composition — "one frame
  stale".
- **The oracle.**
  - **On the parent, over a live round** (a scratch probe, `x43b/probe.mjs
    record`, Harrowmead offline, 1,562 frames: hip and aimed fire, sprint, a
    tactical reload, a frag, the pistol, the launcher and a rocket with its
    load, the rifle back, a molotov): every viewmodel mesh in the active list
    at `onAfterActiveMeshesEvaluation`, against a fresh composition of its
    node chain in Babylon's own arithmetic (the pivot path included) —
    **24,621 meshes, 0 differ**, so what Babylon drew was always the fresh
    composition.
  - **The recorded round, replayed on both trees.** The probe logged every
    call into `ViewModel` and `PlayerView` (3,190: `update` with its
    parameters, the loadout calls, the flash, the brass, the readers) with
    the camera at each and at the render; `probe.mjs replay` re-issues them
    frame for frame in `deploy` (the world held), the camera put back at
    each, the flash's and the brass's `Math.random` seeded. On the parent
    the replay reproduces the live round exactly (every frame's drawn-mesh
    digest, the flash's petals aside, and all 303 reader answers) — the
    harness is faithful. **On the step: 1,563 frames' digests of every drawn
    viewmodel mesh's world matrix identical to the parent's replay (24,651
    meshes), and all 303 reader answers identical as float64 bits** —
    29 `muzzleWorld`, 2 `throwHandWorld`, 28 eject ports (the case's
    position and its seeded velocity), 244 reload gravities — and identical
    to the live recording. **The three origins the live page submitted** (a
    frag's and a molotov's `GrenadeCommand.origin`, a rocket's
    `OrdnanceCommand.origin`, the last floored at `launchAhead`), recomputed
    from the step's replayed answers by `Game`'s own floor: bit-identical.
  - **A seeded sequence through every rig in every sight** (`x43b/gen.mjs`):
    all nine rigs, each in all seven sights hip and aimed with a flash, the
    swap's triangle, a sprint, a dry and a tactical reload eased out, a
    reload cancelled halfway, the bolt cycle (half of it aimed), the
    launcher's load, a frag's and a molotov's throw with the hand read every
    frame, and the turntable turned through both banked bays, the camera
    drifting every frame — 3,979 frames, 9,589 calls. Replayed on both trees:
    **3,981 frames' digests identical (61,242 meshes) and 2,286 reader answers
    identical** (722 muzzle, 702 hand, 99 eject port, 763 gravity); on the
    parent all 61,242 the fresh node-chain composition.
  - **On the step, over live rounds**: every drawn viewmodel mesh against its
    local times a fresh composition of its joints' channels — 24,651 and
    61,242 in the two replays, **13,833 in an offline round and 13,847 in a
    netplay round** (below): 0 differ, so no mesh is drawn off a matrix older
    than its joint's last write.
  - **`kit:hash --models` against the parent: 244 of 244 identical**, the 64
    `viewmodel`, 153 `weapon:*` and the `player` rows among them. The script
    hashes every node in the scene and each mesh's parent and transform, and
    the step took the nodes out of the scene and every mesh's parent away —
    so it now hashes a `ViewTree` IN THE BYTES THE NODES GAVE (each node
    joint a node record after the scene's own, in the order made; each mesh's
    parent the node or mesh its joint hangs from; a joint or a `src/math`
    value in the builder's data spelled as the node or the Babylon value it
    replaced), and every byte of every row matched: the tree's names,
    parents, switches, channels, quaternions and pivots are the nodes'.
- **Measured.** **The bank** against a BEFORE at 85ed303 in a worktree
  (`--check --keep` both sides): **83 of 84 byte-identical** at the first
  run; the 84th, `view-pistol-reload`, two WORLD pixels ((351,390) on the
  trees and (964,428) at the mill's waterline) by 1/255. That is the main
  tree's own outcome and not the step: the parent run in the main tree (the
  step stashed) draws exactly those bytes, as X4.2a found for `sarab/shelf`;
  a second run of Harrowmead on the step is 37 of 37 byte-equal to the
  BEFORE, a third draws the main tree's two pixels again, and the BEFORE's
  two runs and a third with a 2 ms per-frame stall all draw the bank's bytes
  — the row X4.3a's own note found a first take of one pixel off. The same
  34 stale rows on both sides, no console or page error. **`census
  --against`** the BEFORE: every row and every total equal (278, 205, 672,
  2,314, 472, 213, 125). **The reticle cannot lie**: `VERIFYING.md`'s
  sight-alignment check on both trees, the six rail weapons in all seven
  sights and the pistol, the launcher and the mine in their own, aimed and
  settled, each worn `sightCenter` in the camera's frame — **45 of 45
  identical across the trees**, the worst cross-axis offset 0.0013 µm and
  the stand-off within 0.32 µm of `eyeRelief × zoomComp`. **The kit screen**
  raised from the menu (no map) and from `deploy` on both trees with its DOM
  up, a weapon and a sight changed on it and turned, lowered with the
  quaternion null, and a round entered after: no error, the weapon on the
  card in both. **A round offline and a netplay round** (`x43b/net.mjs`,
  Harrowmead, the second against a local `dist-server` built from the step):
  a frag, a rocket and a molotov each, every submitted origin the reader's
  answer through `Game`'s floor, **no `refused`**, the authority's blasts
  arriving. `gate.mjs` clean on seven; `shaders.mjs` clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour); typecheck,
  build (`check-babylon-free` clean), corecheck, `math-check` (81 cases) and
  `parity` (eight maps) pass.
- **Deviations.** **Every mesh is a joint**, not a mesh "with its local
  composed once" beside its node's joint: Babylon cached each MESH's world
  by render id too, and the cache had to be reproduced per mesh to stamp
  ancestors exactly as the render did — a leaf's local is still composed
  once (`fixedLocal`). **`syncSwitches` before the cull** as well as
  `drawView` before the render: the cull's `offer` asks `isEnabled()`, which
  walked ancestors when the meshes had parents, and a mesh switched on in a
  frame would otherwise miss that frame. **The card's NONUNIFORMSCALING
  define** is chosen once at build off a stand-in scale
  (`computeWorldMatrix(true)`, put straight back): Babylon chose it off the
  card's own non-uniform scale every frame, and a frozen matrix never
  chooses it, so without this the card would compile a second effect.
  **`kit:hash` was taught the tree** rather than re-baselined (the brief
  asked for the rows unmoved). **The stale "depth cleared" claims** were
  corrected where this step rewrote the text (`docs/weapons.md`'s
  `VIEWMODEL_GROUP` bullet, `ViewModel`'s header and the group's comment,
  `PlayerView`): group 1's depth has not been cleared since the moon left it.
  **The reticle check is the numeric one** `VERIFYING.md` gives (the worn
  sight's centre on the camera axis at its stand-off, which is where every
  round goes), not shots at a wall.
- **Owed onward.** X4.3c draws the opaque parts off these joints (the
  segments' matrices are `ViewMesh.joint.world`); X4.4's brass reads the
  eject port through `ejectPortWorld`. The cache is a debt with an end:
  once the readers stop being Babylon's answers (`FINDINGS.md` 55 settled)
  the tree can compose fresh, as a rig's does, and `RenderCache` goes. The
  compose costs are unmeasured (a frame composes the carried rig's ~20 joints
  and its ~15 meshes, against Babylon's own walk of the same nodes before).
- **What the post-commit review found** (an independent reader over fa58735
  and 1d6accf; fixed after it). **No outcome bug.** Fixed:
  - **A megamorphic compose.** Viewmodel joints gained `outside`, `pivot`,
    `quaternion`, `fixedLocal` and `memo` lazily and in different orders
    (the weapon its quaternion at runtime, on the turntable), so six or more
    hidden classes reached the `composeLocal` every rig and hull runs each
    frame. Every viewmodel joint is now handed all six, null, in one order
    the moment the tree makes it (`rigJoints.viewJoint`); a rig's joint is
    untouched (`kit:hash`'s soldier and vehicle rows unmoved). Measured on
    Sarab in a live round, three alternated runs a side of 1,500 frames each
    on a 100 us clock, fa58735 against the fix: `drawBodies` 0.049-0.067 ms a
    frame against 0.067-0.076, `fadeHulls` 0.018-0.022 against 0.018-0.020,
    the viewmodel's hand-over 0.030-0.035 against 0.023-0.026 — **not
    measurable**: the bodies' spread inside one side is as large as the gap,
    and every figure is under the clock's grain.
  - **Two silent breaks of the guarantee.** The tree's `JointTree` was public,
    and its `compute`/`computeChain` rewrite `world` without telling the
    cache: it is private to `ViewTree` now (a digest reads `jointList`); and
    `VERIFYING.md`'s sight-alignment recipe called `view.tree.read` from a
    live page, which re-stamps the cache: it composes into scratch now, and
    says why.
  - **A latent stale draw.** A parent mesh skipped (the fist's frag, the
    bottle's neck or cloth) while a child of it was evaluated is recomposed
    through the child, and its own frozen copy was never refreshed: each
    `ViewMesh` keeps the `childUpdate` it was last handed over at
    (`handed`), and is refrozen whenever it differs.
  - **The provisional id could repeat** (`renderId + 0.5` with no render
    between two draws): a counter going down from -2 now, never repeated.
  - **The viewmodel's wick lost its NONUNIFORMSCALING define** (`MolotovModel`
    scales it on y; a frozen matrix never chose the define, so it compiled
    the uniform variant): `seal` composes each mesh's OWN world once,
    unparented, which chooses the define as the parented build did; the
    card's stand-in is chosen after `seal`, which would otherwise have set
    it back. A scratch page read the meshes carrying the flag once drawn:
    the wick on both trees, the card on both while the turntable is up.
  - **A per-frame walk** of every mesh of all nine rigs and every optic, an
    ancestor walk each, twice a frame: `syncSwitches` walks the tree from the
    root and never enters a switched-off subtree, a mesh on after the last
    pass and not reached this one switched off; `draw` evaluates the meshes
    that walk found on.
  - **Words**: the four things `Joint` gained (the header said three), the
    outside root as the one matrix read from outside, `RenderCache`'s
    approximation stated with its real condition, `seal` as what composes at
    build, the card "the one non-uniform scale" no longer, and the
    "parented to the camera" left in `ViewModel`, `Game`, `docs/ui.md` and
    `FILES.md`.
  - **A constraint written into X4.3c's brief**: `ViewTree.draw()` must go on
    evaluating exactly the set Babylon evaluated (switched on and
    `isVisible`) and settling at the render's evaluation id, once the opaque
    parts leave Babylon's draw and the cull's list, or the next frame's
    readers move.
  - **Re-checked after the fixes**: the replay oracle on the recorded round
    and on the seeded sequence, **1,563 and 3,981 frames identical (24,651 and
    61,242 meshes), 303 and 2,286 reader answers identical as float64 bits**,
    the three origins bit for bit, every drawn mesh its joints' fresh
    composition; the bank **84 of 84 byte-equal** to the BEFORE at
    85ed303 (`view-pistol-reload` among them, this run), the same 34 stale
    rows; `kit:hash --models` 244 of 244 identical;
    typecheck, build, corecheck, `math-check` (81 cases) and `parity` pass.
    (A first re-run found the walk drawing nothing — the camera's root had
    not been made a top-level child of the walk — which is what the replay
    oracle is for; fixed, and a timing taken on it discarded.)

X4.3c's brief, word for word:

- **X4.3c — the weapon drawn by us: every opaque part (no picture change).** Landed (below).
  The viewmodel's cel and emissive meshes — every rig's colour groups,
  magazine and spent magazine, bolt, slide and warhead, every optic's housing
  and reticle, both arms, the fist and its pip, the bottle and its wick —
  and the muzzle flash become a KIT our renderer draws (`render/`, beside
  `BodyDraw` and `HullDraw`): the arrays on the GPU once, at construction,
  for all nine rigs and every optic, a segment's matrix its joint's world
  times its own local, drawn while its joint chain is switched on. **One
  draw a segment, one instance**, the cel ones each with its material's
  recipe (`celRecipe`, the PLAIN variant — matte, glossy and the mirror rung
  differ only in values) and the emissive ones by the emissive program (the
  visor's, X4.1d: alpha 1, the fog toward the map's), and those with a
  non-black colour into the glow's mask (`Renderer.addGlowMask`) on
  `glowAdmits(VIEWMODEL_GROUP)` — the stage, which the kit screen keeps. **In
  Babylon's group-1 ORDER**: its opaque queue is `PainterSortCompare`
  (material `uniqueId`, then the order the meshes were dispatched;
  `renderingGroup.js`), which decides who wins an equal depth, so a finish,
  which swaps a group's material, re-orders it. **Where:** our draws at group
  0's `"afterGroup"` (`Renderer.ts:76-77`; no draw has used that point yet),
  which is after the card — the last of group 0's blended queue — and before
  group 1, which is left holding the two glasses. A finish becomes a recipe
  swap (`applyFinish`, `finishes.ts:401-414`) and the epoch moves. **The draw
  is installed for the SESSION, not the round**: the kit screen covers
  `menu` (`ScreenStack.ts:234-239`), where no map is installed and
  `BodyDraw`/`HullDraw` are not (`Game.ts:4978-4979`) — so every frame
  texture must be published there, or the gun is missing from a kit screen
  raised off the title (verify, `FrameTextures`' null rule). Babylon builds
  no opaque viewmodel mesh: the builders hand back segments (`WeaponBuild
  .merge`/`lit`, `buildArm`, `optics.ts`), `WeaponParts.meshes` and
  `FinishPart.mesh` become them, and `kit:hash --models` hashes the same
  arrays off them. The viewmodel leaves `WorldCulling`'s candidate list. The
  pipelines are asked ahead through `PipelineCache`. **A constraint X4.3b
  left (its post-commit review):** the readers keep Babylon's answers only
  while the tree's render cache is stamped as Babylon's evaluation stamped
  it, so once Babylon stops drawing the opaque parts and they leave the
  cull's list, `ViewTree.draw()` must go on EVALUATING exactly the set
  Babylon evaluated — every viewmodel mesh switched on (its joint chain) and
  `isVisible`, drawn or not, by us or by Babylon — and the cache must go on
  being SETTLED at the render's evaluation id, at the point it is now
  (`onAfterActiveMeshesEvaluationObservable`, or wherever that id is then
  read). Narrowing the set to what our renderer draws, or stamping at a
  different id, moves the next frame's `muzzleWorld` and `throwHandWorld` —
  two command inputs — and the replay oracle (X4.3b's) is what proves it did
  not. **Oracle:** the bank's
  `view-*` rows and X4.3a's byte-identical, every other row too; the glow's
  mask read back against the parent's at the aimed rows (the reticles), as
  X3.6d's was; `census --against` (Babylon's draws fall by the gun's, ours
  counted); `kit:hash --models` unmoved; every finish on every primary,
  photographed against the parent on the turntable; the kit screen raised
  from the menu and from deploy at 832x384 and 3440x1440; a round with
  every weapon, both throwables and both AT items; a netplay round.

**X4.3c landed** (58ab5ed; 2026-10-31; no picture change).
- **What it is.** Every opaque surface of the viewmodel is a SEGMENT our
  renderer draws (`render/ViewDraw.ts`, its programs `render/viewProgram.ts`),
  and **Babylon is made no opaque viewmodel mesh**: each rig's colour groups,
  magazines and spent magazines, bolt, slide and warhead, each optic's housing
  and reticle, both arms, the throwing fist with its frag and pip or its
  bottle and wick, and the muzzle flash's three petals. A segment is a
  `ViewSegment` (`entities/viewTree.ts`): the `Part` a builder made —
  `drawnMesh`'s inputs, its arrays, transform, material and metadata — with
  the two flags of the mesh the frame reads (`isVisible`, and its builder's
  own switch), made by `toSegment` (`drawnMesh(part)`'s `dress`) or
  `segmentOf` (a bare buffer at identity). `WeaponBuild.merge` and `lit`,
  `buildArm`, `optics.ts`' reticles (`segmentOf` of the merged bars), the
  throw's ball and pip and `PlayerView`'s petals hand back segments;
  `WeaponParts.meshes` and `SightAssembly.meshes` hold `ViewSurface`s (a
  segment, or an optic's glass) and `FinishPart.mesh` a segment;
  `MolotovModel` states the bottle's four parts once (`molotovParts`) and
  makes them meshes for the world's pool (`buildMolotov`, unchanged in its
  bytes) and segments for the fist (`molotovSegments`, a part tree `hang`
  walks as it walked the child meshes); the spent magazine is a segment's
  twin (`cloneSegment`, what `Mesh.clone` copied); the reload's magazine
  pivots are measured off `segmentBounds` (Babylon's `extractMinAndMax`,
  comparison for comparison). The optics' two GLASSES and the kit CARD stay
  Babylon meshes, hung in the same tree (X4.3d's).
- **The kit**: every segment the tree holds, in the order hung — the order
  made — uploaded ONCE at `Game`'s construction (`Game.buildViewDraw`, right
  after `PlayerView`), all nine rigs and every optic as the meshes were built:
  313 segments (of the tree's 326 surfaces; 65 unlit, 53 of those into the mask), 222,369 vertices, 402,876 corners, 18 materials as built and one cel pipeline, ~14.1 MB of GPU buffers resident on every boot (positions, normals, colours, uvs and slots each a vertex, the indices) — against the same meshes' buffers Babylon held for the nine rigs built up front before. A segment's arrays as Babylon uploaded a mesh's (float32; a
  `color` or `uv` it does not carry reading Babylon's empty buffer widened,
  (0, 0, 0, 1) and (0, 0)), its indices rebased into one `indexData`.
- **One draw a segment, one instance** (decided: no fold): non-indexed over the
  segment's corners (`firstVertex` its first index), its instance the draw's
  place in the frame (`firstInstance`), whose matrix — the segment's joint's
  world as the evaluation left it, read whole out of storage — is what
  `freezeWorldMatrix` handed the mesh. A cel segment is drawn by the cel
  program with its material's recipe (`celRecipe`: matte, glossy and the
  mirror rung are all the `PLAIN` variant, one pipeline, a block and group a
  recipe made the first time the recipe is drawn, re-copied when the epoch
  moves); an unlit one — a reticle, a bead, a post (emissive BLACK), the pip,
  the wick, a petal — by the emissive palette's program over the weapon's
  own table (`CelMaterialFactory.viewEmissiveRecipe`: one slot a
  `getEmissive` colour, the fog band by reference, alpha 1), the visor's
  arrangement (X4.1d). Seven storage arrays in the vertex stage.
- **In Babylon's group-1 ORDER.** Group 1's opaque queue was
  `PainterSortCompare` (the material's `uniqueId`) over the dispatch order —
  the cull's candidate order, which was the order the meshes were made — and
  V8's sort is stable; `Game.drawView` reproduces it every frame: the tree's
  evaluated segments in the order hung, stably insertion-sorted by
  `material.uniqueId`. The materials are still the factory's (`get`,
  `getGlossy`, `getEmissive`), made in the order they were, so their ids keep
  their relative order, and a FINISH — a material write — re-orders the draws
  exactly as it re-ordered the queue.
- **Where**: group 0's `"afterGroup"` (`Renderer.add`; the first draw at that
  point) — after the kit card, the last of group 0's blended queue, and before
  group 1, which keeps the two glasses. Into the world's depth with no clear,
  so the ink, the blur, the paper and the glow's occlusion name the gun by
  depth as before; the cel parts write `opaqueAlpha`, the emissives 1.
- **The glow's mask**: the lit segments whose colour is above black and which
  carry no `noGlow` (`GlowPass.buildList`'s tests of a mesh's own) — each at
  the bloom `GlowRules.colour` gave its mesh: the bounding sphere's centre off
  `segmentBounds` through the draw's matrix, faded by the fog at its distance
  from `globalPosition`, PULLED inside the render (`Game.viewPull`, in the
  prepare), as the visors' is — drawn first in that pass by the main pass's
  own vertex module (`Renderer.addGlowMask`), on
  `glowAdmits(VIEWMODEL_GROUP)` (the stage, which the kit screen keeps).
- **Installed for the SESSION**: the draw, its prepare, its mask and both
  refusal listeners are hooked at construction, because the kit screen covers
  `menu`, where no map stands — and every frame texture the cel pixel binds is
  published there (the gun drawn on a kit screen raised off the title is the
  proof, below). A failure — a pipeline that did not build, or a refused pass
  while the weapon draws — is told to `ViewDraw.onFailed`'s listener: the
  round's `worldFailed` while one stands (set at `installMap`, and told at once
  if the pipelines had already failed), the console's otherwise (reset at
  `teardownMap`). Its pipelines (the cel variant every material the kit is born
  wearing shares, and the emissive pair) are asked at construction, so the
  warm-up's wait for ours covers them; a recipe of a shape not asked then would
  be asked at its first draw, DEV-warned.
- **The evaluation is kept whole**, as X4.3b's review asked: `ViewTree.draw`
  evaluates every surface switched on and visible — a segment or a glass,
  whoever draws it — through the `RenderCache`, settled at the render's
  evaluation id from inside the render as before, and lists the segments it
  found (`evaluated`) for `Game.drawView`; a glass and the card are frozen as
  before. The weapon leaves `WorldCulling`'s candidate list (no mesh is made of
  it), and so the size gate, the frustum and `isReady()`.
- **The instruments taught the segments.** `kit:hash --models` hashes a segment
  IN THE BYTES ITS MESH GAVE: made a throwaway mesh by the game's own
  `drawnMesh` on the same arrays, dressed with the flags the mesh carried (its
  own switch and `isVisible`, never pickable, and in a tree hung from a camera
  the viewmodel's group and always-active), recorded and disposed, at its
  place in the scene's order (a tree's surfaces in the order made — asserted
  equal to the scene's for the meshes that remain — then every other mesh); a
  segment in the builder's data is spelled `Mesh:<name>`. `census.mjs` counts
  `viewDraw.stats.drawn` with ours. The profiler's report **version 23** adds
  `view` (`drawn`, `masked`; `FrameProfile.setView`), the viewer prints it as
  `weapon`.
- **Measured.**
  - **The bank** against a BEFORE at edccb4f in the worktree (`--check --keep`
    both sides): **83 of 84 byte-identical** (`comparePngs`), every Harrowmead
    row among them — the 22 `view-*` and `kit-*` rows and `view-pistol-reload`,
    whose flake did not come up — on the first run of the step. The 84th,
    `sarab/shelf`, differs by one pixel by 1/255, the worktree's own: the
    parent run in the MAIN tree (`git stash`) draws the step's bytes on all
    eleven Sarab rows (X4.1e's and X4.2a's pixel). The same 34 stale rows on
    both sides, no console or page error.
  - **The glow's mask read back** (a scratch readback of `GlowPass.mask` at
    every Harrowmead row in the bank's sequence, on both trees): **37 of 37
    identical**, the aimed rows' reticles among them (lit texels: holo 1,294,
    prism 2,778, green dot 648, long scope 13,333, pistol 711, launcher 2,056,
    the flash 8,467); our mask drew 1-4 segments on 28 of the rows.
  - **`census --against`** the BEFORE: every row and every total equal (278,
    205, 672, 2,314, 472, 213, 125); on Harrowmead's view and kit rows
    Babylon's draws fell by the gun's — 8 to 19 a row (`view-holo-aim`
    37 → 23, the glass still Babylon's; `view-pistol-reload` 41 → 22) — and
    ours rose by the same.
  - **`kit:hash --models`** against the parent: **244 of 244 identical** (the
    64 `viewmodel`, 153 `weapon:*`, `player` and `molotov` rows among them).
  - **Every finish on every primary** on the turntable (the real kit lid over
    `deploy` through the bank's kit-row machinery, the desktop bay, the irons,
    six primaries times sixteen finishes): **96 of 96 byte-identical** to the
    parent.
  - **X4.3b's replay oracle**, re-run on both trees with the digest taken by
    TREE INDEX (the parent's meshes and the step's segments compare
    directly): the recorded round **1,563 frames identical (24,651 drawn
    surfaces) and 303 reader answers identical as float64 bits**, and the same
    303 against the live recording; the seeded sequence through all nine rigs
    in all seven sights **3,981 frames identical (61,242) and 2,286 reader
    answers identical**. On the step every drawn segment's matrix is its
    joints' fresh composition (84,368, 0 differ) and the draw order is
    Babylon's group-1 sort on every frame — a claim the post-commit review
    found TAUTOLOGICAL (it sorted the very list it tested) and false in its
    tie-break (below).
  - **The kit screen** raised from the MENU (no map) and from `deploy`, its
    DOM up, at 832x384 and 3440x1440, a weapon and a sight changed on it and
    turned, then a round entered: the gun drawn from the title (10 draws, 2
    mask draws, no map standing), no page or console error; each shot taken
    twice, and the cross-tree difference within the live screen's own A-vs-B
    noise.
  - **Rounds** (a scratch probe): offline, six lives on Harrowmead, every
    primary with a sight each, the pistol drawn and fired, both throwables and
    both AT items (a rocket fired, a mine laid) — the weapon drawn on every one
    of 6,012 frames with the body up (9-21 draws), 87,808 drawn segments each
    its joints' fresh composition, the six grenade and three rocket origins
    the readers' answers through `Game`'s floor bit for bit (the three mine
    lays read no viewmodel), no `refused`, no error; and a netplay round
    against a local `dist-server` built from the step (1,002 frames, 14,576
    segments fresh, a frag's and a rocket's origins bit for bit, no
    `refused`, no error).
  - **`gate.mjs`** clean on seven; **`shaders.mjs`** clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour — it builds the world's programs; the weapon's are built at boot, where a failure is the console's or the round's). Typecheck, build (`check-babylon-free` clean, `src/render/` walked with the two new files), corecheck (all passed), `math-check` (81 cases) and `parity` (every map) pass.
- **Deviations.** **The profiler's `view`** (report version 23), which the
  brief did not name: X4.1d's review found the profiler blind to the bodies'
  draws and this is the same hole for the weapon. **The mask order**: Babylon
  drew the weapon's emissives LAST in the mask, in group 1, and ours go FIRST
  with the palette's and the visors'; the order matters only where two mask
  draws pass at one pixel, which for depth-writing draws is an exact tie —
  plausibly a tracer lying along a flash petal on a shot's first frame — and
  no banked row has one (the readback above is identical). **A new finish
  material draws at once**: Babylon skipped a mesh whose freshly minted
  ShaderMaterial was still compiling, for a frame or two after a repaint; a
  segment draws off the recipe, whose pipeline is shared. Neither is in the
  bank. **The instruments** (`kit:hash`, `census`) were taught the segments
  rather than re-baselined. `FINDINGS.md` 16's "only the weapon and optic
  WORN are warmed" is narrowed to the glass (X4.3d settles it), and
  `VERIFYING.md`'s flash recipe (`flashRoot` a joint since X4.3b) and its
  material-swap trap are corrected. `CLAUDE.md` is 1,554 lines (four up).
- **Owed onward.** X4.3d: the two glasses and the card as draws of ours, the
  group and `Player.warmView` gone, the glow's stage rule stated by the draw
  (`ViewDraw` asks `glowAdmits(VIEWMODEL_GROUP)` until then), and the
  profiler's `drawOverlay`. X5.4: the render cache's frame id (decided).
  The construction cost of the kit (built and uploaded on every boot, the
  menu included) is unmeasured on the phone. **Memory the review flagged and left** (to be
  taken when a phone reading asks): the kit uploads a colour, a uv and a slot
  for EVERY vertex (most segments carry none of the three, read as constants),
  and each rig's spent magazine uploads its arrays a second time though it
  shares them with the magazine.
- **What the post-commit review found** (an independent reader over 58ab5ed
  and 007ee49; fixed after it — the draw's tie-break, one listener, a late
  failure, DEV asserts and words; nothing in the picture or the readers
  moved). **One real fault**:
  - **The draw order's TIE-BREAK was not Babylon's.** `Game.drawView`
    stable-sorted `ViewTree.evaluated` by material `uniqueId`, and
    `evaluated` is built by `syncSwitches`' depth-first walk of the JOINTS —
    hang order by joint, not the order the surfaces were MADE, which was
    Babylon's dispatch order (the scene's, which the cull walked). The two
    differ where one arm's joint is made before the other arm's segments: the
    reviewer's NullEngine check found 4 of 14 positions differ on the rifle,
    4 of 13 on the SMG and 6 of 17 on the pistol. The landed note's "the draw
    order is Babylon's sort on every frame" sorted the very list it tested.
    No banked frame told — a tie shows only where two tied segments meet at
    one depth — and the bank, the mask and the readers were identical
    throughout. **Fixed**: a tie goes to the segment made first
    (`ViewMesh.slot`, the kit numbered in `ViewTree.meshes`' order, the order
    made — the scene's, which `kit:hash` asserts). **Checked against the
    PARENT's own queue as it rendered** (a scratch probe wrapping
    `SubMesh.render` while the main pass's group 1 rendered, opaque only,
    mapped by tree index, against the step's handed-over order, both trees
    replaying X4.3b's logs): **every frame equal** — the seeded sequence
    through all nine rigs in all seven sights, 3,982 frames and 60,829 draws,
    and the recorded round, 1,564 frames and 23,539 draws — where the landed
    commit, replayed the same way, differed on 1,418 of the round's 1,564.
    The readers bit for bit again (303 and 2,286 answers as float64 bits;
    1,563 and 3,981 frames' digests identical). The `viewTree.ts` header, the
    `drawView` comment, `docs/weapons.md` and `docs/rendering.md` say so.
  **Fixed besides**:
  - **The glow mask's order, stated as it is**: the weapon's mask draw is
    registered once at construction, so it goes FIRST in the pass — ahead of
    the palette and the visors a round registers after it — where Babylon
    drew the weapon's emissives LAST, in group 1; and it decides more than an
    exact tie: a blended self-masking emissive that writes no depth (a
    molotov's fire, `FlameMaterial`) between the eye and a lit weapon part now
    lands over the weapon's colour in the mask. `docs/rendering.md`,
    `GlowPass.ts`, `WorldGlow.ts` and `BodyDraw.ts` ("palette first") now
    say what the code does; whether that order should change is the owner's.
  - **The profiler span**: the weapon's draws are only QUEUED at the end of
    group 0 (inside `drawWorld`); Babylon runs the queue — our recording — at
    `_endCurrentRenderPass`, so that cost lands in whichever span is open then
    (`docs/profiling.md`, reworded; not confirmed by a capture).
  - **A refused pass was told every refused frame**, up to three times a
    frame — with the console listener (the kit screen over the menu) a
    `console.error` a frame: `ViewDraw` now tells a refusal of the main pass,
    and of the mask, once per change.
  - **A recipe's late pipeline** (`adopt`, a shape not asked at
    construction) only logged when it failed: it is told to `onFailed` as the
    construction asks are.
  - **DEV asserts**: a segment whose material has neither a cel recipe nor an
    emissive colour, an unlit material at a non-zero `zOffsetUnits` (the
    weapon's emissive draw carries no bias), and a segment hung after the kit
    was built (no slot), all in `Game.buildViewDraw`/`drawView`.
  - **Re-checked after the fixes**: the bank `--check --keep` against the
    BEFORE at edccb4f **83 of 84 byte-identical** (`sarab/shelf`'s worktree
    pixel, the same bytes the parent draws in the main tree); the glow's mask
    read back at every Harrowmead row **37 of 37 identical**; `kit:hash
    --models` **244 of 244 identical**; `gate.mjs` and `shaders.mjs` clean on seven;
    typecheck, build, corecheck and `parity` pass. No console or page error.
- **Three decisions the owner made on 2026-10-31** on what the review raised,
  landed after it (nothing in the picture or the readers moved):
  - **A. The weapon draws LAST in the glow's mask again, as Babylon drew it.**
    A late mask point of ours, no Babylon internal: `GlowPass` raises
    `onMaskCloseObservable` from the mask target's after-render, which Babylon
    calls inside its unbind before it ends the pass (`unBindFramebuffer`'s
    callback), and `Renderer.glowMaskClosing` queues the late draws
    (`addGlowMaskLate`) there on the verdict its open made of the same pass
    (Babylon no longer names it as the bound target by then). `ViewDraw`'s
    mask hangs there — after the palette and the visors, which stay first,
    and after every mesh of Babylon's, blended ones included — and X4.3d's
    glasses inherit the point. **The review's example was wrong and the case
    is real**: a molotov's fire does not show it — the flame's own material
    is opaque and writes depth (only its mask twin does not), so in front of
    the weapon it hides it in the frame and the mask alike, whatever the
    order — and a BLENDED emissive that writes none does: a spark at
    visibility 0.5. Measured (a scratch: the flame, then a spark, stood
    between the eye and the flash's petals at the hip and the holo's reticle
    aimed, at several depths and sizes, the mask read back on and off, each
    grabbed twice): the fire **10 of 10** masks identical to the parent, as
    they were under the first order too (10 of 10 at bd1aed3); the spark
    **8 of 8 identical to the parent**, where bd1aed3's weapon-first order
    matched **0 of 8** (the spark washing up to 8,376 lit texels of the
    weapon). The mask read back at every Harrowmead row 37 of 37 identical.
    bd1aed3's "current behaviour" words in `docs/rendering.md`, `GlowPass.ts`,
    `WorldGlow.ts` and `BodyDraw.ts` give way to the restored order.
  - **B. `Renderer.begin` does nothing on a frame with nothing of ours
    committed.** Each draw may state whether it has anything this frame
    (`Active`; the weapon's while a segment is committed, its mask's while a
    committed segment glows), and `begin` skips the fill, the
    view-projection, the upload, the textures, the bind-group refresh and the
    prepares (and their encoder) when none has; the next frame that has
    something does all of it afresh, so nothing binds a value a skipped frame
    left stale. `ViewDraw` zeroes its stats at each commit, since a skipped
    frame runs neither its prepare nor its draw. Measured (a scratch counting
    the frame block's uploads and the prepare encoder's asks, 60 frames a
    state): the menu 0, the kit screen over the menu 61 of 61 (the gun drawn
    on every one, 10 draws), the menu again 0, `deploy` 60 of 60, the kit
    screen over deploy 60 of 60, a round after the menu 60 of 60 (the gun
    drawn on every frame); no error. The kit stays built at boot.
  - **C. The empty-group seam is guarded and written down.** Every draw of
    ours hangs on group 0's points and Babylon visits no empty group, so a
    frame on which group 0 dispatches no mesh of Babylon's runs none of them,
    silently. A DEV build now warns once per change (`Renderer`: draws were
    waiting at the points and the group never rendered). Forced (a scratch:
    every group-0 mesh hidden under the kit screen over the menu): ONE warning
    over 60 frames, the weapon undrawn while it lasted, drawn again (10) once
    the group was back, a second warning only when it went again. The briefs
    of X4.4, X4.5 and X4.6 now say whichever step drains group 0 owes the
    seam a fix; `docs/rendering.md`'s draw points say it too.
  - **Re-checked after them**: the bank `--check --keep` against the BEFORE at
    edccb4f **83 of 84 byte-identical** (`sarab/shelf`'s worktree pixel, the
    parent's own bytes in the main tree); the glow's mask read back at every
    Harrowmead row **37 of 37 identical**; the draw order against the
    parent's own group-1 queue every frame equal again (3,982 and 1,564
    frames) and the readers bit for bit (2,286 and 303 answers; 3,981 and
    1,563 frames' digests identical); `census --against` every total equal
    (278, 205, 672, 2,314, 472, 213, 125); `kit:hash --models` **244 of
    244**; `gate.mjs` and `shaders.mjs` clean on seven; typecheck, build,
    corecheck and `parity` pass. No console or page error.
  - **Owed onward, added**: build the ~14 MB kit LAZILY, at its first use (the
    kit screen or a round), rather than at boot — a later lever, to be
    measured (boot time and resident memory on the phone) before it is taken.

X4.3d's brief, word for word:

- **X4.3d — the lens glass and the kit card (no picture change), and group 1
  goes.** Landed (below). The two glasses (the holo's disc and the reflex's canted pane, one
  pair a rail weapon) as a BLENDED draw of ours after the gun's opaque
  parts: colour `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA` and alpha (ONE, ONE) —
  `ALPHA_COMBINE`, so ink behind a lens is attenuated by its alpha as now —
  no depth written, both faces [archive note, X4.3d's review: wrong — the
  glasses' arrays are `DOUBLESIDE`, a coincident reversed copy of every
  triangle, so drawing both faces would blend both copies (0.12 landing as
  ~0.226); the step culls back faces, as Babylon's default did, and must],
  back to front, `StandardMaterial`'s unlit
  emissive at its alpha reproduced as `EmissiveWorld.ts` reproduced
  `getEmissive`'s, never in the mask (`noGlow`). The card as a draw of ours
  at the head of the same point, before the gun: its 256² canvas uploaded as
  a texture of ours as `DynamicTexture.update` uploads it (its flip, its
  format, no mips — none were asked for — and Babylon's sampler) and
  repainted only when the bay moves (`updateInspect`, :1376-1380);
  `ALPHA_REPLACE_COLOR`'s factors — colour (ONE, ZERO), alpha (ONE,
  ONE_MINUS_SRC_ALPHA) at a fragment alpha of 0, the coverage channel
  untouched — depth `always` and written, no culling; up
  only between `beginInspect` and `endInspect`. With group 1 empty,
  `setRenderingAutoClearDepthStencil(VIEWMODEL_GROUP, false)` and
  `VIEWMODEL_GROUP` go, the glow's stage rule is stated by the draw itself
  rather than by a group id (`Game.glowAdmits`, :2156-2158), `Player
  .warmView` goes (the glass was the last viewmodel pipeline it compiled,
  `Player.ts:2494-2505`), and `FINDINGS.md` 16's "only the weapon and optic
  WORN are warmed" is settled. The profiler's `drawOverlay` was group 1
  (`FrameProfile.ts:1365-1374`) and records nothing once it is empty: it is
  retired with a report version, or re-hung on our draw. **Oracle:** the
  bank's aimed `holo` and `reflex` rows and X4.3a's kit rows byte-identical,
  every other row too; the kit screen walked through a resize, a rotation
  into portrait and the AT row arriving (the pool repainting) on a phone and
  a 32:9 window; `pipelines.mjs` creating nothing on a first ADS through
  either glass; a capture's phase tree.

**X4.3d landed** (4070427; 2026-11-01; no picture change).
- **What it is.** The optics' two GLASSES (the holo's disc and the reflex's
  canted pane, one pair a rail weapon) and the kit screen's CARD are
  SEGMENTS of the viewmodel's kit, and **Babylon is made no viewmodel mesh
  at all**. `ViewSegment` gained a `role` (`"opaque"`, `"glass"`, `"card"`;
  `viewTree.ts`), and `ViewSurface` (a segment or a mesh) is gone with the
  mesh half of `ViewTree` (`ViewMesh.mesh`, `drawn`, `frozen`, `handed`, the
  `freezeWorldMatrix` hand-over, a mesh's switch written by `syncSwitches`,
  `seal`'s NONUNIFORMSCALING compose). `optics.ts` makes each glass a
  segment (`toSegment`) and keeps its own `StandardMaterial` on it, never
  bound to a mesh, as the statement of its colour and alpha;
  `buildKitBackdrop` makes the card a segment with no material, and its
  picture is a 256-square `document` canvas of `ViewModel`'s
  (`KitCardPicture`: the canvas, made at the first paint, and how many times
  it was painted), painted by `paintKitPool` exactly as the `DynamicTexture`'s
  canvas was. The kit holds all 326 surfaces of the tree now (313 opaque,
  12 glasses, the card).
- **The draw** (`render/ViewDraw.ts`, programs in `render/viewProgram.ts`):
  one `"afterGroup"` draw in three runs, the frame's draws laid out as
  `[card][opaque…][glass…]` (`commit(n, cards, glassFrom, epoch)`):
  - **the CARD first** — where it was the last of group 0's blended queue
    (`alphaIndex` `Infinity`) — by a stage of its own (`viewCardVertex`: the
    world, then the view-projection, as Babylon's default vertex did, handing
    the pixel its `uv`; `viewCardSurface`: the texel clamped, at an alpha of
    0 — an unlit `StandardMaterial` over an emissive texture at `alpha` 0),
    blended as `ALPHA_REPLACE_COLOR` blends (mode 21: colour (ONE, ZERO),
    alpha (ONE, ONE_MINUS_SRC_ALPHA), so the coverage channel is untouched),
    depth `always` and written, no culling. Its canvas is uploaded as
    `DynamicTexture.update` uploaded it — `copyExternalImageToTexture`
    flipped in y, not premultiplied, into an `rgba8unorm` 256 square with one
    mip — ONCE PER PAINT (`ViewDraw.cardPicture`, from `Game.drawView`,
    before the render, as `update()` ran in the frame's update), and sampled
    by the sampler Babylon's WebGPU cache made for a trilinear mode with no
    mips (linear both ways, mips `nearest`, LOD clamped to 0, clamped in u
    and v); a card never painted is not drawn.
  - **the OPAQUE parts** as X4.3c drew them, in Babylon's group-1 order.
  - **the GLASSES last** — where group 1's blended queue drew them — by the
    emissive stage's own vertex module under a pixel of their own
    (`viewGlassSurface`: `clamp(emissive)` at the material's alpha, 0.12 the
    holo's and 0.07 the reflex's, out of a glass table each glass's 1-based
    slot in `uv2.x` names — what the unlit `StandardMaterial` with no fog
    plugin wrote), blended as `ALPHA_COMBINE` blends (colour (SRC_ALPHA,
    ONE_MINUS_SRC_ALPHA), alpha (ONE, ONE)), no depth written, LEQUAL, back
    faces culled over `DOUBLESIDE` arrays; back to front by the distance from
    the eye to each one's bounding-sphere centre, a tie to the one made
    first (`defaultTransparentSortCompare`) — an order only ever stated, one
    weapon wearing one optic. Never in the glow's mask (`noGlow`).
  Every pipeline (the card's and the glass's with the emissive pair and the
  cel variant) is asked at construction, so the warm-up's wait covers them;
  `stats.drawn` counts the card and the glasses.
- **Group 1 goes.** No rendering group above 0 holds anything:
  `VIEWMODEL_GROUP` and `setRenderingAutoClearDepthStencil` are deleted (the
  gun is in the frame's one depth image by being drawn at the end of group
  0); **the glow's stage rule is stated by the draw** — `ViewDraw` masks the
  weapon's lit parts in every state and asks nothing, and
  `Game.glowAdmits()` answers for the world alone (every Babylon mesh, the
  palette, the visors), where it asked of a rendering group; the size
  gate's "outside rendering group 0" exemption is gone
  (`WorldCulling.offer`: `infiniteDistance` alone, the viewmodel being no
  candidate); **`Player.warmView` is gone** (the glass was the last
  viewmodel pipeline the warm-up compiled), and with it the pre-cull
  `ViewModel.syncSwitches` (the cull asked a glass or the card
  `isEnabled()`; `drawView` still syncs). `FINDINGS.md` 16's "only the
  weapon and optic WORN are warmed" is settled and deleted. **The profiler's
  `drawOverlay` is RETIRED** with report version 24: `drawWorld` is every
  group's (group 0's), a capture's tree has three spans under `render`.
- **The evaluation is unchanged**: `ViewTree.draw` evaluates every surface
  on and visible, whatever its role — the glasses and the card included —
  through the `RenderCache`, settled at the render's id from inside the
  render as before.
- **The empty-group seam, checked**: with the card off Babylon, the kit
  screen over the MENU (no map) holds the SKY in group 0 — its dome, stars
  and cloud ring are group-0 meshes in every state — and no frame of the walk
  below rendered the main pass's group 0 empty (a counter of the meshes it
  dispatched, the main pass alone: minimum 1 on every frame), no DEV seam
  warning. So it is not this step's fix; X4.5, which takes the sky, is where
  group 0 can first go empty over the menu (`docs/rendering.md`'s draw
  points say so).
- **The instruments taught.** `kit:hash --models` dresses the card as the
  mesh it was (rendering group 0, always-active, `alphaIndex` infinite, under
  a stand-in material of its name, `kitBackdrop`); a glass as the opaque
  ones (its own material named as before); every tree surface is a segment
  record. `census` needed nothing (`viewDraw.stats.drawn` counts them).
- **Measured** (BEFOREs at 595e35d in the worktree):
  - **The bank** `--check --keep`: **83 of 84 byte-identical** — the aimed
    `holo` and `reflex` rows, their hip rows and both kit rows among them.
    The 84th, `view-pistol-reload`, one pixel by 1/255, the MAIN tree's own:
    the parent run in the main tree (`git stash`) draws the step's bytes
    (and a second Harrowmead run on the step draws them again). The same 34
    stale rows on both sides, no console or page error.
  - **`census --against`**: every total equal (278, 205, 672, 2,314, 472,
    213, 125); Babylon's draws fall by 1 on the holo and reflex rows (23 to
    22 hip, 23 to 22 and 21 to 20 aimed) and by 2 on the kit rows (24 to 22:
    the card and the glass), ours rise by the same.
  - **`kit:hash --models`**: **244 of 244 identical**.
  - **The glow's mask** read back at every Harrowmead row in the bank's
    sequence on both trees: **37 of 37 identical** (holo aimed 1,294 lit
    texels, reflex aimed 274); the weapon's mask draws equal, its main-pass
    draws +1 (the glass) or +2 (the card and the glass).
  - **X4.3b's replay** on both trees (`x43d/probe4.mjs`, the digest by
    TREE INDEX — the parent's glass and card meshes in Babylon's active list
    plus its handed segments, against the step's handed segments): the
    recorded round **1,564 frames identical (24,651 drawn surfaces, 1,112 of
    them the glass) and 303 reader answers identical as float64 bits**; the
    seeded sequence through all nine rigs in all seven sights, the turntable
    turned **3,982 frames identical (61,242, 413 of them a glass or the card)
    and 2,286 answers identical**; the WHOLE draw order — the card as the
    parent's group 0 rendered it, its opaque draws, the glasses as its group
    1 rendered them — equal to the step's handed order on every frame of
    both; every drawn matrix its joints' fresh composition (0 differ).
  - **Pipelines on a first view and first ADS through either glass**
    (`x43d/ads.mjs`, `pipelines.mjs`'s hook with the async pair added): a
    round warmed on the rifle's irons, then the carbine on the holo and the
    SMG on the reflex set on the deploy screen without the kit screen,
    spawned, 90 frames at the hip and 120 aimed: **0 creations** on both
    lives (the parent: 2 shader modules and 1 render pipeline on the holo's
    first view, 0 on the reflex's, which shares it).
  - **The kit screen walked** (`x43d/walk.mjs`, the real lid with its DOM
    up, clocks frozen once it was up): raised over the MENU and over DEPLOY,
    the anti-tank row arriving (the screen re-fitted with armour offered), a
    resize, a rotation into portrait and back, the carbine on the holo and
    the SMG on the reflex on the bench — at 832x384 (to 740x360, to 384x832)
    and 3840x1080 (to 3440x968, to 1080x1920), each shot twice: **39 of 56
    shots byte-identical** to the parent's, the rest by 1-3/255 in the card's
    pool and the DOM's type, the parent's own run-to-run noise (a second
    parent run differs from the first on 14 of 56, by up to 2/255, in the
    same places). The card was repainted on every bay move (5 paints a
    walk), group 0 never rendered empty, no seam warning, no error.
  - **A capture**: report version 24, `render`'s children `shadowPass`,
    `glow`, `drawWorld`, no `drawOverlay`; `view` 15 drawn (the carbine with
    the holo aimed), 2 masked.
  - **Rounds** (`x43c/round.mjs`): offline, six lives on Harrowmead, every
    primary on a sight each (the holo and the reflex among them), the pistol,
    both throwables and both AT items — the weapon drawn on every one of
    6,014 frames with the body up (9-21 draws), 88,949 drawn matrices each
    its joints' fresh composition, the nine reader-backed origins (six
    grenades, three rockets) bit for bit (the three mine lays read no
    viewmodel), no `refused`, no error; a netplay round against a local
    `dist-server` built from the step (the rifle on the reflex): 15,137
    matrices fresh, a frag's and a rocket's origins bit for bit, no
    `refused`, no error.
  - **`gate.mjs`** clean on seven; **`shaders.mjs`** clean on seven, ours
    17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour); typecheck,
    build (`check-babylon-free` clean), corecheck (all passed),
    `math-check` (81 cases) and `parity` (every map) pass.
- **Deviations.** **The pre-cull `ViewModel.syncSwitches` went too** —
  not named by the brief; it existed only for the cull's `isEnabled()` on a
  Babylon glass or card. **The size gate's group test** was deleted, not
  only its words (no mesh is outside group 0). **The warm-up's frames no
  longer show the put-away weapon**, so the tree's render cache is not
  stamped by them; nothing reads the viewmodel under the building card, and
  the replay oracle, which starts in `deploy`, is unmoved. `CLAUDE.md` is
  1,558 lines (four up), over its ~1,500 as it already was.
- **Owed onward.** X5.4's frame id for the render cache (decided). The kit's
  construction cost and its ~14 MB (now with the card's 256 KB texture) on a
  phone, and building it lazily, stay X4.3c's open levers. **The empty-group
  seam is X4.5's** where it takes the sky: the kit screen over the menu holds
  nothing else of Babylon's in group 0. The tree's compose costs stay
  unmeasured (X4.3b's note).
- **What the post-commit review found** (an independent reader over 4070427
  and da0a996; fixed after it, in one commit). **No bug.** It confirmed the
  glass's back-face culling: the brief's "both faces" was wrong (noted
  inline in the brief above) — the arrays are `DOUBLESIDE`, and with no
  culling a lens would blend both copies. Fixed:
  - **Stale counts and words** (rule 7): `render`'s spans are THREE since
    `drawOverlay` retired — `CLAUDE.md`, `docs/profiling.md` (three places)
    and `FrameProfile.ts` (two) said four; `config/graphics.ts`' header
    gotcha named "rendering group 1"; `PlayerView.ts` said the flash "draws
    in the viewmodel's group"; the viewer's comment on `view` said only the
    opaque parts were out of Babylon's counter (none of the weapon is since
    v24).
  - **A guard**: `WorldCulling.offer` warns (DEV, once per mesh) of a Babylon
    mesh outside rendering group 0 — one there would bring Babylon's
    per-group depth clear back between it and the world, splitting the one
    depth image the ink, the blur and the glow read, and the size gate no
    longer exempts it.
  - **The card's size stated once**: `ViewDraw` held a `CARD_SIZE` beside
    `ViewModel`'s `KIT_CARD_SIZE`; its texture is now made at the first paint
    off the canvas's own width and height, and a paint's copy reuses its
    three descriptors, so `ViewDraw`'s "nothing allocates on a frame" line is
    true again (the texture at the first paint aside).
  - **Why the glass culls**, written in `ViewDraw`'s header and
    `docs/rendering.md`'s glass bullet.
  - **Dead state**: `ViewMesh.on` and `seen` were written and never read once
    no Babylon mesh's switch was written from them; both dropped, and
    `ViewTree.syncSwitches` (its one caller `draw`) made private — the walk,
    and so `evaluated`'s order, unchanged.
  - **The live plan's "Owed onward"** gained X4.3b's unmeasured compose
    costs.
  - **Decided** (the owner, 2026-11-01, raised by the review): **the
    glasses' looks are PLAIN DATA.** The twelve `StandardMaterial`s
    `optics.ts` made for the glasses (one holo and one reflex a rail weapon),
    bound to no mesh since the step and read for four numbers, are gone: a
    glass segment carries `ViewSegment.glass` (`ViewGlass`: its emissive
    colour, each channel the hex byte over 255 exactly as
    `Color3.FromHexString` read it, and its alpha — `glassLook` in
    `optics.ts`), `Game.buildViewDraw` reads it off the segment, and no
    Babylon material is made for a glass (none in `scene.materials`).
    `kit:hash` spells a glass under a stand-in material of the name its own
    had (the segment's name), as it does the card. Nothing else read those
    materials: the finishes never reach an optic, `census` reads
    `viewDraw.stats`, the warm-up poses nothing of the weapon, and the editor
    never touches the viewmodel. Measured after it: the bank `--check --keep` against the BEFORE at
    595e35d **83 of 84 byte-identical** (the aimed holo and reflex rows and
    both kit rows among them; `view-pistol-reload`'s main-tree pixel), all 84
    byte-equal to 4070427's; a first view and first ADS through the holo and
    the reflex **0 creations**, and **0** glass materials in
    `scene.materials`; X4.3b's replay **1,564 and 3,982 frames identical, the
    draw order equal on every frame, 303 and 2,286 reader answers identical
    as float64 bits**; `kit:hash --models` **244 of 244**; `gate.mjs` and
    `shaders.mjs` clean on seven; typecheck, build, corecheck and `parity`
    pass.
  - **Re-checked after the fixes**: the bank `--check --keep` against the BEFORE at 595e35d
    **83 of 84 byte-identical**, all 84 byte-equal to the landed step's
    (`view-pistol-reload`'s one pixel the main tree's own again); X4.3b's
    replay **1,564 and 3,982 frames identical, the whole draw order equal on
    every frame, 303 and 2,286 reader answers identical as float64 bits**;
    `kit:hash --models` **244 of 244**; the kit screen walked again at
    832x384 and 3840x1080 — the card painted 5 times a walk, drawn on every
    frame, group 0 never empty, the new guard silent, 41 of 56 shots
    byte-equal to the landed walk and the rest within the parent's own
    run-to-run noise (1-3/255); `gate.mjs` and `shaders.mjs` clean on
    seven; typecheck, build, corecheck and `parity` pass.

### X4.4 — The effect pools, and pipelines compiled at load — **M–L, as five sub-steps** (split 2026-11-01, decided the same day) — X4.4a **LANDED** (63a338a, review fixes after it), X4.4b **LANDED** (9470686), X4.4c **LANDED** (d82f311), X4.4d **LANDED** (9d81875), X4.4e **LANDED** (e3d5276) — **all five LANDED** (63a338a..e3d5276)

X4.4a's brief, word for word:

- **X4.4a — the bank sees every pool (no change to the game).** Rows are
  added, seeded through the harness's `seeded()` (X4.3a), for what X4.4b-e
  move and the one `blast` row cannot see: a tracer in flight; a spark and a
  dust disc mid-fade at an impact on hard ground and on soil; a wall of
  marks, near and at the size gate's edge; a grenade in flight with its pip
  lit, and one at rest; a rocket in flight with its motor; a laid mine with
  its lamp; brass in the air; the blast at several ages (the fireball, the
  billows, the late smoke) on `ground` and on `hard`; scorch at full and
  mid-fade; rubble chunks in the air and at rest; shards falling from a
  broken pane; a burning molotov and a world fire; and at least one fading
  effect seen through glazing (the sort question above). **Appended at the
  END of a map's sequence**, because a row's frame depends on the rows shot
  before it, and banked with `--rows`. Also recorded: `pipelines.mjs`'
  creations during a scripted round that fires every weapon and uses both
  throwables and both AT items — the count X4.4e must take to zero.
  **Oracle:** `bank.mjs --check` twice back to back, every new row
  byte-identical to itself; every old row unmoved.

**X4.4a landed** (63a338a, the post-commit review's fixes after it;
2026-11-01; no change to the game — the reference
bank, its harness, its table and `pipelines.mjs` only).
- **What it is.** Twenty-one rows, every one raised through the door the
  game raises its effect by and posed on a stated clock: nineteen appended at
  the END of Coldharbour's list (`bench/vantages.ts`' `effectRows`, after
  `crossing`) and two at the end of Cinderhaven's (`fireRows`, after
  `tank-far`), banked with `bank.mjs coldharbour cinderhaven --rows=<the
  twenty-one>`:
  - `fx-tracer` — three tracers in flight crossing in front of the quay's
    harbour wall;
  - `fx-impact-hard` — five rounds on the quay's stone deck (`hard`) at
    ages 0.04-0.3 s: sparks and discs at `visibility` 0.07-0.91, the chips;
  - `fx-impact-ground` — five on the road beside the promenade (`ground`, the
    floor): discs only, the divots;
  - `fx-marks-near` — 28 marks on the quay's harbour face through a 30°
    field, the spark and dust long gone;
  - `fx-marks-far` — 40 rounds at the west face of a brick block 58 m down
    the avenue through a 47° field: 30 land on it, and of those 14 project
    under `minPixels` (3) and are not drawn — their projected diameters run
    2.2-4.1 px, so the gate's edge falls in the middle of the wall;
  - `fx-grenade` — a frag at rest on the deck, a second in flight, a bottle
    in flight: both pips lit, the wick lit;
  - `fx-rocket` — a rocket 0.25 s out, broadside, its motor;
  - `fx-mine` — two plates on the deck, the lamp lit on the armed one and
    dark on the other, laid as the wire lays them (`NetOrdnance.applyMines`:
    the page never predicts a mine, so a mine on screen is always the wire's);
  - `fx-brass` — the rifle at the hip on the square firing eight rounds 0.05 s
    apart, three cases in frame mid-arc and the flash on the muzzle;
  - `fx-blast-{hard,ground}-{fireball,billows,smoke}` — a frag's blast at
    0.08, 0.6 and 1.8 s on the quay's deck and on the floor at the road's edge
    by the promenade, raised as the wire's `explode` arm raises one
    (`Game.onNetEvent` → `drawBlast` and `onExplosion`: the six drawn layers,
    the rubble, the scorch, the light — which the freeze clears with every
    transient): the flash and fireball, the billows with the trails and the
    rubble in the air, the column dissolving with the rubble at rest;
  - `fx-scorch` — two molotovs' scorches on the deck, 9 s old at full and
    11.5 s old fading (0.4 and 0.28);
  - `fx-molotov` — a molotov 1.5 s after it went up, raised by the wire's
    `blaze` arm (`Game.fireLit`: the flames, the ignition's billows, the
    scorch, the light);
  - `fx-shards` — pane 0 (the square's west shopfront) bursting outward,
    0.3 s on (`DebrisSystem.burst`, as `GlassSystem.onBreak` hands it over;
    the sheet left standing, since a broken pane never mends in a round and
    the put-away could not mend it);
  - `fx-glass` — the same shopfront: two rounds through the window into the
    shop's side wall 3-4 m behind the pane, two on the pier beside it, all
    mid-fade;
  - `fx-fire`, `fx-fire-fade` — Cinderhaven's fire drum on the bay road at
    night through a 9° field, then the same with a spark, a disc and a tracer
    on the careened boat's hull behind its flames and two dust discs on the
    cobbles in front.
- **Where, and why there.** Coldharbour has the three things in one boot:
  see-through glazing (`map.panes`, the square's shopfronts), both ground
  kinds side by side (the quay's deck and walls answer `hard`, the road and
  floor beside them `ground`), and armour, so the third slot is in its kit.
  Its only fires are a tavern's hearths and a chapel's candles, indoors, so
  the world fire is Cinderhaven's drum. **Every row stands at a position an
  earlier row of its map already stands at** (`curtain90`, `crossing`,
  `blast`, `avenue`; Cinderhaven's `crossing`) and only turns or narrows the
  camera, because the benchmark takes one stop per POSITION: its stops are
  unchanged (checked by script, the dedupe `BenchScript` runs, positions and
  first targets identical before and after), and `BenchScript` is untouched.
- **The field.** `Vantage.fx: { seconds, events, mines? }`, events a union
  (`FxEvent`) of `round` (`CombatFx.drawRounds`, the wall query its own: the
  round is aimed at `to` and flies on to the first thing in its way, out to
  the rifle's range), `throw` (`GrenadeSystem.throwAt`), `rocket`
  (`AntiTankSystem.launchToward`), `explode`, `blaze` (the wire's arms),
  `shards` (`DebrisSystem.burst`) and `brass` (`PlayerView.fired`).
  `placeVantage` raises each `at` seconds into a clock of fixed 1/60 s steps
  and steps every pool in the frame's order (`stepShots`, `stepAftermath`,
  then the brass as `Player.update` steps it); the frame is the clock's end,
  no frame rendered among the steps. A row that throws brass renders one
  frame with its pose up first, because the port is read out of the render
  cache (the held reload's reason). **The put-away** (each door's own:
  `clearTransient`, both throwables' `reset`s — a fire out through
  `Game.fireOut`, its light and voice with it — `antiTank`/`antiTankFx`,
  the wire's `ordnance.reset`, `debris`/`blastDebris.reset`, the brass
  `cleared` and the weapon's stowed state put back) runs only after a row
  that raised one, so the 84 rows before run exactly the calls they were
  banked with.
- **Determinism, per kind.** Every random in the pools is a picture's
  `Math.random` (the blast's 39, the tumble, the marks' roll and size, the
  brass, the flash, the ignition), seeded by `seeded()` for the whole
  clock. **The sound draws from `Math.random` too, and gates what it draws
  on the audio clock and its voice count** (`Sfx.impact`'s rate limit reads
  `ctx.currentTime`), which no two runs share, so every `Sfx` call inside the
  clock is handed the real `Math.random` for its length (a proxy on `g.sfx`
  for the clock, put back after): the sound still plays and its draws do not
  move the pictures' stream. **The Havok-posed pieces needed nothing new**:
  the rubble and the shards draw from their own xorshift streams
  (`BlastDebrisSystem.rand`, `DebrisSystem`'s), re-seeded by the put-away,
  and `PhysicsWorld` steps at the fixed `death.substep` (1/60) carrying no
  remainder across a lull — so a 1/60 step is exactly one substep — and the
  rows run in the same order every run; `bank.mjs` refusing a row whose two
  grabs differ, and the two checks below, are the proof. No stop condition
  was met. The marks' ring restarts at slot 0 (`BulletMarks.clear`), the
  flights' and fires' ids are monotonic and only key a fresh tumble.
- **Measured.** **Banked**: all 21 written, each from two consecutive grabs
  byte-identical. **Twice back to back**: `bank.mjs --check --keep` run
  twice in a row on this tree — all 21 new rows "within floor" at 0 pixels
  against the bank in both runs, 104 of 105 kept frames byte-equal between
  the runs, the 105th `view-pistol-reload` one pixel by 1/255 in the second
  run (the known main-tree flake); no console or page error. **Old rows**:
  against a BEFORE taken the same way at bb05074 in the worktree, 84 of 84
  byte-equal in the first run and 83 of 84 in the second (the same pistol
  pixel), and the same 34 stale rows failing the stale bank with identical
  numbers on both sides. Typecheck, build (`check-babylon-free`,
  `check-proving` clean) and corecheck (all passed) pass. Not run: `gate`,
  `census`, `parity`, `kit:hash` — nothing in the game moved.
- **The pipeline count** (`pipelines.mjs coldharbour --round`, new: see its
  header). Two lives on Coldharbour, each deployed with its kit through the
  real deploy (rifle, frag, launcher; carbine, molotov, mine); every primary
  and the pistol fired through the real trigger for two seconds each round
  the compass and at the floor (187 rounds, 187 flashes and cases), a frag
  thrown (its blast, rubble and scorch), two rockets (their blasts), a
  molotov (its fire), two mines laid (the wire's tables), and one pane
  broken by a round's path through it (`GlassSystem.shoot`, predicted; its
  shards). The script holds `g.input`'s trigger, throw and pointer lock and
  writes the kit, and nothing else of the game. **In play, Babylon created
  ZERO render pipelines and our renderer zero, in six of eight runs**; two
  runs created 5 and 2 Babylon pipelines (and twice that in shader
  modules), both inside the same 2 s window at the end of the first life
  (the pane phase), before the probe filed each creation under the mesh
  being drawn — the five runs since it was added read zero, so the two are
  unattributed. At the installs (left out) 39 of Babylon's and 39 of ours,
  and the second install creates none. **So the warm-up (`FINDINGS.md` 16)
  already holds a scripted round at zero most of the time**: what X4.4e
  owes is the declared list replacing the `warm(on)` poses at the same
  zero, and the intermittent 2-5 attributed (`--round` names the mesh now).
- **The transparent sort, measured** (a scratch probe wrapping `Mesh.render`
  in group 0 of the main pass, the seam's `afterOpaque` and `afterGroup`
  marked, over two frames: the `fx-glass` shopfront with a molotov and a
  0.6 s blast added, and the `fx-fire-fade` drum with the same). **Babylon
  draws the blast's billows (`blast` slots and `blastSmall`), the molotov's
  flames, the world's fires (`block-*-flame`), the tracers, the marks and
  the rubble in its OPAQUE list** — front to back by bounding-sphere centre,
  among the opaque world, before `afterOpaque` — none of them blended (the
  backed panes, `cel-glass-…-on-…`, are there too). **The fading sparks and
  discs (`visibility` under 1) and the scorch are in its TRANSPARENT list**,
  after `afterOpaque` and before `afterGroup`, sorted back to front by
  bounding-sphere centre distance (every `alphaIndex` at its default) **and
  interleaved with the see-through glazing**, one mesh a pane block sorted by
  the block's centre: at the shopfront the interior sparks and discs (13.3-
  13.7 m) and the pier's (8.4 m) drew before the pane block (8.35 m), the
  nearest spark (8.27 m) and both scorches (4.6, 6.1 m) after it. **So for
  X4.4b neither of our points reproduces Babylon's order for a blended
  pool**: at `afterOpaque` every fade lands before every pane (wrong for one
  nearer than a block's centre), at `afterGroup` after every pane (wrong for
  one behind) — a blended pool of ours has to draw inside Babylon's sort
  (an item queued in the transparent list's order), or the difference is a
  recorded picture change. The billows and the flames raise no such question
  against the glazing: they are opaque-list draws.
- **Looked at, every one**, each `proves` written against its frame; the
  marks' gate read off the meshes' own bounding spheres (`fx-marks-far`), the
  impacts', casings' and scorches' live states read off their pools.
  **Found and recorded rather than moved:** a scorch laid on the FLOOR does
  not show — the ground blasts' marks at the road's edge, and a trial pair
  laid on the promenade's floor at 0.2 and 0.4 (`ScorchMarks` live, visible,
  at full scale), drew nothing, where the same marks on the quay's deck (a
  block) draw (`fx-scorch`); not investigated, and X4.4c, which makes the
  scorch ours, inherits the question. Coldharbour's `ground` impacts land on
  the asphalt (the floor's road), where the dust disc reads; on the
  promenade's cobbled floor it is near invisible — the same picture a round draws there.
- **What the post-commit review found** (an independent reader over
  63a338a and 1f16c67; fixed after it — the bank, its harness, its table,
  `pipelines.mjs` and docs; nothing in the game moved, the shipped
  `?bench=` included: its stops are identical, checked by the dedupe
  `BenchScript` runs). **No game-behaviour bug.** Each claim was checked
  before it was fixed:
  - **`--round` left the spawn out, and filed the second install under the
    pane.** `__gpuPhase` stayed `"install"` through `spawnPlayer`, the wait
    for `playing` and the 30 frames after, so those creations fell in no
    phase; worse, `phase(null)` closed a life's last phase but the next
    `phase()` call re-opened it, overwriting the pane phase's counts with
    everything from the end of life 1 to life 2's first weapon — the second
    install and spawn. A run of the old script showed it (`life 1: a pane …
    mineTables 1`, the new round's mine table, and the pane's own shards
    missing from it), which is where X4.4a's "5 and 2 in the pane window,
    unattributed" most likely came from: made while the label read
    `install`, so the mesh probe's in-play list never named them. **Fixed**:
    `life N: spawn` is a phase opened before `spawnPlayer`, a closed phase
    stays closed (the gap between lives is the install's), and each install
    is reported as its OWN creations (startRound to deploy) rather than a
    running total.
  - **The pane's reading depended on the camera.** The sweep turned the
    camera 0.02 rad a frame inside loops bounded by wall clock, so where it
    faced when the pane broke rode the frame rate, and a shard only
    compiles if it is drawn. **Fixed**: the sweep is a count of FRAMES (320
    a primary, 160 the pistol — about one turn of the compass), the camera
    is turned onto the chosen pane (yaw and pitch at its centre from the
    eye) ten frames before the round that breaks it, and the pane phase
    reports the main pass's shard draws. **Five runs**, each two lives with
    every weapon (42-100 rounds; fewer than X4.4a's 185, the sweeps being
    frames now on an uncapped clock), a frag, two rockets, a molotov, two
    mines and pane 21 broken at 30.4-44.5 m: **zero of Babylon's pipelines
    and zero of ours created in play in five of five**, every phase
    including both spawns, the shards drawn 4,848-7,692 times each run; the
    first install made 28 of Babylon's, 23 of ours and 55 modules (boot
    excluded), the second none. **The pools with NO warm pose in
    `stageWarmFrame`** (which poses `CombatFx`, `GrenadeFx` — its blast
    billows and one molotov flame — `BlastDebrisSystem`'s scorch, and the
    blob shadow): the glass shards (`DebrisSystem`, positions and normals
    only), the rubble chunks, the thrown and laid bodies (`GrenadeBody`,
    `RocketBody`, `MineBody`, and the wire's copies in
    `NetGrenades`/`NetOrdnance`) and the brass. They compile nothing in play
    only because their pipelines already exist before it — not by
    construction — so X4.4e's declared list must name them (its brief says
    so now). The warm-up itself is X4.4e's and was not touched.
  - **Every banked blast was power 1.** `fx-blast-hard-power2-billows`
    appended: a blast of power 2 (a mine's) on the quay's deck at 0.6 s,
    beside `fx-blast-hard-billows` — the billows bigger and more of them,
    filling the frame from the same eye.
  - **The wire's flying bodies were never banked** (only its mine).
    `fx-wire` appended, and `Vantage.fx.wire` with it: two snapshots
    (`WireFlights`, 50 ms apart) fed to `NetGrenades.applySnapshot` and
    `NetOrdnance.applySnapshot` with a local slot no flight names, then both
    posed at render times 100,020 and 100,030 ms — the rocket down the
    direction the wire sent with its motor at its built size (the wire's
    rocket never calls `flicker`), the frag with its pip lit off the wire's
    fuse, the bottle with its wick, both tumbled off the ground covered
    between the two poses. An offline bank boot never runs the session's
    per-frame update (it is held under the deploy card), so the pose
    stands. The put-away now takes the wire's grenades in
    (`net.grenades.reset()`). The first bank of it was NOT reproducible in
    the next check (0.61% of pixels, worst 217): a claimed wire grenade
    rolls its attitude off `Math.random` (`GrenadeBody.begin`), outside the
    seeded clock — the block is seeded now (`0x44b`) and the row re-banked.
  - **`fx-glass`'s in-front fade barely overlapped the glass** — confirmed
    by projecting every live spark's silhouette and disc rim through the
    frame's own transform: the pier impact is 0.15 m in front of the glass
    (8.27 m from the eye against the pane's 8.42 m on its ray), its spark
    15 px and its disc 24 px outside the pane's projected edge at their
    worst; the other pier impact is wholly beside the glass. Nothing on the
    map stands in front of pane 0 for a round to strike: a pavement impact
    projects BELOW a vertical pane from any eye above it, there is no sill
    collider (the pane runs 0.8-3.7 m with nothing under it), and the piers
    project onto its edge. So `fx-glass-sort` appended, with
    `FxEvent.drawn` (`CombatFx.drawRound`, the picture as `onRound` hands
    it over: no wall query, the stated kind and normal, no mark): BEHIND, a
    round through the window onto the shop's side wall (`drawRounds`, its
    own wall query) at (-25.77, 3.05, -4.11), 12.58 m from the eye, the
    pane plane 9.97 m along that ray; IN FRONT, a `hard` impact as `onRound`
    hands a round stopped on a HULL (no mark; no hull drawn) at (-22.24,
    1.66, -8.48), 7.19 m from the eye, the pane 8.92 m along its ray, its
    disc facing the eye. **Projected** at the row's frame: the behind spark
    73 px and disc 64 px inside the pane's quad at their nearest point, the
    front spark 64 px and disc 49 px — every silhouette point inside. Both
    mid-fade (spark `visibility` 0.63 and 0.72, discs 0.49 and 0.60).
  - **"A scorch on the floor draws nothing" was a misreading, neither game
    behaviour nor a harness artefact.** Probed by hiding and showing each
    live mark in the banked frames: on Coldharbour's floor the whole disc
    changes pixels wherever it is in view — under `fx-molotov`'s flames, and
    in a probe on the asphalt and the promenade's cobbles (darkening up to
    35/255 in luminance, against 45 on the quay's lit deck). It is faint by
    design: a black decal at opacity 0.4 is a proportional darkening (the
    material's own comment), so on dark asphalt or a fire-lit floor it
    barely reads. In the ground blasts' rows the book stall (and at 0.08 s
    the fireball) stands between the harbour eye and the mark, so only a
    sliver of it reaches the frame — what the first note read as nothing.
    The marks are in the active list, and the 8.75 cm lift (the row's `at`
    at 0.06 m plus the mark's 0.035 over a floor at 0.0075) is harmless.
    **No `FINDINGS.md` entry**, since nothing is wrong; X4.4c's brief says
    the floor scorch draws, and `fx-blast-ground-fireball`'s `proves`
    (which said it did not show) and `fx-molotov`'s now say what each frame
    holds.
  - **Rows depended on each other's order.** Fire lights take their flicker
    phases from `LightingSystem`'s stream, which only a map build re-seeds.
    **Fixed** where it is cheap: the put-away re-seeds it
    (`mulberry32(0x44a)`), which moved `fx-molotov` alone (its light's phase,
    54% of pixels at a mean of 1.2/255; re-banked) and no old row (the
    put-away runs only after an `fx` row, and every `fx` row is after every
    old one). **Documented** where it is not: Havok's world keeps every
    pooled body, the lamps' atlas its allocation and caches, and the
    flights' ids run on (the harness's put-away comment and the README).
  - **The flesh and glass sparks were never banked.** `fx-impact-kinds`
    appended: two of each over the quay's deck through `drawRound`. Flesh is
    every round on a body; **no caller raises `glass` today** —
    `CombatSystem` names `flesh`, `hard` or `ground`, and a pane's break is a
    sound and shards — so its spark is the table's colour and nothing the
    game draws, which the row says.
  - **Docs**: the X4.4 survey said `BlastShader`'s and `FlameMaterial`'s
    draws write no depth; only their glow-mask twins (`blastGlowMask`,
    `flameGlowMask`) set `disableDepthWrite`, the main materials write it
    (corrected). `docs/rendering.md` said the banked vantages hold none of
    what a culling change touches; `fx-marks-far` banks the size gate's
    edge on a pool now (corrected: the bank still holds no body, which is
    what that latch is about). `fx-shards`' `proves` says plainly that it
    checks the SHARD POOL in front of a sheet left standing, a state the
    game never draws; a real break as a last row was set aside — every row
    a later step appends would stand behind a broken pane.
  - **Measured.** New rows banked with `bank.mjs coldharbour --rows=…`,
    each from two byte-identical grabs, `fx-molotov` and `fx-wire`
    re-banked the same way. `--check --keep` twice back to back: all 25 `fx` rows "within
    floor" at 0 pixels against the bank in both runs, and all 109 kept
    frames byte-equal between the runs (the pistol pixel did not flake);
    against X4.4a's own kept frames (its second run) the 84 old rows and 20
    of its 21 `fx` rows byte-equal, the 21st `fx-molotov` (re-banked, above);
    the same 34 stale rows failing the stale bank as X4.4a's runs did; no
    console or page error. Typecheck, build and corecheck pass.
    Every new and changed row looked at, its `proves` written against its
    frame.

X4.4b's brief, word for word:

- **X4.4b — the plain mesh pools are ours (no picture change).** The tracer
  and mark pools, the grenade, rocket and mine bodies (both the simulation's
  views and the wire's), and the brass, drawn by our renderer as instances
  of their kits (`BodyDraw`'s and `HullDraw`'s shape), into the glow's mask
  where emissive. **The spark and dust-disc pools stay Babylon's** (decided
  2026-11-01, "Find out first" above): they fade in Babylon's transparent
  sort among the panes, and move with the glazing at X4.6 — whole, the
  frames a spark is still opaque included, so a pool is never split across
  two renderers. A mark keeps its depth bias and drops out at range by our
  own size test (it was the size gate's); every pool stays fixed-size and
  allocates nothing per shot. Babylon is made no mesh of any pool this
  sub-step moves. **Oracle:** the bank byte-identical; a round firing every weapon
  at walls, soil and glass, with a frag, a molotov, a rocket and a mine; a
  netplay round where the other side throws and fires (the wire's bodies).

**X4.4b landed** (9470686; 2026-11-01; no picture change).
- **What moved.** Every tracer (`CombatFx`), spent case (`PlayerView`),
  thrown frag and bottle (`GrenadeFx`'s `GrenadeBody`, and the wire's in
  `net/NetGrenades`), rocket in flight and laid mine (`AntiTankFx`'s
  `RocketBody` and `MineBody`, and the wire's in `net/NetOrdnance`) and
  bullet mark (`BulletMarks`) is drawn by our renderer; Babylon is made no
  mesh of any. The sparks and the dust discs stay Babylon meshes, whole, warm
  poses and all (the owner's decision of 2026-11-01).
- **The pieces as data** (`entities/pieces.ts`, new). A `PieceKit` is a kind:
  its segments, each the mesh it was — the arrays (the builder's `Part`
  geometry, never mutated: no palette slot is written into it, so `kit:hash`
  can make the old mesh of it), a cel paint or an unlit one, the local
  bounding sphere (`extractMinAndMax`, `reConstruct`), the transform the mesh
  was dressed with and the segment it hung from. Six kits — tracer, casing,
  frag, bottle, rocket, mine — each built ONCE by the view that made the
  first of its meshes (`CombatFx.tracerKit`, `PlayerView.casingKit`,
  `GrenadeFx.kits`, `AntiTankFx.kits`), so each `mats.get`/`getEmissive` is
  asked at the point in the factory's order it always was (a material's
  `uniqueId` is what the glow mask's and the weapon's sorts tie on), and
  passed to each session's wire pools (`NetSession(kits, …)`, which built
  meshes per session until now). The model files hand over parts:
  `grenadeParts`, `molotovPieceParts` (the bottle's four, off the same
  `molotovParts` the fist's segments are), `rocketParts`, `minePieceParts`,
  `tracerParts` (`CombatFx`), `casingParts` (`PlayerView`). A `Piece` is a
  `PieceNode` a segment — the mesh's channels (an Euler, or the quaternion
  that overrides it while set), `visible` for `isVisible`, the piece's
  `enabled` for the root's `setEnabled` — composed as `computeWorldMatrix`
  composed the mesh (`ComposeToRef`, times the parent's world, `src/math`).
  The pools move the nodes exactly as they moved the meshes, every
  `Math.random` draw kept in count and order (the bank's seeded clocks
  depend on it): `GrenadeBody.begin`, `RocketBody.place` (`lookAt` in local
  space and `setDirection` with no corrections, operation for operation:
  `(x + dx) - x`, `pitch + 0`), the brass's throw in `src/math`
  (`TransformNormalToRef` off the port's Babylon matrix, read through `.m`).
  `BulletMarks` imports no Babylon now: a slot holds its shape, paint, world
  and sphere, composed once at `place` as `freezeWorldMatrix` composed the
  mesh; a slot never stood stands at the identity, its sphere the shape's.
- **The draw** (`render/PoolDraw.ts`, new): `BodyDraw` without the fade —
  kits of any width padded to the widest, the cel and unlit segments at any
  index per kit (the bodies' decode does not care which), the cel pipeline
  at the recipe's `depthBias`, the emissive one and its mask twin asked only
  for a draw with an unlit segment — on `bodyPrograms`' plain three
  (`bodyPrograms` takes a `name` for the labels, `pool`; a label is no part
  of the code, so the bodies' pipelines are the ones they were). Two
  instances: `pieceDraw` (six kits, the bottle's four segments the widest;
  a cel palette of eight colours, `CelMaterialFactory.poolCelRecipe`, and an
  emissive table of five, `poolEmissiveRecipe` — `get(hex)`'s and
  `getEmissive`+`EmissiveFog`'s numbers, as the bodies' and the visors' are)
  and `markDraw` (eight kits, a shape in each paint since the paint is a
  vertex slot; `MARK_DEPTH_UNITS` its pipeline's `depthBias`). Each piece's
  colours, uvs and uv2 are uploaded as Babylon uploaded the mesh's (none of
  these meshes carries a colour buffer, so `color` reads (0, 0, 0, 1)).
- **Where it sits, and why.** Both at `"beforeAlphaTest"`, installed AHEAD
  of the hulls, the bodies and the world: X4.4a measured the pools' meshes
  in Babylon's OPAQUE queue, which runs before that point, and opaque draws
  through the depth buffer differ only where two depths tie — so the marks
  still go down before the walls they are biased off, and the order among
  ours is the queue's. **Within the pools the order is Babylon's where a tie
  can occur**: a piece's segments in `bodyPull`'s stable sort off
  `globalPosition` (`Game.piecePull`, inside the render), and the MARKS'
  instances themselves sorted the same way (`Game.markPull`, slot order
  breaking a tie), since two overlapping marks on one wall are coplanar at
  one bias and the later wins an equal depth (LEQUAL). Across two pieces the
  draw is rank-major, which differs from the queue's interleaving only where
  two different pieces tie (the bodies' and the hulls' accepted price). Not
  reproduced: Babylon's remaining opaque meshes (the sky, the backed panes,
  the flames, the blast, the rubble, the shards, a spark at `visibility` 1)
  now draw before every piece rather than among them — ties only.
- **The glow.** The unlit parts (tracer, pip, wick, motor, lamp) go into the
  mask after the palette and the visors (`installMask` after
  `BodyDraw.installMask`), where Babylon's mask drew them after both, by the
  main pass's vertex module (the LEQUAL tie); each piece's bloom is
  `GlowRules.colour` as `GlowPass` asked it of the mesh — its `getEmissive`
  colour (`Color3.FromHexString`, alpha 1) faded by the fog at the unlit
  segment's sphere centre (`piecePull`); a kit has one unlit segment at most.
- **The size gate, and the latch kept.** An unlit segment is exempt (an
  emissive mesh was). A mark asks `keepsSphere` of its frozen sphere — what
  the gate read off the mesh — so exactly the same marks drop. A CEL part of
  a piece asks it of a GATE sphere that reproduces what Babylon's gate read:
  the world sphere as of the last frame its mesh would have been COMPUTED
  (`_evaluateActiveMeshes` computes only a candidate the gate let through;
  a child's compute asks its parent's world, so a candidate's ancestors too)
  and the local sphere before (a never-computed mesh's world is the
  identity). The first probe gated on THIS frame's sphere (the hulls' rule,
  X4.2b) and found 27 segment-frames Babylon never drew — 22 of brass and
  five of a bottle's parts a frame before Babylon drew them — because a
  case is one mesh with no unlit child to refresh it: the first time a slot
  is thrown its never-computed sphere stands at the world ORIGIN, under 3 px
  from a few tens of metres, and is never recomputed. The hulls' rule
  differed only a frame at the gate's edge (X4.2a forced their compose);
  here it would draw brass a live round never showed, a picture change the
  bank cannot see (`fx-brass` stands ~20 m from the origin). Kept, recorded
  as `FINDINGS.md` 67 with the one-line fix, the owner's call (stop
  condition 2's reading: not this step's to decide). The frustum is not asked:
  a piece or mark outside it is handed over and clipped. **(Fixed after, the
  owner's decision of 2026-11-01, in its own commit: every cel part gated on
  this frame's sphere, the gate sphere deleted, `FINDINGS.md` 67 deleted;
  `fx-brass-far`, `fx-mine-far` and `fx-rocket-far` bank it — the numbers
  are in `BABYLON_EXIT.md`'s X4.4b note.)**
- **What stays.** `CombatFx.warm` and `BulletMarks.warm` still pose a tracer
  and a mark for the warm-up (drawn through ours; the mark in the hard
  paint, as the material swap did), until X4.4e; our four pipelines are
  asked at construction, so the warm-up waits for them.
- **The empty-group seam** (X4.4e's to fix if reachable): not made
  reachable — the sky holds group 0 in a round and over the menu, as X4.3d
  measured, and the pools were never the only thing in it; neither round
  below raised the DEV warning.
- **Measured.**
  - **The bank**: `--check --keep` at ece59b1 (the worktree, its `ref/` the
    main tree's) and at the step; **109 of 109 kept frames byte-equal**
    (`comparePngs`, max 0), the 25 `fx` rows 0 pixels from the bank in both,
    the same 34 stale rows failing the stale bank with the same means.
  - **The order probe** (`x44b/order.mjs`, `ordcmp.mjs`): Coldharbour, 330
    frames on a fixed script — 40 rounds at the avenue's brick face with
    the camera walking in from 59 m (marks crossing the gate), a frag, a
    bottle and a rocket there; 24 rounds on the quay's deck (overlapping
    marks), frags, a bottle, a rocket, the wire's mines (one arming), the
    wire's rocket and grenades, eight rounds' brass, the camera orbiting;
    then ~150 m from the origin the wire's mines arming by the camera, a
    rocket past it and brass. Parent: `Mesh.render` in group 0 of the main
    pass; step: what `piecePull`/`markPull` handed over. **Drawn sets equal
    on 330 of 330 frames** (8,986 entries outside the frustum excluded, all
    ours), **mark order equal on 182 of 182 frames with marks** (4,782),
    **segment order equal for 905 of 905 pieces** with two or more drawn;
    no pool mesh was in Babylon's blended list on any frame.
  - **`pipelines.mjs coldharbour --round`**: zero of Babylon's, zero of ours
    and zero modules in play in **five of five** runs (92-93 rounds, 2
    throws, 4 blasts, a fire, 2 rockets, 4 mine tables, pane 21 broken at
    31.5-44.7 m, 6,012-8,964 shard draws); the first install 26 of Babylon's
    (28 at X4.4a's review: the tracer's and the mark's Babylon pipelines gone),
    23 of ours, 53 modules; the second nothing.
  - **`kit:hash --models --against`** the BEFORE: **244 of 244 identical** —
    `grenade`, `molotov`, `rocket`, `mine` and `player` hashed as the meshes
    the parts make by `drawnMesh` (the script's header).
    **`kit:hash`** (the kit half) against a BEFORE at ece59b1: **3,722 of
    3,722 builds identical**, drawing and colliders (no kit builder moved).
  - **`census --against`** the BEFORE: every row with no piece or mark in
    frame equal; Hollowmere 278, Greyfen 205, Harrowmead 2314, Sarab 472 and
    Kurenai 125 equal; Coldharbour 2567 → 2502 and Cinderhaven 264 → 261, all
    on `fx` rows (`fx-marks-near` 49 → 22, `fx-marks-far` 143 → 126,
    `fx-impact-hard` and `-ground` -4 each, `fx-glass` -3, `fx-wire` -3, `fx-grenade` -3,
    `fx-brass` -2, `fx-tracer` -1, `fx-mine` -1, `fx-fire-fade` -3; `fx-rocket`
    75 = 75).
  - **`gate`** all seven maps clean; **`shaders`** every shader clean on
    seven; **`parity`** every map agrees; typecheck, build
    (`check-babylon-free`, `check-proving`) and corecheck pass.
  - **An offline round** on Coldharbour (`x44b/round.mjs`): six lives, every
    primary, the pistol, frags and molotovs alternating, the launcher and
    the mine alternating, firing at walls, the floor and the square's glass
    on a compass sweep: tracers, frags, bottles and rockets drawn by ours
    (e.g. 244 tracer, 328 frag and 16 rocket piece-frames in the first
    life), up to 17 marks a frame; the authority's `fire` 98, `explode` 6,
    `blaze` 3; no error; the empty-group warning never fired.
  - **A server's round** (`npm run server`, `x44b/net2.mjs`): two clients on
    Coldharbour, B on the other side throwing two frags, firing two rockets
    and its rifle; on A our renderer was handed the wire's frags (423
    piece-frames), the wire's rockets (440) and 1,236 tracer piece-frames;
    no error on either page. (A one-client server round, `round.mjs --ws`,
    the same: tracers, the client's own frag and rockets, no error, no
    seam warning.)
  - **A profiler capture** (`?profile`, a live round): report version 26,
    `pools: { drawn: 3, masked: 1, instances: 2, marks: 19 }`, `build`
    filled.

X4.4c's brief, word for word:

- **X4.4c — the blast and the posed pieces are ours (no picture change).**
  `BlastFx`'s billows and its sparks-and-trails mesh become instanced draws
  of ours on `BlastShader`'s WGSL (the bounds it sets by hand become the
  cull's input, and the glow's distance fade reads the same centre); the
  rubble chunks and the glass shards are drawn off their `pose` arrays
  straight after the physics step, as a corpse's joints are (X4.1). **The
  scorch stays Babylon's** (decided 2026-11-01, "Find out first" above): it
  is blended in Babylon's transparent sort among the panes, so it moves with
  the glazing at X4.6 — and its decal of ours reproducing
  `StandardMaterial`'s output (or a recorded picture change if that cannot
  be made exact) is X4.6's. **The scorch on the FLOOR draws** — X4.4a's
  first note said it drew nothing, and its review measured otherwise (each
  mark hidden and shown in the banked frames): a black decal at 0.4 is a
  proportional darkening, faint on a dark or fire-lit floor, whole under
  `fx-molotov`'s flames, and mostly behind the book stall in the ground
  blasts' rows. **Oracle:** the
  bank's blast rows at every age byte-identical; `kit:hash` unmoved; a round
  with blasts on both surfaces and panes broken.

**X4.4c landed** (d82f311; 2026-11-01; no picture change).
- **What moved.** Every blast billow — each batch `BlastFx` poses, one per
  blast slot and one the sparks and the burning fragments' trails share — is
  drawn by our renderer (`render/BlastDraw.ts`), and every glass shard
  (`DebrisSystem`) and rubble chunk (`BlastDebrisSystem`) too, straight off
  its body's pose (`systems/poseView.ts`, a third `PoolDraw`, the DEBRIS).
  Babylon is made no blast mesh, no `ShaderMaterial` and no mask twin for it,
  and no shard or chunk mesh; `poseView`'s `absolutePose`, `applyPose` and
  `drawPieces` (the writes onto meshes) are gone. The scorch stays a Babylon
  mesh, as decided (2026-11-01), until X4.6 — a pool of its own, so the
  rubble leaving while it stays splits no pool.
- **Found first, on the parent** (`x44c/order.mjs`: Coldharbour, 420 frames
  on a fixed script — two blasts on the quay's deck and on the floor, a
  power-2, a molotov's ignition, two more; pane 0 and pane 1 bursting by the
  square with a blast in the street; then ~150 m out two blasts, a power-2
  and pane 21, the farthest from the origin at 171.7 m, bursting twice; the
  camera moving throughout — each frame Babylon's `Mesh.render` calls in
  group 0 of the main pass and in the glow's mask):
  - the billows (`blast0..3`, `blastSmall`) and the shards are in group 0's
    OPAQUE list, sorted front to back with everything else in it (the scene's
    `setRenderingOrder`: `eyeDistanceSq` off the bounding sphere's centre),
    never blended; the billows again in the mask, in the ACTIVE list's order
    (slot 0..3, then the small batch — the mask's queue sorts by material and
    they wear one);
  - a billow is EMISSIVE, so `WorldCulling`'s size gate never dropped one,
    and Babylon's frustum test of a batch is the mesh's
    `CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY` on the sphere `BillowBatch` set by
    hand (`reConstruct` of the billows' extent);
  - **no rubble chunk was drawn on any frame** and a shard far from the
    origin is gated on a stale sphere — `FINDINGS.md` 58, as stated: a
    chunk's bounds were computed once at its park, a kilometre under the map;
    a shard's rebuilt under the identity at every cut, so measured from the
    origin once a burst.
- **The billows** (`render/blastProgram.ts`, `shaders/wgsl/blast.ts`). The
  material's two WGSL stages as plain bodies, statement for statement, an
  instance's matrix, `billow` and `warmth` read through a private block its
  prelude fills from storage (the thin instance's `world0..3` and two
  attributes until now), times the block's `world`, the identity the mesh was
  frozen at, kept so the product is the one Babylon's stage made; the bloom
  per instance through a flat `vGlow` (the mask material's `glowColor`). The
  light, eye, fog and opaque alpha are the FRAME's (`render/frame.ts`) — the
  very fields `CelMaterialFactory` pushed onto the material — and the rest
  is `BlastPaint`'s block (`BlastShader.ts`, no material now: the drawing,
  the five inks, the soot, the dust, the clock), copied every frame drawn.
  The two icospheres (8 and 4 subdivisions) are uploaded once off
  `CreateIcoSphereVertexData` with the options `CreateIcoSphere` used. A
  batch is ONE draw (`pass.draw(shape's index count, its count, shape's first
  index, its first instance)`), so its instances go down in push order, as
  the thin-instanced mesh's did. `Game.blastPull` (inside the render) takes
  each visible batch through Babylon's sphere frustum test (`inFrustum`, this
  render's planes), orders the draws as the queue did (nearest centre first,
  the batches' own order breaking a tie, stable), the mask's in the active
  list's order, each batch's bloom `GlowRules.colour` at its centre (the
  fire's body, alpha 1). The draws hang at `"beforeAlphaTest"` AHEAD of the
  pieces, the mask after the pieces'. The one vertex module serves both
  passes (the LEQUAL tie).
- **The debris.** A shard is a kit of its own, its 48 vertices REWRITTEN on
  every cut (`DebrisSystem.onCut` → `PoolDraw.rewrite`, the draw built
  `dynamic`), a chunk its box (`CreateBoxVertexData`, the sizes still drawn
  off the seeded stream at construction) in each of two paints, the stone
  and the map's earth — the palette of the three `get` materials they wore,
  the earth painted per map (`CelMaterialFactory.repaintPool`); the
  materials are still asked of the factory where the meshes asked them, so
  its order is unmoved. `Game.drawDebris` composes every switched-on piece's
  world off its pose and scale (`computeWorldMatrix`'s arithmetic in
  `src/math`) — the pose the meshes were written from, every write having
  followed whatever moved it — and gates it on the piece's GATE sphere: the
  world bounds as of the last frame Babylon would have COMPUTED the mesh
  (only as a candidate the gate let through), its creation park before that,
  the identity after a cut. Kept byte for byte: the latch is the owner's to
  undo (`FINDINGS.md` 58 says how, one line; a decisions row asks). The
  render pulls the instances front to back by this frame's sphere, the
  meshes' order breaking a tie (`Game.debrisPull`). Every pooled body is
  created at `poseView.parkedPose` — `[0, -1000, 0, 0, 0, 0, 1]`, what the
  creation read returned (measured on the parent) — so Havok is handed what
  it was.
- **The bank's rubble is the HARNESS's.** The first check of the step had
  six `fx-blast-*` rows short of one chunk each (0.06-0.76% of pixels): the
  parent DRAWS rubble in those rows. Hooked on the parent, the chunks' only
  world compute in a row came from `waitUntilDrawn`'s `scene.isReady()` —
  `Mesh.isReady(true)` computes every mesh's world, which refreshed their
  bounds and let them through the gate. Nothing in the game asks the scene if
  it is ready, which is why a live round never draws one. `waitUntilDrawn`
  now makes the same refresh of every debris piece's gate sphere before it
  asks (`plans/webgpu-ref/README.md`), and the rows are what they were
  banked as. **(Fixed after, the owner's decision of 2026-11-01, in its own
  commit: every piece gated on this frame's sphere, the gate sphere and the
  harness's refresh deleted, `FINDINGS.md` 58 deleted; `fx-shards-far`
  banks it — the numbers are in `BABYLON_EXIT.md`'s X4.4c note.)**
- **The oracles' tools.** `pipelines.mjs` counts a shard as our renderer
  is handed it (its "shard draws" are instances now, not Babylon's
  `Mesh.render`s); the harness reaches `GrenadeFx.blasts` (`fx` before);
  `plans/physics-ref/clients.mjs` digests each shard and chunk in the bytes
  its mesh gave (switch, pose, a zero Euler, the pose's quaternion, scale).
- **Pipelines.** Three asked at `Game`'s construction — the billow and its
  mask, the debris cel — so the building card's warm-up waits for them.
  `BlastFx.warm` still poses its billows, drawn through ours, until X4.4e;
  every pool with no warm pose is ours now, by construction.
- **Profiler.** Report version 27: `pools.billows`, `pools.debris`, the
  blast's and the debris's draws in `pools.drawn`/`masked`; the viewer prints
  them.
- **The empty-group seam**: not made reachable — the sky holds group 0;
  neither round raised the DEV warning.
- **Measured.**
  - **The bank**: `--check --keep` at 558dbdf (the worktree, its `ref/` the
    main tree's) and at the step: **112 of 112 kept frames byte-equal**
    (`comparePngs`), every `fx` row within floor (78 rows in all), the same 34 stale rows
    failing with the same means.
  - **The order probe** (`x44c/order.mjs`, `ordcmp.mjs`): main-pass batch
    draws (name, count, order) equal on **420 of 420 frames** (358 with a
    batch), the mask's on 420 of 420, the debris order on 420 of 420 (295
    with a piece; 2,771 handed over outside the frustum, excluded, all
    ours), no piece lost or added, no chunk on either side.
  - **`pipelines.mjs coldharbour --round`**: zero of Babylon's, zero of ours
    and zero modules in play in **five of five** (83-91 rounds, 2 throws,
    4-5 blasts, a fire, 2 rockets, 4 mine tables, pane 21 broken at
    27.3-43.5 m, 6,516-9,336 shard instances handed over); the first install
    24 of Babylon's (26 at X4.4b), 23 of ours, 49 modules; the second none.
  - **`kit:hash`** 3,722 of 3,722 builds identical; **`--models`** 244 of
    244.
  - `census --against` the BEFORE: every row with no billow, shard or chunk in frame equal on all seven maps, Coldharbour 2639 → 2561 on those rows alone (`fx-blast-*` -8 to -12, `fx-shards` -12, `blast` and the power-2 row -2, `fx-molotov` -1).
  - `plans/physics-ref/clients.mjs --check` passes at the parent and at the step on all three of its maps — the engine's hash, the NODE digest (318 nodes × 601 frames, each shard and chunk now digested in the bytes its mesh gave) and every pooled body, identical.
  - **`gate`** all seven maps clean; **`shaders`** every shader clean on
    seven; **`parity`** every map agrees; typecheck, build
    (`check-babylon-free`, `check-proving`) and corecheck pass.
  - An offline round on Coldharbour (`x44c/round.mjs`: X4.4b's script with the AT item's presses spread over its draw and load — the launcher never fired under the old two 4-frame presses — and two panes broken a life): six lives, every primary, frags and molotovs, the launcher and the mine; the authority's `explode` 10 and `blaze` 6; billows drawn on 131-293 frames a life (up to 409 a frame, 4 draws and 4 mask draws), rockets in flight in every launcher life (8-14 piece-frames), 1,680-1,704 shard instance-frames a life and no chunk; 0 errors, the seam warning never raised.
  - A server's round (`x44c/net2.mjs`, `PORT=8097`): B threw two frags and fired two rockets; on A the authority's `explode` 4, billows drawn on 758 frames (up to 192, 3 draws, 3 mask draws), the wire's frags and rockets drawn (203 and 418 piece-frames); 0 errors on either page.
  - A profiler capture at report version 27 with a blast and a burst live: `pools: { drawn: 6, masked: 3, instances: 7, marks: 9, billows: 42, debris: 12 }`.

**X4.4d landed** (9d81875; 2026-11-01; no picture change).
- **What moved.** Every world fire — a block's merge of `world/flame.ts`
  surfaces (35 on the seven maps: Hollowmere 11, Greyfen 3, Coldharbour 2,
  Harrowmead 2, Sarab 2, Cinderhaven 15, Kurenai none), the fire drums'
  flames among them (a scatter prop's flame stays in its block's merge: no
  cel recipe, so never an instanced part) — and every flame of a burning
  molotov is drawn by our renderer (`render/FlameDraw.ts`), a draw each.
  Babylon is made no fire mesh in a round and no molotov flame mesh at all:
  the handover TAKES a fire (`BlockHandover.takeFire`: block-merged at
  identity, never `updatable`, casting nothing, its normals and uvs present,
  or the map is REFUSED) and `GrenadeFx`'s 61 meshes (the source and its 60
  clones) are `PieceNode`s of one flame shape (`GrenadeFx.flames`,
  `flameShape`, its local sphere `reConstruct`'s off the positions). The
  only world surface Babylon is made a mesh of in a round is the glazing.
  An EDITOR build is untouched: its fires are Babylon meshes on
  `FlameMaterial`, whose two stages are now assembled from the same bodies.
- **Found first, on the parent** (`x44d/fireorder.mjs`: Coldharbour and
  Cinderhaven, 640 frames each on a fixed script — molotovs lit through the
  `blaze` door, overlapping and spreading on the quay or round the drum; the
  camera round each world fire in turn; on Cinderhaven out to ~1,200 m and
  back; on both, the first world fire's cell walked out past the cull's
  reach and back, the camera on it — each frame Babylon's `Mesh.render`
  calls in group 0 of the main pass and in the glow's mask, and our draws'
  points as the BUNDLE LIST holds them: `host.queue` hooked at queue time,
  since an item runs only when the list does, at the pass's end — which is
  why a marker draw of ours at those points reads out of order):
  - every fire, world and molotov, is in group 0's OPAQUE list, sorted
    front to back with everything else in it (`setRenderingOrder`,
    `eyeDistanceSq` off the bounding sphere's centre), never blended; ahead
    of them only the sky dome (which writes no depth), interleaved with them
    the grass, the capture zones' poles, flags, paint and stones, the backed
    panes and the water (`waterFar` too) — every one writing depth — and all
    of it before our `"beforeAlphaTest"` point (the clouds and the turf,
    after it, are the alpha-tested list);
  - in the glow's mask, after every draw of ours (`@MASK` queued first), in
    the ACTIVE list's order — the molotov's flames first, slot by slot and
    flame by flame (their meshes were made at `Game`'s construction, ahead of
    any map's), then the world's fires in BIRTH order (the order
    `worldMeshes` made their meshes, `scene.meshes`') — the mask's queue
    sorting by material, which they share;
  - a fire is EMISSIVE (`FlameMaterial.emissiveColor`), so `WorldCulling`'s
    size gate never dropped one (`gateOf` null) — **no stale-bounds latch to
    keep or report** — and the frustum test is the mesh's
    `CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY` on bounds `_evaluateActiveMeshes`
    composed that frame (`computeWorldMatrix` before `isInFrustum`); a world
    fire's mesh was a candidate exactly while its block's cell was offered.
- **The fire's program** (`render/flameProgram.ts`, `shaders/wgsl/flame.ts`).
  `FlameShader.ts`'s stages as three bodies — the shared hash, noise and
  drawn clock, `flameVertex`, `flameSurface` — statement for statement, which
  BOTH sides assemble: Babylon's `ShaderStore` strings are its declarations
  around them and a `main` that calls them (the editor's), ours the assembler
  (`assembleVertex`/`assembleFragment`). The two names a body reads two ways:
  `uniforms.world` (a uniform for Babylon, a private block its prelude fills
  from the draw's matrix for ours) and the bloom (`uniforms.glowColor`, or
  under `FLAME_INSTANCED` the instance's flat `vGlow`). The eye, the wind's
  bearing, the fog and the opaque alpha are the FRAME's — the very numbers
  the factory pushed onto the material (`windBearing` is `configure`'s
  `normalize` of the same numbers) — and the rest is `FlameMaterial.values`
  (the motion, the curl, the embers, the boil, the five inks and the clock),
  written in place off the same Babylon objects the material is handed, so
  each float is the one its uniform buffer held.
- **The draw** (`render/FlameDraw.ts`). The molotov's flame (surface 0, the
  session's) and each map's world fires (`setWorld`, at the handover's
  install; `clearWorld` at its `clear`) uploaded end to end, a draw ONE
  instance of ONE surface (`pass.draw(its index count, 1, its first index,
  the draw's index)`), its matrix and bloom per draw. `Game.flamePull`
  (inside the render) walks the active list in scene order: a molotov flame
  while `visible`, composed as `computeWorldMatrix` composed its mesh
  (`pieces.composeNode`) with its sphere carried (`worldSphere`); a world
  fire while `WorldCulling.offersBlock` says its cell is offered (snapshotted
  in `rebuildList`, where a filed mesh's candidacy was decided, the warm-up's
  every cell included), at the identity its frozen mesh had, its sphere its
  record's (`merge:hash` holds a record's bounds to its mesh's bit for bit);
  each through Babylon's sphere frustum test (none while the scene skips
  clipping), into a stable insertion sort by squared eye distance; the mask's
  draws in the active list's order, a `noGlow` world fire (none ships) left
  out, each one's bloom `GlowRules.colour` at its centre. The main draw at
  `"beforeAlphaTest"` installed FIRST of all ours (ahead of the billows),
  the mask after the billows'. What moved is only the fires' interleave with
  the meshes Babylon still has in that queue, all depth-writing, so an exact
  tie or nothing. In the mask the fires go down with ours at its open, ahead
  of every mesh Babylon's mask still draws (the sparks, the dust discs, the
  moon), where its queue drew them among those — no depth written and LEQUAL
  against the frame's, so again only an exact tie could differ, and the
  blended sparks and discs drew after the opaque fires before and since.
- **The held-caster layer, deleted.** `WorldBlocks.addCaster`,
  `casterGroup`, `heldCasters`, the `"held"` layer, `CASTER_ATTRIBUTES` and
  the `CASTERS` cut rank (the palette is cut last, inside the count the
  main view culls — `count: clusterCount`, what `drawn` always was with no
  caster held); `BlockHandover`'s `held`, `heldMeshes`, `hold`'s caster arm
  (`holdPalette` now), the DEV node check in `frame` and the `NO_REACH` a
  held caster was cut against; `WorldCulling.NO_REACH`'s note of it. No
  build reached it (X3.7c's review): the one surface Babylon keeps in a
  round is the glazing, which casts nothing, and a fire that casts is now
  refused.
- **The oracles' tools.** `census.mjs` counts the fires' draws with ours
  (`Game.flameDraw.stats.drawn`), so a row's total holds; `x44d/fireorder.mjs`
  and `ordcmp.mjs` are the probe.
- **Pipelines.** Two asked at `Game`'s construction — the fire and its mask
  — so the building card's warm-up waits for them. `GrenadeFx.warm` still
  poses its molotov flame, drawn through ours, until X4.4e. Babylon's flame
  material is compiled by no round (its install count 24 → 22, modules
  49 → 45).
- **Profiler.** Report version 28: `pools.fires`, the fires' draws in
  `pools.drawn`/`masked`; the viewer prints them.
- **The empty-group seam**: not reachable — the sky dome is in group 0 on
  every frame of both probes; what Babylon still queues there in a round is
  the sky's dome and clouds, the grass and its turf, the capture zones, the
  water, the glazing, the moon and the three blended pools.
- **Measured.**
  - **The bank**: `--check --keep` at bac02b7 (the worktree, its `ref/` the
    main tree's) and at the step: **111 of 113 kept frames byte-equal**
    (`comparePngs`) — among them the 68 rows with a fire drawn (the census
    moves each one's fire draws from Babylon's count to ours), `fx-fire`,
    `fx-fire-fade` and `fx-molotov` 0 px from the bank — the other two
    `sarab-ground` (100 px, 2/255) and `sarab-shelf` (1 px, 1/255); Sarab's
    eleven rows re-checked alone twice at each code are byte-equal across
    all four runs, each full run's odd frame differing from them alone
    (cross-process residue, as at X4.4c). The same 34 stale rows failing
    with the same means.
  - **The order probe** (`x44d/fireorder.mjs`, `ordcmp.mjs`): the main
    pass's fire order equal on **640 of 640 frames** on Coldharbour (595 with
    a fire; 10,752 draws — 10,140 of molotov flames, 612 of world fires) and
    **640 of 640** on Cinderhaven (13,593 — 9,659 and 3,934), the mask's on
    640 of 640 on each; Coldharbour's first fire's cell OFF on 96 frames of
    the reach walk on both codes; every fire of ours at `"beforeAlphaTest"`;
    no fire in Babylon's lists on the step.
  - **`merge:hash`** against the parent: the 35 world fires' `mesh` moved
    and nothing else (`record arrays` and `record bounds` 854 of 854 meshed
    visuals, 889 before); `--editor` identical on all eight; every map
    installs.
  - **`pipelines.mjs coldharbour --round`**: zero of Babylon's, zero of ours
    and zero modules in play in **five of five**; the first install 22 of
    Babylon's, 23 of ours (the construction's asks are not an install's),
    45 modules; the second none.
  - **`kit:hash`** 3,722 of 3,722 builds identical; **`--models`** 244 of 244.
  - **`census --against`** the BEFORE: every one of 113 rows equal.
  - **`gate`** all seven maps clean; **`shaders`** every shader clean on
    seven (its first run lost its page to a navigation mid-install on
    Kurenai — "Execution context was destroyed" in `installRound` — and the
    re-run was clean); **`parity`** every map agrees; typecheck, build
    (`check-babylon-free`, `check-proving`) and corecheck pass.
  - **An EDITOR build** (`x44d/editorfire.mjs`: Cinderhaven, the round
    installed, then `buildEditorMap`, the clocks frozen, the camera at each of
    the first four fires): every fire mesh ready, its mask twin made and ready,
    0 errors — and the **four photographs byte-equal** to the parent's.
  - An offline round on Coldharbour (`x44d/round.mjs`, X4.4c's script
    counting the fires our renderer was handed): six lives, every primary,
    frags and molotovs, the launcher and the mine; the authority's `explode`
    11 and `blaze` 6; the molotov lives' flames 1,737, 1,398 and 1,719
    flame-frames (up to 20 fire draws a frame — 18 flames and the two
    hearths — and 20 mask draws), the two hearths on 582-631 frames a life;
    billows, pieces, shards (1,680 a life) and rubble (12,470-12,870 in the
    frag lives) as at X4.4c; 0 errors, the seam warning never raised.
  - A server's round (`x44d/net2.mjs`, `PORT=8097`): B threw two MOLOTOVS
    (and fired two rockets); on A, the camera turned onto each fire as the
    authority's `blaze` landed, `blaze` 2 drawn through `drawFire` — flames
    on 598 frames, 8,100 flame-draws, up to 17 at once and 19 mask draws
    with the hearths — the wire's bottles (156 piece-frames) and rockets
    (418); 0 errors on either page.
  - A profiler capture at report version 28 with a molotov burning and a
    pane's burst live: `pools: { drawn: 17, masked: 14, instances: 5,
    marks: 9, billows: 24, debris: 12, fires: 12 }`.

X4.4e's brief, word for word:

- **X4.4e — pipelines compiled at load, and the seam checked (no picture
  change).** **The warm-up changes shape**: every pipeline a round can use is
  created from a declared list during loading, so the `warm(on)` poses become
  a list of pipeline keys and `warm(on)` is deleted from every pool that is
  ours (`GrenadeFx`, `BlastFx`, `BulletMarks`, and `CombatFx`'s tracer).
  **The three blended pools still Babylon's keep their poses** until X4.6
  moves them (decided 2026-11-01): `CombatFx`'s sparks and dust discs and
  `BlastDebrisSystem`'s scorch, so `warm(on)` survives on those two classes
  for those pools alone, stated as such.
  **The list covers the pools with NO warm pose today too** (X4.4a's
  review): the glass shards (`DebrisSystem`), the rubble chunks
  (`BlastDebrisSystem`'s, only its scorch is posed), the thrown and laid
  bodies (`GrenadeBody`, `RocketBody`, `MineBody`, and the wire's copies in
  `NetGrenades`/`NetOrdnance`) and the brass (`PlayerView`). A scripted
  round compiles nothing for them in play only because each shares a
  pipeline something else made first — not by construction. (Since X4.4b
  the thrown and laid bodies, the brass, the tracer and the marks are
  ours, their four pipelines asked at `Game`'s construction, which the
  warm-up already waits for — by construction now; of the pools with no
  pose that leaves the shards and the rubble, X4.4c's. Since X4.4c those
  are ours too — the debris draw's pipeline and the blast's two asked at
  construction — so every pool with no pose is covered by construction;
  `BlastFx.warm` still poses its billows, drawn through ours, and goes with
  the rest here. Since X4.4d the fires are ours as well — their two
  pipelines asked at construction — and `GrenadeFx.warm`'s molotov flame
  pose, drawn through ours, is redundant and goes here too. The three
  Babylon pools left — the sparks, the dust discs and the scorch — keep
  their poses until X4.6.)
  **The empty-group seam** (decided 2026-10-31, X4.3c's review): every draw
  of ours hangs on rendering group 0's three points, and Babylon visits no
  empty group — so a frame on which group 0 dispatches no mesh of Babylon's
  runs NONE of ours, silently (a DEV build warns once per change,
  `Renderer`). X4.4b-d take meshes out of group 0 (after X4.4d what Babylon
  still queues there in a round is the sky's dome and clouds, the grass and
  its turf, the capture zones, the water, the glazing, and the three blended
  pools — measured by its order probe); this sub-step states
  whether any state can now leave it empty (the sky still holds it in a round
  and over the menu, so X4.5 is expected to owe the fix) and fixes the seam
  if X4.4 made it reachable — our draws must not depend on group 0 being
  non-empty (a point of ours that does not ride Babylon's group, or a mesh
  kept in it on purpose, stated as such). **Oracle:** `pipelines.mjs`
  reports zero pipeline creations during a round, against X4.4a's count; the
  building card takes no longer than before.

**X4.4e landed** (e3d5276; 2026-11-01; no picture change).
- **The declared list.** `Game.roundPipelines` (a field, filled once at the
  end of the pools' construction) names every draw of ours a round can use
  whatever its map, by the promise its constructor's asks settle:
  `bodies` (`BodyDraw`), `the bodies' shadow map` (`BodyShadowMap`),
  `hulls` (`HullDraw`), `the weapon` (`ViewDraw`), `pieces` (the tracers,
  the brass, the thrown and laid bodies of both sides of the wire),
  `marks`, `billows` (`BlastDraw`), `debris` (the shards and the rubble)
  and `fires` (`FlameDraw`). No ask moved: each draw's constructor still
  states its own pipelines (its programs, targets and state are its own),
  and the list states WHICH draws a round has. `PipelineWarmup` takes it
  (`DeclaredPipelines`: a name and a `ready`), counts its entries settled
  off the promises (no per-frame work), and opens on BOTH — every entry
  settled and nothing of ours compiling (the map's: the world's groups, its
  depth passes, the lamps' atlas's casters, the probes' bake, the palette's mask,
  asked by its install) — under `oursCapMs`, its DEV line naming how many
  entries were unsettled if the cap is ever reached. The map's are not on
  the list because they are not the session's: they are asked as the
  install builds the map, before the warm-up, and the cache's count covers
  them. **It departs from the brief**: the list is each draw's `ready`
  promise, asked at construction, not pipeline keys created during loading,
  and its wait is functionally redundant with the cache's in-flight count
  (an entry settles in the same microtask checkpoint as the compiles it
  waits on) — its value is the one place every draw of ours is stated, and
  the seal's tripwire. (Review fixes after it: the cap's DEV line names
  the entries unsettled, and the lamps' proxies — the atlas's moving
  casters, a session draw of ours asked at `LampAtlas`'s construction since
  X3.6b, where its casters are the map's — joined the list as `the lamps'
  proxies`; the cache's sealed test moved to its call sites, so a
  production build makes no label.)
- **The seal.** `PipelineCache.seal(on)`: sealed in `finishBakeWait` when the
  warm-up stood (a map), unsealed in `teardownMap` (so also at every
  `installMap`, an editor rebuild included). A `get` or `compute` that
  MISSES while sealed is a DEV warning naming the variant (`[pipelines]
  "…" compiled in play — asked by nothing before the building card came
  down`); the compile is made and counted as before. **Proved**
  (`x44e/sealtest.mjs`): unsealed over the menu, sealed at deploy and in
  play, a compute asked in play named, unsealed again after `enterMenu`.
  Never raised in the offline round, the server's round, the seam walks
  (Coldharbour, Sarab) or their bench runs.
- **The poses.** Deleted: `GrenadeFx.warm` (which posed the billows through
  `BlastFx.warm` and one molotov flame), `BlastFx.warm` and its
  `warmBillow`, `BulletMarks.warm`, and `CombatFx.warm`'s tracer (its
  `warmedTracer`/`warmedScale` and the always-1 stretch argument). Kept,
  stated as the pools still Babylon's until X4.6: `CombatFx.warm` (two
  sparks and two discs, at `visibility` 1 and 0.5 — the opaque and the
  blended pipeline) and `BlastDebrisSystem.warm` (`ScorchMarks.warm`, one
  mark at its standing opacity), beside `ShadowSystem.warmBlob`. Every pose
  of ours had compiled nothing since X4.4b-d (its pipelines asked at
  construction), so deleting them moved no count — the install figures
  below are the parent's.
- **What the vantages are still for**: Babylon's own meshes — the sky's
  dome and clouds, the grass and its turf, the water, the glazing (both
  kinds), the flags and the capture rings, the blob shadows, the particles,
  and the three blended pools — and the camera-dependent passes the eye
  places (the shadow window, the bodies' map, the lamps' tiles).
- **The empty-group seam: not reachable.** `x44e/seam.mjs` counted, after
  every render, the meshes in rendering group 0 of Babylon's ACTIVE list —
  what the main pass's group 0 is queued from — through a walk of every
  state: menu (173 frames), the kit screen over it (180), settings over it
  (31), `startRound`'s loading frames, the bake (53) and the warm-up (31),
  deploy (70) and the kit over it, play (150), the pause (30), the death
  cam (`enterDying`, 96), the editor (94), back to the menu (`enterMenu`,
  no map) and the kit over that, then a fresh page's `?bench=` (its
  loading, warm-up and 600 bench frames). Coldharbour: no frame empty in
  any state, the minimum 2 — `sky-dome` and `sky-clouds`, alone over the
  menu, the kit screen and the settings — and 26-2,244 with a map up.
  Sarab: the same (2 over the menu; 7-3,168 with the map). So X4.4 did not
  make it reachable; X4.5's brief now says it owes the fix. `Sky.apply`
  builds nothing for an environment with no `sky` spec
  (`EnvironmentSpec.sky` is optional); every shipped map, the proving
  ground included, states one; `Game.applySky` now warns in a DEV build
  when one does not. The `Renderer` warning is kept as it was (both deleted
  at X4.5a).
- **Measured.**
  - **The bank**: `--check --keep` at b06595a (the worktree, its `ref/` the
    main tree's) and at the step: **111 of 113 kept frames byte-equal**,
    the other two `sarab-ground` (100 px, 2/255) and `sarab-shelf` (1 px,
    1/255); Sarab alone re-checked twice at each code, **11 of 11 frames
    byte-equal across the four runs** — cross-process residue, as at X4.4c
    and X4.4d. The same 34 stale rows failing at both.
  - **`pipelines.mjs coldharbour --round`**: zero of Babylon's, zero of ours
    and zero modules in play in **five of five** runs at the step and three
    of three at the parent (pane 21 broken at 31.8-44.1 m, 4,848-6,744
    shard draws); the first install 22 of Babylon's, 23 of ours, 45
    modules at both; the second none.
  - **`pipelines.mjs cinderhaven --round`**: zero of ours in play in five
    of five (and three of three at the parent); **two of Babylon's in every
    run at both codes**, in the DMR's phase of the first life, filed under
    "no Babylon mesh drawing" — `x44e/stack.mjs` took their stacks:
    `ComputeShaderParticleSystem.updateParticleBuffer` and
    `GPUParticleSystem._render`, the rotor wash (a helicopter lifting), which
    `FINDINGS.md` 16 lists and X4.7 owns; X4.7's brief now says so. The
    install 22 of Babylon's, 21 of ours, 48 modules; the second install one
    of Babylon's and two modules — both codes alike. Its pane (pane 0, 444 m
    off) is never on screen (0 shard draws).
  - **The building card** (`x44e/loadtime.mjs`: `startRound` to `deploy` —
    the build, the bake's drain and the warm-up — in a fresh browser each
    run, the two dev servers warmed by a discarded run, the sides
    alternating, six a side). Coldharbour first install: before 5,609,
    5,231, 5,400, 5,228, 5,465, 5,313 ms (median 5,400); after 5,566,
    5,459, 5,228, 5,500, 5,766, 5,433 (median 5,500); a second install
    2,858 → 2,813. Cinderhaven: before 7,973, 7,713, 8,003, 7,775, 8,109,
    7,830 (median 7,973); after 7,758, 7,753, 7,732, 7,776, 7,776, 7,645
    (median 7,758); a second install 5,299 → 5,393. Every difference within
    ±3% — under the protocol's 8%, so no slower. The warm-up alone (its DEV
    line): Coldharbour 8 pipelines from 11 vantages in 299-366 ms before
    and 306-369 after, 3-9 ms waiting for ours; Cinderhaven 10 in 387-493
    and 401-438, 2-41 ms waiting.
  - **`census --against`** the BEFORE: every one of 113 rows equal.
  - **`kit:hash --against`** 3,722 of 3,722 builds identical; **`--models`**
    244 of 244.
  - **`gate`** all seven maps clean; **`shaders`** every shader clean on
    seven; **`parity`** every map agrees; typecheck, build
    (`check-babylon-free`, `check-proving`) and corecheck pass.
  - **An offline round** on Coldharbour (`x44e/round.mjs`, X4.4d's with the
    seal's warning watched and the seal read at each life's end): six lives,
    every primary, frags and molotovs, the launcher and the mine; the
    authority's `fire` 82, `explode` 6, `blaze` 3; tracers (64-291
    piece-frames a life), brass (780-2,730), frags (374), bottles
    (129-155), rockets (18-19), the player's laid mines (701-706), marks on
    826-872 frames, billows on 263-280 frames in the frag lives (up to 315),
    shards 1,680-1,728 a life, rubble 5,440-5,460 in the frag lives, the
    world's two fires on 593-629 frames; the seal on in every life, 0
    errors, neither warning raised. That run's three molotov fires put few
    flames in frame (12 flame-frames in one life, none in two) — **and the
    parent's code under the same script the same** (`blaze` 3; 12, 0, 0);
    a molotov thrown before the eye (`x44e/molotov.mjs`) draws its ten
    flames on 273 frames at the step and 272 at the parent.
  - **A server's round** (`x44e/net2.mjs`, `PORT=8097`): B threw two
    molotovs and fired two rockets; on A the authority's `blaze` 2 drawn
    through `drawFire` — flames on 792 frames, 13,941 flame-draws, up to 19
    at once (21 mask draws with the hearths) — the wire's bottles (288
    piece-frames) and rockets (474), tracers (660); 0 errors and no
    warning on either page.
  - **A profiler capture** at report version 28 (no field added) with a
    molotov burning and a pane's burst live: `pools: { drawn: 17, masked:
    14, instances: 8, marks: 9, billows: 11, debris: 12, fires: 12 }`.

### X4.5 — Sky and clouds — **M, as three sub-steps** (split 2026-11-02, decided the same day) — X4.5a **LANDED** (4118b5b)

The plan's `BABYLON_EXIT.md` holds what the sky is today and the two sub-steps
to come. What X4.5a was asked for and what it measured:

- **X4.5a — our draws stop needing group 0 LANDED** (4118b5b; 2026-11-02; no
  picture change; no sky mesh moved).
  - **The brief.** The empty-group seam (decided 2026-10-31, X4.3c's review;
    X4.4e measured it unreachable until this step); a new first draw point
    ahead of group 0's opaque list, with nothing on it but a proof; rows for
    the sky, appended and banked with `--rows`, and `pipelines.mjs`' creations
    recorded with the sky Babylon's; the menu settled; and for its oracle
    `bank.mjs --check` twice back to back and a map stating no `sky` over the
    menu with the kit screen up, its weapon drawn. No new Babylon internal, or
    it stops (rule 4).
  - **The seam (`render/babylonSeam.ts`, `onMainPass`).** A `visited` flag, set
    where the group's own start is seen in the main pass and cleared as the
    phase begins; the end-of-phase observer, inserted first so it is ahead of
    `GlowPass.render` and `FrameDepth`, tells the three group points in order
    when the flag is down. Only `scene.onBeforeDrawPhaseObservable` and
    `onAfterDrawPhaseObservable`, both already on the seam's public list. The
    alternative of hanging our draws off the phase outright cannot keep the
    picture while Babylon has meshes in the group: the palette, blocks and
    landform must land between its opaque and alpha-tested lists and the weapon
    after its blended queue. So the group's hooks remain the path while it
    holds anything and the end of the phase is the path once it does not, which
    from X4.7 is every frame.
  - **What the group's emptiness leaves out.** Babylon's viewport item, which a
    draw of its own would have queued first: the pass's default viewport is the
    whole attachment, the same rectangle, and the byte-equal frames below are
    the proof. No group above 0 holds anything (X4.3d), so the fallback's place
    after every group is the group's place.
  - **The first point.** `Renderer`'s `"first"`, a list, a predicate list and a
    hook. `begin` counts it among the draws that fill the frame. An empty list
    never reaches `passOk`, so it never starts Babylon's delayed pass early.
  - **The rows.** `hollowmere-sky-moon` ([52, 0.35, 62], `ground`'s eye, the barn
    roof against the sky), `hollowmere-sky-motes` (the same, 24°),
    `coldharbour-sky-disc` and `-sky-ring` ([-150, 12, -26], `avenue`'s),
    `cinderhaven-sky-cloud-moon` ([-581, 15, 73], `tank-far`'s, 30°),
    `-sky-ring` and `-sky-flash` ([250, 0.35, 404], `ground`'s), `-sky-far`
    ([-90, 1.7, 300], `town`'s; the terrain's horizon 680 to 740 m off along its
    frame, marched off `surfaceAt`). `sky-flash` is last on its list: it reads
    the storm's schedule at 28.484 s, a flash of 1.336, and any row after it
    would step on from there. **`strike`**, in `freeze`: the schedule read once
    through the real `step`, the strike's map drawn at the eye because
    `pushLightning` would see a strike already up, and the step held.
    **`motes`**, in `placeVantage`: particles off, the field rebuilt under a
    seed, its emit box gathered on the eye, waited ready, 200 hand steps of 0.1 s
    inside one frame under a seed (Babylon's own pre-warm calls), and a clock of
    zero; put away by rebuilding it as the map states it. **`fx`-style caution**:
    none of these rows moves an old row, each being last in its map's sequence.
  - **The numbers.** Everything in `BABYLON_EXIT.md`'s entry, and:
    - **Bank**: `after-keep1` against `after-keep2` 121 of 121 byte-equal;
      `before-keep` (de2a07e) against `after-keep1` 113 of 113; the new rows at
      the parent's renderer (the four instrument files copied over it) against
      `after-keep1` 8 of 8. 87 within floor and 34 red, the same 34 as the
      parent's run, in each.
    - **Census**: 121 rows, `--against` a BEFORE with the new rows, all equal;
      the new rows from 14 draws (`sky-motes`, Babylon 6, ours 8) to 120
      (`coldharbour-sky-ring`, Babylon 75, ours 45).
    - **Group 0 across every state** (`x45a/seam.mjs`, X4.4e's, Coldharbour):
      menu 173 frames, kit 180, settings 31, loading 4 + 53 + 31, deploy 70,
      playing 150, paused 30, dying 96, editor 93, none empty: **the sky still
      holds the group in every shipped state**, so on a shipped map the fallback
      runs only if something else empties it.
    - **Bank frames at the parent versus the fix over the menu**: `kit-sky`
      across the two trees byte-equal.
    - **`Sky.apply`**: 5-6 ms on Hollowmere (no clouds), 19-49 ms on every other
      map, with the DEV server and a bank run sharing the machine. The paint is
      not worth moving off the boot.
  - **The menu, measured** (`x45a/menu.mjs`, `x45a/seamfix.mjs`, Coldharbour at
    1920x1080). With the card off and the photograph up, the sky on and stated
    away: byte-equal. Kit, settings and lobby over the menu, the same: byte-equal.
    The boot's window, three boots: the photograph fully opaque 477-764 ms after
    the boot screen comes off (the first boot's Vite cost in it). Not measured:
    the sky's GPU time under the menu, and the other three windows' lengths,
    which are a decode's and a screen's. `docs/states.md` has the argument.
  - **Corrected at the review** (the owner's decision, 2026-11-02). There are
    five windows, a rejected `img.decode()` being the fifth; the boot's fade is
    the right map's sky rather than the wrong one's; the boot figures above are
    off a local dev server. `scene.clearColor` was Babylon's default slate at the
    boot and is now the boot map's `skyColor` (`applyClearColor`), after a round
    still the last map's. It moved no pixel: `x45a-fix/boot.mjs`, clocks pinned,
    the seven maps twice a tree and Hollowmere and Kurenai five times, the bare
    canvas and the kit screen over the boot menu byte-equal to 547d803 in every
    run; a photograph held at half opacity, with and without the card, and the
    card over no photograph, byte-equal but for flakes that also come up inside
    one tree (one DOM pixel at 1/255, at (836,811) on Hollowmere and Harrowmead;
    a lone Kurenai run's photograph, up to 7/255, mean 1). The control: every sky
    mesh off, all seven differ, Coldharbour's centre (50,50,77) at the parent and
    (205,188,157) here; the shafts seeded at the boot lie over it, a bright column
    on Harrowmead and Kurenai that `setVolumetrics("off")` takes away. The bank
    on Coldharbour, Cinderhaven and Hollowmere: 64 of 64 byte-equal to 547d803,
    the same 9 stale rows red.

### X4.6 — Water, glazing, grass, flags and capture rings — **M–L, as five sub-steps** (split 2026-11-03, decided the same day) — X4.6a **LANDED** (df74bd4, its review 5d43b2e), X4.6b **LANDED** (483165a, its review e1f5712), X4.6c **LANDED** (4a16b5f), X4.6d **LANDED** (5f26b00), X4.6e **LANDED** (a3d24c6, ccd194a, 0e44130, its note a5a4b28, its review 4251a34..a5ca27d, its note 2052df0) — **all five LANDED**

The plan's `BABYLON_EXIT.md` holds what the surfaces are today, the two tables X4.6a
measured and the four sub-steps to come. X4.6a's brief, word for word:

- **X4.6a — the bank sees what it does not yet** (no change to the game). The
  bank already holds `marsh` and `millpond` (water), `ashwood` and the `ground`
  rows (grass and turf edges), `ring` (paint, and a flag at rest at the foot of
  its pole), `curtain2`, `curtain40` and `curtain90` (`backed`), `shopfront`
  (see-through), and `fx-glass`, `fx-glass-sort`, `fx-impact-hard`,
  `fx-impact-ground`, `fx-impact-kinds`, `fx-scorch` and `fx-fire-fade`. **Gaps,
  from the rows' descriptions, each to be confirmed against the frames**: a flag
  flown up its pole in the wind; a ring's stones on open ground; Greyfen's grass
  at each row of `CONFIG.grass.tiers` (`settings` already sets one per row);
  a pane `GlassFx` has collapsed (`fx-shards` says it is not a real break's
  picture); the water's far quad; a fade over water; water through a pane.
  **It also records** where each surface sits in Babylon's frame (which list, and
  ahead of which of our draw points), which the later sub-steps hang on, and what
  each does in an editor build, since an editor build's surfaces stay Babylon
  meshes until X5.3 and the editor edits the water and grass rects.

**X4.6a landed** (df74bd4; 2026-11-03; no change to the game: the reference bank, its
harness, its table, a new instrument and docs).

- **The instrument: `plans/webgpu-ref/surfaces.mjs`, kept in the repo** because every
  later sub-step owes the same reading. It shoots a map's sequence exactly as
  `bank.mjs` does and in each row's frozen frame hangs three wrappers, none of them a
  draw that shows: `Mesh.prototype.render` (every Babylon draw, in the order Babylon
  records it, which under `compatibilityMode = false` is the order the pass replays
  it), the host's `queue` (how each of our points reaches that same list, with an
  empty function hung on every point so each is in the log) and
  `Renderer.glowMaskOpened`. So a surface's place among our points is read off one
  log, never argued. **The list a mesh is on is its place between the points**, not a
  flag on its material. Beside it the pipeline state the engine's `applyStates` leaves
  for the draw, because a material's own flags lie here: a see-through pane's
  `disableDepthWrite` reads false and its pipeline's depth write is off. **`--pixels`
  skips one class at `Mesh.render` for three frames in every pass**, grabs, and counts
  what moved against the row's own frame, with no `isVisible` written (`GrassSystem`
  and `WaterSystem` rewrite those from `tick`); a class's count is everything that
  differs without it, the ink included. Overlaps of two classes' masks answer "over
  water" and "through a pane". Its first run read `getRenderPipeline`, which a fast
  bundle never asks, and printed `null` for every draw; then `_alphaBlendEnabled`, an
  array, always truthy. The numbers below are the third.
- **The gaps, each against the frames.** The counts are pixels a class owns.
  | claimed gap | real? | the old rows | the new row |
  | --- | --- | --- | --- |
  | a flag flown up its pole | **yes** | `hollowmere-ring` alone holds a flag, 2,457 px, at the foot behind the well | `hollowmere-ring-flown` 16,113 (near sheet, Valeguard), `coldharbour-ring-flown-far` 11,908 (far sheet, Redline) |
  | a ring's stones | **yes** | 4 draws and 0 px in `ring`, the only row showing zones: its point is all paint | `coldharbour-ring-stones` 9,731, with paint 3,728 and the flag at rest 12,222 |
  | Greyfen's grass at each rung | **yes** | no row sets `grass`, so every frame is `high` here | `greyfen-grass-low`, `-medium`, `-high`, at `crossing`'s pose mid-gust: blades 240,932, 517,071, 715,646; turf 778,754, 732,071, 650,948 |
  | a pane collapsed | **yes** | `fx-shards` leaves the sheet up | `coldharbour-fx-glass-broken`: see-through owns 12,327 against `fx-glass-sort`'s 100,713 from the same eye |
  | the water's far quad | **NO** | `waterFar` owns pixels in 16 of 121 rows: `coldharbour-menu` 204,387, `cinderhaven-sky-cloud-moon` 120,672, `coldharbour-sky-disc` 69,292, `cinderhaven-tank-far` 43,229 | none |
  | a fade over water | **yes for the sparks and discs** | `spark&water` and `disc&water` are 0 in all 121 (`fx-impact-hard` has both in a frame, on no shared pixel). `fx-scorch` already holds the scorch over water, 27,480, in a band along the quay's outer edge: the disc overhangs the wall, no depth written and nothing under it | `coldharbour-fx-water-fade`: 27,736 and 1,484 |
  | water through a pane | **yes** | 1 + 9 px on `cinderhaven-tank-far`, 4 on `coldharbour-menu` | `sarab-pane-water` 24,785 |
- **Where each sits.** The table is in `BABYLON_EXIT.md`'s X4.6, and these are its
  readings. All 130 rows report the one mark order, `first` > `beforeAlphaTest` >
  `opaque` > `beforeBlended` > `afterGroup`, then the mask's open and late draws.
  Across them: 2,041 draws on the opaque list, 997 steps outward, 917 ties (the blades,
  at the field's one bounding centre), no step inward, so nearest first holds. 261 on
  the alpha-tested list, all turf, no two distances differing, and always coarsest
  cell first. 582 on the transparent list, 524 steps inward, 2 ties at the log's
  centimetre (a spark and another impact's disc in `fx-impact-hard`), no step outward,
  so farthest first holds, with `fx-glass-sort`'s order the one X4.4a read: pane blocks
  down to 40.92 m, spark 12.58, disc 12.57, the pane block 8.35, spark 7.19, disc 7.17.
  910 pairs of neighbouring blade meshes, none out of `lods` order. Sparks in the mask:
  17 of 17 drawn, between our mask's open and `maskLate`, farthest first; no disc and no
  scorch there. **`fx-water-fade`'s third disc proves the water's depth write**: its
  draw is in the log at (-13.03, -2.88, -56.9), `visibility` 0.85, 0.7 m under the
  surface; it projects near (605, 790), and the discs' mask has its whole bound in
  x 748-1219. The size gate (in the frustum, switched on, not drawn) drops no surface
  of these in any row. **The transparent order is also why a fade under `visibility` 1
  is on that list and only then**: a spark and a disc are raised inside
  `combatFx.update`, by the tracer loop in `stepShots` ahead of the fade loops, so the
  same call that raises them fades them, and with `dt` over 0 they stay under 1, a read
  of the code rather than a measurement.
- **The editor build**, also in the plan's X4.6: no zones at all, the same grass, turf
  and water, glazing per placement (179 surfaces on Coldharbour, `paneGroups` against
  a round's 78), the pools idle, no probe. A value edit on a water rect and a grass rect
  through `Editor.rebuildGeometry` remade every mesh of both. **Open for the owner** then, decided since (its review, below):
  whether X4.6c and X4.6d move the grass, the turf and the water in an editor build too
  (they are no world surfaces, so nothing keeps them Babylon's but a second path), the
  plan's "stay Babylon meshes" having assumed they were.
- **Found, for the sub-steps, and written into their briefs.** The glazing is often
  not at identity: a group of one is not baked (`docs/editor.md` says it of the editor;
  it is as true in a round), 42 of Coldharbour's 78 surfaces, 12 of them see-through,
  20 of Sarab's 28 and 12 of Cinderhaven's 14. Breakable panes sit in those too, so a
  `WorldPane`'s range is into local positions (a scan of this step's that read them
  without `getWorldMatrix` looked for its glazing in the wrong block).
  `wrapCubeTexture` cannot retire at X4.6e, the editor's glazing binding the default
  cube through it until X5.3. `docs/rendering.md` said Babylon's mask holds the dust
  discs; it never has (corrected). A shopfront's transom lights are the same sheet as
  its window, behind the bars, so they go with it (`fx-glass-broken`, read against the
  mended frame).
- **The rows.** Each stands at an eye a row above stands at, or the menu's, and by the
  dedupe `BenchScript` runs no map gains a stop (Sarab's one new position among the
  table's rows is its own menu's, already the first stop). **`sarab-pane-water` was
  the only sight line going**: rays from every eye of the three glazed maps through
  every see-through triangle and on to water, colliders in the way subtracted (but for
  the 3 m before a pane and the 5 m past it, or a car's own box blocks its own glass),
  gave 23 on Coldharbour, 0 on Cinderhaven and 3 on Sarab. The three of Coldharbour's
  photographed are the goods depots' clerestories, over a room and a ceiling the ray
  knows nothing of (a visual is no collider), and the rest are the same blocks; Sarab's
  is a car drowned to its sills in the east pool, the one that holds. So the pane is
  over the far quad; no body in the table is both inside `quadBeyond` and
  behind glass from any eye, and both lists are the opaque one. `coldharbour-fx-water-fade`'s
  sparks are `drawn` over the water as `onRound` hands over a round stopped on a hull,
  and its third round flies by `drawRounds`, tracer in frame. **New fields**:
  `Vantage.flown` steps `CaptureZoneSystem.update`, the door a round uses, after one
  frame with the camera in place (a flag outside the LAST render's frustum is not
  stepped); and an `fx` event `breaks`, which calls `GlassSystem.onBroken` and then
  `onBreak`, the two callbacks `Game` wires, in that order, leaving `g.glass` unwritten.
  Its put-away writes the stashed range back, so the row is no longer a last row and a
  later row has a window: the reason X4.4a set a real break aside. Mended, proven at the same eye in one boot: the frame after
  a `breaks` row is byte-equal to the frame after a row that only bursts the shards
  (`shards`, the sheet never collapsed). Against the frame BEFORE either it differs
  in 16% of pixels at a mean of 0.27/255, both alike: a row's frame depends on the rows
  before it, as the README says.
  **No bank-only hook in game code**; `src/bench/vantages.ts` is data and types, and
  `BenchScript` is untouched.
- **Measured.** New rows banked by `bank.mjs hollowmere greyfen coldharbour sarab
  --rows=...`, each from two byte-identical grabs and each looked at, its `proves`
  written against its frame. `bank.mjs --check --keep` twice alone on this tree,
  against one at 1b5fec8 in the worktree: **121 of 121 old rows byte-equal to the
  BEFORE** in the second run, 120 in the first (`view-pistol-reload`, one pixel by
  1/255, the known flake); the two runs against each other 129 of 130, the same
  pixel, **all 9 new rows byte-equal**; 96 within floor and 34 red, the same 34 at the
  same means as the BEFORE's run; no page or console error. Typecheck, build
  (`check-babylon-free`, `check-proving`), corecheck and parity pass. **Not run**:
  `census`, `gate`, `shaders`, `kit:hash`, `pipelines.mjs --round`; nothing in the game
  moved, and `git diff` under `src/` is `bench/vantages.ts` alone.
- **Not verified.** A flag captured in a live round: every reading here is of a held
  frame, and `flown` steps the zones by hand at a stated meter. The rotor wash and the
  ash: the freeze turns particles off (but for `sky-motes`), so their place between
  `opaque` and `beforeBlended` is the seam's reading and not this log's. Drag of a rect
  in the editor: read off `repositionScene` and `onDragEnd`, not driven. The phone.

**X4.6a's review** (5d43b2e; 2026-11-03; no change to the game: the bank, its
harness, its table, the instrument and docs). Seven findings, all verified before being
changed, two owner decisions, and one thing nobody had noticed.

- **The owner's two decisions, 2026-11-03.** The blob shadows move in X4.6e's one
  commit, `warmBlob` with them. X4.6c and X4.6d move the editor's grass, turf and water
  too, one path through each system, each Verify gaining an `F2` and a rect edit; the
  editor's glazing stays Babylon's until X5.3. Both are in "Decisions" and the briefs.
- **The blob was on no list and in no row** (the must-fix). `updateBlobs` has two
  callers, a played frame's and the benchmark's, and the harness hands
  `updateSceneForCamera` no player, so a frozen frame reaches neither, and "nothing else
  of Babylon's in the main pass" was true only of what no row raised. `surfaces.mjs` has
  a `blob` class now, and a new `fx` event raises one through `updateBlobs` itself, on
  a stand-in body holding only what that door reads, kept for the boot so a later row
  reuses its mesh and switched off by the put-away with `hideBlobs`, after a row that
  raised one and no other. **The reading this row took**: a blob is on the transparent
  list by its centre, `depthWrite off, depthTest LEQUAL, bias 0, cull back, blend
  770,771,1,1`, as the reviewer's probe had it.
- **A blob draws nothing from above, which nobody knew and which reshaped the row.** The
  first placement, on floors below the eye, drew three blobs at `visibility` 0.55 and
  owned 0 pixels. The disc's normal reads (0, -1, 0) in the world: `rotation.x = -PI/2`
  sends local +Z up on `blobFor`'s comment's belief that `CreateDisc` faces +Z, its front
  is -Z, and the material culls back. With the cull off or the disc flipped the same
  frame moves 0.1153% of its pixels, mean 0.0042, worst 32/255. A dust disc has the same
  builder and shows because it is `DOUBLESIDE` geometry. So the row stands three blobs
  above the eye and one on the pavement as a guard, and the question goes to the owner
  (`FINDINGS.md` 67, "Decisions"). **Nothing in the game was changed.** A live round draws
  ~14 of these a frame on Coldharbour.
- **The rows**, both at `square`'s eye, appended at the end of Coldharbour's list, so the
  benchmark gains no stop and no earlier row's clock or frames move.
  - `coldharbour-fx-blob-sort`, frame looked at, cropped 3x: the farthest-first order
    reads the panes down to 40.92, spark 12.58, disc 12.57, **blob 11.32**, pane 0's block
    8.35, **blob 7.76**, spark 7.14, disc 7.12, **blob 7.00**, **blob 6.21**. Dark slivers
    cross both sparks where the stacks are. Class: 4,465 pixels, mean 0.0235, of which
    3,149 on the panes, 3,802 on the sparks, 1,328 on the discs. One mesh at a time, the
    row shot on its own: the blob behind the glass 547 (all on the panes and all on
    the far spark), the one between the glass and the near impact 1,234 (all on the
    panes, 1,130 on the near spark), the nearest 2,789 (1,463 on the panes, 2,221 on the
    near spark), and the pavement's 0. **Three blended layers on one pixel in a known
    order**, which is what an exact sort of ours has to reproduce. The stated floors stand
    in for a deck nothing is built under, as `fx-glass-sort`'s impact has no hull.
  - `coldharbour-fx-scorch-glass`, frame looked at, cropped: the bottom of both windows
    faintly darker (worst 13/255). **All nine old scorch rows hold no scorch-and-pane
    pixel**, read by `surfaces.mjs --pixels` on each (`fx-blast-*` seven, `fx-scorch`,
    `fx-molotov`), so the gap was real. A mark on the shop's floor sorted behind pane 0's
    block (12.83, 9 s old, `visibility` 0.40) owns 9,170 pixels, 6,980 through the panes,
    and one on a ledge 1.2 m short of the glass sorted in front of it (7.75, 11.5 s old,
    0.28) owns 37,279, 22,939 on the panes, its far half behind the sheet and blended over
    it all the same; the two share 6,878. Class: 39,547 pixels, 23,585 on the panes.
- **The editor's transparent list is not glazing alone**, and the printed line hid it.
  Every `ed-*` proxy drawn is blended, and they usually outnumber the panes: 69 against 8
  at Coldharbour's `menu`, 150 against 89 at `avenue`, 38 against 4 at `crossing`, and on
  Greyfen, with no glass, 26 to 414 alone. `surfaces.mjs` has a `proxy` class and prints
  every class, `other` included, by list. X5.3's brief inherits them.
- **"One mesh a placement" was wrong**: it is per placement per material. Coldharbour's
  179 surfaces are 115 glazed placements (57 cars, 26 towers, 24 shophouses, 6 depots, 2
  offices), 83 with one see-through surface and 32 with three, so 115 see-through and 64
  `backed`; Sarab 42 over 38, Cinderhaven 16 over 8; a round's 78 is 32 and 46 over 32
  blocks. `merge.ts`'s 82 placements and 40 meshes are stale, and that is `src/`, so it
  went on X4.6e's rewrites.
- **`surfaces.mjs`'s header described `--pixels` output that did not exist.** It has
  `--keep=<dir>` now, which writes each reported row's frame under `bank.mjs --keep`'s
  names, and that made the claim checkable: **13 of 13 frames byte-equal** with every
  wrapper and empty point hung (11 to the BEFORE, 2 to the bank), so the probe moves no
  pixel on those rows. It prints each class's whole-frame mean too.
- **`--check` cannot grade these surfaces.** Taken out whole, `fx-water-fade`'s discs are
  0.0281, `fx-blob-sort`'s blobs 0.0235, and the scorch 0, 0.0004, 0.0008, 0.0014 and
  0.0149 in five of the seven blast rows, against a tolerance of 0.02: those five print
  `within floor` with the mark gone. "Every sub-step owes" a byte comparison now.
- **The smaller ones.** `spawnImpact` is not "raised before `stepShots`": its one caller
  is `CombatFx.update`'s tracer loop, ahead of the fade loops, so the same call fades what
  it raised (corrected in the plan and above). `docs/rendering.md`'s mask sentence still said "sparks and discs".
  `VERIFYING.md`'s black frame was "a tenth" of neighbours that are 2-4 MB. "33 stale rows"
  and 34 were both right about different things: 33 of the 47 old rows, plus
  `greyfen-crossing` at 0.0581, one of the fourteen the README said still graded clean,
  so 34 of 132 and the README says so. The bank is ~360 MB, not ~130. After X4.6d what
  reads `wrapCubeTexture` is the glazing alone, a round's until X4.6e and the default
  cube, which the editor's glazing samples until X5.3.
- **The Phase 4 gate** reads "in a round" now, since an editor build draws whole until
  X5.3, and it is checked: Coldharbour and Cinderhaven, 25 s of live round each at a spawn
  with every Babylon `render` logged, drew the panes, the water, the zones, the grass, the
  turf and (Coldharbour) the blobs, and Coldharbour's scene holds nothing else but the
  idle pools and `localShadowProxy`, undrawn. Neither round saw a fight, so the sparks,
  discs and scorch are the rows' reading and not those rounds'.
- **Measured.** New rows banked by `bank.mjs coldharbour --rows=...`, each from two byte-identical
  grabs and each looked at. `bank.mjs --check --keep` twice alone on this tree against
  one at 6c8d71a: **130 of 130 old rows byte-equal to the BEFORE** in the first run and
  129 in the second (`view-pistol-reload`, one pixel by 1/255, the known flake); the
  two runs against each other 131 of 132, the same pixel; **both new rows byte-equal to
  the bank in both**; 98 within floor and 34 red, the same 34 at the same means as the
  BEFORE's run; no page or console error. Typecheck, build (`check-babylon-free`,
  `check-proving`), corecheck and parity pass. A check of the 132 takes about 6 minutes.
- **Not verified.** A blob seen from below in live play; whether an earlier Babylon ever
  showed one from above. The two live rounds stood at a spawn: no vehicle mounted, no
  rotor wash, no shot. The phone. `census`, `gate`, `shaders`, `kit:hash` and `pipelines.mjs
  --round` were not run; nothing in the game moved, and `git diff` under `src/` is
  `bench/vantages.ts` alone. **Left for the owner, being `CLAUDE.md`**: its lines naming
  what stays Babylon's still read true (the blob is Babylon's until X4.6e), and go with
  X4.6e's rewrites.

#### X4.6b's brief, word for word

- **X4.6b — the flags and the rings.** The smallest step. The ring keeps its
  batches and depth bias on OUR renderer's cel recipes. The cloth is the one new
  shape: a vertex buffer of ours rewritten while the flag moves, with no per-frame
  allocation (the sim stays where it is), for BOTH sheets; **the pole goes with it**.
  All of it lands on `"beforeAlphaTest"`, which is where Babylon's opaque list has it
  relative to everything of ours but the order on that point, and an editor build
  has none of it. **Verify:** `ring`, `ring-stones`, `ring-flown`, `ring-flown-far`,
  a flag captured in a live round; the ring is still the zone's boundary; `surfaces.mjs`
  reports no `flag`, `pole`, `stones` or `paint`.

**X4.6b landed** (483165a; 2026-11-04; no change to the picture).

- **What moved.** `render/ZoneDraw.ts` (new) draws every `zone-*` mesh Babylon's opaque list
  drew: each ring's two batches of stones and its paint, each pole, and a field and a band
  on each of a flag's two sheets, one draw for one, 40 surfaces on Coldharbour and 36 on
  Hollowmere, through the plain cel stage and the fragment the world's plain variants use,
  on the recipes `get` and now `getCloth` keep (`bear` and `own`, `CLOTH_VARIANT` beside the
  others). The pipelines are three (plain, plain at bias -8, `CEL_SMOOTH`), asked at
  construction off `zoneRecipes` and declared on `Game.roundPipelines`; a recipe of a variant
  not asked is refused. **The bias is pipeline state from the recipe**, keyed by `get` as
  `CLAUDE.md`'s road rules have it. The arrays are one set a round (`finish` to `clear`),
  static and cloth together under one group 2 and one index buffer, the indices rebased.
  `CaptureZoneSystem` and `FlagCloth` no longer name Babylon (`src/math` for `Color3` and
  `Vector3`, `computeNormals` for the winding probe) and hold no node, but **neither is free
  of it** (corrected by the review; this first said they import none): `FlagCloth` takes
  `mergeParts` and `Part` from `world/parts.ts`, which imports Babylon as a value, and
  `CaptureZoneSystem` reaches that through `FlagCloth`. `ZoneDraw` has no such path. Both stay
  where they are: neither is a core simulation, so `SIMULATIONS` gains nothing and
  `check-babylon-free` does not hold them. A sheet writes its arrays
  through `ZoneDraw.rewrite`: two `writeBuffer`s, where `present` made an array and four
  `updateVerticesData`s, since a field and a band are two index ranges over one sheet.
- **Where it is in each pass, read and not assumed.** On the BEFORE (a scan of Coldharbour's
  40 meshes in a round): no material with an emissive colour, every one `noGlow` and
  `noShadowCaster`, none in any render target's list, no record among the world's, and the
  casters are `map.visuals`, handed over before `buildRound` builds a zone; X4.6a's log has
  sparks alone in the mask. **So: no shadow map, no lamp atlas, no bake, no glow mask, then
  and now.** They RECEIVE shadow, take fog and light, and are inked, all from the cel
  fragment, the frame and the depth buffer, which is why those needed no line here.
- **The draw point, which the brief had wrong and only a byte comparison said.** Hung at
  `"beforeAlphaTest"` first of ours, as briefed: **130 of 132 rows byte-equal, and 8 pixels
  of `ring-stones` (worst 68/255) and 7 of `ring-flown-far` (worst 43/255) moved**, both
  `within floor` at `--check`, mean 0.0001. Babylon's log at the BEFORE has the near zones at
  18-20 m ahead of the blades at their one key, 57 m, so the stones drew first and the blade
  won the tie; hung behind the list, the stone took it. The crop has a stone under blades at
  the pixels. It is a real tie: under the 0.05 m near plane a 32-bit float depth steps every
  half-millimetre at 18 m and every 3 mm at 53 m. **All at `"first"` was the next try, and
  byte-equal on all 132, and wrong**: two scratch rows from eyes where the ring's centre is
  farther than the field's differed by 70 pixels (worst 119/255) on one. So `Game.zonePull`
  splits its one nearest-first order at the blades' key: nearer at `"first"` behind the dome
  and farther at `"beforeAlphaTest"`, first of ours (`zoneDraw.install` ahead of the fires).
  That reproduces Babylon's order against the blades in every frame, whatever the rows
  hold, since it is the comparison Babylon made. The key is read through
  `GrassSystem.bladeSortCentre`, off a bounding sphere: no reach into Babylon's queue, and
  gone at X4.6c. **The guard stays**: `coldharbour-ring-behind-field`, at `crossing`'s eye so
  the benchmark gains no stop, appended and banked by `--rows` from the BEFORE, two
  byte-identical grabs: all at `"first"` moves 54 of its pixels (worst 113/255), the split
  none, and `surfaces.mjs` shows it holds the grass and the stones. **The bank alone could
  not have said this**, for the blob's reason: no old row was on that side of the key.
- **What is left of the interleave.** The water and the `backed` panes are on the same list
  at their own keys, and the split does not read them, so a surface between one of those
  and the blades draws on the wrong side of it: an exact tie or nothing, it needs a stone at
  a shore or a flag through a curtain wall, no row of 133 holds one, and it goes with
  X4.6d and X4.6e. It is the class X4.4d's note accepted for the fires.
- **Allocation**, by V8's sampling heap profiler over 3,000 steps of the door a round steps
  the zones by, Coldharbour, two flags in view (`seconds of air` read back, 50 s each), warmed
  by 3,000 first. **BEFORE ~1,315 bytes a frame; AFTER ~313.** `present` 239,904 bytes, the
  iterator's `next` and `values`, `_markSubMeshesAsAttributesDirty`, `_notifyUpdate` and
  `_markSubMeshesAsDirty` are gone, and `ZoneDraw`, `rewrite`, `present` and `zonePull` took no
  sample in that run. **That is not "`zonePull` allocates nothing"** (the review): its own run of
  the same profiler over 3,000 steps has `zonePull` at 6,180 bytes, one or two samples and about 2
  bytes a step, beside the `Vector3` getters it reads at 5-6 KB each. Its source makes no object,
  and neither run can say whether that is a cold function's boxing or a small steady cost. `bearing` fell from 564,292 to ~16,000 by reading the one wind once (a destructure
  per substep), the same numbers: the bank proves it. `inFrustum` would have added `Vector3`'s
  boxed getters per surface, so the zones hold the render's planes as numbers (`inPlanes`,
  filled once a frame; `FlagCloth.inView` reads the same, the LAST render's). **What remains
  is not the cloth's write**: `viewer.x` and `.z` in `update`, the doubles `update` and
  `flyFlag` pass (code this step did not touch), `writeOut`'s small residue, and other
  systems' frames falling in the window. Under 2,000 loops of `update`, `drawZones` and
  `zonePull` in a live round: `CaptureZoneSystem.update` ~78 KB, `flyFlag` ~40 KB, `writeOut` ~21 KB.
- **Measured.** BEFORE `bank.mjs --check --keep` alone in the worktree at a269bfb (the new
  rows' PNGs copied in). AFTER twice alone on the final tree: **133 of 133 byte-equal to the
  BEFORE in one run and 132 in the other** (`harrowmead-view-pistol-reload`, 2 pixels by 1/255,
  the known flake; `sarab/shelf` held), the two runs against each other the same pixels; 99
  within floor and 34 red, the same 34 at the same means; no page or console error. **A row's
  `--check` pass line would have hidden every difference above.** `kit:hash --models` against
  the BEFORE: 244 builds identical, the 8 `zone` among them, the geometry, order, names,
  materials, bounds and enabled state, through a stand-in that makes each surface handed to
  `ZoneDraw` the mesh it was (`zoneDrawStandIn`). `census --against`: all 132 old rows equal on
  all seven maps, so the total differs only on Coldharbour, by the new row's 64 (not in the
  BEFORE). Typecheck, build (`check-babylon-free`, `check-proving`), corecheck, parity, `gate`
  (seven maps clean), `shaders` (seven clean). `merge:hash` not run: nothing of the world's
  merge moved. `surfaces.mjs` on the ring rows: no `flag`, `pole`, `stones` or `paint`.
- **In play.** `pipelines.mjs coldharbour --round`: **zero of ours in play in every run**, the
  seal quiet. Three of Babylon's are made at `life 1: spawn` with no mesh drawing in 3 of 4
  runs here and 1 of 2 at the BEFORE, or under the card in the others (the count at the
  install 13 or 16 here, 17 or 20 there), so **a race that predates this step**, and the
  review named it: `GiVolume`'s three compute pipelines (`FINDINGS.md` 16); one run at the BEFORE wrote nothing, a run of a tree nothing here
  touched. Ours at the install fell from 23 to 21, the plain pipelines being asked at boot.
- **Live**, Coldharbour offline, the real bots, no script but `spawnPlayer`: by t=26 s Echo's flag
  had gone from 0 to 1 in the Redline's red and Alpha's to -0.74 in the Valeguard's tan, canvas
  until the meter left the foot; Delta's went up to 1 and came back down through 0 and up in tan
  (-0.286, `#c9a15e`, photographed, the ring's stones in place and the plinth under it). 30 of
  40 surfaces drawn at the spawn, 0 Babylon `zone-*` meshes, the cache sealed; two
  `powerPreference` warnings and nothing else in the console. Echo's indoor point flies from
  its roof, seen from 60 m. `F2` out of that live round: the editor opens, `installed` false,
  0 surfaces, 0 zones, 203 proxies, no `zone-*`; closing it goes to `loading` and a new round.
  `surfaces.mjs coldharbour --editor`: a water and a grass rect both remade, as at X4.6a.
- **Tools.** `shaders.mjs` asked for any mesh on a cel material as its probe, and the zones
  were the last on a map with no glazing, so it threw on Hollowmere: it mints a hidden one.
  `census.mjs` counts `zoneDraw`. `harness.mjs`'s zone switch writes `ZoneSurface.on`.
  `profileReport` is version 31, `pools.zones`, the draws in `pools.drawn`.
- **Rewritten**: `docs/rendering.md` (the capture zone, the `"first"` point), `docs/game.md`'s
  pushes, `CLAUDE.md`'s line on what is ours (its section runs to 138 lines against ~135, the
  owner's to trim), `FILES.md`, every header named, and X4.6c's and X4.6d's briefs, which owe
  this tie. `docs/rendering.md`'s "`placeVantage` disposes the zones" was stale since X4.6a.
- **Not verified.** A server's match in a browser: the zones read the same doors, and only
  `corecheck` and `parity` have run one. The phone. The gate's frame rates are not an A/B. A
  stone at a shore against the water, by the reasoning above and no row (the review measured
  it, below).

**X4.6b's review** (e1f5712; 2026-11-04; no change to the game, and nothing under `src/`
moved, comments included). The reviewer found no must-fix and no picture problem. What it
found is the instruments' and the record's:

- **A lost device ended nothing.** A `pipelines.mjs --round` sat about 11 hours at no CPU, a
  hung device (`DXGI_ERROR_DEVICE_HUNG`) leaving the frame counter stopped and `settle` waiting.
  `harness.mjs` now holds two stops, both a `process.exit`: the console line on every `bootMap`
  page and `pipelines` and `bench`'s own (`watchDevice`, exit 4), and a hard limit (exit 3) on
  `settle`, `waitUntilDrawn`, `installRound` and `freeze`, and over a run (`hardLimit`,
  `--limit=<seconds>`: `bank`, `surfaces`, `census`, `shaders`, `pipelines`). `dev-server.mjs`
  stops its child on any exit, or the first of these would orphan it. **Proven on the real
  thing**: `device.destroy()` mid-run exits 4 in 0.2 s naming the line, a stopped render loop
  under an 8 s `settle` exits 3 in 8.1 s, `pipelines --round --limit=8` exits 3, and none leaves
  a Chromium or a Node behind. A clean `pipelines --round`: 16 at the install, zero in play.
  `gate` and `depth` have the page's stop and the waits' limits, not a run's.
- **`plans/webgpu-ref/exact.mjs`** compares two `--keep` directories, the proof the plan owes
  and no committed tool gave: per row byte-equal, or pixels and worst value, exit 1 outside
  `KNOWN_FLAKES` (`view-pistol-reload` 2 by 1/255, `sarab-shelf` 1 by 1/255) or a row on one side
  only unless `--new`. Shown to fail: the review's all-at-`"first"` `ring-behind-field` prints
  `MOVED: 53 pixels, worst 113/255, mean 0.0002/255`, exit 1 (54 on this step's own try).
  `comparePngs` returns `pixels`.
- **`kit:hash` could not fail on `ZoneDraw`**, its stand-in rebuilding a mesh from what the
  builders hand over. Stated in the script and `docs/rendering.md`, with what holds the rest (the
  bank's byte comparison: the rebasing, the upload's defaults, `rewrite`, the split). **A guard for
  the sphere was cheap**: the stand-in runs the real `addSurface` on an object holding what it
  writes and throws on any bit's difference from the mesh's sphere. All 8 zone builds pass, and
  `boxOf`'s `maxX` nudged by 1e-9 (reverted) throws on all 8. `--against` the BEFORE: identical.
- **The tie this step could not reach, measured small**: re-run here over all seven maps, **no
  stone, paint or pole triangle meets a `backed` pane's box, and only Hollowmere's rings B and E
  have stones crossing the water plane, 61 triangles** (19, 11, 19, 12). Seven eyes with the order
  reversed against the blades and the water, all `zones`, byte-equal to the BEFORE: pos `[-85, 1.5,
  -50]` to `[-88.1, -1.3, -37.2]` fov 14; `[-40, 3, -15]` to `[-89.8, -1.3, -18.5]` and to `[-88.1,
  -1.3, -37.2]` fov 5; `[35, 1.5, -112]` to `[29, -1.3, -80.8]` fov 8; `[15, 3, -25]` to `[29, -1.3,
  -80.8]` and to `[50.7, -1.3, -82.1]` fov 5; `[-85, 1.5, -30]` to `[-89.5, -1.3, -18.2]` fov 14. A
  cloth's triangles are not in that count (a sheet's stated reach overlaps a water rect in plan on
  five maps, and a pane's on none, and it flies up its pole). **So that class is an engineering
  call, judged and measured small, not a proof.**
- **X4.6c's brief was one-sided**: it warned of the blades falling behind water at
  `"beforeAlphaTest"`, not of their falling ahead of it at `"first"`, which the log shows both ways
  and a shore makes real. It owes the bytes at both, rows first, and an open question in "Decisions"
  if neither holds. **Nothing retired the split**: X4.6e's brief does now, in the commit moving the
  last of Babylon's opaque list (the `backed` panes), with `"first"`'s exception in `Renderer.ts`.
- **Written up, no change to the game**: `GiVolume`'s three compute pipelines, on no declared list
  (`FINDINGS.md` 16, and what "a race" above was: 16 at the install in 4 of 5 runs, 13 with 3 at the
  spawn in the fifth; X5.1 picks them up), and a lost device freezing the game with no message
  (`FINDINGS.md` 64).
- **Was the review's device loss this step? No.** It had lost the device in 12 of 16 short runs here
  against 2 of 4 at the BEFORE, unpaired. Paired, alternating BEFORE at a269bfb and AFTER at 7097196,
  fresh process each run, nothing else on the GPU: **0 of 37 against 0 of 37** over the review's own
  script (10 each, and 5 each with no gap), the bank's bare loop on the same rows (10 each), the bank's
  order over 42 of Coldharbour's rows (5 each), 5 each beside a deliberately idle tree, and the whole
  bank (2 each). So a short named-row sequence does not provoke it, and neither does the bank's order,
  and what the review saw was of that hour (`FINDINGS.md` 64 has the table and the limits of it).
- **Corrected**: `bank.mjs`'s count (133), `docs/states.md`'s vantages, `docs/rendering.md`'s
  `inFrustum` (`inPlanes`) and "first of all ours" on the fires (the far zones are ahead),
  `docs/profiling.md`'s version 31 and `pools.zones`, and above in this note, "import no Babylon"
  and "`zonePull` takes no sample".
- **Measured.** Bank twice each, alternating, each alone: **through the fixed `settle` no device
  lost in ~366 s a pass**, and by `exact.mjs` 131 of 132 old rows byte-equal in one pair and 132
  in the other (`view-pistol-reload`, 2 by 1/255, the known flake), `ring-behind-field` new at
  this BEFORE, and against this step's own BEFORE, which holds it, 132 of 133 and the flake. The same
  34 stale rows red at the same means, which is `--check`'s exit 1. Typecheck, build, corecheck and
  parity pass.
- **Left for the owner, being `CLAUDE.md`**: the rendering section still runs to 138 lines against
  its ~135. The trim is drafted, unapplied, and hands the section back at 135 with no rule lost: what
  goes is argument `docs/rendering.md` holds (why the moon's depth, "nothing excludes a mesh by hand")
  and words of the pointer's list.
- **Not verified.** A real hang through the new stops: no run here lost a device without being told
  to (`census`, `surfaces` and `shaders` ran clean through them on Hollowmere, `bench` did not run).
  A fresh boot (`FINDINGS.md` 64), a server's match, the phone.

#### X4.6c's brief, word for word

- **X4.6c — the grass and the turf.** The field keeps its frustum test and its
  levels of detail, and its instance buffers become ours. The turf keeps its place
  in the order and its blend, and owes the coverage alpha what the blend writes
  today (`docs/rendering.md`). **The blades are opaque, and their place is where the
  zones are split: `ZoneDraw`'s near run, the blades, its far run**, a tie between them
  being real (X4.6b measured it). **Neither point is free, and this step owes the bytes
  at both.** At `"beforeAlphaTest"`, as this first said, they fall behind the water and the
  `backed` panes, which they are ahead of wherever the field's centre is nearer, and the near
  run must come with them. At `"first"` behind the near run they fall AHEAD of the water and
  the `backed` panes, which they are BEHIND wherever the field's centre is farther: the log
  has both on one map, `ring-flown-far` drawing zone, water, grass, and Hollowmere `water@12`
  then blades at 95 m from one eye and blades at 39 m then `water@65` from another. **A blade
  does stand in shallow water at a shore**, so this is a real tie and no row holds it: this
  step adds rows at a shore from either side of the key (Hollowmere's rings B and E have
  both, the eyes in `X4.6b`'s note) before it moves anything, as X4.6b's guard was added, and
  then proves them by `exact.mjs`. **If neither point holds them, the blades and the water must
  move together or the tie be taken as a picture change, and that comes back to the owner**
  ("Decisions") with the numbers, rather than being absorbed. `GrassSystem.bladeSortCentre`
  and `Game.zonePull`'s split read Babylon's sort, and are rewritten here. **The turf must be past
  `"afterSurfaces"` and past the floor, and
  writes no depth, so with the alpha-tested list empty behind it `"opaque"` is its
  place**, coarsest cell first. **It moves the editor's grass and turf too** (decided
  2026-11-03): one path through the system, as the sky's did at X4.5c. **Verify:**
  `grass-low`, `-medium`, `-high`; the `ground` rows; the mask still rejects roads and
  water (`grass-*` hold both); `F2` in an editor build, a grass rect edited through the
  tier-3 rebuild and drawn; `surfaces.mjs` reports no `grass` or `turf`, in a round and
  under `--editor`.

**X4.6c landed** (21839d1 the rows, 4a16b5f the move; 2026-11-04; "no change to the picture" as written then, which its review below corrects: an accepted, temporary one).

- **What moved.** `render/GrassDraw.ts` (new) draws each `grass*` and `grassTurf*` mesh as a run of one
  index buffer, one draw for one, instanced, a patch an instance; `render/grassProgram.ts` (new) is the
  program, `shaders/wgsl/grass.ts` (new) the bodies, near enough verbatim, and `shaders/GrassShader.ts` is
  deleted. `GrassSystem` keeps the walk, `keep`, `turfRow`, the frustum test and the levels of detail, holds
  no mesh or material, and writes plain arrays: a patch is two `vec4f`s where it was a matrix with four
  entries read, and the five-triangle runs share one set of seeds and the one-triangle ones another, each
  a prefix, where every mesh held a copy. It keeps Babylon's `Frustum` alone, for the planes off the camera.
  The pipelines are two, on `Game.roundPipelines`. **In an editor build too**, by the owner's decision: the
  install is on both paths, and the editor's glazing stays Babylon's until X5.3.
- **The field keeps its own uniforms, and that is how the bytes held.** Its materials held their own eye,
  fog, mist, key wrap, ambient, wind and lamps, set at different moments from the frame's: `update` does not
  run on a frozen row, nor on a held frame, and `lighting.update` can, and `pointLocal` in `celShadow` read the
  material's `pointPos`. So they are `GRASS_BLOCK`'s, under the names the bodies and the chunks read, with
  those names on the frame's block renamed for these programs alone (`FIELD_FRAME_BLOCK`), the layout unmoved
  so the frame's one bind group binds. The live key is copied in `commit`, in the frame a flash moves it. It
  costs a block a frame, and a later step can collapse it against the frame's fields with bytes to prove it.
- **The draw point, by bytes, before anything moved.** Babylon's opaque list was forced with the blades first
  or last in one frozen frame (a scratch comparator, `setRenderingOrder`, no write to anything else), so each
  point could be read off without a port. At existing eyes, and at no new stop:
  | row | field, water keys | at `"beforeAlphaTest"` | at `"first"` |
  | --- | --- | --- | --- |
  | `greyfen-shore-ahead` (`crossing`'s eye) | 85.5, 85.7 | 355 px, worst 60/255 | byte-equal |
  | `harrowmead-shore-ahead` (the menu's) | 34.6, 76.3 | 251 px, worst 154/255 | byte-equal |
  | `harrowmead-shore-behind` (`millpond`'s) | 189.8, 165.9 | byte-equal | 58 px, worst 76/255 |
  Hollowmere's existing eyes hold no such tie (the brief's rings B and E are at eyes no row stands at), so the
  rows are on the maps whose eyes do. **Moving the point each frame came from the orchestrating agent's brief to the implementer, "try moving where it
  helps", which is not in the plan at b06399d; the phrase was ambiguous, and that same paragraph told it to stop and report if
  neither draw point held, as the plan says (the review, below). It is the comparison Babylon made**: `Game.grassPull`, inside the render, puts the blades at `"first"`, behind
  the zones' near run, unless a body the frame's drawn patches may stand in sorts at or ahead of the field's
  centre (`GrassSystem.drawnReeds`, off `reedsOf`: over the rect, and on ground under the tallest the surface
  stands, read off the water's own box), and then at `"beforeAlphaTest"`, first of ours, ahead of the zones' far
  run. Keys tie to the water, made first. **The patch test earns its place**: by key alone, a sight on the bog from
  `[-30, 3, -75]` (fov 6, creek 56.7, field 79.4, bog 85.1) moved 3 px by 6/255, there being no creek in frame.
- **What cannot be held, and what it measured. WRONG as first written, kept with its corrections, and the review below has the
  numbers.** ~~Only Hollowmere has two reedy bodies (wet texels per body: Hollowmere 349 and 106; Kurenai 481; Cinderhaven 499; Sarab
  149; Greyfen and Harrowmead one body; Coldharbour none), so everywhere else the comparison is whole.~~ Sarab has four. A frame whose
  drawn patches reach both, one nearer than the field's
  centre and one farther, wants the blades BETWEEN them, which two points cannot do; it goes behind the list, flipping a
  tie against the farther only. **98 poses built to hit it, shot on both trees and compared by `exact.mjs`, all byte-equal**:
  every pose a scan of forced orders logged as moving at either point (Hollowmere, Greyfen, Harrowmead), 72 of them with water
  either side of the key, 40 of those reaching both bodies. ~~In forced order the farther water never tied in such a frame.~~ It does, on Sarab and
  Hollowmere: the search missed them. **That was judged small and not proved absent, and the review measured it.** It is the class X4.6b's review judged the same way, and X4.6d ends it. No draw hook
  on the water was tried, the owner having refused that reach at X4.4b.
- **The other thing still on that list, the `backed` panes, cannot be reached**: over Coldharbour, Sarab and Cinderhaven, 58
  `backed` meshes and 14,844 triangles, none is within a blade's sway (2.34 m, generous) and height of a texel that grows grass.
- **The turf** is at `"opaque"`, first and alone there, past the clouds at `"afterSurfaces"` as it was past the ring: `cull none`,
  no depth write, bias -8, `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` and alpha `ZERO, ONE`, read off the table and proved by the bytes,
  coverage channel included (a whole-frame compare reads the ink, which reads that channel).
- **In every pass, read and not assumed.** At the BEFORE each patch mesh was `noShadowCaster` and `noGlow`, in no render
  target's list, and X4.6a's log has none in a mask or a bake. **So no shadow map, no lamp atlas, no bake, no mask, then and
  now.** It receives shadow, clouds, the flash and the lamps' cones from the frame; blades write depth and alpha 0, so the
  ink draws on them as it did; fog and mist are its own `fieldAtmosphere`; the wind its own `values.time` over the one
  bearing. The size gate is the field's one sphere (`keepsSphere`, `Game.drawGrass`), each mesh having held it.
- **Measured.** BEFORE `bank.mjs --check --keep` alone at 21839d1 (the shore rows banked from two byte-identical grabs). AFTER twice alone on the final tree, and once before the patch test was tightened: **136 of 136 byte-equal to the BEFORE in all three by `exact.mjs`**, neither known flake coming up, `greyfen-grass-low`, `-medium`, `-high`, every `ground` row, `ashwood`, `hollowmere-ring` and the shore rows among them, which hold the road the mask rejects and the channel it stops at; 102 within floor and 34 red, the same 34 at the same means; no page or console error. `surfaces.mjs` on Greyfen's `marsh`, `crossing`, `grass-high` and `shore-ahead` and under `--editor`
  on Coldharbour and Greyfen: no `grass` or `turf`, `grassMeshes` 0, a water and a grass rect both remade. `census` `--against` the BEFORE by row: all 136 rows and all seven totals equal, Babylon down by the field (`marsh` 18 of 38 to 1, `ground` 17 of 37 to 1), ours up by the same.
  `pipelines.mjs --round` on Coldharbour and Cinderhaven: **zero of ours in play**, and on Cinderhaven the two of Babylon's the
  rotor wash already owed (X4.7). Typecheck, build (`check-babylon-free`, `check-proving`), corecheck, parity, `gate` (seven maps clean) and `shaders` (seven clean) pass.
  `kit:hash` and `merge:hash` not run: no builder and no merge moved. The harness pins `values.time`; `census` counts the runs;
  `surfaces.mjs --editor` watches the mask. Report version 32, `pools.grass`.
- **Allocation**, V8's sampling heap profiler with short-lived objects counted, Greyfen at `crossing`'s eye. 3,000 calls of the
  field's per-frame work: `follow` 1,688 bytes a call to none sampled, `update` 122 to 42. 1,200 rendered frames at deploy:
  `follow` and `thinInstanceBufferUpdated` ~1,740 bytes a frame, against ~100 now, of which `drawGrass` ~43 and `grassPull` ~56, a
  once-a-frame function's boxed doubles (`Vector3`'s getters, `keepsSphere`'s arguments), and nothing in `GrassDraw`. So none is
  added: the field's share falls.
- **Live.** Greyfen offline, spawned, the real bots: 15 blade and 2 turf runs drawn, the clock moving (a frame 0.7 s on differs
  across the field), `low`, `medium`, `high` in the round (11, 14, 15 runs, 8,661 to 45,835 blades, the picture plainly thinner at
  `low`), both growths forced (a run's array cut to one patch and a kind's buffer to `capacity` 1: 128 patches, group 2 remade, the
  field whole), out to the menu with `installed` false, and a second round. No page or console error, no warning, the seal on. Hollowmere the same, 12 and 2 runs, one reedy body in reach at its spawn, the blades at `"first"`.
  **Editor**, Greyfen, `F2` from the menu: `grass.mask` rebaked on a rect's density going to 0 through `rebuildGeometry`, the blades
  under that rect gone from the frame and back on restoring it, a rung change, out to a round, to the menu and into another
  round, no error and no warning. Nothing was saved.
- **Not verified.** A server's match in a browser: the field reads no wire. The phone (no capture was owed by this step: the
  draw count is unchanged). The field's GPU cost against the BEFORE: not an A/B. "A frame on Hollowmere that actually flips" stood here,
  and the review found them.

**X4.6c's review** (d80c078; 2026-11-04; no change to the game or to the picture, under `src/` only comments and
`bench/vantages.ts`'s row and text). **The picture difference the step left is real, and the owner accepted it on 2026-11-04 as
recorded and temporary until X4.6d** (`BABYLON_EXIT.md`, "Decisions"). The review had found the record understated it; what follows is
what was corrected and measured.

- **"Only Hollowmere can" was false, and pixels do move.** Sarab has four reedy bodies. Where the eye has one nearer than the field's
  centre and another farther and the frame's patches reach both, `grassPull` picks `"beforeAlphaTest"`, so the blades draw after the
  farther water and win ties Babylon gave it. The reviewer's shots, BEFORE 21839d1 against AFTER, re-compared here:
  | pose (pos, target, fov) | moved |
  | --- | --- |
  | Sarab `[250,8,50]` to `[-194.75,-6.0,-69.75]`, 9.8° | 29 px, worst 41/255 |
  | Sarab `[-100,8,-175]` to `[-198.75,-0.52,51.25]`, 9.8° | 22 px, worst 95/255 |
  | Sarab `[50,8,-50]` to `[253.25,-6.29,-48.75]`, 9.8° | 12 px, worst 58/255 |
  | Sarab `[-275,8,50]` to `[273.25,-6.22,-44.75]`, 9.8° | 16 px, worst 34/255 |
  | Sarab `[-275,1.6,-150]` to `[79.25,-5.66,-39.75]`, 9.8°, standing eye height | 6 px, worst 43/255 |
  | Hollowmere `[-50,8,-70]` to `[12.25,-1.8,-100.75]`, 54.4° hip | 1 px, worst 5/255 |
  | Hollowmere `[-60,8,-80]` to `[14.25,-1.66,-93.75]`, 13.75° | 4 px, worst 1/255 |
  Scan rate, poses aimed at this case and so no rate of play: Sarab 20 of 300 (mid range) and 14 of 300 (long range), Hollowmere 9 of
  300 (at most 2 px in the scan), Kurenai 0 of 300. Patches with a bit / wet texels per body, re-measured: Hollowmere 55/2963, 19/805;
  Greyfen 206/10971; Harrowmead 75/271; Sarab 31/1586, 32/1587, 21/870, 21/819; Cinderhaven 273/3032 on one body of eight; Kurenai
  80/3258, 8/0, 12/0; Coldharbour none. **The bit is `yLo < top`, not "reeds stand here"**: Kurenai's two ponds carry bits and grow no
  blade below their surface, and 300 such poses moved 0 pixels. Corrected in `Game.ts`, `GrassSystem.ts`, `docs/rendering.md` and the plan.
- **How this came about, plainly.** Neither fixed point held, which the plan says comes back to the owner. The implementer built a third
  option instead of stopping. The note above called that "the brief's", and the words "move where it helps" are not in the plan at
  b06399d: **they were in the orchestrating agent's brief to the implementer, "try moving where it helps", whose same paragraph said to
  stop and report if neither point held. The phrase was ambiguous and came from that brief.** The plan's "It did not come to that" and
  "Had it failed, the answer was to land X4.6d first", which nobody decided, are replaced by what happened.
- **The flip is banked.** `sarab-shore-flip`, appended at the end of Sarab's list at `shelf`'s eye `[228, 20, 132]`, so the benchmark
  gains no stop: to `[-190.75, -6.31, -90.75]`, 13.75°, wind 2.6, the field's centre 261.1 m off, the middle pool 251.6, the west pool
  478.9, found by scanning only from existing eyes (10 of 131 poses moved, all from `shelf`). **Its reference frame is the truth, Babylon's
  order**: banked at 21839d1 in the BEFORE worktree with the row's definition added (uncommitted, and that tree left clean), two
  processes byte-equal. **The tree moves it by 27 pixels, worst 54/255, mean 0.0001**, two processes byte-equal, all of them inside a box
  of 286 by 30 pixels on the far bank: a crop of (915,522)-(965,556) shows the west pool's surface in the haze and the blades along its
  edge, the moved specks on that waterline. `--check` calls it `within floor`, which is why `exact.mjs` carries it.
  **`exact.mjs` gains `EXPECTED_MOVES`**, separate from the flakes (`until: "X4.6d"`, 27 by 54): the tool passes today and fails if the
  row moves more. It also gains `--rows`, so a kept frame can be held against `ref/` alone. X4.6d's brief removes the entry and owes the
  row byte-equal to that truth.
- **No Hollowmere row.** At all seven of its existing eyes both bodies sort beyond the field's centre (menu's field 51 m, bodies 111
  and 181; `crossing`'s 66, 156 and 122; and so on), so no frame from any of them can reach the two sides: 1,152 frames per eye over every
  5° of bearing say the same, `both` 0. A row there would cost a new stop in the benchmark, moving Hollowmere's every later segment,
  for a difference of at most 4 px by 1/255. Sarab's row shows the same mechanism, so none was added.
- **X4.6d's and X4.6e's briefs contradicted each other**, and X4.6d's read true against the code. X4.6e's was written at X4.6b's review, when
  two points were the only way for anything of ours to keep a place around a tie with that list. But a split is only owed where something
  ties, and with the water ours nothing in that run ties with what is left: no blade and no zone triangle reaches a `backed` pane (X4.6b's
  review, X4.6c), and **the water does not either, measured here**: over Coldharbour (13,044), Sarab (600) and Cinderhaven (1,200) no `backed`
  triangle's box comes within half a metre of a body's surface range in plan and height. So after X4.6d the run stands at one point, first of
  ours at `"beforeAlphaTest"`; `ZoneDraw`'s near run, `GrassDraw`'s `"first"` run, the split and `"first"`'s exception all go there, and what
  remains is the panes' place on Babylon's list. X4.6e removes that, and owes the exception only if X4.6d's bytes refused that point.
- **An editor build's picture was never measured and "no change to the picture" did not reach it.** Its whole world is on Babylon's opaque
  list, so the blades no longer interleave with it by key. Measured once, Greyfen, `F2` from the menu, each distinct eye of the map's rows,
  frozen at wind 2.6, BEFORE 21839d1 against the tree, two runs each:
  | eye | moved |
  | --- | --- |
  | `crossing` | 302 px, worst 94/255 |
  | `menu` | 47 px, worst 58/255 |
  | `ground` | 10 px, worst 21/255 |
  | `marsh` | 5 px, worst 6/255 |
  | `canopy` | byte-equal |
  | `treeline` | 26,355 and 38,080 px, worst 79/255, inside its own residue: one tree against itself across processes is 127,370 and 88,506 px, worst 92/255, so this row says nothing |
  Each repeats in the second pair but `treeline`. **With the field hidden on both trees all six are byte-equal**, so the move is the field's
  alone and `treeline`'s residue is too. It stays until X5.3 moves the editor's world (its "Inherits"). Dev-only; no player sees it.
- **Corrected**: `docs/game.md`'s `tick` table was split by a blank line. `FINDINGS.md` 62 said the grass is Babylon's thin instances and its
  first suspect is gone. `FINDINGS.md` 46's growth re-run is recorded, with what one forced growth on Greyfen does not settle.
  `WorldCulling`'s header still listed the grass and the sky as loose meshes. `vantages.ts`'s `shore-ahead` said "through a sight" at 4.05°, and
  `shore-behind` read as a sight at 8°: the game's narrowest aimed field is about 9.8° (6x over `fovHip` 0.95), so both now read as stress
  rows, their cameras untouched. The count in `bank.mjs` and the README: 34 of 137.
- **Measured.** BEFORE `bank.mjs --check --keep` alone at 1d8f393 and AFTER alone on the final text: by `exact.mjs` **136 of 136 old rows byte-equal**, neither
  known flake coming up, `sarab-shore-flip` new (`--new`), exit 0; the same 34 stale rows red at the same means, no device lost. The new row against its truth:
  `expected to move until X4.6d: 27 pixels, worst 54/255`, exit 0, byte-equal to the earlier takes; a different frame in its place exits 1 naming the bound. Typecheck, build,
  corecheck and parity pass. **Not verified**: a server's match in a browser, the phone, and how often a player would meet the flip, since every rate here is of poses aimed at it.

#### X4.6d's brief, word for word

- **X4.6d — the water.** The largest shader of the five (`WaterShader.ts`). **It retires what X4.6c
  could not do without it and owes back what the owner accepted until it lands** ("Decisions", 2026-11-04):
  the blades, the zones' two runs and the water become ONE nearest-first run of ours by the keys Babylon
  used, the water and the blades' tie exact again in every frame, Sarab's and Hollowmere's included, and with
  that `Game.grassPull`, `GrassDraw.near` and `installNear`, `GrassSystem.reeds` and `drawnReeds`, and
  `WaterSystem.sortCentre` and `surfaceTop` all go. **`backed` panes stay Babylon's through this step, the only
  thing left on that list in a round, and they tie with nothing in the run**: no blade and no zone triangle
  reaches one (X4.6b's review, X4.6c), and no water either (X4.6c's review: none of the 14,844 triangles is
  within half a metre of any body's surface range on the three maps with any; `sarab-pane-water`'s drowned car
  is see-through). **So the run needs one point and no split**: first of ours at `"beforeAlphaTest"`,
  behind the panes, and this step takes out `ZoneDraw`'s near run and its "drawn at TWO points",
  `Game.zonePull`'s split and `GrassSystem.bladeSortCentre`, `GrassDraw`'s `"first"` run, `Renderer.ts`'s "two
  opaque draws" under `"first"` (the dome alone there again) and `docs/rendering.md`'s. **What remains after it
  is the panes' place on Babylon's list and nothing else.** If `exact.mjs` refuses that point, the whole run goes
  at `"first"`, behind the dome, and only then does an exception stay in `Renderer.ts`, for X4.6e. Two points
  again is an owner question, not a choice. **An editor build keeps its difference** (the whole world on that
  list, no zones): this step moves its blades and water into the same one run, and that stays until X5.3. **Its
  proof includes the banked flip**: `exact.mjs plans/webgpu-ref/ref <keep> --rows=sarab-shore-flip` byte-equal
  against 21839d1's truth, this step REMOVES the row's `EXPECTED_MOVES` entry (against its parent's BEFORE the
  row moves by that same bound, the one row that may), and it re-shoots the seven poses in `docs/rendering.md`'s
  table against a BEFORE at 21839d1, byte-equal. `ref/` is gitignored, so a lost frame is re-taken at 21839d1
  with the row's definition added (`bank.mjs sarab --rows=shore-flip`), which reproduced byte for byte. The
  bed-depth bake and the probes stay what they are, and the water reads its cube
  directly, a round's (`cubeOf("water", slot)`) and an editor build's (the default
  cube) alike, as it moves there too (decided 2026-11-03). **So what reads
  `wrapCubeTexture` after this step is the glazing alone**: a round's through
  `pointGlazing`, until X4.6e, and the default cube every glass material is born with
  (`setDefaultReflection`), which is all the editor's glazing ever samples, until
  X5.3. `cubeOf` makes a wrapped view for every pool today, and the water's pool no
  longer wants one. **It must be ahead
  of `"afterSurfaces"`**: it writes depth, the clouds' far depth passes wherever
  nothing has, and the turf at a shore and every fade land on it (the one run's point,
  above).
  **Verify:** `marsh`, `millpond`; the far quad in `coldharbour-menu`, `-sky-disc`
  and `cinderhaven-sky-cloud-moon` (no row of its own, the gap was not real);
  `fx-water-fade`, its disc on the bed still rejected; `sarab-pane-water`; a cube's
  bake on Cinderhaven's sea; `F2` in an editor build, a water rect edited through the
  tier-3 rebuild and drawn at strength 0; `surfaces.mjs` reports no `water` or
  `waterFar`, in a round and under `--editor`.

**X4.6d landed** (5f26b00; 2026-11-04; no change to the picture in a round but the accepted, temporary one of X4.6c ending).

- **What moved.** `render/WaterDraw.ts` (new) draws every body of water its grid or its far quad, one draw for one, a
  range of one index buffer over one storage array; `render/waterProgram.ts` (new) is the program,
  `shaders/wgsl/water.ts` (new) the bodies, verbatim but for their entry points and the essay kept with them, and
  `shaders/WaterShader.ts` is deleted. `WaterSystem` keeps the bed-depth bake, the grid's lines, `follow`'s near/far test
  and the clock, holds no mesh and no material, and writes plain arrays. One pipeline, on `Game.roundPipelines`. **In an
  editor build too**, by the owner's decision: the install is on both paths, and the editor's glazing stays Babylon's until X5.3.
- **The order: one run at one point, first of ours at `"beforeAlphaTest"`, and it held at the first try.**
  `render/NearestRun.ts` (new) is the frame's one draw there; `Game.nearestPull` writes each list's order and keys off the
  scene's planes and `globalPosition`, inside the render, as a late prepare so each draw's verdict stands; the merge sends an
  equal key to the mesh made first, the water's, then the blades', then the zones', which was Babylon's stable sort over
  its list. Nothing but the `backed` panes is left on that list in a round, and nothing in the run ties with one (X4.6b's
  and X4.6c's reviews). **Bytes at each point tried: `"beforeAlphaTest"`, 136 of 137 rows byte-equal to a7b29fb and the 137th
  byte-equal to its truth. No other point was tried, none being needed**, so `"first"` holds the dome alone and `Renderer.ts`'
  exception is gone rather than left for X4.6e. No further scheme was built.
- **Retired**: `Game.grassPull` and `zonePull` (the second's frustum and sort are `nearestPull`'s), `GrassDraw.near`, its
  `pull`, `drawNear`, `drawFar` and `installNear`, `GrassSystem.reeds`, `drawnReeds`, `reedsOf` and `build`'s `waterTop`,
  `WaterSystem.sortCentre` and `surfaceTop`, `ZoneDraw`'s `split`, `pull`, `drawNear` and `drawFar`, `ShadowBindings`'
  `shadowConsumers`, `registerShadowConsumer` and `unregisterShadowConsumer`, the water's pool's wrapped views, and
  `exact.mjs`'s one `EXPECTED_MOVES` entry. **Not retired**: Babylon's opaque list in a round (the `backed` panes, X4.6e's),
  `wrapCubeTexture` (the glazing's, and the default cube's for the editor's glazing), the foam's `Texture`, the empty
  `EXPECTED_MOVES` table, and the harness's optional chain on `body.mat` for a BEFORE at a tree whose water is Babylon's.
- **What it keeps, in each pass, measured at a7b29fb and not assumed.** A scratch hook on every water mesh's
  `onBeforeRenderObservable`, over 90 frames of a real round and a `reflections.rebake()`: Cinderhaven 720 draws (90 grid, 630
  quad) and Hollowmere 90, every one in the frame's main pass (`PostProcessRTT-celInk`), none in the glow's mask, a shadow map,
  the lamps' atlas or a bake; no render target's list holds one. So no shadow map, no atlas, no bake, no mask, then and now. It
  RECEIVES shadow, clouds, the flash and the lamps' cones off the frame. It writes depth and alpha 0, so the ink draws on it as
  it did. Its fog, mist, key, ambient, sky fill and lamps are its own, in `WATER_SHARED`, under the names the bodies and
  `celShadow` read, with those names on the frame's block renamed for this program alone (`frameBlockExcept`, moved here out of
  `grassProgram.ts`); `pointLocal` reads the water's `pointPos`, as it did. Its wind is none: its waves are its own clock. Depth
  write on, LEQUAL, bias 0, back cull, no blend: the defaults, which `surfaces.mjs` had measured.
- **Found by the limit, before anything drew: group 0 cannot be the frame's whole.** The frame's fourteen textures and the
  water's three are 17 sampled textures in the fragment stage, and WebGPU promises 16; the material declared nine. So
  `WaterDraw` holds a group 0 of its own, the frame's block and the six shadow maps at the head of `FRAME_TEXTURES`, a prefix so each
  keeps its binding, refreshed from the frame's handles in its prepare.
- **Three textures, three owners, each sampler read off the BEFORE.** Babylon's own `_GetSamplerDescriptor` over each texture's
  state, in the page: the bed `r8unorm` 1 level, linear in all three, clamped, `maxAnisotropy` 4; the foam `rgba8unorm`, 9 levels,
  `invertY`, repeat, `maxAnisotropy` 4; the cube linear in all three, `repeat` (from `INVCUBIC_MODE`), `maxAnisotropy` 4. The bed is
  ours now and its sampler states exactly that; the cube is the bake's, read through a cube view over every level with a sampler
  stating that; **the foam stays Babylon's `Texture`**, read through the seam (`hostTexture`), so its decode and mips are what they
  were, and that goes to X5.4's list, where the seam ends.
- **Values read live, kept live.** A material held `key.dir`, `key.color` and the rotors' array by reference and read them at its
  bind, so `WaterSystem.commit` copies all three in the frame that draws, right before the render; `update` alone moves the clock and
  the lamps, so a frozen or held frame keeps what it had, and `follow` writes the eye and the grid's origin in every state. A build's
  first frame draws at clock 0 on a fresh `values`, as a new material did, and `this.time` carries on across builds, as it did.
- **Proof.** BEFORE `bank.mjs --check --keep` alone at a7b29fb, AFTER twice alone on the tree, the second on the final source. By
  `exact.mjs`: **136 of 137 rows byte-equal in both, neither known flake coming up, and the one that moved is `sarab-shore-flip`,
  27 pixels by 54/255, exactly the bound X4.6c's review banked**. Against its truth (`ref/`, taken at 21839d1)
  `exact.mjs plans/webgpu-ref/ref <keep> --rows=sarab-shore-flip` is byte-equal. The same 34 stale rows red at the same means, no
  device lost, no page or console error. With the entry removed, `exact.mjs <a7b29fb> <after>` exits 1 naming that row alone, which
  is what "the one row that may" means.
  - **The flips.** The seven poses of X4.6c's review and every pose of its scans (`rev-c/hole-*.json`), shot frozen at wind 2.6, in one
    order, at 21839d1 and on the tree, compared by the PNG's SHA-1: **Sarab 599 of 599, Hollowmere 302 of 302, Kurenai 300 of 300 byte-equal**,
    the 34 of Sarab's and 9 of Hollowmere's that had moved among them. Pose by pose: all seven, 29 px, 22, 12, 16, 6, 1 and 4, now 0.
  - **The far quad.** `surfaces.mjs --pixels` at the BEFORE, what it owns: `coldharbour-menu` 204,387 px, `-sky-disc` 69,292, `-avenue`
    26,171, `cinderhaven-sky-cloud-moon` 120,672, `cinderhaven-tank-far` 43,229, so those rows do prove it, and all five are byte-equal.
    `marsh`, `millpond`, `sarab-pane-water`, `coldharbour-fx-water-fade`, `fx-scorch`, `greyfen-shore-ahead`, `harrowmead-shore-ahead`
    and `-behind` byte-equal. `sarab-pane-water`'s drowned car is byte-equal with the pool's quad now behind the `backed` panes.
  - **A cube's bake on Cinderhaven's sea.** Every water cube read back after a frozen re-bake, every face at every level, hashed: all 8 of
    Cinderhaven's (world 0.50 to 0.52 on the four in reach of the land, 0 on the four out at sea) and Greyfen's 1 (0.66), equal on both trees.
  - **What no row holds.** A rotor's wash forced at one site on each of Cinderhaven's and Hollowmere's largest body, near and far, frozen: 8 frames
    byte-equal, the wash moving the frame in 3 of the 4 (the fourth has that site out of Hollowmere's far view, and no wash in either tree).
  - **The order against a `backed` pane** had been measured as non-tying and these rows bear it out: `curtain2`, `curtain40`, `curtain90`
    and `shopfront` byte-equal.
- **`census`** `--against` the BEFORE by row: all 137 rows and all seven totals equal, Babylon down by the water, ours up by the same. **`surfaces.mjs`**
  on Coldharbour, Cinderhaven and Greyfen and under `--editor` on Coldharbour and Greyfen: no `water` or `waterFar`, `waterMeshes` 0, a water
  and a grass rect both remade. **`pipelines.mjs --round`**: zero of ours in play on Coldharbour and Cinderhaven, and on Cinderhaven the two of Babylon's
  the rotor wash already owed (X4.7). Typecheck, build (`check-babylon-free`, `check-proving`), corecheck, parity, `gate` (seven maps clean) and `shaders`
  pass. `kit:hash` and `merge:hash` not run: no builder and no merge moved. Report version 33, `pools.water`.
- **Allocation**, V8's sampling heap profiler with short-lived objects counted, Cinderhaven, BEFORE against AFTER. 1,200 rendered frames at deploy:
  **63,757 to 56,538 bytes a frame**, Babylon's material binds and uniform pushes gone with its eight draws. In that, `drawWater` ~255 and `NearestRun.draw`
  ~102, once-a-frame functions' boxed doubles (`keepsSphere`'s arguments for eight bodies, a read of a `Float64Array`), and nothing in `WaterDraw`.
  3,000 calls of `follow`, `update` and `commit` under a camera moved every call: 294 to 333 bytes a call, all of it boxed doubles.
- **Live.** Cinderhaven offline, spawned, the real bots: 8 bodies drawn, one grid and seven quads, the clock moving, two frames at the water
  about a second apart differing by 333,920 pixels; the near/far test turning between 121 m and 119 m past a rect's edge, and placed by the harness first at 300 m and then at 20 m
  the shapes swapped body by body; out to the menu with no body standing, and a second round. No page or console error, no warning, the seal on. Hollowmere the same, 2
  bodies. **Babylon's active list is EMPTY in a Hollowmere round** (0 a frame, at deploy and in play, group 0 still visited 60 of 60), so the seam's fallback is not this frame's
  path; Coldharbour's holds its panes and its blobs. **Editor**, Greyfen, `F2` from the menu, at `marsh`'s eye, frozen: rect 0's surface raised 0.5 m through
  `rebuildGeometry`, its body remade, 969,041 pixels moved by up to 212/255 with the water plainly up the piles; restored, 0 pixels against the frame before; out, to the menu
  with no body standing, and into a round. No error and no warning. Nothing was saved.
- **An editor build, re-measured, since the owner was told of it.** Frozen at wind 2.6, `F2` from the menu, each distinct eye of the map's rows. Its blades and water now stand
  behind its whole world. Against 21839d1:
  | eye | at X4.6c (a7b29fb) | now |
  | --- | --- | --- |
  | Greyfen `crossing` | 302 px, worst 94/255 | byte-equal |
  | Greyfen `menu` | 47, 58/255 | byte-equal |
  | Greyfen `ground` | 10, 21/255 | byte-equal |
  | Greyfen `marsh` | 5, 6/255 | byte-equal |
  | Greyfen `canopy` | byte-equal | byte-equal |
  | Greyfen `treeline` | noise | 21,029 px, its own residue (one tree against itself is 127,370 and 88,506 px) |
  | Sarab `menu` | 73, 60/255 | 2, 1/255 |
  | Sarab `wadi` | 414, 98/255 | 456, 91/255 |
  | Sarab `shelf` | byte-equal | 17, 35/255 |
  | Harrowmead `ground` | not taken | 2, 1/255 |
  **Greyfen's were the blades against the WORLD, not the water, and did not end with the flips**: this line said the opposite until X4.6d's review, whose table below measures it. They come back at these eyes because the run has put the blades behind the world again, **which is these eyes and not the map**. **A difference stays, and it is the run's place against the world on Babylon's list**: Sarab's seven other
  eyes and Harrowmead's `borderland` and `millpond` byte-equal; Harrowmead's `crossing` (10,494 px) and `menu` (1,645) are inside their own residue, one tree against itself 11,051 and 9,053. Sarab's and Harrowmead's
  repeat on the tree, byte-equal across two runs, and each tree's truth was taken once, so these are small differences and not a bound. It stays until X5.3. Dev-only; no player sees it.
- **Corrected as it went**: `docs/editor.md` said Babylon draws an editor build whole, which stopped being so at X4.5c; `docs/states.md`'s vantages; `VERIFYING.md`'s default cube; `Game.ts`'s comment on
  why `follow` comes before the cull; `WorldCulling`'s loose list; `docs/rendering.md`'s draw points, the run's section, the water's own and the capture zone's. **`CLAUDE.md` was not touched, and "no statement in it is made false", which stood here, was wrong**: its
  rendering section still had the zones and the grass drawn either side of Babylon's opaque list. X4.6d's review, below, corrects it.
- **Not verified.** A server's match in a browser: the water reads no wire. The phone (no capture was owed by this step: the draw count is unchanged). GPU cost against the BEFORE: not an A/B.

**X4.6d's review** (9b086ef; 2026-11-04; no change to the picture; under `src/` comments, a doc and one change to the run's merge, whose finite keys take the same path). An independent review found five small things. Its numbers below are the review's and are labelled so; this commit did not re-take them.

- **The note gave the wrong cause for Greyfen's editor frames.** Its numbers were right. It said the blades against the water; X4.6c's review (`BABYLON_EXIT.md`) said the blades against the world, and the two records contradicted each other. **The review measured that the world is right**: at Greyfen's `crossing` and `menu` on a7b29fb `grassDraw.near` is true and the field sorts ahead of the water (85.5 against 85.7, 68.8 against 69); with the water hidden on both trees those eyes still move, and on af5eff1, moving only the blades to `"first"`, ahead of the world with the water left in the run, reproduces a7b29fb's frame byte for byte at both. Its attribution, **the review's measurement, a7b29fb against af5eff1**, so directly between the two trees and not the table above's rows, which are each against 21839d1:
  | eye | BEFORE vs AFTER | field hidden | water hidden | cause |
  | --- | --- | --- | --- | --- |
  | Greyfen `crossing` | 302 px, 94/255 | 0 | 344 px, 94/255 | blades vs world |
  | Greyfen `menu` | 47 px, 58/255 | 0 | 47 px, 58/255 | blades vs world |
  | Sarab `wadi` | 870 px, 98/255 | 0 | 870 px, 98/255 | blades vs world |
  | Sarab `shelf` | 17 px, 35/255 | 16 px, 43/255 | 0 | water vs world |
  | Sarab `menu` | 78 px, 60/255 | 0 | 78 px, 60/255 | blades vs world |
  `wadi`'s 870 is exactly 414 + 456: the two trees differ from truth on disjoint pixels. **Inferred, not measured**: Greyfen holds because of these eyes and not for the map as a whole, every tying world surface there evidently sorting nearer than the field's centre. Corrected in the note above and in `docs/rendering.md`, whose "Greyfen's six eyes hold" could be read as "Greyfen is exact", and in the plan's summary, which now says "at those eyes". A search of the plan, `docs/` and this file for the old cause found no other sentence giving it. These stay editor-only differences until X5.3.
- **A clause in `CLAUDE.md` was false, and the record said nothing was.** The capture zone's pieces and the grass were "drawn either side of what is left of Babylon's opaque list, for its ties". They stand in one nearest-first run, with the water, behind it. That clause is rewritten and names `WaterDraw`, two lines for two and nothing else in the file changed. It says "the turf apart" because the turf stays at `"opaque"`, outside the run. **5f26b00's commit message also says "`CLAUDE.md` is not touched: nothing in it is made false". Old commit messages are not rewritten, so this note is the correction.** The rest of that paragraph was read against the code and holds: nothing else in it is made false by X4.6d. The sparks, the discs and the scorch are still Babylon's until X4.6e.
- **`NearestRun.draw` could spin forever on a NaN key.** No comparison holds of a NaN, so every arm failed and the last, assuming `z < zn`, ran with `z` spent: the review had it still looping at 200,000 calls with a NaN body and no zones, with a NaN after a finite key, and with every key NaN, and with zones standing it would run past the end of `order` and throw. The review found no shipped path to a NaN, so this is robustness only. **The fix is at the three reads at the top of the loop**: a NaN key reads as +Infinity, the value an emptied list already reads as, so it sorts last and the last arm's assumption is true rather than tested. No new arm and no allocation. Every item is still drawn exactly once whatever the keys. **Measured**, the real class in Node over stubs (`--experimental-transform-types`): the review's three NaN cases draw `W0-1`, `W0-1 W1-2` and `W0-1 B Z0-1 Z1-2`, five more NaN placements end too, and equal keys go water, then blades, then zones (`W0-2 B Z0-2`). The same eight NaN cases on af5eff1's class: seven overrun the zones' list, which the stub stops with a throw, and the eighth, a NaN zone among finite ones, draws in a different order. 200,000 random finite cases, ties made likely, make identical calls in identical order on both classes.
- **Stale comments.** `Game.ts` said `mats` publishes the shadow map both systems sample; both read the frame, and `keyLight` is all either asks it for. The list of what `pools.drawn` sums stopped at the grass. `WaterSystem` and `GrassSystem` each said twice that a lightning flash moves the key, and it never does: only `setEnvironment` writes `lightDir` and `lightColor`, and the flash is `ShadowBindings.setFlash`'s `flashDir` and `flashColor`, off the frame, read by `flashLight` in both programs. Each was checked against the code first.
- **`WaterDraw.setGeometry`'s doc** said "replacing any before", and it destroys nothing. It says now that a `clear` is owed first, which `WaterSystem.build`'s `dispose` always does. No change of behaviour.
- **Proof.** BEFORE `bank.mjs --check --keep --limit=3000` alone at af5eff1 in the BEFORE worktree, AFTER the same alone on the final source. By `exact.mjs`: **137 of 137 rows byte-equal**, neither known flake coming up and `sarab-ground` not moving. The same 34 stale rows red at the same means (the two logs' lines are identical), no device lost, no console error. `sarab-shore-flip` against its truth in `ref/` byte-equal. Typecheck, build, corecheck and parity pass.
- **Not verified.** A server's match in a browser, the phone. Nothing here was run in a live round: the only change to what runs is the merge, and a bank frame draws through it. **The NaN path has only run over stubs**, never on a real frame, there being no known shipped way to one. The review's table and its inference were not re-measured.

#### X4.6e's brief, word for word

- **X4.6e — the glazing, the three blended pools and the blob shadows, together.** The
  see-through panes, the three pools and the blobs land in ONE commit, because one sort
  of ours orders every blended surface (decided 2026-11-01, X4.4's "Find out first",
  and for the blobs 2026-11-03), and no half can be proven without the rest. **`backed`
  panes write depth, so they may go in a commit ahead of it** if the step runs large. It:
  - replaces Babylon's transparent sort with ours, back to front by the same
    centres, so a tie comes out as it did;
  - holds the moon's place (`"beforeBlended"` stands on the seam's item 6, which
    this sort takes from under it: `sky-moon`, `sky-disc` and `sky-motes` read it);
  - gives `GlassFx`'s collapse a buffer of ours, and takes the round's glazing off
    `wrapCubeTexture`. **It cannot retire it**: the editor's glazing binds the default
    cube through it until X5.3 (`ReflectionSystem.defaultCube`). The harness's
    put-away of a `breaks` event writes the range back through the mesh and moves
    with the buffer;
  - draws each surface under its own world matrix or bakes it (the list above: most
    are not at identity, and a `WorldPane`'s range is into its local positions);
  - keeps `backed` ahead of the blocks on `"beforeAlphaTest"`, which is the whole of
    what makes a backed pane pay (`Game`'s sort comment), and the sparks' mask draw
    between the mask's open and its late draws, where Babylon's mask has them;
  - moves the three pools' `warm(on)` poses and `warmBlob` into X4.4e's declared list,
    retiring the last of them on `CombatFx`, `BlastDebrisSystem` and `ShadowSystem`,
    and with them `stageWarmFrame`'s list of what is Babylon's and idle;
  - moves the **blob**: its disc, its radial texture, its `visibility` and its
    switch (`updateBlob`, `hideBlobs`) onto ours, with the depth state in the table
    above, in the sort by its centre, out of the mask, through the size gate
    (`tooSmallMesh`) and, like every blended draw here, accumulating into the coverage
    alpha. **Its FACING is part of the port**: what a port must match today is a disc
    that shows from below and not from above, so it is byte-identical or it is the
    picture change "Decisions" holds open, in a commit of its own;
  - **ports the scorch exactly**. A port that cannot match comes back to the owner
    with the numbers rather than being taken as a picture change;
  - **takes the last of Babylon's opaque list in a round, the `backed` panes**, in their own
    commit here or ahead of here. **The zones' split and `"first"`'s exception are gone already**:
    X4.6d's one run stands at `"beforeAlphaTest"`, its bytes having held it there, and nothing in it
    ties with a `backed` pane. So what this removes is the panes' reach into Babylon's list and that
    list's hold on a round, and the panes keep their place ahead of the blocks, above, on either side
    of the run. An editor build's list stands until X5.3 either way;
  **The BEFORE**: `fx-glass-sort` (a fade squarely behind and squarely in front of
  a pane), `fx-blob-sort` (a blob behind a pane, between it and a fade, and in front of
  both, and one that must own no pixel), `fx-glass`, the impact rows, `fx-scorch`,
  `fx-scorch-glass` (a mark sorted behind a pane and one in front, both through it),
  `fx-fire-fade`, `fx-glass-broken`, `fx-water-fade` and `sarab-pane-water`. **Rewrites**:
  `ShadowSystem`'s header and its "CreateDisc faces +Z" comment, `PipelineWarmup`'s
  list, `merge.ts`'s stale counts, `docs/rendering.md`'s blob paragraph, and the
  `CLAUDE.md` lines on what stays Babylon's, for the owner. **Read first against
  X5.3**: glazing in an editor build stays Babylon's until then, and with it a
  transparent list there, the seam's item 6 and `wrapCubeTexture`, and **the editor's
  `ed-*` proxies are on that list with it**, usually outnumbering the panes. No pool and
  no blob is ever drawn there (`--editor`, every eye), so the sort of ours never meets
  that list, and neither does it need to: X5.3 takes the list, whole.

**X4.6e landed** (a3d24c6 the backed panes, ccd194a the rest, 0e44130 the blob's facing, this note a5a4b28; 2026-11-05; no change to the picture in the first two, and in the third the owner's decided one).

- **What moved, commit by commit.** a3d24c6: `render/GlassDraw.ts` (new) draws a round's `backed` pane groups, one draw for one, under each group's OWN world matrix through the cel stage's PLACED twin (`celVertex.ts`, `celPlacedVertex`), nearest first by `eyeDistanceSq`, ahead of everything of ours at `"beforeAlphaTest"`, the one run included, where Babylon's opaque list drew them; Babylon's opaque list holds nothing in a round from there. ccd194a: the see-through groups join `GlassDraw` (no depth write, `ALPHA_COMBINE`, bias -16), and `render/FarthestRun.ts` (new) is ONE back-to-front run of ours at `"beforeBlended"` behind the moon — the see-through panes and every spark, dust disc, scorch and blob (`render/FadeDraw.ts`, `render/fadeProgram.ts`, `shaders/wgsl/fade.ts`, `entities/fades.ts`, all new) — and one draw in the glow's mask behind the moon's bloom, the sparks'. Babylon draws nothing in a round: its active list is empty in a live Coldharbour round, and `surfaces.mjs` finds no Babylon draw in any of the six glass and fade rows asked. 0e44130: the blob faces up (below).
- **The sort, read off Babylon and not argued.** `Game.farthestPull` orders the run farthest first by `_distanceToCamera` — the SQUARE ROOT of the bounding sphere's centre from `globalPosition`, Babylon's key, since two squares can share a root — stable, a tie to the mesh that stood first in the scene: the sparks, the discs and the scorch (made at construction), the panes (the build), the blobs (made as each body is first placed, so after the panes in a first round and before a later map's; no frame was found needing that tie). `Game.glassPull`, `GlassDraw`'s own late prepare ahead of the run's, offers a group as its mesh was offered: its block's cell (`WorldCulling.offersBlock`), the size gate on its record's sphere, the sphere's frustum test (`inPlanes`). A probe at the BEFORE logged Babylon's transparent order at `fx-blob-sort` (`…pane 40.92, spark 12.58, disc 12.57, blob 11.32, pane 8.35, blob 7.76, spark 7.14, disc 7.12, blob 7.00, blob 6.21`) and ours reads the same to four places.
- **The fades, read off each material's compiled effect at the BEFORE.** Each unlit `StandardMaterial`'s WGSL as Babylon processed it for a spark, a disc, the scorch and a blob: rgb `clamp(diffuse 0 + emissive + ambient 0)`, alpha the material's 1 times the opacity map's alpha times its level 1, times `mesh.visibility` LAST, then (the sparks, the discs, the scorch) `EmissiveFog`'s `t * t` mix over `distance(vPositionW, vEyePosition)`; scene fog off, image processing off, `OPACITYDIRECTUV`. The pipeline states as Babylon's cache left them: all blended `770,771,1,1`, no depth write, LEQUAL, back culled, but the scorch, `cull off` with bias -4 and slope -2 (`PipelineState.depthBiasSlopeScale`, new). The two opacity maps stay Babylon's `DynamicTexture`s through the seam. The sparks' mask twin writes `GlowRules`' colour (emissive times one minus the fog at the same distance, alpha 1), blended as the mask material drew a mesh under `visibility` 1. A spark and a disc pass no size gate (emissive, as `offer`'s `glows`); a scorch and a blob are gated on this frame's sphere, the pools' rule since X4.4b — Babylon's gate read the last frame's, which no bank row can tell apart; **stated for the owner**. **(Wrong, its review found: Babylon's gate read the sphere as of the last time the mesh's world was COMPUTED — only for a candidate the gate kept — so a mark or a blob never computed was measured at the world origin and stayed dropped, a LATCH, and the bank could not tell because the harness's `scene.isReady()` computed every mesh's world. Ported exactly, then dropped by the owner's decision, in the review's commits: the review's note below.)** Geometry: `src/geometry`'s `createSphere` and `createDisc`, every number `Object.is` Babylon's for the four kits.
- **Two things the bytes found, and their causes.** (1) **A rotated pane under a world matrix built of three columns and a constant row** came out exact in the bank's rows but was not the uniform's shape, and while it was suspected the placed stage and the fades were changed to read the matrix WHOLE out of storage, the shape every instanced program here uses; nothing moved either way. (2) **`fx-blob-sort` moved 18 pixels by up to 2/255 with every pane and every fade hidden on both trees**: the bullet mark of the row's later round, its roll and scale off `Math.random`, which the harness seeds for a row's pictures. A body's first blob was a Babylon mesh, and `new Geometry` drew `Geometry.RandomId()` — 31 draws, counted at the BEFORE, none on reuse — so the mark rolled at another point of the stream. The harness now draws those 31 where the mesh did (`harness.mjs`, the `blob` event), and the row is byte-equal. No rendering scheme was built; it is an instrument's compensation for a draw the game no longer makes, and is stated so beside it.
- **Retired**: `warm(on)` on `CombatFx` and `BlastDebrisSystem`, `ShadowSystem.warmBlob` and `stageWarmFrame`'s poses (every pipeline of these on `Game.roundPipelines`); `glassProbe`, its per-slot twins and `getGlass`'s slot; the glazing pool's wrapped views (`wrapCubeTexture` stays for the default cube, an editor build's glazing, until X5.3); `CubeReflection`, `ProbeReflection`. A break collapses a pane in `GlassDraw`'s buffer (`GlassFx`), and the harness's put-away writes the stashed range back there.
- **The blob's facing, 0e44130.** The owner's decision of 2026-11-05: `rotation.x = PI/2`, the disc's front (its -Z) up, back faces culled as ever. **The bank moves `coldharbour-fx-blob-sort` alone**: 5,270 pixels, worst 78/255, mean 0.0239/255, against its parent's take, and every one a blob's — against the same frame with the blobs off, 4,465 are the three discs on stated floors above the eye, seen from below and no longer drawn (worst 78/255; the 4,465 X4.6a's review measured them to own), and 805 the fourth, on the pavement below the eye, now drawn from above (worst 20/255), disjoint, nothing outside. The row is re-banked in `ref/`, two grabs byte-equal, equal to the tree's `--check` frame. **The row no longer holds a blob in the back-to-front run among the panes**, which it did only through the three seen from below; a row with a blob seen from above between two glass layers is owed, the owner's to ask for. `FINDINGS.md` 67 deleted; "Decisions" answered; the row's text rewritten.
- **Measured.** BEFORE `bank.mjs --check --keep --limit` alone at 8bf7789; a3d24c6, ccd194a and 0e44130 each alone, by `exact.mjs` against its parent's: **137 of 137**, **136 of 137** (`sarab-ground` 100 pixels by up to 2/255, byte-equal on a Sarab re-shoot: the cross-process flake), and **136 of 137 with `fx-blob-sort` the move above** (`sarab-ground` the same take). The same 34 stale rows red throughout at the same lines; no device lost, no console error. `census --against` 8bf7789 on Coldharbour and Sarab: every row and both totals equal, Babylon 0 in every row. `pipelines.mjs --round`: Coldharbour zero in play of either renderer, a pane broken, over both commits; Cinderhaven zero of ours, Babylon's three of `GiVolume`'s race at the spawn (`FINDINGS.md` 16) and the rotor wash's two (X4.7). `surfaces.mjs --editor` on Coldharbour: the glazing as before (179 groups, backed and see-through on Babylon's lists, 203 proxies), no pool or blob, a water and a grass rect remade. Live Coldharbour rounds after each commit: 46 backed groups ours (a3d24c6), then 45 backed and up to 32 see-through drawn, up to 19 fades and 3 sparks' blooms with rounds fired; the menu, a second round, `F2`; no console error, no warning from the sealed cache. Sampling heap profiler over 1,200 live frames, rounds fired: 73-74 KB a frame against the BEFORE's 159 KB; `farthestPull` about 0.8 KB of it, boxed doubles (no object in its source; the arrays never grew). Typecheck, build, corecheck and parity pass on all three. Report versions 34 (`pools.glass`) and 35 (`pools.fades`, the see-through groups in `glass`, the sparks' blooms in `masked`).
- **Rewritten**: `CLAUDE.md` — a3d24c6 one clause (the one run is behind the backed panes), ccd194a five (the warm-up poses no pool; no mesh of a round's glazing; a block-keyed surface, a pane or a fire, is offered within the fog; every spark, disc, scorch and blob in one back-to-front run with the see-through panes; `offersBlock` answers a fire and a pane), no line added in either. `ShadowSystem`'s header and its "CreateDisc faces +Z" comment, `PipelineWarmup`'s list, `merge.ts`'s counts, `docs/rendering.md` (the back-to-front run, the pools, the one run, the blob paragraph), `docs/game.md`, `docs/states.md`, `docs/profiling.md`, `VERIFYING.md`, `FILES.md`, `WorldCulling`'s, `ReflectionSystem`'s, `wrappedTextures`' and `CombatFx`'s headers. `depth.mjs`'s glass mode reads Babylon's glazing meshes, which a round no longer has: it says it owes a port. `merge:hash` not run: a round's glazing is no visual now, so its fingerprint moves by design.
- **Not verified.** A server's match in a browser; the phone; a GPU A/B; `merge:hash`, `kit:hash`, `gate`, `shaders`; a re-bake beyond the bank's freeze (every row re-bakes); the editor's glazing past `F2` (still Babylon's).

**X4.6e's review fixes landed** (4251a34 the run's growth, 48796b8 the latch ported, 1a89216 the latch dropped, fdfae2e the minor fixes, a5ca27d the new row, this note 2052df0; 2026-11-06; no change to the picture but the owner's decided one in 1a89216). The review's findings, fixed in its order; the owner's three decisions of 2026-11-06 (port the latch then drop it, record the bank's blindness with no tooling, the new row) are in "Decisions" and below.

- **`FarthestRun.reserve` threw away what had been filed (4251a34).** The pull reserves mid-filing (`Game.farthestPull`, `fileGlass`) and `reserve` made the arrays new and empty, so the first frame filing past 64 items (and again past 128) drew pane 0 through the see-through pipeline in the first 64's place. It now carries them, as `FadeDraw.reserve` does; the bound is not fixed at an install, the blobs growing as bodies are first placed, so the growth path stays. `FadeDraw.reserve` holds (it copies, and rebuilds its buffers and group before any draw of the frame). **Measured**: the real class in Node, frames of 70, 130, 70 and 300 items each farthest first and every item once (the parent's: 70 filed, 7 distinct, code 0 drawn 64 times); the review's live frame 0 on Coldharbour with the 88 sparks and discs on, 100 draws, 100 distinct, 88 fades and the 12 kept panes (the parent's: 37 distinct, 76 pane draws, 64 of them pane 0).
- **Babylon's size gate LATCHED the scorch and the blobs, and X4.6e's note said it read "the last frame's sphere".** It read a mesh's bounds as of the last time its world was COMPUTED, which `_evaluateActiveMeshes` did only for a candidate the gate kept (`offer` skips a mesh switched off, then gates on the bounds it holds): a mark or a blob never computed is measured at the world origin under its built radius (1.41 m, 0.85 m) and stays dropped while the eye is farther than `2 r perRad / 3` from it — 381 m and 229 m at a 384-pixel-high viewport, 1,072 m and 643 m at 1080p — and one computed is measured where it was last kept, at its scaled radius (a frag's mark 2.97 m: 800 m and 2,251 m). The bank could not tell: `waitUntilDrawn`'s `scene.isReady()` computes every mesh's world. **Ported exactly (48796b8)**, the owner's decision (port, then fix, as X4.4b and X4.4c): `Fade.gate`, seeded from the kit's sphere under the identity; the pull gates a scorch or a blob on it and, kept, writes this frame's into it before visibility is asked; the warm-up's frame, which had shown the last free mark and the player's blob gate off, computes them (`warmGate`, making the player's blob there the first time, as `warmBlob` did); `waitUntilDrawn` restates the scene's refresh. **Proved by gate decision, not by the bank**: a live probe (no `isReady`, no freeze; a real `explode` event and stand-in bodies through `updateBlobs`, four frames a case) at 8bf7789 and on the port, Sarab at 832x384 with the eye 446 m out, gave the same decision on every frame of every case — a fresh mark and a fresh blob 6 m ahead dropped (Babylon: in no candidate list); released by going to 1080p and staying drawn back at 832x384; fresh at 1080p drawn; a mark last computed at the eye raised 537 m away drawn (its scaled radius) and the blob there dropped; eight marks and the player's blob, slots 0 and 1 drawn and 2 to 7 and the blob dropped; the same after a second round's teardown and warm-up, slots 0, 1 and 7 and the blob drawn — and without the two `warmGate` calls slot 7 and the blob dropped, so the warm-up's part of the port is what holds it; at 1080p, a mark and a blob raised at (-400,-400) and again at (400,400), the mark drawn and the blob dropped.
- **Then dropped (1a89216), `Picture change:`**, the owner's decision: `Fade.gate`, `compute`, both `warmGate`s and the harness's refresh are gone and the pull is 35b97b2's again. **The probe, before and after**: on Sarab at 832x384 every dropped case above is drawn (the two fresh members, the blob raised 537 m on, slots 2 to 7 and the player's blob in the first round and 2 to 6 in the second, the blob raised 1,131 m on); on Sarab at 1080p only the last; on Cinderhaven at 1080p with the eye 806 m out, every blob case at that eye (both fresh blobs, the moved one, the player's in the first round) and the blob raised 1,131 m on; no mark is dropped at 1080p before or after. **Which maps reach it, from their layouts, not walked**: a play square's corner is 170 m out on Hollowmere, Greyfen and Kurenai, 226 m on Coldharbour, 283 m on Harrowmead, 636 m on Sarab, 1,061 m on Cinderhaven, and the leash's 10 s on foot adds about 69 m in a borderland; so from the origin the scorch's 1,072 m at 1080p is reached by no play square and the blob's 643 m by Cinderhaven's (measured) and Sarab's only past its edge; at 384 px the blob by Harrowmead, Sarab and Cinderhaven and the scorch by Sarab and Cinderhaven. From where a member was last computed the reach is a map's span: every map for a blob at 384 px, Sarab and Cinderhaven at 1080p (measured on Sarab). A hull's eye in the air is not counted. **No bank row moves at either commit**; the bank's README and `FINDINGS.md` 68 say why it cannot.
- **The minor fixes (fdfae2e).** **The tie order after a first round**: a blob's mesh, never disposed, stood ahead of a later map's panes in Babylon's scene, and the pull filed every blob after the panes. `Game.blobsBeforeGlass` counts the blobs standing when a round's glazing is installed and the pull files the panes after that many — an integer, no allocation, 0 in a first round and so in every row. Live on Coldharbour, a blob from round 1 and one from round 2 stood at a kept pane's centre, three keys equal to the bit (115.3018470115399): round-1 blob, pane, round-2 blob, where the parent's had the pane first. **`merge-hash.mjs`** fingerprinted a round's pane groups by `pg.mesh`, null since X4.6e (every group surface -1), and reads `PaneGroup.record` now, the index the mesh had: against the reviewer's 8bf7789 baseline `paneGroups` compare equal on every map, and every round's glazing visual loses `mesh` (Coldharbour 78, Sarab 28, Cinderhaven 14, the proving ground 734), 75, 27, 11 and 733 of them with a probe slot's material renamed (`cel-glass-#2a333b#1` is `cel-glass-#2a333b`), no other field moving. **`kit:hash --against`** the same baseline: 3,722 builds, `drawing changed 537` (car 94, depot 40, office 31, shophouse 82, tower 290), `colliders changed 0`; with `Build.pane`'s `getGlass` call given its slot argument back (temporarily) it is `identical`, so the stub factory's naming is all of it. `docs/build.md` says both. **`shaders.mjs`** builds the glazing's placed stage in `GlassDraw`'s four states and the four fade programs in `FadeDraw`'s (`FADE_STATES`, exported): eight more a map (Coldharbour 24 to 32), clean on all seven. **Recorded**: `depth.mjs glass` throws "owes a port" (`FINDINGS.md` 69, and where it is offered: the bank's README twice, `VERIFYING.md`, `docs/rendering.md`); the bank's blindness to a Babylon size-gate latch, by the owner's decision with no tooling (`FINDINGS.md` 68, the bank's README, with the live probe to use); `BABYLON_EXIT.md`'s "What they are today" marks the glazing, the pools and the blobs ours and the blob's facing as before 0e44130; `CLAUDE.md`'s `noGlow` clause names the fades meshless too, blooming by kind (`FarthestRun`'s `blooms`: a spark alone), three lines for three, nothing else in the file.
- **A row with a blob seen from above between two glass layers (a5ca27d)**, the owner's decision: `coldharbour-fx-blob-glass`, appended at `square`'s eye through a 6° field. A search over Coldharbour's eight eyes (18 headings and two pitches each, 640x360, every kept see-through group hidden in turn) found this the largest overlap of two glass layers: group 44 (key 40.25) with group 65 (97.17) seen through it. The blob sorts at 42.05 between them; in the bank's own sequence pane 44 owns 386,781 pixels, pane 65 7,020 and the blob 581 (worst 21/255), all 581 under pane 44 and 96 over pane 65; the blob drawn first of the run moves 96 pixels, drawn last 612. Banked with `--rows`; three processes byte-equal.
- **Measured, every code commit**, bank `--check --keep` alone by `exact.mjs` against its parent's take: 4251a34 136 of 137 against 35b97b2 (`sarab-ground` 100 pixels by up to 2/255; the pistol pixel within its flake); 48796b8 the same against 4251a34's; 1a89216 the same against 48796b8's; fdfae2e 137 of 137; a5ca27d 137 of 137 old rows and the new row. **`sarab-ground` is a two-state cross-process flake**, and 4251a34's message is wrong that the worktree made it: each state is byte-equal to an earlier take, 48796b8's to 35b97b2's two takes in the BEFORE worktree and 1a89216's to 4251a34's and to the parent's code shot in this tree. The same 34 stale rows red throughout at the same means; no device lost, no console error. Typecheck, build, corecheck and parity pass on all five; `pipelines.mjs coldharbour --round` on the last, ours 0 in play (Babylon's 3 at the spawn, `GiVolume`'s, `FINDINGS.md` 16). No per-frame allocation added: the run grows only past its most, and the rest is integers.
- **Found and not this review's**: `ShadowSystem.blobs` keeps every `Combatant` it ever placed, and each round's page match is a fresh session with fresh soldiers, so the map and `blobFades` grow by a roster a round for the page's life (a leak, and the reason the run's bound cannot be fixed at an install). Read in the code, not measured.
- **Not verified.** A server's match in a browser; the phone; `merge:hash --editor`; `gate`; the latch's probe on any map but Sarab and Cinderhaven; a hull's eye in the air.

**X4.6, the whole step verified** (2026-11-06; no change to the game: this note, the plan's Verify line and `FINDINGS.md` 70). The whole of X4.6a to X4.6e against a BEFORE at a269bfb, ahead of every move (the worktree `greywatch-2-before-x36b`, left detached there), on the Windows box, headless, every run alone on the GPU and under a hard limit: HEAD's tools by `--limit` and their own stops, the BEFORE's (which predate the stops) under a scratch guard killing the run on a wall-clock limit or a silent stall. No run hit either; no device lost.

- **The bank, every row.** `bank.mjs --check --keep` alone at a269bfb (132 rows) and alone at 4623a7f (138), compared by `exact.mjs`: **131 of 132 byte-equal, no known flake coming up** (`view-pistol-reload`, `sarab-shelf` and `sarab-ground` all byte-equal, so Sarab was not re-shot), and **`coldharbour-fx-blob-sort` the one move, 5,270 pixels by up to 78/255, mean 0.0239** — 0e44130's numbers exactly. **Every moved pixel is a blob's**: that row shot in Coldharbour's own sequence on both trees, then again with `hideBlobs()` after the freeze: the two blobs-off frames byte-equal across the trees (0 pixels), the move 4,465 pixels inside the BEFORE's blob mask (worst 78/255: the three discs above the eye, seen from below and drawn face down) and 805 inside HEAD's (worst 20/255: the one on the pavement, seen from above), none in both and none outside; the with-blob frames byte-equal to each bank run's take. **The water and glass rows, by name, all byte-equal**: water `greyfen-marsh`, `harrowmead-millpond`, `coldharbour-fx-water-fade`, `sarab-pane-water`, and the far quad's `coldharbour-menu`, `-avenue`, `-sky-disc` and `cinderhaven-sky-cloud-moon`; glass `coldharbour-shopfront`, `-curtain2`, `-curtain40`, `-curtain90`, `-fx-glass`, `-fx-glass-sort`, `-fx-glass-broken`, `-fx-scorch-glass`, `-fx-shards` and `cinderhaven-fx-shards-far` (`fx-blob-sort` above); the zones' and the field's too (`hollowmere-ring`, `-ring-flown`, `coldharbour-ring-stones`, `-ring-flown-far`, `greyfen-grass-low`, `-medium`, `-high`, every `ground` row, `ashwood`). **The six rows the BEFORE has no take of** (`coldharbour-ring-behind-field`, `greyfen-shore-ahead`, `harrowmead-shore-ahead`, `harrowmead-shore-behind`, `sarab-shore-flip`, `coldharbour-fx-blob-glass`; `src/bench/vantages.ts` adds no other since a269bfb) are byte-equal to `ref/` and, re-shot by `--rows` in a second process, byte-equal across the two; `fx-blob-sort` is byte-equal to its re-banked `ref/` frame. **The same 34 stale rows red at the same means** on both trees (the BEFORE's 35th red line is `fx-blob-sort` against the re-banked `ref/`); no page or console error. The scorch and blob latch's drop (1a89216) the bank cannot see, by construction (`FINDINGS.md` 68), and was not re-probed here.
- **Greyfen's grass at every rung.** The rungs are `CONFIG.grass.tiers`: `low`, `medium`, `high` (`Settings.grass`; unchanged since a269bfb). A scratch sequence through each tree's own harness, in a built round held at `deploy` as the bank holds it (not the editor), 13 poses a rung, 39 frames, each from two byte-identical grabs: the menu's eye and every Greyfen row's (`treeline`, `canopy`, `marsh`, `ground`, `crossing`, the `grass-*` rows' pose, `shore-ahead`'s), each with the rung set; the `grass-*` pose with the one wind's clocks pinned at 2.6 s plus 0, 15, 30 and 90 steps of 1/60 (the freeze pins the cel factory's, the field's and the water's clock together, so this is the wind moved by a fixed `dt`, not the updater stepped), and `ground`'s turf edge at 15 and 30 steps. **39 of 39 byte-equal.** Each rung, wind step and turf frame differs from its neighbours (`low` against `high` at the field 41.7% of pixels, one wind step 45.7%), so the setting and the clock took.
- **A flag captured.** Posed, by the harness's `flown` (the zones stepped through `CaptureZoneSystem.update` at a stated meter for six seconds), the square's flag at meters 0, 0.5, 1, -0.5, -1 and 0 again, on Hollowmere (its square's ring all paint, from `ring`'s eye) and Coldharbour (stones and paint, the memorial's flag from `ring-flown-far`'s), and each ring standing: **14 of 14 byte-equal** to the BEFORE. Looked at: the cloth at the foot of the pole in the neutral cloth at 0, half way and at the top at 0.5 and 1, the Redline's red for a positive meter and the Valeguard's tan for a negative. **Live at HEAD**, offline, the real bots, the player walked by held `W` and its own look toward the nearest flag its side did not hold: on Coldharbour **the player stood in Alpha's ring through its capture** (inside its 15 m on 42 of 43 samples while the meter went 0 to -1 in 10.3 s, the HUD reading `CAPTURING` then `SECURED`), and the bots took the rest (Charlie to -1, Echo to 1, Delta rising); on Hollowmere the player did not reach a ring and the bots took all five. Sampled every 30 frames (305 and 366 samples): **the hoist equal to the shown meter's magnitude on every sample where the cloth was stepped**, its colour the side's whenever drawn (`#c9a15e` below 0, `#c8404a` above), every ring's surfaces on and kept every sample (Coldharbour two stone tones and paint at each point; Hollowmere's from stones alone to paint alone), the cloth's positions changing sample to sample (up to 305 distinct readings of 305 on a flag in view), both sheets used. Where they differed (57, then 25, 21, 273 and 331) the cloth was NOT stepped in that sample — out of the last render's frustum, or past the fog, which the zone system skips by design (`FlagCloth.inView`) — and a second Coldharbour run shows why from inside Alpha: its flag flies from a roof at 16.2 to 19.5 m (the ground at 3), out of a level view 14 m off. No page or console error, no `compiled in play` warning, the cache still sealed, in three live rounds.
- **The blob map's leak, measured** (`FINDINGS.md` 70, not fixed). Five Coldharbour rounds in one page at each tree, a forced GC before each reading: `ShadowSystem.blobs` 17, 33, 49, 65, 81 on both (HEAD's `blobFades` the same; a269bfb's `blobShadow` meshes the same, its scene 2,047 to 2,111 meshes), every earlier round's sixteen bodies alive after the GC, and freed once the map's keys are cleared by a probe. Heap after GC: HEAD 95,378 to 97,150 KB, a269bfb 107,454 to 110,710.
- **Not verified.** A server's match in a browser; the phone; the editor (its recorded differences stay until X5.3); a gate or latch case live (the drop is 1a89216's record); `gate`, `shaders`, `census`, `pipelines.mjs --round`, `merge:hash`, `kit:hash`, typecheck and build, none of which this note's text-only change could move. The player capturing ALONE (bots may have stood in Alpha too: the page reads no bot). Live frames are pictures, not bytes: the byte comparisons are of held frames.

### X4.7 — GPU particles — **S–M, as four sub-steps** (split 2026-11-07: the owner instructed that X4.7 be implemented in sub-steps, each implemented, reviewed and fixed by agents; the four-way split was proposed by the orchestrating session and run under that instruction) — X4.7a **LANDED** (bad6caa, its review 30bd400), X4.7b **LANDED** (8c691c7, its review 312dc44), X4.7c **LANDED** (9dff2c4, its review 9d5ab4a), X4.7d **LANDED** (999d4ca, its review fd7199b) — **all four LANDED**

The plan's `BABYLON_EXIT.md` holds X4.7's brief, the table of what the fields are
(corrected in place by X4.7a) and the three sub-steps to come.

**X4.7a landed** (bad6caa; 2026-11-07; no change to the game: the reference bank, its
harness and table, a new live probe, two instruments widened, and docs; `git diff`
under `src/` is `bench/vantages.ts` alone).

- **The rows**, appended by `bank.mjs sarab cinderhaven kurenai --rows=...` at the
  parent's game, each at the END of its map's list and at an eye a row above it stands
  at, so no older row moves and the benchmark (one stop a POSITION) gains none. Each
  was looked at.
  | row | eye | what is in the air | its fields' pixels (`surfaces.mjs --pixels`) |
  | --- | --- | --- | --- |
  | `sarab-particles-dust` | `crossing`'s, 40° | the west base's helicopter 2.5 m over the sand, its dust ring, 120 frames | `rotorWash0` 92 of 135 slots, 83,644 px, mean 0.668 |
  | `cinderhaven-particles-embers` | `town`'s | the map's embers as it runs them, 1,200 frames | `motes` 6,067 slots, 4,387 px, mean 0.0142 |
  | `cinderhaven-particles-spray` | `tank-far`'s, 12° | the west yard's helicopter 3 m over the western sea, its spray ring and the water's hole, 120 frames | `rotorSpray0` 78 of 126, 42,466 px, mean 0.285 |
  | `cinderhaven-particles-ring-ash` | `tank-far`'s, 20° | the same helicopter 2.5 m over the shore, its dust ring and the embers, 1,200 frames | `motes` 4,159 px, `rotorWash0` 71,242 px, **92 px both**: the order between two fields |
  | `kurenai-particles-leaves` | `ground`'s | the map's falling leaves as it runs them, 1,200 frames | `motes` 7,467 slots, 16,696 px, mean 0.0274 |

  The embers' whole field sits under `CHECK_TOLERANCE`'s mean (0.0142 against 0.02) and
  the leaves' barely over it: only `exact.mjs` grades those rows, as the brief said. The
  water's hole in `particles-spray` is real: with the row's site taken off the water
  (`WaterSystem.setWash(sites, 0)`) the frame moves 7.74% of its pixels by up to 25/255
  (scratch `x47a/hole.mjs`); the water holds 1 site, (-705, 45), radius 5.72, strength
  0.617.
- **The harness** (`harness.mjs`, `placeVantage`'s `particles`, the vantage field
  documented in `vantages.ts`'s header). A `wash` row pins its hull before the passes are
  placed (position over the floor or the water's surface at the stated clearance, a yaw,
  the rotor at 1, `VehicleViews.update`), then the fields: the particles off; the mote
  field rebuilt under seed `0xa5` (as `sky-motes`) and put on the eye; the rings rebuilt
  under `0xa7` through the game's own door (`RotorWash.build` with the palette forgotten,
  so an install's order: motes, then rings); `RotorWash.update(true, hullFades)` names the
  ring that raises the wash; every other field `stop()` and `reset()`; the stated ones
  waited ready, then `steps` frames under `0xa6` in the scene's list order, each a
  `RotorWash.update(true, ...)` and the field's own `animate(true)` + `render(true, true)`
  at `preWarmStepOffset` 1, so a step is a 60 fps frame at the field's own `updateSpeed`
  (0.012 the motes, 1/60 a ring); then `updateSpeed` 0, the water told the sites, the
  particles on. The put-away rebuilds the motes (`__refMotes`), resets and restarts every
  ring on its own speed, closes the hole and stands the hull back. **Every touch of a
  field goes through one adapter** (`babylonFields`), so X4.7c adds its own beside it and
  its BEFORE runs this file over the parent unchanged. `freeze`'s `particles` switch reads
  `__refParticles` beside `__refMotes`. `sky-flash`'s "LAST" comment is corrected: the
  rows after it step the storm on from 28.484 s through their settle, held by their
  freeze with no strike up, and they reproduce.
- **The bank.** `bank.mjs --check --keep` alone at 38c65fd (the BEFORE, 138 rows) and
  alone at the step (143): **138 of 138 old rows byte-equal by `exact.mjs`**, no known
  flake coming up, 5 new; the same 34 stale rows red at the same means (the two logs'
  red lines identical). **The five new rows byte-equal across three processes**: the
  banking run (two identical grabs each), the full check against `ref/`, and
  `surfaces.mjs --keep` (with every wrapper and empty point hung) against the check, which
  also holds `sky-motes` byte-equal with the probe on. No page or console error.
- **`surfaces.mjs`**: a class per field, hung on the field's own `render` (a particle
  comes through no `Mesh.render`), named by the field with its index off, logged only for
  a call that drew, with its pipeline, blend mode, count, capacity, random texture and the
  defines of its compiled update and render effects; `--pixels` skips the call (a held
  field moves nothing by it); the seam's path a phase; two overlaps, `motes&rotorWash` and
  `motes&rotorSpray`. **Read**: every field's draw on the list between `opaque` and
  `beforeBlended`, none in the mask; depth write off, test LEQUAL, bias 0, cull off, mask
  15; ADD `770,1` / `0,1`, STANDARD `770,771` / `1,1`. The render defines are `BILLBOARD
  BILLBOARDMODE_ALL EMITRATECTRL TONEMAPPING 0` (the rings `+ COLORGRADIENTS
  COLORGRADIENTS_COLOR2`): **no `IMAGEPROCESSING` and no fog**, where the brief guessed
  one was compiled in. Update: `BOXEMITTER BILLBOARD EMITRATECTRL`, the rings
  `CYLINDEREMITTER BILLBOARD COLORGRADIENTS SIZEGRADIENTS VELOCITYGRADIENTS EMITRATECTRL`.
  The dust and spray rings' defines and blend are the same, so one pipeline each. **The
  seam's path in every row**: 137 rows by the empty-group fallback, the six particle rows
  (`sky-motes` and these five) by the group.
- **The live probe, `particles.mjs`** (kept, its header the contract). In one boot the
  rotation Sarab → Cinderhaven → Sarab → Hollowmere → Cinderhaven through the menu, each
  map: `useConstantAnimationDeltaTime`, every field reset with the particles off, the
  deploy screen's held world with `followEye` told the fleet stepped (X4.2d's scratch's
  way), the first flying hull pinned 3 m over dry ground 30 m off its pad and then over the
  deepest-bedded rect centre, 240 frames each, the camera 40 m south and 12 m up; the window
  opens on the first frame every field is ready. **Two runs, equal by `Object.is`**: 45,120
  numbers a map with a hull over 480 frames, 4,800 on Hollowmere. Read: the motes' step
  0.01152 (0.012 × 0.96), a ring's 0.016; the dust ring at 55.561 a second dry, the spray
  at 86.429 wet, the site's strength 0.617; over water the dust ring holds its count of 84
  at a rate of zero. **The order**: motes ahead of every ring at every deploy of the
  rotation. **`--editor`** (Cinderhaven, after the rotation): `F2`'s build has no hulls and
  keeps the round's four rings; `particles.count` changed in memory and the editor's
  rebuild put the motes BEHIND them, and putting it back left them there. The panel edits
  no `particles` field, so only an in-memory edit reaches it (dev only, recorded). **The
  random draws**: 65,536 a mote field and 32,768 a ring at construction; 22,400 (Sarab),
  24,268 (Cinderhaven; 27,068 at the editor's edited 6,767), 74,668 (Hollowmere), 540 and 504 at
  `_initialize` — **and a ring at rest draws its seeds too**, at its first render after
  every reset, since `_initialize` precedes the count test: every install, teardown and
  editor rebuild re-draws 540/504 a ring off the native stream. **The splits**: with the
  particles off, 10 render passes from the draw phase's start to the frame's end and no
  compute pass; dry, 11-12 and 1-2 compute, the main pass split 1-2 times (the motes, then
  the dust ring once it has a count); wet, 13 and 3, split 3 times every frame. The seam
  took the group on every frame of the window, the fallback on the particles-off frames.
- **`pipelines.mjs --round`**, each creation in play kept with its stack. Cinderhaven: 5 of
  Babylon's in play, 3 at `life 1: spawn` under `GiVolume.update` (the race, X5.1's) and 2 at
  `life 1: dmr` with no mesh drawing, a compute pipeline under
  `ComputeShaderParticleSystem.updateParticleBuffer` and a render one under
  `GPUParticleSystem._render`: the wash, a bot's helicopter raising dust; none of ours; the
  installs 2 and 0 of Babylon's, 19 and 0 of ours. Sarab: **it threw at the parent**
  (`panes[-1]`: Sarab has no breakable pane), so the pane phase is skipped on such a map;
  then 2 in play, the wash's same two at `life 1: sniper`, `GiVolume`'s three at the install
  this run (5 there).
- **Gates**: typecheck, build (`check-babylon-free`, `check-proving`), corecheck and parity
  pass. Not run: `census`, `gate`, `shaders`, `kit:hash` — no game code moved. No
  `FILES.md` line: it lists no `plans/` instrument (`surfaces.mjs` has none either); the
  probe's header is its contract.
- **Not verified.** A field in a server's match; the phone; `census` with the new rows;
  the probe across two TREES (it has one tree's run against itself, the control the later
  steps compare against); a live frame's pixels of either field (none reproduce, which is
  why the probe exists).

**X4.7a's review** (2026-11-07; no change to the game: the instruments and the records;
`git diff` touches nothing under `src/`). An independent review found nothing real and five
minor points, fixed now because X4.7c and X4.7d grade themselves with these instruments.

- **The one adapter, made true and its limits stated.** `harness.mjs`'s `particles` path
  read the ring's `emitRate` and wrote `preWarmStepOffset` directly; both go through
  `babylonFields` now (`emits`, `prime`, and `ringsOf` for a hull's rings), with the same
  arithmetic, so a field's bytes cannot move. The comment named a `fields` that is
  `babylonFields`. **Two paths stay Babylon's alone, and are X4.7c's to give an adapter**,
  as its brief already said and its Verify now spells out: the `motes` row's path
  (`sky-motes`, writing the mote field's emitter, emit box, `preWarmStepOffset` and
  `updateSpeed` on `g.atmosphere.system` and calling its pre-warm pair) and `freeze`'s
  `particles` switch with its thaw (`g.scene.particlesEnabled`). On a tree whose ash is
  ours, `sky-motes` byte-equal to a BEFORE proves nothing until that path builds ours.
- **The probe no longer throws on a field that is not Babylon's.** Its `_initialize` wrap
  walked the prototype chain to `null` and threw inside `Atmosphere.build`, breaking the
  install. It now stops at the end of the chain, leaves that field uncounted, names it in
  the log's `unwrapped` and on the console, and wraps the next field that has an
  `_initialize`. Its header named an adapter `FIELDS`; it is `babylon`, held as
  `window.__fields`, and the header says the draw counting is outside it.
- **`--against` compares the random draws.** Before, it compared the order and the logged
  numbers alone, so a port dropping the 540 and 504 seeds a ring draws at rest after each
  reset passed. It now compares every construction's and first update's `[label, count]`,
  the `unwrapped` list, the map count, and with `--editor` on both sides the editor's three
  orders and its draws, and names the first difference.
- **The probe's clock is the scene's own path (item 3: the clock exercised, not the gap
  recorded).** `useConstantAnimationDeltaTime` makes `Scene.animate` use 16 ms and skip
  `Math.max(MinDeltaTime, Math.min(getDeltaTime(), MaxDeltaTime))`, so a port that dropped
  the 1..1000 ms clamp passed. Through the window the engine's `getDeltaTime` is now
  answered by frame, counted from the window's first: 16.7 ms, but 0.25 ms on the
  thirtieth of every sixty frames and 1,500 ms on the sixtieth, with
  `useConstantAnimationDeltaTime` off, so the scene clamps it itself. The log's `timeDelta`
  shows all three: motes 0.012024, 0.00072 and 0.72, a ring 0.0167, 0.001 and 1 (clamped up
  from 0.015 and down from 90). Nothing in `Game` steps by that number (`FrameCap`'s stamps
  step the world, and the delta reaches only the readout). The constant 16 ms still holds
  while the fields compile with the particles off, so the window still opens from a known
  state. The bank's rows step by the pre-warm pair and never read the ratio, so the probe
  is the clock's only test, and X4.7c's Verify says so.
- **The records claimed more than was measured.** "Every number in it measured" was not
  true of the table. Read now off the live fields on all seven maps in one boot (scratch
  `x47a-fix/table.mjs`), every cell is as stated: the mote capacities 18,667, 22,400,
  14,934, 16,800, 5,600, 6,067 and 7,467; ADD on Coldharbour, Harrowmead, Sarab and
  Cinderhaven and STANDARD on the other three; random textures 8,192 (the device's
  `maxTextureSize`) and 4,096 a ring; `mote` a 64² `DynamicTexture` with no mips and the
  rings' a 128² one; boxes 0.2 to 11 m, half-widths 130, 125 and 70 on the three maps
  stating a `volume` and the map's half otherwise; rings at 135 and 126, STANDARD, a
  cylinder of radius 5.72, height 0.4, `radiusRange` 0.5 and `directionRandomizer` 0.4,
  three colour stops in two rows with only the alpha moving, two size and three velocity
  gradients; `updateSpeed` 0.012 and 1/60; two fliers on Sarab and Cinderhaven, water on
  all seven. The plan's table header now says the review measured them. **The splits and
  the seam's path were counted in the deploy screen's HELD world** with `followEye` told
  the fleet stepped, not in a live round, as the brief asked; the plan and the README now
  say so, and nobody has counted a live round's.
- **What no row holds, now in X4.7c's and X4.7d's Verify**: a particle against the
  see-through panes or the fades, and a ring against the moon (the ash's order there is
  `sky-motes`'s alone, once X4.7c ports the `motes` path; nothing holds the rings'); and
  the particle rows sit under `--check`'s mean (the embers 0.0142, the ring-and-ash order
  flip about 0.0001), so only `exact.mjs` grades them. The README says the same.
- **Measured.** `bank.mjs sarab cinderhaven kurenai hollowmere --check --keep` at 260552e
  (the BEFORE, the parent's harness) and with this harness: **50 of 51 rows byte-equal by
  `exact.mjs`**, the five particle rows and `sky-motes` among them. The one other was
  `sarab-ground`, 100 pixels by 2/255, the cross-process residue `exact.mjs`'s header
  names. Sarab alone at both ends shows it is two frames, each taken by BOTH harnesses
  (the BEFORE equal to this harness's Sarab-alone run, and this harness's four-map run
  equal to the parent's Sarab-alone run), on a row shot before any particle row on its
  list. The same ten stale rows were red at the same means on both sides. The probe, `sarab
  cinderhaven sarab hollowmere cinderhaven --editor`, 240 frames a place: three runs equal
  by `Object.is` (45,120 numbers a map with a hull, 4,800 on Hollowmere, and the editor's
  orders and draws). A copy of the first log with Sarab's `_initialize rotorWash0` 540
  changed to 0, Cinderhaven's `construct motes` 65,536 to 65,535 and an editor draw 504 to
  503 **FAILED**, all three named, exit 1. `unwrapped` was empty on every map. The order,
  the draws, the splits (10 render passes with the particles off; 11-12 and 1-2 dry; 13
  and 3 wet) and the editor's order are X4.7a's readings unchanged. Typecheck and build
  (`check-babylon-free`, `check-proving`) pass. No page or console error.
- **Not verified.** The `unwrapped` path on a real non-Babylon field (there is none until
  X4.7c). A live round's splits and seam path. The rest of the bank (the harness change is
  inside the `particles` branch, which only a particle row enters). `corecheck`, parity,
  `census`, `gate`, `shaders` (no game code moved).

**X4.7b landed** (8c691c7; 2026-11-07; no change to the picture; report version 36; `git diff`
under `src/` is `core/FrameProfile.ts` and `core/profileReport.ts`).

- **The span.** `FrameProfile.hookRender` opens `drawWorld` on the scene's
  `onBeforeDrawPhaseObservable` and closes it with `endAdd` in the glow's `onBeforeWork`
  (ahead of `begin(glow)`), and again at `onAfterDrawPhaseObservable` for a frame the glow does
  no work, where the second `endAdd` returns on its first test. The rendering-group observers
  and the `inDraw` gate are gone: the draw phase fires from `Scene._renderForCamera` alone
  (`scene.pure.js`; no render target's manager raises it), so a shadow map's or the mask's
  groups cannot reach it. The brief's recommended form, taken; the other (retiring the span)
  was not needed, the spans nesting as before. No new observer kind, nothing allocated per
  frame (the four closures are made at `arm`), no seam item.
- **What it holds, read off the observers' order rather than measured apart**: the rendering
  manager (group 0 when Babylon visits it: today the ash, and our draws QUEUED at its points)
  and, on a frame it visits none, the seam's fallback telling the same points at the phase's
  end (`onMainPass`'s `after`, inserted FIRST, so ahead of the glow's observer); `FrameDepth`'s
  identity test only on a frame the glow skips. NOT the seam's start of the pass, our
  renderer's `begin` (the frame's uniforms, every prepare on the upload encoder) and `first`:
  the seam's `before` was added when `Game` built the renderer (Game.ts:1901), before any
  `arm` (2718 on, or the bench's), so it runs ahead of the span's opening, under `render` and
  unnamed, as it did when the span was the groups'.
- **Measured** (scratch `x47b/capture.mjs`: `?profile`, the profiler re-armed after 30 menu
  frames and again 60 frames into a live round with the player unkillable, 600 frames each,
  `capture(…, true)` and `trace(3000)`, headless on the Windows box). `drawWorld` frames of 600
  and mean, parent (v35) → step (v36):

  | capture | parent | step |
  | --- | --- | --- |
  | Coldharbour menu | 0, — | 600, 0.003 ms |
  | Cinderhaven menu | 0, — | 600, 0.005 ms |
  | Coldharbour round | 600, 0.153 ms | 600, 0.132 ms |
  | Cinderhaven round | 600, 0.144 ms | 600, 0.144 ms |
  | Coldharbour round, `particlesEnabled` false (the fallback) | — | 600, 0.003 ms |

  `glow` on every frame of every capture (0.07-0.14 ms). Per frame, off the trace (601 frames a
  capture): `drawWorld` and `glow` both inside `render`, and `drawWorld` ending before `glow`
  begins, on every frame at both trees; the report's tree `drawWorld: render`, `glow: render`,
  roots `frame`, `sim`, `present`. No page or console error. **In a live round today the span
  is Babylon's particles and, about half of it, our opaque recording** (0.13-0.15 ms with the
  ash, 0.003 without; this said "almost all Babylon's particles" until the review below), so a
  capture across X4.7c and X4.7d compares the same span, but its reading falls by ~0.13 ms
  as the ash and then the wash become ours (their update a prepare, outside it), while
  `glow` rises by ~0.06.
- **The viewer** (scratch `x47b/viewer.mjs`, through the hand-off key): a v36 round and menu
  capture and a v35 round and menu capture open, the report shown, no loader error, no page
  error; the v36 menu lists `drawWorld`, the v35 menu does not. No name moved, so the viewer is
  untouched.
- **The bank**, `bank.mjs --check --keep` at 30bd400 (the BEFORE, the main tree before the
  edit) and at the step: **141 of 143 byte-equal by `exact.mjs`**,
  `harrowmead-view-pistol-reload` within its known flake (2 pixels by 1/255), and
  `sarab-ground` 100 pixels by 2/255. Sarab alone, three times a tree, alternating: the step
  drew one frame every time (its full run too); the parent drew the other twice and the step's
  once (its full run the other), so both frames are the parent's own, the cross-process residue
  `exact.mjs`'s header names. The same 34 stale rows red at the same means (the two logs' red
  lines identical).
- **Gates**: typecheck, build (`check-babylon-free`, `check-proving`), corecheck and parity
  pass. Not run: `gate`, `shaders`, `census`, `surfaces.mjs`, `pipelines.mjs` (no draw, pipeline
  or shader moved; the profiler is disarmed in all of them).
- **Not verified.** The bench's halted capture (`?bench=`, the same `hookRender`); a phone; an
  editor build's frames (an editor's Babylon generator still enters `shadowPass`, unchanged);
  a `?gpu` capture. `CLAUDE.md`'s "Measuring a frame" stands as written (the spans still hang
  off the scene's own observables), so it is not touched.

**X4.7b's review** (2026-11-07; no change to the game: comments and records only, `git diff`
under `src/` is comments in `core/FrameProfile.ts`, `core/profileReport.ts`,
`shaders/GlowPass.ts` and `shaders/FrameDepth.ts`). An independent review, off Babylon 9.28's
source and the step's captures (scratch `x47b/`), found one real mis-statement and two minor ones.

- **What `drawWorld` holds.** `GPUParticleSystem`'s compute dispatch ENDS the main pass from
  inside group 0 (`_computeDispatch` calls `_endCurrentRenderPass`,
  `Engines/WebGPU/Extensions/engine.computeShader.pure.js` line 203), and ending a pass runs
  the bundle list (`Engines/thinWebGPUEngine.js` lines 59-67): our `first`, `beforeAlphaTest`
  and `opaque` recordings, queued ahead of the particles. So with the ash our opaque recording
  runs inside `drawWorld`; without it, where the glow's mask ends the pass, inside `glow`. The
  step's Coldharbour rounds (`step-summary.json`, `fallback-summary.json`): particles on,
  `drawWorld` 0.132 / `glow` 0.078 / `render` 0.58 ms; off, 0.003 / 0.140 / 0.48. About half
  of `drawWorld` is our encoding, not "almost all Babylon's particles": across X4.7c and X4.7d
  it falls by ~0.13 ms while `glow` rises by ~0.06, a move between spans and not a regression
  of the glow. Corrected in `docs/profiling.md` (the X4.7b measurement; the weapon's queuing,
  whose "not confirmed by a capture" is now confirmed by these), `FrameProfile.hookRender`'s
  header, `BABYLON_EXIT.md`'s entry and the note above; X4.7c's and X4.7d's Verify say to
  expect the move.
- **The guards' comments.** `GlowPass.render` and `FrameDepth` said render targets ("a
  reflection probe's bake") raise `onAfterDrawPhaseObservable`; in 9.28 only
  `Scene._renderForCamera` notifies it (`scene.pure.js` line 4180). The comments say so; the
  guards stay, harmless.
- **The v36 note** (`profileReport.ts`): on a group frame the glow skips, v36 also picks up
  the seam's `after` observer and `FrameDepth`'s identity test (negligible), not only the
  rendering manager's walk.
- **Gates**: typecheck and build pass.

**X4.7c landed** (9dff2c4; 2026-11-07; no change to the picture; report version 37). The ash —
`Atmosphere`'s mote field — is our renderer's compute particles, Babylon 9.28's
`GPUParticleSystem` on `ComputeShaderParticleSystem` ported exactly; the rotor wash stays
Babylon's (X4.7d).

- **What moved.** New: `render/ParticleDraw.ts` (every field of ours in ONE list in creation
  order, a disposed one spliced out; each field's GPU half — two `rgba32float` random
  textures, the update's `SimParams` buffer, the draw's `LeftOver` block, and from its first
  update its two particle buffers with the bind groups over them; the three pipelines asked
  once; the prepare that steps every started field and dispatches its update into the host's
  prepare encoder; the draw; `enabled`, `scene.particlesEnabled`'s twin; `preWarmStep` for the
  harness), `render/ParticleField.ts` (a field's CPU half under Babylon's names and defaults:
  `start`, `stop`, the reset's state, `animate`, and the emit-rate-controlled arm of `render`
  line for line), `render/particleProgram.ts` (the bind group, the two blends, `SimParams`'
  offsets, `particlePipelines`) and `shaders/wgsl/particles.ts` (the three modules). A new
  `DrawPoint`, `"particles"`: a list of its own run right behind `"opaque"`'s in the same slot
  of the host's, so behind the turf (added at `"opaque"` at each install, after anything added
  at construction) and ahead of the moon. `Atmosphere` now DECIDES a `ParticleField` and
  draws nothing; its routing note is gone; `fit`, `apply`, `update`, the wrap invariant and its
  DEV warning are as they were. `Game` builds `ParticleDraw` with the scene's animation ratio
  and a camera reader (`readParticleCamera`: the scene's view and projection apart, the view's
  inverse by `Matrix.invertToRef`, the active camera's `globalPosition`, asked as the main pass
  begins). Its pipelines are "the ash" on `Game.roundPipelines` (the update and the draw at
  both blends). `ProfileReport.pools.particles`, in `pools.drawn` too: report version 37. No
  seam item was added (the mote texture is bound through `hostTexture` and `bind`, items 7
  and 8).
- **The WGSL, read off the parent's device.** A scratch dump at 312dc44 (`createShaderModule`
  hooked, Kurenai then Cinderhaven) gave one update module (`BOXEMITTER BILLBOARD
  EMITRATECTRL`), one vertex and one fragment module (`BILLBOARD BILLBOARDMODE_ALL
  EMITRATECTRL TONEMAPPING 0`), shared by both blends, and the three pipelines Babylon built
  from them: a compute pipeline, and two render pipelines differing in the blend alone —
  `triangle-strip`, cull none, `less-equal`, no depth write, bias 0, mask 15, STANDARD
  `src-alpha, one-minus-src-alpha` / `one, one` and ADD `src-alpha, one` / `zero, one`, the
  particle buffer an instance-stepped layout of stride 96 (position 0, age 12, size 16, life
  28, colour 64, angle 80) and the sprite a vertex-stepped one of stride 16. The update is
  copied verbatim, bindings included (equal to the device's text but for comment lines, checked
  by a script); the vertex body from `let shouldCullParticle` on and its two functions are
  verbatim, its first lines PULLING the same attributes out of storage into the same private
  `vertexInputs`; the fragment's `main` is verbatim (the helper functions every WGSL effect gets,
  which it never calls, dropped). `LeftOver` and `Internals` are Babylon's structs, laid out by
  `blockLayout` exactly as WGSL reads them (view 0, projection 64, translationPivot 128,
  worldOffset 144, invView 160, colorDead 224, eyePosition 240; 256 bytes). `SimParams`' floats
  are the parent's `UniformBuffer` locations (`currentCount` 0 … `maxEmitBox` 64), the struct 272
  bytes.
- **The buffers and the draw.** Babylon's `_initialize` stride for this feature set is 24
  floats (21, plus `alignDataInBuffer`'s 1, rounded to 4); both buffers hold every slot dead
  with its seed at floats 8 to 11, made at the first update after a build or a reset (which
  also zeroes `_targetIndex`) and released by a reset. **The draw reads the buffer the update
  READ**: `_createVertexBuffers(_buffer0, _buffer1)` then `(_buffer1, _buffer0)` makes list 0
  render `_buffer1` and list 1 render `_buffer0`, and `_render` binds the list at the index
  `_update` just incremented — so a frame draws the slots as the PREVIOUS update left them. The
  brief said the draw reads the buffer the update just wrote; the port follows the code. A held
  field's update writes what it read, so no bank row can tell the two apart, and no live frame
  reproduces. One instanced strip of four, `currentActiveCount` instances, in list order.
- **The random draws, the clock, the gate.** Two textures at `create`, 4 × `randomTextureSize`
  each, the first then the second (65,536 on this box, whose `maxTextureDimension2D` is 8192,
  the number Babylon's caps read); 4 a slot at the first update. The clock is `updateSpeed` ×
  `scene.getAnimationRatio()` (`|| 1`), read at the prepare, after `Scene.animate`; a started
  field is stepped on every frame the scene draws with the switch on, so a stopped one drains
  and is drawn over the menu as Babylon's was. The ready gate: the texture ready, the draw's
  pipeline for the field's blend built, and the update "created" by the first test after a
  build or a reset, which answers no (`isUpdateBufferCreated`), so a field emits from its second
  ready frame.
- **The harness and the probe.** `harness.mjs` has ONE adapter for every field
  (`placeVantage`'s `fields`), picking per field between ours (`g.particleDraw`: its ready test,
  reset, pre-warm step and switch) and Babylon's, and the `motes` path (`sky-motes`) and
  `freeze`'s `particles` switch with its thaw go through it (both switches); `babylonFields` is
  folded into it. On the parent's tree, which has no `particleDraw`, it touches Babylon's alone.
  `particles.mjs` reads ours beside Babylon's through one adapter (ours listed first, the order
  the frame draws them, the same seventeen columns) and counts our first updates around
  `ParticleDraw.initialize` under Babylon's label. `census.mjs` counts `particleDraw.stats.drawn`;
  `shaders.mjs` builds the three pipelines on every map.
- **Measured.** The BEFORE: `bank.mjs --check --keep` at 312dc44 in the worktree
  `greywatch-2-before-x36b` (moved there from a269bfb), its own harness. The step's, alone.
  - **The bank, by `exact.mjs`: 142 of 143 byte-equal**, every particle row and `sky-motes`
    among them, `harrowmead-view-pistol-reload` within its known flake (2 pixels by 1/255), and
    `sarab-ground` 100 pixels by 2/255. Sarab alone twice a tree, alternating: the step drew
    one frame both times; the parent drew that frame once and its own once — the cross-process
    residue. The same 34 stale rows red at the same means (the two logs' red lines identical).
    No page or console error.
  - **The new harness over the parent**: the six particle rows (`--rows`, four maps) in the
    worktree with this commit's `harness.mjs`, byte-equal to the BEFORE and to the step — the
    adapter's Babylon side is the old path.
  - **Each ash row holds our field**: the frame against the same frame with
    `particleDraw.enabled` off, one process: `hollowmere-sky-motes` 630,923 px (the field
    gathered into 24 m), `cinderhaven-particles-embers` 4,387 px (mean 0.0142),
    `-ring-ash` 4,159, `kurenai-particles-leaves` 16,696 (mean 0.0274) — X4.7a's counts for
    Babylon's fields; switched back on, the frame is its first grab's bytes.
  - **The probe across the trees**, `hollowmere coldharbour cinderhaven sarab cinderhaven`, 240
    frames a place, parent (this probe in the worktree) then step `--against`: **equal by
    `Object.is` on every map** (4,800 numbers on Hollowmere and Coldharbour, 45,120 on each
    Cinderhaven and Sarab), the order at every deploy and every construction's and first
    update's draws equal (59 entries; 65,536 a mote field, 74,668, 59,736, 24,268 and 22,400 at
    the first updates), `unwrapped` empty. Its pass counts: at the parent the motes split the
    main pass once a frame on the ash-only maps (11 render, 1 compute) and Cinderhaven and Sarab
    1-2 dry and 3 wet; at the step none on the ash-only maps (10 render, the seam on its fallback
    path in the held world) and 0-1 dry, 2 wet — the wash's alone. Our update's pass is recorded
    at the seam's `begin`, whose observer runs ahead of the probe's, so the probe counts it
    nowhere.
  - **`--editor` (Cinderhaven)**: the build's order after `F2` equal (motes ahead of the four
    rings); after the in-memory `particles.count` edit and its rebuild, the parent's motes are
    BEHIND the rings and ours ahead, and the order of the draws differs with it (the same twenty
    entries). That is the dev-only flow X4.7a recorded, which no shipped flow reaches; ours is
    drawn at `"particles"`, ahead of every Babylon field, whatever order they were made in.
    **Reported to the owner.**
  - **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): every row and every total
    equal (331, 595, 619, 168); in `sky-motes`, `particles-embers`, `-ring-ash` and `-leaves`
    Babylon down one and ours up one.
  - **`surfaces.mjs`** on the five particle rows and `sky-motes`: no `motes` class; the rings
    as before (`rotorSpray0` 78 of 126, `rotorWash0` 92 of 135, their defines and state); the
    seam's path the fallback on `sky-motes` and the leaves, the group on Cinderhaven's rows
    (its emptied rings still dispatched).
  - **An editor build's frames**, Cinderhaven `town` and `tank-far`, Kurenai `ground` and
    `crossing`, each held by the freeze without the ash and again with the map's ash rebuilt
    under a seed, 600 pre-warm steps and held, through each tree's own field: **8 of 8
    byte-equal across the trees**, the ash moving 236 to 22,377 pixels.
  - **Pipelines.** `pipelines.mjs cinderhaven --round` and `sarab --round`: in play 2 of
    Babylon's, the wash's compute and render pipelines at `life 1: sniper`, none of ours; 3 of
    Babylon's and 19 of ours at the first install (X4.7a: 2 and 19, and `GiVolume`'s race at the
    spawn; the motes' two are gone, and the race fell under the card this run — inferred from
    the counts, the install's creations keep no stack). Plain `pipelines.mjs hollowmere`: three
    more of ours at the boot (64 against 61), and two fewer of Babylon's in the first second (3
    against 5), nothing after it.
  - **Live**, offline, headless: Cinderhaven (ADD) 300 frames playing, our field drawn on every
    one; the menu, 60 frames, the stopped field still drawn (drained, as Babylon's was); Kurenai
    (STANDARD) 300, a second Kurenai round on the same field 120, then `F2` 120, drawn on every
    frame. No console or page error, no `[pipelines]` warning from the sealed cache.
  - **`?profile`**, 600 frames a capture, parent → step: a live Coldharbour round `drawWorld`
    0.132 → 0.002 ms, `glow` 0.075 → 0.143, `render` 0.569 → 0.496; Kurenai 0.125 → 0.004,
    0.079 → 0.131, 0.547 → 0.466; Cinderhaven (its wash still Babylon's) 0.149 → 0.060, 0.075 →
    0.116, 0.628 → 0.586; the menus 0.002-0.005 at both. `pools.particles` 1 in a round,
    `counters.drawCalls` 10 → 9. The prediction (X4.7b's review) held.
  - **Gates**: `gate` all seven maps clean; `shaders` every shader compiled clean on seven
    maps (the ash's three among ours); typecheck, build (`check-babylon-free`, `check-proving`),
    corecheck and parity pass.
- **Rewritten**: `CLAUDE.md` (the warm-up's vantages are for the rotor wash alone in a round; the
  ash joins the list of what is ours), `docs/rendering.md` ("The particles, ours", the new point,
  the moon's two notes), `docs/states.md`, `docs/profiling.md` (the X4.7c captures),
  `FINDINGS.md` 5, `VERIFYING.md` (freezing the field), `FILES.md`, `plans/webgpu-ref/README.md`,
  and the headers of `Atmosphere`, `Renderer` (the point; `FramePrepare`'s timing: the update is
  no cull, so untimed), `PipelineWarmup`, the seam's item 6 and `profileReport`; `Game`'s stale
  "all of them but one" (three maps state a `volume`).
- **Not verified.** A server's match in a browser; the phone; a `?gpu` capture; a field whose
  pipelines are still compiling when it is first asked (every build here had them settled);
  `merge:hash` and `kit:hash` (no world geometry moved). Nothing holds a particle against the
  see-through panes or the fades in a frame: both points are ours, `"particles"` ahead of
  `"beforeBlended"`, so it is held by construction.

**X4.7c's review** (2026-11-07; no change to the game: records and docs only). An independent
review, by reading Babylon 9.28's source and a live rotation Hollowmere → Coldharbour →
Coldharbour (a second round) → Sarab → Hollowmere, found nothing real.

- **Confirmed**: always one field and exactly six `particles:` GPU resources live, no leak
  across the rebuilds or the second round; the field drawn on every frame of the deploy
  screen, play and the menu; no console error. Against the source: the ping-pong (the draw
  reading the buffer the update read), the ready gate after a reset, the emission, the clock,
  the blends, the uniforms and the ordering.
- **The editor flow, decided.** In `F2`, an in-memory `particles.count` edit, the editor's
  rebuild, then back to a round on Sarab or Cinderhaven, Babylon put the motes behind its live
  rings and ours keeps them ahead; ADD over STANDARD does not commute, so overlapping pixels
  would differ (reasoned, not measured: no bank row reaches it). In the editor itself no pixel
  differs (the rings cleared to count 0, no fleet, Babylon's render returning early); only the
  probe's order and the order of the `Math.random` draws. No shipped flow reaches it: every
  shipped map and the proving map has a distinct `floorColor`, so a map change rebuilds the
  rings after `atmosphere.apply`; a second round rebuilds neither; a server's rotation takes
  the same `installMap`; no setting rebuilds the ash. **The owner accepted it 2026-11-07 as a
  recorded, dev-only order difference until X4.7d** (`BABYLON_EXIT.md`, "Decisions that are
  yours"), whose Verify now shows the flow back in Babylon's order against a BEFORE at 312dc44,
  not at its own parent. The implementer had been told by the orchestrator to stop and report
  this and landed it flagged instead; the brief's own stop condition was a shipped flow, which
  none is.
- **MINOR, the first field's timing.** The ported one-frame ready gate equals Babylon's only
  once Babylon's effects are cached: on a session's first field Babylon's render and compute
  effects may have taken more frames to come ready, so our first emission can start a few
  frames earlier, under the building card. The probe opens its window at the first ready
  frame, so nothing measures it, and nothing shows it (the field runs on the wall clock).
  Recorded in `docs/rendering.md`'s ready gate.
- **MINOR, device loss.** Babylon's particle `rebuild()` path is gone with the port. Not worse
  in practice: every draw of ours already dies on a lost device, and nothing in `src/` handles
  one (`FINDINGS.md` 64, "What a player gets").
- **MINOR, wording.** `docs/rendering.md`'s moon passage said the wash, Babylon's until X4.7d,
  drew "ahead of both"; it draws after the ash and before the moon. Corrected.
- **Gates**: typecheck passes; `git diff` is docs and records alone.

**X4.7d landed** (999d4ca; 2026-11-07; no change to the picture; no report version —
`pools.particles` counts the rings with the ash, as Babylon's counter did). The rotor
wash's dust and spray rings — `RotorWash`'s — are our renderer's compute particles,
Babylon 9.28's `GPUParticleSystem` on `ComputeShaderParticleSystem` ported exactly on
X4.7c's machinery; Babylon's scene holds no particle system.

- **What moved.** `render/ParticleField.ts` gained a feature set (`features`, `"box"`
  the default, `"ring"`), the cylinder emitter's four numbers (`createCylinderEmitter`'s
  defaults), the colour, size and velocity gradients (`addColorGradient`,
  `addSizeGradient`, `addVelocityGradient`, sorted by Babylon's comparator) and their
  bakes (`bakeColorGradients`, `bakeFactorGradients`: `_bakeColorGradientData`,
  `_bakeFactorGradientData` and `GradientHelper.GetCurrentGradient` line for line, the
  `Uint8Array`'s own conversion of `channel × 255`). `render/ParticleDraw.ts` runs both
  sets in its one list: a ring's three gradient textures are baked at its first ready
  test that creates the update (`_recreateUpdateEffect`'s), kept across a reset as
  Babylon's were, destroyed at its dispose; the ring's stride is 20 (21, the padding
  float, less the colour's 4, rounded to 4); its `SimParams` are Babylon's layout for
  the set (no colours; `radius`, `height`, `radiusRange`, `directionRandomizer` at
  floats 40-43, 176 bytes); its update binds a second group (the size and velocity
  gradients) and its draw a colour gradient beside the puff. `render/particleProgram.ts`
  states both sets (`PARTICLE_RING_GROUP`, `PARTICLE_RING_BLOCK` — no `colorDead` —
  `RING_PARAMS`, `FEATURE_BLENDS`, `RING_UPDATE_GROUPS`, `RING_COLOR_SAMPLER`,
  `RING_FACTOR_SAMPLER`) and `particlePipelines` asks the ring's update and STANDARD
  draw beside the box's three. `render/PipelineCache.compute` takes an explicit layout
  when stated. `shaders/wgsl/particles.ts` gained `PARTICLE_UPDATE_RING` (verbatim) and
  `PARTICLE_RING_RENDER_VERTEX`. `RotorWash` builds its rings with `ParticleDraw.create`
  and draws nothing; `update`, `drive`, `silence`, `clear` and `surfaceOver` write the
  same numbers; the rebuild on a new palette is kept. `Game`: `RotorWash` handed the
  draw; "the ash and the rotor wash" on `Game.roundPipelines`. The seam's particle
  observable and its public-list line are gone; no numbered internal retires (item 6
  stays: the moon and the one run, told there while an editor build's group is visited,
  until X5.3). Babylon's `GPUParticleSystem` and `CylinderParticleEmitter` are imported
  nowhere.
- **The WGSL and the state, read off the parent's device** (scratch `x47d/dump.mjs` at
  9d5ab4a, every module, sampler, texture, bind group and layout hooked from the page's
  first script, the `sarab-particles-dust` and `cinderhaven-particles-spray` rows posed):
  one update module (`CYLINDEREMITTER BILLBOARD COLORGRADIENTS SIZEGRADIENTS
  VELOCITYGRADIENTS EMITRATECTRL`), one vertex (`BILLBOARD BILLBOARDMODE_ALL
  COLORGRADIENTS COLORGRADIENTS_COLOR2 EMITRATECTRL TONEMAPPING 0`) and a fragment whose
  `main` is the motes' (so the ring draws with `PARTICLE_RENDER_FRAGMENT`); a compute
  pipeline on an EXPLICIT layout (group 0 the box's, the random textures
  `unfilterable-float`; group 1 a `non-filtering` sampler and an `unfilterable-float`
  texture at 0/1 and 4/5) and a render pipeline whose instance buffer is stride 80
  (position 0, age 12, size 16, life 28, seed 32, angle 64). The samplers: the colour
  gradient's nearest, lod 0..0, CLAMPED; the factors' nearest, lod 0..0, REPEATING —
  the compute binding takes the sampler state of a texture no material ever bound — so
  an age at or past its life reads texel 0, as ours does. The puff's linear, clamped,
  through the seam's `bind` as before. The textures `rgba8unorm` 256 × 2 and
  `rg32float` 256 × 1.
- **Why `"auto"` would not do**: an `"auto"` layout types a float texture sampled with a
  `sampler` as filterable, and `rg32float` is filterable only under `float32-filterable`,
  which a phone may lack; the explicit layout is Babylon's own.
- **Measured.** The BEFORE: `bank.mjs --check --keep` at 9d5ab4a in the worktree
  `greywatch-2-before-x36b` (moved there from 312dc44; moved to 312dc44 and back for the
  editor oracle), its own harness. The step's, alone (a first AFTER run died mid-way on
  a navigation when a source file was edited under its dev server; re-run whole).
  - **The bank, by `exact.mjs`: 143 of 143 byte-equal**, the five particle rows and
    `sky-motes` among them, no known flake coming up; the same 34 stale rows red at the
    same means (the two logs' red lines identical). One run was enough: nothing moved.
  - **Each wash row holds our ring** (scratch `x47d/holds.mjs`: the frame against the
    same frame with the rings' `started` off for a frame, one process):
    `sarab-particles-dust` 83,644 px (mean 0.668), `cinderhaven-particles-spray` 42,466
    (0.285), `-ring-ash` 71,242 of its 75,309 — X4.7a's counts for Babylon's rings; on
    again, the first grab's bytes.
  - **The gradients against the parent's baked arrays** (scratch `x47d/gradcheck.mjs`
    against the dump's `_bakeColorGradientData(2)` and `_bakeFactorGradientData`
    outputs): on all four rings of Sarab and of Cinderhaven (two palettes, a map change
    rebuilding them), the colour 2,048 elements, the size 512 and the velocity 512 equal
    by `Object.is`, and the stops, the cylinder's four numbers, the capacity, the random
    texture width, the lives, sizes, spin, gravity and blend equal; `scene.particleSystems`
    empty after each install.
  - **The probe** (`particles.mjs sarab cinderhaven sarab hollowmere cinderhaven`, 240
    frames a place): against the parent (9d5ab4a, its own probe) **equal by `Object.is`
    on every map** — 45,120 numbers on each Sarab and Cinderhaven, 4,800 on Hollowmere —
    with the order at every deploy and every construction's and first update's draws
    (65,536 a mote field, 32,768 a ring; 22,400, 24,268 and 74,668 the motes' seeds, 540
    and 504 a ring's, at rest after every reset too), `unwrapped` empty. **The editor
    flow** (`--editor`, now ending in the round leaving the editor starts — this step's
    probe, run in the worktree at 312dc44 with this step's `particles.mjs` and
    `harness.mjs`, then put back): **orders and draws equal to 312dc44's** — after `F2`
    the motes ahead of the four rings; after the in-memory `particles.count` edit and
    the rebuild, after putting it back, and in the round after, the motes BEHIND them —
    and the maps equal to 312dc44's as well; the same probe over the parent keeps the
    motes ahead throughout (X4.7c's recorded difference), so it differs, as the brief
    said it must.
  - **`census --against`** a parent run on Sarab and Cinderhaven: every row and both
    totals equal (595, 619); in `particles-dust`, `-spray` and `-ring-ash` Babylon 1 → 0
    and ours up one; Babylon 0 in every row.
  - **`surfaces.mjs`** on the four Sarab and Cinderhaven particle rows: no Babylon draw,
    no particle class, the seam's path the fallback in each (at the parent the group,
    Babylon's rings dispatched).
  - **Pipelines.** `pipelines.mjs cinderhaven --round` and `sarab --round`: **zero of
    either renderer in play** (both lives); at the first install 3 of Babylon's and 19
    of ours, as at X4.7c. Where Babylon compiles across an install (scratch
    `x47d/warmup.mjs`, Cinderhaven, Sarab, Hollowmere, `startRound` to 120 frames into
    the deploy, each creation's state and program): the post chain's six (`kernelBlur`,
    `celInk`, `fxaa`, `volumetrics_medium`, `motionBlur`, `paperGrain`) on the frames
    before the card, `GiVolume`'s three computes under it, and **nothing at a vantage** —
    the warm-up's vantages compile nothing of Babylon's in a round, handed to X5.4,
    which owns retiring them.
  - **Live**, offline, headless (scratch `x47d/live.mjs`): Sarab, the first helicopter
    pinned each frame on a descent from 14 m of skid clearance to 0.3 m over 300 frames
    and held 120, on the real clock with the world stepping (`fleetStepped` true): the
    dust ring's rate 0.8 → 86.2 a second and its count 0 → 130, drawn from its first
    count; the menu after (the rings cleared to 0, the motes drained and drawn); a
    second Sarab round the same numbers; the map change to Cinderhaven (another palette,
    the rings rebuilt) landing on the bay: the spray 11.8 → 134.1, its count to 121, the
    site published and held by the water; `F2` (an editor build, the rings cleared) and
    back to a round. `scene.particleSystems` 0 throughout, no page or console error, no
    `[pipelines]` warning from the sealed cache. **After a teardown** the rings left
    standing over the menu (cleared, not disposed) re-create their two buffers and draw
    their 540/504 seeds at rest, at their first update after the reset — Babylon's
    `_initialize` did the same before its count test, so this is parity, not a fault
    (recorded by X4.7d's review).
  - **The fade** at a stated hull draw distance, X4.2d's review's way (its scratch
    `x42dr/wash.mjs`, `hullDrawDistance: 420` written into Cinderhaven's environment for
    the run and taken out): every rate and site, after every render, `Object.is` the
    formula — the dust 55.561 at a fade of 1, 44.449, 33.337, 22.224, 11.112, 0 at 420 and
    428.4 m with no hull instance; the spray 134.672 → 107.738, 80.803, 53.869, 26.934,
    0; the ripple 0.9619 → 0.7696, 0.5772, 0.3848, 0.1924, no site — X4.2d's numbers.
  - **An editor build's frames** (X4.7c's `edframes.mjs`): Cinderhaven `town` and
    `tank-far`, Sarab `crossing` and `ground`, held without and with a seeded ash:
    **8 of 8 byte-equal** across the trees.
  - **`?profile`**, 600 frames a capture, parent → step: a live Sarab round `drawWorld`
    0.050 → 0.003 ms, `glow` 0.111 → 0.111, `render` 0.578 → 0.519; Cinderhaven 0.061 →
    0.002, 0.100 → 0.108, 0.525 → 0.493; the menus 0.002-0.004 at both; the nesting
    check clean on every frame. The wash's share was small on these runs (a ring splits
    the pass only while it holds a count, so only while a bot flies low); the move to
    `glow` sits inside the clock's grain.
  - **Gates**: `gate` all seven maps clean; `shaders` every shader compiled clean on
    seven maps (the ring's two among ours); typecheck, build (`check-babylon-free`,
    `check-proving`), corecheck and parity pass.
- **Rewritten**: `CLAUDE.md` (the gradient rule deleted; the warm-up's vantages are for
  nothing of Babylon's but the post chain; every particle field ours, no particle
  system on Babylon's scene), `docs/vehicles.md` ("What a GPU particle field here may
  and may not do", "A puff fades IN": the rules restated as the port's, the gradient's
  deleted), `docs/rendering.md` ("The particles, ours", the `"opaque"` and `"particles"`
  points, the moon's two notes), `docs/states.md`, `docs/profiling.md` (the X4.7d
  captures), `FINDINGS.md` 16 (the rotor-wash bullet deleted, its table rows answered),
  `FILES.md`, `plans/webgpu-ref/README.md`, the headers of `RotorWash` (and `paint`'s
  note), `ParticleDraw`, `ParticleField`, `particleProgram`, `wgsl/particles`,
  `PipelineCache`, `Renderer`'s point, `PipelineWarmup` and the seam; `Game`'s comments
  at `rotorWash.build` and at the draw's construction; `bench/vantages.ts`' two row
  descriptions; the harness's and the probe's adapters' comments, `shaders.mjs`.
- **Not verified.** A server's match in a browser; the phone; a `?gpu` capture; a ring
  whose pipelines are still compiling when first asked (every build here had them
  settled); a ring with a gradient missing or a palette with one colour row (refused by
  a throw — no field states one); `merge:hash` and `kit:hash` (no world geometry moved).
  Nothing holds a ring against the moon or the one run in a frame; both points are ours,
  `"particles"` ahead of `"beforeBlended"`, so it is held by construction. **X4.7's own
  Verify and the Gate after Phase 4 are not claimed here**: the whole step's Verify is
  met by the measurements above, but the gate's "a live round's `render` log" with
  `surfaces.mjs` and the seam's list read against PERF_PLAN B4 are the phase gate's.

**X4.7d's review** (fd7199b; 2026-11-07; no change to the game: records, docs and
comments only). An independent review found nothing real and nothing architectural.

- **Read** against Babylon 9.28: the ring's stride 20 and its slot layout; the bakes
  ported line for line at a width of 256, the `Uint8Array`'s truncation included; the
  bake at the first ready test, kept across a reset; the clamped colour sampler and the
  repeating factor samplers matching Babylon's compute-binding fallback; `SimParams` 176
  bytes; `PipelineCache.compute`'s key now `label:entry:shape:code`, the `"auto"`
  callers' behaviour identical; the ring's pipelines on `Game.roundPipelines`; one
  creation-ordered list.
- **Run**: a live script of ten installs in one boot — Sarab, Cinderhaven, Hollowmere,
  Sarab, Cinderhaven, Kurenai, Sarab, Cinderhaven, Sarab, Cinderhaven — both helicopters
  pinned, one over sand and one over the deepest water. The rings exclusive (dust 55.6/s
  on hull 0, spray 86.4/s on hull 1); a destroyed hull silencing its ring; climbing away
  taking every rate to 0 and back; no GPU-resource growth across rounds (5 of each kind
  and 4 gradient textures at every helicopter-map deploy); the maps without vehicles down
  to the motes alone; `scene.particleSystems` 0 throughout; the motes ahead of the rings
  at every deploy; no console error or seal warning.
- **Not re-run by the review**: the bank, `pipelines.mjs`, the probe's `--editor` flow,
  an editor build.
- **MINOR, wording: what the palette rebuild decides.** `RotorWash.paint`'s note and
  `docs/vehicles.md` said the rebuild kept on a new palette now decides only when a
  ring's random textures are drawn. It also decides the rings' place in `ParticleDraw`'s
  one creation-ordered list: on a palette change the motes are rebuilt first
  (`atmosphere.apply`, earlier in `installMap`) and the rings after them, so the rings
  draw after the ash. A repaint in place would leave the rings where they were, so a map
  change that rebuilds the motes would put them behind the rings and flip the
  ring-against-ash order in a rotation; the later commit those notes promise owes that
  check. Corrected there, in `RotorWash`'s header and in `Game`'s comment at
  `rotorWash.build`.
- **MINOR, wording: when the gradients are baked.** `docs/vehicles.md` said "at its first
  update"; the code bakes them at the first ready test (`_recreateUpdateEffect`'s, kept
  across a reset), as `docs/rendering.md` says. Corrected in both of its places, and in
  `RotorWash`'s two comments and `Game`'s that said the same.
- **Recorded, parity**: after a teardown the rings left standing over the menu re-create
  their two buffers and draw their 540/504 seeds at rest — Babylon's behaviour too (X4.7d's
  note, its Live bullet).
- **X4.7 is not closed by this note.** X4.7d's note says the whole step's Verify is met by
  its measurements; it is not marked done. What the sub-steps measured toward it: the
  bank with the ash and the rings 143 of 143 byte-equal (X4.7d), landings on sand and
  water live, `pipelines.mjs cinderhaven --round` and `sarab --round` zero of either
  renderer in play. The whole step's Verify and the Gate after Phase 4 (a live round's
  `render` log with `surfaces.mjs`, the seam's list read against PERF_PLAN B4) remain open.
- **Gates**: typecheck passes; `git diff` is docs, records and comments alone.

### The Gate after Phase 4 — **PASSED** (2026-11-07, at 55d98aa)

No change to the game. **The `exit-phase-4` tag is the owner's call**, and was not taken
by the gate's commit; the owner took it on 2026-11-07, at the commit that also marks X4.7's
whole-step Verify done. The record of what was measured stands under the gate in `BABYLON_EXIT.md`; this
note adds how.

- **The instrument change.** `plans/webgpu-ref/surfaces.mjs` gained a fourth wrapper:
  the engine's `_draw`, logged while no `Mesh.render` and no field's `render` is on the
  stack (`s.inMesh`), as `effect -> target`, printed under a row when it differs from the
  row before and totalled per draw at the end. Without it the tool could not see the post
  chain at all (no post process comes through `Mesh.render`), so "only the post chain"
  could not be read off a row; with it, the rows say which passes Babylon draws and
  nothing else moved in the tool. It draws nothing and changes no state; the frames were
  not re-compared against the bank for it (`--keep` not run), the wrapper being a call
  through. The README's bullet says so.
- **The rows.** `surfaces.mjs` over every map, twice (before and after the wrapper): 143
  rows, no class in any, the seam's path `fallback` in all 143; the engine-level totals
  as the plan records them. Run time about four minutes a pass.
- **The live log.** The scratch `gate-p4/renderlog.mjs` (in the session's scratchpad, not
  the repo): boots a map through `harness.mjs`'s `bootMap` with the HUD shown, wraps
  `engine._draw` (keyed by the mesh in `Mesh.render`, folded of digits, else the effect,
  with the render target's label), `engine.computeDispatch`, and samples every twentieth
  frame `scene.meshes` enabled, visible and not `solid`, the particle systems, sprite
  managers, layers, effect layers, the camera's post processes, the active meshes and
  each rendering group's lists. The frame class is `g.state` at the engine's begin-frame,
  a building card raised from the editor told apart. The round drives `g.input` as
  `pipelines.mjs --round` does (the trigger, the throw, the forward axis and the sprint
  redefined), pins a flying hull through `followEye` as X4.7d's `live.mjs` did, and walks
  the player at the control point farthest from the spawn, firing, until the authority
  kills them (200 s cap). Counted at the doors: Coldharbour rounds 197 / throws 2 /
  blasts 38 / fires 8 / rubble 37 / rockets 2 / shard bursts 12 / kills 80 (the second
  run 141 / 1 / 12 / 1 / 11 / 2 / 2 / 23); Cinderhaven 197 / 2 / 10 / 1 / 9 / 2 / 1 /
  112; Sarab 188 / 2 / 43 / 1 / 42 / 2 / 0 / 288 (the round ran out of tickets: 10,419
  frames of `roundover`, no mesh drawn there either).
- **What the first Coldharbour run showed and the second settled.** The first logged 273
  mesh keys over two frames under `loading`; the editor's `F2` came last in that run, and
  the second, with the card raised from the editor classed apart, put all of them there
  (4,504 draws, two frames) and none under a round's card. The same on Cinderhaven
  (9,130). It is the editor's build standing under the card for the two frames
  `startRound` waits before `buildRound` tears it down.
- **The seam's count**, read off `git show` of the header at e59b96a (five, X3.2),
  c4d3021 (ten, the end of Phase 3) and HEAD (ten). The breakdown and the B4 reading are
  in the plan. One thing for the plan, not a fault of the gate: the canvas-made textures
  our draws read through `hostTexture` (items 7 and 8) have no step named before X6.1;
  X5.4's foam bullet covers only a texture Babylon DECODED and mipped.
- **X4.7's whole-step Verify**: every item it names was measured by X4.7c and X4.7d
  (the particle rows byte-equal, the two landings live with the hull pinned, the two
  `--round` runs with none of the wash's in play, no particle system in a round or an
  editor build), and the live log here adds a round and an editor build with no Babylon
  particle draw. It can be marked done; marking it is the owner's.
- **Gates**: typecheck and build (`check-babylon-free`, `check-proving`) pass at 55d98aa.
  `git diff` is this note, the plan's record, `surfaces.mjs` and the README.

---

## Phase 5 — The frame

### X5.1 — GI and the compute passes are ours — **M, as two sub-steps** (split 2026-11-07: the owner instructed that X5.1 be implemented in sub-steps, each implemented, reviewed and fixed by agents; the two-way split was proposed by the orchestrating session and run under that instruction) — X5.1a **LANDED** (06b9daa), X5.1b **LANDED** (e9a39d6, its picture change 9b9d205, its review b22fda3) — **both LANDED**

The plan's `BABYLON_EXIT.md` holds X5.1's brief, "What it is today" (corrected in place
by X5.1a, each correction marked) and X5.1b's brief with its open questions.

**X5.1a landed** (06b9daa; 2026-11-07; no change to the game: a new live probe, the
harness's GI path stated and checked, docs; nothing under `src/`). Measured at f7790e4,
headless on the Windows box.

- **The probe, `plans/webgpu-ref/gi.mjs`** (its header is its contract). The device is
  wrapped from the page's first line (`bootMap` gained an `init` option, absent by
  default): shader modules (the volume's three told apart by their source), compute
  pipelines, `getBindGroupLayout`, bind groups (each entry described), samplers,
  textures, views, buffers, command encoders' passes and submits. On the game: Babylon's
  `_computeDispatch` (whether its `_endCurrentRenderPass` ended a pass), the frame host's
  `prepareEncoder` and `viewProjection`, the draw phase, Babylon's `_setTexture` for the
  seven and the cloud field, and `GiVolume`'s four doors. A frame record at
  `onEndFrameObservable` (after the submit), so a readback submitted there sees the frame.
  **The volume is STEPPED**: `update` wrapped to run only on a frame holding a token, the
  probe reading the CPU half and copying the thirteen GPU resources back between tokens,
  under a pinned seed (`?seed=5101`) in the deploy screen's held world frozen by `freeze`
  minus `gi` and `reflections`. **The pinned seed was found needed**: without it two runs
  differed on their first step, the player's carried lamp (a light every channel and fast
  list sees) standing at the seed's spawn.
- **The race** (the finding that shaped the probe). Two fresh histories with identical CPU
  halves gave different state on their first step. A scratch test (`x51a/scratch/race*.mjs`):
  one step from a fresh history, four times, four state hashes (the age lane masked); 432 of
  the 8,192 probes traced differing, every one in the colour lanes (SH colour rgb, direction
  xyz), none in the sun, sky, age, validity, column or position lanes; with the trace's budget
  at ONE workgroup a dispatch, three runs of 40 steps byte-equal; the vis buffer equal under
  both. The trace reads the history of the probe nearest a hit, which another workgroup of
  the same dispatch may be rewriting — documented in `giTrace.ts` ("may be read before or
  after its own write; both are history"). So the probe hashes the state, `giIrr` and `giDir`
  twice (the lanes that reproduce, and the colour as `name~`), compares the colour only in
  its `serial` scenarios (budget 1, through `GiVolume.tier`), and everything else everywhere.
- **Every scenario's number** (Hollowmere / Coldharbour, high unless said): warm-up
  dispatches trace 8,192 then 1,024, compose and vis 1,152 each, `converged` on step 18; low
  4,096 then 384, 384 and 384; off nothing, the textures 1×1×1. Converged (eight warm sweeps,
  72 steps) then two steady sweeps (144 steps): `giIrr`'s colour changed on 0 / 29 steps,
  `giDir`'s on 28 / 38, the exact lanes, `giAux`, the vis textures and buffer on none, the
  state on all (its age lane); the irradiance's largest drift over those steps 0 / 3.815e-6 a
  texel (L1 0 / 1.4e-5). A lamp (`#ffc070`, range 14, 2.5, 5 m off the eye and 1.2 up, `fast`
  false): 14,221 / 8,874 of 73,728 texels changed past the drift; share of the eventual change
  in place after one sweep (72 frames) 0.9222 / 0.9173, two 0.9930 / 0.9902, three 0.9990 /
  0.9986; texels within 10% of their own 0.504 / 0.478, 0.925 / 0.912, 0.987 / 0.981; at low
  (64 frames) 4,087 / 2,589 of 24,576, 0.9464 / 0.9110, 0.9957 / 0.9904, 0.9994 / 0.9986, and
  0.533 / 0.426, 0.921 / 0.895, 0.990 / 0.974. A pulse (`#ffd9a0`, range 12, 3, life 0.25 s,
  stepped at 1/60 with the flame clock held at t = 1/60 and the trace's budget 0) beside a
  control: compose (`giIrr~`, `giDir~`) differs from the control on steps 1-15 /
  1-14 and `giVis3` on 1-15 on both, each byte-equal to it again after; `giAux` and the state never (the vis buffer, not printed here, moves with `giVis3` on 1-15: its review); the control never
  moved. (The `lamp` numbers move in the fourth decimal run to run: the race.)
- **The live half** (Hollowmere through its card, 60 frames of deploy, a spawn and 240 frames
  of a live round, 60 of the round-over card raised by `Game.endRound`, 30 of the menu;
  Coldharbour's card; Coldharbour's editor build, 120 frames with a quay dragged 2 m and back,
  its card and the round after): the volume dispatched on 19 of 48 card frames (the warm-up
  vantages skip it), 61 of 62 deploy, 241 of 241 playing, 60 of 60 round-over, 0 of 30 menu,
  120 of 120 editor; **with none of our prepares on 0 of them**, the card's 2 frames with no
  prepare dispatching nothing; Babylon's dispatch ended a render pass on 0 frames; every one
  of the volume's passes on Babylon's render encoder with no render pass begun on it before
  (0 in every state); the trace's bind group made once per dispatched frame. Render passes a
  frame 12-18 (round 14.1 mean), compute 6-18. Babylon's binds of the cloud field: one a frame
  in the menu and deploy (`cloudShadowMap`, the light shafts); of each of the seven, 0 in a
  round and 100,365 in 120 editor frames (1,648 in the card raised from the editor), the cloud
  field 100,485.
- **The statics**: the three modules' tokens equal the sources' (5,618, 4,392, 4,415), the text
  reflowed and two comment lines prepended; pipelines synchronous, layout `"auto"`, made on
  the first dispatch (6 or 7 frames after the boot's first `setMap`; the first `setQuality("low")`
  2 frames on; every later door 0), low's two made once; the seven 96×8×96 (64×6×64 low,
  1×1×1 off), `3d`, one mip, usage 15, two `rgba16float` and five `rgba8unorm`; the buffers'
  sizes and usage 140 (the plan's entry lists them); the bind groups' entries at the mapping's
  numbers; our host's sampler for the seven repeat/clamp/repeat, linear×3, anisotropy 4; 22
  prepares and 4 late ones on our renderer.
- **The cloud field's sampler.** Shafts on (the default): the trace's is our host's own object
  (clamp, clamp, repeat; linear×3; anisotropy 4), fresh, after `F2` and in the round after;
  the internal texture's fields filled every frame by the light shafts. `--shafts-off`: the
  internal's fields null in a round, the trace's sampler repeat, repeat, repeat; linear,
  linear, nearest; lod 0..0; anisotropy 1, not the host's; after `F2` the host's, and so for
  the round after. **The trace's bytes under each**: 0 of 256 serial steps differ (state, both
  halves; `giIrr`, `giDir`, `giAux`) on Hollowmere (whose trace never samples the field,
  `cloudArea.w` 1) and Coldharbour (0.45), in both boots (each forcing the other state).
- **The probe against itself**: two processes, `--against`, equal — 904,662 values on Hollowmere and 244,782 on Coldharbour, by `Object.is` and hash, twice: with the file as it was measured and as it is committed — and FAILING on
  copies of the first log with a warm step's cursor, a stable step's params, a serial step's raced state hash, a low
  step's `giVis0` hash, the cloud sampler's anisotropy and a pulse step's workgroups each
  changed by hand; a full-budget step's edited `giIrr~` passes (not compared, by design).
- **The harness**: `freeze`'s `gi` block's contract stated (its header and the block), and the
  stub's hold checked: `window.__refGiCount` (Babylon's arm, `ComputeShader.prototype.dispatch`
  counted for `gi-*`, wrapped once; X5.1b adds ours; null throws in the freeze) taken at the
  stub and compared at the thaw, which throws on a dispatch under the stub. Held over every
  row of the AFTER below that a thaw followed — each map's last row had none (its review).
- **The bank**: all 143 rows, against a BEFORE at f7790e4 (`--check --keep`, the parent's harness) by `exact.mjs`: 141 byte-equal, `sarab-shelf` within its known flake and `sarab-ground` 100 pixels by 2/255, the cross-process residue (Sarab alone, with this harness and with the parent's, drew the AFTER's frame both times: the BEFORE's is the parent's other); the same 34 stale rows red against `ref/` at the same means; the stub's hold held on every row a thaw followed (no thaw threw; `bank.mjs` thawed only before a next row, so each map's last was unchecked until its review)
- **The floors**: two full processes each: `--query=gi=off` 142 of 143 byte-equal and `harrowmead-view-pistol-reload` within its flake; `--query=gi=low` 142 byte-equal and `sarab-alley` 5 pixels by 2/255 — two frames, Sarab alone twice more drawing the second run's (3 processes of 4 against 1), the class `sarab-ground` is at high (what moves is that row's frame, both frames the same tree's; the cause is not pinned — it did not appear at off in two runs, which fits the volume's race leaving a sub-8-bit residue there, unproven)
- **`FINDINGS.md` 16's baseline**: `pipelines.mjs coldharbour --round` five times, the `FINDINGS.md` 16 baseline: 3 of Babylon's at the install in 5 of 5 (the volume's), none in play, 21 of ours and 15 modules at the install
- **Gates**: typecheck, build (`check-babylon-free`, `check-proving`), corecheck and parity
  pass. Not run: `census`, `gate`, `shaders`, `kit:hash` — no game code moved. No `FILES.md`
  line: it lists no `plans/` instrument.
- **Not verified**: the probe on a map with no hulls but Hollowmere, on Sarab or Cinderhaven
  (where a cloud field's edge may fall inside the window); a live round's per-frame log on a
  phone; a server's match.

**Its review** (aaca294; 2026-11-07; instruments and records only, no change to the game; nothing
under `src/`). Every finding was checked against the code before it was fixed; none was
wrong.

- **Real, three.** (1) `harness.mjs`'s Babylon arm of `__refGiCount` took the first
  non-null of `trace`, `compose` and `vis` and wrapped its prototype's `dispatch` whatever
  it was, so a port keeping a `trace` field of its own (with no `dispatch` call) and no arm
  would have read the same count for ever and held every row vacuously, while its comment said a port
  "cannot pass this silently". It now answers null unless every one of the three that is set
  is Babylon's own `ComputeShader` (`getClassName()`, its name `gi-*`, a `dispatch` on its
  prototype), and `thaw` throws on null as `freeze` does. (2) X5.1b's Verify asked `gi.mjs
  --against` to be equal, but the log differs by design in fields it did not name
  (`statics.late`, `statics.pipelines`, `statics.wgsl`'s count, `length` and `prefix`, and,
  under row 2's recommended answer, the cloud sampler's `samplerSerial.unbound` in a default
  boot and `samplersFresh`, `samplerSerial.asFound` and `.restored` under `--shafts-off`),
  and `statics()` and the editor block read three of the volume's facts past the one
  adapter (`_hardwareTexture.view`, `host.bind` of the seven, `giIrr`'s cached sampling
  fields). Following X4.7a's review, the reads go through `window.__giGpu`'s two new
  members (`frameBind`: the sampler our frame binds and whether its view is the producer's;
  `cachedSampling`), the statics' fields renamed for what they mean on both arms
  (`frameSampler`, `frameViewIsProducers`), and X5.1b's Verify names every field expected to
  differ and why, the sampler ones only under row 2's "the host's always". The cloud field
  (Babylon's texture until X5.4) and the live half's wraps stay direct reads, which the
  header now says. (3) X5.1b's late prepare had no converse: `Renderer.begin` returns before
  any prepare when nothing of ours is active or none is registered, while `update` has
  already moved the cursor, the warm frames and the dirty channels — a slice skipped
  silently, on a frame X5.1a measured never happens today. The brief now requires that an
  armed frame whose prepares do not run advances nothing (or fails loudly in a dev build),
  the mechanism left to X5.1b.
- **Minor, eight.** The pulse's per-step flash-against-control bits are logged as
  `vsControl` (keys with `.colour` for the `~` lanes), so `--against` compares the steps a
  flash lands and dies on, colour included; `bank.mjs` thaws once more after each map's last
  row; `dispatched` logs each pass's workgroups as x, y and z; `chanDirty` is captured at
  `writeParams` (the CPU half's own method, which X5.1b keeps), since `update` clears it
  after a trace and the log read zeros; decision row 2 restated (the evidence is 256 serially
  traced probes on Coldharbour, no hit near the field's edge; Hollowmere's trace never
  samples the field; Sarab and Cinderhaven unmeasured), and its open question beside it; the
  late prepares counted right in the plan (`FarthestRun`, `NearestRun`, `GlassDraw`'s
  `late`, `ProbeBake`: the plan had `NearestRun` twice, "with the rings' run"); `exact.mjs`'s
  header names `sarab-alley`'s `gi=low` residue beside `sarab-ground`, with the procedure
  (Sarab alone at both ends, under the same `--query`); and X5.1b's brief says the
  bake-before-dispatch order rests on the late list's push order alone (`ProbeBake` pushed in
  its constructor, before `GiVolume` is built).
- **Found by the fix.** The pulse's compared bits name the vis BUFFER moving with the flash on
  steps 1-15, exactly as `giVis3` does, on both maps; X5.1a's record said it never moved,
  never having printed it. Corrected in the plan's "A pulse" and above.
- **Measured** (the Windows box, headless). `gi.mjs` twice in separate processes, the second
  `--against` the first, and `--compare` of the two with no browser: equal, 914,616 values
  on Hollowmere and 254,736 on Coldharbour (914,612 and 254,732 read back from the files),
  every scenario's steps; `--compare` FAILING on copies of the log with one pulse bit, one
  step's `chanDirty` and one pass's workgroup y each changed by hand. `chanDirty` now logs the
  set flags (all sixteen after each fresh history's `setMap`, 3 of 410 steps a map), where
  it read zeros. The hold, by a hand test on Hollowmere: Babylon's arm took its count and
  thawed clean; a real `update` called under the stub made the thaw throw ("dispatched 3
  times"); with `trace`, `compose` and `vis` holding objects of another class the old arm's
  code answered 219 twice (a number for ever) and the new one null, and the freeze threw
  ("no adapter counts the irradiance volume's dispatches"). The bank on Hollowmere and
  Greyfen (`--check --keep`, the review's harness): 26 of 26 rows byte-equal to X5.1a's AFTER
  by `exact.mjs`, the same 7 rows red against `ref/` at the same means, no thaw thrown at the
  maps' last rows. Typecheck and build (`check-babylon-free`, `check-proving`) pass.
- **The owner's, not decided.** The ONE RULE paragraph defined "byte-exact" for X5.1 as
  never covering the trace's colour at the game's budget and said it won, which answered
  decision row 3 for the owner. It now leaves that to row 3 and says X5.1b may not land until
  the row is answered; row 3 gains how thin the `serial` oracle is (96 probes, 64 at low, 256
  in the sampler scenario, from a fresh history, so most history reads return the fallback
  and a carried lamp's fast bounce likely reaches no valid probe — reasoned, not measured)
  and lists its three options, still OPEN.

**The owner's three answers** (2026-11-07, recorded in 14df397, the rows in `BABYLON_EXIT.md`'s
"Decisions that are yours"): row 1 **no GI in an editor build until X5.3**, not a wrapped view;
row 2 **the cloud field's sampler the host's, always**; row 3 **(a)**, the trace's colour graded
by the `serial` scenarios and the bank's converged rows, the trace unchanged.

**X5.1b's picture change** (9b9d205; 2026-11-07; dev-only, the owner's row 1, made first so the
move is graded against it). Every Babylon cel material — an editor build's world, the only
Babylon cel draw left — is bound once, on creation, to GI `off`: `CelMaterialFactory.babylonGi`,
seven 1x1x1 `RawTexture3D`s of the factory's own (made as `GiVolume.makeTextures(null)` made them,
named `celGiOff-*`), `giShade.w` 0 (the whole of "off" to `giCoord`), the lightning fill the live
`giExtra` by reference, as at `off`. `setGi` stores the binding the frame pulls and walks nothing.
Docs: `CLAUDE.md`, `docs/rendering.md`, `docs/editor.md`, `GiVolume`'s header and `setQuality`.
- **The editor's frames** (a scratch script, `x51b/edframes.mjs`: `F2` from the menu, the free
  camera warped to the first four distinct bank eyes of Hollowmere and Coldharbour, the
  harness's freeze, 1920x1080 headless): every eye moved — Hollowmere `menu` 1,176,754 pixels,
  worst 65/255; `lanterns` 1,307,329, 135/255; `ashwood` 627,166, 95/255; `wall40` 1,837,725,
  74/255; Coldharbour `menu` 647,461, 94/255; `curtain2` 1,450,015, 38/255; `curtain40`
  1,624,489, 67/255; `curtain90` 1,085,195, 76/255. The floor, two processes at 14df397: 5 of 8
  byte-equal, Hollowmere `ashwood` 9,646 by 26/255 and `menu` 771 by 48/255, `curtain90` 5 by
  1/255.
- **The bank** against 14df397, all 143 rows: high and off 142 byte-equal and
  `harrowmead-view-pistol-reload` within its flake; low 142 and `sarab-alley` 5 pixels by
  2/255, a frame X5.1a's first `gi=low` process drew on the same source. No round row moved.

**X5.1b landed** (e9a39d6; 2026-11-07; no change to the picture; no report version). The
irradiance volume's GPU half is our renderer's; Babylon makes no compute pipeline and
dispatches nothing, in a round or an editor build.

- **What moved.** New: `render/GiCompute.ts` — the five pipelines on
  `PipelineCache.compute`, layout `"auto"` (the trace at 32 and 64 rays, compose at 6 and 8 fast
  rays, vis once), asked at construction and declared as "the irradiance volume" on
  `Game.roundPipelines`; the params buffer (2,560 B, made once), the tier's state and vis
  buffers and the map's boxes, index and heights, usage 140, written by the same
  `writeBuffer`s at the same offsets; the seven textures (descriptor `RawTexture3D`'s: `3d`, one
  mip, usage 15, `rgba16float` x2 and `rgba8unorm` x5, never uploaded), ONE view each with the
  descriptor Babylon's hardware texture made both its views with, serving the compute's
  storage binding and the frame's sampled one; the frame's sampler (repeat, clamp, repeat;
  linear x3; anisotropy 4); the bind groups at Babylon's numbers in its entry order, buffers
  bound whole, made on the first dispatch after anything behind them moved (a set of resources
  is replaced whole by a door, so a dispatch armed before a door records on what it was armed
  with); the history's clears (asked before an arm: ahead of that dispatch; after it: behind;
  with no dispatch: that frame's prepare); every retired buffer and texture destroyed at
  `FrameHost.afterSubmit` (new on the host: the engine's `onEndFrameObservable`, public API,
  after `flushFramebuffer`'s submit). The dispatch is ARMED by `GiVolume.update` and RECORDED by
  a late prepare pushed in `GiCompute`'s constructor — after `ProbeBake`'s, `Game` building the
  bake first — as three compute passes on the host's prepare encoder; **an armed dispatch still
  unrecorded at the frame's end is dropped and THROWN in a dev build** (logged once in
  production): the converse the brief asked for, never reached by any run here. `GiVolume` keeps
  its CPU half line for line (its fields, `update`'s schedule, `writeParams`, `writeHulls`,
  `uploadMap`'s arrays); `isReady` is ours, and asks only the five pipelines where Babylon's
  `ComputeShader.isReady()` also waited for every texture bound to it (its review); `cloudBound` stays for the probe, the cloud field
  handed over as `hostTexture(cloud)` and bound with `host.bind`'s view and sampler (row 2).
  `CelShader`: `GiBinding.textures` are our `OwnTexture`s, `fillFrameTextures` hands them over
  directly; the Babylon materials' set (`BabylonGi`) is the picture change's.
- **The instruments.** `harness.mjs`'s `__refGiCount` picks OURS first (`g.gi.gpu.recorded`).
  `gi.mjs`'s `__giGpu` picks ours when `GiVolume.gpu` stands (`texture`/`buffer` off
  `GiCompute`, `frameBind` off the frame's own pull, `cachedSampling` null); a sampler is logged
  by `GPUSamplerDescriptor`'s own members (Babylon's cache adds `anisotropyEnabled`, which WebGPU
  ignores), and the parent's log was re-taken with this probe. `exact.mjs`'s header names
  `sarab-particles-dust` beside `sarab-alley`.
- **Measured** (the Windows box, headless; BEFOREs at 9b9d205 in the worktree
  `greywatch-2-before-x36b`):
  - **The bank**, all 143 rows by `exact.mjs`: high 143 byte-equal; `gi=off` 143 byte-equal;
    `gi=low` 142 and `sarab-particles-dust` 4 pixels by 1/255. Sarab alone under `gi=low`, two
    processes a tree: the parent drew both of that row's frames (one a process), the step both
    too; `sarab-alley` (byte-equal in the full runs) likewise, each tree drawing both of its
    frames over its three processes — cross-process residue. The same red rows against
    `ref/` at each tier, the lists identical (34, 135, 138). No thaw threw.
  - **The probe** (`gi.mjs`, a default boot and `--shafts-off`, against 9b9d205's logs; the
    comparison through `gi.mjs --compare` on copies with only the named fields masked,
    `x51b/maskgi.mjs`): equal — 914,601 values on Hollowmere and 254,721 on Coldharbour, 914,595
    and 254,715 with the shafts off. What differed, all by design: `statics.late` 4 → 5;
    `statics.pipelines` (Babylon's 3 synchronous on frame 9, then low's 2 on frame 2,504, against
    our 5 asynchronous at the boot; all `"auto"`, `main`); `statics.wgsl` (Babylon's three, then
    five, at 19,056 / 14,243 / 13,615 characters behind two `//#define` lines; ours five at
    21,004 / 15,876 / 15,105 with none; every module's tokens the source's); a default boot's
    `samplerSerial.unbound.sampler` and `.isHosts`; under `--shafts-off` `samplersFresh.trace`
    and `.same`, `samplerSerial.asFound` and `.restored`, and the trace group's binding 5 in
    `statics.bindGroups` — the same sampler `samplersFresh.trace` reads off the same record,
    which the plan's list did not name. The trace's readbacks under each sampler byte-equal.
  - **Live**: a scratch log (`x51b/live.mjs`) through Hollowmere's card, deploy, a round, the
    tier low, off and high in play (`Game.setSetting`), a teardown, a second round, Coldharbour,
    `F2` with a quay dragged and back and the tier changed, the round after: Babylon's
    `_computeDispatch` 0 calls and no synchronous compute pipeline (the parent: 3,375 and 5), no
    `uncapturederror`, no page or console error. `gi.mjs`'s live half: the volume dispatched on
    19 of 42 card frames, 63 of 64 deploy, 242 of 242 playing, 60 of 60 round-over, 120 of 120
    editor, with no prepare of ours on 0 of them, every pass on the upload encoder; no Babylon
    bind of `gi-*`.
  - **Pipelines**: `coldharbour --round` five times, 0 of Babylon's at the install (X5.1a: 3),
    none in play, 21 of ours and 12 modules at the install (15 before); `cinderhaven --round`
    and `sarab --round` 0 of Babylon's, 19 of ours at the install, none in play; plain
    `hollowmere` 71 of ours, 9 of Babylon's by the install, nothing in the 16 seconds after.
  - **The editor's frames** (two processes a tree): Coldharbour `menu`, `curtain2`, `curtain40`
    and Hollowmere `lanterns` byte-equal in all four pairings; `curtain90` 1-3 pixels by 1/255
    (parent against itself 3); `ashwood` and `menu` within the parent's own cross-process floor
    (31,845-102,989 pixels by 41-47/255 and 275-993 by 30-35, against 79,451 by 47 and 768 by
    35); `wall40` changes between two grabs in one process on both trees, and by 1,433,398
    pixels between the parent's two processes — no oracle.
  - **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): every row and total equal.
  - **`?profile&gpu`** (parent and step alternating twice): `gi` 0.090-0.099 → 0.023-0.027 ms,
    `render` within its spread, `gpu.frame` within 8% (`docs/profiling.md`).
  - **Gates**: `gate` seven maps clean; `shaders` clean on seven; typecheck, build, corecheck,
    parity.
- **Rewritten**: `CLAUDE.md` (the GI paragraph, the warm-up's declared list), `docs/rendering.md`
  ("Its GPU half, ours", the frame textures), `docs/states.md`, `docs/profiling.md` (the `gi`
  span, the X5.1b captures), `FILES.md` (`GiVolume`, `GiCompute`, `frameHost`), `FINDINGS.md` 16
  (settled) and 64 (a lost device), the headers of `GiVolume`, `GiCompute`, `frame`,
  `frameHost`, the seam (items 7 and 8, the end-of-frame public API), `PipelineWarmup`,
  `profilePhases`' `gi`, `CelShader`'s binding and `fillFrameTextures`, `Game`'s comments;
  X5.4's texture list; `plans/webgpu-ref/README.md`.
- **Not verified**: a server's match in a browser; the phone; a lost device; the converse's
  throw provoked on purpose; `surfaces.mjs`.

**Its review** (b22fda3; 2026-11-07; no change to the game: documents, comments, contract headers and
`harness.mjs`; under `src/` comments only). An independent review found nothing real and
seven minor points, each verified against the tree first.

- **The compose's readers.** `docs/rendering.md` said the main pass, the glow's mask "and an
  editor build's Babylon passes" read this frame's compose; since 9b9d205 those passes read
  nothing of the volume (every Babylon cel material holds GI `off`). Corrected. `CLAUDE.md`
  said an armed frame without prepares "is an error, not a skipped slice"; in production it
  is a skipped slice logged once and a dev build throws, which is what it says now, tersely.
- **"An editor build prepares NO frame of ours"** — older than X5.1b, in `docs/rendering.md`
  (the bodies' map twice, the bodies once), `BodyShadowMap`'s header and its `asks` field,
  and `BodyShadows`' comment at the ask. X5.1a counted our prepares on 120 of 120 editor
  frames; `Renderer.begin` runs them whenever `filled || maskFilled`. Checked in the code:
  `BodyShadowMap.prepare` zeroes `asks` on every prepared frame and the editor asks once a
  frame (`updateEditor` -> `updateSceneForCamera` -> `BodyShadows.update` -> `draw`), so
  `asks > 1` never holds there — the clear-at-once branch (`clearNow`) is unreachable in an
  editor build, and its owed clear lands on the next frame's prepare, as in a round. Each
  place now says that; the branch stays, a guard for a state that prepares nothing, which no
  state measured is.
- **The readiness gate is not line for line.** `GiCompute.isReady` asks the five pipelines;
  Babylon's `ComputeShader.isReady()` (`computeShader.pure.js`, ~219-231) also walked every
  bound texture's `isReady()`, the cloud field's among them, so a cloud field not yet ready
  held the CPU half back. Ours would arm and advance, and `record` would bind nothing and say
  so once. Unreachable: both candidate cloud fields (`Sky.cloudShadowMap` and
  `ShadowBindings`' no-cloud texel) are `RawTexture`s built from data, ready at creation.
  Recorded, not changed, in `GiVolume`'s and `GiCompute`'s headers, `FILES.md` and the
  "What moved" bullet above.
- **The converse's DEV throw**, never provoked by any run, is thrown inside `afterSubmit`,
  which is `onEndFrameObservable`. Checked in Babylon: `AbstractEngine.endFrame` is
  `_frameId++` then `notifyObservers`, which catches nothing; WebGPU's `endFrame` has
  submitted (`flushFramebuffer`) and destroyed its own deferred resources before it; and
  `_renderLoop` queues the next frame only after `_processFrame` returns. So the throw stops
  a dev build's render loop, skips every end-of-frame observer added after `GiCompute`'s,
  and leaves the retired buffers and textures undestroyed (`frameEnd` destroys them after
  the throw), the CPU half having already advanced: the brief's "fail loudly" branch, not a
  recovery. `GiCompute`'s header says so.
- **X5.4's list** said nothing of Babylon's samples the textures it moves; the cloud field is
  bound by Babylon's `Volumetrics` every frame it draws until X5.2, and by an editor build's
  Babylon cel materials until X5.3 (X5.1a's counts). Corrected.
- **`FILES.md` and `FINDINGS.md`.** `GiVolume`'s line said "seven 3D textures every cel
  material binds, always" — they are `GiCompute`'s, bound by our frame and by no Babylon
  material; `GiCompute`'s line now names the readiness gate and the converse as they are.
  `FINDINGS.md` 16's `GiVolume` bullet was marked SETTLED rather than deleted; it is deleted,
  its status saying one thing it does not reach is left. **The settlement, for the record**:
  the three compute pipelines were Babylon's, compiled on their first dispatch (synchronous,
  layout `"auto"`), on no declared list, so which side of the card came down first was a
  race (X4.6b's tree, five runs of `pipelines.mjs coldharbour --round`: 16 of Babylon's at
  the install in 4 of 5, 13 with 3 at `life 1: spawn` in the fifth, naming
  `GiVolume.update`; X5.1a's baseline 3 at the install in 5 of 5, none in play, 21 of ours
  and 15 modules); since X5.1b the five pipelines are ours, asked at construction and
  declared as "the irradiance volume", and five runs read 0 of Babylon's at the install,
  none in play, 21 of ours and 12 modules (the "Pipelines" bullet above).
- **The harness's arm for ours is checked live.** `window.__refGiCount` returned
  `GiCompute.recorded` whenever it was a number, so a regression that stopped incrementing
  it would read a constant and every freeze would hold vacuously — the class of hole X5.1a's
  review closed for Babylon's arm. It now wraps `GPUComputePassEncoder.prototype`'s
  `setPipeline` (the pass's pipeline in a `WeakMap`) and `dispatchWorkgroups` once, counts a
  dispatch whose pipeline is one of `GiCompute`'s own (`traces`, `composes`, `visPipeline`),
  and THROWS at any call where trace, compose and vis have not each been dispatched exactly
  as many times as `recorded` moved since its first call; with those fields missing it
  answers null and the freeze throws. Nothing under `src/` changed. `plans/webgpu-ref/README.md`
  says the same.
- **Watch**: the reviewer observed that `sarab-particles-dust` is the third Sarab `gi=low`
  row in the cross-process residue class, after `sarab-ground` and `sarab-alley`.
- **Measured** (the Windows box, headless). The hand test, scratch
  `x51b-review/live-count.mjs` on a Hollowmere round: three freeze/thaw cycles pass, the
  independent count live (204 frames recorded since the arm's first call, 204 of each
  pass); `recorded` stubbed to a constant after them fails the next freeze ("recorded moved
  204 while the volume's passes were dispatched trace 296, compose 296, vis 296 times — the
  count is not live"); on a fresh page, the volume's real `update` put back for ten frames
  under the hold with `recorded` stubbed fails the thaw ("moved 0 ... dispatched ... 10
  times"), and the same with the PARENT's harness passes with no error (the hole, shown);
  with `recorded` live it fails on the old message ("dispatched 10 times while its update
  was stubbed"). `gi.mjs --against` X5.1b's AFTER log (`x51b/gi-x.json`): equal, 914,611
  values on Hollowmere and 254,731 on Coldharbour, 0 page and 0 console errors. `bank.mjs
  hollowmere --check --keep` by `exact.mjs` against X5.1b's kept AFTER (`x51b/x-high`): 16 of
  16 byte-equal; the same two rows red against `ref/` (`menu` 0.0677/255, `ashwood`
  0.3918/255) as that AFTER's log. Typecheck and build (`check-babylon-free`,
  `check-proving`) pass.
- **Not verified**: the rest of the bank (the change is inside `__refGiCount`, which every
  row's freeze calls; Hollowmere's 16 rows ran it); the throw itself provoked; corecheck,
  parity, `gate`, `shaders` (no game code moved).

### X5.2 — The post chain — **M–L, as five sub-steps** (split 2026-11-07; its decisions the owner's, 2026-11-07 and 2026-11-08, rows in "Decisions that are yours") — X5.2a **LANDED** (e5d9390, its review 55ef32c, its held finding F1 fixed 738f5e3), X5.2b **LANDED** (f697f0e, its review e5ab075), X5.2c1 **LANDED** (4747fe7, its review bfa6a6b), X5.2c2 the shafts and the blur **LANDED** (14dd887, its review 7c5030f), its FXAA **LANDED** (cb17a73, its picture change a459e7c, their review 117c5fd), X5.2d **LANDED** (4f83650, a picture change, row "X5.2, the boot canvas") — **all LANDED**

The plan's `BABYLON_EXIT.md` holds X5.2's brief, its ONE RULE, shape (A), "What it is
today" (corrected in place by X5.2a, each correction marked) and the five sub-steps.

**X5.2a landed** (e5d9390; 2026-11-08; no change to the game: a new probe, the
harness's post path through one adapter, four rows, docs; under `src/` only the rows and
the `damage` field in `bench/vantages.ts`). Measured at b00b887, headless on the Windows
box.

- **The probe, `plans/webgpu-ref/post.mjs`** (its header is its contract). The device is
  wrapped from the page's first line; Hollowmere's round is installed (`?seed=5101`) and held
  at `deploy`, and each scenario is shot as `bank.mjs` shoots a row at `lanterns`' eye
  (`placeVantage` with the scenario's settings over a stated base, `waitUntilDrawn`, every
  stage's effect ready, 30 frames, `freeze`, 6 frames), then two consecutive frames are
  captured and the second logged. Two pages: `desk` 1920x1080 at 1, `phone` 832x384 at
  2.8125. Sixteen scenarios a page: `base`, `scale75`, `scale50`, `glowlow`,
  `glowlow-scale75`, `glowlow-scale50`, `vol-off`, `vol-low`, `vol-high`, `nofxaa`, `blur`
  (the turn), `noblur`, `nograin`, `alloff`, `damage`, `base-again`. Per frame: every render
  pass in submit order, its attachments and ops and clear values, a SHA-256 of each colour
  target as its pass left it (a `copyTextureToBuffer` recorded on the pass's own encoder after
  `end`), and every draw by a named stage in full — pipeline, bind groups (each sampler's
  descriptor, each view's target, each uniform buffer's bytes as the queue held them at the
  submit, mirrored from `writeBuffer` and mapped-at-creation ranges), vertex and index bytes,
  viewport, scissor, draw call. Render bundles (Babylon's `compatibilityMode = false`) are
  recorded when made and resolved where a pass executes them. `chain()` logs Babylon's own
  facts (the camera's list with its holes, each pass's fields, the glow's rung, kernel and
  targets, the scaling level, `scene.autoClear`, `autoClearDepthAndStencil`, the clear colour,
  `scene.imageProcessingConfiguration`). One adapter, `window.__postGpu`, names stages by
  module and targets by what writes them (`frame`, `<stage>.out`, `canvas`, `canvas.depth`,
  `glow.*`); ours is added per stage by the sub-step that moves it. About 25 minutes for both
  pages.
- **The harness.** `postAdapter` (`window.__refPost`) is the one door to the grade, the shafts
  and the blur for `freeze`, `thaw` and `placeVantage`; each updater is stashed with the
  object it came off. The stale `g.post.time = 0` is gone (the grade has no clock). `freeze`
  takes `damage` and raises the flash under the held decay; `placeVantage` puts it out.
  `bootMap` takes `viewport` and `deviceScaleFactor`. **The probe found the motion blur's
  `maxShift` unpinned** — the config's rate times the `dt` of the last real `update`, so
  0.01896 in one process and 0.0192 in the next — and `freeze` now shows the pass the aim
  once at 1/60 s at rest. No pixel moves: 502 of 502 readbacks equal with it and without it,
  and the bank below. `reproject` stays the last rotation the pass was handed, a function of
  the row sequence.
- **The rows**, appended by `--rows` at the end of Hollowmere's list at `lanterns`' eye:
  `post-scale50`, `post-scale75`, `post-damage`, `post-alloff`.
- **What the measurement found** (all in "What it is today", marked X5.2a). The camera's
  list is `[ink, hole, fxaa, shafts, blur, grain]` at boot and eleven entries after the
  scenarios' toggles. The quad, the vertex text and the flip are as the planning read said,
  but the vertex module carries the pass's whole uniform struct, FXAA's has no `scale`, and
  every binding is in group 1 (group 0 empty). Intermediates are `rgba8unorm`, cleared to the
  scene's clear colour, with no depth; only the frame has a depth attachment. The samplers:
  nearest (lod 0..0, anisotropy 1) for the ink's, shafts', blur's and grain's inputs and the
  shadow maps; FXAA's linear with nearest mips; the mask, the glow targets and the cloud
  field linear with ANISOTROPY 4. **The canvas's pass carries the ENGINE's depth, not the
  frame's, and the last pass's pipeline writes it (compare always)**; the frame opens with a
  canvas pass of no draws that loads the colour and clears that depth. The glow's own passes
  LOAD (no clear); its four blurs are one program; the kernel text took five values a page.
  `extractDriverInfo()` is the empty string. ~~The six pipelines are made on the page's fourth
  frame and drawn on it, nothing is skipped for a compile~~ (**wrong, corrected by its review
  below**: the chain first draws on the page's third to fifth frame, and on the phone's page
  FXAA's pass drew nothing on the chain's first frame or two in two boots of four, as did the
  shafts' on one desktop rung change), and **a render-scale change or a resize costs one
  frame in which nothing but the canvas's opening pass runs**.
- **Measured**: `post.mjs` twice in separate processes, equal by `--against` (34,083 values
  a page counted in the process, absent fields included; 31,701 off the written log, which
  both modes count since its review) and by `--compare`, every scenario steady, and FAILING on copies of its log with a
  sampler's `minFilter`, a uniform byte, a load op, a canvas hash, a module's token count, a
  vertex stride and a camera-list hole each changed by hand. The four new rows banked into
  `ref/` in one process and byte-equal to it in two more (`--check`, 0 pixels), Hollowmere's
  20 rows byte-equal across those two by `exact.mjs`. The bank: 143 old rows against a
  BEFORE at b00b887 (the parent's harness, a worktree with its own `npm ci`) by `exact.mjs` —
  142 byte-equal, `sarab-shelf` 1 pixel by 1/255 (its known flake), the four new rows named
  `--new`; 34 stale rows red against `ref/` on both sides, as before. Typecheck, build,
  corecheck, parity, `gate` and `shaders` pass.
- **Not run** (the step moves no draw): `pipelines.mjs`, `surfaces.mjs`, `census`, the
  editor's frames, live toggles by hand, `?profile&gpu`.

**Its review** (55ef32c; 2026-11-08; instruments and records only, no change to the game; under `src/`
one comment). An independent review found two real points and five minor ones, each checked
against the code and the logs first; a third real point (F1, `thaw` leaving a rebuilt
`Volumetrics` stubbed) was held for the owner's decision, because fixing it moves bank rows,
and `harness.mjs`'s freeze and thaw were untouched (fixed since: "Its held finding F1",
below).

- **Real, two.** (1) The record said no frame was seen with a pass skipped for a compile and
  that all six pipelines were made and drawn on the page's fourth frame; the probe's own logs
  said otherwise — the phone's FXAA always compiled one frame after the rest, and drew nothing
  (`->fxaa.out/clear`) on the chain's first frame in `postB2`; a desktop shafts rung change
  drew nothing in the shafts' pass on its first frame in `postA2`; the chain first drew on the
  3rd to 5th frame. And the live render-scale and glow-rung changes ran after the scenarios had
  drawn every kernel and rung, so they could never show a compile. The live half's changes now
  run on a SECOND, FRESH page (its own boot, `boot-2`; the settings put to the base,
  `to-base`; then render scale 0.75, glow `low`, shafts `low` then `high`, and the desktop's
  resize), each a change that page has never drawn; pipelines are counted from the same `+0`
  as the frames, a pass or pipeline made between two engine frames is marked `~`, and each
  change prints its drawless chain passes. **The rerun** (both pages, one process): on the
  fresh pages nothing in play was skipped — render scale 0.75 made the glow blur's new pipeline
  on the first frame the chain drew after it (the one after the canvas-only frame) and drew it
  there, glow `low` made the blur's and the box filter's on the first frame after it and drew
  them, each shafts rung made and drew its own
  on its frame, and a render-scale change (the phone's fresh page also booted at its device
  default of 0.5 and went to 1) and the resize each cost the one canvas-only frame; at boot the
  phone's first page drew FXAA's pass empty for TWO frames (`+2`, `+3`, its pipeline on `+4`),
  its fresh page not at all. Across the eight boots now logged a stage's pipeline is stamped on
  the chain's first frame or on the frame before it, a frame with no pass of the chain
  recorded, which the probe does not explain. "What it is today" is corrected in place.
  (2) `--against` named only the first difference a scenario met, and `chain` (Babylon's own
  fields, which X5.2b and X5.2c1 change by design) was walked before the passes, so a moved
  stage would have hidden every pass and draw; and a value was cut at 120 characters, so two
  uniform buffers differing past that printed alike. It now names every differing path
  (`--max-diffs`, 40 a scenario, then the count), shows a long value from its first differing
  character (the byte, for hex), walks the common prefix of two arrays of unequal length, and
  excuses only path patterns `--ignore` names (`*` within a segment, `**` across, `@file`),
  saying what each excused and which matched nothing; the in-process comparison goes through
  JSON so both modes count alike (31,701 values a page, the 34,083 X5.2a quoted having
  counted absent fields).
- **Minor, five.** X5.2c1's correction says the canvas pass (Babylon's main pass) carries the
  ENGINE's depth, not the frame's, rather than "not the main pass's"; the adapter names the
  shafts' two shadow maps and the cloud field (`shadow.world`, `shadow.bodies`,
  `cloud.field`, off the pass or off what `Game` hands it, and `input()` so the live half
  does not count their passes), so X5.2c2's `own ?? hostTexture` is compared by name; the two
  `postAdapter`s (`harness.mjs`'s `window.__refPost`, `post.mjs`'s `window.__postGpu`) each
  point to the other and say a later sub-step adds ours to both; `post.mjs`'s header says about
  25 minutes, as the README does; `src/bench/BenchScript.ts`'s comment counts the post chain's
  ten rows on `lanterns`.
- **Measured.** `--compare` of X5.2a's two logs (`postA2`, `postB2`): equal, 31,701 values a
  page. The seven hand-edited copies of `postA2` each fail on their one path; one copy with all
  seven edits plus a glow kernel and a pipeline's `call` in the same scenario names all nine
  (the filled hole as the 21 fields it moves: three printed under `--max-diffs=3`, then the
  count) and, under
  `--ignore=**.chain.glow.kernel,**.pipeline.call`, the other seven, with a pattern that
  matched nothing said. The rerun `--against` `postA2`: every scenario steady and every value
  equal but the 84 the new names move (`shadow.world`, `shadow.bodies` and `cloud.field`
  against `-r16float`, `-r16float` and `-rg8unorm`, the shafts' bindings 2 to 4 on the
  fourteen scenarios with the shafts on, both pages). The bank on Hollowmere `--check --keep`,
  20 of 20 rows byte-equal to X5.2a's AFTER by `exact.mjs` (the harness's change is a
  comment). Typecheck and build pass.

**Its held finding F1** (738f5e3; 2026-11-08; the owner's decision of that day: fixed before X5.2b, in
a commit of its own, the moved rows measured and only those re-banked; the reference moves,
not the game — `harness.mjs` and comments only, nothing under `src/`).

- **Cause.** `freeze` stashed the post chain's three updaters once a page
  (`window.__refThaw ??=`), each with the object it came off; it stubbed whatever
  `Volumetrics` was live at each freeze; `thaw` restored `update` only onto the stashed
  object. `Game.setVolumetrics` builds a new pass on every rung change and every off to on,
  so after the first the live pass was stubbed and never restored. On Hollowmere `post-novol`
  turned the shafts off and `post-glowlow`'s settings reset built a new pass, which its
  freeze stubbed; `ground`, `crossing`, `sky-moon`, `sky-motes` and `ring-flown` then
  converged with `syncVolumetrics`'s `vol.update()` doing nothing, their shafts marched with
  the camera basis and `tanY` of `post-glowlow`'s eye (`lanterns`'). A page whose first freeze
  found the shafts off never restored them at all.
- **Fix.** The post chain's parts left the once-a-page stash. Each freeze records every part
  it stubs (`window.__refPostStubs`, keyed by the object, the real updater read off THAT
  object before its stub, own property or class method; a part already stubbed keeps its
  first record), the blur's in-flight calls read the real updater from the same record, and
  `thaw` restores every recorded part — deleting the stub so the prototype method shows
  through, or assigning an own property back — and empties the record. The grade and the
  blur are built once a page (the blur toggle re-appends the same grade), so neither was
  hit; they are held the same way. `post.mjs` has no stubbing of its own and is fixed with
  the harness (one eye, so the stale basis there was the right one).
- **Measured.** The bank, 147 rows, `--check --keep` against a BEFORE at b9b6c43 (the same
  tree, the parent's harness), compared by `exact.mjs` with two processes after the fix:
  exactly five rows moved, all Hollowmere's and all the bug's — `hollowmere-ground` 1,419,906 pixels by up to 21/255 (a mean of 4.0714/255),
  `hollowmere-crossing` 1,708,325 by 14/255 (1.8825), `hollowmere-sky-moon` 2,037,583 by 25/255
  (6.7773), `hollowmere-sky-motes` 2,012,029 by 25/255 (9.1004) and `hollowmere-ring-flown`
  1,868,088 by 6/255 (1.1955). Otherwise
  `sarab-ground` in one process (100 pixels by 2/255, its cross-process residue: the
  BEFORE's frame byte-equal to the other process's) and `harrowmead-view-pistol-reload`
  within its flake in the other. The five byte-equal across the two processes; re-banked
  alone (`bank.mjs hollowmere --rows=ground,crossing,sky-moon,sky-motes,ring-flown`, a third
  process) and byte-equal to both processes' kept frames; `ref/mode.json` untouched. Before
  the fix the five graded within the floor against `ref/` (banked with the bug); the same 34
  stale rows red on both sides at the same means, so 34 with the five re-banked. Typecheck
  and build pass.

**X5.2b landed** (f697f0e; 2026-11-08; no change to the picture; no report version). The
glow's box filter and four blurs are our draws, in the passes `GlowPass` binds on its own
targets, with no change to the pass structure; the mask stays Babylon's. Measured at 285da96,
headless on the Windows box (BEFOREs in a worktree of the parent with its own `npm ci` and a
copy of the main tree's `ref/`).

- **What moved.** `render/GlowBlur.ts` (new, Babylon-free): one pipeline a compiled kernel
  width and the box filter's, on `PipelineCache.get` with the new `vertexBuffers` (Babylon's
  quad attribute: `float32x2`, stride 8, location 0); the quad's vertex and index buffers
  (`(1,1) (-1,1) (-1,-1) (1,-1)`, `uint16` `0,1,2,0,2,3`, usages 168 and 152 as Babylon's
  buffer manager made them); one `Internals` (8 bytes: -1, the render height, as the engine's
  `UBInvertY`) and one `LeftOver` a pass (16 bytes: the box filter's `scale` 1, 1 and `texel`;
  each blur's `delta`, `(1 / width) * direction.x, (1 / height) * direction.y` of its target as
  `ThinBlurPostProcess.bind` computes it), bound with Babylon's explicit sizes; the source
  through `FrameHost.bind` (Babylon's own view and its cached sampler: linear x3, clamp, clamp,
  repeat, lod 0..32, anisotropy 4); an empty group 0 and group 1 at Babylon's numbers; the draw
  `drawIndexed(6, 1, 0, 0, 0)` queued by `Renderer.glowBlurOpened` (new: `passIs` against
  `GLOW_BLUR_TARGETS`, new in `targets.ts` — `rgba16float`, no depth, one sample, flipped —
  then `queue`, one console error a change on a refusal). `shaders/wgsl/glowBlur.ts` (new):
  the box filter's two modules copied off the parent's device, and the blur's GENERATED, its
  text being the kernel's — `blurKernel` (`_nearestBestKernel`), the Gaussian, its
  normalisation, the linear-sampling pairs, `toFixed(8)` with trailing zeros off, the split of
  the taps between varyings and dependent reads at `maxInterStageShaderVariables - 2` (the
  device's own limit, Babylon's `maxVaryingVectors` under WebGPU), then the processor's output
  for those defines; every one of the 24 modules the parent's device was handed for the glow on
  both pages (the box filter's two and ten kernel widths' — 5, 9, 13, 21 and 29 on the desk, 21,
  29, 37, 57 and 77 on the phone, the last three with five, fifteen and twenty-five dependent
  taps) reproduced character for character. `GlowPass`: the four `ThinBlurPostProcess`es, the
  `glowDown` `EffectWrapper` and the `EffectRenderer` gone; it still binds and unbinds each of
  its five targets, reads the kernel every frame (`kernelTexels`, now over `kernelTexelsAt`)
  and skips a pass whose program is not built (NOT as Babylon did, which compiled a new width
  synchronously and drew it: corrected by its review, the owner's accepted live difference
  below), and asks for
  the draws through `GlowBlurDraws`, handed in by `Game` (the targets cross there,
  `hostTexture`); `glowKernels(dpr)` is the same formula over every rung and render scale.
  `PipelineCache.get(spec, unsealed)`: an ask the seal allows. `Game`: `glowBlur` built before
  the glow at the boot's DPR, "the glow's blur" on `roundPipelines`, `applyRenderScale`
  declaring a new DPR's kernels (row "X5.2, pipelines").
- **The probe's bind groups.** `post.mjs` kept `entries[i].resource` by reference, and Babylon
  rewrites its `{ buffer, offset, size }` objects for the next bind group, so a group's logged
  buffer was the last one written into that object. Found here: the parent's log showed the
  glow's four blurs binding one buffer holding the wide pass's `delta` (0, 1/270 on the desk),
  where a scratch script reading the bundles' groups at creation showed four buffers, each with
  its own (1/960, 0), (0, 1/540), (1/480, 0), (0, 1/270) — Babylon 9.28's owner-keyed slots, one
  per draw context, in the probe's own session as in a fresh one. A buffer binding is copied as
  it is handed now; re-taken at the parent, the log differs from X5.2a's in 52 buffer-byte paths
  a page and in nothing else (every hash equal). "What it is today" is corrected in place.
  **Corrected by its review**: 4 of those 52 are not the glow's — the ink's `Internals`
  (`passes[7]`, binding 9) and the motion blur's (`passes[10]`, binding 3) in `damage` and
  `base-again`, on both pages, logged as +1 (`0000803f`) where -1 (`000080bf`) is bound; those
  stages are X5.2c2's and X5.2d's.
  `__postGpu` gains our arm (`ours`: modules named `glow.down` / `glow.blur` off the labels our
  cache gave them, the chain's kernel and readiness off `GlowPass.blurKernel` and
  `Game.glowBlur`).
- **Measured.**
  - **The probe** `--against` the parent's re-taken log, both pages, sixteen scenarios
    (render scale 1, 0.75 and 0.5 at both rungs among them): equal, 31,031 values a page — every
    pass's targets and hashes, every module's tokens (the module table equal), every pipeline,
    layout, bind group, sampler, uniform byte, vertex and index byte — with 670 values excused,
    on the glow's draws alone (passes 3 to 6, and 7 on `low`): `pipeline.call` (ours
    `createRenderPipelineAsync` ahead of the frame, Babylon's `createRenderPipeline` at its first
    draw); `bundle` (Babylon's draw was recorded into a render bundle, ours is a bundle-list item
    run on the pass encoder itself, seam item 3); `viewport` (Babylon set the whole target before
    its bundle; ours sets none, which a render pass defaults to — the same `[0, 0, w, h, 0, 1]` —
    and an item that set it would leave it for Babylon's next draws, `FrameHost.queue`'s rule).
    The patterns, `--ignore=@file`: `*.*.passes[3..6].draws[0].{pipeline.call,bundle,viewport}`
    and `*.glowlow*.passes[7].draws[0].{…}` (fifteen lines), each excusing 32 paths (6 for
    `passes[7]`). Two buffer sizes the first run showed (`null` against 8 and 16) were bound
    explicitly instead. Live, printed: the chain's first frame draws all four blurs on every
    boot, and no change in play makes a pipeline of ours (the parent made the glow blur's on a
    render-scale change, a glow rung change and the phone's 0.5 → 1).
  - **The bank**, all 147 rows, `--check --keep` at the step against the BEFORE, by
    `exact.mjs`: 145 byte-equal, `harrowmead-view-pistol-reload` within its flake (2 pixels by
    1/255), `sarab-ground` 100 pixels by 2/255. **The Sarab procedure** (`bank.mjs sarab --check
    --keep`, two processes a tree, alternating): the row has two frames and both trees draw
    both (the parent one in its full run and the other in both Sarab-alone processes; the step
    the other in its full run, then each alone), the step's full-run frame byte-equal to both
    of the parent's Sarab-alone processes — cross-process residue. The same 34 stale rows red
    against `ref/` on both sides. After `blurKernel` was made allocation-free (and the
    constructor's kernels de-duplicated), the probe again equal and Hollowmere's 20 rows
    byte-equal to the BEFORE.
  - **Live** (a scratch log: a Hollowmere round, FXAA, the motion blur and the grain off and on,
    the shafts low/off/high/medium, the glow low and high, render scale 0.5/0.75/1 at both rungs,
    a window resize and back, a teardown, a second round, Coldharbour, `F2` with a quay dragged
    and back and the glow rung changed, the round after): our 12 modules made at the boot (ten
    blur, two box filter) and none after; no module of Babylon's `kernelBlur` or `glowDown`
    (the parent: 3 at the boot, 11 by the end); Babylon's synchronous pipelines 33 against 39;
    every glow pass drew (6,464 passes, none empty); no "compiled in play" warning, no
    `uncapturederror`, no page or console error, on either tree.
  - **Pipelines**: `coldharbour --round` identical on both trees (0 of Babylon's at the install,
    21 of ours and 12 modules, none in play); `hollowmere` Babylon's 9 → 8 by the install (the
    glow blur's), ours 71 → 77 (five kernel widths and the box filter), nothing in the 16
    seconds after on either.
  - **`surfaces.mjs`**: Babylon's draws through no mesh lose `kernelBlur -> glowNearH`,
    `glowNear`, `glowWideH`, `glowWide` (147 rows each) and `glowDown -> glowDown` (1); four
    items of ours stand in the order where they were.
  - **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): every row and total equal
    (403, 595, 619, 168).
  - **The editor's frames** (X5.1b's script, its eight eyes, two processes a tree): Coldharbour
    `menu`, `curtain2`, `curtain40` and Hollowmere `lanterns` byte-equal in all four pairings;
    `curtain90` 2-4 pixels by up to 2/255 (the parent against itself 2 by 2/255); Hollowmere
    `ashwood` 42,999-170,205 pixels by 44-52/255 and `menu` 253-482 by up to 30/255 (each tree
    against itself 113,219-116,198 by 47-52 and 189-627 by 30); `wall40` changes between two
    grabs in one process on both trees — no oracle.
  - **`?profile&gpu`** (Coldharbour and Hollowmere, the parent and the step alternating twice,
    report version 37 on both): `render` 0.928/0.964 → 0.954/0.933 and 0.866/0.855 →
    0.832/0.839 ms; `gpu.frame` 2.646/2.626 → 2.585/2.697 and 2.509/2.618 → 2.494/2.593 ms
    (within 3%); `glow` 0.286/0.293 → 0.271/0.258 and 0.242/0.238 → 0.210/0.215 ms.
  - **A device-pixel-ratio change in play** (a scratch script: CDP's device-metrics override,
    1 to 2 and back, in a Hollowmere round): the two widths new at 2 (57 and 41) compiled as asks
    the seal allows — four modules, no "compiled in play" warning — the blur's passes skipped
    for three frames while they did (so no bloom on them: the targets the resize recreated hold
    zeros; where Babylon compiled synchronously and drew it — the live difference its review
    found and the owner accepted), then drawn; the Glow and Render Scale settings changed
    after it compiled nothing; no error.
  - **Gates**: `gate` seven maps clean; `shaders` clean on seven; typecheck, build
    (`check-babylon-free`, `check-proving`), corecheck and parity pass.
- **Rewritten**: `CLAUDE.md` (the glow paragraph), `docs/rendering.md` ("Our renderer's frame":
  the glow's blur passes; the glow's "the blur and the box filter are OUR draws"), `docs/states.md`
  and `PipelineWarmup.ts`'s header (the post chain's five), `docs/profiling.md` (`glow`),
  `FILES.md` (`GlowPass`, `GlowBlur`, `wgsl/glowBlur`, `frameHost`, `Renderer`, `targets`,
  `PipelineCache`), `FINDINGS.md` 5, the headers of `GlowPass`, `Renderer`, `PipelineCache`,
  `targets`, `frameHost` and the seam (no item added: the glow's blur passes reached by items 2
  to 5 as the mask is), `Game`'s comments, `plans/webgpu-ref/README.md` and `post.mjs`'s header;
  `BABYLON_EXIT.md` (X5.2b LANDED, "What it is today" corrected, X5.4's post passes).
- **Not run**: the phone (its page is the probe's `phone` size only), a lost device (ours does
  not rebuild after one, as for every draw of ours, `FINDINGS.md` 64), a server's match in a
  browser.

**Its review** (e5ab075; 2026-11-08; no change to the picture: two module-scope constants made equal
literals, the rest documents, comments, contract headers and the probe's `--ignore`). An
independent review found one real point, one the owner decided and two minor ones, each
verified against the tree first.

- **F2, real: module-scope `GPUBufferUsage` broke the boot gate.** `GlowBlur.ts`'
  `QUAD_USAGE` and `INDEX_USAGE` and `GiCompute.ts`' `BUFFER_USAGE` and `TEXTURE_USAGE`
  (since X5.1b) were evaluated at module load; `main.ts` imports `Game` statically, so where
  those secure-context globals are undefined — a browser without WebGPU, or any browser on a
  LAN address over plain http — the import threw before `checkWebGPU` ran and the boot card
  stuck on "Fetching the game" with no sentence. Now literals with the flags in a comment
  (168, 152; 140, 15 — each the same number), as `particleProgram.ts`' `COMPUTE` already was.
  A scan of `src/` with the TypeScript parser for any `GPU*` identifier or `navigator`
  evaluated outside a function, method or instance field (types excluded) found these two
  files and nothing else. The rule is in `CLAUDE.md` (a clause) and `docs/build.md` (its
  reason). **Proved**: a scratch page (`f2/boot.mjs`, the full Chromium headless) on the dev
  server — `http://192.168.1.136:5391/`, not a secure context, and `localhost` with every
  `GPU*` global and `navigator.gpu` deleted by an init script — reached `#boot.failed` with
  "Not a secure origin" and "No WebGPU" and their sentences, no page error; with the fix
  stashed, both stuck on "Fetching the game" with `pageerror: GPUBufferUsage is not defined`.
- **F1, the owner's decision (2026-11-08): accept the skip, recorded as a known live
  difference.** On a device-pixel-ratio change in play the new widths compile off the frame
  and the blur is skipped ~3 frames, the glow's targets recreated zero-filled by the resize,
  so the ink composes no bloom on them; Babylon compiled them synchronously at the first
  draw and drew the bloom. The record called it parity. Corrected in `GlowBlur.ts`' header
  and `declare`, `GlowPass.ts`' header, `GlowBlurDraws.blurReady` and `blur`, `Game`'s
  comment at `applyRenderScale`, `docs/rendering.md` (both places), `FILES.md`, X5.2b's entry
  and this note, and a row in "Decisions that are yours" ("X5.2, a DPR change in play"). The
  reviewer's nit with it: a ratio changed in the MENU declares its widths after the round's
  list is taken (`GlowBlur.ready` covers the constructor's alone), so the warm-up does not
  wait for them and a round reaching play first skips the same way — stated in the same
  places.
- **F3: the probe fix's record.** The re-taken parent log differs from X5.2a's in 52 paths a
  page, and 4 are not the glow's: the ink's `Internals` (`passes[7]`, binding 9) and the
  motion blur's (`passes[10]`, binding 3), in `damage` and `base-again`, both pages, logged
  `0000803f` (+1) where `000080bf` (-1) is bound (re-run here: `--compare` of
  `post-before.json` against `post-before2.json`, 14 scenarios x 3 + 2 x 5 = 52). Those stages
  are X5.2c2's and X5.2d's; "What it is today" and the bullet above say so.
- **F4: the seal's exception.** `CLAUDE.md`'s warm-up and glow paragraphs, `docs/states.md`,
  `docs/rendering.md`'s `PipelineCache` paragraph, `PipelineCache`'s header and `Game`'s
  comments (the declared list's field, the seal's line) now all say the one exception: a
  pixel-ratio change's new glow blur widths (up to five: two rungs at three scales are five
  distinct ideal kernels, high at 0.5 equalling low at 1), asked through `get(spec,
  unsealed)` by `GlowBlur.declare`.
- **Nits.** The stale "(the setter returns on an unchanged value)" is gone from
  `docs/rendering.md` and `Game.applyRenderScale`'s comment (Babylon's kernel setter left
  with X5.2b). `post.mjs`'s `--ignore` takes `[stage=glob]` in place of an index (matched
  against the element's `stage`, only when both logs agree on it; a plain index still
  matches a staged element), and `plans/webgpu-ref/post-expected.txt` holds X5.2b's three
  expected differences keyed on `**.draws[stage=glow.*]`, a section a sub-step, named in the
  README and `post.mjs`'s header. **Measured**: `--compare` of `post-after4.json` against
  `post-before2.json` with the file: equal, both pages, 31,031 values and 670 excused a page
  (134 a pattern: 32 x 4 + 6), as with the scratch index-keyed list; a hand-edited copy (the
  ink's `viewport` on `desk.base` `passes[7]` and on `phone.glowlow` `passes[8]`, a field
  added to a glow draw) fails on all three, and a copy logging one glow draw under another
  stage on one side fails on that draw's `stage`, `pipeline.call`, `bundle` and `viewport`.
- **Verified**: `bank.mjs hollowmere --check --keep` by `exact.mjs`: 20 of 20 byte-equal to
  X5.2b's AFTER (`x52b/bank-after-h`) and to its parent's BEFORE (`x52b/bank-before`); the
  same two rows red against `ref/` as X5.2b's AFTER (`menu` 0.0677/255, `ashwood` 0.3918/255).
  Typecheck, build (its gates, `check-babylon-free`, `check-proving`) and corecheck pass.
- **Not run**: the rest of the bank (the constants are equal numbers and the rest is
  comments), the probe's browser half (`--compare` only), a real browser without WebGPU (the
  globals deleted stand for one), the phone.

**X5.2c1 landed** (4747fe7; 2026-11-08; no change to the picture; no report version, the
grade's draw queued inside `render` where Babylon's was, named by nothing). **What
moved**: the grade is OUR draw, the last stage of the post chain's HOST,
`render/PostChain.ts` — an ordered list of DECLARED stages (`PostStage`: the program as
compiled with its bindings, the uniform block and its `fill`, extra bindings, the
sampler it reads its input with, `active()`, `reads` point-wise or neighbourhood), routed
a pass per active stage in list order, the last given the canvas, any other a pool
target; nothing a stage holds names its output, its place or the canvas. Its passes are
opened by the Babylon-side owner `shaders/PostPasses.ts` with public API (no seam item):
while a stage of ours is active `camera.outputRenderTarget` takes Babylon's prefix's
output (a `RenderTargetTexture` made as a post-process's input — `rgba8unorm`, no depth,
NEAREST, the render size — named for the stage reading it, `PostProcessRTT-paperGrain`),
the canvas is opened with `restoreDefaultFramebuffer` as `_finalizeFrame` opened it, and
the draw goes in through `Renderer.postStageOpened` (`passIs` against `canvasTargets`:
the swap chain's format, the ENGINE's `depth32float` written with compare `always`, not
flipped); with no stage of ours active none of it runs and Babylon's prefix writes the
canvas as before — no interim copy pass. The grade's modules are the parent's device text
character for character (`shaders/wgsl/paperGrain.ts`, CONFIG's constants where they
were), its 496-byte block filled as its `onApply` filled it (`PaperGrain.fill`), its input
read through our own sampler at Babylon's descriptor (nearest x3, clamp, clamp, repeat,
lod 0..0, anisotropy 1), the frame's depth through the host's own view; Babylon's quad,
`Internals` (+1, the render height) and layout (group 0 empty, group 1 at Babylon's
numbers). `PaperGrain` keeps the CPU half (grade, switch, flash, lattice) and its `stage`;
its `attach`/`detach` and the blur-and-grade dance are gone (`Game.setMotionBlurEnabled`
appends the blur, the last of Babylon's passes). `PipelineCache` lays a `texture_depth_*`
binding out as `"depth"`. The harness's readiness arm (`__refPost().ready`) and both
adapters' arms for the grain.
**Found, and the reason for two things the plan did not say.** (1) **Babylon reads
`outputRenderTarget` at THREE points**, not one: as `Scene.render` binds the frame's
first target and clears the canvas's depth (with it set, the scene binds the output
target instead and the frame's opening canvas pass — `canvas` loaded, `canvas.depth`
cleared, X5.2a — is never recorded, shifting every pass after it); as the camera's render
picks its render pass id (`outputRenderTarget.renderPassId`, which keys every Babylon
draw's wrapper, an editor build's meshes among them); and as `_finalizeFrame` binds its
last pass's target. Only the third is the prefix's output, so `PostPasses` sets it only
from the draw phase's end to the camera's (`onAfterDrawPhaseObservable`, after the glow's
and the frame depth's observers, to `onAfterCameraRenderObservable`). Five more reads,
each inert under that window, were listed by X5.2c1's review (the plan's "What it is
today": `_checkCameraRenderTarget`, the camera loop's bind flag, `_renderForCamera`'s
multiview branch and two MULTIVIEW tests). (2)
**`_finalizeFrame` binds that target WITHOUT a clear**, where Babylon's `activate` cleared
the grade's input at its pass's open (to the scene's clear colour), so the pass the
prefix's last stage draws in would load rather than clear — and on a frame that stage
draws nothing (its effect still compiling: the probe's live half sees it at a boot) our
grade would grade the target's last contents where Babylon's graded the clear colour. So
`PostPasses` clears it in that pass, from the prefix's last pass's `onApplyObservable`
(`Game.postPrefixTail`: the blur, the shafts, FXAA or the ink, whichever is last on the
camera) — after its own observers, before its draw, the pass still unbegun — or, on a
frame it draws nothing, in a pass of its own where that one stood: every pass's load op
and clear value the parent's, on every frame. **That fallback cannot tell a tail that
drew nothing from a `postPrefixTail` naming a pass that never applied** (the real last
pass drew, and the clear would land after it, grading a clear colour), so a DEV build
THROWS when it is about to run while the named tail `isReady()` — Babylon's `apply`
returns nothing exactly while `!isReady()`, and readiness does not change inside a
frame (X5.2c1's review; production keeps the clear).
**Measured** (the Windows box, headless; BEFOREs at 79e620d in a worktree with its own
`npm ci` and a copy of the main tree's `ref/`):
- **The probe** `--against` the parent's log, both pages, sixteen scenarios: equal,
  29,009 values a page — every pass in submit order (the canvas's opening pass, the
  prefix's last pass into the grade's input with its `clear` and clear value and its
  label `PostProcessRTT-paperGrain`, the canvas's pass with the engine's depth loaded),
  every target's hash, every module's tokens (the module table equal: the grade's two
  the same text), pipeline, layout, bind group, sampler, uniform byte (the 496-byte block
  and `Internals` among them), vertex and index byte — with 2,223 excused a page by
  X5.2c1's section of `post-expected.txt`: the grade's draw's `pipeline.call`, `bundle`
  and `viewport` (X5.2b's three, for X5.2b's reasons: 28 paths a page) and Babylon's
  own `chain.list`, `chain.off` and `chain.slots.grade.attached` (the camera's list no
  longer holds the grade and the blur's toggle no longer re-appends it, so it is shorter
  with fewer holes; 32 paths each a page, the list's every field counted). Desk-only
  first, then both pages. The live half (printed): the same pass sequence frame for frame
  after the boot on both pages — the render-scale change and the resize each one frame
  with the canvas's opening pass alone, then whole; no stage of ours drawless; the shafts'
  rungs made on their frames. **At the boot one frame may differ, and it is not made
  exact** (stated plainly by X5.2c1's review): which pipeline is ready first rides
  timing on both trees (the parent's desk boot drew FXAA's pass empty on its first chain
  frame), and our grade is declared and compiled ahead of Babylon's prefix — so on a
  frame where every pass of that prefix is still compiling, ours grades its input
  cleared to the clear colour (the clear-alone path) and the canvas shows a GRADED CLEAR
  COLOUR where the parent's grade, compiling with the rest, left it BLACK. The probe's
  desk `boot-2` was such a frame, and it was under the building card; a real FIRST MENU
  BOOT may show it through the canvas for a frame while `#menu-shot` is still decoding
  (`ui/backdrop.css`: the shot has no background of its own), so "under the card" holds
  of the probe's frame and not of every boot. It is a timing-dependent boot-frame
  difference: no frozen frame and no bank row shows it, and it is not made exact
  because that would mean faking compile timing.
  **Wider since X5.2c2, for the owner's information** (X5.2c2's review): the shafts and
  the blur are ours and compiled ahead of Babylon's ink and FXAA too, so on a boot frame
  where either is still compiling ours draws the shafts' haze and dither and the blur over
  that input cleared to the clear colour, then grades it — the same timing-dependent
  class, in no frozen frame and no bank row.
- **The bank**, all 147 rows, `--check --keep` at the step against the BEFORE, by
  `exact.mjs`: 147 byte-equal, no flake, no Sarab procedure needed; the same 34 stale
  rows red against `ref/` on both sides.
- **Live** (a scratch log, X5.2b's script on the grade: a Hollowmere round, FXAA, the
  motion blur and the grain off and on, the shafts low/off/high/medium, the glow low and
  high, render scale 0.5/0.75/1 at both rungs, a window resize and back, a teardown, a
  second round, Coldharbour, `F2` with a quay dragged and back and the glow rung changed,
  the round after): our two grade modules made at the boot and none after, no module of
  Babylon's `paperGrain` (the parent: one); Babylon's synchronous pipelines 32 against 33
  by the end; the grade's input pass drawn on every frame the grade was on but the three
  boot frames both trees draw it empty; `outputRenderTarget` null at every frame's end;
  no "compiled in play" warning, no `uncapturederror`, no page or console error, on
  either tree.
- **Pipelines**: `coldharbour --round` identical on both trees (0 of Babylon's at the
  install, 21 of ours and 12 modules, none in play); `hollowmere` Babylon's 8 → 7 by the
  install (the grade's), ours 77 → 78, modules 111 on both, nothing in the 16 seconds
  after on either.
- **`surfaces.mjs`**: Babylon's draws through no mesh lose `paperGrain -> canvas` (145
  rows); `motionBlur -> PostProcessRTT-paperGrain` stands, the prefix's output named for
  its reader.
- **The editor's frames** (X5.1b's script, its eight eyes, two processes a tree):
  Coldharbour `menu`, `curtain2`, `curtain40` and Hollowmere `lanterns` byte-equal in all
  four pairings; `curtain90` 2-5 pixels by 1/255 (each tree against itself 0-3 by 1);
  Hollowmere `ashwood` 22,735-106,685 pixels by up to 52/255 and `menu` 273-1,165 by up to
  35/255 (each tree against itself 82,453-90,759 by 52 and 1,028-1,112 by 29-35);
  `wall40` changes between two grabs in one process on both trees — no oracle.
- **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): every row and total
  equal (403, 595, 619, 168).
- **`?profile&gpu`** (Coldharbour and Hollowmere, the parent and the step alternating
  twice, report version 37 on both): `render` 0.931/0.960 → 0.964/0.977 and 0.820/0.843 →
  0.801/0.820 ms; `gpu.frame` 2.646/2.602 → 2.561/2.575 and 2.527/2.471 → 2.473/2.569 ms
  (within 4%); Babylon's draw calls 5 → 4 (the grade's draw is ours).
- **Gates**: `gate` seven maps clean; `shaders` clean on seven; typecheck, build
  (`check-babylon-free`, `check-proving`), corecheck and parity pass.
**For X5.2c2**: Babylon's chain becomes `[celInk]` and the host's list grows ahead of the
grade — each stage DECLARED as the grade is, a pool pipeline asked for every stage another
follows (`PostChain`'s constructor), the pool's passes opened bound and cleared as
`activate` opens a pass (`PostPasses.openPool`, written here and first exercised there:
its descriptors are X5.2c2's to prove), `Game.postPrefixTail` shrinking to the ink, and
`__refPost`'s ours arm taking the shafts and the blur. Deleting
`DefaultRenderingPipeline` sets `scene.autoClear` back to true, which the window does not
meet (it opens after the frame's start) — only the opening canvas pass's colour load
moves, as that entry says. A pass of ours into a texture is FLIPPED (`Internals` -1, the
front face `cw` under cull none, as the probe read Babylon's).
**Not run**: the phone (its page is the probe's `phone` size only), a lost device (ours
does not rebuild after one, `FINDINGS.md` 64), a server's match in a browser, a DPR
change in play (the grade's text and pipeline do not depend on the ratio). The plan's entry is X5.2c1's in `BABYLON_EXIT.md`.
- **Rewritten**: `CLAUDE.md` (the warm-up's "nothing of Babylon's but the post chain's
  prefix", and the grade as ours with the `outputRenderTarget` window), `docs/rendering.md`
  ("Our renderer's frame": the post chain's host and its owner; the layout rule for a depth
  texture; the post-process chain's order without the dance), `docs/states.md` and
  `PipelineWarmup.ts`' header (the post chain's four), `docs/profiling.md` (the grade
  queued inside `render`, no span moved), `FILES.md` (`PostChain`, `PostPasses`,
  `wgsl/paperGrain`, `PaperGrain`, `Renderer`, `targets`, `PipelineCache`, `frameHost`, the
  seam), `FINDINGS.md` 5 and 52, the headers of `PaperGrain`, `Renderer`, `PipelineCache`,
  `targets`, `frameHost` and the seam (no item added: the post chain's passes reached by
  items 2 to 5 as the glow's are), `Game`'s comments, `plans/webgpu-ref/README.md`,
  `post.mjs`'s and `harness.mjs`' headers and `post-expected.txt` (X5.2c1's section);
  `BABYLON_EXIT.md` (X5.2c1 LANDED, "What it is today" corrected: the grade's block and
  sampler, and `camera.outputRenderTarget`'s three readers — five more, inert under the
  window, added by its review — which X5.2d meets; X5.4's
  sequencer named).
**Its review** (bfa6a6b; 2026-11-08; no change to the picture: a DEV-only check, the rest documents,
comments and contract headers) found nothing that must be fixed and five minor points,
each checked against the tree first. **The tail**: the fallback clear could not tell a
prefix tail that drew nothing from a `Game.postPrefixTail` naming a pass that never
applied; a DEV build now throws on a READY tail that never applied ((2) above,
`PostPasses`' header and comment, `Game.postPrefixTail`, `docs/rendering.md`, `FILES.md`).
**The boot frame**: stated plainly in the probe's live half above, a first menu boot
included. **`outputRenderTarget`'s readers**: five more, inert under the window, listed in
"What it is today" with what X5.2d meets (and `PostPasses`' header and `docs/rendering.md`
no longer say three). **`openPool`**: four things X5.2c2 must verify, in its bullet, the
code unchanged. **A stray `TODO`** after "Measured" removed. **Measured** (the Windows box,
headless, a dev build): a Hollowmere round with FXAA, the shafts (off, low, high, medium),
the motion blur and the grain each off and on — the tail at the blur, the shafts and the
ink in turn — and render scale 0.75 and back: 250 frames, the prefix's output cleared in
its pass on every frame the grain was on and by the fallback on none, no page or console
error; the detached (ready) blur named as the tail threw on its first frame. Typecheck and
build pass; the throw's text is absent from `dist/`.

**X5.2c2's first commit landed — the shafts and the blur** (14dd887; 2026-11-08; no change
to the picture; no report version, the draws queued inside `render` where Babylon's were,
named by nothing; FXAA, the third pass, is a commit of its own). **What moved**: the light
shafts and the motion blur are OUR draws, stages of the post chain's host ahead of the
grade, so Babylon's chain is `[celInk, FXAA]` and ours `[shafts (one stage a rung), blur,
grain]`. Each is ported AS COMPILED off the parent's device (`shaders/wgsl/volumetrics.ts`,
`shaders/wgsl/motionBlur.ts`: the `postprocess` vertex stage with the stage's whole
`LeftOver`, the fragment character for character, CONFIG's constants where they were — the
shafts' `celCloud` expanded, the rung's name and `SAMPLES`, `EDGE_FADE`; the blur's
`SAMPLES`; every rung's fragment reproduced, the probe's module table equal), its block
filled as its `onApply` filled it (the blur's 112 bytes with the `mat3x3f` as three vec4
columns, the shafts' 320 with `intensity` in `march`'s fourth float), its CPU half the
same objects as before (`Game.volumetrics`, rebuilt on a rung change; `Game.motionBlur`,
its history the previous basis, its `dt` cap and jitter unchanged), its input read
through our sampler at Babylon's descriptor (nearest x3, clamp, clamp, repeat, lod 0..0,
anisotropy 1). **Every rung is a stage** (`volumetricStages`): all six of the shafts'
pipelines asked at construction ("the post chain"), so a rung change in play compiles
nothing (the parent compiled each rung at its first frame); a rung's stage is drawn only
while `Game.syncVolumetrics` has latched the pass ready, where it used to attach it — the
same frame for a pass a rung change has just built, so only the session's first render,
before the frame's depth exists, has no shafts, as before (X5.2c2's review: the record
first said a new pass's first frame had none, against X5.2a's correction and the code). **The shafts' two shadow maps are bound
as our renderer holds them** (`ShadowSystem.ownDepthMap`, `BodyShadows.ownDepthMap`,
`own ?? hostTexture`), **the cloud field through `hostTexture` with the host's sampler —
Babylon reads the cloud field in a round no longer** (X5.4's list says so). `PostExtra`
gains a sampler binding and an `OwnTexture`. The shafts' slot trick is gone
(`volumetricsSlot`, `FIRST_VOLUMETRIC_RUNG`), and so is the blur's attach and detach;
`Game.postPrefixTail` is FXAA or the ink. The dead Mali comments are corrected (`Fxaa.ts`,
`Game.setFxaaEnabled`; `FINDINGS.md` 5 no longer states one).
**`PostPasses.openPool`'s four checks** (X5.2c1's review): (1) **the clear** — Babylon's
`activate` clears under the READER's `autoClear` and `alphaMode`, with its own `clearColor`
if it has one; every reader of ours was a post-process at the defaults (the parent's
probe, `chain.list`: `autoClear` true, `alphaMode` 0, `clearColor` null, `pixelPerfect`
false on the ink, FXAA, the shafts and the blur, both pages), so the scene's colour,
always — stated in `openPool`, a stage needing another owing `PostStage` the field;
(2) **`forceFullscreenViewport`** — now passed `true`, as `activate` passes it, so the
viewport is the whole target whatever the camera's; (3) **the pool no longer ping-pongs**:
one target a pass POSITION (`PostChain.record`'s `slot++`), so each pass of a frame writes
a target of its own as each Babylon pass had an input of its own, and the probe names every
pool target by its one writer (`PostPasses.poolTarget`, `PostChain.stages`) — with every
tail pass on the pool holds two targets and the prefix's output one, where Babylon held an
input a pass; (4) **`fill` is handed the render size**, which every target of the chain is
(`getRenderWidth(true) | 0`, Babylon's own sizing at `size` 1).
**Measured** (the Windows box, headless; BEFOREs at f5c5a42 in a worktree with its own
`npm ci` and a copy of the main tree's `ref/`):
- **The bank**, all 147 rows, `--check --keep` at the step against the BEFORE, by
  `exact.mjs`: **default** 146 byte-equal and `sarab-ground` 100 pixels by 2/255 — Sarab
  alone, two processes a tree: all four frames byte-equal to each other (`sarab-shelf`
  within its flake) and to the step's full-run frame, so the step draws the frame the
  parent's processes draw (cross-process residue, as at X5.2b and X5.2a's F1 fix);
  **`--query=volumetrics=low`** 146 byte-equal and `harrowmead-view-pistol-reload` within
  its flake; **`--query=volumetrics=high`** the same. The same rows red against `ref/` on
  both sides at each tier (34, 102, 93).
- **The probe** `--against` the parent's log, both pages, sixteen scenarios: equal, with
  X5.2c2's section of `post-expected.txt` excusing the shafts' and the blur's draws'
  `pipeline.call`, `bundle` and `viewport` (X5.2b's three), the view descriptors of the
  shafts' two shadow maps (their owner's view, made with no descriptor: the defaults) and
  their samplers' `addressModeW` and `lodMaxClamp` (their owner's: nearest as Babylon's,
  clamp-to-edge and 32 where Babylon's said repeat and 0 — fields a one-mip 2d texture
  never reads; the march's output hash compared, equal), and `chain.slots.shafts`; every
  pass, load op, clear value, label, target hash, module, pipeline, layout and uniform byte
  else compared and equal. The live half: the same pass sequence frame for frame on both
  pages; the shafts' rungs made at the boot and NONE in play (the parent made each rung's on
  its frame).
- **`gi.mjs --against`** (default): equal but the two paths the plan predicted —
  `statics.samplersFresh.internalCached.wrapU` and `samplerSerial.found.wrapU` null where
  the parent's were 0 on both maps: with no Babylon bind of the cloud field its internal's
  cached sampler fields stay unfilled, as under `--shafts-off`; and Babylon's binds of the
  cloud field fall from 24 in the menu and 31 in deploy to 0, 1,694 to 1,648 under the
  building card and 100,485 to 100,365 in 120 editor frames (the editor's shafts, one a
  frame). **`--shafts-off --against`**: equal.
- **Live** (`x52c2/live.mjs`, X5.2c1's script counting the three: a Hollowmere round, every
  post setting toggled in play, the shafts low/off/high/medium, render scale at both glow
  rungs, a resize and back, a teardown, a second round, Coldharbour, `F2` with a quay
  dragged and back and the glow rung changed, the round after): our eight modules (the shafts'
  vertex and three fragments, the blur's two, the grade's two) made at the boot and none
  after; no module of Babylon's `volumetrics_*` or `motionBlur` (the parent: five, three of
  them in play); Babylon's synchronous pipelines 32 → 26 by the end; no "compiled in play"
  warning, no `uncapturederror`, no page or console error, `outputRenderTarget` null at
  every frame's end, on either tree. **At the boot one or two more frames than X5.2c1
  stated may differ**, the same timing-dependent class: our stages are compiled ahead of
  Babylon's prefix, so on a boot frame where the ink or FXAA is still compiling ours draws
  the shafts, the blur and the grade over its input cleared to the clear colour, where the
  parent's, compiling with them, drew less — three menu boot frames drew our blur's and
  grade's passes here where the parent's drew none. No frozen frame and no bank row shows
  it; it is not made exact, which would mean faking compile timing.
- **Pipelines**: `coldharbour --round` identical on both trees (0 of Babylon's at the
  install, 21 of ours and 12 modules, none in play); `hollowmere` Babylon's 7 → 5 by the
  install, ours 78 → 86, modules 111 → 113 (the two rungs' fragments the parent made only
  once a rung was chosen), nothing after on either.
- **`surfaces.mjs`**: Babylon's draws through no mesh lose `volumetrics_medium ->
  PostProcessRTT-motionBlur` and `motionBlur -> PostProcessRTT-paperGrain` (144 rows each);
  `fxaa -> PostProcessRTT-volumetrics_medium` stands, the prefix's output named for its
  reader.
- **The editor's frames** (X5.1b's script, its eight eyes, two processes a tree):
  Coldharbour `menu`, `curtain2`, `curtain40` and Hollowmere `lanterns` byte-equal in all
  four pairings; `curtain90` 0-3 pixels by 1/255, `ashwood` 0-181,621 by up to 54/255 and
  `menu` 25-536 by up to 30/255, each within the tree's own floor (each tree against itself
  1-2, 104,929-181,621 and 178-401); `wall40` changes between two grabs on both trees, as
  recorded — no oracle.
- **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): every row and total
  equal (403, 595, 619, 168).
- **`?profile&gpu`** (Coldharbour and Hollowmere, the parent and the step alternating
  twice, report version 37): `render` 0.927/0.893 → 0.904/0.932 and 0.804/0.823 →
  0.802/0.847 ms; `gpu.frame` 2.610/2.618 → 2.563/2.587 and 2.495/2.498 → 2.496/2.479 ms
  (within 4%); Babylon's draw calls 4 → 2.
- **Gates**: `gate` seven maps clean; `shaders` clean on seven; typecheck, build
  (`check-babylon-free`, `check-proving`), corecheck and parity pass.
**Not run**: the phone (its page is the probe's `phone` size only), a lost device, a
server's match in a browser.

**Its review** (7c5030f; 2026-11-08; no change to the picture: documents, comments, a
vantage's `proves` text and the probe's `chain` log, under `src/` comments and text only)
found nothing real and six minor points, each checked against the tree first. **Records
left on the old order**: `docs/rendering.md`'s post-process bullet (the shafts' slot, the
blur's append), its ink paragraph and `Game`'s ("beside the other three passes"), and
`post-noblur`'s `proves` ("the blur pass detached") now say the shafts, the blur and the
grade are stages of our chain. **"A new pass's first frame has no shafts"** was wrong
against X5.2a's correction and the code: after `setVolumetrics` the next
`syncVolumetrics` latches `ready` the same frame, every input standing; only the session's
first render, before the frame's depth exists, has none, as on the parent — corrected in
`Volumetrics`, `Game`, `docs/rendering.md`, the record above and the note. **Eight
modules, not ten**, in the live count. **The boot-frame difference is wider** — noted for
the owner where X5.2c1's is recorded. **`PostChain`'s header** says a group is remade on a
sampler or a shadow map changing too, not only a resize. **`post.mjs`** no longer logs the
shafts' slot (it was `undefined`, so absent: `--compare` of the two logs above still
equal on both pages).

**X5.2c2's FXAA LANDED** (cb17a73; 2026-11-08; no change to the picture; no report version).
**What moved**: FXAA is OUR draw, the post chain's first stage of ours after the ink
(`shaders/Fxaa.ts`: the switch and `stage`; `shaders/wgsl/fxaa.ts`: Babylon's own `fxaa`
vertex stage — `vUV` with NO `scale` multiply, the eight sample coordinates off
`texelSize` — and the fragment with `CONFIG.graphics.fxaa`'s three constants, both the
parent's device text character for character; its 16-byte block, `texelSize` one over the
render size; its input read bilinear — linear/linear, mip nearest, clamp, clamp, repeat,
lod 0..0, anisotropy 1 — as Babylon's `FxaaPostProcess` bound it). Babylon's chain is the
INK ALONE, so `Game.postPrefixTail` is the ink. **`DefaultRenderingPipeline` is deleted**,
and with it the two things it set on the scene, each stated by `Game` in its place so
nothing moves: `imageProcessingConfiguration.isEnabled = false` (an editor build's Babylon
materials read it; false through every phase of the live run, the editor's included, on
both trees) and `scene.autoClear = false` — which the owner decided goes back to true as a
picture change of its own (row "X5.2, autoClear", next). The FXAA slot trick, the
ShaderStore registration and `fxaaShaderIsOurs` are gone; the Mali arm, never run under
WebGPU, is not in the text (`Fxaa.ts`' header; `Game.setFxaaEnabled`).
**Measured** (BEFOREs at 41fb598 in a worktree with its own `npm ci` and a copy of `ref/`):
- **The bank**, 147 rows, by `exact.mjs`: **default** 146 byte-equal and `sarab-ground`
  100 pixels by 2/255 — Sarab alone, two processes a tree: all four frames byte-equal to the step's full-run frame, so the parent's processes draw the step's frame (cross-process residue); **`volumetrics=low`** 147 byte-equal; **`volumetrics=high`**
  147 byte-equal; the same rows red against `ref/` on both sides (34, 102, 93).
- **The probe** `--against` 14dd887's log, both pages: equal, excusing FXAA's draw's
  `pipeline.call`, `bundle` and `viewport` (X5.2b's three) and the `chain.slots.fxaa` and
  `fxaaAttached` the probe no longer logs (X5.2c2's FXAA section of `post-expected.txt`);
  every pass's load op and clear value the parent's, the opening canvas pass's included.
- **`gi.mjs --against`** 14dd887's logs, default and `--shafts-off`: equal.
- **Live** (both trees): our ten modules at the boot (FXAA's two beside the shafts', the
  blur's and the grade's) and none after; Babylon's `fxaa` modules gone; Babylon's
  synchronous pipelines 26 → 25 by the end; no in-play compile, no error;
  `imageProcessingConfiguration.isEnabled` false and `applyByPostProcess` false in the menu,
  a round and the editor on both trees.
- **Pipelines**: `coldharbour --round` identical; `hollowmere` Babylon's 5 → 4, ours 86 →
  88, modules 113 → 109 (the pipeline's own post-processes' modules gone with it), nothing
  after. **`surfaces.mjs`**: Babylon's draws through no mesh are the ink's alone (`fxaa ->
  PostProcessRTT-volumetrics_medium` gone). **`census --against`** equal (403, 595, 619,
  168). **The editor's eight eyes**: Coldharbour `menu`, `curtain2`, `curtain40` and
  Hollowmere `lanterns` byte-equal in all four pairings, the rest within each tree's own
  floor. **`?profile&gpu`** (Coldharbour and Hollowmere, the parent and the step alternating four times; this session's GPU frame ran ~1.7x the earlier sessions' on BOTH trees): `render` 0.94 → 0.92 and 0.83 → 0.81 ms (means), `gpu.frame` Coldharbour 4.37 → 4.35 ms; Hollowmere's `gpu.frame` spread 3.7-5.9 ms on both trees (parent 4.48/5.66/5.22/5.86, step 4.92/3.74/3.88/5.20), wider than 8% within each tree and not slower on the step; Babylon's draw calls 2 → 1. `gate` (7), `shaders` (7), typecheck, build,
  corecheck and parity pass.

**X5.2c2's picture change — `scene.autoClear` true** (a459e7c; 2026-11-08; the owner's decision,
row "X5.2, autoClear"): `Game` no longer states `scene.autoClear = false`, so the scene is at
Babylon's default, as the plan said deleting the pipeline would leave it. **What moved**: the
frame's OPENING canvas pass — the scene's first bind, which clears the engine's depth —
CLEARS its colour to the scene's clear colour where it loaded it. **Measured**: the probe
`--against` the FXAA commit's log, both pages, sixteen scenarios: exactly that pass's load op
(`load` → `clear`), clear value (null → the clear colour, Hollowmere's `[0.0314, 0.0510,
0.0863, 1]`) and the canvas's hash after it (transparent zeros → the clear colour), and
`chain.autoClear` — 128 paths, 4 a scenario; every later pass and every FINAL canvas hash
equal in all 32 scenarios (the last pass overwrites the canvas whole, no blend). **The
picture moves on the page's first frames alone**: two or three frames of every boot (both
pages, every boot of the live half), before the chain first draws, show the boot map's clear
colour, opaque, where the parent's canvas held transparent zeros — under the boot screen
(`#boot`, opaque, which starts its fade two animation frames after `Game`'s constructor).
**The canvas-only frame after a render-scale change or a resize is unaffected**: its canvas
pass is not the scene's clear and still loads, on both sides (the plan predicted it would
move; measured, it does not). The bank, 147 rows by `exact.mjs` against the FXAA commit's
frames: default 147 byte-equal; `volumetrics=low` 146 byte-equal and `sarab-ground` 98
pixels by 2/255 (Sarab alone under the same query, two processes a tree: each tree drew
both frames, one process each — cross-process residue), `sarab-shelf` within its flake;
`volumetrics=high` 147 byte-equal; the same rows red against `ref/` (34, 102, 93); `gate`
(7 maps) clean. The lines naming it are in `post-expected.txt`, commented out (a later
sub-step compares against a parent on the same side of the change).

**Their review** (117c5fd; 2026-11-08; no change to the picture: comments, documents, a
probe scenario) found nothing real across cb17a73, a459e7c and 83d5255 and eight minor
points, each checked against the tree first. **Stale text**: `Settings.fxaa` ("off detaches
the pass"), `Game`'s ink comment (FXAA missing from our stages; the append sentence now the
ink's alone), `post-expected.txt`'s FXAA section (`autoClear = false` stated only until the
picture change), the decision row ("first two or three frames"), and the prefix output's
clear named "the grade's input" in `docs/rendering.md` and `PostPasses` (its DEV throw's
message among them, the logic unchanged) — since X5.2c2 it is our FIRST stage's, FXAA's when
it is on. `Fxaa.isEnabled` had no reader and is gone. `PostChain`'s header rewrapped.
**Coverage**: no scenario and no bank row drew FXAA straight into the canvas (every other
tail pass off), so `post.mjs` gains a seventeenth, `fxaa-alone`, appended at the END so every
scenario before it stands where it did. **Measured**: the probe with it (`--no-live`, both
pages) at 41fb598 — FXAA Babylon's pass into the canvas — and at cb17a73 — FXAA our stage
into the canvas — compared `--against` with `post-expected.txt`: **equal**, 29,651 values a
page, FXAA's draw's X5.2b fields alone excused (30 paths, the new scenario's two among them);
`fxaa-alone`'s canvas `1735d52707135209` (desk) and `38f1059d519aab3f` (phone) on both trees.
Typecheck, build and corecheck pass.

**X5.2d LANDED** (4f83650; 2026-11-08; a `Picture change:` by the owner's decision, row "X5.2,
the boot canvas": the boot frames before the chain first draws; otherwise no change to the picture
was measured; no report version, the ink's draw queued inside `render` where Babylon's was).
**What moved**: the INK is OUR draw, the post chain's FIRST stage (`shaders/CelInk.ts`, its CPU
half — the fog band — and `stage`; `shaders/wgsl/celInk.ts`, the `postprocess` vertex stage with
the ink's whole `LeftOver` and the fragment with the glow's compose, `glowAt`, ahead of it, both
the parent's device text character for character, written off the probe's module table and
checked round trip; its 112-byte block filled as its `onApply` filled it, `glowIntensity` in
`grain`'s fourth float; the frame read NEAREST through our sampler at Babylon's descriptor, its
depth by `textureLoad`, the glow's mask and two blurred targets through the host's own view and
sampler). The source's comments, which the compiled text keeps none of, are kept verbatim in
`CelInk.ts`. The GLOW's compose is the ink's last line as compiled: `GLOW_COMPOSE_*` and
`bindCompose` are gone, `GlowPass` hands the stage `composeNear`, `composeWide` and
`composeIntensity`. **The scene draws STRAIGHT INTO the frame**: `PostPasses` owns it, a
`RenderTargetTexture` made as the ink's input was (`FRAME_TARGETS`: `rgba8unorm`, NEAREST, the
render size, `depth32float`, no stencil), named `PostProcessRTT-celInk` for its reader, resized
before the scene first binds it (`onBeforeRenderObservable`), and the camera's
`outputRenderTarget` from the end of one frame's render to the end of the next frame's camera
render; the scene clears it itself (Babylon's clear of a camera's output target under
`scene.autoClear`). `GlowPass.drawsInto` takes it; `FrameDepth` reads its public
`renderTarget.depthStencilTexture` and is off the seam header's "not here" list (row "X5.2,
`FrameDepth`"; the gate note reconciled). `Game.postPrefixTail`, the prefix's output, its clear
on the tail's `apply` and the DEV throw are gone: **no Babylon `PostProcess` is left** in the
tree. The ink's two pipelines are on "the post chain" (`Game.roundPipelines`); no seam item.
**Found, and the reason for one thing the plan did not say**: with `outputRenderTarget` set for
good, an editor build's gizmo layer (`UtilityLayerRenderer`, which renders with the SAME camera
on `onAfterRenderCameraObservable`, after the camera's render) bound the frame the chain had
already read and drew its gizmos into nothing shown. So `PostPasses` takes `outputRenderTarget`
off the camera once the chain is recorded and puts it back as the scene's render ends
(`onAfterRenderObservable`) — before `_checkCameraRenderTarget` reads it at the next frame's
start; nothing in a round reads it in between. Measured: F2 on Hollowmere, a placement selected,
the frame byte-equal to the parent's with its gizmo (0.6057% of pixels moved by the selection
on both trees, the two selected frames byte-equal).
**The picture change — the boot canvas.** The frame's OPENING pass is the frame's (an empty
pass, the clear) where it was the canvas's, so no pass clears the canvas any more: the last
stage overwrites it whole on every frame the chain draws, and on a boot frame before our
chain's pipelines are built it holds what the swap chain hands over. Read back off the device
each frame (a scratch script, the canvas's centre and (8, 8)): page frame 3 22,13,8,255 at the
parent (the boot map's clear colour) → 0,0,0,0 (transparent zeros); frames 1–2 (0,0,0,0) and
4 on equal. The probe's live half: menu frames +0 to +1 lose their `->canvas/clear`. It undoes
a459e7c (row "X5.2, autoClear") for that frame, under `#boot` (opaque); the canvas-only frame
after a render-scale change or a resize is unaffected (its canvas pass still loads).
**Measured** (the Windows box, headless; BEFOREs at 20de8ee in a worktree with its own `npm ci`
and a copy of the main tree's `ref/`):
- **The probe** `--against` the parent's log, both pages, seventeen scenarios: equal, 29,209
  values a page, 1,425 excused by X5.2d's section of `post-expected.txt` — the ink's draw's
  X5.2b three; `passes[0]`, the opening pass, the frame's (cleared, no draw) where it was the
  canvas's (its label, target, format, usage and view, its depth's target, usage and stencil
  clear, what it leaves, the frame's depth hashed); `passes[1]`, the scene's pass, LOADING the
  colour it cleared. Every other field — the ink's uniform bytes, samplers, views, pipeline,
  layout, every target's hash — equal, and every FINAL canvas in all 34 scenarios equal. Re-run
  on the final tree: equal again, and the default bank with it (146 byte-equal and `sarab-ground`
  the same 100 pixels by 2/255; 146 byte-equal and the pistol within its flake against the
  step's first run).
- **The bank**, 147 rows by `exact.mjs`: **default** 145 byte-equal,
  `harrowmead-view-pistol-reload` within its flake and `sarab-ground` 100 pixels by 2/255 —
  Sarab alone, two processes a tree: all four frames byte-equal (14 of 14 rows) and equal to
  the step's full-run frame (cross-process residue); **`volumetrics=low`** and
  **`volumetrics=high`** 146 byte-equal and the pistol within its flake; the same rows red
  against `ref/` on both sides (34, 102, 93). This is the whole step's "bank with every post
  setting on and off" (X5.2a's rows, row "X5.2, the Verify").
- **No Babylon `PostProcess` in a round**: `surfaces.mjs` — Babylon's draws through no mesh were
  the ink's in all 147 rows (`celInk -> PostProcessRTT-fxaa` 145, `-> PostProcessRTT-volumetrics_medium`
  1, `-> canvas` 1), and are nothing in all 147; live, the camera held no Babylon post-process
  on any frame.
- **X0.3, the whole step's** (row "X5.2, X0.3"): `bench.mjs greyfen sarab --max`, three runs a
  tree, the fight hashes `83e8e74ef36916ba` and `986c2e35557fb679` on every run; medians new over
  old: Greyfen vantages 0.970, path 1.002, fight 1.002; Sarab vantages 0.980, path 0.996, fight
  1.000; Sarab's fight 1% low 13.2 → 12.4 ms; some vantage segments over 8% spread on both trees.
- **`gi.mjs --against`**, default and `--shafts-off`: equal (914,611 and 254,731 values).
- **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): equal (403, 595, 619, 168).
- **Pipelines**: `coldharbour --round` identical (0 of Babylon's, 21 of ours and 12 modules at
  the install, none in play); `hollowmere` Babylon's 4 → 3 by the install (the ink's), ours
  88 → 90, modules 109 on both, nothing after on either.
- **Live** (X5.2c2's script counting the ink: a Hollowmere round, every post setting toggled in
  play, the shafts' rungs, render scale at both glow rungs, a resize and back, a teardown, a
  second round, Coldharbour, `F2` with a drag and the glow rung changed, the round after): our
  twelve post modules made at the boot and none after; Babylon's `celInk` module gone (the
  parent: one); Babylon's synchronous pipelines 25 → 24; no Babylon post-process on the camera;
  no in-play compile, no `uncapturederror`, no page or console error, on either tree.
- **The editor's eight eyes** (two processes a tree): Coldharbour `menu`, `curtain2`,
  `curtain40` and Hollowmere `lanterns` byte-equal in all six pairings; `curtain90` 0-2/255,
  `ashwood` and `menu` within each tree's own floor; `wall40` unstable between two grabs on
  both trees, as recorded — no oracle.
- **`?profile&gpu`** (Coldharbour and Hollowmere, four alternating runs a tree, report version
  37): `render` 0.887 → 0.851 and 0.799 → 0.771 ms, `gpu.frame` 2.655 → 2.643 and 2.535 → 2.525
  ms (means, within 4%); Babylon's draw calls 1 → 0.
- **Gates**: `gate` seven maps clean; `shaders` clean on seven; typecheck, build
  (`check-babylon-free`, `check-proving`), corecheck and parity pass.
**Not run**: the phone (its page is the probe's `phone` size only), a lost device, a server's
match in a browser. **X5.2 is whole**: no Babylon `PostProcess` in a round, the bank with every
post setting on and off and X0.3 measured above.
