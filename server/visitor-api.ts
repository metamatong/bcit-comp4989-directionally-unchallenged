/** Visitor HTTP routes share one committed session and evidence record per operation. */
import { aiProviderDetails, type AiProviderName } from '../src/ai-provider';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm-campus-region'), candidateId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('reset') }).strict(),
]);
import { newSession } from './session';
import { ProviderError, type Provider } from './provider';
import {
  labelLocationRequestSchema,
  locateFromLabels,
  selectLocatedCandidate,
} from './label-localization';
import { readPhotoEvidence, PhotoEvidenceError } from './photo-evidence';
import { photoEvidenceRequestSchema, releasePhotoBytes } from './photo-media';
import { TopologyError, type TopologyStore } from './topology';
import {
  navigationSchema,
  planVisitorNavigation,
  startingPoints,
  startingPointsSchema,
} from './wayfinding';
import type { VisitorRecord, VisitorSessions } from './visitor-sessions';

type Reply = { body: unknown; status?: number; changed?: boolean; retryAfter?: number };
type Operation = (req: Request, res: Response, record: VisitorRecord) => Reply | Promise<Reply>;
const expired = { error: 'Session expired. Reload to start again.' };
function mutation(sessions: VisitorSessions, operate: Operation) {
  return async (req: Request, res: Response) => {
    const lease = await sessions.claim(String(req.params.id));
    if (!lease) {
      res.status(404).json(expired);
      return;
    }
    if (lease.busy) {
      res.status(409).json({
        error: 'The session is busy. Refresh before trying again.',
        session: lease.record.session,
      });
      return;
    }
    let reply: Reply;
    try {
      reply = await operate(req, res, lease.record);
    } catch (error) {
      await lease.finish();
      throw error;
    }
    // Publish state before returning its revision to the next function invocation.
    await lease.finish(reply.changed ? lease.record : undefined);
    if (res.destroyed) return;
    if (reply.retryAfter) res.set('Retry-After', String(reply.retryAfter));
    res.status(reply.status ?? 200).json(reply.body);
  };
}
const actionEnvelope = z
  .object({ requestId: z.string().uuid(), revision: z.number().int().min(0), action: actionSchema })
  .strict();
function action(
  req: Request,
  record: VisitorRecord,
  available: boolean,
  providerName?: AiProviderName,
): Reply {
  const { session } = record;
  const parsed = actionEnvelope.safeParse(req.body);
  if (!parsed.success)
    return { status: 400, body: { error: 'Invalid action. Check the fields and try again.' } };
  const { requestId, revision, action } = parsed.data;
  if (session.appliedActions.includes(requestId)) return { body: session };
  if (revision !== session.revision)
    return {
      status: 409,
      body: {
        error: 'The session changed. Your view has been refreshed; try the action again.',
        session,
      },
    };
  try {
    if (action.type === 'confirm-campus-region')
      selectLocatedCandidate(session, action.candidateId);
    else {
      delete record.evidence;
      Object.assign(session, newSession(available, providerName), {
        id: session.id,
        revision: session.revision,
        appliedActions: session.appliedActions,
      });
    }
    session.appliedActions = [...session.appliedActions, requestId].slice(-80);
    session.revision++;
    session.lastTouched = Date.now();
    return { body: session, changed: true };
  } catch (error) {
    session.revision++;
    session.lastTouched = Date.now();
    return {
      status: 400,
      body: {
        error: error instanceof Error ? error.message : 'Action could not be completed.',
        session,
      },
      changed: true,
    };
  }
}
type Options = { provider: Provider; liveAvailable: boolean; setupNotice?: string | null };
function photoStage(options: Options, stage: 'evidence' | 'location'): Operation {
  const provider = aiProviderDetails(options.provider.name);
  return async (req, res, record) => {
    const { session } = record;
    const parsed = (
      stage === 'evidence' ? photoEvidenceRequestSchema : labelLocationRequestSchema
    ).safeParse(req.body);
    if (!parsed.success)
      return {
        status: 400,
        body: {
          error:
            stage === 'evidence'
              ? `Choose a valid photo with its detail crops and explicitly agree to send it to ${provider.recipient}.`
              : 'Submit the current evidence ID and optional device building candidates. This step accepts no images.',
        },
      };
    if (stage === 'evidence' && !options.liveAvailable)
      return {
        status: 503,
        body: {
          error:
            options.setupNotice ??
            `${provider.label} is not configured. Add the server API key and required provider settings, then restart.`,
          providerError: { code: 'configuration', retryable: false },
          session,
        },
      };
    const input = parsed.data,
      actionKey = 'photo:' + stage + ':' + input.requestId;
    if (session.appliedActions.includes(actionKey)) return { body: session };
    if (input.revision !== session.revision)
      return {
        status: 409,
        body: {
          error: 'The session changed. Your view has been refreshed; try the photo again.',
          session,
        },
      };
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      if (stage === 'evidence' && 'image' in input) {
        session.campusAnalysis = null;
        session.campusLocation = null;
        session.photoEvidence = null;
        delete record.evidence;
        record.evidence = await readPhotoEvidence(
          session,
          input,
          options.provider,
          controller.signal,
        );
      } else if ('evidenceId' in input && typeof input.evidenceId === 'string') {
        locateFromLabels(session, input, record.evidence);
      } else
        throw new PhotoEvidenceError('Read this photo’s labels before locating its source match.');
      session.appliedActions = [...session.appliedActions, actionKey].slice(-80);
      return { body: session, changed: true };
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? {
              code: error.code,
              retryable: error.retryable,
              retryAfterSeconds: error.retryAfterSeconds,
            }
          : undefined;
      return {
        status:
          error instanceof ProviderError || error instanceof PhotoEvidenceError
            ? error.httpStatus
            : 400,
        retryAfter: providerError?.retryAfterSeconds,
        body: {
          error:
            error instanceof Error ? error.message : 'The photo evidence could not be located.',
          providerError,
          session,
        },
        changed: true,
      };
    } finally {
      session.revision++;
      session.lastTouched = Date.now();
      if ('image' in input) {
        releasePhotoBytes(input);
        releasePhotoBytes(req.body);
      }
    }
  };
}
function navigation(store: TopologyStore, origins: boolean): Operation {
  return async (req, res, { session }) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      let result;
      if (origins) {
        const input = startingPointsSchema.safeParse(req.body);
        if (!input.success)
          return { status: 400, body: { error: 'Choose a starting area from the current photo.' } };
        const candidate = session.campusAnalysis?.candidates.find(
          (c) => c.id === input.data.candidateId,
        );
        if (!candidate || input.data.revision !== session.revision)
          return {
            status: 409,
            body: {
              error: 'The photo session changed. Refresh before choosing a starting point.',
              session,
            },
          };
        result = startingPoints(candidate, store);
      } else {
        const input = navigationSchema.safeParse(req.body);
        if (!input.success)
          return {
            status: 400,
            body: {
              error: 'Enter a destination for the current photo location.',
            },
          };
        if (
          input.data.revision !== session.revision ||
          session.campusLocation?.id !== input.data.candidateId ||
          !session.campusAnalysis?.candidates.some((c) => c.id === input.data.candidateId)
        )
          return {
            status: 409,
            body: {
              error: 'Analyze a current photo before requesting directions.',
              session,
            },
          };
        result = await planVisitorNavigation(
          session.campusLocation,
          input.data,
          store,
          controller.signal,
        );
      }
      session.lastTouched = Date.now();
      return { body: result, changed: true };
    } catch (error) {
      return {
        status:
          error instanceof ProviderError
            ? error.httpStatus
            : error instanceof TopologyError
              ? error.httpStatus
              : 503,
        body: {
          error:
            error instanceof ProviderError || error instanceof TopologyError
              ? error.message
              : 'Route planning is unavailable. Try again shortly.',
        },
        changed: true,
      };
    } finally {
      session.lastTouched = Date.now();
    }
  };
}
export function visitorRouter(
  options: Options,
  sessions: VisitorSessions,
  topology: TopologyStore,
) {
  const router = Router();
  router.post('/', async (req, res) => {
    if (
      !z
        .object({})
        .strict()
        .safeParse(req.body ?? {}).success
    ) {
      res.status(400).json({ error: 'Start a session without mode or location overrides.' });
      return;
    }
    const session = newSession(options.liveAvailable, options.provider.name);
    if (!(await sessions.create(session))) {
      res.status(503).json({ error: 'Session capacity reached. Try again later.' });
      return;
    }
    res.status(201).json(session);
  });
  router.get('/:id', async (req, res) => {
    const record = await sessions.read(req.params.id);
    if (!record) {
      res.status(404).json(expired);
      return;
    }
    res.json(record.session);
  });
  router.post('/:id/photo/evidence', mutation(sessions, photoStage(options, 'evidence')));
  router.post('/:id/photo', mutation(sessions, photoStage(options, 'location')));
  router.post('/:id/photo/location', mutation(sessions, photoStage(options, 'location')));
  router.post('/:id/navigation/origins', mutation(sessions, navigation(topology, true)));
  router.post('/:id/navigation', mutation(sessions, navigation(topology, false)));
  router.post(
    '/:id/actions',
    mutation(sessions, (req, _res, record) =>
      action(req, record, options.liveAvailable, options.provider.name),
    ),
  );
  return router;
}
