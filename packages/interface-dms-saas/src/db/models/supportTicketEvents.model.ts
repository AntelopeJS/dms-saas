import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  SupportTicketEvent,
  supportTicketEventsTableName,
} from "../tables/supportTicketEvents.table";

/** Tenant-scoped ticket history access. */
export class SupportTicketEventModel extends BasicDataModel(
  SupportTicketEvent,
  supportTicketEventsTableName,
) {}
