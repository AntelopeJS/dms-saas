import { JSONBody, Post } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  type InviteUserToTenantResult,
  inviteUserToTenant,
} from "@antelopejs/interface-dms/invites";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  Grid,
  GridRow,
  KpiCard,
  TableView,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import type { WatchAction } from "@antelopejs/interface-dms/base/types";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { recomputeTenantBillingState } from "../../../billing-state";
import { isAllowedRedirectUrl } from "../../../config";
import { workspacesDataAPI } from "../../../data-api";
import { type Plan, PlanModel, TenantSubscriptionModel } from "../../../db";
import {
  createWorkspaceCheckoutSession,
  type WorkspaceCheckoutSession,
} from "../../../stripe";
import { parseFutureDate } from "../../../utils";
import {
  deliverInvitationEmail,
  type InvitationEmailDelivery,
  inviterNameOf,
} from "../../../workspaces/invitations";
import { SAAS_MODULE_ID } from "../../module";
import { customersCategory } from "../categories";

const KPI_WORKSPACES = "/api/saas/dashboard/kpi/workspaces";
const KPI_ACTIVE = "/api/saas/dashboard/kpi/state-active";
const KPI_FREE = "/api/saas/dashboard/kpi/state-free";
const KPI_PAST_DUE = "/api/saas/dashboard/kpi/state-past-due";

// Shared with the create modal (WorkspaceAdminCreateModal.vue), which emits
// the event, and the frontend plugin registering the refresh function.
const WORKSPACE_CREATED_EVENT = "DmsSaas.Workspaces.Created";
const WORKSPACE_CREATED_SOURCE = "saas.workspaces.create";
const REFRESH_FUNCTION_ID = "DmsSaas.RefreshData";

/**
 * Refetch on every workspace the create modal adds. Declared as a raw watch
 * action because `.watch()` only listens to the component's own events, and
 * the counters have to hear the modal's.
 */
const WORKSPACE_CREATED_WATCH: WatchAction = {
  component: WORKSPACE_CREATED_SOURCE,
  event: WORKSPACE_CREATED_EVENT,
  functionId: REFRESH_FUNCTION_ID,
};

function workspaceKpiCard(title: string, icon: string, fetchUrl: string) {
  return KpiCard({
    title,
    icon,
    fetchUrl,
    variant: "stat",
    valueFormat: "compact",
    showDelta: false,
  }).transformOptions(
    (options) =>
      options && {
        ...options,
        watchActions: [
          ...(options.watchActions ?? []),
          WORKSPACE_CREATED_WATCH,
        ],
      },
  );
}

const ACTIVE_STATUS = "active";
const PENDING_PAYMENT_STATUS = "pending_payment";

const STATUS_TAB_FILTER_KEY = "billingState";

const STATUS_TAB_IDS = ["active", "free", "past_due", "suspended"];

const STATUS_TABS = STATUS_TAB_IDS.map((id) => ({
  id,
  label: `$saas.workspaces.billing_state.${id}`,
  filters: [{ accessorKey: STATUS_TAB_FILTER_KEY, value: id, mode: "is" }],
}));

// A custom form rather than the generic one: the generic form always reports
// success, and the operator must learn when the owner's invitation email did
// not leave.
const workspaceCreateModal = CustomComponent(
  "DmsSaasWorkspaceAdminCreateModal",
);

const HTTP_BAD_REQUEST = 400;

interface CreateWorkspaceBody {
  name?: unknown;
  planId?: unknown;
  ownerEmail?: unknown;
  freeWorkspace?: unknown;
  freeUntil?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
}

interface ValidatedWorkspaceInput {
  name: string;
  planId: string;
  ownerEmail: string;
  freeWorkspace: boolean;
  freeUntil: Date | null;
}

interface ValidatedCheckoutInput {
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function validateWorkspaceInput(
  body: CreateWorkspaceBody,
): ValidatedWorkspaceInput {
  const name = asNonEmptyString(body.name);
  const planId = asNonEmptyString(body.planId);
  const ownerEmail = asNonEmptyString(body.ownerEmail);
  const freeWorkspace = body.freeWorkspace !== false;
  const freeUntil = freeWorkspace
    ? parseFutureDate(
        body.freeUntil,
        "saas.workspaces.admin.create.error.free_until_past",
      )
    : null;
  assert(name, HTTP_BAD_REQUEST, "saas.workspaces.admin.create.error.name");
  assert(planId, HTTP_BAD_REQUEST, "saas.workspaces.admin.create.error.plan");
  assert(
    ownerEmail,
    HTTP_BAD_REQUEST,
    "saas.workspaces.admin.create.error.owner_email",
  );
  return { name, planId, ownerEmail, freeWorkspace, freeUntil };
}

function validatePaidCheckoutInput(
  body: CreateWorkspaceBody,
  plan: Plan,
): ValidatedCheckoutInput {
  const stripePriceId = plan.paymentProviderRefs?.stripePriceId ?? null;
  assert(
    stripePriceId,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_synced_with_stripe",
  );
  const successUrl = asNonEmptyString(body.successUrl);
  const cancelUrl = asNonEmptyString(body.cancelUrl);
  assert(
    successUrl && isAllowedRedirectUrl(successUrl),
    HTTP_BAD_REQUEST,
    "saas.errors.billing.invalid_return_url",
  );
  assert(
    cancelUrl && isAllowedRedirectUrl(cancelUrl),
    HTTP_BAD_REQUEST,
    "saas.errors.billing.invalid_return_url",
  );
  return { stripePriceId, successUrl, cancelUrl };
}

async function insertFreeSubscription(
  tenantId: string,
  planId: string,
  userId: string,
  now: Date,
  freeUntil: Date | null,
): Promise<void> {
  await GetModel(TenantSubscriptionModel, tenantId).insert([
    {
      planId,
      status: ACTIVE_STATUS,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      createdBy: userId,
      freeUntil,
      isComplimentary: true,
      paidUsageStartedAt: null,
      paidUsagePeriods: [],
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

interface ProvisionedTenant {
  tenantId: string;
  inviteResult: InviteUserToTenantResult;
  invitationEmail: InvitationEmailDelivery | null;
}

interface WorkspaceOwnerProvisioning {
  name: string;
  ownerEmail: string;
  operator: User;
  now: Date;
}

async function provisionTenantWithOwner(
  tenantModel: TenantModel,
  { name, ownerEmail, operator, now }: WorkspaceOwnerProvisioning,
): Promise<ProvisionedTenant> {
  // The owner has no account yet, so the operator's language is the best
  // guess at theirs; the email follows the language stored on the invitation.
  const ownerLanguage = operator.language;
  const inserted = await tenantModel.insert([
    { name, createdAt: now, updatedAt: now },
  ]);
  const tenantId = inserted[0];
  const inviteResult: InviteUserToTenantResult = await inviteUserToTenant({
    tenantId,
    email: ownerEmail,
    language: ownerLanguage,
    roleIds: [],
    asTenantOwner: true,
  });
  // Sent here rather than through `sendEmail`, which fires and forgets: the
  // operator has to learn that the owner never got the link.
  const invitationEmail =
    inviteResult.kind === "invited"
      ? await deliverInvitationEmail(
          {
            email: ownerEmail,
            token: inviteResult.token,
            firstname: null,
            lastname: null,
            language: ownerLanguage,
          },
          { workspaceName: name, inviterName: inviterNameOf(operator) },
        )
      : null;
  return { tenantId, inviteResult, invitationEmail };
}

async function insertPendingSubscription(
  tenantId: string,
  planId: string,
  userId: string,
  checkout: WorkspaceCheckoutSession,
  now: Date,
): Promise<void> {
  await GetModel(TenantSubscriptionModel, tenantId).insert([
    {
      planId,
      status: PENDING_PAYMENT_STATUS,
      stripeCustomerId: checkout.customerId,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: checkout.sessionId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

@RegisterPage()
export class SaasWorkspacesListController extends PageController(
  "workspaces",
  {
    displayName: "$saas.workspaces.title",
    module: SAAS_MODULE_ID,
    category: customersCategory,
    icon: "i-ph-buildings",
    description: "$saas.workspaces.description",
    order: 0,
  },
  DefaultLayout({ fullWidth: true }),
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(UserModel)
  declare userModel: UserModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  static kpis = Grid({ gap: "1rem" }).child(
    "row",
    GridRow()
      .child(
        "workspaces",
        workspaceKpiCard(
          "$saas.workspaces.kpi.workspaces",
          "i-ph-buildings",
          KPI_WORKSPACES,
        ),
      )
      .child(
        "active",
        workspaceKpiCard(
          "$saas.workspaces.kpi.active",
          "i-ph-check-circle",
          KPI_ACTIVE,
        ),
      )
      .child(
        "free",
        workspaceKpiCard("$saas.workspaces.kpi.free", "i-ph-gift", KPI_FREE),
      )
      .child(
        "pastDue",
        workspaceKpiCard(
          "$saas.workspaces.kpi.past_due",
          "i-ph-warning",
          KPI_PAST_DUE,
        ),
      ),
  );

  static table = TableView(workspacesDataAPI, {
    caption: "$saas.workspaces.caption",
    tabs: STATUS_TABS,
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      details: { isEnabled: true, isVisible: true },
      edit: false,
      duplicate: false,
    },
    customButtons: [
      {
        label: "$saas.workspaces.admin.create.button",
        icon: "i-ph-plus",
        color: "primary",
        target: {
          type: "modal",
          size: "lg",
          component: workspaceCreateModal,
          title: "$saas.workspaces.admin.create.title",
          description: "$saas.workspaces.admin.create.description",
        },
      },
    ],
    formContainer: {
      type: "page",
      pages: { view: { urlSlug: ":id", customPage: true } },
    },
  });

  @Post("/create")
  async createWorkspace(
    @AuthOwnerOnly() user: User,
    @JSONBody() body: CreateWorkspaceBody,
  ) {
    const input = validateWorkspaceInput(body);
    const plan = await this.planModel.get(input.planId);
    assert(
      plan && !plan.isDeleted && plan.isActive,
      HTTP_BAD_REQUEST,
      "saas.errors.plan.not_available",
    );
    const checkoutInput = input.freeWorkspace
      ? null
      : validatePaidCheckoutInput(body, plan);

    const now = new Date();
    const { tenantId, inviteResult, invitationEmail } =
      await provisionTenantWithOwner(this.tenantModel, {
        name: input.name,
        ownerEmail: input.ownerEmail,
        operator: user,
        now,
      });

    if (!checkoutInput) {
      await insertFreeSubscription(
        tenantId,
        input.planId,
        user._id,
        now,
        input.freeUntil,
      );
      await recomputeTenantBillingState(tenantId);
      return {
        tenantId,
        owner: inviteResult,
        invitationEmail,
        checkoutUrl: null,
      };
    }

    const checkout = await createWorkspaceCheckoutSession({
      tenantId,
      ownerEmail: input.ownerEmail,
      stripePriceId: checkoutInput.stripePriceId,
      trialDays: plan.trialDays,
      successUrl: checkoutInput.successUrl,
      cancelUrl: checkoutInput.cancelUrl,
    });
    await insertPendingSubscription(
      tenantId,
      input.planId,
      user._id,
      checkout,
      now,
    );
    await recomputeTenantBillingState(tenantId);
    return {
      tenantId,
      owner: inviteResult,
      invitationEmail,
      checkoutUrl: checkout.url,
    };
  }
}
