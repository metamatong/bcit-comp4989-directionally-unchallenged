/** Read sanitized AI request logs and print latency distributions by model and operation. */
import { readFileSync } from 'node:fs';
import type { ProviderMetric } from '../server/provider-metrics';

const file = process.argv[2];
const lines = readFileSync(file ?? 0, 'utf8').split('\n');
const groups = new Map<string, ProviderMetric[]>();
for (const line of lines) {
  const start = line.indexOf('{');
  if (start < 0) continue;
  try {
    const value = JSON.parse(line.slice(start));
    const metric: ProviderMetric = value.metric ?? value;
    if (
      !metric.operation ||
      !metric.model ||
      !Number.isFinite(metric.elapsedMs) ||
      !['success', 'failure'].includes(metric.outcome)
    )
      continue;
    const key = [metric.provider, metric.model, metric.operation, metric.outcome].join(' / ');
    groups.set(key, [...(groups.get(key) ?? []), metric]);
  } catch {
    /* Other application log lines are outside this report. */
  }
}
function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
console.log(
  JSON.stringify(
    [...groups].map(([group, entries]) => ({
      group,
      attempts: entries.length,
      p50Ms: percentile(
        entries.map((entry) => entry.elapsedMs),
        0.5,
      ),
      p95Ms: percentile(
        entries.map((entry) => entry.elapsedMs),
        0.95,
      ),
      firstOutputP50Ms: percentile(
        entries.flatMap((entry) =>
          entry.firstOutputMs === undefined ? [] : [entry.firstOutputMs],
        ),
        0.5,
      ),
      meanImages: entries.reduce((sum, entry) => sum + entry.imageCount, 0) / entries.length,
      meanRequestBytes:
        entries.reduce((sum, entry) => sum + entry.requestBytes, 0) / entries.length,
      inputTokens: entries.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
      outputTokens: entries.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
      reasoningTokens: entries.reduce((sum, entry) => sum + (entry.reasoningTokens ?? 0), 0),
    })),
    null,
    2,
  ),
);
