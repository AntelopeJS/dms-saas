/** A kind of one-way door. */
export type DoorKind =
  | "data"
  | "format"
  | "contract"
  | "outbound"
  | "exposure"
  | "publish";

/** Path rules for one door kind: globs and declared funnel modules. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  why: string;
}

/**
 * How the gate decides whether a diff changed what the covered code does:
 * `emit` compares the JavaScript statements of the covered files on the
 * base and on HEAD (types, comments, formatting, imports and export
 * keywords left out); `probe` runs a command on a checkout of each, the
 * checkout's path as last argument, and compares what it prints.
 */
export type Behaviour = { kind: "emit" } | { kind: "probe"; command: string[] };

/**
 * A formal check: the source files it covers, the check's own files, the
 * command that runs it, how its output names a violated and a passing rule,
 * how the gate decides that a diff changed the covered behaviour, and the
 * command run on the base when it did or when the check's own files changed
 * (`command` when absent).
 */
export interface FormalCheck {
  name: string;
  covers: string[];
  files: string[];
  command: string[];
  baseCommand?: string[];
  violation: RegExp | null;
  passing: RegExp | null;
  behaviour: Behaviour;
}

/** The repo-owned layer of the verification skill, read by `dms-control`. */
export interface VerifyConfig {
  playground: string;
  prepare: string[][];
  userFacing: string[];
  notUserFacing: string[];
  smoke: string;
  smokeJourney: string;
  doors: Record<DoorKind, DoorRule | null>;
  formal: FormalCheck[];
}

const SKILL = ".agents/skills/verify-dms-saas";
const MODULE = "packages/dms-saas";
const INTERFACE = "packages/interface-dms-saas";
const GUARDED_PLAN_CHANGE = ".agents/skills/formal-guarded-plan-change";

const config: VerifyConfig = {
  playground: `${SKILL}/playground`,
  prepare: [
    [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    ["pnpm", "--filter", "@antelopejs/interface-dms-saas", "build"],
    ["node", `${SKILL}/prune-dist.mjs`, MODULE],
    [`${MODULE}/node_modules/.bin/tsc`, "-p", MODULE],
    [
      "npm",
      "install",
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "--prefix",
      SKILL,
      "playwright-core@1.56.1",
    ],
    ["ln", "-sfn", `../../../../${MODULE}/node_modules`, `${SKILL}/playground/node_modules`],
    [`${MODULE}/node_modules/.bin/tsc`, "-p", `${SKILL}/playground/tsconfig.build.json`],
  ],
  userFacing: [
    `${MODULE}/src/**`,
    `${MODULE}/frontend-vue/**`,
    `${MODULE}/skills/**`,
    `${MODULE}/package.json`,
    `${INTERFACE}/src/**`,
    `${INTERFACE}/package.json`,
  ],
  notUserFacing: [
    `${MODULE}/frontend-vue/.*`,
    `${MODULE}/frontend-vue/eslint.config.mjs`,
    `${MODULE}/frontend-vue/pnpm-lock.yaml`,
  ],
  smoke: "smoke",
  smokeJourney:
    "register at /register without a card, land in a workspace on the free plan, and see that plan on the Billing page",
  doors: {
    data: {
      globs: [
        `${MODULE}/src/routes/platformOwner/plans.ts`,
        `${MODULE}/src/routes/platformOwner/plan-deletion.ts`,
        `${MODULE}/src/routes/tenant/workspaces.ts`,
        `${MODULE}/src/workspaces/deletion*.ts`,
        `${MODULE}/src/crons/hard-delete-cancelled.ts`,
        `${MODULE}/src/hooks/tenant-export.ts`,
        `${MODULE}/src/workers/**`,
      ],
      funnels: [],
      why: "these delete workspaces with their data, plans, and move workspaces between plans, which a revert of the code does not bring back",
    },
    format: {
      globs: [`${INTERFACE}/src/db/**`, `${MODULE}/src/operator-actions/db/**`, `${MODULE}/src/workspaces/db/**`, `${MODULE}/src/upcoming-invoice/db/**`],
      funnels: [],
      why: "the stored subscriptions, plans, invoices, segments and webhook records are read back by the next version of the module",
    },
    contract: {
      globs: [
        `${MODULE}/package.json`,
        `${MODULE}/src/routes/**`,
        `${MODULE}/src/types/**`,
        `${INTERFACE}/package.json`,
        `${INTERFACE}/src/**`,
        `${MODULE}/frontend-vue/package.json`,
      ],
      funnels: [],
      why: "other modules import the interface, the dashboard and scripts call the HTTP routes, and projects set the config keys and the renderer range",
    },
    outbound: {
      globs: [`${MODULE}/src/stripe/**`, `${MODULE}/src/notifications/**`, `${MODULE}/src/workspaces/owner-invitation-email.ts`, `${MODULE}/src/plans/stripe-sync.ts`, `${MODULE}/src/operator-actions/lifecycle-outbox.ts`],
      funnels: [`${MODULE}/src/stripe/client.ts`],
      why: "these call Stripe, charge, refund and notify owners by e-mail, which cannot be unsent",
    },
    exposure: {
      globs: [`${MODULE}/src/auth/**`, `${MODULE}/src/routes/public/**`, `${MODULE}/src/routes/platformOwner/**`, `${MODULE}/src/plans/seat-*.ts`],
      funnels: [],
      why: "the plan resolver, the owner-only surfaces, the subscription gate and the public routes decide who sees which data and who may write the catalogue",
    },
    publish: {
      globs: [`${MODULE}/package.json`, `${INTERFACE}/package.json`, `${MODULE}/.release-it.json`, `${INTERFACE}/.release-it.json`, `${MODULE}/changelogen.config.json`, `${INTERFACE}/changelogen.config.json`, ".github/workflows/release*.yml"],
      funnels: [],
      why: "the package names, their files and the release workflows claim @antelopejs/dms-saas and @antelopejs/interface-dms-saas in the npm registry",
    },
  },
  formal: [
    {
      name: "formal-guarded-plan-change",
      covers: [
        `${MODULE}/src/plan-changes/guarded-state.ts`,
        `${MODULE}/src/plan-changes/guarded-free.ts`,
        `${MODULE}/src/plan-changes/guarded-landing.ts`,
        `${MODULE}/src/plan-changes/inventory-barrier.ts`,
        `${MODULE}/src/plan-changes/pending-target.ts`,
        `${MODULE}/src/plan-changes/deferred.ts`,
        `${MODULE}/src/crons/reconcile-guarded-downgrades.ts`,
        `${MODULE}/src/stripe/webhook-handlers.ts`,
        `${MODULE}/src/stripe/webhook-shared.ts`,
        `${MODULE}/src/auth/subscription-access-gate.ts`,
        `${INTERFACE}/src/db/models/tenantSubscriptions.model.ts`,
      ],
      files: [`${GUARDED_PLAN_CHANGE}/**`],
      command: ["node", `${GUARDED_PLAN_CHANGE}/check.mjs`, "--full"],
      baseCommand: ["node", `${GUARDED_PLAN_CHANGE}/check.mjs`],
      violation: /^(?:finding|BROKEN|CHANGED|HOLDS) +(\w+)/gm,
      passing: /(?<=^holds +(?:\w+, )*)(\w+)(?=,| \()/gm,
      behaviour: { kind: "emit" },
    },
  ],
};

export default config;
