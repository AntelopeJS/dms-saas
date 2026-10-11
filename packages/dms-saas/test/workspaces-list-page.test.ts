import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import { describe, expect, it } from "vitest";
import { workspacesDataAPI } from "../src/data-api/platformOwner/workspaces";
import { SaasWorkspacesListController } from "../src/pages/platform/workspaces";
import { WORKSPACE_STATUS_ORDER } from "../src/utils/status-vocabulary";

interface SerializedTable {
  options?: {
    tabs?: { id: string; filter?: { accessorKey: string; value?: string } }[];
    views?: {
      items: { id: string; filters?: { accessorKey: string }[] }[];
      layout?: string;
    };
    footer?: {
      summary?: {
        field?: string;
        op: string;
        format?: { currency?: string };
      }[];
    };
    defaultSort?: { field: string; desc?: boolean };
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
      ...WORKSPACE_STATUS_ORDER,
    ]);
    expect(table.options?.tabs?.[0]?.filter).toMatchObject({
      accessorKey: "billingState",
      value: WORKSPACE_STATUS_ORDER[0],
    });
  });

  it("opens on the largest accounts first", () => {
    expect(table.options?.defaultSort).toEqual({
      field: "mrrMinor",
      desc: true,
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

  it("lays the views out as a strip of pills", () => {
    expect(table.options?.views?.layout).toBe("strip");
  });

  it("totals the listed MRR in the reporting currency", async () => {
    const filter = SaasWorkspacesListController.table.onFilterCallback;
    const filtered = (await filter?.(
      new Set(),
      table.options,
      "table",
      {} as never,
    )) as SerializedTable["options"];

    expect(filtered?.footer?.summary).toEqual([
      expect.objectContaining({
        field: "reportingMrr",
        op: "sum",
        format: { style: "currency", currency: "EUR" },
      }),
    ]);
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
