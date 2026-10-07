import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  PLAN_AUDIENCES,
  PLAN_BILLING_MODES,
  PLAN_INTERVALS,
  Plan,
  type PlanFeatureValue,
  PlanModel,
} from "../../db";
import { loadCatalogueUsage, planMrrShare } from "../../plans/catalogue-usage";
import { stripeDashboardUrl } from "../../stripe/client";
import {
  PlanMemberCapDisplay,
  PlanMoneyDisplay,
} from "../../plans/plan-displays";

const TEXTS = "$saas.catalog.plans";

const AUDIENCE_ITEMS = PLAN_AUDIENCES.map((value) => ({
  value,
  label: `${TEXTS}.audience.${value}`,
}));

const INTERVAL_ITEMS = PLAN_INTERVALS.map((value) => ({
  value,
  label: `${TEXTS}.interval.${value}`,
}));

const BILLING_MODE_ITEMS = PLAN_BILLING_MODES.map((value) => ({
  value,
  label: `${TEXTS}.billing_mode.${value}`,
}));

/** Whether a plan is sold (`on_sale`) or kept for its customers (`legacy`). */
export const PLAN_SALE_STATUSES = ["on_sale", "legacy"] as const;
export type PlanSaleStatus = (typeof PLAN_SALE_STATUSES)[number];

const SALE_STATUS_ITEMS = PLAN_SALE_STATUSES.map((value) => ({
  value,
  label: `${TEXTS}.sale_status.${value}`,
}));

const SALE_STATUS_TONES = { on_sale: "success", legacy: "warning" } as const;

const COUNT_COLUMN_SIZE = 120;
const UNLIMITED_MEMBERS = -1;

interface PlanRowInstance {
  table: Plan;
}

function planOf(self: unknown): Plan {
  return (self as PlanRowInstance).table;
}

async function usageOf(self: unknown) {
  const usage = await loadCatalogueUsage();
  return usage.byPlan.get(planOf(self)._id);
}

/**
 * The catalogue of plans, read-only but for `order`, which the table and the
 * cards reorder. Plans are written through `/api/saas/plans`, which keeps
 * Stripe in line.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class plansDataAPI extends DataController(
  Plan,
  {
    get: TableViewRoutes.Get,
    list: TableViewRoutes.List,
    select: TableViewRoutes.Select,
    count: TableViewRoutes.Count,
    countBatch: TableViewRoutes.CountBatch,
    edit: TableViewRoutes.Edit,
    ...TableViewRoutes.ExportRoutes,
  },
  Controller("/api/saas/tables/plans"),
) {
  @ModelReference()
  @Model(PlanModel)
  declare model: PlanModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.plan`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-stack",
      subtitleField: "description",
      badges: [
        {
          field: "isPublic",
          equals: false,
          label: `${TEXTS}.card.hidden`,
          tone: "neutral",
        },
      ],
    }),
    size: 260,
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Listable()
  @Searchable()
  @Column({
    name: `${TEXTS}.field.description`,
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare description: string;

  @Listable(["isActive"])
  @Column({
    name: `${TEXTS}.column.sale_status`,
    type: new DefaultDataTypes.SelectType({ items: SALE_STATUS_ITEMS }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: { ...SALE_STATUS_TONES },
    }),
    size: COUNT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  get saleStatus(): PlanSaleStatus {
    return planOf(this).isActive ? "on_sale" : "legacy";
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.price`,
    type: new DefaultDataTypes.PriceType(),
    display: new PlanMoneyDisplay({ currencyField: "currency" }),
  })
  @Access(AccessMode.ReadOnly)
  declare price: number;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.currency`,
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare currency: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.interval`,
    type: new DefaultDataTypes.SelectType({ items: INTERVAL_ITEMS }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare interval: string;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.billing_mode`,
    type: new DefaultDataTypes.SelectType({ items: BILLING_MODE_ITEMS }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare billingMode: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.audience`,
    type: new DefaultDataTypes.SelectType({ items: AUDIENCE_ITEMS }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare audience: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.trial_days`,
    type: new DefaultDataTypes.NumberType({ min: 0 }),
    size: COUNT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare trialDays: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.max_members`,
    type: new DefaultDataTypes.NumberType({ min: UNLIMITED_MEMBERS }),
    display: new PlanMemberCapDisplay(),
    size: COUNT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare maxMembers: number;

  @Listable(["_id"])
  @Exported()
  @Column({
    name: `${TEXTS}.column.workspaces`,
    type: new DefaultDataTypes.NumberType(),
    size: COUNT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  get workspaceCount(): Promise<number> {
    return usageOf(this).then((usage) => usage?.workspaces ?? 0);
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get payingCount(): Promise<number> {
    return usageOf(this).then((usage) => usage?.paying ?? 0);
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get trialingCount(): Promise<number> {
    return usageOf(this).then((usage) => usage?.trialing ?? 0);
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get seatCount(): Promise<number> {
    return usageOf(this).then((usage) => usage?.seats ?? 0);
  }

  @Listable(["_id"])
  @Access(AccessMode.ReadOnly)
  get memberCount(): Promise<number> {
    return usageOf(this).then((usage) => usage?.members ?? 0);
  }

  @Listable(["_id", "currency"])
  @Exported()
  @Column({
    name: `${TEXTS}.column.mrr`,
    description: `${TEXTS}.column.mrr_description`,
    type: new DefaultDataTypes.PriceType(),
    display: new PlanMoneyDisplay({ currencyField: "currency" }),
  })
  @Access(AccessMode.ReadOnly)
  get mrr(): Promise<number> {
    return usageOf(this).then((usage) => usage?.mrr ?? 0);
  }

  @Listable(["_id", "currency"])
  @Column({
    name: `${TEXTS}.column.mrr_share`,
    type: new DefaultDataTypes.PercentageType(),
    size: COUNT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  get mrrShare(): Promise<number> {
    return loadCatalogueUsage().then((usage) =>
      planMrrShare(usage, planOf(this)),
    );
  }

  @Listable(["_id", "features", "permissions", "inheritsFromPlanId"])
  @Access(AccessMode.ReadOnly)
  get resolvedFeatures(): Promise<PlanFeatureValue[]> {
    return GetModel(PlanModel)
      .resolveInheritance(planOf(this))
      .then((resolved) => resolved.features);
  }

  @Listable(["paymentProviderRefs"])
  @Access(AccessMode.ReadOnly)
  get stripeProductId(): string | null {
    return planOf(this).paymentProviderRefs?.stripeProductId ?? null;
  }

  @Listable(["paymentProviderRefs"])
  @Access(AccessMode.ReadOnly)
  get stripeProductUrl(): string | null {
    const productId = planOf(this).paymentProviderRefs?.stripeProductId;
    return productId ? stripeDashboardUrl(`products/${productId}`) : null;
  }

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare borderLabel: string | null;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare borderColor: string | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.is_public`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare isPublic: boolean;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.is_active`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare isActive: boolean;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.field.order`,
    type: new DefaultDataTypes.NumberType({ min: 0 }),
    isVisible: false,
  })
  @Access(AccessMode.ReadWrite)
  declare order: number;

  @Listable()
  @Access(AccessMode.ReadOnly)
  declare updatedAt: Date;

  @Select()
  @Column({
    name: `${TEXTS}.field.is_deleted`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare isDeleted: boolean;
}
