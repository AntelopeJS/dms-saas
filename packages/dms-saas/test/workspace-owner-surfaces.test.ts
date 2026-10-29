import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  TenantMemberModel,
  TenantModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  InvoiceModel,
  type Plan,
  type TenantSubscription,
  TenantSubscriptionModel,
  TrialConsumptionModel,
} from "../src/db";
import { defaultBillingRules } from "../src/operator-billing/billing-settings-store";
import { hashEmail } from "../src/utils/email-hash";
import {
  assertCardMayBackFreeWorkspace,
  listFreeWorkspacesBackedByCard,
} from "../src/workspaces/free-workspaces-per-card";
import { listMyWorkspaces } from "../src/workspaces/my-workspaces";
import {
  buildWorkspaceCreateOptions,
  cardRequirementOf,
} from "../src/workspaces/self-serve-creation";
import { buildWorkspaceOverview } from "../src/workspaces/workspace-overview";
import { createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import {
  PLACEHOLDER_SECRET_KEY,
  reinitSuiteStripe,
} from "./helpers/suite-stripe-keys";
import { insertPlan } from "./helpers/plans";
import { SUITE_STRIPE_KEYS, useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("workspace-owner-surfaces");
const stripe = useSuiteStripe();

const NOW = new Date("2026-10-01T00:00:00.000Z");
const DAY_MS = 86_400_000;

let FREE: Plan;
let PRO: Plan;
let camille: User;
let ines: User;

/** A member of a workspace, and whether it owns it. */
interface Seat {
  user: User;
  isTenantOwner: boolean;
}

beforeAll(async () => {
  FREE = await insertPlan({
    _id: "free",
    name: "Free",
    price: 0,
    order: 0,
    isPublic: true,
  });
  PRO = await insertPlan({
    _id: "pro",
    name: "Pro",
    price: 2900,
    order: 2,
    trialDays: 14,
    maxMembers: 5,
    isPublic: true,
  });
  await insertPlan({
    _id: "business",
    name: "Business",
    price: 4900,
    order: 3,
    audience: "business",
    isPublic: true,
  });
});

/** Stores a workspace with its members and, when given, its subscription; returns its id. */
async function addWorkspace(
  name: string,
  seats: Seat[],
  sub?: Partial<TenantSubscription>,
): Promise<string> {
  const tenantId = randomUUID();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await GetModel(TenantMemberModel, tenantId).insert(
    seats.map(({ user, isTenantOwner }) => ({
      _id: randomUUID(),
      userId: user._id,
      roleIds: [],
      isTenantOwner,
      joinedAt: NOW,
      invitedBy: null,
    })),
  );
  if (sub) await subscribe(tenantId, sub);
  return tenantId;
}

/** Stores the subscription of a workspace, active on the free plan unless said otherwise. */
async function subscribe(
  tenantId: string,
  overrides: Partial<TenantSubscription>,
): Promise<void> {
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    status: "active",
    planId: FREE._id,
    isComplimentary: false,
    stripeSubscriptionId: null,
    cardFingerprint: null,
    currentPeriodEnd: null,
    ...overrides,
  });
}

/** Turns the per-card rule of the billing rules on, up to `limit` free workspaces. */
async function setMaxFreeWorkspacesPerCard(limit: number): Promise<void> {
  await GetModel(BillingSettingsModel).insert({
    _id: BILLING_SETTINGS_SINGLETON_ID,
    ...defaultBillingRules(),
    maxFreeWorkspacesPerCard: limit,
  });
}

function owner(user: User): Seat {
  return { user, isTenantOwner: true };
}

function member(user: User): Seat {
  return { user, isTenantOwner: false };
}

beforeEach(async () => {
  await GetModel(BillingSettingsModel).table.delete().run();
  camille = await createUser({ name: "Camille Laurent" });
  ines = await createUser({ name: "Inès Roy" });
});

describe("free workspaces per card", () => {
  it("counts the live free workspaces a card backs, not paid or complimentary ones", async () => {
    const cardFingerprint = randomUUID();
    const acme = randomUUID();
    await subscribe(acme, { planId: FREE._id, cardFingerprint });
    await subscribe(randomUUID(), {
      planId: FREE._id,
      isComplimentary: true,
      cardFingerprint,
    });
    await subscribe(randomUUID(), { planId: PRO._id, cardFingerprint });

    await expect(
      listFreeWorkspacesBackedByCard(cardFingerprint),
    ).resolves.toEqual([acme]);
  });

  it("refuses the card once it backs as many free workspaces as allowed", async () => {
    const cardFingerprint = randomUUID();
    await subscribe(randomUUID(), { planId: FREE._id, cardFingerprint });

    await expect(
      assertCardMayBackFreeWorkspace(cardFingerprint, 1),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.workspace.free_card_limit_reached",
    });
    await expect(
      assertCardMayBackFreeWorkspace(cardFingerprint, 2),
    ).resolves.toBe(undefined);
  });

  it("asks a card of a free plan only while the rule is on", () => {
    expect(cardRequirementOf(FREE, 1)).toBe("verification");
    expect(cardRequirementOf(FREE, 0)).toBe("none");
    expect(cardRequirementOf(PRO, 0)).toBe("payment");
  });

  it("asks no card of a free plan while Stripe is not configured", () => {
    reinitSuiteStripe(stripe, PLACEHOLDER_SECRET_KEY);
    try {
      expect(cardRequirementOf(FREE, 1)).toBe("none");
      expect(cardRequirementOf(PRO, 1)).toBe("payment");
    } finally {
      reinitSuiteStripe(stripe, SUITE_STRIPE_KEYS.secretKey);
    }
  });
});

describe("workspace creation options", () => {
  it("offers the plans of the caller's audience, in catalogue order, with their card rule", async () => {
    await setMaxFreeWorkspacesPerCard(1);

    const options = await buildWorkspaceCreateOptions(camille, "en");

    expect(options.plans.map((option) => option._id)).toEqual(["free", "pro"]);
    expect(options.plans.map((option) => option.cardRequirement)).toEqual([
      "verification",
      "payment",
    ]);
    expect(options.plans[1]?.trialDays).toBe(14);
  });

  it("offers no trial to an e-mail that already used one", async () => {
    await GetModel(TrialConsumptionModel).insert({
      _id: randomUUID(),
      userId: camille._id,
      emailHash: hashEmail(camille.email),
      paymentFingerprint: null,
      planId: PRO._id,
    });

    const options = await buildWorkspaceCreateOptions(camille, "en");

    expect(options.plans.find((o) => o._id === PRO._id)?.trialDays).toBe(0);
  });

  it("names the caller's own free workspaces that already rest on a card", async () => {
    await setMaxFreeWorkspacesPerCard(1);
    await addWorkspace("acme", [owner(camille)], { cardFingerprint: "fp" });
    await addWorkspace("nocard", [owner(camille)], {});
    await addWorkspace("theirs", [member(camille)], {
      cardFingerprint: "fp2",
    });

    const options = await buildWorkspaceCreateOptions(camille, "en");

    expect(options.freePerCard).toEqual({ limit: 1, usedBy: ["acme"] });
  });

  it("leaves the rule off by default", async () => {
    const options = await buildWorkspaceCreateOptions(camille, "en");

    expect(options.freePerCard).toBeNull();
    expect(options.plans[0]?.cardRequirement).toBe("none");
  });

  it("drops the rule when the billing rules turn it off", async () => {
    await setMaxFreeWorkspacesPerCard(0);

    const options = await buildWorkspaceCreateOptions(camille, "en");

    expect(options.freePerCard).toBeNull();
    expect(options.plans[0]?.cardRequirement).toBe("none");
  });
});

describe("my workspaces", () => {
  it("lists the live workspaces, current first, with plan, state and owner", async () => {
    const zeta = await addWorkspace("Zeta", [owner(ines), member(camille)], {
      planId: PRO._id,
      status: "past_due",
      stripeSubscriptionId: "sub_1",
    });
    const acme = await addWorkspace("acme", [owner(camille)], {
      planId: FREE._id,
    });
    await addWorkspace("Gone", [owner(camille)], { status: "cancelled" });

    const rows = await listMyWorkspaces(camille._id, zeta);

    expect(rows.map((row) => row._id)).toEqual([zeta, acme]);
    expect(rows[0]).toMatchObject({
      planName: "Pro",
      status: "past_due",
      ownerName: "Inès Roy",
      isOwner: false,
      isCurrent: true,
      membersCount: 2,
    });
    expect(rows[1]).toMatchObject({ status: "free", isOwner: true });
  });

  it("keeps the cancelled workspace the caller is in", async () => {
    const acme = await addWorkspace("acme", [owner(camille)], {
      planId: FREE._id,
    });
    const gone = await addWorkspace("Gone", [owner(camille)], {
      status: "cancelled",
    });

    const rows = await listMyWorkspaces(camille._id, gone);

    expect(rows.map((row) => row._id)).toEqual([gone, acme]);
    expect(rows[0]).toMatchObject({ status: "cancelled", isCurrent: true });
  });
});

describe("workspace overview", () => {
  it("states the seats, the plan, the owners and what deleting does", async () => {
    const acme = await addWorkspace("acme", [owner(camille), member(ines)], {
      planId: PRO._id,
      status: "past_due",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: NOW,
    });
    const north = await addWorkspace("Northwind", [owner(camille)], {});
    const invoices = GetModel(InvoiceModel, acme);
    const invoice = (number: string, status: string) => ({
      _id: randomUUID(),
      documentType: "invoice" as const,
      stripeInvoiceId: randomUUID(),
      number,
      status,
      issuedAt: NOW,
    });
    await invoices.insert([invoice("INV-1", "paid"), invoice("INV-2", "open")]);
    await GetModel(UserInviteModel, acme).insert(
      ["lea", "paul"].map((name) => ({
        _id: randomUUID(),
        createdAt: NOW,
        email: `${name}@acme.test`,
        roles_ids: [],
        language: "en",
        token: randomUUID(),
        asTenantOwner: false,
        expiresAt: new Date(Date.now() + DAY_MS),
      })),
    );

    const overview = await buildWorkspaceOverview(acme, camille._id, NOW);

    expect(overview.seats).toEqual({
      members: 2,
      pendingInvites: 2,
      occupied: 4,
      maxMembers: 5,
    });
    expect(overview.plan).toMatchObject({ name: "Pro", status: "past_due" });
    expect(overview.owners).toEqual([
      {
        userId: camille._id,
        name: "Camille Laurent",
        email: camille.email,
        isCaller: true,
      },
    ]);
    expect(overview.invoicesCount).toBe(2);
    expect(overview.unpaidInvoiceNumber).toBe("INV-2");
    expect(overview.destroyedAt).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
    expect(overview.nextWorkspace).toEqual({ _id: north, name: "Northwind" });
  });

  it("reads unlimited seats as no ceiling", async () => {
    const acme = await addWorkspace("acme", [owner(camille)], {
      planId: FREE._id,
    });

    const overview = await buildWorkspaceOverview(acme, camille._id, NOW);

    expect(overview.seats.maxMembers).toBeNull();
    expect(overview.nextWorkspace).toBeNull();
  });

  it("refuses an unknown workspace", async () => {
    await expect(
      buildWorkspaceOverview("missing", camille._id, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });
});
