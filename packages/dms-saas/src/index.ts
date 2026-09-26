import path from "node:path";
import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import * as billingInterface from "@antelopejs/interface-dms-saas/billing";
import * as invoiceLineItemsInterface from "@antelopejs/interface-dms-saas/invoice-line-items";
import * as pagesInterface from "@antelopejs/interface-dms-saas/pages";
import * as workspaceLifecycleInterface from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import type { ScheduledTask } from "node-cron";
import {
  registerPlanPermissionsResolver,
  registerSubscriptionAccessGate,
} from "./auth";
import {
  registerAutomationNodes,
  unregisterAutomationNodes,
} from "./automation";
import {
  getRegistrationPaymentMethodPolicy,
  resolveDevMode,
  setRuntimeConfig,
} from "./config";
import { registerSaasCrons } from "./crons";
import { registerSaasHookListeners } from "./hooks";
import * as billingImplementation from "./implementations/dms-saas/billing";
import * as invoiceLineItemsImplementation from "./implementations/dms-saas/invoice-line-items";
import * as pagesImplementation from "./implementations/dms-saas/pages";
import * as workspaceLifecycleImplementation from "./implementations/dms-saas/workspace-lifecycle";
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
  await resolveDevMode();
  initStripeClient(config.stripe);
  registerSaasHookListeners();
  registerPlanPermissionsResolver();
  registerSubscriptionAccessGate();
  registerSeatHooks();
  ImplementInterface(billingInterface, billingImplementation);
  ImplementInterface(invoiceLineItemsInterface, invoiceLineItemsImplementation);
  ImplementInterface(pagesInterface, pagesImplementation);
  ImplementInterface(
    workspaceLifecycleInterface,
    workspaceLifecycleImplementation,
  );
  await registerPublicScreens(config);

  await AddFrontendModule({
    name: "@antelopejs/dms-saas-frontend-vue",
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    priority: 0,
    // Self-service registration ends on an authenticated user: the finalize
    // route provisions the workspace and mints the token pair, and the
    // frontend server seals its session cookie from it. Declaring it here is
    // what lets `/auth/establish` call it, so no deployment has to name it in
    // DMS_AUTH_ESTABLISH_ENDPOINTS by hand.
    authEstablishEndpoints: ["/api/saas/register/finalize"],
    options: {
      dmsSaas: {
        stripePublishableKey: config.stripe.publishableKey,
        admissionMode: config.admissionMode ?? "open",
        registrationPaymentMethod: getRegistrationPaymentMethodPolicy(),
      },
    },
  });
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
