import {
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import {
  GetPermissions,
  type PermissionTree,
} from "@antelopejs/interface-dms/permissions";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { StatGroupItem } from "@antelopejs/interface-dms/base";
import type { Plan } from "../../db";
import {
  FeatureModel,
  PLAN_INTERVALS,
  PlanModel,
  TenantSubscriptionModel,
} from "../../db";
import { localizeFeature } from "../../plans";
import {
  catalogueStatItems,
  summariseCatalogue,
} from "../../plans/catalogue-summary";
import { loadCatalogueUsage } from "../../plans/catalogue-usage";
import {
  type PlanWriteBody,
  invalidFeatureValues,
  isValidMemberCap,
  pickPlanWrite,
  slugify,
  toInheritance,
} from "../../plans/plan-write";
import {
  type PlanStripeSyncState,
  archivePlanStripeProduct,
  planStripeSyncState,
  syncPlanStripeRefs,
} from "../../plans/stripe-sync";
import { stripeDashboardUrl } from "../../stripe/client";
import {
  CONTENT_LANGUAGE_HEADER,
  requestLocale,
} from "../../utils/content-language";

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;
const DEFAULT_MAX_MEMBERS = -1;
const VALID_PLAN_INTERVALS = new Set<string>(PLAN_INTERVALS);
const STRIPE_SYNC_FIELDS = [
  "name",
  "description",
  "price",
  "currency",
  "interval",
  "billingMode",
] as const satisfies readonly (keyof Plan)[];
const PRICE_TERMS_FIELDS = [
  "price",
  "currency",
  "interval",
  "billingMode",
] as const satisfies readonly (keyof Plan)[];
const PRICE_CHANGED_NOTICE = "$saas.catalog.editor.notice.price_changed";
const INVALID_FEATURES_MESSAGE = "$saas.errors.plan.invalid_feature_value";
const INVALID_MEMBER_CAP_MESSAGE = "$saas.errors.plan.invalid_member_cap";
const INHERITANCE_FIELD = "inheritance";
const MAX_MEMBERS_FIELD = "maxMembers";

function isPlanInterval(value: unknown): value is Plan["interval"] {
  return typeof value === "string" && VALID_PLAN_INTERVALS.has(value);
}

function assertPlanInterval(value: unknown): asserts value is Plan["interval"] {
  assert(
    isPlanInterval(value),
    HTTP_BAD_REQUEST,
    "saas.errors.plan.invalid_interval",
  );
}

function hasStripeSyncChanges(plan: Partial<Plan>): boolean {
  return STRIPE_SYNC_FIELDS.some((field) => plan[field] !== undefined);
}

function changesPriceTerms(current: Plan, write: Partial<Plan>): boolean {
  return PRICE_TERMS_FIELDS.some(
    (field) => write[field] !== undefined && write[field] !== current[field],
  );
}

/** A refusal the plan editor shows under the field it names. */
function fieldRefusal(field: string, message: string): HTTPResult {
  return new HTTPResult(HTTP_BAD_REQUEST, { message, field });
}

type PlanWithWorkspaceCount = Plan & { workspaceCount: number };

/** The figures above the catalogue, as its `StatGroup` reads them. */
interface CatalogueStats {
  items: StatGroupItem[];
}

interface PublicPlan {
  _id: string;
  name: string;
  slug: string;
  description: string;
  audience: Plan["audience"];
  price: number;
  currency: string;
  interval: Plan["interval"];
  billingMode: Plan["billingMode"];
  features: Plan["features"];
  trialDays: number;
  borderColor: string | null;
  borderLabel: string | null;
  order: number;
}

function toPublicPlan(plan: Plan): PublicPlan {
  return {
    _id: plan._id,
    name: plan.name,
    slug: plan.slug,
    description: plan.description,
    audience: plan.audience,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    billingMode: plan.billingMode,
    features: plan.features,
    trialDays: plan.trialDays,
    borderColor: plan.borderColor,
    borderLabel: plan.borderLabel,
    order: plan.order,
  };
}

/** A plan the editor can build on, with its own and its resolved access. */
interface PlanInheritanceOption {
  _id: string;
  name: string;
  inheritsFromPlanId: string | null;
  permissions: string[];
  features: Plan["features"];
}

/** A feature of the catalogue, as the plan editor and the cards show it. */
interface PlanFeatureCatalogItem {
  _id: string;
  displayName: string;
  description: string;
  tooltip: string | null;
  valueType: string;
  unit: string | null;
  isDetailRow: boolean;
  order: number;
}

interface PlanEditCatalog {
  plans: PlanInheritanceOption[];
  features: PlanFeatureCatalogItem[];
}

/** One node of the permission tree the plan editor offers. */
interface PlanPermissionNode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  children?: PlanPermissionNode[];
}

interface PlanReorderItem {
  id: string;
  order: number;
}

interface PlanReorderBody {
  items?: PlanReorderItem[];
}

interface PlanReorderResult {
  updated: number;
}

/** A plan write the editor made, and what the operator should know of it. */
interface PlanWriteResult {
  _id: string;
  notice?: { title: string; description?: string; color?: string };
}

/** What the editor shows beside the form: usage and Stripe state. */
interface PlanEditorContext {
  workspaceCount: number;
  trialingCount: number;
  mrr: number;
  stripeProductId: string | null;
  stripeProductUrl: string | null;
  stripePriceId: string | null;
  syncedPrice: number | null;
  syncedCurrency: string | null;
  syncedInterval: string | null;
  syncState: PlanStripeSyncState;
  updatedAt: Date | null;
}

function mapPermissionTreeToNodes(
  tree: Record<string, PermissionTree>,
): PlanPermissionNode[] {
  return Object.values(tree)
    .filter((node) => node.data && !node.data.defaultGranted)
    .map((node) => ({
      id: node.data?.id ?? "",
      label: node.data?.title ?? node.data?.id ?? "",
      description: node.data?.description,
      icon: node.data?.icon,
      children:
        Object.keys(node.children).length > 0
          ? mapPermissionTreeToNodes(node.children)
          : undefined,
    }));
}

function toCatalogFeature(
  feature: ReturnType<typeof localizeFeature>,
): PlanFeatureCatalogItem {
  return {
    _id: feature._id,
    displayName: feature.displayName,
    description: feature.description ?? "",
    tooltip: feature.tooltip ?? null,
    valueType: feature.valueType,
    unit: feature.unit ?? null,
    isDetailRow: !!feature.isDetailRow,
    order: feature.order ?? 0,
  };
}

async function ensureInheritanceIsAcyclic(
  planModel: PlanModel,
  planId: string | null | undefined,
  parentPlanId: string | null | undefined,
): Promise<void> {
  if (!parentPlanId) return;
  const parent = await planModel.get(parentPlanId);
  assert(
    parent,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.inheritance_parent_missing",
  );
  if (!planId) return;
  const chain = await planModel.resolveInheritanceChain(parent);
  const formsCycle = chain.some((link) => link._id === planId);
  assert(!formsCycle, HTTP_BAD_REQUEST, "saas.errors.plan.inheritance_cycle");
}

function priceChangeNotice(
  current: Plan,
  write: Partial<Plan>,
): PlanWriteResult["notice"] {
  if (!changesPriceTerms(current, write)) return undefined;
  if (!current.paymentProviderRefs?.stripePriceId) return undefined;
  return {
    title: PRICE_CHANGED_NOTICE,
    description: `${PRICE_CHANGED_NOTICE}_description`,
    color: "info",
  };
}

/** A plan's fields as a new plan starts from them, without its identity. */
function toDuplicateDraft(plan: Plan): Partial<Plan> & PlanWriteBody {
  return {
    name: plan.name,
    description: plan.description,
    audience: plan.audience,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    billingMode: plan.billingMode,
    trialDays: plan.trialDays,
    maxMembers: plan.maxMembers,
    isPublic: plan.isPublic,
    isActive: plan.isActive,
    borderColor: plan.borderColor,
    borderLabel: plan.borderLabel,
    inheritance: toInheritance(plan),
  };
}

export class SaasPlansApiController extends Controller("/api/saas/plans") {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(FeatureModel)
  declare featureModel: FeatureModel;

  @Model(TenantSubscriptionModel, CROSS_INSTANCE)
  declare tenantSubscriptionModel: TenantSubscriptionModel;

  @Get("/public")
  async listPublic(): Promise<PublicPlan[]> {
    const plans = await this.planModel.findPubliclyVisible();
    return plans.map(toPublicPlan);
  }

  @Post("/reorder")
  async reorder(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: PlanReorderBody,
  ): Promise<PlanReorderResult> {
    const items = (body.items ?? []).filter(
      (item) => typeof item.id === "string" && Number.isFinite(item.order),
    );
    const now = new Date();
    const results = await Promise.all(
      items.map((item) =>
        this.planModel.update(item.id, { order: item.order, updatedAt: now }),
      ),
    );
    return { updated: results.length };
  }

  @Get("/")
  async list(@AuthOwnerOnly() _user: User): Promise<PlanWithWorkspaceCount[]> {
    const plans = await this.planModel.findNotDeleted();
    const counts = await Promise.all(
      plans.map((plan) => this.tenantSubscriptionModel.countByPlan(plan._id)),
    );
    return plans.map((plan, index) => ({
      // The spread row is an AntelopeJS table class: `Table` declares one
      // field and a static, no instance methods, and the value is
      // serialised to JSON on the way out. No prototype to lose.
      // oxlint-disable-next-line typescript/no-misused-spread
      ...plan,
      workspaceCount: counts[index],
    }));
  }

  /** The figures above the catalogue: plans on sale, workspaces, MRR, legacy. */
  @Get("/summary")
  async summary(@AuthOwnerOnly() _user: User): Promise<CatalogueStats> {
    const [plans, usage] = await Promise.all([
      this.planModel.findNotDeleted(),
      loadCatalogueUsage(),
    ]);
    return { items: catalogueStatItems(summariseCatalogue(plans, usage)) };
  }

  /** Plans to build on and features to set, for the plan editor and cards. */
  @Get("/catalog")
  async editCatalog(
    @AuthOwnerOnly() _user: User,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<PlanEditCatalog> {
    const locale = requestLocale(language);
    const [plans, features] = await Promise.all([
      this.planModel.findNotDeleted(),
      this.featureModel.getAll(),
    ]);
    const resolvedPlans = await Promise.all(
      plans.map(async (plan) => {
        const resolved = await this.planModel.resolveInheritance(plan);
        return {
          _id: plan._id,
          name: plan.name,
          inheritsFromPlanId: plan.inheritsFromPlanId ?? null,
          permissions: resolved.permissions,
          features: resolved.features,
        };
      }),
    );
    return {
      plans: resolvedPlans,
      features: features
        .map((feature) => toCatalogFeature(localizeFeature(feature, locale)))
        .sort((left, right) => left.order - right.order),
    };
  }

  /** Permission tree the plan editor's picker offers, grouped by page. */
  @Get("/permissions-tree")
  async permissionsTree(
    @AuthOwnerOnly() _user: User,
  ): Promise<PlanPermissionNode[]> {
    return mapPermissionTreeToNodes(await GetPermissions());
  }

  /** A plan's values for a new plan duplicating it (the new form loads it). */
  @Get("/:id/duplicate")
  async duplicate(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<Partial<Plan> & PlanWriteBody> {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_found");
    return toDuplicateDraft(plan);
  }

  /** Usage and Stripe state shown beside the plan editor. */
  @Get("/:id/editor-context")
  async editorContext(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<PlanEditorContext> {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_found");
    const usage = (await loadCatalogueUsage()).byPlan.get(id);
    const refs = plan.paymentProviderRefs ?? {};
    const synced = refs.stripeSyncedTerms?.price;
    const syncState = await planStripeSyncState(plan);
    return {
      workspaceCount: usage?.workspaces ?? 0,
      trialingCount: usage?.trialing ?? 0,
      mrr: usage?.mrr ?? 0,
      stripeProductId: refs.stripeProductId ?? null,
      stripeProductUrl: refs.stripeProductId
        ? stripeDashboardUrl(`products/${refs.stripeProductId}`)
        : null,
      stripePriceId: refs.stripePriceId ?? null,
      syncedPrice: synced ? synced.unitAmount : null,
      syncedCurrency: synced ? synced.currency : null,
      syncedInterval: synced ? synced.interval : null,
      syncState,
      updatedAt: plan.updatedAt ?? null,
    };
  }

  @Get("/:id")
  async getOne(@AuthOwnerOnly() _user: User, @Parameter("id") id: string) {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_found");
    // The spread row is an AntelopeJS table class: `Table` declares one
    // field and a static, no instance methods, and the value is
    // serialised to JSON on the way out. No prototype to lose.
    // oxlint-disable-next-line typescript/no-misused-spread
    return { ...plan, inheritance: toInheritance(plan) };
  }

  private async assertValidAccess(write: Partial<Plan>): Promise<void> {
    if (write.maxMembers !== undefined && !isValidMemberCap(write.maxMembers)) {
      throw fieldRefusal(MAX_MEMBERS_FIELD, INVALID_MEMBER_CAP_MESSAGE);
    }
    if (!write.features) return;
    const invalid = invalidFeatureValues(
      write.features,
      await this.featureModel.getAll(),
    );
    if (invalid.length > 0) {
      throw fieldRefusal(INHERITANCE_FIELD, INVALID_FEATURES_MESSAGE);
    }
  }

  @Post("/")
  async create(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: PlanWriteBody,
  ): Promise<PlanWriteResult> {
    const sanitized = pickPlanWrite(body);
    assertPlanInterval(sanitized.interval);
    await this.assertValidAccess(sanitized);
    if (!sanitized.slug && sanitized.name) {
      sanitized.slug = slugify(sanitized.name);
    }
    await ensureInheritanceIsAcyclic(
      this.planModel,
      null,
      sanitized.inheritsFromPlanId,
    );
    const inserted = await this.planModel.insert([
      {
        ...sanitized,
        isActive: sanitized.isActive ?? true,
        isDeleted: false,
        isPublic: sanitized.isPublic ?? true,
        maxMembers: sanitized.maxMembers ?? DEFAULT_MAX_MEMBERS,
        order: sanitized.order ?? (await this.nextOrder()),
        paymentProviderRefs: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const planId = inserted[0];
    const created = await this.planModel.get(planId);
    assert(created, HTTP_INTERNAL_ERROR, "saas.errors.plan.creation_failed");
    await syncPlanStripeRefs(created, this.planModel);
    return { _id: planId };
  }

  private async nextOrder(): Promise<number> {
    const plans = await this.planModel.findNotDeleted();
    return plans.reduce(
      (highest, plan) => Math.max(highest, plan.order + 1),
      0,
    );
  }

  @Put("/:id")
  async update(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @JSONBody() body: PlanWriteBody,
  ): Promise<PlanWriteResult> {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_found");
    const sanitized = pickPlanWrite(body);
    await this.assertValidAccess(sanitized);
    if (sanitized.inheritsFromPlanId !== undefined) {
      await ensureInheritanceIsAcyclic(
        this.planModel,
        id,
        sanitized.inheritsFromPlanId,
      );
    }
    if (hasStripeSyncChanges(sanitized)) {
      assertPlanInterval(sanitized.interval ?? plan.interval);
    }
    await this.planModel.update(id, { ...sanitized, updatedAt: new Date() });
    const updated = await this.planModel.get(id);
    if (updated) await syncPlanStripeRefs(updated, this.planModel);
    return { _id: id, notice: priceChangeNotice(plan, sanitized) };
  }

  @Delete("/:id")
  async remove(@AuthOwnerOnly() _user: User, @Parameter("id") id: string) {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_found");
    const workspaceCount = await this.tenantSubscriptionModel.countByPlan(id);
    assert(
      workspaceCount === 0,
      HTTP_CONFLICT,
      "saas.errors.plan.has_workspaces",
    );
    // Stripe first: a failure there leaves the plan as it was.
    await archivePlanStripeProduct(plan);
    await this.planModel.update(id, {
      isDeleted: true,
      isActive: false,
      updatedAt: new Date(),
    });
    return { _id: id };
  }
}
