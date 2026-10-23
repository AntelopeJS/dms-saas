import { describe, expect, it } from "vitest";
import {
  headingAnchor,
  legalDocumentStamp,
  readingMinutes,
  resolveLegalBackTarget,
} from "../frontend-vue/app/build/public/legal";

const ORIGIN = "https://app.example.com";
const PAGE = "/terms-and-conditions";

describe("legalDocumentStamp", () => {
  const NEVER = { version: 0, publishedAt: null };

  it("reads the document's own version and publication date", () => {
    const stamp = legalDocumentStamp(
      {
        termsOfUse: "",
        termsAndConditions: "<p>Terms</p>",
        privacyPolicy: "",
        versions: {
          termsOfUse: NEVER,
          termsAndConditions: {
            version: 4,
            publishedAt: "2026-09-12T00:00:00.000Z",
          },
          privacyPolicy: NEVER,
        },
      },
      "termsAndConditions",
    );

    expect(stamp).toEqual({
      version: 4,
      updatedAt: "2026-09-12T00:00:00.000Z",
    });
  });
});

describe("headingAnchor", () => {
  it("gives readable, unique ids", () => {
    const taken = new Set<string>();

    expect(headingAnchor("Who we are", taken)).toBe("section-who-we-are");
    expect(headingAnchor("Who we are", taken)).toBe("section-who-we-are-2");
    expect(headingAnchor("Données & vie privée", taken)).toBe(
      "section-données-vie-privée",
    );
  });

  it("numbers headings with no letters", () => {
    expect(headingAnchor("—", new Set(["a"]))).toBe("section-2");
  });
});

describe("readingMinutes", () => {
  it("rounds up, never below a minute", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("word ".repeat(201))).toBe(2);
  });
});

describe("resolveLegalBackTarget", () => {
  it("prefers the page named by ?from=", () => {
    expect(resolveLegalBackTarget("/register?plan=pro", "", ORIGIN, PAGE)).toBe(
      "/register?plan=pro",
    );
  });

  it("refuses another origin in ?from=", () => {
    expect(resolveLegalBackTarget("//evil.example", "", ORIGIN, PAGE)).toBe(
      "/auth",
    );
  });

  it("returns to the page of this site the visitor came from", () => {
    expect(
      resolveLegalBackTarget(undefined, `${ORIGIN}/pricing?x=1`, ORIGIN, PAGE),
    ).toBe("/pricing?x=1");
  });

  it("falls back to sign-in for another site or no referrer", () => {
    expect(
      resolveLegalBackTarget(undefined, "https://other.example/", ORIGIN, PAGE),
    ).toBe("/auth");
    expect(resolveLegalBackTarget(undefined, "", ORIGIN, PAGE)).toBe("/auth");
    expect(
      resolveLegalBackTarget(undefined, `${ORIGIN}${PAGE}`, ORIGIN, PAGE),
    ).toBe("/auth");
  });
});
