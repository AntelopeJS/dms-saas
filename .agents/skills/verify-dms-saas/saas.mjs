import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {import("../../../packages/dms-saas/node_modules/@antelopejs/dms/bin/control/journey.mjs").JourneyContext} Ctx
 * @typedef {import("../../../packages/dms-saas/node_modules/@antelopejs/dms/bin/control/tab.mjs").Tab} Tab
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {{ folder: string, status: number | null, headers: Record<string, string>, bytes: Buffer, text: string, json: unknown }} Raw
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** The module's HTTP API. */
export const SAAS = "/api/saas";

/** The verification playground's trusted backend calls (`playground/src/fixture.ts`). */
export const FIXTURE = "/verify-saas";

/** The tenant of a single-tenant DMS. */
export const TENANT = "default";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
export function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is string} Whether it is a string
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * Reads a nested field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {unknown} The field, or undefined when a step is missing
 */
export function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (!isRow(current)) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string} The field when it is a string, else the empty string
 */
export function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * The objects of an array field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {Row[]} The array's objects, empty when the field is not an array
 */
export function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string[]} The `name` of each object of the array field
 */
export function names(value, ...path) {
  return list(value, ...path).map((row) => text(row, "name"));
}

/**
 * A check, in the shape `ctx.record` takes.
 *
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
export function check(name, pass, detail) {
  return { name, pass: pass === true, detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined") };
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the module's API (`/api/saas`)
 * @param {{ body?: unknown, as?: string }} [options] The JSON body, and the account (`admin` by default, `anon` for nobody)
 * @returns {Promise<Answer>} The answer
 */
export function saas(ctx, label, method, path, options = {}) {
  return ctx.api(label, { method, path: `${SAAS}${path}`, body: options.body, as: options.as });
}

/**
 * Calls the verification playground's trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the fixture
 * @param {unknown} [body] The JSON body
 * @returns {Promise<Answer>} The answer
 */
export function fixture(ctx, label, method, path, body) {
  return ctx.api(label, { method, path: `${FIXTURE}${path}`, body, as: "anon" });
}

/**
 * Registers a visitor through `POST /api/saas/register` and keeps the account for the journey's tabs and calls.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name of the journey
 * @param {{ workspaceName?: string, extras?: unknown }} [options] What the registration sends besides the account
 * @returns {Promise<{ answer: Answer, email: string, password: string, tenantId: string, userId: string }>} The answer and the account
 */
export async function register(ctx, name, options = {}) {
  const email = ctx.email(name);
  const password = ctx.password();
  const answer = await saas(ctx, `register ${name}`, "POST", "/register", {
    as: "anon",
    body: { email, password, name: `Verify ${name}`, ...options },
  });
  const tenantId = text(answer.body, "tenantId");
  const userId = text(answer.body, "userId");
  if (tenantId) ctx.addAccount(name, { email, password });
  return { answer, email, password, tenantId, userId };
}

/**
 * Signs a Stripe webhook payload the way Stripe does, with the secret the run configures.
 *
 * @param {string} payload The raw JSON body
 * @param {string} secret The endpoint's signing secret
 * @param {number} [timestamp] The signing time in seconds
 * @returns {string} The `Stripe-Signature` header value
 */
export function stripeSignature(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Restarts the backend with module options set from `VERIFY_SAAS_*` variables (see `playground/antelope.config.ts`), runs
 * `body`, then restarts it again without them.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env The variables to set
 * @param {() => Promise<void>} body What to do under that configuration
 * @returns {Promise<void>}
 */
export async function withConfig(ctx, env, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * Tries to start the backend under a configuration the module refuses at start, and puts it back.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env The variables to set
 * @returns {Promise<{ started: boolean, failure: string }>} Whether the backend came up, and why not
 */
export async function refusedAtStart(ctx, env) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  let started = true;
  let failure = "";
  try {
    await ctx.restartBackend();
  } catch (error) {
    started = false;
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
  return { started, failure };
}

/**
 * The plan write the editor sends, with the defaults of a plain monthly plan.
 *
 * @param {Partial<Record<string, unknown>>} fields The fields to set over the defaults
 * @returns {Record<string, unknown>} The body of `POST /plans`
 */
export function planBody(fields) {
  return { name: { en: "Plan" }, slug: "plan", price: 0, currency: "EUR", interval: "month", audience: "any", isPublic: true, isActive: true, order: 0, ...fields };
}

/**
 * Creates a plan as the platform owner.
 *
 * @param {Ctx} ctx The journey
 * @param {string} slug The plan's slug
 * @param {Partial<Record<string, unknown>>} [fields] Fields over the defaults of {@link planBody}
 * @returns {Promise<{ answer: Answer, id: string }>} The answer and the plan's id
 */
export async function createPlan(ctx, slug, fields = {}) {
  const answer = await saas(ctx, `create the plan ${slug}`, "POST", "/plans", { body: planBody({ slug, name: { en: slug }, ...fields }) });
  return { answer, id: text(answer.body, "_id") };
}

/**
 * Reads what the module answers for one page of the dashboard, by its server-rendered text.
 *
 * @param {Ctx} ctx The journey
 * @param {string} path The page path
 * @returns {Promise<string>} The page's HTML
 */
export async function pageHtml(ctx, path) {
  const folder = ctx.step(`GET ${path} on the dashboard`);
  const response = await fetch(`${ctx.state.webUrl}${path}`, { redirect: "manual" });
  const html = await response.text();
  writeFileSync(join(folder, "response.json"), `${JSON.stringify({ status: response.status, bytes: html.length }, null, 2)}\n`);
  return html;
}
