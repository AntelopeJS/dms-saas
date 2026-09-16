import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import { ModelReference } from "@antelopejs/interface-data-api/metadata";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import {
  SupportMessage,
  SupportMessageModel,
  SupportTicket,
  SupportTicketEvent,
  SupportTicketEventModel,
  SupportTicketModel,
} from "../../db";
import {
  SupportEventFields,
  SupportMessageFields,
  SupportTicketFields,
} from "../support-fields";
import { supportReadRoutes } from "../support-routes";

/** Member-only tickets in the authenticated tenant. */
@RegisterDataController()
export class tenantSupportTicketsDataAPI extends DataController(
  SupportTicket,
  supportReadRoutes("tenant", "tickets"),
  Controller("/api/saas/tenant/tables/support-tickets", SupportTicketFields),
) {
  @ModelReference()
  @TenantScopedModel(SupportTicketModel)
  declare model: SupportTicketModel;
}

/** Member-only conversation with immutable route ticket scope. */
@RegisterDataController()
export class tenantSupportMessagesDataAPI extends DataController(
  SupportMessage,
  supportReadRoutes("tenant", "messages"),
  Controller("/api/saas/support/:ticketId/messages", SupportMessageFields),
) {
  @ModelReference()
  @TenantScopedModel(SupportMessageModel)
  declare model: SupportMessageModel;
}

/** Member-only ticket audit history. */
@RegisterDataController()
export class tenantSupportEventsDataAPI extends DataController(
  SupportTicketEvent,
  supportReadRoutes("tenant", "events"),
  Controller("/api/saas/support/:ticketId/events", SupportEventFields),
) {
  @ModelReference()
  @TenantScopedModel(SupportTicketEventModel)
  declare model: SupportTicketEventModel;
}
