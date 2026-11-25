/** Approximate device area and optional full-ring facing sector in source-page coordinates. */
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
  // Strip colons from React useId() values so SVG url(#...) references stay strictly valid in WebKit.
  const safeId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `device-cone-grad-${safeId}`;
  const shadowId = `device-cone-shadow-${safeId}`;
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
  const rx = overlay.radiusX * width;
  const ry = overlay.radiusY * height;
  const dotR = Math.min(width, height) * 0.004;
  const accent = matched ? '#0f766e' : '#155b9d';
  const midAccent = matched ? '#0d9488' : '#2474c7';
  const shadowColor = matched ? '#062e2b' : '#0b2c4d';

  const hasValidHeading =
    !!heading &&
    Number.isFinite(heading.angleRad) &&
    Number.isFinite(heading.spreadDeg) &&
    heading.spreadDeg > 0 &&
    heading.spreadDeg < 180;

  let conePath: string | null = null;
  let raysPath: string | null = null;
  let arcPath: string | null = null;
  // Cover 100% of the uncertainty ring; fall back only when a degenerate zero radius is supplied.
  const minConeRadius = dotR * 5.5;
  const sectorRx = Number.isFinite(rx) && rx > 0 ? rx : minConeRadius;
  const sectorRy = Number.isFinite(ry) && ry > 0 ? ry : minConeRadius;
  const gradientRadius = Math.max(sectorRx, sectorRy);

  if (hasValidHeading) {
    const halfRad = (heading.spreadDeg * Math.PI) / 360;
    const startAngle = heading.angleRad - halfRad;
    const endAngle = heading.angleRad + halfRad;
    const x1 = cx + sectorRx * Math.cos(startAngle);
    const y1 = cy + sectorRy * Math.sin(startAngle);
    const x2 = cx + sectorRx * Math.cos(endAngle);
    const y2 = cy + sectorRy * Math.sin(endAngle);
    conePath = `M ${cx} ${cy} L ${x1} ${y1} A ${sectorRx} ${sectorRy} 0 0 1 ${x2} ${y2} Z`;
    raysPath = `M ${x1} ${y1} L ${cx} ${cy} L ${x2} ${y2}`;
    arcPath = `M ${x1} ${y1} A ${sectorRx} ${sectorRy} 0 0 1 ${x2} ${y2}`;
  }

  const ellipseFill = conePath
    ? matched
      ? '#0f766e14'
      : '#2474c71a'
    : matched
      ? '#0f766e22'
      : '#2474c72b';

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
      <defs>
        {conePath && (
          <radialGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            cx={cx}
            cy={cy}
            r={gradientRadius}
          >
            <stop offset="0%" stopColor={accent} stopOpacity="0.62" />
            <stop offset="55%" stopColor={midAccent} stopOpacity="0.34" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.14" />
          </radialGradient>
        )}
        <filter id={shadowId} x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow
            dx="0"
            dy={dotR * 0.25}
            stdDeviation={dotR * 0.38}
            floodColor={shadowColor}
            floodOpacity="0.35"
          />
        </filter>
      </defs>
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill={ellipseFill}
        stroke={accent}
        strokeOpacity={conePath ? 0.55 : undefined}
        strokeWidth={1.5}
        strokeDasharray={matched || held ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {conePath && raysPath && arcPath && heading && (
        <>
          <path
            className="device-heading-cone"
            data-heading-source={heading.source}
            data-heading-spread={heading.spreadDeg}
            d={conePath}
            fill={`url(#${gradientId})`}
          />
          <path
            className="device-heading-rays"
            d={raysPath}
            fill="none"
            stroke={accent}
            strokeOpacity={0.48}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="device-heading-arc"
            d={arcPath}
            fill="none"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      <circle
        cx={cx}
        cy={cy}
        r={dotR * 1.25}
        fill={accent}
        stroke="white"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        filter={`url(#${shadowId})`}
      />
    </g>
  );
}
