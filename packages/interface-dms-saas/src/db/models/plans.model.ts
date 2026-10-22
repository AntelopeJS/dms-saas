import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  Plan,
  PLAN_FALLBACK_LOCALE,
  PLAN_LOCALIZED_FIELDS,
  type PlanFeatureValue,
  plansTableName,
} from "../tables/plans.table";

const MAX_INHERITANCE_DEPTH = 10;

export interface ResolvedPlanInheritance {
  permissions: string[];
  features: PlanFeatureValue[];
}

/** A plan with its localized texts unlocked in the fallback locale. */
function inFallbackLocale(plan: Plan): Plan {
  return plan.localize(PLAN_FALLBACK_LOCALE, PLAN_LOCALIZED_FIELDS);
}

function readPlans(rows: unknown[]): Plan[] {
  return rows
    .map((row) => PlanModel.fromDatabase(row))
    .filter((row): row is Plan => row !== undefined)
    .map(inFallbackLocale);
}

/**
 * Data access and inheritance resolution for SaaS plans.
 *
 * Every read returns plans whose localized texts (`name`, `description`,
 * `borderLabel`) are unlocked in {@link PLAN_FALLBACK_LOCALE}, the language
 * Stripe, journals and e-mails without a reader use. A screen re-reads them in
 * its reader's locale with `localizePlan()` from `/plans`.
 */
export class PlanModel extends BasicDataModel(Plan, plansTableName) {
  override async get(id: string): Promise<Plan | undefined> {
    const plan = await super.get(id);
    return plan && inFallbackLocale(plan);
  }

  override async getBy(index: keyof Plan, ...keys: unknown[]): Promise<Plan[]> {
    return (await super.getBy(index, ...keys)).map(inFallbackLocale);
  }

  override async getAll(): Promise<Plan[]> {
    return (await super.getAll()).map(inFallbackLocale);
  }

  async findNotDeleted(): Promise<Plan[]> {
    const rows = await this.table
      .filter((row) => row.key("isDeleted").eq(false))
      .run();
    return readPlans(rows);
  }

  async findActiveNotDeleted(): Promise<Plan[]> {
    const rows = await this.table
      .filter((row) =>
        row.key("isDeleted").eq(false).and(row.key("isActive").eq(true)),
      )
      .run();
    return readPlans(rows);
  }

  async findPubliclyVisible(): Promise<Plan[]> {
    const rows = await this.table
      .filter((row) =>
        row
          .key("isDeleted")
          .eq(false)
          .and(row.key("isActive").eq(true))
          .and(row.key("isPublic").eq(true)),
      )
      .run();
    return readPlans(rows);
  }

  async resolveInheritanceChain(plan: Plan): Promise<Plan[]> {
    const visited = new Set<string>();
    const chain: Plan[] = [];
    let current: Plan | undefined = plan;
    while (current && !visited.has(current._id)) {
      visited.add(current._id);
      chain.push(current);
      if (!current.inheritsFromPlanId) break;
      if (chain.length >= MAX_INHERITANCE_DEPTH) break;
      current = await this.get(current.inheritsFromPlanId);
    }
    return chain;
  }

  async resolveInheritance(plan: Plan): Promise<ResolvedPlanInheritance> {
    const chain = await this.resolveInheritanceChain(plan);
    const permissions = new Set<string>();
    const featureMap = new Map<string, unknown>();
    for (let i = chain.length - 1; i >= 0; i--) {
      const link = chain[i];
      for (const permission of link.permissions ?? []) {
        permissions.add(permission);
      }
      for (const feature of link.features ?? []) {
        featureMap.set(feature.featureId, feature.value);
      }
    }
    return {
      permissions: Array.from(permissions),
      features: Array.from(featureMap).map(([featureId, value]) => ({
        featureId,
        value,
      })),
    };
  }
}
