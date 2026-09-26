import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import { getUpcomingInvoicePreviewCacheTtlMs } from "../config";
import {
  PlanModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { UpcomingInvoicePreviewCacheModel } from "./db/preview-cache.model";
import { resolvePreviewEligibility } from "./eligibility";
import { stampOutcome } from "./outcomes";
import { priceUpcomingInvoice } from "./pricing";

const LOG_PREFIX = "[dms-saas:upcoming-invoice]";
const MISSING_ROW_VERSION = "none";
const SOURCE_VERSION_SEPARATOR = "|";

interface VersionedRow {
  updatedAt?: Date | null;
}

function rowVersion(row: VersionedRow | undefined): string {
  return row?.updatedAt
    ? new Date(row.updatedAt).toISOString()
    : MISSING_ROW_VERSION;
}

/**
 * Every write to the subscription (plan change, status, Stripe ids) or to the
 * billing identity (country, VAT number) moves one of these timestamps, so a
 * cached preview never outlives the local state it was priced from.
 */
function toSourceVersion(
  subscription: TenantSubscription | undefined,
  billingInfo: TenantBillingInfo | undefined,
): string {
  return [rowVersion(subscription), rowVersion(billingInfo)].join(
    SOURCE_VERSION_SEPARATOR,
  );
}

async function readCachedPreview(
  tenantId: string,
  sourceVersion: string,
  computedNotBefore: Date,
): Promise<UpcomingInvoicePreview | null> {
  try {
    return await GetModel(UpcomingInvoicePreviewCacheModel).readFresh({
      tenantId,
      sourceVersion,
      computedNotBefore,
    });
  } catch (error) {
    Logging.Error(`${LOG_PREFIX} cache read failed for ${tenantId}`, error);
    return null;
  }
}

async function cachePreview(
  tenantId: string,
  preview: UpcomingInvoicePreview,
  sourceVersion: string,
  computedAt: Date,
): Promise<void> {
  // A failed pricing is retried on the next request rather than pinned for
  // the whole cache lifetime.
  if (preview.status === "unavailable") return;
  try {
    await GetModel(UpcomingInvoicePreviewCacheModel).store({
      tenantId,
      preview,
      sourceVersion,
      computedAt,
    });
  } catch (error) {
    Logging.Error(`${LOG_PREFIX} cache write failed for ${tenantId}`, error);
  }
}

/**
 * The current upcoming invoice preview of a workspace, served from the
 * per-workspace cache while it is fresh. The caller authorizes the tenant.
 */
export async function getUpcomingInvoicePreview(
  tenantId: string,
): Promise<UpcomingInvoicePreview> {
  const now = new Date();
  const [subscription, billingInfo] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
    GetModel(TenantBillingInfoModel, tenantId).findOne(),
  ]);
  const plan = subscription?.planId
    ? await GetModel(PlanModel).get(subscription.planId)
    : undefined;
  const eligibility = resolvePreviewEligibility(subscription, plan);
  if (!eligibility.isPreviewable) return stampOutcome(eligibility.outcome, now);
  const ttlMs = getUpcomingInvoicePreviewCacheTtlMs();
  const sourceVersion = toSourceVersion(subscription, billingInfo);
  if (ttlMs > 0) {
    const computedNotBefore = new Date(now.getTime() - ttlMs);
    const cached = await readCachedPreview(
      tenantId,
      sourceVersion,
      computedNotBefore,
    );
    if (cached) return cached;
  }
  const preview = await priceUpcomingInvoice(tenantId, eligibility.target, now);
  if (ttlMs > 0) await cachePreview(tenantId, preview, sourceVersion, now);
  return preview;
}

/** Drop a workspace's cached preview so the next request prices it again. */
export async function invalidateUpcomingInvoicePreview(
  tenantId: string,
): Promise<void> {
  await GetModel(UpcomingInvoicePreviewCacheModel).invalidate(
    tenantId,
    new Date(),
  );
}
