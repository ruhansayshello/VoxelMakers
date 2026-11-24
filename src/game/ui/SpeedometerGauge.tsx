import React from 'react';

export interface SpeedometerGaugeProps {
  speedKmh: number;
  maxSpeedKmh?: number;
  scale?: number;
  compactMobile?: boolean;
  style?: React.CSSProperties;
}

/**
 * Computes normalized speed ratio [0..1] and active LED segment count for the industrial segmented speedometer.
 */
export function computeSpeedometerNeedleState(
  speedKmh: number,
  maxSpeedKmh = 160,
): { clampedKmh: number; norm: number; needleDeg: number; activeSegments: number } {
  const safeMax = Math.max(40, maxSpeedKmh);
  const clampedKmh = Math.max(0, Math.round(Math.abs(speedKmh)));
  const norm = Math.min(1, clampedKmh / safeMax);
  const needleDeg = -135 + norm * 270;
  const activeSegments =
    clampedKmh === 0 ? 0 : Math.max(1, Math.min(20, Math.ceil(norm * 20)));
  return { clampedKmh, norm, needleDeg, activeSegments };
}

const SEGMENT_COLORS = [
  '#38b000',
  '#40bc08',
  '#4cd137',
  '#65dc28',
  '#80e51a',
  '#9ef01a',
  '#b5e42c',
  '#c4e538',
  '#e1b12c',
  '#f39c12',
  '#f59e0b',
  '#ff9f1a',
  '#ff7f11',
  '#ff6319',
  '#f9411d',
  '#ef3018',
  '#e82518',
  '#d61f1f',
  '#c21818',
  '#a81313',
];

const TOTAL_SEGMENTS = 20;
const ARC_CX = 64;
const ARC_CY = 62;
const ARC_OUTER_R = 45;
const ARC_INNER_R = 35;
const TICK_OUTER_R = 32.5;
const TICK_INNER_MINOR_R = 29.5;
const TICK_INNER_MAJOR_R = 27.2;
const START_DEG = 136; // 7:30 o'clock (bottom-left)
const END_DEG = 292; // 1:00 o'clock (top-right)

function polarToCartesian(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
}

// Precompute segment polygons and tick lines once at module load (zero per-frame allocations)
const PRECOMPUTED_SEGMENTS = Array.from({ length: TOTAL_SEGMENTS }, (_, i) => {
  const stepDeg = (END_DEG - START_DEG) / TOTAL_SEGMENTS;
  const gapDeg = 1.65;
  const a0 = START_DEG + i * stepDeg + gapDeg * 0.5;
  const a1 = START_DEG + (i + 1) * stepDeg - gapDeg * 0.5;
  const [ox0, oy0] = polarToCartesian(ARC_CX, ARC_CY, ARC_OUTER_R, a0);
  const [ox1, oy1] = polarToCartesian(ARC_CX, ARC_CY, ARC_OUTER_R, a1);
  const [ix1, iy1] = polarToCartesian(ARC_CX, ARC_CY, ARC_INNER_R, a1);
  const [ix0, iy0] = polarToCartesian(ARC_CX, ARC_CY, ARC_INNER_R, a0);
  return {
    points: `${ox0.toFixed(1)},${oy0.toFixed(1)} ${ox1.toFixed(1)},${oy1.toFixed(1)} ${ix1.toFixed(1)},${iy1.toFixed(1)} ${ix0.toFixed(1)},${iy0.toFixed(1)}`,
    color: SEGMENT_COLORS[i],
  };
});

const TOTAL_TICKS = 33;
const PRECOMPUTED_TICKS = Array.from({ length: TOTAL_TICKS }, (_, i) => {
  const frac = i / (TOTAL_TICKS - 1);
  const deg = START_DEG + frac * (END_DEG - START_DEG);
  const isMajor = i % 4 === 0;
  const [x1, y1] = polarToCartesian(ARC_CX, ARC_CY, TICK_OUTER_R, deg);
  const [x2, y2] = polarToCartesian(
    ARC_CX,
    ARC_CY,
    isMajor ? TICK_INNER_MAJOR_R : TICK_INNER_MINOR_R,
    deg,
  );
  return { x1, y1, x2, y2, isMajor };
});

export const SpeedometerGauge: React.FC<SpeedometerGaugeProps> = ({
  speedKmh,
  maxSpeedKmh = 160,
  scale = 1.0,
  compactMobile = false,
  style,
}) => {
  const { clampedKmh, activeSegments } = computeSpeedometerNeedleState(
    speedKmh,
    maxSpeedKmh,
  );

  const sizePx = compactMobile ? 64 : 84;
  const isRedline = clampedKmh >= 120;

  return (
    <div
      data-testid="speedometer-gauge"
      style={{
        width: `${sizePx}px`,
        height: `${sizePx}px`,
        transform: scale !== 1 ? `scale(${scale})` : undefined,
        transformOrigin: compactMobile ? 'top right' : 'bottom right',
        ...style,
      }}
      className="relative flex items-center justify-center pointer-events-none select-none shrink-0 drop-shadow-lg"
    >
      <svg
        width={sizePx}
        height={sizePx}
        viewBox="0 0 120 120"
        className="block w-full h-full"
      >
        <defs>
          <pattern
            id="speedo-hazard-pattern"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(40)"
          >
            <rect width="6" height="12" fill="#eab308" />
            <rect x="6" width="6" height="12" fill="#181a1d" />
          </pattern>
        </defs>

        {/* Outer Chamfered Octagonal Armor Plate */}
        <polygon
          points="26,3 94,3 117,26 117,94 94,117 26,117 3,94 3,26"
          fill="#32363d"
          stroke="#111316"
          strokeWidth="2.5"
        />

        {/* Top & Bottom Hazard Stripe Plates */}
        <rect
          x="33"
          y="4.2"
          width="54"
          height="6.2"
          fill="url(#speedo-hazard-pattern)"
          stroke="#181a1d"
          strokeWidth="0.8"
        />
        <rect
          x="33"
          y="109.6"
          width="54"
          height="6.2"
          fill="url(#speedo-hazard-pattern)"
          stroke="#181a1d"
          strokeWidth="0.8"
        />

        {/* Inner Beveled Octagonal Faceplate */}
        <polygon
          points="29,11 91,11 109,29 109,91 91,109 29,109 11,91 11,29"
          fill="#202328"
          stroke="#111316"
          strokeWidth="2"
        />

        {/* Corner Rivets */}
        {[
          [20, 20],
          [100, 20],
          [100, 100],
          [20, 100],
          [30, 8],
          [90, 8],
          [30, 112],
          [90, 112],
        ].map(([rx, ry], idx) => (
          <circle
            key={idx}
            cx={rx}
            cy={ry}
            r="1.9"
            fill="#2b2f36"
            stroke="#111316"
            strokeWidth="1"
          />
        ))}

        {/* Dark Recessed Track Behind LED Segments */}
        {PRECOMPUTED_SEGMENTS.map((seg, idx) => {
          const isLit = idx < activeSegments;
          return (
            <polygon
              key={idx}
              points={seg.points}
              fill={isLit ? seg.color : '#14171a'}
              stroke="#0d0f12"
              strokeWidth="1.1"
              opacity={isLit ? 1 : 0.88}
            />
          );
        })}

        {/* Unlit faint color tint overlay so the green->orange->red bar gradient is subtly recognizable at rest */}
        {PRECOMPUTED_SEGMENTS.map((seg, idx) => {
          if (idx < activeSegments) return null;
          return (
            <polygon
              key={`dim-${idx}`}
              points={seg.points}
              fill={seg.color}
              opacity="0.22"
            />
          );
        })}

        {/* Inner Orange Calibration Ticks */}
        {PRECOMPUTED_TICKS.map((t, idx) => (
          <line
            key={idx}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="#f59e0b"
            strokeWidth={t.isMajor ? '1.6' : '0.9'}
            opacity={t.isMajor ? '0.95' : '0.75'}
          />
        ))}

        {/* Recessed Chamfered Digital Readout Window */}
        <polygon
          points="52,40 95,40 95,86 52,86 41,75 41,51"
          fill="#101215"
          stroke="#353a42"
          strokeWidth="2"
        />

        {/* Bottom & Right Industrial Vent Louvers */}
        <rect
          x="46"
          y="92"
          width="36"
          height="9"
          rx="1.5"
          fill="#121417"
          stroke="#2d3138"
          strokeWidth="1"
        />
        {[50, 54, 58, 62, 66, 70, 74, 78].map((vx) => (
          <line
            key={vx}
            x1={vx}
            y1="93.5"
            x2={vx}
            y2="99.5"
            stroke="#2a2e35"
            strokeWidth="1.3"
          />
        ))}

        <rect
          x="99"
          y="44"
          width="6"
          height="36"
          rx="1"
          fill="#121417"
          stroke="#2d3138"
          strokeWidth="1"
        />
        {[48, 53, 58, 63, 68, 73, 77].map((vy) => (
          <line
            key={vy}
            x1="100.2"
            y1={vy}
            x2="103.8"
            y2={vy}
            stroke="#2a2e35"
            strokeWidth="1.2"
          />
        ))}
      </svg>

      {/* Crisp Digital Speed Number + Orange KM/H inside the Chamfered Screen */}
      <div
        className="absolute flex flex-col items-center justify-center leading-none"
        style={{
          left: '36%',
          right: '20%',
          top: '35%',
          bottom: '28%',
        }}
      >
        <span
          data-testid="speed-readout"
          className={`font-display font-black tabular-nums tracking-tight leading-none ${
            compactMobile
              ? clampedKmh >= 100
                ? 'text-[14px]'
                : 'text-[16px]'
              : clampedKmh >= 100
                ? 'text-[19px]'
                : 'text-[22px]'
          } ${isRedline ? 'text-[#ff5252]' : 'text-[#ffffff]'}`}
        >
          {clampedKmh}
        </span>
        <span
          className={`font-display font-black tracking-wider text-[#f59e0b] mt-0.5 ${
            compactMobile ? 'text-[6.5px]' : 'text-[8px]'
          }`}
        >
          KM/H
        </span>
      </div>
    </div>
  );
};
