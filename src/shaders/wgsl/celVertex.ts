/**
 * wgsl/celVertex.ts — The cel material's VERTEX body: where a vertex lands and
 * what it hands the fragment, as one function both renderers call,
 * `celVertex()`.
 * Owns: `CEL_VERTEX` (the chunk `celVertex` in `WGSL_CHUNKS`) — the world
 * transform, the wind's sway (the RAMP, and the two RIGGED layers, a palm's
 * frond and an ash's bough), the world normal and the varyings — the
 * vertex-stage half of what `celSurface` is to the fragment.
 * Invariants: declares nothing (`wgsl/chunks.ts`'s rule): Babylon's
 * declarations for it are `CelShader.ts`'s `celVertexShader`, ours are
 * `render/celVertex.ts`; reads its inputs as `vertexInputs.<name>`, its
 * uniforms as `uniforms.<name>` and writes `vertexOutputs.<name>`, the
 * spellings both sides honour; ends with clip space in
 * `vertexOutputs.position` and NO y flip — each side's own `main` owns the
 * flip of a pass that renders to a texture (Babylon's processor appends it;
 * ours, `render/wgsl/assemble.ts`, writes it); the one variant define it
 * reads is `CEL_PALETTE`.
 * Never: imports Babylon; is edited for one renderer — what the two must
 * differ in is a declaration, never a body.
 * Contract: `docs/rendering.md` ("Hand-written WGSL", and the wind's rigs);
 * `CelShader.ts`'s header is the material's own.
 */

/**
 * The cel vertex stage, minus its declarations and its entry point. Called
 * by each side's `main` with the inputs already in `vertexInputs`.
 */
export const CEL_VERTEX = `
fn celVertex() {
  var worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);

  // --- foliage sway, in world space, weighted by the baked red channel ---
  //
  // Branched rather than multiplied out, and the branch costs nothing because
  // it is coherent: the sway mark is part of the merge KEY, so a draw is either
  // all foliage or all wall and no warp ever has both answers in it. Everything
  // that is not world geometry — every rig, the viewmodel, every grenade and
  // every effect mesh — carries no colour buffer at all and takes the disabled
  // attrib's 0, so it pays one compare and no transcendentals.
  //
  // The gust is the grass shader's shape at the canopy's scale: two crossing
  // sines, the second at 2.33x so the field never repeats on a clean beat,
  // phased along the wind's own bearing so a gust TRAVELS rather than every
  // crown leaning at once.
  if (vertexInputs.color.r != 0.0) {
    // Subtracted, not added: a gust has to travel WITH the wind, and a wave
    // whose phase runs the other way rolls up the valley against the lean of
    // everything in it. The grass shader adds instead, and gets away with it
    // because its phase is not along the bearing at all — here it is.
    let phase = dot(worldPos.xz, uniforms.windDir) * uniforms.windParams.z;
    let gust = sin(uniforms.windTime * uniforms.windParams.y - phase)
      + 0.5 * sin(uniforms.windTime * uniforms.windParams.y * 2.33 - phase * 1.71);
    if (vertexInputs.color.r > 0.0) {
      // The RAMP: one lateral swing along the bearing, as much of it as the
      // height above the ground entitles this vertex to.
      // Two component writes rather than one swizzle write: WGSL allows an
      // assignment to a single component and forbids one to a multi-component
      // swizzle, so the GLSL "worldPos.xz +=" has to be spelled out.
      let lean =
        uniforms.windDir * (gust * uniforms.windParams.x * vertexInputs.color.r);
      worldPos.x += lean.x;
      worldPos.z += lean.y;
    } else {
      // The RIG (world/sway.ts): this vertex knows where it is on its own
      // frond, so the frond bends from its root and no two move as one.
      //
      // Which rigged layer: -1 a palm's frond, -2 an ash's bough — coherent
      // per draw like the branch above, the layer being in the merge key. A
      // bough packs one number more (\`boughRig\`): its bend is in u's whole
      // part with its leaf cluster's phase in the fraction, and v's whole
      // part is a SIGNED tilt across that cluster rather than a frond's edge.
      let bough = vertexInputs.color.r < -1.5;
      let bend = select(vertexInputs.uv.x, floor(vertexInputs.uv.x) / 1023.0, bough);
      let edge = select(floor(vertexInputs.uv.y) / 63.0,
        (floor(vertexInputs.uv.y) - 31.0) / 31.0, bough);
      let tau = fract(vertexInputs.uv.y) * 6.2831853;
      let rig = select(uniforms.windFrond, uniforms.windBough, bough);
      let rigRate = select(uniforms.windFrondRate, uniforms.windBoughRate, bough);
      // The same gust as the ramp's, read as PRESSURE: 0 in a lull, 1 at the
      // top of a gust, squared so a gust arrives rather than the wind simply
      // breathing. It only ever pushes downwind — nothing leans into a wind.
      let g = clamp(0.5 + gust / 3.0, 0.0, 1.0);
      let press = g * g;
      let t = uniforms.windTime;
      // Each frond on its own rate (+-15%) as well as its own phase, so a
      // crown's fronds drift in and out of step instead of nodding together.
      let rate = rigRate.y * (0.85 + 0.3 * fract(tau * 1.618));
      let flap = sin(t * rate + tau) + 0.35 * sin(t * rate * 2.17 + tau * 3.1);
      let swing = sin(t * rate * 0.61 + tau * 5.3);
      let stir = 0.45 + 0.55 * press;
      let down = rig.x * mix(rigRate.x, 1.0, press);
      let across = rig.z * swing * stir;
      let crosswind = vec2f(-uniforms.windDir.y, uniforms.windDir.x);
      let sway = (uniforms.windDir * down + crosswind * across) * bend;
      worldPos.x += sway.x;
      worldPos.z += sway.y;
      worldPos.y += rig.y * flap * stir * bend;
      if (bough) {
        // The LEAF: every cluster TIPS whole on its stalk — the same number
        // for all of its vertices, times how far across it each one sits
        // (\`edge\`, signed), so the displacement is linear across a cluster
        // and the cluster turns without changing shape. Each cluster on its
        // own phase and rate (+-25%), three incommensurate partials so no
        // beat repeats, and a slow SWELL of its own on top of the gust, so
        // the crown rustles in patches — some clusters busy, some nearly
        // still — and harder as a gust arrives. Tipped up and a little
        // downwind, so a cluster facing the wind turns out of its face too.
        // It fades out with distance (CONFIG.wind.bough's header): a
        // pixel-wide cluster crossing a band is a twinkle.
        let leafTau = fract(vertexInputs.uv.x) * 6.2831853;
        let lr = rigRate.z * (0.75 + 0.5 * fract(leafTau * 2.618));
        let wob = (sin(t * lr + leafTau)
          + 0.55 * sin(t * lr * 1.73 + leafTau * 2.3)
          + 0.3 * sin(t * lr * 2.91 + leafTau * 4.1)) / 1.85;
        let swell = 0.5 + 0.5 * sin(t * rigRate.w * (0.8 + 0.4 * fract(leafTau * 1.618)) + leafTau * 3.0);
        let near = 1.0 - smoothstep(uniforms.windBoughFade.x, uniforms.windBoughFade.y,
          distance(worldPos.xyz, uniforms.camPos));
        let rustle = rig.w * edge * wob * (0.15 + 0.85 * press) * (0.35 + 0.65 * swell) * near;
        worldPos.y += rustle;
        worldPos.x += uniforms.windDir.x * rustle * 0.5;
        worldPos.z += uniforms.windDir.y * rustle * 0.5;
      } else {
        // The pinnae: a ripple running along the frond on a short wave, so
        // the fringe flutters rather than shivers in unison — nothing at the
        // rib, most at a pinna's point, and more out along the frond than
        // near it.
        let ripple = sin(t * rigRate.z
          - dot(worldPos.xyz, vec3f(0.71, 0.45, 0.54)) * rigRate.w
          + tau * 7.0);
        worldPos.y += rig.w * edge * (0.3 + 0.7 * bend)
          * (0.35 + 0.65 * press) * ripple;
      }
    }
  }

  // WGSL has no mat4 -> mat3 conversion, so the upper-left block is taken by
  // hand; a matrix indexes by COLUMN, which is what makes that read correctly.
  let nW = normalize(
    mat3x3f(uniforms.world[0].xyz, uniforms.world[1].xyz, uniforms.world[2].xyz)
      * vertexInputs.normal);
  vertexOutputs.vNormalW = nW;

  vertexOutputs.vPosW = worldPos.xyz;
  vertexOutputs.vBaked = vertexInputs.color;
  #ifdef CEL_PALETTE
  vertexOutputs.vPalette = vertexInputs.uv2.x;
  #endif
  vertexOutputs.position = uniforms.viewProjection * worldPos;
}
`;
