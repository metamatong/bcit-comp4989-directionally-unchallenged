import { createHash } from 'node:crypto';
import type { TopologyRecord } from '../src/topology';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
/** Stable across JSON property ordering; source hashes, points and review subjects remain exact. */
export function topologyContentHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** Reviews bind to the record's exact content and endpoint versions. */
export function topologyRecordHash(record: TopologyRecord) {
  const { review: _review, reviewHistory: _history, ...subject } = record;
  return topologyContentHash(subject);
}
