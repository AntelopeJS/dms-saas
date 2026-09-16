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
  Form,
  Grid,
  GridRow,
  HttpMethod,
  KpiCard,
  TableView,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { recomputeTenantBillingState } from "../../../billing-state";
import { isAllowedRedirectUrl } from "../../../config";
import { plansDataAPI, workspacesDataAPI } from "../../../data-api";
import { type Plan, PlanModel, TenantSubscriptionModel } from "../../../db";
import {
  createWorkspaceCheckoutSession,
  type WorkspaceCheckoutSession,
} from "../../../stripe";
import { parseFutureDate } from "../../../utils";
import { SAAS_MODULE_ID } from "../../module";
import { customersCategory } from "../categories";

const KPI_WORKSPACES = "/api/saas/dashboard/kpi/workspaces";
const KPI_ACTIVE = "/api/saas/dashboard/kpi/state-active";
const KPI_FREE = "/api/saas/dashboard/kpi/state-free";
const KPI_PAST_DUE = "/api/saas/dashboard/kpi/state-past-due";

const ACTIVE_STATUS = "active";
const PENDING_PAYMENT_STATUS = "pending_payment";

const STATUS_TAB_FILTER_KEY = "billingState";

const STATUS_TAB_DEFS = [
  { id: "active", label: "Active" },
  { id: "free", label: "Free" },
  { id: "past_due", label: "Past due" },
  { id: "suspended", label: "Suspended" },
];

const STATUS_TABS = STATUS_TAB_DEFS.map(({ id, label }) => ({
  id,
  label,
  filters: [{ accessorKey: STATUS_TAB_FILTER_KEY, value: id, mode: "is" }],
}));

const workspaceCreateForm = Form({
  fields: [
    {
      id: "name",
      label: "$saas.workspaces.admin.create.field.name",
      description: "$saas.workspaces.admin.create.field.name_description",
      type: new DefaultDataTypes.StringType({
        placeholder: "$saas.workspaces.admin.create.placeholder.name",
      }),
      required: true,
    },
    {
      id: "planId",
      label: "$saas.workspaces.admin.create.field.plan",
      description: "$saas.workspaces.admin.create.field.plan_description",
      type: new DefaultDataTypes.RelationType({
        placeholder: "$saas.workspaces.admin.create.placeholder.plan",
        dataApiController: plansDataAPI,
        keyMapping: { label: "name", value: "_id" },
      }),
      required: true,
    },
    {
      id: "ownerEmail",
      label: "$saas.workspaces.admin.create.field.owner_email",
      description:
        "$saas.workspaces.admin.create.field.owner_email_description",
      type: new DefaultDataTypes.EmailType({
        placeholder: "$saas.workspaces.admin.create.placeholder.owner_email",
      }),
      required: true,
    },
    {
      id: "freeWorkspace",
      label: "$saas.workspaces.admin.create.field.free_workspace",
      description:
        "$saas.workspaces.admin.create.field.free_workspace_description",
      type: new DefaultDataTypes.BooleanType(),
      defaultValue: true,
    },
    {
      id: "freeUntil",
      label: "$saas.workspaces.admin.create.field.free_until",
      description: "$saas.workspaces.admin.create.field.free_until_description",
      type: new DefaultDataTypes.DateType(),
    },
  ],
  fieldsOrientation: "vertical",
  submitUrl: "/modules/saas/customers/workspaces/create",
  submitUrlMethod: HttpMethod.post,
  successMessage: "$saas.workspaces.admin.create.success",
});

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
}

async function provisionTenantWithOwner(
  tenantModel: TenantModel,
  name: string,
  ownerEmail: string,
  ownerLanguage: string,
  now: Date,
): Promise<ProvisionedTenant> {
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
    sendEmail: true,
  });
  return { tenantId, inviteResult };
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
          component: workspaceCreateForm,
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
    const { tenantId, inviteResult } = await provisionTenantWithOwner(
      this.tenantModel,
      input.name,
      input.ownerEmail,
      user.language,
      now,
    );

    if (!checkoutInput) {
      await insertFreeSubscription(
        tenantId,
        input.planId,
        user._id,
        now,
        input.freeUntil,
      );
      await recomputeTenantBillingState(tenantId);
      return { tenantId, owner: inviteResult, checkoutUrl: null };
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
    return { tenantId, owner: inviteResult, checkoutUrl: checkout.url };
  }
}
