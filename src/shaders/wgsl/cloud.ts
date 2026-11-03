/**
 * wgsl/cloud.ts — The sky's cloud masses as plain strings OUR renderer
 * assembles (`render/cloudProgram.ts`, `BABYLON_EXIT.md` X4.5b): the vertex
 * stage that stands a cloud where it is and draws it as if it were far beyond
 * the world, and the pixel lit in cel TONES that writes one depth 7 km out along
 * its own ray. `CloudShader.ts`' `ShaderMaterial` drew these bodies through
 * Babylon until X4.5b; the arithmetic is its, statement for statement, and what
 * moved is only that the eye is `uniforms.cloudEye` (the frame's `camPos` is a
 * different field: `Sky.update` pushes this one) and the two outputs: the colour
 * is returned and the depth written to `fragmentOutputs`, which the assembler
 * declares (`FragmentProgram.writesDepth`).
 * Owns: `CLOUD_VERTEX` (`cloudVertex`) and `CLOUD_SURFACE` (`cloudSurface`, which
 * includes `celDither`).
 * Invariants: a body DECLARES NOTHING (`wgsl/chunks.ts`' rule): it reads
 * `uniforms.<name>`, `fragmentInputs.<name>`, `vertexInputs.<name>` and writes
 * `vertexOutputs.<name>` and `fragmentOutputs.fragDepth`, and its assembler
 * declares those; the fragment takes its ray from `fragmentInputs.position`, so
 * every fragment on one pixel writes bit-identical depth; unlit by any scene
 * light and unfogged by the cel fog; it writes coverage 0 as a LITERAL, never
 * `opaqueAlpha`, the ring being in no bake.
 * Never: imports Babylon (`src/render/` imports this, and the build gate walks
 * it); declares a binding.
 * Contract: `docs/rendering.md` ("The sky").
 */

/** The vertex stage: the real projection in x and y, the depth pinned short of the far plane. */
export const CLOUD_VERTEX = /* wgsl */ `
// Where a cloud's VERTICES land in clip depth: just short of the far plane, so
// no cloud is ever clipped by it however far out the ring is laid. What the
// depth TEST sees is not this but the fragment's skyDepth — see the fragment.
const CLIP_DEPTH: f32 = 0.9999998;

fn cloudVertex() {
  let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vNormalW = (uniforms.world * vec4f(vertexInputs.normal, 0.0)).xyz;
  vertexOutputs.vSmoothW = (uniforms.world * vec4f(vertexInputs.smoothNormal, 0.0)).xyz;
  vertexOutputs.vDir = worldPos.xyz - uniforms.cloudEye;
  // THE CLOUD IS WHERE IT IS AND DRAWN AS IF IT WERE FAR BEYOND THE WORLD. x
  // and y are the real projection, so a cloud a few hundred metres up over the
  // north field slides across the sky exactly as much as walking under it
  // should move it; z is pinned just inside the far plane so nothing clips it.
  var clip = uniforms.viewProjection * worldPos;
  clip.z = clip.w * CLIP_DEPTH;
  vertexOutputs.position = clip;
}
`;

/**
 * The pixel. `uniforms.look`: x lit share, y haze at the horizon, z lining, w
 * wrap. `uniforms.form`: x how much of the facet's own normal the light sees
 * (the rest is the lump's smooth one), y how much of the sky behind the shadow
 * side takes, z the belly's step, w how strongly the sky's air reaches the lit
 * side too. `uniforms.tones`: x how far toward the lit tone the first cut goes,
 * y where the second cut (the highlight) sits, as a cosine to the light.
 * `uniforms.fill`: x how far the shadow side's upper facets go toward the sky
 * above, y how much of the air the lit side sheds. `uniforms.depthRay`: where a
 * cloud's depth is written from: x, y the tangents of the half field of view,
 * z, w two over the target's width and height (pixel -> NDC).
 * `uniforms.depthLine`: the depth of a point depthMetres out ALONG ITS OWN RAY
 * is x - y * |ray|, with the ray's view-space z at 1 — see the fragment's end.
 */
export const CLOUD_SURFACE = /* wgsl */ `
#include<celDither>

// The dome's canvas gradient, stop for stop (\`Sky.paintDome\`): row 0 the
// zenith, 0.28 halfway to the horizon colour, 0.43 the horizon colour — and a
// row is (90 - elevation) / 180. Nothing a cloud stands in is under the band,
// so the stops past it are never reached and are not repeated.
fn domeAt(up: f32) -> vec3f {
  let row = 0.5 - asin(clamp(up, -1.0, 1.0)) / 3.14159265;
  let mid = mix(uniforms.zenithColor, uniforms.hazeColor, 0.5);
  if (row < 0.28) {
    return mix(uniforms.zenithColor, mid, row / 0.28);
  }
  return mix(mid, uniforms.hazeColor, clamp((row - 0.28) / 0.15, 0.0, 1.0));
}

// A hard cel step at zero, footed on the pixel so the edge is one pixel of
// antialiasing wide at every distance — \`band\`'s own edge, for a threshold
// that is not a multiple of a band width.
fn cut(x: f32) -> f32 {
  let w = max(fwidth(x), 1e-4);
  return smoothstep(-w, w, x);
}

fn cloudSurface() -> vec4f {
  let nFacet = normalize(fragmentInputs.vNormalW);
  let nSmooth = normalize(fragmentInputs.vSmoothW);
  let v = normalize(fragmentInputs.vDir);
  let l = uniforms.sunDir;
  let toward = clamp(dot(v, l), 0.0, 1.0);

  // THE SKY BEHIND THIS PIXEL: the dome's gradient, rebuilt from the same
  // stops the dome was painted with. A cloud is made of the air it stands in,
  // and the shade and the haze below reach for this rather than for a fixed
  // colour — that is the difference between a cloud and a pale rock hung in
  // front of the sky.
  //
  // **The gradient and NOT the halo baked over it**, and the halo was tried: a
  // cloud crossing the light took the halo's own colour and vanished into it,
  // where a backlit cloud is the one that should stand DARK against the glare.
  // The glow term below is what puts it back in the bright air, and only there.
  let dome = domeAt(v.y);

  // THE NORMAL THE LIGHT SEES is mostly the LUMP's, and only partly the
  // facet's. Lit per facet alone, every triangle took a tone of its own and a
  // cloud was a crystal of forty greys — the "too 3D, too solid" of it. Off the
  // smooth normal the terminator is one clean line across a lump, and the
  // facet share left in it is what makes that line break along the facets,
  // which is the frame's own hand-cut edge rather than an airbrushed one.
  let n = normalize(mix(nSmooth, nFacet, uniforms.form.x));

  // THE KEY, WRAPPED and cut ONCE. Two tones, as every wall in the village has:
  // a cloud is a scattering volume, so the light reaches past the equator
  // (wrap), but a ramp across it would be the continuous-tone smear the decks
  // were retired for.
  //
  // …and a SECOND cut above it for the facets square to the light. With one
  // cut, a flat bank's whole top was one cream shape with nothing in it; the
  // highlight is where the facet share in the normal shows, as the broken
  // bright ridge along the top of a lit cloud.
  let ndl = dot(n, l);
  let key = cut(uniforms.look.w + ndl) * uniforms.tones.x
    + cut(ndl - uniforms.tones.y) * (1.0 - uniforms.tones.x);

  // The two tones. The SHADOW side is mostly sky — a cloud's shade is lit by
  // the dome all round it — so it is the map's cloud colour pulled toward the
  // air behind it, which keeps it a darker shape IN the sky rather than a hole
  // cut out of it. The lit side is that tone carried toward the light's colour.
  let shade = mix(uniforms.shadeColor, dome, uniforms.form.y);
  let lit = mix(shade, uniforms.litColor, uniforms.look.x);
  // THE SKY FILL: the shadow side's UPPER facets are lit by the dome over
  // them, so they are a lighter, sky-tinted tone above a darker foot — the
  // middle tone every painted cloud has between its light and its belly. Cut
  // on the blended normal like the key, so its edge breaks along the facets.
  let skyAbove = mix(dome, uniforms.zenithColor, 0.5);
  let fill = mix(shade, skyAbove, uniforms.fill.x * cut(n.y - 0.3));
  var col = mix(fill, lit, key);

  // The belly. Nothing lights the underside of a cloud but the ground, so the
  // flat base is a third, darker tone — asked of the SMOOTH normal, so it is
  // one band along the bottom of the bank rather than a scatter of dark facets.
  col *= 1.0 - uniforms.form.z * cut(-nSmooth.y - 0.6);

  // THE SILVER LINING, the one term that belongs to where the EYE is. Looking
  // toward the light a cloud's thin edge is lit through, and on the smooth
  // normal that edge is a clean band round the silhouette — the rim light's own
  // vocabulary, one layer up — where on the facet normal it was a handful of
  // bright shards. Only well inside the light's quarter of the sky.
  //
  // **A graze alone is not an EDGE on a flat lump, and that shipped for a
  // photograph.** A bank low over the rim is seen almost edge-on, so its whole
  // top and its whole belly are square to the view as well as its rim, and a
  // cloud crossing the light took the lining all over and went the glare's own
  // colour. The rim of a flat lump is where its normal is also LEVEL, so the
  // lining asks both.
  let graze = cut(0.3 - abs(dot(nSmooth, v))) * cut(0.45 - abs(nSmooth.y));
  let behind = cut(pow(toward, 8.0) - 0.5);
  col = mix(col, uniforms.litColor, uniforms.look.z * graze * behind);

  // Inside the light's halo the whole mass is lifted toward the dome's glow,
  // so a cloud crossing the sun sits IN the bright air rather than cut out of it.
  col = mix(col, uniforms.glowColor, 0.35 * pow(toward, 40.0));

  // THE AIR. Every cloud takes some of the sky behind it — it is kilometres
  // away through the same haze that paints the dome — and a low one takes much
  // more, on the dome's own schedule: most of the way at the rim, the floor by
  // 30 degrees up. This is what sets a far bank back behind a near one.
  //
  // **The LIT side sheds part of it** (\`fill.y\`), and that is what keeps a
  // lit face the one thing in the sky PALER than the air around it. Hazed as
  // hard as the shade, a sunlit face landed on the sky's own value, a little
  // greyer — measured on Harrowmead, #ecc793 against an #e9be80 sky — and a
  // cloud no brighter than its sky is a pale stone hung in it. The shade keeps
  // the full share, so the haze still sets a far bank back behind a near one.
  let low = 1.0 - smoothstep(0.06, 0.5, v.y);
  let air = clamp(uniforms.form.w + low * uniforms.look.y, 0.0, 1.0);
  col = mix(col, dome, air * (1.0 - uniforms.fill.y * key));

  // ONE DEPTH PER PIXEL FOR EVERY CLOUD, written here rather than interpolated.
  // It is the depth of a point 7 km out along THIS PIXEL'S RAY, which is behind
  // every surface in the world and in front of the sun's disc — so a roof hides
  // a cloud, a cloud hides the disc, and the glow layer, occluded by this same
  // depth buffer, stops blooming the disc through one.
  //
  // **Along the ray, never along the view axis, and the difference was a bug
  // anybody could see.** A depth buffer stores view-axis z, and the disc 9 km
  // out has a view z of 9 km x cos(its angle off the centre of the screen). The
  // first version wrote one constant, the depth of 7 km DOWN THE AXIS, so past
  // about 39 degrees off-centre the disc's z fell under it and the disc drew in
  // front of the cloud hiding it: turn until the moon was toward the side of the
  // screen and the order flipped. A point at radial distance D on a ray whose
  // view-space direction is (x, y, 1) has z = D / |ray|, so writing that makes
  // the cloud's distance and the disc's the same KIND of distance at every
  // pixel, and 7 against 9 holds everywhere on the screen.
  //
  // From the pixel's own position rather than from vDir, for the painter's
  // order's sake: with LEQUAL a nearer lump drawn later must tie EXACTLY with
  // the farther one under it, and every fragment on one pixel is handed the same
  // position bit for bit, where an interpolated direction is not.
  let ndc = fragmentInputs.position.xy * uniforms.depthRay.zw - vec2f(1.0);
  let ray = ndc * uniforms.depthRay.xy;
  fragmentOutputs.fragDepth = uniforms.depthLine.x
    - uniforms.depthLine.y * sqrt(1.0 + dot(ray, ray));
  // Coverage 0, as everything opaque writes. At 7 km the ink's own fade has
  // taken every line off already, on every map's fog band.
  return vec4f(dither(col), 0.0);
}
`;
