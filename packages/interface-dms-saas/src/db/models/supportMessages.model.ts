import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  SupportMessage,
  supportMessagesTableName,
} from "../tables/supportMessages.table";

/** Data access for support messages in one tenant schema. */
export class SupportMessageModel extends BasicDataModel(
  SupportMessage,
  supportMessagesTableName,
) {
  /** Checks attachment ownership without loading the conversation. */
  async hasAttachment(ticketId: string, resourceKey: string): Promise<boolean> {
    const count = await this.table
      .getAll(ticketId, "ticketId")
      .filter((row) => row.key("attachments").includes(resourceKey))
      .count()
      .run();
    return count > 0;
  }
}
