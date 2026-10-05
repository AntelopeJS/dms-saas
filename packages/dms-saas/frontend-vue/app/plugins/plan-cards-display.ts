import PlanCardsDisplay from "../components/PlanCardsDisplay.vue";

const PLAN_CARDS_DISPLAY_ID = "saas:plan-cards";
const PLAN_CARDS_DISPLAY_LABEL = "saas.plans.display.cards";
const PLAN_CARDS_DISPLAY_ICON = "i-ph-cards";
const PLAN_CARDS_DISPLAY_ORDER = 5;

export default defineDmsPlugin(() => {
  registerTableViewDisplay({
    id: PLAN_CARDS_DISPLAY_ID,
    label: PLAN_CARDS_DISPLAY_LABEL,
    icon: PLAN_CARDS_DISPLAY_ICON,
    order: PLAN_CARDS_DISPLAY_ORDER,
    component: PlanCardsDisplay,
  });
});
