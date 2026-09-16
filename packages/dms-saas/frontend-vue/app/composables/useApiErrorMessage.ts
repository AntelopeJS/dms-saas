/**
 * Resolves an unknown error thrown by `$authFetch` into a human-readable,
 * translated message.
 *
 * The backend signals failures with `assert(cond, status, "i18n.key")`, which
 * serializes the i18n key as the response body. ofetch exposes that body on
 * `error.data` (a string, or `{ message }` for some handlers), while
 * `error.message` only holds the generic "POST <url> 409" text — never show
 * that to the user. We translate the server key when it exists, otherwise fall
 * back to a caller-provided generic key.
 */
export function useApiErrorMessage() {
  const nuxtApp = useDmsApp();

  function extractServerKey(error: unknown): string | undefined {
    const data = (error as { data?: unknown } | undefined)?.data;
    if (typeof data === "string") return data;
    const message = (data as { message?: unknown } | undefined)?.message;
    return typeof message === "string" ? message : undefined;
  }

  /** Translated server message, or `undefined` when the server sent no usable key. */
  function resolveServerMessage(error: unknown): string | undefined {
    const { t, te } = nuxtApp.$i18n;
    const key = extractServerKey(error);
    return key && te(key) ? t(key) : undefined;
  }

  /** Translated server message, or the caller's generic fallback key. */
  function resolveApiError(error: unknown, fallbackKey: string): string {
    return resolveServerMessage(error) ?? nuxtApp.$i18n.t(fallbackKey);
  }

  return { resolveApiError, resolveServerMessage };
}
