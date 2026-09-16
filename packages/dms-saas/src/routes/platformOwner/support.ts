import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { toStagedKey } from "@antelopejs/interface-file-storage";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  type SupportMessage,
  SupportMessageModel,
  type SupportTicket,
  SupportTicketEventModel,
  SupportTicketModel,
} from "../../db";
import {
  notifyTenantMembers,
  supportNewMessageSubject,
  supportStatusChangedSubject,
} from "../../notifications";
import {
  addSupportMessage,
  getSupportAttachmentMetadata,
  parseSupportMessage,
  parseSupportRequestId,
  parseSupportStatus,
  reconcileSupportTicket,
  type SupportAttachmentMetadata,
  type SupportModels,
  type SupportTicketPatch,
  updateSupportTicket,
} from "../../support";
import {
  recoverSupportOperations,
  type SupportRecoveryPage,
} from "../../support/recovery";
import { getSupportUpload } from "../../support/uploads";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const TENANT_SUPPORT_PATH = "/settings/workspace/support";

interface UpdateSupportTicketBody {
  status?: unknown;
  assignedTo?: unknown;
}

interface PlatformSupportDetail {
  ticket: SupportTicket;
  tenantId: string;
  tenantName: string;
}

async function requireOwnerAssignment(
  users: UserModel,
  value: unknown,
): Promise<string | null> {
  if (value === null) return null;
  assert(
    typeof value === "string" && value.length > 0,
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_assignee",
  );
  const assignee = await users.get(value);
  assert(
    assignee?.owner,
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_assignee",
  );
  return value;
}

function resolveTicketUpdate(body: unknown): SupportTicketPatch {
  const value: UpdateSupportTicketBody =
    body && typeof body === "object" ? body : {};
  const patch: SupportTicketPatch = {};
  if (value.status !== undefined)
    patch.status = parseSupportStatus(value.status);
  if (value.assignedTo !== undefined) {
    assert(
      value.assignedTo === null ||
        (typeof value.assignedTo === "string" && value.assignedTo.length > 0),
      HTTP_BAD_REQUEST,
      "saas.errors.support.invalid_assignee",
    );
    patch.assignedTo = value.assignedTo;
  }
  return patch;
}

function tenantModels(tenantId: string): SupportModels {
  assert(
    tenantId.length > 0,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.not_found",
  );
  return {
    tickets: GetModel(SupportTicketModel, tenantId),
    messages: GetModel(SupportMessageModel, tenantId),
    events: GetModel(SupportTicketEventModel, tenantId),
  };
}

export class SaasPlatformSupportController extends Controller(
  "/api/saas/support/platform",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(UserModel)
  declare userModel: UserModel;

  @Post("/:tenantId/reconcile")
  async reconcile(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId") tenantId: string,
    @Parameter("after", "query") after = "",
  ): Promise<SupportRecoveryPage> {
    return recoverSupportOperations(tenantId, tenantModels(tenantId), after);
  }

  @Get("/:tenantId/:ticketId")
  async detail(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId") tenantId: string,
    @Parameter("ticketId") ticketId: string,
  ): Promise<PlatformSupportDetail> {
    const ticket = await reconcileSupportTicket(
      tenantModels(tenantId).tickets,
      ticketId,
    );
    const tenant = await this.tenantModel.get(tenantId);
    return { ticket, tenantId, tenantName: tenant?.name ?? tenantId };
  }

  @Post("/:tenantId/:ticketId/messages")
  async reply(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId") tenantId: string,
    @Parameter("ticketId") ticketId: string,
    @JSONBody() body: unknown,
  ): Promise<SupportMessage> {
    const input = parseSupportMessage(body);
    assert(
      input.attachments.length === 0,
      HTTP_BAD_REQUEST,
      "saas.errors.support.platform_attachments_not_available",
    );
    const message = await addSupportMessage({
      tenantId,
      ticketId,
      authorId: user._id,
      authorName: user.name,
      authorType: "platform",
      requestId: parseSupportRequestId(body),
      input,
      models: tenantModels(tenantId),
    });
    await notifyTenantMembers(tenantId, supportNewMessageSubject, {
      icon: "i-ph-chat-circle-text",
      title: "$saas.notifications.payload.support_platform_reply.title",
      description:
        "$saas.notifications.payload.support_platform_reply.description",
      linkTo: TENANT_SUPPORT_PATH,
    });
    return message;
  }

  @Put("/:tenantId/:ticketId")
  async update(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId") tenantId: string,
    @Parameter("ticketId") ticketId: string,
    @JSONBody() body: unknown,
  ): Promise<SupportTicket> {
    const models = tenantModels(tenantId);
    const input = resolveTicketUpdate(body);
    const previous = await reconcileSupportTicket(models.tickets, ticketId);
    const updated = await updateSupportTicket({
      tenantId,
      ticketId,
      requestId: parseSupportRequestId(body),
      input,
      models,
      actorId: user._id,
      actorName: user.name || user._id,
      validateNewRequest: async () => {
        if (input.assignedTo)
          await requireOwnerAssignment(this.userModel, input.assignedTo);
      },
    });
    if (previous.status !== updated.status)
      await notifyTenantMembers(tenantId, supportStatusChangedSubject, {
        icon: "i-ph-arrows-clockwise",
        title: "$saas.notifications.payload.support_status_changed.title",
        description: `$saas.support.status.${updated.status}`,
        linkTo: TENANT_SUPPORT_PATH,
      });
    return updated;
  }

  @Get("/:tenantId/:ticketId/attachment")
  async attachment(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId") tenantId: string,
    @Parameter("ticketId") ticketId: string,
    @Parameter("resourceKey", "query") resourceKey: string,
  ): Promise<SupportAttachmentMetadata> {
    const models = tenantModels(tenantId);
    await reconcileSupportTicket(models.tickets, ticketId);
    assert(
      await models.messages.hasAttachment(ticketId, resourceKey),
      HTTP_NOT_FOUND,
      "saas.errors.support.attachment_not_found",
    );
    const upload = await getSupportUpload(tenantId, toStagedKey(resourceKey));
    return getSupportAttachmentMetadata(resourceKey, upload.storage);
  }
}
