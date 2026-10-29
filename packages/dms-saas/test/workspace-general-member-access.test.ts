import { randomUUID } from "node:crypto";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  BlockFunctions,
  type FormFieldSerialized,
  FormEvents,
  type FormPropsSerialized,
} from "@antelopejs/interface-dms/base";
import type {
  ComponentBuilder,
  ComponentFilterContext,
} from "@antelopejs/interface-dms/component";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it } from "vitest";
import { SaasTenantGeneralController } from "../src/pages/tenant/general";
import { SaasWorkspacesController } from "../src/routes/tenant/workspaces";
import { WORKSPACE_NAME_MAX_LENGTH } from "../src/workspaces/workspace-name";
import {
  addTenantMember,
  createUser,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { guardRefusals } from "./helpers/guards";

useMongoDatabase("workspace-general-member-access");
useDmsAuth();

const OWNER_REQUIRED = "error.tenant_owner_required";
const MEMBER_REQUIRED = "error.tenant_member_required";

let tenantId = "";
let owner: User;
let member: User;

async function identityForm(): Promise<ComponentBuilder<FormPropsSerialized>> {
  const section = await SaasTenantGeneralController.identity.componentInfo;
  const form = section.children?.find((child) => child.id === "form");
  return form?.component as ComponentBuilder<FormPropsSerialized>;
}

async function servedTo(user: User): Promise<FormPropsSerialized> {
  const form = await identityForm();
  const { options } = await form.serialize();
  const context = fromPartial<ComponentFilterContext>({ tenantId, user });
  return form.onFilterCallback?.(new Set(), options, "general", context);
}

beforeEach(async () => {
  tenantId = randomUUID();
  owner = await createUser();
  member = await createUser();
  await addTenantMember(tenantId, owner, true);
  await addTenantMember(tenantId, member);
});

describe("General page for a workspace member", () => {
  it("serves the identity form read-only, with nothing to save", async () => {
    const served = await servedTo(member);

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

  it("reads the page again after a rename: its glance and danger zone show the name", async () => {
    const form = await identityForm();
    const { options } = await form.serialize();

    expect(options.watchActions).toContainEqual(
      expect.objectContaining({
        event: FormEvents.SUBMIT_SUCCESS,
        functionId: BlockFunctions.REFRESH_PAGE,
      }),
    );
  });

  it("serves the identity form unchanged to an owner", async () => {
    const form = await identityForm();
    const { options } = await form.serialize();

    expect(await servedTo(owner)).toEqual(options);
  });

  it("lets every member read the identity and the glance, and only owners change it", async () => {
    const stranger = await createUser();
    const guardedFor = async (user: User) =>
      guardRefusals(
        SaasWorkspacesController,
        await tenantRequest(user, tenantId),
      );

    await expect(guardedFor(owner)).resolves.toEqual({});
    await expect(guardedFor(member)).resolves.toEqual({
      getCurrentOverview: [OWNER_REQUIRED],
      renameCurrent: [OWNER_REQUIRED],
      deleteCurrent: [OWNER_REQUIRED],
    });
    await expect(guardedFor(stranger)).resolves.toEqual({
      getCurrent: [MEMBER_REQUIRED],
      getCurrentGlance: [MEMBER_REQUIRED],
      getCurrentOverview: [OWNER_REQUIRED],
      renameCurrent: [OWNER_REQUIRED],
      deleteCurrent: [OWNER_REQUIRED],
    });
  });
});
