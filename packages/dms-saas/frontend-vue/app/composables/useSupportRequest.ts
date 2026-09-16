interface PendingSupportRequest {
  requestId: string;
  fingerprint: string;
}

interface SupportRequestIdentity {
  requestId: string;
}

interface SupportTransportError {
  statusCode?: number;
  status?: number;
  data?: unknown;
}

type SupportRequestBody<T> = T & SupportRequestIdentity;
type SupportSender<T, R> = (body: SupportRequestBody<T>) => Promise<R>;
const TERMINAL_STATUSES = new Set([400, 409, 422]);
const STORAGE_PREFIX = "saas:support-request:";

async function fingerprint(payload: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isTerminal(error: unknown): boolean {
  const result = error as SupportTransportError | null;
  return (
    TERMINAL_STATUSES.has(result?.statusCode ?? result?.status ?? 0) &&
    typeof result?.data === "string" &&
    result.data.startsWith("saas.errors.support.")
  );
}

function clearPending(key: string, value: string): void {
  if (sessionStorage.getItem(key) === value) sessionStorage.removeItem(key);
}

/** Retains request identity across ambiguous transport and page reloads, without storing message content. */
export async function sendSupportRequest<T extends object, R>(
  scope: string,
  body: T,
  send: SupportSender<T, R>,
): Promise<R> {
  const payload = JSON.stringify(body);
  const digest = await fingerprint(payload);
  const key = `${STORAGE_PREFIX}${scope}`;
  const saved = sessionStorage.getItem(key);
  const pending: PendingSupportRequest = saved
    ? JSON.parse(saved)
    : { requestId: crypto.randomUUID(), fingerprint: digest };
  if (pending.fingerprint !== digest)
    throw new Error(
      "Retry the pending support request unchanged before submitting different content.",
    );
  const value = JSON.stringify(pending);
  sessionStorage.setItem(key, value);
  try {
    const result = await send({
      ...JSON.parse(payload),
      requestId: pending.requestId,
    } as SupportRequestBody<T>);
    clearPending(key, value);
    return result;
  } catch (error) {
    if (isTerminal(error)) clearPending(key, value);
    throw error;
  }
}
