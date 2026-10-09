import { describe, expect, it } from "vitest";
import {
  type UserDetail,
  type UserSecurity,
  userFactItems,
  userSecurityItems,
} from "../src/users";
import { LOCALES, missingKeys } from "./helpers/composed-text";

const SECURITY: UserSecurity = {
  signInMethods: ["password", "google"],
  twoFactorMethods: ["totp"],
  backupCodesLeft: 3,
  activeSessions: 2,
  sessionLocations: ["Paris", "Lyon"],
  isEmailVerified: false,
  verificationRequestedAt: new Date("2026-10-01T08:00:00Z"),
};

const USER: UserDetail = {
  _id: "u1",
  name: "Ada",
  email: "ada@example.com",
  avatar: null,
  language: "fr-FR",
  createdAt: new Date("2026-01-12T09:00:00Z"),
  lastActiveAt: new Date("2026-10-09T08:00:00Z"),
  lastSession: { browser: "Firefox", os: "Linux", location: "Paris" },
  isPlatformAdmin: false,
  isSelf: false,
  workspaces: [
    { tenantId: "t1", name: "Acme", isTenantOwner: true, joinedAt: null },
    { tenantId: "t2", name: "Beta", isTenantOwner: false, joinedAt: null },
  ],
  billedAsOwner: [
    { currency: "EUR", amount: 4900 },
    { currency: "USD", amount: 1200 },
  ],
  segmentCount: 0,
  security: SECURITY,
};

const fact = (user: UserDetail, id: string) =>
  userFactItems(user, "EUR").find((item) => item.id === id);
const row = (security: UserSecurity, id: string) =>
  userSecurityItems(security).find((item) => item.id === id);

describe("user facts", () => {
  it("names a shipped language in the reader's words, keeps any other code", () => {
    expect(fact(USER, "language")?.value).toEqual({
      key: "saas.users.detail_facts.languages.fr",
    });
    expect(fact({ ...USER, language: "de" }, "language")?.value).toBe("de");
  });

  it("dates the last activity relative to the moment it is read", () => {
    expect(fact(USER, "last-active")).toMatchObject({
      value: { params: { value: { type: "relative" } } },
      detail: "Firefox · Paris",
    });
  });

  it("adds what was billed in each currency", () => {
    expect(fact(USER, "billed")?.value).toEqual({
      key: "saas.text.sum_list",
      params: {
        first: { type: "money", value: 4900, currency: "EUR" },
        rest: { type: "money", value: 1200, currency: "USD" },
      },
    });
  });

  it("names known sign-in methods and capitalises a provider", () => {
    expect(row(SECURITY, "sign-in")?.value).toEqual({
      key: "saas.text.dot_list",
      params: {
        first: { key: "saas.users.security.method.password" },
        rest: "Google",
      },
    });
  });

  it("keeps the verification as a status pill", () => {
    expect(row(SECURITY, "email-verified")).toMatchObject({
      type: "status",
      value: "$saas.users.security.not_yet",
      tone: "warning",
    });
  });

  it.each(LOCALES)("%s has every key the user page names", (code) => {
    const bare: UserSecurity = {
      ...SECURITY,
      signInMethods: [],
      twoFactorMethods: [],
      activeSessions: 0,
      isEmailVerified: true,
    };
    const payloads = [
      userFactItems(USER, "EUR"),
      userFactItems(
        { ...USER, language: null, lastActiveAt: null, billedAsOwner: [] },
        "EUR",
      ),
      userSecurityItems(SECURITY),
      userSecurityItems(bare),
    ];
    expect(missingKeys(payloads, code)).toEqual([]);
  });
});
