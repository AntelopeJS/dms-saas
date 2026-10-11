import { GetMetadata } from "@antelopejs/interface-core";
import { DefaultDisplays, TableViewMeta } from "@antelopejs/interface-dms/base";
import { describe, expect, it } from "vitest";
import { creditNotesDataAPI } from "../src/data-api/platformOwner/credit-notes";
import { invoicesDataAPI } from "../src/data-api/platformOwner/invoices";

describe("invoices table", () => {
  it("draws the workspace with its initials over its plan", () => {
    const columns = GetMetadata(invoicesDataAPI, TableViewMeta).columns;

    const display = columns.workspaceName?.display;

    expect(display).toBeInstanceOf(DefaultDisplays.IdentityDisplay);
    expect(display).toMatchObject({ options: { subtitleField: "planDetail" } });
  });
});

describe("credit notes table", () => {
  it("draws each credit note's tile with the icon of its type", () => {
    const columns = GetMetadata(creditNotesDataAPI, TableViewMeta).columns;
    const typeIcon = Object.getOwnPropertyDescriptor(
      creditNotesDataAPI.prototype,
      "typeIcon",
    )?.get;

    expect(columns.number?.display).toMatchObject({
      options: { iconField: "typeIcon", icon: "i-ph-receipt-x" },
    });
    expect(typeIcon?.call({ table: { type: "refund" } })).toBe(
      "i-ph-arrow-u-down-left",
    );
    expect(typeIcon?.call({ table: { type: "unknown" } })).toBeNull();
  });
});
