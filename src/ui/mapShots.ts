/**
 * mapShots.ts — The photograph of each map that stands behind the main menu,
 * and the camera position it was taken from.
 * Owns: the shot table — one image per map id, plus the VANTAGE that image is
 * a picture of. Holds no state and draws nothing; `OverlayScreen` reads the
 * url and `scripts/capture-map-shots.mjs` reads the vantage.
 * Invariants: a map with no row here is not a broken screen — the menu falls
 * back to its veil over the scene, which holds no map while the menu is up
 * (`Game.teardownMap`), only the sky of whatever was last installed. Never
 * import this from anything but the menu and the lobby (the two title screens
 * that stand on a map's picture — the lobby's match plates wear the reel's
 * thumbnails): the images are ~250 KB each and nothing else on any screen
 * wants them.
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
import cinderhavenShot from "../../shots/cinderhaven.jpg?url";
import coldharbourShot from "../../shots/coldharbour.jpg?url";
import sarabShot from "../../shots/sarab.jpg?url";
import harrowmeadShot from "../../shots/harrowmead.jpg?url";
import greyfenShot from "../../shots/greyfen.jpg?url";
import hollowmereShot from "../../shots/hollowmere.jpg?url";
import kurenaiShot from "../../shots/kurenai.jpg?url";

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
   * wider, and Coldharbour's does: it is the one shot whose subject is a bay
   * rather than a building.
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
  // The chapel on its hill, seen from Church Lane where it climbs out of the
  // village: a lit cottage, the churchyard wall, the spire against the stars.
  hollowmere: {
    url: hollowmereShot,
    vantage: { pos: [-38, 2.2, 38], target: [-60, 10, 82] },
  },
  // From the processional way where it reaches the temple's hill, looking up
  // at the terraces through the trunks — the paved road in the foreground, the
  // sanctuary on its summit in the morning haze. Stood ON the paving because a
  // road is the one place a jungle tree cannot grow (`PropBody.rooted`), so
  // the frame is never a trunk from edge to edge.
  greyfen: {
    url: greyfenShot,
    vantage: { pos: [68, 3.6, 10], target: [81, 5.6, 32] },
  },
  // Over the square's east terrace, looking south-west down the harbour into
  // the sun (azimuth 225): the boats on the mud, the quays, the old town on
  // the west shore and the harbour light on the pier head against the open
  // sea. **The frame to preserve is the harbour and the light together** —
  // they are what the town is laid out round, and the one frame on this map
  // that says it is a harbour town rather than a city block. Wider than the
  // others because the subject is the bay.
  coldharbour: {
    url: coldharbourShot,
    vantage: { pos: [26, 24, 2], target: [-48, -2, -130], fov: 58 },
  },
  // The market green from over East Lane — into the sunset, looking across the
  // stalls and the well to the church and the coaching inn on North Street,
  // the spire standing against the sun and the inn's windows lit. **The frame
  // to preserve is the church and the inn together across the green**: they
  // are what the village is laid out round, and the one frame on this map
  // that says it is a village rather than a farm. The old vantage (44, 15,
  // -58) now looks at the backs of Main Street's terrace.
  harrowmead: {
    url: harrowmeadShot,
    vantage: { pos: [32, 12, -10], target: [-12, 4, 30], fov: 62 },
  },
  // Off the east highway's verge, looking north-west up the length of the town:
  // the souk's two arcades and their awnings in the near ground, the old town's
  // roofs behind them, and the minaret and the blue dome on the axis with the
  // basin rim in haze behind everything.
  //
  // It is the only shot in this table whose subject is the EXTENT as well as a
  // building — four hundred metres of town in one frame from nine metres up,
  // which is the thing this map is and no other map here can be photographed
  // doing. **The frame to preserve is the two landmarks on the axis**: the
  // minaret and the dome are the only saturated things on a 1,500 m map and are
  // what a player navigates by, so a re-frame that loses them has lost the
  // picture whatever else is in it. The shelf was the other candidate and it
  // put a shelled block's roof across the bottom third.
  sarab: {
    url: sarabShot,
    vantage: { pos: [96, 9, 30], target: [-190, 12, 150], fov: 56 },
  },
  // CINDER BAY from Netstrand's beach, looking west-north-west across the
  // water: the bay road curving out of the near corner with the net sheds and
  // the drying racks on it, the strand and the surf line below, four hundred
  // metres of open harbour, CHAPEL ROCK standing in the middle of it with its
  // churchyard wall along the ridge, the quay's lights on the far shore, and
  // Grimhold's shoulder under the crater's glow on the left.
  //
  // **The frame to preserve is the ROCK IN THE WATER.** That is what this map
  // now is, and it is the one thing no other map here has — a control point on
  // an island in the middle of a bay, with a town on two shores of it. The
  // glow is the second thing and it is free: the key light's direction is set
  // so that the disc hangs over the mountain (`cinderhaven/environment.ts`),
  // so any westward eye gets both.
  //
  // A low eye on purpose, unlike Sarab's: this map's extent is water and does
  // not photograph, so the shot is a PLACE rather than a survey. It stands on
  // a waterfront for that reason, and it stands on the north-eastern one
  // because that is the only shore from which the rock, the far town and the
  // mountain are all on the same side of the camera. What it replaced looked
  // up a reach that no longer exists.
  cinderhaven: {
    url: cinderhavenShot,
    vantage: { pos: [372, 11, -128], target: [-340, 48, -320], fov: 60 },
  },
  // KOYO-JI's court from inside the gate, looking north-west into the sun:
  // the stone path and its lanterns in the near ground, the maples along the
  // precinct wall, the pagoda against the low sun with the mountain behind it
  // and the hall's paper walls glowing on the right. It is the reference frame
  // this map was built from (`reference-media/new-map.jpg`), taken in the map.
  //
  // **The frame to preserve is the PAGODA AGAINST THE SUN** — the landmark,
  // the hour and the haze in one shape — and the paper walls beside it, which
  // are what says there is anybody here at all.
  kurenai: {
    url: kurenaiShot,
    vantage: { pos: [-59, 2.2, 65], target: [-96, 10, 74], fov: 62 },
  },
};

/** The backdrop for a map, or `undefined` if it has none. */
export function mapShotUrl(id: string): string | undefined {
  return MAP_SHOTS[id]?.url;
}

/**
 * How wide the menu reel's copy of a shot is, in pixels. The reel's widest
 * card is ~270 CSS px on a 1440p monitor, so this covers it at a device ratio
 * of about 1.8 and is a sixteenth of the full photograph's pixels.
 */
const THUMB_WIDTH = 480;
/** One downscale per photograph per session, shared by every reel. */
const thumbs = new Map<string, Promise<string>>();

/**
 * A SMALL copy of a map's photograph, for the menu's map reel — as an object
 * URL, or the full shot's own URL when the downscale cannot be made.
 *
 * **The reel shows every map at once and the photographs are 1920x1080**, so
 * pointing seven cards at the full images keeps seven 8 MB decoded bitmaps
 * alive for a strip whose widest card is a couple of hundred pixels — on the
 * phone this menu is also laid out for, that is real memory spent on nothing.
 * So each photograph is decoded ONCE, drawn down into a canvas, re-encoded,
 * and the full decode is let go. The backdrop behind the card still takes the
 * full image, which is the one place its pixels are seen.
 *
 * Not a committed asset, and deliberately so: a thumbnail on disk is a fifth
 * file per map for `npm run shots` to keep in step with the first, and the
 * client can make one from the photograph it already has.
 */
export function shotThumbUrl(id: string): Promise<string> | undefined {
  const url = mapShotUrl(id);
  if (!url) return undefined;
  let made = thumbs.get(url);
  if (!made) {
    made = (async () => {
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = THUMB_WIDTH;
        canvas.height = Math.round((THUMB_WIDTH * img.naturalHeight) / img.naturalWidth);
        const ctx = canvas.getContext("2d");
        if (!ctx) return url;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((done) =>
          canvas.toBlob(done, "image/jpeg", 0.84),
        );
        return blob ? URL.createObjectURL(blob) : url;
      } catch {
        return url;
      }
    })();
    thumbs.set(url, made);
  }
  return made;
}
