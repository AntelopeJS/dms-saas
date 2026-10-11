import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  getWorkspaceOperatorOptions,
  grantBalanceCreditCommand,
  manuallyUpgradeWorkspaceCommand,
  operatorActorOf,
  reactivateWorkspaceCommand,
  suspendWorkspaceCommand,
  type WorkspaceOperatorOptions,
} from "../../operator-actions";
import { OperatorActionModel } from "../../operator-actions/db/operator-action.model";
import {
  assertBalanceCreditWithinCeiling,
  balanceCreditCeilingMinor,
  loadSuspensionImpact,
  type NextInvoiceRef,
  nextInvoiceOf,
  safeUpcomingInvoice,
  type SuspensionImpact,
} from "../../operator-actions/previews";
import {
  previewManualUpgrade,
  type UpgradePreview,
} from "../../operator-actions/upgrade-preview";
import { ProvisioningAttemptModel } from "../../workspaces/db/provisioning-attempt.model";
import { loadWorkspaceOperatorView } from "../../workspaces/operator-view";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

interface OperationBody {
  operationId?: unknown;
}

interface SuspendBody extends OperationBody {
  /** The workspace name, typed by the operator to confirm. */
  confirmName?: unknown;
}

interface ManualUpgradeBody extends OperationBody {
  planId?: unknown;
}

interface BalanceCreditBody extends OperationBody {
  amountCents?: unknown;
  reason?: unknown;
}

interface ValidatedCreditInput {
  amountCents: number;
  reason: string;
}

/** The operator options, with the credit ceiling and the next invoice. */
interface OperatorOptionsResponse extends WorkspaceOperatorOptions {
  creditCeilingMinor: number;
  nextInvoice: NextInvoiceRef | null;
}

function requireString(value: unknown, errorCode: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  assert(normalized, HTTP_BAD_REQUEST, errorCode);
  return normalized;
}

function operationIdOf(body: OperationBody): string {
  return requireString(
    body.operationId,
    "saas.errors.operator.invalid_operation_id",
  );
}

function creditInputOf(body: BalanceCreditBody): ValidatedCreditInput {
  assert(
    typeof body.amountCents === "number",
    HTTP_BAD_REQUEST,
    "saas.errors.operator.invalid_credit_amount",
  );
  return {
    amountCents: body.amountCents,
    reason: requireString(
      body.reason,
      "saas.errors.operator.invalid_credit_reason",
    ),
  };
}

export class SaasWorkspaceOperatorActionsController extends Controller(
  "/api/saas/workspaces",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  private async assertTenantExists(tenantId: string): Promise<string> {
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    return tenant.name;
  }

  /** List bounded recovery evidence, including attempts that never created a core tenant. */
  @Get("/provisioning-attempts")
  async getProvisioningAttempts(@AuthOwnerOnly() _user: User) {
    return GetModel(ProvisioningAttemptModel).findUnresolved();
  }

  /** Inspect an attempt without replaying non-idempotent hooks. */
  @Get("/:tenantId/provisioning-attempt")
  async getProvisioningAttempt(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ) {
    const attempt = await GetModel(ProvisioningAttemptModel).get(tenantId);
    assert(attempt, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    return attempt;
  }

  /** Inspect durable recovery evidence without granting unsafe force-completion. */
  @Get("/:tenantId/operations/:operationId")
  async getOperation(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @Parameter("operationId", "param") operationId: string,
  ) {
    const action = await GetModel(OperatorActionModel).get(operationId);
    assert(
      action?.tenantId === tenantId,
      HTTP_NOT_FOUND,
      "saas.errors.workspace.not_found",
    );
    return {
      operationId: action._id,
      status: action.status,
      action: action.action,
      details: action.details,
      lastErrorCode: action.lastErrorCode,
      requiresReconciliation: ["running", "reconciliation_required"].includes(
        action.status,
      ),
      reconciliationRequirements: [
        "previous_executor_quiescent",
        "external_outcome_established",
      ],
    };
  }

  @Get("/:tenantId/operator-options")
  async getOptions(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<OperatorOptionsResponse> {
    const view = await loadWorkspaceOperatorView(tenantId);
    const [options, preview] = await Promise.all([
      getWorkspaceOperatorOptions(tenantId),
      safeUpcomingInvoice(tenantId),
    ]);
    return {
      ...options,
      creditCeilingMinor: balanceCreditCeilingMinor(view),
      nextInvoice: nextInvoiceOf(preview),
    };
  }

  /** What suspending or reactivating changes, for the confirmation dialog. */
  @Get("/:tenantId/suspension-impact")
  async getSuspensionImpact(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<SuspensionImpact> {
    return loadSuspensionImpact(tenantId);
  }

  /** Suspends once the operator typed the workspace name, as the dialog asks. */
  @Post("/:tenantId/suspend")
  async suspend(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @JSONBody() body: SuspendBody,
  ) {
    const name = await this.assertTenantExists(tenantId);
    assert(
      typeof body.confirmName === "string" &&
        body.confirmName.trim() === name.trim(),
      HTTP_BAD_REQUEST,
      "saas.errors.workspace.confirmation_mismatch",
    );
    return suspendWorkspaceCommand({
      tenantId,
      operationId: operationIdOf(body),
      actor: operatorActorOf(user),
    });
  }

  @Post("/:tenantId/unsuspend")
  async unsuspend(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @JSONBody() body: OperationBody,
  ) {
    await this.assertTenantExists(tenantId);
    return reactivateWorkspaceCommand({
      tenantId,
      operationId: operationIdOf(body),
      actor: operatorActorOf(user),
    });
  }

  /** Stripe's prorated preview of an immediate upgrade, before it runs. */
  @Get("/:tenantId/upgrade-preview")
  async getUpgradePreview(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @Parameter("planId", "query") planId: unknown,
  ): Promise<UpgradePreview> {
    return previewManualUpgrade(
      tenantId,
      requireString(planId, "saas.errors.operator.target_plan_required"),
    );
  }

  @Post("/:tenantId/upgrade")
  async upgrade(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @JSONBody() body: ManualUpgradeBody,
  ) {
    await this.assertTenantExists(tenantId);
    return manuallyUpgradeWorkspaceCommand({
      tenantId,
      operationId: operationIdOf(body),
      actor: operatorActorOf(user),
      targetPlanId: requireString(
        body.planId,
        "saas.errors.operator.target_plan_required",
      ),
    });
  }

  /** Credits the Stripe balance, within a year of what the plan bills. */
  @Post("/:tenantId/balance-credit")
  async grantCredit(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @JSONBody() body: BalanceCreditBody,
  ) {
    const credit = creditInputOf(body);
    const view = await loadWorkspaceOperatorView(tenantId);
    assertBalanceCreditWithinCeiling(view, credit.amountCents);
    return grantBalanceCreditCommand({
      tenantId,
      operationId: operationIdOf(body),
      actor: operatorActorOf(user),
      ...credit,
    });
  }
}
