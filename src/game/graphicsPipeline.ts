import * as THREE from 'three';
import { WATER_LEVEL } from './constants.ts';
import {
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

const BLOOM_EXTRACT_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp int;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float uThreshold;
  uniform int uSceneIsAlreadySrgb;

  vec3 toSrgbIfLit(vec3 rawCol, float rawDepth) {
    if (rawDepth > 0.9992 || uSceneIsAlreadySrgb == 1) return rawCol;
    return pow(max(rawCol, vec3(0.0)), vec3(1.0 / 2.2));
  }

  void main() {
    float d = texture2D(tDepth, vUv).x;
    vec3 col = toSrgbIfLit(texture2D(tColor, vUv).rgb, d);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float maxCh = max(col.r, max(col.g, col.b));
    float brightness = max(lum, maxCh * 0.9);
    float knee = uThreshold * 0.4 + 0.0001;
    float soft = clamp(brightness - uThreshold + knee, 0.0, 2.0 * knee);
    soft = (soft * soft) / (4.0 * knee);
    float contrib = max(soft, brightness - uThreshold) / max(brightness, 0.0001);
    gl_FragColor = vec4(col * clamp(contrib, 0.0, 3.5), 1.0);
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

const COMPOSITE_POST_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tBloom;
  uniform sampler2D tHistory;

  uniform vec2 uResolution;
  uniform vec2 uTexelSize;
  uniform float uNear;
  uniform float uFar;
  uniform float uTime;

  // 2. SSAO
  uniform int uSsaoEnabled;
  uniform float uSsaoIntensity;
  uniform float uSsaoRadius;

  // 3. SSR
  uniform int uSsrEnabled;
  uniform float uSsrIntensity;

  // 4. HDR Bloom (Standard Multi-Pass & Single-Pass Cheap Bloom for PENTIUM)
  uniform int uBloomEnabled;
  uniform int uCheapBloomEnabled;
  uniform float uBloomStrength;
  uniform float uBloomThreshold;

  // 6. Volumetric God Rays
  uniform int uGodRaysEnabled;
  uniform float uGodRaysIntensity;
  uniform vec2 uSunScreenPos;
  uniform float uSunVisible;

  // 7. Motion Blur
  uniform int uMotionBlurEnabled;
  uniform float uMotionBlurStrength;
  uniform mat4 uInvViewProjMatrix;
  uniform mat4 uPrevViewProjMatrix;

  // 8. Bokeh Depth of Field
  uniform int uDofEnabled;
  uniform float uDofFocusDistance;
  uniform float uDofAperture;

  // 9. Volumetric Smoke & Dust Raymarching
  uniform int uVolumetricSmokeEnabled;
  uniform float uVolumetricSmokeDensity;
  uniform vec3 uCameraPos;
  uniform vec3 uSmokeFocusPos;
  uniform float uExplosionTrauma;

  // 10. Screen-Space Contact Shadows
  uniform int uContactShadowsEnabled;
  uniform float uContactShadowsIntensity;
  uniform vec2 uSunScreenDir;

  // 11. Temporal Anti-Aliasing (TAA)
  uniform int uTaaEnabled;
  uniform int uTaaHistoryValid;
  uniform float uTaaBlendFactor;
  uniform vec2 uJitterOffset;

  // 12. Chromatic Aberration & Lens Distortion
  uniform int uChromaticEnabled;
  uniform float uChromaticIntensity;
  uniform float uLensDistortion;

  // 13. Tiered Visual Quality Grade (0 = LOW/PENTIUM/CARTOON, 1 = MEDIUM, 2 = HIGH, 3 = ULTRA)
  uniform int uVisualTier;
  uniform int uSceneIsAlreadySrgb;
  uniform int uWorldGenMode;

  // Cancellation-free depth linearization (avoids subtracting uFar - uFar at mid/far distances)
  float readLinearDepthFromRaw(float z) {
    float oneMinusZ = max(0.000001, 1.0 - z);
    return (uNear * uFar) / max(0.00001, uNear + oneMinusZ * (uFar - uNear));
  }

  float readLinearDepth(vec2 uv) {
    float z = texture2D(tDepth, clamp(uv, 0.001, 0.999)).x;
    return readLinearDepthFromRaw(z);
  }

  // Three.js disables #include <colorspace_fragment> (LinearTosRGB) when rendering into an offscreen
  // WebGLRenderTarget. Convert linear-lit 3D geometry (rawDepth <= 0.9992) to sRGB,
  // while skipping conversion when scene shaders already output sRGB (Potato / Cartoon presets).
  vec3 sampleSceneSrgb(vec2 uv) {
    vec2 cUv = clamp(uv, 0.001, 0.999);
    vec3 raw = texture2D(tColor, cUv).rgb;
    float d = texture2D(tDepth, cUv).x;
    if (d > 0.9992 || uSceneIsAlreadySrgb == 1) {
      return raw;
    }
    vec3 srgb = pow(max(raw, vec3(0.0)), vec3(1.0 / 2.2));
    return srgb * 1.08;
  }

  bool isWaterSurfaceWorld(vec3 wp, vec3 srgbCol) {
    if (wp.y < 13.4 || wp.y > 15.65) return false;
    // Reject neutral/dark asphalt roads, yellow sand beaches, and green grass land
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

  vec3 reconstructWorldPos(vec2 uv, float rawDepth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    vec4 world = uInvViewProjMatrix * ndc;
    return world.xyz / max(0.0001, world.w);
  }

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

  void main() {
    // 12A. Lens Distortion (Barrel / Pincushion)
    vec2 centeredUv = vUv - 0.5;
    float r2 = dot(centeredUv, centeredUv);
    vec2 baseUv = vUv;
    if (abs(uLensDistortion) > 0.001) {
      baseUv = 0.5 + centeredUv * (1.0 + uLensDistortion * r2 + uLensDistortion * 0.5 * r2 * r2);
      baseUv = clamp(baseUv, 0.001, 0.999);
    }

    float rawDepth = texture2D(tDepth, baseUv).x;
    float linearDepth = readLinearDepthFromRaw(rawDepth);
    bool isSky = rawDepth > 0.9992;
    vec3 worldPos = isSky
      ? reconstructWorldPos(baseUv, 0.995)
      : reconstructWorldPos(baseUv, rawDepth);

    // 12B. Chromatic Aberration & Base Color Fetch (in sRGB display space)
    vec3 color;
    if (uChromaticEnabled == 1 && uChromaticIntensity > 0.001) {
      vec2 caOffset = centeredUv * (0.0035 * uChromaticIntensity * (0.3 + r2 * 1.8));
      float r = sampleSceneSrgb(baseUv + caOffset).r;
      float g = sampleSceneSrgb(baseUv).g;
      float b = sampleSceneSrgb(baseUv - caOffset).b;
      color = vec3(r, g, b);
    } else {
      color = sampleSceneSrgb(baseUv);
    }

    // 8. Depth of Field (Bokeh DOF) — Far-Field Only with Depth-Discontinuity Rejection
    // Never blurs sky pixels or gameplay foreground (< 38m), and weights samples by depth similarity
    // so airborne debris cubes never bleed square halos onto the sky!
    if (uDofEnabled == 1 && !isSky) {
      float focusStart = max(uDofFocusDistance, 38.0);
      float coc = clamp((linearDepth - focusStart) * uDofAperture * 0.014, 0.0, 0.75);
      if (coc > 0.05) {
        vec3 bokehAcc = color;
        float totalW = 1.0;
        vec2 blurRad = uTexelSize * coc * 4.5;
        for (int i = 0; i < 8; i++) {
          float fi = float(i);
          float ang = fi * 2.3999632;
          float rad = sqrt((fi + 0.5) / 8.0);
          vec2 sampleUv = clamp(baseUv + vec2(cos(ang), sin(ang)) * rad * blurRad, 0.001, 0.999);
          float sampleRawDepth = texture2D(tDepth, sampleUv).x;
          if (sampleRawDepth > 0.9992) continue;
          float sampleDepth = readLinearDepthFromRaw(sampleRawDepth);
          float depthWeight = 1.0 - smoothstep(0.35, 4.0, abs(sampleDepth - linearDepth));
          float sampleCoc = clamp((sampleDepth - focusStart) * uDofAperture * 0.014, 0.0, 0.75);
          float w = mix(0.25, 1.0, sampleCoc) * depthWeight;
          if (w > 0.01) {
            bokehAcc += sampleSceneSrgb(sampleUv) * w;
            totalW += w;
          }
        }
        color = bokehAcc / totalW;
      }
    }

    // 7. Motion Blur (Camera & Vehicle Velocity Space with Depth-Edge Guard)
    if (uMotionBlurEnabled == 1 && !isSky) {
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
          mbAcc += sampleSceneSrgb(tapUv) * w;
          mbWeight += w;
        }
        color = mbAcc / mbWeight;
      }
    }

    // 2. Screen-Space Ambient Occlusion (SSAO) — 3D World-Space Vertical Crease Detector
    if (uSsaoEnabled == 1 && !isSky && linearDepth < 38.0) {
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
        if (valleyDiff > minCrease && valleyDiff < 1.25) {
          vec3 pPos = reconstructWorldPos(uvPos, rawPos);
          vec3 pNeg = reconstructWorldPos(uvNeg, rawNeg);
          float verticalRise = max(pPos.y, pNeg.y) - worldPos.y;
          if (verticalRise > 0.22 && abs(dPos - dNeg) > minCrease * 1.2) {
            float rangeCheck = 1.0 - smoothstep(0.18, 1.25, valleyDiff);
            occ += rangeCheck * smoothstep(0.22, 0.45, verticalRise);
          }
        }
      }
      float minAoFloor = uVisualTier >= 3 ? 0.64 : (uVisualTier == 2 ? 0.71 : 0.80);
      float aoWeight = uVisualTier >= 3 ? 0.62 : (uVisualTier == 2 ? 0.50 : 0.38);
      float ao = clamp(1.0 - (occ / 4.0) * uSsaoIntensity * distFade * aoWeight, minAoFloor, 1.0);
      color *= ao;
    }

    // 10. Screen-Space Contact Shadows — 3D World-Elevation Occluder Raymarch
    if (uContactShadowsEnabled == 1 && !isSky && linearDepth < 34.0) {
      float contactOcc = 0.0;
      float distFade = 1.0 - smoothstep(14.0, 34.0, linearDepth);
      vec2 rayStep = uSunScreenDir * uTexelSize * 2.0;
      for (int i = 1; i <= 5; i++) {
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
            contactOcc = max(contactOcc, (1.0 - fi / 6.0) * smoothstep(0.24, 0.45, verticalRise));
          }
        }
      }
      float maxContactShadow = uVisualTier >= 3 ? 0.30 : 0.22;
      color *= 1.0 - contactOcc * distFade * clamp(uContactShadowsIntensity * 0.26, 0.0, maxContactShadow);
    }

    // 10B. 3D Voxel Micro-Bevel Specular Rim & Sunlit Edge Catch (HIGH & ULTRA Tiers)
    if (uVisualTier >= 2 && !isSky && linearDepth < 42.0) {
      float dRight = readLinearDepth(baseUv + vec2(uTexelSize.x, 0.0));
      float dUp = readLinearDepth(baseUv + vec2(0.0, uTexelSize.y));
      float edgeGrad = abs(dRight - linearDepth) + abs(dUp - linearDepth);
      float voxelBevel = smoothstep(0.018, 0.12, edgeGrad) * (1.0 - smoothstep(0.22, 0.65, edgeGrad));
      float distAtten = 1.0 - smoothstep(14.0, 42.0, linearDepth);
      float lumaBase = dot(color, vec3(0.299, 0.587, 0.114));
      float sunlitMask = smoothstep(0.32, 0.78, lumaBase);
      if (uVisualTier == 2) {
        color += vec3(1.0, 0.97, 0.88) * voxelBevel * sunlitMask * distAtten * 0.09;
      } else {
        color += vec3(1.0, 0.95, 0.82) * voxelBevel * sunlitMask * distAtten * 0.15;
        color += vec3(0.55, 0.82, 1.0) * voxelBevel * (1.0 - sunlitMask) * distAtten * 0.05;
      }
    }

    // 3. Screen-Space Reflections (SSR) — Jittered Multi-step Screen-Space Raymarch on Water Surfaces Only
    if (uSsrEnabled == 1 && !isSky && isWaterSurfaceWorld(worldPos, color)) {
      vec3 hitColor = vec3(0.0);
      float hitFound = 0.0;
      float rippleX = sin(worldPos.x * 1.45 + uTime * 2.2) * 0.004;
      vec2 reflDirUv = normalize(vec2(rippleX * 2.0, 1.0));
      float ignJitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float rayStepLen = 0.036;
      for (int s = 1; s <= 8; s++) {
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
            float distFade = 1.0 - smoothstep(2.0, 8.0, float(s)) * 0.45;
            hitColor = sampleSceneSrgb(sampleUv);
            hitFound = edgeFade * distFade;
            break;
          }
        }
      }
      if (hitFound > 0.01) {
        vec3 viewV = normalize(uCameraPos - worldPos);
        float ssrFresnel = clamp(0.16 + 0.84 * pow(1.0 - max(viewV.y, 0.02), 3.0), 0.12, 0.82);
        float ssrMix = clamp(uSsrIntensity * ssrFresnel * hitFound * 0.44, 0.0, 0.52);
        color = mix(color, hitColor, ssrMix);
      }
    }

    // 9. Volumetric Smoke & Dust Raymarching — Sunlit Atmospheric Scattering
    if (uVolumetricSmokeEnabled == 1) {
      vec3 rayVec = worldPos - uCameraPos;
      float rayLen = min(length(rayVec), 85.0);
      vec3 rayDir = rayVec / max(0.001, length(rayVec));
      float accumSmoke = 0.0;
      for (int i = 0; i < 5; i++) {
        float t = ((float(i) + 0.5) / 5.0) * rayLen;
        vec3 sampleP = uCameraPos + rayDir * t;
        float distToFocus = length(sampleP - uSmokeFocusPos);
        float plumeMask = (1.0 - smoothstep(2.5, 22.0, distToFocus)) * (0.12 + uExplosionTrauma * 0.95);
        float lowMistMask = (1.0 - smoothstep(11.0, 18.0, sampleP.y)) * 0.05;
        if (plumeMask + lowMistMask > 0.01) {
          vec3 windP = sampleP * 0.24 + vec3(uTime * 0.45, -uTime * 0.65, uTime * 0.25);
          float n = noise3D(windP) * 0.65 + noise3D(windP * 2.1) * 0.35;
          accumSmoke += max(0.0, n - 0.38) * (plumeMask + lowMistMask) * (rayLen / 5.0) * 0.022;
        }
      }
      float smokeAlpha = clamp(accumSmoke * uVolumetricSmokeDensity, 0.0, 0.38);
      vec3 sunlitMist = mix(vec3(0.86, 0.93, 1.0), vec3(1.0, 0.72, 0.38), clamp(uExplosionTrauma, 0.0, 1.0));
      // Screen-like warm scattering so atmospheric dust/mist illuminates rather than darkens
      color = mix(color, max(color, sunlitMist), smokeAlpha * 0.65);
    }

    // 6. Volumetric God Rays & Golden Sun Shafts
    if (uGodRaysEnabled == 1 && uSunVisible > 0.01) {
      vec2 deltaUv = (baseUv - uSunScreenPos) * (1.0 / 14.0) * 0.85;
      vec2 marchUv = baseUv;
      float illumination = 0.0;
      float decay = 1.0;
      for (int i = 0; i < 14; i++) {
        marchUv -= deltaUv;
        float d = texture2D(tDepth, clamp(marchUv, 0.001, 0.999)).x;
        float isSkySample = step(0.997, d);
        illumination += isSkySample * decay;
        decay *= 0.94;
      }
      float radialFalloff = 1.0 - smoothstep(0.0, 1.25, length(baseUv - uSunScreenPos));
      vec3 shaftColor = vec3(1.0, 0.94, 0.76) * (illumination / 14.0) * radialFalloff * uSunVisible * uGodRaysIntensity * 0.72;
      color += shaftColor;
    }

    // 4. HDR Bloom & Emissive Glow (Multi-Pass Gaussian or Single-Pass Cheap 5-Tap for PENTIUM)
    if (uBloomEnabled == 1) {
      if (uCheapBloomEnabled == 1) {
        vec2 offX = vec2(uTexelSize.x * 2.5, 0.0);
        vec2 offY = vec2(0.0, uTexelSize.y * 2.5);
        vec3 c0 = color;
        vec3 c1 = sampleSceneSrgb(baseUv + offX);
        vec3 c2 = sampleSceneSrgb(baseUv - offX);
        vec3 c3 = sampleSceneSrgb(baseUv + offY);
        vec3 c4 = sampleSceneSrgb(baseUv - offY);
        vec3 avg = c0 * 0.28 + (c1 + c2 + c3 + c4) * 0.18;
        float lum = dot(avg, vec3(0.2126, 0.7152, 0.0722));
        float maxCh = max(avg.r, max(avg.g, avg.b));
        float brightness = max(lum, maxCh * 0.9);
        float knee = uBloomThreshold * 0.4 + 0.0001;
        float soft = clamp(brightness - uBloomThreshold + knee, 0.0, 2.0 * knee);
        soft = (soft * soft) / (4.0 * knee);
        float contrib = max(soft, brightness - uBloomThreshold) / max(brightness, 0.0001);
        color += avg * clamp(contrib, 0.0, 2.5) * (uBloomStrength * 0.85);
      } else {
        vec3 bloom = texture2D(tBloom, baseUv).rgb;
        color += bloom * (uBloomStrength * 0.85);
      }
    }

    // 11. Temporal Anti-Aliasing (TAA) with Velocity Reprojection & 5-Tap Neighborhood Clamping (Zero Ghosting)
    if (uTaaEnabled == 1) {
      vec3 n1 = sampleSceneSrgb(baseUv + vec2(uTexelSize.x, 0.0));
      vec3 n2 = sampleSceneSrgb(baseUv - vec2(uTexelSize.x, 0.0));
      vec3 n3 = sampleSceneSrgb(baseUv + vec2(0.0, uTexelSize.y));
      vec3 n4 = sampleSceneSrgb(baseUv - vec2(0.0, uTexelSize.y));
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

    // 13. Tiered Color Grading & ACES Filmic Contrast Curve (Makes MEDIUM, HIGH, and ULTRA visibly distinct!)
    if (uVisualTier == 1) {
      // MEDIUM: Clean, balanced natural daylight
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 1.04);
    } else if (uVisualTier == 2) {
      // HIGH: Cinematic HD — Crisp S-curve contrast, vibrant saturation, warm sunlit highlights
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 1.12);
      color = clamp((color - 0.5) * 1.06 + 0.505, 0.0, 1.0);
      color *= mix(vec3(0.97, 0.99, 1.02), vec3(1.03, 1.01, 0.97), clamp(luma, 0.0, 1.0));
    } else if (uVisualTier >= 3) {
      // ULTRA: Photorealistic Next-Gen Showcase — Rich ACES-inspired filmic tonemap, golden-hour warmth & deep azure shadows
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 1.18);
      vec3 shadowTint = vec3(0.93, 0.97, 1.05);
      vec3 highlightTint = vec3(1.06, 1.02, 0.95);
      color *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, luma));
      color = clamp((color - 0.5) * 1.10 + 0.51, 0.0, 1.0);
    }

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
  varying vec3 vWorldPos;
  varying vec4 vScreenPos;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    vScreenPos = projectionMatrix * viewMatrix * worldPosition;
    gl_Position = vScreenPos;
  }
`;

const PLANAR_MIRROR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec3 vWorldPos;
  varying vec4 vScreenPos;
  uniform sampler2D tReflection;
  uniform vec3 uCamPos;
  uniform vec3 uFocusPos;
  uniform float uMaxWaterDist;
  uniform float uTime;

  void main() {
    // Strictly clip planar mirror to actual water basins (West Ocean or Inland Pond) and within active chunk draw distance
    // so it NEVER sticks out at the horizon beyond green terrain and NEVER appears inside dry-land craters!
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
    vec3 rawRefl = texture2D(tReflection, reflUv).rgb;
    vec3 reflCol = pow(max(rawRefl, vec3(0.0)), vec3(1.0 / 2.2)) * 1.08;
    vec3 viewDir = normalize(uCamPos - vWorldPos);
    float fresnel = pow(1.0 - clamp( abs(viewDir.y), 0.0, 1.0 ), 2.2);
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

  private prevViewProjMatrix = new THREE.Matrix4();
  private hasPrevViewProj = false;
  private currentShadowMapSize = 1024;
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
        tDepth: { value: this.sceneTarget.depthTexture },
        uThreshold: { value: 0.65 },
        uSceneIsAlreadySrgb: { value: 0 },
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

    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: COMPOSITE_POST_FRAGMENT_SHADER,
      uniforms: {
        tColor: { value: this.sceneTarget.texture },
        tDepth: { value: this.sceneTarget.depthTexture },
        tBloom: { value: this.bloomBlurVTarget.texture },
        tHistory: { value: this.taaTargets[0].texture },
        uResolution: { value: new THREE.Vector2(w, h) },
        uTexelSize: { value: new THREE.Vector2(1 / w, 1 / h) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uTime: { value: 0 },

        uSsaoEnabled: { value: 0 },
        uSsaoIntensity: { value: 0.8 },
        uSsaoRadius: { value: 1.0 },

        uSsrEnabled: { value: 0 },
        uSsrIntensity: { value: 0.6 },

        uBloomEnabled: { value: 0 },
        uCheapBloomEnabled: { value: 0 },
        uBloomStrength: { value: 0.8 },
        uBloomThreshold: { value: 0.65 },

        uGodRaysEnabled: { value: 0 },
        uGodRaysIntensity: { value: 0.6 },
        uSunScreenPos: { value: new THREE.Vector2(0.5, 0.8) },
        uSunVisible: { value: 1.0 },

        uMotionBlurEnabled: { value: 0 },
        uMotionBlurStrength: { value: 0.45 },
        uInvViewProjMatrix: { value: new THREE.Matrix4() },
        uPrevViewProjMatrix: { value: new THREE.Matrix4() },

        uDofEnabled: { value: 0 },
        uDofFocusDistance: { value: 26.0 },
        uDofAperture: { value: 0.6 },

        uVolumetricSmokeEnabled: { value: 0 },
        uVolumetricSmokeDensity: { value: 0.8 },
        uCameraPos: { value: new THREE.Vector3() },
        uSmokeFocusPos: { value: new THREE.Vector3() },
        uExplosionTrauma: { value: 0.0 },

        uContactShadowsEnabled: { value: 0 },
        uContactShadowsIntensity: { value: 0.6 },
        uSunScreenDir: { value: new THREE.Vector2(0.4, 0.7) },

        uTaaEnabled: { value: 0 },
        uTaaHistoryValid: { value: 0 },
        uTaaBlendFactor: { value: 0.82 },
        uJitterOffset: { value: new THREE.Vector2(0, 0) },

        uChromaticEnabled: { value: 0 },
        uChromaticIntensity: { value: 0.3 },
        uLensDistortion: { value: 0.0 },
        uVisualTier: { value: 1 },
        uSceneIsAlreadySrgb: { value: 0 },
        uWorldGenMode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

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

  public getPlanarReflectionTexture(): THREE.Texture | null {
    return this.hasPlanarReflection ? this.planarReflectionTarget.texture : null;
  }

  public getPlanarReflViewProj(): THREE.Matrix4 {
    return _planarReflViewProj;
  }

  public applySettings(settings: GraphicsSettings, isHeadless = false): void {
    // 1. Custom WebGL2 engine uses fast Blob Shadow Sprites (not GPU shadow maps)
    this.renderer.shadowMap.enabled = false;
    this.sunLight.castShadow = false;

    // 5. Resolution Scale / Super-Sampling (HiDPI devicePixelRatio * resolutionScale)
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const pixelRatio = resolveEffectivePixelRatio(settings.resolutionScale, dpr, isHeadless);
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
    const sceneIsAlreadySrgb =
      settings.usePotatoShader || settings.useCartoonShader ? 1 : 0;

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
          // Unbind reflection target texture and suppress water voxels before rendering planar mirror pass
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
      oceanUniforms.uWaterOutputSrgb.value =
        hasPostFx && sceneIsAlreadySrgb === 1 ? 1.0 : 0.0;
    }

    // Direct render path when no screen-space post-processing is enabled
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
      this.bloomExtractMat.uniforms.tDepth.value = this.sceneTarget.depthTexture;
      this.bloomExtractMat.uniforms.uThreshold.value = settings.bloomThreshold;
      this.bloomExtractMat.uniforms.uSceneIsAlreadySrgb.value = sceneIsAlreadySrgb;
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

    // Compute unjittered view-projection matrices for world-position reconstruction & TAA/motion blur
    _currViewProj.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    _invViewProj.copy(_currViewProj).invert();
    if (!this.hasPrevViewProj) {
      this.prevViewProjMatrix.copy(_currViewProj);
      this.hasPrevViewProj = true;
    }

    // Project Sun position into screen UV for God Rays & Contact Shadows
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

    u.uSsaoEnabled.value = settings.ssaoEnabled ? 1 : 0;
    u.uSsaoIntensity.value = settings.ssaoIntensity;
    u.uSsaoRadius.value = settings.ssaoRadius;

    u.uSsrEnabled.value = settings.ssrEnabled ? 1 : 0;
    u.uSsrIntensity.value = settings.ssrIntensity;

    u.uBloomEnabled.value = settings.bloomEnabled ? 1 : 0;
    u.uCheapBloomEnabled.value = settings.cheapBloom ? 1 : 0;
    u.uBloomStrength.value = settings.bloomStrength;
    u.uBloomThreshold.value = settings.bloomThreshold;

    u.uGodRaysEnabled.value = settings.godRaysEnabled ? 1 : 0;
    u.uGodRaysIntensity.value = settings.godRaysIntensity;
    u.uSunScreenPos.value.set(sunScreenX, sunScreenY);
    u.uSunVisible.value = sunForwardDot;

    const speedBlurFactor = Math.min(1.0, Math.max(0.0, (vehicleSpeedMPS - 8.0) / 22.0));
    u.uMotionBlurEnabled.value = settings.motionBlurEnabled && speedBlurFactor > 0.01 ? 1 : 0;
    u.uMotionBlurStrength.value = settings.motionBlurStrength * speedBlurFactor;
    u.uInvViewProjMatrix.value.copy(_invViewProj);
    u.uPrevViewProjMatrix.value.copy(this.prevViewProjMatrix);

    u.uDofEnabled.value = settings.dofEnabled ? 1 : 0;
    u.uDofFocusDistance.value = settings.dofFocusDistance;
    u.uDofAperture.value = settings.dofAperture;

    u.uVolumetricSmokeEnabled.value = settings.volumetricSmokeEnabled ? 1 : 0;
    u.uVolumetricSmokeDensity.value = settings.volumetricSmokeDensity;
    u.uCameraPos.value.copy(this.camera.position);
    u.uSmokeFocusPos.value.copy(focusPos);
    u.uExplosionTrauma.value = explosionTrauma;

    u.uContactShadowsEnabled.value = settings.contactShadowsEnabled ? 1 : 0;
    u.uContactShadowsIntensity.value = settings.contactShadowsIntensity;
    const sunDir2D = u.uSunScreenDir.value as THREE.Vector2;
    sunDir2D.set(sunScreenX - 0.5, sunScreenY - 0.5);
    if (sunDir2D.lengthSq() > 1e-4) {
      sunDir2D.normalize();
    } else {
      sunDir2D.set(0.5, 0.86);
    }

    u.uTaaEnabled.value = settings.taaEnabled ? 1 : 0;
    u.uTaaHistoryValid.value = useTaaPass && this.hasTaaHistory ? 1 : 0;
    u.uTaaBlendFactor.value = settings.taaBlendFactor;
    u.uJitterOffset.value.set(jx, jy);

    const speedBoostCA = Math.min(0.65, vehicleSpeedMPS * 0.012) + explosionTrauma * 0.85;
    u.uChromaticEnabled.value = settings.chromaticAberrationEnabled ? 1 : 0;
    u.uChromaticIntensity.value =
      settings.chromaticAberrationIntensity + speedBoostCA * 0.5;
    u.uLensDistortion.value = settings.lensDistortion;
    u.uVisualTier.value = resolveVisualQualityTier(settings);
    u.uSceneIsAlreadySrgb.value = sceneIsAlreadySrgb;
    u.uWorldGenMode.value = worldGenModeToShaderId(worldGenMode);

    this.quadMesh.material = this.compositeMat;
    if (useTaaPass) {
      this.renderer.setRenderTarget(writeTaaTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.blitMat.uniforms.tInput.value = writeTaaTarget.texture;
      this.quadMesh.material = this.blitMat;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.taaIndex = 1 - this.taaIndex;
      this.hasTaaHistory = true;
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.quadScene, this.quadCamera);
      this.hasTaaHistory = false;
    }

    this.prevViewProjMatrix.copy(_currViewProj);
  }

  public dispose(): void {
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
