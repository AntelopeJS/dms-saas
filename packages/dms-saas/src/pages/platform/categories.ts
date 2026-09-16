import { Category } from "@antelopejs/interface-dms/page";
import { saasModule } from "../module";

export const overviewCategory = Category("overview", {
  displayName: "$saas.menu.overview",
  category: saasModule,
  icon: "i-ph-gauge",
  type: "label",
  order: 0,
});

export const customersCategory = Category("customers", {
  displayName: "$saas.menu.customers",
  category: saasModule,
  icon: "i-ph-users-three",
  type: "label",
  order: 10,
});

export const catalogCategory = Category("catalog", {
  displayName: "$saas.menu.catalog",
  category: saasModule,
  icon: "i-ph-package",
  type: "label",
  order: 20,
});

export const billingCategory = Category("billing", {
  displayName: "$saas.menu.billing",
  category: saasModule,
  icon: "i-ph-receipt",
  type: "label",
  order: 30,
});

export const configurationCategory = Category("configuration", {
  displayName: "$saas.menu.configuration",
  category: saasModule,
  icon: "i-ph-sliders",
  type: "label",
  order: 40,
});

export const supportCategory = Category("support", {
  displayName: "$saas.menu.support",
  category: saasModule,
  icon: "i-ph-lifebuoy",
  type: "label",
  order: 35,
});
