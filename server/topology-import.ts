/** Initialize a new editor from the public snapshot without publishing the private review journal. */
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import type {
  CandidateEndpoint,
  ConnectionCandidate,
  TopologyDocument,
  TopologyEdge,
  TopologyNode,
  TopologyRecord,
} from '../src/topology';
import { reviewedNetwork } from './pilot-network';
import { topologyContentHash, topologyRecordHash } from './topology-provenance';

type Network = ReturnType<typeof reviewedNetwork>;

export function importReviewedNetwork(
  network: Network,
  candidates: ConnectionCandidate[],
  importedAt = new Date().toISOString(),
): TopologyDocument {
  const attribution = `Published network revision ${network.revision}`;
  // These timestamps and attribution describe this local import. Original review hashes provide provenance.
  const fields = (record: Network['nodes'][number] | Network['edges'][number]) => {
    if (
      (record.reviewBasis === 'field' || record.reviewBasis === 'plan-and-field') &&
      !record.fieldObservedOn
    )
      throw new Error(
        'This snapshot lacks original field observation dates. Restore the editor backup to import it.',
      );
    return {
      id: record.id,
      version: record.version,
      createdAt: importedAt,
      updatedAt: importedAt,
      notes: '',
      evidence: {
        basis: record.reviewBasis,
        observedOn: record.fieldObservedOn ?? null,
        note: `${attribution}, original approved record ${record.reviewContentHash}.`,
      },
      review: null,
      reviewHistory: [],
    };
  };
  function recordImport<T extends TopologyRecord>(record: T): T {
    const review = {
      status: 'verified' as const,
      reviewer: attribution,
      note: 'Imported existing approval from the published pilot network.',
      reviewedAt: importedAt,
      recordVersion: record.version,
      contentHash: topologyRecordHash(record),
      evidence: { ...record.evidence },
    };
    record.review = review;
    record.reviewHistory = [review];
    return record;
  }
  const nodes = network.nodes.map((n) =>
    recordImport<TopologyNode>({
      ...fields(n),
      planId: n.planId,
      sourceSha256: n.sourceSha256,
      label: n.label,
      kind: n.kind,
      point: { ...n.point },
    }),
  );
  const edges = network.edges.map((e) =>
    recordImport<TopologyEdge>({
      ...fields(e),
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      kind: e.kind,
      direction: e.direction,
      endpointVersions: { ...e.endpointVersions },
      distanceMeters: e.distanceMeters,
      distanceEvidence:
        e.distanceMeters === null ? '' : `Reviewed measurement from ${e.reviewContentHash}`,
    }),
  );
  const points = new Map(nodes.map((n) => [n.id, n]));
  const definitions = new Map(candidates.map((c) => [c.id, c]));
  const receipts: TopologyDocument['candidateAnswers'] = [];
  for (const [index, edge] of network.edges.entries()) {
    const binding = edge.candidateBinding,
      candidate = edge.sourceCandidateId && definitions.get(edge.sourceCandidateId);
    if (!binding || !candidate || topologyContentHash(candidate) !== binding.definitionHash)
      continue;
    function endpoint(definition: CandidateEndpoint, nodeId: string) {
      const n = points.get(nodeId)!;
      return {
        ...definition,
        planId: n.planId,
        sourceSha256: n.sourceSha256,
        point: { ...n.point },
        label: n.label,
        kind: n.kind,
      };
    }
    receipts.push({
      id: randomUUID(),
      candidateId: candidate.id,
      definitionHash: binding.definitionHash,
      presentedHash: binding.presentedHash,
      answer: 'true',
      direction:
        edge.direction === 'both'
          ? 'both'
          : edge.fromNodeId === binding.fromNodeId
            ? 'a-to-b'
            : 'b-to-a',
      from: endpoint(candidate.from, binding.fromNodeId),
      to: endpoint(candidate.to, binding.toNodeId),
      reviewer: attribution,
      answeredAt: importedAt,
      note: 'Imported the published endpoint and direction confirmation.',
      bindings: {
        fromNodeId: binding.fromNodeId,
        toNodeId: binding.toNodeId,
        edgeId: edge.id,
        ...(binding.reviewedEdgeHash === edge.reviewContentHash
          ? { reviewedEdgeHash: edges[index].review!.contentHash }
          : {}),
      },
    });
  }
  const reports: TopologyDocument['floorObservations'] = [];
  for (const report of network.elevatorReports) {
    const candidate = definitions.get(report.candidateId);
    if (!candidate || topologyContentHash(candidate) !== report.definitionHash) continue;
    reports.push({
      id: randomUUID(),
      candidateId: candidate.id,
      definitionHash: report.definitionHash,
      presentedHash: topologyContentHash(report),
      answeredAt: importedAt,
      reviewer: attribution,
      answer: report.answer,
      note: 'Imported the published floor-service report; boarding points were not published.',
      from: { ...candidate.from, ...report.from, point: null },
      to: { ...candidate.to, ...report.to, point: null },
    });
  }
  return {
    schemaVersion: 2,
    revision: network.revision,
    updatedAt: importedAt,
    nodes,
    edges,
    candidateAnswers: receipts,
    floorObservations: reports,
  };
}

/** An atomic, no-overwrite install also handles two simultaneous first launches. */
export function initializeTopologyFile(file: string, doc: TopologyDocument) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, JSON.stringify(doc, null, 2) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    unlinkSync(temporary);
  }
}
