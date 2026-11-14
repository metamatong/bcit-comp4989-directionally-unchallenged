import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import type { VisualPlan } from '../src/types';
import {
  topologyBuildings,
  topologyDocumentSchema,
  topologyMutationSchema,
  type TopologyDocument,
  type TopologyNode,
  type TopologyEdge,
  type TopologyRecord,
  type TopologyEligibility,
  type TopologyBootstrap,
  type TopologyCommand,
  type CandidateEndpoint,
  type ConnectionCandidate,
} from '../src/topology';
import { root } from './data';
import { visualPlans } from './visual-data';
import { topologyRecordHash } from './topology-provenance';
import { connectionCandidateViews, readConnectionCandidates } from './topology-candidates';
import { importReviewedNetwork, initializeTopologyFile } from './topology-import';
import { reviewedNetwork } from './pilot-network';
import { needsEnglishMigration, migrateTopologyToEnglish } from './topology-english';

export class TopologyError extends Error {
  constructor(
    message: string,
    public httpStatus = 400,
  ) {
    super(message);
  }
}
export const topologyPlans = visualPlans.filter((plan) =>
  (topologyBuildings as readonly string[]).includes(plan.building),
);
export { topologyRecordHash } from './topology-provenance';
function reviewed(record: TopologyRecord) {
  return (
    record.review?.status === 'verified' &&
    record.review.recordVersion === record.version &&
    record.review.contentHash === topologyRecordHash(record)
  );
}
export function validateTopologyDocument(value: unknown): TopologyDocument {
  const document = topologyDocumentSchema.parse(value);
  const ids = [
    ...document.nodes,
    ...document.edges,
    ...document.candidateAnswers,
    ...document.floorObservations,
  ].map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new TopologyError('Topology IDs must be unique.');
  const nodes = new Set(document.nodes.map((node) => node.id));
  for (const edge of document.edges) {
    if (
      !nodes.has(edge.fromNodeId) ||
      !nodes.has(edge.toNodeId) ||
      edge.fromNodeId === edge.toNodeId
    )
      throw new TopologyError('A connection must join two different saved points.');
  }
  for (const answer of document.candidateAnswers) {
    if ((answer.answer === 'true') !== (answer.direction !== null))
      throw new TopologyError('Only a T answer can include a direction response.');
  }
  return document;
}
function evidenceProblem(record: TopologyRecord) {
  if (record.evidence.note.trim().length < 10)
    return 'Add a specific evidence note (at least 10 characters).';
  if (['field', 'plan-and-field'].includes(record.evidence.basis) && !record.evidence.observedOn)
    return 'Record the date of the field observation.';
  return null;
}
function edgeProblem(
  edge: TopologyEdge,
  nodes: Map<string, TopologyNode>,
  plans: Map<string, VisualPlan>,
) {
  const from = nodes.get(edge.fromNodeId),
    to = nodes.get(edge.toNodeId);
  if (!from || !to || from.id === to.id) return 'A connection needs two different saved points.';
  const fromPlan = plans.get(from.planId),
    toPlan = plans.get(to.planId);
  if (!fromPlan || !toPlan) return 'Both endpoints must belong to supported official plans.';
  if (edge.kind === 'corridor' && from.planId !== to.planId)
    return 'A same-floor passage must stay on one plan. Use a transition for other plans.';
  if (edge.kind === 'stairs' || edge.kind === 'elevator') {
    const requiredKind = edge.kind === 'stairs' ? 'stair-landing' : 'elevator-stop';
    if (from.kind !== requiredKind || to.kind !== requiredKind)
      return `Both endpoints must be ${requiredKind} points.`;
    if (fromPlan.building !== toPlan.building || fromPlan.floor === toPlan.floor)
      return 'Stair/elevator transitions must join different floors of the same building.';
  }
  if (edge.kind === 'building-link' && fromPlan.building === toPlan.building)
    return 'A building link must join different buildings.';
  if (edge.kind === 'outdoor' && (from.kind !== 'outdoor-access' || to.kind !== 'outdoor-access'))
    return 'An outdoor passage must join exterior doorway points.';
  return null;
}
function reviewedEdgeProblem(edge: TopologyEdge) {
  if (edge.kind === 'outdoor' && edge.evidence.basis === 'plan')
    return 'An outdoor passage needs a dated field observation of the complete passage.';
  if (edge.distanceMeters !== null && edge.distanceEvidence.trim().length < 10)
    return 'Describe how the passage distance was measured (at least 10 characters).';
  return null;
}
export function topologyEligibility(
  document: TopologyDocument,
  plans: VisualPlan[] = topologyPlans,
): TopologyEligibility {
  const result: TopologyEligibility = { nodeIds: [], edgeIds: [], issues: [] };
  const planIndex = new Map(plans.map((plan) => [plan.id, plan]));
  const nodeIndex = new Map(document.nodes.map((node) => [node.id, node]));
  for (const node of document.nodes) {
    const plan = planIndex.get(node.planId);
    const reason = !plan
      ? 'Unsupported source plan.'
      : plan.sourceSha256 !== node.sourceSha256
        ? 'The source plan changed; resave the point against the current plan and review it again.'
        : (evidenceProblem(node) ??
          (!reviewed(node) ? 'Point has no valid approval for its current version.' : null));
    if (reason) result.issues.push({ id: node.id, target: 'node', reason });
    else result.nodeIds.push(node.id);
  }
  const eligibleNodes = new Set(result.nodeIds);
  for (const edge of document.edges) {
    const from = nodeIndex.get(edge.fromNodeId),
      to = nodeIndex.get(edge.toNodeId);
    const candidateAnswer =
      edge.evidence.basis === 'user-confirmation'
        ? [...document.candidateAnswers]
            .reverse()
            .find((answer) => answer.bindings?.edgeId === edge.id)
        : undefined;
    const reason =
      (candidateAnswer &&
      (candidateAnswer.answer !== 'true' || candidateAnswer.direction === 'unknown')
        ? 'The latest candidate answer does not confirm a traversable direction.'
        : null) ??
      edgeProblem(edge, nodeIndex, planIndex) ??
      evidenceProblem(edge) ??
      reviewedEdgeProblem(edge) ??
      (!eligibleNodes.has(edge.fromNodeId) || !eligibleNodes.has(edge.toNodeId)
        ? 'Both endpoint points need current approval.'
        : null) ??
      (edge.endpointVersions.from !== from?.version || edge.endpointVersions.to !== to?.version
        ? 'An endpoint changed; review the connection again.'
        : null) ??
      (!reviewed(edge) ? 'Connection has no valid approval for its current version.' : null);
    if (reason) result.issues.push({ id: edge.id, target: 'edge', reason });
    else result.edgeIds.push(edge.id);
  }
  return result;
}
export class TopologyStore {
  private opened = false;
  constructor(
    public readonly file = resolve(root, 'data/campus/topology.json'),
    public readonly plans = topologyPlans,
    public readonly candidates: ConnectionCandidate[] = readConnectionCandidates(),
    private readonly initialNetwork:
      (() => ReturnType<typeof reviewedNetwork>) | undefined = file ===
    resolve(root, 'data/campus/topology.json')
      ? reviewedNetwork
      : undefined,
    private readonly legacyAnnotations?: ReadonlyMap<string, string>,
  ) {}

  private load(): TopologyDocument {
    try {
      let contents: string;
      try {
        contents = readFileSync(this.file, 'utf8');
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          this.opened ||
          !this.initialNetwork
        )
          throw error;
        const initial = validateTopologyDocument(
          importReviewedNetwork(this.initialNetwork(), this.candidates),
        );
        initializeTopologyFile(this.file, initial);
        contents = readFileSync(this.file, 'utf8');
      }
      const document = validateTopologyDocument(JSON.parse(contents));
      this.opened = true;
      return document;
    } catch {
      throw new TopologyError(
        'Topology storage is missing or invalid. Restore a valid backup; existing data was not reset.',
        503,
      );
    }
  }
  read(): TopologyDocument {
    const document = this.load();
    if (!needsEnglishMigration(document)) return document;
    return this.withWriteLock(() => this.upgrade(this.load()));
  }
  private upgrade(document: TopologyDocument) {
    if (needsEnglishMigration(document)) {
      migrateTopologyToEnglish(document, this.legacyAnnotations);
      this.save(document);
    }
    return document;
  }
  snapshot(): TopologyBootstrap {
    return this.present(this.read());
  }
  private present(document: TopologyDocument): TopologyBootstrap {
    const eligibility = topologyEligibility(document, this.plans);
    return {
      document,
      plans: this.plans,
      eligibility,
      candidates: connectionCandidateViews(document, this.candidates, this.plans, eligibility),
    };
  }
  mutate(value: unknown): TopologyBootstrap {
    const parsed = topologyMutationSchema.safeParse(value);
    if (!parsed.success)
      throw new TopologyError(
        `Invalid edit: ${parsed.error.issues[0]?.message ?? 'check the fields'}`,
      );
    return this.withWriteLock(() => {
      const document = this.upgrade(this.load());
      if (parsed.data.revision !== document.revision)
        throw new TopologyError(
          'Another edit changed the graph. Discard or copy your unsaved edit, reload the graph, and try again.',
          409,
        );
      document.schemaVersion = 2;
      this.apply(document, parsed.data.command);
      document.revision++;
      document.updatedAt = new Date().toISOString();
      this.save(document);
      return this.present(document);
    });
  }
  private withWriteLock<T>(action: () => T): T {
    const lockPath = `${this.file}.lock`;
    let lock: number;
    try {
      lock = openSync(lockPath, 'wx', 0o600);
    } catch {
      throw new TopologyError(
        'Topology storage is busy or not writable. Refresh and retry; a leftover .lock file may require recovery after a crash.',
        503,
      );
    }
    try {
      return action();
    } catch (error) {
      if (error instanceof TopologyError) throw error;
      throw new TopologyError(
        'The edit could not be saved. Check record limits and storage permissions; reload before retrying.',
        503,
      );
    } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }
  private save(document: TopologyDocument) {
    validateTopologyDocument(document);
    const temporaryPath = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(document, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temporaryPath, this.file);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }
  private apply(document: TopologyDocument, command: TopologyCommand) {
    if (command.type === 'answer-candidate' || command.type === 'record-floor-observation') {
      this.answerCandidate(document, command);
      return;
    }
    const now = new Date().toISOString();
    const planIndex = new Map(this.plans.map((plan) => [plan.id, plan]));
    const nodeIndex = new Map(document.nodes.map((node) => [node.id, node]));
    const find = (target: 'node' | 'edge', id: string): TopologyRecord => {
      const record = (target === 'node' ? document.nodes : document.edges).find(
        (item) => item.id === id,
      );
      if (!record) throw new TopologyError('The selected record no longer exists.', 404);
      return record;
    };
    if (command.type === 'save-node') {
      const { type: _type, id, ...fields } = command;
      const plan = planIndex.get(fields.planId);
      if (!plan) throw new TopologyError('Choose an official SE12, SW03 or SW01 plan.');
      const previous = id ? (find('node', id) as TopologyNode) : null;
      const node: TopologyNode = {
        ...fields,
        id: previous?.id ?? randomUUID(),
        sourceSha256: plan.sourceSha256,
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        review: null,
        reviewHistory: previous?.reviewHistory ?? [],
      };
      if (previous) document.nodes[document.nodes.indexOf(previous)] = node;
      else document.nodes.push(node);
      for (const edge of document.edges)
        if (edge.fromNodeId === node.id || edge.toNodeId === node.id) {
          edge.review = null;
          edge.version++;
          edge.updatedAt = now;
        }
    } else if (command.type === 'save-edge') {
      const { type: _type, id, ...fields } = command;
      const from = nodeIndex.get(fields.fromNodeId),
        to = nodeIndex.get(fields.toNodeId);
      if (!from || !to || from.id === to.id)
        throw new TopologyError('Choose two different saved points.');
      const previous = id ? (find('edge', id) as TopologyEdge) : null;
      const edge: TopologyEdge = {
        ...fields,
        id: previous?.id ?? randomUUID(),
        endpointVersions: { from: from.version, to: to.version },
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        review: null,
        reviewHistory: previous?.reviewHistory ?? [],
      };
      const problem = edgeProblem(edge, nodeIndex, planIndex);
      if (problem) throw new TopologyError(problem);
      if (previous) document.edges[document.edges.indexOf(previous)] = edge;
      else document.edges.push(edge);
    } else if (command.type === 'delete-node') {
      find('node', command.id);
      document.nodes = document.nodes.filter((node) => node.id !== command.id);
      document.edges = document.edges.filter(
        (edge) => edge.fromNodeId !== command.id && edge.toNodeId !== command.id,
      );
    } else if (command.type === 'delete-edge') {
      find('edge', command.id);
      document.edges = document.edges.filter((edge) => edge.id !== command.id);
    } else {
      const record = find(command.target, command.id);
      if (record.reviewHistory.length >= 1000)
        throw new TopologyError(
          'Review history is full. Export this graph before starting a new record.',
        );
      if (command.status === 'verified') {
        const problem = evidenceProblem(record);
        if (problem) throw new TopologyError(problem);
        if ('planId' in record) {
          if (planIndex.get(record.planId)?.sourceSha256 !== record.sourceSha256)
            throw new TopologyError(
              'The source changed. Resave the point against the current plan before reviewing.',
            );
        } else {
          const connectionProblem =
            edgeProblem(record, nodeIndex, planIndex) ?? reviewedEdgeProblem(record);
          if (connectionProblem) throw new TopologyError(connectionProblem);
          const eligible = new Set(topologyEligibility(document, this.plans).nodeIds);
          if (!eligible.has(record.fromNodeId) || !eligible.has(record.toNodeId))
            throw new TopologyError(
              'Approve both endpoint points before approving their connection.',
            );
          record.endpointVersions = {
            from: nodeIndex.get(record.fromNodeId)!.version,
            to: nodeIndex.get(record.toNodeId)!.version,
          };
        }
      }
      const review = {
        status: command.status,
        reviewer: command.reviewer,
        note: command.note,
        reviewedAt: now,
        recordVersion: record.version,
        contentHash: topologyRecordHash(record),
        evidence: structuredClone(record.evidence),
      };
      record.review = review;
      record.reviewHistory.push(review);
      if (command.target === 'node' && command.status !== 'verified') {
        for (const edge of document.edges)
          if (edge.fromNodeId === record.id || edge.toNodeId === record.id) {
            edge.review = null;
            edge.version++;
            edge.updatedAt = now;
          }
      }
    }
  }
  private answerCandidate(
    document: TopologyDocument,
    command: Extract<TopologyCommand, { type: 'answer-candidate' | 'record-floor-observation' }>,
  ) {
    const candidate = this.present(document).candidates.find(
      (item) => item.id === command.candidateId,
    );
    if (!candidate) throw new TopologyError('Unknown connection candidate.', 404);
    if (candidate.blockedReason) throw new TopologyError(candidate.blockedReason, 409);
    if (candidate.waitingForPoints)
      throw new TopologyError(
        'First confirm the door and landing at the ends of the corridor.',
        409,
      );
    if (candidate.presentedHash !== command.presentedHash)
      throw new TopologyError(
        'The candidate or its markers changed. Reload and review them again.',
        409,
      );
    if (
      command.type === 'answer-candidate' &&
      (command.answer === 'true') !== (command.direction !== null)
    )
      throw new TopologyError(
        'A T answer requires a travel direction. Leave direction empty for F or Unknown.',
      );
    const position = (side: 'from' | 'to'): CandidateEndpoint => {
      const input = command[side],
        original = candidate[side];
      if (
        candidate.endpointRefs?.[side] &&
        (input.planId !== original.planId ||
          input.point?.x !== original.point?.x ||
          input.point?.y !== original.point?.y)
      ) {
        throw new TopologyError('Edit a shared point through its original door or landing review.');
      }
      const plan = this.plans.find((item) => item.id === input.planId);
      const originalPlan = this.plans.find((item) => item.id === original.planId);
      if (
        !plan ||
        plan.building !== originalPlan?.building ||
        plan.sourceSha256 !== input.sourceSha256
      )
        throw new TopologyError(
          'A corrected point must use the current official plan for the same building.',
        );
      return {
        ...original,
        ...input,
        description:
          input.planId === original.planId
            ? original.description
            : 'The reviewer changed the floor and marker. Confirm the passage on this plan.',
      };
    };
    const first = position('from'),
      second = position('to');
    if (
      (candidate.kind === 'stairs' || candidate.kind === 'elevator') &&
      this.plans.find((plan) => plan.id === first.planId)?.floor ===
        this.plans.find((plan) => plan.id === second.planId)?.floor
    ) {
      throw new TopologyError('Select different floors for this transition.');
    }
    if (command.type === 'record-floor-observation') {
      if (!candidate.allowsFloorOnlyAnswer || (first.point && second.point)) {
        throw new TopologyError('Review the marked points to confirm this candidate.');
      }
      document.floorObservations.push({
        id: randomUUID(),
        candidateId: candidate.id,
        definitionHash: candidate.definitionHash,
        presentedHash: command.presentedHash,
        answer: command.answer,
        reviewer: command.reviewer,
        note: command.note,
        answeredAt: new Date().toISOString(),
        from: first,
        to: second,
      });
      return;
    }
    if (!first.point || !second.point) throw new TopologyError('Mark both endpoints.');
    const from = { ...first, point: first.point },
      to = { ...second, point: second.point };
    let bindings = candidate.latestAnswer?.bindings ?? null;
    const oldEdge = document.edges.find((edge) => edge.id === bindings?.edgeId);
    const answerDescription = `User confirmation of ${command.answer} with travel direction ${command.direction ?? 'not answered'}. A is on ${from.planId} and B is on ${to.planId}. Field visit unconfirmed.`;
    const evidence = {
      basis: 'user-confirmation' as const,
      observedOn: null,
      note: `${answerDescription}${command.note ? ` Reviewer note: ${command.note}` : ''}`,
    };
    const approve = (target: 'node' | 'edge', id: string) =>
      this.apply(document, {
        type: 'review',
        target,
        id,
        status: 'verified',
        reviewer: command.reviewer,
        note: `The reviewer confirmed the marked points and passage. ${answerDescription}`,
      });
    if (command.answer === 'true' && command.direction !== 'unknown') {
      const oldFrom = document.nodes.find((node) => node.id === bindings?.fromNodeId);
      const oldTo = document.nodes.find((node) => node.id === bindings?.toNodeId);
      const samePosition = (node: TopologyNode | undefined, point: typeof from) =>
        !!node &&
        node.planId === point.planId &&
        node.sourceSha256 === point.sourceSha256 &&
        node.point.x === point.point.x &&
        node.point.y === point.point.y &&
        node.kind === point.kind &&
        node.label === point.label;
      const sameEndpoints =
        (!candidate.endpointRefs?.from || oldFrom?.id === candidate.sharedEndpoints?.from?.id) &&
        (!candidate.endpointRefs?.to || oldTo?.id === candidate.sharedEndpoints?.to?.id);
      const distanceStillApplies =
        sameEndpoints &&
        samePosition(oldFrom, from) &&
        samePosition(oldTo, to) &&
        oldEdge?.kind === candidate.kind &&
        topologyEligibility(document, this.plans).edgeIds.includes(oldEdge.id);
      const resolveNodeId = (
        side: 'from' | 'to',
        point: typeof from,
        existing: TopologyNode | undefined,
      ) => {
        if (candidate.endpointRefs?.[side]) {
          const ref = candidate.sharedEndpoints?.[side];
          if (!ref) throw new TopologyError('Both corridor endpoints need approved points.', 409);
          return ref.id;
        }
        if (
          samePosition(existing, point) &&
          topologyEligibility(document, this.plans).nodeIds.includes(existing!.id)
        )
          return existing!.id;
        this.apply(document, {
          type: 'save-node',
          ...(existing ? { id: existing.id } : {}),
          planId: point.planId,
          label: point.label,
          kind: point.kind,
          point: point.point,
          notes: existing?.notes ?? `User-confirmed point for candidate ${candidate.id}.`,
          evidence,
        });
        const saved = existing
          ? document.nodes.find((node) => node.id === existing.id)!
          : document.nodes.at(-1)!;
        approve('node', saved.id);
        return saved.id;
      };
      const fromNodeId = resolveNodeId('from', from, oldFrom);
      const toNodeId = resolveNodeId('to', to, oldTo);
      const reverseOnly = command.direction === 'b-to-a';
      this.apply(document, {
        type: 'save-edge',
        ...(oldEdge ? { id: oldEdge.id } : {}),
        fromNodeId: reverseOnly ? toNodeId : fromNodeId,
        toNodeId: reverseOnly ? fromNodeId : toNodeId,
        kind: candidate.kind,
        direction: command.direction === 'both' ? 'both' : 'forward',
        notes: oldEdge?.notes ?? `Candidate ${candidate.id}. ${candidate.rationale}`,
        evidence,
        distanceMeters: distanceStillApplies ? (oldEdge?.distanceMeters ?? null) : null,
        distanceEvidence: distanceStillApplies ? (oldEdge?.distanceEvidence ?? '') : '',
      });
      const edge = oldEdge
        ? document.edges.find((item) => item.id === oldEdge.id)!
        : document.edges.at(-1)!;
      approve('edge', edge.id);
      bindings = {
        fromNodeId,
        toNodeId,
        edgeId: edge.id,
        reviewedEdgeHash: edge.review!.contentHash,
      };
    } else if (oldEdge) {
      this.apply(document, {
        type: 'review',
        target: 'edge',
        id: oldEdge.id,
        status: command.answer === 'false' ? 'rejected' : 'draft',
        reviewer: command.reviewer,
        note: `Passage withdrawn after the answer changed. ${answerDescription}`,
      });
    }
    document.candidateAnswers.push({
      id: randomUUID(),
      candidateId: candidate.id,
      definitionHash: candidate.definitionHash,
      presentedHash: command.presentedHash,
      answer: command.answer,
      direction: command.direction,
      reviewer: command.reviewer,
      note: command.note,
      answeredAt: new Date().toISOString(),
      from: structuredClone(from),
      to: structuredClone(to),
      bindings,
    });
  }
}
