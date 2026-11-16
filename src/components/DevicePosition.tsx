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
  return (
    <g className="device-position">
      <title>Approximate device position and reported horizontal accuracy area</title>
      <ellipse
        cx={overlay.point.x * width}
        cy={overlay.point.y * height}
        rx={overlay.radiusX * width}
        ry={overlay.radiusY * height}
        fill="#2474c72b"
        stroke="#155b9d"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={overlay.point.x * width}
        cy={overlay.point.y * height}
        r={Math.min(width, height) * 0.004}
        fill="#155b9d"
        stroke="white"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
