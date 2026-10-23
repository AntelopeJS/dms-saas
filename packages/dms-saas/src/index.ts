import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
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
import { resolveDevMode, setRuntimeConfig } from "./config";
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

let registeredCronTasks: ScheduledTask[] = [];

export async function construct(config: DmsSaasConfig): Promise<void> {
  setRuntimeConfig(config);
  planChangesImplementation.setRequiredPlanChangePolicy(
    config.requiredPlanChangePolicy,
  );
  // DMS stops treating default-tenant ownership as platform ownership while
  // this registration exists; the core drops it when this module unloads.
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

export async function start(): Promise<void> {
  registeredCronTasks = registerSaasCrons();
  registerAutomationNodes();
}

export async function stop(): Promise<void> {
  const teardowns = await Promise.allSettled(
    registeredCronTasks.map(async (task) => task.destroy()),
  );
  for (const teardown of teardowns) {
    if (teardown.status === "rejected") {
      Logging.Error("A cron task failed to stop", teardown.reason);
    }
  }
  registeredCronTasks = [];
  unregisterAutomationNodes();
}
