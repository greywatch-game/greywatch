/**
 * mapShots.ts — The photograph of each map that stands behind the main menu,
 * and the camera position it was taken from.
 * Owns: the shot table — one image per map id, plus the VANTAGE that image is
 * a picture of. Holds no state and draws nothing; `OverlayScreen` reads the
 * url and `scripts/capture-map-shots.mjs` reads the vantage.
 * Invariants: a map with no row here is not a broken screen — the menu falls
 * back to its veil over the live scene, exactly as it looked before there were
 * shots at all. Never import this from anything but the menu: the images are
 * ~250 KB each and nothing else on any screen wants them.
 *
 * **The vantage lives here, beside the image, because it is the only thing
 * that can regenerate it.** A screenshot is an opaque 200 KB rectangle: there
 * is nothing in the file that says where the camera stood, so a map whose
 * chapel moves has a backdrop nobody can retake without guessing. Stating the
 * pose next to the picture makes `npm run shots` a re-run rather than a
 * re-hunt, and makes a re-frame a two-number edit.
 *
 * **Which is why this is a UI table and not a field on `MapDef`.** A map's
 * `blurb` is on the map because a map's own file is the only place that cannot
 * fall out of step with it — but a `MapDef` is imported by the SERVER
 * (`Match.ts`, `simulate.ts`), which has no screen, no menu and no use for a
 * quarter of a megabyte of JPEG per map. The menu's backdrop is the menu's.
 * What that costs is the one thing this file must therefore say out loud: a
 * fourth map added to `world/maps.ts` gets no backdrop until it is given a row
 * here, and the menu will not complain, it will simply look like it used to.
 *
 * The images are imported with Vite's `?url`, the same way `WaterSystem` takes
 * its water textures — so they are content-hashed into `dist/assets/`, they
 * are precached by the service worker along with everything else the build
 * emitted, and a re-shoot invalidates its own url without anybody editing a
 * cache list.
 */
import coldharbourShot from "../../shots/coldharbour.jpg?url";
import harrowmeadShot from "../../shots/harrowmead.jpg?url";
import greyfenShot from "../../shots/greyfen.jpg?url";
import hollowmereShot from "../../shots/hollowmere.jpg?url";

/**
 * Where the camera stood for one of these pictures.
 *
 * `pos.y` is METRES ABOVE THE SURFACE at (x, z), not a world height, and that
 * is deliberate: the two valleys are heightfields, and "eye seven metres up"
 * survives a terrain edit where an absolute 11.4 becomes a camera buried in a
 * bank. `target` is absolute, because what a shot is aimed at is a spire or a
 * skyline rather than a spot on the ground.
 */
export interface MapVantage {
  /** Camera position: world x, height ABOVE the surface there, world z. */
  pos: readonly [x: number, above: number, z: number];
  /** What it looks at, in absolute world metres. */
  target: readonly [x: number, y: number, z: number];
  /**
   * Vertical field of view, in degrees. Omitted means the game's own hip FOV
   * — which is what a map should use unless the frame genuinely needs to be
   * wider, and Coldharbour's does: it is the one shot whose subject is a
   * skyline rather than a building.
   */
  fov?: number;
}

export interface MapShot {
  /** The image, content-hashed by Vite. */
  url: string;
  /** The pose it was taken from — see `MapVantage`. */
  vantage: MapVantage;
}

/**
 * One row per map, keyed by `MapDef.id`.
 *
 * Each pose was picked by sweeping candidate vantages and looking at them; the
 * comment on each says what the picture is OF, because that is the thing a
 * re-frame has to preserve and the numbers alone do not say it.
 */
export const MAP_SHOTS: Readonly<Record<string, MapShot>> = {
  // The chapel on its terrace, seen from the lane below it: lit windows, the
  // graveyard, the spire against the aurora and the valley wall behind.
  hollowmere: {
    url: hollowmereShot,
    vantage: { pos: [-32, 7, 100], target: [-58, 10, 78] },
  },
  // Under the canopy looking north-east into the morning sun — the temple
  // platform through the mist, with the trunks and the ferns in front of it.
  // The bearing is the sun's own (043), which is what puts the glow in frame.
  greyfen: {
    url: greyfenShot,
    vantage: { pos: [54, 6, 8], target: [78, 9, 32] },
  },
  // The central square from the avenue, looking south-west down the sun's
  // bearing (225) so the towers either side are rim-lit and the glass has
  // something to hold. Wider than the others because the subject is the
  // skyline.
  coldharbour: {
    url: coldharbourShot,
    vantage: { pos: [40, 10, 48], target: [2.5, 12, 2.5], fov: 58 },
  },
  // The market green from the south-east — into the sunset, so the village
  // stands as roofs and lit windows against the gold over the western downs,
  // with the sun itself in frame low over the rim. The same vantage was a
  // lit-faces shot when this map was a morning; the hour turned it around.
  //
  // The eye is five metres higher than it was, and a TREE is why: the vale's
  // hedgerow ash was planted after this frame was chosen, and one of the two
  // on the green grew straight through the right third of it. At 15 m the same
  // crown is a corner the village is framed by rather than a screen in front
  // of it — which is the frame to preserve if this is ever re-shot, since a
  // 10 m eye now photographs a leaf.
  harrowmead: {
    url: harrowmeadShot,
    vantage: { pos: [44, 15, -58], target: [-10, 4, 14] },
  },
};

/** The backdrop for a map, or `undefined` if it has none. */
export function mapShotUrl(id: string): string | undefined {
  return MAP_SHOTS[id]?.url;
}
