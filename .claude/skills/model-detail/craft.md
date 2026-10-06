# Craft: detail that reads in this cel look

The look is hand-drawn cel shading, not cartoony: flat banded light, hard
edges, a screen-space ink line wherever depth steps or bends, and a muted
palette where VALUE carries the read. Detail has to be drawn in that
vocabulary — geometry the ink and the bands can find — never texture or noise.

## The settings

One style, six settings. A model's setting follows from the kit file it lives
in and the map it stands on, and each has its own materials, its own way of
decaying and its own light to be judged under. Read the kit file's header
before choosing a colour; a colour a setting lacks goes in that file's palette
(or core.ts's, if it is genuinely shared), darker than its swatch.

| setting | kit file | maps | materials | how it ages | judge it under |
| --- | --- | --- | --- | --- | --- |
| **Wet northern village** | `buildings/` | Hollowmere, Harrowmead; Cinderhaven's houses | `TIMBER`, `PLASTER`, `STONE`, `SLATE`, `THATCH`, `BRICK`, `PLANK`, weatherboard | damp and moss at the foot, rot, fire (a ruined cottage is BURNT) | Hollowmere at night (blood moon), Harrowmead at sunset |
| **Tropical colonial** | `buildings/` (manor, stilt hut, jungle ruin), `structures/` | Greyfen | `STUCCO`, `TEAK`, `VERDIGRIS`, matting; the temple's `SANDSTONE`/`LATERITE`; the forest's `CREEPER` and `FIG_*` | render spalls to brick, the forest TAKES it: figs, roots, creeper, ferns | Greyfen's low north-east sun through canopy |
| **Downtown** | `city/` | Coldharbour | `CONCRETE`, `DARK_CONCRETE`, `ASPHALT`, `GLASS`, `ALLOY`, `CITY_BRICK`, `ASHLAR`, `RENDER`, `ENAMEL`, `AWNING` | grime and wear (`EnvironmentSpec.wear`), not ruin | a low sun on pale stone; the read is VALUE — pale spandrel, dark reveal |
| **Desert town** | `desert.ts` | Sarab | ten colours: mud brick and its shade, whitewash, roof mud, palm beam, window void, sandbag, scorch, cloth — and `TILE_BLUE`, the one chroma, for domes | war: shelling, scorch, sandbags; blown dust is LIGHTER than the wall | a hot high sun; walked flat roofs are half the town |
| **Volcanic harbour** | `harbour.ts` | Cinderhaven | three materials: `BASALT`, `PITCH`ed timber, `RUST` — stained by `SULPHUR` and `SLAG` | salt, tar and rust on a schedule of weeks | night, lit by the volcano and lamps |
| **Temple town** | `japan/palette.ts` | Kurenai | stained and aged timber, lime and earthen plaster, fired tile, thatch, granite; vermilion (`SHU`) ONLY on what is sacred or crossed | moss on stone, weathered timber; nothing ruined | a 14° gold key — colours a shade darker and greyer, never warmed twice |

Across all of them: **few tones differing in value beat many differing in
hue** (the cel bands posterise saturation into stripes), and a setting gets at
most one saturated accent, spent where it means something.

## How detail becomes visible

- **The ink draws steps in depth.** A joint, a moulding, a board lap or a
  relief is only drawn if it is a real step. A patch of brick flush with the
  stucco round it is a stain; 3.5 cm back is a hole in the plaster. Lay stones
  with a 2 cm gap over a core set 5 cm behind the face and every joint is
  inked for free.
- **Shallow relief needs a dark ground.** A 3 cm figure on a pier face was
  invisible in any light: no shadow map resolves 5 cm. Put the relief on a
  recessed ground in `DARK_STONE` (weathering really does darken recesses), make
  the frame ~7 cm proud and the figure ~5 cm. Then it reads at 10 m.
- **Lapped boards are tipped.** Each weatherboard course tipped out at its foot
  is a shading band and a bend for the ink; flat boards side by side are a
  stripe.
- **Up-facing surfaces come back a stop and a half lighter.** The sky term
  lands on every level face. Pick floor, roof and paving colours darker than
  they look in isolation. `CREEPER` laid flat read as lily pads — bright green
  coins on grey stone; moss on paving wants a darker green and a lobed, drawn-out
  shape (overlapping discs, `scaling.x` 1.4–2.2), never a circle.
- **Area limits emissive colour.** A lit window the size of a shopfront at
  `LAMPLIT` blooms into a lantern; big emissive planes step down (`SHOPLIT`,
  `ROOM_GLOW`). Glow costs no light slot; `Build.light` does (see below).

## Silhouette and construction

- **Roofs are thick and cut plumb.** A roof as thin as a door reads as a
  board. Thatch and slate are solids (`convexSolid`) cut vertical at the eave
  and verge, with courses stepped down the slope and a ridge that is its own
  shape. `convexSolid` winding: a front face's cross product points INTO the
  solid — inside-out solids draw their far faces lit and look right only to
  within their own thickness.
- **Gable ends are wall, not roof colour.** A gable drawn in the roof's colour
  reads as a roof with a hole in it.
- **Applied members sit ON the face.** A post centred in a wall is swallowed by
  the boarding (core.ts contract).
- **Name what holds everything up.** A jetty needs joists and brackets under
  it; a deck needs bearers and piles cut to the ground; a beam needs a post or
  a corbel. "Standing on nothing" is the most common tell of a box model.
- **Chimneys, stacks and columns may not stand in a room** as columns you walk
  through; carry them in the wall or on a breast.
- **Every elevation gets something.** A blank back wall on a house you can walk
  round reads as a set. Doors on houses that cannot be entered still exist.

## Decay and the forest

- **Decay follows construction.** Render spalls to the brick under it, a wall
  breaks along its bond (toothed ends), a head breaks in stretches a course or
  several high, facing stones fall off a fill that is a different material
  (laterite behind sandstone), what fell lies at the foot of where it fell from.
- **Irregular, but coherent.** A torn edge is a slow wave along the face with a
  little noise, not independent noise per strip — that reads as pixel art. Lost
  patches are 2–3 overlapping lobes, not rectangles or single ellipses.
- **Roots are not pipes.** A root drawn as one tube bent square at every edge
  read as plumbing. Taper hard (d0 → ~0.25 d0), wander across a surface
  (offset midpoints), ROLL over a lip (a point over the edge, one just below
  it) rather than folding, throw thinner branches off sideways, and half-bury
  them where they lie on a surface.
- **Creeper is fine-grained.** Leaves ~0.09–0.14 × 0.06–0.09 m, mostly
  `CREEPER` with a few `FIG_LEAF_LIT`, spaced 0.09–0.18 down a strand. Bigger
  reads as paper cut-outs. Curtains are longest mid-run and stop short of
  every opening.
- **The same tree as the forest.** A tree growing on a model uses `FIG_*` and
  the forest's plate-and-frond crown, marked `marksSway(mesh, "canopy")` — and
  only foliage is ever marked, never anything a collider stands in for.

## Rendering rules a drawing can break silently

- **Two up-facing surfaces of different colours never share a plane.** The
  merge is per colour, so a shared top face is a per-pixel tie that strobes as
  the camera moves. Stand one proud (≥ 1 cm near, 2–3 cm for broad surfaces
  seen far). Coplanar faces of ONE colour are fine.
- **Emit what is hidden AFTER what hides it** (cores after facing, the bed
  after the tiles). The part merge keeps emission order, so the depth test
  rejects the hidden layer instead of shading it twice — the wrong order was
  ~4% of a frame standing in the jungle ruin.
- **A walked surface's drawn top is the collider's top** unless there is a
  reason. A flagstone floor 2 cm proud buries a capture ring's painted line
  (it is laid 18 mm over the box top) — check whether a control point's ring
  can cross the model.
- **Lights are a budget.** Sixteen slots, nearest first. One `Build.light` per
  building is the norm; the chapel's first cut had three and each measured
  0.1–0.2 ms. Everything else that glows is `glow`/`flame` only.
- **What burns is heard burning**: a drawn fire owes `Build.sound("fire", ...)`
  beside its light.

## Vertex and draw-call budget

- Recent detailed models: cart ~8–9 k vertices, cottage ~4 k, stilt hut
  ~35 k, jungle ruin ~62–68 k, temple ~83 k. Multiply by placements: Cinderhaven
  has 178 cottages. A prop placed hundreds of times earns far less detail than
  a landmark placed once.
- Draw calls come from colours × map blocks, not from parts — parts merge per
  colour per block. A new palette colour on a widely placed model can cost a
  draw call in every block it stands in.
- Tessellation: cylinders at 6–8 sides for stems and balusters; a limb chain
  (`rope`) at 5–7. Don't spend cylinders where a box reads the same.
