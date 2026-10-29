import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { UserModel, type User } from "@antelopejs/interface-dms/auth/db";
import { applyTenantOwnership } from "@antelopejs/interface-dms/tenant-ownership";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRuntimeConfig } from "../src/config";
import { PlanModel } from "../src/db";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { SaasWorkspacesAdminController } from "../src/routes/platformOwner/workspaces-admin";

let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "operator-trail" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
  setRuntimeConfig({
    stripe: { secretKey: "unused", webhookSecret: "", publishableKey: "" },
  });
}, 60_000);

afterAll(async () => {
  await destroy();
  await mongodb?.stop();
});

function adminController(): SaasWorkspacesAdminController {
  const controller = new SaasWorkspacesAdminController();
  controller.planModel = GetModel(PlanModel);
  controller.tenantModel = GetModel(TenantModel);
  controller.userModel = GetModel(UserModel);
  return controller;
}

async function insertPlan(name: string): Promise<string> {
  const planId = randomUUID();
  await GetModel(PlanModel).insert({
    _id: planId,
    name,
    price: 0,
    currency: "eur",
    interval: "month",
    billingMode: "flat",
    isActive: true,
    isDeleted: false,
  });
  return planId;
}

async function insertPlatformOwner(): Promise<User> {
  const userId = randomUUID();
  await GetModel(UserModel).insert({
    _id: userId,
    email: `${userId}@platform.test`,
    name: "Paula Platform",
    language: "en",
    owner: true,
  });
  const user = await GetModel(UserModel).get(userId);
  if (!user) throw new Error("Expected the platform owner");
  return user;
}

async function createWorkspace(): Promise<string> {
  const tenantId = randomUUID();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: "Trail workspace",
    createdAt: new Date("2026-01-01T09:00:00Z"),
  });
  return tenantId;
}

async function createWorkspaceOwnedBy(owner: User): Promise<string> {
  const tenantId = await createWorkspace();
  await applyTenantOwnership(GetModel(UserModel), owner._id, tenantId, {
    roleIds: [],
    isTenantOwner: true,
  });
  return tenantId;
}

async function latestActivity(operator: User, tenantId: string) {
  const { items } = await new SaasWorkspaceDetailController().activity(
    operator,
    tenantId,
    undefined,
    undefined,
    undefined,
  );
  return items[0];
}

describe("the operator's own place in a workspace", () => {
  it("tells a platform owner who owns the workspace that they own it", async () => {
    const owner = await insertPlatformOwner();
    const tenantId = await createWorkspaceOwnedBy(owner);

    const overview = await new SaasWorkspaceDetailController().overview(
      owner,
      tenantId,
    );

    expect(overview.membership).toMatchObject({ role: "owner" });
  });

  it("tells a platform owner who joined someone else's workspace that they support it", async () => {
    const tenantId = await createWorkspaceOwnedBy(await insertPlatformOwner());
    const supporter = await insertPlatformOwner();

    await adminController().joinAsMember(supporter, tenantId);
    const overview = await new SaasWorkspaceDetailController().overview(
      supporter,
      tenantId,
    );

    expect(overview.membership).toMatchObject({ role: "support" });
  });
});

describe("operator actions in the workspace's activity", () => {
  it("shows a complimentary grant with the plan and who granted it", async () => {
    const operator = await insertPlatformOwner();
    const tenantId = await createWorkspace();
    const planId = await insertPlan("Team");

    await adminController().grantFreeAccess(operator, tenantId, { planId });

    expect(await latestActivity(operator, tenantId)).toMatchObject({
      title: "$saas.activity.workspace.complimentary_access_granted",
      params: expect.objectContaining({ operator: operator.email, to: "Team" }),
    });
  });

  it("shows platform support joining, with who joined", async () => {
    const tenantId = await createWorkspaceOwnedBy(await insertPlatformOwner());
    const supporter = await insertPlatformOwner();

    await adminController().joinAsMember(supporter, tenantId);

    expect(await latestActivity(supporter, tenantId)).toMatchObject({
      title: "$saas.activity.workspace.support_joined",
      params: expect.objectContaining({ operator: supporter.email }),
    });
  });
});
