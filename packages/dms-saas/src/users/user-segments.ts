import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { SegmentModel, UserSegmentModel } from "../db";
import {
  evaluateSegmentGroup,
  type ExplainedGroup,
  explainSegmentGroup,
  loadUserProjection,
} from "../utils";

const HTTP_NOT_FOUND = 404;

/** A segment a user belongs to, and why. */
export interface UserSegmentMatch {
  _id: string;
  name: string;
  description: string;
  /** When the evaluation that put the user in the segment ran. */
  evaluatedAt: Date;
  /** The rules the user meets today. */
  explanation: ExplainedGroup;
  /**
   * The user still meets the rules today; false when their data changed
   * since the segment was last evaluated.
   */
  matchesNow: boolean;
}

/**
 * The segments the user belongs to, as last evaluated, each with the rules
 * they meet on today's data.
 */
export async function loadUserSegmentMatches(
  userId: string,
): Promise<UserSegmentMatch[]> {
  const user = await GetModel(UserModel).get(userId);
  assert(user, HTTP_NOT_FOUND, "saas.errors.user.not_found");
  const links = await GetModel(UserSegmentModel).listByUser(userId);
  if (links.length === 0) return [];
  const [segments, projection] = await Promise.all([
    GetModel(SegmentModel).getMany(links.map((link) => link.segmentId)),
    loadUserProjection(user),
  ]);
  const evaluatedAt = new Map(
    links.map((link) => [link.segmentId, link.evaluatedAt]),
  );
  return segments
    .map((segment) => ({
      _id: segment._id,
      name: segment.name,
      description: segment.description ?? "",
      evaluatedAt: evaluatedAt.get(segment._id) ?? segment.updatedAt,
      explanation: explainSegmentGroup(segment.conditions, projection),
      matchesNow: evaluateSegmentGroup(segment.conditions, projection),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
