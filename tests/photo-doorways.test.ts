import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzeCampusPhoto, confirmCampusRegion } from '../server/photo-localization';
import { readPhotoEvidence } from '../server/photo-evidence';
import { sourcePhotoReferences } from '../server/photo-grounding';
import {
  doorwayDetailParts,
  matchingDoorways,
  matchDoorwayVicinity,
} from '../server/photo-doorways';
import { pilotEvidence } from '../server/pilot-evidence';
import { retrieveRoomLabels } from '../server/room-labels';
import { verifiedVisualBytes } from '../server/visual-data';
import { TopologyStore } from '../server/topology';
import { planVisitorJourney } from '../server/wayfinding';
import type { ModelPart, Provider } from '../server/provider';
import { newSession } from '../server/session';
import { CampusLocationResults } from '../src/components/CampusLocationResults';
import type { PlanBounds } from '../src/types';
import { comparison, comparisonInput, labelReading, photoInput } from './photo-fixtures';

const plans = pilotEvidence().map((p) => p.plan);
const planIds = new Set(plans.map((p) => p.id));
function sources(labels: string[]) {
  const retrieval = retrieveRoomLabels(
    labels.map((text) => ({ text, clarity: 'clear', viewId: 'full' })),
    planIds,
  );
  const references = sourcePhotoReferences(retrieval, plans);
  return { references, options: matchingDoorways(plans, references) };
}
function supported(doorId: string, room: string) {
  return {
    doorId,
    verdict: 'supported' as const,
    observedLabel: room,
    signAtDoor: true,
    layoutVisibleInPhoto: true,
    layoutMatchesDrawing: true,
    relation: 'glazing-opposite-door' as const,
    doorSide: 'right' as const,
    glazingSide: 'left' as const,
    photoFeature: 'Windows line the corridor opposite the wall with the signed door.',
    planFeature: 'The door opens onto a strip along the exterior boundary opposite the classroom.',
  };
}
describe('visually supported doorway vicinities', () => {
  it.each([
    ['302', 'SE12-F3-p1', 'SW03 3615', 'unmapped-origin'],
    ['3615', 'SW3-F3-p1', 'SW03 2605', 'choose-origin'],
    ['2004', 'SW1-F2-p1', 'SW03 3615', 'unmapped-origin'],
  ])(
    'allows a confirmed starting vicinity for %s even without a camera rectangle',
    async (room, planId, destination, routeState) => {
      const { options } = sources([room]);
      expect(options).toHaveLength(1);
      const door = options[0].door;
      const output = comparison({
        outcome: 'insufficient_evidence',
        candidates: [],
        doorwayAssessments: [supported(door.id, room)],
      });
      const captures: ModelPart[][] = [];
      const provider: Provider = {
        calls: 0,
        async generate(contents, _tools, _signal, onAttempt, opts) {
          this.calls++;
          onAttempt?.();
          captures.push(contents[0].parts);
          return opts?.forceTool === 'read_photo_labels' ? labelReading(room) : output;
        },
      };
      const input = photoInput({ scope: 'wayfinding-pilot' }),
        session = newSession();
      const receipt = await readPhotoEvidence(session, input, provider);
      const result = await analyzeCampusPhoto(
        session,
        comparisonInput(input, receipt.evidence.id),
        provider,
        receipt,
      );
      expect(result).toMatchObject({
        outcome: 'candidates',
        localizationDecision: { cameraIssues: ['no-camera-proposal'], doorwayOutcome: 'supported' },
        candidates: [
          {
            planId,
            verification: 'unverified-ai-hypothesis',
            doorwayVicinity: { doorId: door.id, room, point: door.point },
            bounds: door.corridorBounds ?? null,
          },
        ],
      });
      expect(captures[0].some((p) => p.text?.includes(door.id))).toBe(false);
      expect(
        captures[1].some(
          (p) => p.text?.startsWith('OFFICIAL DOORWAY DETAIL') && p.text.includes(door.id),
        ),
      ).toBe(true);
      const match = result.candidates[0];
      const markup = renderToStaticMarkup(
        createElement(CampusLocationResults, {
          analysis: result,
          plans,
          onConfirm: () => {},
          busy: false,
        }),
      );
      expect(markup).toContain('I’m in this corridor');
      expect(markup).toContain(door.corridorBounds ? 'corridor-vicinity' : 'doorway-reference');
      expect(session.campusLocation).toBeNull();
      confirmCampusRegion(session, match.id);
      const store = new TopologyStore();
      const query = { revision: session.revision, candidateId: match.id, destination };
      const choices = planVisitorJourney(session.campusLocation!, query, store);
      expect(choices.status).toBe(routeState);
      if (choices.status === 'choose-origin') {
        expect(choices.origins).toHaveLength(1);
        expect(
          planVisitorJourney(
            match,
            { ...query, networkRevision: choices.networkRevision, originId: choices.origins[0].id },
            store,
          ).status,
        ).toBe('route');
      } else expect(choices.origins).toEqual([]);
    },
  );
  it('keeps alternatives separate until all competing doors are checked', () => {
    const { options, references } = sources(['2605']);
    expect(options).toHaveLength(2);
    const [a, b] = options.map((o) => supported(o.door.id, o.door.room));
    expect(matchDoorwayVicinity(options, [a], references)).toBeUndefined();
    expect(matchDoorwayVicinity(options, [a, b], references)).toBeUndefined();
    expect(
      matchDoorwayVicinity(options, [a, { ...b, verdict: 'ambiguous' }], references),
    ).toBeUndefined();
    expect(
      matchDoorwayVicinity(
        options,
        [a, { ...b, doorId: a.doorId, verdict: 'contradicted' }],
        references,
      ),
    ).toBeUndefined();
    expect(
      matchDoorwayVicinity(options, [a, { ...b, verdict: 'contradicted' }], references)
        ?.doorwayVicinity?.doorId,
    ).toBe(a.doorId);
  });
  it('requires a signed doorway and a compatible independent layout, and never invents an origin', () => {
    const { options, references } = sources(['302']);
    const a = supported(options[0].door.id, '302');
    for (const mismatch of [
      { signAtDoor: false },
      { layoutVisibleInPhoto: false },
      { layoutMatchesDrawing: false },
      { glazingSide: 'right' as const },
      { doorSide: 'unclear' as const },
      { observedLabel: '320' },
      { doorId: randomUUID() },
      { verdict: 'contradicted' as const },
      { planFeature: 'Access to room 320' },
    ]) {
      expect(matchDoorwayVicinity(options, [{ ...a, ...mismatch }], references)).toBeUndefined();
    }
    const other = sources(['320']).references;
    expect(matchDoorwayVicinity(options, [a], [...references, ...other])).toBeUndefined();
    expect(sources(['2082']).options).toEqual([]);
  });
  it('preserves a second nearby printed sign without treating the whole inspection crop as a position', () => {
    const { options, references } = sources(['2004', '2005']);
    const door = options.find((o) => o.door.room === '2004')!.door;
    const match = matchDoorwayVicinity(options, [supported(door.id, '2004')], references);
    expect(match?.sourceLabels?.map((ref) => ref.label).sort()).toEqual(['2004', '2005']);
    expect(match?.bounds).toBeNull();
    expect(match?.doorwayVicinity?.point).toEqual(door.point);
  });
  it('provides the actual pixels for each offered source doorway in page coordinates', async () => {
    const { options } = sources(['320']);
    const detail = await doorwayDetailParts(options);
    expect(detail).toHaveLength(2 * options.length);
    for (const [i, { door, plan }] of options.entries()) {
      const caption = detail[2 * i].text!;
      const record = JSON.parse(
        caption.slice(caption.indexOf('{'), caption.lastIndexOf('}') + 1),
      ) as { doorId: string; pageBounds: PlanBounds };
      expect(record.doorId).toBe(door.id);
      const [l, t, r, b] = record.pageBounds;
      const left = Math.round(l * plan.full.width),
        top = Math.round(t * plan.full.height);
      const width = Math.round(r * plan.full.width) - left,
        height = Math.round(b * plan.full.height) - top;
      const expected = await sharp(verifiedVisualBytes(plan.full))
        .extract({ left, top, width, height })
        .raw()
        .toBuffer();
      const actual = await sharp(Buffer.from(detail[2 * i + 1].inlineData!.data, 'base64'))
        .raw()
        .toBuffer();
      expect(actual.equals(expected)).toBe(true);
    }
  });
});
