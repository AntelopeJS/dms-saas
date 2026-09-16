import PlanCardsDisplay from "../components/PlanCardsDisplay.vue";

const CARDS_DISPLAY_ID = "cards";
const CARDS_DISPLAY_LABEL = "saas.plans.display.cards";
const CARDS_DISPLAY_ICON = "i-ph-cards";
const CARDS_DISPLAY_ORDER = 5;

export default defineDmsPlugin(() => {
  registerTableViewDisplay({
    id: CARDS_DISPLAY_ID,
    label: CARDS_DISPLAY_LABEL,
    icon: CARDS_DISPLAY_ICON,
    order: CARDS_DISPLAY_ORDER,
    component: PlanCardsDisplay,
  });
});
