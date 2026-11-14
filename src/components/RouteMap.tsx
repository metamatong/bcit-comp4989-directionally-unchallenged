/** The image, room boxes, markers and walking arrows share the source page coordinate system. */
import { useState } from 'react';
import type { PlanBounds, VisualPlan } from '../types';
import type { PagePoint } from '../wayfinding';
import { planLabel } from '../topology';

export type MapMarker = { point: PagePoint; label: string; symbol: string; end?: boolean };
export function RouteMap({
  plan,
  markers = [],
  path = [],
  bounds,
  label,
}: {
  plan: VisualPlan;
  markers?: MapMarker[];
  path?: PagePoint[];
  bounds?: PlanBounds;
  label: string;
}) {
  const [whole, setWhole] = useState(false);
  const points = [
    ...markers.map((m) => m.point),
    ...path,
    ...(bounds
      ? [
          { x: bounds[0], y: bounds[1] },
          { x: bounds[2], y: bounds[3] },
        ]
      : []),
  ];
  const width = plan.width,
    height = plan.height;
  const xs = points.map((p) => p.x * width),
    ys = points.map((p) => p.y * height);
  const margin = width * 0.055;
  const x = whole || !points.length ? 0 : Math.max(0, Math.min(...xs) - margin);
  const y = whole || !points.length ? 0 : Math.max(0, Math.min(...ys) - margin);
  const w = whole || !points.length ? width : Math.min(width, Math.max(...xs) + margin) - x;
  const h = whole || !points.length ? height : Math.min(height, Math.max(...ys) + margin) - y;
  const scale = Math.max(w / 640, h / 420);
  const line = 3.7 * scale;
  const svgPoints = path.map((p) => `${p.x * width},${p.y * height}`).join(' ');
  return (
    <div className="journey-map">
      <div className="map-bar">
        <strong>{planLabel(plan)}</strong>
        <button type="button" aria-pressed={whole} onClick={() => setWhole(!whole)}>
          {whole ? 'Zoom to marks' : 'Show full floor'}
        </button>
      </div>
      <svg viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={label} className="walking-map">
        <title>{label}</title>
        <image href={plan.full.url} x={0} y={0} width={width} height={height} />
        {bounds && (
          <rect
            x={bounds[0] * width}
            y={bounds[1] * height}
            width={(bounds[2] - bounds[0]) * width}
            height={(bounds[3] - bounds[1]) * height}
            fill="#eba72c30"
            stroke="#986219"
            strokeWidth={line * 0.65}
            strokeDasharray={`${3 * line} ${line}`}
          />
        )}
        {path.length > 1 && (
          <g>
            <polyline
              points={svgPoints}
              fill="none"
              stroke="white"
              strokeWidth={line * 2.3}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              data-walking-line="true"
              points={svgPoints}
              fill="none"
              stroke="#1460ab"
              strokeWidth={line}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {path.slice(1).map((p, i) => {
              const a = path[i],
                dx = (p.x - a.x) * width,
                dy = (p.y - a.y) * height;
              if (Math.hypot(dx, dy) < 14 * scale) return null;
              return (
                <path
                  key={i}
                  d="M -5 -4 L 2.5 0 L -5 4"
                  transform={`translate(${((a.x + p.x) * width) / 2} ${((a.y + p.y) * height) / 2}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}) scale(${scale * 1.4})`}
                  fill="none"
                  stroke="#103f73"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </g>
        )}
        {markers.map((m, i) => (
          <g key={i} transform={`translate(${m.point.x * width} ${m.point.y * height})`}>
            <title>{m.label}</title>
            <circle
              r={10 * scale}
              fill={m.end ? '#a84b29' : '#124f40'}
              stroke="white"
              strokeWidth={2 * scale}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11 * scale}
              fontWeight="700"
              fill="white"
            >
              {m.symbol}
            </text>
          </g>
        ))}
      </svg>
      <div className="map-credit">
        {plan.attribution}
        <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
          Source PDF ↗
        </a>
      </div>
    </div>
  );
}
