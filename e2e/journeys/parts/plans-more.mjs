import { check, createPlan, isText, pick, planBody, saas, text } from "../../saas.mjs";

/** @typedef {import("../../saas.mjs").Ctx} Ctx */

/**
 * @param {unknown} value A localized text as the API reads it
 * @returns {string} Its English text
 */
function english(value) {
  return isText(value) ? value : text(value, "en");
}

/** The plan editor's text fields. */
export const planTextJourneys = [
  {
    id: "every-text-field-of-a-plan-is-saved-trimmed",
    title: "name, description and badge are saved trimmed on create and on save, and a save of one text keeps the others",
    entryPoint: "POST /api/saas/plans, PUT /api/saas/plans/:id",
    async run(/** @type {Ctx} */ ctx) {
      const created = await saas(ctx, "create a plan with padded texts", "POST", "/plans", {
        body: planBody({ slug: "  padded  ", name: { en: "  Padded Name  " }, description: { en: "  A padded description.  " }, borderLabel: { en: "  Popular  " } }),
      });
      const id = text(created.body, "_id");
      const read = await saas(ctx, "read the plan", "GET", `/plans/${id}`);
      await ctx.verify("create stores each text and the slug trimmed", [
        check("created", created.status === 200 && id !== "", created.body),
        check("name: Padded Name", english(pick(read.body, "name")) === "Padded Name", read.body),
        check("description: A padded description.", english(pick(read.body, "description")) === "A padded description.", read.body),
        check("badge: Popular", english(pick(read.body, "borderLabel")) === "Popular", read.body),
        check("slug: padded", text(read.body, "slug") === "padded", read.body),
      ]);
      const saved = await saas(ctx, "save padded texts", "PUT", `/plans/${id}`, { body: { description: { en: "\t Edited description \n" }, borderLabel: { en: " Best value " } } });
      const after = await saas(ctx, "read the plan after the save", "GET", `/plans/${id}`);
      await ctx.verify("a save trims too and keeps the texts it leaves out", [
        check("saved", saved.status === 200, saved.body),
        check("description: Edited description", english(pick(after.body, "description")) === "Edited description", after.body),
        check("badge: Best value", english(pick(after.body, "borderLabel")) === "Best value", after.body),
        check("name untouched", english(pick(after.body, "name")) === "Padded Name", after.body),
      ]);
      const other = await createPlan(ctx, "second", { name: { en: " Second " } });
      const second = await saas(ctx, "read the second plan", "GET", `/plans/${other.id}`);
      await ctx.verify("a plan created through the helper is trimmed as well", [check("name: Second", english(pick(second.body, "name")) === "Second", second.body)]);
    },
  },
];
