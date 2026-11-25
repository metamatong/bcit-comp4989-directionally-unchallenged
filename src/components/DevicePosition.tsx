/** Approximate device area and optional live facing cone in source-page coordinates. */
import { useId } from 'react';
import type { DeviceHeading, DeviceOverlay } from '../location/types';
export function DevicePosition({
  overlay,
  heading,
  width,
  height,
}: {
  overlay: DeviceOverlay;
  heading?: DeviceHeading | null;
  width: number;
  height: number;
}) {
  const gradientId = useId();
  const matched =
    overlay.corridorMatched ||
    overlay.snapDistanceMetres !== undefined ||
    overlay.trackingMode === 'matched' ||
    overlay.trackingMode === 'motion-gated' ||
    overlay.trackingMode === 'stationary-hold' ||
    overlay.trackingMode === 'pdr' ||
    overlay.trackingMode === 'pdr-bridged';
  const held = overlay.trackingMode === 'gps-hold';
  const cx = overlay.point.x * width;
  const cy = overlay.point.y * height;
  const dotR = Math.min(width, height) * 0.004;
  const accent = matched ? '#0f766e' : '#155b9d';

  let conePath: string | null = null;
  const coneRadius = dotR * 5.5;
  if (
    heading &&
    Number.isFinite(heading.angleRad) &&
    Number.isFinite(heading.spreadDeg) &&
    heading.spreadDeg > 0 &&
    heading.spreadDeg < 180
  ) {
    const halfRad = (heading.spreadDeg * Math.PI) / 360;
    const startAngle = heading.angleRad - halfRad;
    const endAngle = heading.angleRad + halfRad;
    const x1 = cx + coneRadius * Math.cos(startAngle);
    const y1 = cy + coneRadius * Math.sin(startAngle);
    const x2 = cx + coneRadius * Math.cos(endAngle);
    const y2 = cy + coneRadius * Math.sin(endAngle);
    conePath = `M ${cx} ${cy} L ${x1} ${y1} A ${coneRadius} ${coneRadius} 0 0 1 ${x2} ${y2} Z`;
  }

  return (
    <g
      className="device-position"
      data-matched={matched ? 'true' : undefined}
      data-held={held ? 'true' : undefined}
      data-tracking-mode={overlay.trackingMode}
      opacity={held ? 0.72 : undefined}
    >
      <title>
        {held
          ? 'Held last known approximate device position and expanded uncertainty area'
          : matched
            ? 'Approximate corridor-matched device position and uncertainty area'
            : 'Approximate device position and reported horizontal accuracy area'}
      </title>
      <ellipse
        cx={cx}
        cy={cy}
        rx={overlay.radiusX * width}
        ry={overlay.radiusY * height}
        fill={matched ? '#0f766e22' : '#2474c72b'}
        stroke={accent}
        strokeWidth={1.5}
        strokeDasharray={matched || held ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {conePath && heading && (
        <>
          <defs>
            <radialGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              cx={cx}
              cy={cy}
              r={coneRadius}
            >
              <stop offset="0%" stopColor={accent} stopOpacity="0.52" />
              <stop offset="65%" stopColor={accent} stopOpacity="0.22" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          <path
            className="device-heading-cone"
            data-heading-source={heading.source}
            data-heading-spread={heading.spreadDeg}
            d={conePath}
            fill={`url(#${gradientId})`}
          />
        </>
      )}
      <circle
        cx={cx}
        cy={cy}
        r={dotR}
        fill={accent}
        stroke="white"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
