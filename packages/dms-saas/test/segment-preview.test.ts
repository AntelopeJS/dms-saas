import { describe, expect, it } from "vitest";
import type { SegmentConditionGroup } from "../src/db";
import { segmentExportRow } from "../src/routes/platformOwner/segments-export";
import {
  computeSegmentPreview,
  explainSegmentGroup,
  SEGMENT_PREVIEW_SAMPLE_SIZE,
  type UserProjection,
  type UserWorkspaceProjection,
} from "../src/utils";

const NOW = new Date("2026-10-07T12:00:00Z");

function workspace(
  patch: Partial<UserWorkspaceProjection>,
): UserWorkspaceProjection {
  return {
    _id: "w",
    name: "Workspace",
    createdAt: NOW,
    ageInDays: 100,
    status: "active",
    hasSubscription: true,
    hasStripeCustomer: true,
    isOnTrial: false,
    isFreeAccess: false,
    planId: "business",
    planName: "Business",
    currency: "EUR",
    mrr: 4900,
    isPaying: true,
    customerType: "business",
    membersCount: 5,
    totalRevenue: 100_000,
    daysSinceLastInvoice: 10,
    isOwner: true,
    ...patch,
  };
}

function user(id: string, patch: Partial<UserProjection> = {}): UserProjection {
  return {
    _id: id,
    email: `${id}@example.test`,
    name: id,
    language: "en",
    createdAt: NOW,
    ageInDays: 30,
    isValidated: true,
    daysSinceLastActive: 1,
    workspacesCount: 0,
    isOwnerOfAnyWorkspace: false,
    workspaces: [],
    ...patch,
  };
}

const USERS: UserProjection[] = [
  user("ada", {
    workspaces: [workspace({ name: "Initech", status: "past_due" })],
  }),
  user("bob", {
    workspaces: [workspace({ name: "Hooli", membersCount: 2 })],
  }),
  user("cyd", {
    workspaces: [workspace({ name: "Verdi", isOwner: false, membersCount: 1 })],
  }),
  user("dan", { isValidated: false }),
];

// Verified owners of a paying workspace that is past due or has fewer than
// 3 members.
const AT_RISK: SegmentConditionGroup = {
  logical: "and",
  conditions: [
    { field: "isValidated", operator: "eq", value: true },
    {
      kind: "workspaceRef",
      quantifier: "any",
      role: "owner",
      conditions: {
        logical: "and",
        conditions: [
          { field: "isPaying", operator: "eq", value: true },
          {
            logical: "or",
            conditions: [
              { field: "status", operator: "in", value: ["past_due"] },
              { field: "membersCount", operator: "lt", value: 3 },
            ],
          },
        ],
      },
    },
  ],
};

describe("segment preview", () => {
  it("counts the draft's matches against the saved members", () => {
    const preview = computeSegmentPreview({
      conditions: AT_RISK,
      users: USERS,
      savedMemberIds: new Set(["ada", "dan"]),
    });

    expect(preview).toMatchObject({
      matchCount: 2,
      totalUsers: 4,
      savedCount: 2,
      addedCount: 1,
      removedCount: 1,
    });
  });

  it("counts each condition on its own, workspace rules among their pool", () => {
    const { nodeCounts } = computeSegmentPreview({
      conditions: AT_RISK,
      users: USERS,
      savedMemberIds: null,
    });

    expect(nodeCounts).toEqual({
      "0": 3,
      "1": 2,
      "1.0": 2,
      "1.1": 2,
      "1.1.0": 1,
      "1.1.1": 1,
    });
  });

  it("counts the branches of an ANY group among the matching users", () => {
    const { signals } = computeSegmentPreview({
      conditions: AT_RISK,
      users: USERS,
      savedMemberIds: null,
    });

    expect(signals).toEqual([
      { path: "1.1.0", count: 1 },
      { path: "1.1.1", count: 1 },
    ]);
  });

  it("names the conditions every user meets", () => {
    const preview = computeSegmentPreview({
      conditions: {
        logical: "and",
        conditions: [
          { field: "daysSinceLastActive", operator: "gte", value: 0 },
        ],
      },
      users: USERS.slice(0, 3),
      savedMemberIds: new Set(),
    });

    expect(preview.matchCount).toBe(3);
    expect(preview.universalPaths).toEqual(["0"]);
  });

  it("lists the users the edit adds first, then by name", () => {
    const users = Array.from({ length: 7 }, (_, index) =>
      user(`user-${index}`),
    );
    const preview = computeSegmentPreview({
      conditions: {
        logical: "and",
        conditions: [{ field: "isValidated", operator: "eq", value: true }],
      },
      users,
      savedMemberIds: new Set(["user-0", "user-1", "user-2", "user-3"]),
    });

    expect(preview.sample).toHaveLength(SEGMENT_PREVIEW_SAMPLE_SIZE);
    expect(preview.sample.map((entry) => [entry._id, entry.isAdded])).toEqual([
      ["user-4", true],
      ["user-5", true],
      ["user-6", true],
      ["user-0", false],
      ["user-1", false],
    ]);
  });

  it("treats every match of a new segment as added", () => {
    const preview = computeSegmentPreview({
      conditions: AT_RISK,
      users: USERS,
      savedMemberIds: null,
    });

    expect(preview.savedCount).toBeNull();
    expect(preview.addedCount).toBe(2);
    expect(preview.removedCount).toBe(0);
    expect(preview.sample[0]).toMatchObject({
      _id: "ada",
      workspaceName: "Initech",
    });
  });
});

describe("why a user matches a segment", () => {
  it("keeps the branches met and names the workspaces meeting the rules", () => {
    const explanation = explainSegmentGroup(AT_RISK, USERS[0]!);

    expect(explanation).toEqual({
      logical: "and",
      conditions: [
        { field: "isValidated", operator: "eq", value: true },
        {
          kind: "workspaceRef",
          quantifier: "any",
          role: "owner",
          workspaceNames: ["Initech"],
          conditions: {
            logical: "and",
            conditions: [
              { field: "isPaying", operator: "eq", value: true },
              {
                logical: "or",
                conditions: [
                  { field: "status", operator: "in", value: ["past_due"] },
                ],
              },
            ],
          },
        },
      ],
    });
  });

  it("leaves out what a user no longer meets", () => {
    const explanation = explainSegmentGroup(AT_RISK, USERS[3]!);

    expect(explanation.conditions).toEqual([]);
  });
});

describe("segment CSV export", () => {
  it("lists who the user is, their workspaces and the MRR they own", () => {
    const row = segmentExportRow(
      user("eve", {
        workspaces: [
          workspace({ name: "Initech", mrr: 4900 }),
          workspace({ name: "Hooli", isOwner: false, mrr: 9900 }),
        ],
      }),
    );

    expect(row).toEqual([
      "eve",
      "eve@example.test",
      "eve",
      "en",
      NOW.toISOString(),
      "true",
      "Initech; Hooli",
      "Initech",
      "49.00",
    ]);
  });
});
