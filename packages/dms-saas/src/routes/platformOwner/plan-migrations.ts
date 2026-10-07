import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import type { NavCardItem } from "@antelopejs/interface-dms/base";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  type PlanMigration,
  PlanMigrationModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../../db";
import {
  type MigrationAbilities,
  type MigrationTotals,
  type MigrationWorkspaceView,
  migrationAbilities,
  migrationTotals,
  migrationWorkspaces,
} from "../../plans/migration-detail";
import { getStripeClient, isStripeConfigured } from "../../stripe/client";
import {
  type UncertainResolution,
  reconcileMigration,
  resolveUncertainWorkspace,
  retryFailedPlanMigrationWorkspaces,
} from "../../workers";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const NOTE_MAX_LENGTH = 500;
const NOTE_FIELD = "note";
const NOTE_REQUIRED = "$saas.errors.migration.note_required";
const RESOLUTIONS = new Set<UncertainResolution>(["moved", "not_moved"]);
const MIGRATIONS_PAGE = "/modules/saas/catalog/plan-migrations";
const TEXTS = "$saas.catalog.migrations";

/** A plan a migration moves from or to. */
interface MigrationPlanRef {
  _id: string;
  name: string;
}

/** Everything the migration detail shows. */
interface MigrationDetail {
  _id: string;
  status: PlanMigration["status"];
  reason: string | null;
  from: MigrationPlanRef;
  to: MigrationPlanRef;
  createdAt: Date;
  completedAt: Date | null;
  startedBy: string;
  notifyMembers: boolean;
  totals: MigrationTotals;
  abilities: MigrationAbilities;
  permissions: { added: string[]; removed: string[] };
  reconciliation: {
    at: Date;
    by: string;
    note: string;
  } | null;
  workspaces: MigrationWorkspaceView[];
}

/** Which plan Stripe bills a workspace on, next to the DMS's. */
interface StripeReading {
  stripeSubscriptionId: string | null;
  stripePlan: "source" | "target" | "other" | "none" | "unavailable";
  stripePlanName: string | null;
  dmsPlanName: string | null;
}

interface ResolveBody {
  resolution?: string;
}

interface ReconcileBody {
  note?: string;
}

async function userName(userId: string | null | undefined): Promise<string> {
  if (!userId) return "";
  const user = await GetModel(UserModel).get(userId);
  return user?.name || user?.email || userId;
}

async function planRef(
  planId: string,
  stored: string | null | undefined,
): Promise<MigrationPlanRef> {
  if (stored) return { _id: planId, name: stored };
  const plan = await GetModel(PlanModel).get(planId);
  return { _id: planId, name: plan?.name ?? planId };
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

async function reconciliationOf(
  migration: PlanMigration,
): Promise<MigrationDetail["reconciliation"]> {
  if (!migration.reconciledAt) return null;
  return {
    at: migration.reconciledAt,
    by: await userName(migration.reconciledBy),
    note: migration.reconciliationNote ?? "",
  };
}

function capturedTenantIds(migration: PlanMigration): string[] {
  return (
    migration.snapshot?.tenantIds ??
    (migration.tenantOutcomes ?? []).map((row) => row.tenantId)
  );
}

async function describeMigration(
  migration: PlanMigration,
): Promise<MigrationDetail> {
  const totals = migrationTotals(migration);
  const [from, to, startedBy, names, reconciliation] = await Promise.all([
    planRef(migration.fromPlanId, migration.fromPlanName),
    planRef(migration.toPlanId, migration.toPlanName),
    userName(migration.initiatedBy),
    workspaceNames(capturedTenantIds(migration)),
    reconciliationOf(migration),
  ]);
  return {
    _id: migration._id,
    status: migration.status,
    reason: migration.reason ?? null,
    from,
    to,
    createdAt: migration.createdAt,
    completedAt: migration.completedAt ?? null,
    startedBy,
    notifyMembers: migration.notifyMembers,
    totals,
    abilities: migrationAbilities(migration, totals),
    permissions: {
      added: migration.permissionDiff?.added ?? [],
      removed: migration.permissionDiff?.removed ?? [],
    },
    reconciliation,
    workspaces: migrationWorkspaces(migration, names),
  };
}

async function planByStripePrice(
  priceId: string,
): Promise<MigrationPlanRef | null> {
  const plans = await GetModel(PlanModel).findNotDeleted();
  const plan = plans.find(
    (row) => row.paymentProviderRefs?.stripePriceId === priceId,
  );
  return plan ? { _id: plan._id, name: plan.name } : null;
}

function stripeSide(
  migration: PlanMigration,
  plan: MigrationPlanRef | null,
): StripeReading["stripePlan"] {
  if (!plan) return "other";
  if (plan._id === migration.toPlanId) return "target";
  if (plan._id === migration.fromPlanId) return "source";
  return "other";
}

/** Settles, retries and closes plan migrations; reads one in full. */
export class SaasPlanMigrationsController extends Controller(
  "/api/saas/plan-migrations",
) {
  @Model(PlanMigrationModel)
  declare planMigrationModel: PlanMigrationModel;

  private async load(id: string): Promise<PlanMigration> {
    const migration = await this.planMigrationModel.get(id);
    assert(migration, HTTP_NOT_FOUND, "saas.errors.migration.not_found");
    return migration;
  }

  /** One card per migration waiting for an operator, for the list's head. */
  @Get("/attention")
  async attention(
    @AuthOwnerOnly() _user: User,
  ): Promise<{ items: NavCardItem[] }> {
    const rows = await this.planMigrationModel.table
      .getAll("needs_attention", "stage")
      .run();
    const migrations = rows
      .map((row) => PlanMigrationModel.fromDatabase(row))
      .filter((row): row is PlanMigration => row !== undefined);
    const items = await Promise.all(migrations.map(attentionCard));
    return { items };
  }

  @Get("/:id")
  async detail(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<MigrationDetail> {
    return describeMigration(await this.load(id));
  }

  /** What Stripe bills an uncertain workspace on, to settle it by hand. */
  @Get("/:id/workspaces/:tenantId/stripe")
  async stripeReading(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Parameter("tenantId") tenantId: string,
  ): Promise<StripeReading> {
    const migration = await this.load(id);
    const subscription = await GetModel(
      TenantSubscriptionModel,
      tenantId,
    ).findOne();
    const dmsPlan = subscription?.planId
      ? await planRef(subscription.planId, null)
      : null;
    const reading: StripeReading = {
      stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
      stripePlan: "none",
      stripePlanName: null,
      dmsPlanName: dmsPlan?.name ?? null,
    };
    if (!reading.stripeSubscriptionId) return reading;
    return readStripePlan(migration, reading);
  }

  @Post("/:id/workspaces/:tenantId/resolve")
  async resolve(
    @AuthOwnerOnly() user: User,
    @Parameter("id") id: string,
    @Parameter("tenantId") tenantId: string,
    @JSONBody() body: ResolveBody,
  ): Promise<{ _id: string }> {
    const resolution = body.resolution as UncertainResolution;
    assert(
      RESOLUTIONS.has(resolution),
      HTTP_BAD_REQUEST,
      "saas.errors.migration.invalid_resolution",
    );
    await resolveUncertainWorkspace({
      migrationId: id,
      tenantId,
      resolution,
      operatorId: user._id,
    });
    return { _id: id };
  }

  /** Moves again the workspaces known not to have moved. */
  @Post("/:id/retry")
  async retry(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<{ _id: string }> {
    const migration = await this.load(id);
    const abilities = migrationAbilities(migration, migrationTotals(migration));
    assert(
      abilities.canRetry,
      HTTP_CONFLICT,
      "saas.errors.migration.nothing_to_retry",
    );
    void retryFailedPlanMigrationWorkspaces(id).catch(() => {
      console.error("Plan migration retry requires inspection", id);
    });
    return { _id: id };
  }

  /** Closes a migration, its remaining workspaces kept on the source plan. */
  @Post("/:id/reconcile")
  async reconcile(
    @AuthOwnerOnly() user: User,
    @Parameter("id") id: string,
    @JSONBody() body: ReconcileBody,
  ): Promise<{ _id: string }> {
    const note = (body.note ?? "").trim();
    if (!note || note.length > NOTE_MAX_LENGTH) {
      throw new HTTPResult(HTTP_BAD_REQUEST, {
        message: NOTE_REQUIRED,
        field: NOTE_FIELD,
      });
    }
    await reconcileMigration({ migrationId: id, operatorId: user._id, note });
    return { _id: id };
  }
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

async function attentionCard(migration: PlanMigration): Promise<NavCardItem> {
  const [from, to] = await Promise.all([
    planRef(migration.fromPlanId, migration.fromPlanName),
    planRef(migration.toPlanId, migration.toPlanName),
  ]);
  const totals = migrationTotals(migration);
  return {
    id: migration._id,
    title: `${from.name} → ${to.name}`,
    description:
      totals.uncertain > 0
        ? `${TEXTS}.attention.uncertain`
        : `${TEXTS}.attention.failed`,
    icon: "i-ph-warning-circle",
    iconTone: totals.uncertain > 0 ? "error" : "warning",
    to: `${MIGRATIONS_PAGE}/${migration._id}`,
    state: `${totals.notMoved} / ${totals.captured}`,
    stateTone: totals.uncertain > 0 ? "error" : "warning",
  };
}
