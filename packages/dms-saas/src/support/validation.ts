import { assert } from "@antelopejs/interface-api-util";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "../db";
import { SUPPORT_ATTACHMENT_LIMIT } from "./config";

const HTTP_BAD_REQUEST = 400;
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 10_000;
const CATEGORY_SET = new Set<string>(SUPPORT_TICKET_CATEGORIES);
const PRIORITY_SET = new Set<string>(SUPPORT_TICKET_PRIORITIES);
const STATUS_SET = new Set<string>(SUPPORT_TICKET_STATUSES);
const REQUEST_ID = /^[a-zA-Z0-9_-]{16,128}$/;

interface SupportRequest {
  requestId?: unknown;
}

/** Requires caller-generated identity to survive ambiguous transport outcomes. */
export function assertSupportRequestId(
  value: unknown,
): asserts value is string {
  assert(
    typeof value === "string" && REQUEST_ID.test(value),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_request_id",
  );
}

/** Extracts the stable request identity without accepting a server UUID fallback. */
export function parseSupportRequestId(body: unknown): string {
  const request = body as SupportRequest | null;
  assertSupportRequestId(request?.requestId);
  return request.requestId;
}

export interface SupportMessageInput {
  body: string;
  attachments: string[];
}

export interface SupportTicketInput extends SupportMessageInput {
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
}

export function parseSupportMessage(body: unknown): SupportMessageInput {
  const value = body as Partial<SupportMessageInput> | null;
  const message = typeof value?.body === "string" ? value.body.trim() : "";
  const attachments = Array.isArray(value?.attachments)
    ? value.attachments.filter(
        (attachment): attachment is string =>
          typeof attachment === "string" && attachment.length > 0,
      )
    : [];
  assert(
    message.length > 0 && message.length <= MAX_MESSAGE_LENGTH,
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_message",
  );
  assert(
    attachments.length <= SUPPORT_ATTACHMENT_LIMIT,
    HTTP_BAD_REQUEST,
    "saas.errors.support.too_many_attachments",
  );
  assert(
    new Set(attachments).size === attachments.length,
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_attachments",
  );
  return { body: message, attachments };
}

export function parseSupportTicket(body: unknown): SupportTicketInput {
  const value = body as Partial<SupportTicketInput> | null;
  const subject =
    typeof value?.subject === "string" ? value.subject.trim() : "";
  assert(
    subject.length > 0 && subject.length <= MAX_SUBJECT_LENGTH,
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_subject",
  );
  assert(
    CATEGORY_SET.has(value?.category ?? ""),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_category",
  );
  assert(
    PRIORITY_SET.has(value?.priority ?? ""),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_priority",
  );
  return {
    subject,
    category: value?.category as SupportTicketCategory,
    priority: value?.priority as SupportTicketPriority,
    ...parseSupportMessage(value),
  };
}

export function parseSupportStatus(value: unknown): SupportTicketStatus {
  assert(
    typeof value === "string" && STATUS_SET.has(value),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_status",
  );
  return value as SupportTicketStatus;
}
