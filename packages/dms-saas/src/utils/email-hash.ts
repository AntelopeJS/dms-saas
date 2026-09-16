import { createHash } from "node:crypto";

/**
 * Stable identity hash for an email, used to detect trial reuse across the
 * register and plan-change flows without storing the raw address.
 */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
