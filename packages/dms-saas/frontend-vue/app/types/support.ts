export type SupportPriority = "low" | "normal" | "high" | "urgent";
export type SupportStatus =
  | "open"
  | "in_progress"
  | "waiting_customer"
  | "resolved"
  | "closed";
export type SupportCategory =
  | "question"
  | "incident"
  | "billing"
  | "feature_request";

export interface SupportTicketView {
  _id: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  createdBy: string;
  assignedTo: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessageView {
  _id: string;
  ticketId: string;
  authorId: string;
  authorType: "tenant" | "platform";
  body: string;
  attachments: string[];
  createdAt: string;
}

export interface SupportPageView<T> {
  results: T[];
  total: number;
  offset: number;
  limit: number;
}

export type SupportTicketEventType = "status_changed" | "assignment_changed";

export interface SupportTicketEventView {
  _id: string;
  ticketId: string;
  actorId: string;
  actorName: string;
  type: SupportTicketEventType;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface SupportThreadView {
  ticket: SupportTicketView;
  messages: SupportPageView<SupportMessageView>;
  events: SupportPageView<SupportTicketEventView>;
}

export interface SupportTicketDetailView {
  ticket: SupportTicketView;
}

export interface SupportPolicyView {
  level: "community" | "email" | "priority" | "dedicated";
  responseTargetHours: number | null;
  businessHoursOnly: boolean;
  priorities: SupportPriority[];
}

export interface SupportConfigView {
  policy: SupportPolicyView;
  uploadPath: string;
  maxAttachmentSize: number;
  allowedMimetypes: string[];
}

export interface SupportAttachmentView {
  resourceKey: string;
  filename: string;
  size: number;
  mimetype: string;
  url: string;
  expiresAt?: number;
}

export interface SupportTicketDraft {
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  body: string;
  attachments: string[];
}

export interface PlatformSupportTicketView extends SupportTicketView {
  _instance: string;
  tenantName: string;
}

export interface PlatformSupportTicketDetailView {
  ticket: SupportTicketView;
  tenantId: string;
  tenantName: string;
}

export interface PlatformSupportThreadView extends PlatformSupportTicketDetailView {
  messages: SupportPageView<SupportMessageView>;
  events: SupportPageView<SupportTicketEventView>;
}

export interface PlatformOwnerOptionView {
  _id: string;
  name: string;
  email: string;
}

export interface SupportTicketPatch {
  status?: SupportStatus;
  assignedTo?: string | null;
}
