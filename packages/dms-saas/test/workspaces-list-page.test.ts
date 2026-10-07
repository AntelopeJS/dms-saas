import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import { describe, expect, it } from "vitest";
import { workspacesDataAPI } from "../src/data-api/platformOwner/workspaces";
import { BILLING_STATES } from "../src/db";
import { SaasWorkspacesListController } from "../src/pages/platform/workspaces";

interface SerializedTable {
  options?: {
    tabs?: { id: string; filter?: { accessorKey: string; value?: string } }[];
    views?: { items: { id: string; filters?: { accessorKey: string }[] }[] };
  };
}

const DIRECTORY_COLUMNS = [
  "billingState",
  "planName",
  "mrrMinor",
  "ownerName",
  "ownerStatus",
  "ownerNeverJoined",
  "renewsAt",
  "renewalKind",
  "stateSince",
];

describe("workspace list", () => {
  const table =
    SaasWorkspacesListController.table.serializeSync() as SerializedTable;

  it("offers a tab per status, filtering on the stored billing state", () => {
    expect(table.options?.tabs?.map((tab) => tab.id)).toEqual([
      ...BILLING_STATES,
    ]);
    expect(table.options?.tabs?.[0]?.filter).toMatchObject({
      accessorKey: "billingState",
      value: BILLING_STATES[0],
    });
  });

  it("offers the predefined views, each filtering on stored directory fields", () => {
    const views = table.options?.views?.items ?? [];

    expect(views.map((view) => view.id)).toEqual([
      "complimentary-ending",
      "past-due-7-days",
      "trials-ending",
      "owner-never-joined",
      "mrr-over-500",
    ]);
    for (const view of views) {
      for (const filter of view.filters ?? []) {
        expect(DIRECTORY_COLUMNS).toContain(filter.accessorKey);
      }
    }
  });

  it("reads the directory fields as joins the database sorts and filters", () => {
    const meta = GetDataControllerMeta(new workspacesDataAPI());

    for (const column of DIRECTORY_COLUMNS) {
      expect(meta.fields[column]?.joined).toMatchObject({
        localKey: "_id",
        remoteField: column === "billingState" ? "billingState" : column,
      });
    }
    expect(meta.fields.mrrMinor?.sortable).toBeDefined();
    expect(meta.fields.renewsAt?.sortable).toBeDefined();
  });
});
