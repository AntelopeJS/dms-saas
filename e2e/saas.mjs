import { expect } from "@playwright/test";

/**
 * @typedef {import("@antelopejs/dms/e2e").Ctx} Ctx
 * @typedef {import("@antelopejs/dms/e2e").Tab} Tab
 * @typedef {Parameters<Tab["locator"]>[0]} Target
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** The module's HTTP API. */
const SAAS = "/api/saas";

/** The e2e playground's trusted backend calls (`e2e/playground/src/fixture.ts`). */
const FIXTURE = "/e2e-fixture";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
function isRow(value) {
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
 * Calls the e2e playground's trusted backend.
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
 * Restarts the backend with module options set from `E2E_SAAS_*` variables (see `playground/antelope.config.ts`), runs
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
 * The plan write the editor sends, with the defaults of a plain monthly plan.
 *
 * @param {Partial<Record<string, unknown>>} fields The fields to set over the defaults
 * @returns {Record<string, unknown>} The body of `POST /plans`
 */
function planBody(fields) {
  return { name: { en: "Plan" }, slug: "plan", price: 0, currency: "EUR", interval: "month", audience: "any", billingMode: "flat", isPublic: true, isActive: true, order: 0, ...fields };
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
 * Every permission id of the plan editor's tree.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<string[]>} The ids, depth first
 */
export async function allPermissionIds(ctx) {
  const tree = await saas(ctx, "the permission tree", "GET", "/plans/permissions-tree");
  /** @type {string[]} */
  const ids = [];
  /** @param {Row[]} nodes The nodes */
  const walk = (nodes) => {
    for (const node of nodes) {
      ids.push(text(node, "id"));
      walk(list(node, "children"));
    }
  };
  walk(list(tree.body));
  return ids;
}


/**
 * Waits for a form field to hold a value, so a read after a reload does not race the field's first fill.
 *
 * @param {Tab} tab The tab
 * @param {Target} target The form field
 * @param {string} expected The value it must hold
 * @returns {Promise<Check>} The check
 */
export async function holdsValue(tab, target, expected) {
  const field = tab.locator(target);
  const label = `${target.role} "${String(target.name)}" holds ${expected}`;
  try {
    await expect(field).toHaveValue(expected, { timeout: 15_000 });
    return check(label, true, expected);
  } catch {
    return check(label, false, await field.inputValue().catch(() => "no such field"));
  }
}

/**
 * A test password built from parts, so no literal password sits in the source. Each rule of the DMS policy can be left out.
 *
 * @param {{ length?: number, upper?: boolean, digit?: boolean, special?: string }} [rules] The length (12 by default), whether it holds an uppercase letter and a digit, and its special character
 * @returns {string} The password
 */
export function passwordWith(rules = {}) {
  const { length = 12, upper = true, digit = true, special = "!" } = rules;
  return [upper ? "K" : "k", digit ? "7" : "q", special].join("").padEnd(length, "x");
}
