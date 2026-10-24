import { Logging } from "@antelopejs/interface-core/logging";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
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
import { writeUsers } from "./writers/users";
import { publishBillingStates, writeWorkspaces } from "./writers/workspaces";

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
  await publishBillingStates([DEFAULT_WORKSPACE, ...WORKSPACES]);
}

/**
 * Seeds the playground database once, when DMS provisions its default
 * tenant on a fresh database: that runs after every `DATABASE_INITIALIZED`
 * handler has finished, so dms-saas has its legal documents and billing
 * state in place before the data set lands. A failure is logged and never
 * stops the DMS from serving.
 *
 * Plans seeded by an earlier start still receive the permissions a module
 * added since, on `DATABASE_INITIALIZED`: the catalogue is the platform's,
 * not the default tenant's.
 */
export function registerPlaygroundSeed(): void {
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, async ({ tenantId }) => {
    if (tenantId !== DEFAULT_TENANT_ID) return undefined;
    try {
      await writeDataSet();
      Logging.Info(
        `${LOG_PREFIX} data set written; sign in as ${PLATFORM_ADMIN_EMAIL} / ${SEED_PASSWORD}`,
      );
    } catch (error) {
      Logging.Error(`${LOG_PREFIX} failed`, error);
    }
    return undefined;
  });
  RegisterHook(Hook.DATABASE_INITIALIZED, async () => {
    try {
      await grantNewPermissionsToSeededPlans();
    } catch (error) {
      Logging.Error(`${LOG_PREFIX} failed`, error);
    }
    return undefined;
  });
}
