import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Filter,
  Joined,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { Tenant } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { Searchable } from "@antelopejs/interface-dms/base";
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
import { supportReadRoutes, supportTenantId } from "../support-routes";
import { HiddenStringFilter } from "./hidden-filter";

/** Owner-only cross-instance inbox, without a central copy. */
@RegisterDataController()
@AuthOwnerOnly()
export class supportTicketsDataAPI extends DataController(
  SupportTicket,
  supportReadRoutes("platform", "tickets"),
  Controller("/api/saas/tables/support-tickets", SupportTicketFields),
) {
  @ModelReference()
  @Model(SupportTicketModel, CROSS_INSTANCE)
  declare model: SupportTicketModel;
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare _instance: string;
  @Listable(["_instance"])
  @Searchable()
  @Sortable({ noIndex: true })
  @Joined({ table: Tenant, localKey: "_instance", remoteField: "name" })
  @Access(AccessMode.ReadOnly)
  declare tenantName: string;
}

/** Owner-only conversation in the explicitly selected tenant. */
@RegisterDataController()
@AuthOwnerOnly()
export class supportMessagesDataAPI extends DataController(
  SupportMessage,
  supportReadRoutes("platform", "messages"),
  Controller(
    "/api/saas/support/platform/:tenantId/:ticketId/messages",
    SupportMessageFields,
  ),
) {
  @ModelReference()
  @Model(SupportMessageModel, supportTenantId)
  declare model: SupportMessageModel;
}

/** Owner-only ticket audit history. */
@RegisterDataController()
@AuthOwnerOnly()
export class supportEventsDataAPI extends DataController(
  SupportTicketEvent,
  supportReadRoutes("platform", "events"),
  Controller(
    "/api/saas/support/platform/:tenantId/:ticketId/events",
    SupportEventFields,
  ),
) {
  @ModelReference()
  @Model(SupportTicketEventModel, supportTenantId)
  declare model: SupportTicketEventModel;
}

/** Bounded owner directory for assigning tickets. */
@RegisterDataController()
@AuthOwnerOnly()
export class supportOwnersDataAPI extends DataController(
  User,
  supportReadRoutes("platform", "owners"),
  Controller("/api/saas/tables/support-owners"),
) {
  @ModelReference()
  @Model(UserModel)
  declare model: UserModel;
  @Filter((_ctx, proxy) => proxy.eq(true), false)
  @Access(AccessMode.ReadOnly)
  declare owner: boolean;
  @Listable()
  @Sortable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;
  @Listable()
  @Searchable()
  @Sortable({ noIndex: true })
  @Access(AccessMode.ReadOnly)
  declare name: string;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare email: string;
}
