import { allPermissionIds, check, createPlan, fixture, list, register, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/** The invitation a workspace owner sends from the Members page. */
export const memberJourneys = [
  {
    id: "an-owner-invites-a-member-from-the-members-page-and-the-invitation-is-pending",
    title: "the owner sends an invitation from the Invite members dialog, the invitation e-mail arrives with a sign-up link, and the Invitations page lists it as pending",
    entryPoint: "Settings › Workspace › Members, Settings › Workspace › Member invitations, POST /dms/pages/settings/workspace/members/invite",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free", { name: { en: "Free" }, permissions: await allPermissionIds(ctx) });
      const owner = await register(ctx, "inviter", { workspaceName: "Invite Co" });
      const guest = ctx.email("guest");
      const tab = await ctx.tab("inviter");
      await tab.signIn("inviter");
      await tab.goto("/settings/workspace/members");
      await ctx.verify("the Members page lists the owner alone and offers Invite members", [tab.visible({ role: "button", name: "Members 1" }, { timeoutMs: 60_000 }), tab.visible({ role: "button", name: "Invite members" }, { timeoutMs: 15_000 })], { critical: true });
      await tab.click({ role: "button", name: "Invite members" });
      const dialog = { role: "dialog", name: "Invite members" };
      await tab.fill({ role: "textbox", name: "Email addresses", within: dialog }, guest);
      await tab.press("Enter", { role: "textbox", name: "Email addresses", within: dialog });
      await tab.click({ role: "button", name: "Member", exact: true, within: dialog });
      await tab.click({ role: "button", name: "Send invitations", within: dialog });
      const sent = await ctx.mail((message) => message.to.some((to) => to.includes(guest)));
      await ctx.verify("the invitation e-mail reaches the invited address with a sign-up link", [
        check("a message is addressed to the guest", sent.match !== undefined, sent.messages.map((message) => message.to)),
        check("it names the workspace", sent.match?.subject.includes("Invite Co") === true, sent.match?.subject),
        check("it carries a sign-up link", sent.match?.links.some((link) => /\/auth\/signup\?token=/.test(link)) === true, sent.match?.links),
      ], { critical: true });
      await tab.goto("/settings/workspace/invites");
      await ctx.verify("the Invitations page lists the guest as pending, with the Member role", [
        tab.visible({ role: "row", name: new RegExp(`${RegExp.escape(guest)}.*Member.*Pending`) }, { timeoutMs: 60_000 }),
        tab.visible({ role: "button", name: "Invitations 1" }, { timeoutMs: 15_000 }),
        tab.shows(/1 member\s*1 pending invite/, { timeoutMs: 15_000 }),
      ]);
      const pending = await fixture(ctx, "the invitations of the workspace", "GET", `/invites/${owner.tenantId}`);
      await ctx.verify("the workspace holds exactly that invitation", [check("one invitation, to the guest", list(pending.body).length === 1 && text(list(pending.body)[0], "email") === guest, pending.body)]);
    },
  },
];
