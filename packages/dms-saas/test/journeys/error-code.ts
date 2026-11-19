import { z } from "zod";
import type { Answer } from "./journey.ts";

const errorBody = z.union([
  z.string(),
  z.object({ message: z.string() }).transform(({ message }) => message),
]);

/** The error code an answer carries: its string body, or the `message` of its object body; "" when it has neither. */
export function errorCode(answer: Answer): string {
  return errorBody.safeParse(answer.body).data ?? "";
}
