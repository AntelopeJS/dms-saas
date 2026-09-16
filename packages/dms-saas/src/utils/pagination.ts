const FIRST_PAGE = 1;
const MIN_PAGE_SIZE = 1;
/** Probes whether a further page exists without asking for its contents. */
const LOOKAHEAD = 1;

/** Digits only: `parseInt` alone would read "7abc" as 7 and pass garbage on. */
const POSITIVE_INT_PATTERN = /^\d+$/;

export function parsePositiveInt(
  value: string | undefined,
): number | undefined {
  if (value === undefined || !POSITIVE_INT_PATTERN.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export interface PageRequest {
  page?: number;
  pageSize?: number;
}

export interface PageBounds {
  page: number;
  pageSize: number;
  offset: number;
  /** Rows to read to fill the page and still know whether another follows. */
  fetchLimit: number;
}

export interface PageLimits {
  defaultPageSize: number;
  maxPageSize: number;
  /**
   * Ceiling on the rows a single request may read, and so on how deep paging
   * goes. Capping the page size alone would not bound anything: the prefix a
   * page is cut from grows with the page number, so a large enough one asks the
   * source to read the whole collection.
   */
  maxFetchLimit: number;
}

/**
 * Clamps a page request and states how much to read for it.
 *
 * `fetchLimit` covers everything up to the end of the page plus one row: a
 * source that only takes a limit, as the dms-base export listing does, cannot
 * be asked where a page starts, so the page is cut out of the prefix and the
 * extra row is what tells the caller a next page exists without counting the
 * whole collection.
 *
 * Past the readable window the page comes back empty rather than reading
 * further. On the row where the window ends the lookahead is what gets dropped,
 * so the page reports no successor — which is true of what this source will
 * serve, whatever else the collection still holds.
 */
export function resolvePageBounds(
  request: PageRequest,
  limits: PageLimits,
): PageBounds {
  const pageSize = Math.min(
    Math.max(request.pageSize ?? limits.defaultPageSize, MIN_PAGE_SIZE),
    limits.maxPageSize,
  );
  const page = Math.max(request.page ?? FIRST_PAGE, FIRST_PAGE);
  const offset = (page - FIRST_PAGE) * pageSize;
  return {
    page,
    pageSize,
    offset,
    fetchLimit: Math.min(offset + pageSize + LOOKAHEAD, limits.maxFetchLimit),
  };
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

/** Cuts the requested page out of a prefix read with {@link resolvePageBounds}. */
export function slicePage<T>(rows: readonly T[], bounds: PageBounds): Page<T> {
  const end = bounds.offset + bounds.pageSize;
  return {
    items: rows.slice(bounds.offset, end),
    hasMore: rows.length > end,
  };
}
