/** Provider-neutral tool contracts for a future location/destination orchestrator. */
import { z } from 'zod';
import { outgoingPassages } from './pilot-network';
import {
  contextSchema,
  getPilotContext,
  lookupPilotLabels,
  lookupSchema,
  pilotCoverage,
} from './spatial-retrieval';

function tool<T extends z.ZodObject>(name: string, description: string, input: T) {
  return {
    name,
    description,
    parametersJsonSchema: z.toJSONSchema(input, { target: 'draft-7', io: 'input' }),
  };
}
const neighborsSchema = z.object({ nodeId: z.string().uuid() }).strict();
const empty = z.object({}).strict();
export const pilotToolDeclarations = [
  tool(
    'resolve_spatial_labels',
    'Find complete labels in the three pilot buildings. Return all exact occurrences, source coordinates and evidence. The photo-derived start and matched destination can be used by the AI route planner without approved room checkpoints or door bindings. Only cross-building passages must come from mapped connections.',
    lookupSchema,
  ),
  tool(
    'get_spatial_context',
    'Read every drawing observation intersecting a normalized source-page rectangle. Proximity is drawing context only; the AI route planner selects floor paths and only mapped cross-building links constrain transfers.',
    contextSchema,
  ),
  tool(
    'get_reviewed_neighbors',
    'Read permitted outgoing connections for a reviewed checkpoint ID at the published graph revision.',
    neighborsSchema,
  ),
  tool(
    'get_spatial_coverage',
    'Read per-floor label and reviewed-network coverage for SE12, SW03 and SW01.',
    empty,
  ),
];
export function runPilotTool(name: string, args: unknown) {
  switch (name) {
    case 'resolve_spatial_labels':
      return lookupPilotLabels(lookupSchema.parse(args));
    case 'get_spatial_context':
      return getPilotContext(contextSchema.parse(args));
    case 'get_reviewed_neighbors':
      return outgoingPassages(neighborsSchema.parse(args).nodeId);
    case 'get_spatial_coverage':
      empty.parse(args);
      return pilotCoverage();
    default:
      throw new Error('Unknown pilot spatial tool');
  }
}
