/** Drawing-supported passage questions available to a reviewer independently of the approved graph. */
import { z } from 'zod';
import { readJson } from './data';
import { pilotEvidence, spatialDir } from './pilot-evidence';

const endpoint = z
  .object({
    planId: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.string().min(1),
    point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  })
  .strict();
const catalogue = z
  .object({
    schemaVersion: z.literal(1),
    questions: z.array(
      z
        .object({
          id: z.string().min(1),
          status: z.literal('unreviewed'),
          from: endpoint,
          to: endpoint,
          question: z.string().min(1),
          basis: z.string().min(1),
        })
        .strict(),
    ),
    supportingMap: z
      .object({
        url: z.string().url().startsWith('https://www.bcit.ca/'),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();
let cache: z.infer<typeof catalogue> | undefined;
export function passageInquiries() {
  if (cache) return cache;
  const result = catalogue.parse(readJson(spatialDir + '/passage-inquiries.json'));
  const plans = pilotEvidence().map((page) => page.plan);
  if (new Set(result.questions.map((q) => q.id)).size !== result.questions.length)
    throw new Error('Duplicate passage inquiry ID');
  for (const q of result.questions) {
    const a = plans.find((plan) => plan.id === q.from.planId),
      b = plans.find((plan) => plan.id === q.to.planId);
    if (
      !a ||
      !b ||
      a.building === b.building ||
      a.sourceSha256 !== q.from.sourceSha256 ||
      b.sourceSha256 !== q.to.sourceSha256
    ) {
      throw new Error(`Passage inquiry needs current source review: ${q.id}`);
    }
  }
  return (cache = result);
}
