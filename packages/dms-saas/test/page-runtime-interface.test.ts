import { ImplementInterface } from "@antelopejs/interface-core";
import { beforeAll, describe, expect, it, vi } from "vitest";

const pageRegistration = vi.hoisted(() => {
  const modulesCategory = { location: "/modules" };
  const settingsCategory = { location: "/settings" };
  const workspaceSettingsCategory = { fullId: "settings.workspace" };
  return {
    modulesCategory,
    settingsCategory,
    workspaceSettingsCategory,
    Category: vi.fn((id, options) => ({
      ...options,
      id,
      fullId: `settings.${id}`,
      fullSlug: `/settings/${id}`,
    })),
    RegisterModule: vi.fn((definition) => ({
      id: definition.id,
      fullId: `modules.${definition.id}`,
      fullSlug: `/modules/${definition.id}`,
      category: modulesCategory,
    })),
  };
});

vi.mock("@antelopejs/interface-dms/page", () => ({
  Category: pageRegistration.Category,
  RegisterModule: pageRegistration.RegisterModule,
  internal: {
    RegisterPageExtension: { register: vi.fn(), unregister: vi.fn() },
  },
  modulesCategory: pageRegistration.modulesCategory,
  settingsCategory: pageRegistration.settingsCategory,
  workspaceSettingsCategory: pageRegistration.workspaceSettingsCategory,
}));

import * as pagesImplementation from "../src/implementations/dms-saas/pages";
import * as pagesInterface from "@antelopejs/interface-dms-saas/pages";
import { saasModule, workspaceSettingsCategory } from "../src/pages/module";

beforeAll(() => {
  ImplementInterface(pagesInterface, pagesImplementation);
});

describe("page runtime interface", () => {
  it("registers each canonical root exactly once from shared definitions", () => {
    expect(pageRegistration.RegisterModule).toHaveBeenCalledOnce();
    expect(pageRegistration.RegisterModule).toHaveBeenCalledWith({
      id: "saas",
      title: "$saas.module.title",
      description: "$saas.module.description",
      icon: "i-ph-buildings",
      landingPage: "dashboard",
    });
    // The workspace settings category is the DMS's own: registering a
    // second `settings.workspace` would collide with it.
    expect(pageRegistration.Category).not.toHaveBeenCalled();
  });

  it("returns the canonical registered objects", async () => {
    await expect(pagesInterface.GetPlatformSaasModule()).resolves.toBe(
      saasModule,
    );
    await expect(pagesInterface.GetWorkspaceSettingsCategory()).resolves.toBe(
      pageRegistration.workspaceSettingsCategory,
    );
    expect(workspaceSettingsCategory).toBe(
      pageRegistration.workspaceSettingsCategory,
    );
    expect(pagesInterface.platformSaasModule).not.toBe(saasModule);
  });
});
