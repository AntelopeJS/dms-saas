import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  FeatureModel,
  type PlanMigration,
  PlanModel,
  TenantSubscriptionModel,
} from "../../db";
import { localizeFeature } from "../../plans";
import type { FeatureNames } from "../../plans/migration-blocks";
import {
  type MigrationDetailContext,
  type MigrationPlanRef,
  type MigrationWorkspaceView,
  migrationAbilities,
  migrationTotals,
  migrationWorkspaces,
} from "../../plans/migration-detail";
import {
  type MigrationWorkspaceRow,
  type StripeReading,
  type StripeSide,
  type WorkspaceSubscriptionRef,
  migrationWorkspaceRows,
} from "../../plans/migration-workspaces";
import { getStripeClient, isStripeConfigured } from "../../stripe/client";
import { stripeObjectUrl } from "../../stripe/dashboard-links";

const HTTP_CONFLICT = 409;

/** A plan as a migration names it, priced while the plan still exists. */
async function planRef(
  planId: string,
  name: string,
): Promise<MigrationPlanRef> {
  const plan = await GetModel(PlanModel).get(planId);
  return {
    _id: planId,
    name,
    price: plan?.price ?? null,
    currency: plan?.currency ?? null,
  };
}

async function workspaceNames(
  tenantIds: string[],
): Promise<Map<string, string>> {
  const tenants = await Promise.all(
    tenantIds.map((id) => GetModel(TenantModel).get(id)),
  );
  return new Map(
    tenantIds.map((id, index) => [id, tenants[index]?.name ?? id]),
  );
}

function capturedTenantIds(migration: PlanMigration): string[] {
  return (
    migration.snapshot?.tenantIds ??
    migration.tenantOutcomes.map((row) => row.tenantId)
  );
}

function mentionedPeople(migration: PlanMigration): string[] {
  const ids = [
    migration.initiatedBy,
    migration.reconciledBy,
    ...migration.tenantOutcomes.map((row) => row.resolvedBy),
  ];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

async function peopleNames(userIds: string[]): Promise<Map<string, string>> {
  const users = await Promise.all(
    userIds.map((id) => GetModel(UserModel).get(id)),
  );
  return new Map(
    userIds.map((id, index) => [
      id,
      users[index]?.name || users[index]?.email || id,
    ]),
  );
}

/**
 * A migration with everything its detail blocks name: its plans, the names
 * of its workspaces and of the operators it mentions, its counts and what it
 * allows.
 *
 * @param migration The migration
 */
export async function loadMigrationContext(
  migration: PlanMigration,
): Promise<MigrationDetailContext> {
  const totals = migrationTotals(migration);
  const [from, to, names, people] = await Promise.all([
    planRef(migration.fromPlanId, migration.fromPlanName),
    planRef(migration.toPlanId, migration.toPlanName),
    workspaceNames(capturedTenantIds(migration)),
    peopleNames(mentionedPeople(migration)),
  ]);
  return {
    migration,
    from,
    to,
    totals,
    abilities: migrationAbilities(migration, totals),
    workspaces: migrationWorkspaces(migration, names),
    people,
  };
}

async function subscriptionRef(
  tenantId: string,
): Promise<WorkspaceSubscriptionRef | null> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  const id = subscription?.stripeSubscriptionId;
  return id ? { id, url: stripeObjectUrl("subscriptions", id) } : null;
}

/** The workspace table's rows, each with its Stripe subscription. */
export async function loadWorkspaceRows(
  context: MigrationDetailContext,
): Promise<MigrationWorkspaceRow[]> {
  const refs = await Promise.all(
    context.workspaces.map((view) => subscriptionRef(view.tenantId)),
  );
  const subscriptions = new Map<string, WorkspaceSubscriptionRef>();
  context.workspaces.forEach((view, index) => {
    const ref = refs[index];
    if (ref) subscriptions.set(view.tenantId, ref);
  });
  return migrationWorkspaceRows(context, subscriptions);
}

/** Every feature's name in `locale`, by key. */
export async function loadFeatureNames(locale: string): Promise<FeatureNames> {
  const features = await GetModel(FeatureModel).getAll();
  return new Map(
    features.map((feature) => [
      feature._id,
      localizeFeature(feature, locale).displayName,
    ]),
  );
}

/**
 * The uncertain workspace an operator is about to settle; a workspace that
 * is not (any more) uncertain cannot be settled by hand.
 */
export function uncertainView(
  context: MigrationDetailContext,
  tenantId: string,
): MigrationWorkspaceView {
  const view = context.workspaces.find((row) => row.tenantId === tenantId);
  assert(
    view?.isUncertain && context.abilities.canResolve,
    HTTP_CONFLICT,
    "saas.errors.migration.workspace_not_uncertain",
  );
  return view!;
}

async function planByStripePrice(
  priceId: string,
): Promise<MigrationPlanRef | null> {
  const plans = await GetModel(PlanModel).findNotDeleted();
  const plan = plans.find(
    (row) => row.paymentProviderRefs?.stripePriceId === priceId,
  );
  return plan ? planRef(plan._id, plan.name) : null;
}

function stripeSide(
  migration: PlanMigration,
  plan: MigrationPlanRef | null,
): StripeSide {
  if (!plan) return "other";
  if (plan._id === migration.toPlanId) return "target";
  if (plan._id === migration.fromPlanId) return "source";
  return "other";
}

async function readStripePlan(
  migration: PlanMigration,
  reading: StripeReading,
): Promise<StripeReading> {
  if (!isStripeConfigured() || !reading.stripeSubscriptionId) {
    return { ...reading, stripePlan: "unavailable" };
  }
  try {
    const subscription = await getStripeClient().subscriptions.retrieve(
      reading.stripeSubscriptionId,
    );
    const priceId = subscription.items.data[0]?.price.id;
    const plan = priceId ? await planByStripePrice(priceId) : null;
    return {
      ...reading,
      stripePlan: stripeSide(migration, plan),
      stripePlanName: plan?.name ?? null,
    };
  } catch {
    return { ...reading, stripePlan: "unavailable" };
  }
}

/**
 * Which plan Stripe bills a workspace on right now, next to the one the DMS
 * holds, to settle an uncertain move on a reading rather than a guess.
 *
 * @param migration The migration
 * @param tenantId The workspace
 */
export async function readStripe(
  migration: PlanMigration,
  tenantId: string,
): Promise<StripeReading> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  const dmsPlan = subscription?.planId
    ? await GetModel(PlanModel).get(subscription.planId)
    : undefined;
  const subscriptionId = subscription?.stripeSubscriptionId ?? null;
  const reading: StripeReading = {
    stripeSubscriptionId: subscriptionId,
    stripeUrl: subscriptionId
      ? stripeObjectUrl("subscriptions", subscriptionId)
      : null,
    stripePlan: "none",
    stripePlanName: null,
    dmsPlanName: dmsPlan?.name ?? null,
  };
  if (!subscriptionId) return reading;
  return readStripePlan(migration, reading);
}
