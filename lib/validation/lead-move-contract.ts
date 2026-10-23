import { z } from 'zod';

export const LEAD_MOVE_STAGE_CONTRACT = 'revision-v1' as const;

export const leadMoveStageCapabilitiesSchema = z.object({
  data: z.object({ contract: z.literal(LEAD_MOVE_STAGE_CONTRACT) }).passthrough(),
}).passthrough();
