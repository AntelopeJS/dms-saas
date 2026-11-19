import { z } from "zod";
import type { Answer, Journey } from "./journey.ts";
import { fixture, saas } from "./saas.ts";

export const PAGES_API = "/dms/pages/settings/workspace";

const permissionSet = z.object({ permissions: z.array(z.string()) });
const seatCounts = z.object({ seats: z.record(z.string(), z.number()) });
const userRow = z.object({ userId: z.string() });
const planRow = z.object({ slug: z.string() }).passthrough();
const leaves = z.tuple([z.string(), z.string(), z.string()]).rest(z.string());

/** The three first leaf permissions of a permission tree's ids, none of them an ancestor of another id. */
export function firstThreeLeaves(ids: string[]): [string, string, string] {
  const [a, b, c] = leaves.parse(
    ids.filter((id) => !ids.some((other) => other.startsWith(`${id}.`))),
  );
  return [a, b, c];
}

/** The effective permissions of a user in a workspace, sorted; `platformOwner` makes the user the only holder of `*`. */
export async function effective(
  journey: Journey,
  tenantId: string,
  userId: string,
  rolePermissions: string[],
  platformOwner = false,
): Promise<string[]> {
  const answer = await fixture(
    journey,
    `the effective permissions of ${userId}`,
    "POST",
    "/effective-permissions",
    { tenantId, userId, rolePermissions, platformOwner },
  );
  return permissionSet.parse(answer.body).permissions;
}

/** The permissions stored on a plan itself. */
export async function storedPermissions(
  journey: Journey,
  planId: string,
): Promise<string[]> {
  const answer = await saas(
    journey,
    "the plan's stored permissions",
    "GET",
    `/plans/${planId}`,
  );
  return permissionSet.parse(answer.body).permissions;
}

/** The seat counts block of the plan page, as `account` reads it. */
export async function seatsOf(
  journey: Journey,
  account: string,
): Promise<Record<string, number>> {
  const answer = await saas(
    journey,
    `${account} reads the seats`,
    "GET",
    "/tenant/plan",
    { as: account },
  );
  return seatCounts.parse(answer.body).seats;
}

/** Creates an account that owns no workspace, and returns its user id. */
export async function accountWithoutWorkspace(
  journey: Journey,
  email: string,
  password: string,
): Promise<string> {
  const answer = await fixture(
    journey,
    "an account that is not the owner",
    "POST",
    "/account-without-workspace",
    { email, name: "Member", password },
  );
  return userRow.parse(answer.body).userId;
}

/** Invites an address as a plain member as `owner`, without waiting for the mail. */
export function invite(
  journey: Journey,
  owner: string,
  name: string,
  roleId: string,
): Promise<Answer> {
  return journey.api(`invite ${name}`, {
    method: "POST",
    path: `${PAGES_API}/members/invite`,
    as: owner,
    body: {
      emails: [journey.email(name)],
      roles: [roleId],
      asTenantOwner: false,
      language: "en",
    },
  });
}

/** The catalogue entry of a plan, by slug. */
export async function catalogueEntry(journey: Journey, slug: string) {
  const answer = await saas(journey, "the plans", "GET", "/plans");
  return z
    .array(planRow)
    .parse(answer.body)
    .find((entry) => entry.slug === slug);
}
