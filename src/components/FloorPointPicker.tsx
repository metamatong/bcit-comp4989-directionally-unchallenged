/** Pick a point on the currently relevant floor's verified public walking cells. */
import { useEffect, useMemo, useState } from 'react';
import { request } from '../api';
import { buildingLabel, planLabel } from '../topology';
import type { CampusLocationCandidate, VisualPlan } from '../types';
import {
  mapDestinationScope,
  type FloorPin,
  type PagePoint,
  type WalkingSurface,
} from '../wayfinding';

type Props = {
  sessionId: string;
  revision: number;
  candidate: CampusLocationCandidate;
  destination: string;
  plans: VisualPlan[];
  role: 'origin' | 'destination';
  initiallyOpen?: boolean;
  onPick: (pin: FloorPin) => void;
};

function MapSelection({
  plan,
  surface,
  onPick,
}: {
  plan: VisualPlan;
  surface: WalkingSurface;
  onPick: (pin: FloorPin) => void;
}) {
  const [point, setPoint] = useState<PagePoint>();
  const [zoom, setZoom] = useState(false);
  const { step, runs } = surface;
  const cells = useMemo(() => {
    const rows = new Map<number, [number, number][]>();
    for (const [y, l, r] of [...runs, ...(surface.interiorRuns ?? [])]) {
      const spans = rows.get(y) ?? [];
      spans.push([l, r]);
      rows.set(y, spans);
    }
    return rows;
  }, [runs, surface.interiorRuns]);
  const outline = useMemo(
    () =>
      runs
        .map(([y, l, r]) => 'M' + l * step + ' ' + (y + 0.5) * step + 'h' + (r - l + 1) * step)
        .join(' '),
    [step, runs],
  );
  const interior = useMemo(
    () =>
      (surface.interiorRuns ?? [])
        .map(([y, l, r]) => 'M' + l * step + ' ' + (y + 0.5) * step + 'h' + (r - l + 1) * step)
        .join(' '),
    [step, surface.interiorRuns],
  );
  const column = point ? Math.floor((point.x * plan.width) / step) : -1;
  const row = point ? Math.floor((point.y * plan.height) / step) : -1;
  const valid = cells.get(row)?.some(([a, b]) => a <= column && column <= b);
  return (
    <>
      <button type="button" className="text-button" onClick={() => setZoom(!zoom)}>
        {zoom ? 'Show full floor' : 'Zoom in'}
      </button>
      <div className="floor-point-scroll">
        <svg
          role="group"
          aria-label={'Select a walking point on ' + planLabel(plan)}
          tabIndex={0}
          viewBox={'0 0 ' + plan.width + ' ' + plan.height}
          style={{ width: zoom ? '250%' : '100%' }}
          onClick={(event) => {
            const svg = event.currentTarget,
              matrix = svg.getScreenCTM();
            if (!matrix) return;
            const location = new DOMPoint(event.clientX, event.clientY).matrixTransform(
              matrix.inverse(),
            );
            setPoint({ x: location.x / plan.width, y: location.y / plan.height });
          }}
          onKeyDown={(event) => {
            const move: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            if (!move[event.key] || !runs.length) return;
            event.preventDefault();
            const [dx, dy] = move[event.key],
              [y, l, r] = runs[Math.floor(runs.length / 2)];
            const at = point ? [column, row] : [Math.floor((l + r) / 2), y];
            const jump = event.shiftKey ? 10 : 1;
            setPoint({
              x: Math.max(0, Math.min(1, ((at[0] + dx * jump + 0.5) * step) / plan.width)),
              y: Math.max(0, Math.min(1, ((at[1] + dy * jump + 0.5) * step) / plan.height)),
            });
          }}
        >
          <image href={plan.full.url} width={plan.width} height={plan.height} />
          <path d={interior} fill="none" stroke="#528ba4" strokeOpacity=".37" strokeWidth={step} />
          <path d={outline} fill="none" stroke="#13896b" strokeOpacity=".56" strokeWidth={step} />
          {point && (
            <circle
              cx={point.x * plan.width}
              cy={point.y * plan.height}
              r={plan.width * 0.007}
              stroke="white"
              strokeWidth={2}
              fill={valid ? '#124f40' : '#ad512d'}
            />
          )}
        </svg>
      </div>
      <p className="helper" role="status">
        {point && !valid
          ? 'That point is outside the mapped walking area.'
          : 'Tap a shaded walking area or use the arrow keys on the map.'}
      </p>
      <button
        type="button"
        className="secondary"
        disabled={!valid}
        onClick={() => {
          if (valid && point)
            onPick({
              planId: plan.id,
              sourceSha256: surface.sourceSha256,
              graphVersion: surface.graphVersion,
              point,
            });
        }}
      >
        Use this point
      </button>
    </>
  );
}
export function FloorPointPicker({
  candidate,
  destination,
  plans,
  sessionId,
  revision,
  onPick,
  role,
  initiallyOpen = false,
}: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const [floorId, setFloorId] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState(candidate.building);
  const [surface, setSurface] = useState<WalkingSurface>();
  const [error, setError] = useState('');
  const scope = mapDestinationScope(destination);
  const chooseBuilding = role === 'destination' && scope !== undefined && !scope.building;
  const building = scope?.building ?? selectedBuilding;
  const floors = plans.filter((p) =>
    role === 'origin'
      ? p.id === candidate.planId
      : scope !== undefined && p.building === building && (!scope.floor || p.floor === scope.floor),
  );
  const plan =
    floors.find((p) => p.id === floorId) ??
    floors.find((p) => p.id === candidate.planId) ??
    (floors.length === 1 ? floors[0] : undefined);
  useEffect(() => {
    setSurface(undefined);
    setError('');
    if (!open || !plan) return;
    const abort = new AbortController();
    request<WalkingSurface>(
      '/api/sessions/' + sessionId + '/navigation/surface',
      { revision, candidateId: candidate.id, role, destination, planId: plan.id },
      { signal: abort.signal },
    )
      .then((s) => {
        if (!abort.signal.aborted) setSurface(s);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [open, plan?.id, role, candidate.id, destination, revision, sessionId]);
  return (
    <details
      className="floor-point-picker"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {role === 'origin' ? 'Adjust starting point on the map' : 'Choose a destination on the map'}
      </summary>
      {open && (
        <>
          {chooseBuilding && (
            <label>
              Building{' '}
              <select
                value={selectedBuilding}
                onChange={(event) => {
                  setSelectedBuilding(event.target.value);
                  setFloorId('');
                }}
              >
                {[...new Set(plans.map((p) => p.building))].sort().map((b) => (
                  <option key={b} value={b}>
                    {buildingLabel(b)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {floors.length > 1 && (
            <label>
              Floor{' '}
              <select value={plan?.id ?? ''} onChange={(e) => setFloorId(e.target.value)}>
                {!plan && <option value="">Choose a floor</option>}
                {floors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {planLabel(p)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {plan && floors.length === 1 && <strong>{planLabel(plan)}</strong>}
          {error && <p role="alert">{error}</p>}
          {!floors.length && <p>No floor plan matches this selection.</p>}
          {plan &&
            !error &&
            (!surface || surface.planId !== plan.id ? (
              <p role="status">Loading walking areas…</p>
            ) : (
              <MapSelection key={plan.id + role} plan={plan} surface={surface} onPick={onPick} />
            ))}
        </>
      )}
    </details>
  );
}
