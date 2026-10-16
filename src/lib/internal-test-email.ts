import { z } from "zod";

export const internalTestRequest = z.object({ id: z.uuid() }).strict();

export function internalTestRecipient(configured: string | undefined) {
  return z.email().parse(configured?.trim()).toLowerCase();
}
