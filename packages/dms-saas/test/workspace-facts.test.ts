import { fromPartial } from "@total-typescript/shoehorn";
import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import { describe, expect, it } from "vitest";
import type { Invoice } from "../src/db";
import { workspaceFacts } from "../src/workspaces/detail-items";
import type { WorkspaceOperatorView } from "../src/workspaces/operator-view";
import { LOCALES, missingKeys, writeText } from "./helpers/composed-text";

const VIEW = fromPartial<WorkspaceOperatorView>({
  billingState: "active",
  plan: { maxMembers: 10 },
  seats: { members: 3, pendingInvites: 2, occupied: 5, platformSupport: [] },
  subscription: { stripeCustomerId: "cus_1" },
  directory: {
    planName: "Business",
    planUnitAmountMinor: 2900,
    planInterval: "month",
    planBillingMode: "seat",
    currency: "eur",
    seats: 5,
    isComplimentary: false,
    mrrMinor: 14_500,
  },
});

const PREVIEW = fromPartial<UpcomingInvoicePreview>({
  status: "available",
  billingDate: "2026-11-01T00:00:00.000Z",
  totalMinorUnits: 17_400,
  currency: "eur",
});

const PAID = fromPartial<Invoice>({
  status: "paid",
  documentType: "invoice",
  currency: "eur",
  total: 14_500,
  amount: 14_500,
  issuedAt: new Date("2026-03-01T00:00:00Z"),
});

const facts = (view = VIEW, preview: UpcomingInvoicePreview | null = PREVIEW) =>
  workspaceFacts({
    view,
    preview,
    card: fromPartial<
      NonNullable<Parameters<typeof workspaceFacts>[0]["card"]>
    >({
      brand: "visa",
      last4: "4242",
    }),
    invoices: [PAID],
  });

describe("workspace facts", () => {
  it("serves the MRR as an amount the browser writes", () => {
    expect(facts()[0]).toMatchObject({
      value: {
        params: { value: { type: "money", value: 14_500, currency: "EUR" } },
      },
      detail: { key: "saas.workspace_detail.facts.price_times_seats" },
    });
  });

  it("reads the same once written on the server", () => {
    const [mrr, seats, next] = facts();

    expect(writeText(mrr!.detail!)).toBe("€29.00 × 5 seats · per month");
    expect(writeText(seats!.detail!)).toBe("+2 pending invitations");
    expect(writeText(next!.detail!)).toBe("€174.00 incl. tax");
  });

  it.each(LOCALES)("%s has every key the facts name", (code) => {
    const trialing = fromPartial<WorkspaceOperatorView>({
      ...VIEW,
      billingState: "trialing",
    });
    const bare = fromPartial<WorkspaceOperatorView>({
      ...VIEW,
      subscription: undefined,
      directory: { ...VIEW.directory, planName: null, currency: null },
    });
    expect(
      missingKeys([facts(), facts(trialing, null), facts(bare, null)], code),
    ).toEqual([]);
  });
});
