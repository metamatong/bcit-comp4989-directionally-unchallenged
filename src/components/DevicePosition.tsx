/** Approximate device area in the same source-page coordinates as the drawing. */
import type { DeviceOverlay } from '../location/types';
export function DevicePosition({
  overlay,
  width,
  height,
}: {
  overlay: DeviceOverlay;
  width: number;
  height: number;
}) {
  const matched =
    overlay.snapDistanceMetres !== undefined ||
    overlay.trackingMode === 'matched' ||
    overlay.trackingMode === 'motion-gated' ||
    overlay.trackingMode === 'pdr' ||
    overlay.trackingMode === 'pdr-bridged';
  return (
    <g
      className="device-position"
      data-matched={matched ? 'true' : undefined}
      data-tracking-mode={overlay.trackingMode}
    >
      <title>
        {matched
          ? 'Approximate corridor-matched device position and uncertainty area'
          : 'Approximate device position and reported horizontal accuracy area'}
      </title>
      <ellipse
        cx={overlay.point.x * width}
        cy={overlay.point.y * height}
        rx={overlay.radiusX * width}
        ry={overlay.radiusY * height}
        fill={matched ? '#0f766e22' : '#2474c72b'}
        stroke={matched ? '#0f766e' : '#155b9d'}
        strokeWidth={1.5}
        strokeDasharray={matched ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={overlay.point.x * width}
        cy={overlay.point.y * height}
        r={Math.min(width, height) * 0.004}
        fill={matched ? '#0f766e' : '#155b9d'}
        stroke="white"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
