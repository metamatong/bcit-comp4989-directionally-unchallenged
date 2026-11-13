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
    'Find complete labels in the three pilot buildings. Return all exact occurrences, source coordinates and evidence. Origin candidates require visual and user confirmation. A destination requires an explicit reviewed door binding for routing.',
    lookupSchema,
  ),
  tool(
    'get_spatial_context',
    'Read every drawing observation intersecting a normalized source-page rectangle and the reviewed checkpoints inside it. Proximity is drawing context only.',
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
