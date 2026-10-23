import { Logging } from "@antelopejs/interface-core/logging";
import { getStripeClient } from "./client";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { TenantSubscription } from "../db";
import { baseLanguage } from "../utils/language";
import { isWorkspaceOwner } from "../workspaces/workspace-owner";

const LOG_PREFIX = "[dms-saas:customer-locale]";

/**
 * The locale last written on each Stripe customer by this process, so an
 * owner reading Billing does not cost a Stripe call each time. A restart
 * only costs one redundant update per customer.
 */
const syncedLocales = new Map<string, string>();

/**
 * The `preferred_locales` of a Stripe customer, from the owner's language:
 * Stripe words invoice lines, PDFs and e-mails in it. The base language is
 * kept (`fr` for `fr-FR`), which every Stripe surface supports.
 *
 * @param language The owner's language, as stored on the user
 * @returns Undefined when the language is unknown, leaving Stripe's default
 */
export function toStripePreferredLocales(
  language: string | null | undefined,
): string[] | undefined {
  const base = baseLanguage(language);
  return base ? [base] : undefined;
}

/** Records the locale a customer was just created with. */
export function rememberCustomerLocale(
  customerId: string,
  language: string | null | undefined,
): void {
  const [locale] = toStripePreferredLocales(language) ?? [];
  if (locale) syncedLocales.set(customerId, locale);
}

/**
 * Follows the owner's language on the Stripe customer, once it changed:
 * before a plan change, Stripe words its proration lines in it. Best effort —
 * a refused update leaves the lines in the previous language, which must not
 * stop the owner from changing plan.
 *
 * @param customerId The workspace's Stripe customer, when it has one
 * @param language The owner's language
 */
export async function syncCustomerPreferredLocale(
  customerId: string | null | undefined,
  language: string | null | undefined,
): Promise<void> {
  const locales = toStripePreferredLocales(language);
  if (!customerId || !locales) return;
  if (syncedLocales.get(customerId) === locales[0]) return;
  try {
    await getStripeClient().customers.update(customerId, {
      preferred_locales: locales,
    });
    syncedLocales.set(customerId, locales[0]);
  } catch (error) {
    Logging.Warn(`${LOG_PREFIX} ${customerId} keeps its locale`, error);
  }
}

/**
 * Billing is where an owner comes back after changing language: the Stripe
 * customer follows it from then on, renewals included. A member's language
 * is not the one the workspace's invoices are written in.
 */
export async function followOwnerLanguage(
  tenantId: string,
  subscription: TenantSubscription | undefined,
  user: User,
): Promise<void> {
  const customerId = subscription?.stripeCustomerId;
  if (!customerId) return;
  if (!(await isWorkspaceOwner(user._id, tenantId).catch(() => false))) {
    return;
  }
  await syncCustomerPreferredLocale(customerId, user.language);
}
