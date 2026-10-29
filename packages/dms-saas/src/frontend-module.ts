import path from "node:path";
import type { AddFrontendModuleOptions } from "@antelopejs/interface-dms/page";
import { resolvePublicScreensToRegister } from "./pages/public/screens";
import {
  DEFAULT_REGISTRATION_PAYMENT_METHOD_POLICY,
  type DmsSaasConfig,
} from "./types";

const DEFAULT_ADMISSION_MODE = "open";

/**
 * This module's frontend, from its configuration alone: the backend registers
 * it with `AddFrontendModule`, and `@antelopejs/dms-frontend` calls this same
 * function (declared as `dmsFrontend` in package.json) to build and start the
 * frontend without a backend. It reads nothing but its arguments.
 *
 * Self-service registration ends on an authenticated user: the finalize route
 * provisions the workspace and mints the token pair, and the frontend server
 * seals its session cookie from it. Declaring `authEstablishEndpoints` here is
 * what lets `/auth/establish` call it, so no deployment has to name it in
 * DMS_AUTH_ESTABLISH_ENDPOINTS by hand. Sign-in only links to the bundled
 * screens the deployment serves.
 */
export function frontendModule(
  config: DmsSaasConfig,
): AddFrontendModuleOptions {
  return {
    name: "@antelopejs/dms-saas-frontend-vue",
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    priority: 0,
    authEstablishEndpoints: ["/api/saas/register/finalize"],
    options: {
      dmsSaas: {
        stripePublishableKey: config.stripe.publishableKey,
        admissionMode: config.admissionMode ?? DEFAULT_ADMISSION_MODE,
        registrationPaymentMethod:
          config.registration?.paymentMethod ??
          DEFAULT_REGISTRATION_PAYMENT_METHOD_POLICY,
        publicScreens: resolvePublicScreensToRegister(config),
      },
    },
  };
}
