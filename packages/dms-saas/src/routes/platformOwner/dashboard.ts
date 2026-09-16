import { Controller, Get } from "@antelopejs/interface-api";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  InvoiceModel,
  PlanModel,
  TenantBillingStateModel,
  TenantSubscriptionModel,
} from "../../db";
import { MS_PER_DAY } from "../../utils/time";

const ACTIVE_STATUS = "active";
const TRIALING_STATUS = "trialing";
const FREE_STATUS = "free";
const PAST_DUE_STATUS = "past_due";
const OPEN_STATUS = "open";
const PAID_STATUS = "paid";
const PRICE_DIVIDER = 100;
const REVENUE_BUCKETS = 12;
const DAYS_PER_MONTH = 30;
const TOP_PLANS_LIMIT = 10;
const RECENT_ACTIVITY_LIMIT = 12;
const CURRENCY_SYMBOL = "€";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
  pending_payment: "Pending payment",
};
const UNKNOWN_STATUS_LABEL = "Unknown";

interface TopListItem {
  id: string;
  title: string;
  value: number;
}

interface ChartPoint {
  x: string;
  y: number;
}

interface ChartSeries {
  name: string;
  data: ChartPoint[];
}

interface DonutSlice {
  label: string;
  value: number;
}

interface ActivityEntry {
  id: string;
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
  timestamp: string;
}

function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? UNKNOWN_STATUS_LABEL;
}

function toTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

function formatInvoiceAmount(amount: number | null | undefined): string {
  return `${CURRENCY_SYMBOL}${((amount ?? 0) / PRICE_DIVIDER).toFixed(2)}`;
}

export class SaasDashboardController extends Controller("/api/saas/dashboard") {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(TenantSubscriptionModel, CROSS_INSTANCE)
  declare tenantSubscriptionModel: TenantSubscriptionModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(InvoiceModel, CROSS_INSTANCE)
  declare invoiceModel: InvoiceModel;

  @Model(TenantBillingStateModel)
  declare tenantBillingStateModel: TenantBillingStateModel;

  @Get("/kpi/workspaces")
  async kpiWorkspaces(@AuthOwnerOnly() _user: User) {
    const value = await this.tenantModel.table.count().run();
    return { value };
  }

  @Get("/kpi/mrr")
  async kpiMrr(@AuthOwnerOnly() _user: User) {
    const rows = await this.tenantSubscriptionModel.table
      .getAll([ACTIVE_STATUS, TRIALING_STATUS], "status")
      .pluck("planId")
      .run();
    const planPriceCache = new Map<string, number | null>();
    let total = 0;
    for (const row of rows) {
      const planId = row.planId;
      if (!planId) continue;
      let price = planPriceCache.get(planId);
      if (price === undefined) {
        const plan = await this.planModel.get(planId);
        price = plan?.price ?? null;
        planPriceCache.set(planId, price);
      }
      if (price !== null) total += price;
    }
    return { value: Math.round(total * PRICE_DIVIDER) / PRICE_DIVIDER };
  }

  @Get("/kpi/active-subscriptions")
  async kpiActive(@AuthOwnerOnly() _user: User) {
    const value = await this.tenantSubscriptionModel.table
      .getAll([ACTIVE_STATUS, TRIALING_STATUS], "status")
      .count()
      .run();
    return { value };
  }

  @Get("/kpi/open-invoices")
  async kpiOpen(@AuthOwnerOnly() _user: User) {
    const value = await this.invoiceModel.table
      .getAll(OPEN_STATUS, "status")
      .count()
      .run();
    return { value };
  }

  @Get("/kpi/state-active")
  async kpiStateActive(@AuthOwnerOnly() _user: User) {
    return {
      value: await this.tenantBillingStateModel.countByState(ACTIVE_STATUS),
    };
  }

  @Get("/kpi/state-free")
  async kpiStateFree(@AuthOwnerOnly() _user: User) {
    return {
      value: await this.tenantBillingStateModel.countByState(FREE_STATUS),
    };
  }

  @Get("/kpi/state-past-due")
  async kpiStatePastDue(@AuthOwnerOnly() _user: User) {
    return {
      value: await this.tenantBillingStateModel.countByState(PAST_DUE_STATUS),
    };
  }

  @Get("/top-plans")
  async topPlans(@AuthOwnerOnly() _user: User): Promise<TopListItem[]> {
    const rows = await this.tenantSubscriptionModel.table
      .getAll([ACTIVE_STATUS, TRIALING_STATUS], "status")
      .pluck("planId")
      .run();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const planId = row.planId;
      if (!planId) continue;
      counts.set(planId, (counts.get(planId) ?? 0) + 1);
    }
    const planIds = Array.from(counts.keys());
    const plans = await Promise.all(
      planIds.map((id) => this.planModel.get(id)),
    );
    const items: TopListItem[] = [];
    for (let i = 0; i < planIds.length; i += 1) {
      const plan = plans[i];
      if (!plan) continue;
      items.push({
        id: plan._id,
        title: plan.name,
        value: counts.get(planIds[i]) ?? 0,
      });
    }
    items.sort((a, b) => b.value - a.value);
    return items.slice(0, TOP_PLANS_LIMIT);
  }

  @Get("/chart/revenue")
  async chartRevenue(@AuthOwnerOnly() _user: User): Promise<ChartSeries[]> {
    const now = Date.now();
    const buckets = new Map<string, number>();
    for (let bucket = REVENUE_BUCKETS - 1; bucket >= 0; bucket -= 1) {
      const date = new Date(now - bucket * DAYS_PER_MONTH * MS_PER_DAY);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, 0);
    }
    const cutoff = new Date(
      now - REVENUE_BUCKETS * DAYS_PER_MONTH * MS_PER_DAY,
    );
    const invoices = await this.invoiceModel.table
      .getAll(PAID_STATUS, "status")
      .filter((row) => row.key("issuedAt").ge(cutoff))
      .pluck("amount", "issuedAt")
      .run();
    for (const invoice of invoices) {
      const rawIssued = invoice.issuedAt;
      if (!rawIssued) continue;
      const issued =
        rawIssued instanceof Date ? rawIssued : new Date(rawIssued);
      const key = `${issued.getFullYear()}-${String(issued.getMonth() + 1).padStart(2, "0")}`;
      if (buckets.has(key)) {
        buckets.set(
          key,
          (buckets.get(key) ?? 0) + (invoice.amount ?? 0) / PRICE_DIVIDER,
        );
      }
    }
    const data = Array.from(buckets.entries()).map(([x, y]) => ({ x, y }));
    return [{ name: "revenue", data }];
  }

  @Get("/chart/subscriptions-by-status")
  async chartSubscriptionsByStatus(
    @AuthOwnerOnly() _user: User,
  ): Promise<DonutSlice[]> {
    const rows = await this.tenantSubscriptionModel.table.pluck("status").run();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const status = row.status;
      if (!status) continue;
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, value]) => ({
      label: formatStatusLabel(status),
      value,
    }));
  }

  @Get("/recent-activity")
  async recentActivity(@AuthOwnerOnly() _user: User): Promise<ActivityEntry[]> {
    const tenants = await this.tenantModel.table
      .pluck("_id", "name", "createdAt")
      .run();
    const invoices = await this.invoiceModel.table
      .getAll(PAID_STATUS, "status")
      .pluck("_id", "amount", "issuedAt")
      .run();
    const entries: ActivityEntry[] = [
      ...tenants.map((tenant) => ({
        id: `workspace-${tenant._id}`,
        icon: "i-ph-building",
        iconColor: "primary",
        title: tenant.name ?? "",
        subtitle: "saas.dashboard.activity.workspace_created",
        timestamp: toTimestamp(tenant.createdAt),
      })),
      ...invoices.map((invoice) => ({
        id: `invoice-${invoice._id}`,
        icon: "i-ph-receipt",
        iconColor: "success",
        title: formatInvoiceAmount(invoice.amount),
        subtitle: "saas.dashboard.activity.invoice_paid",
        timestamp: toTimestamp(invoice.issuedAt),
      })),
    ];
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return entries.slice(0, RECENT_ACTIVITY_LIMIT);
  }
}
