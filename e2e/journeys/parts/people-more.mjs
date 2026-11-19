import { check, createPlan, fixture, pick, register, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

const USERS_PAGE = "/modules/saas/customers/users";

/** The segment editor and the Users list tabs. */
export const peopleMoreJourneys = [
  {
    id: "the-platform-owner-creates-a-segment-in-the-editor-and-the-list-shows-it",
    title: "the platform owner builds an e-mail rule in the segment editor, the live preview counts the match, saving lists the segment with that count, and the segments API reads it",
    entryPoint: "Customers › Segments, GET /api/saas/segments/:id",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "alpha");
      await register(ctx, "beta");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/saas/customers/segments/new");
      await ctx.verify("the editor opens on an empty rule", [tab.shows(/Group users with rules, previewed live before you save/, { timeoutMs: 60_000 })], { critical: true });
      await tab.fill({ role: "textbox", name: "Name", exact: true }, "Alpha users");
      await tab.click({ role: "button", name: "Add condition" });
      await tab.fill({ role: "textbox", name: "Type a value" }, "alpha");
      await ctx.verify("the live preview counts the one account whose e-mail contains alpha", [tab.shows(/1 user matches[\s\S]*of 3 users/, { timeoutMs: 30_000 })]);
      await tab.click({ role: "button", name: "Save and re-evaluate" });
      await ctx.verify("saving opens the segment's edit page", [tab.at(/\/modules\/saas\/customers\/segments\/[^/]+\/edit$/, { timeoutMs: 60_000 })], { critical: true });
      const id = new URL(tab.page.url()).pathname.split("/").at(-2) ?? "";
      const stored = await saas(ctx, "the saved segment", "GET", `/segments/${id}`);
      await ctx.verify("the API holds the segment with its rule and its count", [
        check("named Alpha users", text(stored.body, "name") === "Alpha users", stored.body),
        check("the rule is: e-mail contains alpha", JSON.stringify(pick(stored.body, "conditions", "conditions")) === JSON.stringify([{ field: "email", operator: "contains", value: "alpha" }]), stored.body),
        check("it matches one user, evaluated on save", pick(stored.body, "estimatedCount") === 1 && text(stored.body, "lastEvaluatedAt") !== "", stored.body),
      ]);
      await tab.goto("/modules/saas/customers/segments");
      await ctx.verify("the Segments list shows the segment with its rule and its one match", [tab.visible({ role: "row", name: /Alpha users Email contains “alpha” 1/ }, { timeoutMs: 60_000 })]);
    },
  },
  {
    id: "the-all-and-platform-admins-tabs-list-exactly-their-accounts",
    title: "All lists every account and Platform admins only the admins, each tab with its count",
    entryPoint: "Customers › Users",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "plain-one");
      await register(ctx, "plain-two");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(USERS_PAGE);
      await ctx.verify("the tabs carry their counts", [tab.visible({ role: "button", name: "All 3" }, { timeoutMs: 60_000 }), tab.visible({ role: "button", name: "Platform admins 1" }, { timeoutMs: 15_000 })]);
      await ctx.verify("All lists the three accounts", [tab.shows(/plain-one/, { timeoutMs: 30_000 }), tab.shows(/plain-two/, { timeoutMs: 15_000 }), tab.shows(/Platform admin/, { timeoutMs: 15_000 })]);
      await tab.click({ role: "button", name: "Platform admins 1" });
      await ctx.verify("Platform admins lists the admin and neither visitor", [tab.shows(/Verify admin/i, { timeoutMs: 30_000 }), tab.count({ role: "row", name: /plain-one/ }, 0), tab.count({ role: "row", name: /plain-two/ }, 0)]);
    },
  },
  {
    id: "the-unverified-tab-lists-the-accounts-whose-address-is-not-verified",
    title: "accounts that registered and never verified their e-mail address are listed under Unverified, which counts them",
    entryPoint: "Customers › Users",
    async run(/** @type {Ctx} */ ctx) {
      await createPlan(ctx, "free");
      await register(ctx, "unverified-one");
      await register(ctx, "unverified-two");
      const unverified = await fixture(ctx, "an account that never verified", "POST", "/account-without-workspace", { email: ctx.email("never"), name: "Never Verified", password: ctx.password() });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(USERS_PAGE);
      await ctx.verify("the Unverified tab counts the three accounts that never verified", [
        check("the fixture made an account", text(unverified.body, "userId") !== "", unverified.body),
        tab.visible({ role: "button", name: "Unverified 3" }, { timeoutMs: 60_000 }),
      ]);
      await tab.click({ role: "button", name: /^Unverified/ });
      await ctx.verify("and lists them", [tab.shows(/unverified-one/, { timeoutMs: 30_000 }), tab.shows(/unverified-two/, { timeoutMs: 15_000 }), tab.shows(/never/i, { timeoutMs: 15_000 })]);
    },
  },
];
