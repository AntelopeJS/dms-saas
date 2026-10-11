import { CustomComponent } from "@antelopejs/interface-dms/base/custom";

/** The public page a navigation bar heads: its link reads as the current one. */
export type PublicNavPage = "pricing" | "register" | "legal";

/**
 * The bar heading a public page, above its content: the public pages to
 * browse, then signing in or opening an account.
 */
export function publicNavBar(current: PublicNavPage) {
  return CustomComponent("DmsSaasPublicNavBar")
    .meta({
      name: "$saas.permissions.public.nav_bar",
      description: "$saas.permissions.public.nav_bar_description",
      icon: "i-ph-compass",
    })
    .options({ current });
}
