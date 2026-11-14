import type { VisualPlan } from '../types';
import { pointOnPlan, reviewStatus, type TopologyNode, type TopologyEdge } from '../topology';

export function TopologyPlan({
  plan,
  nodes,
  edges,
  selectedId,
  draftPoint,
  placing,
  routeEdgeIds,
  zoom,
  onPlace,
  onSelect,
}: {
  plan: VisualPlan;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedId?: string;
  draftPoint?: { x: number; y: number };
  placing: boolean;
  routeEdgeIds: string[];
  zoom: number;
  onPlace: (point: { x: number; y: number }) => void;
  onSelect: (node: TopologyNode) => void;
}) {
  const planNodes = nodes.filter((node) => node.planId === plan.id);
  const nodeIndex = new Map(planNodes.map((node) => [node.id, node]));
  return (
    <div className="topology-map-scroll">
      <div
        className={`topology-sheet ${placing ? 'is-placing' : ''}`}
        style={{ width: `${zoom}%` }}
        role={placing ? 'button' : undefined}
        tabIndex={placing ? 0 : undefined}
        aria-label={
          placing
            ? 'Place a point on the plan. Press Enter to start at the page center, then adjust its coordinates.'
            : undefined
        }
        onKeyDown={(event) => {
          if (
            placing &&
            event.target === event.currentTarget &&
            (event.key === 'Enter' || event.key === ' ')
          ) {
            event.preventDefault();
            onPlace({ x: 0.5, y: 0.5 });
          }
        }}
        onClick={(event) => {
          if (!placing) return;
          const point = pointOnPlan(
            event.clientX,
            event.clientY,
            event.currentTarget.getBoundingClientRect(),
          );
          if (point) onPlace(point);
        }}
      >
        <img
          src={plan.full.url}
          alt={`Official ${plan.building} floor ${plan.floor} plan`}
          width={plan.full.width}
          height={plan.full.height}
          draggable={false}
        />
        <svg
          className="topology-lines"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {edges.map((edge) => {
            const from = nodeIndex.get(edge.fromNodeId),
              to = nodeIndex.get(edge.toNodeId);
            if (!from || !to) return null;
            return (
              <line
                key={edge.id}
                x1={from.point.x * 100}
                y1={from.point.y * 100}
                x2={to.point.x * 100}
                y2={to.point.y * 100}
                className={routeEdgeIds.includes(edge.id) ? 'is-route' : reviewStatus(edge)}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {planNodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`topology-marker ${reviewStatus(node)} ${selectedId === node.id ? 'is-selected' : ''}`}
            style={{ left: `${node.point.x * 100}%`, top: `${node.point.y * 100}%` }}
            aria-label={`${node.label}; ${reviewStatus(node)}`}
            title={`${node.label} · ${reviewStatus(node)}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(node);
            }}
          >
            {nodes.indexOf(node) + 1}
          </button>
        ))}
        {draftPoint && (
          <span
            className="topology-marker is-draft"
            style={{ left: `${draftPoint.x * 100}%`, top: `${draftPoint.y * 100}%` }}
            aria-label="Unsaved point"
          >
            +
          </span>
        )}
      </div>
    </div>
  );
}
