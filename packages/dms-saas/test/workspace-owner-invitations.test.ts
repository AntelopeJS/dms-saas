import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel, type User } from "@antelopejs/interface-dms/auth/db";
import {
  TenantModel,
  type UserInvite,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { applyTenantOwnership } from "@antelopejs/interface-dms/tenant-ownership";
import { fromPartial } from "@total-typescript/shoehorn";
import { assert, describe, expect, it, vi } from "vitest";
import { loadDirectoryOwner } from "../src/billing-state/directory";
import { invitationsDataAPI } from "../src/data-api/platformOwner/invitations";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { SaasWorkspaceInvitationsController } from "../src/routes/platformOwner/workspace-invitations";
import {
  CONSOLE_URL,
  WORKSPACE_NAME,
  createInvitedWorkspace,
  createWorkspaceFor,
  operator,
  useBackOffice,
} from "./helpers/operator-workspaces";
import { useMongoDatabase } from "./helpers/mongo";
import { httpRefusal } from "./helpers/refusal";

useMongoDatabase("owner-invitations");
const { sendInviteEmail, core } = useBackOffice();

const DAY_MS = 86_400_000;

function invitationsController(): SaasWorkspaceInvitationsController {
  const controller = new SaasWorkspaceInvitationsController();
  controller.tenantModel = GetModel(TenantModel);
  return controller;
}

async function storedInvite(tenantId: string): Promise<UserInvite> {
  const [invite] = await GetModel(UserInviteModel, tenantId).getAll();
  if (!invite) throw new Error("Expected a stored invitation");
  return invite;
}

async function journalFor(tenantId: string) {
  const actions = await GetModel(OperatorActionModel).getBy(
    "tenantId",
    tenantId,
  );
  return actions.filter((action) => action.action.startsWith("invitation."));
}

/** The journal past the creation's own invitation e-mail. */
async function journalAfterCreation(tenantId: string) {
  return (await journalFor(tenantId)).filter(
    (action) => action.action !== "invitation.send",
  );
}

function signupLinkOf(invite: Pick<UserInvite, "token" | "email">): string {
  const params = new URLSearchParams({
    token: invite.token,
    email: invite.email,
  });
  return `${CONSOLE_URL}/auth/signup?${params.toString()}`;
}

describe("back-office workspace creation for a new owner", () => {
  it("reports a delivered invitation email and invites the owner as tenant owner", async () => {
    const { email, tenantId, owner } = await createInvitedWorkspace();
    const created = await GetModel(UserInviteModel, tenantId).get(
      owner.inviteId,
    );

    await vi.waitFor(() =>
      expect(sendInviteEmail).toHaveBeenCalledWith(
        email,
        owner.token,
        undefined,
        {
          workspaceName: WORKSPACE_NAME,
          inviterName: "Olivia Operator",
          language: "en",
        },
      ),
    );
    expect(created).toMatchObject({ email, asTenantOwner: true });
    const sentDetails: unknown = expect.objectContaining({
      email,
      emailDelivery: "sent",
    });
    await vi.waitFor(async () =>
      expect(await journalFor(tenantId)).toEqual([
        expect.objectContaining({
          action: "invitation.send",
          status: "succeeded",
          details: sentDetails,
        }),
      ]),
    );
    expect(core.sendToUsers).not.toHaveBeenCalled();
  });

  it("answers before the invitation e-mail leaves", async () => {
    sendInviteEmail.mockReturnValue(new Promise<void>(() => undefined));

    const created = await createWorkspaceFor(`${randomUUID()}@example.test`);

    expect(created.invitationEmail).toBe("sending");
    expect(created.owner.kind).toBe("invited");
  });

  it("writes the invitation in the stored invitation language", async () => {
    const email = `${randomUUID()}@example.test`;
    const frenchOperator = fromPartial<User>({ ...operator, language: "fr" });

    const created = await createWorkspaceFor(email, frenchOperator);

    expect((await storedInvite(created.tenantId)).language).toBe("fr");
    await vi.waitFor(() =>
      expect(sendInviteEmail).toHaveBeenCalledWith(
        email,
        expect.any(String),
        undefined,
        expect.objectContaining({ language: "fr" }),
      ),
    );
  });

  it("leaves the inviter unnamed when the operator has no name", async () => {
    const email = `${randomUUID()}@example.test`;
    const namelessOperator = fromPartial<User>({ ...operator, name: " " });

    await createWorkspaceFor(email, namelessOperator);

    await vi.waitFor(() =>
      expect(sendInviteEmail).toHaveBeenCalledWith(
        email,
        expect.any(String),
        undefined,
        expect.objectContaining({
          workspaceName: WORKSPACE_NAME,
          inviterName: undefined,
        }),
      ),
    );
  });

  it("tells the operator afterwards that the invitation e-mail did not leave", async () => {
    sendInviteEmail.mockRejectedValue(new Error("render failed: 401"));
    const email = `${randomUUID()}@example.test`;

    const created = await createWorkspaceFor(email);

    expect(created.invitationEmail).toBe("sending");
    const invite = await storedInvite(created.tenantId);
    expect(invite).toMatchObject({ email });
    const failureSubject: unknown = expect.objectContaining({
      id: "saas.invitation_email_failed",
    });
    await vi.waitFor(() =>
      expect(core.sendToUsers).toHaveBeenCalledWith(
        [operator._id],
        expect.objectContaining({
          subject: failureSubject,
          params: { workspace: WORKSPACE_NAME, email },
          linkTo: `/modules/saas/customers/workspaces/${created.tenantId}`,
        }),
        undefined,
        `invitation-email-failed:${invite._id}`,
        expect.anything(),
      ),
    );
    const failedDetails: unknown = expect.objectContaining({
      emailDelivery: "failed",
    });
    expect(await journalFor(created.tenantId)).toEqual([
      expect.objectContaining({
        action: "invitation.send",
        details: failedDetails,
      }),
    ]);
  });

  it("sends no invitation when the owner already has an account", async () => {
    const email = `${randomUUID()}@example.test`;
    await GetModel(UserModel).insert({
      _id: randomUUID(),
      email,
      name: "Existing",
      language: "en",
    });

    const created = await createWorkspaceFor(email);

    expect(created.owner.kind).toBe("added");
    expect(created.invitationEmail).toBeNull();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });
});

describe("workspace owner in the directory", () => {
  it("shows the invitee while the owner invitation is pending", async () => {
    const { email, tenantId } = await createInvitedWorkspace();

    expect(await loadDirectoryOwner(tenantId)).toEqual({
      status: "invited",
      name: null,
      email,
    });
  });

  it("flags an owner invitation that can no longer be redeemed", async () => {
    const { email, tenantId, owner } = await createInvitedWorkspace();
    await GetModel(UserInviteModel, tenantId).update(owner.inviteId, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    expect(await loadDirectoryOwner(tenantId)).toEqual({
      status: "expired",
      name: null,
      email,
    });
  });

  it("shows the owner once they joined", async () => {
    const { tenantId } = await createInvitedWorkspace();
    const ownerId = randomUUID();
    await GetModel(UserModel).insert({
      _id: ownerId,
      email: "joined@example.test",
      name: "Joined",
      language: "en",
    });
    await applyTenantOwnership(GetModel(UserModel), ownerId, tenantId, {
      roleIds: [],
      isTenantOwner: true,
    });

    expect(await loadDirectoryOwner(tenantId)).toEqual({
      status: "joined",
      name: "Joined",
      email: "joined@example.test",
    });
  });

  it("shows no owner when there is neither an owner nor an owner invitation", async () => {
    const [tenantId] = await GetModel(TenantModel).insert([
      { name: "Orphan", createdAt: new Date(), updatedAt: new Date() },
    ]);

    expect(await loadDirectoryOwner(tenantId!)).toEqual({
      status: "none",
      name: null,
      email: null,
    });
  });
});

describe("pending invitations listed on the workspace detail", () => {
  it("reports whether each invitation can still be redeemed", () => {
    const read = Object.getOwnPropertyDescriptor(
      invitationsDataAPI.prototype,
      "status",
    )?.get;
    assert(read);

    expect(
      read.call({ table: { expiresAt: new Date(Date.now() + DAY_MS) } }),
    ).toBe(true);
    expect(
      read.call({ table: { expiresAt: new Date(Date.now() - DAY_MS) } }),
    ).toBe(false);
  });

  it("counts the owner invitation beside the members in the detail header", async () => {
    const { tenantId } = await createInvitedWorkspace();

    const overview = await new SaasWorkspaceDetailController().overview(
      operator,
      tenantId,
    );

    expect(overview).toMatchObject({
      members: 0,
      pendingInvitations: 1,
      ownerStatus: "invited",
    });
  });

  it("leaves an expired invitation out of the pending count", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    await GetModel(UserInviteModel, tenantId).update(owner.inviteId, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const overview = await new SaasWorkspaceDetailController().overview(
      operator,
      tenantId,
    );

    expect(overview.pendingInvitations).toBe(0);
  });
});

describe("copy invitation link", () => {
  it("hands over the link the email carries and journals the disclosure", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    const invite = await storedInvite(tenantId);

    const result = await invitationsController().copyLink(
      operator,
      tenantId,
      owner.inviteId,
    );

    expect(result.link).toBe(signupLinkOf(invite));
    const [journaled] = await journalAfterCreation(tenantId);
    expect(journaled).toMatchObject({
      action: "invitation.link_copy",
      actorId: operator._id,
      actorEmail: operator.email,
      status: "succeeded",
      details: { inviteId: owner.inviteId },
    });
    expect(JSON.stringify(journaled!.details)).not.toContain(invite.token);
  });

  it("renews an expired invitation so the link can still be redeemed", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    await GetModel(UserInviteModel, tenantId).update(owner.inviteId, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const result = await invitationsController().copyLink(
      operator,
      tenantId,
      owner.inviteId,
    );

    const renewed = await storedInvite(tenantId);
    expect(renewed.token).not.toBe(owner.token);
    expect(renewed.asTenantOwner).toBe(true);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.link).toBe(signupLinkOf(renewed));
  });

  it("rejects an unknown invitation", async () => {
    const { tenantId } = await createInvitedWorkspace();

    await expect(
      invitationsController().copyLink(operator, tenantId, randomUUID()),
    ).rejects.toMatchObject({ body: "saas.errors.invitations.not_found" });
  });
});

describe("resend invitation from the back office", () => {
  it("reissues the invitation and emails the new link", async () => {
    const { email, tenantId, owner } = await createInvitedWorkspace();
    sendInviteEmail.mockClear();

    const result = await invitationsController().resend(
      operator,
      tenantId,
      owner.inviteId,
    );

    const renewed = await storedInvite(tenantId);
    expect(result.emailDelivery).toBe("sent");
    expect(renewed.token).not.toBe(owner.token);
    expect(sendInviteEmail).toHaveBeenCalledWith(
      email,
      renewed.token,
      undefined,
      {
        workspaceName: WORKSPACE_NAME,
        inviterName: "Olivia Operator",
        language: renewed.language,
      },
    );
  });

  it("keeps the renewed invitation but reports an email that did not leave", async () => {
    const { tenantId, owner } = await createInvitedWorkspace();
    sendInviteEmail.mockRejectedValue(new Error("smtp down"));

    const failure = await httpRefusal(
      invitationsController().resend(operator, tenantId, owner.inviteId),
    );

    expect(failure).toBeInstanceOf(HTTPResult);
    expect(failure).toMatchObject({
      body: "saas.errors.invitations.email_not_sent",
    });
    expect((await storedInvite(tenantId)).token).not.toBe(owner.token);
    const [journaled] = await journalAfterCreation(tenantId);
    expect(journaled).toMatchObject({
      action: "invitation.resend",
      details: { emailDelivery: "failed" },
    });
  });
});
