/** Derived building metadata only; raw device coordinates never cross this boundary. */
import { z } from 'zod';
import { isPilotBuilding, PILOT_BUILDINGS } from './pilot-scope';

export const gpsContextSchema = z
  .object({
    buildings: z
      .array(z.string().refine(isPilotBuilding))
      .max(PILOT_BUILDINGS.length)
      .refine((items) => new Set(items).size === items.length),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: z.number().finite(),
    accuracy: z.number().finite().nonnegative(),
  })
  .strict();
