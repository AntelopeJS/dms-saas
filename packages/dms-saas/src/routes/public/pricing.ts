import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { Model } from "@antelopejs/interface-database-decorators";
import { PlanModel } from "../../db";
import {
  CONTENT_LANGUAGE_HEADER,
  requestLocale,
} from "../../utils/content-language";
import { resolveDefaultPlan } from "../../workspaces";
import {
  loadPublicBillingRules,
  loadPublicPlanCatalog,
  type PublicBillingRules,
  type PublicPlanCatalog,
} from "./public-plan-catalog";

/** What the public pricing page renders: plans, comparison rows, FAQ facts. */
export interface PublicPricing extends PublicPlanCatalog {
  rules: PublicBillingRules;
  /** The plan every sign-up opens on, when it is on sale. */
  defaultPlanId: string | null;
}

/**
 * Public catalogue: the active plans marked public, read by anonymous
 * visitors on `/pricing`. Served whether or not the bundled pricing page is,
 * so a deployment that replaced it can build its own on the same data.
 */
export class SaasPricingController extends Controller("/api/saas/pricing") {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Get("/")
  async getPricing(
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<PublicPricing> {
    const [plans, rules, defaultPlan] = await Promise.all([
      this.planModel.findPubliclyVisible(),
      loadPublicBillingRules(),
      resolveDefaultPlan(),
    ]);
    const catalog = await loadPublicPlanCatalog(plans, requestLocale(language));
    const isDefaultOnSale = plans.some((plan) => plan._id === defaultPlan?._id);
    return {
      ...catalog,
      rules,
      defaultPlanId: isDefaultOnSale ? (defaultPlan?._id ?? null) : null,
    };
  }
}
