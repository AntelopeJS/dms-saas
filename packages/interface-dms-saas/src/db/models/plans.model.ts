import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  Plan,
  type PlanFeatureValue,
  plansTableName,
} from "../tables/plans.table";

const MAX_INHERITANCE_DEPTH = 10;

export interface ResolvedPlanInheritance {
  permissions: string[];
  features: PlanFeatureValue[];
}

/** Data access and inheritance resolution for SaaS plans. */
export class PlanModel extends BasicDataModel(Plan, plansTableName) {
  async findNotDeleted(): Promise<Plan[]> {
    const rows = await this.table
      .filter((row) => row.key("isDeleted").eq(false))
      .run();
    return rows
      .map((row) => PlanModel.fromDatabase(row))
      .filter((row): row is Plan => row !== undefined);
  }

  async findActiveNotDeleted(): Promise<Plan[]> {
    const rows = await this.table
      .filter((row) =>
        row.key("isDeleted").eq(false).and(row.key("isActive").eq(true)),
      )
      .run();
    return rows
      .map((row) => PlanModel.fromDatabase(row))
      .filter((row): row is Plan => row !== undefined);
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
    return rows
      .map((row) => PlanModel.fromDatabase(row))
      .filter((row): row is Plan => row !== undefined);
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
