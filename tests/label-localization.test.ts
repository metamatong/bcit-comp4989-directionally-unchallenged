/** Single-pass evidence resolution with exact source labels and optional building-level GPS hints. */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { locateFromLabels, labelLocationRequestSchema } from '../server/label-localization';
import { newSession } from '../server/session';
import { locationCatalogue } from '../server/geolocation';
import { gpsBuildingHint } from '../src/location/building-hint';
import type { PhotoEvidence, PhotoLabelReading } from '../src/types';
import type { GpsBuildingHint } from '../src/location/types';

const catalogue = locationCatalogue();
const label = (
  text: string,
  placement: PhotoLabelReading['placement'] = 'door',
): PhotoLabelReading => ({ text, clarity: 'clear', viewId: 'full', kind: 'room', placement });

function locate(
  labels: PhotoLabelReading[],
  gps?: GpsBuildingHint,
  visibleDoorCount: number | null = 1,
) {
  const session = newSession(true, 'openai');
  const evidence: PhotoEvidence = {
    id: randomUUID(),
    requestId: randomUUID(),
    labels,
    observations: ['A room sign is beside a visible doorway.'],
    features: { visibleDoorCount, windowsSide: 'left', corridorShape: 'straight' },
    readAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    usedFallbackModel: false,
  };
  session.photoEvidence = evidence;
  const record = {
    sessionId: session.id,
    fingerprint: 'image-bundle-fingerprint',
    evidence,
    scope: 'wayfinding-pilot' as const,
  };
  const input = labelLocationRequestSchema.parse({
    requestId: randomUUID(),
    revision: 1,
    evidenceId: evidence.id,
    ...(gps ? { gps } : {}),
  });
  const result = locateFromLabels(session, input, record);
  return { result, session, record, input };
}

const hint = (buildings: string[]): GpsBuildingHint => ({
  buildings,
  capturedAt: Date.now(),
  accuracy: 5,
  sourceSha256: catalogue.geographicSource.sha256,
});

it('resolves 302 to the unique SE12 source doorway using extracted evidence only', () => {
  const { result, session } = locate([label('302')]);
  expect(result).toMatchObject({
    outcome: 'candidates',
    method: 'photo-label-retrieval',
    atlasPlanCount: 0,
    candidates: [{ planId: 'SE12-F3-p1', doorwayVicinity: { room: '302' } }],
  });
  expect(session.providerCalls).toBe(0);
  expect(result.observations).toContain('1 visible doorway(s) reported in the photo.');
  expect(result.observations).toContain('Window observation relative to the photo is left.');
  expect(result.candidates[0].matches.every((match) => match.kind === 'printed-label')).toBe(true);
});

it('uses all clear labels to constrain the floor and the attached sign to select its doorway', () => {
  const { result } = locate([label('302'), label('306', 'other')]);
  expect(result.candidates[0].doorwayVicinity?.room).toBe('302');
  expect(result.candidates[0].labelMatches.map((match) => match.observedLabel)).toEqual([
    '302',
    '306',
  ]);
});

it.each(['3021', '0302', '302A'])('preserves the complete identifier %s', (text) => {
  expect(
    locate([label(text)]).result.candidates.some(
      (candidate) => candidate.doorwayVicinity?.room === '302',
    ),
  ).toBe(false);
});

it('abstains on conflicting, unknown, uncertain and directional-only readings', () => {
  for (const labels of [
    [label('302'), label('2605')],
    [label('302'), label('99999')],
    [{ ...label('302'), clarity: 'uncertain' as const }],
    [label('302', 'directional-sign')],
  ])
    expect(locate(labels).result.candidates).toEqual([]);
  expect(locate([label('302')], undefined, 0).result.candidates).toEqual([]);
});

it('keeps directional signs as evidence without treating them as the current doorway', () => {
  const { result } = locate([label('302'), label('2605', 'directional-sign')]);
  expect(result.candidates[0].doorwayVicinity?.room).toBe('302');
  expect(result.labelRetrieval.clearLabels).toEqual(['302', '2605']);
});

it('uses fresh GPS building candidates and reports contradictions or an outside-pilot reading', () => {
  expect(locate([label('302')], hint(['SE12'])).result).toMatchObject({
    gpsStatus: 'used',
    outcome: 'candidates',
  });
  expect(locate([label('302')], hint(['SW3'])).result).toMatchObject({
    gpsStatus: 'conflict',
    candidates: [],
  });
  expect(locate([label('302')], hint([])).result).toMatchObject({
    gpsStatus: 'outside-pilot',
    candidates: [],
  });
  expect(() =>
    locate([label('302')], { ...hint(['SE12']), capturedAt: Date.now() - 60000 }),
  ).toThrow('expired');
  expect(() => locate([label('302')], { ...hint(['SE12']), sourceSha256: '0'.repeat(64) })).toThrow(
    'map changed',
  );
});

it('narrows a repeated source identifier using the opted-in GPS building candidates', () => {
  expect(locate([label('S300', 'other')]).result.candidates).toEqual([]);
  expect(locate([label('S300', 'other')], hint(['SE12'])).result).toMatchObject({
    outcome: 'candidates',
    gpsStatus: 'used',
    candidates: [{ planId: 'SE12-F3-p1' }],
  });
});

it('binds metadata-only requests to the same current session and evidence receipt', () => {
  const { session, record, input } = locate([label('302')]);
  expect(() => locateFromLabels(session, { ...input, evidenceId: randomUUID() }, record)).toThrow(
    'current photo',
  );
  expect(() => locateFromLabels(newSession(), input, record)).toThrow('current photo');
  expect(labelLocationRequestSchema.safeParse({ ...input, image: 'photo-bytes' }).success).toBe(
    false,
  );
  expect(labelLocationRequestSchema.safeParse({ ...input, labels: ['302'] }).success).toBe(false);
});

it('derives a building hint on-device without transmitting latitude or longitude', () => {
  const ring = catalogue.buildings.find((building) => building.building === 'SE12')!.rings[0];
  const longitude =
    (Math.min(...ring.map((point) => point[0])) + Math.max(...ring.map((point) => point[0]))) / 2;
  const latitude =
    (Math.min(...ring.map((point) => point[1])) + Math.max(...ring.map((point) => point[1]))) / 2;
  const reading = {
    latitude,
    longitude,
    accuracy: 1,
    timestamp: Date.now(),
    receivedAt: Date.now(),
  };
  const result = gpsBuildingHint(reading, catalogue);
  expect(result.buildings).toEqual(['SE12']);
  expect(result).not.toHaveProperty('latitude');
  expect(result).not.toHaveProperty('longitude');
  expect(() => gpsBuildingHint({ ...reading, timestamp: Date.now() - 60000 }, catalogue)).toThrow(
    'fresh',
  );
});
