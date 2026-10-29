import { describe, expect, it } from "vitest";
import { SaasTermsOfUsePage } from "../src/pages/public/legal/terms-of-use";
import { SaasPricingPage } from "../src/pages/public/pricing";
import { SaasRegisterController } from "../src/pages/public/register";

const PAGES = [
  ["pricing", SaasPricingPage],
  ["register", SaasRegisterController],
  ["legal", SaasTermsOfUsePage],
] as const;

describe("public navigation bar", () => {
  it.each(PAGES)(
    "heads the %s page, its link marked current",
    (current, page) => {
      const bar = page.navBar.serializeSync();

      expect(bar.options).toMatchObject({ current });
      expect(Object.keys(page)[0]).toBe("navBar");
    },
  );
});
