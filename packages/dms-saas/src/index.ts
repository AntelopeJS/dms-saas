import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  Hook,
  RegisterHook,
  UnregisterHook,
} from "@antelopejs/interface-dms/hooks";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import { RegisterSaasMode } from "@antelopejs/interface-dms/utils/saas-mode";
import * as billingInterface from "@antelopejs/interface-dms-saas/billing";
import * as invoiceLineItemsInterface from "@antelopejs/interface-dms-saas/invoice-line-items";
import * as pagesInterface from "@antelopejs/interface-dms-saas/pages";
import * as planChangesInterface from "@antelopejs/interface-dms-saas/plan-changes";
import * as tenantLifecycleInterface from "@antelopejs/interface-dms-saas/tenant-lifecycle";
import type { ScheduledTask } from "node-cron";
import {
  registerOwnerOnlyPermissionsResolver,
  registerPlanPermissionsResolver,
  registerSubscriptionAccessGate,
} from "./auth";
import {
  registerAutomationNodes,
  unregisterAutomationNodes,
} from "./automation";
import { registerBillingLayoutBanners } from "./billing-state";
import { registerWorkspaceDirectoryHooks } from "./billing-state/directory-hooks";
import {
  areScheduledJobsEnabled,
  resolveDevMode,
  setRuntimeConfig,
} from "./config";
import { registerSaasCrons } from "./crons";
import { registerSaasHookListeners } from "./hooks";
import * as billingImplementation from "./implementations/dms-saas/billing";
import * as invoiceLineItemsImplementation from "./implementations/dms-saas/invoice-line-items";
import * as pagesImplementation from "./implementations/dms-saas/pages";
import * as planChangesImplementation from "./implementations/dms-saas/plan-changes";
import * as tenantLifecycleImplementation from "./implementations/dms-saas/tenant-lifecycle";
import { frontendModule } from "./frontend-module";
import { registerPublicScreens } from "./pages";
import { registerSeatHooks } from "./plans";
import { initStripeClient } from "./stripe";
import type { DmsSaasConfig } from "./types";

import "./data-api";
import "./db";
import "./notifications";
import "./routes";

/**
 * The jobs of a started module, scheduled once the DMS fires
 * `DATABASE_INITIALIZED`: every job reads tables of the schemas the DMS binds
 * at its start. Empty until then; `undefined` while the module is stopped or
 * runs without scheduled jobs, so a handler the DMS already took schedules
 * nothing after `stop()`.
 */
let registeredCronTasks: ScheduledTask[] | undefined;

/**
 * Starts the module with its configuration. While the SaaS mode registration
 * made here exists, the DMS stops treating default-tenant ownership as
 * platform ownership; the core drops it when this module unloads.
 *
 * @param config Module configuration
 */
export async function construct(config: DmsSaasConfig): Promise<void> {
  setRuntimeConfig(config);
  planChangesImplementation.setRequiredPlanChangePolicy(
    config.requiredPlanChangePolicy,
  );
  RegisterSaasMode();
  await resolveDevMode();
  initStripeClient(config.stripe);
  registerSaasHookListeners();
  registerPlanPermissionsResolver();
  registerOwnerOnlyPermissionsResolver();
  registerSubscriptionAccessGate();
  registerSeatHooks();
  registerWorkspaceDirectoryHooks();
  registerBillingLayoutBanners();
  ImplementInterface(billingInterface, billingImplementation);
  ImplementInterface(invoiceLineItemsInterface, invoiceLineItemsImplementation);
  ImplementInterface(pagesInterface, pagesImplementation);
  ImplementInterface(planChangesInterface, planChangesImplementation);
  ImplementInterface(tenantLifecycleInterface, tenantLifecycleImplementation);
  await registerPublicScreens(config);

  await AddFrontendModule(frontendModule(config));
}

async function destroyCronTasks(tasks: ScheduledTask[]): Promise<void> {
  const teardowns = await Promise.allSettled(
    tasks.map(async (task) => task.destroy()),
  );
  for (const teardown of teardowns) {
    if (teardown.status === "rejected") {
      Logging.Error("A cron task failed to stop", teardown.reason);
    }
  }
}

async function scheduleCronTasks(): Promise<undefined> {
  const previous = registeredCronTasks;
  if (previous === undefined) return undefined;
  registeredCronTasks = registerSaasCrons();
  await destroyCronTasks(previous);
  return undefined;
}

export async function start(): Promise<void> {
  if (areScheduledJobsEnabled()) {
    registeredCronTasks = [];
    RegisterHook(Hook.DATABASE_INITIALIZED, scheduleCronTasks);
  }
  registerAutomationNodes();
}

export async function stop(): Promise<void> {
  UnregisterHook(Hook.DATABASE_INITIALIZED, scheduleCronTasks);
  const tasks = registeredCronTasks ?? [];
  registeredCronTasks = undefined;
  await destroyCronTasks(tasks);
  unregisterAutomationNodes();
}
