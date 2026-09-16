import { describe, expect, it } from "vitest";
import {
  type PageLimits,
  parsePositiveInt,
  resolvePageBounds,
  slicePage,
} from "../src/utils/pagination";

const LIMITS: PageLimits = {
  defaultPageSize: 10,
  maxPageSize: 50,
  maxFetchLimit: 500,
};

function rows(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

describe("parsePositiveInt", () => {
  it("reads a positive integer", () => {
    expect(parsePositiveInt("7")).toBe(7);
  });

  it("keeps an absent parameter absent", () => {
    expect(parsePositiveInt(undefined)).toBeUndefined();
  });

  it.each(["0", "-3", "abc", "", "NaN"])(
    "rejects %j rather than passing it on",
    (value) => {
      expect(parsePositiveInt(value)).toBeUndefined();
    },
  );

  it.each(["7abc", "7.5", " 7", "+7", "1e3", "0x10"])(
    "rejects %j rather than reading a number out of it",
    (value) => {
      expect(parsePositiveInt(value)).toBeUndefined();
    },
  );
});

describe("resolvePageBounds", () => {
  it("falls back to the first page at the default size", () => {
    expect(resolvePageBounds({}, LIMITS)).toEqual({
      page: 1,
      pageSize: 10,
      offset: 0,
      fetchLimit: 11,
    });
  });

  it("offsets by the pages that precede the requested one", () => {
    expect(resolvePageBounds({ page: 3, pageSize: 5 }, LIMITS)).toEqual({
      page: 3,
      pageSize: 5,
      offset: 10,
      fetchLimit: 16,
    });
  });

  it("caps the page size so a caller cannot ask for an unbounded read", () => {
    const bounds = resolvePageBounds({ pageSize: 5000 }, LIMITS);

    expect(bounds.pageSize).toBe(LIMITS.maxPageSize);
    expect(bounds.fetchLimit).toBe(LIMITS.maxPageSize + 1);
  });

  it("caps how much a deep page reads, which the page size alone does not", () => {
    const bounds = resolvePageBounds({ page: 1_000_000, pageSize: 50 }, LIMITS);

    expect(bounds.fetchLimit).toBe(LIMITS.maxFetchLimit);
  });

  it("keeps the lookahead while the window has room for it", () => {
    const bounds = resolvePageBounds({ page: 2, pageSize: 10 }, LIMITS);

    expect(bounds.fetchLimit).toBe(21);
  });

  it("never reads less than one row per page", () => {
    expect(resolvePageBounds({ pageSize: 0 }, LIMITS).pageSize).toBe(1);
  });

  it("never offsets before the first page", () => {
    expect(resolvePageBounds({ page: 0 }, LIMITS).offset).toBe(0);
  });

  it("reads one row past the page, and only one", () => {
    const bounds = resolvePageBounds({ page: 2, pageSize: 10 }, LIMITS);

    expect(bounds.fetchLimit).toBe(bounds.offset + bounds.pageSize + 1);
  });
});

describe("slicePage", () => {
  it("cuts the requested page out of the prefix", () => {
    const bounds = resolvePageBounds({ page: 2, pageSize: 3 }, LIMITS);

    expect(slicePage(rows(7), bounds)).toEqual({
      items: [3, 4, 5],
      hasMore: true,
    });
  });

  it("reports no next page when the lookahead row is missing", () => {
    const bounds = resolvePageBounds({ page: 1, pageSize: 3 }, LIMITS);

    expect(slicePage(rows(3), bounds)).toEqual({
      items: [0, 1, 2],
      hasMore: false,
    });
  });

  it("reports a next page as soon as one row follows the page", () => {
    const bounds = resolvePageBounds({ page: 1, pageSize: 3 }, LIMITS);

    expect(slicePage(rows(4), bounds).hasMore).toBe(true);
  });

  it("yields an empty page past the end rather than throwing", () => {
    const bounds = resolvePageBounds({ page: 5, pageSize: 10 }, LIMITS);

    expect(slicePage(rows(3), bounds)).toEqual({ items: [], hasMore: false });
  });

  it("keeps a partial last page", () => {
    const bounds = resolvePageBounds({ page: 2, pageSize: 3 }, LIMITS);

    expect(slicePage(rows(5), bounds)).toEqual({
      items: [3, 4],
      hasMore: false,
    });
  });
});

describe("deep paging", () => {
  it("serves nothing past the readable window instead of reading further", () => {
    const bounds = resolvePageBounds({ page: 1_000_000, pageSize: 50 }, LIMITS);

    expect(slicePage(rows(LIMITS.maxFetchLimit), bounds)).toEqual({
      items: [],
      hasMore: false,
    });
  });

  it("reads the whole window and no more on the last page it can serve", () => {
    const page = LIMITS.maxFetchLimit / 10;
    const bounds = resolvePageBounds({ page, pageSize: 10 }, LIMITS);

    expect(bounds.fetchLimit).toBe(LIMITS.maxFetchLimit);
    expect(slicePage(rows(LIMITS.maxFetchLimit), bounds).items).toHaveLength(
      10,
    );
  });
});
