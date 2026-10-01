# Creating a new model

A new structure is a builder function, one line in two tables, and its
placements. Everything else — merging, culling, colliders, the nav graph, the
server's bake — follows from what the builder declares.

## 1. Where it goes and what it looks like

- **File by set, not by map.** `kit/buildings/` (village buildings),
  `kit/structures/` (small structures and cover), `kit/city.ts`,
  `kit/desert.ts`, `kit/harbour.ts`, `kit/japan/`, `kit/manor.ts` (one
  building in a file of its own), `kit/terrain.ts` (walked ground:
  roads, ramps, decks). A set that has outgrown one file is a DIRECTORY, as
  `kit/japan/`, `kit/buildings/` and `kit/structures/` are: one file per builder, what two builders share in a file
  of its own (its palette, its roof, its mason), and an `index.ts` that is
  the set's header and the barrel `BuildingKit.ts` imports — so a new
  builder in it is a new file plus a line there. The kit is map-agnostic — **nothing in a builder may
  special-case a map**, and anything built here is available to every map.
  Read the chosen file's header: several own rules every builder in them obeys
  (city's walked-storey rules, desert's stair lane).
- **Signature**:
  ```ts
  export function buildThing(scene: Scene, mats: CelMaterialFactory, p: BuildParams = {}, ctx?: BuildCtx): Structure {
    const b = new Build(scene, mats, "thing");
    ...
    return b;
  }
  ```
  Drop `ctx` if it neither seeds nor reads the ground. Build at the ORIGIN,
  unrotated, ground at y = 0; the layout's `rotY` turns it. Every part through
  `Build` — never `MeshBuilder` directly.
- **A header comment** in the house style: what it is, what it is FOR in play
  (cover height, sightlines, verticality), its nav budget if it stacks walked
  surfaces, and what it is drawn as. The next person reads this before editing.
- Then draw it by SKILL.md's procedure and craft.md.

## 2. Register it

1. `src/world/BuildingKit.ts`: import it and add `thing: buildThing` to
   `BUILDERS` (grouped with its set). `BuilderKind` derives from this.
2. `src/editor/params.ts`: a `PARAMS` row listing exactly the `BuildParams` it
   reads, with the builder's own defaults (`[]` if none). It is a `Record` over
   `BuilderKind`, so this is a compile error until done. If it is dressing
   that may sit at any angle (cart, crates, car), exclude it in
   `isStructural`.
3. A NEW param: add the field to `BuildParams` in `kit/core.ts` with a doc
   comment saying which builder reads it and what it means. The bag is shared
   and flat on purpose; reuse `width`/`depth`/`height`/`length`/`ruined`/`lit`
   before adding one.
4. If it takes `ctx` (seed or ground): add it to `CONFORMS_TO_TERRAIN` and a
   clause to that set's comment.
5. `FILES.md`: add the kind to its kit file's line.

## 3. Colliders — the part that is gameplay

Declare colliders with `b.wall` (drawn and solid), `b.block` (solid, nothing
drawn — the usual choice once the drawing is detailed), `b.strut` (stops rounds
only), `b.guard` (a rail on a walkable edge), or `porous: true` on a block
(stops bodies, not rounds). Rules, each of which has already cost a bug:

- **Size a box to the silhouette where rounds arrive**, not the widest circle
  it is drawn in (`b.cyl` diameters are CIRCUMdiameters). Too small costs a
  round clipping an edge; too large costs shots that visibly should have
  landed. See the haystack's header.
- **Cover heights mean something**: 0.9 soft, 1.3 crouch cover, 1.7 hard
  cover, taller breaks sightlines. Pick one on purpose.
- **Walked tops within `CONFIG.nav.stepHeight` (0.6) of what they are reached
  from, and at least 0.35 (`HEIGHT_EPS`) above the surface below** or they
  merge into it. Ramps pitch the COLLIDER with `rotX`, not just the visual.
- **The nav graph keeps `maxSurfaces` (3) per cell and silently DROPS the
  rest, in arrival order.** Emit walked surfaces first, cover next, roofs last.
  Stacked tiers are RINGS, never nested solids (`buildTempleRuin`'s header).
- **An enterable floor owes a collider** — without one a body stands inside
  the drawn boards and grass grows up through the floor (it only skips tufts
  inside a collider).
- **A rail on a walked edge is `guard()`**, standing outboard of the surface.
- **Open frames are `porous` + `strut`s** (the fence): a coarse box for bodies
  and nav, struts for what a round actually hits. Porous is not cover.
- **Roofs** are a flat slab at the eaves (`gableRoof`'s), not pitched boxes.
- **Never `marksSway` a part a collider stands in for** — the drawing would
  leave its box behind in the wind.
- A collider that is a moving thing, glass, or anything exotic: read CLAUDE.md
  and `docs/world.md` first — those are separate systems.

## 4. Lights, sound, glass

- One `b.light` at most for a building unless a room genuinely needs two; the
  rest is `glow`/`flame`. `p.lit` is the usual switch.
- A fire owes `b.sound("fire", ...)`; water, `stream`. Ids are
  `AmbienceId`s.
- Glass: `b.pane` — `breakable` only where there is enterable space behind it;
  `backed` only where there is a mass behind it. See `PaneSpec`.

## 5. Place it

- Layout entry: `{ kind: "thing", x, z, rotY?, y?, params? }` in
  `src/world/<map>/layout.ts`. `y` only when it stands on something the floor
  does not know about (a terrace).
- **Four maps are GENERATED** (`sarab`, `cinderhaven`, `kurenai`,
  `harrowmead`): placing it by hand works until the generator is re-run, which
  discards the edit. For those, place it in the generator
  (`scripts/generate-<map>.mjs`, run by `npm run <map>`, which owes
  `npm run collision -- <map>` after it) or accept that trade knowingly.
- Blocking things may not stand on a control point or a spawn. If a flag flies
  from the model's roof, check `ControlPointDef.poleLift`.
- If the new model is taller or wider than what it replaces, check nothing
  else now stands in it (the chapel's tower swallowed a cottage).

## 6. Bake and prove it

```bash
npm run collision -- <map>    # every map it is placed on; commit the bakes
npm run parity                # server and client build the same world
node .claude/skills/model-detail/scripts/reach.mjs --map <id> --at x,z,rotY --half hx,hz
npm run typecheck && npm run build
```

`reach.mjs` must show no sealed surfaces you did not intend, no UNREACHED
counts on anything a player can stand on, and no cells at the surface ceiling
unless the drop is understood. Heights are WORLD heights. Sealed surfaces on
top of a wall or a pier nobody can climb are expected — the temple reports 9
sealed at its wall head and 9 cells at the ceiling (terrain, tread, wall top),
which is its budget table exactly; a sealed band at a FLOOR's height is the
bug. The build refuses a bake older than its layout,
but the guard hashes the LAYOUT — a collider change inside a builder needs
`npm run collision` by hand.
