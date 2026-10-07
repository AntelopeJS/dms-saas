import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  headingAnchor,
  legalDocumentStamp,
  readingMinutes,
  resolveLegalBackTarget,
} from "../frontend-vue/app/build/public/legal";

const LEGAL_LAYOUT_PATH = new URL(
  "../frontend-vue/app/components/LegalLayout.vue",
  import.meta.url,
);
const ORIGIN = "https://app.example.com";
const PAGE = "/terms-and-conditions";

describe("LegalLayout Vue runtime", () => {
  it("loads public documents through the DMS API at browser runtime", () => {
    const source = readFileSync(LEGAL_LAYOUT_PATH, "utf8");

    // SSR has no route to the API's base URL; an anonymous visitor must not
    // go through the authenticated fetch, which sends them to sign-in.
    expect(source).not.toContain("useFetch");
    expect(source).not.toContain("$authFetch");
    expect(source).toContain("usePublicFetch()");
    expect(source).toContain("void loadDocument()");
  });
});

describe("legalDocumentStamp", () => {
  it("reads the document's own version when documents are versioned", () => {
    const stamp = legalDocumentStamp(
      {
        updatedAt: "2026-09-30T00:00:00.000Z",
        versions: {
          termsAndConditions: {
            version: 4,
            publishedAt: "2026-09-12T00:00:00.000Z",
          },
        },
      },
      "termsAndConditions",
    );

    expect(stamp).toEqual({
      version: 4,
      updatedAt: "2026-09-12T00:00:00.000Z",
    });
  });

  it("falls back to the save date when versions are missing", () => {
    expect(
      legalDocumentStamp(
        { updatedAt: "2026-09-30T00:00:00.000Z" },
        "privacyPolicy",
      ),
    ).toEqual({ version: null, updatedAt: "2026-09-30T00:00:00.000Z" });
  });

  it("shows no date for documents never saved", () => {
    expect(
      legalDocumentStamp({ updatedAt: new Date(0).toISOString() }, "termsOfUse")
        .updatedAt,
    ).toBeNull();
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
      "/auth/login",
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
    ).toBe("/auth/login");
    expect(resolveLegalBackTarget(undefined, "", ORIGIN, PAGE)).toBe(
      "/auth/login",
    );
    expect(
      resolveLegalBackTarget(undefined, `${ORIGIN}${PAGE}`, ORIGIN, PAGE),
    ).toBe("/auth/login");
  });
});
