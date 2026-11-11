/**
 * render/TextureMaker.ts — The textures the GAME makes for itself, made,
 * uploaded and mipped by our renderer as Babylon 9.28 made them
 * (`BABYLON_EXIT.md` X5.4d): a painted canvas (`Picture`, what a
 * `DynamicTexture` was), raw texels (what a `RawTexture` was), an image file
 * decoded (what the water's foam `Texture` was), and the fully-lit texel every
 * shadow lookup with no map behind it reads.
 * Owns: `TextureMaker` — the textures it made and has not released, one
 * `GPUSampler` per sampling state it was asked for, its mip chains
 * (`CubeMips`, over the cache's one `rgba8unorm` mip pipeline) and the
 * textures whose chains wait on that pipeline, the foam's stand-in texel, and
 * the textures released and waiting for the frame's submit, and a WEAK record
 * of every texture it made, for its teardown; `MadeTexture`, a
 * texture of its making as a bind group binds it; `Picture`; the sampling
 * states (`SAMPLING`, `anisotropic`); `newCanvas`, a canvas as Babylon made one
 * for a `DynamicTexture`.
 * Invariants: every texture is what Babylon made of the same request, read off
 * the device at X5.4d's BEFORE (c83841c) — `rgba8unorm` (a picture, the lit
 * texel, the foam) or `rg8unorm` (the cloud field), usage `COPY_SRC | COPY_DST
 * | TEXTURE_BINDING | RENDER_ATTACHMENT`, the full mip chain where mips were
 * asked (`floor(log2(max(w, h))) + 1`) and one level where not, viewed whole;
 * a picture is uploaded by `copyExternalImageToTexture` off its canvas with
 * its `flipY` (`DynamicTexture.update`'s `invertY`) and `premultipliedAlpha`
 * false, a decoded image off the `ImageBitmap` Babylon's `LoadImage` made
 * (`premultiplyAlpha: "none"`, `colorSpaceConversion: "none"`), raw texels by
 * `writeTexture`, never flipped (no raw texture of the game's ever was); the
 * mip chain is Babylon's (`WebGPUTextureManager.generateMipmaps`, which
 * `cubeMips.ts` ports): each level drawn from the level above through a
 * sampler that is `linear` for minification and nothing else, levels top
 * down, each pass loading its level and storing it — recorded on an encoder of
 * its own and submitted at once; **a mipped texture has NO VIEW until its chain
 * is recorded** (and, if the mip pipeline failed, a view of its top level
 * alone), so nothing ever samples a half-made chain (a draw over one
 * draws nothing, as a Babylon material not ready drew nothing): Babylon built
 * its mip pipeline synchronously at its engine's boot and recorded a chain
 * with its upload, and ours is the cache's one (`PipelineCache`, the
 * reflection bake's own, asked at the renderer's construction), so a texture
 * painted before it is built — the sky's dome, in `Game`'s constructor, which
 * no frame draws until a map stands — waits for it, and every chain owed is
 * recorded the moment it settles; a texture that is still decoding is bound
 * as Babylon bound one not ready (the engine's empty texel, sampled `NEAREST`
 * with the texture's own wrap) until it is; a sampling state is a
 * `GPUSamplerDescriptor` as Babylon's sampler cache made it (`SAMPLING`), one
 * sampler per state; a picture is made ONCE however often it is asked
 * (`picture`); a released texture is destroyed after the next frame's submit
 * (`FrameHost.afterSubmit`), never inside a frame that may still bind it —
 * but by `dispose`, the teardown a lost device runs between frames with none
 * after it (`Game.deviceLost`, `BABYLON_EXIT.md` X5.4i), which destroys every
 * texture it made at once, the live ones and the lit texel with the rest.
 * Never: imports Babylon; draws in a frame; keeps a canvas past its upload but
 * as the key its texture is found by.
 * Contract: `docs/rendering.md`, "Our renderer's frame" and "The textures the
 * game paints".
 */
import { CubeMips } from "./cubeMips";
import type { FrameHost } from "./frameHost";
import { OwnTexture } from "./HostBindGroup";
import type { PipelineCache } from "./PipelineCache";

/** Bytes a texel, for the formats raw texels are written in. */
const TEXEL_BYTES: Record<RawFormat, number> = { rgba8unorm: 4, rg8unorm: 2 };

/** What a raw texture may be: the lit texel's and the cloud field's formats. */
export type RawFormat = "rgba8unorm" | "rg8unorm";

/**
 * How Babylon's WebGPU sampler cache made a sampler for each sampling state the
 * game used (`WebGPUCacheSampler._GetSamplerDescriptor`), read off the device at
 * X5.4d's BEFORE. Every one repeats in `w`: Babylon's `_cachedWrapR` was never
 * set on a 2D texture, and the cache reads that as `WRAP`.
 */
export const SAMPLING = {
  /**
   * A texture with no mips at `TRILINEAR_SAMPLINGMODE`, clamped — a
   * `DynamicTexture`'s defaults (the motes, the scorch, the puff, the blob) and
   * the lit texel's (`RawTexture.CreateRGBATexture`): linear both ways, no mip
   * filter and the LOD held at 0, no anisotropy (Babylon's comes on only with
   * mips).
   */
  flat: {
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "repeat",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "nearest",
    lodMinClamp: 0,
    lodMaxClamp: 0,
    maxAnisotropy: 1,
  },
  /**
   * `NEAREST_SAMPLINGMODE`, clamped: `ShadowBindings`' no-cloud texel, a
   * `RawTexture` made so.
   */
  nearest: {
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "repeat",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
    lodMinClamp: 0,
    lodMaxClamp: 0,
    maxAnisotropy: 1,
  },
} as const satisfies Record<string, GPUSamplerDescriptor>;

/**
 * What Babylon's cache made of a texture whose anisotropy it turned on — a
 * mipped texture at `TRILINEAR_SAMPLINGMODE`, or one at
 * `BILINEAR_SAMPLINGMODE` whatever its mips (the cloud field): every filter
 * linear, the LOD at WebGPU's defaults (Babylon states none), `maxAnisotropy`
 * the texture's own level (its default 4; the grounds' 8), the device's cap
 * of 16 above all of them.
 */
export function anisotropic(u: GPUAddressMode, v: GPUAddressMode, level: number): GPUSamplerDescriptor {
  return {
    addressModeU: u,
    addressModeV: v,
    addressModeW: "repeat",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    maxAnisotropy: level,
  };
}

/**
 * A canvas as `AbstractEngine._CreateCanvas` made one for a `DynamicTexture`:
 * the document's, or an `OffscreenCanvas` where there is none (a Node run
 * that builds the world under a stub, `kit:hash`), at the texture's size.
 */
export function newCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document === "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * A canvas the game painted and the texture it is to be: what a
 * `DynamicTexture` was, its `update(invertY)` and its sampling held beside it.
 * Its texture is made the first time it is asked for (`TextureMaker.picture`),
 * and the same texture is answered every time after.
 */
export interface Picture {
  readonly label: string;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Uploaded flipped: `DynamicTexture.update()`'s default, `update(false)` the sky's. */
  readonly flipY: boolean;
  /** The full mip chain, Babylon's filter (the constructor's `generateMipMaps`). */
  readonly mips: boolean;
  readonly sampling: GPUSamplerDescriptor;
}

/** A texture of the maker's, as a bind group binds it — and the texture itself, null once released. */
export class MadeTexture extends OwnTexture {
  texture: GPUTexture | null = null;
}

/** A mipped texture whose chain is owed: its handle, the texture, and the sampling its view comes with. */
interface Owed {
  readonly made: MadeTexture;
  readonly texture: GPUTexture;
  readonly sampling: GPUSamplerDescriptor;
}

/**
 * A texture's view, whole, stated as Babylon's hardware texture stated the one
 * it bound (`createGPUTextureForInternalTexture`): every level, its one layer,
 * every aspect — what a bare `createView()` defaults to, written out. `levels`
 * is short of every level only for a chain the mip pipeline never drew (`chain`).
 */
function whole(texture: GPUTexture, levels = texture.mipLevelCount): GPUTextureView {
  return texture.createView({
    format: texture.format,
    dimension: "2d",
    mipLevelCount: levels,
    baseArrayLayer: 0,
    baseMipLevel: 0,
    arrayLayerCount: 1,
    aspect: "all",
  });
}

export class TextureMaker {
  private readonly samplers = new Map<string, GPUSampler>();
  private readonly pictures = new WeakMap<Picture, MadeTexture>();
  /** Babylon's mip filter, over the cache's one `rgba8unorm` mip pipeline (the reflection bake's own). */
  private readonly chains: CubeMips;
  /** Whether that pipeline has settled — built or failed — and so whether a chain is recorded at once. */
  private chainsSettled = false;
  /** Mipped textures made before it settled, their chains owed. */
  private readonly owed: Owed[] = [];
  private readonly retired: GPUTexture[] = [];
  /**
   * Every texture made, held WEAKLY: what `dispose` destroys — the live ones,
   * the lit texel, the retired and the empty texel alike — without keeping
   * alive one whose handle the game dropped unreleased, which the collector
   * would otherwise have taken. Pruned of the collected as it grows (`made`).
   */
  private readonly everMade = new Set<WeakRef<GPUTexture>>();
  /** `everMade`'s size after its last prune: it is pruned again at twice that. */
  private prunedAt = 0;
  private readonly afterSubmit: { dispose(): void };
  /**
   * The engine's empty texel (`AbstractEngine.emptyTexture`): four zero bytes,
   * made at the first ask — held, and not only its view, so `dispose` can
   * destroy it.
   */
  private blank: GPUTexture | null = null;
  private blankView: GPUTextureView | null = null;
  private litTexel: MadeTexture | null = null;

  constructor(
    private readonly device: GPUDevice,
    host: FrameHost,
    pipelines: PipelineCache,
  ) {
    this.chains = new CubeMips(device, pipelines, "rgba8unorm");
    void this.chains.ready.then((built) => {
      this.chainsSettled = true;
      if (!built) console.error("textures: the mip pipeline did not build; a mipped texture is bound with its top level alone");
      for (const owed of this.owed) if (owed.made.texture === owed.texture) this.chain(owed);
      this.owed.length = 0;
    });
    this.afterSubmit = host.afterSubmit(this.destroyRetired);
  }

  /** The sampler for one sampling state: made at its first ask, the same object after. */
  sampler(state: GPUSamplerDescriptor): GPUSampler {
    const key = JSON.stringify(state);
    let s = this.samplers.get(key);
    if (!s) {
      s = this.device.createSampler(state);
      this.samplers.set(key, s);
    }
    return s;
  }

  /**
   * A picture's texture: made, uploaded off its canvas and mipped the first
   * time it is asked for, and the same `MadeTexture` every time after — two
   * materials painted with one canvas bind one texture, as Babylon's two did
   * one `DynamicTexture`.
   */
  picture(p: Picture): MadeTexture {
    let made = this.pictures.get(p);
    if (made) return made;
    const { width, height } = p.canvas;
    made = new MadeTexture();
    const texture = this.texture(p.label, width, height, "rgba8unorm", p.mips);
    made.texture = texture;
    this.device.queue.copyExternalImageToTexture(
      { source: p.canvas, flipY: p.flipY },
      { texture, premultipliedAlpha: false },
      [width, height, 1],
    );
    if (p.mips) this.mips({ made, texture, sampling: p.sampling });
    else this.show(made, texture, p.sampling);
    this.pictures.set(p, made);
    return made;
  }

  /** Raw texels, one level, written as they lie (row 0 first, never flipped). */
  raw(label: string, data: Uint8Array, width: number, height: number, format: RawFormat, sampling: GPUSamplerDescriptor): MadeTexture {
    const made = new MadeTexture();
    const texture = this.texture(label, width, height, format, false);
    made.texture = texture;
    this.write(made, data);
    this.show(made, texture, sampling);
    return made;
  }

  /** A raw texture's texels, rewritten whole — `RawTexture.update`. */
  write(made: MadeTexture, data: Uint8Array): void {
    const texture = made.texture;
    if (!texture) return;
    const bytes = TEXEL_BYTES[texture.format as RawFormat];
    this.device.queue.writeTexture(
      { texture },
      data as Uint8Array<ArrayBuffer>,
      { offset: 0, bytesPerRow: texture.width * bytes, rowsPerImage: texture.height },
      [texture.width, texture.height, 1],
    );
  }

  /**
   * An image file decoded as Babylon's `Texture` decoded one under WebGPU
   * (`LoadImage` with `forceBitmapOverHTMLImageElement`): its bytes fetched,
   * an `ImageBitmap` made of them in a `Blob` with no type, unpremultiplied and
   * unconverted, uploaded `flipY` (a `Texture`'s `invertY`) and mipped. Until
   * it is, the handle binds the stand-in Babylon bound for a texture not ready —
   * the engine's empty texel at `NEAREST_SAMPLINGMODE`, wrapped as the texture
   * is wrapped. `whenReady` is told once it is, or with the error if it fails
   * — the fetch, the decode, or the upload after it (the stand-in stays) — and
   * is told exactly once either way.
   */
  image(
    label: string,
    url: string,
    sampling: GPUSamplerDescriptor,
    whenReady: (error: unknown) => void,
  ): MadeTexture {
    const made = new MadeTexture();
    made.view = this.blankTexel();
    made.sampler = this.sampler({
      ...SAMPLING.nearest,
      addressModeU: sampling.addressModeU,
      addressModeV: sampling.addressModeV,
    });
    const standIn = { view: made.view, sampler: made.sampler };
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${label}: ${r.status} ${r.statusText}`);
        return r.arrayBuffer();
      })
      .then((data) =>
        createImageBitmap(new Blob([data], { type: "" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" }),
      )
      .then((bitmap) => {
        let texture: GPUTexture | null = null;
        try {
          const { width, height } = bitmap;
          texture = this.texture(label, width, height, "rgba8unorm", true);
          this.device.queue.copyExternalImageToTexture(
            { source: bitmap, flipY: true },
            { texture, premultipliedAlpha: false },
            [width, height, 1],
          );
          made.texture = texture;
          // The stand-in stays bound until the chain is recorded — at once, the
          // pipeline having settled long before any decode lands.
          this.mips({ made, texture, sampling });
        } catch (error: unknown) {
          // A throw past the decode (the device lost under it) fails as a fetch
          // or a decode does: the stand-in bound, the texture made for it
          // retired, and `whenReady` told below — or the scene's pending data
          // is never released and nothing waiting on `isReady` ever runs.
          made.texture = null;
          made.view = standIn.view;
          made.sampler = standIn.sampler;
          if (texture) this.retired.push(texture);
          throw error;
        } finally {
          bitmap.close();
        }
      })
      .then(
        () => whenReady(null),
        (error: unknown) => whenReady(error),
      );
    return made;
  }

  /**
   * The texel every shadow lookup reads as FULLY LIT — what a map that is off
   * is bound as (`ShadowBindings`, `Volumetrics`): one `rgba8unorm` texel of 255,
   * which reads back as exactly 1.0, past every receiver; the FORMAT is what
   * matters (a 32-bit float is not filterable, and fails the group the depth
   * maps' filtering sampler asks for). Made once, never released.
   */
  get lit(): MadeTexture {
    return (this.litTexel ??= this.raw(
      "lit shadow",
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      "rgba8unorm",
      SAMPLING.flat,
    ));
  }

  /**
   * `made`'s texture, destroyed after the next frame's submit; the handle binds
   * nothing from now on (a group over it is not made: its draw draws nothing).
   */
  release(made: MadeTexture): void {
    const texture = made.texture;
    made.texture = null;
    made.view = null;
    made.sampler = null;
    if (texture) this.retired.push(texture);
  }

  /**
   * The teardown, with no frame after it (a lost device's, `Game.deviceLost`,
   * `BABYLON_EXIT.md` X5.4i, through `Renderer.dispose`): EVERY texture the
   * maker made and the collector has not taken destroyed AT ONCE — the live
   * ones, the lit texel, the retired and the empty texel — the one exception
   * to "destroyed after the frame's submit" (the header). A handle bound
   * after it binds a destroyed texture.
   */
  dispose(): void {
    this.afterSubmit.dispose();
    for (const ref of this.everMade) ref.deref()?.destroy();
    this.everMade.clear();
    this.blank?.destroy();
    this.blank = null;
    this.prunedAt = 0;
    this.retired.length = 0;
    this.owed.length = 0;
    this.blankView = null;
    this.litTexel = null;
  }

  private texture(label: string, width: number, height: number, format: GPUTextureFormat, mips: boolean): GPUTexture {
    return this.made(this.device.createTexture({
      label,
      size: [width, height, 1],
      format,
      // `COPY_SRC | COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT` (23): what
      // Babylon's `createTexture` asked for every one of these. Named here, at
      // the call, and never at the module's top level, where a WebGPU global
      // throws before `main.ts`' gate runs (`CLAUDE.md`, `docs/build.md`).
      usage:
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
      mipLevelCount: mips ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1,
    }));
  }

  /** `texture`, remembered for `dispose`: weakly, the collected pruned once the set has doubled. */
  private made(texture: GPUTexture): GPUTexture {
    const made = this.everMade;
    made.add(new WeakRef(texture));
    if (made.size >= 2 * this.prunedAt + 64) {
      for (const ref of made) if (ref.deref() === undefined) made.delete(ref);
      this.prunedAt = made.size;
    }
    return texture;
  }

  /** `made` bound as `texture` — whole, or its top `levels` — with `sampling`'s sampler. */
  private show(made: MadeTexture, texture: GPUTexture, sampling: GPUSamplerDescriptor, levels = texture.mipLevelCount): void {
    made.view = whole(texture, levels);
    made.sampler = this.sampler(sampling);
  }

  /** A chain recorded now if the mip pipeline has settled, and owed until it does otherwise. */
  private mips(owed: Owed): void {
    if (this.chainsSettled) this.chain(owed);
    else this.owed.push(owed);
  }

  /**
   * `generateMipmaps`: levels 1 and down, each drawn from the level above, on
   * an encoder of its own and submitted — and only then the texture shown.
   */
  private chain({ made, texture, sampling }: Owed): void {
    const encoder = this.device.createCommandEncoder({ label: `${texture.label}: mips` });
    const recorded = this.chains.record(texture, encoder);
    this.chains.forget(texture);
    this.device.queue.submit([encoder.finish()]);
    // Not recorded (the mip pipeline failed), levels 1 and down were never
    // written — zeros, which a far sample reads as black — so the texture is
    // shown with its top level alone, as the constructor's log says.
    this.show(made, texture, sampling, recorded ? texture.mipLevelCount : 1);
  }

  /** The engine's empty texel's view, made at the first ask. */
  private blankTexel(): GPUTextureView {
    if (!this.blankView) {
      const texture = this.texture("empty texel", 1, 1, "rgba8unorm", false);
      this.device.queue.writeTexture({ texture }, new Uint8Array(4), { offset: 0, bytesPerRow: 4, rowsPerImage: 1 }, [1, 1, 1]);
      this.blank = texture;
      this.blankView = whole(texture);
    }
    return this.blankView;
  }

  private readonly destroyRetired = (): void => {
    const retired = this.retired;
    if (retired.length === 0) return;
    for (let i = 0; i < retired.length; i++) retired[i].destroy();
    retired.length = 0;
  };
}
