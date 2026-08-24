/**
 * Sky.ts — Procedural night sky: baked dome texture (gradient/galactic band/
 * stars/moon halo), a textured moon disc, and drifting fBm cloud decks, each
 * a pair of shells (shadowed body + moonlit silver). All unlit emissive
 * meshes, infiniteDistance, unpickable; moon bloom via the GlowLayer.
 * Invariants: moonDir is negated to align with the shader's light direction;
 * the moon renders in a later renderingGroup than the dome. Rebuilt from an
 * EnvironmentSpec via apply() — keep it data-driven, no Hollowmere specifics.
 */
import {
  Color3,
  Constants,
  DynamicTexture,
  GlowLayer,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { mulberry32 } from "../world/rng";
import type { EnvironmentSpec, SkySpec } from "../world/environment";

/**
 * The night sky: a gradient dome with the galactic band, the stars and the
 * moon's scattering halo baked into a generated texture, an emissive moon
 * disc that feeds the GlowLayer, and cloud decks on sphere shells just inside
 * the dome, scrolling azimuthally. Everything is painted at runtime — the game
 * ships no image files — and nothing here is lit: the scene has no Babylon
 * lights, so sky materials are unlit emissive by construction.
 *
 * Every sky mesh uses `infiniteDistance` (it rides with the camera, so the
 * horizon never gets closer and the clouds are always overhead) and stays
 * outside the pick/collide contract: no `solid` metadata, `isPickable =
 * false`, `noOutline`. These meshes are built after Game's constructor-time
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
 * Two things about the clouds are load-bearing:
 *
 * - **The mask is 3D noise sampled on the sphere direction, not 2D noise on
 *   the texture.** An equirectangular image stretches by 1/sin(latitude), so
 *   a 2D field draws blobs that smear into bands as they climb and pinch to
 *   nothing at the pole; sampling a tileable 3D lattice along the direction
 *   the pixel actually points removes the distortion, and it wraps at the
 *   seam and at the pole for free.
 * - **The moonlit silver is a second, additive shell with a static per-vertex
 *   mask**, not a brighter patch in the texture. The texture scrolls; the moon
 *   does not. Baking the lit side into the mask would drag the highlight
 *   around the sky with the clouds.
 */
export class Sky {
  private disposables: { dispose(): void }[] = [];
  private cloudTextures: DynamicTexture[] = [];
  private cloudSpeeds: number[] = [];
  /**
   * Where the moon hangs, as a unit direction. Zero until apply() runs, and
   * mutated in place rather than replaced — GodRays holds this instance.
   */
  private readonly moonDir = Vector3.Zero();

  constructor(
    private scene: Scene,
    private glow: GlowLayer,
  ) {
    // Rendering groups above 0 clear the depth buffer by default (the
    // classic FPS-viewmodel trick). The sky lives in group 1 so the moon
    // draws over the dome, but it must still respect the WORLD's depth —
    // without this the moon and clouds render through players and walls.
    scene.setRenderingAutoClearDepthStencil(1, false);
  }

  /**
   * The moon's direction from the camera (it rides at infiniteDistance, so
   * there is no world position to speak of). GodRays projects this to find
   * where on screen the shafts converge.
   */
  get moonDirection(): Vector3 {
    return this.moonDir;
  }

  /** Rebuilds the sky for a map's environment; a missing `sky` spec clears it. */
  apply(env: EnvironmentSpec): void {
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
    // A sky with no disc hands out no direction, which is exactly what
    // `clear()` already means by leaving this zero: GodRays reads it as
    // "nothing to converge on" and takes its pass off the camera. The halo
    // below is still painted at `moonDir`, which is a local — the sky is lit
    // from somewhere whether or not the source is drawn.
    if (discRadius > 0) this.moonDir.copyFrom(moonDir);

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
      moon.position.copyFrom(moonDir.scale(cfg.moonDistance));
      // Billboard, not lookAt: the disc must face the camera dead-on from
      // everywhere on the map, and with infiniteDistance it rides with it.
      moon.billboardMode = Mesh.BILLBOARDMODE_ALL;
      moon.material = moonMat;
      moon.renderingGroupId = 1; // after the dome, so depth can't drop it
      this.prepare(moon, false);
      this.disposables.push(moonMat, moonTex);
    }

    // --- cloud decks: sphere shells just inside the dome, so there are no
    // edges anywhere. Transparent, so they veil the moon on their own. ---
    for (const layer of cfg.cloudLayers) {
      const cloudTex = this.paintCloudTexture(layer.coverage, rand);
      cloudTex.uScale = layer.uScale; // azimuthal repeat: smaller, busier blobs
      this.cloudTextures.push(cloudTex);
      this.cloudSpeeds.push(layer.speedU);
      this.disposables.push(cloudTex);
      const diameter = (cfg.domeRadius - layer.radiusOffset) * 2;

      // The body of the deck: the map's cloud tint, alpha straight from the
      // mask. This is what blocks the stars.
      const bodyMat = new StandardMaterial("sky-cloud-mat", this.scene);
      bodyMat.emissiveTexture = cloudTex;
      bodyMat.opacityTexture = cloudTex;
      bodyMat.emissiveColor = Color3.FromHexString(spec.cloudColor);
      bodyMat.alpha = spec.cloudOpacity * layer.opacity;
      this.dressCloudMaterial(bodyMat);
      this.cloudShell(diameter, bodyMat);
      this.disposables.push(bodyMat);

      // The moonlit face: the same mask, silver, added on top and masked to
      // the stretch of sky around the moon by per-vertex alpha.
      const litMat = new StandardMaterial("sky-cloud-lit-mat", this.scene);
      litMat.emissiveTexture = cloudTex;
      litMat.opacityTexture = cloudTex;
      litMat.emissiveColor = Color3.FromHexString(spec.cloudLitColor);
      litMat.alpha = spec.cloudLitStrength * layer.opacity;
      // Added, not blended: the silver is light reaching the camera through
      // the deck, so it lifts the body it sits on rather than replacing it.
      litMat.alphaMode = Constants.ALPHA_ADD;
      this.dressCloudMaterial(litMat);
      const lit = this.cloudShell(diameter, litMat, moonDir);
      // Slightly inside the body shell: the two are coincident otherwise, and
      // depth-equal transparent surfaces z-fight into a shimmer as the camera
      // turns. Both are unlit and depth-write-free, so this is purely order.
      lit.scaling.setAll(0.998);
      this.disposables.push(litMat);
    }
  }

  /** Scrolls the cloud decks azimuthally. Runs in every game state. */
  update(dt: number): void {
    for (let i = 0; i < this.cloudTextures.length; i++) {
      this.cloudTextures[i].uOffset += this.cloudSpeeds[i] * dt;
    }
  }

  private clear(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.cloudTextures.length = 0;
    this.cloudSpeeds.length = 0;
    // A sky with no moon has no direction to hand out; GodRays reads a zero
    // here as "nothing to converge on" and switches itself off.
    this.moonDir.setAll(0);
  }

  /** The settings every cloud shell material shares, lit or not. */
  private dressCloudMaterial(mat: StandardMaterial): void {
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableDepthWrite = true;
  }

  /**
   * One cloud shell. Passing `moonDir` gives it a per-vertex alpha mask that
   * peaks at the moon and falls off around it — the anchor that keeps the
   * silver in the sky while the texture scrolls through it.
   */
  private cloudShell(
    diameter: number,
    mat: StandardMaterial,
    moonDir?: Vector3,
  ): Mesh {
    const cfg = CONFIG.sky;
    const shell = MeshBuilder.CreateSphere(
      "sky-cloud",
      {
        diameter,
        segments: cfg.cloudSegments,
        sideOrientation: Mesh.BACKSIDE,
      },
      this.scene,
    );
    if (moonDir) {
      const pos = shell.getVerticesData(VertexBuffer.PositionKind)!;
      const colors = new Float32Array((pos.length / 3) * 4);
      const inv = 2 / diameter;
      for (let i = 0; i < pos.length / 3; i++) {
        const d =
          (pos[i * 3] * moonDir.x +
            pos[i * 3 + 1] * moonDir.y +
            pos[i * 3 + 2] * moonDir.z) *
          inv;
        colors[i * 4] = 1;
        colors[i * 4 + 1] = 1;
        colors[i * 4 + 2] = 1;
        colors[i * 4 + 3] = Math.pow(Math.max(d, 0), cfg.cloudLitPower);
      }
      shell.setVerticesData(VertexBuffer.ColorKind, colors);
      shell.hasVertexAlpha = true;
    }
    shell.material = mat;
    shell.renderingGroupId = 1;
    this.prepare(shell, true);
    return shell;
  }

  /**
   * Tags a sky mesh out of every scene contract and parks it at infinite
   * distance. `excludeGlow` is for the pieces whose emissive fill must not
   * bloom (dome, clouds); the moon passes false so the GlowLayer haloes it.
   */
  private prepare(mesh: Mesh, excludeGlow: boolean): void {
    mesh.infiniteDistance = true;
    mesh.isPickable = false;
    // noGlow only where true — the moon keeps its bloom, so it must not
    // claim the flag (the contract reads it as "excluded from the GlowLayer").
    mesh.metadata = excludeGlow
      ? { noOutline: true, noGlow: true }
      : { noOutline: true };
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

  /**
   * Paints one deck's cloud mask: tileable fBm sampled along the direction
   * each texel points (see the class doc — 2D noise smears at altitude),
   * thresholded at `coverage` for billowy edges and confined to the latitude
   * band `cloudBandTop..cloudBandBottom` with its edges faded so no ring
   * shows. White in rgb, cloud in alpha; the material supplies the tint.
   */
  private paintCloudTexture(
    coverage: number,
    rand: () => number,
  ): DynamicTexture {
    const cfg = CONFIG.sky;
    const w = cfg.cloudTextureWidth;
    const h = cfg.cloudTextureHeight;
    const tex = new DynamicTexture(
      "sky-cloud-tex",
      { width: w, height: h },
      this.scene,
      true,
    );
    const ctx = context2d(tex);
    const img = ctx.createImageData(w, h);
    const data = img.data;

    const noise = fbm3(rand, cfg.cloudLattice, cfg.cloudOctaves);
    const top = cfg.cloudBandTop * h;
    const bottom = cfg.cloudBandBottom * h;
    const fade = (bottom - top) * 0.22;

    // The field is built first and stretched to its own full range before it
    // is thresholded. Summed value noise piles up around 0.5 — the octaves
    // average out, the way any sum of independent terms does — so a raw fBm
    // never gets within a third of either end, and a coverage of 0.5 against
    // it produces not "half sky" but a barely-there haze. Normalising is what
    // makes `coverage` mean what it says at any octave count.
    const field = new Float32Array(w * h);
    let lo = Infinity;
    let hi = -Infinity;
    for (let py = 0; py < h; py++) {
      // Row 0 is the zenith; the sphere's y is cos(pi * row / h).
      const theta = (Math.PI * (py + 0.5)) / h;
      const sy = Math.cos(theta);
      const ring = Math.sin(theta);
      for (let px = 0; px < w; px++) {
        const phi = ((px + 0.5) / w) * Math.PI * 2;
        const f = noise(ring * Math.cos(phi), sy, -ring * Math.sin(phi));
        field[py * w + px] = f;
        if (f < lo) lo = f;
        if (f > hi) hi = f;
      }
    }
    const span = hi - lo || 1;

    for (let py = 0; py < h; py++) {
      const band =
        smoothstep(top, top + fade, py) *
        (1 - smoothstep(bottom - fade, bottom, py));
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        if (band <= 0) continue;
        const f = (field[py * w + px] - lo) / span;
        const a =
          smoothstep(coverage, coverage + cfg.cloudSoftness, f) * band;
        data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
      }
    }

    ctx.putImageData(img, 0, 0);
    // Not flipped: the band rows above are latitudes, not pixels.
    tex.update(false);
    tex.hasAlpha = true;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    return tex;
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * Tileable 3D value-noise fBm on the unit sphere. Each octave owns a cubic
 * lattice of random values wrapped at its own resolution, so the field is
 * continuous everywhere on the sphere — no seam at the texture's edge and no
 * pinch at the pole, which is the whole reason the clouds are sampled in 3D.
 * Returns 0..1.
 */
function fbm3(
  rand: () => number,
  lattice: number,
  octaves: number,
): (x: number, y: number, z: number) => number {
  const grids: { n: number; g: Float32Array }[] = [];
  let amp = 1;
  let norm = 0;
  const amps: number[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = lattice << o;
    const g = new Float32Array(n * n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    grids.push({ n, g });
    amps.push(amp);
    norm += amp;
    amp *= 0.5;
  }

  return (x, y, z) => {
    let sum = 0;
    for (let o = 0; o < grids.length; o++) {
      const { n, g } = grids[o];
      // The sphere is radius 1, so shift into 0..2 before scaling — negative
      // coordinates would need a modulo on every axis otherwise.
      const fx = (x + 1) * 0.5 * n;
      const fy = (y + 1) * 0.5 * n;
      const fz = (z + 1) * 0.5 * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const z0 = Math.floor(fz);
      const tx = smoothCurve(fx - x0);
      const ty = smoothCurve(fy - y0);
      const tz = smoothCurve(fz - z0);
      const xa = ((x0 % n) + n) % n;
      const ya = ((y0 % n) + n) % n;
      const za = ((z0 % n) + n) % n;
      const xb = (xa + 1) % n;
      const yb = (ya + 1) % n;
      const zb = (za + 1) % n;
      const nn = n * n;
      const c000 = g[za * nn + ya * n + xa];
      const c100 = g[za * nn + ya * n + xb];
      const c010 = g[za * nn + yb * n + xa];
      const c110 = g[za * nn + yb * n + xb];
      const c001 = g[zb * nn + ya * n + xa];
      const c101 = g[zb * nn + ya * n + xb];
      const c011 = g[zb * nn + yb * n + xa];
      const c111 = g[zb * nn + yb * n + xb];
      const e00 = c000 + (c100 - c000) * tx;
      const e10 = c010 + (c110 - c010) * tx;
      const e01 = c001 + (c101 - c001) * tx;
      const e11 = c011 + (c111 - c011) * tx;
      const f0 = e00 + (e10 - e00) * ty;
      const f1 = e01 + (e11 - e01) * ty;
      sum += (f0 + (f1 - f0) * tz) * amps[o];
    }
    return sum / norm;
  };
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

function smoothCurve(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
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
