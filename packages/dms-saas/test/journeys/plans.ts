import { z } from "zod";
import type { Answer, Journey } from "./journey.ts";
import { createdId, planBody, saas } from "./saas.ts";

const planIds = z.object({ current: z.object({ _id: z.string() }) });
const offeredPlans = z.object({
  available: z.array(
    z.object({ _id: z.string(), checkoutAvailable: z.boolean() }),
  ),
});
const listedPlans = z.array(z.object({ slug: z.string() }));

/** Waits for a plan to show as the visitor's current plan, and returns the id of the plan the workspace ends on. */
export async function settledPlan(
  journey: Journey,
  account: string,
  planId: string,
): Promise<string> {
  let current = "";
  for (let attempt = 0; attempt < 40 && current !== planId; attempt += 1) {
    const answer = await saas(
      journey,
      `${account}'s plan`,
      "GET",
      "/tenant/plan",
      {
        as: account,
      },
    );
    current = planIds.safeParse(answer.body).data?.current._id ?? "";
    if (current !== planId) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return current;
}

/** The slugs of the plans an answer lists, in order. */
export function slugs(answer: Answer): string[] {
  return listedPlans.parse(answer.body).map((plan) => plan.slug);
}

/** The plan of an answer's `available` list with this id, as the workspace is offered it. */
export function offeredPlan(answer: Answer, planId: string) {
  return offeredPlans
    .parse(answer.body)
    .available.find((plan) => plan._id === planId);
}

/** Starts the retirement of a plan towards a target, typing `confirmText` as its key. */
export function retirePlan(
  journey: Journey,
  sourceId: string,
  label: string,
  body: { targetPlanId: string; confirmText: string },
): Promise<Answer> {
  return saas(
    journey,
    label,
    "POST",
    `/plans-deletion/${sourceId}/migrate-and-delete`,
    { body },
  );
}

/** Creates a plan capped at `maxMembers`, under a slug that names the cap. */
export function createCappedPlan(
  journey: Journey,
  maxMembers: number,
): Promise<Answer> {
  return saas(
    journey,
    `create a plan capped at ${maxMembers}`,
    "POST",
    "/plans",
    {
      body: planBody({
        slug: `cap-${String(maxMembers).replace(/\W/g, "_")}`,
        maxMembers,
      }),
    },
  );
}

/** Creates a plan from a padded name and a yearly one without a slug, and reads both back. */
export async function createPlansFromPaddedNames(journey: Journey) {
  const first = await saas(
    journey,
    "create a plan from a padded name",
    "POST",
    "/plans",
    {
      body: {
        name: { en: "  Pro Plan  " },
        price: 0,
        currency: "EUR",
        interval: "month",
      },
    },
  );
  const second = await saas(journey, "create a second plan", "POST", "/plans", {
    body: {
      name: { en: "Second" },
      price: 0,
      currency: "EUR",
      interval: "year",
    },
  });
  const one = await saas(
    journey,
    "read the first plan",
    "GET",
    `/plans/${createdId(first)}`,
  );
  const two = await saas(
    journey,
    "read the second plan",
    "GET",
    `/plans/${createdId(second)}`,
  );
  return { first, second, one, two };
}
