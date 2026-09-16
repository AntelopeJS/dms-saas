import { describe, expect, it } from "vitest";
import { resolveFreePlanAvailability } from "../src/workspaces/free-workspace-guard";

const DEFAULT_LIMIT = 1;

describe("resolveFreePlanAvailability", () => {
  it("offers Free when the user has no card on file yet", () => {
    expect(resolveFreePlanAvailability([], DEFAULT_LIMIT)).toEqual({
      isAvailable: true,
      blockingWorkspaceName: null,
    });
  });

  it("offers Free when a known card is still below the limit", () => {
    expect(resolveFreePlanAvailability([[]], DEFAULT_LIMIT)).toEqual({
      isAvailable: true,
      blockingWorkspaceName: null,
    });
  });

  it("blocks Free and names the workspace holding the only card", () => {
    expect(resolveFreePlanAvailability([["Perso"]], DEFAULT_LIMIT)).toEqual({
      isAvailable: false,
      blockingWorkspaceName: "Perso",
    });
  });

  it("keeps Free available when a second card still has room", () => {
    const availability = resolveFreePlanAvailability(
      [["Perso"], []],
      DEFAULT_LIMIT,
    );

    expect(availability.isAvailable).toBe(true);
  });

  it("follows a raised limit instead of assuming one free workspace", () => {
    const raisedLimit = 2;

    expect(
      resolveFreePlanAvailability([["Perso"]], raisedLimit).isAvailable,
    ).toBe(true);
    expect(
      resolveFreePlanAvailability([["Perso", "Side"]], raisedLimit),
    ).toEqual({ isAvailable: false, blockingWorkspaceName: "Perso" });
  });

  it("blocks Free when a zero limit forbids it outright", () => {
    expect(resolveFreePlanAvailability([[]], 0).isAvailable).toBe(false);
  });
});
