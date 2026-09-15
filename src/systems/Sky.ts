/**
 * Sky.ts — Procedural sky: baked dome texture (gradient/galactic band/stars/
 * moon halo), a textured moon disc, and a ring of faceted cloud MASSES lit per
 * facet off the key light. The dome and disc are unlit emissive meshes; the
 * clouds are one cel-banded ShaderMaterial draw. Everything infiniteDistance,
 * unpickable; moon bloom via the GlowLayer.
 * Invariants: moonDir is negated to align with the shader's light direction;
 * the moon renders in a later renderingGroup than the dome; the clouds sit
 * inside the moon's distance so they hide it by depth. Rebuilt from an
 * EnvironmentSpec via apply() — keep it data-driven, no Hollowmere specifics.
 */
import {
  Color3,
  DynamicTexture,
  GlowLayer,
  Mesh,
  MeshBuilder,
  Matrix,
  Scene,
  type ShaderMaterial,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { clamp } from "../core/math";
import { createCloudMaterial } from "../shaders/CloudShader";
import { mulberry32 } from "../world/rng";
import type { EnvironmentSpec, SkySpec } from "../world/environment";
import { buildCloudRing, type CloudGeometry } from "./cloudMasses";

/**
 * The rendering group the clouds draw in: after the world (0) and after the
 * disc and the viewmodel (1), with its automatic depth clear turned off in the
 * constructor. Nothing else in the tree uses group 2.
 */
const CLOUD_GROUP = 2;

/**
 * The sky: a gradient dome with the galactic band, the stars and the moon's
 * scattering halo baked into a generated texture, an emissive moon disc that
 * feeds the GlowLayer, and a ring of cloud masses turning slowly about the
 * eye. Everything is built at runtime — the game ships no image files — and
 * nothing here is lit by a scene light: the scene has none, so the dome and
 * disc are unlit emissive by construction and the clouds ask the map's KEY
 * light for themselves, as uniforms, exactly as the cel materials do.
 *
 * Every sky mesh uses `infiniteDistance` (it rides with the camera, so the
 * horizon never gets closer and the clouds are always overhead) and stays
 * outside the pick/collide contract: no `solid` metadata, `isPickable =
 * false`, `noInk`. These meshes are built after Game's constructor-time
 * GlowLayer scan, so the pieces that must NOT bloom (dome, clouds — a
 * full-screen gradient would haze the frame) are excluded directly, the
 * WaterSystem way. The moon keeps its bloom on purpose.
 *
 * The moon sits opposite the key light's direction (`lighting.direction`),
 * so the disc always agrees with the shadows the cel shader paints. Its
 * halo is drawn into the dome texture at the matching uv, which the sphere
 * builder guarantees: v = acos(y)/PI down from the zenith, u = atan2(-z, x)
 * around the horizon.
 *
 * **Every sky texture is uploaded with `update(false)`, and that is
 * load-bearing.** `DynamicTexture.update()` defaults to flipping Y, which
 * turns canvas row 0 into v = 1 — the NADIR on the sphere above. Painting a
 * sky top-down (the only sane way to write it: row 0 is the zenith, row h/2
 * the horizon) and letting it flip puts the stars, the galactic band and the
 * moon's halo underneath the map, where nothing can ever see them, and leaves
 * the visible half filled with the fog colour the gradient ends on. The
 * symptom is not an upside-down sky. It is a sky that is simply black, with
 * a moon still hanging correctly in it because the disc is placed as
 * geometry rather than painted.
 *
 * **The clouds are GEOMETRY, and that replaced two fBm shells.** A thresholded
 * noise deck is a soft continuous-tone smear — the one register this game does
 * not draw in — and its lit side had to be a second additive shell with a
 * per-vertex mask, because a texture has no facets to turn toward a light. A
 * pile of lumps does, so the key is asked of each facet and banded like every
 * wall in the village. `cloudMasses.ts` carries the shape's argument and
 * `CloudShader.ts` the light's.
 */
export class Sky {
  private disposables: { dispose(): void }[] = [];
  /** The cloud ring, which `update` turns; null on a sky with no cover. */
  private clouds: Mesh | null = null;
  private cloudMat: ShaderMaterial | null = null;
  private cloudGeo: CloudGeometry | null = null;
  /** The index buffer the ring is drawn from, rewritten back to front. */
  private cloudIndices = new Uint32Array(0);
  /** Lump ids in the order last written, and each lump's distance scratch. */
  private cloudOrder = new Uint32Array(0);
  private cloudDist = new Float32Array(0);
  /** Where the eye stood, and the ring's turn, when the order was last taken. */
  private readonly sortedEye = new Vector3(Infinity, Infinity, Infinity);
  private sortedTurn = Infinity;
  private readonly localEye = new Vector3();
  private readonly toLocal = new Matrix();
  constructor(
    private scene: Scene,
    private glow: GlowLayer,
  ) {
    // Rendering groups above 0 clear the depth buffer by default (the
    // classic FPS-viewmodel trick). The sky lives in group 1 so the moon
    // draws over the dome, but it must still respect the WORLD's depth —
    // without this the moon and clouds render through players and walls.
    scene.setRenderingAutoClearDepthStencil(1, false);
    // And the clouds live in group 2, for the same reason and one more: they
    // are drawn after the disc so they can pass in front of it, and they are
    // depth-TESTED against the world, so group 2 must not clear the depth the
    // world wrote either.
    scene.setRenderingAutoClearDepthStencil(CLOUD_GROUP, false);
  }

  /**
   * Rebuilds the sky for a map's environment; a missing `sky` spec clears it.
   * `mapSize` is the play square's side, which is what the cloud ring is laid
   * out against — see `CONFIG.sky.clouds.minRadius`.
   */
  apply(env: EnvironmentSpec, mapSize: number): void {
    this.clear();
    const spec = env.sky;
    if (!spec) return;

    const cfg = CONFIG.sky;
    const rand = mulberry32(cfg.seed);
    // The source the key light falls from — the moon's seat in the dome.
    const moonDir = Vector3.FromArray(env.lighting.direction)
      .normalize()
      .negate();
    const discRadius = spec.discRadius ?? cfg.moonRadius;
    // Zero draws no disc and that is now the WHOLE of what it does. It used to
    // switch the light shafts off as well, by withholding the direction they
    // converged on — `Volumetrics` reads `EnvironmentSpec.lighting.direction`
    // instead (see `setLightDir`), so a sky with no source drawn is still air
    // lit from wherever the shadows fall. The halo below is painted at
    // `moonDir` regardless: the sky is lit from somewhere whether or not the
    // source is drawn.

    // --- dome: gradient + galactic band + stars + baked halo, one draw ---
    const domeMat = new StandardMaterial("sky-dome-mat", this.scene);
    domeMat.emissiveTexture = this.paintDomeTexture(spec, env, moonDir, rand);
    domeMat.disableLighting = true;
    domeMat.diffuseColor = Color3.Black();
    domeMat.specularColor = Color3.Black();
    domeMat.disableDepthWrite = true;
    // **The dome is NOT dithered, and that was measured rather than assumed.**
    // It looks like the one surface that would need it — the widest, shallowest
    // ramp in the game, magnified about sevenfold on its way to the screen — but
    // the ramp is never seen clean. The stars, the galactic band and the halo's
    // additive bloom are painted over the whole of it, and the cloud decks sit
    // in front. Measured on a scanline down 360 px of open sky with the moon
    // behind the camera, grade off: 233 runs of identical 8-bit value without a
    // dither against 229 with one — the same 1.55 px mean run either way, which
    // is already broken up. See `shaders/Dither.ts` for the surfaces that DO
    // band; the fog ramp on a plain cel-shaded wall is six times coarser.
    const dome = MeshBuilder.CreateSphere(
      "sky-dome",
      {
        diameter: cfg.domeRadius * 2,
        segments: 24,
        sideOrientation: Mesh.BACKSIDE,
      },
      this.scene,
    );
    dome.material = domeMat;
    this.prepare(dome, true);
    this.disposables.push(domeMat, domeMat.emissiveTexture!);

    // --- moon: emissive disc, deliberately left inside the GlowLayer ---
    // Omitted entirely at radius 0 — an overcast sky has a source but no
    // visible disc, and drawing a small one instead reads as a hole rather
    // than as a sun behind cloud.
    if (discRadius > 0) {
      const moonTex = this.paintMoonTexture(rand);
      const moonMat = new StandardMaterial("sky-moon-mat", this.scene);
      moonMat.emissiveTexture = moonTex;
      // The limb fades out through the same texture's alpha, so the disc has
      // no polygon edge — a hard circle in the sky reads as a decal.
      moonMat.opacityTexture = moonTex;
      moonMat.emissiveColor = Color3.FromHexString(spec.moonColor).scale(
        cfg.moonEmissiveBoost,
      );
      moonMat.disableLighting = true;
      moonMat.diffuseColor = Color3.Black();
      moonMat.specularColor = Color3.Black();
      moonMat.disableDepthWrite = true;
      const moon = MeshBuilder.CreateDisc(
        "sky-moon",
        { radius: discRadius, tessellation: 48 },
        this.scene,
      );
      // Stood BEHIND the clouds' depth rather than at `moonDistance`, and
      // scaled up by the same ratio so it subtends exactly the angle a map's
      // `discRadius` was written for. The disc writes no depth, but the glow
      // layer blooms it against the frame's depth buffer, so a disc in front of
      // the clouds' depth blooms straight through every cloud crossing it.
      const moonScale = cfg.moonDepthDistance / cfg.moonDistance;
      moon.position.copyFrom(moonDir.scale(cfg.moonDepthDistance));
      moon.scaling.setAll(moonScale);
      // Billboard, not lookAt: the disc must face the camera dead-on from
      // everywhere on the map, and with infiniteDistance it rides with it.
      moon.billboardMode = Mesh.BILLBOARDMODE_ALL;
      moon.material = moonMat;
      moon.renderingGroupId = 1; // after the dome, so depth can't drop it
      this.prepare(moon, false);
      this.disposables.push(moonMat, moonTex);
    }

    // --- cloud masses: one merged mesh, one draw, the whole ring ---
    this.buildClouds(spec, moonDir, rand, mapSize);
  }

  /**
   * Turns the cloud ring about the map's centre, hands the shader the eye, and
   * re-orders the lumps back to front when either has moved enough to matter.
   * Runs in every game state, after the camera has been placed for the frame.
   */
  update(dt: number, eye: Vector3): void {
    const clouds = this.clouds;
    if (!clouds || !this.cloudMat) return;
    const c = CONFIG.sky.clouds;
    clouds.rotation.y += c.driftDegPerSec * (Math.PI / 180) * dt;
    this.cloudMat.setVector3("camPos", eye);
    // The one depth every cloud fragment writes: that of a point `depthMetres`
    // down the view axis, through the camera's own projection. WebGPU's depth
    // runs 0..1 and nothing here reverses it, so this is the plain perspective
    // z row. Re-derived every frame because it is two divisions and the camera
    // is the one thing here that could be swapped out from under a cache.
    const cam = this.scene.activeCamera;
    if (cam) {
      const n = cam.minZ;
      const f = cam.maxZ;
      const d = Math.min(c.depthMetres, f * 0.99);
      this.cloudMat.setFloat("skyDepth", (f / (f - n)) * (1 - n / d));
    }
    // The ORDER only changes when the eye crosses the plane between two lumps'
    // centres, and at these distances that takes metres of walking or tenths
    // of a degree of drift — so the sort is spent on those, not on frames.
    if (
      Vector3.DistanceSquared(eye, this.sortedEye) < c.resortMetres * c.resortMetres &&
      Math.abs(clouds.rotation.y - this.sortedTurn) < c.resortTurn
    ) {
      return;
    }
    this.sortedEye.copyFrom(eye);
    this.sortedTurn = clouds.rotation.y;
    this.sortClouds(clouds, eye);
  }

  private clear(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.clouds = null;
    this.cloudMat = null;
    this.cloudGeo = null;
    this.sortedEye.set(Infinity, Infinity, Infinity);
    this.sortedTurn = Infinity;
  }

  /**
   * Writes the ring's index buffer with its lumps FARTHEST FIRST.
   *
   * **This is the clouds' whole occlusion AMONG THEMSELVES, because they all
   * write one depth** (see `buildClouds` for why). Back-face culling makes one closed lump
   * right on its own; the painter's order makes one lump in front of another
   * right. What it gets wrong is the sliver where two lumps interpenetrate — the
   * nearer is drawn whole over the farther — and between two facets of one
   * cloud's colour that is not a visible error.
   *
   * The eye is taken into the mesh's own frame rather than every lump out of
   * it: the ring's world matrix is a turn about Y and nothing else, so one
   * inverse serves every distance.
   */
  private sortClouds(clouds: Mesh, eye: Vector3): void {
    const geo = this.cloudGeo;
    if (!geo) return;
    clouds.computeWorldMatrix(true).invertToRef(this.toLocal);
    Vector3.TransformCoordinatesToRef(eye, this.toLocal, this.localEye);
    const e = this.localEye;
    const n = geo.lumpFirst.length;
    const dist = this.cloudDist;
    for (let i = 0; i < n; i++) {
      const dx = geo.lumpCentres[i * 3] - e.x;
      const dy = geo.lumpCentres[i * 3 + 1] - e.y;
      const dz = geo.lumpCentres[i * 3 + 2] - e.z;
      dist[i] = dx * dx + dy * dy + dz * dz;
    }
    const order = this.cloudOrder.slice();
    order.sort((a, b) => dist[b] - dist[a]);
    let same = true;
    for (let i = 0; i < n; i++) {
      if (order[i] !== this.cloudOrder[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
    this.cloudOrder = order;
    const idx = this.cloudIndices;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const first = geo.lumpFirst[order[i]];
      const end = first + geo.lumpCount[order[i]];
      for (let v = first; v < end; v += 3) {
        idx[k++] = v;
        idx[k++] = v + 1;
        idx[k++] = v + 2;
      }
    }
    clouds.updateIndices(idx);
  }

  /**
   * The cloud masses: the ring `buildCloudRing` piles, as ONE flat-shaded mesh
   * with one material, so the whole sky's cloud is a single draw on a frame
   * that is draw-call bound.
   *
   * **The clouds are IN THE WORLD, over the map, and that is the point.** They
   * rode at `infiniteDistance` first, like the dome, and a player walking
   * across Harrowmead watched every cloud walk with them: nothing overhead
   * moved however far they went, which reads as a picture pinned to the camera
   * rather than as a sky. Laid out as real positions — `CONFIG.sky.clouds
   * .radius` metres from the map's centre, a few hundred to a thousand metres
   * up — a cloud slides across the sky as the eye moves under it, by exactly
   * as much as it should.
   *
   * **And they are depth-tested as if they were far beyond the world while
   * standing in it.** A kilometre-wide cloud a kilometre out is not reliably
   * farther than every roof, ridge and crater the camera can see, so a test on
   * its real distance draws it over a mountain. So every cloud fragment writes
   * ONE depth instead — that of a point `CONFIG.sky.clouds.depthMetres` out
   * (7 km), behind every surface any map has and in front of the sun's disc,
   * which `moonDepthDistance` stands behind it. Every surface in the world then
   * hides a cloud, a cloud hides the disc, and — the reason it cannot simply
   * write NO depth, which was tried — the glow layer, occluded by this same
   * buffer, stops blooming the disc through a cloud.
   *
   * **All of them sharing one depth is why the lumps are drawn back to front**
   * (`sortClouds`) under a LEQUAL test: the buffer cannot say which is in front,
   * so the order does, and a later tie wins. At 7 km the ink's fade has taken
   * every line off on every map's fog band, so they need no mask from it.
   *
   * **A drift is a turn of the mesh, never of what it is lit by.** The light
   * is asked of the WORLD normal in the shader, so the ring can turn and a
   * cloud coming round into the sun lights on its sun side, where a baked
   * colour would have carried its lit face away with it.
   */
  private buildClouds(
    spec: SkySpec,
    lightFrom: Vector3,
    rand: () => number,
    mapSize: number,
  ): void {
    const c = CONFIG.sky.clouds;
    const count = Math.round(c.maxCount * clamp(spec.cloudCover, 0, 1));
    if (count <= 0) return;
    const deg = Math.PI / 180;
    const ring = buildCloudRing(rand, {
      count,
      radius: Math.max(c.minRadius, mapSize * c.perMapSize),
      minElevation: c.minElevation * deg,
      maxElevation: c.maxElevation * deg,
      elevationBias: c.elevationBias,
      minWidth: c.minWidth * deg,
      maxWidth: c.maxWidth * deg,
      minFlatness: c.minFlatness,
      maxFlatness: c.maxFlatness,
      depth: c.depth,
      minLumps: c.minLumps,
      maxLumps: c.maxLumps,
      jitter: c.jitter,
    });

    const mesh = new Mesh("sky-clouds", this.scene);
    // A soup: every triangle owns its three corners, which is what gives each
    // facet its own normal. The positions never change; the INDICES are
    // rewritten whenever the painter's order does, so only they are updatable.
    mesh.setVerticesData(VertexBuffer.PositionKind, ring.positions, false);
    mesh.setVerticesData(VertexBuffer.NormalKind, ring.normals, false);
    const lumps = ring.lumpFirst.length;
    this.cloudIndices = new Uint32Array(ring.positions.length / 3);
    for (let i = 0; i < this.cloudIndices.length; i++) this.cloudIndices[i] = i;
    mesh.setIndices(this.cloudIndices, null, true);
    this.cloudOrder = new Uint32Array(lumps);
    for (let i = 0; i < lumps; i++) this.cloudOrder[i] = i;
    this.cloudDist = new Float32Array(lumps);
    this.cloudGeo = ring;

    const mat = createCloudMaterial(this.scene, {
      sunDir: lightFrom,
      shade: Color3.FromHexString(spec.cloudColor),
      lit: Color3.FromHexString(spec.cloudLitColor),
      haze: Color3.FromHexString(spec.horizonColor),
      glow: Color3.FromHexString(spec.moonGlowColor),
      litShare: clamp(spec.cloudLitStrength, 0, 1),
      hazeAtHorizon: c.hazeAtHorizon,
      lining: c.lining,
      wrap: c.wrap,
    });
    mesh.material = mat;
    mesh.renderingGroupId = CLOUD_GROUP;
    // The ring spans kilometres around the map and the eye is always inside
    // it, so it is always in the frustum; saying so spares the bounding test.
    mesh.alwaysSelectAsActiveMesh = true;
    this.prepare(mesh, true, false);
    this.disposables.push(mat);
    this.clouds = mesh;
    this.cloudMat = mat;
  }

  /**
   * Tags a sky mesh out of every scene contract and, unless told otherwise,
   * parks it at infinite distance. `excludeGlow` is for the pieces whose
   * emissive fill must not bloom (dome, clouds); the moon passes false so the
   * GlowLayer haloes it. The clouds pass `riding` false: they stand in the
   * world (see `buildClouds`).
   */
  private prepare(mesh: Mesh, excludeGlow: boolean, riding = true): void {
    mesh.infiniteDistance = riding;
    mesh.isPickable = false;
    // noGlow only where true — the moon keeps its bloom, so it must not
    // claim the flag (the contract reads it as "excluded from the GlowLayer").
    mesh.metadata = excludeGlow
      ? { noInk: true, noGlow: true }
      : { noInk: true };
    if (excludeGlow) this.glow.addExcludedMesh(mesh);
    this.disposables.push(mesh);
  }

  /**
   * Paints the dome: zenith-to-horizon gradient, the galactic band, the star
   * field (fading toward the horizon and washed out near the moon), and the
   * moon's scattering halo at the uv the sphere builder maps to the key
   * light's source direction.
   */
  private paintDomeTexture(
    spec: SkySpec,
    env: EnvironmentSpec,
    moonDir: Vector3,
    rand: () => number,
  ): DynamicTexture {
    const cfg = CONFIG.sky;
    const w = cfg.domeTextureWidth;
    const h = cfg.domeTextureHeight;
    const tex = new DynamicTexture(
      "sky-dome-tex",
      { width: w, height: h },
      this.scene,
      true,
    );
    const ctx = context2d(tex);

    // Gradient — canvas row 0 is v=1 (the zenith), row h/2 is the horizon.
    // The bright band peaks at row ~0.43h, about 12 deg ABOVE the horizon,
    // because the valley ridge hides the lowest ~10 deg from anywhere on the
    // ground: a band centred on the horizon line itself would never be seen.
    // Below the horizon the dome fades to the fog colour, so the gap between
    // the ridge and the dome reads as more fog.
    const zenith = spec.zenithColor;
    const horizon = spec.horizonColor;
    const fog = env.fogColor;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, zenith);
    grad.addColorStop(0.28, mixHex(zenith, horizon, 0.5));
    grad.addColorStop(0.43, horizon);
    grad.addColorStop(0.5, mixHex(horizon, fog, 0.6));
    grad.addColorStop(0.58, fog);
    grad.addColorStop(1, fog);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // The moon's seat, in texture pixels (see the class doc for the mapping).
    const mx = wrap01(Math.atan2(-moonDir.z, moonDir.x) / (Math.PI * 2)) * w;
    const my = (Math.acos(clamp(moonDir.y, -1, 1)) / Math.PI) * h;
    const haloR = cfg.haloRadius * h;

    if (spec.milkyWayColor) {
      this.paintMilkyWay(ctx, w, h, spec.milkyWayColor, rand);
    }
    this.paintStars(ctx, w, h, spec, rand, mx, my, haloR);

    // The scattering halo: a wide, faint bloom of moonlight in the air with a
    // tight core inside it. Stretched horizontally by 1/cos(latitude) so it
    // comes out ROUND on the sphere — the equirect mapping squeezes a circle
    // drawn this high into a lens otherwise.
    const stretch = 1 / Math.max(0.05, Math.sqrt(1 - moonDir.y * moonDir.y));
    const glow = Color3.FromHexString(spec.moonGlowColor);
    // The halo is the widest thing on the dome — wider, here, than the moon's
    // own distance from the wrap column — so it is the one mark that MUST be
    // stamped across the seam. See acrossSeam().
    acrossSeam(mx, w, haloR * stretch, (x) => {
      ctx.save();
      ctx.translate(x, my);
      ctx.scale(stretch, 1);
      // Additive, so the halo lifts the gradient it sits on instead of
      // replacing it — the band behind the moon has to keep its colour.
      ctx.globalCompositeOperation = "lighter";
      const haloPeak = spec.haloStrength ?? cfg.haloStrength;
      for (const [radius, peak] of [
        [haloR, haloPeak * 0.55],
        [cfg.haloCore * h, haloPeak],
      ] as const) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        g.addColorStop(0, rgba(glow, peak));
        g.addColorStop(0.25, rgba(glow, peak * 0.35));
        g.addColorStop(0.6, rgba(glow, peak * 0.08));
        g.addColorStop(1, rgba(glow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Not flipped — see the class doc; this is the whole sky's orientation.
    tex.update(false);
    // The dome wraps all the way round the horizon, so u must wrap with it.
    // DynamicTexture defaults BOTH axes to CLAMP, which leaves the column at
    // u = 0 filtering against its own edge texels instead of against the far
    // side of the sky — a hairline seam even where the painted content is
    // continuous. v stays clamped: it runs pole to pole and has nothing to
    // meet.
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    return tex;
  }

  /**
   * The galactic band: a great circle of dust, drawn as a run of overlapping
   * soft blobs along a sine path with its own dense star field on top. Tilted
   * off the horizon (`milkyWayTilt`) because a band running level with it
   * reads as a rendering seam rather than as sky.
   */
  private paintMilkyWay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    color: string,
    rand: () => number,
  ): void {
    const cfg = CONFIG.sky;
    const dust = Color3.FromHexString(color);
    // Centre of the band at column x: a full sine over the texture's width,
    // which is one circuit of the horizon — so the path closes on itself.
    const bandY = (x: number) =>
      h * (0.24 + cfg.milkyWayTilt * 0.16 * Math.sin((x / w) * Math.PI * 2));
    const halfW = cfg.milkyWayWidth * h;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < cfg.milkyWayBlobs; i++) {
      const x = rand() * w;
      // Concentrated toward the spine: two samples averaged is a cheap
      // triangular distribution, which is what makes the band have edges.
      const y = bandY(x) + (rand() + rand() - 1) * halfW;
      const r = halfW * (0.35 + rand() * 0.8);
      const a = 0.035 + rand() * 0.05;
      acrossSeam(x, w, r, (sx) => {
        const g = ctx.createRadialGradient(sx, y, 0, sx, y, r);
        g.addColorStop(0, rgba(dust, a));
        g.addColorStop(1, rgba(dust, 0));
        ctx.fillStyle = g;
        ctx.fillRect(sx - r, y - r, r * 2, r * 2);
      });
    }
    // The band's own stars: dense, small, and the reason it reads as stars
    // rather than as a smudge on the lens.
    for (let i = 0; i < cfg.milkyWayStars; i++) {
      const x = rand() * w;
      const y = bandY(x) + (rand() + rand() - 1) * halfW * 1.3;
      if (y > h * 0.46) continue; // below the ridge line, never seen
      ctx.fillStyle = rgba(dust, 0.2 + rand() * 0.5);
      // A single texel needs no wrapped copy, only to stay inside the canvas.
      ctx.fillRect(x % w, y, 1, 1);
    }
    ctx.restore();
  }

  /**
   * The star field: many dim, few bright, dissolving into the horizon murk
   * and washed out inside the moon's halo. The brightest few get diffraction
   * spikes — one cross each, which is what sells them as points of light
   * rather than as dots of paint.
   */
  private paintStars(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    spec: SkySpec,
    rand: () => number,
    moonX: number,
    moonY: number,
    haloR: number,
  ): void {
    const cfg = CONFIG.sky;
    const star = Color3.FromHexString(spec.starColor);
    const wash = haloR * cfg.starMoonWash;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < spec.starCount; i++) {
      const x = rand() * w;
      // Uniform on the sphere rather than on the texture: an even scatter in
      // texture space piles up at the pole, and the zenith ends up a clump.
      const y = (Math.acos(1 - rand() * 1.06) / Math.PI) * h;
      if (y > h * 0.46) continue; // below the ridge line, never seen
      const mag = Math.pow(rand(), 2.2);
      // Fade out both toward the horizon murk and inside the moon's glare.
      const altFade = clamp((h * 0.46 - y) / (h * 0.08), 0, 1);
      const dx = shortestDx(x - moonX, w);
      const moonFade = clamp(
        Math.hypot(dx, y - moonY) / Math.max(wash, 1) - 0.25,
        0,
        1,
      );
      const alpha =
        spec.starBrightness * (0.2 + 0.8 * mag) * altFade * moonFade;
      if (alpha <= 0.01) continue;
      const r = 0.4 + mag * (cfg.starMaxSize - 0.4);
      const spiked = mag > 1 - cfg.starSpikeFraction;
      const len = cfg.starSpikeLength * mag;
      acrossSeam(x, w, spiked ? len : r, (sx) => {
        ctx.fillStyle = rgba(star, alpha);
        ctx.beginPath();
        ctx.arc(sx, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (!spiked) return;
        const g = ctx.createLinearGradient(sx - len, y, sx + len, y);
        g.addColorStop(0, rgba(star, 0));
        g.addColorStop(0.5, rgba(star, alpha * 0.5));
        g.addColorStop(1, rgba(star, 0));
        ctx.fillStyle = g;
        ctx.fillRect(sx - len, y - 0.5, len * 2, 1);
        const gv = ctx.createLinearGradient(sx, y - len, sx, y + len);
        gv.addColorStop(0, rgba(star, 0));
        gv.addColorStop(0.5, rgba(star, alpha * 0.5));
        gv.addColorStop(1, rgba(star, 0));
        ctx.fillStyle = gv;
        ctx.fillRect(sx - 0.5, y - len, 1, len * 2);
      });
    }
    ctx.restore();
  }

  /**
   * The moon's face: a white disc with a soft limb in the alpha channel and
   * grey maria mottled across it. The material tints it, so this is painted
   * neutral — and the limb falloff is why the disc has no polygon edge.
   */
  private paintMoonTexture(rand: () => number): DynamicTexture {
    const cfg = CONFIG.sky;
    const size = cfg.moonTextureSize;
    const tex = new DynamicTexture(
      "sky-moon-tex",
      { width: size, height: size },
      this.scene,
      true,
    );
    const ctx = context2d(tex);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const r = size / 2;

    // The face, then the maria, then the limb — the limb is a destination-out
    // wipe so it eats whatever mottling is under it and the edge stays soft.
    const solid = r * (1 - cfg.moonLimbFraction);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(c, c, solid, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < cfg.moonMaria; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * solid * 0.8;
      const mr = solid * (0.1 + rand() * 0.26);
      const g = ctx.createRadialGradient(
        c + Math.cos(a) * d,
        c + Math.sin(a) * d,
        0,
        c + Math.cos(a) * d,
        c + Math.sin(a) * d,
        mr,
      );
      const shade = 0.66 + rand() * 0.2;
      g.addColorStop(0, `rgba(${255 * shade},${255 * shade},${255 * shade},1)`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, mr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = "destination-in";
    const limb = ctx.createRadialGradient(c, c, 0, c, c, r);
    limb.addColorStop(0, "rgba(255,255,255,1)");
    limb.addColorStop(1 - cfg.moonLimbFraction, "rgba(255,255,255,1)");
    limb.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = limb;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";

    tex.update(false);
    tex.hasAlpha = true;
    return tex;
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * A DynamicTexture's context, typed as the DOM one it actually is. Babylon's
 * `ICanvasRenderingContext` is a subset written for its headless/native
 * backends and is missing the compositing and ImageData calls the sky needs
 * (`globalCompositeOperation` for the additive passes, `createImageData` for
 * the cloud mask, which is written per pixel rather than drawn).
 */
function context2d(tex: DynamicTexture): CanvasRenderingContext2D {
  return tex.getContext() as unknown as CanvasRenderingContext2D;
}

/**
 * Draws a mark at `x` and, when it reaches within `reach` of either edge of a
 * texture `w` wide, again at the matching column on the far side.
 *
 * The dome is one circuit of the horizon, so its left and right edges are the
 * same piece of sky. A mark painted near one of them and not duplicated is cut
 * in half by the wrap — and a canvas clips rather than wrapping, so the half
 * that falls outside is simply lost. On a star that is a missing dot; on the
 * moon's halo, which is far wider than the moon's own distance from the wrap
 * column, it is a bright gradient ending in a straight vertical line down the
 * sky. Wrapping the sampler alone does not fix that: the seam is in the paint.
 */
function acrossSeam(
  x: number,
  w: number,
  reach: number,
  draw: (x: number) => void,
): void {
  draw(x);
  // Only one side can be in reach unless the mark is wider than the sky
  // itself, and a halo that wide has nothing left to be cut off by.
  if (x - reach < 0) draw(x + w);
  else if (x + reach > w) draw(x - w);
}

function wrap01(x: number): number {
  return x - Math.floor(x);
}

/** Horizontal distance on a texture that wraps at `w`. */
function shortestDx(dx: number, w: number): number {
  const d = Math.abs(dx) % w;
  return Math.min(d, w - d);
}

function rgba(c: Color3, a: number): string {
  const r = Math.round(clamp(c.r, 0, 1) * 255);
  const g = Math.round(clamp(c.g, 0, 1) * 255);
  const b = Math.round(clamp(c.b, 0, 1) * 255);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

/** Linear blend between two hex colours, returned as a hex string. */
function mixHex(a: string, b: string, t: number): string {
  const ca = Color3.FromHexString(a);
  const cb = Color3.FromHexString(b);
  return Color3.Lerp(ca, cb, t).toHexString();
}
