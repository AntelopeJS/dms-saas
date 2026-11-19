import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Answer, Journey, Json, JsonObject } from "./journey.ts";

/** The module's HTTP API. */
export const SAAS = "/api/saas";

/** The verification playground's trusted backend calls (`playground/src/fixture.ts`). */
export const FIXTURE = "/verify-saas";

/** The tenant of a single-tenant DMS. */
export const TENANT = "default";

/** The signing secret the playground's webhook endpoint checks. */
export const WEBHOOK_SECRET = "whsec_placeholder";

const createdRow = z.object({ _id: z.string() });
const registration = z.object({ tenantId: z.string(), userId: z.string() });

/** The `_id` of the row an answer created, "" when it created none. */
export function createdId(answer: Answer): string {
  return createdRow.safeParse(answer.body).data?._id ?? "";
}

/** Calls the module's API (`/api/saas<path>`) as `as`, `admin` by default. */
export function saas(
  journey: Journey,
  label: string,
  method: string,
  path: string,
  options: { body?: Json; as?: string } = {},
): Promise<Answer> {
  return journey.api(label, {
    method,
    path: `${SAAS}${path}`,
    body: options.body,
    as: options.as,
  });
}

/** Calls the verification playground's trusted backend (`/verify-saas<path>`), anonymously. */
export function fixture(
  journey: Journey,
  label: string,
  method: string,
  path: string,
  body?: Json,
): Promise<Answer> {
  return journey.api(label, {
    method,
    path: `${FIXTURE}${path}`,
    body,
    as: "anon",
  });
}

/** A registered visitor: the answer of `POST /api/saas/register` and the account it created. */
export interface Visitor {
  answer: Answer;
  email: string;
  password: string;
  tenantId: string;
  userId: string;
}

/** Registers a visitor and, when a workspace opened, keeps the account under `name`. */
export async function register(
  journey: Journey,
  name: string,
  options: { workspaceName?: string; extras?: Json } = {},
): Promise<Visitor> {
  const email = journey.email(name);
  const password = journey.password();
  const answer = await saas(journey, `register ${name}`, "POST", "/register", {
    as: "anon",
    body: { email, password, name: `Verify ${name}`, ...options },
  });
  const { tenantId = "", userId = "" } =
    registration.safeParse(answer.body).data ?? {};
  if (tenantId) journey.addAccount(name, { email, password });
  return { answer, email, password, tenantId, userId };
}

/** The `Stripe-Signature` header Stripe sends for `payload`, signed with `secret` at `timestamp` (seconds). */
export function stripeSignature(
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Restarts the backend with module options set from `VERIFY_SAAS_*`
 * variables (see the playground's `antelope.config.ts`), runs `body`, then
 * restarts it again without them.
 */
export async function withConfig(
  journey: Journey,
  env: Record<string, string>,
  body: () => Promise<void>,
): Promise<void> {
  const previous = { ...journey.state.extraEnv };
  journey.state.extraEnv = { ...previous, ...env };
  try {
    await journey.restartBackend();
    await body();
  } finally {
    journey.state.extraEnv = previous;
    await journey.restartBackend();
  }
}

/** Tries to start the backend under options the module may refuse at start, then puts it back. */
export async function refusedAtStart(
  journey: Journey,
  env: Record<string, string>,
): Promise<{ started: boolean; failure: string }> {
  const previous = { ...journey.state.extraEnv };
  journey.state.extraEnv = { ...previous, ...env };
  let started = true;
  let failure = "";
  try {
    await journey.restartBackend();
  } catch (error) {
    started = false;
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    journey.state.extraEnv = previous;
    await journey.restartBackend();
  }
  return { started, failure };
}

/** The plan write the editor sends: a plain public monthly plan, under `fields`. */
export function planBody<Fields extends JsonObject>(fields: Fields) {
  return {
    name: { en: "Plan" },
    slug: "plan",
    price: 0,
    currency: "EUR",
    interval: "month",
    audience: "any",
    billingMode: "flat",
    isPublic: true,
    isActive: true,
    order: 0,
    ...fields,
  };
}

/** Creates a plan as the platform owner. */
export async function createPlan(
  journey: Journey,
  slug: string,
  fields: JsonObject = {},
): Promise<{ answer: Answer; id: string }> {
  const answer = await saas(
    journey,
    `create the plan ${slug}`,
    "POST",
    "/plans",
    {
      body: planBody({ slug, name: { en: slug }, ...fields }),
    },
  );
  return { answer, id: createdId(answer) };
}

/** The status and HTML the dashboard serves for `path`, without following a redirect. */
export async function page(
  journey: Journey,
  path: string,
): Promise<{ status: number; html: string }> {
  const response = await fetch(`${journey.state.webUrl}${path}`, {
    redirect: "manual",
  });
  return { status: response.status, html: await response.text() };
}

/** A Stripe event as the webhook endpoint receives it. */
export interface StripeEvent {
  type: string;
  id: string;
  object: JsonObject;
}

/**
 * Posts a Stripe event to the module's webhook endpoint with the raw body and
 * signature a real delivery carries. `secret: null` sends no signature.
 */
export async function deliverEvent(
  journey: Journey,
  event: StripeEvent,
  options: {
    secret?: string | null;
    timestamp?: number;
    previousAttributes?: JsonObject;
  } = {},
): Promise<{ status: number; body: unknown }> {
  const payload = JSON.stringify({
    id: event.id,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    type: event.type,
    data: {
      object: event.object,
      previous_attributes: options.previousAttributes,
    },
  });
  const secret = options.secret === undefined ? WEBHOOK_SECRET : options.secret;
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) {
    headers.set(
      "stripe-signature",
      stripeSignature(payload, secret, options.timestamp),
    );
  }
  const response = await fetch(
    `${journey.state.apiUrl}${SAAS}/webhooks/stripe`,
    { method: "POST", headers, body: payload },
  );
  const raw = await response.text();
  try {
    const body: unknown = JSON.parse(raw);
    return { status: response.status, body };
  } catch {
    return { status: response.status, body: raw };
  }
}

const permissionNode: z.ZodType<{ id: string; children?: PermissionNode[] }> =
  z.lazy(() =>
    z.object({ id: z.string(), children: z.array(permissionNode).optional() }),
  );
type PermissionNode = z.infer<typeof permissionNode>;

/** Every permission id of the plan editor's tree, depth first. */
export async function allPermissionIds(journey: Journey): Promise<string[]> {
  const tree = await saas(
    journey,
    "the permission tree",
    "GET",
    "/plans/permissions-tree",
  );
  const walk = (nodes: PermissionNode[]): string[] =>
    nodes.flatMap((node) => [node.id, ...walk(node.children ?? [])]);
  return walk(z.array(permissionNode).parse(tree.body));
}

/**
 * A test password built from parts, so no literal password sits in the
 * source; each rule of the DMS policy can be left out.
 */
export function passwordWith(
  rules: {
    length?: number;
    upper?: boolean;
    digit?: boolean;
    special?: string;
  } = {},
): string {
  const { length = 12, upper = true, digit = true, special = "!" } = rules;
  return [upper ? "K" : "k", digit ? "7" : "q", special]
    .join("")
    .padEnd(length, "x");
}

const PAGES_API = "/dms/pages/settings/workspace";
const SIGNUP_LINK = /\/auth\/signup\?token=([^&\s]+)/;
const createdRole = z.object({ id: z.string() });

/** Creates a role without permissions in the workspace of `owner`, and returns its id. */
export async function createRole(
  journey: Journey,
  owner: string,
): Promise<string> {
  const role = await journey.api(`${owner} creates a role`, {
    method: "POST",
    path: `${PAGES_API}/roles/create`,
    as: owner,
    body: { name: journey.unique("Member"), description: "", permissions: [] },
  });
  return createdRole.safeParse(role.body).data?.id ?? "";
}

/** Invites an address as a plain member; `token` is the e-mailed sign-up link's, "" when no mail arrived. */
export async function inviteMember(
  journey: Journey,
  owner: string,
  email: string,
  roleId: string,
): Promise<{ answer: Answer; token: string }> {
  const answer = await journey.api(`${owner} invites ${email}`, {
    method: "POST",
    path: `${PAGES_API}/members/invite`,
    as: owner,
    body: {
      emails: [email],
      roles: [roleId],
      asTenantOwner: false,
      language: "en",
    },
  });
  if (answer.status !== 200) return { answer, token: "" };
  const mail = await journey.mail(
    (message) =>
      message.to.some((to) => to.includes(email)) &&
      message.links.some((link) => SIGNUP_LINK.test(link)),
  );
  const link =
    mail.match?.links.findLast((entry) => SIGNUP_LINK.test(entry)) ?? "";
  return { answer, token: SIGNUP_LINK.exec(link)?.[1] ?? "" };
}

/** Invites a member and accepts through the sign-up route, so the account is a real member of the workspace. */
export async function joinMember(
  journey: Journey,
  owner: string,
  name: string,
  roleId?: string,
): Promise<{ email: string; password: string; ok: boolean }> {
  const role = roleId ?? (await createRole(journey, owner));
  const email = journey.email(name);
  const password = journey.password();
  const invited = await inviteMember(journey, owner, email, role);
  if (invited.token === "") return { email, password, ok: false };
  const signup = await journey.api(`${name} accepts the invitation`, {
    method: "POST",
    path: "/api/auth/signup",
    as: "anon",
    body: { name: `Verify ${name}`, email, password, token: invited.token },
  });
  if (signup.status === 200) journey.addAccount(name, { email, password });
  return { email, password, ok: signup.status === 200 };
}
