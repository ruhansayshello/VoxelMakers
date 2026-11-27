import * as THREE from 'three';
import { WATER_LEVEL } from './constants.ts';
import {
  GRAPHICS_PRESETS,
  type GraphicsSettings,
  hasActivePostProcessing,
  computeHaltonJitter,
  resolveVisualQualityTier,
  resolveEffectivePixelRatio,
  shouldUseRealisticWater,
  worldGenModeToShaderId,
} from './graphicsSettings.ts';

const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Note: The custom WebGL2 engine always applies linearToOutputTexel() (sRGB encoding)
// when rendering built-in and custom materials into offscreen WebGLRenderTargets.
// Therefore tColor is already in sRGB display space — zero redundant pow(1/2.2) conversions!
const BLOOM_EXTRACT_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp int;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform float uThreshold;

  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float maxCh = max(col.r, max(col.g, col.b));
    float brightness = max(lum, maxCh * 0.9);
    float knee = uThreshold * 0.4 + 0.0001;
    float soft = clamp(brightness - uThreshold + knee, 0.0, 2.0 * knee);
    soft = (soft * soft) / (4.0 * knee);
    float contrib = max(soft, brightness - uThreshold) / max(brightness, 0.0001);
    gl_FragColor = vec4(col * clamp(contrib, 0.0, 3.2), 1.0);
  }
`;

const BLOOM_BLUR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform vec2 uDirection; // (1/w, 0) or (0, 1/h)

  void main() {
    vec3 sum = texture2D(tInput, vUv).rgb * 0.227027;
    vec2 off1 = uDirection * 1.384615;
    vec2 off2 = uDirection * 3.230769;
    sum += texture2D(tInput, vUv + off1).rgb * 0.316216;
    sum += texture2D(tInput, vUv - off1).rgb * 0.316216;
    sum += texture2D(tInput, vUv + off2).rgb * 0.070270;
    sum += texture2D(tInput, vUv - off2).rgb * 0.070270;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

/**
 * Computes the compile-time #define map and deterministic program cache key
 * for the specialized post-processing composite shader.
 * Only active features are compiled into each WebGL2 program, slashing VGPR
 * register pressure and fragment shader instruction count across low-end,
 * mobile, and desktop GPUs.
 */
export function computeCompositeFeatureKey(
  settings: GraphicsSettings,
  useTaaPass: boolean,
): { key: string; defines: Record<string, number> } {
  const tier = resolveVisualQualityTier(settings);
  const defines: Record<string, number> = {
    VISUAL_TIER: tier,
  };

  let mask = tier & 3;
  if (Math.abs(settings.lensDistortion) > 0.005) {
    defines.USE_LENS_DISTORTION = 1;
    mask |= 1 << 2;
  }
  if (settings.chromaticAberrationEnabled) {
    defines.USE_CHROMA = 1;
    mask |= 1 << 3;
  }
  if (settings.dofEnabled) {
    defines.USE_DOF = 1;
    mask |= 1 << 4;
  }
  if (settings.motionBlurEnabled) {
    defines.USE_MOTION_BLUR = 1;
    mask |= 1 << 5;
  }
  if (settings.ssaoEnabled) {
    defines.USE_SSAO = 1;
    mask |= 1 << 6;
  }
  if (settings.contactShadowsEnabled) {
    defines.USE_CONTACT_SHADOWS = 1;
    mask |= 1 << 7;
  }
  if (tier >= 2) {
    defines.USE_MICRO_BEVEL = 1;
    mask |= 1 << 8;
  }
  if (settings.ssrEnabled) {
    defines.USE_SSR = 1;
    mask |= 1 << 9;
  }
  if (settings.volumetricSmokeEnabled) {
    defines.USE_VOLUMETRIC_SMOKE = 1;
    mask |= 1 << 10;
  }
  if (settings.godRaysEnabled) {
    defines.USE_GODRAYS = 1;
    mask |= 1 << 11;
  }
  if (settings.bloomEnabled) {
    if (settings.cheapBloom) {
      defines.USE_CHEAP_BLOOM = 1;
      mask |= 1 << 12;
    } else {
      defines.USE_BLOOM = 1;
      mask |= 1 << 13;
    }
  }
  if (useTaaPass) {
    defines.USE_TAA = 1;
    mask |= 1 << 14;
  }

  const needsWorldPos = Boolean(
    defines.USE_MOTION_BLUR ||
      (defines.USE_SSAO && tier >= 2) ||
      defines.USE_CONTACT_SHADOWS ||
      defines.USE_SSR ||
      defines.USE_VOLUMETRIC_SMOKE ||
      defines.USE_TAA,
  );
  if (needsWorldPos) {
    defines.NEEDS_WORLD_POS = 1;
  }

  const needsDepth = Boolean(
    needsWorldPos ||
      defines.USE_DOF ||
      defines.USE_SSAO ||
      defines.USE_MICRO_BEVEL ||
      defines.USE_GODRAYS,
  );
  if (needsDepth) {
    defines.NEEDS_DEPTH = 1;
  }

  return {
    key: `composite_v2_${mask.toString(16)}`,
    defines,
  };
}

const COMPOSITE_POST_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  varying vec2 vUv;

  uniform sampler2D tColor;
  #ifdef NEEDS_DEPTH
    uniform sampler2D tDepth;
    uniform float uNear;
    uniform float uFar;
    uniform float uUseLogDepth;
  #endif
  #ifdef USE_BLOOM
    uniform sampler2D tBloom;
  #endif
  #ifdef USE_TAA
    uniform sampler2D tHistory;
  #endif

  uniform vec2 uResolution;
  uniform vec2 uTexelSize;
  uniform float uTime;

  #ifdef USE_SSAO
    uniform float uSsaoIntensity;
    uniform float uSsaoRadius;
  #endif

  #ifdef USE_SSR
    uniform float uSsrIntensity;
    uniform int uWorldGenMode;
  #endif

  #if defined(USE_BLOOM) || defined(USE_CHEAP_BLOOM)
    uniform float uBloomStrength;
    uniform float uBloomThreshold;
  #endif

  #ifdef USE_GODRAYS
    uniform float uGodRaysIntensity;
    uniform vec2 uSunScreenPos;
    uniform float uSunVisible;
  #endif

  #ifdef NEEDS_WORLD_POS
    uniform mat4 uInvViewProjMatrix;
  #endif

  #if defined(USE_MOTION_BLUR) || defined(USE_TAA)
    uniform mat4 uPrevViewProjMatrix;
  #endif

  #ifdef USE_MOTION_BLUR
    uniform float uMotionBlurStrength;
  #endif

  #ifdef USE_DOF
    uniform float uDofFocusDistance;
    uniform float uDofAperture;
  #endif

  #if defined(USE_VOLUMETRIC_SMOKE) || defined(USE_SSR)
    uniform vec3 uCameraPos;
  #endif

  #ifdef USE_VOLUMETRIC_SMOKE
    uniform float uVolumetricSmokeDensity;
    uniform vec3 uSmokeFocusPos;
    uniform float uExplosionTrauma;
  #endif

  #ifdef USE_CONTACT_SHADOWS
    uniform float uContactShadowsIntensity;
    uniform vec2 uSunScreenDir;
  #endif

  #ifdef USE_TAA
    uniform int uTaaHistoryValid;
    uniform float uTaaBlendFactor;
  #endif

  #ifdef USE_CHROMA
    uniform float uChromaticIntensity;
  #endif
  #ifdef USE_LENS_DISTORTION
    uniform float uLensDistortion;
  #endif

  // Custom WebGL2 engine already renders sRGB directly into tColor; zero pow() conversion!
  vec3 sampleScene(vec2 uv) {
    return texture2D(tColor, clamp(uv, 0.001, 0.999)).rgb;
  }

  #ifdef NEEDS_DEPTH
    float readLinearDepthFromRaw(float z) {
      if (uUseLogDepth > 0.5) {
        return max(uNear, pow(2.0, z * log2(uFar + 1.0)) - 1.0);
      }
      float oneMinusZ = max(0.000001, 1.0 - z);
      return (uNear * uFar) / max(0.00001, uNear + oneMinusZ * (uFar - uNear));
    }

    float readLinearDepth(vec2 uv) {
      float z = texture2D(tDepth, clamp(uv, 0.001, 0.999)).x;
      return readLinearDepthFromRaw(z);
    }
  #endif

  #ifdef NEEDS_WORLD_POS
    vec3 reconstructWorldPos(vec2 uv, float rawDepth) {
      float ndcZ;
      if (uUseLogDepth > 0.5) {
        float d = readLinearDepthFromRaw(rawDepth);
        ndcZ = (uFar + uNear - (2.0 * uNear * uFar) / max(uNear, d)) / max(0.0001, uFar - uNear);
      } else {
        ndcZ = rawDepth * 2.0 - 1.0;
      }
      vec4 ndc = vec4(uv * 2.0 - 1.0, ndcZ, 1.0);
      vec4 world = uInvViewProjMatrix * ndc;
      return world.xyz / max(0.0001, world.w);
    }
  #endif

  #ifdef USE_SSR
    bool isWaterSurfaceWorld(vec3 wp, vec3 srgbCol) {
      if (wp.y < 13.4 || wp.y > 15.65) return false;
      bool isWaterTint = (srgbCol.b > 0.16) && (srgbCol.b > srgbCol.r * 1.12) && (srgbCol.b >= srgbCol.g * 0.90);
      if (!isWaterTint) return false;
      if (uWorldGenMode == 0) {
        return (wp.x < -22.5 && wp.z < 35.5) || length(wp.xz - vec2(65.0, -85.0)) < 18.0;
      }
      if (uWorldGenMode == 1) {
        return abs(wp.x - sin(wp.z * 0.04) * 22.0) < 18.0;
      }
      if (uWorldGenMode == 4) {
        return wp.y <= 15.25;
      }
      return false;
    }
  #endif

  #ifdef USE_VOLUMETRIC_SMOKE
    float noise3D(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n = i.x + i.y * 57.0 + 113.0 * i.z;
      return mix(
        mix(
          mix(fract(sin(n + 0.0) * 43758.5453), fract(sin(n + 1.0) * 43758.5453), f.x),
          mix(fract(sin(n + 57.0) * 43758.5453), fract(sin(n + 58.0) * 43758.5453), f.x),
          f.y
        ),
        mix(
          mix(fract(sin(n + 113.0) * 43758.5453), fract(sin(n + 114.0) * 43758.5453), f.x),
          mix(fract(sin(n + 170.0) * 43758.5453), fract(sin(n + 171.0) * 43758.5453), f.x),
          f.y
        ),
        f.z
      );
    }
  #endif

  void main() {
    vec2 baseUv = vUv;

    #if defined(USE_LENS_DISTORTION) || defined(USE_CHROMA)
      vec2 centeredUv = vUv - 0.5;
      float r2 = dot(centeredUv, centeredUv);
    #endif

    #ifdef USE_LENS_DISTORTION
      baseUv = 0.5 + centeredUv * (1.0 + uLensDistortion * r2 + uLensDistortion * 0.5 * r2 * r2);
      baseUv = clamp(baseUv, 0.001, 0.999);
    #endif

    #ifdef NEEDS_DEPTH
      float rawDepth = texture2D(tDepth, baseUv).x;
      float linearDepth = readLinearDepthFromRaw(rawDepth);
      bool isSky = rawDepth > 0.9992;
    #endif

    #ifdef NEEDS_WORLD_POS
      vec3 worldPos = isSky
        ? reconstructWorldPos(baseUv, 0.995)
        : reconstructWorldPos(baseUv, rawDepth);
    #endif

    // Base Color Fetch (+ optional Chromatic Aberration)
    #ifdef USE_CHROMA
      vec3 color;
      if (uChromaticIntensity > 0.001) {
        vec2 caOffset = centeredUv * (0.0032 * uChromaticIntensity * (0.3 + r2 * 1.8));
        color = vec3(
          sampleScene(baseUv + caOffset).r,
          sampleScene(baseUv).g,
          sampleScene(baseUv - caOffset).b
        );
      } else {
        color = sampleScene(baseUv);
      }
    #else
      vec3 color = sampleScene(baseUv);
    #endif

    // 8. Depth of Field (Bokeh DOF) — Far-Field Only with Depth-Discontinuity Rejection
    #ifdef USE_DOF
      if (!isSky) {
        float focusStart = max(uDofFocusDistance, 38.0);
        float coc = clamp((linearDepth - focusStart) * uDofAperture * 0.014, 0.0, 0.75);
        if (coc > 0.05) {
          vec3 bokehAcc = color;
          float totalW = 1.0;
          vec2 blurRad = uTexelSize * coc * 4.2;
          for (int i = 0; i < 6; i++) {
            float fi = float(i);
            float ang = fi * 2.3999632;
            float rad = sqrt((fi + 0.5) / 6.0);
            vec2 sampleUv = clamp(baseUv + vec2(cos(ang), sin(ang)) * rad * blurRad, 0.001, 0.999);
            float sampleRawDepth = texture2D(tDepth, sampleUv).x;
            if (sampleRawDepth > 0.9992) continue;
            float sampleDepth = readLinearDepthFromRaw(sampleRawDepth);
            float depthWeight = 1.0 - smoothstep(0.35, 4.0, abs(sampleDepth - linearDepth));
            float sampleCoc = clamp((sampleDepth - focusStart) * uDofAperture * 0.014, 0.0, 0.75);
            float w = mix(0.25, 1.0, sampleCoc) * depthWeight;
            if (w > 0.01) {
              bokehAcc += sampleScene(sampleUv) * w;
              totalW += w;
            }
          }
          color = bokehAcc / totalW;
        }
      }
    #endif

    // 7. Motion Blur (Velocity Space with Depth-Edge Guard)
    #ifdef USE_MOTION_BLUR
      if (!isSky && uMotionBlurStrength > 0.005) {
        vec4 prevClip = uPrevViewProjMatrix * vec4(worldPos, 1.0);
        vec2 prevUv = (prevClip.xy / max(0.0001, prevClip.w)) * 0.5 + 0.5;
        vec2 velUv = (baseUv - prevUv) * uMotionBlurStrength;
        float velLen = length(velUv);
        if (velLen > 0.0012) {
          vec2 clampedVel = velUv * min(1.0, 0.022 / velLen);
          vec3 mbAcc = color;
          float mbWeight = 1.0;
          for (int i = 1; i <= 4; i++) {
            vec2 tapUv = clamp(baseUv - clampedVel * (float(i) * 0.25), 0.001, 0.999);
            float tapRaw = texture2D(tDepth, tapUv).x;
            if (tapRaw > 0.9992) continue;
            float tapDepth = readLinearDepthFromRaw(tapRaw);
            float w = 1.0 - smoothstep(0.25, 2.5, abs(tapDepth - linearDepth));
            mbAcc += sampleScene(tapUv) * w;
            mbWeight += w;
          }
          color = mbAcc / mbWeight;
        }
      }
    #endif

    // 2. Screen-Space Ambient Occlusion (SSAO)
    #ifdef USE_SSAO
      if (!isSky && linearDepth < 38.0) {
        float occ = 0.0;
        float distFade = 1.0 - smoothstep(16.0, 38.0, linearDepth);
        float minCrease = 0.16 + linearDepth * linearDepth * 0.0014;
        vec2 radiusUv = uTexelSize * (4.5 * uSsaoRadius) / clamp(linearDepth * 0.08, 0.5, 3.0);
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          float ang = fi * 0.78539816;
          vec2 offset = vec2(cos(ang), sin(ang)) * radiusUv;
          vec2 uvPos = clamp(baseUv + offset, 0.001, 0.999);
          vec2 uvNeg = clamp(baseUv - offset, 0.001, 0.999);
          float rawPos = texture2D(tDepth, uvPos).x;
          float rawNeg = texture2D(tDepth, uvNeg).x;
          if (rawPos > 0.9992 || rawNeg > 0.9992) continue;
          float dPos = readLinearDepthFromRaw(rawPos);
          float dNeg = readLinearDepthFromRaw(rawNeg);
          float valleyDiff = linearDepth - 0.5 * (dPos + dNeg);
          if (valleyDiff > minCrease && valleyDiff < 1.25 && abs(dPos - dNeg) > minCrease * 1.2) {
            #if VISUAL_TIER >= 2
              vec3 pPos = reconstructWorldPos(uvPos, rawPos);
              vec3 pNeg = reconstructWorldPos(uvNeg, rawNeg);
              float verticalRise = max(pPos.y, pNeg.y) - worldPos.y;
              if (verticalRise > 0.22) {
                float rangeCheck = 1.0 - smoothstep(0.18, 1.25, valleyDiff);
                occ += rangeCheck * smoothstep(0.22, 0.45, verticalRise);
              }
            #else
              // Fast depth-only crease detection on MEDIUM/LOW (zero mat4 inversions per sample)
              float rangeCheck = 1.0 - smoothstep(0.18, 1.25, valleyDiff);
              occ += rangeCheck * smoothstep(minCrease, minCrease * 2.5, valleyDiff);
            #endif
          }
        }
        #if VISUAL_TIER >= 3
          float minAoFloor = 0.64;
          float aoWeight = 0.62;
        #elif VISUAL_TIER == 2
          float minAoFloor = 0.71;
          float aoWeight = 0.50;
        #else
          float minAoFloor = 0.80;
          float aoWeight = 0.38;
        #endif
        float ao = clamp(1.0 - (occ * 0.25) * uSsaoIntensity * distFade * aoWeight, minAoFloor, 1.0);
        color *= ao;
      }
    #endif

    // 10. Screen-Space Contact Shadows — 3D World-Elevation Occluder Raymarch
    #ifdef USE_CONTACT_SHADOWS
      if (!isSky && linearDepth < 34.0) {
        float contactOcc = 0.0;
        float distFade = 1.0 - smoothstep(14.0, 34.0, linearDepth);
        vec2 rayStep = uSunScreenDir * uTexelSize * 2.2;
        for (int i = 1; i <= 4; i++) {
          float fi = float(i);
          vec2 marchUv = baseUv + rayStep * fi;
          if (marchUv.x < 0.001 || marchUv.x > 0.999 || marchUv.y < 0.001 || marchUv.y > 0.999) break;
          float sampleRaw = texture2D(tDepth, marchUv).x;
          if (sampleRaw > 0.9992) continue;
          float sampleDepth = readLinearDepthFromRaw(sampleRaw);
          float depthDelta = linearDepth - sampleDepth;
          if (depthDelta > 0.16 && depthDelta < 1.25) {
            vec3 marchWorldPos = reconstructWorldPos(marchUv, sampleRaw);
            float verticalRise = marchWorldPos.y - worldPos.y;
            float dist3D = length(marchWorldPos - worldPos);
            if (verticalRise > 0.24 && verticalRise < 1.65 && dist3D < 1.45) {
              contactOcc = max(contactOcc, (1.0 - fi / 5.0) * smoothstep(0.24, 0.45, verticalRise));
            }
          }
        }
        #if VISUAL_TIER >= 3
          float maxContactShadow = 0.30;
        #else
          float maxContactShadow = 0.22;
        #endif
        color *= 1.0 - contactOcc * distFade * clamp(uContactShadowsIntensity * 0.26, 0.0, maxContactShadow);
      }
    #endif

    // 10B. 3D Voxel Micro-Bevel Specular Rim & Sunlit Edge Catch (HIGH & ULTRA Tiers)
    #ifdef USE_MICRO_BEVEL
      if (!isSky && linearDepth < 42.0) {
        float dRight = readLinearDepth(baseUv + vec2(uTexelSize.x, 0.0));
        float dUp = readLinearDepth(baseUv + vec2(0.0, uTexelSize.y));
        float edgeGrad = abs(dRight - linearDepth) + abs(dUp - linearDepth);
        float voxelBevel = smoothstep(0.018, 0.12, edgeGrad) * (1.0 - smoothstep(0.22, 0.65, edgeGrad));
        float distAtten = 1.0 - smoothstep(14.0, 42.0, linearDepth);
        float lumaBase = dot(color, vec3(0.299, 0.587, 0.114));
        float sunlitMask = smoothstep(0.32, 0.78, lumaBase);
        #if VISUAL_TIER == 2
          color += vec3(1.0, 0.97, 0.88) * voxelBevel * sunlitMask * distAtten * 0.08;
        #else
          color += vec3(1.0, 0.95, 0.82) * voxelBevel * sunlitMask * distAtten * 0.13;
          color += vec3(0.55, 0.82, 1.0) * voxelBevel * (1.0 - sunlitMask) * distAtten * 0.04;
        #endif
      }
    #endif

    // 3. Screen-Space Reflections (SSR) — Jittered Multi-Step Raymarch on Water Surfaces Only
    #ifdef USE_SSR
      if (!isSky && isWaterSurfaceWorld(worldPos, color)) {
        vec3 hitColor = vec3(0.0);
        float hitFound = 0.0;
        float rippleX = sin(worldPos.x * 1.45 + uTime * 2.2) * 0.004;
        vec2 reflDirUv = normalize(vec2(rippleX * 2.0, 1.0));
        float ignJitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        float rayStepLen = 0.042;
        for (int s = 1; s <= 6; s++) {
          float stepDist = rayStepLen * (float(s) - 0.35 + ignJitter * 0.7);
          vec2 sampleUv = baseUv + reflDirUv * stepDist;
          sampleUv.x += rippleX * float(s) * 0.45;
          if (sampleUv.x < 0.01 || sampleUv.x > 0.99 || sampleUv.y < 0.01 || sampleUv.y > 0.99) break;
          float reflRaw = texture2D(tDepth, sampleUv).x;
          float reflDepth = readLinearDepthFromRaw(reflRaw);
          if (reflRaw <= 0.9992 && reflDepth > linearDepth + 1.8 && reflDepth < linearDepth + 95.0) {
            vec3 candPos = reconstructWorldPos(sampleUv, reflRaw);
            if (candPos.y > max(worldPos.y + 0.35, 14.3)) {
              float edgeFade =
                smoothstep(0.01, 0.12, sampleUv.x) * smoothstep(0.99, 0.88, sampleUv.x) *
                smoothstep(0.01, 0.12, sampleUv.y) * smoothstep(0.99, 0.88, sampleUv.y);
              float distFade = 1.0 - smoothstep(2.0, 6.0, float(s)) * 0.45;
              hitColor = sampleScene(sampleUv);
              hitFound = edgeFade * distFade;
              break;
            }
          }
        }
        if (hitFound > 0.01) {
          vec3 viewV = normalize(uCameraPos - worldPos);
          float invVy = 1.0 - max(viewV.y, 0.02);
          float ssrFresnel = clamp(0.16 + 0.84 * (invVy * invVy * invVy), 0.12, 0.82);
          float ssrMix = clamp(uSsrIntensity * ssrFresnel * hitFound * 0.44, 0.0, 0.52);
          color = mix(color, hitColor, ssrMix);
        }
      }
    #endif

    // 9. Volumetric Smoke & Dust Raymarching — Sunlit Atmospheric Scattering (4 jittered steps)
    #ifdef USE_VOLUMETRIC_SMOKE
      {
        vec3 rayVec = worldPos - uCameraPos;
        float fullLen = max(0.001, length(rayVec));
        float rayLen = min(fullLen, 85.0);
        vec3 rayDir = rayVec / fullLen;
        float accumSmoke = 0.0;
        float stepScale = (rayLen * 0.25) * 0.026;
        for (int i = 0; i < 4; i++) {
          float t = ((float(i) + 0.5) * 0.25) * rayLen;
          vec3 sampleP = uCameraPos + rayDir * t;
          float distToFocus = length(sampleP - uSmokeFocusPos);
          float plumeMask = (1.0 - smoothstep(2.5, 22.0, distToFocus)) * (0.12 + uExplosionTrauma * 0.95);
          float lowMistMask = (1.0 - smoothstep(11.0, 18.0, sampleP.y)) * 0.05;
          float densityMask = plumeMask + lowMistMask;
          if (densityMask > 0.01) {
            vec3 windP = sampleP * 0.24 + vec3(uTime * 0.45, -uTime * 0.65, uTime * 0.25);
            float n = noise3D(windP);
            accumSmoke += max(0.0, n - 0.38) * densityMask * stepScale;
          }
        }
        float smokeAlpha = clamp(accumSmoke * uVolumetricSmokeDensity, 0.0, 0.36);
        vec3 sunlitMist = mix(vec3(0.86, 0.93, 1.0), vec3(1.0, 0.72, 0.38), clamp(uExplosionTrauma, 0.0, 1.0));
        color = mix(color, max(color, sunlitMist), smokeAlpha * 0.65);
      }
    #endif

    // 6. Volumetric God Rays & Golden Sun Shafts (8 dithered taps instead of 14)
    #ifdef USE_GODRAYS
      if (uSunVisible > 0.01) {
        float ignDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        vec2 deltaUv = (baseUv - uSunScreenPos) * (1.0 / 8.0) * 0.85;
        vec2 marchUv = baseUv - deltaUv * ignDither;
        float illumination = 0.0;
        float decay = 1.0;
        for (int i = 0; i < 8; i++) {
          marchUv -= deltaUv;
          float d = texture2D(tDepth, clamp(marchUv, 0.001, 0.999)).x;
          illumination += step(0.997, d) * decay;
          decay *= 0.90;
        }
        float radialFalloff = 1.0 - smoothstep(0.0, 1.25, length(baseUv - uSunScreenPos));
        vec3 shaftColor = vec3(1.0, 0.94, 0.76) * (illumination * 0.125) * radialFalloff * uSunVisible * uGodRaysIntensity * 0.68;
        color += shaftColor;
      }
    #endif

    // 4. HDR Bloom & Emissive Glow
    #ifdef USE_CHEAP_BLOOM
      {
        vec2 offX = vec2(uTexelSize.x * 2.5, 0.0);
        vec2 offY = vec2(0.0, uTexelSize.y * 2.5);
        vec3 c1 = sampleScene(baseUv + offX);
        vec3 c2 = sampleScene(baseUv - offX);
        vec3 c3 = sampleScene(baseUv + offY);
        vec3 c4 = sampleScene(baseUv - offY);
        vec3 avg = color * 0.28 + (c1 + c2 + c3 + c4) * 0.18;
        float lum = dot(avg, vec3(0.2126, 0.7152, 0.0722));
        float maxCh = max(avg.r, max(avg.g, avg.b));
        float brightness = max(lum, maxCh * 0.9);
        float knee = uBloomThreshold * 0.4 + 0.0001;
        float soft = clamp(brightness - uBloomThreshold + knee, 0.0, 2.0 * knee);
        soft = (soft * soft) / (4.0 * knee);
        float contrib = max(soft, brightness - uBloomThreshold) / max(brightness, 0.0001);
        color += avg * clamp(contrib, 0.0, 2.2) * (uBloomStrength * 0.78);
      }
    #elif defined(USE_BLOOM)
      color += texture2D(tBloom, baseUv).rgb * (uBloomStrength * 0.78);
    #endif

    // 11. Temporal Anti-Aliasing (TAA) with Velocity Reprojection & 5-Tap Neighborhood Clamping
    #ifdef USE_TAA
      {
        vec3 n1 = sampleScene(baseUv + vec2(uTexelSize.x, 0.0));
        vec3 n2 = sampleScene(baseUv - vec2(uTexelSize.x, 0.0));
        vec3 n3 = sampleScene(baseUv + vec2(0.0, uTexelSize.y));
        vec3 n4 = sampleScene(baseUv - vec2(0.0, uTexelSize.y));
        vec3 nMin = min(color, min(min(n1, n2), min(n3, n4)));
        vec3 nMax = max(color, max(max(n1, n2), max(n3, n4)));

        bool blendedTemporal = false;
        if (uTaaHistoryValid == 1) {
          vec4 prevClip = uPrevViewProjMatrix * vec4(worldPos, 1.0);
          if (prevClip.w > 0.01) {
            vec2 prevUv = (prevClip.xy / prevClip.w) * 0.5 + 0.5;
            if (prevUv.x >= 0.002 && prevUv.x <= 0.998 && prevUv.y >= 0.002 && prevUv.y <= 0.998) {
              vec3 histCol = clamp(texture2D(tHistory, prevUv).rgb, nMin, nMax);
              color = mix(color, histCol, clamp(uTaaBlendFactor, 0.0, 0.92));
              blendedTemporal = true;
            }
          }
        }
        if (!blendedTemporal) {
          float lumaM = dot(color, vec3(0.299, 0.587, 0.114));
          float luma1 = dot(n1, vec3(0.299, 0.587, 0.114));
          float luma2 = dot(n2, vec3(0.299, 0.587, 0.114));
          float luma3 = dot(n3, vec3(0.299, 0.587, 0.114));
          float luma4 = dot(n4, vec3(0.299, 0.587, 0.114));
          float lumaContrast = max(lumaM, max(max(luma1, luma2), max(luma3, luma4))) -
                               min(lumaM, min(min(luma1, luma2), min(luma3, luma4)));
          if (lumaContrast > 0.06) {
            vec3 avgNeighbor = 0.25 * (n1 + n2 + n3 + n4);
            float edgeBlend = clamp((lumaContrast - 0.06) * 1.5, 0.0, 0.35) * clamp(uTaaBlendFactor, 0.0, 1.0);
            color = mix(color, avgNeighbor, edgeBlend);
          }
        }
      }
    #endif

    // 13. Tiered Color Grading & ACES Filmic Contrast Curve (properly calibrated for true sRGB input)
    #if VISUAL_TIER == 1
      {
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, 1.05);
      }
    #elif VISUAL_TIER == 2
      {
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, 1.12);
        color = clamp((color - 0.5) * 1.07 + 0.505, 0.0, 1.0);
        color *= mix(vec3(0.97, 0.99, 1.02), vec3(1.03, 1.01, 0.97), clamp(luma, 0.0, 1.0));
      }
    #elif VISUAL_TIER >= 3
      {
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, 1.16);
        vec3 shadowTint = vec3(0.94, 0.97, 1.04);
        vec3 highlightTint = vec3(1.05, 1.02, 0.96);
        color *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, luma));
        color = clamp((color - 0.5) * 1.09 + 0.51, 0.0, 1.0);
      }
    #endif

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

const BLIT_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tInput;
  void main() {
    gl_FragColor = texture2D(tInput, vUv);
  }
`;

const PLANAR_MIRROR_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWorldPos;
  varying vec4 vScreenPos;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    vScreenPos = projectionMatrix * viewMatrix * worldPosition;
    gl_Position = vScreenPos;
    #include <logdepthbuf_vertex>
  }
`;

const PLANAR_MIRROR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>
  varying vec3 vWorldPos;
  varying vec4 vScreenPos;
  uniform sampler2D tReflection;
  uniform vec3 uCamPos;
  uniform vec3 uFocusPos;
  uniform float uMaxWaterDist;
  uniform float uTime;

  void main() {
    #include <logdepthbuf_fragment>
    float distFromFocus = length(vWorldPos.xz - uFocusPos.xz);
    if (distFromFocus > uMaxWaterDist) {
      discard;
    }
    bool inWestOcean = vWorldPos.x < -30.0 && vWorldPos.z < 30.0;
    bool inInlandPond = length(vWorldPos.xz - vec2(65.0, -85.0)) < 17.2;
    bool inOuterArchipelago = length(vWorldPos.xz) > 105.0;
    if (!inWestOcean && !inInlandPond && !inOuterArchipelago) {
      discard;
    }

    float horizonFade = 1.0 - smoothstep(uMaxWaterDist * 0.68, uMaxWaterDist, distFromFocus);
    vec2 ndc = (vScreenPos.xy / max(0.0001, vScreenPos.w)) * 0.5 + 0.5;
    vec2 ripple = vec2(
      sin(vWorldPos.x * 1.35 + uTime * 2.4) + cos(vWorldPos.z * 1.15 - uTime * 1.9),
      cos(vWorldPos.x * 1.05 - uTime * 2.1) + sin(vWorldPos.z * 1.45 + uTime * 2.6)
    ) * 0.0035;
    vec2 reflUv = clamp(vec2(ndc.x, ndc.y) + ripple, 0.002, 0.998);
    // Custom WebGL2 engine already renders sRGB into tReflection — no double-gamma!
    vec3 reflCol = texture2D(tReflection, reflUv).rgb;
    vec3 viewDir = normalize(uCamPos - vWorldPos);
    float fresnel = pow(1.0 - clamp(abs(viewDir.y), 0.0, 1.0), 2.2);
    vec3 waterTint = vec3(0.12, 0.54, 0.88);
    vec3 finalCol = mix(waterTint, reflCol, clamp(0.45 + fresnel * 0.52, 0.35, 0.94));
    float alpha = clamp(0.38 + fresnel * 0.42, 0.30, 0.76) * horizonFade;
    gl_FragColor = vec4(finalCol, alpha);
  }
`;

const _sunWorldPos = new THREE.Vector3();
const _sunProjected = new THREE.Vector3();
const _invViewProj = new THREE.Matrix4();
const _currViewProj = new THREE.Matrix4();
const _planarReflViewProj = new THREE.Matrix4();
const _camDir = new THREE.Vector3();
const _waterClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(WATER_LEVEL - 0.15));

export class VoxelGraphicsPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;

  private sceneTarget: THREE.WebGLRenderTarget;
  private bloomBrightTarget: THREE.WebGLRenderTarget;
  private bloomBlurHTarget: THREE.WebGLRenderTarget;
  private bloomBlurVTarget: THREE.WebGLRenderTarget;
  private taaTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private taaIndex = 0;
  private hasTaaHistory = false;
  private frameCounter = 0;

  // Real-time planar mirror reflections
  private planarReflectionTarget: THREE.WebGLRenderTarget;
  private planarCamera: THREE.PerspectiveCamera;
  private hasPlanarReflection = false;
  public planarMirrorMesh: THREE.Mesh;
  private planarMirrorMat: THREE.ShaderMaterial;

  // Post-processing fullscreen quad scene & materials
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private quadMesh: THREE.Mesh;
  private bloomExtractMat: THREE.ShaderMaterial;
  private bloomBlurMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private blitMat: THREE.ShaderMaterial;
  private activeCompositeKey = 'composite_v2_0';
  private prewarmTimerId: number | null = null;
  private disposed = false;

  private prevViewProjMatrix = new THREE.Matrix4();
  private hasPrevViewProj = false;
  private currentPlanarRes = 512;
  private width = 1280;
  private height = 720;
  private savedFog: THREE.Fog | THREE.FogExp2 | null = null;
  public worldGenMode = 'DEFAULT_PARK';

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    sunLight: THREE.DirectionalLight,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sunLight = sunLight;

    const w = Math.max(64, window.innerWidth);
    const h = Math.max(64, window.innerHeight);
    this.width = 16;
    this.height = 16;

    // Initialize offscreen post-processing targets at minimal 16x16 footprint;
    // they are resized to full viewport dimensions only when hasActivePostProcessing(settings) is true.
    const depthTexture = new THREE.DepthTexture(16, 16);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;

    this.sceneTarget = new THREE.WebGLRenderTarget(16, 16, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      depthTexture,
    });

    this.bloomBrightTarget = new THREE.WebGLRenderTarget(16, 16, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
    this.bloomBlurHTarget = new THREE.WebGLRenderTarget(16, 16, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
    this.bloomBlurVTarget = new THREE.WebGLRenderTarget(16, 16, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });

    this.taaTargets = [
      new THREE.WebGLRenderTarget(16, 16, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
      }),
      new THREE.WebGLRenderTarget(16, 16, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
      }),
    ];

    // 14. Real-Time Planar Mirror Reflection Target & Plane (lazy-sized when enabled)
    this.planarReflectionTarget = new THREE.WebGLRenderTarget(16, 16, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    this.currentPlanarRes = 16;
    this.planarCamera = camera.clone();

    this.planarMirrorMat = new THREE.ShaderMaterial({
      vertexShader: PLANAR_MIRROR_VERTEX_SHADER,
      fragmentShader: PLANAR_MIRROR_FRAGMENT_SHADER,
      uniforms: {
        tReflection: { value: this.planarReflectionTarget.texture },
        uCamPos: { value: new THREE.Vector3() },
        uFocusPos: { value: new THREE.Vector3() },
        uMaxWaterDist: { value: 64.0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    const mirrorGeo = new THREE.PlaneGeometry(640, 640);
    mirrorGeo.rotateX(-Math.PI / 2);
    this.planarMirrorMesh = new THREE.Mesh(mirrorGeo, this.planarMirrorMat);
    this.planarMirrorMesh.position.set(0, WATER_LEVEL + 0.04, 0);
    this.planarMirrorMesh.renderOrder = 4;
    this.planarMirrorMesh.visible = false;
    this.scene.add(this.planarMirrorMesh);

    // Fullscreen Post-Processing Quad
    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);

    this.bloomExtractMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: BLOOM_EXTRACT_FRAGMENT_SHADER,
      uniforms: {
        tColor: { value: this.sceneTarget.texture },
        uThreshold: { value: 0.65 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.bloomBlurMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: BLOOM_BLUR_FRAGMENT_SHADER,
      uniforms: {
        tInput: { value: null },
        uDirection: { value: new THREE.Vector2(1 / Math.max(32, Math.floor(w * 0.5)), 0) },
      },
      depthTest: false,
      depthWrite: false,
    });

    const initSpec = computeCompositeFeatureKey(GRAPHICS_PRESETS.MEDIUM, false);
    this.activeCompositeKey = initSpec.key;

    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: COMPOSITE_POST_FRAGMENT_SHADER,
      defines: initSpec.defines,
      uniforms: {
        tColor: { value: this.sceneTarget.texture },
        tDepth: { value: this.sceneTarget.depthTexture },
        tBloom: { value: this.bloomBlurVTarget.texture },
        tHistory: { value: this.taaTargets[0].texture },
        uResolution: { value: new THREE.Vector2(w, h) },
        uTexelSize: { value: new THREE.Vector2(1 / w, 1 / h) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uUseLogDepth: { value: renderer.capabilities.logarithmicDepthBuffer ? 1.0 : 0.0 },
        uTime: { value: 0 },

        uSsaoIntensity: { value: 0.8 },
        uSsaoRadius: { value: 1.0 },

        uSsrIntensity: { value: 0.6 },

        uBloomStrength: { value: 0.8 },
        uBloomThreshold: { value: 0.65 },

        uGodRaysIntensity: { value: 0.6 },
        uSunScreenPos: { value: new THREE.Vector2(0.5, 0.8) },
        uSunVisible: { value: 1.0 },

        uMotionBlurStrength: { value: 0.45 },
        uInvViewProjMatrix: { value: new THREE.Matrix4() },
        uPrevViewProjMatrix: { value: new THREE.Matrix4() },

        uDofFocusDistance: { value: 26.0 },
        uDofAperture: { value: 0.6 },

        uVolumetricSmokeDensity: { value: 0.8 },
        uCameraPos: { value: new THREE.Vector3() },
        uSmokeFocusPos: { value: new THREE.Vector3() },
        uExplosionTrauma: { value: 0.0 },

        uContactShadowsIntensity: { value: 0.6 },
        uSunScreenDir: { value: new THREE.Vector2(0.4, 0.7) },

        uTaaHistoryValid: { value: 0 },
        uTaaBlendFactor: { value: 0.82 },

        uChromaticIntensity: { value: 0.3 },
        uLensDistortion: { value: 0.0 },
        uWorldGenMode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    // Key compiled variants by feature bitmask so switching between MEDIUM / HIGH / ULTRA
    // reuses cached WebGLPrograms with zero shader destruction or recompilation.
    this.compositeMat.customProgramCacheKey = () => this.activeCompositeKey;

    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: BLIT_FRAGMENT_SHADER,
      uniforms: {
        tInput: { value: null },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quadMesh = new THREE.Mesh(quadGeo, this.compositeMat);
    this.quadScene.add(this.quadMesh);
  }

  /**
   * Incrementally pre-warms specialized composite shader programs for MEDIUM, HIGH,
   * and ULTRA during idle browser slices so preset switching never stalls.
   */
  public schedulePresetShaderPrewarm(isHeadless = false): void {
    // Only pre-warm the currently active post-processing shader if needed; avoid synchronous
    // multi-preset GLSL compilation hitches on PENTIUM / LOW / CARTOON or during startup.
    if (isHeadless || this.disposed || typeof window === 'undefined') return;
    if (this.prewarmTimerId !== null) {
      window.clearTimeout(this.prewarmTimerId);
      this.prewarmTimerId = null;
    }
  }

  public getPlanarReflectionTexture(): THREE.Texture | null {
    return this.hasPlanarReflection ? this.planarReflectionTarget.texture : null;
  }

  public getPlanarReflViewProj(): THREE.Matrix4 {
    return _planarReflViewProj;
  }

  public applySettings(settings: GraphicsSettings, isHeadless = false): void {
    // 1. Custom WebGL2 engine uses instanced Blob Shadow sprites (not GPU shadow maps)
    this.renderer.shadowMap.enabled = false;
    this.sunLight.castShadow = false;

    // 5. Resolution Scale / Super-Sampling (HiDPI devicePixelRatio * resolutionScale)
    const isInIframe = (() => {
      try {
        return typeof window !== 'undefined' && window.self !== window.top;
      } catch {
        return true;
      }
    })();
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const isLowEndPreset =
      settings.usePotatoShader ||
      settings.preset === 'PENTIUM' ||
      settings.preset === 'LOW';
    const effectiveDpr = isLowEndPreset
      ? 1
      : Math.min(rawDpr, isInIframe ? 1.25 : 1.5);
    const pixelRatio = resolveEffectivePixelRatio(
      settings.resolutionScale,
      effectiveDpr,
      isHeadless,
    );
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (hasActivePostProcessing(settings)) {
      this.resizeTargets(window.innerWidth, window.innerHeight, pixelRatio);
    } else if (this.width > 16 || this.height > 16) {
      this.width = 16;
      this.height = 16;
      this.hasTaaHistory = false;
      this.sceneTarget.setSize(16, 16);
      this.bloomBrightTarget.setSize(16, 16);
      this.bloomBlurHTarget.setSize(16, 16);
      this.bloomBlurVTarget.setSize(16, 16);
      this.taaTargets[0].setSize(16, 16);
      this.taaTargets[1].setSize(16, 16);
    }

    // 14. Planar Reflection Resolution
    const targetPlanarRes =
      settings.planarReflectionsEnabled && !isHeadless
        ? settings.planarReflectionResolution
        : 16;
    if (this.currentPlanarRes !== targetPlanarRes) {
      this.currentPlanarRes = targetPlanarRes;
      this.planarReflectionTarget.setSize(targetPlanarRes, targetPlanarRes);
      this.hasPlanarReflection = false;
    }
    if (!settings.planarReflectionsEnabled || isHeadless) {
      this.hasPlanarReflection = false;
    }
    // Realistic ocean water shader renders planar reflections directly across displaced waves
    this.planarMirrorMesh.visible = false;

    if (!settings.taaEnabled || isHeadless) {
      this.hasTaaHistory = false;
    }

    // 17. Scene Fog Toggle
    if (this.scene.fog && !this.savedFog) {
      this.savedFog = this.scene.fog;
    }
    if (settings.fog === false) {
      this.scene.fog = null;
    } else if (!this.scene.fog && this.savedFog) {
      this.scene.fog = this.savedFog;
    }
  }

  public resizeTargets(
    cssWidth: number,
    cssHeight: number,
    pixelRatio = this.renderer.getPixelRatio(),
  ): void {
    const effW = Math.max(64, Math.floor(cssWidth * pixelRatio));
    const effH = Math.max(64, Math.floor(cssHeight * pixelRatio));
    if (effW === this.width && effH === this.height) return;
    this.width = effW;
    this.height = effH;
    this.hasTaaHistory = false;

    this.sceneTarget.setSize(effW, effH);
    const halfW = Math.max(32, Math.floor(effW * 0.5));
    const halfH = Math.max(32, Math.floor(effH * 0.5));
    this.bloomBrightTarget.setSize(halfW, halfH);
    this.bloomBlurHTarget.setSize(halfW, halfH);
    this.bloomBlurVTarget.setSize(halfW, halfH);
    this.taaTargets[0].setSize(effW, effH);
    this.taaTargets[1].setSize(effW, effH);

    this.compositeMat.uniforms.uResolution.value.set(effW, effH);
    this.compositeMat.uniforms.uTexelSize.value.set(1 / effW, 1 / effH);
  }

  public render(
    settings: GraphicsSettings,
    timeSec: number,
    focusPos: THREE.Vector3,
    vehicleSpeedMPS: number,
    explosionTrauma: number,
    isHeadless = false,
    worldGenMode = this.worldGenMode,
    oceanUniforms?: {
      uRealisticWater: { value: number };
      uHasPlanarTex: { value: number };
      uPlanarTex: { value: THREE.Texture | null };
      uReflViewProj: { value: THREE.Matrix4 };
      uPlanarStrength: { value: number };
      uWaterOutputSrgb: { value: number };
      uWorldGenMode: { value: number };
      uRenderingPlanar: { value: number };
    },
  ): void {
    this.frameCounter++;
    this.worldGenMode = worldGenMode;
    this.planarMirrorMesh.visible = false;
    (this.renderer as any).currentTime = timeSec;

    const useRealisticWater = shouldUseRealisticWater(settings);
    const hasPostFx = hasActivePostProcessing(settings);

    if (oceanUniforms) {
      oceanUniforms.uRealisticWater.value = useRealisticWater ? 1.0 : 0.0;
      oceanUniforms.uWorldGenMode.value = worldGenModeToShaderId(worldGenMode);
      oceanUniforms.uWaterOutputSrgb.value = 0.0;
    }

    // 14. Real-Time Planar Mirror Reflections Pass (sampled directly by realistic water shader!)
    const hasWaterInMode =
      worldGenMode === 'DEFAULT_PARK' ||
      worldGenMode === 'BIOME_CANYON' ||
      worldGenMode === 'BIOME_ARCHIPELAGO' ||
      worldGenMode === 'CUSTOM_GLB_MAP';
    const nearWaterBasin =
      worldGenMode !== 'DEFAULT_PARK' ||
      focusPos.x < -8.0 ||
      Math.hypot(focusPos.x - 65.0, focusPos.z - -85.0) < 85.0;
    if (settings.planarReflectionsEnabled && !isHeadless && hasWaterInMode && nearWaterBasin) {
      if (
        (!this.hasPlanarReflection || this.frameCounter % 2 === 0) &&
        this.camera.position.y > WATER_LEVEL - 0.5
      ) {
        if (oceanUniforms) {
          oceanUniforms.uHasPlanarTex.value = 0.0;
          oceanUniforms.uPlanarTex.value = null;
          oceanUniforms.uRenderingPlanar.value = 1.0;
        }
        this.planarCamera.copy(this.camera);
        this.planarCamera.clearViewOffset();
        this.planarCamera.position.set(
          this.camera.position.x,
          2.0 * WATER_LEVEL - this.camera.position.y,
          this.camera.position.z,
        );
        this.camera.getWorldDirection(_camDir);
        _camDir.y = -_camDir.y;
        this.planarCamera.up.set(0, 1, 0);
        this.planarCamera.lookAt(
          this.planarCamera.position.x + _camDir.x * 25.0,
          this.planarCamera.position.y + _camDir.y * 25.0,
          this.planarCamera.position.z + _camDir.z * 25.0,
        );
        this.planarCamera.updateMatrixWorld();
        this.planarCamera.updateProjectionMatrix();
        _planarReflViewProj.multiplyMatrices(
          this.planarCamera.projectionMatrix,
          this.planarCamera.matrixWorldInverse,
        );

        const prevTarget = this.renderer.getRenderTarget();
        const prevClip = this.renderer.clippingPlanes;
        const prevShadowAuto = this.renderer.shadowMap.autoUpdate;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.clippingPlanes = [_waterClipPlane];
        this.renderer.setRenderTarget(this.planarReflectionTarget);
        this.renderer.clear();
        this.renderer.render(this.scene, this.planarCamera);
        this.renderer.clippingPlanes = prevClip;
        this.renderer.shadowMap.autoUpdate = prevShadowAuto;
        this.renderer.setRenderTarget(prevTarget);
        if (oceanUniforms) {
          oceanUniforms.uRenderingPlanar.value = 0.0;
        }
        this.hasPlanarReflection = true;
      }
    } else {
      this.hasPlanarReflection = false;
    }

    if (oceanUniforms) {
      oceanUniforms.uRenderingPlanar.value = 0.0;
      const canUsePlanar =
        settings.planarReflectionsEnabled &&
        !isHeadless &&
        this.hasPlanarReflection;
      oceanUniforms.uHasPlanarTex.value = canUsePlanar ? 1.0 : 0.0;
      oceanUniforms.uPlanarTex.value = canUsePlanar
        ? this.planarReflectionTarget.texture
        : null;
      oceanUniforms.uReflViewProj.value.copy(_planarReflViewProj);
      oceanUniforms.uPlanarStrength.value = 0.85;
      oceanUniforms.uWaterOutputSrgb.value = 0.0;
    }

    // Direct render path when no screen-space post-processing is enabled (PENTIUM, CARTOON, LOW)
    if (!hasPostFx) {
      this.camera.clearViewOffset();
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      this.hasTaaHistory = false;
      return;
    }

    if (this.width <= 16 || this.height <= 16) {
      this.resizeTargets(
        window.innerWidth,
        window.innerHeight,
        this.renderer.getPixelRatio(),
      );
    }

    const useTaaPass = settings.taaEnabled && !isHeadless;
    const { jx, jy } = useTaaPass ? computeHaltonJitter(this.frameCounter) : { jx: 0, jy: 0 };
    if (useTaaPass) {
      this.camera.setViewOffset(
        this.width,
        this.height,
        jx * 0.65,
        jy * 0.65,
        this.width,
        this.height,
      );
    }

    // Render primary 3D scene + depth texture into sceneTarget
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    if (useTaaPass) {
      this.camera.clearViewOffset();
    }

    // 4. HDR Bloom Bright-Pass + Separable Gaussian Blur (skipped when cheapBloom single-pass is active)
    if (settings.bloomEnabled && !settings.cheapBloom) {
      const halfW = this.bloomBrightTarget.width;
      const halfH = this.bloomBrightTarget.height;
      this.bloomExtractMat.uniforms.tColor.value = this.sceneTarget.texture;
      this.bloomExtractMat.uniforms.uThreshold.value = settings.bloomThreshold;
      this.quadMesh.material = this.bloomExtractMat;
      this.renderer.setRenderTarget(this.bloomBrightTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.bloomBlurMat.uniforms.tInput.value = this.bloomBrightTarget.texture;
      this.bloomBlurMat.uniforms.uDirection.value.set(1.0 / halfW, 0.0);
      this.quadMesh.material = this.bloomBlurMat;
      this.renderer.setRenderTarget(this.bloomBlurHTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.bloomBlurMat.uniforms.tInput.value = this.bloomBlurHTarget.texture;
      this.bloomBlurMat.uniforms.uDirection.value.set(0.0, 1.0 / halfH);
      this.renderer.setRenderTarget(this.bloomBlurVTarget);
      this.renderer.render(this.quadScene, this.quadCamera);
    }

    // Select compile-time specialized composite shader variant for active feature flags
    const featureSpec = computeCompositeFeatureKey(settings, useTaaPass);
    if (featureSpec.key !== this.activeCompositeKey) {
      this.activeCompositeKey = featureSpec.key;
      this.compositeMat.defines = featureSpec.defines;
    }

    // Only compute view-projection inverse when the active composite shader variant uses it
    const needsWorldMatrices = Boolean(
      featureSpec.defines.NEEDS_WORLD_POS ||
        featureSpec.defines.USE_MOTION_BLUR ||
        featureSpec.defines.USE_TAA,
    );
    if (needsWorldMatrices) {
      _currViewProj.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      );
      _invViewProj.copy(_currViewProj).invert();
      if (!this.hasPrevViewProj) {
        this.prevViewProjMatrix.copy(_currViewProj);
        this.hasPrevViewProj = true;
      }
    }

    const readTaaTarget = this.taaTargets[this.taaIndex];
    const writeTaaTarget = this.taaTargets[1 - this.taaIndex];

    const u = this.compositeMat.uniforms;
    u.tColor.value = this.sceneTarget.texture;
    u.tDepth.value = this.sceneTarget.depthTexture;
    u.tBloom.value = this.bloomBlurVTarget.texture;
    u.tHistory.value = readTaaTarget.texture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uTime.value = timeSec;

    u.uSsaoIntensity.value = settings.ssaoIntensity;
    u.uSsaoRadius.value = settings.ssaoRadius;

    u.uSsrIntensity.value = settings.ssrIntensity;

    u.uBloomStrength.value = settings.bloomStrength;
    u.uBloomThreshold.value = settings.bloomThreshold;

    if (featureSpec.defines.USE_GODRAYS || featureSpec.defines.USE_CONTACT_SHADOWS) {
      _sunWorldPos
        .copy(this.sunLight.position)
        .sub(this.sunLight.target.position)
        .normalize()
        .multiplyScalar(300.0)
        .add(this.camera.position);
      _sunProjected.copy(_sunWorldPos).project(this.camera);
      const sunScreenX = _sunProjected.x * 0.5 + 0.5;
      const sunScreenY = _sunProjected.y * 0.5 + 0.5;
      this.camera.getWorldDirection(_camDir);
      const sunDirWorld = _sunWorldPos.sub(this.camera.position).normalize();
      const sunForwardDot = Math.max(0, _camDir.dot(sunDirWorld));

      u.uGodRaysIntensity.value = settings.godRaysIntensity;
      u.uSunScreenPos.value.set(sunScreenX, sunScreenY);
      u.uSunVisible.value = sunForwardDot;

      u.uContactShadowsIntensity.value = settings.contactShadowsIntensity;
      const sunDir2D = u.uSunScreenDir.value as THREE.Vector2;
      sunDir2D.set(sunScreenX - 0.5, sunScreenY - 0.5);
      if (sunDir2D.lengthSq() > 1e-4) {
        sunDir2D.normalize();
      } else {
        sunDir2D.set(0.5, 0.86);
      }
    }

    if (needsWorldMatrices) {
      const speedBlurFactor = Math.min(1.0, Math.max(0.0, (vehicleSpeedMPS - 8.0) / 22.0));
      u.uMotionBlurStrength.value =
        settings.motionBlurEnabled && speedBlurFactor > 0.01
          ? settings.motionBlurStrength * speedBlurFactor
          : 0.0;
      u.uInvViewProjMatrix.value.copy(_invViewProj);
      u.uPrevViewProjMatrix.value.copy(this.prevViewProjMatrix);
    }

    u.uDofFocusDistance.value = settings.dofFocusDistance;
    u.uDofAperture.value = settings.dofAperture;

    u.uVolumetricSmokeDensity.value = settings.volumetricSmokeDensity;
    u.uCameraPos.value.copy(this.camera.position);
    u.uSmokeFocusPos.value.copy(focusPos);
    u.uExplosionTrauma.value = explosionTrauma;

    u.uTaaHistoryValid.value = useTaaPass && this.hasTaaHistory ? 1 : 0;
    u.uTaaBlendFactor.value = settings.taaBlendFactor;

    const speedBoostCA = Math.min(0.65, vehicleSpeedMPS * 0.012) + explosionTrauma * 0.85;
    u.uChromaticIntensity.value =
      settings.chromaticAberrationIntensity + speedBoostCA * 0.5;
    u.uLensDistortion.value = settings.lensDistortion;
    u.uWorldGenMode.value = worldGenModeToShaderId(worldGenMode);

    this.quadMesh.material = this.compositeMat;
    if (useTaaPass) {
      this.renderer.setRenderTarget(writeTaaTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      // Prefer hardware WebGL2 gl.blitFramebuffer over a second fullscreen quad pass
      const blitted =
        typeof (this.renderer as any).blitToScreen === 'function' &&
        (this.renderer as any).blitToScreen(writeTaaTarget) === true;
      if (!blitted) {
        this.blitMat.uniforms.tInput.value = writeTaaTarget.texture;
        this.quadMesh.material = this.blitMat;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.quadScene, this.quadCamera);
      }

      this.taaIndex = 1 - this.taaIndex;
      this.hasTaaHistory = true;
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.quadScene, this.quadCamera);
      this.hasTaaHistory = false;
    }

    if (needsWorldMatrices) {
      this.prevViewProjMatrix.copy(_currViewProj);
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.prewarmTimerId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.prewarmTimerId);
      this.prewarmTimerId = null;
    }
    this.sceneTarget.dispose();
    this.sceneTarget.depthTexture?.dispose();
    this.bloomBrightTarget.dispose();
    this.bloomBlurHTarget.dispose();
    this.bloomBlurVTarget.dispose();
    this.taaTargets[0].dispose();
    this.taaTargets[1].dispose();
    this.planarReflectionTarget.dispose();
    this.planarMirrorMesh.geometry.dispose();
    this.planarMirrorMat.dispose();
    this.quadMesh.geometry.dispose();
    this.bloomExtractMat.dispose();
    this.bloomBlurMat.dispose();
    this.compositeMat.dispose();
    this.blitMat.dispose();
  }
}
