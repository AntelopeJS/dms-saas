import {
  Context,
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import {
  toStagedKey,
  type PresignedUploadResponse,
} from "@antelopejs/interface-file-storage";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  PlanModel,
  type SupportMessage,
  SupportMessageModel,
  type SupportTicket,
  SupportTicketEventModel,
  SupportTicketModel,
  TenantSubscriptionModel,
} from "../../db";
import {
  notifyAllPlatformOwners,
  supportNewMessageSubject,
} from "../../notifications";
import {
  addSupportMessage,
  assertPriorityAllowed,
  createSupportTicket,
  getSupportAttachmentMetadata,
  parseSupportMessage,
  parseSupportRequestId,
  parseSupportTicket,
  reconcileSupportTicket,
  resolveTenantSupportPolicy,
  SUPPORT_ATTACHMENT_MAX_SIZE,
  SUPPORT_ATTACHMENT_MIMETYPES,
  type SupportAttachmentMetadata,
  type SupportModels,
  type SupportSlaPolicy,
  tenantSupportAttachmentPath,
} from "../../support";
import {
  createSupportUpload,
  getSupportUpload,
  parseSupportUpload,
} from "../../support/uploads";

const HTTP_NOT_FOUND = 404;
const PLATFORM_SUPPORT_PATH = "/modules/saas/support/support";

export interface SupportPageConfig {
  policy: SupportSlaPolicy;
  uploadPath: string;
  maxAttachmentSize: number;
  allowedMimetypes: readonly string[];
}

interface TenantSupportDetail {
  ticket: SupportTicket;
}

function supportModels(
  tickets: SupportTicketModel,
  messages: SupportMessageModel,
  events: SupportTicketEventModel,
): SupportModels {
  return { tickets, messages, events };
}

async function requireTenant(
  model: TenantModel,
  tenantId: string,
): Promise<NonNullable<Awaited<ReturnType<TenantModel["get"]>>>> {
  const tenant = await model.get(tenantId);
  assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
  return tenant;
}

export class SaasTenantSupportController extends Controller(
  "/api/saas/support",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Get("/config")
  async config(
    @AuthTenantMember() _user: User,
    @Context() ctx: RequestContext,
    @TenantScopedModel(TenantSubscriptionModel)
    subscriptions: TenantSubscriptionModel,
  ): Promise<SupportPageConfig> {
    const uploadPath = tenantSupportAttachmentPath(getRequestTenantId(ctx));
    return {
      policy: await resolveTenantSupportPolicy(subscriptions, this.planModel),
      uploadPath,
      maxAttachmentSize: SUPPORT_ATTACHMENT_MAX_SIZE,
      allowedMimetypes: SUPPORT_ATTACHMENT_MIMETYPES,
    };
  }

  @Post("/uploads")
  async upload(
    @AuthTenantMember() _user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: unknown,
  ): Promise<PresignedUploadResponse> {
    return createSupportUpload(
      getRequestTenantId(ctx),
      parseSupportUpload(body),
    );
  }

  @Post("/")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async create(
    @AuthTenantMember() user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: unknown,
    @TenantScopedModel(SupportTicketModel) tickets: SupportTicketModel,
    @TenantScopedModel(SupportMessageModel) messages: SupportMessageModel,
    @TenantScopedModel(TenantSubscriptionModel)
    subscriptions: TenantSubscriptionModel,
    @TenantScopedModel(SupportTicketEventModel) events: SupportTicketEventModel,
  ): Promise<SupportTicket> {
    const tenantId = getRequestTenantId(ctx);
    const input = parseSupportTicket(body);
    const tenant = await requireTenant(this.tenantModel, tenantId);
    const ticket = await createSupportTicket({
      tenant,
      authorId: user._id,
      requestId: parseSupportRequestId(body),
      input,
      models: supportModels(tickets, messages, events),
      validateNewRequest: async () => {
        const policy = await resolveTenantSupportPolicy(
          subscriptions,
          this.planModel,
        );
        assertPriorityAllowed(input.priority, policy);
      },
    });
    await notifyAllPlatformOwners(supportNewMessageSubject, {
      icon: "i-ph-lifebuoy",
      title: "$saas.notifications.payload.support_new_ticket.title",
      description: input.subject,
      linkTo: PLATFORM_SUPPORT_PATH,
    });
    return ticket;
  }

  @Get("/:ticketId")
  async detail(
    @AuthTenantMember() _user: User,
    @Parameter("ticketId") ticketId: string,
    @TenantScopedModel(SupportTicketModel) tickets: SupportTicketModel,
  ): Promise<TenantSupportDetail> {
    const ticket = await reconcileSupportTicket(tickets, ticketId);
    return { ticket };
  }

  @Post("/:ticketId/messages")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async reply(
    @AuthTenantMember() user: User,
    @Context() ctx: RequestContext,
    @Parameter("ticketId") ticketId: string,
    @JSONBody() body: unknown,
    @TenantScopedModel(SupportTicketModel) tickets: SupportTicketModel,
    @TenantScopedModel(SupportMessageModel) messages: SupportMessageModel,
    @TenantScopedModel(SupportTicketEventModel) events: SupportTicketEventModel,
  ): Promise<SupportMessage> {
    const tenantId = getRequestTenantId(ctx);
    const message = await addSupportMessage({
      tenantId,
      ticketId,
      authorId: user._id,
      authorName: user.name,
      authorType: "tenant",
      requestId: parseSupportRequestId(body),
      input: parseSupportMessage(body),
      models: supportModels(tickets, messages, events),
    });
    await notifyAllPlatformOwners(
      supportNewMessageSubject,
      {
        icon: "i-ph-chat-circle-text",
        title: "$saas.notifications.payload.support_tenant_reply.title",
        description:
          "$saas.notifications.payload.support_tenant_reply.description",
        linkTo: PLATFORM_SUPPORT_PATH,
      },
      user._id,
    );
    return message;
  }

  @Get("/:ticketId/attachment")
  // Request decorators bind arguments positionally; an options object cannot replace them.
  // oxlint-disable-next-line eslint/max-params
  async attachment(
    @AuthTenantMember() _user: User,
    @Context() ctx: RequestContext,
    @Parameter("ticketId") ticketId: string,
    @Parameter("resourceKey", "query") resourceKey: string,
    @TenantScopedModel(SupportTicketModel) tickets: SupportTicketModel,
    @TenantScopedModel(SupportMessageModel) messages: SupportMessageModel,
  ): Promise<SupportAttachmentMetadata> {
    await reconcileSupportTicket(tickets, ticketId);
    assert(
      await messages.hasAttachment(ticketId, resourceKey),
      HTTP_NOT_FOUND,
      "saas.errors.support.attachment_not_found",
    );
    const upload = await getSupportUpload(
      getRequestTenantId(ctx),
      toStagedKey(resourceKey),
    );
    return getSupportAttachmentMetadata(resourceKey, upload.storage);
  }
}
