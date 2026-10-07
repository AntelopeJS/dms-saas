import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { PlanModel } from "../../db";
import {
  createSegment,
  duplicateSegment,
  evaluateSegment,
  loadSegmentDraft,
  previewSegment,
  saveSegment,
  type SegmentDraft,
  type SegmentEvaluation,
  type TimedSegmentPreview,
} from "../../segments";
import {
  parseSegmentConditions,
  parseSegmentInput,
  parseSegmentPatch,
  SEGMENT_FIELDS,
  type SegmentFieldDefinition,
  type SegmentInputBody,
  USER_SEGMENT_FIELDS,
} from "../../utils";

interface PlanOption {
  _id: string;
  name: string;
  currency: string;
}

/** The fields a rule can read, as the segment builder lists them. */
export interface SegmentFieldsCatalog {
  /** Fields of a workspace, inside a "user's workspaces" condition. */
  fields: readonly SegmentFieldDefinition[];
  /** Fields of a user, at the root of the rules. */
  userFields: readonly SegmentFieldDefinition[];
  plans: PlanOption[];
}

/** What the preview route receives: the rules being edited. */
export interface SegmentPreviewBody {
  conditions?: unknown;
  /** The segment being edited, to compare with its saved version. */
  segmentId?: unknown;
}

@AuthOwnerOnly()
export class SaasSegmentsApiController extends Controller(
  "/api/saas/segments",
) {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Get("/fields")
  async fields(@AuthOwnerOnly() _user: User): Promise<SegmentFieldsCatalog> {
    const plans = await this.planModel.getAll();
    return {
      fields: SEGMENT_FIELDS,
      userFields: USER_SEGMENT_FIELDS,
      plans: plans
        .filter((plan) => !plan.isDeleted)
        .map((plan) => ({
          _id: plan._id,
          name: plan.name,
          currency: plan.currency,
        })),
    };
  }

  @Post("/preview")
  preview(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: SegmentPreviewBody,
  ): Promise<TimedSegmentPreview> {
    const segmentId =
      typeof body?.segmentId === "string" && body.segmentId
        ? body.segmentId
        : undefined;
    return previewSegment(parseSegmentConditions(body?.conditions), segmentId);
  }

  @Post("/")
  create(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: SegmentInputBody,
  ): Promise<SegmentEvaluation> {
    return createSegment(parseSegmentInput(body ?? {}));
  }

  @Get("/:id")
  draft(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<SegmentDraft> {
    return loadSegmentDraft(id);
  }

  @Put("/:id")
  save(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
    @JSONBody() body: SegmentInputBody,
  ): Promise<SegmentEvaluation> {
    return saveSegment(id, parseSegmentPatch(body ?? {}));
  }

  @Post("/:id/evaluate")
  evaluate(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<SegmentEvaluation> {
    return evaluateSegment(id);
  }

  @Post("/:id/duplicate")
  duplicate(
    @AuthOwnerOnly() _user: User,
    @Parameter("id") id: string,
  ): Promise<SegmentEvaluation> {
    return duplicateSegment(id);
  }
}
