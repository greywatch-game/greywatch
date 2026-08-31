# The map editor (dev only)

What `F2` opens, what it deliberately refuses to do, the two pointer modes, the
three rebuild tiers, and how a save patches authored source rather than
regenerating it. Split out of [`CLAUDE.md`](../CLAUDE.md), which keeps the
summary; this file is the contract for `src/editor/` and the dev-only write
endpoint in `vite.config.ts`.

`F2` in a dev build opens `src/editor/` — free-fly the real scene, click to select,
drag gizmos, edit properties, add and delete entries. Everything under
`src/editor/` is reached through **one dynamic `import()` inside a
`import.meta.env.DEV` branch in `Game.toggleEditor`**, and the *whole method body*
is behind that gate, not just the keybind — that is what makes the import unreachable
under `vite build` so Rollup drops the chunk. Never import `src/editor/` statically.

Things it deliberately does not do:

- **It does not make visuals pickable.** Babylon skips the `isPickable` test when a
  pick supplies a predicate, so the editor picks on `metadata.editorRef`.
- **It does not build colliders.** Proxy meshes for flags, spawns, scatter regions
  and water/grass/terrain rects are visual only and never enter `colliderBoxes`.
- **It does not re-run builders to move things.** A builder assembles at the origin
  and `MapBuilder` transforms the result, so `repositionItem()` moves the visuals, the
  collider proxies and the `WorldBox`es directly.
- **It does not bake reflections, and it registers no physics world.** Both are
  build steps that are affordable because the world is static, and this is the
  view where it is not: they are refused on the `editor` flag `installMap`
  already carries. The bake was one frame of ~300,000 draw calls after every
  tier-3 rebuild on Coldharbour — see [`rendering.md`](rendering.md). The glass
  still draws; it shows the analytic sky and no city.

  **What that frame costs is now a measured time and not just a draw count, and
  it is bigger than the figure this rule was written against.** The SHIPPED bake
  — 40 probes over a render list of ~486 — is **~1.4–2.1 s in one frame** on the
  RTX box, and it scales almost linearly with the list
  ([`FINDINGS.md`](../FINDINGS.md) #10). The editor's is 82 probes over 610
  unmerged meshes, so it is the larger of the two by both terms. That is not a
  new measurement of the editor and is not quoted as one; it is the reason the
  refusal is a rule rather than a tuning knob, restated in a unit a person
  waiting for a brush stroke can feel.

**There are two pointer modes.** `T` toggles terrain mode and the panel turns
violet, because a mode you forget you are in makes every click feel broken. The
ground is *under* everything, so a terrain annotation is a flat sheet competing for
the same click as the water rect, the grass rect and the jetty standing on it —
whichever is on top wins and the rest become unselectable. In terrain mode only the
ground answers; in object mode terrain is not in the pick at all.

In terrain mode the cursor highlights the cells it covers, `[`/`]` resize the brush,
and the left button draws with one of **two tools**, swapped with `F`: **sculpt**
(drag up or down to raise or lower the cells under a brush that stays where it was
pressed) and **level** (the click samples the height under it and the brush then
paints, pulling everything it is dragged over to that one height). Free-hand
sculpting cannot produce a flat basin floor or a pad that meets the ground around
it, and the nav grid's slope limit and a building's footings are exactly what
"slightly different every pass" ruins.

Both apply a linear falloff from the inner half outward. A hard-edged brush would
make a cliff on its first click, which the nav graph then refuses to walk across;
for the level tool the same falloff blends a levelled pad into the ground around it.
The status line shows the steepest gradient under the cursor against
`MAX_WALKABLE_GRADE` and turns red past it, and names the armed tool.

A stroke is **absolute, not incremental**: the affected vertices are snapshotted
when the drag starts and every mouse move re-derives from that snapshot, so the
result cannot depend on frame rate or mouse speed. Painting makes the same rule do
more work — a vertex remembers the height it had when the stroke *first* touched it
and the *strongest* weight any pass has given it, so dragging back and forth settles
instead of creeping toward the target. Pointer moves are sampled rather than
continuous, so the gap between two is filled with stamps half a brush apart; without
that a quick drag leaves a dotted line of untouched cells, which on a level stroke
is precisely the "nearly flat" it exists to eliminate.

During the stroke only the floor's *visual* blocks are re-tessellated
(`TerrainBrush.reapply`, sub-ms); colliders, navigation and everything whose `y`
rides the ground are stale until release, which schedules the debounced rebuild.
That split is why it feels immediate — nothing walks on the ground mid-drag. It is
also why the brush picks against the floor's **visual** blocks rather than its
`solid` clones: the two carry the same vertices except mid-stroke, and a painting
brush following the stale collider would drift away from the ground being levelled.

**Proxies and gizmos work in world space; the layout stores heights above the local
floor.** `originOf` adds the terrain height and `applyTransform` subtracts it again,
so a rect in a basin draws where it actually is and a round-trip drag writes back
the same relative offset. Getting this wrong is not subtle: a translucent proxy
sheet left at the raw layout `y` hangs over a dug basin and washes it flat, which
reads as the ground having disappeared. `waterY()` lives in `TerrainField.ts` so
`WaterSystem` and the proxy cannot disagree.

**Three rebuild tiers, decided by what changed.** Measured: a full editor build is
~570 ms, `NavGrid` + all 7 flow fields ~45 ms, one builder call ~0.9 ms.

| change | tier | cost |
| --- | --- | --- |
| dragging a gizmo | move that item's meshes and `WorldBox`es | sub-ms, every frame |
| drag released, flag/spawn edited | `NavGrid` + 7 flow fields + `ObstacleField` | ~45 ms |
| param, kind, add, delete, brush stroke released, **road drag released** | `Game.buildEditorMap()` — the whole map | ~570 ms |

**Two derived structures are NOT in that table and go stale on a drag: `map.rays`
and `map.collidables`.** Both are built once from the finished collider set in
`MapBuilder.build`, and tier 1 moves a placement's collider meshes and its
`WorldBox`es in place (`repositionItem`) without touching either index — so
until something forces the tier-3 rebuild, a round fired at a dragged building
resolves against where it USED to be, and a hull sweeps against the same ghost.
This has always been true of `RayWorld` and is stated here rather than fixed,
for the reason there is no undo: the editor is dev-only, every structural change
rebuilds the map anyway, and leaving the editor rebuilds from source. Anyone
adding a third such index should know it joins these two rather than being
special.

**That ~570 ms is Hollowmere's, and a map is allowed to cost much more.**
Coldharbour measures ~2.3 s for the same tier — nearly all of it
`MapBuilder.build`, and over half of that the 6,139 glazed sheets it draws and
then merges — off *fewer* placements than Hollowmere has. It is what starting a
round there costs too; the editor's difficulty is that it pays it per edit. See
[`FINDINGS.md`](../FINDINGS.md) 11 before reaching for it.

The third tier is not laziness. Changing a param changes how many colliders an item
emits, which shifts every later index in `colliderBoxes` and invalidates the
per-item editor index wholesale; there is no correct patch, only a rebuild. A road
earns it for a different reason: its vertices were cut against the ground it started
on, so a translate leaves it contoured to the wrong patch of floor
(`CONFORMS_TO_TERRAIN` is the list). It is debounced by `EDITOR.rebuildDelay` so
holding a spinner does not queue thirty builds, and *not* debounced for add/delete,
which are single deliberate actions. Anything the editor holds that points at
geometry — highlight, gizmo anchor, selection — is re-derived after it rather than
patched. **A `SelectionRef` is a list plus an index, so deleting invalidates every
ref after it in that list**: the editor drops its selection on delete rather than
fixing them up, and `applyStructural` runs the rebuild immediately rather than
leaving stale indices addressable.

Property editing is driven by three files that must agree on what a field key
means: `fields.ts` declares the vocabulary (dotted paths like `params.width`, plus
the three compound keys `kind`, `owner` and `shape` that write more than one field),
`inspect.ts` produces the controls, `mutate.setField` applies them. Two rules keep
the layout terse: **a value equal to the builder's own default is removed, not
written**, and absent-means-default fields (`y`, `rotY`, `blocking`, `clearance`,
`density`, `scale`) disappear when cleared rather than being written as an explicit
zero. Angles are edited in degrees and stored in radians so `Math.PI / 2` survives —
see `qAngle`.

**The map's FLOOR is edited through that same inspector, off a `SelectionRef` that
names no layout array.** `{ list: "floor" }` is a singleton ref reached from a panel
button — never from a pick, because the floor is under everything and picking it
would take every click meant for what stands on it, the same competition terrain
mode exists to settle. It rides the selection union rather than getting a panel of
its own because everything downstream of a selection (the shape-diffed inspector,
the debounced rebuild tier, the dirty flag) is written against a ref, and a second
path through all of that to edit two fields is the expensive way to spell it. Two
seams it opens: `setField`'s contract is "a layout entry, mutated in place", so the
floor takes its own writer (`setFloorField`) which also **reports whether anything
moved** — a colour input fires on every step of a drag and each step would otherwise
buy the ~570 ms rebuild; and the inspector's controls are now live whenever there
are any, with only the delete BUTTON conditional, since the two used to travel
together and a map cannot be without a floor. `fields.ts` grew a `color` kind for
it — a hex string is not something anyone can read as a colour, and choosing one
against the map it is going onto is the whole point of doing it here.

**Saving (`Ctrl+S`) patches `layout.ts`'s text; it does not regenerate it.** The
file is authored — the ASCII village map, the district commentary, and
`BANK_H`/`TERRACE_H`/`VALEGUARD`/`REDLINE` in place of bare numbers would all die on the
first save of a code generator. So the editor rewrites only the lines that changed:
an entry nobody touched is re-emitted **byte for byte** (a no-op save is verified to
reproduce the file exactly); an edited entry is rebuilt field by field, and each
field still equal to what was loaded re-emits its **original source token**, which is
how `TERRACE_H` and `Math.PI / 2` survive on a rewritten line (comparison is against
a deep snapshot taken when the editor opened, so nothing ever evaluates those
expressions); a **deleted** entry's line goes with it and nothing around it moves;
an **added** entry is written fresh at the end of its array.

**A `LayoutSaver` is bound to ONE map, by id, and checks that it is.** The id picks
the source text (out of an `import.meta.glob` of every `world/*/layout.ts` — a `?raw`
specifier is static and cannot be chosen at runtime), both write paths, and the
heights module's export name. Every map's `layout.ts` has the same *shape*, so a
saver holding map A's text and handed map B's layout patches the wrong file and
mostly **succeeds** at it — the one failure mode here that loses work with a clean
"saved" in the status bar. The constructor refuses unless the source it found
declares that map's own `export const <MapId>Layout`, failing into `blocked` rather
than throwing. `serializeHeights` takes the id for the same reason: it writes the
`export const <MapId>Heights` that map's own `heights.ts` declares, and a wrong
name there is a checkout that stops compiling after a terrain save.

**The floor it writes is an ARGUMENT to `save`, not a field on the layout.**
There is no `MapLayout.terrain` any more — a heightfield reaches a build
through `MapDef.heights`, a lazy `import()` (ENGINE_UPGRADE.md S7) — so what
the editor hands the saver is `map.terrain.field`, which is the object the
terrain brush has been writing through and the same one the rebuild tier reads
back. `terrainGrade` in `validate.ts` takes it from the same place, and is
beside `hygiene` rather than inside it for that reason: it is still a static
check, but it is no longer one of the layout's.

**`environment.ts` is the third file a save may write, and it is patched one KEY
at a time** (`src/editor/saveEnvironment.ts`). The floor picker is what writes it,
and the file is authored in the same sense `layout.ts` is — nearly every colour in
a spec carries the argument for why it is that colour — so the same rule applies:
rewrite the line, leave everything around it alone. It is deliberately **not** built
on `sourceScan.ts`, which models flat arrays of one-line entries anchored on their
own `const name: Type = [`; a spec is one nested literal with multi-line members,
exactly the shape that scanner refuses to touch. Three rules make the shortcut safe:
a key is anchored at the literal's **own two-space indent**, so `lighting`, `sky`,
`water` and `grade`'s members (four spaces and deeper) are unreachable by
construction; the anchor must match **exactly once** or the patch is refused rather
than guessed; and the source must declare that map's own
`export const <MapId>Environment`, the same pairing check and the same silent
failure mode `LayoutSaver` documents. A `null` value REMOVES the line, which is how
`floorSurface` returns to its default. What it cannot do is keep the **comment**
above a key true — that prose is the author's, and after re-tinting a floor from the
editor the note explaining the old colour is theirs to bring back into line.

**`vite.config.ts`'s `WRITABLE` stays a literal table — three lines per map.** Path
safety comes from the client's path only ever being *looked up* in it and never used
to build a path, so a regex or a directory listing trades the guarantee for
convenience in the one tool here that writes to disk.

Add and delete work because entries are matched to source lines by **object
identity**, not position — a `WeakMap` from the live layout entry to `{ line, values
}`, bound when the editor opens and rebound after each save (`Baseline` in
`serialize.ts`). Positional matching would go wrong the instant anything ahead of an
entry was deleted. Rebinding after a save is also what lets an entry added earlier
in the session be edited again rather than appended twice.

Gizmo output is quantised before it reaches the layout (`mutate.ts`), and positions
and angles **differently** on purpose. Positions round to 3 dp, matching what the
serializer writes. Angles must not: `Math.PI / 2` rounded to `1.571` is no longer a
quarter turn to within the emitter's tolerance, so it would be written as a bare
decimal and drift off house style — angles snap to the exact quarter turn when
within a whisker of one and keep 6 dp otherwise. Both then treat "close enough to
zero" as zero, so a drag returning something to where it started leaves no trace;
without that, an un-rotated building picked up a redundant `rotY: 0`, because
`1e-17 !== 0` survives the drop-optional-field test and prints as `0`.

**The two OPTIONAL lists are the case where there is no line to patch, and both
halves of the answer have to be present or it loses data.** `water` and `grass` are
optional on `MapLayout`, so a map may never have declared either — Coldharbour
declared neither. Adding to one used to fail outright (`addItem` returned null and
the panel said "cannot add to grass"), which read as the editor being broken on
exactly the maps that had none. It now creates the array (`arrayForOrCreate` in
`mutate.ts`) **and** `serializeLayout` writes the declaration the array needs:
the `const` after the last array already declared, the shorthand member in the
exported object, and the element type into the `import type` block, all three
anchored and each throwing a `SerializeError` rather than emitting a file that
will not compile. Fixing only the runtime half would be worse than the refusal it
replaced — `serializeLayout` walks REGIONS, so a list with no region is skipped in
silence and the rects vanish on `Ctrl+S` under a "saved" message.

This rests on two properties of `layout.ts` that `sourceScan.ts` re-checks every
session: **every array entry is exactly one line**, and each array is delimited by
its own `const name: Type = [` … `];`. Those declarations are the region anchors, so
the file needs no marker comments. That second property is also why a created
declaration is emitted across three lines minimum: `const grass: GrassRect[] = [];`
on one line matches no region next session, so the array would be invisible to
every later edit. A line that fails to tokenize becomes `opaque`
and is never rewritten — the failure mode is always "leave it alone". Multi-line
entries are the one thing that would break this; the editor treats one as a comment
and refuses to touch it rather than corrupt it.

**An entry may carry a `// …` note after its comma, and the note belongs to the
LINE rather than to the entry.** `splitComment` takes it off before the tokenizer
sees the literal, `emitItem` puts it back on a rewritten line, and a deleted entry
takes its note with it — which is what a note on that line means. Getting this
wrong is not a formatting complaint but a **locked map**: while the scanner tested
the whole line for a `},` ending, the four buildings Coldharbour labels this way
were `raw` lines, the region came up four entries short of the layout, and
`bindBaselines` — which refuses to guess which line belongs to which entry —
threw on open.

**The validation list ranks honestly, and the ranking is the design.** Errors are
definitely broken and are zero on a healthy map: a control point whose centre is not
standable (the Flag-C-on-the-well bug), and a flag or spawn unreachable from a home
spawn. Warnings need a human: the biggest is "standable ground nothing can reach",
which is *also* how a roof and the top of a boulder look. `validate.ts` filters both
out — roofs by height above adjacent walkable ground, prop stands by flatness — but
the nav grid cannot distinguish a boathouse deck from a large flat collider top, so
a handful survive on Hollowmere while it plays perfectly well. Read that number as a
**delta**: note it, move a wall, look again. `makeIslandTest` is shared with the
overlay so the red cells on screen are exactly the reported findings.

**A cell id decomposes as `cell = cz * dim + cx`, which is `NavGrid`'s convention
and not negotiable here** — `cell % dim` is the X column, `Math.floor(cell / dim)`
is the Z row. Every check in `validate.ts` had those two the other way round, and
the reason it survived is worth knowing before anyone writes the next check: the
8-neighbour table is closed under transposing `dx`/`dz`, so a walk over it gives
bit-identical answers, and only the step that leaves the grid for WORLD space is
wrong. So the bug hides in exactly the two places that matter. `validateClearance`
probed the obstacle field at the map's mirror image and reported **177 spots on
Greyfen and 813 on Hollowmere that do not exist — the true count is zero on both**,
while 659 and 1,286 surfaces respectively do get a genuine push-out and every one
of them lands somewhere walkable. An island's `at` flew the camera to a point
reflected across the diagonal. Neither looks wrong: a transposed probe still lands
on real geometry, and a mirrored camera position still shows you *a* part of the
map. `navOverlay.ts` had it right all along, which is why the overlay and the list
quietly disagreed about where a finding was. `cellX`/`cellZ`/`cellOf`/`worldOf` at
the top of the file are now the only decomposition; use them.

That flatness filter is why terrain is checked directly by `terrainGrade` rather
than left to `islands()`: a sculpting brush is a machine for producing unreachable
ground, but a flat pit floor looks exactly like the top of a boulder to the island
heuristic, so the one finding worth having is the one it suppresses. `terrainGrade`
scans every edge of the height grid against `MAX_WALKABLE_GRADE` and reports a count
with the worst offender's location — one finding per cell would bury everything else.

The `structure()` checks exist only because entries can be deleted: a duplicate flag
id silently merges two flags' flow fields (they are keyed by id), a spawn naming a
flag that no longer exists is skipped by `ConquestSystem` without saying so, and a
team with no home spawn deploys at the origin. None can happen by dragging
something, and all are errors.

**There is no undo.** The escape hatch is that leaving the editor rebuilds from the
layout module, so F2 (which asks first when there are unsaved edits) throws away
everything since the last save.

`vite.config.ts` holds the dev-only write endpoint. It is deliberately outside
`tsconfig.json`'s `include` (`@types/node` is not installed), so it stays trivial
and the real logic lives in `src/editor/serialize.ts` under the typecheck. Its
`handleHotUpdate` swallows the editor's own writes: none of the three files has
`import.meta.hot.accept`, so an update would propagate to `main.ts`, find no
accepting module, and full-reload the page on every save.

**Both sides of that swallow go through `norm`, and they have to.** The written
path comes from `resolve`, which uses the platform's own separators, while Vite
normalises the `ctx.file` it hands `handleHotUpdate` to POSIX ones — so on Windows
the Set was keyed on `C:\...\layout.ts` and probed with `C:/.../layout.ts` and never
matched. Nothing throws and no save fails; the page simply full-reloads on every
`Ctrl+S`, taking the camera, the selection and the whole session with it, which
reads as the editor crashing on save rather than as a path bug — and it cannot
reproduce for anyone authoring on Linux. Normalising both sides rather than adopting
Vite's spelling is what stops the two drifting apart again.

`build(layout, env, { editor: true })` skips `BlockMerge` so each placement keeps
its own meshes — ~1740 draws against ~150. **Never judge frame cost from the
editor.** Roads also go un-outlined there: in play they merge into one mesh first,
and kept separate each road's outline shell paints a black patch over every junction
it overlaps.

**Glazing takes the same exemption by a different route, because it has its own
second merge.** `PaneBlocks` keys per PLACEMENT in editor mode rather than per
map block, so a building's panes never merge with a neighbour's, and the
resulting mesh is handed back to that item's `visuals` and tagged like any other
— a dragged building takes its windows with it. Two things there are easy to get
wrong and neither says so:

- **A group of one is not baked.** `mergeByMaterial` bakes a lone mesh because
  its caller composes the placement's transform onto what it gets back;
  `PaneBlocks` has no such caller, so baking would flatten the transform into
  the vertices and `repositionItem` would then apply the placement a second
  time. The glass ends up at twice its own offset, drawn perfectly.
- **The tag is written after the merge, not before.** `MergeMeshes` disposes its
  sources and `Node.dispose` nulls their metadata, so a tag written on the way
  in survives only for a group of one — which is every group in editor mode
  today, and stops being so the first time a building is given two colours of
  glass.
