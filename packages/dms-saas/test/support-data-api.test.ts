import type { RequestContext } from "@antelopejs/interface-api";
import { GetDataControllerMeta } from "@antelopejs/interface-data-api";
import {
  Query as DataQuery,
  Parameters,
} from "@antelopejs/interface-data-api/components";
import { Schema } from "@antelopejs/interface-database";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(async () => ({ _id: "ticket-a" })),
  tenant: vi.fn(() => "tenant-a"),
  getModel: vi.fn(),
  member: vi.fn(() => () => undefined),
  owner: vi.fn(() => () => undefined),
}));

vi.mock("@antelopejs/interface-database-decorators", async () => ({
  ...(await vi.importActual("@antelopejs/interface-database-decorators")),
  GetModel: mocks.getModel,
}));
vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: mocks.tenant,
}));
vi.mock("@antelopejs/interface-dms/guards", () => ({
  AuthTenantMember: mocks.member,
}));
vi.mock("@antelopejs/interface-dms/auth", async () => ({
  ...(await vi.importActual("@antelopejs/interface-dms/auth")),
  AuthOwnerOnly: mocks.owner,
}));

import { TableViewRoutes } from "@antelopejs/interface-dms/base";
import {
  supportEventsDataAPI,
  supportMessagesDataAPI,
  supportOwnersDataAPI,
  supportTicketsDataAPI,
} from "../src/data-api/platformOwner/support";
import { supportReadRoutes } from "../src/data-api/support-routes";
import {
  tenantSupportEventsDataAPI,
  tenantSupportMessagesDataAPI,
  tenantSupportTicketsDataAPI,
} from "../src/data-api/tenant/support";

const schema = new Schema("support-data-api-tests", {});
const context = {
  routeParameters: { ticketId: "ticket-a" },
  url: new URL("https://example.test/messages/list"),
} as RequestContext;

afterEach(() => vi.restoreAllMocks());

describe("support DataController contracts", () => {
  it("registers membership and owner guards on both read operations", () => {
    for (const operation of ["list", "count"] as const) {
      const tenant = GetDataControllerMeta(new tenantSupportTicketsDataAPI());
      const platform = GetDataControllerMeta(new supportTicketsDataAPI());
      expect(mocks.member.mock.results.map((result) => result.value)).toContain(
        tenant.endpoints[operation].callback.args.at(-1),
      );
      expect(mocks.owner.mock.results.map((result) => result.value)).toContain(
        platform.endpoints[operation].callback.args.at(-1),
      );
    }
  });

  it("inherits public projections and exposes only list/count", () => {
    const controllers = [
      supportTicketsDataAPI,
      supportMessagesDataAPI,
      supportEventsDataAPI,
      supportOwnersDataAPI,
      tenantSupportTicketsDataAPI,
      tenantSupportMessagesDataAPI,
      tenantSupportEventsDataAPI,
    ];
    for (const Controller of controllers) {
      const meta = GetDataControllerMeta(new Controller());
      expect(Object.keys(meta.endpoints).sort()).toEqual(["count", "list"]);
      expect(meta.modelKey).toBe("model");
      expect(meta.pluck.list.has("_id")).toBe(true);
      expect(meta.pluck.list.has("mutationId")).toBe(false);
    }
    const ticket = GetDataControllerMeta(new supportTicketsDataAPI());
    expect(ticket.pluck.list.has("subject")).toBe(true);
    expect(ticket.pluck.list.has("tenantName")).toBe(true);
    expect(ticket.fields.tenantName.joined).toMatchObject({
      localKey: "_instance",
      remoteField: "name",
    });
    expect(
      GetDataControllerMeta(new tenantSupportTicketsDataAPI()).pluck.list.has(
        "_instance",
      ),
    ).toBe(false);
  });

  it.each(["messages", "events"] as const)(
    "forces %s ticket scope on list and count",
    async (collection) => {
      mocks.getModel.mockReturnValue({ get: mocks.get });
      for (const operation of ["list", "count"] as const) {
        const base =
          operation === "list" ? TableViewRoutes.List : TableViewRoutes.Count;
        const callback = vi
          .spyOn(base, "func")
          .mockResolvedValue({ results: [], total: 0 });
        const route = supportReadRoutes("tenant", collection)[operation];
        await route.func(
          context,
          { filters: { ticketId: ["other", "ne"] }, limit: 20 },
          {},
        );
        expect(callback.mock.calls.at(-1)?.[1]).toMatchObject({
          filters: { ticketId: ["ticket-a", "eq"] },
          limit: 20,
        });
        expect(mocks.getModel).toHaveBeenCalledWith(
          expect.any(Function),
          "tenant-a",
        );
        expect(mocks.get).toHaveBeenCalledWith("ticket-a");
      }
    },
  );

  it("uses the owner's route tenant and rejects a missing ticket before listing", async () => {
    mocks.getModel.mockReturnValue({ get: vi.fn(async () => null) });
    const callback = vi.spyOn(TableViewRoutes.List, "func");
    const route = supportReadRoutes("platform", "messages").list;
    await expect(
      route.func(
        {
          ...context,
          routeParameters: { tenantId: "tenant-b", ticketId: "missing" },
        },
        {},
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.getModel).toHaveBeenCalledWith(
      expect.any(Function),
      "tenant-b",
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("keeps filters, caps pages and maps recent sorting to the compound index", async () => {
    const callback = vi
      .spyOn(TableViewRoutes.List, "func")
      .mockResolvedValue({});
    await supportReadRoutes("platform", "tickets").list.func(context, {
      offset: 40,
      limit: 1000,
      sortKey: "lastMessageAt",
      sortDirection: "desc",
      filters: { status: ["open", "is"], priority: ["high", "is"] },
    });
    expect(callback.mock.calls[0][1]).toMatchObject({
      offset: 40,
      limit: 100,
      sortKey: "ticket_recent_order",
      filters: { status: ["open", "is"], priority: ["high", "is"] },
    });
  });

  it.each([{ offset: -1 }, { limit: -1 }, { offset: Number.NaN }])(
    "rejects invalid pagination %j",
    async (params) => {
      await expect(
        supportReadRoutes("tenant", "tickets").list.func(context, params),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it("applies inbox filters to rows and count in the database", () => {
    const controller = new supportTicketsDataAPI();
    const meta = GetDataControllerMeta(controller);
    const request = {
      ...context,
      url: new URL(
        "https://example.test/list?filter_status=is:open&filter_priority=is:high",
      ),
    };
    const [rows, total] = DataQuery.List(
      controller,
      meta,
      schema.instance("tenant-a").table("support_tickets"),
      context,
      ["ticket_recent_order", "desc"],
      Parameters.ExtractFilters(request, meta),
    );
    for (const query of [rows, total]) {
      const built = JSON.stringify(query.build());
      expect(built).toContain('"status"');
      expect(built).toContain('"priority"');
      expect(built).toContain('"open"');
      expect(built).toContain('"high"');
    }
  });

  it("uses indexed ticket lookup and deterministic database ordering", () => {
    const controller = new tenantSupportMessagesDataAPI();
    const meta = GetDataControllerMeta(controller);
    const [rows, total] = DataQuery.List(
      controller,
      meta,
      schema.instance("tenant-a").table("support_messages"),
      context,
      ["ticket_message_order", "desc"],
      { ticketId: ["ticket-a", "eq"] },
    );
    const query = JSON.stringify(rows.slice(20, 20).build());
    expect(query).toContain("ticket-a");
    expect(query).toContain("ticketId");
    expect(query).toContain("ticket_message_order");
    expect(rows.slice(20, 20).build().at(-1)?.stage).toBe("slice");
    expect(total.build().at(-1)?.stage).toBe("count");
  });

  it("filters owners as booleans and never exposes private user fields", async () => {
    const callback = vi
      .spyOn(TableViewRoutes.List, "func")
      .mockResolvedValue({});
    await supportReadRoutes("platform", "owners").list.func(context, {
      filters: { owner: ["false", "eq"] },
    });
    expect(callback.mock.calls[0][1].filters.owner).toEqual(["true", "eq"]);
    const controller = new supportOwnersDataAPI();
    const meta = GetDataControllerMeta(controller);
    const [rows] = DataQuery.List(
      controller,
      meta,
      schema.instance("default").table("users"),
      context,
      ["_id", "asc"],
      { owner: ["true", "eq"] },
    );
    expect(JSON.stringify(rows.build())).toContain(
      '"stage":"eq","args":[true]',
    );
    expect([...meta.pluck.list].sort()).toEqual(["_id", "email", "name"]);
  });
});
