import { describe, expect, it } from "vitest";
import {
  type ExternalIdentityEntry,
  resolveEntryProvider,
} from "../src/auth/oauth-entry";

function identity(
  provider: string,
  lastLoginAt: string,
): ExternalIdentityEntry {
  return { provider, lastLoginAt: new Date(lastLoginAt) };
}

describe("resolveEntryProvider", () => {
  it("reports no provider for an account that only signs in with a password", () => {
    expect(resolveEntryProvider([])).toBeNull();
  });

  it("names the only bound provider", () => {
    expect(
      resolveEntryProvider([identity("github", "2026-08-01T10:00:00Z")]),
    ).toBe("github");
  });

  it("names the provider of the most recent login", () => {
    const identities = [
      identity("github", "2026-08-01T10:00:00Z"),
      identity("google", "2026-08-04T09:00:00Z"),
    ];

    expect(resolveEntryProvider(identities)).toBe("google");
  });

  it("ignores the stored order, not the login dates", () => {
    const identities = [
      identity("google", "2026-08-04T09:00:00Z"),
      identity("github", "2026-08-01T10:00:00Z"),
    ];

    expect(resolveEntryProvider(identities)).toBe("google");
  });

  it("keeps the first identity when two logins share a timestamp", () => {
    const identities = [
      identity("github", "2026-08-04T09:00:00Z"),
      identity("google", "2026-08-04T09:00:00Z"),
    ];

    expect(resolveEntryProvider(identities)).toBe("github");
  });
});
