import { fromPartial } from "@total-typescript/shoehorn";
import type { Tenant } from "@antelopejs/interface-dms/db";
import { describe, expect, it } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";
import {
  buildWorkspaceProjection,
  type WorkspaceDirectoryRow,
} from "../src/utils";

const NOW = new Date("2026-10-19T12:00:00Z");

const TENANT = fromPartial<Tenant>({
  _id: "t1",
  name: "Initech",
  createdAt: NOW,
});

const YEARLY_PLAN = fromPartial<Plan>({
  _id: "yearly",
  name: "Yearly",
  price: 1200,
  currency: "eur",
  interval: "year",
  billingMode: "flat",
});

const SEAT_PLAN = fromPartial<Plan>({
  _id: "seat",
  name: "Seat",
  price: 10,
  currency: "eur",
  interval: "month",
  billingMode: "seat",
});

function subscription(patch: Partial<TenantSubscription>): TenantSubscription {
  return fromPartial<TenantSubscription>({
    status: "active",
    planId: YEARLY_PLAN._id,
    stripeSubscriptionId: "sub_1",
    isComplimentary: false,
    ...patch,
  });
}

function project(
  sub: TenantSubscription | undefined,
  plan: Plan | null,
  directory: WorkspaceDirectoryRow | null = null,
  membersCount = 3,
) {
  return buildWorkspaceProjection({
    tenant: TENANT,
    subscription: sub,
    billingInfo: undefined,
    plan,
    directory,
    membersCount,
    invoices: [],
    now: NOW,
  });
}

describe("workspace projection MRR", () => {
  it("divides a yearly price by 12", () => {
    const projection = project(subscription({}), YEARLY_PLAN);
    expect(projection.mrr).toBe(100);
    expect(projection.isPaying).toBe(true);
  });

  it("multiplies a seat price by the members", () => {
    const projection = project(
      subscription({ planId: SEAT_PLAN._id }),
      SEAT_PLAN,
    );
    expect(projection.mrr).toBe(30);
  });

  it("counts a trial for nothing", () => {
    const projection = project(
      subscription({ status: "trialing" }),
      YEARLY_PLAN,
    );
    expect(projection.mrr).toBe(0);
    expect(projection.isPaying).toBe(false);
    expect(projection.isOnTrial).toBe(true);
  });

  it("counts complimentary access for nothing", () => {
    const projection = project(
      subscription({ isComplimentary: true }),
      YEARLY_PLAN,
    );
    expect(projection.mrr).toBe(0);
    expect(projection.isPaying).toBe(false);
  });

  it("counts an active workspace without a Stripe subscription for nothing", () => {
    const projection = project(
      subscription({ stripeSubscriptionId: null }),
      YEARLY_PLAN,
    );
    expect(projection.mrr).toBe(0);
  });

  it("keeps past due workspaces billed", () => {
    const projection = project(
      subscription({ status: "past_due" }),
      YEARLY_PLAN,
    );
    expect(projection.mrr).toBe(100);
  });

  it("reads the MRR the directory published, as the dashboard does", () => {
    const projection = project(subscription({}), SEAT_PLAN, {
      billingState: "active",
      mrrMinor: 112_083,
      currency: "EUR",
    });
    expect(projection.mrr).toBe(1120.83);
    expect(projection.status).toBe("active");
  });
});
