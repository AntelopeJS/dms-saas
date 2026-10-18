import type {
  Component,
  ComponentInfoSerialized,
} from "@antelopejs/interface-dms/component";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { GetMetadata } from "@antelopejs/interface-core";
import { SettingsLayout } from "@antelopejs/interface-dms/base/layouts";
import type { PageExtensionInfo } from "@antelopejs/interface-dms/page";
import { internal, PageMetadata } from "@antelopejs/interface-dms/page";
// The DMS's own assembly, so the test places blocks exactly as a page serves
// them rather than restating its rules.
import { assembleLayoutComponents } from "@antelopejs/interface-dms/page/internal/extension-assembly";
import { collectExtensionErrors } from "@antelopejs/interface-dms/page/internal/extension-validation";
import {
  RegisterTenantBillingPageExtension,
  tenantBillingPage,
  tenantBillingPageAnchorPaths,
} from "@antelopejs/interface-dms-saas/pages";
import { describe, expect, it, vi } from "vitest";
import { SaasTenantBillingController } from "../src/pages/tenant/billing";

type Layout = Record<string, ComponentInfoSerialized>;

const PAGE_FIELDS = [
  "freeAccessBanner",
  "pastDueAlert",
  "overview",
  "billingForm",
  "invoices",
] as const;

async function ownLayout(): Promise<Layout> {
  const fields = SaasTenantBillingController as unknown as Record<
    (typeof PAGE_FIELDS)[number],
    Component
  >;
  const entries = await Promise.all(
    PAGE_FIELDS.map(async (key) => [key, await fields[key].serialize()]),
  );
  return Object.fromEntries(entries);
}

function childAt(layout: Layout, path: readonly string[]) {
  const [key, ...ids] = path;
  let node: ComponentInfoSerialized | undefined = layout[key];
  for (const id of ids) {
    node = node?.children?.find((child) => child.id === id)?.component;
  }
  return node;
}

function childIds(layout: Layout, path: readonly string[]): string[] {
  return childAt(layout, path)?.children?.map((child) => child.id) ?? [];
}

/** Registers the cloud module's two blocks the way it does, and captures them. */
function registerCloudBlocks(): PageExtensionInfo {
  const register = vi
    .spyOn(internal.RegisterPageExtension, "register")
    .mockImplementation(() => undefined);
  RegisterTenantBillingPageExtension({
    name: "CloudBillingBlocks",
    components: [
      {
        key: "inProgressInvoice",
        component: CustomComponent("CloudInProgressInvoice"),
        side: "after",
        anchorKey: tenantBillingPage.components.planCard,
      },
      {
        key: "spendProtection",
        component: CustomComponent("CloudSpendProtection"),
        side: "after",
        anchorKey: tenantBillingPage.components.billingForm,
      },
    ],
  });
  const info = register.mock.calls[0][0];
  register.mockRestore();
  return info;
}

async function assemble(own: Layout, info: PageExtensionInfo) {
  const entries = await Promise.all(
    info.components.map(async (component, declarationIndex) => ({
      ...component,
      extensionName: info.extensionName,
      declarationIndex,
      serialized: await component.component.serialize(),
    })),
  );
  return assembleLayoutComponents(own, entries);
}

describe("tenant billing page layout", () => {
  it("inherits the settings layout like the other workspace settings pages", () => {
    const meta = GetMetadata(SaasTenantBillingController, PageMetadata);

    expect(meta.layout?.componentName).toBe(SettingsLayout().componentName);
    expect(meta.layout?.options?.fullWidth).toBeUndefined();
    // The recovery surface of a blocked workspace keeps bypassing the gate.
    expect(meta.pageInfo?.bypassTenantAccessGate).toBe(true);
  });

  it("lays the plan, next invoice, payment method and guarantee out in two columns", async () => {
    const own = await ownLayout();

    expect(own.overview.componentName).toBe("dms-grid");
    expect(childIds(own, ["overview"])).toEqual(["plan", "payment"]);
    expect(childIds(own, ["overview", "plan"])).toEqual([
      "current",
      "nextInvoice",
    ]);
    expect(childIds(own, ["overview", "payment"])).toEqual([
      "method",
      "guarantee",
    ]);
  });

  it("resolves every public anchor to a block the page declares", async () => {
    const own = await ownLayout();

    for (const [anchor, path] of Object.entries(tenantBillingPageAnchorPaths)) {
      expect(path.at(-1), anchor).toBe(anchor);
      expect(childAt(own, path), anchor).toBeDefined();
    }
  });

  it("keeps an extension anchored on planCard right after the plan card, in its column", async () => {
    const own = await ownLayout();
    const info = registerCloudBlocks();

    expect(collectExtensionErrors(info, { own, taken: new Map() })).toEqual([]);
    const assembled = await assemble(own, info);

    expect(childIds(assembled, ["overview", "plan", "current"])).toEqual([
      "planCard",
      "inProgressInvoice",
    ]);
    expect(childIds(assembled, ["overview", "plan"])).toEqual([
      "current",
      "nextInvoice",
    ]);
    expect(Object.keys(assembled)).toEqual([
      "freeAccessBanner",
      "pastDueAlert",
      "overview",
      "billingForm",
      "spendProtection",
      "invoices",
    ]);
  });
});
