import { spawnSync } from "node:child_process";

/** @typedef {import("./saas.mjs").Ctx} Ctx */
/** @typedef {import("./saas.mjs").Tab} Tab */

const GONE = /signs in and leaves \/auth|ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|Target closed|has been closed|browser has disconnected|terminated|UND_ERR/i;

/**
 * Whether the run's backend and dashboard still answer, probed synchronously so any recorded step can be judged.
 *
 * @param {Ctx} ctx The journey
 * @returns {boolean} False when either is gone
 */
function environmentUp(ctx) {
  for (const url of [`${ctx.state.apiUrl}/api/onboarding/informations`, `${ctx.state.webUrl}/dms-preview`]) {
    const probe = spawnSync("curl", ["-fsS", "-m", "5", "-o", "/dev/null", url], { encoding: "utf8" });
    if (probe.status !== 0) return false;
  }
  return true;
}

const SHOW_PASSWORD = { role: "button", name: "Show password" };
const HIDE_PASSWORD = { role: "button", name: "Hide password" };
const HYDRATION_ATTEMPTS = 20;
const HYDRATION_POLL_MS = 1500;
const SIGN_IN_TIMEOUT_MS = 60_000;

/**
 * Waits until the sign-in form is interactive. The server renders it as a plain `<form method="post">` and the
 * dashboard hydrates it after the page's `load` event: a Login click before that posts the form to `/auth`, which
 * answers `{"message":"Not found"}` and leaves the page on `/auth`. The Show password toggle only works once the
 * form is hydrated, so the button becoming Hide password proves it.
 *
 * @param {Tab} tab The tab on the sign-in page
 * @returns {Promise<boolean>} Whether the form became interactive
 */
async function waitForHydration(tab) {
  for (let attempt = 0; attempt < HYDRATION_ATTEMPTS; attempt += 1) {
    await tab.click(SHOW_PASSWORD);
    const toggled = await tab.visible(HIDE_PASSWORD, { timeoutMs: HYDRATION_POLL_MS });
    if (toggled.pass) return true;
  }
  return false;
}

/**
 * Signs an account in through the sign-in form once the form is hydrated, and records the same critical check as
 * the harness's own sign-in.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab The tab to sign in
 * @param {string} account The account of the journey
 * @returns {Promise<void>}
 */
async function signInHydrated(ctx, tab, account) {
  const credentials = ctx.state.accounts?.[account];
  if (!credentials) {
    ctx.record(ctx.step(`${tab.label} signed in as ${account}`), [{ name: `${account} signs in and leaves /auth`, pass: false, detail: `no account ${account}` }], { critical: true });
    return;
  }
  await tab.goto("/auth");
  await waitForHydration(tab);
  await tab.fill({ role: "textbox", name: "Email address" }, credentials.email);
  await tab.fill({ role: "textbox", name: "Password", exact: true }, credentials.password);
  await tab.click({ role: "button", name: "Login", exact: true });
  const left = await tab.at(/^(?!\/auth)/, { timeoutMs: SIGN_IN_TIMEOUT_MS });
  ctx.record(ctx.step(`${tab.label} signed in as ${account}`), [{ name: `${account} signs in and leaves /auth`, pass: left.pass === true, detail: String(left.detail) }], { critical: true });
}

/**
 * Makes a check that fails because the environment went away NOT VERIFIED: before a step with a failing check is
 * recorded, the backend and the dashboard are probed, and when one is gone the journey ends with an error and no
 * failing check.
 *
 * @template {{ run: (ctx: Ctx) => Promise<void> }} Journey
 * @param {Journey[]} journeys The journeys of a feature
 * @returns {Journey[]} The same journeys with the guard installed
 */
export function guarded(journeys) {
  return journeys.map((journey) => ({
    ...journey,
    async run(/** @type {Ctx} */ ctx) {
      const openTab = ctx.tab.bind(ctx);
      ctx.tab = async (account, label) => {
        const tab = await openTab(account, label);
        tab.signIn = (/** @type {string} */ who) => signInHydrated(ctx, tab, who);
        return tab;
      };
      const record = ctx.record.bind(ctx);
      ctx.record = (folder, checks, options) => {
        const failing = checks.filter((check) => !check.pass);
        if (failing.length > 0 && (failing.some((check) => GONE.test(`${check.name} ${check.detail}`)) || !environmentUp(ctx))) {
          throw new Error(`NOT VERIFIED: the environment went away (${failing[0]?.detail.slice(0, 200)})`);
        }
        return record(folder, checks, options);
      };
      const verify = ctx.verify.bind(ctx);
      ctx.verify = async (label, checks, options) => {
        const results = await Promise.all(checks.map((check) => Promise.resolve(check)));
        if (results.some((check) => !check.pass) && !environmentUp(ctx)) {
          throw new Error(`NOT VERIFIED: the environment went away before "${label}" could be judged`);
        }
        return verify(label, results, options);
      };
      await journey.run(ctx);
    },
  }));
}
