// src/shaders.js — AAA GLSL 300 es Pipeline: Dynamic Atmospheres, Auroras, Gerstner Ocean, Multi-Biome Terrain & PBR
(function (AF) {
  'use strict';

  const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2((gl_VertexID & 1) << 2, (gl_VertexID & 2) << 1) - 1.0;
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.9999, 1.0);
}`;

  const ENV_COMMON = `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm2D(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise2D(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}

vec3 evalAurora(vec3 dir, float time, float auroraStr) {
  if (auroraStr < 0.02 || dir.y < 0.02) return vec3(0.0);
  vec2 uv = dir.xz / (dir.y + 0.28);
  float curtain1 = sin(uv.x * 2.6 + fbm2D(uv * 1.4 + vec2(time * 0.04, 0.0)) * 4.5 + time * 0.25);
  float curtain2 = sin(uv.x * 4.1 - fbm2D(uv * 2.1 - vec2(0.0, time * 0.03)) * 3.8 - time * 0.18);
  float band = pow(max(0.0, 1.0 - abs(curtain1) * 1.3), 2.5) * 0.7 + pow(max(0.0, 1.0 - abs(curtain2) * 1.4), 3.0) * 0.5;
  float heightFade = smoothstep(0.04, 0.24, dir.y) * smoothstep(0.92, 0.35, dir.y);
  vec3 col = mix(vec3(0.10, 0.95, 0.68), vec3(0.45, 0.38, 0.98), clamp(uv.y * 0.4 + 0.5, 0.0, 1.0));
  return col * band * heightFade * auroraStr * 0.95;
}

vec3 evalAtmosphere(vec3 dir, vec3 sunDir, vec3 zenithCol, vec3 midCol, vec3 horizCol,
                    float time, float intensity, float auroraStr, float lightning, out float sunDiscMask) {
  float y = clamp(dir.y, -1.0, 1.0);
  float sunDot = max(dot(dir, sunDir), 0.0);

  vec3 zc = mix(zenithCol, vec3(0.14, 0.06, 0.24), intensity * 0.35);
  vec3 mc = mix(midCol,    vec3(0.32, 0.18, 0.42), intensity * 0.30);
  vec3 hc = mix(horizCol,  vec3(0.95, 0.48, 0.38), intensity * 0.25);
  vec3 deepBelow = zenithCol * 0.5 + vec3(0.02, 0.06, 0.14);

  vec3 sky;
  if (y >= 0.0) {
    sky = mix(hc, mc, smoothstep(0.0, 0.24, y));
    sky = mix(sky, zc, smoothstep(0.18, 0.78, y));
  } else {
    sky = mix(hc * 0.75, deepBelow, smoothstep(0.0, -0.35, y));
  }

  // Stars visible during aurora / twilight
  if (auroraStr > 0.15 && dir.y > 0.05) {
    vec2 starCell = floor(dir.xz / (dir.y + 0.42) * 190.0);
    float st = hash21(starCell);
    if (st > 0.990) {
      float tw = 0.55 + 0.45 * sin(time * 2.6 + st * 90.0);
      sky += vec3(0.85, 0.92, 1.0) * smoothstep(0.05, 0.45, dir.y) * tw * auroraStr * 0.95;
    }
  }

  // Dancing Northern Aurora Curtains
  sky += evalAurora(dir, time, auroraStr);

  // Mie scattering & sun/moon disc
  vec3 scatterTint = mix(vec3(1.0, 0.68, 0.38), vec3(0.55, 0.75, 1.0), auroraStr * 0.8);
  sky += scatterTint * pow(sunDot, 6.0) * (0.36 - auroraStr * 0.16);
  sky += mix(vec3(1.0, 0.86, 0.64), vec3(0.75, 0.90, 1.0), auroraStr) * pow(sunDot, 42.0) * 0.52;
  sunDiscMask = smoothstep(0.9982, 0.9994, sunDot);
  sky += mix(vec3(2.4, 2.0, 1.55), vec3(1.3, 1.45, 1.7), auroraStr) * sunDiscMask;

  // Volumetric-style Cumulus Clouds lit by sun + storm lightning
  if (dir.y > 0.008) {
    vec2 cuv = dir.xz / (dir.y + 0.16) * 0.75 + vec2(time * 0.008, time * 0.003);
    float c1 = fbm2D(cuv * 1.25);
    float c2 = fbm2D(cuv * 2.8 - vec2(time * 0.012, 0.0));
    float dens = smoothstep(0.45, 0.78, c1 * 0.72 + c2 * 0.28);
    float mask = dens * smoothstep(0.008, 0.14, dir.y) * smoothstep(0.92, 0.22, dir.y);
    vec3 cloudDark = mix(vec3(0.32, 0.35, 0.48), vec3(0.08, 0.10, 0.18), max(auroraStr, 0.35 * (1.0 - hc.r)));
    vec3 cloudBright = mix(hc * 1.12, vec3(0.72, 0.85, 1.05), lightning * 0.85);
    vec3 cloudCol = mix(cloudDark, cloudBright, smoothstep(0.35, 0.78, c1) * (0.35 + 0.65 * pow(sunDot, 1.5)) + lightning * 0.75);
    sky = mix(sky, cloudCol, mask * 0.78);
  }
  return sky;
}`;

  const SKY_FS = `#version 300 es
precision highp float;

in vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uZenithCol;
uniform vec3 uMidCol;
uniform vec3 uHorizCol;
uniform float uTime;
uniform float uIntensity;
uniform float uAuroraStr;
uniform float uLightning;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragGlow;

${ENV_COMMON}

void main() {
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 wp = uInvViewProj * ndc;
  vec3 dir = normalize(wp.xyz / wp.w - uCamPos);
  vec3 sunDir = normalize(uSunDir);

  float sunDisc = 0.0;
  vec3 sky = evalAtmosphere(dir, sunDir, uZenithCol, uMidCol, uHorizCol, uTime, uIntensity, uAuroraStr, uLightning, sunDisc);
  float sunDot = max(dot(dir, sunDir), 0.0);

  fragColor = vec4(sky, 1.0);
  vec3 auroraGlow = evalAurora(dir, uTime, uAuroraStr) * 0.45;
  fragGlow = vec4(vec3(1.0, 0.78, 0.50) * (sunDisc * 1.1 + pow(sunDot, 36.0) * 0.16) + auroraGlow, 1.0);
}`;

  const SHADOW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() {
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
}`;

  const SHADOW_INST_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 4) in vec4 aInst0;
layout(location = 5) in vec4 aInst1;
layout(location = 6) in vec4 aInst2;
layout(location = 7) in vec4 aInst3;
uniform mat4 uLightVP;
void main() {
  mat4 model = mat4(aInst0, aInst1, aInst2, aInst3);
  gl_Position = uLightVP * model * vec4(aPos, 1.0);
}`;

  const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}`;

  const OCEAN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec4 aMat; // x = seabedY

uniform mat4 uViewProj;
uniform mat4 uLightVP;
uniform float uTime;
uniform float uWaveScale;

out vec3 vWorldPos;
out vec3 vNormal;
out float vSeabedY;
out vec4 vShadowPos;

vec3 gerstner(vec2 pos, vec2 dir, float steep, float wl, float t, inout vec3 tangent, inout vec3 binormal) {
  float k = 6.2831853 / wl;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(dir);
  float f = k * (dot(d, pos) - c * t);
  float a = steep / k;

  tangent += vec3(-d.x * d.x * (steep * sin(f)), d.x * (steep * cos(f)), -d.x * d.y * (steep * sin(f)));
  binormal += vec3(-d.x * d.y * (steep * sin(f)), d.y * (steep * cos(f)), -d.y * d.y * (steep * sin(f)));
  return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));
}

void main() {
  float rawDepth = max(0.0, -aMat.x);
  float ampScale = smoothstep(0.0, 3.2, rawDepth) * uWaveScale;

  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  vec2 xz = aPos.xz;

  disp += gerstner(xz, vec2(1.0, 0.35),   0.14 * ampScale, 26.0, uTime * 1.15, tangent, binormal);
  disp += gerstner(xz, vec2(0.45, -0.88), 0.11 * ampScale, 17.0, uTime * 1.30, tangent, binormal);
  disp += gerstner(xz, vec2(-0.75, 0.62), 0.08 * ampScale, 10.5, uTime * 1.45, tangent, binormal);
  disp += gerstner(xz, vec2(0.22, 0.96),  0.06 * ampScale, 6.2,  uTime * 1.65, tangent, binormal);

  vec3 wp = vec3(aPos.x + disp.x, disp.y, aPos.z + disp.z);
  vWorldPos = wp;
  vNormal = normalize(cross(binormal, tangent));
  vSeabedY = aMat.x;
  vShadowPos = uLightVP * vec4(wp, 1.0);
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

  const OCEAN_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in float vSeabedY;
in vec4 vShadowPos;

uniform mat4 uLightVP;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uZenithCol;
uniform vec3 uMidCol;
uniform vec3 uHorizCol;
uniform float uTime;
uniform float uUseShadows;
uniform float uIntensity;
uniform float uAuroraStr;
uniform float uLightning;
uniform float uBioFoam;
uniform sampler2D uShadowMap;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragGlow;

${ENV_COMMON}

float sampleOceanShadow(vec3 worldPos, vec3 l) {
  if (uUseShadows < 0.5) return 1.0;
  vec4 sp = uLightVP * vec4(worldPos + vec3(0.0, 0.18, 0.0), 1.0);
  vec3 proj = sp.xyz / sp.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x <= 0.0 || proj.x >= 1.0 || proj.y <= 0.0 || proj.y >= 1.0 || proj.z > 0.995) return 1.0;
  float edgeFade = smoothstep(0.0, 0.10, proj.x) * smoothstep(1.0, 0.90, proj.x)
                 * smoothstep(0.0, 0.10, proj.y) * smoothstep(1.0, 0.90, proj.y);
  float bias = 0.0022;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += (proj.z - bias > texture(uShadowMap, proj.xy + vec2(float(x), float(y)) * texel).r) ? 0.0 : 1.0;
    }
  }
  return mix(1.0, s / 9.0, edgeFade);
}

vec3 waterRippleNormal(vec2 p, float t) {
  float e = 0.18;
  float h0 = noise2D(p * 0.42 + vec2(t * 0.65, -t * 0.45)) * 0.55
           + noise2D(p * 1.15 - vec2(t * 0.85, t * 0.52)) * 0.30
           + noise2D(p * 2.8 + vec2(t * 1.1, t * 0.9)) * 0.15;
  float hx = noise2D((p + vec2(e, 0.0)) * 0.42 + vec2(t * 0.65, -t * 0.45)) * 0.55
           + noise2D((p + vec2(e, 0.0)) * 1.15 - vec2(t * 0.85, t * 0.52)) * 0.30
           + noise2D((p + vec2(e, 0.0)) * 2.8 + vec2(t * 1.1, t * 0.9)) * 0.15;
  float hz = noise2D((p + vec2(0.0, e)) * 0.42 + vec2(t * 0.65, -t * 0.45)) * 0.55
           + noise2D((p + vec2(0.0, e)) * 1.15 - vec2(t * 0.85, t * 0.52)) * 0.30
           + noise2D((p + vec2(0.0, e)) * 2.8 + vec2(t * 1.1, t * 0.9)) * 0.15;
  return normalize(vec3(-(hx - h0) / e * 0.24, 1.0, -(hz - h0) / e * 0.24));
}

void main() {
  float waterDepth = vWorldPos.y - vSeabedY;
  if (waterDepth < -0.15) discard;

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uSunDir);
  float dist = length(uCamPos - vWorldPos);

  float rippleFade = exp(-dist * 0.0045);
  vec3 rNorm = waterRippleNormal(vWorldPos.xz, uTime);
  vec3 N = normalize(vNormal + vec3(rNorm.x, 0.0, rNorm.z) * 0.85 * rippleFade);

  float NdotV = max(dot(N, V), 0.001);
  float shadow = sampleOceanShadow(vWorldPos, L);

  float fresnel = 0.025 + 0.975 * pow(1.0 - NdotV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.015);
  float sunReflDisc = 0.0;
  vec3 skyRefl = evalAtmosphere(R, L, uZenithCol, uMidCol, uHorizCol, uTime, uIntensity, uAuroraStr, uLightning, sunReflDisc);

  vec3 shallowSand = mix(vec3(0.56, 0.62, 0.48), vec3(0.18, 0.36, 0.42), uAuroraStr * 0.75);
  vec3 turquoise   = mix(vec3(0.05, 0.42, 0.49), vec3(0.03, 0.24, 0.34), uAuroraStr * 0.70);
  vec3 deepOcean   = mix(vec3(0.02, 0.11, 0.22), vec3(0.01, 0.04, 0.11), uAuroraStr * 0.75);
  float dNorm = clamp(waterDepth / 8.5, 0.0, 1.0);
  vec3 waterBody = mix(shallowSand, turquoise, smoothstep(0.0, 0.28, dNorm));
  waterBody = mix(waterBody, deepOcean, smoothstep(0.18, 0.95, dNorm));

  float sss = pow(max(dot(V, -L + N * 0.6), 0.0), 3.0) * max(N.y, 0.0);
  waterBody += vec3(0.06, 0.45, 0.48) * sss * shadow * 0.55;

  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float specTight = pow(NdotH, 420.0) * 3.8;
  float specBroad = pow(NdotH, 48.0) * 0.35;
  vec3 sunGlint = uSunColor * (specTight + specBroad) * shadow;

  vec3 col = mix(waterBody * (0.45 + 0.55 * shadow), skyRefl, clamp(fresnel * 1.15, 0.05, 0.95)) + sunGlint;

  // Animated organic shoreline foam + bioluminescent surf glow during Aurora Twilight!
  float foamNoise = fbm2D(vWorldPos.xz * 0.38 + vec2(uTime * 0.22, -uTime * 0.16));
  float shoreBand = 1.0 - smoothstep(0.0, 1.45, waterDepth);
  float waveLap = sin(waterDepth * 6.5 - uTime * 2.6 + foamNoise * 4.0) * 0.5 + 0.5;
  float foamMask = clamp(shoreBand * (0.55 + 0.65 * waveLap) * smoothstep(0.28, 0.68, foamNoise + shoreBand * 0.35), 0.0, 1.0);
  vec3 normalFoam = vec3(0.92, 0.95, 0.98) * (0.55 + 0.45 * shadow);
  vec3 bioColor = vec3(0.18, 0.88, 1.0) * (1.2 + 0.3 * sin(uTime * 3.0 + foamNoise * 6.0));
  vec3 foamCol = mix(normalFoam, bioColor, uBioFoam * 0.78);
  col = mix(col, foamCol, foamMask * 0.85);

  float edgeAlpha = smoothstep(-0.08, 0.28, waterDepth);
  float fog = clamp(1.0 - exp(-pow(max(dist - 110.0, 0.0) * 0.0018, 1.25)), 0.0, 0.96);
  col = mix(col, uFogColor, fog);

  vec3 glow = (sunGlint * 0.22 + bioColor * foamMask * uBioFoam * 0.7) * (1.0 - fog);
  fragColor = vec4(col, edgeAlpha);
  fragGlow = vec4(glow, edgeAlpha);
}`;

  const LIT_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec4 aMat;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uNormalMat;
uniform mat4 uLightVP;

out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vColor;
out vec4 vMat;
out vec4 vShadowPos;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize((uNormalMat * vec4(aNormal, 0.0)).xyz);
  vColor = aColor;
  vMat = aMat;
  vShadowPos = uLightVP * wp;
  gl_Position = uViewProj * wp;
}`;

  const LIT_INST_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec4 aMat;
layout(location = 4) in vec4 aInst0;
layout(location = 5) in vec4 aInst1;
layout(location = 6) in vec4 aInst2;
layout(location = 7) in vec4 aInst3;
layout(location = 8) in vec4 aInstTint;
layout(location = 9) in vec4 aInstExtra;

uniform mat4 uViewProj;
uniform mat4 uLightVP;

out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vColor;
out vec4 vMat;
out vec4 vShadowPos;
out vec4 vInstTint;
out vec4 vInstExtra;

void main() {
  mat4 model = mat4(aInst0, aInst1, aInst2, aInst3);
  vec4 wp = model * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  mat3 m3 = mat3(model);
  vec3 invScaleSq = vec3(
    1.0 / max(dot(m3[0], m3[0]), 1e-5),
    1.0 / max(dot(m3[1], m3[1]), 1e-5),
    1.0 / max(dot(m3[2], m3[2]), 1e-5)
  );
  vNormal = normalize(m3 * (aNormal * invScaleSq));
  vColor = aColor;
  vMat = aMat;
  vShadowPos = uLightVP * wp;
  vInstTint = aInstTint;
  vInstExtra = aInstExtra;
  gl_Position = uViewProj * wp;
}`;

  function buildLitFS(instanced) {
    return `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vColor;
in vec4 vMat;
in vec4 vShadowPos;
${instanced ? 'in vec4 vInstTint;\nin vec4 vInstExtra;' : ''}

uniform mat4 uLightVP;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uZenithCol;
uniform vec3 uMidCol;
uniform vec3 uHorizCol;
uniform float uTime;
uniform float uIsTerrain;
uniform float uUseShadows;
uniform float uEmissive;
uniform vec3 uBaseTint;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uHitFlash;
uniform float uAuroraStr;
uniform float uLightning;
uniform sampler2D uShadowMap;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragGlow;

const float PI = 3.14159265;

${ENV_COMMON}

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

vec3 perturbRockNormal(vec3 wp, vec3 n, float strength) {
  float e = 0.22;
  vec3 p = wp * vec3(0.32, 0.58, 0.32);
  float c  = noise3(p) * 0.62 + noise3(p * 2.9) * 0.38;
  float gx = noise3(p + vec3(e, 0.0, 0.0)) * 0.62 + noise3((p + vec3(e, 0.0, 0.0)) * 2.9) * 0.38 - c;
  float gy = noise3(p + vec3(0.0, e, 0.0)) * 0.62 + noise3((p + vec3(0.0, e, 0.0)) * 2.9) * 0.38 - c;
  float gz = noise3(p + vec3(0.0, 0.0, e)) * 0.62 + noise3((p + vec3(0.0, 0.0, e)) * 2.9) * 0.38 - c;
  float strata = sin(wp.y * 2.6 + c * 5.0) * 0.14;
  return normalize(n - vec3(gx, gy + strata, gz) / e * strength);
}

float sampleShadow(vec3 worldPos, vec3 n, vec3 l) {
  if (uUseShadows < 0.5) return 1.0;
  vec4 offsetSp = uLightVP * vec4(worldPos + n * 0.24, 1.0);
  vec3 proj = offsetSp.xyz / offsetSp.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x <= 0.0 || proj.x >= 1.0 || proj.y <= 0.0 || proj.y >= 1.0 || proj.z > 0.995) {
    return 1.0;
  }
  float edgeFade = smoothstep(0.0, 0.10, proj.x) * smoothstep(1.0, 0.90, proj.x)
                 * smoothstep(0.0, 0.10, proj.y) * smoothstep(1.0, 0.90, proj.y);
  float bias = max(0.0040 * (1.0 - max(dot(n, l), 0.0)), 0.0018);
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float shadow = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      shadow += (proj.z - bias > texture(uShadowMap, proj.xy + vec2(float(x), float(y)) * texel).r) ? 0.0 : 1.0;
    }
  }
  return mix(1.0, shadow / 9.0, edgeFade);
}

float D_GGX(float NdotH, float r) {
  float a = r * r;
  float a2 = a * a;
  float d = (NdotH * NdotH) * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 1e-5);
}

float G_Schlick(float NdotV, float NdotL, float r) {
  float k = ((r + 1.0) * (r + 1.0)) / 8.0;
  return (NdotV / (NdotV * (1.0 - k) + k + 1e-5)) * (NdotL / (NdotL * (1.0 - k) + k + 1e-5));
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uSunDir);

  vec3 albedo = vColor * uBaseTint;
  float roughness = clamp(vMat.x, 0.06, 0.98);
  float metallic  = clamp(vMat.y, 0.0, 1.0);
  float emissive  = vMat.z + uEmissive;
  float matType   = vMat.w;
  float hitFlash  = uHitFlash;
  vec3 rimCol     = uRimColor;
  float rimStr    = 1.0;

  ${instanced ? `
  albedo *= vInstTint.rgb;
  emissive += vInstTint.a;
  hitFlash = max(hitFlash, vInstExtra.x);
  rimStr = max(0.2, vInstExtra.y);
  ` : ''}

  vec3 glowMask = vec3(0.0);

  if (uIsTerrain > 0.5 && matType < 0.5) {
    float slopeUp = clamp(N.y, 0.0, 1.0);
    float y = vWorldPos.y;
    float macroNoise = noise3(vWorldPos * 0.07);
    float microNoise = noise3(vWorldPos * 0.45);
    float fineGrain  = noise3(vWorldPos * 1.9);

    float sandMask  = (1.0 - smoothstep(1.3, 3.2, y + macroNoise * 0.8)) * smoothstep(0.30, 0.62, slopeUp);
    float grassMask = smoothstep(1.7, 3.6, y + macroNoise * 0.8) * (1.0 - smoothstep(17.0, 25.0, y)) * smoothstep(0.62, 0.84, slopeUp);
    float cliffMask = clamp(1.0 - max(sandMask, grassMask), 0.0, 1.0);

    float bumpStr = mix(0.04, 0.28, cliffMask);
    N = perturbRockNormal(vWorldPos, N, bumpStr);

    vec3 wetSand = vec3(0.42, 0.36, 0.27);
    vec3 drySand = vec3(0.76, 0.67, 0.50) * mix(0.90, 1.08, fineGrain);
    vec3 sandCol = mix(wetSand, drySand, smoothstep(-0.2, 1.0, y));

    vec3 grassRich = mix(vec3(0.14, 0.33, 0.14), vec3(0.28, 0.46, 0.18), macroNoise);
    grassRich *= mix(0.84, 1.16, microNoise * 0.6 + fineGrain * 0.4);

    float strataBand = sin(vWorldPos.y * 1.45 + macroNoise * 3.5) * 0.5 + 0.5;
    vec3 cliffCol = mix(vec3(0.22, 0.20, 0.23), vec3(0.38, 0.34, 0.35), strataBand);
    cliffCol *= mix(0.75, 1.2, microNoise);
    cliffCol = mix(cliffCol, vec3(0.18, 0.32, 0.16), smoothstep(0.52, 0.72, slopeUp) * smoothstep(1.5, 5.0, y) * 0.55);

    float wSum = max(sandMask + grassMask + cliffMask, 0.001);
    albedo = (sandCol * sandMask + grassRich * grassMask + cliffCol * cliffMask) / wSum;
    roughness = mix(0.88, 0.58, sandMask * smoothstep(0.4, -0.2, y));
    metallic = 0.02;
  } else if (matType > 0.5 && matType < 1.5) {
    float det = noise3(vWorldPos * 0.55);
    N = perturbRockNormal(vWorldPos, N, 0.08);
    albedo *= mix(0.82, 1.15, det);
    roughness = 0.62;
  } else if (matType > 1.5 && matType < 2.5 && uIsTerrain < 0.5) {
    float leafVar = noise3(vWorldPos * 1.1);
    albedo *= mix(0.75, 1.28, leafVar);
    roughness = 0.78;
  } else if (matType > 3.5) {
    float flow1 = noise3(vec3(vWorldPos.xz * 0.55, vWorldPos.y * 0.22 + uTime * 5.2));
    float flow2 = noise3(vec3(vWorldPos.xz * 1.2, vWorldPos.y * 0.45 + uTime * 8.4));
    float streak = smoothstep(0.38, 0.82, flow1 * 0.6 + flow2 * 0.4);
    albedo = mix(vec3(0.20, 0.64, 0.86), vec3(0.92, 0.97, 1.0), streak);
    emissive += 0.25 + streak * 0.45;
    glowMask += albedo * streak * 0.35;
    roughness = 0.14;
  }

  vec3 H = normalize(L + V);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.001);
  float NdotH = max(dot(N, H), 0.0);
  float HdotV = max(dot(H, V), 0.0);

  float shadow = sampleShadow(vWorldPos, N, L);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  vec3 F  = F0 + (1.0 - F0) * pow(1.0 - HdotV, 5.0);
  float D = D_GGX(NdotH, roughness);
  float G = G_Schlick(NdotV, NdotL, roughness);
  vec3 spec = (D * G * F) / (4.0 * NdotV * NdotL + 0.001);
  vec3 kD   = (1.0 - F) * (1.0 - metallic);

  float wrapNdotL = (matType > 1.5 && matType < 2.5) ? clamp((dot(N, L) + 0.35) / 1.35, 0.0, 1.0) : NdotL;
  vec3 direct = (kD * albedo / PI + spec) * (uSunColor + vec3(uLightning * 1.2)) * wrapNdotL * shadow * 2.15;

  float hemi = N.y * 0.5 + 0.5;
  vec3 skyAmb = mix(uHorizCol * 0.28 + vec3(0.08, 0.10, 0.16), uMidCol * 0.55 + vec3(0.12, 0.16, 0.24), hemi);
  vec3 R = reflect(-V, N);
  float dummySun = 0.0;
  vec3 envRefl = evalAtmosphere(R, L, uZenithCol, uMidCol, uHorizCol, uTime, 0.0, uAuroraStr, uLightning, dummySun);
  vec3 F_ibl = F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - NdotV, 5.0);
  vec3 ambient = kD * albedo * skyAmb * 0.82 + envRefl * F_ibl * mix(0.22, 1.05, metallic + (1.0 - roughness) * 0.35);

  float fresnelRim = pow(1.0 - NdotV, uRimPower) * rimStr;
  vec3 rim = rimCol * fresnelRim * (uIsTerrain > 0.5 ? 0.14 : 0.32);

  vec3 lit = ambient + direct + rim + albedo * emissive + glowMask;
  lit = mix(lit, vec3(1.6, 1.65, 1.8), clamp(hitFlash, 0.0, 1.0));

  float dist = length(uCamPos - vWorldPos);
  float fogFactor = clamp(1.0 - exp(-pow(max(dist - 110.0, 0.0) * 0.0018, 1.25)), 0.0, 0.94);
  vec3 finalCol = mix(lit, uFogColor, fogFactor);

  vec3 bloomOut = (albedo * max(emissive, 0.0) + glowMask) * (1.0 - fogFactor * 0.85)
                + vec3(0.95, 1.0, 1.2) * hitFlash * 0.65;

  fragColor = vec4(finalCol, 0.0);
  fragGlow = vec4(bloomOut, 1.0);
}`;
  }

  const VFX_INST_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 4) in vec4 aInst0;
layout(location = 5) in vec4 aInst1;
layout(location = 6) in vec4 aInst2;
layout(location = 7) in vec4 aInst3;
layout(location = 8) in vec4 aInstColor;

uniform mat4 uViewProj;

out vec4 vColor;
out vec3 vNormal;
out vec3 vWorldPos;

void main() {
  mat4 model = mat4(aInst0, aInst1, aInst2, aInst3);
  vec4 wp = model * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(model) * aNormal);
  vColor = aInstColor;
  gl_Position = uViewProj * wp;
}`;

  const VFX_INST_FS = `#version 300 es
precision highp float;

in vec4 vColor;
in vec3 vNormal;
in vec3 vWorldPos;

uniform vec3 uCamPos;
uniform float uFresnelMode;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragGlow;

void main() {
  float alpha = vColor.a;
  if (uFresnelMode > 0.5) {
    vec3 V = normalize(uCamPos - vWorldPos);
    float f = pow(1.0 - abs(dot(normalize(vNormal), V)), 1.65);
    alpha *= (0.28 + 0.95 * f);
  }
  vec3 c = vColor.rgb;
  fragColor = vec4(c * alpha, alpha);
  fragGlow = vec4(c * alpha * 0.85, alpha);
}`;

  const TRAIL_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;

uniform mat4 uViewProj;
out vec4 vColor;

void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

  const TRAIL_FS = `#version 300 es
precision highp float;
in vec4 vColor;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragGlow;
void main() {
  fragColor = vec4(vColor.rgb * vColor.a, vColor.a);
  fragGlow = vec4(vColor.rgb * vColor.a * 0.78, vColor.a);
}`;

  const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexelDir;
out vec4 fragColor;

void main() {
  vec4 sum = texture(uTex, vUv) * 0.227027;
  sum += texture(uTex, vUv + uTexelDir * 1.384615) * 0.316216;
  sum += texture(uTex, vUv - uTexelDir * 1.384615) * 0.316216;
  sum += texture(uTex, vUv + uTexelDir * 3.230769) * 0.070270;
  sum += texture(uTex, vUv - uTexelDir * 3.230769) * 0.070270;
  fragColor = sum;
}`;

  const COMPOSITE_FS = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uSceneTex;
uniform sampler2D uBloomTex0;
uniform sampler2D uBloomTex1;
uniform sampler2D uBloomTex2;
uniform float uBloomStrength;
uniform float uBoostFactor;
uniform float uDamageFlash;
uniform float uTime;
uniform float uAspect;
uniform vec2 uSunScreenPos;
uniform float uSunVisible;
uniform vec3 uRaysColor;
uniform float uGodRayStr;
uniform float uRainAmount;

out vec4 fragColor;

vec3 acesToneMap(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 centered = vUv - 0.5;
  vec2 aspectVec = vec2(centered.x * uAspect, centered.y);
  float r = length(aspectVec);

  float ca = (uBoostFactor * 0.004 + uDamageFlash * 0.008) * smoothstep(0.18, 0.78, r);
  vec2 dir = normalize(centered + 1e-5);

  vec3 sceneCol;
  if (ca > 0.0002) {
    sceneCol.r = texture(uSceneTex, vUv + dir * ca).r;
    sceneCol.g = texture(uSceneTex, vUv).g;
    sceneCol.b = texture(uSceneTex, vUv - dir * ca).b;
  } else {
    sceneCol = texture(uSceneTex, vUv).rgb;
  }

  vec3 bloom = (
    texture(uBloomTex0, vUv).rgb * 0.38 +
    texture(uBloomTex1, vUv).rgb * 0.30 +
    texture(uBloomTex2, vUv).rgb * 0.24
  ) * uBloomStrength;

  vec3 godRays = vec3(0.0);
  if (uSunVisible > 0.01 && uBloomStrength > 0.05) {
    vec2 deltaUv = (vUv - uSunScreenPos) * (0.82 / 14.0);
    vec2 rayUv = vUv;
    float illuminationDecay = 1.0;
    float raySum = 0.0;
    for (int i = 0; i < 14; i++) {
      rayUv -= deltaUv;
      float skyOcc = texture(uSceneTex, clamp(rayUv, 0.002, 0.998)).a;
      raySum += skyOcc * illuminationDecay;
      illuminationDecay *= 0.90;
    }
    float sunDist = length((vUv - uSunScreenPos) * vec2(uAspect, 1.0));
    float radialAtten = exp(-sunDist * 1.35);
    godRays = uRaysColor * (raySum / 14.0) * radialAtten * uSunVisible * uGodRayStr;
  }

  vec3 hdr = sceneCol + bloom + godRays;

  if (uBoostFactor > 0.02) {
    float angle = atan(aspectVec.y, aspectVec.x);
    float streak = pow(max(sin(angle * 34.0 + uTime * 20.0) * sin(angle * 19.0 - uTime * 29.0), 0.0), 5.0);
    float radialMask = smoothstep(0.32, 0.78, r);
    hdr += vec3(0.55, 0.92, 1.0) * streak * radialMask * uBoostFactor * 0.42;
  }

  if (uDamageFlash > 0.01) {
    float edge = smoothstep(0.28, 0.78, r);
    hdr += vec3(1.0, 0.14, 0.18) * edge * uDamageFlash * 0.75;
  }

  // Subtle storm raindrops sliding down visor lens
  if (uRainAmount > 0.05) {
    vec2 dropUv = vec2(vUv.x * 18.0, vUv.y * 9.0 + uTime * 2.2);
    vec2 cell = floor(dropUv);
    vec2 f = fract(dropUv) - 0.5;
    float seed = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    if (seed > 0.72) {
      f.y *= 0.45;
      float d = length(f);
      float drop = smoothstep(0.18, 0.04, d) * smoothstep(0.2, 0.75, r);
      hdr += vec3(0.45, 0.65, 0.85) * drop * uRainAmount * 0.42;
    }
  }

  vec3 mapped = acesToneMap(hdr * 1.02);
  float vig = 1.0 - smoothstep(0.52, 0.98, r) * 0.22;
  mapped *= vig;

  fragColor = vec4(mapped, 1.0);
}`;

  AF.Shaders = {
    FULLSCREEN_VS,
    SKY_FS,
    SHADOW_VS,
    SHADOW_INST_VS,
    SHADOW_FS,
    OCEAN_VS,
    OCEAN_FS,
    LIT_VS,
    LIT_INST_VS,
    LIT_FS: buildLitFS(false),
    LIT_INST_FS: buildLitFS(true),
    VFX_INST_VS,
    VFX_INST_FS,
    TRAIL_VS,
    TRAIL_FS,
    BLUR_FS,
    COMPOSITE_FS
  };
})(window.AF = window.AF || {});
