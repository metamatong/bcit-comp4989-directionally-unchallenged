/** Translate a v1 journal in place while preserving its original reviews and geometry. */
import { createHash } from 'node:crypto';
import { readJson } from './data';
import { topologyRecordHash } from './topology-provenance';
import { initialCorridorReviewHashes } from './visitor-paths';
import type { TopologyDocument } from '../src/topology';

const migration = readJson<{
  definitionHashes: Record<string, string>;
  textByHash: Record<string, string>;
}>('data/campus/topology-english-migration.json');
const knownMessage = (text: string) =>
  migration.textByHash[createHash('sha256').update(text).digest('hex')];
export const englishDefinitionHash = (previous: string) =>
  migration.definitionHashes[previous] ?? previous;

export function needsEnglishMigration(document: TopologyDocument) {
  return (
    document.schemaVersion === 1 &&
    (document.nodes.length > 0 ||
      document.edges.length > 0 ||
      document.candidateAnswers.length > 0 ||
      document.floorObservations.length > 0)
  );
}

/** Only exact legacy messages or explicitly supplied annotations have an English equivalent. */
export function translateTopologyText(
  text: string,
  annotations: ReadonlyMap<string, string> = new Map(),
): string {
  if (!/\p{Script=Hangul}/u.test(text)) return text;
  const literal = annotations.get(text) ?? knownMessage(text);
  if (literal !== undefined) return literal;

  // Generated candidate notes contain an ID, optionally followed by the original rationale.
  const candidate = /^([^a-z0-9]+)([a-z0-9-]+)([\s\S]*)$/i.exec(text);
  if (candidate) {
    const [, prefix, id, tail] = candidate;
    const hasRationale = tail.startsWith('. ');
    const template = knownMessage(prefix + '{0}' + (hasRationale ? '.' : tail));
    if (template) {
      const heading = template.replace('{0}', id);
      return hasRationale
        ? heading + ' ' + translateTopologyText(tail.slice(2), annotations)
        : heading;
    }
  }

  // A generated confirmation contains an answer, direction and two plan IDs, plus an optional note.
  let message = text;
  let note = '';
  const suffix = /\. ([^\s:]+): ([\s\S]+)$/.exec(text);
  if (suffix && knownMessage(suffix[1]) === 'Reviewer note') {
    note = ' Reviewer note: ' + (annotations.get(suffix[2]) ?? suffix[2]);
    message = text.slice(0, suffix.index + 1);
  }
  const values: string[] = [];
  const pattern = message.replace(
    /true|false|unknown|both|a-to-b|b-to-a|not answered|(?:SE12|SW3|SW1)-F\d+-p\d+/g,
    (value) => {
      const index = values.length;
      values.push(value);
      return '{' + index + '}';
    },
  );
  const template = knownMessage(pattern);
  return template ? template.replace(/\{(\d+)\}/g, (_, i) => values[Number(i)]) + note : text;
}

export function migrateTopologyToEnglish(
  document: TopologyDocument,
  annotations: ReadonlyMap<string, string> = new Map(),
): TopologyDocument {
  if (document.schemaVersion === 2) return document;
  const edges = new Map(document.edges.map((edge) => [edge.id, edge]));
  const previousEdgeHashes = new Map(
    document.edges.map((edge) => [edge.id, topologyRecordHash(edge)]),
  );
  for (const record of [...document.nodes, ...document.edges]) {
    const originalHash = topologyRecordHash(record);
    if ('label' in record) record.label = translateTopologyText(record.label, annotations);
    record.notes = translateTopologyText(record.notes, annotations);
    record.evidence.note = translateTopologyText(record.evidence.note, annotations);
    const translatedHash = topologyRecordHash(record);
    for (const review of new Set([
      ...record.reviewHistory,
      ...(record.review ? [record.review] : []),
    ])) {
      review.reviewer = annotations.get(review.reviewer) ?? review.reviewer;
      review.note = translateTopologyText(review.note, annotations);
      review.evidence.note = translateTopologyText(review.evidence.note, annotations);
      if (review.recordVersion !== record.version || originalHash === translatedHash) continue;
      if (review.contentHash === originalHash) {
        review.legacyContentHash = originalHash;
        review.contentHash = translatedHash;
      } else if (review === record.review && review.contentHash === translatedHash) {
        // An invalid old signature must not become valid just because the text changed.
        record.review = null;
      }
    }
  }

  for (const receipt of [...document.candidateAnswers, ...document.floorObservations]) {
    receipt.definitionHash = englishDefinitionHash(receipt.definitionHash);
    receipt.note = annotations.get(receipt.note) ?? receipt.note;
    receipt.reviewer = annotations.get(receipt.reviewer) ?? receipt.reviewer;
    for (const point of [receipt.from, receipt.to]) {
      point.label = translateTopologyText(point.label, annotations);
      point.description = translateTopologyText(point.description, annotations);
    }
  }
  // Retain the presentation fingerprint. Rebind a route receipt only if its old approval matches.
  for (const receipt of document.candidateAnswers) {
    const binding = receipt.bindings;
    if (!binding) continue;
    const edge = edges.get(binding.edgeId);
    const previousHash = previousEdgeHashes.get(binding.edgeId);
    const receiptHash =
      binding.reviewedEdgeHash ?? initialCorridorReviewHashes.get(receipt.candidateId);
    if (
      edge?.review?.status === 'verified' &&
      previousHash &&
      receiptHash === previousHash &&
      edge.review.recordVersion === edge.version &&
      edge.review.contentHash === topologyRecordHash(edge)
    )
      binding.reviewedEdgeHash = edge.review.contentHash;
  }
  document.schemaVersion = 2;
  document.revision++;
  return document;
}
