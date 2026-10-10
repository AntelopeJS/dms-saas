import { Logging } from "@antelopejs/interface-core/logging";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { CREDIT_NOTES, INVOICES } from "./data/billing";
import { FEATURES, PLANS } from "./data/catalogue";
import {
  OTHER_USERS,
  PLATFORM_ADMIN,
  PLATFORM_ADMIN_EMAIL,
  SEED_PASSWORD,
} from "./data/people";
import {
  BILLING_SETTINGS,
  LEGAL_DOCUMENTS,
  PLAN_MIGRATIONS,
  PLATFORM_NOTES,
  SEGMENTS,
} from "./data/platform";
import { DEFAULT_WORKSPACE, WORKSPACES } from "./data/workspaces";
import { writeBillingDocuments } from "./writers/billing";

export * from "./running-migration";
import {
  grantNewPermissionsToSeededPlans,
  readGrantablePermissions,
  writeCatalogue,
} from "./writers/catalogue";
import {
  writeBillingSettings,
  writeLegalDocuments,
  writePlanMigrations,
  writePlatformNotes,
  writeSegments,
} from "./writers/platform";
import { isPlaygroundSeeded, writeUsers } from "./writers/users";
import { writeWorkspaces } from "./writers/workspaces";

const LOG_PREFIX = "[playground:seed]";

async function writeDataSet(): Promise<void> {
  await writeUsers(OTHER_USERS);
  await writeCatalogue(FEATURES, PLANS);
  const permissions = await readGrantablePermissions();
  await writeWorkspaces([DEFAULT_WORKSPACE, ...WORKSPACES], permissions);
  await writeBillingDocuments(INVOICES, CREDIT_NOTES);
  await writeBillingSettings(BILLING_SETTINGS);
  await writeLegalDocuments(LEGAL_DOCUMENTS);
  await writeSegments(SEGMENTS);
  await writePlatformNotes(PLATFORM_NOTES);
  await writePlanMigrations(PLAN_MIGRATIONS, permissions);
  await writeUsers([PLATFORM_ADMIN]);
}

async function seedPlayground(): Promise<void> {
  if (await isPlaygroundSeeded()) {
    await grantNewPermissionsToSeededPlans();
    return;
  }
  await writeDataSet();
  Logging.Info(
    `${LOG_PREFIX} data set written; sign in as ${PLATFORM_ADMIN_EMAIL} / ${SEED_PASSWORD}`,
  );
}

/**
 * Seeds the playground database once, on the first start against it.
 *
 * Registered from `start()`, after every module's `construct()`: the handler
 * then runs after those of the DMS (default tenant) and dms-saas (legal
 * documents, plan migration resume, billing state recompute), so none of
 * them acts on half-written data. A failure is logged and never stops the
 * DMS from serving.
 */
export function registerPlaygroundSeed(): void {
  RegisterHook(Hook.DATABASE_INITIALIZED, async () => {
    try {
      await seedPlayground();
    } catch (error) {
      Logging.Error(`${LOG_PREFIX} failed`, error);
    }
    return undefined;
  });
}
