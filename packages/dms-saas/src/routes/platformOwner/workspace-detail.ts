import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  ActivityFeedItem,
  KeyValueListItem,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import { fetchDefaultPaymentMethod } from "../../billing-state";
import { getReportingCurrency } from "../../config";
import { CreditNoteModel, type Invoice, InvoiceModel } from "../../db";
import { serverMessages } from "../../i18n/server-messages";
import { buildActivityFeed, parseActivityKind } from "../../metrics/activity";
import { loadActivitySources } from "../../metrics/activity-sources";
import {
  loadDirectoryRows,
  nameWorkspaces,
  summariseDirectory,
} from "../../metrics/directory-summary";
import { workspacesHeadline } from "../../metrics/headline-items";
import { safeUpcomingInvoice } from "../../operator-actions/previews";
import { retrieveStripeCustomerBalance } from "../../stripe/customer-balance";
import { stripeObjectUrl } from "../../stripe/dashboard-links";
import { CONTENT_LANGUAGE_HEADER } from "../../utils/content-language";
import {
  billingInfoItems,
  isInvoiceDocument,
  upcomingTimelineItems,
  workspaceFacts,
} from "../../workspaces/detail-items";
import { loadWorkspaceOperatorView } from "../../workspaces/operator-view";

/** What a list block (`StatGroup`, `KeyValueList`, …) reads from its route. */
interface ItemsPayload<T> {
  items: T[];
}

/** The header of a workspace's detail page. */
interface WorkspaceOverview {
  _id: string;
  name: string;
  createdAt: Date;
  status: string;
  planName: string | null;
  isComplimentary: boolean;
  freeUntil: Date | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerStatus: string;
  /** When the signed-in operator joined as platform support, if they did. */
  joinedAt: Date | null;
  stripeCustomerId: string | null;
  stripeCustomerUrl: string | null;
  hasStripeSubscription: boolean;
  members: number;
  /** Platform admins who joined to support the workspace: they hold no seat. */
  platformSupport: number;
  pendingInvitations: number;
  seats: number;
  maxMembers: number | null;
}

const ACTIVITY_LIMIT = 30;
const OVERVIEW_ACTIVITY_LIMIT = 4;
const TIMELINE_HISTORY_LIMIT = 4;
const UNLIMITED_MEMBERS = -1;
const MINOR_UNITS_PER_UNIT = 100;

async function loadDocuments(tenantId: string): Promise<Invoice[]> {
  return GetModel(InvoiceModel, tenantId).getAllInvoices();
}

/** The detail page of one workspace, and the workspace list's headline. */
export class SaasWorkspaceDetailController extends Controller(
  "/api/saas/workspaces",
) {
  @Get("/directory-headline")
  async directoryHeadline(
    @AuthOwnerOnly() _user: User,
  ): Promise<ItemsPayload<StatGroupItem>> {
    const summary = summariseDirectory(
      await loadDirectoryRows(),
      new Date(),
      getReportingCurrency(),
    );
    const endings = await nameWorkspaces(summary.complimentaryEnding);
    return {
      items: workspacesHeadline(summary, endings),
    };
  }

  @Get("/:tenantId/overview")
  async overview(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<WorkspaceOverview> {
    const view = await loadWorkspaceOperatorView(tenantId);
    const membership = await GetModel(TenantMemberModel, tenantId).getByUser(
      user._id,
    );
    const customerId = view.subscription?.stripeCustomerId ?? null;
    const maxMembers = view.plan?.maxMembers ?? UNLIMITED_MEMBERS;
    return {
      _id: view.tenant._id,
      name: view.tenant.name,
      createdAt: view.tenant.createdAt,
      status: view.billingState,
      planName: view.directory.planName,
      isComplimentary: view.directory.isComplimentary,
      freeUntil: view.subscription?.freeUntil ?? null,
      ownerName: view.directory.ownerName,
      ownerEmail: view.directory.ownerEmail,
      ownerStatus: view.directory.ownerStatus,
      joinedAt: membership?.joinedAt ?? null,
      stripeCustomerId: customerId,
      stripeCustomerUrl: customerId
        ? stripeObjectUrl("customers", customerId)
        : null,
      hasStripeSubscription: !!view.subscription?.stripeSubscriptionId,
      members: view.seats.members,
      platformSupport: view.seats.platformSupport.length,
      pendingInvitations: view.seats.pendingInvites,
      seats: view.seats.occupied,
      maxMembers: maxMembers === UNLIMITED_MEMBERS ? null : maxMembers,
    };
  }

  @Get("/:tenantId/facts")
  async facts(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<ItemsPayload<StatGroupItem>> {
    const view = await loadWorkspaceOperatorView(tenantId);
    const customerId = view.subscription?.stripeCustomerId;
    const [preview, card, invoices] = await Promise.all([
      safeUpcomingInvoice(tenantId),
      customerId ? fetchDefaultPaymentMethod(customerId) : null,
      loadDocuments(tenantId),
    ]);
    return {
      items: workspaceFacts({ view, preview, card, invoices }),
    };
  }

  @Get("/:tenantId/billing-info")
  async billingInfo(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<ItemsPayload<KeyValueListItem>> {
    const view = await loadWorkspaceOperatorView(tenantId);
    return { items: billingInfoItems(view.billingInfo) };
  }

  /** The coming milestone, then the latest billing and lifecycle events. */
  @Get("/:tenantId/subscription-timeline")
  async subscriptionTimeline(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<ItemsPayload<ActivityFeedItem>> {
    const messages = serverMessages(language);
    const [view, preview, sources] = await Promise.all([
      loadWorkspaceOperatorView(tenantId),
      safeUpcomingInvoice(tenantId),
      loadActivitySources(tenantId, TIMELINE_HISTORY_LIMIT),
    ]);
    const history = buildActivityFeed(sources, {
      kind: "all",
      limit: TIMELINE_HISTORY_LIMIT,
      messages,
    });
    return {
      items: [...upcomingTimelineItems(messages, view, preview), ...history],
    };
  }

  @Get("/:tenantId/activity")
  async activity(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @Parameter("kind", "query") kind: unknown,
    @Parameter("limit", "query") limit: unknown,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<ItemsPayload<ActivityFeedItem>> {
    const cut = limit === "short" ? OVERVIEW_ACTIVITY_LIMIT : ACTIVITY_LIMIT;
    const sources = await loadActivitySources(tenantId, cut);
    return {
      items: buildActivityFeed(sources, {
        kind: parseActivityKind(kind),
        limit: cut,
        messages: serverMessages(language),
      }),
    };
  }

  /** The counts on the detail page's tabs, by tab slot. */
  @Get("/:tenantId/tab-counts")
  async tabCounts(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<Record<string, string | number>> {
    // The invoice mirror's `getAllInvoices` leaves the credit notes out:
    // they are counted from their own table.
    const [view, invoices, creditNotes] = await Promise.all([
      loadWorkspaceOperatorView(tenantId),
      loadDocuments(tenantId),
      GetModel(CreditNoteModel, tenantId).getAll(),
    ]);
    const { members, pendingInvites } = view.seats;
    return {
      invoices: invoices.filter(isInvoiceDocument).length,
      creditNotes: creditNotes.length,
      members: pendingInvites > 0 ? `${members} + ${pendingInvites}` : members,
    };
  }

  /** The credit on the Stripe customer balance, used on the next invoices. */
  @Get("/:tenantId/available-credit")
  async availableCredit(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<ItemsPayload<KeyValueListItem>> {
    const view = await loadWorkspaceOperatorView(tenantId);
    const customerId = view.subscription?.stripeCustomerId;
    if (!customerId) return { items: [] };
    const balance = await retrieveStripeCustomerBalance(customerId);
    if (balance.status !== "available") return { items: [] };
    const currency = (
      balance.currency ??
      view.directory.currency ??
      ""
    ).toUpperCase();
    return {
      items: [
        {
          id: "available_credit",
          label: "$saas.workspace_detail.credit.available",
          value: Math.max(0, -balance.balanceMinorUnits) / MINOR_UNITS_PER_UNIT,
          type: "money",
          currency,
        },
      ],
    };
  }
}
