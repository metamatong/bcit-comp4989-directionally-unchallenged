import { useEffect, useRef, useState } from 'react';
import { Compass, Download, RefreshCw, Plus, Minus } from 'lucide-react';
import { request } from './api';
import {
  planLabel,
  reviewStatus,
  connectionKindLabels,
  type TopologyBootstrap,
  type TopologyCommand,
  type TopologyNode,
  type TopologyEdge,
  type TopologyRoute,
  type TopologyRouteRequest,
  type NodeDraft,
  type EdgeDraft,
  type CandidateAnswer,
} from './topology';
import { TopologyPlan } from './components/TopologyPlan';
import { NodeForm, EdgeForm, ReviewPanel, pointDescription } from './components/TopologyForms';
import { ConnectionReview } from './components/ConnectionReview';
import './topology.css';

const endpoint = '/api/internal/topology';
const emptyEvidence = () => ({ basis: 'plan' as const, note: '', observedOn: null });
function nodeFields(node: TopologyNode): NodeDraft {
  const { id, planId, label, kind, point, notes, evidence } = node;
  return structuredClone({ id, planId, label, kind, point, notes, evidence });
}
function edgeFields(edge: TopologyEdge): EdgeDraft {
  const {
    id,
    fromNodeId,
    toNodeId,
    kind,
    direction,
    notes,
    evidence,
    distanceMeters,
    distanceEvidence,
  } = edge;
  return structuredClone({
    id,
    fromNodeId,
    toNodeId,
    kind,
    direction,
    notes,
    evidence,
    distanceMeters,
    distanceEvidence,
  });
}
const emptyEdge = (): EdgeDraft => ({
  fromNodeId: '',
  toNodeId: '',
  kind: 'corridor',
  direction: 'both',
  notes: '',
  evidence: emptyEvidence(),
  distanceMeters: null,
  distanceEvidence: '',
});

export default function TopologyEditor({
  initialData,
  initialView = 'questions',
}: {
  initialData?: TopologyBootstrap;
  initialView?: 'questions' | 'manual';
}) {
  const [data, setData] = useState(initialData);
  const [view, setView] = useState(initialView);
  const [questionReset, setQuestionReset] = useState(0);
  const [planId, setPlanId] = useState(initialData?.plans[0]?.id ?? '');
  const [tab, setTab] = useState<'points' | 'connections' | 'route'>('points');
  const [nodeDraft, setNodeDraft] = useState<NodeDraft | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft>(emptyEdge);
  const [dirty, setDirty] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [zoom, setZoom] = useState(100);
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [route, setRoute] = useState<TopologyRoute | null>(null);
  const [routeFrom, setRouteFrom] = useState('');
  const [routeTo, setRouteTo] = useState('');
  const [routeMode, setRouteMode] = useState<TopologyRouteRequest['mode']>('fewest-connections');

  useEffect(() => {
    if (initialData) return;
    let disposed = false;
    const controller = new AbortController();
    request<TopologyBootstrap>(endpoint, undefined, { signal: controller.signal })
      .then((next) => {
        if (!disposed) {
          setData(next);
          setPlanId(next.plans[0]?.id ?? '');
        }
      })
      .catch((failure) => {
        if (!disposed) setError(failure.message);
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [initialData]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);

  const plan = data?.plans.find((item) => item.id === planId) ?? data?.plans[0];
  const selectedNode = data?.document.nodes.find((node) => node.id === nodeDraft?.id);
  const selectedEdge = data?.document.edges.find((edge) => edge.id === edgeDraft.id);
  function discard() {
    if (view === 'questions') setQuestionReset((current) => current + 1);
    setNodeDraft(selectedNode ? nodeFields(selectedNode) : null);
    setEdgeDraft(selectedEdge ? edgeFields(selectedEdge) : emptyEdge());
    setDirty(false);
    setPlacing(false);
    setPicking(null);
  }
  function canSwitch() {
    if (busyRef.current) return false;
    if (dirty && !window.confirm('Discard your unsaved edits? Saved records will be kept.'))
      return false;
    discard();
    return true;
  }
  function showNode(nodeId: string) {
    const node = data?.document.nodes.find((item) => item.id === nodeId);
    if (node) {
      setPlanId(node.planId);
      setZoom(100);
    }
  }
  function selectNode(node: TopologyNode) {
    if (busyRef.current) return;
    if (tab === 'connections' && picking) {
      setEdgeDraft((current) => ({
        ...current,
        [picking === 'from' ? 'fromNodeId' : 'toNodeId']: node.id,
      }));
      setDirty(true);
      setPicking(null);
      return;
    }
    if (!canSwitch()) return;
    setTab('points');
    setPlanId(node.planId);
    setNodeDraft(nodeFields(node));
    setPlacing(false);
  }
  async function reload() {
    if (!canSwitch()) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await request<TopologyBootstrap>(endpoint);
      setData(next);
      setNodeDraft(null);
      setEdgeDraft(emptyEdge());
      setRoute(null);
      setNotice('Loaded the saved graph.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function mutate(command: TopologyCommand) {
    if (!data || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await request<TopologyBootstrap>(`${endpoint}/edits`, {
        revision: data.document.revision,
        command,
      });
      setData(next);
      setDirty(false);
      setPlacing(false);
      setPicking(null);
      setRoute(null);
      setNotice(
        command.type === 'record-floor-observation'
          ? '층 단위 답변을 저장했습니다.'
          : command.type === 'answer-candidate'
            ? '답변이 저장되었습니다. 사용자 확인과 통행 방향에 따라 경로 반영 상태를 갱신했습니다.'
            : command.type === 'review'
              ? 'Review recorded. Routing eligibility has been recalculated.'
              : 'Saved to the local topology file.',
      );
      return next;
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function saveNode() {
    if (!nodeDraft || !data) return;
    const oldIds = new Set(data.document.nodes.map((node) => node.id));
    const next = await mutate({ type: 'save-node', ...nodeDraft });
    const node = next?.document.nodes.find((item) =>
      nodeDraft.id ? item.id === nodeDraft.id : !oldIds.has(item.id),
    );
    if (node) setNodeDraft(nodeFields(node));
  }
  async function saveEdge() {
    if (!data) return;
    const oldIds = new Set(data.document.edges.map((edge) => edge.id));
    const next = await mutate({ type: 'save-edge', ...edgeDraft });
    const edge = next?.document.edges.find((item) =>
      edgeDraft.id ? item.id === edgeDraft.id : !oldIds.has(item.id),
    );
    if (edge) setEdgeDraft(edgeFields(edge));
  }
  async function deleteRecord(target: 'node' | 'edge', id: string) {
    const affected =
      data?.document.edges.filter((edge) => edge.fromNodeId === id || edge.toNodeId === id)
        .length ?? 0;
    const message =
      target === 'node'
        ? `Delete this point and its ${affected} connected passage(s), including their review history?`
        : 'Delete this connection and its review history?';
    if (!window.confirm(message)) return;
    const next = await mutate({ type: target === 'node' ? 'delete-node' : 'delete-edge', id });
    if (next) {
      setNodeDraft(null);
      setEdgeDraft(emptyEdge());
    }
  }
  async function calculateRoute() {
    if (!data || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setRoute(null);
    try {
      setRoute(
        await request<TopologyRoute>(`${endpoint}/route`, {
          revision: data.document.revision,
          fromNodeId: routeFrom,
          toNodeId: routeTo,
          mode: routeMode,
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function exportGraph() {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data.document, null, 2) + '\n'], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `campuslens-topology-r${data.document.revision}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openCandidateRoute(answer: CandidateAnswer) {
    if (!answer.bindings || !canSwitch()) return;
    setView('manual');
    setTab('route');
    const reverse = answer.direction === 'b-to-a';
    setRouteFrom(reverse ? answer.bindings.toNodeId : answer.bindings.fromNodeId);
    setRouteTo(reverse ? answer.bindings.fromNodeId : answer.bindings.toNodeId);
    showNode(reverse ? answer.bindings.toNodeId : answer.bindings.fromNodeId);
  }
  return (
    <div className="topology-app">
      <header className="topology-header">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Compass size={23} />
          </span>
          Campus<span className="brand-light">Lens</span>
        </a>
        <span>Internal topology editor</span>
        <a href="/">Photo location →</a>
      </header>
      <main>
        <div className="topology-title-row">
          <div>
            <h1>Connect the floor plans</h1>
            <p>SE12 · SW03 · SW01</p>
          </div>
          <div className="topology-actions">
            <button
              type="button"
              className="topology-button"
              onClick={exportGraph}
              disabled={!data || busy}
            >
              <Download size={16} /> Export saved graph
            </button>
            <button
              type="button"
              className="topology-button"
              onClick={() => void reload()}
              disabled={busy}
            >
              <RefreshCw size={16} /> Reload
            </button>
          </div>
        </div>
        <div className="candidate-view-tabs" aria-label="편집 방식">
          <button
            type="button"
            className="topology-button"
            aria-pressed={view === 'questions'}
            disabled={busy}
            onClick={() => {
              if (view !== 'questions' && canSwitch()) setView('questions');
            }}
          >
            후보 확인 · T / F
          </button>
          <button
            type="button"
            className="topology-button"
            aria-pressed={view === 'manual'}
            disabled={busy}
            onClick={() => {
              if (view !== 'manual' && canSwitch()) setView('manual');
            }}
          >
            직접 수정 · 경로 확인
          </button>
        </div>
        {view === 'manual' && (
          <details className="topology-guide" open={!data?.document.nodes.length}>
            <summary>How to enter the first connections</summary>
            <ol>
              <li>
                Select a plan and add points at actual doors, corridor junctions, stair landings or
                elevator stops. Label each point and save its evidence.
              </li>
              <li>
                Connect two saved points. To cross floors or buildings, switch plans while picking
                endpoints. Add separate corridor passages to reach the transition.
              </li>
              <li>
                Review both points, then their connection. Check the actual arrival floor and
                permitted direction. Unknown passages stay in draft.
              </li>
              <li>
                Use Route check to test only approved connections. Distances are optional and are
                never inferred from the drawing.
              </li>
            </ol>
            <p>
              Start with a small route you can inspect on campus. No connections have been prefilled
              from assumptions.
            </p>
          </details>
        )}
        {error && (
          <div className="topology-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="topology-notice" role="status">
            {notice}
          </p>
        )}
        {!data && !error && <p role="status">Loading the official plans and saved topology…</p>}
        {data && view === 'questions' && (
          <ConnectionReview
            key={questionReset}
            data={data}
            reviewer={reviewer}
            busy={busy}
            onReviewer={setReviewer}
            onDirty={setDirty}
            onAnswer={mutate}
            onRoute={openCandidateRoute}
          />
        )}
        {data && plan && view === 'manual' && (
          <>
            <div className="topology-status-row">
              <span>
                Revision {data.document.revision} · {data.document.nodes.length} points ·{' '}
                {data.document.edges.length} connections
              </span>
              <span>{data.eligibility.edgeIds.length} connections eligible for routing</span>
              {dirty && (
                <span className="topology-unsaved">
                  Unsaved edits{' '}
                  <button type="button" onClick={discard} disabled={busy}>
                    Discard edits
                  </button>
                </span>
              )}
            </div>
            <div className="topology-layout">
              <section className="topology-map-panel" aria-label="Official plan annotation">
                <div className="topology-map-toolbar">
                  <label>
                    Floor plan
                    <select
                      value={plan.id}
                      disabled={busy}
                      onChange={(event) => {
                        if (tab === 'points' && !canSwitch()) return;
                        setPlanId(event.target.value);
                        setZoom(100);
                        if (tab === 'points') {
                          setNodeDraft(null);
                          setPlacing(false);
                        }
                      }}
                    >
                      {data.plans.map((item) => (
                        <option key={item.id} value={item.id}>
                          {planLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="topology-zoom" aria-label="Plan zoom">
                    <button
                      type="button"
                      className="topology-button"
                      aria-label="Zoom out"
                      disabled={zoom <= 100}
                      onClick={() => setZoom((value) => Math.max(100, value - 50))}
                    >
                      <Minus size={16} />
                    </button>
                    <span>{zoom}%</span>
                    <button
                      type="button"
                      className="topology-button"
                      aria-label="Zoom in"
                      disabled={zoom >= 400}
                      onClick={() => setZoom((value) => Math.min(400, value + 50))}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <p className="topology-map-instruction" role="status">
                  {placing
                    ? 'Click the exact point on the plan. Keyboard: focus the plan and press Enter, then adjust X/Y.'
                    : picking
                      ? `Select the ${picking} point. You can switch floor plans first.`
                      : 'Select a numbered point to inspect it. Connection lines are schematic, not surveyed walking geometry.'}
                </p>
                <TopologyPlan
                  plan={plan}
                  nodes={data.document.nodes}
                  edges={data.document.edges}
                  selectedId={tab === 'points' ? nodeDraft?.id : undefined}
                  draftPoint={tab === 'points' && dirty ? nodeDraft?.point : undefined}
                  placing={placing && !busy}
                  routeEdgeIds={route?.edgeIds ?? []}
                  zoom={zoom}
                  onSelect={selectNode}
                  onPlace={(point) => {
                    setNodeDraft((current) =>
                      current
                        ? { ...current, point }
                        : {
                            planId: plan.id,
                            point,
                            label: '',
                            kind: 'door',
                            notes: '',
                            evidence: emptyEvidence(),
                          },
                    );
                    setDirty(true);
                    setPlacing(false);
                  }}
                />
                <div className="topology-plan-footer">
                  <span>
                    {plan.attribution} · page {plan.page}
                  </span>
                  <a href={plan.sourceUrl} target="_blank" rel="noreferrer">
                    Original BCIT PDF ↗
                  </a>
                </div>
                <p className="topology-help">
                  Amber: draft · Green: reviewed · Red: rejected. A reviewed record may still be
                  excluded if its source or endpoints changed.
                </p>
              </section>
              <aside className="topology-inspector">
                <div className="topology-tabs" role="tablist" aria-label="Topology tools">
                  {(['points', 'connections', 'route'] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      role="tab"
                      id={`tab-${value}`}
                      aria-controls="topology-tool-panel"
                      aria-selected={tab === value}
                      disabled={busy}
                      onClick={() => {
                        if (value !== tab && canSwitch()) {
                          setTab(value);
                          setError('');
                        }
                      }}
                    >
                      {value === 'route'
                        ? 'Route check'
                        : value === 'points'
                          ? 'Points'
                          : 'Connections'}
                    </button>
                  ))}
                </div>
                <div id="topology-tool-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
                  {tab === 'points' && (
                    <>
                      <button
                        type="button"
                        className="topology-button primary"
                        disabled={busy}
                        onClick={() => {
                          if (canSwitch()) {
                            setNodeDraft(null);
                            setPlacing(true);
                          }
                        }}
                      >
                        <Plus size={16} /> Add point on plan
                      </button>
                      <label>
                        Saved points on this floor
                        <select
                          value={nodeDraft?.id ?? ''}
                          disabled={busy}
                          onChange={(event) => {
                            const node = data.document.nodes.find(
                              (item) => item.id === event.target.value,
                            );
                            if (node) selectNode(node);
                          }}
                        >
                          <option value="">Select a point</option>
                          {data.document.nodes
                            .filter((node) => node.planId === plan.id)
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {data.document.nodes.indexOf(node) + 1}. {node.label} ·{' '}
                                {reviewStatus(node)}
                              </option>
                            ))}
                        </select>
                      </label>
                      {!nodeDraft && (
                        <p className="topology-empty">
                          {placing
                            ? 'Choose the doorway or landing on the plan.'
                            : 'Add a point or select an existing marker to enter its evidence.'}
                        </p>
                      )}
                      {nodeDraft && (
                        <NodeForm
                          value={nodeDraft}
                          busy={busy}
                          onChange={(value) => {
                            setNodeDraft(value);
                            setDirty(true);
                          }}
                          onSave={() => void saveNode()}
                          onMove={() => setPlacing(true)}
                          onDelete={() =>
                            selectedNode && void deleteRecord('node', selectedNode.id)
                          }
                        />
                      )}
                      {selectedNode && (
                        <ReviewPanel
                          key={selectedNode.id}
                          record={selectedNode}
                          target="node"
                          issue={
                            data.eligibility.issues.find((issue) => issue.id === selectedNode.id)
                              ?.reason
                          }
                          disabled={busy || dirty}
                          reviewer={reviewer}
                          onReviewer={setReviewer}
                          onReview={(command) => void mutate(command)}
                        />
                      )}
                    </>
                  )}
                  {tab === 'connections' && (
                    <>
                      <button
                        type="button"
                        className="topology-button primary"
                        disabled={busy}
                        onClick={() => {
                          if (canSwitch()) setEdgeDraft(emptyEdge());
                        }}
                      >
                        <Plus size={16} /> New connection
                      </button>
                      <label>
                        Saved connections across all floors
                        <select
                          value={edgeDraft.id ?? ''}
                          disabled={busy}
                          onChange={(event) => {
                            const edge = data.document.edges.find(
                              (item) => item.id === event.target.value,
                            );
                            if (edge && canSwitch()) {
                              setEdgeDraft(edgeFields(edge));
                              showNode(edge.fromNodeId);
                            }
                          }}
                        >
                          <option value="">Select a connection</option>
                          {data.document.edges.map((edge) => (
                            <option key={edge.id} value={edge.id}>
                              {
                                data.document.nodes.find((node) => node.id === edge.fromNodeId)
                                  ?.label
                              }{' '}
                              {edge.direction === 'both' ? '↔' : '→'}{' '}
                              {data.document.nodes.find((node) => node.id === edge.toNodeId)?.label}{' '}
                              · {reviewStatus(edge)} · {edge.id.slice(0, 6)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {data.document.nodes.length < 2 && (
                        <p className="topology-empty">
                          Save at least two points first. Their floors can be different.
                        </p>
                      )}
                      <EdgeForm
                        value={edgeDraft}
                        nodes={data.document.nodes}
                        plans={data.plans}
                        busy={busy}
                        picking={picking}
                        onChange={(value) => {
                          setEdgeDraft(value);
                          setDirty(true);
                        }}
                        onSave={() => void saveEdge()}
                        onDelete={() => selectedEdge && void deleteRecord('edge', selectedEdge.id)}
                        onPick={(value) =>
                          setPicking((current) => (current === value ? null : value))
                        }
                        onShow={showNode}
                      />
                      {selectedEdge && (
                        <ReviewPanel
                          key={selectedEdge.id}
                          record={selectedEdge}
                          target="edge"
                          issue={
                            data.eligibility.issues.find((issue) => issue.id === selectedEdge.id)
                              ?.reason
                          }
                          disabled={busy || dirty}
                          reviewer={reviewer}
                          onReviewer={setReviewer}
                          onReview={(command) => void mutate(command)}
                        />
                      )}
                    </>
                  )}
                  {tab === 'route' && (
                    <>
                      <h2>Check the reviewed graph</h2>
                      <p className="topology-help">
                        Only currently approved points and connections participate. This checks the
                        recorded topology, not your physical location or live campus conditions.
                      </p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void calculateRoute();
                        }}
                      >
                        <fieldset disabled={busy}>
                          {(['from', 'to'] as const).map((field) => (
                            <label key={field}>
                              {field === 'from' ? 'Start point' : 'Destination point'}
                              <select
                                required
                                value={field === 'from' ? routeFrom : routeTo}
                                onChange={(event) => {
                                  (field === 'from' ? setRouteFrom : setRouteTo)(
                                    event.target.value,
                                  );
                                  setRoute(null);
                                }}
                              >
                                <option value="">Select an approved point</option>
                                {data.document.nodes.map((node) => (
                                  <option
                                    key={node.id}
                                    value={node.id}
                                    disabled={!data.eligibility.nodeIds.includes(node.id)}
                                  >
                                    {pointDescription(node, data.plans)}
                                    {data.eligibility.nodeIds.includes(node.id)
                                      ? ''
                                      : ' · not approved'}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                          <label>
                            Route objective
                            <select
                              value={routeMode}
                              onChange={(event) => {
                                setRouteMode(event.target.value as TopologyRouteRequest['mode']);
                                setRoute(null);
                              }}
                            >
                              <option value="fewest-connections">
                                Fewest recorded connections
                              </option>
                              <option value="measured-distance">
                                Shortest recorded distance — measured edges only
                              </option>
                            </select>
                          </label>
                          <button
                            type="submit"
                            className="topology-button primary"
                            disabled={
                              !data.eligibility.nodeIds.includes(routeFrom) ||
                              !data.eligibility.nodeIds.includes(routeTo)
                            }
                          >
                            Calculate reviewed route
                          </button>
                        </fieldset>
                      </form>
                      {route && (
                        <section className="topology-route-result" aria-live="polite">
                          <h3>
                            {route.outcome === 'route'
                              ? `${route.edgeIds.length} connections`
                              : 'No supported route'}
                          </h3>
                          <p>{route.message}</p>
                          {route.outcome === 'route' && (
                            <>
                              <p>
                                {route.distanceMeters === null
                                  ? 'Walking distance unknown.'
                                  : `Recorded distance: ${Number(route.distanceMeters.toFixed(2))} m.`}{' '}
                                Graph revision {route.revision}.
                              </p>
                              <ol>
                                {route.nodeIds.map((id, index) => {
                                  const node = data.document.nodes.find((item) => item.id === id)!;
                                  const edge = data.document.edges.find(
                                    (item) => item.id === route.edgeIds[index],
                                  );
                                  return (
                                    <li key={`${id}-${index}`}>
                                      <button
                                        type="button"
                                        className="topology-route-point"
                                        onClick={() => showNode(id)}
                                      >
                                        {pointDescription(node, data.plans)}
                                      </button>
                                      {edge && (
                                        <details>
                                          <summary>
                                            {connectionKindLabels[edge.kind]} · connection evidence
                                          </summary>
                                          <p>{edge.evidence.note}</p>
                                          <p>{edge.notes}</p>
                                          <p className="topology-help">
                                            Reviewed by {edge.review?.reviewer} ·{' '}
                                            {edge.evidence.basis}
                                            {edge.evidence.observedOn
                                              ? ` · observed ${edge.evidence.observedOn}`
                                              : ''}
                                          </p>
                                        </details>
                                      )}
                                    </li>
                                  );
                                })}
                              </ol>
                            </>
                          )}
                        </section>
                      )}
                    </>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
