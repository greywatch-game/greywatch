/**
 * wgsl/particles.ts — Every GPU particle field's update and draw as OUR renderer
 * runs them (`BABYLON_EXIT.md` X4.7c, X4.7d): the WHOLE modules Babylon 9.28
 * handed the device for `GPUParticleSystem`'s compute update and its render
 * effect, for the two feature sets the game's fields use, read off the parent's
 * device (`createShaderModule`; the ash's at 312dc44, the rotor wash's at
 * 9d5ab4a) and copied.
 * Owns: the ash's feature set — `PARTICLE_UPDATE_BOX` (the update: `BOXEMITTER`,
 * `BILLBOARD`, `EMITRATECTRL`), `PARTICLE_RENDER_VERTEX` and
 * `PARTICLE_RENDER_FRAGMENT` (the draw: `BILLBOARD`, `BILLBOARDMODE_ALL`,
 * `EMITRATECTRL`, `TONEMAPPING 0` — no image processing, no fog, no clip
 * plane), and `PARTICLE_STRIDE`, the floats one slot takes in its buffer; and
 * the rotor wash's — `PARTICLE_UPDATE_RING` (`CYLINDEREMITTER`, `BILLBOARD`,
 * `COLORGRADIENTS`, `SIZEGRADIENTS`, `VELOCITYGRADIENTS`, `EMITRATECTRL`),
 * `PARTICLE_RING_RENDER_VERTEX` (the draw's vertex stage, with `COLORGRADIENTS`
 * and `COLORGRADIENTS_COLOR2` as well; its fragment stage is the box's, Babylon
 * having compiled the same `main` for both) and `PARTICLE_RING_STRIDE`.
 * Invariants: every expression is Babylon's AS COMPILED, character for
 * character — a re-typed shader is a different rounding — and only how a
 * value ARRIVES changed: each update's bindings are Babylon's own (group
 * 0, bindings 0 to 4, `ComputeShaderParticleSystem.createUpdateBuffer`'s
 * mapping; the ring's group 1, its gradients' samplers and textures at 0/1 and
 * 4/5), and each draw's are ours, its group 0 (`render/particleProgram.ts`'
 * `PARTICLE_GROUP`, `PARTICLE_RING_GROUP`), with what Babylon fed it as vertex
 * ATTRIBUTES — a slot's position, age, life, size, angle and colour (the box)
 * or seed (the ring) off the particle buffer at its stride, a corner's offset
 * and uv off the sprite buffer at stride 16 (`_createVertexBuffers`) — PULLED
 * out of storage into the same private `vertexInputs`, the same floats;
 * `LeftOver` and `Internals` are Babylon's structs, field for field, so a value
 * is written where Babylon wrote it; the fragment keeps only what its `main`
 * reads (Babylon's module also declared `LeftOver`, `Internals` and the helper
 * functions every WGSL effect gets, none of which its `main` calls); the
 * clip-space y is flipped by `internals.yFactor_`, as Babylon's processor wrote
 * it, -1 into the frame's texture.
 * Never: imports Babylon (`src/render/` imports this, and the build gate walks
 * it); is assembled (`render/wgsl/assemble.ts`) — these are whole modules, not
 * shared bodies; changes an expression without the bank's `exact.mjs` and the
 * particle probe saying it moved nothing.
 * Contract: `docs/rendering.md`, "The particles".
 */

/** Floats in one slot of the motes' feature set (`_initialize`'s stride, its `alignDataInBuffer` padding in). */
export const PARTICLE_STRIDE = 24;

/** The update, as Babylon compiled `gpuUpdateParticles` for `BOXEMITTER BILLBOARD EMITRATECTRL`. */
export const PARTICLE_UPDATE_BOX = /* wgsl */ `
struct Particle {position : vec3<f32>,
age : f32,
size : vec3<f32>,
life : f32,
seed : vec4<f32>,
direction : vec3<f32>,
dummy0: f32,
color : vec4<f32>,
angle : vec2<f32>,
};
struct Particles {particles : array<Particle>,};
struct SimParams {currentCount : f32,
timeDelta : f32,
stopFactor : f32,
randomTextureSize: i32,
lifeTime : vec2<f32>,
emitPower : vec2<f32>,
emitIndex : f32,
emitCount : f32,
color1 : vec4<f32>,
color2 : vec4<f32>,
sizeRange : vec2<f32>,
scaleRange : vec4<f32>,
angleRange : vec4<f32>,
gravity : vec3<f32>,
emitterWM : mat4x4<f32>,
direction1 : vec3<f32>,
direction2 : vec3<f32>,
minEmitBox : vec3<f32>,
maxEmitBox : vec3<f32>,
};
@binding(0) @group(0) var<uniform> params : SimParams;
@binding(1) @group(0) var<storage,read> particlesIn : Particles;
@binding(2) @group(0) var<storage,read_write> particlesOut : Particles;
@binding(3) @group(0) var randomTexture : texture_2d<f32>;
@binding(4) @group(0) var randomTexture2 : texture_2d<f32>;
fn getRandomVec3(offset : f32,vertexID : f32)->vec3<f32> {return textureLoad(randomTexture2,vec2<i32>(i32(vertexID*offset/params.currentCount*f32(params.randomTextureSize)) % params.randomTextureSize,0),0).rgb;
}
fn getRandomVec4(offset : f32,vertexID : f32)->vec4<f32> {return textureLoad(randomTexture,vec2<i32>(i32(vertexID*offset/params.currentCount*f32(params.randomTextureSize)) % params.randomTextureSize,0),0);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {let index : u32=GlobalInvocationID.x;
let vertexID : f32=f32(index);
if (index>=u32(params.currentCount)) {return;
}
let PI : f32=3.14159;
let timeDelta : f32=params.timeDelta;
let newAge : f32=particlesIn.particles[index].age+timeDelta;
let life : f32=particlesIn.particles[index].life;
let seed : vec4<f32>=particlesIn.particles[index].seed;
let direction : vec3<f32>=particlesIn.particles[index].direction;
var offsetFromEmitIndex : f32=vertexID-params.emitIndex;
if (offsetFromEmitIndex<0.0) {offsetFromEmitIndex+=params.currentCount;
}
let shouldEmit : bool=offsetFromEmitIndex<params.emitCount && params.stopFactor != 0.;
if (shouldEmit) {var newPosition : vec3<f32>;
var newDirection : vec3<f32>;
let randoms : vec4<f32>=getRandomVec4(seed.x,vertexID);
let outLife : f32=params.lifeTime.x+(params.lifeTime.y-params.lifeTime.x)*randoms.r;
particlesOut.particles[index].life=outLife;
particlesOut.particles[index].age=0.0;
particlesOut.particles[index].seed=seed;
var sizex : f32;
sizex=params.sizeRange.x+(params.sizeRange.y-params.sizeRange.x)*randoms.g;
particlesOut.particles[index].size=vec3<f32>(
sizex,
params.scaleRange.x+(params.scaleRange.y-params.scaleRange.x)*randoms.b,
params.scaleRange.z+(params.scaleRange.w-params.scaleRange.z)*randoms.a);
particlesOut.particles[index].color=params.color1+(params.color2-params.color1)*randoms.b;
particlesOut.particles[index].angle=vec2<f32>(
params.angleRange.z+(params.angleRange.w-params.angleRange.z)*randoms.r,
params.angleRange.x+(params.angleRange.y-params.angleRange.x)*randoms.a);
let randoms2 : vec3<f32>=getRandomVec3(seed.y,vertexID);
let randoms3 : vec3<f32>=getRandomVec3(seed.z,vertexID);
newPosition=params.minEmitBox+(params.maxEmitBox-params.minEmitBox)*randoms2;
newDirection=params.direction1+(params.direction2-params.direction1)*randoms3;
let power : f32=params.emitPower.x+(params.emitPower.y-params.emitPower.x)*randoms.a;
particlesOut.particles[index].position=(params.emitterWM*vec4<f32>(newPosition,1.)).xyz;
let initial : vec3<f32>=(params.emitterWM*vec4<f32>(newDirection,0.)).xyz;
particlesOut.particles[index].direction=initial*power;
} else {var directionScale : f32=timeDelta;
particlesOut.particles[index].age=newAge;
let ageGradient : f32=newAge/life;
let position : vec3<f32>=particlesIn.particles[index].position;
particlesOut.particles[index].position=position+direction*directionScale;
particlesOut.particles[index].life=life;
particlesOut.particles[index].seed=seed;
particlesOut.particles[index].color=particlesIn.particles[index].color;
particlesOut.particles[index].size=particlesIn.particles[index].size;
var updatedDirection : vec3<f32>=direction+params.gravity*timeDelta;
particlesOut.particles[index].direction=updatedDirection;
let angle : vec2<f32>=particlesIn.particles[index].angle;
particlesOut.particles[index].angle=vec2<f32>(angle.x+angle.y*timeDelta,angle.y);
}}
`;

/**
 * The draw's vertex stage, as Babylon compiled `gpuRenderParticles` for
 * `BILLBOARD BILLBOARDMODE_ALL EMITRATECTRL`: one instance a slot, a triangle
 * strip of four corners. `main`'s first lines are the attribute fetch Babylon's
 * vertex buffers made (the header); from `let shouldCullParticle` on it is
 * Babylon's.
 */
export const PARTICLE_RENDER_VERTEX = /* wgsl */ `
struct VertexInputs {
  vertexIndex : u32,
  instanceIndex : u32,
position : vec3f,
age : f32,
life : f32,
size : vec3f,
angle : f32,
offset : vec2f,
uv : vec2f,
color : vec4f,
};
var<private> vertexInputs : VertexInputs;
struct FragmentInputs {
  @builtin(position) position : vec4<f32>,
  @location(0) @interpolate(perspective, center) vUV : vec2f,
  @location(1) @interpolate(perspective, center) vColor : vec4f,
  @location(2) @interpolate(perspective, center) vPositionW : vec3f,
};
var<private> vertexOutputs : FragmentInputs;

struct LeftOver {
  view : mat4x4f,
  projection : mat4x4f,
  translationPivot : vec2f,
  worldOffset : vec3f,
  invView : mat4x4f,
  colorDead : vec4f,
  eyePosition : vec3f,
};
@group(0) @binding(0) var<uniform> uniforms : LeftOver;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(0) @binding(1) var<uniform> internals : Internals;
@group(0) @binding(2) var<storage, read> particleData : array<f32>;
@group(0) @binding(3) var<storage, read> spriteData : array<f32>;

fn particleBasePosition()->vec3f {
return vertexInputs.position+uniforms.worldOffset;
}
fn rotate(yaxis: vec3f,rotatedCorner: vec3f)->vec3f {let xaxis: vec3f=normalize(cross(vec3f(0.0,1.0,0.0),yaxis));
let zaxis: vec3f=normalize(cross(yaxis,xaxis));
let rotMatrix: mat3x3f=mat3x3f(xaxis,yaxis,zaxis);
return particleBasePosition()+rotMatrix*rotatedCorner;
}
@vertex
fn main(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32)->FragmentInputs {
  let p = instanceIndex * ${PARTICLE_STRIDE}u;
  let s = vertexIndex * 4u;
  vertexInputs.vertexIndex = vertexIndex;
  vertexInputs.instanceIndex = instanceIndex;
  vertexInputs.position = vec3f(particleData[p], particleData[p + 1u], particleData[p + 2u]);
  vertexInputs.age = particleData[p + 3u];
  vertexInputs.size = vec3f(particleData[p + 4u], particleData[p + 5u], particleData[p + 6u]);
  vertexInputs.life = particleData[p + 7u];
  vertexInputs.color = vec4f(particleData[p + 16u], particleData[p + 17u], particleData[p + 18u], particleData[p + 19u]);
  vertexInputs.angle = particleData[p + 20u];
  vertexInputs.offset = vec2f(spriteData[s], spriteData[s + 1u]);
  vertexInputs.uv = vec2f(spriteData[s + 2u], spriteData[s + 3u]);

let shouldCullParticle: bool=vertexInputs.life>0.0 && vertexInputs.age>=vertexInputs.life;
vertexOutputs.vUV=vertexInputs.uv;
let ratio: f32=min(1.0,vertexInputs.age/vertexInputs.life);
vertexOutputs.vColor=vertexInputs.color*vec4f(1.0-ratio)+uniforms.colorDead*vec4f(ratio);
let cornerPos: vec2f=(vertexInputs.offset-uniforms.translationPivot)*vertexInputs.size.yz*vertexInputs.size.x;
var rotatedCorner: vec4f;
rotatedCorner.w=0.0;
rotatedCorner.x=cornerPos.x*cos(vertexInputs.angle)-cornerPos.y*sin(vertexInputs.angle);
rotatedCorner.y=cornerPos.x*sin(vertexInputs.angle)+cornerPos.y*cos(vertexInputs.angle);
rotatedCorner.z=0.0;
rotatedCorner.x+=uniforms.translationPivot.x;
rotatedCorner.y+=uniforms.translationPivot.y;
let viewPosition: vec4f=uniforms.view*vec4f(particleBasePosition(),1.0)+rotatedCorner;
vertexOutputs.vPositionW=(uniforms.invView*viewPosition).xyz;
vertexOutputs.position=uniforms.projection*viewPosition;
if (shouldCullParticle) {vertexOutputs.position=vec4f(0.0,0.0,2.0,1.0);
vertexOutputs.vColor=vec4f(0.0);
vertexOutputs.vUV=vec2f(0.0);
vertexOutputs.vPositionW=vec3f(0.0);
}
  vertexOutputs.position.y = vertexOutputs.position.y * internals.yFactor_;
  return vertexOutputs;
}
`;

/** The draw's pixel, as Babylon compiled it for the same defines: the texture times the slot's colour. */
export const PARTICLE_RENDER_FRAGMENT = /* wgsl */ `
struct FragmentInputs {
  @builtin(position) position : vec4<f32>,
  @builtin(front_facing) frontFacing : bool,
  @location(0) @interpolate(perspective, center) vUV : vec2f,
  @location(1) @interpolate(perspective, center) vColor : vec4f,
  @location(2) @interpolate(perspective, center) vPositionW : vec3f,
};
var<private> fragmentInputs : FragmentInputs;
struct FragmentOutputs {
  @location(0) color : vec4<f32>,
};
var<private> fragmentOutputs : FragmentOutputs;
@group(0) @binding(4) var diffuseSamplerSampler: sampler;
@group(0) @binding(5) var diffuseSampler: texture_2d<f32>;
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {  fragmentInputs = input;

let textureColor: vec4f=textureSample(diffuseSampler,diffuseSamplerSampler,input.vUV);
var baseColor: vec4f=textureColor*input.vColor;
fragmentOutputs.color=baseColor;
  return fragmentOutputs;
}
`;

/** Floats in one slot of the rotor wash's feature set: 21, the padding float, less the colour's 4 (a gradient carries it), rounded to 4. */
export const PARTICLE_RING_STRIDE = 20;

/**
 * The rotor wash's update (X4.7d), as Babylon compiled `gpuUpdateParticles` for
 * `CYLINDEREMITTER BILLBOARD COLORGRADIENTS SIZEGRADIENTS VELOCITYGRADIENTS
 * EMITRATECTRL`, read off the parent's device (9d5ab4a) and copied verbatim, its
 * bindings included (group 0 as the box's; group 1 the size and velocity
 * gradients, each a non-filtering sampler and an unfilterable float texture).
 */
export const PARTICLE_UPDATE_RING = /* wgsl */ `
struct Particle {position : vec3<f32>,
age : f32,
size : vec3<f32>,
life : f32,
seed : vec4<f32>,
direction : vec3<f32>,
dummy0: f32,
angle : vec2<f32>,
};
struct Particles {particles : array<Particle>,};
struct SimParams {currentCount : f32,
timeDelta : f32,
stopFactor : f32,
randomTextureSize: i32,
lifeTime : vec2<f32>,
emitPower : vec2<f32>,
emitIndex : f32,
emitCount : f32,
sizeRange : vec2<f32>,
scaleRange : vec4<f32>,
angleRange : vec4<f32>,
gravity : vec3<f32>,
emitterWM : mat4x4<f32>,
radius : f32,
height : f32,
radiusRange : f32,
directionRandomizer : f32,
};
@binding(0) @group(0) var<uniform> params : SimParams;
@binding(1) @group(0) var<storage,read> particlesIn : Particles;
@binding(2) @group(0) var<storage,read_write> particlesOut : Particles;
@binding(3) @group(0) var randomTexture : texture_2d<f32>;
@binding(4) @group(0) var randomTexture2 : texture_2d<f32>;
@binding(0) @group(1) var sizeGradientSampler : sampler;
@binding(1) @group(1) var sizeGradientTexture : texture_2d<f32>;
@binding(4) @group(1) var velocityGradientSampler : sampler;
@binding(5) @group(1) var velocityGradientTexture : texture_2d<f32>;
fn getRandomVec3(offset : f32,vertexID : f32)->vec3<f32> {return textureLoad(randomTexture2,vec2<i32>(i32(vertexID*offset/params.currentCount*f32(params.randomTextureSize)) % params.randomTextureSize,0),0).rgb;
}
fn getRandomVec4(offset : f32,vertexID : f32)->vec4<f32> {return textureLoad(randomTexture,vec2<i32>(i32(vertexID*offset/params.currentCount*f32(params.randomTextureSize)) % params.randomTextureSize,0),0);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {let index : u32=GlobalInvocationID.x;
let vertexID : f32=f32(index);
if (index>=u32(params.currentCount)) {return;
}
let PI : f32=3.14159;
let timeDelta : f32=params.timeDelta;
let newAge : f32=particlesIn.particles[index].age+timeDelta;
let life : f32=particlesIn.particles[index].life;
let seed : vec4<f32>=particlesIn.particles[index].seed;
let direction : vec3<f32>=particlesIn.particles[index].direction;
var offsetFromEmitIndex : f32=vertexID-params.emitIndex;
if (offsetFromEmitIndex<0.0) {offsetFromEmitIndex+=params.currentCount;
}
let shouldEmit : bool=offsetFromEmitIndex<params.emitCount && params.stopFactor != 0.;
if (shouldEmit) {var newPosition : vec3<f32>;
var newDirection : vec3<f32>;
let randoms : vec4<f32>=getRandomVec4(seed.x,vertexID);
let outLife : f32=params.lifeTime.x+(params.lifeTime.y-params.lifeTime.x)*randoms.r;
particlesOut.particles[index].life=outLife;
particlesOut.particles[index].age=0.0;
particlesOut.particles[index].seed=seed;
var sizex : f32;
let sizeGradientRange=textureSampleLevel(sizeGradientTexture,sizeGradientSampler,vec2<f32>(0.,0.),0.).rg;
sizex=sizeGradientRange.x+(sizeGradientRange.y-sizeGradientRange.x)*seed.y;
particlesOut.particles[index].size=vec3<f32>(
sizex,
params.scaleRange.x+(params.scaleRange.y-params.scaleRange.x)*randoms.b,
params.scaleRange.z+(params.scaleRange.w-params.scaleRange.z)*randoms.a);
particlesOut.particles[index].angle=vec2<f32>(
params.angleRange.z+(params.angleRange.w-params.angleRange.z)*randoms.r,
params.angleRange.x+(params.angleRange.y-params.angleRange.x)*randoms.a);
let randoms2 : vec3<f32>=getRandomVec3(seed.y,vertexID);
let randoms3 : vec3<f32>=getRandomVec3(seed.z,vertexID);
let yPos : f32=(-0.5+randoms2.x)*params.height;
var angle : f32=randoms2.y*PI*2.;
let inverseRadiusRangeSquared : f32=(1.-params.radiusRange)*(1.-params.radiusRange);
let positionRadius : f32=params.radius*sqrt(inverseRadiusRangeSquared+randoms2.z*(1.-inverseRadiusRangeSquared));
let xPos : f32=positionRadius*cos(angle);
let zPos : f32=positionRadius*sin(angle);
newPosition=vec3<f32>(xPos,yPos,zPos);
angle=angle+(-0.5+randoms3.x)*PI*params.directionRandomizer;
newDirection=vec3<f32>(cos(angle),(-0.5+randoms3.y)*params.directionRandomizer,sin(angle));
newDirection=normalize(newDirection);
let power : f32=params.emitPower.x+(params.emitPower.y-params.emitPower.x)*randoms.a;
particlesOut.particles[index].position=(params.emitterWM*vec4<f32>(newPosition,1.)).xyz;
let initial : vec3<f32>=(params.emitterWM*vec4<f32>(newDirection,0.)).xyz;
particlesOut.particles[index].direction=initial*power;
} else {var directionScale : f32=timeDelta;
particlesOut.particles[index].age=newAge;
let ageGradient : f32=newAge/life;
let velocityGradientRange=textureSampleLevel(velocityGradientTexture,velocityGradientSampler,vec2<f32>(ageGradient,0.),0.).rg;
directionScale=directionScale*(velocityGradientRange.x+(velocityGradientRange.y-velocityGradientRange.x)*seed.w);
let position : vec3<f32>=particlesIn.particles[index].position;
particlesOut.particles[index].position=position+direction*directionScale;
particlesOut.particles[index].life=life;
particlesOut.particles[index].seed=seed;
let sizeGradientRange=textureSampleLevel(sizeGradientTexture,sizeGradientSampler,vec2<f32>(ageGradient,0.),0.).rg;
particlesOut.particles[index].size=vec3<f32>(
sizeGradientRange.x+(sizeGradientRange.y-sizeGradientRange.x)*seed.y,
particlesIn.particles[index].size.yz);
var updatedDirection : vec3<f32>=direction+params.gravity*timeDelta;
particlesOut.particles[index].direction=updatedDirection;
let angle : vec2<f32>=particlesIn.particles[index].angle;
particlesOut.particles[index].angle=vec2<f32>(angle.x+angle.y*timeDelta,angle.y);
}}
`;

/**
 * The rotor wash's draw (X4.7d), as Babylon compiled `gpuRenderParticles` for
 * `BILLBOARD BILLBOARDMODE_ALL COLORGRADIENTS COLORGRADIENTS_COLOR2
 * EMITRATECTRL`: the box's draw but for the colour, which is the two rows of the
 * gradient texture sampled at the slot's age and mixed by its seed, and the
 * `LeftOver` block, which holds no `colorDead`. `main`'s first lines pull the
 * attributes Babylon's vertex buffers fed it — a slot's position, age, size,
 * life, SEED and angle at stride 80 bytes (the angle at float 16), a corner's
 * offset and uv at 16 — and from `let shouldCullParticle` on it is Babylon's,
 * as are the two functions above it. The fragment stage is the box's
 * (`PARTICLE_RENDER_FRAGMENT`): Babylon compiled the same `main` for both.
 */
export const PARTICLE_RING_RENDER_VERTEX = /* wgsl */ `
struct VertexInputs {
  vertexIndex : u32,
  instanceIndex : u32,
position : vec3f,
age : f32,
life : f32,
size : vec3f,
angle : f32,
offset : vec2f,
uv : vec2f,
seed : vec4f,
};
var<private> vertexInputs : VertexInputs;
struct FragmentInputs {
  @builtin(position) position : vec4<f32>,
  @location(0) @interpolate(perspective, center) vUV : vec2f,
  @location(1) @interpolate(perspective, center) vColor : vec4f,
  @location(2) @interpolate(perspective, center) vPositionW : vec3f,
};
var<private> vertexOutputs : FragmentInputs;

struct LeftOver {
  view : mat4x4f,
  projection : mat4x4f,
  translationPivot : vec2f,
  worldOffset : vec3f,
  invView : mat4x4f,
  eyePosition : vec3f,
};
@group(0) @binding(0) var<uniform> uniforms : LeftOver;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(0) @binding(1) var<uniform> internals : Internals;
@group(0) @binding(2) var<storage, read> particleData : array<f32>;
@group(0) @binding(3) var<storage, read> spriteData : array<f32>;
@group(0) @binding(6) var colorGradientSamplerSampler: sampler;
@group(0) @binding(7) var colorGradientSampler: texture_2d<f32>;

fn particleBasePosition()->vec3f {
return vertexInputs.position+uniforms.worldOffset;
}
fn rotate(yaxis: vec3f,rotatedCorner: vec3f)->vec3f {let xaxis: vec3f=normalize(cross(vec3f(0.0,1.0,0.0),yaxis));
let zaxis: vec3f=normalize(cross(yaxis,xaxis));
let rotMatrix: mat3x3f=mat3x3f(xaxis,yaxis,zaxis);
return particleBasePosition()+rotMatrix*rotatedCorner;
}
@vertex
fn main(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32)->FragmentInputs {
  let p = instanceIndex * ${PARTICLE_RING_STRIDE}u;
  let s = vertexIndex * 4u;
  vertexInputs.vertexIndex = vertexIndex;
  vertexInputs.instanceIndex = instanceIndex;
  vertexInputs.position = vec3f(particleData[p], particleData[p + 1u], particleData[p + 2u]);
  vertexInputs.age = particleData[p + 3u];
  vertexInputs.size = vec3f(particleData[p + 4u], particleData[p + 5u], particleData[p + 6u]);
  vertexInputs.life = particleData[p + 7u];
  vertexInputs.seed = vec4f(particleData[p + 8u], particleData[p + 9u], particleData[p + 10u], particleData[p + 11u]);
  vertexInputs.angle = particleData[p + 16u];
  vertexInputs.offset = vec2f(spriteData[s], spriteData[s + 1u]);
  vertexInputs.uv = vec2f(spriteData[s + 2u], spriteData[s + 3u]);

let shouldCullParticle: bool=vertexInputs.life>0.0 && vertexInputs.age>=vertexInputs.life;
vertexOutputs.vUV=vertexInputs.uv;
let ratio: f32=min(1.0,vertexInputs.age/vertexInputs.life);
let vColor1: vec4f=textureSampleLevel(colorGradientSampler,colorGradientSamplerSampler,vec2f(ratio,0.25),0.0);
let vColor2: vec4f=textureSampleLevel(colorGradientSampler,colorGradientSamplerSampler,vec2f(ratio,0.75),0.0);
vertexOutputs.vColor=mix(vColor1,vColor2,vertexInputs.seed.x);
let cornerPos: vec2f=(vertexInputs.offset-uniforms.translationPivot)*vertexInputs.size.yz*vertexInputs.size.x;
var rotatedCorner: vec4f;
rotatedCorner.w=0.0;
rotatedCorner.x=cornerPos.x*cos(vertexInputs.angle)-cornerPos.y*sin(vertexInputs.angle);
rotatedCorner.y=cornerPos.x*sin(vertexInputs.angle)+cornerPos.y*cos(vertexInputs.angle);
rotatedCorner.z=0.0;
rotatedCorner.x+=uniforms.translationPivot.x;
rotatedCorner.y+=uniforms.translationPivot.y;
let viewPosition: vec4f=uniforms.view*vec4f(particleBasePosition(),1.0)+rotatedCorner;
vertexOutputs.vPositionW=(uniforms.invView*viewPosition).xyz;
vertexOutputs.position=uniforms.projection*viewPosition;
if (shouldCullParticle) {vertexOutputs.position=vec4f(0.0,0.0,2.0,1.0);
vertexOutputs.vColor=vec4f(0.0);
vertexOutputs.vUV=vec2f(0.0);
vertexOutputs.vPositionW=vec3f(0.0);
}
  vertexOutputs.position.y = vertexOutputs.position.y * internals.yFactor_;
  return vertexOutputs;
}
`;
