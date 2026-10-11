import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  FormFieldSerialized,
  FormPropsSerialized,
} from "@antelopejs/interface-dms/base";
import type {
  ComponentBuilder,
  ComponentFilterContext,
} from "@antelopejs/interface-dms/component";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_NAME_MAX_LENGTH } from "../src/workspaces/workspace-name";

const harness = vi.hoisted(() => ({
  owners: new Set<string>(),
  guards: new Map<string, string>(),
}));

vi.mock("../src/workspaces/workspace-owner", () => ({
  isWorkspaceOwnerRequest: async ({ user, tenantId }: ComponentFilterContext) =>
    !!user && harness.owners.has(`${tenantId}:${user._id}`),
}));

function recordGuard(name: string) {
  return () =>
    (target: object, propertyKey: string | symbol | undefined): void => {
      if (!propertyKey) return;
      harness.guards.set(String(propertyKey), name);
    };
}

vi.mock("@antelopejs/interface-dms/guards", () => ({
  AuthTenantMember: recordGuard("member"),
  AuthTenantOwner: recordGuard("owner"),
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return { ...original, Model: () => (): void => undefined };
});

const { SaasTenantGeneralController } =
  await import("../src/pages/tenant/general");
await import("../src/routes/tenant/workspaces");

async function identityForm(): Promise<ComponentBuilder<FormPropsSerialized>> {
  const section = await SaasTenantGeneralController.identity.componentInfo;
  const form = section.children?.find((child) => child.id === "form");
  return form?.component as ComponentBuilder<FormPropsSerialized>;
}

async function servedTo(userId: string): Promise<FormPropsSerialized> {
  const form = await identityForm();
  const { options } = await form.serialize();
  const context = { tenantId: "acme", user: { _id: userId } as User };
  return form.onFilterCallback?.(new Set(), options, "general", context);
}

beforeEach(() => {
  harness.owners = new Set(["acme:owner"]);
});

describe("General page for a workspace member", () => {
  it("serves the identity form read-only, with nothing to save", async () => {
    const served = await servedTo("member");

    expect(served.saveMode).toBe("none");
    expect(
      (served.fields as FormFieldSerialized[]).map((field) => field.readonly),
    ).toEqual([
      {
        badge: { label: "$saas.workspace.general.owner_only", tone: "neutral" },
      },
      {
        badge: { label: "$saas.workspace.general.owner_only", tone: "neutral" },
      },
    ]);
  });

  it("counts the name's characters out of its limit", async () => {
    const form = await identityForm();
    const { options } = await form.serialize();
    const name = options.fields.find(
      (field) => field.id === "name",
    ) as FormFieldSerialized;

    expect(name.component?.options).toMatchObject({
      maxLength: WORKSPACE_NAME_MAX_LENGTH,
      showCount: true,
    });
  });

  it("serves the identity form unchanged to an owner", async () => {
    const form = await identityForm();
    const { options } = await form.serialize();

    expect(await servedTo("owner")).toEqual(options);
  });

  it("lets every member read the identity and the glance, and only owners change it", () => {
    expect(Object.fromEntries(harness.guards)).toMatchObject({
      getCurrent: "member",
      getCurrentGlance: "member",
      getCurrentOverview: "owner",
      renameCurrent: "owner",
      deleteCurrent: "owner",
    });
  });
});
