import { randomUUID } from "node:crypto";
import type { AuthConfig } from "@antelopejs/dms";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as auth from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import * as clientBaseUrl from "@antelopejs/interface-dms/client-base-url";
import { TenantModel } from "@antelopejs/interface-dms/db";
import * as permissions from "@antelopejs/interface-dms/permissions";
import * as saasMode from "@antelopejs/interface-dms/utils/saas-mode";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, type Mock, vi } from "vitest";
import { setRuntimeConfig } from "../../src/config";
import { PlanModel, TenantSubscriptionModel } from "../../src/db";
import { SaasWorkspacesAdminController } from "../../src/routes/platformOwner/workspaces-admin";
import { applyDmsConfig, dmsImplementation, implementWithDms } from "./dms";
import {
  implementNotificationCore,
  type NotificationCore,
} from "./notification-core";

/** The console the invitation links point to. */
export const CONSOLE_URL = "https://console.example.test";
/** The name every operator-created workspace carries. */
export const WORKSPACE_NAME = "Invited workspace";

/** The platform owner who creates workspaces from the back office. */
export const operator = fromPartial<User>({
  _id: randomUUID(),
  email: "operator@example.test",
  name: "Olivia Operator",
  owner: true,
  language: "en",
});

type SendInviteEmail = (
  email: string,
  token: string,
  inviteeName?: string,
  context?: auth.AdminInviteEmailContext,
) => Promise<void>;

/** What a back-office test observes of the outside world. */
export interface BackOffice {
  /** The invitation e-mail the DMS sends: resolved unless a test makes it fail. */
  sendInviteEmail: Mock<SendInviteEmail>;
  /** The notification core receiving the operator's notifications. */
  core: NotificationCore;
}

/**
 * Wires what creating a workspace from the back office reaches: DMS SaaS mode,
 * auth with its invitation e-mail sent through an observer, the console base
 * URL, the permission registry and the notification core. Call it at the top
 * level of a test file, after `useMongoDatabase`.
 */
export function useBackOffice(): BackOffice {
  const sendInviteEmail = vi.fn<SendInviteEmail>();
  const core = implementNotificationCore();
  beforeAll(() => {
    implementWithDms(saasMode, "implementations/dms/saas-mode.js");
    saasMode.RegisterSaasMode();
    applyDmsConfig({
      auth: fromPartial<AuthConfig>({ jwtSecret: "back-office-test-only" }),
    });
    ImplementInterface(auth, {
      ...dmsImplementation("implementations/dms-auth/index.js"),
      sendAdminInviteEmail: sendInviteEmail,
    });
    ImplementInterface(clientBaseUrl, { GetClientBaseUrl: () => CONSOLE_URL });
    implementWithDms(permissions, "implementations/dms/permissions.js");
  });
  beforeEach(() => {
    sendInviteEmail.mockReset();
    sendInviteEmail.mockResolvedValue(undefined);
    setRuntimeConfig({
      stripe: { secretKey: "unused", webhookSecret: "", publishableKey: "" },
    });
  });
  return { sendInviteEmail, core };
}

/** The back-office controller creating and administering workspaces. */
export function adminController(): SaasWorkspacesAdminController {
  const controller = new SaasWorkspacesAdminController();
  controller.planModel = GetModel(PlanModel);
  controller.tenantModel = GetModel(TenantModel);
  controller.userModel = GetModel(UserModel);
  return controller;
}

/** Stores a free plan and returns its id. */
export async function insertPlan(): Promise<string> {
  const planId = randomUUID();
  await GetModel(PlanModel).insert({
    _id: planId,
    name: "Assigned",
    price: 0,
    currency: "eur",
    interval: "month",
    billingMode: "flat",
    isActive: true,
    isDeleted: false,
  });
  return planId;
}

/** Stores a paid plan Stripe bills and returns its id. */
export async function insertPaidPlan(): Promise<string> {
  const planId = randomUUID();
  await GetModel(PlanModel).insert({
    _id: planId,
    name: "Pro",
    price: 29,
    currency: "eur",
    interval: "month",
    billingMode: "flat",
    audience: "any",
    paymentProviderRefs: { stripePriceId: "price_pro" },
    isActive: true,
    isDeleted: false,
  });
  return planId;
}

/** Has `by` create a complimentary workspace owned by `ownerEmail`. */
export async function createWorkspaceFor(ownerEmail: string, by = operator) {
  return adminController().createWorkspace(by, {
    name: WORKSPACE_NAME,
    ownerEmail,
    planId: await insertPlan(),
    access: "complimentary",
  });
}

/** A workspace created for an owner who has no account yet, so invited. */
export async function createInvitedWorkspace() {
  const email = `${randomUUID()}@example.test`;
  const created = await createWorkspaceFor(email);
  if (created.owner.kind !== "invited") throw new Error("Expected invitation");
  return { email, tenantId: created.tenantId, owner: created.owner };
}

/** The workspace's subscription row. */
export async function subscriptionOf(tenantId: string) {
  return GetModel(TenantSubscriptionModel, tenantId).findOne();
}
