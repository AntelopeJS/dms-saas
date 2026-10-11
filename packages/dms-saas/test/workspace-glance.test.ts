import { describe, expect, it } from "vitest";
import {
  type WorkspaceOverview,
  workspaceGlanceItems,
} from "../src/workspaces";
import { LOCALES, missingKeys } from "./helpers/composed-text";

const OVERVIEW: WorkspaceOverview = {
  _id: "t1",
  name: "Acme",
  createdAt: new Date("2026-01-12T09:00:00Z"),
  seats: { members: 3, pendingInvites: 1, occupied: 4, maxMembers: 10 },
  plan: {
    name: "Business",
    status: "past_due",
    isComplimentary: false,
    price: 49,
    currency: "eur",
    interval: "month",
    billingMode: "seat",
    renewsAt: new Date("2026-11-01T00:00:00Z"),
  },
  owners: [
    { userId: "u1", name: "Ada", email: "ada@example.com", isCaller: true },
    { userId: "u2", name: "Bob", email: "bob@example.com", isCaller: false },
  ],
  invoicesCount: 2,
  unpaidInvoiceNumber: null,
  retentionDays: 30,
  destroyedAt: new Date("2026-11-08T00:00:00Z"),
  nextWorkspace: null,
};

const item = (view: WorkspaceOverview, id: string) =>
  workspaceGlanceItems(view).find((entry) => entry.id === id);

describe("workspace glance", () => {
  it("counts the members and invites in the reader's plural", () => {
    expect(item(OVERVIEW, "members")).toMatchObject({
      value: { params: { occupied: 4, max: 10 } },
      detail: {
        params: {
          members: { params: { count: { type: "count", value: 3 } } },
          invites: { params: { count: { type: "count", value: 1 } } },
        },
      },
      to: "/settings/workspace/members",
    });
  });

  it("writes the plan price in minor units and tones a past-due plan", () => {
    const plan = item(OVERVIEW, "plan");
    expect(plan).toMatchObject({ value: "Business", detailTone: "error" });
    expect(JSON.stringify(plan?.detail)).toContain(
      '{"type":"money","value":4900,"currency":"EUR"}',
    );
  });

  it("names the caller and the other owners", () => {
    expect(item(OVERVIEW, "owner")).toMatchObject({
      value: {
        key: "saas.workspace.general.glance.owner_and_others",
        params: { name: "Ada" },
      },
      detail: { key: "saas.text.dot_list" },
    });
  });

  it.each(LOCALES)("%s has every key the cards name", (code) => {
    const variants: WorkspaceOverview[] = [
      OVERVIEW,
      {
        ...OVERVIEW,
        plan: null,
        owners: [],
        seats: { ...OVERVIEW.seats, maxMembers: null },
      },
      {
        ...OVERVIEW,
        plan: { ...OVERVIEW.plan!, isComplimentary: true, renewsAt: null },
      },
      { ...OVERVIEW, plan: { ...OVERVIEW.plan!, price: 0 } },
    ];
    expect(missingKeys(variants.map(workspaceGlanceItems), code)).toEqual([]);
  });
});
