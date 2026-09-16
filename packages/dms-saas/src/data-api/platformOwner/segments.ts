import { Controller, type RequestContext } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  DataController,
  type DataControllerCallback,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  Mandatory,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  Segment,
  type SegmentCondition,
  type SegmentConditionGroup,
  SegmentModel,
  type SegmentWorkspaceRef,
  UserSegmentModel,
} from "../../db";
import {
  findSegmentField,
  invalidateSegmentNamesCache,
  recomputeSegmentsByIds,
  SegmentConditionsType,
  type SegmentFieldCatalog,
} from "../../utils";

const HTTP_BAD_REQUEST = 400;
/**
 * Must cover the deepest tree the UI builder can produce, counted in
 * validator levels (root group = 1, each nested group/condition/workspaceRef
 * = +1). The builder nests groups down to UI depth 5 (root = 0); the deepest
 * leaf sits inside a workspaceRef added at UI depth 4: root(1) → group(2) →
 * group(3) → group(4) → group(5) → ref(6) → inner group(7) → condition(8).
 */
const MAX_CONDITION_DEPTH = 8;
const SEGMENTS_API_BASE = "/api/saas/segments";

interface DeleteParams {
  id: string | string[];
}

type SegmentNode =
  | SegmentCondition
  | SegmentConditionGroup
  | SegmentWorkspaceRef;

function validateWorkspaceRefNode(
  node: SegmentWorkspaceRef,
  depth: number,
  catalog: SegmentFieldCatalog,
): void {
  assert(
    catalog === "user",
    HTTP_BAD_REQUEST,
    "saas.errors.segments.invalid_conditions",
  );
  assert(
    node.quantifier === "any" || node.quantifier === "all",
    HTTP_BAD_REQUEST,
    "saas.errors.segments.invalid_quantifier",
  );
  assert(
    node.role === undefined || node.role === "member" || node.role === "owner",
    HTTP_BAD_REQUEST,
    "saas.errors.segments.invalid_role",
  );
  // The nested tree is evaluated against workspace projections, so it is
  // validated against the workspace catalog (and cannot nest another ref).
  validateConditionNode(node.conditions, depth + 1, "workspace");
}

function validateGroupNode(
  node: SegmentConditionGroup,
  depth: number,
  catalog: SegmentFieldCatalog,
): void {
  assert(
    node.logical === "and" || node.logical === "or",
    HTTP_BAD_REQUEST,
    "saas.errors.segments.invalid_logical",
  );
  assert(
    Array.isArray(node.conditions),
    HTTP_BAD_REQUEST,
    "saas.errors.segments.invalid_conditions",
  );
  for (const child of node.conditions) {
    validateConditionNode(child, depth + 1, catalog);
  }
}

function validateLeafCondition(
  condition: SegmentCondition,
  catalog: SegmentFieldCatalog,
): void {
  const field = findSegmentField(condition.field, catalog);
  assert(field, HTTP_BAD_REQUEST, "saas.errors.segments.unknown_field");
  assert(
    field.operators.includes(condition.operator),
    HTTP_BAD_REQUEST,
    "saas.errors.segments.invalid_operator",
  );
  if (condition.operator === "in" || condition.operator === "nin") {
    assert(
      Array.isArray(condition.value),
      HTTP_BAD_REQUEST,
      "saas.errors.segments.invalid_value",
    );
  }
}

function validateConditionNode(
  node: SegmentNode,
  depth: number,
  catalog: SegmentFieldCatalog,
): void {
  assert(
    depth <= MAX_CONDITION_DEPTH,
    HTTP_BAD_REQUEST,
    "saas.errors.segments.conditions_too_deep",
  );
  if ("kind" in node && node.kind === "workspaceRef") {
    validateWorkspaceRefNode(node, depth, catalog);
    return;
  }
  if ("logical" in node && node.logical !== undefined) {
    validateGroupNode(node, depth, catalog);
    return;
  }
  validateLeafCondition(node as SegmentCondition, catalog);
}

function parseAndValidateConditions(raw: unknown): SegmentConditionGroup {
  if (raw === undefined || raw === null || raw === "") {
    return { logical: "and", conditions: [] };
  }
  let parsed: SegmentConditionGroup;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as SegmentConditionGroup;
    } catch {
      assert(
        false,
        HTTP_BAD_REQUEST,
        "saas.errors.segments.invalid_conditions",
      );
    }
  } else if (typeof raw === "object") {
    parsed = raw as SegmentConditionGroup;
  } else {
    assert(false, HTTP_BAD_REQUEST, "saas.errors.segments.invalid_conditions");
  }
  validateConditionNode(parsed, 1, "user");
  return parsed;
}

function affectedSegmentIds(params: unknown, result: unknown): string[] {
  const editId = (params as { id?: unknown })?.id;
  if (typeof editId === "string" && editId.length > 0) return [editId];
  if (Array.isArray(result)) {
    return result.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function wrapWithConditionsValidation(
  base: DataControllerCallback,
): DataControllerCallback {
  return {
    ...base,
    func: async function (
      this: unknown,
      ctx: RequestContext,
      params: unknown,
      body: Buffer | string,
      ...rest: unknown[]
    ) {
      const raw = typeof body === "string" ? body : body.toString();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return base.func.call(this, ctx, params, body, ...rest);
      }
      if (parsed.conditions !== undefined) {
        parsed.conditions = parseAndValidateConditions(parsed.conditions);
      }
      const newBody = Buffer.from(JSON.stringify(parsed));
      const result = await base.func.call(this, ctx, params, newBody, ...rest);
      invalidateSegmentNamesCache();

      const ids = affectedSegmentIds(params, result);
      if (ids.length > 0) {
        void recomputeSegmentsByIds(ids).catch((error: unknown) => {
          Logging.Error(
            "[dms-saas] segment recompute after save failed",
            error,
          );
        });
      }
      return result;
    },
  };
}

function wrapDeleteWithCascade(
  base: DataControllerCallback,
): DataControllerCallback {
  return {
    ...base,
    func: async function (
      this: unknown,
      ctx: RequestContext,
      params: DeleteParams,
      ...rest: unknown[]
    ) {
      const result = await base.func.call(this, ctx, params, ...rest);
      invalidateSegmentNamesCache();
      const ids = Array.isArray(params.id) ? params.id : [params.id];
      const userSegmentModel = GetModel(UserSegmentModel);
      await Promise.all(
        ids.map((segmentId) =>
          userSegmentModel.cleanupUnpublishable(segmentId),
        ),
      );
      return result;
    },
  };
}

const segmentsRoutes = {
  ...TableViewRoutes.All,
  new: wrapWithConditionsValidation(TableViewRoutes.All.new),
  edit: wrapWithConditionsValidation(TableViewRoutes.All.edit),
  delete: wrapDeleteWithCascade(TableViewRoutes.All.delete),
};

@RegisterDataController()
@AuthOwnerOnly()
export class segmentsDataAPI extends DataController(
  Segment,
  segmentsRoutes,
  Controller("/api/saas/tables/segments"),
) {
  @ModelReference()
  @Model(SegmentModel)
  declare model: SegmentModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Mandatory("new", "edit")
  @Column({
    name: "$saas.segments.column.name",
    description: "$saas.segments.column.name_description",
    type: new DefaultDataTypes.StringType({
      placeholder: "$saas.segments.placeholder.name",
    }),
    filterable: true,
  })
  @Access(AccessMode.ReadWrite)
  declare name: string;

  @Select()
  @Searchable()
  @Exported()
  @Column({
    name: "$saas.segments.column.description",
    description: "$saas.segments.column.description_description",
    type: new DefaultDataTypes.StringType({ textarea: true, rows: 3 }),
  })
  @Access(AccessMode.ReadWrite)
  declare description: string;

  @Select()
  @Column({
    name: "$saas.segments.field.conditions",
    description: "$saas.segments.field.conditions_description",
    type: new SegmentConditionsType({
      fieldsCatalogUrl: `${SEGMENTS_API_BASE}/fields`,
    }),
  })
  @Access(AccessMode.ReadWrite)
  declare conditions: SegmentConditionGroup;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.segments.column.estimated_count",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  declare estimatedCount: number;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.segments.column.last_evaluated_at",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare lastEvaluatedAt: Date | null;
}
