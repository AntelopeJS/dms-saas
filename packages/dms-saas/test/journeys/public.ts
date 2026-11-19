import { z } from "zod";
import { errorCode } from "./error-code.ts";
import { expect, type Journey, type Json } from "./journey.ts";
import { passwordWith, saas } from "./saas.ts";

/** A password the DMS policy accepts, shared by the registrations that only need one. */
export const STRONG = passwordWith();

/** Matches any non-empty string. */
export const NON_EMPTY_STRING: unknown = expect.stringMatching(/./);

const planOpeningRegistration = z.object({
  plan: z.object({ _id: z.string() }).nullish(),
});

/** The id of the plan `GET /register/plan` says registration opens on, "" when it names none. */
export async function planRegistrationOpensOn(
  journey: Journey,
  label: string,
): Promise<string> {
  const answer = await saas(journey, label, "GET", "/register/plan", {
    as: "anon",
  });
  return planOpeningRegistration.safeParse(answer.body).data?.plan?._id ?? "";
}

/** Registers an address as an anonymous visitor and reports what the module answered. */
export async function registrationAttempt(
  journey: Journey,
  label: string,
  body: Json,
): Promise<{ status: number | null; code: string }> {
  const answer = await saas(journey, label, "POST", "/register", {
    as: "anon",
    body,
  });
  return { status: answer.status, code: errorCode(answer) };
}
