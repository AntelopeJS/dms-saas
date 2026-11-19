import { z } from "zod";
import type { Answer, Journey } from "./journey.ts";
import { fixture } from "./saas.ts";

/** A day in milliseconds. */
export const DAY_MS = 86_400_000;

/** The dashboard blocks of the platform owner's back office. */
export const DASHBOARD = "/dashboard";

const dashboardEntry = z.object({ id: z.string() }).passthrough();
const dashboardItems = z.object({ items: z.array(dashboardEntry) });
const numericItems = z.object({
  items: z.array(z.object({ id: z.string(), value: z.number() })),
});
const availablePlans = z.object({
  available: z.array(z.object({ name: z.string() }).passthrough()),
});
const invitations = z.array(
  z.object({ id: z.string(), email: z.string(), expiresAt: z.string() }),
);
const errorMessage = z.union([
  z.string(),
  z.object({ message: z.string() }).transform((body) => body.message),
]);

/** A block item of a dashboard answer: its `id` and whatever it draws. */
export type DashboardItem = z.infer<typeof dashboardEntry>;

/** An instant `days` from now, as an ISO string. */
export function inDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/** The day `daysAgo` days ago, as `YYYY-MM-DD`. */
export function dayStamp(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** The error code an answer carries, as a bare string body or as a `message`; "" when it has none. */
export function errorCode(answer: Answer): string {
  return errorMessage.safeParse(answer.body).data ?? "";
}

/** The dashboard item of an answer with this `id`, undefined when the block did not draw it. */
export function dashboardItem(answer: Answer, id: string) {
  return dashboardItems
    .parse(answer.body)
    .items.find((entry) => entry.id === id);
}

/** The `value` of every item of a count block, by item id. */
export function countsById(answer: Answer): Record<string, number> {
  return Object.fromEntries(
    numericItems
      .parse(answer.body)
      .items.map((entry) => [entry.id, entry.value]),
  );
}

/** The billing state a fixture subscription is put in. */
export interface SubscriptionState {
  complimentary?: boolean;
  stripe?: boolean;
  endsInDays?: number;
  pastDueDaysAgo?: number;
}

/**
 * Puts a registered workspace on a plan in a billing state, as a paid flow
 * would leave it: Stripe ids unless it is a gift or `stripe` is false.
 */
export async function putSubscription(
  journey: Journey,
  tenantId: string,
  planId: string,
  status: string,
  state: SubscriptionState = {},
): Promise<void> {
  const { complimentary = false, stripe = !complimentary } = state;
  await fixture(
    journey,
    `put ${tenantId} on its plan as ${status}`,
    "POST",
    "/subscription",
    {
      tenantId,
      planId,
      status,
      isComplimentary: complimentary,
      stripeCustomerId: stripe ? `cus_${tenantId.slice(0, 8)}` : undefined,
      stripeSubscriptionId: stripe ? `sub_${tenantId.slice(0, 8)}` : undefined,
      currentPeriodEnd:
        state.endsInDays === undefined ? undefined : inDays(state.endsInDays),
      pastDueSince:
        state.pastDueDaysAgo === undefined
          ? undefined
          : inDays(-state.pastDueDaysAgo),
    },
  );
}

/** A billing document the fixture mirrors as Stripe would have sent it. */
export interface MirroredDocument {
  number: string;
  documentType: "invoice" | "credit_note";
  status: string;
  totalMinor: number;
  daysAgo: number;
}

/** Mirrors an invoice or a credit note of a workspace, in EUR. */
export async function mirrorDocument(
  journey: Journey,
  tenantId: string,
  mirrored: MirroredDocument,
): Promise<void> {
  await fixture(journey, `mirror ${mirrored.number}`, "POST", "/invoice", {
    tenantId,
    currency: "EUR",
    ...mirrored,
  });
}

/** The pending invitations of a workspace, as the fixture reads them. */
export async function pendingInvitations(journey: Journey, tenantId: string) {
  const answer = await fixture(
    journey,
    "the invitations",
    "GET",
    `/invites/${tenantId}`,
  );
  return invitations.parse(answer.body);
}

/** The plan of the Change plan list of a workspace's plan page with this name. */
export function availablePlan(answer: Answer, name: string) {
  return availablePlans
    .parse(answer.body)
    .available.find((entry) => entry.name === name);
}
