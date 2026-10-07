import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  type ConfirmDialogSerialized,
  serializeConfirmDialog,
} from "@antelopejs/interface-dms/base/table-view";
import { FeatureModel, type Plan, PlanModel } from "../../db";
import { localizeFeature } from "../../plans";
import { plansUsingFeature } from "../../plans/feature-usage";
import {
  type PlanUsage,
  loadCatalogueUsage,
} from "../../plans/catalogue-usage";
import { formatMoney } from "../../plans/money";
import {
  CONTENT_LANGUAGE_HEADER,
  requestLocale,
} from "../../utils/content-language";

const HTTP_NOT_FOUND = 404;
const TEXTS = "$saas.catalog.plans.dialog";
const FEATURE_TEXTS = "$saas.catalog.features.dialog.delete";
const STRIPE_ID_PREVIEW_LENGTH = 12;
const ELLIPSIS = "…";

const NO_USAGE: PlanUsage = {
  workspaces: 0,
  paying: 0,
  trialing: 0,
  free: 0,
  seats: 0,
  members: 0,
  mrr: 0,
};

function shortStripeId(id: string): string {
  return id.length > STRIPE_ID_PREVIEW_LENGTH
    ? `${id.slice(0, STRIPE_ID_PREVIEW_LENGTH)}${ELLIPSIS}`
    : id;
}

/**
 * "Stop selling Team?": the plan leaves the pricing page and sign-up, nobody
 * is moved. A plan in use lists who stays on it and what keeps being billed.
 */
export function stopSellingDialog(
  plan: Plan,
  usage: PlanUsage,
  locale: string,
): ConfirmDialogSerialized {
  const isInUse = usage.workspaces > 0;
  return serializeConfirmDialog({
    title: `${TEXTS}.stop_selling.title`,
    description: isInUse
      ? `${TEXTS}.stop_selling.description_in_use`
      : `${TEXTS}.stop_selling.description_unused`,
    params: { name: plan.name },
    icon: "i-ph-pause",
    color: "warning",
    confirmLabel: `${TEXTS}.stop_selling.confirm`,
    impact: isInUse
      ? [
          {
            icon: "i-ph-buildings",
            label: `${TEXTS}.stop_selling.impact_workspaces`,
            count: usage.workspaces,
          },
          {
            icon: "i-ph-currency-circle-dollar",
            label: `${TEXTS}.stop_selling.impact_mrr`,
            count: formatMoney(usage.mrr, plan.currency, locale),
          },
          {
            icon: "i-ph-hourglass",
            label: `${TEXTS}.stop_selling.impact_trials`,
            count: usage.trialing,
          },
        ]
      : [],
  });
}

/**
 * "Delete plan Nonprofit?": only for a plan no workspace uses; otherwise the
 * dialog explains that it must be retired first.
 */
export function deletePlanDialog(
  plan: Plan,
  usage: PlanUsage,
): ConfirmDialogSerialized {
  if (usage.workspaces > 0) {
    return serializeConfirmDialog({
      title: `${TEXTS}.delete.blocked_title`,
      description: `${TEXTS}.delete.blocked_description`,
      params: { name: plan.name, count: usage.workspaces },
      icon: "i-ph-trash",
      color: "error",
      blocked: true,
    });
  }
  const productId = plan.paymentProviderRefs?.stripeProductId;
  return serializeConfirmDialog({
    title: `${TEXTS}.delete.title`,
    description: `${TEXTS}.delete.description`,
    params: { name: plan.name },
    icon: "i-ph-trash",
    color: "error",
    confirmLabel: `${TEXTS}.delete.confirm`,
    impact: [
      {
        icon: "i-ph-buildings",
        label: `${TEXTS}.delete.impact_workspaces`,
        count: 0,
      },
      ...(productId
        ? [
            {
              icon: "i-ph-stripe-logo",
              label: `${TEXTS}.delete.impact_stripe`,
              count: shortStripeId(productId),
            },
          ]
        : []),
    ],
  });
}

/** How far a feature reaches: plans storing it, workspaces relying on it. */
export interface FeatureReach {
  plans: number;
  workspaces: number;
}

/**
 * "Delete White-label emails?": only for a feature no plan stores a value
 * for; otherwise the dialog says how far it reaches and what to do instead.
 */
export function deleteFeatureDialog(
  displayName: string,
  reach: FeatureReach,
): ConfirmDialogSerialized {
  if (reach.plans > 0) {
    return serializeConfirmDialog({
      title: `${FEATURE_TEXTS}.blocked_title`,
      description: `${FEATURE_TEXTS}.blocked_description`,
      params: { name: displayName, count: reach.plans },
      icon: "i-ph-lock-simple",
      color: "warning",
      blocked: true,
      impact: [
        {
          icon: "i-ph-stack",
          label: `${FEATURE_TEXTS}.impact_plans`,
          count: reach.plans,
        },
        {
          icon: "i-ph-buildings",
          label: `${FEATURE_TEXTS}.impact_workspaces`,
          count: reach.workspaces,
        },
      ],
    });
  }
  return serializeConfirmDialog({
    title: `${FEATURE_TEXTS}.title`,
    description: `${FEATURE_TEXTS}.description`,
    params: { name: displayName },
    icon: "i-ph-trash",
    color: "error",
    confirmLabel: `${FEATURE_TEXTS}.confirm`,
  });
}

/** Dialogs the plan catalogue asks in before it changes a plan. */
export class SaasPlanDialogsController extends Controller(
  "/api/saas/plan-dialogs",
) {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(FeatureModel)
  declare featureModel: FeatureModel;

  private async featureReach(featureId: string): Promise<FeatureReach> {
    const [plans, usage] = await Promise.all([
      this.planModel.findNotDeleted(),
      loadCatalogueUsage(),
    ]);
    const resolved = await Promise.all(
      plans.map((plan) => this.planModel.resolveInheritance(plan)),
    );
    const relying = plans.filter((_plan, index) =>
      resolved[index].features.some((entry) => entry.featureId === featureId),
    );
    return {
      plans: plansUsingFeature(plans, featureId).length,
      workspaces: relying.reduce(
        (total, plan) => total + (usage.byPlan.get(plan._id)?.workspaces ?? 0),
        0,
      ),
    };
  }

  @Get("/features/:id/delete")
  async removeFeature(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<ConfirmDialogSerialized> {
    const feature = await this.featureModel.get(id);
    assert(feature, HTTP_NOT_FOUND, "saas.errors.feature.not_found");
    const localized = localizeFeature(feature, requestLocale(language));
    return deleteFeatureDialog(
      localized.displayName,
      await this.featureReach(id),
    );
  }

  private async load(id: string): Promise<[Plan, PlanUsage]> {
    const plan = await this.planModel.get(id);
    assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_found");
    const usage = await loadCatalogueUsage();
    return [plan, usage.byPlan.get(id) ?? NO_USAGE];
  }

  @Get("/:id/stop-selling")
  async stopSelling(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<ConfirmDialogSerialized> {
    const [plan, usage] = await this.load(id);
    return stopSellingDialog(plan, usage, requestLocale(language));
  }

  @Get("/:id/delete")
  async remove(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<ConfirmDialogSerialized> {
    const [plan, usage] = await this.load(id);
    return deletePlanDialog(plan, usage);
  }
}
