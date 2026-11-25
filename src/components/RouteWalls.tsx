import { memo } from 'react';
import records from '../../3D Model/pilot-walls.json';
import type { VisualPlan } from '../types';

type WallRecord = { sourceSha256: string; estimated: boolean; segments: number[][] };
const walls: Record<string, WallRecord> = records;

// Draw vertical schematic faces in floor coordinates. The parent projects the floor
// with x' = x + 0.22y, y' = 0.72y; the offset below projects straight up on screen.
export default memo(function RouteWalls({ plan }: { plan: VisualPlan }) {
  const record = walls[plan.id];
  if (!record || record.sourceSha256 !== plan.sourceSha256) return null;
  const rise = plan.width * 0.012;
  const faces = record.segments
    .map(([x1, y1, x2, y2]) => {
      const dx = (x2 - x1) * plan.width;
      const dy = (y2 - y1) * plan.height;
      return `M${x1 * plan.width} ${y1 * plan.height}l${dx} ${dy}l${0.22 * rise} ${-rise}l${-dx} ${-dy}z`;
    })
    .join(' ');
  return (
    <path
      d={faces}
      fill={record.estimated ? '#98bcb3' : '#9ab3be'}
      stroke="#516e78"
      strokeWidth={plan.width * 0.00045}
      fillRule="nonzero"
    >
      <title>{record.estimated ? 'Estimated walls' : 'Drawing-derived walls'}</title>
    </path>
  );
});
