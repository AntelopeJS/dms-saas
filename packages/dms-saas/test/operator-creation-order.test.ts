import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as auth from "@antelopejs/interface-dms/auth";
import {
  RoleModel,
  TenantModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import {
  Hook,
  type HookHandler,
  RegisterHook,
  UnregisterHook,
} from "@antelopejs/interface-dms/hooks";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Schema } from "@antelopejs/interface-database";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { registerSaasHookListeners } from "../src/hooks/register";
import {
  PlanModel,
  TenantBillingStateModel,
  TenantSubscriptionModel,
} from "../src/db";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { createWorkspaceForOwner } from "../src/workspaces/operator-creation";
import { createUser, dmsImplementation } from "./helpers/dms";
import { ANY_DATE } from "./helpers/asymmetric-matchers";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase();

/** What the workspace holds so far, in the order the creation writes it. */
async function writtenSoFar(tenantId: string): Promise<string[]> {
  const [tenant, invites, roles, subscription, billing] = await Promise.all([
    GetModel(TenantModel).get(tenantId),
    GetModel(UserInviteModel, tenantId).getAll(),
    GetModel(RoleModel, tenantId).getAll(),
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
    GetModel(TenantBillingStateModel).findByTenant(tenantId),
  ]);
  const steps = [
    [tenant, "tenant"],
    [invites.find((invite) => invite.asTenantOwner), "owner"],
    [roles[0], `member role (${roles[0]?.name})`],
    [subscription, `subscription (${subscription?.status})`],
    [billing, `billing state (${billing?.billingState})`],
  ] as const;
  return steps.filter(([row]) => row).map(([, step]) => step);
}

const inviteCreated: HookHandler<Hook.INVITE_CREATED>[] = [];
const provisioningListeners: HookHandler<Hook.TENANT_BEING_PROVISIONED>[] = [];
const deletionListeners: HookHandler<Hook.TENANT_DELETED>[] = [];

function listenToProvisioning(
  handler: HookHandler<Hook.TENANT_BEING_PROVISIONED>,
): void {
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, handler);
  provisioningListeners.push(handler);
}

function listenToDeletion(handler: HookHandler<Hook.TENANT_DELETED>): void {
  RegisterHook(Hook.TENANT_DELETED, handler);
  deletionListeners.push(handler);
}

afterEach(() => {
  for (const handler of inviteCreated.splice(0))
    UnregisterHook(Hook.INVITE_CREATED, handler);
  for (const handler of provisioningListeners.splice(0))
    UnregisterHook(Hook.TENANT_BEING_PROVISIONED, handler);
  for (const handler of deletionListeners.splice(0))
    UnregisterHook(Hook.TENANT_DELETED, handler);
});

describe("operator workspace creation", () => {
  it("writes the plan, then e-mails the owner without waiting", async () => {
    const operator = await createUser({ language: "fr" });
    const planId = randomUUID();
    await GetModel(PlanModel).insert({ _id: planId, price: 29 });
    const observed: { at: string; written: string[] }[] = [];
    let tenantId = "";
    const onInvite: HookHandler<Hook.INVITE_CREATED> = async (invite) => {
      tenantId = invite.tenantId;
      observed.push({ at: "owner", written: await writtenSoFar(tenantId) });
    };
    RegisterHook(Hook.INVITE_CREATED, onInvite);
    inviteCreated.push(onInvite);
    listenToProvisioning(async (payload) => {
      observed.push({
        at: `provisioning (user ${payload.userId ?? "none"})`,
        written: await writtenSoFar(payload.tenantId),
      });
    });
    ImplementInterface(permissions, {
      ...dmsImplementation("implementations/dms/permissions.js"),
      GetPermissions: async () => {
        observed.push({
          at: "member role",
          written: await writtenSoFar(tenantId),
        });
        return {};
      },
    });
    let releaseEmail = (): void => {};
    const emailHeld = new Promise<void>((resolve) => {
      releaseEmail = resolve;
    });
    const sendEmail = vi.fn(async () => {
      observed.push({ at: "email", written: await writtenSoFar(tenantId) });
      await emailHeld;
    });
    ImplementInterface(auth, {
      ...dmsImplementation("implementations/dms-auth/index.js"),
      sendAdminInviteEmail: sendEmail,
    });

    const created = await createWorkspaceForOwner(
      {
        name: "Recette Op Co",
        planId,
        ownerEmail: "owner@example.com",
        access: "owner_pays",
        freeUntil: null,
      },
      operator,
    );
    await vi.waitFor(() => expect(observed).toHaveLength(4));
    releaseEmail();

    expect(observed).toEqual([
      { at: "owner", written: ["tenant", "owner"] },
      { at: "member role", written: ["tenant", "owner"] },
      {
        at: "provisioning (user none)",
        written: [
          "tenant",
          "owner",
          "member role (Membre)",
          "subscription (pending_payment)",
          "billing state (pending_payment)",
        ],
      },
      {
        at: "email",
        written: [
          "tenant",
          "owner",
          "member role (Membre)",
          "subscription (pending_payment)",
          "billing state (pending_payment)",
        ],
      },
    ]);
    expect(sendEmail).toHaveBeenCalledWith(
      "owner@example.com",
      expect.stringMatching(/^.{64}$/),
      undefined,
      expect.objectContaining({ workspaceName: "Recette Op Co" }),
    );
    expect(created).toMatchObject({
      tenantId,
      invitationEmail: "sending",
      access: "owner_pays",
    });
    await vi.waitFor(async () =>
      expect(
        await GetModel(OperatorActionModel)
          .table.filter((row) => row.key("tenantId").eq(tenantId))
          .run(),
      ).toEqual([expect.objectContaining({ status: "succeeded" })]),
    );
  });
});

async function insertPlanRow(): Promise<string> {
  const planId = randomUUID();
  await GetModel(PlanModel).insert({ _id: planId, price: 29 });
  return planId;
}

function complimentaryWorkspace(planId: string, ownerEmail: string) {
  return {
    name: "Provisioned Co",
    planId,
    ownerEmail,
    access: "complimentary" as const,
    freeUntil: null,
  };
}

const coreCleanup = z.object({ registerTenantDeletedCleanup: z.function() });

describe("operator workspace provisioning", () => {
  beforeAll(() => {
    coreCleanup
      .parse(dmsImplementation("hooks/tenant-deleted.js"))
      .registerTenantDeletedCleanup();
    registerSaasHookListeners();
  });

  it("registers the workspace's tenant-schema instance", async () => {
    const operator = await createUser();

    const { tenantId } = await createWorkspaceForOwner(
      complimentaryWorkspace(await insertPlanRow(), "instance@example.com"),
      operator,
    );

    const tenantSchema = Schema.get(TENANT_SCHEMA_NAME);
    expect(await tenantSchema?.listInstances().run()).toContain(tenantId);
  });

  it("names an owner who already has an account in the provisioning payload", async () => {
    const operator = await createUser();
    const owner = await createUser();
    const userIds: (string | undefined)[] = [];
    listenToProvisioning(async (payload) => {
      userIds.push(payload.userId);
    });

    await createWorkspaceForOwner(
      complimentaryWorkspace(await insertPlanRow(), owner.email),
      operator,
    );

    expect(userIds).toEqual([owner._id]);
  });

  it("unwinds the workspace when a provisioning listener refuses it", async () => {
    const operator = await createUser();
    const sendEmail = vi.fn(async () => undefined);
    ImplementInterface(auth, {
      ...dmsImplementation("implementations/dms-auth/index.js"),
      sendAdminInviteEmail: sendEmail,
    });
    let tenantId = "";
    listenToProvisioning(async (payload) => {
      tenantId = payload.tenantId;
      throw new Error("listener refused");
    });
    const deletions: (string | undefined)[] = [];
    listenToDeletion(async (deleted, context) => {
      if (deleted === tenantId) deletions.push(context?.operationId);
    });

    await expect(
      createWorkspaceForOwner(
        complimentaryWorkspace(await insertPlanRow(), "new-owner@example.com"),
        operator,
      ),
    ).rejects.toMatchObject({
      body: "saas.errors.workspace_create.provisioning_failed",
    });

    expect(await GetModel(TenantModel).get(tenantId)).toBeUndefined();
    expect(
      await GetModel(TenantSubscriptionModel, tenantId).findOne(),
    ).toBeUndefined();
    expect(deletions).toEqual([expect.stringContaining("retention-delete")]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await GetModel(UserInviteModel, tenantId).getAll()).toEqual([]);
    expect(await GetModel(RoleModel, tenantId).getAll()).toEqual([]);
    expect(
      await GetModel(TenantBillingStateModel).findByTenant(tenantId),
    ).toMatchObject({ deletedAt: ANY_DATE });
  });

  it("leaves a deletion the retention cron resumes when the unwinding fails", async () => {
    const operator = await createUser();
    let tenantId = "";
    listenToProvisioning(async (payload) => {
      tenantId = payload.tenantId;
      throw new Error("listener refused");
    });
    listenToDeletion(async () => {
      throw new Error("deletion unavailable");
    });

    await expect(
      createWorkspaceForOwner(
        complimentaryWorkspace(await insertPlanRow(), "late-owner@example.com"),
        operator,
      ),
    ).rejects.toMatchObject({
      body: "saas.errors.workspace_create.provisioning_failed",
    });

    expect(
      await GetModel(TenantSubscriptionModel, tenantId).findOne(),
    ).toMatchObject({ deletionStartedAt: ANY_DATE });
  });
});
