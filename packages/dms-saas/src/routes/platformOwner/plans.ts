import {
  Controller,
  Delete,
  Get,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import {
  GetPermissions,
  type PermissionTree,
} from "@antelopejs/interface-dms/permissions";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { FormComponents } from "@antelopejs/interface-dms/base/form-schema";
import type { Plan } from "../../db";
import {
  FeatureModel,
  PLAN_INTERVALS,
  PlanModel,
  TenantSubscriptionModel,
} from "../../db";
import { isStripeConfigured, syncPlanWithStripe } from "../../stripe";

const STRIPE_SKIP_WARNING =
  "[dms-saas:plans] Stripe not configured (placeholder key) — skipping plan sync";

async function syncPlanIfConfigured(plan: Plan): Promise<Plan> {
  if (isStripeConfigured()) return syncPlanWithStripe(plan);
  Logging.Warn(STRIPE_SKIP_WARNING);
  return plan;
}

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;
const VALID_PLAN_INTERVALS = new Set<string>(PLAN_INTERVALS);
const STRIPE_SYNC_FIELDS = [
  "name",
  "description",
  "price",
  "currency",
  "interval",
  "billingMode",
] as const satisfies readonly (keyof Plan)[];

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

interface PlanInheritanceInput {
  parentPlanId: string | null;
  extraPermissions: string[];
  extraFeatures: Record<string, boolean | number>;
}

const WRITE_FIELDS = [
  "name",
  "slug",
  "description",
  "audience",
  "price",
  "currency",
  "interval",
  "billingMode",
  "features",
  "permissions",
  "inheritsFromPlanId",
  "trialDays",
  "maxMembers",
  "isPublic",
  "borderColor",
  "borderLabel",
  "order",
  "isActive",
] as const satisfies readonly (keyof Plan)[];

type PlanWriteBody = Partial<Pick<Plan, (typeof WRITE_FIELDS)[number]>> & {
  inheritance?: PlanInheritanceInput | string;
};

type PlanWithWorkspaceCount = Plan & { workspaceCount: number };

function parseInheritance(
  raw: PlanInheritanceInput | string,
): PlanInheritanceInput | null {
  if (typeof raw === "string") {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PlanInheritanceInput;
    } catch {
      return null;
    }
  }
  return raw;
}

function expandInheritance(body: PlanWriteBody): PlanWriteBody {
  if (body.inheritance === undefined) return body;
  const parsed = parseInheritance(body.inheritance);
  if (!parsed) {
    const rest = { ...body };
    delete rest.inheritance;
    return rest;
  }
  const { parentPlanId, extraPermissions, extraFeatures } = parsed;
  return {
    ...body,
    inheritsFromPlanId: parentPlanId ?? null,
    permissions: extraPermissions ?? [],
    features: Object.entries(extraFeatures ?? {}).map(([featureId, value]) => ({
      featureId,
      value,
    })),
  };
}

function toInheritance(plan: Plan): PlanInheritanceInput {
  const extraFeatures: Record<string, boolean | number> = {};
  for (const feature of plan.features ?? []) {
    extraFeatures[feature.featureId] = feature.value as boolean | number;
  }
  return {
    parentPlanId: plan.inheritsFromPlanId ?? null,
    extraPermissions: plan.permissions ?? [],
    extraFeatures,
  };
}

function pickPlanWrite(body: PlanWriteBody): Partial<Plan> {
  const expanded = expandInheritance(body);
  const out: Partial<Plan> = {};
  for (const field of WRITE_FIELDS) {
    if (expanded[field] !== undefined) {
      Object.assign(out, { [field]: expanded[field] });
    }
  }
  return out;
}

const SLUG_MAX_LENGTH = 100;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
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

type PlanInheritanceOption = Pick<
  Plan,
  "_id" | "name" | "permissions" | "features"
>;

interface PlanFeatureCatalogItem {
  _id: string;
  displayName: string;
  valueType: string;
}

interface PlanEditCatalog {
  plans: PlanInheritanceOption[];
  features: PlanFeatureCatalogItem[];
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

function mapPermissionTreeToNodes(
  tree: Record<string, PermissionTree>,
): FormComponents.PermissionsTreeNode[] {
  return Object.values(tree)
    .filter((node) => node.data && !node.data.defaultGranted)
    .map((node) => ({
      id: node.data?.id ?? "",
      label: node.data?.title ?? node.data?.id ?? "",
      icon: node.data?.icon,
      children:
        Object.keys(node.children).length > 0
          ? mapPermissionTreeToNodes(node.children)
          : undefined,
    }));
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
    const items = body.items ?? [];
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

  /** Catalog consumed by the inheritance picker: selectable parents + features. */
  @Get("/catalog")
  async editCatalog(@AuthOwnerOnly() _user: User): Promise<PlanEditCatalog> {
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
          permissions: resolved.permissions,
          features: resolved.features,
        };
      }),
    );
    return {
      plans: resolvedPlans,
      features: features.map((feature) => ({
        _id: feature._id,
        displayName: feature.displayName,
        valueType: feature.valueType,
      })),
    };
  }

  /** Permission tree consumed by the inheritance picker (mirrors roles page). */
  @Get("/permissions-tree")
  async permissionsTree(
    @AuthOwnerOnly() _user: User,
  ): Promise<FormComponents.PermissionsTreeNode[]> {
    return mapPermissionTreeToNodes(await GetPermissions());
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

  @Post("/")
  async create(@AuthOwnerOnly() _user: User, @JSONBody() body: PlanWriteBody) {
    const sanitized = pickPlanWrite(body);
    assertPlanInterval(sanitized.interval);
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
        maxMembers: sanitized.maxMembers ?? -1,
        paymentProviderRefs: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const planId = inserted[0];
    const created = await this.planModel.get(planId);
    assert(created, HTTP_INTERNAL_ERROR, "saas.errors.plan.creation_failed");
    const synced = await syncPlanIfConfigured(created);
    await this.planModel.update(planId, {
      paymentProviderRefs: synced.paymentProviderRefs,
      updatedAt: new Date(),
    });
    return { _id: planId };
  }

  @Put("/:id")
  async update(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @JSONBody() body: PlanWriteBody,
  ) {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_found");
    const sanitized = pickPlanWrite(body);
    if (sanitized.inheritsFromPlanId !== undefined) {
      await ensureInheritanceIsAcyclic(
        this.planModel,
        id,
        sanitized.inheritsFromPlanId,
      );
    }
    // The spread row is an AntelopeJS table class: `Table` declares one
    // field and a static, no instance methods, and the value is
    // serialised to JSON on the way out. No prototype to lose.
    // oxlint-disable-next-line typescript/no-misused-spread
    const merged = { ...plan, ...sanitized };
    if (hasStripeSyncChanges(sanitized)) {
      assertPlanInterval(merged.interval);
    }
    const synced = isPlanInterval(merged.interval)
      ? await syncPlanIfConfigured({
          ...merged,
          updatedAt: new Date(),
        } as Plan)
      : merged;
    await this.planModel.update(id, {
      ...sanitized,
      paymentProviderRefs: synced.paymentProviderRefs,
      updatedAt: new Date(),
    });
    return { _id: id };
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
    await this.planModel.update(id, {
      isDeleted: true,
      isActive: false,
      updatedAt: new Date(),
    });
    return { _id: id };
  }
}
