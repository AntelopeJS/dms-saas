import { GetMetadata } from "@antelopejs/interface-core";
import { DefaultDisplays, TableViewMeta } from "@antelopejs/interface-dms/base";
import { describe, expect, it } from "vitest";
import { invoicesDataAPI } from "../src/data-api/platformOwner/invoices";

describe("invoices table", () => {
  it("draws the workspace with its initials over its plan", () => {
    const columns = GetMetadata(invoicesDataAPI, TableViewMeta).columns;

    const display = columns.workspaceName?.display;

    expect(display).toBeInstanceOf(DefaultDisplays.IdentityDisplay);
    expect(display).toMatchObject({ options: { subtitleField: "planDetail" } });
  });
});
