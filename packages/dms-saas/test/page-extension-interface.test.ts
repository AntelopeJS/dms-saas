import type { Component } from "@antelopejs/interface-dms/component";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pageExtension = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
}));

const pageRegistration = vi.hoisted(() => ({
  Category: vi.fn(),
  RegisterModule: vi.fn(),
  modulesCategory: { location: "/modules" },
  settingsCategory: { location: "/settings" },
}));

vi.mock("@antelopejs/interface-dms/page", () => ({
  Category: pageRegistration.Category,
  RegisterModule: pageRegistration.RegisterModule,
  internal: { RegisterPageExtension: pageExtension },
  modulesCategory: pageRegistration.modulesCategory,
  settingsCategory: pageRegistration.settingsCategory,
}));

import {
  platformSaasModule,
  platformWorkspaceDetailPage,
  RegisterPlatformWorkspaceDetailPageExtension,
  RegisterTenantBillingPageExtension,
  tenantBillingPage,
} from "@antelopejs/interface-dms-saas/pages";

const COMPONENT = {} as Component;

beforeEach(() => {
  pageExtension.register.mockClear();
  pageExtension.unregister.mockClear();
});

describe("tenant billing page extension interface", () => {
  it("publishes stable page and anchor identifiers", () => {
    expect(tenantBillingPage).toMatchObject({
      fullId: "settings.workspace.billing",
      fullSlug: "/settings/workspace/billing",
      components: {
        planCard: "planCard",
        billingForm: "billingForm",
      },
    });
  });

  it("registers and unregisters the same identifier-based extension", () => {
    const registration = RegisterTenantBillingPageExtension({
      name: "CloudBillingBlocks",
      components: [
        {
          key: "inProgressInvoice",
          component: COMPONENT,
          side: "after",
          anchorKey: tenantBillingPage.components.planCard,
          order: 10,
        },
      ],
    });

    expect(pageExtension.register).toHaveBeenCalledOnce();
    const info = pageExtension.register.mock.calls[0][0];
    expect(info).toEqual({
      extensionName: "CloudBillingBlocks",
      targetFullId: "settings.workspace.billing",
      components: [
        {
          key: "inProgressInvoice",
          component: COMPONENT,
          side: "after",
          anchorPath: ["planCard"],
          order: 10,
        },
      ],
    });

    registration.unregister();

    expect(pageExtension.unregister).toHaveBeenCalledWith(info);
  });
});

describe("platform workspace page extension interface", () => {
  it("publishes the module and stable page identifiers", () => {
    expect(pageRegistration.RegisterModule).not.toHaveBeenCalled();
    expect(platformSaasModule).toEqual({
      id: "saas",
      fullId: "modules.saas",
      fullSlug: "/modules/saas",
      category: {
        id: "modules",
        fullId: "modules",
        fullSlug: "/modules",
        layoutUrl: "/modules/pagelayout",
        category: undefined,
        displayName: "$modules.title",
        description: "$modules.intro",
        urlSlug: "/modules",
        icon: "i-ph-squares-four",
        order: 2,
        noComponentPermissions: true,
        isModuleRoot: true,
        hidden: undefined,
        publicAccess: undefined,
        authOnly: undefined,
        bypassTenantAccessGate: undefined,
      },
      displayName: "$saas.module.title",
      description: "$saas.module.description",
      icon: "i-ph-buildings",
      urlSlug: "saas",
      type: "label",
      isModuleRoot: true,
      urlTransparent: false,
      hidden: undefined,
      bypassTenantAccessGate: undefined,
    });
    expect(Object.getPrototypeOf(platformSaasModule)).toBe(Object.prototype);
    expect(platformWorkspaceDetailPage).toEqual({
      fullId: "modules.saas.customers.workspaces.detail",
      components: {
        header: "header",
        summary: "summary",
        body: "body",
      },
    });
  });

  it("registers an identifier-based platform workspace extension", () => {
    const registration = RegisterPlatformWorkspaceDetailPageExtension({
      name: "CloudWorkspaceOperations",
      components: [{ key: "cloudState", component: COMPONENT, side: "end" }],
    });

    expect(pageExtension.register).toHaveBeenCalledWith({
      extensionName: "CloudWorkspaceOperations",
      targetFullId: "modules.saas.customers.workspaces.detail",
      components: [{ key: "cloudState", component: COMPONENT, side: "end" }],
    });

    const info = pageExtension.register.mock.calls[0][0];
    registration.unregister();
    expect(pageExtension.unregister).toHaveBeenCalledWith(info);
  });
});
