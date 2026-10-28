import { ImplementInterface } from "@antelopejs/interface-core";
import * as pagesInterface from "@antelopejs/interface-dms-saas/pages";
import { beforeAll, describe, expect, it } from "vitest";
import * as pagesImplementation from "../src/implementations/dms-saas/pages";
import { saasModule } from "../src/pages/module";
import { implementPageRegistry, registered } from "./helpers/pages";

const registry = implementPageRegistry();

beforeAll(() => {
  ImplementInterface(pagesInterface, pagesImplementation);
});

describe("page runtime interface", () => {
  it("registers each canonical root exactly once from shared definitions", () => {
    expect(registered(registry.modules)).toEqual([
      {
        id: "saas",
        title: "$saas.module.title",
        description: "$saas.module.description",
        icon: "i-ph-buildings",
        landingPage: "dashboard",
      },
    ]);
    // The workspace settings category is the DMS's own: registering a
    // second `settings.workspace` would collide with it.
    expect(
      registered(registry.categories).map((category) => category.fullId),
    ).toEqual(["pages", "settings.workspace", "modules.saas"]);
  });

  it("returns the canonical registered objects", async () => {
    await expect(pagesInterface.GetPlatformSaasModule()).resolves.toBe(
      saasModule,
    );
    expect(pagesInterface.platformSaasModule).not.toBe(saasModule);
  });
});
