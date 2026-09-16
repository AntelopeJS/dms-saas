import { assert } from "@antelopejs/interface-api-util";
import type { SupportTicketStatus } from "../db";

const HTTP_BAD_REQUEST = 400;

const STATUS_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["waiting_customer", "resolved", "closed"],
  waiting_customer: ["in_progress", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

export function assertSupportStatusTransition(
  current: SupportTicketStatus,
  next: SupportTicketStatus,
): void {
  if (current === next) return;
  assert(
    STATUS_TRANSITIONS[current].includes(next),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_status_transition",
  );
}

export function statusAfterTenantMessage(
  current: SupportTicketStatus,
): SupportTicketStatus {
  if (current === "waiting_customer") return "in_progress";
  return current === "resolved" || current === "closed" ? "open" : current;
}

export function statusAfterPlatformReply(
  current: SupportTicketStatus,
): SupportTicketStatus {
  assert(
    current !== "closed",
    HTTP_BAD_REQUEST,
    "saas.errors.support.closed_ticket_reply",
  );
  return "waiting_customer";
}
