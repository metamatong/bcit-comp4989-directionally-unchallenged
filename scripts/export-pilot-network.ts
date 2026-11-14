/** Materialize a public, read-only network from a private topology-editor export. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { validateNetworkExport } from '../server/pilot-network';
import { checkedSpatialJson, pilotEvidence } from '../server/pilot-evidence';
import { englishDefinitionHash, translateTopologyText } from '../server/topology-english';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const version = z.number().int().positive();
const evidence = z.object({
  basis: z.enum(['user-confirmation', 'plan', 'field', 'plan-and-field']),
  note: z.string(),
  observedOn: z.string().date().nullable(),
});
const meta = {
  id: z.string().uuid(),
  version,
  evidence,
  review: z
    .object({
      status: z.enum(['verified', 'draft', 'rejected']),
      recordVersion: version,
      contentHash: z.string(),
      evidence,
    })
    .nullable(),
  reviewHistory: z.array(z.unknown()),
};
const inputSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  revision: z.number().int().nonnegative(),
  floorObservations: z
    .array(
      z.object({
        candidateId: z.string(),
        definitionHash: z.string(),
        answer: z.enum(['true', 'false', 'unknown']),
        answeredAt: z.string().datetime(),
        from: z.object({
          kind: z.literal('elevator-stop'),
          planId: z.string(),
          sourceSha256: z.string(),
        }),
        to: z.object({
          kind: z.literal('elevator-stop'),
          planId: z.string(),
          sourceSha256: z.string(),
        }),
      }),
    )
    .default([]),
  nodes: z.array(
    z
      .object({
        ...meta,
        planId: z.string(),
        sourceSha256: z.string(),
        label: z.string(),
        kind: z.string(),
        point: z.object({ x: z.number(), y: z.number() }),
      })
      .passthrough(),
  ),
  edges: z.array(
    z
      .object({
        ...meta,
        fromNodeId: z.string(),
        toNodeId: z.string(),
        kind: z.string(),
        direction: z.string(),
        endpointVersions: z.object({ from: version, to: version }),
        distanceMeters: z.number().positive().nullable(),
        distanceEvidence: z.string(),
      })
      .passthrough(),
  ),
  candidateAnswers: z
    .array(
      z.object({
        candidateId: z.string(),
        answeredAt: z.string().datetime(),
        answer: z.enum(['true', 'false', 'unknown']),
        direction: z.enum(['both', 'a-to-b', 'b-to-a', 'unknown']).nullable(),
        definitionHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        presentedHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        bindings: z
          .object({
            edgeId: z.string(),
            fromNodeId: z.string().uuid().optional(),
            toNodeId: z.string().uuid().optional(),
            reviewedEdgeHash: z.string().optional(),
          })
          .nullable(),
      }),
    )
    .default([]),
});

// Same key ordering as the editor; review metadata is excluded from its approval subject.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
function approved(
  record:
    z.infer<typeof inputSchema>['nodes'][number] | z.infer<typeof inputSchema>['edges'][number],
) {
  const { review, reviewHistory: _history, ...subject } = record;
  return (
    review?.status === 'verified' &&
    review.recordVersion === record.version &&
    review.contentHash === hash(JSON.stringify(canonical(subject))) &&
    record.evidence.note.trim().length >= 10 &&
    (!['field', 'plan-and-field'].includes(record.evidence.basis) || !!record.evidence.observedOn)
  );
}
export function exportPilotNetwork(bytes: Buffer) {
  const document = inputSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (document.schemaVersion === 1) {
    for (const receipt of [...document.candidateAnswers, ...document.floorObservations]) {
      if (receipt.definitionHash)
        receipt.definitionHash = englishDefinitionHash(receipt.definitionHash);
    }
  }
  const traces = z
    .object({
      traces: z.array(
        z.object({
          candidateId: z.string(),
          definitionHash: z.string(),
          initialReviewHash: z.string().optional(),
        }),
      ),
    })
    .parse(checkedSpatialJson('corridor-traces')).traces;
  const plans = pilotEvidence().map((page) => page.plan);
  const nodes = document.nodes
    .filter(
      (n) => approved(n) && plans.find((p) => p.id === n.planId)?.sourceSha256 === n.sourceSha256,
    )
    .map((n) => {
      const label = document.schemaVersion === 1 ? translateTopologyText(n.label) : n.label;
      const aliases = [label];
      const stairId = /^([A-Za-z]?\d{3,4}[A-Za-z]?) · /.exec(label)?.[1];
      if (stairId && n.kind === 'stair-landing') aliases.push(stairId);
      return {
        id: n.id,
        planId: n.planId,
        point: n.point,
        label,
        kind: n.kind,
        aliases,
        version: n.version,
        sourceSha256: n.sourceSha256,
        reviewContentHash: n.review!.contentHash,
        reviewBasis: n.evidence.basis,
        ...(n.evidence.observedOn ? { fieldObservedOn: n.evidence.observedOn } : {}),
      };
    });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const responses = new Map(
    document.candidateAnswers.filter((a) => a.bindings).map((a) => [a.bindings!.edgeId, a]),
  );
  const lastMarked = new Map(
    document.candidateAnswers.map((answer) => [answer.candidateId, answer.answeredAt]),
  );
  const lastReport = new Map(
    document.floorObservations.map((report) => [report.candidateId, report]),
  );
  const elevatorReports = [...lastReport.values()]
    .filter((r) => r.answeredAt > (lastMarked.get(r.candidateId) ?? ''))
    .map(({ candidateId, definitionHash, answer, from, to }) => ({
      candidateId,
      definitionHash,
      answer,
      from: { planId: from.planId, sourceSha256: from.sourceSha256 },
      to: { planId: to.planId, sourceSha256: to.sourceSha256 },
    }));
  const edges = document.edges
    .filter((e) => {
      const answer = responses.get(e.id);
      return (
        approved(e) &&
        byId.get(e.fromNodeId)?.version === e.endpointVersions.from &&
        byId.get(e.toNodeId)?.version === e.endpointVersions.to &&
        (e.evidence.basis !== 'user-confirmation' ||
          !answer ||
          (answer.answer === 'true' && !!answer.direction && answer.direction !== 'unknown')) &&
        (e.kind !== 'outdoor' || e.evidence.basis !== 'plan') &&
        (e.distanceMeters === null || e.distanceEvidence.trim().length >= 10)
      );
    })
    .map((e) => {
      const answer = responses.get(e.id);
      const pair = answer?.bindings;
      const candidateBinding =
        answer?.answer === 'true' &&
        answer.definitionHash &&
        answer.presentedHash &&
        pair?.fromNodeId &&
        pair.toNodeId &&
        (!pair.reviewedEdgeHash || pair.reviewedEdgeHash === e.review!.contentHash)
          ? {
              definitionHash: answer.definitionHash,
              presentedHash: answer.presentedHash,
              fromNodeId: pair.fromNodeId,
              toNodeId: pair.toNodeId,
              ...(pair.reviewedEdgeHash === e.review!.contentHash ||
              traces.some(
                (trace) =>
                  trace.candidateId === answer.candidateId &&
                  trace.definitionHash === answer.definitionHash &&
                  trace.initialReviewHash === e.review!.contentHash,
              )
                ? { reviewedEdgeHash: e.review!.contentHash }
                : {}),
            }
          : undefined;
      return {
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        kind: e.kind,
        direction: e.direction,
        version: e.version,
        endpointVersions: e.endpointVersions,
        distanceMeters: e.distanceMeters,
        reviewContentHash: e.review!.contentHash,
        reviewBasis: e.evidence.basis,
        ...(e.evidence.observedOn ? { fieldObservedOn: e.evidence.observedOn } : {}),
        sourceCandidateId: answer?.candidateId ?? null,
        ...(candidateBinding ? { candidateBinding } : {}),
      };
    });
  return validateNetworkExport(
    {
      schemaVersion: 1,
      revision: document.revision,
      sourceDocumentSha256: hash(bytes),
      nodes,
      edges,
      elevatorReports,
    },
    plans,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: export-pilot-network.ts <private topology.json> <output directory>');
  const data = exportPilotNetwork(readFileSync(input));
  const bytes = JSON.stringify(data, null, 2) + '\n';
  mkdirSync(output, { recursive: true });
  for (const [name, contents] of [
    ['reviewed-network.json', bytes],
    ['reviewed-network.sha256', hash(bytes) + '\n'],
  ]) {
    const path = join(output, name);
    writeFileSync(path + '.tmp', contents);
    renameSync(path + '.tmp', path);
  }
  console.log(
    `Exported graph revision ${data.revision}: ${data.nodes.length} approved checkpoints, ${data.edges.length} directed/bidirectional passages.`,
  );
}
