import { z } from "zod";
import type { Answer } from "./journey.ts";

const refusal = z.union([
  z.string(),
  z.object({ message: z.string() }).transform((body) => body.message),
]);

/** The error key a refusal carries, as a bare string or as `{ message }`; "" when the body is neither. */
export function errorCode(answer: Answer): string {
  return refusal.safeParse(answer.body).data ?? "";
}
