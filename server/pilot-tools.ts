/** Provider-neutral tool contracts for a future location/destination orchestrator. */
import { z } from 'zod';
import { floorCoverage } from './floor-coverage';
import { floorGraphs, sourceBuilding } from './floor-graph';
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
const campusPlaceQuery = z
  .object({
    label: z.string().trim().min(1),
    building: z.string().optional(),
    floor: z.string().optional(),
  })
  .strict();
export const pilotToolDeclarations = [
  tool(
    'get_floor_routing_coverage',
    'Read place and approach coverage for every supplied floor, including missing approaches.',
    empty,
  ),
  tool(
    'get_floor_places',
    'Find exact place occurrences and walking approaches in the visitor floor graphs.',
    campusPlaceQuery,
  ),
  tool(
    'resolve_spatial_labels',
    'Inspect the original three-building evidence collection, including raw OCR and drawing annotations.',
    lookupSchema,
  ),
  tool(
    'get_spatial_context',
    'Read drawing observations in a normalized rectangle on an annotated pilot sheet.',
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
    case 'get_floor_routing_coverage':
      empty.parse(args);
      return floorCoverage();
    case 'get_floor_places': {
      const q = campusPlaceQuery.parse(args);
      return floorGraphs()
        .ordered.filter(
          (f) =>
            (!q.building || f.plan.building === sourceBuilding(q.building)) &&
            (!q.floor || f.plan.floor === q.floor),
        )
        .flatMap((f) =>
          f.places
            .filter((p) => p.label === q.label.normalize('NFKC').trim().toUpperCase())
            .map((p) => ({
              ...p,
              sourceSha256: f.plan.sourceSha256,
              sourceUrl: f.plan.sourceUrl,
              approaches: p.cells.map((id) => f.point(id)),
            })),
        );
    }
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
