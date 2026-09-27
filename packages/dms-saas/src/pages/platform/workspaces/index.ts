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
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { recomputeTenantBillingState } from "../../../billing-state";
import { workspacesDataAPI } from "../../../data-api";
import { PlanModel, TenantSubscriptionModel } from "../../../db";
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

const ACTIVE_STATUS = "active";

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
  freeUntil?: unknown;
}

interface ValidatedWorkspaceInput {
  name: string;
  planId: string;
  ownerEmail: string;
  freeUntil: Date | null;
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
  const freeUntil = parseFutureDate(
    body.freeUntil,
    "saas.workspaces.admin.create.error.free_until_past",
  );
  assert(name, HTTP_BAD_REQUEST, "saas.workspaces.admin.create.error.name");
  assert(planId, HTTP_BAD_REQUEST, "saas.workspaces.admin.create.error.plan");
  assert(
    ownerEmail,
    HTTP_BAD_REQUEST,
    "saas.workspaces.admin.create.error.owner_email",
  );
  return { name, planId, ownerEmail, freeUntil };
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
        KpiCard({
          title: "$saas.workspaces.kpi.workspaces",
          icon: "i-ph-buildings",
          fetchUrl: KPI_WORKSPACES,
          variant: "stat",
          valueFormat: "compact",
          showDelta: false,
        }),
      )
      .child(
        "active",
        KpiCard({
          title: "$saas.workspaces.kpi.active",
          icon: "i-ph-check-circle",
          fetchUrl: KPI_ACTIVE,
          variant: "stat",
          valueFormat: "compact",
          showDelta: false,
        }),
      )
      .child(
        "free",
        KpiCard({
          title: "$saas.workspaces.kpi.free",
          icon: "i-ph-gift",
          fetchUrl: KPI_FREE,
          variant: "stat",
          valueFormat: "compact",
          showDelta: false,
        }),
      )
      .child(
        "pastDue",
        KpiCard({
          title: "$saas.workspaces.kpi.past_due",
          icon: "i-ph-warning",
          fetchUrl: KPI_PAST_DUE,
          variant: "stat",
          valueFormat: "compact",
          showDelta: false,
        }),
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

    const now = new Date();
    const { tenantId, inviteResult, invitationEmail } =
      await provisionTenantWithOwner(this.tenantModel, {
        name: input.name,
        ownerEmail: input.ownerEmail,
        operator: user,
        now,
      });

    await insertFreeSubscription(
      tenantId,
      input.planId,
      user._id,
      now,
      input.freeUntil,
    );
    await recomputeTenantBillingState(tenantId);
    return { tenantId, owner: inviteResult, invitationEmail };
  }
}
