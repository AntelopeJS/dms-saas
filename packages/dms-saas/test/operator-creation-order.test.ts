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
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PlanModel,
  TenantBillingStateModel,
  TenantSubscriptionModel,
} from "../src/db";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { createWorkspaceForOwner } from "../src/workspaces/operator-creation";
import { createUser, dmsImplementation } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("operator-creation-order");

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

afterEach(() => {
  for (const handler of inviteCreated.splice(0))
    UnregisterHook(Hook.INVITE_CREATED, handler);
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
    await vi.waitFor(() => expect(observed).toHaveLength(3));
    releaseEmail();

    expect(observed).toEqual([
      { at: "owner", written: ["tenant", "owner"] },
      { at: "member role", written: ["tenant", "owner"] },
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
    const [invite] = await GetModel(UserInviteModel, tenantId).getAll();
    expect(sendEmail).toHaveBeenCalledWith(
      "owner@example.com",
      invite?.token,
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
