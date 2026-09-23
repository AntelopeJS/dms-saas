import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const packageNameParts = manifest.name.split("/");
const typescriptBin = require.resolve("typescript/bin/tsc");
const CONCURRENCY = 8;
const NON_CODE_SUBPATHS = new Set(["./package.json"]);

const INTERFACE_SPECIFIERS = {
  root: `@antelopejs/interface-dms-saas`,
  billing: `@antelopejs/interface-dms-saas/billing`,
  dataApi: `@antelopejs/interface-dms-saas/data-api`,
  db: `@antelopejs/interface-dms-saas/db`,
  invoiceLineItems: `@antelopejs/interface-dms-saas/invoice-line-items`,
  pages: `@antelopejs/interface-dms-saas/pages`,
  plans: `@antelopejs/interface-dms-saas/plans`,
  provisioning: `@antelopejs/interface-dms-saas/provisioning`,
  registration: `@antelopejs/interface-dms-saas/registration`,
  workspaceLifecycle: `@antelopejs/interface-dms-saas/workspace-lifecycle`,
};
const EXPECTED_RUNTIME_EXPORTS = {
  [manifest.name]: ["construct", "start", "stop"],
  [INTERFACE_SPECIFIERS.billing]: [
    "GetTenantCustomerBalance",
    "isComplimentarySubscription",
  ],
  [INTERFACE_SPECIFIERS.dataApi]: ["HiddenStringFilter"],
  [INTERFACE_SPECIFIERS.db]: [
    "BILLING_SETTINGS_SINGLETON_ID",
    "BILLING_STATES",
    "BillingSettings",
    "BillingSettingsModel",
    "CREDIT_NOTE_STATUSES",
    "CREDIT_NOTE_TYPES",
    "CreditNote",
    "CreditNoteModel",
    "DEFAULT_AUTO_SUSPEND_DELAY_DAYS",
    "DEFAULT_DATA_RETENTION_DAYS",
    "DEFAULT_MAX_FREE_WORKSPACES_PER_CARD",
    "DEFAULT_STRIPE_TAX_CODE",
    "DunningClock",
    "FEATURE_DEFAULT_ORDER",
    "FEATURE_VALUE_TYPES",
    "Feature",
    "FeatureModel",
    "INVOICE_STATUSES",
    "Invoice",
    "InvoiceModel",
    "LEGAL_DOCUMENTS_SINGLETON_ID",
    "LegalDocuments",
    "LegalDocumentsModel",
    "PLAN_AUDIENCES",
    "PLAN_BILLING_MODES",
    "PLAN_INTERVALS",
    "PLAN_MIGRATION_STATUSES",
    "PLATFORM_NOTE_TARGET_TYPES",
    "Plan",
    "PlanMigration",
    "PlanMigrationModel",
    "PlanModel",
    "PlatformNote",
    "PlatformNoteModel",
    "REFUND_PRORATA_MODES",
    "REFUND_STATUSES",
    "Refund",
    "RefundModel",
    "SEGMENT_LOGICAL",
    "SEGMENT_MEMBER_ROLES",
    "SEGMENT_OPERATORS",
    "SEGMENT_QUANTIFIERS",
    "Segment",
    "SegmentModel",
    "StripeWebhookEvent",
    "StripeWebhookEventModel",
    "SUPPORT_EVENT_ORDER_INDEX",
    "SUPPORT_MESSAGE_AUTHOR_TYPES",
    "SUPPORT_MESSAGE_ORDER_INDEX",
    "SUPPORT_TICKET_CATEGORIES",
    "SUPPORT_TICKET_ORDER_INDEX",
    "SUPPORT_TICKET_PRIORITIES",
    "SUPPORT_TICKET_STATUSES",
    "SUPPORT_TICKET_STATUS_ORDER_INDEX",
    "SupportMessage",
    "SupportMessageModel",
    "SupportTicket",
    "SupportTicketEvent",
    "SupportTicketEventModel",
    "SupportTicketModel",
    "TENANT_CUSTOMER_TYPES",
    "TENANT_SUBSCRIPTION_STATUSES",
    "TenantBillingInfo",
    "TenantBillingInfoModel",
    "TenantBillingState",
    "TenantBillingStateModel",
    "TenantSubscription",
    "TenantSubscriptionModel",
    "TrialConsumption",
    "TrialConsumptionModel",
    "UserSegment",
    "UserSegmentModel",
    "VAT_VERIFICATION_STATUSES",
    "WEBHOOK_RESULTS",
    "billingSettingsTableName",
    "creditNotesTableName",
    "featuresTableName",
    "invoicesTableName",
    "legalDocumentsTableName",
    "planMigrationsTableName",
    "plansTableName",
    "platformNotesTableName",
    "refundsTableName",
    "segmentsTableName",
    "stripeWebhookEventsTableName",
    "supportMessagesTableName",
    "supportTicketEventsTableName",
    "supportTicketsTableName",
    "tenantBillingInfoTableName",
    "tenantBillingStateTableName",
    "tenantSubscriptionsTableName",
    "trialConsumptionsTableName",
    "userSegmentsTableName",
  ],
  [INTERFACE_SPECIFIERS.invoiceLineItems]: [
    "LINE_KEY_SEPARATOR",
    "RegisterInvoiceLineItemsProvider",
    "UnregisterInvoiceLineItemsProvider",
    "buildInvoiceLineKey",
    "internal",
    "selectInvoiceLineItemsToCreate",
  ],
  [INTERFACE_SPECIFIERS.pages]: [
    "GetPlatformSaasModule",
    "GetWorkspaceSettingsCategory",
    "RegisterPlatformWorkspaceDetailPageExtension",
    "RegisterTenantBillingPageExtension",
    "platformSaasModule",
    "platformWorkspaceDetailPage",
    "tenantBillingPage",
    "workspaceSettingsCategory",
  ],
  [INTERFACE_SPECIFIERS.plans]: [
    "buildTenantPlanCatalog",
    "isDowngrade",
    "monthlyPrice",
  ],
  [INTERFACE_SPECIFIERS.provisioning]: [],
  [INTERFACE_SPECIFIERS.registration]: ["REGISTRATION_EXTRAS_LIMITS"],
  [INTERFACE_SPECIFIERS.workspaceLifecycle]: [
    "IsWorkspaceProvisioningCommitted",
    "RegisterWorkspaceLifecycleConsumer",
    "UnregisterWorkspaceLifecycleConsumer",
    "WORKSPACE_LIFECYCLE_TRANSITIONS",
    "internal",
  ],
};

import { consumerSource } from "./check-package-contract-fixture.mjs";

const TYPESCRIPT_MODES = [
  { name: "legacy-node", module: "commonjs", moduleResolution: "node" },
  { name: "node16", module: "Node16", moduleResolution: "Node16" },
  { name: "bundler", module: "esnext", moduleResolution: "bundler" },
];

function packageManagerInvocation(args) {
  const packageManagerPath = process.env.npm_execpath;
  if (packageManagerPath) {
    return { command: process.execPath, args: [packageManagerPath, ...args] };
  }
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return { command, args };
}

async function createPackageTarball(temporaryRoot) {
  const tarball = path.join(temporaryRoot, "package.tgz");
  const invocation = packageManagerInvocation([
    "--config.ignore-scripts=true",
    "--reporter=silent",
    "pack",
    "--out",
    tarball,
  ]);
  await execFileAsync(invocation.command, invocation.args, {
    cwd: packageRoot,
  });
  return tarball;
}

async function extractPackage(tarball, consumerRoot) {
  const packageDir = path.join(
    consumerRoot,
    "node_modules",
    ...packageNameParts,
  );
  fs.mkdirSync(packageDir, { recursive: true });
  await execFileAsync(
    "tar",
    ["-xzf", tarball, "--strip-components=1", "-C", packageDir],
    { cwd: packageRoot },
  );
}

function collectRuntimeTargets(value, condition) {
  if (condition === "types" || value === null) {
    return [];
  }
  if (typeof value === "string") {
    return value.endsWith(".json") ? [] : [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectRuntimeTargets(entry));
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    collectRuntimeTargets(entry, key),
  );
}

function listPackageFiles(packageDir) {
  return fs
    .readdirSync(packageDir, { recursive: true })
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) => fs.statSync(path.join(packageDir, entry)).isFile());
}

function expandWildcardSubpath(subpath, target, packageFiles) {
  const normalizedTarget = target.replace(/^\.\//, "");
  const wildcardIndex = normalizedTarget.indexOf("*");
  const prefix = normalizedTarget.slice(0, wildcardIndex);
  const suffix = normalizedTarget.slice(wildcardIndex + 1);
  return packageFiles
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix))
    .map((entry) => {
      const capture = entry.slice(prefix.length, -suffix.length || undefined);
      return subpath.replace("*", capture);
    });
}

function collectRuntimeSpecifiers(packageDir, packedManifest) {
  const packageFiles = listPackageFiles(packageDir);
  /** @type {Set<string>} */
  const specifiers = new Set();
  for (const [subpath, value] of Object.entries(packedManifest.exports)) {
    if (NON_CODE_SUBPATHS.has(subpath)) {
      continue;
    }
    const targets = collectRuntimeTargets(value);
    const entries = subpath.includes("*")
      ? targets.flatMap((target) =>
          expandWildcardSubpath(subpath, target, packageFiles),
        )
      : targets.length > 0
        ? [subpath]
        : [];
    for (const entry of entries) {
      specifiers.add(path.posix.join(packedManifest.name, entry));
    }
  }
  return [...specifiers].sort();
}

function writeTypescriptFixture(consumerRoot, mode) {
  const config = {
    compilerOptions: {
      module: mode.module,
      moduleResolution: mode.moduleResolution,
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: "es2022",
      // TypeScript 6 no longer loads every @types package by default.
      types: ["node"],
      // The legacy `node` (node10) mode is probed on purpose; TypeScript 6 only
      // deprecates it.
      ignoreDeprecations: "6.0",
    },
    files: ["consumer.ts"],
  };
  fs.writeFileSync(
    path.join(consumerRoot, "consumer.ts"),
    consumerSource(manifest, INTERFACE_SPECIFIERS),
  );
  fs.writeFileSync(
    path.join(consumerRoot, `tsconfig.${mode.name}.json`),
    JSON.stringify(config, null, 2),
  );
}

async function checkTypescriptModes(consumerRoot) {
  for (const mode of TYPESCRIPT_MODES) {
    writeTypescriptFixture(consumerRoot, mode);
    await execFileAsync(
      process.execPath,
      [typescriptBin, "--project", `tsconfig.${mode.name}.json`],
      { cwd: consumerRoot },
    );
  }
}

async function checkRuntimeEntrypoint(consumerRoot, specifier) {
  const expectedExports = EXPECTED_RUNTIME_EXPORTS[specifier];
  const checkSource = `
    const entrypoint = require(${JSON.stringify(specifier)});
    const expected = ${JSON.stringify(expectedExports)};
    if (expected) {
      const actual = Object.keys(entrypoint).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected.slice().sort())) {
        throw new Error(\`Expected exports \${expected}, received \${actual}\`);
      }
    }
  `;
  try {
    await execFileAsync(process.execPath, ["-e", checkSource], {
      cwd: consumerRoot,
    });
    return null;
  } catch (error) {
    return { specifier, stderr: error.stderr ?? String(error) };
  }
}

async function runPool(items, worker) {
  const results = [];
  let nextIndex = 0;
  const drain = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  };
  const poolSize = Math.min(CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: poolSize }, drain));
  return results;
}

async function checkRuntimeEntrypoints(
  consumerRoot,
  packageDir,
  packedManifest,
) {
  const specifiers = collectRuntimeSpecifiers(packageDir, packedManifest);
  const results = await runPool(specifiers, (specifier) =>
    checkRuntimeEntrypoint(consumerRoot, specifier),
  );
  const failures = results.filter(Boolean);
  for (const failure of failures) {
    console.error(`require("${failure.specifier}") failed:`);
    console.error(String(failure.stderr).trim());
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length}/${specifiers.length} packed package entrypoints are broken.`,
    );
  }
  return specifiers.length;
}

async function checkRoutedPagesInterface(consumerRoot) {
  const checkScript = path.join(
    packageRoot,
    "scripts/check-routed-pages-interface.cjs",
  );
  await execFileAsync(process.execPath, [checkScript, manifest.name], {
    cwd: consumerRoot,
  });
}

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "dms-saas-package-contract-"),
);
let consumerRoot;
try {
  const tarball = await createPackageTarball(temporaryRoot);
  // The packed declarations resolve the build's dependencies without copying
  // them into the isolated consumer or package tarball.
  consumerRoot = fs.mkdtempSync(path.join(packageRoot, ".package-contract-"));
  await extractPackage(tarball, consumerRoot);
  const packageDir = path.join(
    consumerRoot,
    "node_modules",
    ...packageNameParts,
  );
  const packedManifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  await checkTypescriptModes(consumerRoot);
  const entrypointCount = await checkRuntimeEntrypoints(
    consumerRoot,
    packageDir,
    packedManifest,
  );
  await checkRoutedPagesInterface(consumerRoot);
  console.log(
    `Packed package contract is valid in ${TYPESCRIPT_MODES.length} TypeScript modes, ${entrypointCount} runtime entrypoints, and a routed pages identity.`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  if (consumerRoot) {
    fs.rmSync(consumerRoot, { recursive: true, force: true });
  }
}
